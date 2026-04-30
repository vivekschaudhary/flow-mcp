# Flow — Build Context
> Carry this into any Claude conversation to resume exactly where we left off.

---

## What Flow Is

**One sentence:** Flow is an MCP server that Claude calls to handle integrations silently — so developers never leave their flow state while building with AI.

**The core insight:** When Claude hits an integration wall (OAuth, API keys, env vars), the developer has to stop. Getting back into flow state takes 20-30 minutes. Flow absorbs that interruption. Claude calls Flow, credentials appear, building continues.

**What Flow is NOT:** A credential manager, a documentation tool, or a proxy. It is a flow preservation layer.

---

## Current Architecture

Flow ships as a **hosted MCP service** at `https://mcp.kindtree.us/api/mcp`,
distributed as a Claude Code plugin. The plugin's `.mcp.json` is a thin
pointer at the hosted URL — no npm install, no local Node process, no
configuration on the developer's machine.

### MCP Tools (what Claude calls — Milestone 2 surface)
```
flow_check          Check integration status for a project
flow_setup          Run a playbook to configure an integration
flow_capture        Extract credentials from downloaded JSON file
flow_sync           Push credentials to all environments
flow_status         Full project integration health
flow_setup_oauth    Set up Google OAuth (dev = instant, prod = guided)
```

**Milestone state (2026-04):** the hosted server currently exposes a single
stub tool `flow_status_check` that confirms connectivity. Real tools above
are being ported from the v0 stdio server (kept in `src/lib`, `src/tools`)
into the hosted entry. Each tool changes from "write to user's filesystem
directly" to "return `{ write_files, run_commands }` for Claude to apply
via its built-in Edit/Write/Bash tools."

### Key Files
```
api/mcp.ts                    Hosted MCP entry (Vercel Function via mcp-handler)
vercel.json                   Vercel function config
src/lib/state.ts              Project state utilities (FS-based today; will be
                              swapped for KV-backed when ported to hosted)
src/lib/env.ts                .env reader/writer + Vercel sync logic
src/lib/playbook.ts           Playbook loader and formatter
src/tools/oauth-setup.ts      Google OAuth dev + prod setup logic
src/playbooks/
  google-oauth-web.json       v1.0.0 — verified live
plugin/                       Marketplace plugin (points at mcp.kindtree.us)
plugin/.mcp.json              { type: "http", url: "https://mcp.kindtree.us/api/mcp" }
plugin/skills/flow-integrations/SKILL.md
.claude-plugin/marketplace.json
```

### Install experience (target)
```
/plugin install flow@claude-community
   → Browser opens, GitHub login (when auth ships)
   → MCP server registers automatically
   → Claude has Flow's tools in every project
```

---

## Google OAuth — Current Approach

### Development (multi-port direct-inject)
- Flow uses its OWN shared Google OAuth app (flow-dev-shared GCP project)
- The shared OAuth client registers a generous set of `localhost:<port>` URIs
  across two callback path conventions:
    - `/api/auth/google/callback`  — custom-style
    - `/api/auth/callback/google`  — NextAuth / Clerk-style
- Registered ports: 3000–3005, 4000, 4200, 5000, 5001, 5173–5175, 8000, 8080,
  8081, 8888, 9000  (≈ 18 common dev ports × 2 paths). Plus reserved
  fallbacks 47823, 51234 for projects with non-standard ports.
