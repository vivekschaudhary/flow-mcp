/**
 * flow-vault — entry point.
 *
 * Loaded synchronously via `node --require flow-vault ./your-app.js`.
 * Pulls credentials and makes them available through a Proxy on
 * process.env, without ever writing to the user's filesystem.
 *
 * Boot sequence (PR3, v0.2):
 *   1. keychain  — get install_id session (may be null on first run)
 *   2. detect    — projectName + environment from package.json + env vars
 *   3. vault     — fetch hosted credentials (existing path, unchanged)
 *   4. manifest  — read .flow/integrations.json if present (new in PR3)
 *   5. router    — merge per-integration adapter results over hosted base
 *   6. proxy     — wrap process.env, hand-off to host app
 *
 * Failure modes — all silent (or warn-only). Never throws. Never crashes.
 *   No session in keychain  → skip hosted fetch (silent on first run);
 *                             manifest path can still resolve creds
 *   No project name         → skip hosted fetch with warning;
 *                             manifest path is independent of projectName
 *   No manifest file        → hosted-only behavior (PR1/PR2 baseline)
 *   Vault unreachable       → warn, hosted creds = {}; manifest may cover
 *   AWS resolver fails      → warn, fall back to hosted for that integration
 *   Any uncaught error      → swallow, never propagate
 */

(function flowVaultBoot() {
  let session, project, hostedCreds, manifestEntries, credentials;

  try {
    session = require("./keychain").getSession();
  } catch {
    // Keychain itself blew up — leave env alone.
    return;
  }

  try {
    project = require("./detect").detect();
  } catch {
    return;
  }

  // Hosted path (PR1/PR2 baseline). Skipped when there's no session or
  // no package.json name; either case is non-fatal because the manifest
  // path below may still resolve credentials.
  hostedCreds = {};
  if (session) {
    if (project.projectName) {
      try {
        hostedCreds = require("./vault").fetchCredentials(
          session,
          project.projectName,
          project.environment
        );
      } catch {
        // Helper already wrote a stderr warning if the failure was real.
      }
    } else {
      process.stderr.write(
        "[flow-vault] no package.json name found near cwd; skipping hosted vault fetch\n"
      );
    }
  }

  // Manifest path (PR3). Reads .flow/integrations.json and returns the
  // entries for the current environment, or null if no manifest exists.
  // No session required — manifest-driven sources (e.g. AWS) work even on
  // first run before `flow_check` has bootstrapped an install_id.
  try {
    manifestEntries = require("./manifest-reader").readManifest(project.environment);
  } catch {
    manifestEntries = null;
  }

  // Route each manifest entry to the right resolver and merge over hosted.
  // resolveCredentials never throws — failed adapters degrade silently to
  // "hosted only" for that integration.
  try {
    credentials = require("./adapter-router").resolveCredentials(manifestEntries, hostedCreds);
  } catch {
    credentials = hostedCreds;
  }

  if (!credentials || Object.keys(credentials).length === 0) {
    // Nothing to inject — app uses .env as-is. Same outcome as the old
    // "empty vault" case from PR1/PR2.
    return;
  }

  try {
    require("./proxy").wrapProcessEnv(credentials);
  } catch (err) {
    process.stderr.write(`[flow-vault] proxy wrap failed: ${err.message}\n`);
  }
})();
