/**
 * GET /api/admin/usage?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Founder-facing aggregation of telemetry events.
 *
 * Auth: Bearer token in Authorization header, must equal FLOW_ADMIN_TOKEN
 * env var. Single shared secret — not multi-user. Set on Vercel project env.
 *
 * Returns aggregated stats over the date range:
 *   - totals: events, unique_installs, unique_projects, errors, error_rate
 *   - by_tool: counts per MCP tool (incl. vault gets)
 *   - by_provider: counts per provider id
 *   - by_env: development / preview / production
 *   - by_country: ip_country breakdown
 *   - by_ai_tool: claude / cursor / windsurf / etc.
 *   - latency: p50, p95, p99
 *   - daily: per-day rollup (for trend charts)
 *
 * Default range: last 7 days if from/to omitted.
 *
 * Performance: reads raw events from each daily Redis sorted set and
 * aggregates in memory. Acceptable below ~10k events/day. When volume
 * grows, swap to pre-aggregated counters or pipe to a real analytics tool.
 */

import { readEvents, type FlowEvent } from "../../src/lib/telemetry.js";

export const runtime = "nodejs";
export const maxDuration = 30;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

function defaultRange(): { from: string; to: string } {
  const today = new Date();
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setUTCDate(today.getUTCDate() - 6);
  return {
    from: sevenDaysAgo.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
  };
}

function aggregate(events: FlowEvent[]) {
  const byTool: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byEnv: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const byAiTool: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  const byInstall: Record<string, number> = {}; // for top-tenants ranking
  const installSet = new Set<string>();
  const projectSet = new Set<string>();
  const latencies: number[] = [];
  let errors = 0;

  for (const e of events) {
    const toolKey = e.tool ?? (e.source === "vault" ? "vault_get" : "unknown");
    byTool[toolKey] = (byTool[toolKey] ?? 0) + 1;
    if (e.provider) byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1;
    if (e.env) byEnv[e.env] = (byEnv[e.env] ?? 0) + 1;
    if (e.ip_country) byCountry[e.ip_country] = (byCountry[e.ip_country] ?? 0) + 1;
    if (e.ai_tool_hint) byAiTool[e.ai_tool_hint] = (byAiTool[e.ai_tool_hint] ?? 0) + 1;
    if (e.install_id_hash) {
      installSet.add(e.install_id_hash);
      byInstall[e.install_id_hash] = (byInstall[e.install_id_hash] ?? 0) + 1;
    }
    if (e.project_id_hash) projectSet.add(e.project_id_hash);
    latencies.push(e.latency_ms);
    if (!e.ok) errors++;

    const day = e.ts.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);

  // Top 20 install_id_hashes by event count — outliers signal abuse.
  // NOTE: hashes are pseudonymous; use admin/tenants to disable an outlier
  // (you'd need the raw install_id to disable, not the hash). For now this
  // surfaces volume distribution, and the real install_ids appear in
  // Vercel function logs filtered by hash.
  const topInstalls = Object.entries(byInstall)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([install_id_hash, count]) => ({ install_id_hash, count }));

  return {
    totals: {
      events: events.length,
      unique_installs: installSet.size,
      unique_projects: projectSet.size,
      errors,
      error_rate: events.length > 0 ? errors / events.length : 0,
    },
    by_tool: byTool,
    by_provider: byProvider,
    by_env: byEnv,
    by_country: byCountry,
    by_ai_tool: byAiTool,
    by_day: byDay,
    top_installs_by_volume: topInstalls,
    latency_ms: {
      p50: percentile(sortedLat, 50),
      p95: percentile(sortedLat, 95),
      p99: percentile(sortedLat, 99),
    },
  };
}

async function handle(request: Request): Promise<Response> {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const expected = process.env.FLOW_ADMIN_TOKEN;

  if (!expected) {
    return jsonResponse(503, {
      error: "admin endpoint not configured",
      detail:
        "Set FLOW_ADMIN_TOKEN on the Vercel project to enable this endpoint.",
    });
  }
  if (!token || token !== expected) {
    return jsonResponse(401, { error: "unauthorized" });
  }

  const url = new URL(request.url);
  const def = defaultRange();
  const from = url.searchParams.get("from") || def.from;
  const to = url.searchParams.get("to") || def.to;

  const events = await readEvents(from, to);
  const stats = aggregate(events);

  return jsonResponse(200, {
    period: { from, to },
    ...stats,
  });
}

export { handle as GET };
