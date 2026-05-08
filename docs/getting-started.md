# Getting started with Flow

A walkthrough for a developer who's never seen Flow. Real example, end to end, no skipped steps.

## The problem

Three scenarios that have happened to every developer building an AI-assisted app:

**Scenario 1.** You're 90 minutes into building a SaaS with Claude. You ask it to add Google sign-in. It tells you to open Google Cloud Console, create an OAuth client, configure the consent screen, add redirect URIs. You go do it. By the time you're back at your editor, you've forgotten what you were originally building.

**Scenario 2.** You're debugging an OAuth flow. You paste a snippet of your `.env` into Claude to ask "why isn't this working?" The chat history now contains your client secret. You realize three days later when reviewing logs.

**Scenario 3.** You commit your `.env` accidentally because `.gitignore` only had `.env.local` not `.env`. The repo is public for a week before you notice. GitHub's secret scanner catches it. Google revokes the OAuth client. You spend an afternoon rebuilding it.

Flow's goal: none of those three happen.

## What Flow does

Flow holds credentials on its hosted vault. A small Node preload (`flow-vault`) fetches them into your process at boot. Your app reads `process.env.GOOGLE_CLIENT_ID` like normal. The value is never written to a file, never visible in chat, never near `git`.

Two parts to the install:

- **A Claude Code plugin** that tells Claude how to provision integrations and store creds in your vault.
- **A runtime preload** (`flow-vault`) that injects creds into your app's `process.env` at boot.

You install both once. Each new integration after that is one sentence to Claude.

## Status — what works today vs what's coming

This walkthrough describes the *target* developer experience. The vault and runtime are live; the Claude Code plugin's MCP tools that auto-install flow-vault and store creds in vault are the next milestone (M2). Today you can do the runtime install manually — see "Manual setup" below.

## Install Flow (target — when M2 ships)

```bash
flow login
```

Opens a browser. You sign in with GitHub. Flow stores a session token in your OS keychain. Done — once per machine.

In Claude Code:

```
/plugin install flow@claude-community
```

Plugin appears in `/mcp`. From now on Claude knows about Flow.

## Manual setup (when you want to test flow-vault directly without Claude)

```bash
# 1. Install flow-vault as a dev dependency
npm install --save-dev flow-vault

# 2. Wrap your dev script
# package.json:
"scripts": {
  "dev:flow": "NODE_OPTIONS='--require=flow-vault' vercel dev"
}

# 3. Store a session manually (any string for the v1 anonymous model)
node -e "require('flow-vault/keychain').storeSession('your-machine-id')"
```

That's the entire setup if you want to use the runtime without the Claude Code plugin. With the plugin installed, Claude does steps 1 and 2 for you when you ask for an integration.

## Your first integration

In Claude Code (with Flow plugin installed):

```
You: Set up Google OAuth for development.
```

What Claude does, step by step:

1. Calls `flow_check` to see what's already configured (nothing yet).
2. Calls `flow_setup_oauth(environment: "development")`. Flow's hosted server stores Google's shared dev credentials in your project's vault entry under `vault:<your-install>:<your-project>:development`.
3. Reads back: "OK, dev creds are in the vault. Your app needs `flow-vault` loaded at startup. I'll handle that."
4. Runs `npm install --save-dev flow-vault` in your project.
5. Edits your `package.json` to wrap your dev script with `--require=flow-vault`.
6. Tells you: "Done. Restart your dev server and try the Google login flow."

What you do: restart your dev server (Ctrl-C, `npm run dev:flow`), trigger the Google login on your app. Works. Your `.env` has no Google credentials in it.

What's NOT in your terminal output, your chat, your codebase:
- The actual `client_id` value
- The actual `client_secret` value
- A `client_secret_*.json` file in `~/Downloads` you need to remember to delete
- An `.env` line that needs gitignoring

## Check what's configured

```
You: What integrations does Flow have set up for this project?
```

Claude calls `flow_status`, returns a summary:

```
swing-trading-signals (development):
  ✓ google-oauth-web   configured 2 minutes ago
```

Or as a CLI (planned):

```bash
flow status
```

## Production setup

Production has a different question: where should your real credentials *live*?

Flow does not require you to relocate them. The `flow-vault` runtime takes a *source adapter* — a small module that authenticates to a secrets store and returns the credential map. Same Proxy, same `process.env.X`, same application code as in development. The only thing that changes is which source the adapter points at.

### The source choice — one short conversation with whoever owns secrets

Before you flip a project to production, the AI walks through three questions. The answers come from whoever owns secrets in your org (you, if you're solo; SRE / platform team, if you're not).

> **1. Where do production credentials live today?**
> AWS Secrets Manager, HashiCorp Vault, Azure Key Vault, GCP Secret Manager, a homegrown system, or "nowhere yet — we just use platform env vars."
>
> **2. How does compute authenticate to that store?**
> OIDC federation, IAM role, service account, Vault token, managed identity, etc. We want the *existing* answer here — Flow inherits it, doesn't replace it.
>
> **3. Which environments need scoping?**
> Typically `production` and `preview` (or `staging`). The adapter passes the detected environment to the store so each environment resolves to a separate scope / path / namespace.

