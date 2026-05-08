# Source adapters

Flow has two pieces:

1. **The injection layer** — `flow-vault`, a Node `--require` preload that wraps `process.env` with a Proxy. Same in every environment, on every machine, in every adapter.
2. **The source** — *where the credential map comes from*. This is pluggable. Different environments can point at different sources.

This document is the architectural reference for the source adapter pattern: the interface, the per-source authentication models, and the reasoning behind keeping ownership of production secrets with the customer's existing store.

## The pattern

```
┌─────────────────────────────────────────────────────┐
│ Your app code                                       │
│   const id = process.env.GOOGLE_CLIENT_ID           │
└─────────────────┬───────────────────────────────────┘
                  ↑
┌─────────────────┴───────────────────────────────────┐
│ flow-vault Proxy on process.env                     │
│   1. real env non-empty? return that.               │
│   2. key in injected map? return that.              │
│   3. otherwise undefined.                           │
└─────────────────┬───────────────────────────────────┘
                  ↑ (one fetch at preload, cached)
┌─────────────────┴───────────────────────────────────┐
│ Source adapter                                      │
│   .id  (string)                                     │
│   .fetch({ project, environment }) → Record<string, │
│                                       string>      │
└─────────────────┬───────────────────────────────────┘
                  ↑
            (HTTPS / SDK / IAM)
                  ↑
┌─────────────────┴───────────────────────────────────┐
│ The actual secrets store                            │
│   (hosted vault, AWS SM, Vault, Azure KV, GCP SM)   │
└─────────────────────────────────────────────────────┘
```

The Proxy contract is invariant. The adapter contract is the hand-off point — everything below the adapter is store-specific; everything above is uniform.

## The adapter interface (shipped, v0.2)

The CLI's `SourceAdapter` interface (in [packages/flow-cli/src/adapters/index.ts](../packages/flow-cli/src/adapters/index.ts)) is the authoritative shape. Used by the CLI today; the v0.3 runtime will share the same contract for app-boot resolution.

```ts
type AdapterStatus = "live" | "stub";

interface AuthMethod {
  id: string;            // 'iam-access-keys', 'oidc-federation', etc.
  displayName: string;
  status: AdapterStatus;
  hint?: string;         // shown in the picker, e.g. '(planned, v0.3)'
  description?: string;
}

interface SourceAdapter {
  id: string;            // 'aws-secrets-manager'
  displayName: string;   // 'AWS Secrets Manager'
  status: AdapterStatus;
  pickerHint?: string;
  authMethods: AuthMethod[];

  // Each adapter owns its own credential UX
  promptCredentials(authMethodId: string): Promise<AuthCredentials>;

  // Discovery + validation
  listSecrets(creds: AuthCredentials): Promise<SecretSummary[]>;
  validateAccess(creds: AuthCredentials, secretName: string): Promise<ValidationResult>;

  // Resolve a secret's contents to env-var map (used by validation in
  // the CLI; used at app boot in v0.3 by flow-vault).
  resolveSecret(creds: AuthCredentials, secretName: string): Promise<Record<string, string>>;
}
```

The CLI uses every method except `resolveSecret` (it could; today it just validates). The v0.3 runtime will lean on `resolveSecret` for the credential map at app boot. The interface is small enough that bespoke adapters are practical to implement — open an issue if your store isn't in the live or planned list.

Contract for any adapter:

- **Pure read.** Adapters never write to the store from the runtime. Writes happen via Flow's MCP tools (which call the AI's IDE → store-specific paths) or out-of-band (existing IaC, console, CLI).
- **No persistent state on disk.** The credential map lives in process memory only.
- **Honor the failure contract.** If the source is unreachable, the adapter throws a recognized error; flow-vault prints one stderr line and lets the app boot with whatever's in real `process.env`.
- **Scope by environment.** A `production` boot must not be able to read `development` material from the same store, and vice-versa. This is enforced at the store side (path / namespace / IAM scope), not in the adapter.

## Per-adapter authentication

| Adapter | Recommended auth | Fallback | Notes |
|---|---|---|---|
| `flow-hosted` | Bearer token from OS keychain | — | The token is an opaque install identifier, not a credential. |
| `aws-secrets-manager` | OIDC federation | IAM access keys | OIDC is the modern AWS pattern. No long-lived creds on disk. Per-environment role scoped to one secret path prefix. |
| `hashicorp-vault` | Vault token via auth method (Kubernetes / AWS / OIDC) | AppRole | Vault token TTL kept short; renewal is the deployment platform's job. |
| `azure-key-vault` | Managed identity | Service principal | Managed identity removes credential bootstrap entirely on Azure compute. |
| `gcp-secret-manager` | Workload identity | Service account JSON | Workload identity for GKE / Cloud Run; service account JSON only for compute outside GCP. |

