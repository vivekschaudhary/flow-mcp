import { plain, dim, header, section, success, step, withSpinner, ICON } from "../lib/output.js";
import { pickList, text } from "../lib/prompts.js";
import { UserError } from "../lib/errors.js";
import { ADAPTERS, getAdapter, type SourceAdapter, type AuthCredentials } from "../adapters/index.js";
import {
  setIntegrationEnv,
  findProjectRoot,
  manifestPath,
  type EnvironmentConfig,
} from "../lib/manifest.js";
import { defaultEnvVarsFor, displayNameFor } from "../lib/integrations.js";

/**
 * `flow setup production --integration <id>` — the canonical production
 * credential setup flow. Walks the SRE through:
 *
 *   1. Picking a source adapter (AWS today; Vault/Azure/GCP stubs visible).
 *   2. Picking an auth method (IAM access keys today; OIDC stub visible).
 *   3. Collecting credentials (hidden input for secrets).
 *   4. Listing/selecting a secret in that source.
 *   5. Validating IAM access to that secret.
 *   6. Mapping the secret's contents to env-var names.
 *   7. Optionally configuring `preview` with the same or different secret.
 *   8. Writing .flow/integrations.json (Shape A).
 *
 * Non-interactive mode: if `--source` is provided, every other prompt
 * accepts its corresponding flag. Missing required flags become errors
 * (not prompts) so the command is safe to run in CI / runbooks.
 *
 * AWS access keys are NEVER written to .flow/integrations.json. They
 * live in the SRE's environment (FLOW_AWS_ACCESS_KEY_ID /
 * FLOW_AWS_SECRET_ACCESS_KEY) for non-interactive mode, or in process
 * memory only for interactive mode.
 */

export interface SetupProductionOptions {
  integration: string;
  source?: string;
  authMethod?: string;
  secretName?: string;
  region?: string;
  envVars?: string[];
  skipStaging?: boolean;
  withPreview?: boolean;
  previewSecretName?: string;
}

function isNonInteractive(opts: SetupProductionOptions): boolean {
  // Treat as non-interactive when --source is explicitly provided OR
  // when we don't have a TTY (CI, piped, etc).
  if (opts.source) return true;
  if (process.stdout.isTTY === false || process.stdin.isTTY === false) return true;
  return false;
}

function requireFlag(opts: SetupProductionOptions, name: keyof SetupProductionOptions, flagName: string): string {
  const value = opts[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new UserError(
      `Non-interactive mode requires --${flagName}.`,
      `Either pass --${flagName} <value> or run interactively (omit --source so the CLI prompts).`
    );
  }
  return value;
}

async function pickSource(opts: SetupProductionOptions): Promise<SourceAdapter> {
  if (opts.source) {
    const adapter = getAdapter(opts.source);
    if (!adapter) {
      throw new UserError(
        `Unknown source '${opts.source}'.`,
        `Available sources: ${ADAPTERS.map((a) => a.id).join(", ")}.`
      );
    }
    return adapter;
  }
  const choices = ADAPTERS.map((a) => ({
    name: a.displayName,
    value: a.id,
    hint: a.pickerHint ? `  ${a.pickerHint}` : undefined,
  }));
  const picked = await pickList("Where are your secrets stored?", choices);
  return getAdapter(picked)!;
}

async function pickAuthMethod(adapter: SourceAdapter, opts: SetupProductionOptions): Promise<string> {
  if (opts.authMethod) {
    const found = adapter.authMethods.find((m) => m.id === opts.authMethod);
    if (!found) {
      throw new UserError(
        `Unknown auth method '${opts.authMethod}' for ${adapter.displayName}.`,
        `Available: ${adapter.authMethods.map((m) => m.id).join(", ")}.`
      );
    }
    return found.id;
  }
  if (adapter.authMethods.length === 1) {
    return adapter.authMethods[0]!.id;
  }
  const choices = adapter.authMethods.map((m) => ({
    name: m.displayName,
    value: m.id,
    hint: m.hint,
  }));
  return pickList("Authentication method?", choices);
}

