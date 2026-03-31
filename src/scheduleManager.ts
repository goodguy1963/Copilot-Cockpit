/**
 * Copilot Cockpit - Schedule Manager
 * Handles task CRUD operations, cron scheduling, and persistence
 */

import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { parseExpression } from "cron-parser";
import type {
  ScheduledTask,
  CreateTaskInput,
  TaskScope,
  ChatSessionBehavior,
  JobDefinition,
  JobFolder,
  JobNode,
  JobPauseNode,
  JobRuntimeState,
  JobTaskNode,
  SchedulerWorkspaceConfig,
  CreateJobInput,
  CreateJobPauseInput,
  CreateJobFolderInput,
} from "./types";
import { messages } from "./i18n";
import { logDebug, logError } from "./logger";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import {
  getResolvedWorkspaceRoots,
  getPrivateSchedulerConfigPath,
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./schedulerJsonSanitizer";
import { selectTaskStore } from "./taskStoreSelection";
import {
  normalizeForCompare,
  resolveGlobalPromptPath,
  resolveGlobalPromptsRoot,
  resolveLocalPromptPath,
} from "./promptResolver";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import {
  getCanonicalPromptBackupPath,
  getDefaultPromptBackupRelativePath,
  isRecurringPromptBackupCandidate,
  renderPromptBackupContent,
  resolvePromptBackupPath,
  toWorkspaceRelativePromptBackupPath,
} from "./promptBackup";
import {
  createScheduleHistorySnapshot,
  listScheduleHistoryEntries,
  readScheduleHistorySnapshot,
} from "./scheduleHistory";
import type { ScheduleHistoryEntry } from "./types";

// Node.js globals
declare const setTimeout: (callback: () => void, ms: number) => NodeJS.Timeout;
declare const clearTimeout: (timeoutId: NodeJS.Timeout) => void;
declare const setInterval: (callback: () => void, ms: number) => NodeJS.Timeout;
declare const clearInterval: (intervalId: NodeJS.Timeout) => void;
declare const console: {
  error: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
};

const STORAGE_KEY = "scheduledTasks";
const STORAGE_FILE_NAME = "scheduledTasks.json";
const STORAGE_META_FILE_NAME = "scheduledTasks.meta.json";
const STORAGE_REVISION_KEY = "scheduledTasksRevision";
const STORAGE_SAVED_AT_KEY = "scheduledTasksSavedAt";
const DAILY_EXEC_COUNT_KEY = "dailyExecCount";
const DAILY_EXEC_DATE_KEY = "dailyExecDate";
const DAILY_LIMIT_NOTIFIED_DATE_KEY = "dailyLimitNotifiedDate";
const DISCLAIMER_ACCEPTED_KEY = "disclaimerAccepted";

type TaskStorageMeta = {
  revision: number;
  savedAt: string; // ISO string
};

function getLocalDateKey(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toSafeErrorDetails(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeAbsolutePathDetails(raw) || raw;
}

function readSchedulerJsonFile(
  configPath: string,
): SchedulerWorkspaceConfig | undefined {
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tasks)) {
      return {
        ...parsed,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        jobFolders: Array.isArray(parsed.jobFolders) ? parsed.jobFolders : [],
      } as SchedulerWorkspaceConfig;
    }
  } catch {
    // ignore malformed files and let callers fall back
  }

  return undefined;
}

type WorkspaceSchedulerState = {
  tasks: ScheduledTask[];
  jobs: JobDefinition[];
  jobFolders: JobFolder[];
};

type JobPauseResolution = {
  job: JobDefinition;
  previousTaskId?: string;
};

/**
 * Manages scheduled tasks including CRUD operations, cron parsing, and persistence
 */
export class ScheduleManager {
  private static readonly BUNDLED_JOB_FOLDER_NAME = "Bundled Jobs";

  private tasks: Map<string, ScheduledTask> = new Map();
  private jobs: Map<string, JobDefinition> = new Map();
  private jobFolders: Map<string, JobFolder> = new Map();
  private suppressedOverdueTaskIds: Set<string> = new Set();
  private schedulerInterval: ReturnType<typeof setInterval> | undefined;
  private schedulerTimeout: ReturnType<typeof setTimeout> | undefined;
  private schedulerTickInProgress = false;
  private schedulerTickPending = false;
  private context: vscode.ExtensionContext;
  private storageFilePath: string;
  private storageMetaFilePath: string;
  private onTasksChangedCallback: (() => void) | undefined;
  private onExecuteCallback:
    | ((task: ScheduledTask) => Promise<void>)
    | undefined;
  private dailyExecCount = 0;
  private dailyExecDate = "";
  private dailyLimitNotifiedDate = "";

  private storageRevision = 0;

  private saveQueue: Promise<void> = Promise.resolve();

  private static readonly FIRST_RUN_DELAY_MINUTES = 3;

  private getOpenWorkspaceFolderPaths(): string[] {
    return (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri.fsPath)
      .filter((folderPath): folderPath is string =>
        typeof folderPath === "string" && folderPath.trim().length > 0,
      );
  }

  private getResolvedWorkspaceRoots(): string[] {
    return getResolvedWorkspaceRoots(this.getOpenWorkspaceFolderPaths());
  }