### `flow-hosted`

The shipped adapter. Authentication is a bearer token kept in the OS keychain (Apple Keychain / Windows DPAPI / libsecret on Linux). Today the token is an anonymous install identifier; in v0.2 it becomes a GitHub-OAuth-issued Flow session.

```
flow-vault preload
  → keychain.getSession()             // sync, native
  → execFileSync('node', vault-helper) // bridge to async fetch
    → GET https://mcp.kindtree.us/api/vault/credentials
      Authorization: Bearer <session>
      ?project=<name>&env=<environment>
  → Record<string, string>
```

The hosted source is the right choice for: solo developers, small teams, the development environment of any team, and projects that don't yet have a production secrets store.

### `aws-secrets-manager` (v0.2 — shipped in PR2)

The first non-hosted adapter. Two auth methods:

- **IAM access keys** — long-lived `FLOW_AWS_ACCESS_KEY_ID` / `FLOW_AWS_SECRET_ACCESS_KEY`. The CLI adapter (`packages/flow-cli/`) uses these today; the v0.3 runtime will too. Works everywhere; requires the SRE to manage key rotation. Available now.
- **OIDC federation (recommended)** — your compute platform (Vercel, Cloud Run, ECS, EKS, GitHub Actions) presents a short-lived OIDC token; AWS exchanges it for temporary IAM credentials scoped to a role you control. **Requires Flow's OIDC provider at `oidc.flow.kindtree.us`, which is not yet deployed (planned v0.3).** Until the provider exists, the CLI surfaces a clear error pointing the SRE at IAM access keys for now.

The CLI writes the manifest entry per-integration in Shape A:

```jsonc
// .flow/integrations.json (after `flow setup production --integration google-oauth-web`)
{
  "integrations": {
    "google-oauth-web": {
      "production": {
        "source": "aws-secrets-manager",
        "secretName": "prod/swing-trading-signals/google-oauth",
        "region": "us-east-1",
        "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "configured_at": "2026-05-08T18:08:48.652Z"
      }
    }
  }
}
```

At app boot (v0.3), the runtime will:

1. Read the manifest entry for the configured integration + environment.
2. Read AWS credentials from the deployment env (`FLOW_AWS_ACCESS_KEY_ID` / `FLOW_AWS_SECRET_ACCESS_KEY` for IAM; OIDC token for federation).
3. Call `secretsmanager:GetSecretValue` for the `secretName` declared in the manifest.
4. JSON-parse the secret payload and merge it into the credential map under the `envVars` declared.

**Flow does not see your production credentials.** The runtime authenticates to AWS using your IAM; AWS hands the values back to your process; the adapter merges them into the Proxy. Flow's hosted infrastructure is not on the request path.

### `hashicorp-vault` (planned v0.3)

```jsonc
{
  "integrations": {
    "google-oauth-web": {
      "production": {
        "source": "hashicorp-vault",
        "vaultAddress": "https://vault.example.com",
        "mountPath": "kv/swing-trading-signals/google-oauth",
        "authMethod": "kubernetes",
        "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "configured_at": "2026-…"
      }
    }
  }
}
```

Authentication via whatever auth method your Vault deployment already uses (Kubernetes auth, AppRole, OIDC, raw token). The runtime calls `auth.<method>.login` for a Vault token, then `kv-v2.read` for the configured path.

### `azure-key-vault` (planned v0.3)

```jsonc
{
  "integrations": {
    "google-oauth-web": {
      "production": {
        "source": "azure-key-vault",
        "vaultUrl": "https://swing-trading-signals.vault.azure.net",
        "secretName": "google-oauth",
        "authMethod": "managed-identity",
        "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "configured_at": "2026-…"
      }
    }
  }
}
```

Managed identity is the recommended path on Azure compute (Functions, Container Apps, App Service, AKS). The adapter calls IMDS for a token and `Get Secret` for the configured name.

### `gcp-secret-manager` (planned v0.3)

```jsonc
{
  "integrations": {
    "google-oauth-web": {
      "production": {
        "source": "gcp-secret-manager",
        "project": "my-gcp-project",
        "secretName": "prod-google-oauth",
        "authMethod": "workload-identity",
        "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        "configured_at": "2026-…"
      }
    }
  }
}
```

Workload identity (GKE / Cloud Run / Cloud Functions) lets the adapter authenticate without a service account key on disk. The adapter reads the latest version of the named secret.

## Why ownership matters in production

There are two architectures available to a tool that injects credentials into your app at runtime. They look similar in dev. They diverge sharply in production.

### Architecture A — auth-as-a-service (the vendor holds your prod creds)

```
Your app  →  vendor's vault  →  vendor's network  →  provider's API
```

