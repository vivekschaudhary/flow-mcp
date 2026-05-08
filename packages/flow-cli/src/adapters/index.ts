/**
 * SourceAdapter — the contract every source adapter implements.
 *
 * The flow CLI is one of N possible callers of an adapter; the runtime
 * (flow-vault, v0.3) will be another. Both go through this interface.
 *
 * Three adapter responsibilities the CLI uses:
 *   1. Own its credential UX — `promptCredentials` knows what AWS asks
 *      for vs. what Vault asks for. Keeps `setup.ts` thin.
 *   2. Discover and validate — `listSecrets` + `validateAccess` let the
 *      CLI confirm the SRE picked a working secret before writing the
 *      manifest entry.
 *   3. Resolve — `resolveSecret` returns the env-var map the runtime
 *      will eventually inject. PR2 uses this for validation only;
 *      flow-vault will use it at app boot once v0.3 ships.
 *
 * Status fields:
 *   - `live`:  fully implemented in this PR
 *   - `stub`:  visible in the picker so SREs see it's coming, but throws
 *              a clear "planned for vX.Y" error if selected
 */

export type AdapterStatus = "live" | "stub";

export interface AuthMethod {
  /** Stable identifier, e.g. 'iam-access-keys' or 'oidc-federation'. */
  id: string;
  /** Display label for the picker. */
  displayName: string;
  status: AdapterStatus;
  /** Optional one-line hint shown in the picker, e.g. '(available now)'. */
  hint?: string;
  /** Free-form description shown when the SRE selects this method. */
  description?: string;
}

/** Credentials collected from the SRE, keyed by adapter-specific names. */
export type AuthCredentials = Record<string, string>;

export interface SecretSummary {
  /** Secret identifier (name in AWS, path in Vault, etc). */
  name: string;
  /** Optional ARN for AWS, full path for Vault, etc. */
  fullId?: string;
  /** ISO timestamp of the last value change, if the source exposes it. */
  lastChanged?: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Human-readable reason on failure. */
  reason?: string;
  /** Optional remediation snippet — for AWS, the IAM policy needed. */
  iamPolicySnippet?: string;
}

export interface SourceAdapter {
  id: string;
  displayName: string;
  status: AdapterStatus;
  /** Hint shown in the source picker, e.g. '(planned, v0.3)'. */
  pickerHint?: string;

  /** What auth methods this adapter supports. */
  authMethods: AuthMethod[];

  /**
   * Prompt the SRE for the credentials this adapter needs to call its API.
   * Implementations call `prompts.password()` / `prompts.text()` etc.
   * In non-interactive mode the caller passes pre-collected creds via
   * options on the adapter and skips this method.
   */
  promptCredentials(authMethodId: string): Promise<AuthCredentials>;

  /**
   * List secrets the SRE could choose from. May paginate internally.
   */
  listSecrets(creds: AuthCredentials): Promise<SecretSummary[]>;

  /**
   * Confirm the configured creds + secret are reachable and the IAM /
   * token has the right permissions. Returns ok=false with a reason and
   * an optional IAM policy snippet on failure.
   */
  validateAccess(creds: AuthCredentials, secretName: string): Promise<ValidationResult>;

  /**
   * Resolve a secret's contents to an env-var map. Used by the runtime
   * at app boot in v0.3; used by the CLI to validate the secret format
   * matches the integration's expected env vars.
   */
  resolveSecret(creds: AuthCredentials, secretName: string): Promise<Record<string, string>>;
}

/**
 * Registry — maps source id → adapter instance. The order here drives
 * the order of options in the source picker, so live adapters come first.
 */
import { flowHostedAdapter } from "./flow-hosted.js";
import { awsSecretsManagerAdapter } from "./aws-secrets-manager.js";
import { hashicorpVaultAdapter } from "./hashicorp-vault.js";
import { azureKeyVaultAdapter } from "./azure-key-vault.js";
import { gcpSecretManagerAdapter } from "./gcp-secret-manager.js";

export const ADAPTERS: SourceAdapter[] = [
  awsSecretsManagerAdapter,
  hashicorpVaultAdapter,
  azureKeyVaultAdapter,
  gcpSecretManagerAdapter,
  flowHostedAdapter,
];

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}
