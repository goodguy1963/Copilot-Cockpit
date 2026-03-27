import * as fs from "fs";
import * as path from "path";

const VSCODE_GITIGNORE_RELATIVE_PATH = path.join(".vscode", ".gitignore");
const PRIVATE_CONFIG_IGNORE_ENTRY = "scheduler.private.json";
const PRIVATE_CONFIG_IGNORE_COMMENT = "# Copilot Cockpit private config";

function normalizeLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

export function ensurePrivateConfigIgnoredForWorkspaceRoot(
  workspaceRoot: string,
): string | undefined {
  if (!workspaceRoot) {
    return undefined;
  }

  const ignorePath = path.join(workspaceRoot, VSCODE_GITIGNORE_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(ignorePath), { recursive: true });

  const existingContent = fs.existsSync(ignorePath)
    ? fs.readFileSync(ignorePath, "utf8")
    : "";
  const lines = normalizeLines(existingContent);

  if (lines.some((line) => line.trim() === PRIVATE_CONFIG_IGNORE_ENTRY)) {
    return undefined;
  }

  const nextLines = [...lines];
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  if (nextLines.length > 0) {
    nextLines.push("");
  }

  nextLines.push(PRIVATE_CONFIG_IGNORE_COMMENT);
  nextLines.push(PRIVATE_CONFIG_IGNORE_ENTRY);

  const nextContent = `${nextLines.join("\n")}\n`;
  fs.writeFileSync(ignorePath, nextContent, "utf8");
  return ignorePath;
}

export function ensurePrivateConfigIgnoredForWorkspaceRoots(
  workspaceRoots: string[],
): string[] {
  const createdOrUpdated: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    const ignorePath = ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
    if (ignorePath) {
      createdOrUpdated.push(ignorePath);
    }
  }

  return createdOrUpdated;
}