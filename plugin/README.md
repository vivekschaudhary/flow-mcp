# Flow — Integration plugin for AI-coding IDEs

**Flow is the layer your AI IDE calls so you never leave your conversation to set up integrations.**

Working with Claude Code, Cursor, Windsurf, or VS Code (with MCP-enabled Copilot)? Ask the AI for Google sign-in or transactional email and Flow handles the credential side: dev creds appear in your app's `process.env` at boot, **never in a `.env` file**, never pasted into chat. No provider consoles. No copy-pasting secrets.

## What's live today

Two providers, development environment only. Be skeptical of any doc that claims more than this.

| Provider id | Provider | Status |
|---|---|---|
| `google-oauth-web` | Google OAuth (Web sign-in) | ✅ Live (development) |
| `email_provider` | Transactional email (Resend under the hood) | ✅ Live (development) |
| Stripe / Auth0 / AWS S3 / Pusher / Twilio | Various | 🚧 Planned (v0.2 / v0.3) |
| Production credential intake (`flow_capture`, `flow_setup_provider(production)`) | — | 🚧 Planned (v0.2) |

## Install

The plugin's `.mcp.json` snippet works in any MCP-capable IDE — see the repo root [README.md](../README.md#quick-start-works-in-any-mcp-capable-ai-tool) for the per-tool config path (Cursor, Claude Code, Windsurf, VS Code).

If you're on the standalone Claude Code CLI, the marketplace install also works and adds proactive auto-trigger via the bundled SKILL.md:

```
/plugin marketplace add vivekschaudhary/flow-mcp
/plugin install flow@flow-marketplace
```

## Use

Ask the AI in plain language:

```
Set up Google OAuth for development.
```

What happens:

1. AI calls `flow_check` to bootstrap your project (writes `.flow/install.json`, generates an install id) and verify the integration isn't already configured.
2. AI calls `flow_setup_provider(provider="google-oauth-web", environment="development")`. Flow's hosted server stores its shared dev credentials in your project's vault namespace.
3. AI runs `npm install --save-dev flow-vault` and adds `NODE_OPTIONS='--require=flow-vault'` to your dev script in `package.json`.
4. You restart your dev server. `process.env.GOOGLE_CLIENT_ID` and `process.env.GOOGLE_CLIENT_SECRET` resolve from the vault at boot. **No `.env` line is written.**

For email (Resend), substitute `set up email for development` and read the AI's reply for the from-address constraints (sends from `onboarding@resend.dev` while in dev).

Production setup is planned for v0.2 and currently returns "coming soon."

## Live MCP tools (called by the AI, not by you)

| Tool | Status | What it does |
|---|---|---|
| `flow_status_check` | ✅ Live | Connectivity probe |
| `flow_check` | ✅ Live | Project + integration status; bootstraps `install_id` on first call |
| `flow_status` | ✅ Live | Verbose project health |
| `flow_setup_provider` | ✅ Live (development only) | Generic — `provider` ∈ {`google-oauth-web`, `email_provider`} |
| `flow_setup_oauth` | ✅ Live (alias) | Backward-compat alias for `flow_setup_provider(provider="google-oauth-web")` |
| `flow_setup_provider(environment="production")` | 🚧 Planned (v0.2) | Returns "coming soon" today |
| `flow_capture` | 🚧 Planned (v0.2) | Will extract creds from a downloaded provider JSON |
| `flow_sync` | ❌ Removed | Runtime injection makes env-push obsolete; Flow delivers at app boot |

## How it works

Flow runs as a hosted MCP service at `https://mcp.kindtree.us`. The plugin's `.mcp.json` is a thin pointer to that service — your IDE connects, your AI's tool surface gains the `flow_*` tools, and any project on your machine can use them.

The hosted server holds Flow's shared development credentials (Google OAuth client limited to `openid email profile`; Resend key restricted to a no-verified-domains account — both monitored, kill-switchable). When the AI asks Flow for a development integration, the server stores the relevant env-var map in your project's vault entry. The `flow-vault` runtime preload (`npm install --save-dev flow-vault` + `--require=flow-vault` in your start script) fetches that map at app boot and injects it into `process.env` via a Proxy. **Credentials never touch your filesystem.**

For production: production credential intake is on the v0.2 roadmap. The longer-term picture is the *source adapter pattern* — Flow injects from whichever secrets store you already operate (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, GCP Secret Manager) using your IAM, so Flow never sees production credential values. See [docs/source-adapters.md](../docs/source-adapters.md).

## Trust model — read this before you install

Two kinds of credentials, very different threat models:

1. **Flow shared dev credentials** (one set per provider, used by every Flow user). Operated by Flow at `mcp.kindtree.us` — never shipped to your machine in source form. Deliberately shared (limited scope, monitored, rotatable). Equivalent to Stripe's test-mode keys.
2. **Your production credentials** (per-tenant, real secrets). Production intake is planned for v0.2. With the hosted source: stored in Flow's KV under your install + project + `production`. With non-hosted source adapters (planned v0.2 / v0.3): Flow never sees the values — the runtime authenticates to your store using your IAM. Either way: never on your filesystem, never in `.env`, never echoed in chat.

If you don't trust Flow to operate a small set of shared dev credentials on your behalf, don't install. If you do, you get one MCP-config snippet and you stop visiting provider consoles for development OAuth.

## License

MIT

## Author

Vivek Chaudhary — [kindtree.us](https://kindtree.us) — `vivek@kindtree.us`
