import { select, password as _password, input, confirm as _confirm } from "@inquirer/prompts";
import { CancelledError } from "./errors.js";

/**
 * Thin wrappers over @inquirer/prompts. Two responsibilities:
 *
 *   1. Translate the modular API's ExitPromptError (SIGINT) into our
 *      CancelledError so the top-level handler exits with code 130 and
 *      the standard message.
 *
 *   2. Provide a consistent ChoiceItem shape (with optional hint) so the
 *      picker UX is uniform across the CLI (e.g. "(available now)",
 *      "(planned, v0.3)").
 *
 * No business logic lives here — purely UX.
 */

export interface ChoiceItem {
  name: string;       // displayed
  value: string;      // returned
  hint?: string;      // appended in dim, e.g. "(planned, v0.3)"
}

function decorateName(item: ChoiceItem): string {
  return item.hint ? `${item.name}  ${item.hint}` : item.name;
}

async function withCancellation<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    if (name === "ExitPromptError" || name === "AbortPromptError") {
      throw new CancelledError();
    }
    throw err;
  }
}

export async function pickList(
  message: string,
  choices: ChoiceItem[],
  defaultValue?: string
): Promise<string> {
  return withCancellation(() =>
    select<string>({
      message,
      choices: choices.map((c) => ({ name: decorateName(c), value: c.value })),
      default: defaultValue,
      pageSize: Math.min(15, Math.max(5, choices.length)),
    })
  );
}

export async function password(message: string): Promise<string> {
  return withCancellation(() => _password({ message, mask: true }));
}

export async function text(
  message: string,
  options: { default?: string; validate?: (v: string) => true | string } = {}
): Promise<string> {
  return withCancellation(() =>
    input({
      message,
      default: options.default,
      validate: options.validate,
    })
  );
}

export async function confirm(message: string, defaultValue = true): Promise<boolean> {
  return withCancellation(() => _confirm({ message, default: defaultValue }));
}
