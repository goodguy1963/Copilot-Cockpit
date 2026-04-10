import * as fs from "fs";
import * as path from "path";

export type CockpitSkillType = "operational" | "support";

export interface ParsedSkillMetadata {
  name: string;
  type: CockpitSkillType;
  toolNamespaces: string[];
  workflowIntents: string[];
  approvalSensitive: boolean;
  promptSummary?: string;
  readyWorkflowFlags: string[];
  closeoutWorkflowFlags: string[];
}

export const WORKSPACE_SKILLS_RELATIVE_PATH = path.join(".github", "skills");

function parseFrontmatterArray(value: string | undefined): string[] {
  const raw = String(value || "").trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  return raw
    .split(",")
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function parseSkillMetadataFromContent(content: string): ParsedSkillMetadata | undefined {
  const frontmatterMatch = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!frontmatterMatch) {
    return undefined;
  }

  const values = new Map<string, string>();
  for (const line of frontmatterMatch[1].split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*$/.exec(line.trim());
    if (match) {
      values.set(match[1], match[2].trim());
    }
  }

  const name = values.get("name")?.replace(/^['"]|['"]$/g, "") || "";
  const typeValue = values.get("copilotCockpitSkillType")?.replace(/^['"]|['"]$/g, "") || "";
  if (!name || (typeValue !== "operational" && typeValue !== "support")) {
    return undefined;
  }

  return {
    name,
    type: typeValue,
    toolNamespaces: parseFrontmatterArray(values.get("copilotCockpitToolNamespaces")),
    workflowIntents: parseFrontmatterArray(values.get("copilotCockpitWorkflowIntents")),
    approvalSensitive: /^true$/i.test(values.get("copilotCockpitApprovalSensitive") || "false"),
    promptSummary: values.get("copilotCockpitPromptSummary")?.replace(/^['"]|['"]$/g, ""),
    readyWorkflowFlags: parseFrontmatterArray(values.get("copilotCockpitReadyWorkflowFlags")),
    closeoutWorkflowFlags: parseFrontmatterArray(values.get("copilotCockpitCloseoutWorkflowFlags")),
  };
}

export function readSkillMetadataFromFile(filePath: string): ParsedSkillMetadata | undefined {
  try {
    return parseSkillMetadataFromContent(fs.readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function collectSkillFiles(directoryPath: string): string[] {
  if (!fs.existsSync(directoryPath)) {
    return [];
  }

  const stack = [directoryPath];
  const files: string[] = [];
  while (stack.length > 0) {
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
        stack.push(entryPath);
        continue;
      }

      const lower = entry.name.toLowerCase();
      if (lower === "skill.md" || lower.endsWith(".skill.md")) {
        files.push(entryPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function listSkillMetadataInDirectory(
  directoryPath: string | undefined,
): ParsedSkillMetadata[] {
  if (!directoryPath) {
    return [];
  }

  return collectSkillFiles(directoryPath)
    .map((filePath) => readSkillMetadataFromFile(filePath))
    .filter((entry): entry is ParsedSkillMetadata => Boolean(entry));
}

export function listWorkspaceSkillMetadata(
  workspaceRoot: string | undefined,
): ParsedSkillMetadata[] {
  if (!workspaceRoot) {
    return [];
  }

  const skillsRoot = path.join(workspaceRoot, WORKSPACE_SKILLS_RELATIVE_PATH);
  return listSkillMetadataInDirectory(skillsRoot);
}