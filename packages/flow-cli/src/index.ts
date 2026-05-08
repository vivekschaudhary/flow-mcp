import { Command } from "commander";
import { reportError, installCancellationHandler } from "./lib/errors.js";
import { setupProductionCommand } from "./commands/setup.js";
import { statusCommand } from "./commands/status.js";
import { auditCommand } from "./commands/audit.js";
import { loginCommand } from "./commands/login.js";

/**
 * CLI entry. commander wires subcommands; each command function returns
 * an exit code (or throws a FlowError, which the top-level handler maps
 * to an exit code via reportError).
 */

installCancellationHandler();

const program = new Command();

program
  .name("flow")
  .description("Flow CLI — production credential setup for projects using flow-vault.\nThe canonical interface that the MCP tool flow_setup_production redirects to.")
  .version("0.0.1");

const setup = program
  .command("setup")
  .description("Set up an integration for an environment");

setup
  .command("production")
  .description("Configure production credentials for an integration")
  .requiredOption("--integration <id>", "Integration id (e.g. google-oauth-web, email_provider)")
  .option("--source <id>", "Source adapter id (e.g. aws-secrets-manager, flow-hosted). When set, the CLI runs non-interactively for source-related prompts.")
  .option("--auth-method <id>", "Auth method id for the source (e.g. iam-access-keys, oidc-federation)")
  .option("--secret-name <name>", "Secret identifier in the source (e.g. prod/myapp/google-oauth)")
  .option("--region <region>", "AWS region (e.g. us-east-1) — required for aws-secrets-manager")
  .option("--env-vars <list>", "Comma-separated env-var names this secret produces (defaults from the integration's known mapping)", (v: string) =>
    v.split(",").map((s) => s.trim()).filter(Boolean)
  )
  .option("--skip-staging", "Do not configure preview/staging — only production")
  .option("--with-preview", "Configure preview/staging in addition to production (requires --preview-secret-name in non-interactive mode)")
  .option("--preview-secret-name <name>", "Secret identifier to use for preview (only used with --with-preview)")
  .action(async (opts) => {
    try {
      const code = await setupProductionCommand({
        integration: opts.integration,
        source: opts.source,
        authMethod: opts.authMethod,
        secretName: opts.secretName,
        region: opts.region,
        envVars: opts.envVars,
        skipStaging: Boolean(opts.skipStaging),
        withPreview: Boolean(opts.withPreview),
        previewSecretName: opts.previewSecretName,
      });
      process.exit(code);
    } catch (err) {
      process.exit(reportError(err));
    }
  });

program
  .command("status")
  .description("Show the per-integration / per-environment source adapter matrix from .flow/integrations.json")
  .action(async () => {
    try {
      const code = await statusCommand();
      process.exit(code);
    } catch (err) {
      process.exit(reportError(err));
    }
  });

program
  .command("audit")
  .description("Diff the manifest against the actual store (stub — coming in v0.2.1)")
  .action(async () => {
    try {
      const code = await auditCommand();
      process.exit(code);
    } catch (err) {
      process.exit(reportError(err));
    }
  });

program
  .command("login")
  .description("Replace the install_id model with a GitHub-OAuth session (stub — coming in v0.3)")
  .action(async () => {
    try {
      const code = await loginCommand();
      process.exit(code);
    } catch (err) {
      process.exit(reportError(err));
    }
  });

program.parseAsync(process.argv).catch((err) => {
  process.exit(reportError(err));
});