- `flow_setup_oauth("development")` flow:
    1. Read user's natural port + callback path from project config
    2. If callback path isn't registered → fail loudly with the two valid paths
    3. If port is in the registered list → leave dev server alone
    4. Else → write `PORT=47823` into the env file and tell the user to restart
    5. Pre-flight check that the chosen port is free; abort if not
    6. Write `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (and `PORT` only when
       forced) into the user's dev env file (`.env` or `.env.local`, per
       `state.dev_env_file`)
- No proxy, no babysat process, no library-specific token forwarding

### Production  
- One console visit required (Google API does not allow programmatic OAuth client creation)
- Flow generates pre-filled instructions with exact values
- Downloads folder watcher detects JSON the moment it lands
- Credentials captured + synced to Vercel automatically
- Developer never touches keys again

### Why not a proxy
- Earlier attempt (`src/proxy.ts`, deprecated) ran an Express server on 9999
  to intercept Google's callback. Adds a process to manage, in-memory
  session state, and library-specific token-forwarding logic. Also leaks
  Flow's URL into the user's source code. Not worth the complexity vs. just
  registering more URIs in Google.

### Why not a single pinned port
- Considered pinning everything to one port (e.g. 9999). Rejected because
  9999 is itself a common tooling port and forcing every project off its
  natural dev port is more invasive than registering a few dozen URIs.

### Why not fully automated
- Google blocks programmatic OAuth client creation for general web apps (IAP only)
- Client secrets only visible once at console creation time — cannot be retrieved via API
- Playwright automation considered but fragile (Google changes UI constantly)

---

## Flow's Shared Dev Credentials

```bash
# These live in your shell profile (~/.zshrc)
FLOW_GOOGLE_CLIENT_ID=your-client-id
FLOW_GOOGLE_CLIENT_SECRET=your-client-secret

# Registered in GCP project: flow-dev-shared
# Redirect URI registered: http://localhost:9999/flow/callback/google
# Supports ports: 3000, 3001, 3002, 3003, 3004, 3005, 8000, 8080
```

---

## Stack Detection (logic from v0; ports forward to Milestone 2)

The detection heuristics from the v0 CLI live in `src/lib/state.ts` /
`src/tools/oauth-setup.ts` and will move into the hosted server's
`flow_check` / `flow_setup_oauth` tools when those are ported. The set
of stacks recognized:
```
Frontend:   nextjs, react, vue, svelte
Backend:    express, fastify, koa, node (fallback)
Auth:       clerk, nextauth, passport
Databases:  supabase, postgres, mongodb, prisma
Services:   stripe, resend, sendgrid, twilio, openai, anthropic
```

In the hosted model, the actual `package.json` content is read by Claude
locally and passed into the tool call — the hosted server does the
classification and returns the result.

---

## Running Flow Locally (development)

```bash
cd /Users/vivekchaudhary/apps/flow-mcp
vercel dev          # boots api/mcp.ts at http://localhost:3000/api/mcp
```

Point a Claude Code MCP client at `http://localhost:3000/api/mcp` (e.g.
add it to a project's `.mcp.json` as `{ type: "http", url: ... }`) to
exercise the hosted entry without deploying. Promote with `vercel --prod`
when changes are good.

---

## What We Validated Today (end-to-end test on swing-trading)

1. `flow_check` fired correctly — Claude called it automatically
2. `flow_setup` returned correct playbook with all warnings
3. Detected port 3002 (not default 3000) ✓
4. Detected custom auth library (not nextauth) ✓  
5. `flow_capture` read downloaded JSON — found wrong project credentials ✓
6. Flagged security issue: secret pasted in chat history ✓
7. Flagged `env copy.local` not covered by .gitignore (live secrets exposed) ✓
8. Held code writing until flow_capture confirmed credentials ✓

---

## What Broke / Gaps Found

```
Gap 1    Port detection assumes 3000 — needs to read dev server config (CLOSED — multi-port whitelist + fallback)
Gap 2    Auth library detection missed custom auth patterns
Gap 3    Claude wrote code before credentials were captured (fixed via CLAUDE.md rule)
Gap 4    Stack detection missed plain Node / backend-only projects (fixed in v4)
Gap 5    .mcp.json not created by flow init automatically (fixed in v4)
Gap 6    Flow shared credentials need to be in .mcp.json env block
         (so developer doesn't need env vars in shell)
```

---

## Build Order (what's next)