The output of this conversation is one file in your repo: `.flow/integrations.json`. It lists which keys each project requests and which source adapter resolves them. **No secret values.** Just shape — the same shape your AI tools already see when reasoning about the project.

```jsonc
{
  "project": "swing-trading-signals",
  "environments": {
    "development": {
      "source": "flow-hosted",
      "integrations": ["google-oauth-web", "email_provider"]
    },
    "production": {
      "source": "aws-secrets-manager",
      "config": {
        "auth": "oidc",
        "region": "us-east-1",
        "secret_path_prefix": "prod/swing-trading-signals/"
      },
      "integrations": ["google-oauth-web", "email_provider", "payments_provider"]
    }
  }
}
```

This file is the compliance artifact: it's in version control, every change is a PR, and an auditor can read it without grepping code. Detail at [docs/compliance.md](./compliance.md).

### Today vs the target

The `flow-hosted` source adapter is the only one shipped today. The AWS / Vault / Azure / GCP adapters and the manifest-driven config are v0.2 work. If you need production *right now* and you're a small team, the hosted source can hold your production credentials too — same trust model as the dev sandbox, scoped per install + project + `production`. The path forward is the same regardless: when an external source adapter ships for your store, change one field in the manifest, redeploy, and your app code doesn't move.

### What happens at runtime

The runtime resolves the source per environment. In production, on app boot:

1. flow-vault detects the environment (`VERCEL_ENV` / `NODE_ENV` / default `development`).
2. Reads `.flow/integrations.json` to find the source adapter for that environment.
3. The adapter authenticates to the configured store using whatever IAM your compute already has — Flow does not introduce a new identity.
4. Adapter returns the credential map. Runtime wraps `process.env`. Your app reads `process.env.GOOGLE_CLIENT_ID` and the value is there.

When you use a non-hosted source: **Flow's infrastructure is not on the request path in production.** Your compute talks directly to your secrets store; Flow ships the runtime that authenticates and injects.

## Common questions

**Does Flow work with my framework?**
Yes — the runtime is framework-agnostic. Anywhere you can wrap Node startup with `--require` (Next.js, Express, Fastify, NestJS, Hono, raw Node, ts-node), Flow works. For Vercel functions, set `NODE_OPTIONS='--require=flow-vault'` in the project env vars or wrap `vercel dev` locally.

**Does Flow work in CI/CD?**
Partially. CI/CD environments don't have your OS keychain, so the session-token model doesn't apply directly. For now, set the underlying credential values as CI env vars (Flow's Proxy yields to non-empty values). Long-term: a `FLOW_SESSION` env var that the runtime falls back to when keychain is unavailable.

**What if I already have my own keys?**
Set them in `.env` (or your platform's env vars). Flow's Proxy returns the developer's value before consulting the vault. You can mix-and-match: Stripe creds from Flow, your own custom API key from your own env. Flow only fills the empty slots.

**Does Flow work in production?**
Yes. The same `flow-vault` preload runs in your deployed function/server. The production environment uses whichever source adapter you've configured in `.flow/integrations.json` — the hosted source today, or your own AWS / Vault / Azure / GCP store once those adapters ship in v0.2 / v0.3. The shared dev creds are never returned for `env=production` — that's an explicit guardrail in the hosted source.

**What if Flow goes down?**
Your app boots normally. The preload prints one warning to stderr and skips the wrap. Reads of `process.env.GOOGLE_CLIENT_ID` return whatever's in your real env (likely undefined for vault-managed keys). Your auth flow returns "not configured" until Flow is back. **Flow is a soft dependency by design.**

**Where does Flow store my production credentials?**
Wherever you point the source adapter. With the hosted source: in Flow's KV (Upstash Redis behind Vercel-managed networking), scoped to your install + project + `production`, accessed only via the vault endpoint with bearer auth. With a non-hosted source (AWS / Vault / Azure / GCP, planned v0.2+): **Flow never sees the values** — the runtime authenticates to your store using your IAM, fetches directly, and injects in-memory. Either way no credential touches your filesystem. See [packages/flow-vault/SECURITY.md](../packages/flow-vault/SECURITY.md) for the threat model and [docs/source-adapters.md](./source-adapters.md) for adapter-specific detail.

**What does it cost?**
Free during pre-release. Pricing TBD post-launch — likely free tier per developer, paid for organizations and high-volume use.

## Where to next

- Source adapter pattern (the architectural backbone): [docs/source-adapters.md](./source-adapters.md)
- Compliance manifest (`.flow/integrations.json` as audit artifact): [docs/compliance.md](./compliance.md)
- Full security model: [packages/flow-vault/SECURITY.md](../packages/flow-vault/SECURITY.md)
- Playbook reference: [docs/playbooks.md](./playbooks.md)
- Runtime details: [packages/flow-vault/README.md](../packages/flow-vault/README.md)
- Architecture: [CLAUDE.md](../CLAUDE.md) (also the Claude Code project memory)
