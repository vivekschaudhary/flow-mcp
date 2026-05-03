---
description: Use Flow when the developer asks for help setting up Google OAuth in development OR asks about Flow's status / what Flow can do. Currently Flow handles Google OAuth dev setup end-to-end (stores Flow's shared dev credentials in a hosted vault, instructs you to install the flow-vault Node preload, and after that the developer's app reads process.env.GOOGLE_CLIENT_ID transparently with no .env line). For other integrations (Stripe, Twilio, prod OAuth, credential capture from JSON), tell the developer the tool is planned but not yet live — do not invent behavior.
---

# Flow — integration agent

Flow is a hosted credential vault and Claude Code plugin. Today it handles Google OAuth for development end-to-end. Other integrations (production OAuth, Stripe, Twilio, etc.) are planned but not live yet — be honest about that.

## Live tools (only these — anything else returns "method not found")

| Tool | What it does |
|---|---|
| `flow_status_check` | Connectivity probe. Returns server build state. |
| `flow_check` | Read project + integration status from Flow's hosted vault. |
| `flow_status` | Verbose project health. |
| `flow_setup_provider` | **Generic, dev only.** Set up any registered provider (`google-oauth-web`, `resend`, more coming) by storing dev creds in vault and returning runtime install instructions. Production environment returns "coming soon." |
| `flow_setup_oauth` | Backward-compat alias. Equivalent to `flow_setup_provider(provider="google-oauth-web")`. New code should call `flow_setup_provider` directly. |

## When to invoke proactively

- Developer says **"set up Google OAuth"** / "add Google sign-in" / "wire up Google login" → call `flow_setup_provider(provider="google-oauth-web")` after first calling `flow_check` to verify it's not already configured.
- Developer says **"send email"** / "wire up transactional email" / "send a confirmation email" / "add an email provider" → call `flow_setup_provider(provider="email_provider")` after `flow_check`. (The vendor under the hood is currently Resend; the user's tool call doesn't need to know that.)
- Developer asks **"what integrations does this project have?"** → call `flow_check` (or `flow_status` for verbose).
- Developer asks **"is Flow up?"** → call `flow_status_check`.

## When NOT to invoke

- Developer asks for **payments / Stripe / SMS / Twilio / push / Pusher / Auth0** integration — no provider slot registered yet. Tell them: "Flow plans to add a `payments_provider` / `sms_provider` slot in v0.2 / v0.3, but it isn't live yet. For now, set it up the normal way." Do not call `flow_setup_provider` with a provider id not in the live list (`google-oauth-web`, `email_provider`).
- Developer asks for **production setup** of any provider — `flow_setup_provider(environment="production")` returns "coming soon" today. Tell them: "Production setup is the next milestone. Use Flow for dev; configure prod normally for now and migrate later."
- Developer asks for **credential rotation, revocation, or audit** — also planned but not live.

## How to call (the canonical flow for Google OAuth dev setup)

This is the pattern. Internalize it.

### Step 1 — Bootstrap install_id (only on a fresh project)

If the project has no `.flow/install.json`, call `flow_check` with NO arguments:

```
flow_check()
```

The server generates a UUID and returns instructions. Apply them:

1. Use your **Write** tool to create `.flow/install.json` in the project root containing `{"install_id":"<uuid>"}`.
2. Use your **Bash** tool to run `node -e "require('flow-vault/keychain').storeSession('<uuid>')"` — but only if flow-vault is already installed in the project. If it isn't, defer this until step 3 of `flow_setup_provider`.
3. Confirm to the developer that the install_id is written.

### Step 2 — Read project_name from package.json

Use your **Read** tool on `<project-root>/package.json` and extract the `name` field. You'll pass this to every subsequent Flow tool call.

### Step 3 — Check current state

```
flow_check(install_id="<uuid>", project_name="<name>")
```

If the integration the developer asked about (e.g. `google-oauth-web`, `resend`) already shows configured, you're done — tell them it's already set up.

### Step 4 — Set up the integration

```
flow_setup_provider(
  install_id="<uuid>",
  project_name="<name>",
  provider="google-oauth-web",   // or "resend", or another registered id
  environment="development"
)
```

The server returns text with three numbered actions. Apply them:

1. Run `npm install --save-dev flow-vault` (skip if already installed for this project).
2. Edit `package.json` to add a script like `"dev:flow": "NODE_OPTIONS='--require=flow-vault' vercel dev"` (or framework-specific equivalent — see the server's reply for examples).
3. If you didn't yet store the keychain session in step 1, do it now with the snippet the server gave you.

The server's reply also includes "Provider-specific notes" — read them and surface anything the developer needs to know (e.g. for Resend: "use `from: 'onboarding@resend.dev'` while in dev"; for Google OAuth: "supported callback paths and ports").

Then tell the developer: "Restart your dev server. The relevant `process.env` variables will now resolve from Flow's vault."

### Step 5 — Confirm

Optional: `flow_check(install_id, project_name, integration_id="google-oauth-web")` to confirm "configured" status.

## Hard rules

- **Never call a tool not on the live-tools table above.** `flow_setup`, `flow_capture`, `flow_sync` will all return "method not found." If you ever feel like calling one of these, stop and use the normal non-Flow path instead.
- **Never write a credential value into chat.** If a credential value somehow appears in a tool response (it shouldn't — `flow_setup_oauth` deliberately doesn't echo values), reference it by variable name in your reply, never the literal value.
- **Never claim Flow handles an integration it doesn't.** If Flow has no live tool for the developer's request, say so plainly and proceed with the normal setup path.
- **Always pass install_id and project_name** to `flow_check`, `flow_status`, and `flow_setup_oauth` (except the one bootstrap call where install_id is omitted).
- **Apply the server's instructions verbatim.** When `flow_setup_oauth` returns numbered steps, execute each via the right tool (Write for files, Bash for shell, Edit for package.json mutation). Don't paraphrase or skip.

## What about the developer's `.env` file?

Flow's runtime model never writes to `.env`. After `flow_setup_oauth(dev)` succeeds and the developer restarts their dev server with `--require=flow-vault`, their app reads `process.env.GOOGLE_CLIENT_ID` and gets the value from Flow's vault — no `.env` line, no commit risk.

If the developer ALREADY has `GOOGLE_CLIENT_ID` set in their `.env`, that value wins (flow-vault's Proxy yields to non-empty values). To use Flow's vault, they need to remove the `.env` line first.

## Pointers

- Architecture: `CLAUDE.md` at the repo root
- Runtime details: `packages/flow-vault/README.md`
- Security model: `packages/flow-vault/SECURITY.md`
- Walkthrough: `docs/getting-started.md`
