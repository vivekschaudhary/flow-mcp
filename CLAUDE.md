# Flow — Build Context

Single source of truth for Flow's design and current state. Auto-loaded by Claude Code at session start.

---

## What Flow is

**One sentence.** Flow is a hosted credential vault and Claude Code plugin that injects integration credentials into the user's app at runtime — so developers never leave their conversation with Claude to set up OAuth, API keys, or env vars.

**The core insight.** Building with AI works until the integration wall. OAuth, secrets, env config — every one of these forces the developer out of conversation, into a provider console, into copy-paste, into 20–30 minutes of context-rebuilding. Flow absorbs that interruption.

**What Flow is NOT.** Not a 1Password / Doppler clone (those manage YOUR existing keys; Flow handles BOTH owned dev keys and your prod keys). Not a credentials manager UI. Not a proxy in the OAuth request path. Not a documentation tool. Flow is a *flow preservation layer* for AI-built software.

---

## Architecture (current state — 2026-05-03)

Flow is two cooperating products that ship as one experience:

```
┌────────────────────────────────────────────────────────────────────┐
│ Claude Code  +  flow plugin                                        │
│   Plugin's .mcp.json points at https://mcp.kindtree.us/api/mcp     │
│   Claude calls flow_* MCP tools → server stores creds in vault     │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ↓ MCP over HTTPS (Streamable)
┌────────────────────────────────────────────────────────────────────┐
│ Hosted Flow service @ mcp.kindtree.us  (Vercel Functions)          │
│   /api/mcp                MCP server (mcp-handler)                 │
│   /api/vault/credentials  Read endpoint (called by runtime)        │
│   Backed by Upstash Redis KV + Vercel env (FLOW_GOOGLE_*)          │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                               ↓ HTTPS GET on app boot
┌────────────────────────────────────────────────────────────────────┐
│ User's app  +  flow-vault  (npm package, --require preload)        │
│   Reads keychain session (no creds in env vars)                    │
│   Fetches credential map → caches in memory                        │
│   Wraps process.env with Proxy                                     │
│   Developer's own values WIN over vault on overlap                 │
│   process.env.GOOGLE_CLIENT_ID resolves transparently              │
└────────────────────────────────────────────────────────────────────┘
```

**Key property.** No credentials ever sit on the user's filesystem. `.env` files don't need to contain Google/Stripe/Twilio secrets — `flow-vault` injects them at process startup, in memory, per session.

---

## Live surface (what actually works today)

