import * as fs from "fs";
import * as path from "path";

const ROOT_GITIGNORE_RELATIVE_PATH = ".gitignore";
const SETTINGS_RELATIVE_PATH = path.join(".vscode", "settings.json");
const VSCODE_GITIGNORE_RELATIVE_PATH = path.join(".vscode", ".gitignore");
export const AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY = "autoIgnorePrivateFiles";
const AUTO_IGNORE_PRIVATE_FILES_CONFIG_KEY =
  `copilotCockpit.${AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY}`;
const LEGACY_AUTO_IGNORE_PRIVATE_FILES_CONFIG_KEY =
  `copilotScheduler.${AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY}`;
const VSCODE_IGNORE_ENTRIES = [
  "scheduler.private.json",
  "copilot-cockpit.db",
  "copilot-cockpit.db-migration.json",
  "copilot-cockpit.private.json",
  "cockpit-prompt-backups/",
  "cockpit-input-uploads/",
  "scheduler-prompt-backups/",
  "copilot-cockpit-support/",
] as const;
const VSCODE_IGNORE_COMMENT = "# Copilot Cockpit private config";
const ROOT_IGNORE_ENTRIES = [".copilot-cockpit-logs/"] as const;
const ROOT_IGNORE_COMMENT = "# Copilot Cockpit logs";

function stripBom(content: string): string {
  return content.replace(/^\uFEFF/, "");
}

function stripJsonComments(content: string): string {
  let result = "";
  let inString = false;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    const nextCharacter = content[index + 1];

    if (inLineComment) {
      if (character === "\n" || character === "\r") {
        inLineComment = false;
        result += character;
      }
      continue;
    }

    if (inBlockComment) {
      if (character === "*" && nextCharacter === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += character;
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === "/" && nextCharacter === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += character;
  }

  return result;
}

function stripTrailingJsonCommas(content: string): string {
  let result = "";
  let inString = false;
  let isEscaped = false;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (inString) {
      result += character;
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      result += character;
      continue;
    }

    if (character === ",") {
      let lookaheadIndex = index + 1;
      while (
        lookaheadIndex < content.length
        && /\s/.test(content[lookaheadIndex])
      ) {
        lookaheadIndex += 1;
      }

      if (
        content[lookaheadIndex] === "}"
        || content[lookaheadIndex] === "]"
      ) {
        continue;
      }
    }

    result += character;
  }

  return result;
}

function parseWorkspaceSettingsContent(content: string): Record<string, unknown> {
  const sanitized = stripTrailingJsonCommas(
    stripJsonComments(stripBom(content)),
  );
  const parsed = JSON.parse(sanitized);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  return parsed as Record<string, unknown>;
}

function readWorkspaceSettings(workspaceRoot: string): Record<string, unknown> {
  if (!workspaceRoot) {
    return {};
  }

  const settingsPath = path.join(workspaceRoot, SETTINGS_RELATIVE_PATH);
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  try {
    return parseWorkspaceSettingsContent(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    return {};
  }
}

export function isAutoIgnorePrivateFilesEnabledForWorkspaceRoot(
  workspaceRoot: string,
): boolean {
  const settings = readWorkspaceSettings(workspaceRoot);

  if (typeof settings[AUTO_IGNORE_PRIVATE_FILES_CONFIG_KEY] === "boolean") {
    return settings[AUTO_IGNORE_PRIVATE_FILES_CONFIG_KEY] as boolean;
  }

  if (typeof settings[LEGACY_AUTO_IGNORE_PRIVATE_FILES_CONFIG_KEY] === "boolean") {
    return settings[LEGACY_AUTO_IGNORE_PRIVATE_FILES_CONFIG_KEY] as boolean;
  }

  return true;
}

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

function ensurePrivateConfigIgnoredForWorkspaceRootInternal(
  workspaceRoot: string,
  forceApply = false,
): string[] {
  if (
    !workspaceRoot
    || (!forceApply && !isAutoIgnorePrivateFilesEnabledForWorkspaceRoot(workspaceRoot))
  ) {
    return [];
  }

  const updatedPaths: string[] = [];
  const vscodeIgnorePath = path.join(
    workspaceRoot,
    VSCODE_GITIGNORE_RELATIVE_PATH,
  );
  const rootIgnorePath = path.join(workspaceRoot, ROOT_GITIGNORE_RELATIVE_PATH);

  if (ensureIgnoreEntries(
    vscodeIgnorePath,
    VSCODE_IGNORE_COMMENT,
    VSCODE_IGNORE_ENTRIES,
  )) {
    updatedPaths.push(vscodeIgnorePath);
  }

  if (ensureIgnoreEntries(
    rootIgnorePath,
    ROOT_IGNORE_COMMENT,
    ROOT_IGNORE_ENTRIES,
  )) {
    updatedPaths.push(rootIgnorePath);
  }

  return updatedPaths;
}

export function ensurePrivateConfigIgnoredForWorkspaceRoot(
  workspaceRoot: string,
): string | undefined {
  return ensurePrivateConfigIgnoredForWorkspaceRootInternal(workspaceRoot)[0];
}

export function ensurePrivateConfigIgnoredForWorkspaceRoots(
  workspaceRoots: string[],
): string[] {
  const createdOrUpdated: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    createdOrUpdated.push(
      ...ensurePrivateConfigIgnoredForWorkspaceRootInternal(workspaceRoot),
    );
  }

  return createdOrUpdated;
}

export function applyPrivateConfigIgnoreForWorkspaceRoot(
  workspaceRoot: string,
): string | undefined {
  return ensurePrivateConfigIgnoredForWorkspaceRootInternal(workspaceRoot, true)[0];
}

export function applyPrivateConfigIgnoreForWorkspaceRoots(
  workspaceRoots: string[],
): string[] {
  const createdOrUpdated: string[] = [];

  for (const workspaceRoot of workspaceRoots) {
    createdOrUpdated.push(
      ...ensurePrivateConfigIgnoredForWorkspaceRootInternal(workspaceRoot, true),
    );
  }

  return createdOrUpdated;
}