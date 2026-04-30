/**
 * Playbook loader and step executor
 * Loads playbook JSON, walks steps, surfaces warnings
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PlaybookStep {
  id: string;
  type: "navigate" | "action" | "select" | "input" | "capture" | "flow";
  title: string;
  url?: string;
  instruction?: string;
  notes?: string;
  warning?: string;
  values?: string[];
  library_variants?: Record<string, string[]>;
  common_mistakes?: string[];
  credential_paths?: Record<string, string>;
  automated?: boolean;
}

export interface PlaybookWarning {
  id: string;
  severity: "blocking" | "high" | "medium" | "low";
  trigger: string;
  message: string;
  days_before?: number;
  url?: string;
}

export interface Prerequisite {
  id: string;
  description: string;
  check: string;
  if_missing?: string;
  gotcha?: boolean;
  url?: string;
}

export interface CredentialEmitted {
  key: string;
  description: string;
  format: string;
  required: boolean;
  source: string;
}

export interface Playbook {
  id: string;
  name: string;
  version: string;
  verified_at: string;
  confidence: number;
  estimated_time_expert: string;
  estimated_time_first_timer: string;
  provider: string;
  platform: string;
  credentials_emitted: CredentialEmitted[];
  prerequisites: Prerequisite[];
  steps: PlaybookStep[];
  warnings: PlaybookWarning[];
  common_errors: Array<{
    error: string;
    cause: string;
    fix: string;
  }>;
}

export function loadPlaybook(id: string): Playbook | null {
  // Look in src/playbooks relative to this file
  const playbookPath = path.join(
    __dirname,
    "..",
    "playbooks",
    `${id}.json`
  );

  if (!fs.existsSync(playbookPath)) {
    // Try the dist path
    const distPath = path.join(
      __dirname,
      "playbooks",
      `${id}.json`
    );
    if (!fs.existsSync(distPath)) return null;
    return JSON.parse(fs.readFileSync(distPath, "utf-8"));
  }

  return JSON.parse(fs.readFileSync(playbookPath, "utf-8"));
}

export function listPlaybooks(): string[] {
  const playbookDir = path.join(__dirname, "..", "playbooks");
  if (!fs.existsSync(playbookDir)) return [];
  return fs
    .readdirSync(playbookDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(".json", ""));
}

export function getWarnings(
  playbook: Playbook,
  trigger: string
): PlaybookWarning[] {
  return playbook.warnings.filter((w) => w.trigger === trigger);
}

export function formatStepForClaude(
  step: PlaybookStep,
  authLibrary?: string
): string {
  const lines: string[] = [`**${step.title}**`];

  if (step.url) {
    lines.push(`→ Navigate to: ${step.url}`);
  }

  if (step.instruction) {
    lines.push(`→ ${step.instruction}`);
  }

  if (step.notes) {
    lines.push(`ℹ️ ${step.notes}`);
  }

  if (step.warning) {
    lines.push(`⚠️ ${step.warning}`);
  }

  if (step.values) {
    lines.push(`Add these values:`);
    step.values.forEach((v) => lines.push(`  • ${v}`));
  }

  // Show library-specific redirect URIs if relevant
  if (step.library_variants && authLibrary) {
    const variant = step.library_variants[authLibrary];
    if (variant) {
      lines.push(`For ${authLibrary}, add these redirect URIs:`);
      variant.forEach((v) => lines.push(`  • ${v}`));
    }
  }

  if (step.common_mistakes?.length) {
    lines.push(`Common mistakes to avoid:`);
    step.common_mistakes.forEach((m) => lines.push(`  ✗ ${m}`));
  }

  return lines.join("\n");
}

export function formatPlaybookSummary(playbook: Playbook): string {
  const lines: string[] = [
    `**${playbook.name}** (v${playbook.version})`,
    `Verified: ${playbook.verified_at} | Confidence: ${Math.round(playbook.confidence * 100)}%`,
    `Time: ~${playbook.estimated_time_first_timer} for first-timers`,
    ``,
    `Credentials this will configure:`,
    ...playbook.credentials_emitted.map((c) => `  • ${c.key}`),
    ``,
    `${playbook.steps.length} steps total`,
  ];

  const blockingWarnings = playbook.warnings.filter(
    (w) => w.severity === "blocking"
  );
  if (blockingWarnings.length > 0) {
    lines.push(``, `⚠️ Before you start:`);
    blockingWarnings.forEach((w) => lines.push(`  • ${w.message}`));
  }

  return lines.join("\n");
}
