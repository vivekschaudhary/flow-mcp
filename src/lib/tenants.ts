/**
 * Tenants — namespace + kill-switch layer on top of install_ids.
 *
 * Today, 1 install_id == 1 tenant (single-developer team). The tenant
 * primitive lets the admin disable a specific install without rotating
 * the shared dev creds for everyone. When real multi-developer teams
 * arrive (post `flow login`), the tenant can have multiple install_ids
 * mapped to it; the same enable/disable surface keeps working.
 *
 * KV layout:
 *   tenant:<install_id>      → JSON Tenant record
 *   tenants                  → ZSET; member=install_id, score=last_active_ms
 *
 * The ZSET lets `listTenants` paginate by recent activity without scanning
 * all keys. The score-on-touch pattern means active tenants float to the
 * top automatically.
 *
 * Privacy: install_id is opaque (UUID). No PII stored.
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

export type TenantStatus = "active" | "disabled";

export interface Tenant {
  id: string;
  created_at: string;
  last_active_at: string;
  status: TenantStatus;
  disabled_at?: string;
  disabled_reason?: string;
}

const TENANTS_INDEX = "tenants";
const tenantKey = (id: string) => `tenant:${id}`;

/** Read a tenant record. Returns null if not found. */
export async function getTenant(id: string): Promise<Tenant | null> {
  const redis = getRedis();
  if (!redis) return null;
  const raw = await redis.get<string>(tenantKey(id));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as Tenant);
  } catch {
    return null;
  }
}

/**
 * Ensure a tenant exists for this install_id. If absent, creates one
 * with status="active". If present, returns the existing record. Idempotent.
 *
 * Also bumps the tenants index score to now (for "newly active" sort order).
 */
export async function ensureTenant(id: string): Promise<Tenant | null> {
  const redis = getRedis();
  if (!redis) return null;

  const existing = await getTenant(id);
  if (existing) {
    // Touch activity score; don't overwrite the record itself.
    await redis.zadd(TENANTS_INDEX, { score: Date.now(), member: id });
    return existing;
  }

  const now = new Date().toISOString();
  const tenant: Tenant = {
    id,
    created_at: now,
    last_active_at: now,
    status: "active",
  };
  await redis.set(tenantKey(id), JSON.stringify(tenant));
  await redis.zadd(TENANTS_INDEX, { score: Date.now(), member: id });
  return tenant;
}

/**
 * Update a tenant's last_active_at to now. Cheap — just a SET + ZADD.
 * Called on every authenticated request that touches a tenant's data.
 *
 * Returns the updated tenant, or null if it doesn't exist (caller should
 * have called ensureTenant first).
 */
export async function touchTenant(id: string): Promise<Tenant | null> {
  const redis = getRedis();
  if (!redis) return null;
  const tenant = await getTenant(id);
  if (!tenant) return null;
  tenant.last_active_at = new Date().toISOString();
  await redis.set(tenantKey(id), JSON.stringify(tenant));
  await redis.zadd(TENANTS_INDEX, { score: Date.now(), member: id });
  return tenant;
}

/** Mark a tenant as disabled. Future requests get 403 from the vault. */
export async function disableTenant(
  id: string,
  reason: string
): Promise<Tenant | null> {
  const redis = getRedis();
  if (!redis) return null;
  const tenant = await getTenant(id);
  if (!tenant) return null;
  tenant.status = "disabled";
  tenant.disabled_at = new Date().toISOString();
  tenant.disabled_reason = reason;
  await redis.set(tenantKey(id), JSON.stringify(tenant));
  return tenant;
}

/** Re-enable a previously-disabled tenant. */
export async function enableTenant(id: string): Promise<Tenant | null> {
  const redis = getRedis();
  if (!redis) return null;
  const tenant = await getTenant(id);
  if (!tenant) return null;
  tenant.status = "active";
  delete tenant.disabled_at;
  delete tenant.disabled_reason;
  await redis.set(tenantKey(id), JSON.stringify(tenant));
  return tenant;
}

/**
 * List tenants in reverse-chronological activity order (most recently
 * active first). Defaults to the top 50.
 */
export async function listTenants(limit = 50): Promise<Tenant[]> {
  const redis = getRedis();
  if (!redis) return [];
  // ZREVRANGE — most recent activity first.
  const ids = await redis.zrange<string[]>(TENANTS_INDEX, 0, limit - 1, {
    rev: true,
  });
  if (!ids || ids.length === 0) return [];
  // Bulk fetch records.
  const tenants: Tenant[] = [];
  for (const id of ids) {
    const t = await getTenant(id);
    if (t) tenants.push(t);
  }
  return tenants;
}
