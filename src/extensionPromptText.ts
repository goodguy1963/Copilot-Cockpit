import * as path from "path";
import * as vscode from "vscode";
import {
  normalizeForCompare,
  resolveGlobalPromptPath,
  resolveLocalPromptPath,
} from "./promptResolver";
import type { ScheduledTask } from "./types";

type PromptTextLogger = (message: string, details?: string) => void;

export type PromptTextResolutionOptions = {
  task: ScheduledTask;
  preferOpenDocument: boolean;
  workspaceRoots: readonly string[];
  globalPromptsRoot?: string;
  logDebug: PromptTextLogger;
  sanitizeError: (message: string) => string;
};

function findPromptFilePath(
  task: ScheduledTask,
  workspaceRoots: readonly string[],
  globalPromptsRoot?: string,
): string | undefined {
  const relativePromptPath = task.promptPath?.trim() ?? "";
  if (relativePromptPath.length === 0) {
    return undefined;
  }

  switch (task.promptSource) {
    case "global":
      return resolveGlobalPromptPath(globalPromptsRoot, relativePromptPath);
    case "local":
      return resolveLocalPromptPath([...workspaceRoots], relativePromptPath);
    default:
      return undefined;
  }
}

function findOpenPromptDocument(filePath: string): vscode.TextDocument | undefined {
  const normalizedPath = normalizeForCompare(filePath);
  return vscode.workspace.textDocuments.find(
    (document) =>
      document.uri.scheme === "file" &&
      normalizeForCompare(document.uri.fsPath) === normalizedPath,
  );
}

export async function resolveTaskPromptTextFromSource({
  globalPromptsRoot,
  logDebug,
  preferOpenDocument,
  sanitizeError,
  task,
  workspaceRoots,
}: PromptTextResolutionOptions): Promise<string> {
  const fallbackPrompt = task.prompt;
  const promptPath = task.promptPath?.trim() ?? "";
  const debugPrefix = `[CopilotScheduler] resolvePromptText:`;

  if (task.promptSource === "inline") {
    logDebug(`${debugPrefix} inline (task=${task.id})`);
    return fallbackPrompt;
  }

  if (promptPath.length === 0) {
    logDebug(
      `${debugPrefix} missing promptPath (source=${task.promptSource}, task=${task.id})`,
    );
    return fallbackPrompt;
  }

  const filePath = findPromptFilePath(task, workspaceRoots, globalPromptsRoot);
  if (!filePath) {
    logDebug(
      `${debugPrefix} path resolution failed (source=${task.promptSource}, file=${path.basename(promptPath)}, task=${task.id})`,
    );
    return fallbackPrompt;
  }

  if (preferOpenDocument) {
    const openPromptDocument = findOpenPromptDocument(filePath);
    const documentText = openPromptDocument?.getText() ?? "";
    if (documentText.trim().length > 0) {
      logDebug(
        `${debugPrefix} openDocument (file=${path.basename(filePath)}, dirty=${openPromptDocument?.isDirty === true}, task=${task.id})`,
      );
      return documentText;
    }
  }

  try {
    const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
    const fileText = Buffer.from(bytes).toString("utf8");
    if (fileText.trim().length > 0) {
      logDebug(`${debugPrefix} file (file=${path.basename(filePath)}, task=${task.id})`);
      return fileText;
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "");
    logDebug(
      `${debugPrefix} readFile failed (file=${path.basename(filePath)}, task=${task.id})`,
      sanitizeError(errorMessage),
    );
  }

  logDebug(`${debugPrefix} fallback to stored prompt (source=${task.promptSource}, task=${task.id})`);
  return fallbackPrompt;
}
