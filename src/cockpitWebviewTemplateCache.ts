/**
 * Template and skill discovery/cache logic extracted from SchedulerWebview.
 * Provides refresh and loading helpers that were previously private static
 * methods on the main class.
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { notifyError } from "./extension";
import type {
  PromptTemplate,
  SkillReference,
  AgentInfo,
  ModelInfo,
} from "./types";
import { CopilotExecutor } from "./copilotExecutor";
import { messages } from "./i18n";
import { logError } from "./logger";
import { validateTemplateLoadRequest } from "./templateValidation";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import { resolveGlobalPromptsRoot } from "./promptResolver";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { getResolvedWorkspaceRoots } from "./cockpitJsonSanitizer";
import { readSkillMetadataFromFile } from "./skillMetadata";

type OutgoingWebviewMessage = { type: string; [key: string]: unknown };
type PostMessageFn = (message: OutgoingWebviewMessage) => void;

// ---------------------------------------------------------------------------
// Workspace root resolution
// ---------------------------------------------------------------------------

export function getResolvedWorkspaceRootPaths(): string[] {
  const startPaths = (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => folder.uri.fsPath)
    .filter(
      (folderPath): folderPath is string =>
        typeof folderPath === "string" && folderPath.trim().length > 0,
    );

  return getResolvedWorkspaceRoots(startPaths);
}

// ---------------------------------------------------------------------------
// Global prompts path
// ---------------------------------------------------------------------------

export function getGlobalPromptsPath(): string | undefined {
  return resolveGlobalPromptsRoot(
    getCompatibleConfigurationValue<string>("globalPromptsPath", ""),
  );
}

// ---------------------------------------------------------------------------
// Agents & models
// ---------------------------------------------------------------------------

export async function refreshAgentsAndModels(
  agentListCache: AgentInfo[],
  modelListCache: ModelInfo[],
  force = false,
): Promise<{ agents: AgentInfo[]; models: ModelInfo[] }> {
  if (
    !force &&
    agentListCache.length > 0 &&
    modelListCache.length > 0
  ) {
    return { agents: agentListCache, models: modelListCache };
  }

  let refreshedAgents: AgentInfo[] | undefined;
  let refreshedModels: ModelInfo[] | undefined;

  try {
    refreshedAgents = await CopilotExecutor.collectAllAgents();
  } catch {}

  try {
    refreshedModels = await CopilotExecutor.collectAvailableModels();
  } catch {}

  const agents =
    Array.isArray(refreshedAgents) && refreshedAgents.length > 0
      ? refreshedAgents
      : agentListCache.length > 0
        ? agentListCache
        : CopilotExecutor.getBuiltInAgents();
  const models =
    Array.isArray(refreshedModels) && refreshedModels.length > 0
      ? refreshedModels
      : modelListCache.length > 0
        ? modelListCache
        : CopilotExecutor.builtinModels();

  return { agents, models };

  return { agents, models };
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

export async function refreshPromptTemplates(
  cached: PromptTemplate[],
  force = false,
): Promise<PromptTemplate[]> {
  if (!force && cached.length > 0) {
    return cached;
  }
  return getPromptTemplates();
}

async function getPromptTemplates(): Promise<PromptTemplate[]> {
  const templates: PromptTemplate[] = [];

  const workspaceRoots = getResolvedWorkspaceRootPaths();
  for (const workspaceRoot of workspaceRoots) {
    const localPromptDir = path.join(workspaceRoot, ".github", "prompts");
    try {
      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(localPromptDir),
      );
      for (const [file, fileType] of entries) {
        if (fileType !== vscode.FileType.File) continue;
        const lower = file.toLowerCase();
        if (!lower.endsWith(".md")) continue;
        if (lower.endsWith(".agent.md")) continue;
        templates.push({
          path: path.join(localPromptDir, file),
          name: path.basename(file, ".md"),
          source: "local",
        });
      }
    } catch {
      // Ignore errors
    }
  }

  const globalPath = getGlobalPromptsPath();
  if (globalPath) {
    try {
      const entries = await vscode.workspace.fs.readDirectory(
        vscode.Uri.file(globalPath),
      );
      for (const [file, fileType] of entries) {
        if (fileType !== vscode.FileType.File) continue;
        const lower = file.toLowerCase();
        if (!lower.endsWith(".md")) continue;
        if (lower.endsWith(".agent.md")) continue;
        templates.push({
          path: path.join(globalPath, file),
          name: path.basename(file, ".md"),
          source: "global",
        });
      }
    } catch {
      // Ignore errors
    }
  }

  templates.sort((a, b) => a.name.localeCompare(b.name));
  return templates;
}

// ---------------------------------------------------------------------------
// Skill references
// ---------------------------------------------------------------------------

export async function refreshSkillReferences(
  cached: SkillReference[],
  force = false,
): Promise<SkillReference[]> {
  if (!force && cached.length > 0) {
    return cached;
  }
  return getSkillReferences();
}

async function getSkillReferences(): Promise<SkillReference[]> {
  const results: SkillReference[] = [];
  const seen = new Set<string>();
  const workspaceRoots = getResolvedWorkspaceRootPaths();

  const addSkill = (
    filePath: string,
    source: "workspace" | "global",
    basePath?: string,
  ): void => {
    const resolved = path.resolve(filePath);
    const key = process.platform === "win32"
      ? resolved.toLowerCase()
      : resolved;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const reference = basePath
      ? path.relative(basePath, resolved) || path.basename(resolved)
      : path.basename(resolved);
    const metadata = readSkillMetadataFromFile(resolved);
    results.push({
      path: resolved,
      name: path.basename(resolved),
      reference,
      source,
      skillType: metadata?.type,
      toolNamespaces: metadata?.toolNamespaces,
      workflowIntents: metadata?.workflowIntents,
      approvalSensitive: metadata?.approvalSensitive,
      promptSummary: metadata?.promptSummary,
      readyWorkflowFlags: metadata?.readyWorkflowFlags,
      closeoutWorkflowFlags: metadata?.closeoutWorkflowFlags,
    });
  };

  const workspaceSkills = await vscode.workspace.findFiles(
    "**/{SKILL.md,*.skill.md}",
    "**/{node_modules,.git,out,dist,build,.next}/**",
    200,
  );
  for (const uri of workspaceSkills) {
    if (uri.scheme !== "file") {
      continue;
    }
    const matchedRoot = workspaceRoots.find((candidate) => {
      const resolvedRoot = path.resolve(candidate);
      const lhs = process.platform === "win32"
        ? uri.fsPath.toLowerCase()
        : uri.fsPath;
      const rhs = process.platform === "win32"
        ? resolvedRoot.toLowerCase()
        : resolvedRoot;
      return lhs === rhs || lhs.startsWith(`${rhs}${path.sep}`);
    });
    addSkill(uri.fsPath, "workspace", matchedRoot);
  }

  const globalRoot = getGlobalPromptsPath();
  if (globalRoot && fs.existsSync(globalRoot)) {
    const stack = [globalRoot];
    while (stack.length > 0 && results.length < 250) {
      const current = stack.pop();
      if (!current) {
        continue;
      }
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (["node_modules", ".git", "out", "dist", "build"].includes(entry.name)) {
            continue;
          }
          stack.push(entryPath);
          continue;
        }
        const lower = entry.name.toLowerCase();
        if (lower !== "skill.md" && !lower.endsWith(".skill.md")) {
          continue;
        }
        addSkill(entryPath, "global", globalRoot);
      }
    }
  }

  results.sort((a, b) => a.reference.localeCompare(b.reference));
  return results;
}

