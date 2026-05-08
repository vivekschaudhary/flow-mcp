# Flow — Build Context

Single source of truth for Flow's design and current state. Auto-loaded by Claude Code at session start.

---

## What Flow is

**One sentence.** Flow is the runtime injection layer that wraps any secrets store with an IDE conversation layer — developers ask the AI to set up an integration, Flow's MCP tools provision it, and `flow-vault` (a Node `--require` preload) injects credentials into `process.env` at boot from whichever source the project is configured for.

**The core insight.** Building with AI works until the integration wall. OAuth, secrets, env config — every one of these forces the developer out of conversation, into a provider console, into copy-paste, into 20–30 minutes of context-rebuilding. Flow absorbs that interruption *without* asking the org to relocate its existing secrets.

**The architectural commitment.** Flow does not aspire to be the production secrets store. The hosted vault is a sandbox for development and small-team production; the long-term home for production credentials is whichever store the customer already operates (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, GCP Secret Manager). Flow is the injection layer on top — same `process.env.X` developer experience whichever source the project is configured for. *Verified today: hosted source in development. Expected to behave identically once non-hosted source adapters ship in v0.2 — the runtime contract is invariant, only the source-side fetch differs.*

**What Flow is NOT.** Not a competitor to existing secrets stores — Flow runs *on top* of them via source adapters (the customer keeps ownership of production secrets). Not a credentials manager UI. Not a proxy in the OAuth request path. Not a documentation tool. Flow is the *flow preservation layer* for AI-built software, plus the runtime that makes "ask the AI for an integration" produce working `process.env` reads (today: development; staging / production extend in v0.2 via source adapters).

---

## Two products, one experience

Flow ships as two product surfaces backed by the same `flow-vault` runtime. They serve different buyers and dominate in different conversations.

**1. Flow Marketplace** — the developer-facing surface (development & QA only).
- *What it does.* Provider registry the AI can pick from. Developers ask the AI to "set up X for development"; Flow stores its shared dev credentials in the project's namespace and `flow-vault` injects them at boot.
- *Buyer.* The developer. Optimizes for time-to-first-OAuth-callback.
- *Status.* ✅ Live today: **2 providers** (`google-oauth-web` for Google OAuth Web, `email_provider` backed by Resend). Stripe / Auth0 / AWS S3 / Pusher / Twilio are on the v0.2 / v0.3 roadmap and are not yet shipped — say "planned, not live" if asked.

**2. Flow Source Adapters** — the platform-facing surface (staging & production).
- *What it does.* Wraps the customer's existing secrets store (AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, GCP Secret Manager) with the same `process.env.X` developer experience used in dev. SRE configures the source via a short conversation; the result is a `.flow/integrations.json` manifest committed to the repo.
- *Buyer.* SRE / DevOps / platform lead. Optimizes for compliance posture and zero migration of existing secrets.
- *Status.* 🚧 Planned (v0.2 ships the abstraction + AWS Secrets Manager; v0.3 the rest).

Both surfaces share the `flow-vault` runtime and the `process.env`-Proxy contract. The application code does not change between them. From a developer's perspective the only thing that *should* change between dev and prod is which source adapter is configured for the environment — not the runtime, not the workflow, not the line of code that reads `process.env.GOOGLE_CLIENT_ID`. *This dev=prod parity is the design intent. Verified today only for development with the hosted source; production source adapters are v0.2 work and not yet a tested property end-to-end.*

---

## Architecture (current state — 2026-05-07)

The IDE side is the same regardless of environment: Claude Code (or any MCP-capable IDE) talks to the hosted MCP server, which provisions integrations on the developer's behalf.

```
┌────────────────────────────────────────────────────────────────────┐
│ IDE (Claude Code / Cursor / Windsurf)  +  flow plugin              │
│   .mcp.json points at https://mcp.kindtree.us/api/mcp              │
│   IDE calls flow_* MCP tools to provision integrations             │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ MCP over HTTPS (Streamable)
                               ↓
┌────────────────────────────────────────────────────────────────────┐
│ Hosted Flow service @ mcp.kindtree.us  (Vercel Functions)          │
│   /api/mcp                MCP server (mcp-handler)                 │
│   /api/vault/credentials  Hosted source adapter's read endpoint    │
│   /api/admin/*            Tenant kill-switch + telemetry           │
│   Backed by Upstash Redis KV + Vercel env (FLOW_*)                 │
└────────────────────────────────────────────────────────────────────┘
```

