import * as fs from "fs";
import * as path from "path";
import { renderWorkspaceMcpLauncherScript } from "./mcpLauncherScript";

export type McpServerEntry = {
  type: "stdio";
  command: string;
  args: string[];
};

export type McpWorkspaceConfig = {
  servers?: Record<string, McpServerEntry | Record<string, unknown>>;
  [key: string]: unknown;
};

export type SchedulerMcpSetupState =
  | { status: "missing"; configPath: string }
  | { status: "configured"; configPath: string }
  | { status: "stale"; configPath: string; reason: string }
  | { status: "invalid"; configPath: string; reason: string };

export type SchedulerMcpWriteResult = {
  configPath: string;
  createdFile: boolean;
  createdDirectory: boolean;
  updated: boolean;
  repairedInvalidFile: boolean;
  backupPath?: string;
};

type WorkspaceMcpLauncherState = {
  extensionIdPrefix?: string;
  preferredExtensionDir: string;
  lastKnownExtensionRoot: string;
  lastKnownServerPath: string;
  updatedAt: string;
};

const MCP_SUPPORT_DIR_PARTS = [
  ".vscode",
  "copilot-cockpit-support",
  "mcp",
] as const;

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getInvalidMcpBackupPath(configPath: string): string {
  const parsed = path.parse(configPath);
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  return path.join(parsed.dir, `${parsed.name}.invalid-${timestamp}${parsed.ext}`);
}

export function getWorkspaceMcpConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", "mcp.json");
}

export function buildSchedulerMcpServerEntry(
  workspaceRoot: string,
): McpServerEntry {
  return {
    type: "stdio",
    command: "node",
    args: [getWorkspaceMcpLauncherPath(workspaceRoot)],
  };
}

export function getWorkspaceMcpSupportDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...MCP_SUPPORT_DIR_PARTS);
}

export function getWorkspaceMcpLauncherPath(workspaceRoot: string): string {
  return path.join(getWorkspaceMcpSupportDirectory(workspaceRoot), "launcher.js");
}

export function getWorkspaceMcpLauncherStatePath(workspaceRoot: string): string {
  return path.join(getWorkspaceMcpSupportDirectory(workspaceRoot), "state.json");
}

function getExtensionIdPrefix(extensionRoot: string): string | undefined {
  const packageJsonPath = path.join(extensionRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(stripBom(fs.readFileSync(packageJsonPath, "utf8"))) as {
        publisher?: unknown;
        name?: unknown;
      };
      if (typeof parsed.publisher === "string" && typeof parsed.name === "string") {
        return `${parsed.publisher}.${parsed.name}-`;
      }
    } catch {
      // Ignore malformed installed package metadata and fall back to the folder name.
    }
  }

  const baseName = path.basename(extensionRoot);
  const match = baseName.match(/^(.*)-(\d+\.\d+\.\d+)$/);
  return match ? `${match[1]}-` : undefined;
}

function buildWorkspaceMcpLauncherState(
  extensionRoot: string,
): WorkspaceMcpLauncherState {
  return {
    extensionIdPrefix: getExtensionIdPrefix(extensionRoot),
    preferredExtensionDir: path.dirname(extensionRoot),
    lastKnownExtensionRoot: extensionRoot,
    lastKnownServerPath: path.join(extensionRoot, "out", "server.js"),
    updatedAt: new Date().toISOString(),
  };
}

export function ensureWorkspaceMcpSupportFiles(
  workspaceRoot: string,
  extensionRoot: string,
): void {
  const supportDirectory = getWorkspaceMcpSupportDirectory(workspaceRoot);
  fs.mkdirSync(supportDirectory, { recursive: true });

  const launcherPath = getWorkspaceMcpLauncherPath(workspaceRoot);
  const launcherContent = `${renderWorkspaceMcpLauncherScript()}\n`;
  const currentLauncherContent = fs.existsSync(launcherPath)
    ? stripBom(fs.readFileSync(launcherPath, "utf8"))
    : undefined;
  if (currentLauncherContent !== launcherContent) {
    fs.writeFileSync(launcherPath, launcherContent, "utf8");
  }

  const statePath = getWorkspaceMcpLauncherStatePath(workspaceRoot);
  const stateContent = `${JSON.stringify(buildWorkspaceMcpLauncherState(extensionRoot), null, 4)}\n`;
  const currentStateContent = fs.existsSync(statePath)
    ? stripBom(fs.readFileSync(statePath, "utf8"))
    : undefined;
  if (currentStateContent !== stateContent) {
    fs.writeFileSync(statePath, stateContent, "utf8");
  }
}

