import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { UserError } from "./errors.js";

/**
 * `.flow/integrations.json` — the manifest the CLI writes for the SRE.
 *
 * Schema is Shape A (integration-first), decided in plan-mode for PR2.
 *
 *   {
 *     "integrations": {
 *       "google-oauth-web": {
 *         "development": {...},
 *         "preview":     {...},
 *         "production":  {...}
 *       }
 *     }
 *   }
 *
 * No credential values ever live here — only the source reference, secret
 * name (where applicable), region, and the list of env-var names this
 * integration produces.
 *
 * Some repos (including this one) have a legacy `.flow/integrations.json`
 * from before storage moved to KV — its shape is
 *   {project_name, initialized_at, stack, environments[], integrations: {}}.
 * We detect that shape on read and treat it as an empty manifest so the
 * first `flow setup production` against such a repo overwrites cleanly.
 */

export type Environment = "development" | "preview" | "production";

export interface EnvironmentConfig {
  /** Source adapter id, e.g. 'flow-hosted', 'aws-secrets-manager'. */
  source: string;

  /** Env-var names this integration produces in the user's app. */
  envVars: string[];

  /** ISO timestamp of when this entry was last written. */
  configured_at: string;

  /** AWS Secrets Manager — secret identifier (name or ARN). */
  secretName?: string;

  /** AWS Secrets Manager — region. */
  region?: string;

  // Vault / Azure / GCP source-specific fields land here when their adapters do.
}

export interface IntegrationConfig {
  development?: EnvironmentConfig;
  preview?: EnvironmentConfig;
  production?: EnvironmentConfig;
}

export interface IntegrationManifest {
  integrations: Record<string, IntegrationConfig>;
}

const MANIFEST_DIR = ".flow";
const MANIFEST_FILE = "integrations.json";

/**
 * Walk up from `start` looking for a directory that has package.json.
 * Returns that directory. Falls back to `start` if no package.json is found.
 *
 * The CLI wants to write the manifest at the *project* root, not wherever
 * the SRE happens to invoke from inside the project tree.
 */
export function findProjectRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  while (true) {
    if (existsSync(join(dir, "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start); // hit FS root, fall back
    dir = parent;
  }
}

export function manifestPath(projectRoot: string = findProjectRoot()): string {
  return join(projectRoot, MANIFEST_DIR, MANIFEST_FILE);
}

/**
 * Detect the legacy pre-KV shape so first-write doesn't trip on it.
 */
function isLegacyShape(parsed: unknown): boolean {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    "project_name" in obj &&
    "initialized_at" in obj &&
    "stack" in obj &&
    Array.isArray(obj.environments)
  );
}

function isShapeA(parsed: unknown): parsed is IntegrationManifest {
  if (typeof parsed !== "object" || parsed === null) return false;
  const obj = parsed as Record<string, unknown>;
  return (
    "integrations" in obj &&
    typeof obj.integrations === "object" &&
    obj.integrations !== null &&
    !Array.isArray(obj.integrations)
  );
}

/**
 * Load the manifest. Returns an empty manifest if the file is missing or
 * contains the legacy pre-KV shape (which is treated as empty).
 *
 * Throws UserError if the file exists but contains JSON that's neither
 * legacy nor Shape A — that means someone hand-edited it into a broken
 * state and we shouldn't silently overwrite their work.
 */
export function loadManifest(projectRoot: string = findProjectRoot()): IntegrationManifest {
  const path = manifestPath(projectRoot);
  if (!existsSync(path)) {
    return { integrations: {} };
  }
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new UserError(
      `Could not read ${path}.`,
      `Check filesystem permissions, then try again. Underlying error: ${(err as Error).message}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new UserError(
      `${path} is not valid JSON.`,
      `Open the file and fix the syntax error, or delete it and re-run \`flow setup production\`.\nUnderlying error: ${(err as Error).message}`
    );
  }
  if (isLegacyShape(parsed)) {
    return { integrations: {} };
  }
  if (isShapeA(parsed)) {
    return parsed;
  }
  throw new UserError(
    `${path} has an unrecognized shape.`,
    `The CLI expects Shape A (integration-first). If you hand-edited the file, restore the expected shape or delete it and re-run \`flow setup production\` to recreate it.`
  );
}

/**
 * Atomic write — write to a sibling temp file, then rename. Avoids the
 * partial-write window where readers see a half-written manifest.
 */
export function saveManifest(
  manifest: IntegrationManifest,
  projectRoot: string = findProjectRoot()
): void {
  const path = manifestPath(projectRoot);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmp = `${path}.tmp-${process.pid}`;
  const json = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(tmp, json, "utf8");
  renameSync(tmp, path);
}

/**
 * Read-modify-write helper. Sets `config` for `integration` × `env`,
 * preserving every other env in that integration and every other
 * integration in the manifest.
 */
export function setIntegrationEnv(
  integration: string,
  env: Environment,
  config: EnvironmentConfig,
  projectRoot: string = findProjectRoot()
): IntegrationManifest {
  const manifest = loadManifest(projectRoot);
  const existing: IntegrationConfig = manifest.integrations[integration] ?? {};
  manifest.integrations[integration] = {
    ...existing,
    [env]: config,
  };
  saveManifest(manifest, projectRoot);
  return manifest;
}
