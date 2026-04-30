/**
 * Flow project state — reads and writes .flow/integrations.json
 * This is the source of truth for what is configured in this project
 */

import fs from "fs";
import path from "path";
import os from "os";

export interface IntegrationState {
  id: string;
  status: "not_configured" | "in_progress" | "configured" | "expiring" | "expired";
  configured_at?: string;
  credentials: Record<string, string>;
  environments_synced: string[];
  warnings_acknowledged: string[];
  playbook_version: string;
}

export interface ProjectState {
  project_name: string;
  initialized_at: string;
  stack: string[];
  environments: string[];
  dev_env_file?: string;
  integrations: Record<string, IntegrationState>;
}

const FLOW_DIR = ".flow";
const STATE_FILE = "integrations.json";
const CREDENTIALS_FILE = "credentials.json"; // gitignored

export function getFlowDir(projectRoot?: string): string {
  return path.join(projectRoot || process.cwd(), FLOW_DIR);
}

export function getStatePath(projectRoot?: string): string {
  return path.join(getFlowDir(projectRoot), STATE_FILE);
}

export function getCredentialsPath(projectRoot?: string): string {
  return path.join(getFlowDir(projectRoot), CREDENTIALS_FILE);
}

export function readState(projectRoot?: string): ProjectState | null {
  const statePath = getStatePath(projectRoot);
  if (!fs.existsSync(statePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(statePath, "utf-8"));
  } catch {
    return null;
  }
}

export function writeState(state: ProjectState, projectRoot?: string): void {
  const flowDir = getFlowDir(projectRoot);
  if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });
  fs.writeFileSync(getStatePath(projectRoot), JSON.stringify(state, null, 2));
}

export function readCredentials(projectRoot?: string): Record<string, string> {
  const credPath = getCredentialsPath(projectRoot);
  if (!fs.existsSync(credPath)) return {};
  try {
    return JSON.parse(fs.readFileSync(credPath, "utf-8"));
  } catch {
    return {};
  }
}

export function writeCredentials(
  creds: Record<string, string>,
  projectRoot?: string
): void {
  const flowDir = getFlowDir(projectRoot);
  if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });
  // Merge with existing credentials
  const existing = readCredentials(projectRoot);
  const merged = { ...existing, ...creds };
  fs.writeFileSync(
    getCredentialsPath(projectRoot),
    JSON.stringify(merged, null, 2)
  );
}

export function updateIntegrationStatus(
  integrationId: string,
  status: IntegrationState["status"],
  extras?: Partial<IntegrationState>,
  projectRoot?: string
): void {
  const state = readState(projectRoot);
  if (!state) throw new Error("Flow not initialized. Run npx flow init first.");

  state.integrations[integrationId] = {
    ...(state.integrations[integrationId] || {
      id: integrationId,
      credentials: {},
      environments_synced: [],
      warnings_acknowledged: [],
      playbook_version: "unknown",
    }),
    status,
    ...extras,
  };

  writeState(state, projectRoot);
}

export function initializeState(
  projectName: string,
  stack: string[],
  environments: string[]
): ProjectState {
  return {
    project_name: projectName,
    initialized_at: new Date().toISOString(),
    stack,
    environments,
    integrations: {},
  };
}
