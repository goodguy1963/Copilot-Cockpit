import * as path from "path";
import * as vscode from "vscode";
import * as fs from "fs";

const PROMPT_FILE_SUFFIX = ".md";
const AGENT_FILE_SUFFIX = ".agent.md";

export function normalizeForCompare(p: string): string {
  if (!p) {
    return "";
  }

  const absolutePath = path.resolve(p);
  const normalizedPath = path.normalize(absolutePath);
  const parsedRoot = path.parse(normalizedPath).root;
  const trimmedPath = normalizedPath === parsedRoot
    ? normalizedPath
    : normalizedPath.replace(/[\\/]+$/, "");

  return process.platform === "win32"
    ? trimmedPath.toLowerCase()
    : trimmedPath;
}

function tryResolveRealPathNormalized(p: string): string | undefined {
  if (!p) {
    return undefined;
  }

  try {
    const resolvedPath = fs.realpathSync.native
      ? fs.realpathSync.native(p)
      : fs.realpathSync(p);
    return normalizeForCompare(resolvedPath);
  } catch {
    return undefined;
  }
}

function ensureTrailingSeparator(resolvedPath: string): string {
  if (resolvedPath.endsWith(path.sep)) {
    return resolvedPath;
  }

  return `${resolvedPath}${path.sep}`;
}

export function isPathInsideBaseDir(baseDir: string, targetPath: string): boolean {
  const normalizedBase =
    tryResolveRealPathNormalized(baseDir) ?? normalizeForCompare(baseDir);
  const normalizedTarget =
    tryResolveRealPathNormalized(targetPath) ?? normalizeForCompare(targetPath);

  if (!normalizedBase || !normalizedTarget) {
    return false;
  }

  const canonicalBasePath = ensureTrailingSeparator(normalizedBase);
  return normalizedTarget === normalizedBase
    || normalizedTarget.startsWith(canonicalBasePath);
}

function isMarkdownFile(p: string): boolean {
  const lowerPath = p.toLowerCase();
  return lowerPath.endsWith(PROMPT_FILE_SUFFIX)
    && !lowerPath.endsWith(AGENT_FILE_SUFFIX);
}

function resolveIfAllowed(baseDir: string, candidatePath: string): string | undefined {
  const resolvedCandidate = path.resolve(candidatePath);
  if (!isPathInsideBaseDir(baseDir, resolvedCandidate)) {
    return undefined;
  }

  return isMarkdownFile(resolvedCandidate) ? resolvedCandidate : undefined;
}

export function resolveAllowedPathInBaseDir(baseDir: string, promptPath: string): string | undefined {
  const hasMissingInput = !baseDir || !promptPath;
  if (hasMissingInput) {
    return undefined;
  }

  const targetPath = path.resolve(baseDir, promptPath);
  return resolveIfAllowed(baseDir, targetPath);
}

export function resolveGlobalPromptPath(globalRoot: string | undefined, promptPath: string): string | undefined {
  return globalRoot
    ? resolveIfAllowed(globalRoot, path.resolve(globalRoot, promptPath))
    : undefined;
}

function getPromptsDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".github", "prompts");
}

function* getLocalPromptCandidates(
  workspaceRoot: string,
  promptPath: string,
): Generator<string> {
  const promptsDir = getPromptsDirectory(workspaceRoot);
  if (path.isAbsolute(promptPath)) {
    yield promptPath;
    return;
  }

  yield path.resolve(workspaceRoot, promptPath);
  yield path.resolve(promptsDir, promptPath);
}

export function resolveLocalPromptPath(workspaceFolderPaths: string[], promptPath: string): string | undefined {
  const missingPromptPath = typeof promptPath !== "string" || promptPath.length === 0;
  if (missingPromptPath || workspaceFolderPaths.length === 0) {
    return undefined;
  }

  for (const workspaceRoot of workspaceFolderPaths) {
    if (!workspaceRoot) {
      continue;
    }

    const promptsDir = getPromptsDirectory(workspaceRoot);
    for (const candidatePath of getLocalPromptCandidates(workspaceRoot, promptPath)) {
      const resolved = resolveIfAllowed(promptsDir, candidatePath);
      if (resolved) {
        return resolved;
      }
    }
  }

  return undefined;
}

export function resolveGlobalPromptsRoot(customPath?: string): string | undefined {
  if (customPath) {
    return fs.existsSync(customPath) ? customPath : undefined;
  }

  for (const candidateRoot of getPreferredProductDirs()) {
    if (candidateRoot && fs.existsSync(candidateRoot)) {
      return candidateRoot;
    }
  }

  return undefined;
}

function getPreferredProductDirs(): string[] {
  const normalizedAppName = vscode.env.appName.toLowerCase();
  const preferredProductNames = normalizedAppName.includes("insider")
    ? ["Code - Insiders", "Code"]
    : ["Code", "Code - Insiders"];

  if (process.env.APPDATA) {
    return preferredProductNames.map((productName) =>
      path.join(process.env.APPDATA!, productName, "User", "prompts"),
    );
  }

  if (process.platform === "darwin" && process.env.HOME) {
    return preferredProductNames.map((productName) =>
      path.join(
        process.env.HOME!,
        "Library",
        "Application Support",
        productName,
        "User",
        "prompts",
      ),
    );
  }

  if (process.env.HOME) {
    const configRoot =
      process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, ".config");
    return preferredProductNames.map((productName) =>
      path.join(configRoot, productName, "User", "prompts"),
    );
  }

  return [];
}
