import type { SourceAdapter } from "./index.js";

/**
 * The hosted source adapter — formalizes the existing hosted vault
 * (`mcp.kindtree.us/api/vault/credentials`) as a SourceAdapter so the
 * CLI's setup flow can treat it uniformly with non-hosted adapters.
 *
 * Most adapter methods don't apply: when an SRE picks `flow-hosted` for
 * an environment, the manifest entry just records the choice. There's
 * no secret to pick, no IAM to validate, no per-invocation creds — the
 * flow-vault runtime reads the install_id from the OS keychain at app
 * boot and fetches from the hosted vault directly.
 *
 * So promptCredentials returns {}, listSecrets / validateAccess return
 * sentinel "not applicable" results, and the setup command short-circuits
 * the secret-picker flow when this adapter is selected.
 */

export const flowHostedAdapter: SourceAdapter = {
  id: "flow-hosted",
  displayName: "Flow hosted vault",
  status: "live",
  pickerHint: "(small-team prod fallback)",
  authMethods: [
    {
      id: "install-id",
      displayName: "Install ID (OS keychain)",
      status: "live",
      hint: "(implicit; bootstrapped via flow_check)",
      description:
        "The flow-vault runtime authenticates to the hosted vault using the install_id stored in the OS keychain. No additional credentials needed at setup time.",
    },
  ],

  async promptCredentials() {
    return {};
  },

  async listSecrets() {
    // The hosted source serves credentials per (install_id, project, env);
    // there's no list of "secrets" to choose from, the project itself is
    // the unit of selection. The CLI short-circuits this prompt.
    return [];
  },

  async validateAccess() {
    // Reachability of the hosted vault is a runtime concern, not a setup
    // concern. flow-vault reports failures at app boot. The CLI assumes
    // the hosted source is reachable; if it isn't, the SRE would already
    // have seen the AI's MCP calls failing.
    return { ok: true };
  },

  async resolveSecret() {
    throw new Error(
      "flow-hosted does not expose resolveSecret to the CLI — the runtime resolves directly via the hosted vault endpoint at app boot."
    );
  },
};
