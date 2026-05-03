/**
 * Provider registry — single source of truth for which integrations Flow supports
 * and what each one needs.
 *
 * Adding a provider:
 *   1. Add an entry to PROVIDERS below.
 *   2. Set the corresponding FLOW_* env vars on the hosted Vercel project.
 *   3. (Optional) update the SKILL.md to teach the AI about the new trigger phrases.
 *   4. Done — no new MCP tool needed; flow_setup_provider handles all of them.
 */

export interface ProviderEnvVar {
  /**
   * Name as exposed to the user's app via the runtime vault response.
   * E.g. "GOOGLE_CLIENT_ID" — what the user's process.env will resolve to.
   */
  runtime_name: string;

  /**
   * Name of the env var on the Flow hosted server (Vercel env) that holds
   * the shared dev value. E.g. "FLOW_GOOGLE_CLIENT_ID".
   * If null, the value isn't supplied by Flow's shared dev account
   * (e.g. user-only credentials with no dev fallback).
   */
  source_env: string | null;

  /**
   * Whether this env var is required for the integration to work.
   * Used to validate at setup time.
   */
  required: boolean;
}

export interface ProviderConfig {
  /** Stable id used in vault keys, state.integrations, MCP tool args. */
  id: string;

  /** Human-readable name for status text. */
  name: string;

  /** One-line description for SKILL/UX. */
  description: string;

  /** Environment variables this provider needs at runtime. */
  env_vars: ProviderEnvVar[];

  /**
   * Free-form integration notes appended to the flow_setup_provider success
   * message. Use this to tell the user what to install in their app, what
   * `from` address to use, etc.
   */
  setup_notes: string;
}

export const PROVIDERS: Record<string, ProviderConfig> = {
  "google-oauth-web": {
    id: "google-oauth-web",
    name: "Google OAuth (Web)",
    description: "Google sign-in for web applications.",
    env_vars: [
      {
        runtime_name: "GOOGLE_CLIENT_ID",
        source_env: "FLOW_GOOGLE_CLIENT_ID",
        required: true,
      },
      {
        runtime_name: "GOOGLE_CLIENT_SECRET",
        source_env: "FLOW_GOOGLE_CLIENT_SECRET",
        required: true,
      },
    ],
    setup_notes: [
      "Your app reads process.env.GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET",
      "as normal. Flow's shared dev OAuth client supports redirect URIs at",
      "the common dev ports (3000-3005, 4000, 5000, 5173-5175, 8000, 8080,",
      "8888, 9000) for both /api/auth/google/callback and",
      "/api/auth/callback/google paths.",
    ].join("\n"),
  },

  "email_provider": {
    id: "email_provider",
    name: "Email provider (currently Resend under the hood)",
    description: "Transactional email sending. Vendor-agnostic to the user's tool calls — Flow chooses the underlying provider (today: Resend).",
    env_vars: [
      {
        runtime_name: "RESEND_API_KEY",
        source_env: "FLOW_RESEND_API_KEY",
        required: true,
      },
    ],
    setup_notes: [
      "Today this provisions Resend under the hood — your app reads process.env.RESEND_API_KEY.",
      "If Flow swaps to a different email vendor in the future, the env var name(s) may change",
      "and you'd update the import. The provider='email' tool call stays the same.",
      "",
      "Install the SDK: npm install resend",
      "Send from Resend's test domain without DNS setup:",
      "  import { Resend } from 'resend';",
      "  const resend = new Resend(process.env.RESEND_API_KEY);",
      "  await resend.emails.send({",
      "    from: 'onboarding@resend.dev',",
      "    to: 'someone@example.com',",
      "    subject: 'Hello from Flow',",
      "    html: '<p>It works.</p>'",
      "  });",
      "For production, verify your own domain in the Resend dashboard and",
      "use it as the `from` address — your own RESEND_API_KEY at that point",
      "will come from flow_capture (M2.5).",
    ].join("\n"),
  },
};

/**
 * Get the runtime env-var map a provider would deliver in its dev shared form.
 * Used by the vault endpoint when env=development to fill in shared Flow creds.
 *
 * Reads from process.env on the Flow server (Vercel env). Returns only keys
 * that have a non-empty source value. Skips runtime_name keys whose source_env
 * is null (those have no dev shared fallback by design).
 */
export function sharedDevValuesFor(providerId: string): Record<string, string> {
  const provider = PROVIDERS[providerId];
  if (!provider) return {};
  const out: Record<string, string> = {};
  for (const v of provider.env_vars) {
    if (!v.source_env) continue;
    const val = process.env[v.source_env];
    if (val) out[v.runtime_name] = val;
  }
  return out;
}

/**
 * Resolve the shared dev value map for ALL providers a project has configured.
 * Used by the vault endpoint when env=development.
 */
export function sharedDevValuesForIntegrations(
  configuredIntegrations: string[]
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const id of configuredIntegrations) {
    Object.assign(merged, sharedDevValuesFor(id));
  }
  return merged;
}
