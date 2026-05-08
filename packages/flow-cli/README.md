# flow-cli

The Flow CLI. The canonical interface for production credential setup; the MCP tool `flow_setup_production` redirects to this CLI.

## Why CLI, not chat

Production credential entry needs three properties a chat tool can't deliver:

- **Hidden input** — terminal password mode keeps secret values out of scrollback.
- **Shell history** — reconstructable audit trail of who ran what, when, with which flags.
- **Scriptability** — the same setup re-runs non-interactively in CI / runbooks.

So the MCP layer redirects, and this CLI is where the real work happens.

## Status

Pre-release (v0.0.1, in active development). Today the CLI ships:

| Command | Status |
|---|---|
| `flow setup production --integration <id>` | ✅ Real (interactive + non-interactive) |
| `flow status` | ✅ Real |
| `flow audit` | 🟡 Stub (coming in v0.2.1) |
| `flow login` | 🟡 Stub (coming in v0.3) |

Source adapters:

| Adapter | Status |
|---|---|
| `flow-hosted` | ✅ Real (formalizes the existing hosted source) |
| `aws-secrets-manager` | ✅ Real (IAM access keys today; OIDC federation stubbed pending Flow OIDC provider) |
| `hashicorp-vault` | 🟡 Stub (planned v0.3) |
| `azure-key-vault` | 🟡 Stub (planned v0.3) |
| `gcp-secret-manager` | 🟡 Stub (planned v0.3) |

**Honest gap:** the CLI writes `.flow/integrations.json` manifests that the `flow-vault` runtime cannot yet honor at production app boot. Runtime resolution of non-hosted adapters lands in v0.3. Until then, the manifest is correctly configured, but production app boots still pull from the hosted source.

## Install

While in pre-release, install from source:

```bash
git clone https://github.com/vivekschaudhary/flow-mcp.git
cd flow-mcp/packages/flow-cli
npm install
npm run build
npm link    # makes `flow` available globally
```

## Use

Interactive:

```bash
flow setup production --integration google-oauth-web
```

Non-interactive (for CI / runbooks):

```bash
flow setup production \
  --integration google-oauth-web \
  --source aws-secrets-manager \
  --auth-method iam-access-keys \
  --secret-name prod/myapp/google-oauth \
  --region us-east-1 \
  --skip-staging
```

AWS credentials in non-interactive mode are read from the environment:

```bash
export FLOW_AWS_ACCESS_KEY_ID=AKIA...
export FLOW_AWS_SECRET_ACCESS_KEY=...
```

## Test mode

Set `FLOW_TEST_MODE=true` to short-circuit the AWS adapter with hardcoded fixture secrets — useful for iterating on prompts without an AWS account.

## Manifest

The CLI writes `.flow/integrations.json` (Shape A — integration-first). Schema documented in [docs/source-adapters.md](../../docs/source-adapters.md) and [docs/compliance.md](../../docs/compliance.md). The manifest contains zero secret values — only source references, secret names, regions, and env-var mappings. Commit it to your repo.

## License

MIT.
