/**
 * flow_setup_oauth MCP tool
 *
 * Dev:  Injects Flow shared Google OAuth credentials directly
 *       into .env.local. Zero console. Zero proxy. Seconds.
 *
 * Prod: Deep link to Google Console with exact values.
 *       Downloads watcher captures JSON automatically.
 */

import fs from "fs";
import path from "path";
import os from "os";
import net from "net";
import { writeEnvFile, extractGoogleOAuthCredentials, syncToVercel } from "../lib/env.js";
import { updateIntegrationStatus, writeCredentials } from "../lib/state.js";

// ─── OAuth registration whitelist ────────────────────────────────────────────
// These are the ports + paths registered in the flow-dev-shared GCP OAuth client.
// If the user's natural dev port is in SUPPORTED_PORTS, Flow leaves it alone.
// Otherwise, Flow forces PORT to FALLBACK_PORTS[0] and tells the user.

const SUPPORTED_PORTS = [
  3000, 3001, 3002, 3003, 3004, 3005,
  4000, 4200,
  5000, 5001,
  5173, 5174, 5175,
  8000, 8080, 8081, 8888,
  9000,
];

const FALLBACK_PORTS = [47823, 51234];

const SUPPORTED_CALLBACK_PATHS = [
  "/api/auth/google/callback",
  "/api/auth/callback/google",
];

function pickDevPort(detectedPort: number): { port: number; forced: boolean } {
  if (SUPPORTED_PORTS.includes(detectedPort)) {
    return { port: detectedPort, forced: false };
  }
  return { port: FALLBACK_PORTS[0], forced: true };
}

function checkPortAvailable(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(`Port ${port} is already in use.`);
      } else {
        resolve(`Could not check port ${port}: ${err.message}`);
      }
    });
    tester.once("listening", () => {
      tester.close(() => resolve(null));
    });
    tester.listen(port, "127.0.0.1");
  });
}

// ─── Flow shared dev credentials ─────────────────────────────────────────────

function getFlowCreds(): { client_id: string; client_secret: string } | null {
  const id = process.env.FLOW_GOOGLE_CLIENT_ID;
  const secret = process.env.FLOW_GOOGLE_CLIENT_SECRET;
  if (!id || !secret || id === "FLOW_CLIENT_ID_PLACEHOLDER") return null;
  return { client_id: id, client_secret: secret };
}

// ─── Env file selection ───────────────────────────────────────────────────────

// Source of truth: user-confirmed `dev_env_file` in .flow/integrations.json
// (set during `flow init`). Heuristic only used as a last-resort fallback.
function pickEnvFile(root: string): string {
  const statePath = path.join(root, ".flow", "integrations.json");
  if (fs.existsSync(statePath)) {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      if (state.dev_env_file) return path.join(root, state.dev_env_file);
    } catch { /* fall through */ }
  }

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const usesEnvLocal =
        deps["next"] ||
        deps["nuxt"] ||
        deps["@sveltejs/kit"] ||
        deps["vite"] ||
        deps["astro"];
      if (usesEnvLocal) return path.join(root, ".env.local");
    } catch { /* fall through */ }
  }
  return path.join(root, ".env");
}

// ─── Project detection ────────────────────────────────────────────────────────

export function detectAppConfig(root: string) {
  let port = 3000;
  let authLibrary = "custom";
  let callbackPath = "/api/auth/google/callback";
  let prodDomain: string | null = null;

  const pkgPath = path.join(root, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    if (deps["next-auth"] || deps["nextauth"]) {
      authLibrary = "nextauth";
      callbackPath = "/api/auth/callback/google";
    } else if (deps["@clerk/nextjs"]) {
      authLibrary = "clerk";
      callbackPath = "/api/auth/callback/google";
    }

    const devScript = pkg.scripts?.dev || "";
    const m = devScript.match(/(?:--port|-p)\s*(\d+)|PORT=(\d+)/);
    if (m) port = parseInt(m[1] || m[2]);
  }

  // Port from .env.local
  const envPath = path.join(root, ".env.local");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(/^PORT=(\d+)/m);
    if (m) port = parseInt(m[1]);
  }

  // Prod domain from Vercel
  const vercelPath = path.join(root, ".vercel", "project.json");
  if (fs.existsSync(vercelPath)) {
    try {
      const v = JSON.parse(fs.readFileSync(vercelPath, "utf-8"));
      if (v.projectName) prodDomain = `${v.projectName}.vercel.app`;
    } catch { /* ignore */ }
  }

  return { port, authLibrary, callbackPath, prodDomain };
}

// ─── Dev setup ────────────────────────────────────────────────────────────────

