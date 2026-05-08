/**
 * Static mirror of the Flow MCP server's PROVIDERS registry — just enough
 * for the CLI to know an integration's default env-var mapping.
 *
 * Source of truth lives on the server at src/lib/providers.ts. When new
 * providers ship there, mirror them here. v0.2.1 may replace this with a
 * runtime fetch from the MCP server so the two cannot drift; for now the
 * CLI keeps a small local copy because:
 *
 *   - Bootstrapping a network call before knowing whether the SRE wants
 *     a non-hosted source feels backwards.
 *   - The integration list grows slowly (~one provider per quarter), so
 *     drift risk is low.
 *
 * If an integration id is missing here, the CLI prompts the SRE to type
 * the env var names manually. So this map is "convenience defaults," not
 * a hard gate.
 */

export interface IntegrationDefaults {
  displayName: string;
  envVars: string[];
}

export const INTEGRATION_DEFAULTS: Record<string, IntegrationDefaults> = {
  "google-oauth-web": {
    displayName: "Google OAuth (Web)",
    envVars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
  },
  email_provider: {
    displayName: "Transactional email (Resend)",
    envVars: ["RESEND_API_KEY"],
  },
};

export function defaultEnvVarsFor(integrationId: string): string[] | null {
  return INTEGRATION_DEFAULTS[integrationId]?.envVars ?? null;
}

export function displayNameFor(integrationId: string): string {
  return INTEGRATION_DEFAULTS[integrationId]?.displayName ?? integrationId;
}
