import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { messages } from "./i18n";
import { logError } from "./logger";
import {
  getCanonicalPromptBackupPath,
  getDefaultPromptBackupRelativePath,
  isRecurringPromptBackupCandidate,
  renderPromptBackupContent,
  resolvePromptBackupPath,
  toWorkspaceRelativePromptBackupPath,
} from "./promptBackup";
import { normalizeForCompare } from "./promptResolver";
import { getSchedulerLocalDateKey, toSafeSchedulerErrorDetails } from "./copilotManagerPersistence";
import type { ScheduledTask } from "./types";

export type ScheduleManagerDailyState = {
  count: number;
  date: string;
  notifiedDate: string;
};

type DailyStateKeys = {
  count: string;
  date: string;
  notifiedDate: string;
};

export function persistGlobalStateValueBestEffort<T>(
  globalState: vscode.Memento,
  key: string,
  value: T,
  failurePrefix: string,
): void {
  void globalState.update(key, value).then(
    undefined,
    (error: unknown) => logError(failurePrefix, toSafeSchedulerErrorDetails(error)),
  );
}

export function loadDailyExecState(
  globalState: vscode.Memento,
  keys: DailyStateKeys,
): ScheduleManagerDailyState {
  const today = getSchedulerLocalDateKey();
  const savedDate = globalState.get<string>(keys.date, "");
  const notifiedDate = globalState.get<string>(keys.notifiedDate, "");

  if (savedDate === today) {
    return {
      count: globalState.get<number>(keys.count, 0),
      date: today,
      notifiedDate,
    };
  }

  persistGlobalStateValueBestEffort(
    globalState,
    keys.count,
    0,
    "[CopilotScheduler] Failed to reset daily execution count:",
  );
  persistGlobalStateValueBestEffort(
    globalState,
    keys.date,
    today,
    "[CopilotScheduler] Failed to reset daily execution date:",
  );

  return {
    count: 0,
    date: today,
    notifiedDate,
  };
}

export function incrementDailyExecState(
  state: Pick<ScheduleManagerDailyState, "count" | "date">,
  date = new Date(),
): Pick<ScheduleManagerDailyState, "count" | "date"> {
  const today = getSchedulerLocalDateKey(date);
  if (state.date !== today) {
    return {
      ...state,
      count: 1,
      date: today,
    };
  }

  return {
    ...state,
    count: state.count + 1,
  };
}

export async function persistDailyExecState(
  globalState: vscode.Memento,
  keys: Pick<DailyStateKeys, "count" | "date">,
  state: Pick<ScheduleManagerDailyState, "count" | "date">,
): Promise<void> {
  const today = state.date || getSchedulerLocalDateKey();
  await globalState.update(keys.count, state.count);
  await globalState.update(keys.date, today);
}

export function notifyDailyLimitReachedOnce(options: {
  currentNotifiedDate: string;
  todayKey: string;
  maxDailyLimit: number;
  globalState: vscode.Memento;
  notifiedDateKey: string;
}): string {
  if (options.currentNotifiedDate === options.todayKey) {
    return options.currentNotifiedDate;
  }

  persistGlobalStateValueBestEffort(
    options.globalState,
    options.notifiedDateKey,
    options.todayKey,
    "[CopilotScheduler] Failed to persist daily limit notified date:",
  );
  void vscode.window.showInformationMessage(
    messages.dailyLimitReached(options.maxDailyLimit),
  );
  return options.todayKey;
}

export async function syncRecurringPromptBackupsForTasks(
  tasks: Iterable<ScheduledTask>,
  getPrimaryWorkspaceRoot: () => string | undefined,
): Promise<{ metadataChanged: number }> {
  let metadataChanged = 0;

  for (const task of tasks) {
    if (!isRecurringPromptBackupCandidate(task)) {
      continue;
    }

    const workspaceRoot =
      (task.scope === "workspace" && task.workspacePath) || getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      continue;
    }

    const backupPathCandidate =
      typeof task.promptBackupPath === "string" && task.promptBackupPath.trim().length > 0
        ? task.promptBackupPath.trim()
        : getDefaultPromptBackupRelativePath(task.id);

    const resolvedExistingBackupPath =
      resolvePromptBackupPath(workspaceRoot, backupPathCandidate) ??
      resolvePromptBackupPath(
        workspaceRoot,
        getDefaultPromptBackupRelativePath(task.id),
      );

    const resolvedBackupPath =
      getCanonicalPromptBackupPath(workspaceRoot, backupPathCandidate) ??
      getCanonicalPromptBackupPath(
        workspaceRoot,
        getDefaultPromptBackupRelativePath(task.id),
      );

    if (!resolvedBackupPath) {
      continue;
    }

    const relativeBackupPath = toWorkspaceRelativePromptBackupPath(
      workspaceRoot,
      resolvedBackupPath,
    );

    const storedBackupUpdatedAt =
      task.promptBackupUpdatedAt instanceof Date &&
      !Number.isNaN(task.promptBackupUpdatedAt.getTime())
        ? task.promptBackupUpdatedAt
        : undefined;

    const expectedContent = storedBackupUpdatedAt
      ? renderPromptBackupContent(task, storedBackupUpdatedAt)
      : undefined;

    let needsWrite = !expectedContent;

    if (expectedContent) {
      try {
        const existingContent = await fs.promises.readFile(
          resolvedBackupPath,
          "utf8",
        );
        needsWrite = existingContent !== expectedContent;
      } catch {
        needsWrite = true;
      }
    }

    if (needsWrite) {
      const syncedAt = new Date();
      await fs.promises.mkdir(path.dirname(resolvedBackupPath), {
        recursive: true,
      });
      await fs.promises.writeFile(
        resolvedBackupPath,
        renderPromptBackupContent(task, syncedAt),
        "utf8",
      );
      task.promptBackupUpdatedAt = syncedAt;
      metadataChanged++;
    }

    if (task.promptBackupPath !== relativeBackupPath) {
      task.promptBackupPath = relativeBackupPath;
      metadataChanged++;
    }

    if (
      resolvedExistingBackupPath &&
      normalizeForCompare(resolvedExistingBackupPath) !==
        normalizeForCompare(resolvedBackupPath)
    ) {
      try {
        await fs.promises.rm(resolvedExistingBackupPath, { force: true });
      } catch {
        // ignore best-effort legacy cleanup failures
      }
    }
  }

  return { metadataChanged };
}
