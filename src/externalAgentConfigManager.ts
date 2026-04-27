import * as fs from "fs";
import * as path from "path";
import {
  getWorkspaceMcpLauncherPath,
} from "./mcpConfigManager";
import { renderWorkspaceExternalAgentLauncherScript } from "./externalAgentLauncherScript";

export const EXTERNAL_AGENT_KEY_ENV_VAR = "COPILOT_COCKPIT_EXTERNAL_AGENT_KEY";
export const EXTERNAL_AGENT_REPO_ID_ENV_VAR = "COPILOT_COCKPIT_EXTERNAL_AGENT_REPO_ID";
const EXTERNAL_AGENT_SUPPORT_DIR_PARTS = [
  ".vscode",
  "copilot-cockpit-support",
  "external-agent",
] as const;

export type ExternalAgentLauncherState = {
  version: 1;
  repoId: string;
  workspaceRoot: string;
  controlSocketPath: string;
  innerLauncherPath: string;
  keyEnvVarName: string;
  repoIdEnvVarName: string;
  heartbeatIntervalMs: number;
  updatedAt: string;
};

export type ExternalAgentSupportWriteResult = {
  supportDirectory: string;
  launcherPath: string;
  statePath: string;
  createdDirectory: boolean;
  launcherUpdated: boolean;
  stateUpdated: boolean;
};

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

export function getWorkspaceExternalAgentSupportDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...EXTERNAL_AGENT_SUPPORT_DIR_PARTS);
}

export function getWorkspaceExternalAgentLauncherPath(workspaceRoot: string): string {
  return path.join(getWorkspaceExternalAgentSupportDirectory(workspaceRoot), "launcher.js");
}

export function getWorkspaceExternalAgentStatePath(workspaceRoot: string): string {
  return path.join(getWorkspaceExternalAgentSupportDirectory(workspaceRoot), "state.json");
}

export function buildWorkspaceExternalAgentLauncherState(options: {
  workspaceRoot: string;
  repoId: string;
  controlSocketPath: string;
  heartbeatIntervalMs?: number;
}): ExternalAgentLauncherState {
  return {
    version: 1,
    repoId: options.repoId,
    workspaceRoot: options.workspaceRoot,
    controlSocketPath: options.controlSocketPath,
    innerLauncherPath: getWorkspaceMcpLauncherPath(options.workspaceRoot),
    keyEnvVarName: EXTERNAL_AGENT_KEY_ENV_VAR,
    repoIdEnvVarName: EXTERNAL_AGENT_REPO_ID_ENV_VAR,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 2000,
    updatedAt: new Date().toISOString(),
  };
}

export function ensureWorkspaceExternalAgentSupportFiles(options: {
  workspaceRoot: string;
  repoId: string;
  controlSocketPath: string;
  heartbeatIntervalMs?: number;
}): ExternalAgentSupportWriteResult {
  const supportDirectory = getWorkspaceExternalAgentSupportDirectory(options.workspaceRoot);
  const createdDirectory = !fs.existsSync(supportDirectory);
  if (createdDirectory) {
    fs.mkdirSync(supportDirectory, { recursive: true });
  }

  const launcherPath = getWorkspaceExternalAgentLauncherPath(options.workspaceRoot);
  const nextLauncherContent = `${renderWorkspaceExternalAgentLauncherScript()}\n`;
  const currentLauncherContent = fs.existsSync(launcherPath)
    ? stripBom(fs.readFileSync(launcherPath, "utf8"))
    : undefined;
  const launcherUpdated = currentLauncherContent !== nextLauncherContent;
  if (launcherUpdated) {
    fs.writeFileSync(launcherPath, nextLauncherContent, "utf8");
  }

  const statePath = getWorkspaceExternalAgentStatePath(options.workspaceRoot);
  const state = buildWorkspaceExternalAgentLauncherState(options);
  const nextStateContent = `${JSON.stringify(state, null, 4)}\n`;
  const currentStateContent = fs.existsSync(statePath)
    ? stripBom(fs.readFileSync(statePath, "utf8"))
    : undefined;
  const stateUpdated = currentStateContent !== nextStateContent;
  if (stateUpdated) {
    fs.writeFileSync(statePath, nextStateContent, "utf8");
  }

  return {
    supportDirectory,
    launcherPath,
    statePath,
    createdDirectory,
    launcherUpdated,
    stateUpdated,
  };
}