# Integration playbooks

A playbook is a JSON file that encodes everything Flow needs to walk a developer through configuring an integration: prerequisites, step-by-step instructions per auth library, blocking warnings, common-mistake remedies, credential format hints. The playbook engine in [src/lib/playbook.ts](../src/lib/playbook.ts) loads them, formats steps for Claude, and surfaces warnings at the right moment.

Playbooks turn provider-specific knowledge from "tribal" (one developer remembering they once hit a redirect_uri_mismatch) to "institutional" (encoded once in a versioned, verifiable JSON file).

## How Flow keeps playbooks current

Each playbook has a `verified_at` date and a `confidence` score (0.0–1.0). When `confidence < 0.5` the engine refuses to serve the playbook and tells the developer the steps may be outdated. Future versions will re-verify against the provider's docs (via the Google Developer Knowledge MCP for Google playbooks, similar for others) on a schedule and bump or downgrade confidence automatically.

## Current playbooks

### `google-oauth-web` — v1.0.0

| Field | Value |
|---|---|
| Provider / platform | Google / Web Application |
| Verified | 2026-04-26 (confidence 1.0) |
| Estimated time (expert) | 2 minutes |
| Estimated time (first-timer) | 25 minutes |
| Credentials emitted | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |

**Library variants supported.** Each step that involves callback URLs or origin URLs renders different content based on which auth library the developer's project uses:

- **NextAuth / next-auth** — `/api/auth/callback/google`
- **Clerk** — handled by Clerk's hosted flow; uses Clerk's own callback
- **Auth0** — Auth0-side handler
- **Custom** — `/api/auth/google/callback` (the convention most hand-rolled implementations follow)

**Blocking warnings** (surfaced before step 1):
- The OAuth consent screen MUST be configured before creating credentials. Otherwise the credential creation page is greyed out and the developer ends up bouncing.
- A Privacy Policy URL is required on the consent screen. Test mode allows you to skip it; verification mode does not.

**High-severity warnings** (during steps):
- Test mode caps at 100 unique users — fine for dev, blocks at any real launch.
- Verification takes 7+ days; submit at least a week before launch.
- Redirect URIs are matched character-exactly; one trailing slash mismatch causes `redirect_uri_mismatch` and you spend an hour wondering why.

**Common mistakes** (with explicit remedies):
- `redirect_uri_mismatch` → string-compare your registered URIs against what your app is sending; one trailing slash difference will fail.
- `access_blocked` → consent screen not configured; go configure, retry.
- `access_denied` → user not added to test users list (only relevant in test mode).

**Known gotchas not in the playbook yet:**
- "Authorized JavaScript origins" vs "Authorized redirect URIs" are two separate fields and both must be set for some flows. Today's playbook covers only redirect URIs.
- Workspace-scoped OAuth clients vs personal — the playbook assumes personal/external. Workspace-internal apps have different verification requirements.

## Playbook schema (current)

