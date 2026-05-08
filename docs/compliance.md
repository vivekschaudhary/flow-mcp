# Compliance

This document is for whoever signs off on what credentials your apps are allowed to consume — security lead, SRE, platform team, or in a small org, you. It describes the artifact Flow produces, what it proves, and what it does not.

## The artifact: `.flow/integrations.json`

Every Flow-enabled project has one of these in its repo. It is the authoritative declaration of which keys each project requests, from which source, in which environment.

```jsonc
{
  "project": "swing-trading-signals",
  "environments": {
    "development": {
      "source": "flow-hosted",
      "integrations": ["google-oauth-web", "email_provider"]
    },
    "preview": {
      "source": "flow-hosted",
      "integrations": ["google-oauth-web", "email_provider"]
    },
    "production": {
      "source": "aws-secrets-manager",
      "config": {
        "auth": "oidc",
        "region": "us-east-1",
        "role_arn": "arn:aws:iam::123456789012:role/flow-prod-read",
        "secret_path_prefix": "prod/swing-trading-signals/"
      },
      "integrations": ["google-oauth-web", "email_provider", "payments_provider"]
    }
  }
}
```

What's in the file:

- The project's identity (matches `package.json` name).
- Per environment: the source adapter, its non-secret configuration, and the list of integrations the project consumes.

What is **not** in the file:

- Credential values of any kind.
- Tokens, keys, certificates, or anything that could be exfiltrated by reading the repo.

The file is committed to version control. Every change is a pull request. The diff is human-readable.

## What the manifest proves to an auditor

For a SOC 2 — or any control framework that asks the same questions in different language — the recurring evidence requests are:

| Question | Where the manifest answers it |
|---|---|
| What production credentials does this application consume? | `environments.production.integrations` (by name; values stay in your store) |
| Where do those credentials live? | `environments.production.source` |
| How does the application authenticate to that source? | `environments.production.config.auth` |
| Is the principal scoped — least privilege? | `role_arn` / `secret_path_prefix` (or equivalent per source) |
| Who approved this configuration? | The PR that added or changed the manifest entry |
| When was it last reviewed? | Git history of the file |

A reviewer who has never seen the codebase can answer these in five minutes by reading one file plus its commit history. That is the unlock.

What the manifest does **not** prove:

- That the underlying IAM role grants only what the manifest says it does. The store's policy is the ground truth; the manifest is a declaration of intent. A drift check is on the v1 roadmap (`flow audit`, below).
- That the application code does not also read non-Flow-managed secrets via other means. Flow only attests to what flows through `flow-vault`.
- The certifications of the underlying source (your AWS / Vault / Azure / GCP store). Those certifications are inherited from the store, not granted by Flow.

## The trust posture by source

| Source | Where production credentials live | Who has the IAM | Flow can read them? |
|---|---|---|---|
| `flow-hosted` | Flow's KV (Upstash Redis behind Vercel) | Flow operates the IAM; tenant scope by install id | Yes (Flow stores them) |
| `aws-secrets-manager` | Your AWS account | Your IAM | No |
| `hashicorp-vault` | Your Vault deployment | Your Vault auth methods | No |
| `azure-key-vault` | Your Azure tenant | Your AAD identities | No |
| `gcp-secret-manager` | Your GCP project | Your service accounts / workload identity | No |

For non-hosted sources: Flow is on the runtime authentication path (it ships the code that calls your store), not on the credential storage path. **The credentials never traverse Flow's infrastructure.**

For the hosted source: Flow is on both paths. This is appropriate for development and small-team production; it is explicitly *not* the default recommendation for organizations with a primary secrets store. See [docs/source-adapters.md](./source-adapters.md#why-ownership-matters-in-production) for the architectural rationale.

## Planned: `flow audit`

The `flow audit` command (planned, v1) reads the manifest and verifies it against the actual store:

- For each integration declared in the manifest, does the configured store have the keys present?
- Does the configured IAM role have read access to exactly that path / namespace and no more?
- Are there orphan secrets at the path that aren't declared in the manifest?
- Are there manifest entries for secrets that don't exist in the store?

Output is a single report suitable for attaching to a SOC 2 evidence request. The drift between manifest and store is the finding; the manifest itself is the policy.

Until `flow audit` ships, the manifest is the policy artifact and your store's existing access logs are the evidence.

## What Flow does not certify

Flow holds no security certifications today. The hosted source is operated to a "small-team production" bar, not a regulated-industry bar. Flow does not claim:

- SOC 2, ISO 27001, PCI DSS, HIPAA, FedRAMP, or any other formal certification.
- Independent penetration testing of the hosted vault.
- Regional data residency guarantees.

If your compliance program requires any of these, the path is the source adapter pattern: keep production credentials in a store that *does* hold the certification you need (most large clouds do), and use Flow as the runtime injection layer on top. The certifications you already paid for transfer; Flow is additive.

## Reviewing a Flow-enabled project

A pragmatic review checklist:

1. Read `.flow/integrations.json` for the project. Note the `production.source` and the `integrations` list.
2. If `production.source != "flow-hosted"`: verify the IAM role / token / identity has *read-only* access scoped to exactly the path declared. Reject manifest changes that broaden scope without justification in the PR.
3. If `production.source == "flow-hosted"` *and* the project is in scope for your compliance program: this is a finding. Migrate to a customer-owned source.
4. Compare the integrations list to what the application actually does. Surplus integrations are the most common drift.
5. For each integration, confirm the corresponding secret exists in the configured store at the declared path.

## Contact

`vivek@kindtree.us` for compliance questions, security disclosures, or to request a specific source adapter.
