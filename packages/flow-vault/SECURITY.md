# Security model

How flow-vault protects credentials. Written for an auditor or security-conscious developer.

## What lives on disk

**Only:** a session token, stored in your OS keychain via `keytar`. Service `flow-vault`, account `<your username>`.

**Never:** any actual credential value. No `.env` write. No file-cache. No log line. No diagnostic dump.

The session token is not itself a credential — it's an opaque identifier scoped to your install. Compromise of a session token allows fetching whatever creds you've stored under that install, but does not bypass the provider's own auth (Google still validates the OAuth client ID against its registered redirect URIs).

## What lives in memory

The credential map returned by `/api/vault/credentials` lives in the Node process's memory for the lifetime of the process. When the process exits (Ctrl-C, SIGTERM, crash), the credentials are gone.

The map is held in a single closure variable inside `vault.js` and referenced by the Proxy handler in `proxy.js`. It is not exposed as a module export. It is not written to any temp file, not logged, not serialized to disk under any failure mode.

## The credential-leak surface flow-vault eliminates

Without flow-vault, the typical lifecycle of a Google OAuth secret on a developer's machine:

1. Developer creates OAuth client in GCP console
2. Downloads `client_secret_*.json` to `~/Downloads`
3. Copies values into `.env`
4. Adds `.env` to `.gitignore` (hopefully — a known gap)
5. Re-pastes value into Slack to ask a coworker about a config issue
6. Pastes into Claude Code chat to debug
7. Six months later, runs `git log -p` on a now-public repo and finds the secret

Each numbered step is a leak vector. With flow-vault:

1. The secret is stored once on Flow's vault (your prod creds; never your dev creds — those are Flow's own shared client).
2. It is fetched into your process at boot, lives in RAM for the process lifetime, and is gone when you Ctrl-C.
3. There is no `.env` line to commit. No `~/Downloads/client_secret_*.json` to forget about (Flow guides you to delete it after capture). No copy-paste into chat (the value never appears in your terminal output).

Anyone — security auditor, attacker with grep access to your machine, future-you doing a `git log -p` — finds nothing.

## OS keychain

flow-vault uses [`keytar`](https://www.npmjs.com/package/keytar), which provides bindings to the platform-native credential store:

| OS | Backend | API |
|---|---|---|
| macOS | Apple Keychain (Security framework) | `security` CLI under the hood |
| Windows | Windows Credential Manager (DPAPI) | wincred bindings |
| Linux | Secret Service via libsecret (gnome-keyring / KWallet) | D-Bus |

Each platform's store enforces user-level isolation: another OS user on the same machine cannot read your session token without your user's auth.

Inspect on macOS:

```bash
security find-generic-password -s flow-vault -a "$USER" -w
```

Delete on macOS:

```bash
security delete-generic-password -s flow-vault -a "$USER"
```

flow-vault's own `clearSession()` does the equivalent cross-platform.

## Vault communication

| Property | Value |
|---|---|
| Protocol | HTTPS only |
| Endpoint | `https://mcp.kindtree.us/api/vault/credentials` |
| Method | `GET` |
| Auth | `Authorization: Bearer <session token>` |
| Query | `?project=<package.json name>&env=<environment>` |
| Timeout | 4s (helper) / 5s (parent) |
| Body | JSON object — `Record<string, string>` |
| TLS termination | Vercel edge |

The session token is sent in every request. If captured by an active MITM (only possible if you've installed a malicious root CA), the attacker can replay against the vault to fetch creds for any project name they guess. This is the same threat model as any bearer-token API. Standard mitigation: don't install untrusted root CAs.

## Failure modes — fail safe, never fail open

`flow-vault` is structured so that any failure path leaves your application running normally and your developer-set credentials intact. We never substitute partial vault data on top of partial dev data in a way that could surprise you.

| Failure | Result |
|---|---|
| No session in keychain | No fetch attempted. Proxy not installed. `process.env` unchanged. |
| Vault unreachable / DNS fail / network down | One stderr warning. Empty vault. App boots, env reads return real env values or undefined. |
| Vault returns 401 | Same as above. Treated as "no creds available." |
| Vault returns malformed JSON | Same. |
| Vault returns 200 with non-string values for some keys | Those keys are filtered out; only string values pass through. |
| Helper subprocess hangs | Killed at 4s. Treated as failure. |
| Proxy throws on any individual `get` | The throw propagates only to that one access. Other env reads continue working. |

The contract: **flow-vault is a soft dependency.** Your app should never break because Flow is having a bad day.

## Supply chain

flow-vault has one runtime dependency: `keytar`. keytar has no runtime deps of its own (only `prebuild-install` at install time for native binary fetch). The full transitive dependency tree on a fresh install is small and inspectable:

```bash
npm ls --all
```

The vault-helper uses Node's built-in `fetch` (Node 18+) — no `node-fetch` / `axios` / `undici` to vet.

## What flow-vault does NOT defend against

- Compromise of your OS user account (the keychain is unlocked once you log in). flow-vault provides no extra layer beyond the OS.
- A malicious dependency in your own project that introspects `process.env` after flow-vault wraps it. The Proxy returns the value when called. There is no mechanism inside Node to hide env values from same-process code.
- Compromise of Flow's hosted vault itself. If our infrastructure is breached, your stored production creds are at risk. Mitigations: standard ops hygiene, rotation pathways (planned in v1), eventual SOC 2.

## Reporting vulnerabilities

`security@kindtree.us`. Coordinated disclosure preferred — give us 90 days to ship a fix before public disclosure, longer for severe issues. Bounty program when funded.
