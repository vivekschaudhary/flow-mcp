/**
 * keychain-helper.js — async OS-keychain bridge.
 *
 * Spawned synchronously from keychain.js via child_process.execFileSync
 * because the --require preload context can't await. This file uses
 * keytar's async API and prints results to stdout for the parent to read.
 *
 * Commands (process.argv[2]):
 *   get    → stdout: session token, or empty string if not found
 *   set    → reads token from process.argv[3], stores it; stdout: "ok"
 *   clear  → removes the entry; stdout: "ok"
 *
 * Service: 'flow-vault'
 * Account: OS username
 *
 * Exit code 0 always when keytar itself succeeds (including "not found" on get).
 * Exit code 1 only on hard errors (keytar throws, no permission, etc.).
 */

const keytar = require("keytar");
const os = require("os");

const SERVICE = "flow-vault";
const ACCOUNT = os.userInfo().username;

async function main() {
  const cmd = process.argv[2];

  try {
    switch (cmd) {
      case "get": {
        const value = await keytar.getPassword(SERVICE, ACCOUNT);
        process.stdout.write(value || "");
        return 0;
      }
      case "set": {
        const token = process.argv[3];
        if (!token) {
          process.stderr.write("usage: keychain-helper set <token>\n");
          return 2;
        }
        await keytar.setPassword(SERVICE, ACCOUNT, token);
        process.stdout.write("ok");
        return 0;
      }
      case "clear": {
        await keytar.deletePassword(SERVICE, ACCOUNT);
        process.stdout.write("ok");
        return 0;
      }
      default:
        process.stderr.write(`unknown command: ${cmd}\n`);
        process.stderr.write("usage: keychain-helper <get|set|clear> [token]\n");
        return 2;
    }
  } catch (err) {
    process.stderr.write(`[flow-vault keychain] ${err.message}\n`);
    return 1;
  }
}

main().then((code) => process.exit(code));
