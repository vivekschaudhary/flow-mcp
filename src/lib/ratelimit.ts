/**
 * Rate limiter for the vault endpoint.
 *
 * Two-layer caps: per-IP and per-install_id. Each layer has a per-minute
 * and per-hour bucket. First check that trips returns 429 with a hint
 * about which bucket fired and how long until the window resets.
 *
 * Limits (deliberately tight — the vault endpoint is read-only and a
 * legitimate flow-vault preload only hits it ~once per app boot):
 *
 *   Per IP        30 req/min  200 req/hour
 *   Per install   5  req/min  50  req/hour
 *
 * Storage: Upstash Redis (the same KV that holds project state). Each
 * bucket is a tiny counter key with a TTL matching its window, so
 * memory usage stays bounded automatically.
 */

import { Redis } from "@upstash/redis";

let _redis: Redis | null | undefined;

function getRedis(): Redis | null {
  if (_redis !== undefined) return _redis;
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.KV_REST_API_URL ??
    null;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.KV_REST_API_TOKEN ??
    null;
  if (!url || !token) {
    _redis = null;
    return null;
  }
  _redis = new Redis({ url, token });
  return _redis;
}

const LIMITS = {
  ip_per_minute: 30,
  ip_per_hour: 200,
  install_per_minute: 5,
  install_per_hour: 50,
};

export interface RateLimitVerdict {
  allowed: boolean;
  /** Which bucket tripped. Null when allowed. */
  reason?: "ip-per-minute" | "ip-per-hour" | "install-per-minute" | "install-per-hour";
  /** Seconds until the offending bucket window resets. */
  retry_after?: number;
}

async function bumpBucket(
  redis: Redis,
  key: string,
  ttlSeconds: number
): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) {
    // Freshly-created bucket — set its TTL so it auto-expires after the window.
    // Done as a separate call (not pipelined) for simplicity; one extra round-trip
    // happens only at the start of a window, not on every request.
    await redis.expire(key, ttlSeconds);
  }
  return count;
}

/**
 * Check + bump rate-limit counters in one go.
 *
 * Returns { allowed: true } if the request fits under all four caps.
 * Returns { allowed: false, reason, retry_after } if any cap was exceeded.
 *
 * Important: this function ALWAYS bumps the counters, even when blocking.
 * That keeps the limit accurate during sustained abuse — without bumping,
 * a denied attacker could keep retrying within the same window without
 * incrementing past the cap.
 *
 * If KV is not configured (storage falls back to in-memory), this returns
 * { allowed: true } unconditionally — better to fail-open on infra issues
 * than block legitimate traffic when Redis is down.
 */
export async function checkRateLimit(
  ip: string,
  installId: string
): Promise<RateLimitVerdict> {
  const redis = getRedis();
  if (!redis) return { allowed: true };

  const now = Date.now();
  const minuteBucket = Math.floor(now / 60_000);
  const hourBucket = Math.floor(now / 3_600_000);

  const ipMin = await bumpBucket(redis, `rl:ip:${ip}:m:${minuteBucket}`, 70);
  const ipHr = await bumpBucket(redis, `rl:ip:${ip}:h:${hourBucket}`, 3700);
  const idMin = await bumpBucket(
    redis,
    `rl:id:${installId}:m:${minuteBucket}`,
    70
  );
  const idHr = await bumpBucket(
    redis,
    `rl:id:${installId}:h:${hourBucket}`,
    3700
  );

  // Check tightest first (per-install per-minute) and report the first trip.
  if (idMin > LIMITS.install_per_minute) {
    return {
      allowed: false,
      reason: "install-per-minute",
      retry_after: 60 - Math.floor((now % 60_000) / 1000),
    };
  }
  if (ipMin > LIMITS.ip_per_minute) {
    return {
      allowed: false,
      reason: "ip-per-minute",
      retry_after: 60 - Math.floor((now % 60_000) / 1000),
    };
  }
  if (idHr > LIMITS.install_per_hour) {
    return {
      allowed: false,
      reason: "install-per-hour",
      retry_after: 3600 - Math.floor((now % 3_600_000) / 1000),
    };
  }
  if (ipHr > LIMITS.ip_per_hour) {
    return {
      allowed: false,
      reason: "ip-per-hour",
      retry_after: 3600 - Math.floor((now % 3_600_000) / 1000),
    };
  }

  return { allowed: true };
}

/**
 * Extract a usable client IP from a Vercel Functions Request.
 * Vercel sets x-forwarded-for; we take the first entry (the originating client).
 * Falls back to "0.0.0.0" so we always have *something* to key by.
 */
export function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0].trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}
