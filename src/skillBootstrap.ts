import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

export const BUNDLED_SKILLS_RELATIVE_PATH = path.join(
  ".github",
  "skills",
);

export const CODEX_SKILLS_RELATIVE_PATH = path.join(
  ".agents",
  "skills",
);

export const CODEX_AGENTS_RELATIVE_PATH = "AGENTS.md";

export const COCKPIT_SCHEDULER_SKILL_RELATIVE_PATH = path.join(
  ".github",
  "skills",
  "cockpit-scheduler-agent",
  "SKILL.md",
);

export const SCHEDULER_SKILL_RELATIVE_PATH =
  COCKPIT_SCHEDULER_SKILL_RELATIVE_PATH;

export const COCKPIT_TODO_SKILL_RELATIVE_PATH = path.join(
  ".github",
  "skills",
  "cockpit-todo-agent",
  "SKILL.md",
);

export type BundledSkillSyncState = Record<string, Record<string, string>>;

export interface BundledSkillSyncResult {
  createdPaths: string[];
  updatedPaths: string[];
  skippedPaths: string[];
  unchangedPaths: string[];
  nextState: BundledSkillSyncState;
}

const BUNDLED_SKILL_CUSTOMIZE_FRONTMATTER_KEY = "copilotCockpitCustomize";
const CODEX_AGENTS_MANAGED_START = "<!-- copilot-cockpit-codex:start -->";
const CODEX_AGENTS_MANAGED_END = "<!-- copilot-cockpit-codex:end -->";

function mapBundledSkillPathToCodex(relativePath: string): string {
  return path.join(
    CODEX_SKILLS_RELATIVE_PATH,
    path.relative(BUNDLED_SKILLS_RELATIVE_PATH, relativePath),
  );
}

function buildManagedCodexAgentsBlock(): string {
  return [
    CODEX_AGENTS_MANAGED_START,
    "## Copilot Cockpit",
    "",
    "- Repo-local Codex skills for this project live under `.agents/skills`.",
    "- Repo-local Codex MCP config for this project lives in `.codex/config.toml`.",
    "- Use the Copilot Cockpit scheduler and todo skills when the task touches scheduled work, Todo Cockpit state, or MCP-backed workflow routing.",
    "- Codex cannot start a new session through the Copilot Cockpit task scheduler integration. Creating and running task drafts from Codex is still a manual step in this repo.",
    CODEX_AGENTS_MANAGED_END,
  ].join("\n");
}

function upsertManagedCodexAgentsDoc(content: string | undefined): {
  content: string;
  changed: boolean;
  created: boolean;
} {
  const managedBlock = buildManagedCodexAgentsBlock();
  const normalized = (content ?? "").replace(/\r\n/g, "\n");
  const pattern = new RegExp(
    `${CODEX_AGENTS_MANAGED_START}[\\s\\S]*?${CODEX_AGENTS_MANAGED_END}`,
    "m",
  );

  if (!normalized.trim()) {
    return {
      content: `${managedBlock}\n`,
      changed: true,
      created: true,
    };
  }

  if (pattern.test(normalized)) {
    const nextContent = normalized.replace(pattern, managedBlock);
    return {
      content: nextContent.endsWith("\n") ? nextContent : `${nextContent}\n`,
      changed: nextContent !== normalized,
      created: false,
    };
  }

  const separator = normalized.endsWith("\n") ? "\n" : "\n\n";
  const nextContent = `${normalized}${separator}${managedBlock}\n`;
  return {
    content: nextContent,
    changed: true,
    created: false,
  };
}

