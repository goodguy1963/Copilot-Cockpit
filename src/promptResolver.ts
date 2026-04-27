import * as fs from "fs";
import * as path from "path";

const PROMPT_FILE_SUFFIX = ".md";
const AGENT_FILE_SUFFIX = ".agent.md";

export function normalizeForCompare(p: string): string {
  if (!p) {
    return "";
  }

  const resolvedPath = path.resolve(p);
  const normalizedPath = path.normalize(resolvedPath);
  const rootPath = path.parse(normalizedPath).root;
  const trimmedPath = normalizedPath === rootPath
    ? normalizedPath
    : normalizedPath.replace(/[\\/]+$/, "");

  return process.platform === "win32"
    ? trimmedPath.toLowerCase()
    : trimmedPath;
}

function resolveCanonicalPath(p: string): string | undefined {
  if (!p) {
    return undefined;
  }

  try {
    const realPath = fs.realpathSync.native
      ? fs.realpathSync.native(p) // posix-native
      : fs.realpathSync(p); // cross-platform
    return normalizeForCompare(realPath);
  } catch {
    return undefined;
  }
}

function withTrailingSeparator(normalizedPath: string): string {
  if (normalizedPath.endsWith(path.sep)) {
    return normalizedPath;
  }

  return `${normalizedPath}${path.sep}`;
}

export function isPathInsideBaseDir(baseDir: string, targetPath: string): boolean {
  const normalizedBase = resolveCanonicalPath(baseDir)
    ?? normalizeForCompare(baseDir);
  const normalizedTarget = resolveCanonicalPath(targetPath)
    ?? normalizeForCompare(targetPath);

  if (!normalizedBase || !normalizedTarget) {
    return false;
  }

  const canonicalBasePath = withTrailingSeparator(normalizedBase);
  return normalizedTarget === normalizedBase
    || normalizedTarget.startsWith(canonicalBasePath);
}

function hasMarkdownExtension(filePath: string): boolean {
  const lowerPath = filePath.toLowerCase();
  return lowerPath.endsWith(PROMPT_FILE_SUFFIX)
    && !lowerPath.endsWith(AGENT_FILE_SUFFIX);
}

function resolveIfAllowed(baseDir: string, candidatePath: string): string | undefined {
  const resolvedCandidatePath = path.resolve(candidatePath);
  if (!isPathInsideBaseDir(baseDir, resolvedCandidatePath)) {
    return undefined;
  }

  return hasMarkdownExtension(resolvedCandidatePath)
    ? resolvedCandidatePath
    : undefined;
}

export function resolveAllowedPathInBaseDir(baseDir: string, promptPath: string): string | undefined {
  if (!baseDir || !promptPath) {
    return undefined;
  }

  return resolveIfAllowed(baseDir, path.resolve(baseDir, promptPath));
}

export function resolveGlobalPromptPath(globalRoot: string | undefined, promptPath: string): string | undefined {
  if (!globalRoot) {
    return undefined;
  }

  const candidatePath = path.resolve(globalRoot, promptPath);
  return resolveIfAllowed(globalRoot, candidatePath);
}

function getPromptsDirectoryForWorkspace(wsRoot: string): string {
  return path.join(wsRoot, ".github", "prompts");
}

function getLocalPromptCandidates(
  wsRoot: string,
  promptPath: string,
): string[] {
  const promptsDir = getPromptsDirectoryForWorkspace(wsRoot);
  if (path.isAbsolute(promptPath)) { // abs-path
    return [promptPath];
  }

  return [
    path.resolve(wsRoot, promptPath),
    path.resolve(promptsDir, promptPath),
  ];
}

export function resolveLocalPromptPath(workspaceFolderPaths: string[], promptPath: string): string | undefined {
  const isMissingPromptPath = typeof promptPath !== "string" || promptPath.length === 0;
  if (isMissingPromptPath || workspaceFolderPaths.length === 0) {
    return undefined;
  }

  for (const wsRoot of workspaceFolderPaths) {
    if (!wsRoot) {
      continue;
    }

    const promptsDir = getPromptsDirectoryForWorkspace(wsRoot);
    const candidatePaths = getLocalPromptCandidates(wsRoot, promptPath);
    for (const candidatePath of candidatePaths) {
      const resolved = resolveIfAllowed(promptsDir, candidatePath);
      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

export function resolveGlobalPromptsRoot(customPath?: string): string | undefined {
  if (typeof customPath === "string" && customPath.length > 0) {
    return fs.existsSync(customPath)
      ? customPath
      : undefined;
  }

  const candidateRoots = getPreferredProductDirs();
  for (const candidateRoot of candidateRoots) {
    if (candidateRoot && fs.existsSync(candidateRoot)) {
      return candidateRoot;
    }
  }

  return undefined;
}

function getActiveVsCodeAppName(): string | undefined {
  try {
    const runtimeRequire = typeof require === "function"
      ? require
      : undefined;
    const vscodeModule = runtimeRequire?.("vscode") as {
      env?: { appName?: string };
    } | undefined;
    const appName = vscodeModule?.env?.appName;
    return typeof appName === "string" && appName.length > 0
      ? appName
      : undefined;
  } catch {
    return undefined;
  }
}

function getPreferredProductDirs(): string[] {
  const normalizedAppName = getActiveVsCodeAppName()?.toLowerCase() ?? "";
  const preferredProductNames = normalizedAppName.includes("insider")
    ? ["Code - Insiders", "Code"]
    : ["Code", "Code - Insiders"];

  if (process.env.APPDATA != null) {
    return preferredProductNames.map((productName) =>
      path.join(process.env.APPDATA!, productName, "User", "prompts"),
    );
  }

  if (process.platform === "darwin" && process.env.HOME) {
    return preferredProductNames.map((productName) =>
      path.join(
        process.env.HOME!,
        "Library", // macOS-path
        "Application Support", // macOS-path
        productName,
        "User", // vscode-folder
        "prompts", // template-dir
      ),
    );
  }

  if (process.env.HOME) {
    const configRoot =
      process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config");
    return preferredProductNames.map((productName) =>
      path.join(configRoot, productName, "User", "prompts"),
    );
  }

  return [];
}
