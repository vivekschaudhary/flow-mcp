/**
 * manifest-reader.js — read .flow/integrations.json and filter to the
 * current environment.
 *
 * Returns a map of { integrationId → sourceConfig } for the requested
 * environment. Returns null if the manifest doesn't exist (caller falls
 * back to hosted source entirely — zero breaking change for users who
 * never ran `flow setup production`).
 *
 * Schema (Shape A — integration-first), as written by flow-cli:
 *
 *   {
 *     "integrations": {
 *       "google-oauth-web": {
 *         "production": {
 *           "source": "aws-secrets-manager",
 *           "secretName": "prod/myapp/google-oauth",
 *           "region": "us-east-1",
 *           "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
 *           "configured_at": "..."
 *         }
 *       }
 *     }
 *   }
 *
 * Failure modes — all silent or warn-only:
 *   manifest missing      → return null (silent; expected first-run state)
 *   manifest unreadable   → warn, return null
 *   manifest malformed    → warn, return null
 *   integrations missing  → return {}
 */

const fs = require("fs");
const path = require("path");
const { findPackageJson } = require("./detect");

function findProjectRoot(startDir) {
  const pkg = findPackageJson(startDir || process.cwd());
  return pkg ? path.dirname(pkg) : null;
}

function manifestPath(projectRoot) {
  return path.join(projectRoot, ".flow", "integrations.json");
}

/**
 * Read the manifest and return entries for the given environment.
 * @param {string} environment  "development" | "preview" | "production" | "test"
 * @param {string} [projectRoot]  defaults to nearest dir with package.json from cwd
 * @returns {Object<string, Object> | null}  map of integration id → source config
 *   for this environment, or null if no manifest exists.
 */
function readManifest(environment, projectRoot) {
  if (!environment) return null;
  const root = projectRoot || findProjectRoot();
  if (!root) return null;

  const file = manifestPath(root);
  if (!fs.existsSync(file)) return null;

  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    process.stderr.write(`[flow-vault] could not read ${file}: ${err.message}\n`);
    return null;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`[flow-vault] ${file} is not valid JSON: ${err.message}\n`);
    return null;
  }

  // Reject Shape B / legacy shapes outright; the manifest must be Shape A.
  // Any other shape is treated as "no manifest" (silent — too noisy to warn
  // on every preload if a vestigial file lives in the repo).
  if (!parsed || typeof parsed !== "object" || !parsed.integrations || typeof parsed.integrations !== "object") {
    return {};
  }

  const result = {};
  for (const [id, envMap] of Object.entries(parsed.integrations)) {
    if (!envMap || typeof envMap !== "object") continue;
    const entry = envMap[environment];
    if (entry && typeof entry === "object" && typeof entry.source === "string") {
      result[id] = entry;
    }
  }
  return result;
}

module.exports = { readManifest, findProjectRoot, manifestPath };
