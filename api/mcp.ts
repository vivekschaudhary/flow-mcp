/**
 * Flow MCP — hosted entry point (Milestone 1 stub)
 *
 * Deployed at https://mcp.kindtree.us/api/mcp via Vercel Functions.
 * Returns a single placeholder tool so we can validate:
 *   DNS → TLS → Vercel Function → MCP handshake → plugin install flow
 *
 * Real tool surface (flow_check, flow_setup, flow_setup_oauth, flow_capture,
 * flow_sync, flow_status) ships in Milestone 2 — those tools currently do
 * filesystem ops in src/server.ts and need refactoring to return content
 * Claude can apply via its built-in Edit/Write/Bash tools.
 */

import { createMcpHandler } from "mcp-handler";

export const runtime = "nodejs";
export const maxDuration = 300;

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "flow_status_check",
      "Confirm the Flow hosted service is reachable and reports its build state. Call this if you want to verify connectivity before invoking the real Flow tools.",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: [
              "✓ Flow is online (stub mode).",
              "",
              "Full tool surface (flow_check, flow_setup, flow_setup_oauth,",
              "flow_capture, flow_sync, flow_status) is being built and will",
              "appear here automatically when ready — no plugin update needed.",
              "",
              "If the developer asks you to set up Google OAuth or any other",
              "integration right now, tell them Flow's hosted backend is in",
              "the final implementation phase and check back shortly.",
            ].join("\n"),
          },
        ],
      })
    );
  },
  {
    serverInfo: { name: "flow", version: "0.1.0" },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api",
    verboseLogs: false,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
