/**
 * Admin tenant management.
 *
 * Auth: bearer token must equal FLOW_ADMIN_TOKEN. Same gate as /api/admin/usage.
 *
 * Endpoints:
 *   GET  /api/admin/tenants              → list tenants (most-recently-active first, default 50)
 *   GET  /api/admin/tenants?id=<id>      → single tenant detail
 *   POST /api/admin/tenants              → body: { id, action: "disable"|"enable", reason?: string }
 *
 * Use this to surgically disable an abusive install_id without rotating
 * the shared dev creds for everyone. The vault endpoint returns 403 to
 * disabled tenants on next request.
 */

import {
  getTenant,
  listTenants,
  disableTenant,
  enableTenant,
  type Tenant,
} from "../../src/lib/tenants.js";

export const runtime = "nodejs";
export const maxDuration = 30;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authorize(request: Request): { ok: boolean; reason?: string } {
  const expected = process.env.FLOW_ADMIN_TOKEN;
  if (!expected) {
    return {
      ok: false,
      reason:
        "admin endpoint not configured — set FLOW_ADMIN_TOKEN on Vercel project",
    };
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== expected) {
    return { ok: false, reason: "unauthorized" };
  }
  return { ok: true };
}

async function handleGet(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (id) {
    const tenant = await getTenant(id);
    if (!tenant) return jsonResponse(404, { error: "tenant not found", id });
    return jsonResponse(200, { tenant });
  }

  const limit = Number(url.searchParams.get("limit")) || 50;
  const tenants = await listTenants(limit);
  return jsonResponse(200, { count: tenants.length, tenants });
}

interface AdminAction {
  id?: string;
  action?: "disable" | "enable";
  reason?: string;
}

async function handlePost(request: Request): Promise<Response> {
  let body: AdminAction;
  try {
    body = (await request.json()) as AdminAction;
  } catch {
    return jsonResponse(400, { error: "invalid JSON body" });
  }

  if (!body.id) return jsonResponse(400, { error: "missing 'id' field" });
  if (!body.action || (body.action !== "disable" && body.action !== "enable")) {
    return jsonResponse(400, {
      error: "missing or invalid 'action'; must be 'disable' or 'enable'",
    });
  }

  let result: Tenant | null;
  if (body.action === "disable") {
    result = await disableTenant(body.id, body.reason ?? "no reason given");
  } else {
    result = await enableTenant(body.id);
  }

  if (!result) return jsonResponse(404, { error: "tenant not found", id: body.id });
  return jsonResponse(200, { tenant: result });
}

async function handle(request: Request): Promise<Response> {
  const auth = authorize(request);
  if (!auth.ok) {
    return jsonResponse(auth.reason === "unauthorized" ? 401 : 503, {
      error: auth.reason,
    });
  }

  if (request.method === "GET") return handleGet(request);
  if (request.method === "POST") return handlePost(request);
  return jsonResponse(405, { error: "method not allowed" });
}

export { handle as GET, handle as POST };
