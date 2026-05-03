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

## Manual setup (today, until M2 ships)

```bash
# 1. Install flow-vault as a dev dependency
npm install --save-dev file:/path/to/flow-mcp/packages/flow-vault

# 2. Wrap your dev script
# package.json:
"scripts": {
  "dev:flow": "NODE_OPTIONS='--require=flow-vault' vercel dev"
}

# 3. Store a session manually (any string for the v1 anonymous model)
node -e "require('flow-vault/keychain').storeSession('your-machine-id')"
```

That's the entire setup. No global tools, no `flow login` yet, no Claude plugin needed if you just want to test the runtime.

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

When you're ready to deploy:

```
You: Set up Google OAuth for production.
```

What Claude does:

1. Calls `flow_setup_oauth(environment: "production")`. Flow returns a deep link to GCP console pre-filled with everything: project name, redirect URIs (your prod domain, captured from your `vercel.json`), the right OAuth client type.
2. You click the link, click through the console (one visit, ~3 minutes), download the `client_secret_*.json`.
3. You tell Claude where it is. Claude reads it (via its built-in Read tool) and calls `flow_capture(json_content="...")`.
4. Flow extracts the `client_id` and `client_secret`, stores them in vault under `vault:<your-install>:<your-project>:production`.
5. Claude tells you to delete the JSON from `~/Downloads`.

That's the only console visit, ever. Future credential rotation: Flow stores the new values; your deployed app picks them up on next deploy or function invocation.

## Common questions

**Does Flow work with my framework?**
Yes — the runtime is framework-agnostic. Anywhere you can wrap Node startup with `--require` (Next.js, Express, Fastify, NestJS, Hono, raw Node, ts-node), Flow works. For Vercel functions, set `NODE_OPTIONS='--require=flow-vault'` in the project env vars or wrap `vercel dev` locally.

**Does Flow work in CI/CD?**
Partially. CI/CD environments don't have your OS keychain, so the session-token model doesn't apply directly. For now, set the underlying credential values as CI env vars (Flow's Proxy yields to non-empty values). Long-term: a `FLOW_SESSION` env var that the runtime falls back to when keychain is unavailable.

**What if I already have my own keys?**
Set them in `.env` (or your platform's env vars). Flow's Proxy returns the developer's value before consulting the vault. You can mix-and-match: Stripe creds from Flow, your own custom API key from your own env. Flow only fills the empty slots.

**Does Flow work in production?**
Yes. The same `flow-vault` preload runs in your deployed function/server. The production environment fetches your stored production creds from the vault, scoped to your install + project + `production`. The shared dev creds are never returned for `env=production` — that's an explicit guardrail.

**What if Flow goes down?**
Your app boots normally. The preload prints one warning to stderr and skips the wrap. Reads of `process.env.GOOGLE_CLIENT_ID` return whatever's in your real env (likely undefined for vault-managed keys). Your auth flow returns "not configured" until Flow is back. **Flow is a soft dependency by design.**

**Where does Flow store my production credentials?**
Upstash Redis, behind Vercel-managed networking, accessed only via the vault endpoint with bearer auth. Your install token is the only key to your stored creds. See [packages/flow-vault/SECURITY.md](../packages/flow-vault/SECURITY.md) for the full threat model.

**What does it cost?**
Free during pre-release. Pricing TBD post-launch — likely free tier per developer, paid for organizations and high-volume use.

## Where to next

- Full security model: [packages/flow-vault/SECURITY.md](../packages/flow-vault/SECURITY.md)
- Playbook reference: [docs/playbooks.md](./playbooks.md)
- Runtime details: [packages/flow-vault/README.md](../packages/flow-vault/README.md)
- Architecture: [CLAUDE.md](../CLAUDE.md) (also the Claude Code project memory)
