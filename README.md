# Flow

**Stay in it.**

Flow is a hosted credential vault that plugs into any AI coding tool with MCP support — Claude Code, Cursor, Windsurf. You ask the AI to set up Google OAuth (or Stripe, or any integration). The AI calls Flow. Credentials appear in your app at runtime, in memory only — never written to a `.env` file, never pasted into chat. You stay in conversation.

The problem Flow solves: integration setup is the wall every AI-built project hits. Reading provider docs, juggling consoles, copy-pasting secrets, fixing leaked-key incidents — it interrupts your conversation with Claude and costs 20–30 minutes of context to recover. Flow absorbs that interruption.

How it works: a hosted MCP server holds Flow's shared development credentials and your stored production credentials. A small Node preload (`flow-vault`) fetches them at app boot and exposes them through `process.env` — your application code is unchanged. Claude Code calls Flow's MCP tools to write to the vault on your behalf when an integration is needed.

## Status

Pre-release. Live: hosted vault + runtime package on npm + MCP tools for Google OAuth dev (`flow_check`, `flow_status`, `flow_setup_oauth(development)`, `flow_status_check`). Coming: production OAuth (`flow_capture`, `flow_setup_oauth(production)`), Stripe + Twilio + Resend playbooks, `flow login` CLI for keychain session. See `CLAUDE.md` for the full roadmap.

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

The AI calls Flow's MCP tools (`flow_check` → `flow_setup_oauth`), installs `flow-vault` into your project, wraps your dev script with `--require=flow-vault`, and tells you to restart your dev server. Your app reads `process.env.GOOGLE_CLIENT_ID` as normal — the value comes from Flow's vault, not from any `.env` file.

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

## How it works

Three components, each independent:

```
┌─────────────────────┐
│ flow-cli            │  Stores a session token in your OS keychain.
│ (planned)           │  Runs once per machine.
└─────────────────────┘

┌─────────────────────┐
│ Flow MCP server     │  Hosted at mcp.kindtree.us. Claude calls its tools
│                     │  to provision and store credentials in the vault.
└─────────────────────┘

┌─────────────────────┐
│ flow-vault runtime  │  Node --require preload. Fetches vault at boot,
│                     │  injects into process.env, your app code is unchanged.
└─────────────────────┘
```

You install the plugin once. The runtime ships with each project that uses it. The CLI is a one-time login per machine.

## What Flow manages

| Integration | Status | Notes |
|---|---|---|
| Google OAuth (Web) | Playbook v1.0.0 ready; tool wiring in progress | 8 steps, library variants for nextauth/clerk/auth0/custom |
| AWS S3 | Planned (v0.2) | File uploads — narrow scope to start |
| Stripe + Webhooks | Planned (v0.2) | Webhook setup is the real pain point |
| Auth0 | Planned (v0.2) | 25% of repos surveyed |
| Pusher | Planned (v0.2) | 16% of repos; no existing tooling |
| Twilio, Resend, SendGrid | Planned (v0.3+) | API-key shape; lower friction than OAuth |

Flow only ships an integration when its playbook is verified end-to-end against the provider's current console UI.

## Components

- **`packages/flow-vault/`** — the npm-publishable runtime preload. See [packages/flow-vault/README.md](packages/flow-vault/README.md).
- **`api/mcp.ts`** — the hosted MCP server. Streamable HTTP transport via `mcp-handler`.
- **`api/vault/credentials.ts`** — vault read endpoint. Called by `flow-vault` at boot.
- **`src/lib/storage.ts`** — Upstash Redis KV adapter; vault and state helpers.
- **`src/lib/playbook.ts`** + **`src/playbooks/`** — playbook engine and definitions.
- **`plugin/`** — Claude Code plugin manifest. Points the plugin at the hosted MCP URL.

## Available MCP tools

| Tool | Status | Purpose |
|---|---|---|
| `flow_status_check` | live | Confirms connectivity |
| `flow_check` | planned (M2) | Status of integrations for this project |
| `flow_setup_oauth(development)` | planned (M2) | Stores Google dev creds in vault, tells Claude to install flow-vault |
| `flow_setup_oauth(production)` | planned (M2.5) | Guides user through GCP console, captures downloaded JSON |
| `flow_capture` | planned (M2.5) | Extracts creds from a downloaded provider JSON |
| `flow_sync` | planned (M2.5) | Pushes captured creds to deploy platform |
| `flow_status` | planned (M2) | Full project integration health |

## Security model

Two kinds of credentials, very different threat models:

**Shared development credentials** (one OAuth client, used by every Flow user). Live only on Flow's hosted infrastructure (Vercel env). Returned only when `env=development`. Limited to `openid email profile` scope. Equivalent to Stripe test-mode keys: anyone can use them, abuse traces back to Flow's GCP project, kill-switch is rotate + new vault response.

**Your production credentials** (per-user, real secrets). You create them in your own provider console. Flow captures and stores them in vault under your project + `production` environment. Returned only with your session. Never on your filesystem. Never in your `.env` files. Never echoed in chat. Full detail: [packages/flow-vault/SECURITY.md](packages/flow-vault/SECURITY.md).

## Development vs production

| Mode | Where creds come from | What you do |
|---|---|---|
| Development | Flow's shared dev credentials | Nothing. They're served by the vault automatically. |
| Production | Your own credentials, captured into vault | One console visit guided by Flow; Flow stores and serves from then on. |

## Roadmap

- **v0.1** (now): Hosted vault + flow-vault runtime live. Google OAuth playbook ready. MCP tool wiring in progress.
- **v0.2**: Tool wiring complete. Stripe + Auth0 + AWS S3 + Pusher playbooks. CLI for `flow login`.
- **v0.3**: Twilio, Resend, SendGrid. Marketplace listing in `anthropics/claude-plugins-community`.
- **v1**: Credential lifecycle (`flow_rotate`, `flow_revoke`, `flow_audit`). Microsite.
- **v2+**: Agent credential broker — scoped JIT credentials issued to AI agents per task with auto-revoke.

## Contributing

Playbook contributions welcome once the schema stabilizes. The current playbook lives at `src/playbooks/google-oauth-web.json` and demonstrates the format: 8 steps, library variants, blocking warnings, common errors. Schema reference and contribution guide will land at `docs/playbooks.md` once playbook v2 schema is finalized.

## License

MIT.

## Contact

`vivek@kindtree.us` — issues, security, partnership.
