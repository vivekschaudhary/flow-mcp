# flow-vault

A tiny Node preload that fills empty `process.env` reads from a hosted credential vault. Your app keeps reading `process.env.GOOGLE_CLIENT_ID` like normal — flow-vault makes the value appear without anything ever being written to disk.

## How it works

```
npm run dev
  → flow-vault loads via --require
  → reads session token from your OS keychain
  → identifies project from package.json name
  → fetches credential map from mcp.kindtree.us/api/vault/credentials
  → wraps process.env with a Proxy
  → your app starts; empty env reads now resolve from the vault
```

Cached in process memory for the lifetime of the Node process. One fetch per cold start.

## Status

Pre-release. Not yet on npm. Currently consumed via local `file:` dependency. The `flow login` CLI for keychain session management is planned (today, store the session manually with a small Node snippet — see "Manual session" below).

## Installation

When published:

```bash
npm install --save-dev flow-vault
```

Today (local development):

```bash
npm install --save-dev file:/path/to/flow-mcp/packages/flow-vault
```

Then add `--require=flow-vault` to whatever launches Node. Examples:

| Command | Wrap as |
|---|---|
| `node server.js` | `node --require=flow-vault server.js` |
| `next dev` | `NODE_OPTIONS='--require=flow-vault' next dev` |
| `vercel dev` | `NODE_OPTIONS='--require=flow-vault' vercel dev` |
| `nodemon server.js` | `nodemon --require flow-vault server.js` |
| `ts-node server.ts` | `ts-node --require flow-vault/register server.ts` |

The cleanest place to put it is your `package.json` script:

```json
{
  "scripts": {
    "dev:flow": "NODE_OPTIONS='--require=flow-vault' vercel dev"
  }
}
```

(Don't name the script `dev` if you use `vercel dev` — Vercel detects recursion and refuses.)

## How credentials work

Priority order, top wins:

1. `process.env.X` is non-empty → return that. Your own value always wins.
2. `process.env.X` is empty AND key exists in vault → return vault value.
3. Key isn't managed by Flow → return `undefined` (default Node behavior).

The third rule matters: flow-vault never *adds* keys to your enumerable env. `Object.keys(process.env)` won't show vault keys. If a library loops over your env to detect what's configured, it sees only what you actually set. Vault keys are a fallback for *misses*, not an authoritative source.

## Manual session (until `flow login` ships)

```js
// node -e "..."
require('flow-vault/keychain').storeSession('any-string-for-now');
```

Read it back to verify:

```js
require('flow-vault/keychain').getSession();
```

Clear it:

```js
require('flow-vault/keychain').clearSession();
```

The session is stored in your OS keychain under service `flow-vault`, account `<your username>`. Once `flow-vault-cli` ships, `flow login` will replace this with a real GitHub-OAuth-issued token.

## Supported environments

- macOS, Windows, Linux
- Node 18+ (uses built-in `fetch` and `AbortController`)

## Failure modes

All silent. Never throws. Never crashes your app.

| What happens | flow-vault's response |
|---|---|
| No session in keychain | Skip the fetch entirely. Quiet. (Expected first-run.) |
| Vault unreachable / 5xx | One `[flow-vault]` line on stderr. App boots, reads return the dev's own values or undefined. |
| Vault returns 401 / 404 | Same — warn once, skip the wrap. |
| Vault times out (4s) | Warn once, skip. |
| Anything throws inside flow-vault | Caught and swallowed. Your app boots normally. |

The contract: **flow-vault degrading should never be the reason your app fails to boot.**

## Security

- Credentials never written to disk anywhere on your machine.
- Only thing on disk is the **session token**, stored in your OS keychain (Apple Keychain / Windows DPAPI / libsecret on Linux).
- The session token is not a credential — it's an opaque identifier scoped to your install.
- Communication with the vault is HTTPS only.
- Process-memory only for the credential map. When the process exits, they're gone.
- Developer-set values always win — you can't be tricked into using a vault value when you've set your own.

Full threat model: [SECURITY.md](./SECURITY.md).

## Environment detection

Detects environment in this order:

1. `process.env.VERCEL_ENV` if set to `production`, `preview`, or `development`
2. `process.env.NODE_ENV` if set to `production` or `test`
3. Default: `development`

The vault returns different credentials per environment — for example, `development` includes Flow's shared dev credentials as a fallback; `production` returns only what you've explicitly stored.

## Uninstall

Remove the `--require=flow-vault` flag from your start scripts and `npm uninstall flow-vault`. Your app keeps working as long as the credentials it needs are present in your env or `.env` files. Nothing flow-vault did persists.
