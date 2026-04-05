import * as fs from "fs";
import * as os from "os";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import type { LogLevel } from "./types";
import * as path from "path";
import * as vscode from "vscode";

type Level = Exclude<LogLevel, "none">;

const LOG_DIRECTORY_NAME = ".copilot-cockpit-logs";
const LEVEL_SEVERITY: Record<LogLevel, number> = {
  none: 0,
  error: 1,
  info: 2,
  debug: 3,
};
let fileWriteFailed = false;

export function getConfiguredLogLevel(): LogLevel {
  return getCompatibleConfigurationValue<LogLevel>("logLevel", "info");
}

function severity(level: LogLevel): number {
  return LEVEL_SEVERITY[level];
}

function canLog(messageLevel: Level): boolean {
  return severity(getConfiguredLogLevel()) >= severity(messageLevel);
}

function getPrimaryWorkspacePath(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

export function getLogDirectoryPath(): string {
  return path.join(
    getPrimaryWorkspacePath() || os.homedir(),
    LOG_DIRECTORY_NAME,
  );
}

function ensureDirectoryExists(directoryPath: string): string {
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

function getCurrentLogDirectory(): string {
  return ensureDirectoryExists(getLogDirectoryPath());
}

function getDailyLogFilePath(): string {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return path.join(getCurrentLogDirectory(), `${dateStamp}.log`);
}

function normalizeStructuredChannel(channel: string): string {
  return String(channel || "structured")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-") || "structured";
}

function getStructuredLogFilePath(channel: string): string {
  return path.join(
    getCurrentLogDirectory(),
    `${normalizeStructuredChannel(channel)}.jsonl`,
  );
}

function serializeLogArg(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function appendLine(filePath: string, line: string): void {
  fs.appendFileSync(filePath, line, "utf8");
}

function reportLogWriteFailure(context: string, error: unknown): void {
  fileWriteFailed = true;
  console.error(context, error);
}

function writeLogLine(level: Level, args: unknown[]): void {
  if (fileWriteFailed) {
    return;
  }

  try {
    const serializedArgs = args
      .map((arg) => serializeLogArg(arg))
      .join(" ");
    appendLine(
      getDailyLogFilePath(),
      `${new Date().toISOString()} [${level.toUpperCase()}] ${serializedArgs}\n`,
    );
  } catch (error) {
    reportLogWriteFailure("[CopilotScheduler] Failed to write log file", error);
  }
}

function writeToConsoleAndFile(
  level: Level,
  sink: (...args: unknown[]) => void,
  args: unknown[],
): void {
  if (!canLog(level)) {
    return;
  }

  sink(...args);
  writeLogLine(level, args);
}

export async function revealLogDirectory(): Promise<void> {
  const directory = getCurrentLogDirectory();
  await vscode.commands.executeCommand(
    "revealFileInOS",
    vscode.Uri.file(directory),
  );
}

export function logDebug(...args: unknown[]): void {
  writeToConsoleAndFile("debug", console.log, args);
}

export function logInfo(...args: unknown[]): void {
  writeToConsoleAndFile("info", console.info, args);
}

export function logError(...args: unknown[]): void {
  writeToConsoleAndFile("error", console.error, args);
}

export function appendStructuredLogEntry(
  channel: string,
  entry: Record<string, unknown>,
): void {
  if (fileWriteFailed) {
    return;
  }

  try {
    const entryWithTimestamp = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    appendLine(
      getStructuredLogFilePath(channel),
      `${JSON.stringify(entryWithTimestamp)}\n`,
    );
  } catch (error) {
    reportLogWriteFailure(
      "[CopilotScheduler] Failed to write structured log file",
      error,
    );
  }
}
