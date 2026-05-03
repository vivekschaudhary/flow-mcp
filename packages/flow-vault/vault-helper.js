/**
 * vault-helper.js — async vault fetcher.
 *
 * Spawned synchronously from vault.js via child_process.execFileSync to
 * bridge the sync constraint of the --require preload context.
 *
 * Uses Node 18+ built-in fetch — no extra deps.
 *
 * argv:
 *   [2] session token
 *   [3] project name
 *   [4] environment ("development" | "preview" | "production" | "test")
 *
 * stdout: JSON object of credential map. Empty {} on any failure.
 * stderr: single warning line on failure (parent may log it).
 * exit code: always 0. Failures degrade to empty vault, never crash the host app.
 */

const VAULT_URL = "https://mcp.kindtree.us/api/vault/credentials";
const TIMEOUT_MS = 4000;

async function main() {
  const [, , session, project, environment] = process.argv;

  if (!session || !project || !environment) {
    process.stderr.write("[flow-vault] missing args to vault-helper\n");
    process.stdout.write("{}");
    return;
  }

  const url = new URL(VAULT_URL);
  url.searchParams.set("project", project);
  url.searchParams.set("env", environment);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${session}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      process.stderr.write(`[flow-vault] vault returned ${res.status}\n`);
      process.stdout.write("{}");
      return;
    }

    const body = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      process.stderr.write("[flow-vault] vault returned non-JSON body\n");
      process.stdout.write("{}");
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      process.stderr.write("[flow-vault] vault returned non-object\n");
      process.stdout.write("{}");
      return;
    }

    // Filter to string values only — vault map should be Record<string,string>.
    const clean = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string") clean[k] = v;
    }
    process.stdout.write(JSON.stringify(clean));
  } catch (err) {
    const msg = err.name === "AbortError" ? "vault fetch timed out" : err.message;
    process.stderr.write(`[flow-vault] ${msg}\n`);
    process.stdout.write("{}");
  } finally {
    clearTimeout(timer);
  }
}

main();
