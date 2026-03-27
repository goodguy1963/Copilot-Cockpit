import * as vscode from "vscode";
import type { LogLevel } from "./types";
import { getCompatibleConfigurationValue } from "./extensionCompat";

type Level = Exclude<LogLevel, "none">;

function getConfiguredLogLevel(): LogLevel {
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

export function logDebug(...args: unknown[]): void {
  if (!canLog("debug")) return;
  console.log(...args);
}

export function logError(...args: unknown[]): void {
  if (!canLog("error")) return;
  console.error(...args);
}