async function pickSecret(
  adapter: SourceAdapter,
  creds: AuthCredentials,
  opts: SetupProductionOptions
): Promise<string> {
  if (opts.secretName) return opts.secretName;
  if (isNonInteractive(opts)) {
    return requireFlag(opts, "secretName", "secret-name");
  }

  const secrets = await withSpinner(
    `Connecting to ${adapter.displayName}…`,
    () => adapter.listSecrets(creds),
    { successText: `Connected to ${adapter.displayName}.` }
  );

  if (secrets.length === 0) {
    throw new UserError(
      `No secrets found in this ${adapter.displayName} account / region.`,
      "Create the secret in the provider's console first, then run `flow setup production` again."
    );
  }

  dim(`  Found ${secrets.length} secret${secrets.length === 1 ? "" : "s"}.`);
  plain("");
  const choices = secrets.map((s) => ({ name: s.name, value: s.name }));
  return pickList("Which secret stores the credentials?", choices);
}

async function pickEnvVars(integrationId: string, opts: SetupProductionOptions): Promise<string[]> {
  if (opts.envVars && opts.envVars.length > 0) return opts.envVars;

  const defaults = defaultEnvVarsFor(integrationId);

  if (isNonInteractive(opts)) {
    if (defaults) return defaults;
    throw new UserError(
      `--env-vars is required for unknown integration '${integrationId}' in non-interactive mode.`,
      `Pass --env-vars VAR1,VAR2 or run interactively (omit --source).`
    );
  }

  if (defaults) {
    const useDefault = await pickList(
      "Map this secret to which environment variables?",
      [
        {
          name: `${defaults.join(", ")}`,
          value: "default",
          hint: `(default for ${integrationId})`,
        },
        { name: "Custom mapping…", value: "custom" },
      ],
      "default"
    );
    if (useDefault === "default") return defaults;
  }

  const raw = await text(
    "Comma-separated list of env-var names this secret produces:",
    {
      validate: (v) => {
        const list = v.split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length === 0) return "Provide at least one env var name.";
        if (!list.every((n) => /^[A-Z][A-Z0-9_]*$/.test(n))) {
          return "Env var names should be UPPER_SNAKE_CASE (e.g. GOOGLE_CLIENT_ID).";
        }
        return true;
      },
    }
  );
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

async function decidePreview(
  opts: SetupProductionOptions,
  productionConfig: EnvironmentConfig
): Promise<EnvironmentConfig | null> {
  if (opts.skipStaging) return null;
  if (opts.withPreview === false) return null;

  if (isNonInteractive(opts)) {
    // In non-interactive mode, default to skipping preview unless the SRE
    // explicitly opts in. A quiet skip is safer than auto-applying prod's
    // secret to preview without asking.
    if (!opts.withPreview) return null;
    if (!opts.previewSecretName) {
      throw new UserError(
        "--with-preview requires --preview-secret-name in non-interactive mode.",
        "Pass --preview-secret-name <name> or run interactively."
      );
    }
    return {
      source: productionConfig.source,
      envVars: productionConfig.envVars,
      configured_at: new Date().toISOString(),
      secretName: opts.previewSecretName,
      region: productionConfig.region,
    };
  }

  const choice = await pickList("Set up preview too?", [
    { name: "Same secret as production", value: "same" },
    { name: "Different secret in the same source", value: "different" },
    { name: "Use Flow shared dev credentials", value: "flow-hosted" },
    { name: "Skip preview", value: "skip" },
  ]);

  if (choice === "skip") return null;

  if (choice === "flow-hosted") {
    return {
      source: "flow-hosted",
      envVars: productionConfig.envVars,
      configured_at: new Date().toISOString(),
    };
  }

  if (choice === "same") {
    return {
      source: productionConfig.source,
      envVars: productionConfig.envVars,
      secretName: productionConfig.secretName,
      region: productionConfig.region,
      configured_at: new Date().toISOString(),
    };
  }

  // "different" — same source, different secret name
  const previewSecret = await text("Preview secret name:", {
    validate: (v) => (v.length > 0 ? true : "Provide a secret name."),
  });
  return {
    source: productionConfig.source,
    envVars: productionConfig.envVars,
    secretName: previewSecret,
    region: productionConfig.region,
    configured_at: new Date().toISOString(),
  };
}

