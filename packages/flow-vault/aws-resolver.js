/**
 * aws-resolver.js — synchronous AWS Secrets Manager resolver.
 *
 * Spawns aws-resolver-helper.js (which uses @aws-sdk async) via
 * child_process.execFileSync and parses its stdout as JSON. Any failure
 * → returns null so the adapter-router falls back to the hosted source
 * for that integration.
 *
 * Mirrors the same pattern as vault.js / vault-helper.js — the only way
 * to do async work inside the --require preload's sync constraint.
 */

const path = require("path");
const { execFileSync } = require("child_process");

const HELPER = path.join(__dirname, "aws-resolver-helper.js");
// AWS APIs occasionally take 2-3s; give 8s before timing out.
const SPAWN_TIMEOUT_MS = 8000;

/**
 * Resolve credentials for one integration's manifest entry.
 * @param {{secretName?: string, region?: string, envVars?: string[]}} sourceConfig
 * @returns {Object<string,string> | null}  credential map, or null on failure
 */
function resolveAWS(sourceConfig) {
  if (!sourceConfig || !sourceConfig.secretName || !sourceConfig.region) {
    process.stderr.write(
      "[flow-vault] aws-secrets-manager entry missing secretName or region; falling back to hosted\n"
    );
    return null;
  }

  // Strip NODE_OPTIONS so the helper doesn't recursively --require flow-vault.
  const childEnv = { ...process.env };
  delete childEnv.NODE_OPTIONS;

  const envVarsJoined = Array.isArray(sourceConfig.envVars) ? sourceConfig.envVars.join(",") : "";

  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [HELPER, sourceConfig.secretName, sourceConfig.region, envVarsJoined],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"], // forward stderr warnings
        timeout: SPAWN_TIMEOUT_MS,
        env: childEnv,
      }
    );
  } catch {
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if (Object.keys(parsed).length === 0) return null;

  const clean = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "string") clean[k] = v;
  }
  return Object.keys(clean).length > 0 ? clean : null;
}

module.exports = { resolveAWS };