export function readWorkspaceMcpConfig(
  workspaceRoot: string,
): { exists: boolean; configPath: string; config?: McpWorkspaceConfig } {
  const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
  if (!fs.existsSync(configPath)) {
    return { exists: false, configPath };
  }

  const raw = stripBom(fs.readFileSync(configPath, "utf8"));
  const parsed = JSON.parse(raw);
  if (!isPlainObject(parsed)) {
    throw new Error("Workspace MCP config must be a JSON object.");
  }

  return {
    exists: true,
    configPath,
    config: parsed as McpWorkspaceConfig,
  };
}

export function getSchedulerMcpSetupState(
  workspaceRoot: string,
  extensionRoot: string,
): SchedulerMcpSetupState {
  const configPath = getWorkspaceMcpConfigPath(workspaceRoot);

  try {
    const current = readWorkspaceMcpConfig(workspaceRoot);
    if (!current.exists || !current.config) {
      return { status: "missing", configPath };
    }

    const servers = current.config.servers;
    const scheduler = isPlainObject(servers) ? servers.scheduler : undefined;
    const expected = buildSchedulerMcpServerEntry(workspaceRoot);
    if (!isPlainObject(scheduler)) {
      return { status: "missing", configPath };
    }

    const actualType = scheduler.type;
    const actualCommand = scheduler.command;
    const actualArgs = Array.isArray(scheduler.args) ? scheduler.args : undefined;

    if (
      actualType === expected.type &&
      actualCommand === expected.command &&
      actualArgs &&
      actualArgs.length === expected.args.length &&
      actualArgs.every((value, index) => value === expected.args[index])
    ) {
      if (!fs.existsSync(expected.args[0])) {
        return {
          status: "stale",
          configPath,
          reason: `Configured server path does not exist: ${expected.args[0]}`,
        };
      }

      const launcherStatePath = getWorkspaceMcpLauncherStatePath(workspaceRoot);
      if (!fs.existsSync(launcherStatePath)) {
        return {
          status: "stale",
          configPath,
          reason: `Configured launcher state does not exist: ${launcherStatePath}`,
        };
      }

      return { status: "configured", configPath };
    }

    return {
      status: "stale",
      configPath,
      reason:
        `Scheduler MCP entry points to ${JSON.stringify({
          type: actualType,
          command: actualCommand,
          args: actualArgs,
        })} instead of ${JSON.stringify(expected)}.`,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error ?? "");
    return { status: "invalid", configPath, reason };
  }
}

export function upsertSchedulerMcpConfig(
  workspaceRoot: string,
  extensionRoot: string,
): SchedulerMcpWriteResult {
  const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
  const configDir = path.dirname(configPath);
  ensureWorkspaceMcpSupportFiles(workspaceRoot, extensionRoot);
  const expectedEntry = buildSchedulerMcpServerEntry(workspaceRoot);

  const createdDirectory = !fs.existsSync(configDir);
  if (createdDirectory) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  let existing: McpWorkspaceConfig = {};
  const createdFile = !fs.existsSync(configPath);
  let repairedInvalidFile = false;
  let backupPath: string | undefined;
  if (!createdFile) {
    try {
      const parsed = readWorkspaceMcpConfig(workspaceRoot);
      existing = parsed.config ?? {};
    } catch {
      backupPath = getInvalidMcpBackupPath(configPath);
      fs.copyFileSync(configPath, backupPath);
      existing = {};
      repairedInvalidFile = true;
    }
  }

  const nextConfig: McpWorkspaceConfig = {
    ...existing,
    servers: {
      ...(isPlainObject(existing.servers) ? existing.servers : {}),
      scheduler: expectedEntry,
    },
  };

  const nextContent = `${JSON.stringify(nextConfig, null, 4)}\n`;
  const currentContent = createdFile
    ? undefined
    : stripBom(fs.readFileSync(configPath, "utf8"));
  const updated = repairedInvalidFile || currentContent !== nextContent;

  if (updated) {
    fs.writeFileSync(configPath, nextContent, "utf8");
  }

  return {
    configPath,
    createdFile,
    createdDirectory,
    updated,
    repairedInvalidFile,
    backupPath,
  };
}