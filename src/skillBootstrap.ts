import * as fs from "fs";
import * as path from "path";

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

export function getBundledSchedulerSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, SCHEDULER_SKILL_RELATIVE_PATH);
}

export function getBundledCockpitTodoSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, COCKPIT_TODO_SKILL_RELATIVE_PATH);
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