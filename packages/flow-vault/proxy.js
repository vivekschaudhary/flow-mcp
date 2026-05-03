/**
 * proxy.js — wraps process.env with a Proxy so that empty / undefined
 * env reads fall through to the in-memory vault, while developer-set
 * values always win.
 *
 * Semantics for `get(key)`:
 *   1. If real process.env[key] is a non-empty string → return it
 *      (developer's own value wins; intentional override path)
 *   2. Else if vault[key] exists → return vault[key]
 *      (Flow-managed credential resolves transparently)
 *   3. Else → return undefined (not Flow's job)
 *
 * All other Proxy traps forward to the real env so that:
 *   - `process.env.X = 'foo'` writes to the real env
 *   - `delete process.env.X` deletes from the real env
 *   - `Object.keys(process.env)` returns real keys (vault keys not enumerated;
 *     they're a fallback for missing values, not an authoritative source)
 *   - `'X' in process.env` checks the real env
 *
 * Why not enumerate vault keys? Two reasons:
 *   a) Some libraries iterate process.env to detect "what's configured" —
 *      surfacing vault keys as "set" can confuse that detection.
 *   b) The vault is a fallback for misses; making it a primary source would
 *      change the program's observable env shape, which is invasive.
 */

function wrapProcessEnv(vault) {
  if (!vault || typeof vault !== "object") vault = {};

  const real = process.env;

  // If something already wrapped process.env (double --require?), leave it alone.
  if (real && real.__flowVaultWrapped === true) return;

  const handler = {
    get(target, key) {
      // Symbol keys (rare) — pass through without vault lookup.
      if (typeof key !== "string") return target[key];

      // Internal sentinel so we can detect double-wrap.
      if (key === "__flowVaultWrapped") return true;

      const own = target[key];
      if (typeof own === "string" && own.length > 0) return own;
      if (Object.prototype.hasOwnProperty.call(vault, key)) return vault[key];
      return own; // undefined
    },
    set(target, key, value) {
      target[key] = value;
      return true;
    },
    deleteProperty(target, key) {
      delete target[key];
      return true;
    },
    has(target, key) {
      // Don't claim vault keys as "in" the env — see header comment.
      return key in target;
    },
    ownKeys(target) {
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, key) {
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  };

  process.env = new Proxy(real, handler);
}

module.exports = { wrapProcessEnv };
