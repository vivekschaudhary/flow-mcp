/**
 * Telemetry — minimum viable event logging for Flow's hosted endpoints.
 *
 * Each tool / endpoint call emits one structured event. Events are stored
 * in Upstash Redis as a sorted set per day, scored by timestamp:
 *
 *   ZADD events:2026-05-04 <ms-timestamp> <json-event>
 *   EXPIRE events:2026-05-04 7776000   (90 days)
 *
 * Aggregation is read-time (api/admin/usage.ts loads daily sets, aggregates
 * in memory). Acceptable for current scale; can swap to a pre-aggregated
 * pipeline (or PostHog / Vercel Analytics) when query volume demands it.
 *
 * Privacy posture:
 *   - install_id and project_name are sha256-hashed (first 16 chars) before
 *     storage. Distinct-countable, not reversible.
 *   - Raw IP never stored. Only ip_country from Vercel's CF-IPCountry header.
 *   - User-Agent narrowed to a coarse "ai_tool_hint" (claude / cursor /
 *     windsurf / unknown), not the full string.
 *
 * Failure mode: every logEvent is wrapped in try/catch. Telemetry must
 * never throw or block. If Redis is down, events are silently dropped —
 * acceptable for visibility, unacceptable to fail a user request over.
 */

import { Redis } from "@upstash/redis";
import crypto from "crypto";

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

const RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 days

export interface FlowEvent {
  /** ISO8601 timestamp when the event was emitted. */
  ts: string;
  /** Which surface emitted: "mcp" (tool call) or "vault" (credential fetch) or "admin". */
  source: "mcp" | "vault" | "admin";
  /** MCP tool name. Set when source="mcp". */
  tool?: string;
  /** Provider id. Set on flow_setup_provider calls. */
  provider?: string;
  /** Environment — development/preview/production. */
  env?: string;
  /** Hashed install_id (first 16 hex chars of sha256). Pseudonymous. */
  install_id_hash?: string;
  /** Hashed project_name (first 16 hex chars of sha256). */
  project_id_hash?: string;
  /** Did the operation succeed? */
  ok: boolean;
  /** Server-side handler latency in ms. */
  latency_ms: number;
  /** Two-letter country code from Vercel's CF-IPCountry header. */
  ip_country?: string;
  /** Coarse client identifier — claude / cursor / windsurf / unknown. */
  ai_tool_hint?: string;
  /** Optional error code for failed operations (e.g. "rate_limit", "missing_param"). */
  error_code?: string;
}

/** Hash a value to a short, distinct-countable, non-reversible token. */
export function hashId(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  return crypto
    .createHash("sha256")
    .update(value)
    .digest("hex")
    .slice(0, 16);
}

/** Detect ai_tool_hint from a User-Agent string. */
export function detectAiTool(userAgent: string | null | undefined): string | undefined {
  if (!userAgent) return undefined;
  const ua = userAgent.toLowerCase();
  if (ua.includes("claude")) return "claude";
  if (ua.includes("cursor")) return "cursor";
  if (ua.includes("windsurf")) return "windsurf";
  if (ua.includes("vscode") || ua.includes("vs code")) return "vscode";
  if (ua.includes("curl")) return "curl";
  if (ua.includes("node")) return "node";
  return undefined;
}

/** Day key for the sorted set (YYYY-MM-DD UTC). */
function dayKey(date = new Date()): string {
  return `events:${date.toISOString().slice(0, 10)}`;
}

/**
 * Log a single event. Fire-and-forget: never throws.
 *
 * @returns the event written (for callers that want to inspect / chain),
 *          or null if telemetry was disabled or failed.
 */
export async function logEvent(event: FlowEvent): Promise<FlowEvent | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;

    const key = dayKey(new Date(event.ts));
    const score = new Date(event.ts).getTime();
    await redis.zadd(key, { score, member: JSON.stringify(event) });
    // Refresh TTL each write — cheap, ensures the set always has a future
    // expiration even if it's been around for a while.
    await redis.expire(key, RETENTION_SECONDS);

    return event;
  } catch {
    // Swallow — telemetry MUST NOT break a user request.
    return null;
  }
}

/**
 * Read raw events for a date range. Used by the admin aggregation endpoint.
 *
 * Inclusive of both endpoints (UTC days). Each daily set is fetched in full
 * and the events are concatenated. For high-volume periods this becomes
 * expensive — acceptable for current scale, swap to pre-aggregated counters
 * when daily event count crosses ~10k.
 */
export async function readEvents(
  fromDate: string,
  toDate: string
): Promise<FlowEvent[]> {
  const redis = getRedis();
  if (!redis) return [];

  const from = new Date(fromDate + "T00:00:00Z");
  const to = new Date(toDate + "T23:59:59Z");

  const events: FlowEvent[] = [];
  for (
    let d = new Date(from);
    d <= to;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const key = dayKey(d);
    try {
      const raw = await redis.zrange<string[]>(key, 0, -1);
      for (const r of raw) {
        try {
          // Upstash sometimes pre-parses JSON-shaped strings; handle both.
          const parsed = typeof r === "string" ? JSON.parse(r) : (r as FlowEvent);
          events.push(parsed);
        } catch {
          // Skip malformed entries.
        }
      }
    } catch {
      // Skip days where the read fails (usually means the key TTL'd out).
    }
  }

  return events;
}
