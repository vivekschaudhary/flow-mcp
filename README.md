# Flow

**Stay in it.**

Flow is the runtime injection layer for your existing secrets store. Your developers ask the AI to set up Google OAuth (or Stripe, or any integration). The AI calls Flow. Credentials appear in your app's `process.env` at boot — fetched in memory from the secrets store you already trust, never written to a `.env` file, never pasted into chat. Same experience in development and production. No migration. No new attack surface.

The problem Flow solves: integration setup is the wall every AI-built project hits. Reading provider docs, juggling consoles, copy-pasting secrets, fixing leaked-key incidents — it interrupts your conversation with the AI and costs 20–30 minutes of context to recover. Flow absorbs that interruption *without* asking you to relocate your secrets.

## How it works — the source adapter pattern

Flow has two pieces: an IDE conversation layer (MCP tools the AI calls) and a runtime injection layer (`flow-vault`, a Node `--require` preload). The runtime fetches credentials from a *source adapter* and exposes them through `process.env`. Your application code is unchanged.

The source adapter is pluggable. In development, it points at Flow's hosted vault — a shared sandbox that lets developers start coding integrations before they have real credentials. In production, it points at the secrets store you already operate.

```
Dev                                        Production
┌──────────────────────┐                   ┌──────────────────────┐
│ flow-vault preload   │                   │ flow-vault preload   │
│   ↓ source: hosted   │                   │   ↓ source: aws-sm   │
│ Flow shared vault    │                   │ AWS Secrets Manager  │
│ (sandbox creds)      │                   │ (your prod creds)    │
└──────────┬───────────┘                   └──────────┬───────────┘
           ↓                                          ↓
        process.env                               process.env
        (in memory)                               (in memory)
           ↓                                          ↓
        your app                                  your app
```

Same runtime, same `process.env.GOOGLE_CLIENT_ID`, same application code. The only thing that changes between environments is where the credential map comes from.

## How Flow compares to a secrets store

Flow does not replace AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, or GCP Secret Manager. Flow runs *on top* of them.

| Concern | A secrets store | Flow |
|---|---|---|
| Where production credentials live | In the store | In the store (Flow does not move them) |
| Authentication to the store | Whatever the store requires | Adapter passes through (OIDC, IAM, token, etc.) |
| What touches your app's filesystem | Nothing (with proper config) | Nothing |
| What developers touch in dev | Manual fetch / sync scripts | One sentence to the AI |
| What developers touch in prod | Console, CLI, or platform integration | The same `process.env.X` they used in dev |
| Compliance posture | Defined by the store + your IAM | Inherits the store's posture; adds a manifest of which keys each project requests |

Flow is additive. If you already run a secrets store, Flow makes its credentials reach your app the way your developers already expect. If you don't yet, Flow's hosted source gives you a place to start before you stand one up.

## Status

Pre-release. Live: hosted vault + runtime package on npm + MCP tools for both Google OAuth and Resend (email) in development (`flow_check`, `flow_status`, `flow_setup_provider`, `flow_setup_oauth` alias, `flow_status_check`). Vault endpoint is rate-limited (per-IP and per-install_id). Coming: production credential intake (`flow_capture`, `flow_setup_provider(production)`), additional source adapters (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, GCP Secret Manager), more providers (Stripe, Twilio), `flow login` CLI for keychain session. See `CLAUDE.md` for the full roadmap.

The hosted source adapter is the only one shipped today. Other adapters are planned and documented at [docs/source-adapters.md](docs/source-adapters.md).

## Quick start (works in any MCP-capable AI tool)

Add this JSON snippet to your AI tool's MCP config:

```json
{
  "mcpServers": {
    "flow": {
      "type": "http",
      "url": "https://mcp.kindtree.us/api/mcp"
    }
  }
}
```

Where to paste it depends on your tool:

| Tool | File path |
|---|---|
| **Cursor** (project) | `<your-project>/.cursor/mcp.json` |
| **Cursor** (all projects) | `~/.cursor/mcp.json` |
| **Claude Code** (any) | `<your-project>/.mcp.json` |
| **Windsurf** | `~/.codeium/windsurf/mcp_config.json` |
| **VS Code** with MCP-enabled Copilot | `<your-project>/.vscode/mcp.json` |

