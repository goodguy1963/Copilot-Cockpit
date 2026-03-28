import * as fs from "fs";
import * as path from "path";
import { createHash } from "crypto";

export const BUNDLED_SKILLS_RELATIVE_PATH = path.join(
  ".github",
  "skills",
);

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

export function getBundledSchedulerSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, SCHEDULER_SKILL_RELATIVE_PATH);
}

export function getBundledCockpitTodoSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, COCKPIT_TODO_SKILL_RELATIVE_PATH);
}

function createContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
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
        await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
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
        await fs.promises.writeFile(targetPath, bundledContent, "utf8");
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