```jsonc
{
  "id": "kebab-case-id",
  "name": "Human Title",
  "version": "semver",
  "created_at": "YYYY-MM-DD",
  "verified_at": "YYYY-MM-DD",
  "verified_by": "email",
  "confidence": 1.0,                  // 0.0 to 1.0; <0.5 suspends the playbook
  "estimated_time_expert": "2 minutes",
  "estimated_time_first_timer": "25 minutes",
  "provider": "google",
  "platform": "web",

  "credentials_emitted": [
    {
      "key": "GOOGLE_CLIENT_ID",
      "description": "OAuth client identifier",
      "format": "numeric-string.apps.googleusercontent.com",
      "required": true,
      "source": "downloaded JSON → client_id field"
    }
  ],

  "prerequisites": [
    {
      "id": "consent-screen",
      "description": "OAuth consent screen must be configured",
      "check": "Have you configured the consent screen?",
      "if_missing": "Configure consent screen first"
    }
  ],

  "warnings": [
    {
      "id": "redirect-exact-match",
      "severity": "high",                 // blocking | high | medium | low
      "trigger": "before_step_5",         // before_start | after_complete | before_launch | before_step_N | on_redirect_uri_entry
      "message": "Redirect URIs must match character-exactly",
      "url": "https://docs.example.com/troubleshoot/uri-mismatch"
    }
  ],

  "steps": [
    {
      "id": "step-1",
      "type": "navigate",                 // navigate | action | select | input | capture | flow
      "title": "Open Google Cloud Console",
      "url": "https://console.cloud.google.com/...",
      "instruction": "Click 'Create Credentials' → 'OAuth client ID'",
      "notes": "Optional context",
      "warning": "Optional inline warning",
      "values": ["Web application"],      // for type=select / type=input
      "library_variants": {                // per-auth-library text
        "nextauth": ["http://localhost:3000/api/auth/callback/google"],
        "custom": ["http://localhost:3000/api/auth/google/callback"]
      },
      "common_mistakes": [
        "Forgetting to add localhost variants alongside production"
      ],
      "credential_paths": {                // for type=capture
        "GOOGLE_CLIENT_ID": "web.client_id",
        "GOOGLE_CLIENT_SECRET": "web.client_secret"
      }
    }
  ]
}
```

Step types:

| Type | Meaning |
|---|---|
| `navigate` | "Open this URL." Renders the URL prominently. |
| `action` | "Click this button." No data entry. |
| `select` | Pick one from a list. Renders the `values` as options. |
| `input` | Type a value. Renders `library_variants` if applicable. |
| `capture` | Download a file or copy a value. Triggers `flow_capture` workflow. |
| `flow` | Sub-workflow / branch (rarely used; reserved for future). |

Warning severities:

| Severity | Behavior |
|---|---|
| `blocking` | Must be acknowledged before the step proceeds. |
| `high` | Surfaced prominently; not blocking. |
| `medium` | Inline note. |
| `low` | Footnote-style. |

## How to add a new playbook

1. Pick the provider and the integration type (e.g. `stripe-webhooks`, `aws-s3-uploads`).
2. Walk through the provider's setup yourself, recording every step, every gotcha, every error message and what fixed it. **Do this with a fresh account if possible** — known-state bias makes it easy to skip steps an experienced user does on autopilot.
3. Encode it in the schema above. Save as `src/playbooks/<id>.json`.
4. Write the verification: a script that re-walks the playbook against the live console and confirms each URL still 200s, each step's button text still matches, etc. Lives at `src/playbooks/verify/<id>.test.ts` (when the test harness ships).
5. Submit a PR. CI runs the verifier weekly and updates `verified_at` automatically.

Until the test harness ships, manual verification is enough. Update `verified_at` when you re-walk.

## Planned playbooks (priority order, from GitHub research of 1000 repos)

| Integration | Repos affected | Status |
|---|---|---|
| AWS S3 | 31% | Planned (v0.2) — narrow scope: file uploads only |
| Auth0 | 25% | Planned (v0.2) |
| OpenAI | 25% | Lower priority — API key shape, low friction |
| Google OAuth | 25% | **Live** — v1.0.0 |
| Stripe + Webhooks | 22% | Planned (v0.2) — webhooks are the real pain |
| Pusher | 16% | Planned (v0.2) — no existing tooling, high value |
| GitHub OAuth | 13% | Planned (v0.3) — similar shape to Google |
| Sentry | 13% | Lower priority — infra, not user-facing |
| Anthropic | 9% | Lower priority — API key shape |

Twilio, Resend, SendGrid added in v0.3 (API-key shape — easier playbooks, useful for the notification-stack story).

## Contributing a playbook

Open a PR adding `src/playbooks/<your-id>.json`. Include in the PR description:

1. Which provider and integration scope
2. Last time you walked through it manually
3. The `client_secret_*.json` (or equivalent) file structure if applicable, with redacted values
4. Three known gotchas that aren't obvious from reading the provider's official docs

PR criteria: schema valid, walkthrough verified within last 30 days, gotchas correctly identified.
