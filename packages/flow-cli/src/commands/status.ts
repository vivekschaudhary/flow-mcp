import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { plain, dim, header, statusPill, kv, ICON } from "../lib/output.js";
import {
  findProjectRoot,
  loadManifest,
  manifestPath,
  type Environment,
  type EnvironmentConfig,
} from "../lib/manifest.js";

/**
 * `flow status` — print the per-integration / per-environment source
 * adapter matrix from .flow/integrations.json.
 *
 * Output format (matches the PR2 spec):
 *
 *   Project: my-saas-app
 *   Manifest: .flow/integrations.json
 *
 *   Integrations:
 *     google-oauth-web
 *       development: flow-hosted              ✓ configured
 *       preview:     aws-secrets-manager      ✓ configured (staging/myapp/google-oauth)
 *       production:  aws-secrets-manager      ✓ configured (prod/myapp/google-oauth)
 *
 *     email_provider
 *       development: flow-hosted              ✓ configured
 *       preview:     not configured           ✗
 *       production:  not configured           ✗
 *
 *   Source adapters in use:
 *     aws-secrets-manager    region: us-east-1
 *     flow-hosted            (Flow shared dev sandbox)
 *
 *   → Run flow setup production --integration <id> to configure
 *     preview or production for an integration.
 */

const ENVS: Environment[] = ["development", "preview", "production"];
const ENV_LABEL: Record<Environment, string> = {
  development: "development",
  preview: "preview    ",  // padded for alignment in the matrix
  production: "production ",
};

interface ProjectInfo {
  name: string;
  packageJsonPath: string;
}

function readProjectInfo(root: string): ProjectInfo | null {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
    if (typeof pkg.name === "string") {
      return { name: pkg.name, packageJsonPath: pkgPath };
    }
  } catch {
    // ignore — surfaces below as "(unknown project)"
  }
  return null;
}

function envCellLabel(envConfig: EnvironmentConfig | undefined): string {
  if (!envConfig) return statusPill(false, "not configured");
  const tail = envConfig.secretName ? ` (${envConfig.secretName})` : "";
  return `${statusPill(true, "configured")}${tail}`;
}

function envSourceCell(envConfig: EnvironmentConfig | undefined): string {
  return envConfig?.source ?? "—";
}

export async function statusCommand(): Promise<number> {
  const root = findProjectRoot();
  const project = readProjectInfo(root);
  const manifestFile = manifestPath(root);

  header("flow status");
  plain("");
  kv("Project", project?.name ?? "(unknown — no package.json found)");
  kv("Manifest", manifestFile);

  const manifest = loadManifest(root);
  const integrationIds = Object.keys(manifest.integrations);

  if (integrationIds.length === 0) {
    plain("");
    plain("No integrations configured yet.");
    plain("");
    dim(`  ${ICON.arrow} Run \`flow setup production --integration <id>\` to configure one.`);
    plain("");
    return 0;
  }

  plain("");
  plain("Integrations:");
  for (const id of integrationIds) {
    plain("");
    plain(`  ${id}`);
    const config = manifest.integrations[id]!;
    for (const env of ENVS) {
      const envCfg = config[env];
      const sourcePart = envSourceCell(envCfg).padEnd(22);
      plain(`    ${ENV_LABEL[env]} ${sourcePart} ${envCellLabel(envCfg)}`);
    }
  }

  // Source adapters in use — collect distinct sources + regions
  const sourcesInUse = new Map<string, Set<string>>();
  for (const id of integrationIds) {
    const config = manifest.integrations[id]!;
    for (const env of ENVS) {
      const envCfg = config[env];
      if (!envCfg) continue;
      if (!sourcesInUse.has(envCfg.source)) sourcesInUse.set(envCfg.source, new Set());
      if (envCfg.region) sourcesInUse.get(envCfg.source)!.add(envCfg.region);
    }
  }

  if (sourcesInUse.size > 0) {
    plain("");
    plain("Source adapters in use:");
    for (const [source, regions] of sourcesInUse) {
      const detail =
        source === "flow-hosted"
          ? "(Flow shared dev sandbox)"
          : regions.size > 0
            ? `region: ${[...regions].join(", ")}`
            : "";
      plain(`  ${source.padEnd(22)} ${detail}`);
    }
  }

  plain("");
  dim(`  ${ICON.arrow} Run \`flow setup production --integration <id>\` to configure preview or production for an integration.`);
  plain("");
  return 0;
}
