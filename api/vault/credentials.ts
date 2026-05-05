/**
 * GET /api/vault/credentials?project=<name>&env=<environment>
 *
 * Called by the flow-vault runtime at app boot to retrieve the credential
 * map for (install/user, project, environment). Returns JSON object.
 *
 * Auth: Bearer token in Authorization header.
 *   v1 (anonymous): the token IS the install_id (no real session validation).
 *   v2 (later):     real session validation against KV-stored sessions.
 *
 * Resolution order for the response:
 *   1. For each integration the project has configured (per state.integrations),
 *      look up the provider in the registry and gather its runtime env vars.
 *   2. For env="development" only: merge in shared dev values from Flow's
 *      server env (e.g. FLOW_GOOGLE_CLIENT_ID → GOOGLE_CLIENT_ID).
 *   3. For env="preview"/"production": shared dev values are NOT included.
 *      Only what's been explicitly stored in the vault (post-M2.5 user-owned).
 *   4. Stored vault entries always take priority on overlap.
 *
 * Scoping: only providers the project has configured contribute env vars.
 * If a project sets up Google OAuth but not Resend, the response contains
 * GOOGLE_CLIENT_ID/SECRET but not RESEND_API_KEY.
 *
 * Failure modes return JSON with non-200 status:
 *   401 missing/empty bearer
 *   400 missing project param
 */

import { getState, getVault } from "../../src/lib/storage.js";
import { sharedDevValuesForIntegrations } from "../../src/lib/providers.js";
import { checkRateLimit, clientIp } from "../../src/lib/ratelimit.js";
import { logEvent, hashId, detectAiTool } from "../../src/lib/telemetry.js";
import { ensureTenant, getTenant } from "../../src/lib/tenants.js";

export const runtime = "nodejs";
export const maxDuration = 10;

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

async function handle(request: Request): Promise<Response> {
  const start = Date.now();
  const url = new URL(request.url);
  const project = url.searchParams.get("project");
  const envParam = url.searchParams.get("env") || "development";

  const auth = request.headers.get("authorization") || "";
  const session = auth.replace(/^Bearer\s+/i, "").trim();

  // Telemetry context — populated as we process; logged in finally-style
  // emit at every return point (one logEvent per response).
  const tel = {
    source: "vault" as const,
    install_id_hash: hashId(session),
    project_id_hash: hashId(project ?? undefined),
    env: envParam,
    ip_country: request.headers.get("x-vercel-ip-country") ?? undefined,
    ai_tool_hint: detectAiTool(request.headers.get("user-agent")),
  };
  const emit = (ok: boolean, errorCode?: string) =>
    logEvent({
      ...tel,
      ts: new Date().toISOString(),
      ok,
      latency_ms: Date.now() - start,
      error_code: errorCode,
    });

  if (!session) {
    await emit(false, "missing_bearer");
    return jsonResponse(401, { error: "missing bearer token" });
  }
  if (!project) {
    await emit(false, "missing_project");
    return jsonResponse(400, { error: "missing project query param" });
  }

  // Rate limit: per-IP and per-install_id, minute + hour windows.
  const verdict = await checkRateLimit(clientIp(request), session);
  if (!verdict.allowed) {
    await emit(false, `rate_limit_${verdict.reason}`);
    return jsonResponse(
      429,
      {
        error: "rate limit exceeded",
        reason: verdict.reason,
        retry_after_seconds: verdict.retry_after,
      },
      { "retry-after": String(verdict.retry_after ?? 60) }
    );
  }

  // Tenant gate. If admin has disabled this install_id, refuse with 403.
  // ensureTenant is idempotent + bumps last_active_at.
  await ensureTenant(session);
  const tenant = await getTenant(session);
  if (tenant && tenant.status === "disabled") {
    await emit(false, "tenant_disabled");
    return jsonResponse(403, {
      error: "tenant disabled",
      reason: tenant.disabled_reason,
    });
  }

  // Project state determines which providers' env vars to surface.
  const state = await getState(session, project);
  const configuredIntegrationIds = state
    ? Object.keys(state.integrations).filter(
        (id) => state.integrations[id].status === "configured"
      )
    : [];

  // Stored vault entries (per env).
  const stored = await getVault(session, project, envParam);

  // Shared dev creds — only for env=development.
  const sharedDev =
    envParam === "development"
      ? sharedDevValuesForIntegrations(configuredIntegrationIds)
      : {};

  // Stored takes priority over shared.
  const merged = { ...sharedDev, ...stored };

  await emit(true);
  return jsonResponse(200, merged);
}

export { handle as GET };