The vendor holds your production credentials. Your app authenticates to the vendor, the vendor returns the values, your app uses them. The vendor is in the trust path and on the request path for credential delivery.

This works. It's also the default direction for AI-era developer tooling because it gives the vendor the most leverage.

The honest costs:

- **Compounding trust.** A compromise of the vendor's vault is a compromise of every customer's production secrets simultaneously. The blast radius is the customer base, not one tenant.
- **A new attack surface.** The vendor is now an additional credential store with its own IAM, its own bugs, its own operational maturity to grow. Your security team has to evaluate it the way they'd evaluate a primary store, but it isn't your primary store.
- **Vendor lock-in.** Once production credentials are in the vendor's vault, leaving means re-uploading every secret to a new system and re-attesting to compliance reviewers.
- **Single point of failure on the request path.** Vendor downtime during cold-start = your app can't authenticate to its own providers.
- **Audit story is "trust the vendor."** Your auditor can read your IAM but not the vendor's. The chain has a gap that's hard to fill without the vendor's certifications.

### Architecture B — source adapter (your store, the vendor injects)

```
Your app  →  your existing secrets store  →  provider's API
                ↑
             Flow runtime authenticates here using YOUR IAM
```

The vendor ships the runtime that injects. The credentials live in the store you already operate. The vendor never sees the values.

The properties:

- **Blast radius unchanged.** A compromise of the vendor compromises the runtime's source code, not your secrets. Your IAM still gates access to the store.
- **No new attack surface.** The vendor is not a credential store. There is one less system to evaluate, attest, and patch.
- **No lock-in.** Your secrets are where they were before Flow. Removing Flow is removing one npm package and one config file.
- **No request-path SPOF in production.** Vendor downtime affects future config edits via the IDE, not running app authentication. Your store + your IAM still work.
- **Audit story is unchanged.** Your auditor reads your IAM, your store's access logs, and the manifest committed to your repo. There is no vendor-side gap.

This is the architectural choice the post-AI tooling category has to make. Flow makes it explicitly: the hosted source exists for development and small-team production, but the platform commitment is that production scale runs on customer-owned stores.

### When the hosted source is the right answer

Architecture B is right for any organization with an existing secrets store and a security team. Architecture A — represented in Flow by the hosted source — is right for:

- Development environments, regardless of team size. Shared dev sandboxes are intentionally not production-secret-grade.
- Solo developers and small teams who haven't stood up a secrets store yet. The hosted source is a fast on-ramp; switching to a non-hosted source later means changing one field in `.flow/integrations.json` and redeploying.
- Greenfield projects where production hasn't shipped yet.

Flow does not push you off the hosted source. It also doesn't try to convince you to migrate *to* it from your existing store.

## Migration cost: zero

Swapping a source is a few lines in `.flow/integrations.json`. Application code is untouched. The Proxy contract on `process.env` is invariant. Library code that reads `process.env.GOOGLE_CLIENT_ID` doesn't know — and shouldn't know — where the value came from.

```diff
   "google-oauth-web": {
     "production": {
-      "source": "flow-hosted",
-      "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
-      "configured_at": "2026-…"
+      "source": "aws-secrets-manager",
+      "secretName": "prod/swing-trading-signals/google-oauth",
+      "region": "us-east-1",
+      "envVars": ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
+      "configured_at": "2026-…"
     }
   }
```

In practice you don't hand-edit this — `flow setup production --integration <id>` walks the SRE through the change and writes the diff. The cost of switching sources is the cost of populating the new store with the same key set. The runtime, the application, and the developer experience don't change.

## Status

| Adapter | Status |
|---|---|
| `flow-hosted` | ✅ Shipped. Both as the runtime's hard-wired source today, and as a formal CLI adapter in v0.2 (PR2). |
| `SourceAdapter` interface | ✅ Shipped in v0.2 (PR2) inside `packages/flow-cli/`. Used today by the CLI; the v0.3 runtime will share the contract. |
| `aws-secrets-manager` | ✅ Shipped in v0.2 (PR2) — IAM access keys live; OIDC federation stubbed pending the Flow OIDC provider. |
| `hashicorp-vault` / `azure-key-vault` / `gcp-secret-manager` | 🗓 Planned v0.3. CLI surfaces them as stubs today (visible in the source picker; selecting one prints a clear "planned v0.3" error). |
| `flow-vault` runtime resolves non-hosted adapters | 🗓 Planned v0.3 (PR3). Until then, the CLI writes correct manifest entries but production app boots still pull from the hosted source. |

The ordering follows demand from the early-access cohort. Open an issue or email `vivek@kindtree.us` if your store isn't in this list — the adapter interface is small enough that bespoke adapters are practical for individual customers.