Create the file if it doesn't exist. Restart your AI tool. Approve the trust prompt. Then in any Node project ask:

```
Use Flow to set up Google OAuth for development.
```

The AI calls Flow's MCP tools (`flow_check` → `flow_setup_oauth`), installs `flow-vault` into your project, wraps your dev script with `--require=flow-vault`, and tells you to restart your dev server. Your app reads `process.env.GOOGLE_CLIENT_ID` as normal — the value comes from Flow's hosted source, not from any `.env` file.

### Quick start — Claude Code CLI users (alternative)

If you're on the standalone Claude Code CLI (not the VSCode extension), `/plugin install` is available and gets you the SKILL.md auto-trigger as a bonus:

```
/plugin marketplace add vivekschaudhary/flow-mcp
/plugin install flow@flow-marketplace
```

After this, the AI proactively reaches for Flow on integration requests without needing the explicit "use Flow to..." phrasing.

### Cursor / Windsurf caveat

Those tools' agents don't read Claude Code's SKILL.md. The MCP server is the same and the tools work identically, but the AI won't auto-trigger Flow on bare "set up Google OAuth" — it needs the explicit hint **"use Flow to..."**. After that, tool descriptions on the server itself drive correct usage.

## What you do manually (until v0.2)

The bootstrap step requires you to store a session token in the OS keychain so flow-vault can authenticate when your app boots. The AI tells you the exact command at the right moment; it looks like:

```bash
node -e "require('flow-vault/keychain').storeSession('<install-id>')"
```

The `flow login` CLI in v0.2 will replace this with a one-time GitHub login.

## Components

- **`packages/flow-vault/`** — the npm-publishable runtime preload. Wraps `process.env` via a Proxy. Source-adapter-agnostic. See [packages/flow-vault/README.md](packages/flow-vault/README.md).
- **`api/mcp.ts`** — the hosted MCP server. Streamable HTTP transport via `mcp-handler`.
- **`api/vault/credentials.ts`** — the hosted source adapter's read endpoint. Called by `flow-vault` when configured to use the `flow-hosted` source.
- **`src/lib/storage.ts`** — Upstash Redis KV adapter; vault and state helpers (hosted source only).
- **`src/lib/playbook.ts`** + **`src/playbooks/`** — playbook engine and definitions.
- **`plugin/`** — Claude Code plugin manifest. Points the plugin at the hosted MCP URL.

## What Flow manages

| Integration | Provider id | Status | Notes |
|---|---|---|---|
| Google OAuth (Web) | `google-oauth-web` | ✅ Live (development only) | Library variants for nextauth/clerk/auth0/custom; multi-port + multi-callback whitelist |
| Email | `email_provider` | ✅ Live (development only) | Currently Resend under the hood; sends from `onboarding@resend.dev` test domain |
| AWS S3 | `s3_provider` (planned) | Planned (v0.2) | File uploads — narrow scope to start |
| Payments | `payments_provider` (planned) | Planned (v0.2) | Likely Stripe; webhook setup is the real pain point |
| Auth0 | `auth0` (planned) | Planned (v0.2) | 25% of repos surveyed |
| Realtime | `realtime_provider` (planned) | Planned (v0.2) | Likely Pusher; 16% of repos, no existing tooling |
| SMS | `sms_provider` (planned) | Planned (v0.3+) | Likely Twilio |

Flow only ships an integration when its playbook is verified end-to-end against the provider's current console UI. Production credential intake (`flow_capture`, `flow_setup_provider(production)`) is v0.2 work — until then, all live integrations work for development only.

## Available MCP tools

