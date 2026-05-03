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

export const runtime = "nodejs";
export const maxDuration = 10;

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const project = url.searchParams.get("project");
  const envParam = url.searchParams.get("env") || "development";

  const auth = request.headers.get("authorization") || "";
  const session = auth.replace(/^Bearer\s+/i, "").trim();

  if (!session) return jsonResponse(401, { error: "missing bearer token" });
  if (!project) return jsonResponse(400, { error: "missing project query param" });

  // Rate limit: per-IP and per-install_id, minute + hour windows.
  // Tight caps because legitimate flow-vault preload only hits this
  // once per app boot (cached for the process lifetime).
  const verdict = await checkRateLimit(clientIp(request), session);
  if (!verdict.allowed) {
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

  // Project state determines which providers' env vars to surface.
  // No state → no configured integrations → empty response. The runtime
  // degrades gracefully (developer's existing env still works).
  const state = await getState(session, project);
  const configuredIntegrationIds = state
    ? Object.keys(state.integrations).filter(
        (id) => state.integrations[id].status === "configured"
      )
    : [];

  // Stored vault entries (per env). Captured creds, manual overrides, etc.
  const stored = await getVault(session, project, envParam);

  // Shared dev creds — only for env=development. For preview/prod we want
  // explicit user-owned creds (or nothing). This is the trust boundary.
  const sharedDev =
    envParam === "development"
      ? sharedDevValuesForIntegrations(configuredIntegrationIds)
      : {};

  // Stored takes priority over shared.
  const merged = { ...sharedDev, ...stored };

  return jsonResponse(200, merged);
}

export { handle as GET };
