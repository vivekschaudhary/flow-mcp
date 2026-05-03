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
 *   1. Stored vault entries from Flow MCP tool runs (flow_setup_oauth, etc.)
 *   2. For environment="development" only: shared dev credentials from
 *      Flow's own GCP project, mapped from FLOW_GOOGLE_CLIENT_ID/SECRET
 *      (Vercel project env) into GOOGLE_CLIENT_ID/SECRET in the response.
 *      Stored entries take priority on key overlap.
 *   3. For environment="preview"/"production": stored only — never expose
 *      shared dev creds outside dev.
 *
 * Failure modes return JSON with non-200 status:
 *   401 missing/empty bearer
 *   400 missing project param
 */

import { getVault } from "../../src/lib/storage.js";

export const runtime = "nodejs";
export const maxDuration = 10;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sharedDevCreds(): Record<string, string> {
  const out: Record<string, string> = {};
  if (process.env.FLOW_GOOGLE_CLIENT_ID) {
    out.GOOGLE_CLIENT_ID = process.env.FLOW_GOOGLE_CLIENT_ID;
  }
  if (process.env.FLOW_GOOGLE_CLIENT_SECRET) {
    out.GOOGLE_CLIENT_SECRET = process.env.FLOW_GOOGLE_CLIENT_SECRET;
  }
  return out;
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const project = url.searchParams.get("project");
  const envParam = url.searchParams.get("env") || "development";

  const auth = request.headers.get("authorization") || "";
  const session = auth.replace(/^Bearer\s+/i, "").trim();

  if (!session) return jsonResponse(401, { error: "missing bearer token" });
  if (!project) return jsonResponse(400, { error: "missing project query param" });

  const stored = await getVault(session, project, envParam);

  // Dev: stored merged on top of shared dev creds.
  // Preview/prod: stored only.
  const merged =
    envParam === "development"
      ? { ...sharedDevCreds(), ...stored }
      : stored;

  return jsonResponse(200, merged);
}

export { handle as GET };
