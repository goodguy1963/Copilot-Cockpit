import * as fs from "fs";
import * as path from "path";

export const SCHEDULER_SKILL_RELATIVE_PATH = path.join(
  ".github",
  "skills",
  "scheduler-mcp-agent",
  "SKILL.md",
);

export function getBundledSchedulerSkillPath(extensionRoot: string): string {
  return path.join(extensionRoot, SCHEDULER_SKILL_RELATIVE_PATH);
}

export async function ensureSchedulerSkillForWorkspaceRoots(
  extensionRoot: string,
  workspaceRoots: string[],
): Promise<string[]> {
  if (!extensionRoot || workspaceRoots.length === 0) {
    return [];
  }

  const bundledSkillPath = getBundledSchedulerSkillPath(extensionRoot);
  let bundledSkillContent: string | undefined;
  const createdPaths: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    if (!workspaceRoot) {
      continue;
    }

    const targetPath = path.join(workspaceRoot, SCHEDULER_SKILL_RELATIVE_PATH);

    try {
      await fs.promises.access(targetPath, fs.constants.F_OK);
      continue;
    } catch {
      // Missing is expected; continue to create it from the bundled template.
    }

    if (bundledSkillContent === undefined) {
      bundledSkillContent = await fs.promises.readFile(bundledSkillPath, "utf8");
    }

    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.promises.writeFile(targetPath, bundledSkillContent, "utf8");
    createdPaths.push(targetPath);
  }

  return createdPaths;
}