/**
 * flow-vault — entry point.
 *
 * Loaded synchronously via `node --require flow-vault ./your-app.js`.
 * Pulls credentials from Flow's vault and makes them available through
 * a Proxy on process.env, without ever writing to the user's filesystem.
 *
 * Failure modes — all silent (or warn-only). Never throws. Never crashes.
 *   No session in keychain  → skip, app uses .env as-is (no warning;
 *                             this is the expected first-run state)
 *   No project name         → warn, skip
 *   Vault unreachable / 4xx → warn, fall through with empty vault
 *   Vault timeout (~5s)     → warn, fall through with empty vault
 *   Any uncaught error      → swallow, never propagate
 */

(function flowVaultBoot() {
  let session, project, credentials;

  try {
    session = require("./keychain").getSession();
  } catch {
    // Keychain itself blew up — leave env alone.
    return;
  }

  if (!session) {
    // User hasn't run `flow login`. Stay quiet; their .env still works.
    return;
  }

  try {
    project = require("./detect").detect();
  } catch {
    return;
  }

  if (!project.projectName) {
    process.stderr.write(
      "[flow-vault] no package.json name found near cwd; skipping vault fetch\n"
    );
    return;
  }

  try {
    credentials = require("./vault").fetchCredentials(
      session,
      project.projectName,
      project.environment
    );
  } catch {
    return;
  }

  if (!credentials || Object.keys(credentials).length === 0) {
    // Either vault is empty for this project/env, or fetch failed.
    // Helper already logged a stderr warning if it was a real failure.
    return;
  }

  try {
    require("./proxy").wrapProcessEnv(credentials);
  } catch (err) {
    process.stderr.write(`[flow-vault] proxy wrap failed: ${err.message}\n`);
  }
})();
