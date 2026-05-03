/**
 * Flow MCP — hosted entry point.
 *
 * Deployed at https://mcp.kindtree.us/api/mcp via Vercel Functions.
 *
 * Tools served:
 *   flow_status_check   — connectivity probe (returns server build state)
 *   flow_check          — read state for a project from KV
 *   flow_status         — verbose project health
 *   flow_setup_oauth    — store Google dev creds in vault, instruct Claude to
 *                         install flow-vault and wire --require into the start
 *                         script. Production path is M2.5 — returns "coming soon".
 *
 * The runtime model:
 *   - Each project on the developer's machine has an `install_id` (a UUID).
 *     First call without install_id → server generates one and instructs
 *     Claude to write `.flow/install.json` + store the id in keychain.
 *   - All subsequent tool calls pass install_id; state is keyed by
 *     (install_id, project_name) in Upstash Redis via src/lib/storage.ts.
 *   - flow_setup_oauth(dev) stores creds in the vault. Claude then installs
 *     flow-vault into the user's project; flow-vault fetches the vault at
 *     boot and injects values into process.env via Proxy. No .env writes.
 */

import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  generateInstallId,
  getState,
  mergeVault,
  updateIntegration,
} from "../src/lib/storage.js";

export const runtime = "nodejs";
export const maxDuration = 300;