  private getPrimaryWorkspaceRoot(): string | undefined {
    return this.getResolvedWorkspaceRoots()[0];
  }

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.storageFilePath = path.join(
      this.context.globalStorageUri.fsPath,
      STORAGE_FILE_NAME,
    );
    this.storageMetaFilePath = path.join(
      this.context.globalStorageUri.fsPath,
      STORAGE_META_FILE_NAME,
    );
    this.loadDailyExecCount();
    this.dailyLimitNotifiedDate = this.context.globalState.get<string>(
      DAILY_LIMIT_NOTIFIED_DATE_KEY,
      "",
    );
    this.loadTasks();
  }

  private loadMetaFromFile(): TaskStorageMeta | undefined {
    try {
      if (!this.storageMetaFilePath) return undefined;
      if (!fs.existsSync(this.storageMetaFilePath)) return undefined;
      const raw = fs.readFileSync(this.storageMetaFilePath, "utf8");
      if (!raw.trim()) return undefined;
      const parsed = JSON.parse(raw) as Partial<TaskStorageMeta>;
      const revision =
        typeof parsed.revision === "number" ? parsed.revision : 0;
      const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
      return { revision, savedAt };
    } catch {
      return undefined;
    }
  }

  private loadMetaFromGlobalState(): TaskStorageMeta {
    const revision = this.context.globalState.get<number>(
      STORAGE_REVISION_KEY,
      0,
    );
    const savedAt = this.context.globalState.get<string>(
      STORAGE_SAVED_AT_KEY,
      "",
    );
    return { revision: typeof revision === "number" ? revision : 0, savedAt };
  }

  private async saveMetaToFile(meta: TaskStorageMeta): Promise<void> {
    const dir = path.dirname(this.storageMetaFilePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      this.storageMetaFilePath,
      JSON.stringify(meta),
      "utf8",
    );
  }

  private async saveMetaToGlobalState(meta: TaskStorageMeta): Promise<void> {
    await this.context.globalState.update(STORAGE_REVISION_KEY, meta.revision);
    await this.context.globalState.update(STORAGE_SAVED_AT_KEY, meta.savedAt);
  }

  private loadTasksFromFile(): { tasks: ScheduledTask[]; ok: boolean } {
    try {
      if (!this.storageFilePath) return { tasks: [], ok: false };
      if (!fs.existsSync(this.storageFilePath)) return { tasks: [], ok: false };
      const raw = fs.readFileSync(this.storageFilePath, "utf8");
      if (!raw.trim()) return { tasks: [], ok: true };
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return { tasks: [], ok: false };
      return { tasks: parsed as ScheduledTask[], ok: true };
    } catch (error) {
      logDebug(
        "[CopilotScheduler] Failed to load tasks from file:",
        toSafeErrorDetails(error),
      );
      return { tasks: [], ok: false };
    }
  }

  private async saveTasksToFile(tasksArray: ScheduledTask[]): Promise<void> {
    const dir = path.dirname(this.storageFilePath);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(
      this.storageFilePath,
      JSON.stringify(tasksArray),
      "utf8",
    );
  }

  private async saveTasksToGlobalState(
    tasksArray: ScheduledTask[],
  ): Promise<void> {
    const timeoutMs = 10000;

    const updateThenable = this.context.globalState.update(
      STORAGE_KEY,
      tasksArray,
    );
    const updatePromise = Promise.resolve(updateThenable);

    let timerId: NodeJS.Timeout | undefined;
    const result = await Promise.race([
      updatePromise.then(() => "ok" as const),
      new Promise<"timeout">((resolve) => {
        timerId = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);

    if (timerId !== undefined) {
      clearTimeout(timerId);
    }

    if (result === "timeout") {
      void updatePromise.catch(() => undefined);
      throw new Error(messages.storageWriteTimeout());
    }
  }

  // ==================== Safety: Daily Execution Limit ====================

  /**
   * Load daily execution count from globalState
   */
  private loadDailyExecCount(): void {
    const today = getLocalDateKey();
    const savedDate = this.context.globalState.get<string>(
      DAILY_EXEC_DATE_KEY,
      "",
    );
    if (savedDate === today) {
      this.dailyExecCount = this.context.globalState.get<number>(
        DAILY_EXEC_COUNT_KEY,
        0,
      );
    } else {
      // New day, reset counter
      this.dailyExecCount = 0;
      void this.context.globalState
        .update(DAILY_EXEC_COUNT_KEY, 0)
        .then(undefined, (error: unknown) =>
          logError(
            "[CopilotScheduler] Failed to reset daily execution count:",
            toSafeErrorDetails(error),
          ),
        );
      void this.context.globalState
        .update(DAILY_EXEC_DATE_KEY, today)
        .then(undefined, (error: unknown) =>
          logError(
            "[CopilotScheduler] Failed to reset daily execution date:",
            toSafeErrorDetails(error),
          ),
        );
    }
    this.dailyExecDate = today;
  }

  private incrementDailyExecCountInMemory(date = new Date()): void {
    const today = getLocalDateKey(date);
    if (this.dailyExecDate !== today) {
      this.dailyExecCount = 0;
      this.dailyExecDate = today;
    }
    this.dailyExecCount++;
  }

  private async persistDailyExecCount(): Promise<void> {
    const today = this.dailyExecDate || getLocalDateKey();
    await this.context.globalState.update(
      DAILY_EXEC_COUNT_KEY,
      this.dailyExecCount,
    );
    await this.context.globalState.update(DAILY_EXEC_DATE_KEY, today);
  }

  /**
   * Bulk update task prompts (used by template sync) and save once.
   */
  async updateTaskPrompts(
    updates: Array<{ id: string; prompt: string }>,
  ): Promise<number> {
    if (!Array.isArray(updates) || updates.length === 0) {
      return 0;
    }

    const now = new Date();
    let changed = 0;

    for (const item of updates) {
      if (!item || typeof item.id !== "string") continue;
      const nextPrompt = typeof item.prompt === "string" ? item.prompt : "";
      if (!nextPrompt.trim()) continue;

      const task = this.tasks.get(item.id);
      if (!task) continue;
      if (task.prompt === nextPrompt) continue;
      task.prompt = nextPrompt;
      task.updatedAt = now;
      changed++;
    }

    if (changed > 0) {
      await this.saveTasks();
    }

    return changed;
  }

  async ensureRecurringPromptBackups(): Promise<number> {
    const changed = await this.syncRecurringPromptBackupsInPlace();

    if (changed.metadataChanged > 0) {
      await this.saveTasks({ bumpRevision: false });
    }

    return changed.metadataChanged;
  }

  private async syncRecurringPromptBackupsInPlace(): Promise<{
    metadataChanged: number;
  }> {
    let metadataChanged = 0;

    for (const task of this.tasks.values()) {
      if (!isRecurringPromptBackupCandidate(task)) {
        continue;
      }

      const workspaceRoot =
        (task.scope === "workspace" && task.workspacePath) ||
        this.getPrimaryWorkspaceRoot();
      if (!workspaceRoot) {
        continue;
      }

      const backupPathCandidate =
        typeof task.promptBackupPath === "string" &&
          task.promptBackupPath.trim().length > 0
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

  /**
   * Check if daily execution limit has been reached.
   * @param maxDailyLimit - Pre-computed limit (0 = unlimited). Pass from caller to avoid redundant config reads.
   */
  private isDailyLimitReached(maxDailyLimit: number): boolean {
    // 0 = unlimited (no daily limit, use at your own risk)
    if (maxDailyLimit === 0) {
      return false;
    }
    const today = getLocalDateKey();
    if (this.dailyExecDate !== today) {
      this.dailyExecCount = 0;
      this.dailyExecDate = today;
    }
    return this.dailyExecCount >= maxDailyLimit;
  }

  // ==================== Safety: Jitter (Random Delay) ====================

  private clampJitterSeconds(value: unknown): number {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) return 0;
    const i = Math.floor(n);
    return Math.min(Math.max(i, 0), 1800);
  }

  /**
   * Apply random jitter delay to reduce machine-like patterns
   */
  private async applyJitter(maxJitterSeconds: number): Promise<void> {
    const clamped = this.clampJitterSeconds(maxJitterSeconds);
    if (clamped <= 0) return;

    const jitterMs = Math.floor(Math.random() * clamped * 1000);
    const jitterSec = Math.round(jitterMs / 1000);
    if (jitterSec > 0) {
      logDebug(`[CopilotScheduler] Jitter: waiting ${jitterSec}s`);
      await new Promise<void>((resolve) => setTimeout(resolve, jitterMs));
    }
  }

  // ==================== Safety: Minimum Interval Warning ====================

  /**
   * Check if a cron expression has a short interval and return warning if so
   */
  checkMinimumInterval(cronExpression: string): string | undefined {
    const currentDate = new Date();
    const tz = this.getTimeZone();

    const check = (options: {
      currentDate: Date;
      tz?: string;
    }): string | undefined => {
      const interval = parseExpression(cronExpression, options);
      const first = interval.next().toDate();
      const second = interval.next().toDate();
      const diffMinutes = (second.getTime() - first.getTime()) / (1000 * 60);

      if (diffMinutes < 30) {
        return messages.minimumIntervalWarning();
      }
      return undefined;
    };

    try {
      return check(tz ? { currentDate, tz } : { currentDate });
    } catch {
      // If parsing fails with the configured timezone, fall back to local time (U9).
      if (tz) {
        try {
          return check({ currentDate });
        } catch {
          // If parsing fails, skip interval check
        }
      }
      return undefined;
    }
  }

  // ==================== Safety: Disclaimer ====================

  /**
   * Check if the user has accepted the disclaimer
   */
  isDisclaimerAccepted(): boolean {
    return this.context.globalState.get<boolean>(
      DISCLAIMER_ACCEPTED_KEY,
      false,
    );
  }

  /**
   * Set disclaimer accepted state
   */
  async setDisclaimerAccepted(accepted: boolean): Promise<void> {
    await this.context.globalState.update(DISCLAIMER_ACCEPTED_KEY, accepted);
  }

  /**
   * Set callback for when tasks change
   */
  setOnTasksChangedCallback(callback: () => void): void {
    this.onTasksChangedCallback = callback;
  }

  setOnExecuteCallback(callback: (task: ScheduledTask) => Promise<void>): void {
    this.onExecuteCallback = callback;
  }

  /**
   * Notify that tasks have changed
   */
  private notifyTasksChanged(): void {
    if (this.onTasksChangedCallback) {
      this.onTasksChangedCallback();
    }
  }

  /**
   * Public reload method for file watchers
   */
  public reloadTasks(): void {
    this.loadTasks();
    if (this.onTasksChangedCallback) {
      this.onTasksChangedCallback();
    }
  }

  /**
   * Load tasks from globalState
   */
  private loadTasks(): void {
    const savedTasks = this.context.globalState.get<ScheduledTask[]>(
      STORAGE_KEY,
      [],
    );
    const fileLoad = this.loadTasksFromFile();
    const fileTasks = fileLoad.tasks;

    const globalMeta = this.loadMetaFromGlobalState();
    const fileMeta = this.loadMetaFromFile() || { revision: 0, savedAt: "" };

    const globalStoreExists =
      (Array.isArray(savedTasks) && savedTasks.length > 0) ||
      (typeof globalMeta.revision === "number" && globalMeta.revision > 0);

    const fileStoreExists =
      fileLoad.ok ||
      fs.existsSync(this.storageMetaFilePath) ||
      (typeof fileMeta.revision === "number" && fileMeta.revision > 0);

    const selection = selectTaskStore<ScheduledTask>(
      {
        kind: "globalState",
        exists: globalStoreExists,
        ok: true,
        tasks: savedTasks,
        revision: globalMeta.revision,
      },
      {
        kind: "file",
        exists: fileStoreExists,
        ok: fileLoad.ok,
        tasks: fileTasks,
        revision: fileMeta.revision,
      },
    );

    // Choose newer store by revision (handles deletes correctly).
    // IMPORTANT: an empty task array can still be the newest state (e.g., deleting the last task).
    const tasksToLoad = selection.chosenTasks;
    this.storageRevision = selection.chosenRevision || 0;

    /* --- HBG Custom: Load from .vscode/scheduler.json --- */
    const workspaceState = this.loadWorkspaceSchedulerState();
    const workspaceTasks = workspaceState.tasks;
    this.jobs = new Map(workspaceState.jobs.map((job) => [job.id, job]));
    this.jobFolders = new Map(
      workspaceState.jobFolders.map((folder) => [folder.id, folder]),
    );
    // Apply workspace JSON as authoritative for workspace-scoped tasks.
    // This must also work when JSON contains zero tasks (clear/remove case).
    const existingMap = new Map<string, ScheduledTask>();
    tasksToLoad.forEach((t) => {
      if (t.scope !== "workspace") {
        existingMap.set(t.id, t);
      }
    });

    workspaceTasks.forEach((jsonTask) => {
      existingMap.set(jsonTask.id, jsonTask);
    });

    tasksToLoad.length = 0;
    tasksToLoad.push(...Array.from(existingMap.values()));
    /* ---------------------------------------------------- */

    let needsSave = false;

    // Rebuild in-memory cache from selected stores on each load.
    // Without clearing first, removed tasks can linger until full window reload.
    this.tasks.clear();
    const loadedTaskIds = new Set<string>();

    for (const task of tasksToLoad) {
      // Restore Date objects from JSON serialization
      task.createdAt = new Date(task.createdAt);
      task.updatedAt = new Date(task.updatedAt);
      if (task.lastRun !== undefined) {
        task.lastRun = new Date(task.lastRun);
      }
      if (task.promptBackupUpdatedAt !== undefined) {
        task.promptBackupUpdatedAt = new Date(task.promptBackupUpdatedAt);
      }
      if (task.nextRun !== undefined) {
        task.nextRun = new Date(task.nextRun);
      }

      // Recovery: avoid keeping Invalid Date objects (would break JSON serialization).
      // When dates are corrupted/missing, heal them and persist once.
      const healedNow = new Date();
      if (Number.isNaN(task.createdAt.getTime())) {
        task.createdAt = healedNow;
        needsSave = true;
      }
      if (Number.isNaN(task.updatedAt.getTime())) {
        task.updatedAt = task.createdAt;
        needsSave = true;
      }
      if (task.lastRun && Number.isNaN(task.lastRun.getTime())) {
        task.lastRun = undefined;
        needsSave = true;
      }
      if (
        task.promptBackupUpdatedAt &&
        Number.isNaN(task.promptBackupUpdatedAt.getTime())
      ) {
        task.promptBackupUpdatedAt = undefined;
        needsSave = true;
      }
      if (task.nextRun && Number.isNaN(task.nextRun.getTime())) {
        task.nextRun = undefined;
        needsSave = true;
      }

      const normalizedChatSession = this.normalizeTaskChatSession(
        task.chatSession,
        task.oneTime === true,
      );
      if (task.chatSession !== normalizedChatSession) {
        task.chatSession = normalizedChatSession;
        needsSave = true;
      }

      const normalizedLabels = this.normalizeLabels(task.labels);
      if (
        JSON.stringify(task.labels ?? []) !== JSON.stringify(normalizedLabels ?? [])
      ) {
        task.labels = normalizedLabels;
        needsSave = true;
      }

      if (task.jobId && !this.jobs.has(task.jobId)) {
        task.jobId = undefined;
        task.jobNodeId = undefined;
        needsSave = true;
      }

      // Migration: add missing fields for older tasks
      if (!task.scope) {
        task.scope = "global";
      }
      {
        const promptPath =
          typeof task.promptPath === "string" ? task.promptPath.trim() : "";
        const hasPromptPath = promptPath.length > 0;

        const inferPromptSource = (): "inline" | "local" | "global" => {
          if (!hasPromptPath) return "inline";

          const workspaceFolderPaths = this.getResolvedWorkspaceRoots();

          // Prefer global if it matches the configured (or default) global prompts root.
          const globalRoot = resolveGlobalPromptsRoot(
            getCompatibleConfigurationValue<string>("globalPromptsPath", ""),
          );
          if (resolveGlobalPromptPath(globalRoot, promptPath)) {
            return "global";
          }

          if (resolveLocalPromptPath(workspaceFolderPaths, promptPath)) {
            return "local";
          }

          return "inline";
        };

        // Migration: promptSource was introduced later; infer it from promptPath.
        // Also heal inconsistent data where promptSource is inline but promptPath exists.
        const isKnownSource =
          task.promptSource === "inline" ||
          task.promptSource === "local" ||
          task.promptSource === "global";

        if (!task.promptSource || !isKnownSource) {
          task.promptSource = inferPromptSource();
          if (task.promptSource === "inline" && !hasPromptPath) {
            task.promptPath = undefined;
          }
          needsSave = true;
        } else if (task.promptSource === "inline" && hasPromptPath) {
          const inferred = inferPromptSource();
          if (inferred !== "inline") {
            task.promptSource = inferred;
            needsSave = true;
          }
        }
      }

      // Migration: add jitterSeconds if missing
      if (task.jitterSeconds === undefined) {
        task.jitterSeconds = 0;
      }

      // Safety: if a stored task has an invalid cron expression (e.g., manual edits or corruption),
      // disable it to prevent runaway execution loops.
      try {
        this.validateCronExpression(task.cronExpression);
      } catch {
        if (task.enabled) {
          task.enabled = false;
          needsSave = true;
        }
        if (task.nextRun !== undefined) {
          task.nextRun = undefined;
          needsSave = true;
        }
        logError(
          "[CopilotScheduler] Invalid cron expression found in stored task; disabling:",
          {
            taskId: task.id,
            taskName: task.name,
            cronExpression: task.cronExpression,
          },
        );
      }

      // Keep persisted nextRun to allow catch-up execution after reload.
      // Only compute nextRun when it's missing or invalid.
      if (task.jobId) {
        // Job-managed tasks are synchronized after the load pass.
      } else if (task.enabled) {
        const hasValidNextRun =
          task.nextRun instanceof Date && !Number.isNaN(task.nextRun.getTime());
        if (!hasValidNextRun) {
          const now = new Date();
          task.nextRun = this.getNextRunForTask(task.cronExpression, now);
          needsSave = true;
        }
      } else if (task.nextRun !== undefined) {
        task.nextRun = undefined;
        needsSave = true;
      }

      this.tasks.set(task.id, task);
      loadedTaskIds.add(task.id);
    }

    if (this.syncJobTaskSchedules(new Date())) {
      needsSave = true;
    }

    this.suppressedOverdueTaskIds = new Set(
      Array.from(this.suppressedOverdueTaskIds).filter((id) =>
        loadedTaskIds.has(id),
      ),
    );

    // Save if any changes were made
    if (needsSave) {
      void this.saveTasks().catch((error) =>
        logError(
          "[CopilotScheduler] Failed to save migrated tasks:",
          toSafeErrorDetails(error),
        ),
      );
    } else {
      // Heal the other store if needed (best effort, do not bump revision)
      if (selection.shouldHealFile || selection.shouldHealGlobalState) {
        void this.saveTasks({ bumpRevision: false }).catch((error) =>
          logDebug(
            "[CopilotScheduler] Failed to sync task stores:",
            toSafeErrorDetails(error),
          ),
        );
      }
    }
  }

  /**
   * Save tasks to globalState
   */
  private async saveTasks(options?: { bumpRevision?: boolean }): Promise<void> {
    // Serialize saves to avoid last-write-wins races across concurrent callers.
    const op = this.saveQueue.then(() => this.saveTasksInternal(options));
    // Recover the chain so that a failed save does not block all subsequent saves.
    this.saveQueue = op.catch((error) => {
      logError(
        "[CopilotScheduler] Save failed (chain recovered):",
        toSafeErrorDetails(error),
      );
    });
    return op;
  }

  private async saveTasksAndSyncRecurringPromptBackups(options?: {
    bumpRevision?: boolean;
  }): Promise<void> {
    await this.saveTasks(options);
    await this.ensureRecurringPromptBackups();
  }

  private async saveTasksInternal(options?: {
    bumpRevision?: boolean;
  }): Promise<void> {
    const bumpRevision = options?.bumpRevision !== false;
    const tasksArray: ScheduledTask[] = Array.from(this.tasks.values());

    /* --- HBG CUSTOM: Write tasks to .vscode/scheduler.json --- */
    try {
      const workspaceRoot = this.getPrimaryWorkspaceRoot();
      if (workspaceRoot) {
        const existingConfig = readSchedulerConfig(workspaceRoot);

        const fileTasks = tasksArray.filter(t => t.scope === 'workspace').map(t => ({
          id: t.id,
          name: t.name,
          cron: t.cronExpression,
          prompt: t.prompt,
          enabled: t.enabled,
          description: t.description,
          agent: t.agent,
          model: t.model,
          manualSession: t.manualSession,
          chatSession: t.chatSession,
          promptSource: t.promptSource,
          promptPath: t.promptPath,
          promptBackupPath: t.promptBackupPath,
          promptBackupUpdatedAt: t.promptBackupUpdatedAt
            ? new Date(t.promptBackupUpdatedAt).toISOString()
            : undefined,
          jitterSeconds: t.jitterSeconds,
          oneTime: t.oneTime,
          labels: t.labels,
          jobId: t.jobId,
          jobNodeId: t.jobNodeId,
          workspacePath: t.workspacePath,
          lastRun: t.lastRun ? new Date(t.lastRun).toISOString() : undefined,
          lastError: t.lastError,
          lastErrorAt: t.lastErrorAt ? new Date(t.lastErrorAt).toISOString() : undefined,
          nextRun: t.nextRun ? new Date(t.nextRun).toISOString() : undefined,
          createdAt: t.createdAt ? new Date(t.createdAt).toISOString() : undefined,
          updatedAt: t.updatedAt ? new Date(t.updatedAt).toISOString() : undefined,
        }));

        const config: SchedulerWorkspaceConfig = {
          ...existingConfig,
          tasks: fileTasks,
          jobs: this.getAllJobs().map((job) => ({
            ...job,
            runtime: job.runtime
              ? {
                cycleStartedAt: job.runtime.cycleStartedAt,
                currentSegmentStartedAt: job.runtime.currentSegmentStartedAt,
                approvedPauseNodeIds: this.getApprovedPauseNodeIds(job),
                waitingPause: job.runtime.waitingPause
                  ? { ...job.runtime.waitingPause }
                  : undefined,
              }
              : undefined,
            nodes: job.nodes.map((node) =>
              this.isPauseNode(node)
                ? {
                  id: node.id,
                  type: "pause" as const,
                  title: node.title,
                }
                : {
                  id: node.id,
                  type: "task" as const,
                  taskId: node.taskId,
                  windowMinutes: this.normalizeWindowMinutes(node.windowMinutes),
                }),
          })),
          jobFolders: this.getAllJobFolders().map((folder) => ({ ...folder })),
        };
        writeSchedulerConfig(workspaceRoot, config);
      }
    } catch (e) {
      console.error('[Scheduler] Failed to save to .vscode/scheduler.json:', e);
      vscode.window.showErrorMessage(`Failed to save scheduler configuration: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    /* -------------------------------------------------------- */

    const nextRevision = bumpRevision
      ? this.storageRevision + 1
      : this.storageRevision;
    const meta: TaskStorageMeta = {
      revision: nextRevision,
      savedAt: new Date().toISOString(),
    };

    // Prefer file persistence for responsiveness and reliability.
    // If file save succeeds, return immediately and sync globalState in background.
    try {
      await this.saveTasksToFile(tasksArray);
      await this.saveMetaToFile(meta);
      this.storageRevision = meta.revision;

      void Promise.all([
        this.saveTasksToGlobalState(tasksArray),
        this.saveMetaToGlobalState(meta),
      ]).catch((error) =>
        logDebug(
          "[CopilotScheduler] Task save to globalState failed (file succeeded):",
          toSafeErrorDetails(error),
        ),
      );

      this.notifyTasksChanged();
      return;
    } catch (fileError) {
      // If file persistence fails, fall back to globalState (await so at least one store succeeds).
      try {
        await this.saveTasksToGlobalState(tasksArray);
        await this.saveMetaToGlobalState(meta);
        this.storageRevision = meta.revision;
      } catch (globalStateError) {
        throw globalStateError instanceof Error
          ? globalStateError
          : new Error(String(globalStateError ?? ""));
      }

      // Best-effort background file sync for future reliability.
      void Promise.all([
        this.saveTasksToFile(tasksArray),
        this.saveMetaToFile(meta),
      ]).catch((error) =>
        logDebug(
          "[CopilotScheduler] Task save to file failed (globalState succeeded):",
          {
            fileError: toSafeErrorDetails(fileError),
            syncError: toSafeErrorDetails(error),
          },
        ),
      );
    }

    this.notifyTasksChanged();
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `task_${timestamp}_${random}`;
  }

  /**
   * Get timezone from configuration
   */
  private getTimeZone(): string | undefined {
    const tz = getCompatibleConfigurationValue<string>("timezone", "");
    return tz || undefined;
  }

  /**
   * Calculate next run time from cron expression
   */
  private getNextRun(
    cronExpression: string,
    baseTime?: Date,
  ): Date | undefined {
    const currentDate = baseTime || new Date();
    const tz = this.getTimeZone();

    try {
      const options: { currentDate: Date; tz?: string } = { currentDate };
      if (tz) {
        options.tz = tz;
      }

      const interval = parseExpression(cronExpression, options);
      return interval.next().toDate();
    } catch {
      // If the configured timezone is invalid, fall back to local time (U9).
      if (tz) {
        logDebug(
          `[CopilotScheduler] Invalid timezone "${tz}", falling back to local time`,
        );
        try {
          const interval = parseExpression(cronExpression, { currentDate });
          return interval.next().toDate();
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }

  private truncateToMinute(date: Date): Date {
    return new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes(),
    );
  }

  private isTaskDueAt(task: ScheduledTask, referenceTime: Date): boolean {
    if (!task.enabled || !task.nextRun) {
      return false;
    }

    const nextRunMinute = this.truncateToMinute(task.nextRun);
    const referenceMinute = this.truncateToMinute(referenceTime);
    return nextRunMinute.getTime() <= referenceMinute.getTime();
  }

  private getNextRunForTask(cronExpression: string, baseTime: Date): Date {
    // Always use cron-parser to stay aligned with the cron grid.
    // A previous "*/N" fixed-interval optimisation was removed because it
    // drifted from the grid when jitter or execution time shifted baseTime
    // away from a grid-aligned minute (e.g., */5 starting at :03 → :08
    // instead of :05, compounding on every subsequent execution).
    const parsed = this.getNextRun(cronExpression, baseTime);
    if (parsed) {
      return parsed;
    }

    // Fallback: if cron parsing fails unexpectedly, schedule 60 min in the
    // future instead of "now" to prevent rapid-fire execution loops.
    logError(
      `[CopilotScheduler] Failed to parse cron "${cronExpression}"; falling back to +60 min`,
    );
    return this.truncateToMinute(new Date(baseTime.getTime() + 60 * 60 * 1000));
  }

  /**
   * Validate cron expression
   * @throws Error if invalid
   */
  validateCronExpression(expression: string): void {
    if (!expression || !expression.trim()) {
      throw new Error(messages.invalidCronExpression());
    }

    const currentDate = new Date();
    const tz = this.getTimeZone();

    // First, validate with timezone if configured.
    try {
      const options: { currentDate: Date; tz?: string } = { currentDate };
      if (tz) {
        options.tz = tz;
      }
      parseExpression(expression, options);
      return;
    } catch {
      // If timezone is invalid, retry without tz.
      if (tz) {
        try {
          parseExpression(expression, { currentDate });
          return;
        } catch {
          // Fall through to throw
        }
      }
      throw new Error(messages.invalidCronExpression());
    }
  }

  private normalizeTaskChatSession(
    chatSession: unknown,
    oneTime: boolean,
  ): ChatSessionBehavior | undefined {
    if (oneTime) {
      return undefined;
    }

    return chatSession === "new" || chatSession === "continue"
      ? chatSession
      : undefined;
  }

  private normalizeTaskManualSession(
    manualSession: unknown,
    oneTime: boolean,
  ): boolean | undefined {
    if (oneTime) {
      return undefined;
    }

    return manualSession === true ? true : undefined;
  }

  private normalizeLabels(labels: unknown): string[] | undefined {
    const values = Array.isArray(labels)
      ? labels
      : typeof labels === "string"
        ? labels.split(",")
        : [];

    const normalized = values
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter((value) => value.length > 0);

    if (normalized.length === 0) {
      return undefined;
    }

    return Array.from(new Set(normalized));
  }

  private normalizeWindowMinutes(windowMinutes: unknown): number {
    const numeric =
      typeof windowMinutes === "number"
        ? windowMinutes
        : Number(windowMinutes ?? 30);
    if (!Number.isFinite(numeric)) {
      return 30;
    }

    const rounded = Math.floor(numeric);
    return Math.min(Math.max(rounded, 1), 24 * 60);
  }

  private generateScopedId(prefix: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${timestamp}_${random}`;
  }

  private generateJobId(): string {
    return this.generateScopedId("job");
  }

  private generateJobFolderId(): string {
    return this.generateScopedId("jobfolder");
  }

  private generateJobNodeId(): string {
    return this.generateScopedId("jobnode");
  }

  private isPauseNode(node: JobNode | undefined | null): node is JobPauseNode {
    return !!node && node.type === "pause";
  }

  private isTaskNode(node: JobNode | undefined | null): node is JobTaskNode {
    return (
      !!node &&
      node.type !== "pause" &&
      typeof (node as JobTaskNode).taskId === "string" &&
      (node as JobTaskNode).taskId.trim().length > 0
    );
  }

  private parseIsoDate(value: string | undefined): Date | undefined {
    if (!value || typeof value !== "string") {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private getApprovedPauseNodeIds(job: JobDefinition): string[] {
    const values = Array.isArray(job.runtime?.approvedPauseNodeIds)
      ? job.runtime?.approvedPauseNodeIds
      : [];
    return values.filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0,
    );
  }

  private getLastApprovedPauseIndex(job: JobDefinition): number {
    const approvedIds = this.getApprovedPauseNodeIds(job);
    for (let index = job.nodes.length - 1; index >= 0; index -= 1) {
      const node = job.nodes[index];
      if (this.isPauseNode(node) && approvedIds.includes(node.id)) {
        return index;
      }
    }

    return -1;
  }

  private getCurrentSegmentStartIndex(job: JobDefinition): number {
    const lastApprovedPauseIndex = this.getLastApprovedPauseIndex(job);
    return lastApprovedPauseIndex >= 0 ? lastApprovedPauseIndex + 1 : 0;
  }

  private getNextPauseIndex(job: JobDefinition, startIndex: number): number {
    for (let index = Math.max(0, startIndex); index < job.nodes.length; index += 1) {
      if (this.isPauseNode(job.nodes[index])) {
        return index;
      }
    }

    return -1;
  }

  private getSegmentEndExclusive(job: JobDefinition, startIndex: number): number {
    const pauseIndex = this.getNextPauseIndex(job, startIndex);
    return pauseIndex >= 0 ? pauseIndex : job.nodes.length;
  }

  private getJobNodeOffsetMinutes(
    job: JobDefinition,
    nodeIndex: number,
    startIndex = 0,
  ): number {
    return job.nodes.slice(startIndex, nodeIndex).reduce((total, node) => {
      if (!this.isTaskNode(node)) {
        return total;
      }

      return total + this.normalizeWindowMinutes(node.windowMinutes);
    }, 0);
  }

  private hasTaskExecutedSince(task: ScheduledTask | undefined, startAt: Date): boolean {
    return !!task?.lastRun && task.lastRun.getTime() >= startAt.getTime();
  }

  private isJobTaskOutsideCurrentSegment(
    job: JobDefinition,
    nodeIndex: number,
  ): boolean {
    const segmentStartIndex = this.getCurrentSegmentStartIndex(job);
    const segmentEndExclusive = this.getSegmentEndExclusive(job, segmentStartIndex);
    return nodeIndex < segmentStartIndex || nodeIndex >= segmentEndExclusive;
  }

  private getPreviousTaskNodeBeforeIndex(
    job: JobDefinition,
    startIndex: number,
  ): JobTaskNode | undefined {
    for (let index = startIndex - 1; index >= 0; index -= 1) {
      const node = job.nodes[index];
      if (this.isTaskNode(node)) {
        return node;
      }
    }

    return undefined;
  }

  private getPreviousTaskIdForPause(job: JobDefinition, pauseNodeId: string): string | undefined {
    const pauseIndex = job.nodes.findIndex((node) => node.id === pauseNodeId);
    if (pauseIndex < 0) {
      return undefined;
    }

    return this.getPreviousTaskNodeBeforeIndex(job, pauseIndex)?.taskId;
  }

  private getWorkingRuntimeState(job: JobDefinition): JobRuntimeState {
    if (!job.runtime) {
      job.runtime = {};
    }

    job.runtime.approvedPauseNodeIds = this.getApprovedPauseNodeIds(job);
    if (
      job.runtime.waitingPause &&
      (!job.runtime.waitingPause.nodeId ||
        !this.getNode(job, job.runtime.waitingPause.nodeId) ||
        !this.isPauseNode(this.getNode(job, job.runtime.waitingPause.nodeId)))
    ) {
      job.runtime.waitingPause = undefined;
    }

    return job.runtime;
  }

  private clearJobRuntime(job: JobDefinition): void {
    job.runtime = undefined;
  }

  private getNode(job: JobDefinition, nodeId: string): JobNode | undefined {
    return job.nodes.find((candidate) => candidate.id === nodeId);
  }

  private findJobNodeByTaskId(taskId: string):
    | { job: JobDefinition; node: JobTaskNode; nodeIndex: number }
    | undefined {
    for (const job of this.jobs.values()) {
      const nodeIndex = job.nodes.findIndex(
        (candidate) => this.isTaskNode(candidate) && candidate.taskId === taskId,
      );
      if (nodeIndex >= 0) {
        const node = job.nodes[nodeIndex];
        if (!this.isTaskNode(node)) {
          continue;
        }
        return {
          job,
          node,
          nodeIndex,
        };
      }
    }

    return undefined;
  }
  private getPreviousCronOccurrence(
    cronExpression: string,
    referenceTime: Date,
  ): Date | undefined {
    const currentDate = new Date(referenceTime.getTime() + 1);
    const tz = this.getTimeZone();

    try {
      const options: { currentDate: Date; tz?: string } = { currentDate };
      if (tz) {
        options.tz = tz;
      }
      return parseExpression(cronExpression, options).prev().toDate();
    } catch {
      if (tz) {
        try {
          return parseExpression(cronExpression, { currentDate }).prev().toDate();
        } catch {
          return undefined;
        }
      }
      return undefined;
    }
  }

  private getNextRunForJobNode(
    job: JobDefinition,
    nodeIndex: number,
    referenceTime: Date,
  ): Date | undefined {
    if (job.paused === true) {
      return undefined;
    }

    const node = job.nodes[nodeIndex];
    if (!this.isTaskNode(node)) {
      return undefined;
    }

    const runtime = job.runtime;
    if (runtime?.waitingPause?.nodeId) {
      return undefined;
    }

    if (this.isJobTaskOutsideCurrentSegment(job, nodeIndex)) {
      return undefined;
    }

    const segmentStartIndex = this.getCurrentSegmentStartIndex(job);
    const offsetMinutes = this.getJobNodeOffsetMinutes(job, nodeIndex, segmentStartIndex);
    const segmentBase = this.parseIsoDate(runtime?.currentSegmentStartedAt);
    if (segmentBase) {
      const task = this.tasks.get(node.taskId);
      if (this.hasTaskExecutedSince(task, segmentBase)) {
        return undefined;
      }

      return this.truncateToMinute(
        new Date(segmentBase.getTime() + offsetMinutes * 60 * 1000),
      );
    }

    if (segmentStartIndex > 0) {
      return undefined;
    }

    const previousBase = this.getPreviousCronOccurrence(
      job.cronExpression,
      referenceTime,
    );
    if (previousBase) {
      const previousCandidate = this.truncateToMinute(
        new Date(previousBase.getTime() + offsetMinutes * 60 * 1000),
      );
      if (previousCandidate.getTime() > referenceTime.getTime()) {
        return previousCandidate;
      }
    }

    const nextBase = this.getNextRunForTask(job.cronExpression, referenceTime);
    return this.truncateToMinute(
      new Date(nextBase.getTime() + offsetMinutes * 60 * 1000),
    );
  }

  private syncJobTaskSchedules(referenceTime = new Date()): boolean {
    let changed = false;

    for (const job of this.jobs.values()) {
      for (let index = 0; index < job.nodes.length; index += 1) {
        const node = job.nodes[index];
        if (!this.isTaskNode(node)) {
          continue;
        }
        const task = this.tasks.get(node.taskId);
        if (!task) {
          continue;
        }

        const nextRun =
          task.enabled && job.paused !== true
            ? this.getNextRunForJobNode(job, index, referenceTime)
            : undefined;
        const currentNextRun = task.nextRun?.getTime();
        const targetNextRun = nextRun?.getTime();

        if (currentNextRun !== targetNextRun) {
          task.nextRun = nextRun;
          changed = true;
        }
      }
    }

    return changed;
  }

  isTaskSuppressedByJob(task: ScheduledTask): boolean {
    if (!task.jobId) {
      return false;
    }

    const jobContext = this.findJobNodeByTaskId(task.id);
    if (!jobContext) {
      return this.jobs.get(task.jobId)?.paused === true;
    }

    if (jobContext.job.paused === true) {
      return true;
    }

    if (jobContext.job.runtime?.waitingPause?.nodeId) {
      return true;
    }

    return this.isJobTaskOutsideCurrentSegment(jobContext.job, jobContext.nodeIndex);
  }

  getAllJobs(): JobDefinition[] {
    return Array.from(this.jobs.values());
  }

  getAllJobFolders(): JobFolder[] {
    return Array.from(this.jobFolders.values());
  }

  getTaskEffectiveLabels(task: ScheduledTask): string[] {
    const labels = [...(task.labels ?? [])];
    if (task.jobId) {
      const job = this.jobs.get(task.jobId);
      if (job) {
        labels.push(job.name);
      }
    }

    return Array.from(new Set(labels.filter((value) => value.trim().length > 0)));
  }

  /**
   * Create a new task
   */
  async createTask(input: CreateTaskInput): Promise<ScheduledTask> {
    if (!input.name || !input.name.trim()) {
      throw new Error(messages.taskNameRequired());
    }
    if (!input.prompt || !input.prompt.trim()) {
      throw new Error(messages.promptRequired());
    }

    // Validate cron expression
    this.validateCronExpression(input.cronExpression);

    const now = new Date();
    const id = this.generateId();

    // Get defaults from configuration
    const defaultScope = getCompatibleConfigurationValue<TaskScope>(
      "defaultScope",
      "workspace",
    );
    const defaultJitter = this.clampJitterSeconds(
      getCompatibleConfigurationValue<number>("jitterSeconds", 0),
    );

    const enabled = input.enabled !== false;
    const effectiveScope = input.scope || defaultScope;
    const oneTime = input.oneTime ?? id.startsWith("exec-");

    // Calculate next run (disabled tasks must not keep nextRun)
    let nextRun: Date | undefined;
    if (enabled) {
      if (input.runFirstInOneMinute) {
        nextRun = this.truncateToMinute(
          new Date(
            now.getTime() + ScheduleManager.FIRST_RUN_DELAY_MINUTES * 60 * 1000,
          ),
        );
      } else {
        nextRun = this.getNextRunForTask(input.cronExpression, now);
      }
    }

    const task: ScheduledTask = {
      id,
      name: input.name,
      cronExpression: input.cronExpression,
      prompt: input.prompt,
      enabled,
      agent: input.agent,
      model: input.model,
      scope: effectiveScope,
      workspacePath:
        effectiveScope === "workspace"
          ? this.getPrimaryWorkspaceRoot()
          : undefined,
      promptSource: input.promptSource || "inline",
      promptPath: input.promptPath,
      jitterSeconds:
        input.jitterSeconds !== undefined
          ? this.clampJitterSeconds(input.jitterSeconds)
          : defaultJitter,
      oneTime,
      manualSession: this.normalizeTaskManualSession(input.manualSession, oneTime),
      chatSession: this.normalizeTaskChatSession(input.chatSession, oneTime),
      labels: this.normalizeLabels(input.labels),
      nextRun,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, task);
    await this.saveTasksAndSyncRecurringPromptBackups();

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(id: string): ScheduledTask | undefined {
    return this.tasks.get(id);
  }

  getOverdueTasks(referenceTime = new Date()): ScheduledTask[] {
    return Array.from(this.tasks.values()).filter((task) => {
      if (this.suppressedOverdueTaskIds.has(task.id)) {
        return false;
      }

      return (
        this.shouldTaskRunInCurrentWorkspace(task) &&
        this.isTaskDueAt(task, referenceTime)
      );
    });
  }

  isOneTimeTask(task: ScheduledTask): boolean {
    return this.isOneTimeExecutionTask(task);
  }

  suppressOverdueTasks(taskIds: string[]): void {
    for (const taskId of taskIds) {
      if (typeof taskId === "string" && taskId.trim().length > 0) {
        this.suppressedOverdueTaskIds.add(taskId);
      }
    }
  }

  async deferTaskToNextCycle(
    id: string,
    referenceTime = new Date(),
  ): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || !task.enabled || this.isOneTimeExecutionTask(task)) {
      return false;
    }

    task.nextRun = this.getNextRunForTask(task.cronExpression, referenceTime);
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(id);
    await this.saveTasks();
    return true;
  }

  async rescheduleTaskInMinutes(
    id: string,
    delayMinutes: number,
    referenceTime = new Date(),
  ): Promise<boolean> {
    if (!Number.isInteger(delayMinutes) || delayMinutes < 1) {
      throw new Error("delayMinutes must be an integer >= 1");
    }

    const task = this.tasks.get(id);
    if (!task || !task.enabled) {
      return false;
    }

    task.nextRun = this.truncateToMinute(
      new Date(referenceTime.getTime() + delayMinutes * 60 * 1000),
    );
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(id);
    await this.saveTasks();
    return true;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] {
    return Array.from(this.tasks.values());
  }

  async removeLabelFromAllTasks(labelName: string): Promise<number> {
    const key = String(labelName || "").trim().toLowerCase();
    if (!key) {
      return 0;
    }

    let changedCount = 0;
    const timestamp = new Date();
    for (const task of this.tasks.values()) {
      const existingLabels = Array.isArray(task.labels) ? task.labels : [];
      const nextLabels = existingLabels.filter(
        (label) => String(label || "").trim().toLowerCase() !== key,
      );
      if (nextLabels.length === existingLabels.length) {
        continue;
      }
      task.labels = this.normalizeLabels(nextLabels);
      task.updatedAt = timestamp;
      changedCount += 1;
    }

    if (changedCount > 0) {
      await this.saveTasks();
    }
    return changedCount;
  }

  getJob(id: string): JobDefinition | undefined {
    return this.jobs.get(id);
  }

  getJobFolder(id: string): JobFolder | undefined {
    return this.jobFolders.get(id);
  }

  async createJob(input: CreateJobInput): Promise<JobDefinition> {
    if (!input.name || !input.name.trim()) {
      throw new Error(messages.taskNameRequired());
    }

    this.validateCronExpression(input.cronExpression);

    const now = new Date().toISOString();
    const job: JobDefinition = {
      id: this.generateJobId(),
      name: input.name.trim(),
      cronExpression: input.cronExpression,
      folderId:
        typeof input.folderId === "string" && input.folderId.trim().length > 0
          ? input.folderId.trim()
          : undefined,
      paused: input.paused === true,
      archived: false,
      nodes: [],
      createdAt: now,
      updatedAt: now,
    };

    this.jobs.set(job.id, job);
    await this.saveTasks();
    return job;
  }

  async updateJob(
    id: string,
    updates: Partial<CreateJobInput>,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }

    if (updates.name !== undefined) {
      const nextName = updates.name.trim();
      if (!nextName) {
        throw new Error(messages.taskNameRequired());
      }
      job.name = nextName;
    }

    if (updates.cronExpression !== undefined) {
      this.validateCronExpression(updates.cronExpression);
      job.cronExpression = updates.cronExpression;
      this.clearJobRuntime(job);
    }

    if (updates.folderId !== undefined) {
      job.folderId = updates.folderId?.trim() || undefined;
      if (job.folderId !== job.folderId?.trim()) {
        job.folderId = job.folderId?.trim() || undefined;
      }
    }

    if (updates.paused !== undefined) {
      job.paused = updates.paused === true;
    }

    if (job.archived && job.folderId !== undefined) {
      const archiveFolder = this.jobFolders.get(job.folderId);
      if (!archiveFolder || !this.isBundledJobsFolder(archiveFolder)) {
        job.archived = false;
        job.archivedAt = undefined;
      }
    }

    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async deleteJob(id: string): Promise<boolean> {
    const job = this.jobs.get(id);
    if (!job) {
      return false;
    }

    for (const node of job.nodes) {
      if (!this.isTaskNode(node)) {
        continue;
      }
      const task = this.tasks.get(node.taskId);
      if (!task) {
        continue;
      }

      task.jobId = undefined;
      task.jobNodeId = undefined;
      task.nextRun = task.enabled
        ? this.getNextRunForTask(task.cronExpression, new Date())
        : undefined;
    }

    this.jobs.delete(id);
    await this.saveTasks();
    return true;
  }

  async duplicateJob(id: string): Promise<JobDefinition | undefined> {
    const original = this.jobs.get(id);
    if (!original) {
      return undefined;
    }

    const duplicate = await this.createJob({
      name: `${original.name} ${messages.taskCopySuffix()}`,
      cronExpression: original.cronExpression,
      folderId: original.folderId,
      paused: original.paused === true,
    });

    for (const node of original.nodes) {
      if (this.isPauseNode(node)) {
        await this.createPauseInJob(duplicate.id, {
          title: node.title,
        });
        continue;
      }

      const originalTask = this.tasks.get(node.taskId);
      if (!originalTask) {
        continue;
      }

      const duplicatedTask = await this.createTask({
        name: `${originalTask.name} ${messages.taskCopySuffix()}`,
        description: originalTask.description,
        cronExpression: originalTask.cronExpression,
        prompt: originalTask.prompt,
        enabled: originalTask.enabled,
        oneTime: false,
        manualSession: originalTask.manualSession,
        chatSession: originalTask.chatSession,
        agent: originalTask.agent,
        model: originalTask.model,
        scope: "workspace",
        promptSource: originalTask.promptSource,
        promptPath: originalTask.promptPath,
        jitterSeconds: originalTask.jitterSeconds,
        labels: originalTask.labels,
      });

      await this.attachTaskToJob(duplicate.id, duplicatedTask.id, node.windowMinutes);
    }

    return this.jobs.get(duplicate.id);
  }

  async toggleJobPaused(id: string): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(id);
    if (!job) {
      return undefined;
    }

    job.paused = job.paused !== true;
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async createJobFolder(input: CreateJobFolderInput): Promise<JobFolder> {
    if (!input.name || !input.name.trim()) {
      throw new Error(messages.taskNameRequired());
    }

    const now = new Date().toISOString();
    const folder: JobFolder = {
      id: this.generateJobFolderId(),
      name: input.name.trim(),
      parentId:
        typeof input.parentId === "string" && input.parentId.trim().length > 0
          ? input.parentId.trim()
          : undefined,
      createdAt: now,
      updatedAt: now,
    };

    this.jobFolders.set(folder.id, folder);
    await this.saveTasks();
    return folder;
  }

  async renameJobFolder(
    id: string,
    updates: Partial<CreateJobFolderInput>,
  ): Promise<JobFolder | undefined> {
    const folder = this.jobFolders.get(id);
    if (!folder) {
      return undefined;
    }

    if (updates.name !== undefined) {
      const nextName = updates.name.trim();
      if (!nextName) {
        throw new Error(messages.taskNameRequired());
      }
      folder.name = nextName;
    }

    if (updates.parentId !== undefined) {
      folder.parentId = updates.parentId?.trim() || undefined;
    }

    folder.updatedAt = new Date().toISOString();
    await this.saveTasks();
    return folder;
  }

  async deleteJobFolder(id: string): Promise<boolean> {
    const folder = this.jobFolders.get(id);
    if (!folder) {
      return false;
    }

    for (const candidate of this.jobFolders.values()) {
      if (candidate.parentId === id) {
        candidate.parentId = folder.parentId;
        candidate.updatedAt = new Date().toISOString();
      }
    }

    for (const job of this.jobs.values()) {
      if (job.folderId === id) {
        job.folderId = folder.parentId;
        job.updatedAt = new Date().toISOString();
      }
    }

    this.jobFolders.delete(id);
    await this.saveTasks();
    return true;
  }

  async createPauseInJob(
    jobId: string,
    input: CreateJobPauseInput,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const title = input.title.trim();
    if (!title) {
      throw new Error(messages.taskNameRequired());
    }

    job.nodes.push({
      id: this.generateJobNodeId(),
      type: "pause",
      title,
    });
    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async updateJobPause(
    jobId: string,
    nodeId: string,
    updates: Partial<CreateJobPauseInput>,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const pauseNode = this.getNode(job, nodeId);
    if (!this.isPauseNode(pauseNode)) {
      return undefined;
    }

    if (updates.title !== undefined) {
      const title = updates.title.trim();
      if (!title) {
        throw new Error(messages.taskNameRequired());
      }
      pauseNode.title = title;
    }

    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasksAndSyncRecurringPromptBackups();
    return job;
  }

  async deleteJobPause(
    jobId: string,
    nodeId: string,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const nodeIndex = job.nodes.findIndex((node) => node.id === nodeId);
    if (nodeIndex < 0) {
      return undefined;
    }

    const node = job.nodes[nodeIndex];
    if (!this.isPauseNode(node)) {
      return undefined;
    }

    job.nodes.splice(nodeIndex, 1);
    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async approveJobPause(
    jobId: string,
    nodeId: string,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    const pauseNode = job ? this.getNode(job, nodeId) : undefined;
    if (!job || !this.isPauseNode(pauseNode)) {
      return undefined;
    }

    const runtime = this.getWorkingRuntimeState(job);
    if (runtime.waitingPause?.nodeId !== nodeId) {
      return undefined;
    }
    const approvedIds = new Set(this.getApprovedPauseNodeIds(job));
    approvedIds.add(nodeId);
    runtime.approvedPauseNodeIds = Array.from(approvedIds);
    runtime.waitingPause = undefined;
    runtime.cycleStartedAt = runtime.cycleStartedAt || new Date().toISOString();
    runtime.currentSegmentStartedAt = this.truncateToMinute(new Date()).toISOString();
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async rejectJobPause(
    jobId: string,
    nodeId: string,
  ): Promise<JobPauseResolution | undefined> {
    const job = this.jobs.get(jobId);
    const pauseNode = job ? this.getNode(job, nodeId) : undefined;
    if (!job || !this.isPauseNode(pauseNode)) {
      return undefined;
    }

    if (job.runtime?.waitingPause?.nodeId !== nodeId) {
      return undefined;
    }

    const previousTaskId =
      job.runtime?.waitingPause?.previousTaskId ||
      this.getPreviousTaskIdForPause(job, nodeId);

    return {
      job,
      previousTaskId,
    };
  }

  async createTaskInJob(
    jobId: string,
    input: CreateTaskInput,
    windowMinutes = 30,
  ): Promise<ScheduledTask | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const task = await this.createTask({
      ...input,
      scope: "workspace",
      oneTime: false,
    });
    await this.attachTaskToJob(job.id, task.id, windowMinutes);
    return this.tasks.get(task.id);
  }

  async attachTaskToJob(
    jobId: string,
    taskId: string,
    windowMinutes = 30,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    let task = this.tasks.get(taskId);
    if (!job || !task) {
      return undefined;
    }

    const existing = this.findJobNodeByTaskId(taskId);
    if (existing) {
      task = await this.createTask({
        name: task.name,
        cronExpression: task.cronExpression,
        prompt: task.prompt,
        enabled: task.enabled,
        agent: task.agent,
        model: task.model,
        scope: task.scope,
        oneTime: false,
        chatSession: task.oneTime === true ? undefined : task.chatSession,
        labels: task.labels,
        promptSource: task.promptSource,
        promptPath: task.promptPath,
        jitterSeconds: task.jitterSeconds,
      });
      taskId = task.id;
    }

    if (!job.nodes.some((node) => this.isTaskNode(node) && node.taskId === taskId)) {
      const nodeId = this.generateJobNodeId();
      job.nodes.push({
        id: nodeId,
        type: "task",
        taskId,
        windowMinutes: this.normalizeWindowMinutes(windowMinutes),
      });
      task.jobId = jobId;
      task.jobNodeId = nodeId;
      task.oneTime = false;
      task.scope = "workspace";
      task.workspacePath = this.getPrimaryWorkspaceRoot();
      task.updatedAt = new Date();
    }

    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async detachTaskFromJob(
    jobId: string,
    nodeId: string,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const nodeIndex = job.nodes.findIndex((node) => node.id === nodeId);
    if (nodeIndex < 0) {
      return undefined;
    }

    const [node] = job.nodes.splice(nodeIndex, 1);
    const task = this.isTaskNode(node) ? this.tasks.get(node.taskId) : undefined;
    if (task) {
      task.jobId = undefined;
      task.jobNodeId = undefined;
      task.nextRun = task.enabled
        ? this.getNextRunForTask(task.cronExpression, new Date())
        : undefined;
      task.updatedAt = new Date();
    }

    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async deleteTaskFromJob(
    jobId: string,
    nodeId: string,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const node = job.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !this.isTaskNode(node)) {
      return undefined;
    }

    const deleted = await this.deleteTask(node.taskId);
    if (!deleted) {
      return undefined;
    }

    return this.jobs.get(jobId);
  }

  async reorderJobNode(
    jobId: string,
    nodeId: string,
    targetIndex: number,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const sourceIndex = job.nodes.findIndex((node) => node.id === nodeId);
    if (sourceIndex < 0) {
      return undefined;
    }

    const boundedIndex = Math.max(0, Math.min(targetIndex, job.nodes.length - 1));
    const [node] = job.nodes.splice(sourceIndex, 1);
    job.nodes.splice(boundedIndex, 0, node);
    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  async updateJobNodeWindow(
    jobId: string,
    nodeId: string,
    windowMinutes: number,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const node = job.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !this.isTaskNode(node)) {
      return undefined;
    }

    node.windowMinutes = this.normalizeWindowMinutes(windowMinutes);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return job;
  }

  private async ensureArchiveFolder(): Promise<JobFolder> {
    const existing = Array.from(this.jobFolders.values()).find((folder) =>
      !folder.parentId && this.isBundledJobsFolder(folder),
    );
    if (existing) {
      existing.name = ScheduleManager.BUNDLED_JOB_FOLDER_NAME;
      existing.updatedAt = new Date().toISOString();
      return existing;
    }

    const now = new Date().toISOString();
    const folder: JobFolder = {
      id: this.generateJobFolderId(),
      name: ScheduleManager.BUNDLED_JOB_FOLDER_NAME,
      createdAt: now,
      updatedAt: now,
    };
    this.jobFolders.set(folder.id, folder);
    return folder;
  }

  private isBundledJobsFolder(folder: JobFolder | undefined): boolean {
    if (!folder) {
      return false;
    }

    const normalized = folder.name.trim().toLowerCase();
    return normalized === "bundled jobs" || normalized === "archive";
  }

  private buildCompiledJobPrompt(job: JobDefinition): {
    prompt: string;
    agent?: string;
    model?: string;
    labels: string[];
  } {
    const sections: string[] = [
      `Job: ${job.name}`,
      "Execute the following workflow as one combined task. Keep the sections in order and preserve explicit checkpoints before continuing.",
    ];
    const labels = new Set<string>([job.name, "bundled-task"]);
    let agent: string | undefined;
    let model: string | undefined;
    let taskCount = 0;
    let pauseCount = 0;

    for (const node of job.nodes) {
      if (this.isPauseNode(node)) {
        pauseCount += 1;
        sections.push(
          `Checkpoint ${pauseCount}: ${node.title}`,
          "Review the immediately previous section before continuing to the next one.",
        );
        continue;
      }

      const task = this.tasks.get(node.taskId);
      if (!task) {
        continue;
      }

      taskCount += 1;
      if (!agent && task.agent) {
        agent = task.agent;
      }
      if (!model && task.model) {
        model = task.model;
      }
      for (const label of task.labels ?? []) {
        if (label.trim().length > 0) {
          labels.add(label.trim());
        }
      }

      sections.push(
        `Step ${taskCount}: ${task.name}`,
        `Original window: ${this.normalizeWindowMinutes(node.windowMinutes)} minutes`,
        task.prompt,
      );
    }

    if (taskCount === 0) {
      throw new Error("This job does not contain any task steps to compile.");
    }

    return {
      prompt: sections.join("\n\n"),
      agent,
      model,
      labels: Array.from(labels),
    };
  }

  async compileJobToTask(
    jobId: string,
  ): Promise<{ job: JobDefinition; task: ScheduledTask } | undefined> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return undefined;
    }

    const compiled = this.buildCompiledJobPrompt(job);
    const task = await this.createTask({
      name: "Bundled Task",
      cronExpression: job.cronExpression,
      prompt: compiled.prompt,
      enabled: job.paused !== true,
      scope: "workspace",
      promptSource: "inline",
      oneTime: false,
      agent: compiled.agent,
      model: compiled.model,
      labels: compiled.labels,
    });

    const bundledJobsFolder = await this.ensureArchiveFolder();
    job.folderId = bundledJobsFolder.id;
    job.paused = true;
    job.archived = true;
    job.archivedAt = new Date().toISOString();
    job.lastCompiledTaskId = task.id;
    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();

    return { job, task };
  }

  getWorkspaceScheduleHistory(): ScheduleHistoryEntry[] {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      return [];
    }

    return listScheduleHistoryEntries(workspaceRoot);
  }

  async restoreWorkspaceScheduleHistory(snapshotId: string): Promise<boolean> {
    const op = this.saveQueue.then(() =>
      this.restoreWorkspaceScheduleHistoryInternal(snapshotId),
    );
    this.saveQueue = op
      .then(() => undefined)
      .catch((error) => {
        logError(
          "[CopilotScheduler] Restore history failed (chain recovered):",
          toSafeErrorDetails(error),
        );
      });
    return op;
  }

  private async restoreWorkspaceScheduleHistoryInternal(
    snapshotId: string,
  ): Promise<boolean> {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      return false;
    }

    const snapshot = readScheduleHistorySnapshot(workspaceRoot, snapshotId);
    if (!snapshot) {
      return false;
    }

    const schedulerConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
    const privateConfigPath = getPrivateSchedulerConfigPath(schedulerConfigPath);

    const currentPublicConfig =
      readSchedulerJsonFile(schedulerConfigPath) ?? readSchedulerConfig(workspaceRoot);
    const currentPrivateConfig =
      readSchedulerJsonFile(privateConfigPath) ?? currentPublicConfig;

    createScheduleHistorySnapshot(
      workspaceRoot,
      currentPublicConfig,
      currentPrivateConfig,
    );

    const restoredConfig = snapshot.privateConfig ?? snapshot.publicConfig;
    if (!restoredConfig) {
      return false;
    }

    writeSchedulerConfig(workspaceRoot, restoredConfig);
    this.loadTasks();
    this.notifyTasksChanged();
    return true;
  }

  /**
   * Recalculate nextRun for all enabled tasks.
   * Call when timezone configuration changes so that persisted nextRun values
   * (computed under the old timezone) are recomputed under the new one.
   */
  async recalculateAllNextRuns(): Promise<void> {
    const now = new Date();
    let changed = false;
    for (const task of this.tasks.values()) {
      if (!task.enabled) continue;
      const jobContext = task.jobId ? this.findJobNodeByTaskId(task.id) : undefined;
      const newNextRun = jobContext
        ? this.getNextRunForJobNode(jobContext.job, jobContext.nodeIndex, now)
        : this.getNextRunForTask(task.cronExpression, now);
      if (!newNextRun) {
        if (task.nextRun) {
          task.nextRun = undefined;
          changed = true;
        }
        continue;
      }
      if (!task.nextRun || task.nextRun.getTime() !== newNextRun.getTime()) {
        task.nextRun = newNextRun;
        changed = true;
      }
    }
    if (changed) {
      await this.saveTasks();
    }
  }

  /**
   * Get tasks by scope
   */
  getTasksByScope(scope: TaskScope): ScheduledTask[] {
    return this.getAllTasks().filter((task) => task.scope === scope);
  }

  /**
   * Update a task
   */
  async updateTask(
    id: string,
    updates: Partial<CreateTaskInput>,
  ): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }

    if (updates.name !== undefined && !updates.name.trim()) {
      throw new Error(messages.taskNameRequired());
    }
    if (updates.prompt !== undefined && !updates.prompt.trim()) {
      throw new Error(messages.promptRequired());
    }

    // Validate cron expression if being updated (including empty string)
    if (updates.cronExpression !== undefined) {
      this.validateCronExpression(updates.cronExpression);
    }

    const now = new Date();
    const enabledBefore = task.enabled;
    let cronChanged = false;

    // Apply updates
    if (updates.name !== undefined) {
      task.name = updates.name;
    }
    if (updates.cronExpression !== undefined) {
      task.cronExpression = updates.cronExpression;
      cronChanged = true;
    }
    if (updates.prompt !== undefined) {
      task.prompt = updates.prompt;
    }
    if (updates.enabled !== undefined) {
      task.enabled = updates.enabled;
    }
    if (updates.agent !== undefined) {
      task.agent = updates.agent;
    }
    if (updates.model !== undefined) {
      task.model = updates.model;
    }
    if (updates.scope !== undefined) {
      const nextScope = updates.scope;

      // Only adjust workspacePath when scope actually changes (or workspacePath is missing).
      // Webview submits scope on every save; we must not overwrite workspacePath on edits.
      if (nextScope !== task.scope) {
        task.scope = nextScope;
        if (nextScope === "workspace") {
          task.workspacePath = this.getPrimaryWorkspaceRoot();
        } else {
          task.workspacePath = undefined;
        }
      } else if (nextScope === "workspace" && !task.workspacePath) {
        task.workspacePath = this.getPrimaryWorkspaceRoot();
      }
    }
    if (updates.promptSource !== undefined) {
      task.promptSource = updates.promptSource;
    }
    if (updates.promptPath !== undefined) {
      task.promptPath = updates.promptPath;
    }
    if (updates.jitterSeconds !== undefined) {
      task.jitterSeconds = this.clampJitterSeconds(updates.jitterSeconds);
    }
    if (updates.oneTime !== undefined) {
      task.oneTime = updates.oneTime;
    }
    if (updates.manualSession !== undefined || updates.oneTime !== undefined) {
      task.manualSession = this.normalizeTaskManualSession(
        updates.manualSession !== undefined
          ? updates.manualSession
          : task.manualSession,
        task.oneTime === true,
      );
    }
    if (updates.chatSession !== undefined || updates.oneTime !== undefined) {
      task.chatSession = this.normalizeTaskChatSession(
        updates.chatSession !== undefined ? updates.chatSession : task.chatSession,
        task.oneTime === true,
      );
    }
    if (updates.labels !== undefined) {
      task.labels = this.normalizeLabels(updates.labels);
    }

    const enabledAfter = task.enabled;

    // Keep nextRun consistent with enabled state
    if (!enabledAfter) {
      task.nextRun = undefined;
    } else {
      // One-time immediate scheduling on update (only for enabled tasks)
      if (updates.runFirstInOneMinute) {
        task.nextRun = this.truncateToMinute(
          new Date(
            now.getTime() + ScheduleManager.FIRST_RUN_DELAY_MINUTES * 60 * 1000,
          ),
        );
      } else if (cronChanged || (!enabledBefore && enabledAfter)) {
        task.nextRun = this.getNextRunForTask(task.cronExpression, now);
      } else if (!task.nextRun) {
        // Ensure nextRun exists for enabled tasks
        task.nextRun = this.getNextRunForTask(task.cronExpression, now);
      }
    }

    task.updatedAt = now;
  this.suppressedOverdueTaskIds.delete(id);

    await this.saveTasksAndSyncRecurringPromptBackups();

    return task;
  }

  /**
   * Delete a task
   */
  async deleteTask(id: string): Promise<boolean> {
    const jobContext = this.findJobNodeByTaskId(id);
    if (jobContext) {
      jobContext.job.nodes = jobContext.job.nodes.filter(
        (node) => node.id !== jobContext.node.id,
      );
      this.clearJobRuntime(jobContext.job);
      jobContext.job.updatedAt = new Date().toISOString();
    }

    const deleted = this.tasks.delete(id);
    if (deleted) {
      this.suppressedOverdueTaskIds.delete(id);
      this.syncJobTaskSchedules(new Date());
      await this.saveTasks();
    }
    return deleted;
  }

  /**
   * Toggle task enabled/disabled
   */
  async toggleTask(id: string): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }

    task.enabled = !task.enabled;
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(id);

    // Keep nextRun consistent with enabled state
    if (task.enabled) {
      task.nextRun = this.getNextRunForTask(task.cronExpression, new Date());
    } else {
      task.nextRun = undefined;
    }

    await this.saveTasks();

    return task;
  }

  /**
   * Set task enabled state explicitly
   */
  async setTaskEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }

    task.enabled = enabled;
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(id);

    // Keep nextRun consistent with enabled state
    if (task.enabled) {
      task.nextRun = this.getNextRunForTask(task.cronExpression, new Date());
    } else {
      task.nextRun = undefined;
    }

    await this.saveTasks();

    return task;
  }

  /**
   * Duplicate a task
   */
  async duplicateTask(id: string): Promise<ScheduledTask | undefined> {
    const original = this.tasks.get(id);
    if (!original) {
      return undefined;
    }

    const input: CreateTaskInput = {
      name: `${original.name} ${messages.taskCopySuffix()}`,
      cronExpression: original.cronExpression,
      prompt: original.prompt,
      enabled: false, // Start disabled
      agent: original.agent,
      model: original.model,
      scope: original.scope,
      oneTime: original.oneTime,
      manualSession: original.oneTime === true ? undefined : original.manualSession,
      chatSession: original.oneTime === true ? undefined : original.chatSession,
      labels: original.labels,
      promptSource: original.promptSource,
      promptPath: original.promptPath,
      jitterSeconds: original.jitterSeconds,
    };

    return this.createTask(input);
  }

  /**
   * Move a workspace-scoped task to the current workspace (updates workspacePath).
   */
  async moveTaskToCurrentWorkspace(
    id: string,
  ): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) {
      return undefined;
    }

    if (task.scope !== "workspace") {
      throw new Error(messages.moveOnlyWorkspaceTasks());
    }

    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error(messages.noWorkspaceOpen());
    }

    task.workspacePath = workspaceRoot;
    task.updatedAt = new Date();
  this.suppressedOverdueTaskIds.delete(id);
    await this.saveTasksAndSyncRecurringPromptBackups();
    return task;
  }

  /**
   * Check if task should run in current workspace
   */
  shouldTaskRunInCurrentWorkspace(task: ScheduledTask): boolean {
    // Global tasks run in all workspaces
    if (task.scope === "global") {
      return true;
    }

    // Workspace-specific tasks only run in their workspace
    const workspacePaths = this.getResolvedWorkspaceRoots();
    if (workspacePaths.length === 0) {
      return false;
    }

    const a = task.workspacePath ? normalizeForCompare(task.workspacePath) : "";
    if (a === "") return false;
    return workspacePaths.some((p) => normalizeForCompare(p) === a);
  }

  /**
   * Start the scheduler
   */
  startScheduler(onExecute: (task: ScheduledTask) => Promise<void>): void {
    this.setOnExecuteCallback(onExecute);

    // Stop existing scheduler if running
    this.stopScheduler();

    // Align to next minute boundary
    const now = new Date();
    const msToNextMinute =
      (60 - now.getSeconds()) * 1000 - now.getMilliseconds();

    // Start after alignment
    this.schedulerTimeout = setTimeout(() => {
      this.schedulerTimeout = undefined;
      // Execute immediately on first aligned minute
      void this.runSchedulerTick();

      // Then run every minute
      this.schedulerInterval = setInterval(() => {
        void this.runSchedulerTick();
      }, 60 * 1000);
    }, msToNextMinute);
  }

  private async runSchedulerTick(): Promise<void> {
    if (this.schedulerTickInProgress) {
      this.schedulerTickPending = true;
      return;
    }

    this.schedulerTickInProgress = true;
    try {
      do {
        this.schedulerTickPending = false;
        await this.checkAndExecuteTasks();
      } while (this.schedulerTickPending);
    } catch (error) {
      logError(
        "[CopilotScheduler] Scheduler tick failed:",
        toSafeErrorDetails(error),
      );
    } finally {
      this.schedulerTickInProgress = false;
    }
  }

  /**
   * Stop the scheduler
   */
  stopScheduler(): void {
    if (this.schedulerTimeout) {
      clearTimeout(this.schedulerTimeout);
      this.schedulerTimeout = undefined;
    }
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = undefined;
    }
    this.schedulerTickPending = false;
  }

  /**
   * Helper to identify one-time execution tasks.
   * Prefer explicit `oneTime` flag; keep `exec-` id fallback for backward compatibility.
   */
  private isOneTimeExecutionTask(task: ScheduledTask): boolean {
    return task.oneTime === true || task.id.startsWith("exec-");
  }

  /**
   * Check and execute tasks that are due
   */
  private async checkAndExecuteTasks(): Promise<void> {
    const enabled = getCompatibleConfigurationValue<boolean>("enabled", true);

    if (!enabled) {
      return;
    }

    const now = new Date();
    // Truncate to minute for comparison
    const nowMinute = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );

    // Read config values once per tick (avoid redundant reads inside the loop)
    const rawMaxDaily = getCompatibleConfigurationValue<number>(
      "maxDailyExecutions",
      24,
    );
    const safeMaxDaily = Number.isFinite(rawMaxDaily) ? rawMaxDaily : 24;
    const maxDailyLimit =
      safeMaxDaily === 0 ? 0 : Math.min(Math.max(safeMaxDaily, 1), 100);
    const defaultJitterSeconds = getCompatibleConfigurationValue<number>(
      "jitterSeconds",
      0,
    );

    let needsSave = false;
    let executedCount = 0;
    const tasksToDelete: string[] = [];

    for (const task of this.tasks.values()) {
      if (!task.enabled || !task.nextRun) {
        continue;
      }

      if (this.isTaskSuppressedByJob(task)) {
        continue;
      }

      // Check if task should run in current workspace
      if (!this.shouldTaskRunInCurrentWorkspace(task)) {
        continue;
      }

      if (this.suppressedOverdueTaskIds.has(task.id)) {
        continue;
      }

      // Check if due
      if (this.isTaskDueAt(task, nowMinute)) {
        // Safety: Check daily execution limit
        if (this.isDailyLimitReached(maxDailyLimit)) {
          logDebug(
            `[CopilotScheduler] Daily limit (${maxDailyLimit}) reached, skipping task: ${task.name}`,
          );
          const todayKey = getLocalDateKey();
          if (this.dailyLimitNotifiedDate !== todayKey) {
            this.dailyLimitNotifiedDate = todayKey;
            void this.context.globalState
              .update(DAILY_LIMIT_NOTIFIED_DATE_KEY, todayKey)
              .then(undefined, (error: unknown) =>
                logError(
                  "[CopilotScheduler] Failed to persist daily limit notified date:",
                  toSafeErrorDetails(error),
                ),
              );
            void vscode.window.showInformationMessage(
              messages.dailyLimitReached(maxDailyLimit),
            );
          }
          // Still advance nextRun so it doesn't keep retrying
          const jobContext = task.jobId ? this.findJobNodeByTaskId(task.id) : undefined;
          task.nextRun = jobContext
            ? this.getNextRunForJobNode(jobContext.job, jobContext.nodeIndex, now)
            : this.getNextRunForTask(task.cronExpression, now);
          needsSave = true;
          continue;
        }

        // Safety: Apply jitter (random delay)
        const maxJitterSeconds = task.jitterSeconds ?? defaultJitterSeconds;
        await this.applyJitter(maxJitterSeconds);

        // Execute
        let executedSuccessfully = false;
        if (this.onExecuteCallback) {
          try {
            await this.onExecuteCallback(task);
            // Track daily execution count
            this.incrementDailyExecCountInMemory(new Date());
            executedCount++;
            // Only record lastRun on successful execution
            task.lastRun = new Date();
            task.lastError = undefined;
            task.lastErrorAt = undefined;
            this.handleSuccessfulJobTaskExecution(task, task.lastRun);
            needsSave = this.syncJobTaskSchedules(task.lastRun) || needsSave;
            executedSuccessfully = true;
          } catch (error) {
            const details = toSafeErrorDetails(error);
            logError("[CopilotScheduler] Task execution error:", {
              taskId: task.id,
              taskName: task.name,
              error: details,
            });
            task.lastError = details;
            task.lastErrorAt = new Date();
          }
        }

        // Advance to cron-based next run only on success.
        // On failure, retry in one minute so the run does not silently disappear.
        if (executedSuccessfully) {
          if (this.isOneTimeExecutionTask(task)) {
            tasksToDelete.push(task.id);
            needsSave = true;
          } else {
            const nextReferenceTime = new Date();
            const jobContext = task.jobId
              ? this.findJobNodeByTaskId(task.id)
              : undefined;
            task.nextRun = jobContext
              ? this.getNextRunForJobNode(
                jobContext.job,
                jobContext.nodeIndex,
                nextReferenceTime,
              )
              : this.getNextRunForTask(task.cronExpression, nextReferenceTime);
            needsSave = true;
          }
        } else {
          task.nextRun = this.truncateToMinute(new Date(now.getTime() + 60 * 1000));
          needsSave = true;
        }
      }
    }

    // Process deletions for one-time tasks
    for (const id of tasksToDelete) {
      this.tasks.delete(id);
    }

    // Persist once per tick to reduce I/O overhead.
    if (executedCount > 0) {
      try {
        await this.persistDailyExecCount();
      } catch (error) {
        logError(
          "[CopilotScheduler] Failed to persist daily execution count:",
          toSafeErrorDetails(error),
        );
      }
    }

    if (needsSave) {
      await this.saveTasks();
    }
  }

  private handleSuccessfulJobTaskExecution(
    task: ScheduledTask,
    executedAt: Date,
  ): void {
    const jobContext = this.findJobNodeByTaskId(task.id);
    if (!jobContext) {
      return;
    }

    const runtime = this.getWorkingRuntimeState(jobContext.job);
    const cycleStart =
      this.parseIsoDate(runtime.cycleStartedAt) ||
      this.getPreviousCronOccurrence(jobContext.job.cronExpression, executedAt) ||
      this.truncateToMinute(executedAt);
    runtime.cycleStartedAt = cycleStart.toISOString();
    if (!runtime.currentSegmentStartedAt) {
      runtime.currentSegmentStartedAt = cycleStart.toISOString();
    }

    const nextNode = jobContext.job.nodes[jobContext.nodeIndex + 1];
    if (
      this.isPauseNode(nextNode) &&
      !this.getApprovedPauseNodeIds(jobContext.job).includes(nextNode.id)
    ) {
      runtime.waitingPause = {
        nodeId: nextNode.id,
        previousTaskId: jobContext.node.taskId,
        activatedAt: executedAt.toISOString(),
      };
      runtime.currentSegmentStartedAt = undefined;
      jobContext.job.updatedAt = new Date().toISOString();
      return;
    }

    runtime.waitingPause = undefined;
    const hasFutureTask = jobContext.job.nodes
      .slice(jobContext.nodeIndex + 1)
      .some((node) => this.isTaskNode(node));

    if (!hasFutureTask) {
      this.clearJobRuntime(jobContext.job);
    }

    jobContext.job.updatedAt = new Date().toISOString();
  }

  /**
   * Force run a task immediately
   */
  async runTaskNow(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task || !this.onExecuteCallback) {
      return false;
    }

    if (this.isTaskSuppressedByJob(task)) {
      return false;
    }

    try {
      await this.onExecuteCallback(task);

      // Update lastRun and nextRun after manual execution
      const executedAt = new Date();
      task.lastRun = executedAt;
      task.lastError = undefined;
      task.lastErrorAt = undefined;
      this.handleSuccessfulJobTaskExecution(task, executedAt);
      this.syncJobTaskSchedules(executedAt);
      if (this.isOneTimeExecutionTask(task)) {
        this.tasks.delete(task.id);
        this.suppressedOverdueTaskIds.delete(task.id);
      } else if (task.enabled) {
        const jobContext = task.jobId ? this.findJobNodeByTaskId(task.id) : undefined;
        task.nextRun = jobContext
          ? this.getNextRunForJobNode(jobContext.job, jobContext.nodeIndex, executedAt)
          : this.getNextRunForTask(task.cronExpression, executedAt);
        this.suppressedOverdueTaskIds.delete(task.id);
      }
      await this.saveTasks();

      return true;
    } catch (error) {
      logError(
        "[CopilotScheduler] runTaskNow failed:",
        toSafeErrorDetails(error),
      );
      task.lastError = toSafeErrorDetails(error);
      task.lastErrorAt = new Date();
      await this.saveTasks();
      return false;
    }
  }

  /* --- HBG CUSTOM: Read tasks/jobs/folders from .vscode/scheduler.json --- */
  private loadWorkspaceSchedulerState(): WorkspaceSchedulerState {
    try {
      const workspaceRoot = this.getPrimaryWorkspaceRoot();
      if (!workspaceRoot) {
        return { tasks: [], jobs: [], jobFolders: [] };
      }
      const config = readSchedulerConfig(workspaceRoot);

      if (!config.tasks || !Array.isArray(config.tasks)) {
        console.log(`[Scheduler] Invalid JSON format`);
        return { tasks: [], jobs: [], jobFolders: [] };
      }

      const tasks: ScheduledTask[] = config.tasks.map((t: any) => {
        const workspacePath =
          typeof t.workspacePath === "string" && t.workspacePath.trim().length > 0
            ? path.resolve(t.workspacePath)
            : workspaceRoot;
        return {
          id: t.id,
          name: t.name || t.id,
          description: t.description || 'Auto-generated from scheduler.json',
          cronExpression: t.cron,
          prompt: t.prompt,
          enabled: t.enabled !== false,
          agent: t.agent,
          model: t.model,
          createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
          updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
          lastRun: t.lastRun ? new Date(t.lastRun) : undefined,
          lastError: t.lastError,
          lastErrorAt: t.lastErrorAt ? new Date(t.lastErrorAt) : undefined,
          oneTime: t.oneTime === true,
          manualSession:
            t.oneTime === true
              ? undefined
              : t.manualSession === true
                ? true
                : undefined,
          nextRun: t.nextRun ? new Date(t.nextRun) : undefined,
          promptSource: t.promptSource || "inline",
          promptPath: t.promptPath,
          promptBackupPath: t.promptBackupPath,
          promptBackupUpdatedAt: t.promptBackupUpdatedAt
            ? new Date(t.promptBackupUpdatedAt)
            : undefined,
          jitterSeconds: t.jitterSeconds,
          chatSession: this.normalizeTaskChatSession(
            t.chatSession,
            t.oneTime === true,
          ),
          labels: this.normalizeLabels(t.labels),
          jobId:
            typeof t.jobId === "string" && t.jobId.trim().length > 0
              ? t.jobId.trim()
              : undefined,
          jobNodeId:
            typeof t.jobNodeId === "string" && t.jobNodeId.trim().length > 0
              ? t.jobNodeId.trim()
              : undefined,
          scope: "workspace" as TaskScope,
          workspacePath,
        };
      });

      const jobs = Array.isArray(config.jobs)
        ? config.jobs
          .filter(
            (job): job is JobDefinition =>
              !!job &&
              typeof job.id === "string" &&
              job.id.trim().length > 0 &&
              typeof job.name === "string" &&
              job.name.trim().length > 0 &&
              typeof job.cronExpression === "string" &&
              job.cronExpression.trim().length > 0,
          )
          .map((job) => {
            const normalizedNodes: JobNode[] = Array.isArray(job.nodes)
              ? job.nodes.reduce<JobNode[]>((acc, node) => {
                if (!node || typeof node.id !== "string" || node.id.trim().length === 0) {
                  return acc;
                }

                if (node.type === "pause") {
                  const rawTitle = (node as { title?: unknown }).title;
                  if (typeof rawTitle !== "string" || rawTitle.trim().length === 0) {
                    return acc;
                  }

                  acc.push({
                    id: node.id.trim(),
                    type: "pause" as const,
                    title: rawTitle.trim(),
                  });
                  return acc;
                }

                const rawTaskId = (node as { taskId?: unknown }).taskId;
                if (typeof rawTaskId !== "string" || rawTaskId.trim().length === 0) {
                  return acc;
                }

                acc.push({
                  id: node.id.trim(),
                  type: "task" as const,
                  taskId: rawTaskId.trim(),
                  windowMinutes: this.normalizeWindowMinutes(
                    (node as { windowMinutes?: number }).windowMinutes,
                  ),
                });
                return acc;
              }, [])
              : [];

            const pauseIds = new Set(
              normalizedNodes
                .filter((node): node is JobPauseNode => this.isPauseNode(node))
                .map((node) => node.id),
            );
            const rawRuntime =
              job.runtime && typeof job.runtime === "object"
                ? (job.runtime as JobRuntimeState)
                : undefined;
            const approvedPauseNodeIds = Array.isArray(rawRuntime?.approvedPauseNodeIds)
              ? rawRuntime.approvedPauseNodeIds
                .filter(
                  (value): value is string =>
                    typeof value === "string" && pauseIds.has(value.trim()),
                )
                .map((value) => value.trim())
              : [];
            const waitingPause =
              rawRuntime?.waitingPause && pauseIds.has(rawRuntime.waitingPause.nodeId.trim())
                ? {
                  nodeId: rawRuntime.waitingPause.nodeId.trim(),
                  previousTaskId:
                    typeof rawRuntime.waitingPause.previousTaskId === "string" &&
                    rawRuntime.waitingPause.previousTaskId.trim().length > 0
                      ? rawRuntime.waitingPause.previousTaskId.trim()
                      : undefined,
                  activatedAt:
                    typeof rawRuntime.waitingPause.activatedAt === "string" &&
                    rawRuntime.waitingPause.activatedAt.trim().length > 0
                      ? rawRuntime.waitingPause.activatedAt.trim()
                      : new Date().toISOString(),
                }
                : undefined;
            const runtime =
              rawRuntime?.cycleStartedAt ||
              rawRuntime?.currentSegmentStartedAt ||
              approvedPauseNodeIds.length > 0 ||
              waitingPause
                ? {
                  cycleStartedAt:
                    typeof rawRuntime?.cycleStartedAt === "string" &&
                    rawRuntime.cycleStartedAt.trim().length > 0
                      ? rawRuntime.cycleStartedAt.trim()
                      : undefined,
                  currentSegmentStartedAt:
                    typeof rawRuntime?.currentSegmentStartedAt === "string" &&
                    rawRuntime.currentSegmentStartedAt.trim().length > 0
                      ? rawRuntime.currentSegmentStartedAt.trim()
                      : undefined,
                  approvedPauseNodeIds,
                  waitingPause,
                }
                : undefined;

            return {
              ...job,
              folderId:
                typeof job.folderId === "string" && job.folderId.trim().length > 0
                  ? job.folderId.trim()
                  : undefined,
              paused: job.paused === true,
              archived: job.archived === true,
              archivedAt:
                typeof job.archivedAt === "string" && job.archivedAt.trim().length > 0
                  ? job.archivedAt.trim()
                  : undefined,
              lastCompiledTaskId:
                typeof job.lastCompiledTaskId === "string" &&
                job.lastCompiledTaskId.trim().length > 0
                  ? job.lastCompiledTaskId.trim()
                  : undefined,
              nodes: normalizedNodes,
              runtime,
              createdAt:
                typeof job.createdAt === "string" && job.createdAt.trim().length > 0
                  ? job.createdAt
                  : new Date().toISOString(),
              updatedAt:
                typeof job.updatedAt === "string" && job.updatedAt.trim().length > 0
                  ? job.updatedAt
                  : new Date().toISOString(),
            };
          })
        : [];

      const jobFolders = Array.isArray(config.jobFolders)
        ? config.jobFolders
          .filter(
            (folder): folder is JobFolder =>
              !!folder &&
              typeof folder.id === "string" &&
              folder.id.trim().length > 0 &&
              typeof folder.name === "string" &&
              folder.name.trim().length > 0,
          )
          .map((folder) => ({
            id: folder.id.trim(),
            name: folder.name.trim(),
            parentId:
              typeof folder.parentId === "string" &&
              folder.parentId.trim().length > 0
                ? folder.parentId.trim()
                : undefined,
            createdAt:
              typeof folder.createdAt === "string" && folder.createdAt.trim().length > 0
                ? folder.createdAt
                : new Date().toISOString(),
            updatedAt:
              typeof folder.updatedAt === "string" && folder.updatedAt.trim().length > 0
                ? folder.updatedAt
                : new Date().toISOString(),
          }))
        : [];

      return { tasks, jobs, jobFolders };
    } catch (e) {
      console.error('Failed to load tasks from scheduler.json:', e);
      return { tasks: [], jobs: [], jobFolders: [] };
    }
  }
}
