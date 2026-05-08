import { failure, plain, dim, ICON } from "./output.js";

/**
 * Standard CLI exit codes:
 *   0   — success
 *   1   — user error (invalid input, missing flag, integration unknown)
 *   2   — service error (AWS unreachable, auth failed, network)
 *   130 — user cancelled (ctrl-c at any prompt)
 *
 * Throw a FlowError to fail with an exit code and a formatted message.
 * Anything else thrown is caught at the top level and reported as exit 1.
 */
export type ExitCode = 0 | 1 | 2 | 130;

export class FlowError extends Error {
  readonly exitCode: ExitCode;
  readonly hint?: string;

  constructor(message: string, exitCode: ExitCode = 1, hint?: string) {
    super(message);
    this.name = "FlowError";
    this.exitCode = exitCode;
    this.hint = hint;
  }
}

export class UserError extends FlowError {
  constructor(message: string, hint?: string) {
    super(message, 1, hint);
    this.name = "UserError";
  }
}

export class ServiceError extends FlowError {
  constructor(message: string, hint?: string) {
    super(message, 2, hint);
    this.name = "ServiceError";
  }
}

export class CancelledError extends FlowError {
  constructor() {
    super("Setup cancelled. No changes written to .flow/integrations.json.", 130);
    this.name = "CancelledError";
  }
}

/**
 * Print a FlowError for display. Format:
 *   ✗ <message>
 *     <hint>          (dimmed, indented)
 */
export function reportError(err: unknown): ExitCode {
  if (err instanceof CancelledError) {
    plain("");
    failure(err.message);
    return err.exitCode;
  }

  if (err instanceof FlowError) {
    failure(err.message);
    if (err.hint) {
      plain("");
      // Render multi-line hints with consistent indent
      for (const line of err.hint.split("\n")) {
        dim(`  ${line}`);
      }
    }
    return err.exitCode;
  }

  // Unknown — most likely a programming error. Surface what we can without
  // assuming the message is safe to dump verbatim.
  const message = err instanceof Error ? err.message : String(err);
  failure(`Unexpected error — ${message}`);
  if (err instanceof Error && err.stack) {
    plain("");
    dim("  Run again with FLOW_DEBUG=1 to see the full stack trace.");
    if (process.env.FLOW_DEBUG) {
      plain(err.stack);
    }
  }
  return 1;
}

/**
 * Install the SIGINT handler so ctrl-c at any prompt prints the standard
 * cancellation message and exits 130 cleanly. inquirer also throws on
 * SIGINT, but having the handler ensures we always exit with the right
 * code and message.
 */
export function installCancellationHandler(): void {
  process.on("SIGINT", () => {
    plain("");
    failure("Setup cancelled. No changes written to .flow/integrations.json.");
    process.exit(130);
  });
}

export { ICON };
