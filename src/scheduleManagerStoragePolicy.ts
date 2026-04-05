import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";
import { selectTaskStore } from "./taskStoreSelection";
import {
  readTaskStorageMetaFromFile,
  readTaskStorageMetaFromState,
  writeTaskStorageMetaToFile,
  writeTaskStorageMetaToState,
  type StoredTasksReadResult,
  type TaskStorageMeta,
} from "./scheduleManagerPersistence";
import type { ScheduledTask } from "./types";

type StorageKeys = {
  taskList: string;
  revision: string;
  savedAt: string;
};

export function resolveScheduleManagerStoragePaths(
  globalStoragePath: string,
  storageFileName: string,
  storageMetaFileName: string,
): { storageFilePath: string; storageMetaFilePath: string } {
  return {
    storageFilePath: path.join(globalStoragePath, storageFileName),
    storageMetaFilePath: path.join(globalStoragePath, storageMetaFileName),
  };
}

export function selectScheduleManagerTaskStore(options: {
  globalState: vscode.Memento;
  keys: StorageKeys;
  savedTasks: ScheduledTask[];
  fileLoad: StoredTasksReadResult;
  storageMetaFilePath: string;
}): {
  tasksToLoad: ScheduledTask[];
  revision: number;
  shouldHealFile: boolean;
  shouldHealGlobalState: boolean;
} {
  const globalMeta = readTaskStorageMetaFromState(
    options.globalState,
    options.keys.revision,
    options.keys.savedAt,
  );
  const fileMeta =
    readTaskStorageMetaFromFile(options.storageMetaFilePath) || {
      revision: 0,
      savedAt: "",
    };

  const globalStoreExists =
    (Array.isArray(options.savedTasks) && options.savedTasks.length > 0) ||
    (typeof globalMeta.revision === "number" && globalMeta.revision > 0);

  const fileStoreExists =
    options.fileLoad.ok ||
    fs.existsSync(options.storageMetaFilePath) ||
    (typeof fileMeta.revision === "number" && fileMeta.revision > 0);

  const selection = selectTaskStore<ScheduledTask>(
    {
      kind: "globalState",
      exists: globalStoreExists,
      ok: true,
      tasks: options.savedTasks,
      revision: globalMeta.revision,
    },
    {
      kind: "file",
      exists: fileStoreExists,
      ok: options.fileLoad.ok,
      tasks: options.fileLoad.tasks,
      revision: fileMeta.revision,
    },
  );

  return {
    tasksToLoad: selection.chosenTasks.slice(),
    revision: selection.chosenRevision || 0,
    shouldHealFile: selection.shouldHealFile,
    shouldHealGlobalState: selection.shouldHealGlobalState,
  };
}

export async function persistScheduleManagerTaskStore(options: {
  tasksArray: ScheduledTask[];
  bumpRevision: boolean;
  currentRevision: number;
  storageMetaFilePath: string;
  globalState: vscode.Memento;
  keys: Pick<StorageKeys, "revision" | "savedAt">;
  saveTasksToFile: (tasksArray: ScheduledTask[]) => Promise<void>;
  saveTasksToGlobalState: (tasksArray: ScheduledTask[]) => Promise<void>;
  syncGlobalTasksToSqlite?: () => Promise<void>;
  logDebug: (...args: unknown[]) => void;
  toSafeSchedulerErrorDetails: (error: unknown) => string;
}): Promise<number> {
  const nextRevision = options.bumpRevision
    ? options.currentRevision + 1
    : options.currentRevision;
  const meta: TaskStorageMeta = {
    revision: nextRevision,
    savedAt: new Date().toISOString(),
  };

  try {
    await options.saveTasksToFile(options.tasksArray);
    await writeTaskStorageMetaToFile(options.storageMetaFilePath, meta);
    if (options.syncGlobalTasksToSqlite) {
      await options.syncGlobalTasksToSqlite();
    }

    void Promise.all([
      options.saveTasksToGlobalState(options.tasksArray),
      writeTaskStorageMetaToState(
        options.globalState,
        options.keys.revision,
        options.keys.savedAt,
        meta,
      ),
    ]).catch((error) =>
      options.logDebug(
        "[CopilotScheduler] Task save to globalState failed (file succeeded):",
        options.toSafeSchedulerErrorDetails(error),
      ),
    );

    return meta.revision;
  } catch (fileError) {
    try {
      await options.saveTasksToGlobalState(options.tasksArray);
      await writeTaskStorageMetaToState(
        options.globalState,
        options.keys.revision,
        options.keys.savedAt,
        meta,
      );
    } catch (globalStateError) {
      throw globalStateError instanceof Error
        ? globalStateError
        : new Error(String(globalStateError ?? ""));
    }

    void Promise.all([
      options.saveTasksToFile(options.tasksArray),
      writeTaskStorageMetaToFile(options.storageMetaFilePath, meta),
    ]).catch((error) =>
      options.logDebug(
        "[CopilotScheduler] Task save to file failed (globalState succeeded):",
        {
          fileError: options.toSafeSchedulerErrorDetails(fileError),
          syncError: options.toSafeSchedulerErrorDetails(error),
        },
      ),
    );

    return meta.revision;
  }
}