The runtime side has *one* component (`flow-vault`) and one or more *sources* it reads from. The source is configured per environment.

```
DEVELOPMENT (live today — only path that works)

  ┌─────────────────────────────┐
  │ User's app  +  flow-vault   │  Node --require preload
  │ Wraps process.env via Proxy │
  └──────────────┬──────────────┘
                 │ HTTPS GET (bearer = keychain session)
                 ↓
  ┌─────────────────────────────┐
  │ Hosted source adapter        │  /api/vault/credentials
  │ (Flow's shared dev sandbox)  │  Backed by Upstash Redis
  └─────────────────────────────┘


PRODUCTION (planned — v0.2 source adapter abstraction; v0.3 for the rest)

  ┌─────────────────────────────┐
  │ User's app  +  flow-vault   │  Same runtime, same Proxy
  └──────────────┬──────────────┘
                 │ source-adapter-specific call
                 │ (uses customer's IAM, NOT Flow's)
                 ↓
  ┌─── one of ──────────────────────────────────────────┐
  │ AWS Secrets Manager  (OIDC federation)  v0.2        │
  │ HashiCorp Vault      (token / AppRole)  v0.3        │
  │ Azure Key Vault      (managed identity) v0.3        │
  │ GCP Secret Manager   (workload identity) v0.3       │
  │ flow-hosted          (small-team production fallback)│
  └─────────────────────────────────────────────────────┘
```

For non-hosted production sources, **Flow's infrastructure is not on the request path** — the runtime authenticates to the customer's store using the customer's IAM and Flow never sees the credential values. *This is the design property of the source adapter pattern; non-hosted adapters are not yet shipped, so it is "expected to hold by construction" rather than "verified end-to-end."* The hosted source remains an option for development and small-team production.

**Key property.** No credentials ever sit on the user's filesystem in any architecture. `flow-vault` injects them at process startup, in memory, per process. Today only the hosted source is shipped; the source adapter abstraction lands in v0.2.

---

## Live surface (what actually works today)

