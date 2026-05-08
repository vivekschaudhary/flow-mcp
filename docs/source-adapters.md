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

## The adapter interface (planned, v0.2)

```ts
interface SourceAdapter {
  // Identifier the runtime resolves from .flow/integrations.json.
  readonly id: string;

  // Called once at preload, in the user's app process.
  // Returns the credential map for (project, environment).
  // Synchronous from the caller's perspective; adapters that need
  // async I/O bridge it via execFileSync the same way the hosted
  // adapter does today.
  fetch(opts: {
    project: string;     // from package.json name
    environment: string; // "development" | "preview" | "production"
  }): Record<string, string>;
}
```

Today the runtime hard-codes the `flow-hosted` adapter. The interface is finalized in v0.2 alongside the first non-hosted adapter (AWS Secrets Manager). The contract for any adapter:

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

### `aws-secrets-manager` (planned v0.2)

The first non-hosted adapter. Authentication via **OIDC federation** — your compute platform (Vercel, Cloud Run, ECS, EKS, GitHub Actions) presents a short-lived OIDC token; AWS exchanges it for temporary IAM credentials scoped to a role you control.

```ts
// .flow/integrations.json
{
  "production": {
    "source": "aws-secrets-manager",
    "config": {
      "auth": "oidc",
      "region": "us-east-1",
      "role_arn": "arn:aws:iam::123456789012:role/flow-prod-read",
      "secret_path_prefix": "prod/swing-trading-signals/"
    }
  }
}
```

At preload the adapter:

1. Reads the platform's OIDC token (`AWS_ROLE_ARN` + `AWS_WEB_IDENTITY_TOKEN_FILE`, or platform-specific equivalents).
2. Calls `sts:AssumeRoleWithWebIdentity` to mint short-lived credentials.
3. Calls `secretsmanager:GetSecretValue` for every secret matching `prod/swing-trading-signals/*`.
4. Parses each (JSON or string) and merges into the credential map.

Fallback: long-lived IAM access keys via env. Discouraged but supported for compute that can't speak OIDC.

**Flow does not see your production credentials.** The runtime authenticates to AWS using your role; AWS hands the values back to your process; the adapter merges them into the Proxy. Flow's hosted infrastructure is not on the request path.

### `hashicorp-vault` (planned v0.3)

```ts
{
  "production": {
    "source": "hashicorp-vault",
    "config": {
      "auth": "kubernetes",          // or "aws", "oidc", "approle"
      "address": "https://vault.example.com",
      "mount_path": "kv/swing-trading-signals/prod"
    }
  }
}
```

Authentication via whatever auth method your Vault deployment already uses. Adapter calls `auth.<method>.login` for a Vault token, then `kv-v2.read` for the configured path.

### `azure-key-vault` (planned v0.3)

```ts
{
  "production": {
    "source": "azure-key-vault",
    "config": {
      "auth": "managed_identity",    // or "service_principal"
      "vault_url": "https://swing-trading-signals.vault.azure.net",
      "secret_prefix": "prod-"
    }
  }
}
```

Managed identity is the recommended path on Azure compute (Functions, Container Apps, App Service, AKS). The adapter calls `IMDS` for a token and `Get Secret` for each prefixed secret.

### `gcp-secret-manager` (planned v0.3)

```ts
{
  "production": {
    "source": "gcp-secret-manager",
    "config": {
      "auth": "workload_identity",   // or "service_account_json"
      "project": "my-gcp-project",
      "secret_filter": "labels.app=swing-trading-signals AND labels.env=production"
    }
  }
}
```

Workload identity (GKE / Cloud Run / Cloud Functions) lets the adapter authenticate without a service account key on disk. The adapter lists secrets matching the filter and reads each.

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

Swapping a source is a one-line change in `.flow/integrations.json`. Application code is untouched. The Proxy contract on `process.env` is invariant. Library code that reads `process.env.GOOGLE_CLIENT_ID` doesn't know — and shouldn't know — where the value came from.

```diff
  "production": {
-   "source": "flow-hosted",
+   "source": "aws-secrets-manager",
+   "config": {
+     "auth": "oidc",
+     "region": "us-east-1",
+     "role_arn": "arn:aws:iam::123456789012:role/flow-prod-read",
+     "secret_path_prefix": "prod/swing-trading-signals/"
+   },
    "integrations": ["google-oauth-web", "email_provider"]
  }
```

The cost of switching sources is the cost of populating the new store with the same key set. The runtime, the application, and the developer experience don't change.

## Status

| Adapter | Status |
|---|---|
| `flow-hosted` | ✅ Shipped. Today the runtime is hard-wired to this. |
| Adapter interface | 🚧 Planned v0.2. Until shipped, the runtime hard-codes the hosted source. |
| `aws-secrets-manager` | 🚧 Planned v0.2. First non-hosted adapter. |
| `hashicorp-vault` / `azure-key-vault` / `gcp-secret-manager` | 🗓 Planned v0.3. |

The ordering follows demand from the early-access cohort. Open an issue or email `vivek@kindtree.us` if your store isn't in this list — the adapter interface is small enough that bespoke adapters are practical for individual customers.