### Immediate (finish v1)
1. **Test v4 on swing-trading** — verify stack detects as `node, postgres`
2. **Test flow_setup_oauth** — verify credentials inject into .env.local silently
3. **Verify Claude calls flow tools** — not manual steps

### v1.1 — Credential lifecycle
```
flow_rotate     Rotate credentials before expiry
flow_revoke     Revoke when developer leaves team
flow_audit      Show what credentials exist, where, expiry
```

### v1.2 — More playbooks
```
Priority 1:  AWS S3 (file uploads only — narrow scope)
Priority 2:  Stripe + Webhooks (webhook setup is the real pain)  
Priority 3:  Auth0 (25% of repos, more complex than Google OAuth)
Priority 4:  Pusher (16% of repos, zero tooling exists)
```

### v1.3 — Distribution
```
List the plugin in anthropics/claude-plugins-community
Install command: /plugin install flow@claude-community
Hosted MCP server at mcp.kindtree.us (later mcp.flow.dev)
Shared dev credentials live server-side, never on user disk
Build flow.dev microsite
  One page, one command, one 60-second demo
```

### v2 — Dev proxy (zero console ever)
```
flow auth google    One-time Google account authorization
                    Stores session for console automation
                    OR: Playwright fills console form silently
                    Captures secret from DOM at creation moment
```

### v3 — Agent credential broker
```
Scoped JIT credentials for AI agents
Auto-revoke on task completion  
Full audit trail per task
flow issues → agent uses → flow revokes
```

---

## Competitive Landscape

```
CyberArk / Strata    Enterprise IAM — right problem, wrong buyer
                     Too complex, too expensive for developers

Cloudflare           Infrastructure layer — not developer-native
                     Requires significant setup

Nango / Composio     B2B product integrations
                     YOUR app ↔ CUSTOMER'S Salesforce
                     Different problem entirely

Nobody               Developer-native credential lifecycle
                     for the MCP era
                     This is Flow's position
```

---

## GitHub Research Results (1000 repos, 5+ stars)

```
Rank  Integration     % of repos
1     AWS S3          31%
2     AWS General     28%   (combined ~45%)
3     Auth0           25%
4     OpenAI          25%
5     Google OAuth    25%
6     Stripe          22%
7     Pusher          16%
8     GitHub OAuth    13%
9     Sentry          13%
10    Anthropic        9%
```

---

## Key Decisions Made

| Decision | Choice | Reason |
|---|---|---|
| Proxy vs direct inject | Direct inject | No running process to manage |
| Google API vs console | Console (one visit) | Google blocks programmatic creation |
| Playwright vs manual | Manual for now | Too fragile, Google changes UI |
| Shared dev creds | Flow owns them | Clerk model — developer never sees keys |
| npm package name | flow-mcp | Simple, descriptive |
| Distribution | Claude Code plugin (hosted MCP) | Zero install friction, no creds shipped to user |
| Playbook freshness | Google Developer Knowledge MCP | Query Google's own docs for changes |

---

## Files Location

```
Flow MCP server:    /Users/vivekchaudhary/apps/flow-mcp/
Google OAuth app:   GCP project flow-dev-shared
Shared creds:       ~/.zshrc (FLOW_GOOGLE_CLIENT_ID, FLOW_GOOGLE_CLIENT_SECRET)
Research script:    /Users/vivekchaudhary/apps/flow/flow_research.py
Investor deck:      Flow-Investor-OnePager.docx (downloaded)
```

---

## The Pitch (3 sentences)

Every developer using AI to build software hits the same wall. The code writes itself. The integrations don't. Flow is the MCP agent Claude calls so developers never have to leave their conversation to set up OAuth, configure notifications, or juggle credentials across environments again.

---

## What to Say to Resume

Paste this file into Claude and say:

> "I'm building Flow — the MCP server described in this context doc.
>  Let's continue where we left off.
>  Current task: [describe what you want to do next]"