| Tool | Status | Purpose |
|---|---|---|
| `flow_status_check` | ✅ live | Connectivity probe; returns server build state |
| `flow_check` | ✅ live | Status of integrations for this project; bootstraps `install_id` on first call |
| `flow_status` | ✅ live | Verbose project health |
| `flow_setup_provider(development)` | ✅ live | Generic — accepts `provider="google-oauth-web"` or `provider="email_provider"`. Stores shared dev creds in vault, returns runtime install instructions |
| `flow_setup_oauth(development)` | ✅ live (alias) | Backward-compat alias for `flow_setup_provider(provider="google-oauth-web")` |
| `flow_setup_provider(production)` | ⏳ planned (v0.2) | Returns "coming soon" today |
| `flow_capture` | ⏳ planned (v0.2) | Will extract creds from a downloaded provider JSON the AI reads via its Read tool |
| `flow_sync` | ❌ deprecated | Runtime injection makes env-push obsolete; Flow delivers at app boot, no per-environment push needed |

## Trust model — two kinds of credentials

**Shared development credentials** (one OAuth client, used by every Flow user). Live only on Flow's hosted infrastructure. Returned by the hosted source adapter only when `env=development`. Limited to `openid email profile` scope. Equivalent to test-mode keys: anyone can use them, abuse traces back to Flow's project, kill-switch is rotate + new vault response.

**Your production credentials** (per-tenant, real secrets). Stay in whichever source adapter you point the runtime at. With the hosted source: Flow stores them in its KV under your install + project + `production`. With AWS / Vault / Azure / GCP source adapters: Flow never sees the values — the runtime authenticates to *your* store using *your* IAM. Either way: never on your filesystem, never in your `.env`, never echoed in chat. Full threat model in [packages/flow-vault/SECURITY.md](packages/flow-vault/SECURITY.md).

For why this distinction matters architecturally — the difference between Flow holding your secrets and Flow injecting from a store you operate — see [docs/source-adapters.md](docs/source-adapters.md#why-ownership-matters-in-production).

## Development vs production

| Mode | Source adapter | Where creds come from | What you do |
|---|---|---|---|
| Development | `flow-hosted` | Flow's shared dev sandbox | Nothing. They're served by the vault automatically. |
| Production (hosted) | `flow-hosted` | Your project's vault entry | One console visit guided by the AI; Flow stores and serves from then on. |
| Production (your store) | `aws-secrets-manager` / `hashicorp-vault` / `azure-key-vault` / `gcp-secret-manager` (planned) | Your own secrets store | Authenticate the runtime via your existing IAM (OIDC preferred). Flow only injects. |

## Compliance

Flow produces a per-project manifest at `.flow/integrations.json` describing which keys each project expects from which source — no secret values, just shape. The manifest is committed to your repo, reviewable in PRs, and machine-readable for audits. See [docs/compliance.md](docs/compliance.md).

## Roadmap

- **v0.1** (now): Hosted source adapter + flow-vault runtime live. Google OAuth + Resend playbooks ready. MCP tool wiring shipped for development.
- **v0.2**: Production credential intake (`flow_capture`). First non-hosted source adapter (AWS Secrets Manager via OIDC federation). Stripe + Auth0 + AWS S3 + Pusher playbooks. CLI for `flow login`.
- **v0.3**: HashiCorp Vault, Azure Key Vault, GCP Secret Manager source adapters. Twilio, Resend, SendGrid playbooks. Marketplace listing in `anthropics/claude-plugins-community`.
- **v1**: Credential lifecycle (`flow_rotate`, `flow_revoke`, `flow_audit`). Compliance manifest tooling. Microsite.
- **v2+**: Agent credential broker — scoped JIT credentials issued to AI agents per task with auto-revoke.

## Contributing

Playbook contributions welcome once the schema stabilizes. The current playbook lives at `src/playbooks/google-oauth-web.json` and demonstrates the format: 8 steps, library variants, blocking warnings, common errors. Schema reference and contribution guide will land at `docs/playbooks.md` once playbook v2 schema is finalized.

Source adapter contributions welcome once the adapter interface is finalized. Today the runtime hard-codes the hosted source; the abstraction lands in v0.2.

## License

MIT.

## Contact

`vivek@kindtree.us` — issues, security, partnership.
