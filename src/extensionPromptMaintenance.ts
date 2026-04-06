import type * as vscode from "vscode";
import type { ScheduledTask } from "./types";

type PromptUpdate = { id: string; prompt: string };

type PromptMaintenanceDeps = {
  getAllTasks: () => ScheduledTask[];
  updateTaskPrompts: (updates: PromptUpdate[]) => Promise<number>;
  ensureRecurringPromptBackups: () => Promise<number>;
  updateWebviewTasks: (tasks: ScheduledTask[]) => void;
  resolvePromptText: (task: ScheduledTask, preferOpenDocument: boolean) => Promise<string>;
  logError: (...args: unknown[]) => void;
  redactPathsForLog: (message: string) => string;
};

type PromptMaintenanceKeys = {
  promptSyncDateKey: string;
  promptBackupSyncMonthKey: string;
};

export async function syncPromptTemplatesIfNeeded(
  context: vscode.ExtensionContext,
  deps: PromptMaintenanceDeps,
  keys: PromptMaintenanceKeys,
  force = false): Promise<void> {
  const today = new Date();
  const todayParts = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, "0"),
    String(today.getDate()).padStart(2, "0"),
  ];
  const todayKey = todayParts.join("-");

  if (!force) {
    const last = context.globalState.get<string>(keys.promptSyncDateKey, "");
    if (last === todayKey) {
      return;
    }
  }

  const promptUpdates: PromptUpdate[] = [];
  for (const task of deps.getAllTasks()) {
    if (task.promptSource === "inline" || !task.promptPath) {
      continue;
    }

    try {
      const latest = await deps.resolvePromptText(task, false);
      const trimmedLatest = latest.trim();
      if (trimmedLatest && latest !== task.prompt) {
        promptUpdates.push({ id: task.id, prompt: latest }); }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error ?? "");
      deps.logError(
        `[CopilotScheduler] Prompt sync failed for task "${task.name}": ${deps.redactPathsForLog(errorMessage)}`,
      );
    }
  }

  const updated =
    promptUpdates.length > 0
      ? (await deps.updateTaskPrompts(promptUpdates)) > 0
      : false;

  if (updated) {
    deps.updateWebviewTasks(deps.getAllTasks());
  }

  await context.globalState.update(keys.promptSyncDateKey, todayKey);
}

export async function syncRecurringPromptBackupsIfNeeded(
  context: vscode.ExtensionContext,
  deps: PromptMaintenanceDeps,
  keys: PromptMaintenanceKeys,
  force = false,
): Promise<void> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!force) {
    const last = context.globalState.get<string>(
      keys.promptBackupSyncMonthKey,
      "",
    );
    if (last === monthKey) {
      return;
    }
  }

  const updated = await deps.ensureRecurringPromptBackups();
  if (updated > 0) {
    deps.updateWebviewTasks(deps.getAllTasks());
  }

  await context.globalState.update(keys.promptBackupSyncMonthKey, monthKey);
}

export function runPromptMaintenanceCycle(
  context: vscode.ExtensionContext,
  deps: PromptMaintenanceDeps,
  keys: PromptMaintenanceKeys,
  force: boolean,
  logMaintenanceError: (prefix: string, error: unknown) => void,
): void {
  void syncPromptTemplatesIfNeeded(context, deps, keys, force).catch((error) =>
    logMaintenanceError(
      force
        ? "[CopilotScheduler] Prompt template sync failed:"
        : "[CopilotScheduler] Prompt template daily sync failed:",
      error,
    ),
  );

  void syncRecurringPromptBackupsIfNeeded(context, deps, keys, force).catch(
    (error) =>
      logMaintenanceError(
        force
          ? "[CopilotScheduler] Recurring prompt backup sync failed:"
          : "[CopilotScheduler] Prompt backup monthly sync failed:",
        error,
      ),
  );
}
