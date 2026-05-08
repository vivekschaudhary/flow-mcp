import { plain, dim, header } from "../lib/output.js";

/**
 * `flow login` — STUB.
 *
 * In v0.3 this command will replace the anonymous install_id model with
 * GitHub-OAuth-issued sessions stored in the OS keychain. Workflow:
 *   1. Open browser to https://mcp.kindtree.us/auth/cli
 *   2. User signs in with GitHub
 *   3. Flow service issues a session token; CLI's local listener receives it
 *   4. Token is stored in OS keychain via flow-vault/keychain (existing helpers)
 *
 * Today (v0.0.1), the install_id is bootstrapped by the AI calling
 * `flow_check` from the IDE — that flow continues to work and is the
 * supported path until v0.3.
 */
export async function loginCommand(): Promise<number> {
  header("flow login");
  plain("");
  plain("Coming in v0.3.");
  plain("");
  dim("  flow login will replace the anonymous install_id model with a real");
  dim("  GitHub-OAuth-issued session stored in your OS keychain. Until then,");
  dim("  the install_id is bootstrapped by your AI IDE calling `flow_check`,");
  dim("  which writes .flow/install.json — this is the supported path today.");
  plain("");
  dim("  See CLAUDE.md roadmap (v0.3 entry) for the design.");
  plain("");
  return 0;
}