| Layer | Status | Detail |
|---|---|---|
| Hosted MCP server at `mcp.kindtree.us/api/mcp` | ✅ deployed | Live tools: `flow_status_check`, `flow_check`, `flow_status`, `flow_setup_provider`, `flow_setup_oauth` (alias), `flow_setup_production` (CLI redirector — see "Production setup" section below). Authoritative list is the `server.tool(...)` registrations in `api/mcp.ts`. |
| Vault endpoint at `mcp.kindtree.us/api/vault/credentials` | ✅ deployed | GET; scopes shared dev creds to providers the project has configured; rate-limited per-IP and per-install_id |
| Upstash Redis (KV) | ✅ provisioned | State + vault entries persist across functions |
| `flow-vault@0.1.0` on npm | ✅ published | Public; `npm install --save-dev flow-vault` works for anyone |
| GitHub repo at `vivekschaudhary/flow-mcp` | ✅ public | Marketplace + runtime + server source |
| Provider registry — `google-oauth-web` (Google sign-in) | ✅ live (dev only) | Library variants for nextauth/clerk/auth0/custom; multi-port + multi-callback whitelist |
| Provider registry — `email_provider` (Resend under the hood) | ✅ live (dev only) | Sends from `onboarding@resend.dev`; shared key restricted (no verified domains on Flow's Resend account) |
| Vault endpoint rate limits | ✅ live | Per-IP: 30/min, 200/hr. Per-install_id: 5/min, 50/hr. 429 + Retry-After on cap. |
| Production credential intake (`flow_capture`, `flow_setup_provider(production)`) | 🚧 **NOT live** | v0.2 work — until then all live integrations are dev-only |
| `flow login` CLI for real auth | 🚧 **NOT live** | v0.2 work — replaces anonymous install_id model |

The `flow-vault` runtime and the MCP tool layer are both shipped end-to-end for development. What remains for v0.2 is the source adapter abstraction, the first non-hosted adapter (AWS Secrets Manager via OIDC), and production credential intake — see Roadmap below.

---

## Production setup — CLI canonical, MCP redirects

Production credential setup is a *CLI workflow*, not a chat workflow. The architectural commitment: **the flow CLI (`packages/flow-cli/`, shipping v0.2) is the canonical interface for production work; MCP, future REST API, and any other surface are wrappers around the same CLI logic.**

**Why not multi-turn MCP.** Three properties of production credential entry that a conversational MCP tool can't deliver:
- **Hidden input.** Terminal password mode keeps secret values out of scrollback and chat transcripts.
- **Shell history.** Reconstructable audit trail — who ran what, when, with which flags.
- **Scriptability.** The same setup re-runs non-interactively in CI / runbooks via `--source`, `--auth-method`, `--secret-name`, `--region`, `--skip-staging` flags.

A chat tool that asks "paste your AWS access key here" doesn't compose with any of those. So the MCP tool `flow_setup_production` does *one* thing: it returns the directive to run `flow setup production --integration <id>` in the SRE's terminal. It does not perform setup. It does not walk through prompts conversationally. It points at the CLI and stops.

**What lands when.** PR1 (this commit, 2026-05-08): the MCP tool ships as a redirector — the architectural commitment is in place even before the CLI exists. PR2 (next): `packages/flow-cli/` with the `setup production` command, AWS Secrets Manager source adapter (real), other adapters (HashiCorp Vault, Azure Key Vault, GCP Secret Manager) as stubs. PR3 (v0.3): `flow-vault` runtime resolves non-hosted source adapters at app boot.

Until the CLI ships, calling `flow_setup_production` returns a response that documents the workflow and explicitly says production setup is not yet available — the AI is instructed to fall back to `flow_setup_provider(environment="development")` for now.

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
├── plugin/                        IDE-side entry point. The .mcp.json snippet
│   │                              works in any MCP-capable client (Cursor,
│   │                              Claude Code, Windsurf, VS Code w/ Copilot).
│   │                              Claude Code additionally consumes the
│   │                              SKILL.md for auto-trigger on integration
│   │                              requests; other clients use tool descriptions.
│   ├── .claude-plugin/plugin.json   Claude Code plugin manifest (marketplace listing)
│   ├── .mcp.json                  { type: "http", url: "https://mcp.kindtree.us/api/mcp" }
│   ├── README.md
│   └── skills/flow-integrations/SKILL.md   Claude Code SKILL — auto-trigger only
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

### M2 v2 — wire the MCP tools  ✅ DONE 2026-05-03
- `flow_check`, `flow_status`, `flow_setup_oauth(development)`, and the generic `flow_setup_provider` all live in `api/mcp.ts`
- Each tool stores creds in vault via `mergeVault()` and returns text instructions for Claude to install `flow-vault` + wire `--require` into the start script
- Tenant gate (`checkTenantOrDenied`) + telemetry (`withTelemetry`) wrap every authenticated tool
- Plugin SKILL.md updated to teach Claude the install pattern
- Subsequent commits added telemetry (2026-05-03), tenant kill-switch (2026-05-04), and admin endpoints

**Next on the roadmap is the source adapter abstraction (v0.2) — see below.**

### v0.2 — flow CLI + source adapter pattern + production intake

**Architectural pivot (2026-05-08):** the v0.2 production-setup work moved from "multi-turn MCP tool" to "standalone CLI, MCP redirects." The CLI is canonical; MCP wraps it. Reasoning is in the "Production setup — CLI canonical, MCP redirects" section above. Sequencing:

- **PR1 (✅ shipped 2026-05-08)** — `flow_setup_production` MCP tool registered as a redirector. Returns the directive to run `flow setup production --integration <id>` in the SRE's terminal; does not perform setup. Architectural commitment in place before the CLI exists.
- **PR2 (in progress)** — `packages/flow-cli/`. Bin entrypoint, `setup production` command (interactive + non-interactive via flags), `status` command, `audit` / `login` stubs. SourceAdapter interface + registry. **AWS Secrets Manager** adapter (real, IAM access keys auth method). HashiCorp Vault / Azure Key Vault / GCP Secret Manager / `flow-hosted` adapters formalized; non-AWS as stubs. `.flow/integrations.json` read/write. Standard libs: `commander`, `inquirer`, `chalk`, `ora`, `@aws-sdk/client-secrets-manager`. ETA depends on review cadence; ~1 week focused.
- **PR3 (v0.3)** — `flow-vault` runtime resolves non-hosted source adapters at app boot. Until this ships, the CLI writes the manifest but the runtime can't yet honor non-hosted sources at production app boot.
- **OIDC provider infrastructure at `oidc.flow.kindtree.us`** — Flow's own OIDC issuer that mints short-lived JWTs the customer's AWS / Azure / GCP / Vault deployment can federate against (so the customer never holds long-lived Flow credentials). Includes a JWKS endpoint, signing-key rotation, issuer metadata, and per-tenant audience scoping. **~1 week of focused infrastructure work** and **gates every federated-identity production adapter** — without this we ship IAM-access-keys auth for AWS in PR2 (works but requires the SRE to manage long-lived keys); OIDC federation is the recommended path and lands after this infra.
- `flow_capture` + `flow_setup_provider(production)` for hosted-source production credential intake (the small-team-production path; orthogonal to the CLI)
- `flow login` CLI command replacing the anonymous install_id model with GitHub-OAuth-issued sessions
- `.flow/integrations.json` manifest schema (per-project, non-secret declaration of which keys come from which source — see [docs/compliance.md](docs/compliance.md))

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
- **Multi-IDE install docs** — README already documents the universal `.mcp.json` snippet for Cursor, Claude Code, Windsurf, and VS Code (Copilot w/ MCP). v1.3 polishes the per-tool walkthroughs with screenshots and verifies on each one.
- **Claude Code marketplace listing** — submit to `anthropics/claude-plugins-community` so install becomes `/plugin install flow@claude-community` (Claude Code only). Other IDEs continue to use the JSON snippet — zero-install via marketplace is a Claude Code feature, not a cross-IDE one.
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
| 1Password / Doppler / Vault | Manage YOUR existing keys | Assume you already have an account and don't host shared dev sandboxes. Flow is *additive* via source adapters — wraps these stores, doesn't replace them. |
| Stripe / Vercel / Supabase plugins | First-party "use my product from Claude" | Per-provider, manages YOUR account; Flow is multi-provider AND owns dev sandbox creds, plus has a production path through whichever store you already operate. |
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
| Distribution | Universal MCP `.mcp.json` + Claude Code plugin marketplace | Standard MCP HTTP transport so any conformant IDE can connect; per-IDE end-to-end verification varies — see "Distribution: verified vs expected" below the table. |
| Default Google scope | `openid email profile` only | Limits blast radius if shared creds ever abused |
| Production OAuth client | User-created, captured by Flow | Google blocks programmatic OAuth client creation |

**Distribution — verified vs expected**

- ✅ **Verified end-to-end:** Claude Code. SKILL.md auto-trigger, `/plugin install`, marketplace flow, and full Google-OAuth-dev → working `process.env` cycle all tested. Daily-driver IDE for this project.
- 🟡 **Expected to work, not verified:** Cursor, Windsurf, VS Code (Copilot with MCP). All speak standard MCP over HTTP; the hosted server speaks the same protocol; README documents the per-tool config path; telemetry already buckets traffic by user-agent (`cursor` / `windsurf` / `vscode`). What's missing is a recorded end-to-end run in each. Promotion to "verified" is on the v1.3 punchlist.
- ❌ **Known not to work:** AI tooling without MCP support (older Copilot configurations, ChatGPT desktop today, etc.). Flow has no offline / non-MCP path.

---

## Operational resources

- **Vercel project:** `kind-tree/flow-mcp` (`prj_2T9BlxKGKrXdPttNxaGU8vNxORM5`)
- **Custom domain:** `mcp.kindtree.us`
- **Shared GCP project:** `flow-dev-shared` (OAuth client owner — your liability for abuse, scope-limited, kill-switchable)
- **KV:** Upstash Redis (Vercel Marketplace integration)
- **Cross-IDE distribution:** universal MCP JSON snippet (in [README.md](README.md)) works in Cursor, Claude Code, Windsurf, and VS Code Copilot
- **Claude Code marketplace target:** `anthropics/claude-plugins-community` (Claude-Code-specific zero-install path, v1.3)

---

## Pitch

Every developer using AI to build software hits the same wall — the code writes itself, the integrations don't. Flow is the runtime injection layer that wraps your existing secrets store with an IDE conversation layer: ask the AI to set up an integration, and credentials appear in `process.env` at boot from whichever source you've configured — Flow's hosted sandbox in dev, your AWS / Vault / Azure / GCP store in production. Same developer experience everywhere, no migration of secrets. For non-hosted source adapters, no new credential store on the request path either.

**Status (verified vs expected).** ✅ Verified end-to-end today: hosted source for development, 2 providers (`google-oauth-web`, `email_provider`), 5 MCP tools, Claude Code IDE. 🟡 Expected to work but not yet verified end-to-end: Cursor / Windsurf / VS Code Copilot (MCP-capable, untested). 🚧 Planned (v0.2 / v0.3): non-hosted source adapters (AWS / Vault / Azure / GCP) for production, production credential intake, additional providers. The pitch describes the architecture; this line describes what is actually shipped — keep them separate when speaking to anyone who can check.

---

## Notes for Claude when this file is loaded

- The hosted MCP server's live tools are listed in the Live surface table above; the authoritative source is the `server.tool(...)` registrations in `api/mcp.ts` (do not rely on a hardcoded tool count anywhere in this file). Use `flow_setup_provider` for new dev provider setup; `flow_setup_oauth` is a backward-compat alias for the Google OAuth case; `flow_setup_production` is a redirector to the CLI.
- `flow_capture`, `flow_sync`, `flow_setup`, and `flow_setup_provider(production)` are NOT live (v0.2 / deprecated) — calling them returns "method not found" or "coming soon". `flow_setup_production` IS live but is a redirector to the CLI; it never performs setup, only returns the directive to run `flow setup production` in the terminal.
- The `flow-vault` runtime is on npm and verified end-to-end against **one real app to date — `swing-trading-signals`** (Google OAuth dev → working `process.env.GOOGLE_CLIENT_ID` in a Next.js app). Coverage broadens as additional installs land through v0.2 (early-access friends-of-Vivek). Today the runtime is hard-wired to the hosted source adapter; the pluggable adapter interface lands in v0.2. *In external-facing docs (README, marketing), keep this anonymized as "one Next.js app" — `swing-trading-signals` is internal-only until we decide on a public reference.*
- Adding a new provider = one entry in `src/lib/providers.ts` + a `FLOW_<...>_*` env var on Vercel. No new MCP tool required.
- **Buyer-aware framing.** When pitching Flow to a developer, lead with the marketplace surface — ask the AI for an integration, ship in dev today (2 providers live: `google-oauth-web`, `email_provider`; more on the v0.2 / v0.3 roadmap). When pitching to an engineering leader, SRE, or platform owner, lead with source adapters — wraps your existing store, compliance manifest committed to the repo, no migration. Same product underneath, different framing for different buyers. Never overstate what's live: 2 providers + 1 source adapter (hosted) is the truth, anything beyond that is roadmap.
- **Verified vs expected.** When describing Flow's capabilities, distinguish *verified* (tested end-to-end — e.g. Google OAuth setup in Claude Code resulting in a working `process.env.GOOGLE_CLIENT_ID` in a real Next.js app) from *expected to work* (architecture / protocol support it but no end-to-end test on record — e.g. the same flow in Cursor or Windsurf, or non-hosted source adapters in production). Never collapse the two into a flat capability claim. If you don't know which bucket something belongs in, say so explicitly rather than picking the more flattering one.
- Never echo any credential VALUE into chat (Google client_secret, Resend API key, anything captured from a user's downloaded JSON). Reference by variable name only. The vault endpoint returns values in plaintext by design — be careful when curl-testing it; pipe through a presence-check, not a pretty-printer.
- Per-project credentials (production) belong to the user; Flow only orchestrates capture + vault storage. Production intake is v0.2.
