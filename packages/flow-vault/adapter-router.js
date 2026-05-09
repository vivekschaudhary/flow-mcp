/**
 * adapter-router.js — dispatch each integration in the manifest to the
 * right resolver, then merge the results over the hosted credentials.
 *
 * Inputs:
 *   manifestEntries  — { integrationId → sourceConfig }, from manifest-reader
 *                      May be null (no manifest) or {} (manifest exists but
 *                      no entries for this environment).
 *   hostedCreds      — { envVar → value }, from vault.js
 *
 * Output:
 *   credentials map ready for proxy.wrapProcessEnv. Hosted creds are the
 *   base layer; non-hosted manifest entries override per integration.
 *
 * Routing:
 *   flow-hosted / flow:shared  — already in hostedCreds; no action
 *   aws-secrets-manager        — call aws-resolver, merge if successful
 *   hashicorp-vault            — stub: warn, fall back to hosted
 *   azure-key-vault            — stub: same
 *   gcp-secret-manager         — stub: same
 *   anything else              — warn, skip
 *
 * Safety contract:
 *   - Never throws. Any resolver failure → warn + skip that integration.
 *   - Hosted credentials always survive as the base layer; the worst case
 *     is the runtime degrades to "hosted only" if every adapter fails.
 *   - The credential map shape (Record<string,string>) handed to proxy.js
 *     is unchanged from PR2 — proxy.js consumes the same shape it always has.
 */

const { resolveAWS } = require("./aws-resolver");

const STUB_SOURCES = ["hashicorp-vault", "azure-key-vault", "gcp-secret-manager"];

function isHostedSource(source) {
  return source === "flow-hosted" || source === "flow:shared";
}

/**
 * Resolve credentials by routing each manifest entry to its source adapter
 * and merging on top of the hosted base layer.
 *
 * @param {Object<string, Object> | null} manifestEntries
 * @param {Object<string, string>} hostedCreds
 * @returns {Object<string, string>}
 */
function resolveCredentials(manifestEntries, hostedCreds) {
  // Base layer: whatever the hosted vault returned (may be empty).
  const credentials = { ...(hostedCreds || {}) };

  if (!manifestEntries || Object.keys(manifestEntries).length === 0) {
    return credentials;
  }

  for (const [integrationId, sourceConfig] of Object.entries(manifestEntries)) {
    if (!sourceConfig || typeof sourceConfig !== "object") continue;
    const source = sourceConfig.source;

    if (isHostedSource(source)) {
      // Already covered by hostedCreds (the hosted endpoint serves what's
      // configured per install/project/env). Nothing to merge.
      continue;
    }

    if (source === "aws-secrets-manager") {
      // Honor the auth method declared in the manifest. Today only
      // iam-access-keys works at runtime; oidc-federation is pending the
      // OIDC provider at oidc.flow.kindtree.us (planned v0.3 infra).
      if (sourceConfig.authMethod === "oidc-federation") {
        process.stderr.write(
          `[flow-vault] OIDC federation not yet supported at runtime (oidc.flow.kindtree.us pending). Falling back to hosted source for ${integrationId}.\n`
        );
        continue;
      }
      const resolved = resolveAWS(sourceConfig);
      if (resolved) {
        Object.assign(credentials, resolved);
      } else {
        process.stderr.write(
          `[flow-vault] aws-secrets-manager resolver returned no credentials for ${integrationId}. Falling back to hosted source.\n`
        );
      }
      continue;
    }

    if (STUB_SOURCES.includes(source)) {
      process.stderr.write(
        `[flow-vault] ${source} not yet supported at runtime (planned v0.3). Falling back to hosted source for ${integrationId}.\n`
      );
      continue;
    }

    process.stderr.write(
      `[flow-vault] unknown source '${source}' for ${integrationId}. Falling back to hosted source.\n`
    );
  }

  return credentials;
}

module.exports = { resolveCredentials };
