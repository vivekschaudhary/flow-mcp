/**
 * Environment variable management
 * Reads and writes .env files, syncs to Vercel
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

export interface EnvFile {
  path: string;
  name: string;
  exists: boolean;
  variables: Record<string, string>;
}

// Parse a .env file into key-value pairs
export function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf-8");
  const vars: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
    vars[key] = value;
  }

  return vars;
}

// Write variables to a .env file — preserves existing content
export function writeEnvFile(
  filePath: string,
  newVars: Record<string, string>
): void {
  let content = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : "";

  for (const [key, value] of Object.entries(newVars)) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    const line = `${key}=${value}`;

    if (regex.test(content)) {
      // Update existing line
      content = content.replace(regex, line);
    } else {
      // Append new variable
      content = content.trimEnd() + `\n${line}\n`;
    }
  }

  fs.writeFileSync(filePath, content);
}

// Write .env.example — keys only, no values
export function writeEnvExample(
  filePath: string,
  keys: string[]
): void {
  let content = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf-8")
    : "";

  for (const key of keys) {
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (!regex.test(content)) {
      content = content.trimEnd() + `\n${key}=\n`;
    }
  }

  fs.writeFileSync(filePath, content);
}

// Detect what env files exist in the project
export function detectEnvFiles(projectRoot: string): EnvFile[] {
  const candidates = [
    { path: ".env.local", name: "local" },
    { path: ".env", name: "default" },
    { path: ".env.development", name: "development" },
  ];

  return candidates.map((c) => {
    const fullPath = path.join(projectRoot, c.path);
    return {
      path: fullPath,
      name: c.name,
      exists: fs.existsSync(fullPath),
      variables: parseEnvFile(fullPath),
    };
  });
}

// Check if Vercel CLI is available
export function hasVercelCLI(): boolean {
  try {
    execSync("vercel --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Sync credentials to Vercel environments
export function syncToVercel(
  vars: Record<string, string>,
  environments: string[] = ["development", "preview", "production"]
): { success: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!hasVercelCLI()) {
    return { success: false, errors: ["Vercel CLI not found. Install with: npm i -g vercel"] };
  }

  for (const [key, value] of Object.entries(vars)) {
    for (const env of environments) {
      try {
        // Use vercel env add — pipe the value via stdin
        execSync(
          `echo "${value}" | vercel env add ${key} ${env} --force`,
          { stdio: "pipe" }
        );
      } catch (e: any) {
        errors.push(`Failed to sync ${key} to Vercel ${env}: ${e.message}`);
      }
    }
  }

  return { success: errors.length === 0, errors };
}

// Pull credentials from a downloaded Google JSON file
export function extractGoogleOAuthCredentials(
  jsonPath: string
): Record<string, string> | null {
  try {
    const raw = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

    // Google downloads credentials in { web: { client_id, client_secret } }
    if (raw.web) {
      return {
        GOOGLE_CLIENT_ID: raw.web.client_id,
        GOOGLE_CLIENT_SECRET: raw.web.client_secret,
      };
    }

    // Sometimes it's { installed: { client_id, client_secret } }
    if (raw.installed) {
      return {
        GOOGLE_CLIENT_ID: raw.installed.client_id,
        GOOGLE_CLIENT_SECRET: raw.installed.client_secret,
      };
    }

    return null;
  } catch {
    return null;
  }
}
