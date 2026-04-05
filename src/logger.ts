import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { LogLevel } from "./types";
import { getCompatibleConfigurationValue } from "./extensionCompat";

type Level = Exclude<LogLevel, "none">;

const LOG_DIRECTORY_NAME = ".copilot-cockpit-logs";
let fileWriteFailed = false;

export function getConfiguredLogLevel(): LogLevel {
  return getCompatibleConfigurationValue<LogLevel>("logLevel", "info");
}

function rank(level: LogLevel): number {
  switch (level) {
    case "debug":
      return 3;
    case "info":
      return 2;
    case "error":
      return 1;
    default:
      return 0;
  }
}

function canLog(messageLevel: Level): boolean {
  const current = getConfiguredLogLevel();
  return rank(current) >= rank(messageLevel);
}

function getWorkspaceRootPath(): string | undefined {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

export function getLogDirectoryPath(): string {
  const workspaceRoot = getWorkspaceRootPath();
  if (workspaceRoot) {
    return path.join(workspaceRoot, LOG_DIRECTORY_NAME);
  }
  return path.join(os.homedir(), LOG_DIRECTORY_NAME);
}

function ensureLogDirectory(): string {
  const logDirectory = getLogDirectoryPath();
  fs.mkdirSync(logDirectory, { recursive: true });
  return logDirectory;
}

function getLogFilePath(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(ensureLogDirectory(), `${stamp}.log`);
}

function getStructuredLogFilePath(channel: string): string {
  const safeChannel = String(channel || "structured")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-") || "structured";
  return path.join(ensureLogDirectory(), `${safeChannel}.jsonl`);
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

function writeLogLine(level: Level, args: unknown[]): void {
  if (fileWriteFailed) {
    return;
  }
  try {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${args
      .map((arg) => serializeLogArg(arg))
      .join(" ")}\n`;
    fs.appendFileSync(getLogFilePath(), line, "utf8");
  } catch (error) {
    fileWriteFailed = true;
    console.error("[CopilotScheduler] Failed to write log file", error);
  }
}

function log(level: Level, sink: (...args: unknown[]) => void, args: unknown[]): void {
  if (!canLog(level)) return;
  sink(...args);
  writeLogLine(level, args);
}

export async function revealLogDirectory(): Promise<void> {
  const directory = ensureLogDirectory();
  await vscode.commands.executeCommand(
    "revealFileInOS",
    vscode.Uri.file(directory),
  );
}

export function logDebug(...args: unknown[]): void {
  log("debug", console.log, args);
}

export function logInfo(...args: unknown[]): void {
  log("info", console.info, args);
}

export function logError(...args: unknown[]): void {
  log("error", console.error, args);
}

export function appendStructuredLogEntry(
  channel: string,
  entry: Record<string, unknown>,
): void {
  if (fileWriteFailed) {
    return;
  }
  try {
    const payload = {
      timestamp: new Date().toISOString(),
      ...entry,
    };
    fs.appendFileSync(
      getStructuredLogFilePath(channel),
      `${JSON.stringify(payload)}\n`,
      "utf8",
    );
  } catch (error) {
    fileWriteFailed = true;
    console.error("[CopilotScheduler] Failed to write structured log file", error);
  }
}
