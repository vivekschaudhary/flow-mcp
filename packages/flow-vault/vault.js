/**
 * vault.js — synchronous vault fetch from the --require preload.
 *
 * Spawns vault-helper.js (which uses fetch async) via child_process and
 * parses its stdout as JSON. Any failure → returns {} so the runtime
 * degrades gracefully (host app still boots, just without vault creds).
 */

const path = require("path");
const { execFileSync } = require("child_process");

const HELPER = path.join(__dirname, "vault-helper.js");
// Slightly longer than helper's internal 4s fetch timeout so the helper
// has a chance to write its empty {} fallback before we time out.
const SPAWN_TIMEOUT_MS = 5000;

/**
 * Fetch credential map from Flow vault, sync.
 * @param {string} session  Flow session token
 * @param {string} project  project name (from package.json)
 * @param {string} environment  "development" | "preview" | "production" | "test"
 * @returns {Object<string,string>} credential map; {} on any failure.
 */
function fetchCredentials(session, project, environment) {
  if (!session || !project || !environment) return {};

  // Strip NODE_OPTIONS so the helper doesn't recursively --require flow-vault.
  const childEnv = { ...process.env };
  delete childEnv.NODE_OPTIONS;

  let stdout;
  try {
    stdout = execFileSync(
      process.execPath,
      [HELPER, session, project, environment],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"], // forward stderr warnings
        timeout: SPAWN_TIMEOUT_MS,
        env: childEnv,
      }
    );
  } catch {
    return {};
  }

  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

module.exports = { fetchCredentials };
