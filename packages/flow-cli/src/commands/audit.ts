import { plain, dim, header } from "../lib/output.js";

/**
 * `flow audit` — STUB.
 *
 * In v0.2.1 this command will diff the manifest against the actual store:
 *   - For each integration in .flow/integrations.json, does the configured
 *     store have the expected secret present?
 *   - Does the configured IAM role / token have read access to that secret?
 *     (and ONLY that secret, ideally — least-privilege check)
 *   - Are there orphan secrets at the configured prefix not declared in
 *     the manifest? Or manifest entries for secrets that don't exist?
 *
 * Output is suitable for attaching to a SOC 2 evidence request.
 *
 * Exits 0 here because the stub is informational, not an error.
 */
export async function auditCommand(): Promise<number> {
  header("flow audit");
  plain("");
  plain("Coming in v0.2.1.");
  plain("");
  dim("  flow audit will diff your .flow/integrations.json manifest against");
  dim("  the actual contents of your configured source adapters and verify");
  dim("  the configured IAM scope grants read access to exactly the secrets");
  dim("  declared. Output is intended for SOC 2 evidence.");
  plain("");
  dim("  See docs/compliance.md for the full design.");
  plain("");
  return 0;
}