// ---------------------------------------------------------------------------
// Read prompt template body from disk
// ---------------------------------------------------------------------------

export async function loadPromptTemplateContent(
  templatePath: string,
  source: "local" | "global",
  cachedTemplates: PromptTemplate[],
  postMessage: PostMessageFn,
): Promise<void> {
  try {
    const request = {
      templatePath,
      source,
      cachedTemplates,
      workspaceFolderPaths: getResolvedWorkspaceRootPaths(),
      globalPromptsPath: getGlobalPromptsPath(),
    };
    const validation = validateTemplateLoadRequest(request);

    if (!validation.ok) {
      throw new Error(`Template load rejected: ${validation.reason}`);
    }

    const uri = vscode.Uri.file(path.resolve(templatePath));
    const fileBuffer = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(fileBuffer).toString("utf8");
    const message = { type: "promptTemplateLoaded", path: templatePath, content };
    postMessage(message);
  } catch (error) {
    const templateFile = path.basename(templatePath);
    const rawError = error instanceof Error ? error.message : String(error ?? "");
    const safeErrorMessage = sanitizeAbsolutePathDetails(rawError);
    const details = {
      templateFile,
      source,
      error: safeErrorMessage || messages.webviewUnknown(),
    };
    logError("[CopilotScheduler] Template load failed:", details);
    notifyError(messages.templateLoadError());
  }
}
