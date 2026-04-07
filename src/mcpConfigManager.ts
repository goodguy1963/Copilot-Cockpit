import * as fs from "fs";
import * as path from "path";
import { renderWorkspaceMcpLauncherScript } from "./mcpLauncherScript";

export type McpServerEntry = {
  type: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
};

type NodeLaunchCommand = {
  command: string;
  argsPrefix: string[];
  env?: Record<string, string>;
};

type NodeResolutionRuntime = {
  platform: NodeJS.Platform;
  execPath: string;
  env: NodeJS.ProcessEnv;
  fileExists: (filePath: string) => boolean;
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

export type SchedulerCodexWriteResult = {
  configPath: string;
  createdFile: boolean;
  createdDirectory: boolean;
  updated: boolean;
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

const CODEX_CONFIG_DIR_PARTS = [".codex"] as const;

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function shellEscapeSingleQuoted(value: string): string {
  return String(value).replace(/'/g, `'\\''`);
}

function shellEscapeDoubleQuoted(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/"/g, '\\"');
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

export function getWorkspaceCodexConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ...CODEX_CONFIG_DIR_PARTS, "config.toml");
}

function createNodeResolutionRuntime(): NodeResolutionRuntime {
  return {
    platform: process.platform,
    execPath: process.execPath,
    env: process.env,
    fileExists: (filePath: string) => fs.existsSync(filePath),
  };
}

function getPathEntries(runtime: NodeResolutionRuntime): string[] {
  const rawPath = runtime.env.PATH ?? "";
  return rawPath
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function getPathExtensions(runtime: NodeResolutionRuntime): string[] {
  if (runtime.platform !== "win32") {
    return [""];
  }

  const rawPathExt = runtime.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM";
  const extensions = rawPathExt
    .split(";")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return extensions.length > 0 ? extensions : [".exe"];
}

function resolveNodeFromPath(runtime: NodeResolutionRuntime): string | undefined {
  const pathEntries = getPathEntries(runtime);
  if (pathEntries.length === 0) {
    return undefined;
  }

  if (runtime.platform === "win32") {
    const pathExtensions = getPathExtensions(runtime);
    for (const directory of pathEntries) {
      for (const extension of pathExtensions) {
        const candidate = path.join(directory, `node${extension}`);
        if (runtime.fileExists(candidate)) {
          return candidate;
        }
      }
    }
    return undefined;
  }

  for (const directory of pathEntries) {
    const candidate = path.join(directory, "node");
    if (runtime.fileExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function getKnownNodeInstallLocations(runtime: NodeResolutionRuntime): string[] {
  if (runtime.platform === "win32") {
    return [
      runtime.env.NVM_SYMLINK,
      runtime.env.VOLTA_HOME ? path.join(runtime.env.VOLTA_HOME, "bin", "node.exe") : undefined,
      runtime.env.LOCALAPPDATA ? path.join(runtime.env.LOCALAPPDATA, "Programs", "nodejs", "node.exe") : undefined,
      runtime.env.ProgramFiles ? path.join(runtime.env.ProgramFiles, "nodejs", "node.exe") : undefined,
      runtime.env["ProgramFiles(x86)"] ? path.join(runtime.env["ProgramFiles(x86)"], "nodejs", "node.exe") : undefined,
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
  }

  return [
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/usr/bin/node",
  ];
}

function getPosixShellCandidates(runtime: NodeResolutionRuntime): string[] {
  return [
    runtime.env.SHELL,
    "/bin/zsh",
    "/bin/bash",
    "/bin/sh",
  ].filter((value, index, values): value is string =>
    typeof value === "string"
    && value.length > 0
    && values.indexOf(value) === index,
  );
}

export function buildNodeShellExecutionCommand(launcherPath: string): string {
  const escapedLauncherPath = shellEscapeDoubleQuoted(launcherPath);
  return [
    'NODE_BIN="$(command -v node 2>/dev/null || true)"',
    'if [ -z "$NODE_BIN" ] && [ -s "$HOME/.nvm/nvm.sh" ]; then . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; NODE_BIN="$(command -v node 2>/dev/null || true)"; fi',
    'if [ -z "$NODE_BIN" ] && [ -n "$NVM_BIN" ] && [ -x "$NVM_BIN/node" ]; then NODE_BIN="$NVM_BIN/node"; fi',
    'if [ -z "$NODE_BIN" ] && [ -s "$HOME/.asdf/asdf.sh" ]; then . "$HOME/.asdf/asdf.sh" >/dev/null 2>&1; NODE_BIN="$(command -v node 2>/dev/null || true)"; fi',
    'if [ -z "$NODE_BIN" ] && [ -d "$HOME/.nvm/versions/node" ]; then NODE_BIN="$(find "$HOME/.nvm/versions/node" -type f -path "*/bin/node" 2>/dev/null | sort | tail -n 1)"; fi',
    'if [ -z "$NODE_BIN" ] && [ -d "$HOME/.asdf/installs/nodejs" ]; then NODE_BIN="$(find "$HOME/.asdf/installs/nodejs" -type f -path "*/bin/node" 2>/dev/null | sort | tail -n 1)"; fi',
    'if [ -z "$NODE_BIN" ] && [ -d "$HOME/.fnm/node-versions" ]; then NODE_BIN="$(find "$HOME/.fnm/node-versions" -type f -path "*/installation/bin/node" 2>/dev/null | sort | tail -n 1)"; fi',
    'if [ -z "$NODE_BIN" ]; then for candidate in "$HOME/.volta/bin/node" /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do if [ -x "$candidate" ]; then NODE_BIN="$candidate"; break; fi; done; fi',
    'if [ -z "$NODE_BIN" ]; then echo "Copilot Cockpit MCP launcher could not find node. Install Node.js or expose it in your shell startup." >&2; exit 127; fi',
    `exec "$NODE_BIN" "${escapedLauncherPath}"`,
  ].join("; ");
}

function resolvePosixShellCommand(runtime: NodeResolutionRuntime): NodeLaunchCommand | undefined {
  for (const shellPath of getPosixShellCandidates(runtime)) {
    if (runtime.fileExists(shellPath)) {
      const shellBaseName = path.basename(shellPath).toLowerCase();
      return {
        command: shellPath,
        argsPrefix: shellBaseName === "sh" ? ["-lc"] : ["-ilc"],
      };
    }
  }

  return undefined;
}

export function resolveNodeLaunchCommand(
  runtime: NodeResolutionRuntime = createNodeResolutionRuntime(),
): NodeLaunchCommand {
  const execBaseName = path.basename(runtime.execPath).toLowerCase();
  if (execBaseName === "node" || execBaseName === "node.exe") {
    return {
      command: runtime.execPath,
      argsPrefix: [],
    };
  }

  if (runtime.fileExists(runtime.execPath)) {
    return {
      command: runtime.execPath,
      argsPrefix: [],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
      },
    };
  }

  const pathResolvedNode = resolveNodeFromPath(runtime);
  if (pathResolvedNode) {
    return {
      command: pathResolvedNode,
      argsPrefix: [],
    };
  }

  for (const candidate of getKnownNodeInstallLocations(runtime)) {
    if (runtime.fileExists(candidate)) {
      return {
        command: candidate,
        argsPrefix: [],
      };
    }
  }

  if (runtime.platform !== "win32") {
    const shellCommand = resolvePosixShellCommand(runtime);
    if (shellCommand) {
      return shellCommand;
    }
  }

  return {
    command: "node",
    argsPrefix: [],
  };
}

export function buildSchedulerMcpServerEntry(
  workspaceRoot: string,
): McpServerEntry {
  const launcherPath = getWorkspaceMcpLauncherPath(workspaceRoot);
  const nodeLaunch = resolveNodeLaunchCommand();
  return {
    type: "stdio",
    command: nodeLaunch.command,
    ...(nodeLaunch.env ? { env: nodeLaunch.env } : {}),
    args:
      nodeLaunch.argsPrefix.length > 0
        ? [...nodeLaunch.argsPrefix, buildNodeShellExecutionCommand(launcherPath)]
        : [launcherPath],
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

function escapeTomlString(value: string): string {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function buildSchedulerCodexServerTable(workspaceRoot: string): string {
  const launcherPath = getWorkspaceMcpLauncherPath(workspaceRoot);
  const nodeLaunch = resolveNodeLaunchCommand();
  const args =
    nodeLaunch.argsPrefix.length > 0
      ? [...nodeLaunch.argsPrefix, buildNodeShellExecutionCommand(launcherPath)]
      : [launcherPath];
  return [
    "[mcp_servers.scheduler]",
    `command = "${escapeTomlString(nodeLaunch.command)}"`,
    `args = [${args.map((value) => `"${escapeTomlString(value)}"`).join(", ")}]`,
    ...(nodeLaunch.env
      ? [
        `env = { ${Object.entries(nodeLaunch.env)
          .map(([key, value]) => `${key} = "${escapeTomlString(value)}"`)
          .join(", ")} }`,
      ]
      : []),
    "enabled = true",
    "startup_timeout_sec = 30",
  ].join("\n");
}

function upsertNamedTomlTable(options: {
  content: string;
  tableName: string;
  replacement: string;
}): string {
  const normalizedContent = options.content.replace(/\r\n/g, "\n");
  const lines = normalizedContent.split("\n");
  const header = `[${options.tableName}]`;
  const startIndex = lines.findIndex((line) => line.trim() === header);

  if (startIndex < 0) {
    const trimmed = normalizedContent.trim();
    return trimmed
      ? `${trimmed}\n\n${options.replacement}\n`
      : `${options.replacement}\n`;
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      endIndex = index;
      break;
    }
  }

  const before = lines.slice(0, startIndex).join("\n").trimEnd();
  const after = lines.slice(endIndex).join("\n").trim();
  return [before, options.replacement, after]
    .filter((part) => part.length > 0)
    .join("\n\n") + "\n";
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
    const actualEnv = isPlainObject(scheduler.env)
      ? Object.fromEntries(
        Object.entries(scheduler.env)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      )
      : undefined;
    const expectedEnv = expected.env;

    if (
      actualType === expected.type &&
      actualCommand === expected.command &&
      actualArgs &&
      actualArgs.length === expected.args.length &&
      actualArgs.every((value, index) => value === expected.args[index]) &&
      JSON.stringify(actualEnv ?? {}) === JSON.stringify(expectedEnv ?? {})
    ) {
      const launcherPath = getWorkspaceMcpLauncherPath(workspaceRoot);
      if (!fs.existsSync(launcherPath)) {
        return {
          status: "stale",
          configPath,
          reason: `Configured launcher path does not exist: ${launcherPath}`,
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
          env: actualEnv,
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

export function upsertSchedulerCodexConfig(
  workspaceRoot: string,
  extensionRoot: string,
): SchedulerCodexWriteResult {
  const configPath = getWorkspaceCodexConfigPath(workspaceRoot);
  const configDir = path.dirname(configPath);
  ensureWorkspaceMcpSupportFiles(workspaceRoot, extensionRoot);

  const createdDirectory = !fs.existsSync(configDir);
  if (createdDirectory) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const createdFile = !fs.existsSync(configPath);
  const currentContent = createdFile
    ? ""
    : stripBom(fs.readFileSync(configPath, "utf8"));
  const nextContent = upsertNamedTomlTable({
    content: currentContent,
    tableName: "mcp_servers.scheduler",
    replacement: buildSchedulerCodexServerTable(workspaceRoot),
  });
  const updated = currentContent !== nextContent;

  if (updated) {
    fs.writeFileSync(configPath, nextContent, "utf8");
  }

  return {
    configPath,
    createdFile,
    createdDirectory,
    updated,
  };
}