export async function setupGoogleOAuthDev(root: string): Promise<string> {
  const creds = getFlowCreds();
  const { port: detectedPort, authLibrary, callbackPath } = detectAppConfig(root);

  if (!creds) {
    return [
      `Flow shared credentials not found.`,
      `Make sure FLOW_GOOGLE_CLIENT_ID and FLOW_GOOGLE_CLIENT_SECRET`,
      `are set in your environment.`,
      ``,
      `Run: source ~/.zshrc  then restart the MCP server.`,
    ].join("\n");
  }

  // Validate callback path against the registered whitelist
  if (!SUPPORTED_CALLBACK_PATHS.includes(callbackPath)) {
    return [
      `✗ Your app's Google callback path is "${callbackPath}".`,
      `  Flow's shared dev OAuth only registers these two paths:`,
      ...SUPPORTED_CALLBACK_PATHS.map((p) => `    ${p}`),
      ``,
      `Switch your callback to one of those paths and run setup again.`,
      `(Otherwise Google will reply with redirect_uri_mismatch.)`,
    ].join("\n");
  }

  // Pick the dev port — keep the user's natural port if registered, else force fallback
  const { port, forced } = pickDevPort(detectedPort);

  // Pre-flight: make sure the chosen port is free
  const portError = await checkPortAvailable(port);
  if (portError) {
    return [
      `✗ ${portError}`,
      ``,
      forced
        ? `Flow needs port ${port} (your natural port ${detectedPort} isn't in the registered list).`
        : `Flow needs port ${port} (your natural dev port).`,
      `Find what's using it (\`lsof -i :${port}\`) and stop it, then run setup again.`,
    ].join("\n");
  }

  // Inject into the dev env file the project actually uses
  const envPath = pickEnvFile(root);
  const envFileName = path.basename(envPath);
  let content = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf-8") : "";

  if (!content.includes("# Flow — Google OAuth")) {
    content = content.trimEnd() +
      "\n\n# Flow — Google OAuth (development)\n" +
      "# Managed by Flow — do not edit manually\n";
    fs.writeFileSync(envPath, content);
  }

  const envVars: Record<string, string> = {
    GOOGLE_CLIENT_ID: creds.client_id,
    GOOGLE_CLIENT_SECRET: creds.client_secret,
  };
  if (forced) envVars.PORT = String(port);
  writeEnvFile(envPath, envVars);

  // Update state
  try {
    updateIntegrationStatus("google-oauth-web", "configured", {
      configured_at: new Date().toISOString(),
      environments_synced: ["development"],
      playbook_version: "dev-shared",
    }, root);
  } catch { /* state may not be initialized */ }

  // Start watching Downloads for production setup
  startDownloadsWatcher(root);

  const portLine = forced
    ? `  Port:         ${port}  (forced — your natural port ${detectedPort} isn't in Flow's registered list; restart your dev server)`
    : `  Port:         ${port}  (your natural dev port — no change)`;

  const injectedLines = [
    `  GOOGLE_CLIENT_ID     — Flow shared dev app`,
    `  GOOGLE_CLIENT_SECRET — Flow shared dev app`,
    ...(forced ? [`  PORT=${port}              — pinned so Google's redirect_uri matches`] : []),
  ];

  return [
    `✓ Google OAuth ready for development`,
    ``,
    `Injected into ${envFileName}:`,
    ...injectedLines,
    ``,
    portLine,
    `  Auth library: ${authLibrary}`,
    `  Callback:     http://localhost:${port}${callbackPath}`,
    ``,
    forced
      ? `Restart your dev server, then trigger your Google login.`
      : `Test it now — trigger your Google login.`,
    `No proxy. No extra process. Just works.`,
    ``,
    `When ready to ship: "set up Google OAuth for production"`,
  ].join("\n");
}

// ─── Prod setup ───────────────────────────────────────────────────────────────

export async function setupGoogleOAuthProd(root: string): Promise<string> {
  const { port, callbackPath, prodDomain } = detectAppConfig(root);
  const domain = prodDomain || "your-app.vercel.app";

  startDownloadsWatcher(root);

  return [
    `Setting up Google OAuth for production...`,
    ``,
    `Open this link:`,
    `https://console.cloud.google.com/apis/credentials/oauthclient`,
    ``,
    `Select: Web application`,
    `Name:   ${path.basename(root)}-prod`,
    ``,
    `Authorized JavaScript origins:`,
    `  https://${domain}`,
    ``,
    `Authorized redirect URIs:`,
    `  http://localhost:${port}${callbackPath}`,
    `  https://${domain}${callbackPath}`,
    ``,
    `Click Create → Download JSON`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    `Watching your Downloads folder.`,
    `The moment you download the JSON:`,
    `  ✓ Credentials captured`,
    `  ✓ Synced to .env.local`,
    `  ✓ Synced to Vercel (dev, preview, prod)`,
    `  ✓ You never touch these keys again`,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
  ].join("\n");
}

// ─── Downloads watcher ────────────────────────────────────────────────────────

let watcherStarted = false;

function startDownloadsWatcher(root: string): void {
  if (watcherStarted) return;
  watcherStarted = true;

  const dir = path.join(os.homedir(), "Downloads");
  if (!fs.existsSync(dir)) return;

  fs.watch(dir, (event, filename) => {
    if (!filename || event !== "rename") return;
    if (!filename.startsWith("client_secret") || !filename.endsWith(".json")) return;

    const filePath = path.join(dir, filename);

    setTimeout(() => {
      if (!fs.existsSync(filePath)) return;
      const creds = extractGoogleOAuthCredentials(filePath);
      if (!creds) return;

      console.log(`\n[Flow] Detected: ${filename}`);

      // Write to the dev env file the project uses
      const envPath = pickEnvFile(root);
      writeEnvFile(envPath, creds);
      console.log(`[Flow] ✓ ${path.basename(envPath)} updated`);

      // Store in .flow/credentials.json
      writeCredentials(creds, root);

      // Sync to Vercel
      const result = syncToVercel(creds);
      if (result.success) {
        console.log(`[Flow] ✓ Vercel synced`);
      }

      // Update state
      try {
        updateIntegrationStatus("google-oauth-web", "configured", {
          configured_at: new Date().toISOString(),
          environments_synced: ["local", "vercel"],
        }, root);
      } catch { /* ignore */ }

      console.log(`[Flow] ✓ Done. You never need to touch these keys again.\n`);
    }, 800);
  });

  console.log(`[Flow] Watching ~/Downloads for credentials...`);
}
