import * as path from "path";
import * as fs from "fs";

export function normalizeForCompare(p: string): string {
  if (!p) return "";
  const resolved = path.normalize(path.resolve(p));
  const root = path.parse(resolved).root;
  // Avoid turning filesystem roots ("/", "C:\\") into empty strings.
  const trimmed =
    resolved === root ? resolved : resolved.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? trimmed.toLowerCase() : trimmed;
}

function tryResolveRealPathNormalized(p: string): string | undefined {
  if (!p) return undefined;
  try {
    const real = fs.realpathSync.native
      ? fs.realpathSync.native(p)
      : fs.realpathSync(p);
    return normalizeForCompare(real);
  } catch {
    return undefined;
  }
}

export function isPathInsideBaseDir(
  baseDir: string,
  targetPath: string,
): boolean {
  const baseReal = tryResolveRealPathNormalized(baseDir);
  const targetReal = tryResolveRealPathNormalized(targetPath);

  const base = baseReal || normalizeForCompare(baseDir);
  const tgt = targetReal || normalizeForCompare(targetPath);
  if (!base || !tgt) return false;
  const prefix = base.endsWith(path.sep) ? base : base + path.sep;
  return tgt === base || tgt.startsWith(prefix);
}

function isMarkdownFile(p: string): boolean {
  const lower = p.toLowerCase();
  // Prompt templates are markdown, but agent definitions (*.agent.md) must not be treated as templates.
  return lower.endsWith(".md") && !lower.endsWith(".agent.md");
}

/**
 * Resolve a path against a base directory and ensure it stays inside it.
 *
 * Accepts absolute or relative `promptPath`.
 */
export function resolveAllowedPathInBaseDir(
  baseDir: string,
  promptPath: string,
): string | undefined {
  if (!baseDir || !promptPath) return undefined;
  const resolvedTarget = path.resolve(baseDir, promptPath);
  if (!isPathInsideBaseDir(baseDir, resolvedTarget)) {
    return undefined;
  }
  if (!isMarkdownFile(resolvedTarget)) {
    return undefined;
  }
  return resolvedTarget;
}

export function resolveGlobalPromptPath(
  globalRoot: string | undefined,
  promptPath: string,
): string | undefined {
  if (!globalRoot) return undefined;
  return resolveAllowedPathInBaseDir(globalRoot, promptPath);
}

/**
 * Resolve local prompt template path for execution.
 *
 * Security/consistency:
 * - Only allows markdown files under `.github/prompts/` in any open workspace folder.
 * - Supports multi-root workspaces.
 * - Supports absolute paths and relative paths (relative to workspace root or prompts dir).
 */
export function resolveLocalPromptPath(
  workspaceFolderPaths: string[],
  promptPath: string,
): string | undefined {
  if (!promptPath || typeof promptPath !== "string") return undefined;
  if (workspaceFolderPaths.length === 0) return undefined;

  for (const workspaceRoot of workspaceFolderPaths) {
    if (!workspaceRoot) continue;
    const promptsDir = path.join(workspaceRoot, ".github", "prompts");

    // Absolute path case: just validate containment.
    if (path.isAbsolute(promptPath)) {
      const resolvedAbs = path.resolve(promptPath);
      if (
        isPathInsideBaseDir(promptsDir, resolvedAbs) &&
        isMarkdownFile(resolvedAbs)
      ) {
        return resolvedAbs;
      }
      continue;
    }

    // Relative paths:
    // - relative to workspace root (e.g., ".github/prompts/foo.md")
    // - relative to prompts dir (e.g., "foo.md" or "sub/foo.md")
    const candidateFromWorkspace = path.resolve(workspaceRoot, promptPath);
    if (
      isPathInsideBaseDir(promptsDir, candidateFromWorkspace) &&
      isMarkdownFile(candidateFromWorkspace)
    ) {
      return candidateFromWorkspace;
    }

    const candidateFromPrompts = path.resolve(promptsDir, promptPath);
    if (
      isPathInsideBaseDir(promptsDir, candidateFromPrompts) &&
      isMarkdownFile(candidateFromPrompts)
    ) {
      return candidateFromPrompts;
    }
  }

  return undefined;
}

/**
 * Resolve the global prompts root directory.
 * Falls back to the default VS Code User/prompts folder.
 * Supports Windows (APPDATA), macOS (HOME/Library), and Linux (XDG_CONFIG_HOME or HOME).
 */
export function resolveGlobalPromptsRoot(
  customPath?: string,
): string | undefined {
  let defaultRoot = "";
  if (process.env.APPDATA) {
    // Windows
    defaultRoot = path.join(process.env.APPDATA, "Code", "User", "prompts");
  } else if (process.platform === "darwin" && process.env.HOME) {
    // macOS
    defaultRoot = path.join(
      process.env.HOME,
      "Library",
      "Application Support",
      "Code",
      "User",
      "prompts",
    );
  } else if (process.env.HOME) {
    // Linux (XDG_CONFIG_HOME or ~/.config)
    const configBase =
      process.env.XDG_CONFIG_HOME || path.join(process.env.HOME, ".config");
    defaultRoot = path.join(configBase, "Code", "User", "prompts");
  }
  const globalRoot = customPath || defaultRoot;
  if (!globalRoot) return undefined;
  return fs.existsSync(globalRoot) ? globalRoot : undefined;
}