async function collectBundledSkillSyncResult(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
  applyChanges: boolean,
): Promise<BundledSkillSyncResult> {
  const normalizedState = normalizeSyncState(syncState);
  const result: BundledSkillSyncResult = {
    createdPaths: [],
    updatedPaths: [],
    skippedPaths: [],
    unchangedPaths: [],
    nextState: { ...normalizedState },
  };

  if (!extensionRoot || workspaceRoots.length === 0) {
    return result;
  }

  const bundledRelativePaths = await collectBundledRelativeFilePaths(
    extensionRoot,
    BUNDLED_SKILLS_RELATIVE_PATH,
  );
  if (bundledRelativePaths.length === 0) {
    return result;
  }

  const bundledContentByRelativePath = new Map<string, string>();

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const previousWorkspaceState = normalizedState[workspaceRoot] ?? {};
    const nextWorkspaceState: Record<string, string> = {};

    for (const relativePath of bundledRelativePaths) {
      let bundledContent = bundledContentByRelativePath.get(relativePath);
      if (bundledContent === undefined) {
        bundledContent = await fs.promises.readFile(
          path.join(extensionRoot, relativePath),
          "utf8",
        );
        bundledContentByRelativePath.set(relativePath, bundledContent);
      }

      const bundledHash = createContentHash(bundledContent);
      const targetPath = path.join(workspaceRoot, relativePath);
      const previousManagedHash = previousWorkspaceState[relativePath];

      let currentContent: string | undefined;
      try {
        currentContent = await fs.promises.readFile(targetPath, "utf8");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      if (currentContent === undefined) {
        if (applyChanges) {
          await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
          await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        }
        result.createdPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      const currentHash = createContentHash(currentContent);
      if (currentHash === bundledHash) {
        result.unchangedPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      if (previousManagedHash && currentHash === previousManagedHash) {
        if (applyChanges) {
          await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        }
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      if (!isBundledSkillCustomizationProtected(currentContent)) {
        if (applyChanges) {
          await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        }
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[relativePath] = bundledHash;
        continue;
      }

      result.skippedPaths.push(targetPath);
      if (previousManagedHash) {
        nextWorkspaceState[relativePath] = previousManagedHash;
      }
    }

    if (Object.keys(nextWorkspaceState).length > 0) {
      result.nextState[workspaceRoot] = nextWorkspaceState;
    } else {
      delete result.nextState[workspaceRoot];
    }
  }

  return result;
}

export function getBundledSchedulerSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, SCHEDULER_SKILL_RELATIVE_PATH);
}

export function getBundledCockpitTodoSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, COCKPIT_TODO_SKILL_RELATIVE_PATH);
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function isBundledSkillCustomizationProtected(content: string): boolean {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatterMatch) {
    return false;
  }

  const frontmatter = frontmatterMatch[1];
  const customizePattern = new RegExp(
    `^${BUNDLED_SKILL_CUSTOMIZE_FRONTMATTER_KEY}\\s*:\\s*true\\s*$`,
    "mi",
  );
  return customizePattern.test(frontmatter);
}

function normalizeSyncState(
  syncState: BundledSkillSyncState | undefined,
): BundledSkillSyncState {
  if (!syncState || typeof syncState !== "object") {
    return {};
  }

  const nextState: BundledSkillSyncState = {};
  for (const [workspaceRoot, fileHashes] of Object.entries(syncState)) {
    if (!workspaceRoot || !fileHashes || typeof fileHashes !== "object") {
      continue;
    }

    const normalizedEntries = Object.entries(fileHashes).filter(
      ([relativePath, hash]) =>
        Boolean(relativePath) && typeof hash === "string" && hash.length > 0,
    );
    if (normalizedEntries.length === 0) {
      continue;
    }

    nextState[workspaceRoot] = Object.fromEntries(normalizedEntries);
  }

  return nextState;
}

async function collectBundledRelativeFilePaths(
  extensionRoot: string,
  relativeDirectory: string,
): Promise<string[]> {
  const directoryPath = path.join(extensionRoot, relativeDirectory);

  try {
    const stat = await fs.promises.stat(directoryPath);
    if (!stat.isDirectory()) {
      return [];
    }
  } catch {
    return [];
  }

  const relativePaths: string[] = [];
  const pendingDirectories = [directoryPath];

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) {
      continue;
    }

    const entries = await fs.promises.readdir(currentDirectory, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const absoluteEntryPath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(absoluteEntryPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      relativePaths.push(path.relative(extensionRoot, absoluteEntryPath));
    }
  }

  return relativePaths.sort((left, right) => left.localeCompare(right));
}

export async function syncBundledSkillsForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  return collectBundledSkillSyncResult(
    extensionRoot,
    workspaceRoots,
    syncState,
    true,
  );
}

export async function previewBundledSkillSyncForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  return collectBundledSkillSyncResult(
    extensionRoot,
    workspaceRoots,
    syncState,
    false,
  );
}

export async function syncBundledCodexSkillsForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  syncState: BundledSkillSyncState = {},
): Promise<BundledSkillSyncResult> {
  const normalizedState = normalizeSyncState(syncState);
  const result: BundledSkillSyncResult = {
    createdPaths: [],
    updatedPaths: [],
    skippedPaths: [],
    unchangedPaths: [],
    nextState: { ...normalizedState },
  };

  if (!extensionRoot || workspaceRoots.length === 0) {
    return result;
  }

  const bundledRelativePaths = await collectBundledRelativeFilePaths(
    extensionRoot,
    BUNDLED_SKILLS_RELATIVE_PATH,
  );
  if (bundledRelativePaths.length === 0) {
    return result;
  }

  const bundledContentByRelativePath = new Map<string, string>();

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const previousWorkspaceState = normalizedState[workspaceRoot] ?? {};
    const nextWorkspaceState: Record<string, string> = {};

    for (const relativePath of bundledRelativePaths) {
      let bundledContent = bundledContentByRelativePath.get(relativePath);
      if (bundledContent === undefined) {
        bundledContent = await fs.promises.readFile(
          path.join(extensionRoot, relativePath),
          "utf8",
        );
        bundledContentByRelativePath.set(relativePath, bundledContent);
      }

      const targetRelativePath = mapBundledSkillPathToCodex(relativePath);
      const bundledHash = createContentHash(bundledContent);
      const targetPath = path.join(workspaceRoot, targetRelativePath);
      const previousManagedHash = previousWorkspaceState[targetRelativePath];

      let currentContent: string | undefined;
      try {
        currentContent = await fs.promises.readFile(targetPath, "utf8");
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error
          ? String((error as { code?: unknown }).code)
          : "";
        if (code && code !== "ENOENT") {
          throw error;
        }
      }

      if (currentContent === undefined) {
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.createdPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      const currentHash = createContentHash(currentContent);
      if (currentHash === bundledHash) {
        result.unchangedPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      if (previousManagedHash && currentHash === previousManagedHash) {
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      if (!isBundledSkillCustomizationProtected(currentContent)) {
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
        result.updatedPaths.push(targetPath);
        nextWorkspaceState[targetRelativePath] = bundledHash;
        continue;
      }

      result.skippedPaths.push(targetPath);
      if (previousManagedHash) {
        nextWorkspaceState[targetRelativePath] = previousManagedHash;
      }
    }

    const agentsPath = path.join(workspaceRoot, CODEX_AGENTS_RELATIVE_PATH);
    let currentAgentsContent: string | undefined;
    try {
      currentAgentsContent = await fs.promises.readFile(agentsPath, "utf8");
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code)
        : "";
      if (code && code !== "ENOENT") {
        throw error;
      }
    }

    const nextAgents = upsertManagedCodexAgentsDoc(currentAgentsContent);
    if (nextAgents.changed) {
      await fs.promises.mkdir(path.dirname(agentsPath), { recursive: true });
      await fs.promises.writeFile(agentsPath, nextAgents.content, "utf8");
      if (nextAgents.created) {
        result.createdPaths.push(agentsPath);
      } else {
        result.updatedPaths.push(agentsPath);
      }
    } else {
      result.unchangedPaths.push(agentsPath);
    }

    if (Object.keys(nextWorkspaceState).length > 0) {
      result.nextState[workspaceRoot] = nextWorkspaceState;
    } else {
      delete result.nextState[workspaceRoot];
    }
  }

  return result;
}

async function ensureBundledFileForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
  relativePath: string,
): Promise<string[]> {
  if (!extensionRoot || workspaceRoots.length === 0) {
    return [];
  }

  const bundledPath = path.join(extensionRoot, relativePath);
  let bundledContent: string | undefined;
  const createdPaths: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const targetPath = path.join(workspaceRoot, relativePath);

    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      continue;
    } catch {
      // Missing is expected; continue to create it from the bundled template.
    }

    if (bundledContent === undefined) {
      bundledContent = await fs.promises.readFile(bundledPath, "utf8");
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, bundledContent, "utf8");
    createdPaths.push(targetPath);
  }

  return createdPaths;
}

export async function ensureSchedulerSkillForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
): Promise<string[]> {
  return ensureBundledFileForWorkspaceRoots(
    extensionRoot,
    workspaceRoots,
    SCHEDULER_SKILL_RELATIVE_PATH,
  );
}

export async function ensureCockpitTodoSkillForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
): Promise<string[]> {
  return ensureBundledFileForWorkspaceRoots(
    extensionRoot,
    workspaceRoots,
    COCKPIT_TODO_SKILL_RELATIVE_PATH,
  );
}