const handler = createMcpHandler(
  (server) => {
    // ─── flow_status_check ─────────────────────────────────────────────
    server.tool(
      "flow_status_check",
      "Confirm the Flow hosted service is reachable. Returns server build state. Use this for a quick connectivity probe; for project status use flow_check or flow_status.",
      {},
      async () => ({
        content: [
          {
            type: "text",
            text: [
              "✓ Flow is online.",
              "",
              "Live tools:",
              "  flow_check        — project + integration status",
              "  flow_status       — verbose project health",
              "  flow_setup_oauth  — store Google OAuth creds in vault (dev only in this milestone)",
              "",
              "Production OAuth setup (flow_setup_oauth(production)), credential capture",
              "from JSON, and generic playbook walkthrough are planned for M2.5/M3.",
            ].join("\n"),
          },
        ],
      })
    );

    // ─── flow_check ────────────────────────────────────────────────────
    server.tool(
      "flow_check",
      "Check the status of Flow integrations for a project. Call this BEFORE asking for a Flow setup, so you know whether the integration is already configured. On first call without install_id, generates one and returns instructions to bootstrap. Subsequent calls require install_id (read from .flow/install.json in the project root) AND project_name (read from package.json).",
      {
        install_id: z
          .string()
          .optional()
          .describe(
            "Install ID for this project, stored at .flow/install.json. Omit on first call to bootstrap."
          ),
        project_name: z
          .string()
          .optional()
          .describe(
            'Value of the "name" field in the project\'s package.json. Required when install_id is provided.'
          ),
        integration_id: z
          .string()
          .optional()
          .describe(
            'If set, returns status of just this integration (e.g. "google-oauth-web").'
          ),
      },
      async ({ install_id, project_name, integration_id }) => {
        // Bootstrap: no install_id yet
        if (!install_id) {
          const newId = generateInstallId();
          return {
            content: [
              {
                type: "text",
                text: [
                  "Flow has no install ID for this project yet. I generated one:",
                  "",
                  `  install_id: ${newId}`,
                  "",
                  "To complete setup, do these THREE things in order:",
                  "",
                  `1. Create the file .flow/install.json in the project root with this content:`,
                  `   {"install_id":"${newId}"}`,
                  "",
                  "2. Store the same id in the OS keychain so flow-vault can authenticate when the app boots:",
                  `   node -e "require('flow-vault/keychain').storeSession('${newId}')"`,
                  "   (Skip this step if flow-vault isn't installed yet — flow_setup_oauth will tell you when to install it.)",
                  "",
                  "3. Call flow_check again, this time passing install_id and project_name (read project_name from package.json).",
                ].join("\n"),
              },
            ],
          };
        }

        // Have install_id but missing project_name
        if (!project_name) {
          return {
            content: [
              {
                type: "text",
                text: "I have your install_id but I need the project's package.json `name` value too. Read package.json from the project root and call flow_check again with project_name set.",
              },
            ],
          };
        }

        const state = await getState(install_id, project_name);

        if (!state) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `No Flow state for project "${project_name}" yet.`,
                  "No integrations are configured.",
                  "",
                  'Ask me to "set up Google OAuth for development" to configure your first integration.',
                ].join("\n"),
              },
            ],
          };
        }

        if (integration_id) {
          const integration = state.integrations[integration_id];
          if (!integration) {
            return {
              content: [
                {
                  type: "text",
                  text: `Integration "${integration_id}" is NOT configured for "${project_name}".`,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: [
                  `Integration: ${integration_id}`,
                  `Status: ${integration.status}`,
                  `Configured at: ${integration.configured_at || "(never)"}`,
                  `Environments synced: ${
                    integration.environments_synced.join(", ") || "(none)"
                  }`,
                  `Playbook version: ${integration.playbook_version}`,
                ].join("\n"),
              },
            ],
          };
        }

        // List all integrations
        const lines = [`Project: ${project_name}`, ""];
        const ids = Object.keys(state.integrations);
        if (ids.length === 0) {
          lines.push("No integrations configured yet.");
          lines.push(
            'Ask me to "set up Google OAuth for development" to get started.'
          );
        } else {
          lines.push(`Integrations (${ids.length}):`);
          for (const [id, integration] of Object.entries(state.integrations)) {
            const icon = integration.status === "configured" ? "✓" : "○";
            lines.push(`  ${icon} ${id} — ${integration.status}`);
          }
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }
    );

    // ─── flow_status ───────────────────────────────────────────────────
    server.tool(
      "flow_status",
      "Verbose health report for a project's Flow integrations — what's configured, what's pending, when each was set up. Requires install_id and project_name (same shape as flow_check).",
      {
        install_id: z
          .string()
          .describe("Install ID from .flow/install.json"),
        project_name: z
          .string()
          .describe('Value of the "name" field in package.json'),
      },
      async ({ install_id, project_name }) => {
        const state = await getState(install_id, project_name);

        if (!state) {
          return {
            content: [
              {
                type: "text",
                text: [
                  `# Flow status — ${project_name}`,
                  "",
                  "No state recorded yet. No integrations have been configured.",
                  "",
                  'Ask me to "set up Google OAuth for development" to start.',
                ].join("\n"),
              },
            ],
          };
        }

        const lines = [
          `# Flow status — ${project_name}`,
          `Initialized: ${state.initialized_at}`,
          "",
        ];

        const configured = Object.entries(state.integrations).filter(
          ([, i]) => i.status === "configured"
        );
        const pending = Object.entries(state.integrations).filter(
          ([, i]) => i.status === "in_progress"
        );

        if (configured.length > 0) {
          lines.push(`## ✓ Configured (${configured.length})`);
          for (const [id, i] of configured) {
            lines.push(
              `  • ${id} — synced to: ${
                i.environments_synced.join(", ") || "(none)"
              }`
            );
            if (i.configured_at) {
              lines.push(`    configured at: ${i.configured_at}`);
            }
          }
          lines.push("");
        }

        if (pending.length > 0) {
          lines.push(`## ⏳ In progress (${pending.length})`);
          for (const [id] of pending) lines.push(`  • ${id}`);
          lines.push("");
        }

        if (configured.length === 0 && pending.length === 0) {
          lines.push("No integrations configured yet.");
          lines.push(
            'Ask me to "set up Google OAuth for development" to start.'
          );
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };
      }
    );

    // ─── flow_setup_oauth ──────────────────────────────────────────────
    server.tool(
      "flow_setup_oauth",
      "Set up Google OAuth for a project. In development (the only live mode), stores Flow's shared dev credentials in the project's vault and returns instructions for installing flow-vault. Production setup is planned for M2.5 — returns 'coming soon' for now. ALWAYS pass install_id and project_name.",
      {
        install_id: z
          .string()
          .describe("Install ID from .flow/install.json"),
        environment: z
          .enum(["development", "production"])
          .default("development")
          .describe(
            'Currently only "development" works. "production" returns coming-soon.'
          ),
        project_name: z
          .string()
          .describe('Value of the "name" field in package.json'),
      },
      async ({ install_id, environment, project_name }) => {
        if (environment === "production") {
          return {
            content: [
              {
                type: "text",
                text: [
                  "Production OAuth setup is planned for the next milestone (M2.5).",
                  "",
                  "For now, use flow_setup_oauth with environment='development' to get",
                  "Flow's shared dev credentials into the vault. When production setup",
                  "ships, it will guide you through one Google Cloud Console visit and",
                  "capture the resulting JSON automatically.",
                ].join("\n"),
              },
            ],
          };
        }

        const clientId = process.env.FLOW_GOOGLE_CLIENT_ID;
        const clientSecret = process.env.FLOW_GOOGLE_CLIENT_SECRET;

        if (!clientId || !clientSecret) {
          return {
            content: [
              {
                type: "text",
                text: [
                  "✗ Flow's shared development credentials are not configured on the hosted server.",
                  "",
                  "This is a server-side issue (env vars FLOW_GOOGLE_CLIENT_ID and",
                  "FLOW_GOOGLE_CLIENT_SECRET need to be set on the Vercel project).",
                  "Ask Vivek to verify with `vercel env ls` against the flow-mcp project.",
                ].join("\n"),
              },
            ],
          };
        }

        // Store the creds in the project's vault under the development env.
        // flow-vault will fetch this map at app boot and inject into process.env.
        await mergeVault(install_id, project_name, "development", {
          GOOGLE_CLIENT_ID: clientId,
          GOOGLE_CLIENT_SECRET: clientSecret,
        });

        // Mark the integration as configured in project state.
        await updateIntegration(
          install_id,
          project_name,
          "google-oauth-web",
          "configured",
          {
            configured_at: new Date().toISOString(),
            environments_synced: ["development"],
            playbook_version: "dev-shared-runtime-v1",
          }
        );

        return {
          content: [
            {
              type: "text",
              text: [
                "✓ Google OAuth dev credentials stored in your project's Flow vault.",
                "",
                "To make them available to your app at runtime, two changes:",
                "",
                "1. Install flow-vault as a dev dependency:",
                "   npm install --save-dev flow-vault",
                "",
                "2. Wrap your dev script with the --require flag in package.json scripts:",
                `   "dev:flow": "NODE_OPTIONS='--require=flow-vault' vercel dev"`,
                "",
                "   (Don't name the script 'dev' if you use vercel dev — Vercel detects recursion.",
                "   For other frameworks: `nodemon --require flow-vault server.js`,",
                "   `ts-node --require flow-vault/register server.ts`, etc.)",
                "",
                `3. Verify the keychain session matches the install_id "${install_id}":`,
                `   node -e "require('flow-vault/keychain').storeSession('${install_id}')"`,
                "",
                "Then restart your dev server. process.env.GOOGLE_CLIENT_ID and",
                "process.env.GOOGLE_CLIENT_SECRET will resolve transparently from the vault.",
                "No .env line needed.",
              ].join("\n"),
            },
          ],
        };
      }
    );
  },
  {
    serverInfo: { name: "flow", version: "0.2.0" },
    capabilities: { tools: {} },
  },
  {
    basePath: "/api",
    verboseLogs: false,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
