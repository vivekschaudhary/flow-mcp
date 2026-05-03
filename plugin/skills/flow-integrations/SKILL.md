---
description: Use Flow ONLY when the developer explicitly asks about Flow itself (status, capabilities, "is Flow available", "what does Flow do") OR when they ask about flow-vault, hosted credential vaults, or the credential-injection runtime model. DO NOT auto-invoke for general "set up Google OAuth" / "add Stripe" requests — Flow's integration tools are pre-release and the only live MCP tool today is a status probe. Until the real tools ship, treat Flow as a project the developer is building, not a tool you can use to set up integrations.
---

# Flow — pre-release status

Flow is a hosted credential vault and Claude Code plugin under active development. The architecture is in place but the MCP tool surface that lets Claude write credentials into the vault on the developer's behalf is **not yet live**. Until it ships, this skill exists primarily to answer questions about Flow honestly, not to drive integration workflows.

## What's actually live today (1 tool)

| Tool | What it does | Use when |
|---|---|---|
| `flow_status_check` | Confirms the Flow hosted service is reachable. Returns a static "Flow is being built — full tool surface coming soon" message. | Developer asks "is Flow up?" or "does Flow work?" — call this and report what it returns. |

## What is NOT live (do not promise these)

These tool names appear throughout Flow's documentation and roadmap. They are **not callable** today. If you call them, the MCP server returns "method not found."

- `flow_check` — planned (M2)
- `flow_setup_oauth(development | production)` — planned (M2 / M2.5)
- `flow_capture` — planned (M2.5)
- `flow_sync` — planned (M2.5)
- `flow_status` — planned (M2)
- `flow_setup` (generic playbook walkthrough) — planned (M3)

## When this skill SHOULD be invoked

- Developer asks **"what is Flow?"** / "what does Flow do?" / "is Flow ready?" → call `flow_status_check`, share its response, then describe Flow's intended architecture (hosted vault + flow-vault runtime + Claude Code plugin) in plain terms. Point at `CLAUDE.md` or `README.md` for full context if they want detail.
- Developer asks about **flow-vault** (the npm runtime package) → describe what it is and link to `packages/flow-vault/README.md`. The runtime is real and works; the *MCP tool layer* is what's pre-release.
- Developer asks **"can I use Flow to set up Google OAuth?"** → answer honestly: "Flow's hosted vault and runtime are working, but the MCP tool that wires them up to Claude's setup workflow isn't shipped yet. For now, you'd set up OAuth the normal way; once Flow's M2 tools ship, the same project will get the credential-injection benefits without the manual setup."

## When this skill should NOT be invoked

- Developer says **"set up Google OAuth"** / "add Stripe" / "wire up authentication" — DO NOT call any Flow tool. Flow can't do this yet. Use the normal approach (guide them through the provider's console, write env vars, etc.). Mention Flow only if the developer specifically asks about it.
- Developer asks about credential management generally — do not pretend Flow handles their existing credential management problem today. It's the goal; it's not the current state.

## Hard rules (always)

- **Never claim to call a Flow tool that isn't `flow_status_check`.** Other names will return errors.
- **Never write a credential value into chat.** If you ever encounter actual credential values (during normal OAuth setup work, not Flow), refer to them by variable name — `GOOGLE_CLIENT_ID` — never print the value.
- **Don't oversell Flow.** If the developer's expectation is that Flow will handle their integration today, correct it gently. The runtime works; the AI-driven setup is pre-release.
- **Distinguish "Flow the project" from "Flow the working product."** The architecture exists; the developer-facing automation is partial.

## Pointers if the developer wants to dig in

- Architecture and current state: `CLAUDE.md` at the project root
- Runtime package details: `packages/flow-vault/README.md`
- Security model: `packages/flow-vault/SECURITY.md`
- Walkthrough: `docs/getting-started.md`
- Playbook design: `docs/playbooks.md`

## What to do when the M2 tools ship

This SKILL.md gets rewritten. Trigger conditions expand to cover OAuth/payments/notifications proactively. The "do not invoke for X" section shrinks. Until then, restraint is the right move — a plugin that lies about what it can do hurts adoption more than one that's clear about being early.
