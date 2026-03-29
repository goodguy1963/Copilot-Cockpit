import * as fs from "fs";
import * as path from "path";

const ROOT_GITIGNORE_RELATIVE_PATH = ".gitignore";
const VSCODE_GITIGNORE_RELATIVE_PATH = path.join(".vscode", ".gitignore");
const VSCODE_IGNORE_ENTRIES = [
  "scheduler.private.json",
  "scheduler-prompt-backups/",
] as const;
const VSCODE_IGNORE_COMMENT = "# Copilot Cockpit private config";
const ROOT_IGNORE_ENTRIES = [".copilot-cockpit-logs/"] as const;
const ROOT_IGNORE_COMMENT = "# Copilot Cockpit logs";

function normalizeLines(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function ensureIgnoreEntries(
  ignorePath: string,
  comment: string,
  entries: readonly string[],
): boolean {
  fs.mkdirSync(path.dirname(ignorePath), { recursive: true });

  const existingContent = fs.existsSync(ignorePath)
    ? fs.readFileSync(ignorePath, "utf8")
    : "";
  const lines = normalizeLines(existingContent);
  const missingEntries = entries.filter((entry) =>
    !lines.some((line) => line.trim() === entry),
  );

  if (missingEntries.length === 0) {
    return false;
  }

  const nextLines = [...lines];
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }

  if (nextLines.length > 0) {
    nextLines.push("");
  }

  nextLines.push(comment);
  nextLines.push(...missingEntries);

  const nextContent = `${nextLines.join("\n")}\n`;
  fs.writeFileSync(ignorePath, nextContent, "utf8");
  return true;
}

export function ensurePrivateConfigIgnoredForWorkspaceRoot(
  workspaceRoot: string,
): string | undefined {
  if (!workspaceRoot) {
    return undefined;
  }

  const vscodeIgnorePath = path.join(
    workspaceRoot,
    VSCODE_GITIGNORE_RELATIVE_PATH,
  );
  const rootIgnorePath = path.join(workspaceRoot, ROOT_GITIGNORE_RELATIVE_PATH);

  const updatedVscodeIgnore = ensureIgnoreEntries(
    vscodeIgnorePath,
    VSCODE_IGNORE_COMMENT,
    VSCODE_IGNORE_ENTRIES,
  );
  const updatedRootIgnore = ensureIgnoreEntries(
    rootIgnorePath,
    ROOT_IGNORE_COMMENT,
    ROOT_IGNORE_ENTRIES,
  );

  if (updatedVscodeIgnore) {
    return vscodeIgnorePath;
  }
  if (updatedRootIgnore) {
    return rootIgnorePath;
  }
  return undefined;
}

export function ensurePrivateConfigIgnoredForWorkspaceRoots(
  workspaceRoots: string[],
): string[] {
  const createdOrUpdated: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    const vscodeIgnorePath = path.join(
      workspaceRoot,
      VSCODE_GITIGNORE_RELATIVE_PATH,
    );
    const rootIgnorePath = path.join(workspaceRoot, ROOT_GITIGNORE_RELATIVE_PATH);
    const before = new Set(createdOrUpdated);

    ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);

    if (fs.existsSync(vscodeIgnorePath) && !before.has(vscodeIgnorePath)) {
      const content = fs.readFileSync(vscodeIgnorePath, "utf8");
      if (VSCODE_IGNORE_ENTRIES.every((entry) => content.includes(entry))) {
        createdOrUpdated.push(vscodeIgnorePath);
      }
    }
    if (fs.existsSync(rootIgnorePath) && !before.has(rootIgnorePath)) {
      const content = fs.readFileSync(rootIgnorePath, "utf8");
      if (ROOT_IGNORE_ENTRIES.every((entry) => content.includes(entry))) {
        createdOrUpdated.push(rootIgnorePath);
      }
    }
  }

  return createdOrUpdated;
}