| Layer | Status | Detail |
|---|---|---|
| Hosted MCP server at `mcp.kindtree.us/api/mcp` | ✅ deployed | 5 tools live: `flow_status_check`, `flow_check`, `flow_status`, `flow_setup_provider`, `flow_setup_oauth` (alias) |
| Vault endpoint at `mcp.kindtree.us/api/vault/credentials` | ✅ deployed | GET; scopes shared dev creds to providers the project has configured; rate-limited per-IP and per-install_id |
| Upstash Redis (KV) | ✅ provisioned | State + vault entries persist across functions |
| `flow-vault@0.1.0` on npm | ✅ published | Public; `npm install --save-dev flow-vault` works for anyone |
| GitHub repo at `vivekschaudhary/flow-mcp` | ✅ public | Marketplace + runtime + server source |
| Provider registry — `google-oauth-web` (Google sign-in) | ✅ live (dev only) | Library variants for nextauth/clerk/auth0/custom; multi-port + multi-callback whitelist |
| Provider registry — `email_provider` (Resend under the hood) | ✅ live (dev only) | Sends from `onboarding@resend.dev`; shared key restricted (no verified domains on Flow's Resend account) |
| Vault endpoint rate limits | ✅ live | Per-IP: 30/min, 200/hr. Per-install_id: 5/min, 50/hr. 429 + Retry-After on cap. |
| Production credential intake (`flow_capture`, `flow_setup_provider(production)`) | 🚧 **NOT live** | M2.5 work — until then all integrations are dev-only |
| `flow login` CLI for real auth | 🚧 **NOT live** | v0.2 work — replaces anonymous install_id model |

The `flow-vault` runtime is proven; what remains is the MCP tool layer that lets Claude write to the vault on behalf of the user, plus distribution polish.

---

## Trust model — two kinds of credentials

This is the most important thing to internalize.

**Shared dev credentials** (one OAuth client, used by every Flow user)
- Live in: GCP project `flow-dev-shared` (Vivek owns) → Vercel env `FLOW_GOOGLE_CLIENT_ID/SECRET` → `/api/vault/credentials` response when `env=development`
- These are *intentionally shared*. Equivalent to Stripe test-mode keys: anyone can have them, scope is limited to `openid email profile`, abuse traces back to the GCP project, kill-switch is rotate + new vault response.
- They never live in the plugin's source, never live in the user's `.env`, never live in any committed file.

**User's production credentials** (per-user, per-project, real secrets)
- User creates them in their *own* GCP / Stripe / etc. console
- Flow MCP tools (M2 work) capture them and store in vault under `vault:<install>:<project>:production`
- Returned by `/api/vault/credentials` only when `env=production`
- Never exposed via the dev fallback
- Never touch the user's filesystem; live only in Flow's KV + the user's app's memory at runtime

---

## Repo layout (current, accurate)

```
flow-mcp/
├── api/
│   ├── mcp.ts                     Hosted MCP entry (mcp-handler / Streamable HTTP)
│   └── vault/credentials.ts       Vault read endpoint
├── src/
│   ├── lib/
│   │   ├── storage.ts             Upstash Redis KV adapter + state/vault helpers
│   │   └── playbook.ts            Playbook engine (load JSON, format steps, surface warnings)
│   └── playbooks/
│       └── google-oauth-web.json  v1.0.0 — 8 steps, library variants, blocking warnings
├── packages/
│   └── flow-vault/                Runtime preload npm package
│       ├── index.js               IIFE: keychain → detect → vault → proxy
│       ├── keychain.js            Sync wrapper around keychain-helper.js
│       ├── keychain-helper.js     Async keytar bridge (spawned via execFileSync)
│       ├── vault.js               Sync wrapper around vault-helper.js
│       ├── vault-helper.js        Async fetch (Node 18+ built-in)
│       ├── proxy.js               process.env Proxy: dev value wins over vault
│       └── detect.js              Project name + environment detection
├── plugin/                        Claude Code plugin (marketplace-ready)
│   ├── .claude-plugin/plugin.json
│   ├── .mcp.json                  { type: "http", url: "https://mcp.kindtree.us/api/mcp" }
│   ├── README.md
│   └── skills/flow-integrations/SKILL.md
├── .claude-plugin/marketplace.json  Self-hosted marketplace listing
├── vercel.json                      Function config
├── package.json                     Root workspace config (packages/*)
└── tsconfig.json                    noEmit; type-checks src/ + api/
```

Out of repo, on the deploy side:
- Vercel project `kind-tree/flow-mcp` (custom domain `mcp.kindtree.us`)
- Vercel env vars: `FLOW_GOOGLE_CLIENT_ID`, `FLOW_GOOGLE_CLIENT_SECRET`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Upstash Redis instance (provisioned via Vercel Marketplace)

---

## Roadmap

### M2 v2 — wire the MCP tools (~1 day)
- `flow_check`, `flow_status`, `flow_setup_oauth(development)` ported into `api/mcp.ts`
- Each tool stores creds in vault via `mergeVault()` (already in `storage.ts`)
- Returns text instructions for Claude to install `flow-vault` + add `--require` to the start script
- Updates `plugin/skills/flow-integrations/SKILL.md` to teach Claude the install pattern

### v1.1 — credential lifecycle
- `flow_rotate` — rotate creds before expiry
- `flow_revoke` — revoke when developer leaves team
- `flow_audit` — show what creds exist where

### v1.2 — more playbooks
1. AWS S3 (file uploads — narrow scope)
2. Stripe + Webhooks (webhook setup is the real pain)
3. Auth0 (25% of repos, more complex than Google OAuth)
4. Pusher (16% of repos, zero existing tooling)

### v1.3 — distribution
- List plugin in `anthropics/claude-plugins-community`
- Install command becomes `/plugin install flow@claude-community`
- Publish `flow-vault` and `flow-vault-cli` to npm
- Microsite (one page, one command, one 60-second demo)

### v2 — `flow-vault-cli` for real auth
- `flow login` — GitHub OAuth via Flow service, session stored in OS keychain
- Replaces anonymous install_id model with real user attribution
- Required for per-user quotas, abuse mitigation, billing

### v3 — agent credential broker
- Scoped JIT credentials for AI agents (not just user apps)
- Auto-revoke on task completion
- Full audit trail per task

---

## Competitive landscape

| Player | Position | Why they don't compete |
|---|---|---|
| 1Password / Doppler / Vault | Manage YOUR existing keys | Assume you already have an account; don't host shared dev sandboxes |
| Stripe / Vercel / Supabase plugins | First-party "use my product from Claude" | Per-provider, manages YOUR account; Flow is multi-provider AND owns dev accounts |
| CyberArk / Strata | Enterprise IAM | Wrong buyer (CISO, not dev), too complex |
| Cloudflare | Infrastructure | Not developer-native, requires significant setup |
| Nango / Composio | B2B integrations (your app ↔ customer's Salesforce) | Different problem entirely |

Flow's empty-quadrant position: **"developer-native credential lifecycle for the MCP era — gets you running on dev accounts before you have real ones."**

---

## Top integration friction points (1000-repo GitHub research)

```
Rank  Integration     % of repos
1     AWS S3          31%
2     AWS General     28%   (combined ~45%)
3     Auth0           25%
4     OpenAI          25%
5     Google OAuth    25%   ← v1.0.0 playbook live
6     Stripe          22%   ← v1.2 priority
7     Pusher          16%
8     GitHub OAuth    13%
9     Sentry          13%
10    Anthropic        9%
```

---

## Key decisions made

| Decision | Choice | Reason |
|---|---|---|
| Local-stdio MCP vs hosted | Hosted | One-command install via plugin; no creds shipped to user |
| Env injection vs runtime fetch | Runtime fetch via `flow-vault` | Universal across Node runtimes; no creds on user's disk |
| Keychain vs env-var auth | OS keychain | Real credential storage; no leak via dotfiles |
| Sync HTTP at preload | `child_process.spawnSync` | Bridges Node `--require` sync constraint without sync-http dep |
| `process.env` access | JS Proxy with developer-wins | Zero app code changes |
| OAuth proxy vs direct | Direct (no proxy) | No user-app dependency on Flow at OAuth request time |
| Distribution | Claude Code plugin → marketplace | Zero install friction |
| Default Google scope | `openid email profile` only | Limits blast radius if shared creds ever abused |
| Production OAuth client | User-created, captured by Flow | Google blocks programmatic OAuth client creation |

---

## Operational resources

- **Vercel project:** `kind-tree/flow-mcp` (`prj_2T9BlxKGKrXdPttNxaGU8vNxORM5`)
- **Custom domain:** `mcp.kindtree.us`
- **Shared GCP project:** `flow-dev-shared` (OAuth client owner — your liability for abuse, scope-limited, kill-switchable)
- **KV:** Upstash Redis (Vercel Marketplace integration)
- **Plugin marketplace target:** `anthropics/claude-plugins-community`

---

## Pitch (3 sentences)

Every developer using AI to build software hits the same wall — the code writes itself, the integrations don't. Flow is the credential layer Claude calls so developers never leave their conversation to set up OAuth, configure notifications, or juggle secrets across environments. One install, one login, every integration handled silently from then on.

---

## Notes for Claude when this file is loaded

- The hosted MCP server now exposes 5 tools (see Live surface table above). Use `flow_setup_provider` for new provider setup; `flow_setup_oauth` is a backward-compat alias for the Google OAuth case.
- `flow_capture`, `flow_sync`, `flow_setup`, and `flow_setup_provider(production)` are NOT live (M2.5 / deprecated). If you call them you'll get "method not found" or a "coming soon" reply.
- The `flow-vault` runtime is on npm and proven working end-to-end on real apps.
- Adding a new provider = one entry in `src/lib/providers.ts` + a `FLOW_<...>_*` env var on Vercel. No new MCP tool required.
- Never echo any credential VALUE into chat (Google client_secret, Resend API key, anything captured from a user's downloaded JSON). Reference by variable name only. The vault endpoint returns values in plaintext by design — be careful when curl-testing it; pipe through a presence-check, not a pretty-printer.
- Per-project credentials (production) belong to the user; Flow only orchestrates capture + vault storage. Production intake is M2.5.
