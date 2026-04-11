import * as fs from "fs";
import * as path from "path";

const EXACT_SIGNAL_DIRECTORY_PATHS = [
  ".github/agents",
  ".github/skills",
  ".github/prompts",
  ".agents",
] as const;

const EXACT_SIGNAL_FILE_PATHS = ["AGENTS.md"] as const;

const EXACT_SIGNAL_RELATIVE_PATHS = [
  ...EXACT_SIGNAL_DIRECTORY_PATHS,
  ...EXACT_SIGNAL_FILE_PATHS,
] as const;

const IGNORED_SCAN_DIRECTORIES = new Set([
  ".git",
  "archive",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

const NEARBY_SIGNAL_SUFFIXES = [".instructions.md", ".agent.md"] as const;
const MAX_SCAN_DEPTH = 2;
const MAX_NEARBY_SIGNAL_FILES = 8;
const MAX_SUMMARIZED_SIGNALS_PER_WORKSPACE = 6;

export interface BundledAgentSyncWorkspaceInspection {
  workspaceRoot: string;
  hasGithubFolder: boolean;
  detectedSignals: string[];
}

function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  return path.join(workspaceRoot, ...relativePath.split("/"));
}

function dedupeAndSort(relativePaths: readonly string[]): string[] {
  return [...new Set(relativePaths)].sort((left, right) => {
    if (left < right) {
      return -1;
    }
    if (left > right) {
      return 1;
    }
    return 0;
  });
}

function isNestedUnderExactSignalDirectory(relativePath: string): boolean {
  return EXACT_SIGNAL_DIRECTORY_PATHS.some((prefix) => relativePath.startsWith(`${prefix}/`));
}

function collectNearbyAgentInstructionFiles(workspaceRoot: string): string[] {
  const found: string[] = [];

  const visit = (currentDir: string, relativeDir: string, depth: number): void => {
    if (found.length >= MAX_NEARBY_SIGNAL_FILES) {
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (found.length >= MAX_NEARBY_SIGNAL_FILES) {
        return;
      }

      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const lowerName = entry.name.toLowerCase();

      if (entry.isDirectory()) {
        if (depth >= MAX_SCAN_DEPTH || IGNORED_SCAN_DIRECTORIES.has(lowerName)) {
          continue;
        }
        visit(path.join(currentDir, entry.name), relativePath, depth + 1);
        continue;
      }

      if (!entry.isFile() || isNestedUnderExactSignalDirectory(relativePath)) {
        continue;
      }

      if (NEARBY_SIGNAL_SUFFIXES.some((suffix) => lowerName.endsWith(suffix))) {
        found.push(relativePath);
      }
    }
  };

  visit(workspaceRoot, "", 0);
  return found;
}

function summarizeSignalList(relativePaths: readonly string[]): string {
  if (relativePaths.length <= MAX_SUMMARIZED_SIGNALS_PER_WORKSPACE) {
    return relativePaths.join(", ");
  }

  const visible = relativePaths.slice(0, MAX_SUMMARIZED_SIGNALS_PER_WORKSPACE);
  return `${visible.join(", ")} (+${relativePaths.length - visible.length} more)`;
}

function getWorkspaceLabel(workspaceRoot: string): string {
  const baseName = path.basename(workspaceRoot);
  return baseName || workspaceRoot;
}

export function inspectBundledAgentSyncWorkspace(
  workspaceRoot: string,
): BundledAgentSyncWorkspaceInspection {
  const detectedSignals: string[] = [];

  for (const relativePath of EXACT_SIGNAL_RELATIVE_PATHS) {
    if (fs.existsSync(resolveWorkspacePath(workspaceRoot, relativePath))) {
      detectedSignals.push(relativePath);
    }
  }

  detectedSignals.push(...collectNearbyAgentInstructionFiles(workspaceRoot));

  return {
    workspaceRoot,
    hasGithubFolder: fs.existsSync(resolveWorkspacePath(workspaceRoot, ".github")),
    detectedSignals: dedupeAndSort(detectedSignals),
  };
}

export function inspectBundledAgentSyncWorkspaces(
  workspaceRoots: readonly string[],
): BundledAgentSyncWorkspaceInspection[] {
  return workspaceRoots.map((workspaceRoot) => inspectBundledAgentSyncWorkspace(workspaceRoot));
}

export function summarizeBundledAgentSystemSignals(
  inspections: readonly BundledAgentSyncWorkspaceInspection[],
): string {
  const withSignals = inspections.filter((inspection) => inspection.detectedSignals.length > 0);
  if (withSignals.length === 0) {
    return "";
  }

  if (withSignals.length === 1) {
    return summarizeSignalList(withSignals[0].detectedSignals);
  }

  return withSignals
    .map((inspection) => `${getWorkspaceLabel(inspection.workspaceRoot)}: ${summarizeSignalList(inspection.detectedSignals)}`)
    .join("\n");
}