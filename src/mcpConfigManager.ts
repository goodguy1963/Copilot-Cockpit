import * as fs from "fs";
import * as path from "path";

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
  | { status: "invalid"; configPath: string; reason: string };

export type SchedulerMcpWriteResult = {
  configPath: string;
  createdFile: boolean;
  createdDirectory: boolean;
  updated: boolean;
  repairedInvalidFile: boolean;
  backupPath?: string;
};

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
  extensionRoot: string,
): McpServerEntry {
  return {
    type: "stdio",
    command: "node",
    args: [path.join(extensionRoot, "out", "server.js")],
  };
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
    const expected = buildSchedulerMcpServerEntry(extensionRoot);

    if (
      isPlainObject(scheduler) &&
      scheduler.type === expected.type &&
      scheduler.command === expected.command &&
      Array.isArray(scheduler.args) &&
      scheduler.args.length === expected.args.length &&
      scheduler.args.every((value, index) => value === expected.args[index])
    ) {
      return { status: "configured", configPath };
    }

    return { status: "missing", configPath };
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
  const expectedEntry = buildSchedulerMcpServerEntry(extensionRoot);

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