function printNextSteps(productionConfig: EnvironmentConfig, previewConfig: EnvironmentConfig | null): void {
  section("Next steps");
  step("1. Commit .flow/integrations.json to your repo (no secret values inside).");

  if (productionConfig.source === "aws-secrets-manager") {
    step([
      "2. Set the AWS credentials your production compute uses:",
      "     FLOW_AWS_ACCESS_KEY_ID and FLOW_AWS_SECRET_ACCESS_KEY",
      `     in your deployment env (Vercel / Fly / Railway / etc.). Region is in the manifest (${productionConfig.region}).`,
    ].join("\n"));
  } else if (productionConfig.source === "flow-hosted") {
    step("2. No additional credentials needed in production — the runtime authenticates via the install_id stored in your OS keychain.");
  }

  step([
    "3. Deploy. Once flow-vault v0.3 ships (runtime resolution of non-hosted",
    `   sources), \`process.env.${productionConfig.envVars[0] ?? "X"}\` will resolve from`,
    `   ${productionConfig.source} at app boot using the mapping in .flow/integrations.json.`,
    "",
    "   Until v0.3 lands, the manifest is correctly configured but production",
    "   app boots still pull from the hosted source. flow status shows what's wired.",
  ].join("\n"));

  if (previewConfig) {
    plain("");
    dim(`  Preview environment also configured (source: ${previewConfig.source}${previewConfig.secretName ? `, secret: ${previewConfig.secretName}` : ""}).`);
  }
  plain("");
}

export async function setupProductionCommand(opts: SetupProductionOptions): Promise<number> {
  if (!opts.integration) {
    throw new UserError(
      "--integration is required.",
      "Example: flow setup production --integration google-oauth-web"
    );
  }

  header(`Setting up ${displayNameFor(opts.integration)} for production.`);
  if (opts.integration !== displayNameFor(opts.integration)) {
    dim(`  Integration id: ${opts.integration}`);
  }
  plain("");

  const adapter = await pickSource(opts);
  const authMethodId = await pickAuthMethod(adapter, opts);
  const creds = await adapter.promptCredentials(authMethodId);

  let productionConfig: EnvironmentConfig;

  if (adapter.id === "flow-hosted") {
    // Hosted source: skip secret picker, skip env-var custom mapping —
    // the integration's defaults are what flow-vault resolves at boot
    // via the install_id.
    const envVars = await pickEnvVars(opts.integration, opts);
    productionConfig = {
      source: adapter.id,
      envVars,
      configured_at: new Date().toISOString(),
    };
  } else {
    // External source: pick secret, validate access, pick env vars
    const secretName = await pickSecret(adapter, creds, opts);
    const region = (creds as { region?: string }).region;

    await withSpinner(
      `Validating access to '${secretName}'…`,
      async () => {
        const result = await adapter.validateAccess(creds, secretName);
        if (!result.ok) {
          const hint = [result.reason ?? "Validation failed."];
          if (result.iamPolicySnippet) {
            hint.push("");
            hint.push("Add this to your IAM policy:");
            hint.push("");
            hint.push(result.iamPolicySnippet);
          }
          throw new UserError(`Cannot read secret '${secretName}'.`, hint.join("\n"));
        }
      },
      { successText: `Access to '${secretName}' confirmed.` }
    );

    const envVars = await pickEnvVars(opts.integration, opts);

    productionConfig = {
      source: adapter.id,
      envVars,
      configured_at: new Date().toISOString(),
      secretName,
      ...(region ? { region } : {}),
    };
  }

  // Optional preview environment
  const previewConfig = await decidePreview(opts, productionConfig);

  // Write the manifest
  const projectRoot = findProjectRoot();
  setIntegrationEnv(opts.integration, "production", productionConfig, projectRoot);
  if (previewConfig) {
    setIntegrationEnv(opts.integration, "preview", previewConfig, projectRoot);
  }

  plain("");
  success(`Updated ${manifestPath(projectRoot)}`);
  success("Production credential mapping configured");
  if (previewConfig) success("Preview credential mapping configured");

  printNextSteps(productionConfig, previewConfig);
  return 0;
}

// Used by the commander wiring to surface ICON without import gymnastics
export { ICON };
