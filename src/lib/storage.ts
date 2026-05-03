/**
 * KV-backed project state for the hosted Flow MCP server.
 *
 * Storage backend: Upstash Redis (provisioned via Vercel Marketplace).
 * The Marketplace integration injects either UPSTASH_REDIS_REST_URL/TOKEN
 * or the legacy KV_REST_API_URL/TOKEN names — we accept both.
 *
 * Lazy module-scope init: client is constructed on first use so that
 * functions with no KV needs (e.g. the stub tool) don't fail at cold
 * start when the env isn't provisioned yet. Falls back to an in-process
 * Map in local `vercel dev` without KV — fine for testing, useless across
 * cold starts (which is the whole point of moving to KV in production).
 */

import { Redis } from "@upstash/redis";
import crypto from "crypto";

// ─── Types (inlined from former src/lib/state.ts) ────────────────────────────

export interface IntegrationState {
  id: string;
  status: "not_configured" | "in_progress" | "configured" | "expiring" | "expired";
  configured_at?: string;
  credentials: Record<string, string>;
  environments_synced: string[];
  warnings_acknowledged: string[];
  playbook_version: string;
}

export interface ProjectState {
  project_name: string;
  initialized_at: string;
  stack: string[];
  environments: string[];
  dev_env_file?: string;
  integrations: Record<string, IntegrationState>;
}

// ─── Client ──────────────────────────────────────────────────────────────────

let _redis: Redis | null | undefined; // undefined = unchecked, null = no KV configured

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

// In-memory fallback for `vercel dev` without KV. Lost on every cold start.
const memory = new Map<string, string>();

async function kvGet(key: string): Promise<string | null> {
  const r = getRedis();
  if (r) return (await r.get<string>(key)) ?? null;
  return memory.get(key) ?? null;
}

async function kvSet(key: string, value: string): Promise<void> {
  const r = getRedis();
  if (r) await r.set(key, value);
  else memory.set(key, value);
}

// ─── Identity helpers ────────────────────────────────────────────────────────

export function generateInstallId(): string {
  return crypto.randomUUID();
}

export function generateProjectId(projectRoot: string): string {
  // Stable per-machine: hash the absolute path. Doesn't need to be
  // cryptographic — short hex is enough to disambiguate within an install.
  return crypto
    .createHash("sha256")
    .update(projectRoot)
    .digest("hex")
    .slice(0, 16);
}

// ─── State ops ───────────────────────────────────────────────────────────────

function stateKey(installId: string, projectId: string): string {
  return `state:${installId}:${projectId}`;
}

export async function getState(
  installId: string,
  projectId: string
): Promise<ProjectState | null> {
  const raw = await kvGet(stateKey(installId, projectId));
  if (!raw) return null;
  try {
    return typeof raw === "string" ? JSON.parse(raw) : (raw as ProjectState);
  } catch {
    return null;
  }
}

export async function setState(
  installId: string,
  projectId: string,
  state: ProjectState
): Promise<void> {
  await kvSet(stateKey(installId, projectId), JSON.stringify(state));
}

export async function updateIntegration(
  installId: string,
  projectId: string,
  integrationId: string,
  status: ProjectState["integrations"][string]["status"],
  extras?: Partial<ProjectState["integrations"][string]>
): Promise<void> {
  const existing =
    (await getState(installId, projectId)) ??
    ({
      project_name: projectId,
      initialized_at: new Date().toISOString(),
      stack: [],
      environments: ["development"],
      integrations: {},
    } satisfies ProjectState);

  existing.integrations[integrationId] = {
    ...(existing.integrations[integrationId] ?? {
      id: integrationId,
      credentials: {},
      environments_synced: [],
      warnings_acknowledged: [],
      playbook_version: "unknown",
    }),
    status,
    ...extras,
  };

  await setState(installId, projectId, existing);
}

export function isKvConfigured(): boolean {
  return getRedis() !== null;
}

// ─── Vault ops (per-install/user × project × env credential maps) ────────────
//
// Vault is what the flow-vault runtime fetches at app boot. Key format:
//   vault:<installOrUserId>:<projectName>:<environment>
// Stored value: Record<string, string> of env vars to inject.

function vaultKey(
  installOrUserId: string,
  projectName: string,
  environment: string
): string {
  return `vault:${installOrUserId}:${projectName}:${environment}`;
}

export async function getVault(
  installOrUserId: string,
  projectName: string,
  environment: string
): Promise<Record<string, string>> {
  const raw = await kvGet(vaultKey(installOrUserId, projectName, environment));
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") clean[k] = v;
    }
    return clean;
  } catch {
    return {};
  }
}

export async function setVault(
  installOrUserId: string,
  projectName: string,
  environment: string,
  data: Record<string, string>
): Promise<void> {
  await kvSet(
    vaultKey(installOrUserId, projectName, environment),
    JSON.stringify(data)
  );
}

export async function mergeVault(
  installOrUserId: string,
  projectName: string,
  environment: string,
  patch: Record<string, string>
): Promise<void> {
  const existing = await getVault(installOrUserId, projectName, environment);
  await setVault(installOrUserId, projectName, environment, { ...existing, ...patch });
}
