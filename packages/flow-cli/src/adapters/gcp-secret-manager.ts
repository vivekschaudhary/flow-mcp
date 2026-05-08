import type { SourceAdapter } from "./index.js";
import { UserError } from "../lib/errors.js";

const NOT_IMPLEMENTED = new UserError(
  "GCP Secret Manager support is planned for v0.3.",
  [
    "The CLI will support GCP Secret Manager when the adapter implementation lands.",
    "For v0.2, AWS Secrets Manager is the only non-hosted adapter available.",
    "If your secrets are in GCP Secret Manager, you can either:",
    "",
    "  1. Wait for v0.3 — adapter implementation is on the roadmap.",
    "  2. Use Flow's hosted vault for now (small-team production fallback).",
    "  3. Migrate the relevant secrets to AWS Secrets Manager temporarily.",
    "",
    "→ Run `flow setup production` again and select a different source.",
  ].join("\n")
);

export const gcpSecretManagerAdapter: SourceAdapter = {
  id: "gcp-secret-manager",
  displayName: "GCP Secret Manager",
  status: "stub",
  pickerHint: "(planned, v0.3)",
  authMethods: [
    {
      id: "workload-identity",
      displayName: "Workload Identity",
      status: "stub",
      hint: "(planned, v0.3)",
    },
    {
      id: "service-account-json",
      displayName: "Service account JSON",
      status: "stub",
      hint: "(planned, v0.3)",
    },
  ],
  async promptCredentials() {
    throw NOT_IMPLEMENTED;
  },
  async listSecrets() {
    throw NOT_IMPLEMENTED;
  },
  async validateAccess() {
    throw NOT_IMPLEMENTED;
  },
  async resolveSecret() {
    throw NOT_IMPLEMENTED;
  },
};
