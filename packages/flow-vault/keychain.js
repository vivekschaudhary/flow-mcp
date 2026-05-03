/**
 * keychain.js — synchronous keychain access from the --require preload.
 *
 * Spawns keychain-helper.js (which uses keytar async) via child_process
 * to bridge the sync/async gap. Failures are swallowed and surfaced as
 * `null` so the runtime can degrade gracefully.
 */

const path = require("path");
const { execFileSync } = require("child_process");

const HELPER = path.join(__dirname, "keychain-helper.js");
const TIMEOUT_MS = 2000;

function runHelper(args) {
  try {
    // Strip NODE_OPTIONS so the helper doesn't recursively --require flow-vault.
    // (If the host app set NODE_OPTIONS=--require=flow-vault, the helper would
    // preload flow-vault, run its IIFE, spawn another helper, ...→ timeout.)
    const childEnv = { ...process.env };
    delete childEnv.NODE_OPTIONS;

    const out = execFileSync(process.execPath, [HELPER, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
      env: childEnv,
    });
    return { ok: true, value: out };
  } catch (err) {
    return { ok: false, error: err };
  }
}

/**
 * Read the stored Flow session token, sync.
 * @returns {string|null} token, or null if missing / unreachable.
 */
function getSession() {
  const r = runHelper(["get"]);
  if (!r.ok) return null;
  const trimmed = r.value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Store a session token in the OS keychain. Used by `flow login`,
 * not by the runtime preload itself.
 * @param {string} token
 * @returns {boolean} success
 */
function storeSession(token) {
  if (typeof token !== "string" || token.length === 0) return false;
  const r = runHelper(["set", token]);
  return r.ok && r.value.trim() === "ok";
}

/**
 * Remove the stored session. Used by `flow logout`.
 * @returns {boolean} success
 */
function clearSession() {
  const r = runHelper(["clear"]);
  return r.ok && r.value.trim() === "ok";
}

module.exports = { getSession, storeSession, clearSession };
