import chalk from "chalk";
import ora, { type Ora } from "ora";

/**
 * Output helpers. Match the tone of well-loved CLIs (Vercel, Stripe, GitHub):
 * direct, honest, confident without being chatty. Every line printed should
 * pass the "would I want to read this at 2am before a deploy" test.
 *
 * Icons are used sparingly — only where they earn their place:
 *   ✓  success
 *   ✗  failure
 *   →  next step
 *   ⚠  warning (rare; reserve for things the SRE genuinely needs to notice)
 */

export const ICON = {
  success: chalk.green("✓"),
  failure: chalk.red("✗"),
  arrow: chalk.cyan("→"),
  warning: chalk.yellow("⚠"),
} as const;

export function success(message: string): void {
  console.log(`${ICON.success} ${message}`);
}

export function failure(message: string): void {
  console.error(`${ICON.failure} ${message}`);
}

export function warn(message: string): void {
  console.error(`${ICON.warning} ${message}`);
}

export function step(message: string): void {
  console.log(`${ICON.arrow} ${message}`);
}

export function plain(message = ""): void {
  console.log(message);
}

export function dim(message: string): void {
  console.log(chalk.dim(message));
}

export function header(title: string): void {
  console.log(`\n${chalk.bold(title)}`);
}

export function section(title: string): void {
  console.log(`\n${chalk.bold(title)}`);
}

/**
 * Wrap an async operation with a spinner. Returns whatever the function
 * returns. On rejection, the spinner is failed and the error rethrown.
 */
export async function withSpinner<T>(
  text: string,
  fn: () => Promise<T>,
  options: { successText?: string; failText?: string } = {}
): Promise<T> {
  const spinner: Ora = ora({ text, spinner: "dots" }).start();
  try {
    const result = await fn();
    spinner.succeed(options.successText ?? text);
    return result;
  } catch (err) {
    spinner.fail(options.failText ?? text);
    throw err;
  }
}

/**
 * Render a labelled key/value pair for `flow status`-style output.
 * Aligns the value column at a fixed offset so columns line up across rows.
 */
export function kv(label: string, value: string, labelWidth = 12): void {
  const padded = label.padEnd(labelWidth);
  console.log(`  ${chalk.dim(padded)} ${value}`);
}

/**
 * Render an inline status pill — e.g. "✓ configured" or "✗ not configured".
 */
export function statusPill(ok: boolean, label: string): string {
  return ok ? `${ICON.success} ${chalk.green(label)}` : `${ICON.failure} ${chalk.dim(label)}`;
}

export { chalk };
