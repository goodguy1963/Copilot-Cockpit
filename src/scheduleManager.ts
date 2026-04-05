import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type {
  ScheduledTask,
  CreateTaskInput,
  TaskScope,
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
import {
  getResolvedWorkspaceRoots,
  getPrivateSchedulerConfigPath,
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./schedulerJsonSanitizer";
import {
  readWorkspaceSchedulerStateFromSqlite,
  syncGlobalTasksToSqlite,
  syncWorkspaceSchedulerStateToSqlite,
} from "./sqliteBootstrap";
import {
  getConfiguredSchedulerStorageMode,
  SQLITE_STORAGE_MODE,
} from "./sqliteStorage";
import { selectTaskStore } from "./taskStoreSelection";
import { normalizeForCompare } from "./promptResolver";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import {
  getCanonicalPromptBackupPath,
  getDefaultPromptBackupRelativePath,
  isRecurringPromptBackupCandidate,
  renderPromptBackupContent,
  resolvePromptBackupPath,
  toWorkspaceRelativePromptBackupPath,
} from "./promptBackup";
import { createScheduleHistorySnapshot, listScheduleHistoryEntries, readScheduleHistorySnapshot } from "./scheduleHistory";
import type { ScheduleHistoryEntry } from "./types";
import {
  getSchedulerLocalDateKey,
  readScheduledTasksFromStorageFile,
  readTaskStorageMetaFromFile,
  readTaskStorageMetaFromState,
  reviveScheduledTaskDates,
  TaskStorageMeta,
  toSafeSchedulerErrorDetails,
  updateMementoWithTimeout,
  writeScheduledTasksToStorageFile,
  writeTaskStorageMetaToFile,
  writeTaskStorageMetaToState,
} from "./scheduleManagerPersistence";
import {
  incrementDailyExecState,
  loadDailyExecState,
  notifyDailyLimitReachedOnce,
  persistDailyExecState,
  persistGlobalStateValueBestEffort,
  syncRecurringPromptBackupsForTasks,
} from "./scheduleManagerMaintenance";
import {
  persistScheduleManagerTaskStore,
  resolveScheduleManagerStoragePaths,
  selectScheduleManagerTaskStore,
} from "./scheduleManagerStoragePolicy";
import {
  applyTaskUpdatesToTask,
  applyTaskPromptUpdates,
  createDuplicateTaskInput,
  repairStoredTaskPromptSource,
  resolveCreatedTaskNextRun,
  setTaskEnabledState,
} from "./scheduleManagerTaskOps";
import {
  applyScheduleJitter,
  clampScheduleJitterSeconds,
  normalizeScheduledTaskChatSession,
  normalizeScheduledTaskLabels,
  normalizeScheduledTaskManualSession,
  normalizeScheduledWindowMinutes,
} from "./scheduleManagerTaskConfig";
import {
  assertValidCronExpression,
  getCronIntervalWarning,
  resolveNextCronRun,
  resolvePreviousCronRun,
  truncateDateToMinute,
} from "./scheduleManagerTiming";

const TASK_STORAGE = {
  stateKey: "scheduledTasks",
  fileName: "scheduledTasks.json",
  metaFileName: "scheduledTasks.meta.json",
  revisionKey: "scheduledTasksRevision",
  savedAtKey: "scheduledTasksSavedAt",
} as const;
const DAILY_EXEC_STATE_KEYS = {
  count: "dailyExecCount",
  date: "dailyExecDate",
  notifiedDate: "dailyLimitNotifiedDate",
} as const;
const DISCLAIMER_ACCEPTED_STATE_KEY = "disclaimerAccepted";

type TaskExecutionOutcome = {
  executedCount: number;
  needsSave: boolean;
  deleteTask: boolean;
};

interface CompiledJobPrompt {
  labels: string[];
  prompt: string;
  agent?: string;
  model?: string;
}

function clearScheduledHandle<T>(
  handle: T | undefined,
  clear: (value: T) => void,
): undefined {
  if (handle !== undefined) {
    clear(handle);
  }

  return undefined;
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
  private pendingDeletedTaskIds: Set<string> = new Set();
  private pendingDeletedJobIds: Set<string> = new Set();
  private pendingDeletedJobFolderIds: Set<string> = new Set();
  private context: vscode.ExtensionContext;
  private storageFilePath: string;
  private storageMetaFilePath: string;
  private schedulerInterval?: ReturnType<typeof setInterval>;
  private schedulerTimeout?: ReturnType<typeof setTimeout>;
  private schedulerTickInProgress = false;
  private schedulerTickPending = false;
  private onTasksChangedCallback?: () => void;
  private onExecuteCallback?: (task: ScheduledTask) => Promise<void>;
  private dailyExecCount = 0;
  private dailyExecDate = "";
  private dailyLimitNotifiedDate = "";

  private storageRevision = 0;

  private saveQueue: Promise<void> = Promise.resolve();
  private sqliteHydrationPromise: Promise<void> | undefined;

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
    const storagePaths = resolveScheduleManagerStoragePaths(
      this.context.globalStorageUri.fsPath,
      TASK_STORAGE.fileName,
      TASK_STORAGE.metaFileName,
    );
    this.storageFilePath = storagePaths.storageFilePath;
    this.storageMetaFilePath = storagePaths.storageMetaFilePath;
    this.loadDailyExecCount();
    this.loadTasks();
  }

  private loadTasksFromFile(): { tasks: ScheduledTask[]; ok: boolean } {
    const loaded = readScheduledTasksFromStorageFile(this.storageFilePath);
    if (loaded.error) {
      logDebug("[CopilotScheduler] Failed to load tasks from file:", loaded.error);
    }
    return loaded;
  }

  private async saveTasksToFile(tasksArray: ScheduledTask[]): Promise<void> {
    await writeScheduledTasksToStorageFile(this.storageFilePath, tasksArray);
  }

  private async saveTasksToGlobalState(
    tasksArray: ScheduledTask[],
  ): Promise<void> {
    await updateMementoWithTimeout(
      this.context.globalState,
      TASK_STORAGE.stateKey,
      tasksArray,
      10000,
      messages.storageWriteTimeout(),
    );
  }

  // ==================== Safety: Daily Execution Limit ====================

  /**
   * Load daily execution count from globalState
   */
  private loadDailyExecCount(): void {
    const state = loadDailyExecState(this.context.globalState, {
      ...DAILY_EXEC_STATE_KEYS,
    });
    this.dailyExecCount = state.count;
    this.dailyExecDate = state.date;
    this.dailyLimitNotifiedDate = state.notifiedDate;
  }

  private incrementDailyExecCountInMemory(date = new Date()): void {
    const state = incrementDailyExecState(
      { count: this.dailyExecCount, date: this.dailyExecDate },
      date,
    );
    this.dailyExecCount = state.count;
    this.dailyExecDate = state.date;
  }

  private async persistDailyExecCount(): Promise<void> {
    await persistDailyExecState(
      this.context.globalState,
      DAILY_EXEC_STATE_KEYS,
      {
        count: this.dailyExecCount,
        date: this.dailyExecDate,
      },
    );
  }

  /**
   * Apply a batch of prompt replacements and persist at most once.
   */
  async updateTaskPrompts(
    updates: Array<{ id: string; prompt: string }>,
  ): Promise<number> {
    if (!Array.isArray(updates) || updates.length === 0) {
      return 0;
    }
    const changedCount = applyTaskPromptUpdates(this.tasks, updates, new Date());
    if (changedCount < 1) {
      return 0;
    }
    await this.saveTasks();
    return changedCount;
  }

  async ensureRecurringPromptBackups(): Promise<number> {
    const { metadataChanged } = await this.syncRecurringPromptBackupsInPlace();
    if (metadataChanged < 1) return 0;
    await this.saveTasks({ bumpRevision: false });
    return metadataChanged;
  }

  private async syncRecurringPromptBackupsInPlace(): Promise<{ metadataChanged: number }> {
    return syncRecurringPromptBackupsForTasks(this.tasks.values(), () => this.getPrimaryWorkspaceRoot());
  }

  /**
   * Check if daily execution limit has been reached.
   * @param maxDailyLimit - Pre-computed limit (0 = unlimited). Pass from caller to avoid redundant config reads.
   */
  private isDailyLimitReached(maxDailyLimit: number): boolean {
    if (maxDailyLimit === 0) return false;
    const todayKey = getSchedulerLocalDateKey();
    if (this.dailyExecDate !== todayKey) {
      this.dailyExecCount = 0;
      this.dailyExecDate = todayKey;
    }
    return this.dailyExecCount >= maxDailyLimit;
  }

  private getScheduledTaskNextRun(
    task: ScheduledTask,
    referenceTime: Date,
  ): Date | undefined {
    if (!task.jobId) {
      return this.getNextRunForTask(task.cronExpression, referenceTime);
    }

    const jobContext = this.findJobNodeByTaskId(task.id);
    return jobContext
      ? this.getNextRunForJobNode(
          jobContext.job,
          jobContext.nodeIndex,
          referenceTime,
        )
      : this.getNextRunForTask(task.cronExpression, referenceTime);
  }

  private refreshTaskNextRunAfterUpdate(
    task: ScheduledTask,
    options: {
      enabledBefore: boolean;
      cronChanged: boolean;
      runFirstInOneMinute?: boolean;
      referenceTime: Date;
    },
  ): void {
    if (!task.enabled) {
      task.nextRun = undefined;
      return;
    }

    const { cronChanged, enabledBefore, referenceTime, runFirstInOneMinute } =
      options;
    if (runFirstInOneMinute) {
      task.nextRun = this.truncateToMinute(
        new Date(
          referenceTime.getTime() +
            ScheduleManager.FIRST_RUN_DELAY_MINUTES * 60 * 1000,
        ),
      );
      return;
    }

    if (cronChanged || !enabledBefore || !task.nextRun) {
      task.nextRun = this.getNextRunForTask(task.cronExpression, referenceTime);
    }
  }

  private getMillisecondsUntilNextMinute(referenceTime = new Date()): number {
    const elapsedMsThisMinute =
      referenceTime.getSeconds() * 1000 + referenceTime.getMilliseconds();
    return 60_000 - elapsedMsThisMinute;
  }

  private persistGlobalStateValueBestEffort<T>(
    key: string,
    value: T,
    failurePrefix: string,
  ): void {
    persistGlobalStateValueBestEffort(
      this.context.globalState,
      key,
      value,
      failurePrefix,
    );
  }

  private notifyDailyLimitReachedOnce(
    todayKey: string,
    maxDailyLimit: number,
  ): void {
    this.dailyLimitNotifiedDate = notifyDailyLimitReachedOnce({
      currentNotifiedDate: this.dailyLimitNotifiedDate,
      todayKey,
      maxDailyLimit,
      globalState: this.context.globalState,
      notifiedDateKey: DAILY_EXEC_STATE_KEYS.notifiedDate,
    });
  }

  private replaceTaskNextRun(
    task: ScheduledTask,
    nextRun: Date | undefined,
  ): boolean {
    const currentTime = task.nextRun?.getTime();
    const nextTime = nextRun?.getTime();
    if (currentTime === nextTime) {
      return false;
    }

    task.nextRun = nextRun;
    return true;
  }

  private disableStoredTaskIfCronInvalid(task: ScheduledTask): boolean {
    try {
      this.validateCronExpression(task.cronExpression);
      return false;
    } catch {
      const changed = task.enabled || task.nextRun !== undefined;
      task.enabled = false;
      task.nextRun = undefined;
      const logContext = { taskId: task.id, taskName: task.name, cronExpression: task.cronExpression };
      logError("[CopilotScheduler] Invalid cron expression found in stored task; disabling:", logContext);
      return changed;
    }
  }

  private reconcileLoadedTaskNextRun(task: ScheduledTask): boolean {
    if (task.jobId) {
      return false;
    }

    if (!task.enabled) {
      return this.replaceTaskNextRun(task, undefined);
    }

    const hasValidNextRun =
      task.nextRun instanceof Date && !Number.isNaN(task.nextRun.getTime());
    if (hasValidNextRun) {
      return false;
    }

    return this.replaceTaskNextRun(
      task,
      this.getNextRunForTask(task.cronExpression, new Date()),
    );
  }

  private armSchedulerInterval(): void {
    this.schedulerInterval = setInterval(() => void this.runSchedulerTick(), 60 * 1000);
  }

  private syncEnabledTaskState(
    task: ScheduledTask,
    enabled: boolean,
    referenceTime = new Date(),
  ): void {
    setTaskEnabledState(task, enabled, referenceTime, (cronExpression, when) =>
      this.getNextRunForTask(cronExpression, when),
    );
  }

  private markTaskModified(task: ScheduledTask): void {
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(task.id);
  }

  private scheduleBackgroundSave(
    message: string,
    options?: { bumpRevision?: boolean },
    debugOnly = false,
  ): void {
    void this.saveTasks(options).catch((error) => {
      const details = toSafeSchedulerErrorDetails(error);
      if (debugOnly) {
        logDebug(message, details);
        return;
      }
      logError(message, details);
    });
  }

  private async persistEnabledTaskChange(
    task: ScheduledTask,
    enabled: boolean,
  ): Promise<ScheduledTask> {
    task.enabled = enabled;
    this.markTaskModified(task);
    this.syncEnabledTaskState(task, enabled);
    await this.saveTasks();
    return task;
  }

  private async flushSchedulerTicks(): Promise<void> {
    while (true) {
      this.schedulerTickPending = false;
      await this.checkAndExecuteTasks();
      if (!this.schedulerTickPending) {
        return;
      }
    }
  }

  // ==================== Safety: Minimum Interval Warning ====================

  /**
   * Check if a cron expression has a short interval and return warning if so
   */
  checkMinimumInterval(cronExpression: string): string | undefined {
    return getCronIntervalWarning(
      cronExpression,
      new Date(),
      messages.minimumIntervalWarning(),
      this.getTimeZone(),
    );
  }

  // ==================== Safety: Disclaimer ====================

  /**
   * Check if the user has accepted the disclaimer
   */
  isDisclaimerAccepted(): boolean {
    return this.context.globalState.get<boolean>(DISCLAIMER_ACCEPTED_STATE_KEY, false);
  }

  /**
   * Set disclaimer accepted state
   */
  async setDisclaimerAccepted(accepted: boolean): Promise<void> {
    await this.context.globalState.update(DISCLAIMER_ACCEPTED_STATE_KEY, accepted);
  }

  /**
   * Set callback for when tasks change
   */
  setOnTasksChangedCallback(callback: () => void): void { this.onTasksChangedCallback = callback; }

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
      TASK_STORAGE.stateKey,
      [],
    );
    const fileLoad = this.loadTasksFromFile();
    const selection = selectScheduleManagerTaskStore({
      globalState: this.context.globalState,
      keys: {
        taskList: TASK_STORAGE.stateKey,
        revision: TASK_STORAGE.revisionKey,
        savedAt: TASK_STORAGE.savedAtKey,
      },
      savedTasks: savedTasks,
      fileLoad: fileLoad,
      storageMetaFilePath: this.storageMetaFilePath,
    });

    const tasksToLoad = selection.tasksToLoad;
    this.storageRevision = selection.revision;

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
      needsSave = reviveScheduledTaskDates(task) || needsSave;

      const normalizedChatSession = normalizeScheduledTaskChatSession(
        task.chatSession,
        task.oneTime === true,
      );
      if (task.chatSession !== normalizedChatSession) {
        task.chatSession = normalizedChatSession;
        needsSave = true;
      }

      const normalizedLabels = normalizeScheduledTaskLabels(task.labels);
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
      if (!task.scope) task.scope = "global";
      if (
        repairStoredTaskPromptSource(
          task,
          this.getResolvedWorkspaceRoots(),
          getCompatibleConfigurationValue<string>("globalPromptsPath", ""),
        )
      ) {
        needsSave = true;
      }

      // Migration: add jitterSeconds if missing
      if (task.jitterSeconds === undefined) {
        task.jitterSeconds = 0;
      }

      needsSave = this.disableStoredTaskIfCronInvalid(task) || needsSave;
      needsSave = this.reconcileLoadedTaskNextRun(task) || needsSave;

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
      this.scheduleBackgroundSave("[CopilotScheduler] Failed to save migrated tasks:");
    } else {
      if (selection.shouldHealFile || selection.shouldHealGlobalState) {
        this.scheduleBackgroundSave(
          "[CopilotScheduler] Failed to sync task stores:",
          { bumpRevision: false },
          true,
        );
      }
    }

    this.scheduleSqliteWorkspaceHydration();
  }

  private isWorkspaceSqliteModeEnabled(): boolean {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      return false;
    }
    return getConfiguredSchedulerStorageMode(vscode.Uri.file(workspaceRoot)) === SQLITE_STORAGE_MODE;
  }

  private scheduleSqliteWorkspaceHydration(): void {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot || !this.isWorkspaceSqliteModeEnabled()) {
      return;
    }
    if (this.sqliteHydrationPromise) {
      return;
    }

    this.sqliteHydrationPromise = this.hydrateWorkspaceTasksFromSqlite(workspaceRoot)
      .catch((error) =>
        logDebug(
          "[CopilotScheduler] SQLite workspace hydration failed:",
          toSafeSchedulerErrorDetails(error),
        ),
      )
      .finally(() => {
        this.sqliteHydrationPromise = undefined;
      });
  }

  private async hydrateWorkspaceTasksFromSqlite(workspaceRoot: string): Promise<void> {
    const sqliteState = this.normalizeWorkspaceSchedulerState(
      await readWorkspaceSchedulerStateFromSqlite(workspaceRoot),
      workspaceRoot,
    );

    if (
      sqliteState.tasks.length === 0 &&
      sqliteState.jobs.length === 0 &&
      sqliteState.jobFolders.length === 0
    ) {
      return;
    }

    const nextTasks = new Map<string, ScheduledTask>();
    for (const task of this.tasks.values()) {
      if (task.scope !== "workspace") {
        nextTasks.set(task.id, task);
      }
    }
    for (const task of sqliteState.tasks) {
      nextTasks.set(task.id, task);
    }

    this.jobs = new Map(sqliteState.jobs.map((job) => [job.id, job]));
    this.jobFolders = new Map(sqliteState.jobFolders.map((folder) => [folder.id, folder]));

    this.tasks.clear();
    for (const task of nextTasks.values()) {
      reviveScheduledTaskDates(task);
      this.tasks.set(task.id, task);
    }

    this.notifyTasksChanged();
  }

  private normalizeWorkspaceSchedulerState(
    config: {
      tasks?: unknown[];
      jobs?: unknown[];
      jobFolders?: unknown[];
    },
    workspaceRoot: string,
  ): WorkspaceSchedulerState {
    const tasks = Array.isArray(config.tasks)
      ? config.tasks.map((t: any) => {
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
          chatSession: normalizeScheduledTaskChatSession(
            t.chatSession,
            t.oneTime === true,
          ),
          labels: normalizeScheduledTaskLabels(t.labels),
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
      })
      : [];

    const rawJobs = Array.isArray(config.jobs) ? config.jobs : [];

    const jobs = rawJobs.reduce<JobDefinition[]>((acc, job) => {
      if (
        !job ||
        typeof job !== "object" ||
        typeof (job as { id?: unknown }).id !== "string" ||
        (job as { id: string }).id.trim().length === 0 ||
        typeof (job as { name?: unknown }).name !== "string" ||
        (job as { name: string }).name.trim().length === 0 ||
        typeof (job as { cronExpression?: unknown }).cronExpression !== "string" ||
        (job as { cronExpression: string }).cronExpression.trim().length === 0
      ) {
        return acc;
      }

      const normalizedJob = job as JobDefinition;
          const normalizedNodes: JobNode[] = Array.isArray(normalizedJob.nodes)
            ? normalizedJob.nodes.reduce<JobNode[]>((acc, node) => {
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
                windowMinutes: normalizeScheduledWindowMinutes(
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
            normalizedJob.runtime && typeof normalizedJob.runtime === "object"
              ? (normalizedJob.runtime as JobRuntimeState)
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

          acc.push({
            ...normalizedJob,
            folderId:
              typeof normalizedJob.folderId === "string" && normalizedJob.folderId.trim().length > 0
                ? normalizedJob.folderId.trim()
                : undefined,
            paused: normalizedJob.paused === true,
            archived: normalizedJob.archived === true,
            archivedAt:
              typeof normalizedJob.archivedAt === "string" && normalizedJob.archivedAt.trim().length > 0
                ? normalizedJob.archivedAt.trim()
                : undefined,
            lastCompiledTaskId:
              typeof normalizedJob.lastCompiledTaskId === "string" &&
              normalizedJob.lastCompiledTaskId.trim().length > 0
                ? normalizedJob.lastCompiledTaskId.trim()
                : undefined,
            nodes: normalizedNodes,
            runtime,
            createdAt:
              typeof normalizedJob.createdAt === "string" && normalizedJob.createdAt.trim().length > 0
                ? normalizedJob.createdAt
                : new Date().toISOString(),
            updatedAt:
              typeof normalizedJob.updatedAt === "string" && normalizedJob.updatedAt.trim().length > 0
                ? normalizedJob.updatedAt
                : new Date().toISOString(),
          });

      return acc;
    }, []);

    const rawJobFolders = Array.isArray(config.jobFolders) ? config.jobFolders : [];

    const jobFolders = rawJobFolders.reduce<JobFolder[]>((acc, folder) => {
      if (
        !folder ||
        typeof folder !== "object" ||
        typeof (folder as { id?: unknown }).id !== "string" ||
        (folder as { id: string }).id.trim().length === 0 ||
        typeof (folder as { name?: unknown }).name !== "string" ||
        (folder as { name: string }).name.trim().length === 0
      ) {
        return acc;
      }

      const normalizedFolder = folder as JobFolder;
      acc.push({
          id: normalizedFolder.id.trim(),
          name: normalizedFolder.name.trim(),
          parentId:
            typeof normalizedFolder.parentId === "string" &&
            normalizedFolder.parentId.trim().length > 0
              ? normalizedFolder.parentId.trim()
              : undefined,
          createdAt:
            typeof normalizedFolder.createdAt === "string" && normalizedFolder.createdAt.trim().length > 0
              ? normalizedFolder.createdAt
              : new Date().toISOString(),
          updatedAt:
            typeof normalizedFolder.updatedAt === "string" && normalizedFolder.updatedAt.trim().length > 0
              ? normalizedFolder.updatedAt
              : new Date().toISOString(),
        });

      return acc;
    }, []);

    return { tasks, jobs, jobFolders };
  }

  /**
   * Save tasks to globalState
   */
  private async saveTasks(options?: { bumpRevision?: boolean }): Promise<void> {
    const queuedSave = this.saveQueue.then(() => this.saveTasksInternal(options));
    this.saveQueue = queuedSave.catch((error) => {
      logError(
        "[CopilotScheduler] Save failed (chain recovered):",
        toSafeSchedulerErrorDetails(error),
      );
    });
    return queuedSave;
  }

  private async saveTasksAndSyncRecurringPromptBackups(options?: {
    bumpRevision?: boolean;
  }): Promise<void> {
    await this.saveTasks(options);
    await this.ensureRecurringPromptBackups();
  }

  private async saveTasksInternal(
    options?: { bumpRevision?: boolean },
  ): Promise<void> {
    const bumpRevision = options?.bumpRevision !== false;
    const tasksArray = [...this.tasks.values()];

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
          deletedTaskIds: Array.from(new Set([
            ...(Array.isArray(existingConfig.deletedTaskIds)
              ? existingConfig.deletedTaskIds
              : []),
            ...Array.from(this.pendingDeletedTaskIds),
          ])).filter((taskId) => !fileTasks.some((task) => task.id === taskId)),
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
                  windowMinutes: normalizeScheduledWindowMinutes(node.windowMinutes),
                }),
          })),
          deletedJobIds: Array.from(new Set([
            ...(Array.isArray(existingConfig.deletedJobIds)
              ? existingConfig.deletedJobIds
              : []),
            ...Array.from(this.pendingDeletedJobIds),
          ])).filter((jobId) => !this.jobs.has(jobId)),
          jobFolders: this.getAllJobFolders().map((folder) => ({ ...folder })),
          deletedJobFolderIds: Array.from(new Set([
            ...(Array.isArray(existingConfig.deletedJobFolderIds)
              ? existingConfig.deletedJobFolderIds
              : []),
            ...Array.from(this.pendingDeletedJobFolderIds),
          ])).filter((folderId) => !this.jobFolders.has(folderId)),
        };
        writeSchedulerConfig(workspaceRoot, config, {
          baseConfig: existingConfig,
        });
        if (this.isWorkspaceSqliteModeEnabled()) {
          await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, config);
        }
        this.pendingDeletedTaskIds.clear();
        this.pendingDeletedJobIds.clear();
        this.pendingDeletedJobFolderIds.clear();
      }
    } catch (e) {
      console.error('[Scheduler] Failed to save to .vscode/scheduler.json:', e);
      vscode.window.showErrorMessage(`Failed to save scheduler configuration: ${e instanceof Error ? e.message : String(e)}`);
      throw e;
    }
    /* -------------------------------------------------------- */

    this.storageRevision = await persistScheduleManagerTaskStore({
      tasksArray: tasksArray,
      bumpRevision: bumpRevision,
      currentRevision: this.storageRevision,
      storageMetaFilePath: this.storageMetaFilePath,
      globalState: this.context.globalState,
      keys: {
        revision: TASK_STORAGE.revisionKey,
        savedAt: TASK_STORAGE.savedAtKey,
      },
      saveTasksToFile: (nextTasks) => this.saveTasksToFile(nextTasks),
      saveTasksToGlobalState: (nextTasks) => this.saveTasksToGlobalState(nextTasks),
      syncGlobalTasksToSqlite:
        this.context.globalStorageUri?.fsPath && this.isWorkspaceSqliteModeEnabled()
          ? async () => {
              await syncGlobalTasksToSqlite(
                this.context.globalStorageUri.fsPath,
                tasksArray,
              );
            }
          : undefined,
      logDebug: logDebug,
      toSafeSchedulerErrorDetails: toSafeSchedulerErrorDetails,
    });

    this.notifyTasksChanged();
  }

  /**
   * Generate unique task ID
   */
  private generateId(): string { return this.generateScopedId("task"); }

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
  private getNextRun(cronExpression: string, baseTime?: Date): Date | undefined {
    return resolveNextCronRun(
      cronExpression,
      baseTime || new Date(),
      this.getTimeZone(),
      (tz) =>
        logDebug(
          `[CopilotScheduler] Invalid timezone "${tz}", falling back to local time`,
        ),
    );
  }

  private truncateToMinute(date: Date): Date {
    return truncateDateToMinute(date);
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
    const nextRun = this.getNextRun(cronExpression, baseTime);
    if (nextRun) {
      return nextRun;
    }

    const fallbackRun = new Date(baseTime.getTime() + 60 * 60 * 1000);
    logError(`[CopilotScheduler] Failed to parse cron "${cronExpression}"; falling back to +60 min`);
    return this.truncateToMinute(fallbackRun);
  }

  /**
   * Validate cron expression
   * @throws Error if invalid
   */
  validateCronExpression(expression: string): void {
    assertValidCronExpression(
      expression,
      new Date(),
      messages.invalidCronExpression(),
      this.getTimeZone(),
    );
  }

  private assertTaskUpdateInput(
    task: ScheduledTask,
    updates: Partial<CreateTaskInput>,
  ): void {
    if (updates.name !== undefined) {
      const nextName = updates.name.trim();
      if (!nextName) throw new Error(messages.taskNameRequired());
    }

    const nextPromptSource = updates.promptSource ?? task.promptSource ?? "inline";
    const inlinePromptCleared =
      updates.prompt !== undefined &&
      nextPromptSource === "inline" &&
      updates.prompt.trim().length === 0;
    if (inlinePromptCleared) throw new Error(messages.promptRequired());
    if (updates.cronExpression !== undefined) this.validateCronExpression(updates.cronExpression);
  }

  private createScheduledTaskRecord(
    input: CreateTaskInput,
    params: {
      id: string;
      enabled: boolean;
      effectiveScope: TaskScope;
      workspacePath: string | undefined;
      jitterSeconds: number;
      oneTime: boolean;
      nextRun: Date | undefined;
      now: Date;
    },
  ): ScheduledTask {
    const {
      id,
      enabled,
      effectiveScope,
      workspacePath,
      jitterSeconds,
      oneTime,
      nextRun,
      now,
    } = params;
    const sessionState = {
      manualSession: normalizeScheduledTaskManualSession(input.manualSession, oneTime),
      chatSession: normalizeScheduledTaskChatSession(input.chatSession, oneTime),
      labels: normalizeScheduledTaskLabels(input.labels),
    };

    return {
      id,
      name: input.name,
      cronExpression: input.cronExpression,
      prompt: input.prompt,
      agent: input.agent,
      model: input.model,
      enabled,
      scope: effectiveScope,
      oneTime,
      jitterSeconds,
      workspacePath,
      promptSource: input.promptSource || "inline",
      promptPath: input.promptPath,
      nextRun,
      createdAt: now,
      updatedAt: now,
      ...sessionState,
    };
  }

  private unlinkTaskFromOwningJob(taskId: string): void {
    const jobContext = this.findJobNodeByTaskId(taskId);
    if (!jobContext) {
      return;
    }

    const removedNodeId = jobContext.node.id;
    jobContext.job.nodes = jobContext.job.nodes.filter(
      ({ id }) => id !== removedNodeId,
    );
    this.clearJobRuntime(jobContext.job);
    jobContext.job.updatedAt = new Date().toISOString();
  }

  private beginAlignedSchedulerLoop(): void {
    this.schedulerTimeout = undefined;
    void this.runSchedulerTick();
    this.armSchedulerInterval();
  }

  private createTaskUpdateContext() {
    const taskUpdateContext = {
      getPrimaryWorkspaceRoot: () => this.getPrimaryWorkspaceRoot(),
      clampJitterSeconds: clampScheduleJitterSeconds,
      normalizeTaskManualSession: normalizeScheduledTaskManualSession,
      normalizeTaskChatSession: normalizeScheduledTaskChatSession,
      normalizeLabels: normalizeScheduledTaskLabels,
    };
    return taskUpdateContext;
  }

  private clearTaskSchedulingState(taskId: string): void {
    this.pendingDeletedTaskIds.add(taskId);
    this.suppressedOverdueTaskIds.delete(taskId);
  }

  private updateTaskWorkspacePath(
    task: ScheduledTask,
    workspacePath: string,
  ): ScheduledTask {
    task.workspacePath = workspacePath;
    this.markTaskModified(task);
    return task;
  }

  private getScheduledTaskWorkspaceKey(task: ScheduledTask): string {
    return task.workspacePath ? normalizeForCompare(task.workspacePath) : "";
  }

  private getEnabledTaskArray(): ScheduledTask[] {
    return [...this.tasks.values()].filter(({ enabled }) => enabled);
  }

  private buildDailyLimitSkipOutcome(
    task: ScheduledTask,
    maxDailyLimit: number,
    now: Date,
  ): TaskExecutionOutcome {
    logDebug(
      `[CopilotScheduler] Daily limit (${maxDailyLimit}) reached, skipping task: ${task.name}`,
    );
    this.notifyDailyLimitReachedOnce(getSchedulerLocalDateKey(), maxDailyLimit);
    const rescheduledAt = this.getScheduledTaskNextRun(task, now);
    task.nextRun = rescheduledAt;
    return { executedCount: 0, needsSave: true, deleteTask: false };
  }

  private buildTaskExecutionRetryOutcome(): TaskExecutionOutcome {
    return {
      executedCount: 0,
      needsSave: true,
      deleteTask: false,
    };
  }

  private handleSuccessfulTaskExecution(
    task: ScheduledTask,
    executedAt: Date,
  ): TaskExecutionOutcome {
    this.incrementDailyExecCountInMemory(executedAt);
    task.lastRun = executedAt;
    task.lastError = undefined;
    task.lastErrorAt = undefined;
    this.handleSuccessfulJobTaskExecution(task, executedAt);
    this.syncJobTaskSchedules(executedAt);

    if (this.isOneTimeExecutionTask(task)) {
      return { executedCount: 1, needsSave: true, deleteTask: true };
    }

    task.nextRun = this.getScheduledTaskNextRun(task, new Date());
    return { executedCount: 1, needsSave: true, deleteTask: false };
  }

  private handleFailedTaskExecution(
    task: ScheduledTask,
    error: unknown,
    now: Date,
  ): TaskExecutionOutcome {
    const details = toSafeSchedulerErrorDetails(error);
    const failureContext = { error: details, taskId: task.id, taskName: task.name };
    logError("[CopilotScheduler] Task execution error:", failureContext);
    task.lastError = details;
    task.lastErrorAt = new Date();
    task.nextRun = this.truncateToMinute(new Date(now.getTime() + 60 * 1000));
    return this.buildTaskExecutionRetryOutcome();
  }

  private finalizeTaskUpdate(
    task: ScheduledTask,
    taskId: string,
    updatedAt: Date,
  ): Promise<void> {
    task.updatedAt = updatedAt;
    this.suppressedOverdueTaskIds.delete(taskId);
    return this.saveTasksAndSyncRecurringPromptBackups();
  }

  private async deleteTaskAndPersist(taskId: string): Promise<boolean> {
    const deleted = this.tasks.delete(taskId);
    if (!deleted) {
      return false;
    }

    this.clearTaskSchedulingState(taskId);
    this.syncJobTaskSchedules(new Date());
    await this.saveTasks();
    return true;
  }

  private resolveCurrentWorkspaceRootOrThrow(): string {
    const workspaceRoot = this.getPrimaryWorkspaceRoot();
    if (!workspaceRoot) {
      throw new Error(messages.noWorkspaceOpen());
    }

    return workspaceRoot;
  }

  private scheduleAlignedSchedulerStart(): void {
    const delayUntilNextMinute = this.getMillisecondsUntilNextMinute();
    this.schedulerTimeout = setTimeout(
      () => this.beginAlignedSchedulerLoop(),
      delayUntilNextMinute,
    );
  }

  private logSchedulerTickFailure(error: unknown): void {
    logError(
      "[CopilotScheduler] Scheduler tick failed:",
      toSafeSchedulerErrorDetails(error),
    );
  }

  private getSchedulerTickSettings(): {
    maxDailyLimit: number;
    defaultJitterSeconds: number;
  } {
    const configuredDailyLimit = getCompatibleConfigurationValue<number>(
      "maxDailyExecutions",
      24,
    );
    const normalizedDailyLimit = Number.isFinite(configuredDailyLimit)
      ? configuredDailyLimit
      : 24;

    const defaultJitterSeconds = getCompatibleConfigurationValue<number>(
      "jitterSeconds",
      0,
    );
    const maxDailyLimit =
      normalizedDailyLimit === 0
        ? 0
        : Math.min(Math.max(normalizedDailyLimit, 1), 100);

    return { defaultJitterSeconds, maxDailyLimit };
  }

  private shouldSkipScheduledTask(task: ScheduledTask): boolean {
    if (!task.enabled || !task.nextRun) {
      return true;
    }
    if (this.isTaskSuppressedByJob(task)) {
      return true;
    }
    if (!this.shouldTaskRunInCurrentWorkspace(task)) {
      return true;
    }
    return this.suppressedOverdueTaskIds.has(task.id);
  }

  private async executeDueTask(
    task: ScheduledTask,
    now: Date,
    nowMinute: Date,
    maxDailyLimit: number,
    defaultJitterSeconds: number,
  ): Promise<TaskExecutionOutcome> {
    if (!this.isTaskDueAt(task, nowMinute)) {
      return { executedCount: 0, needsSave: false, deleteTask: false };
    }

    if (this.isDailyLimitReached(maxDailyLimit)) {
      return this.buildDailyLimitSkipOutcome(task, maxDailyLimit, now);
    }

    const maxJitterSeconds = task.jitterSeconds ?? defaultJitterSeconds;
    await applyScheduleJitter(maxJitterSeconds);

    const executeTask = this.onExecuteCallback;
    if (executeTask) {
      try {
        await executeTask(task);
        return this.handleSuccessfulTaskExecution(task, new Date());
      } catch (error) {
        return this.handleFailedTaskExecution(task, error, now);
      }
    }

    task.nextRun = this.truncateToMinute(new Date(now.getTime() + 60 * 1000));
    return this.buildTaskExecutionRetryOutcome();
  }

  private applyScheduledTaskDeletions(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      this.tasks.delete(taskId);
      this.clearTaskSchedulingState(taskId);
    }
  }

  private async persistDailyExecCountSafely(executedCount: number): Promise<void> {
    if (executedCount <= 0) {
      return;
    }

    try {
      await this.persistDailyExecCount();
    } catch (error) {
      logError(
        "[CopilotScheduler] Failed to persist daily execution count:",
        toSafeSchedulerErrorDetails(error),
      );
    }
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

      return total + normalizeScheduledWindowMinutes(node.windowMinutes);
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
    return resolvePreviousCronRun(
      cronExpression,
      new Date(referenceTime.getTime() + 1),
      this.getTimeZone(),
    );
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
    const trimmedName = input.name?.trim();
    const trimmedPrompt = input.prompt?.trim();
    if (!trimmedName) throw new Error(messages.taskNameRequired());
    if (!trimmedPrompt) throw new Error(messages.promptRequired());
    this.validateCronExpression(input.cronExpression);

    const now = new Date();
    const id = this.generateId();

    // Get defaults from configuration
    const defaultScope = getCompatibleConfigurationValue<TaskScope>(
      "defaultScope",
      "workspace",
    );
    const defaultJitter = clampScheduleJitterSeconds(
      getCompatibleConfigurationValue<number>("jitterSeconds", 0),
    );

    const enabled = input.enabled !== false;
    const effectiveScope = input.scope || defaultScope;
    const oneTime = input.oneTime ?? id.startsWith("exec-");
    const workspacePath =
      effectiveScope === "workspace"
        ? this.getPrimaryWorkspaceRoot()
        : undefined;
    const jitterSeconds =
      input.jitterSeconds !== undefined
        ? clampScheduleJitterSeconds(input.jitterSeconds)
        : defaultJitter;
    const nextRun = resolveCreatedTaskNextRun({
      enabled,
      runFirstInOneMinute: input.runFirstInOneMinute,
      now,
      firstRunDelayMinutes: ScheduleManager.FIRST_RUN_DELAY_MINUTES,
      cronExpression: input.cronExpression,
      truncateToMinute: (date) => this.truncateToMinute(date),
      getNextRun: (cronExpression, referenceTime) =>
        this.getNextRunForTask(cronExpression, referenceTime),
    });

    const task = this.createScheduledTaskRecord(input, {
      id,
      enabled,
      effectiveScope,
      workspacePath,
      jitterSeconds,
      oneTime,
      nextRun,
      now,
    });

    this.tasks.set(id, task);
    await this.saveTasksAndSyncRecurringPromptBackups();

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.tasks.get(taskId);
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
    return [...this.tasks.values()];
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
      task.labels = normalizeScheduledTaskLabels(nextLabels);
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
    this.pendingDeletedJobIds.add(id);
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
    this.pendingDeletedJobFolderIds.add(id);
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
        windowMinutes: normalizeScheduledWindowMinutes(windowMinutes),
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

    node.windowMinutes = normalizeScheduledWindowMinutes(windowMinutes);
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

  private buildCompiledJobPrompt(job: JobDefinition): CompiledJobPrompt {
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
        `Original window: ${normalizeScheduledWindowMinutes(node.windowMinutes)} minutes`,
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
          toSafeSchedulerErrorDetails(error),
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

    writeSchedulerConfig(workspaceRoot, restoredConfig, {
      mode: "replace",
    });
    this.loadTasks();
    this.notifyTasksChanged();
    return true;
  }

  /**
   * Rebuild stored next-run timestamps after timezone-sensitive config changes.
   */
  async recalculateAllNextRuns(): Promise<void> {
    const now = new Date();
    let didChange = false;
    for (const task of this.getEnabledTaskArray()) {
      const nextRun = this.getScheduledTaskNextRun(task, now);
      didChange = this.replaceTaskNextRun(task, nextRun) || didChange;
    }
    if (didChange) {
      await this.saveTasks();
    }
  }

  /**
   * Return tasks whose scope matches the requested scope.
   */
  getTasksByScope(scope: TaskScope): ScheduledTask[] {
    return this.getAllTasks().filter(({ scope: taskScope }) => taskScope === scope);
  }

  /**
   * Mutate a task in place and persist the refreshed schedule fields.
   */
  async updateTask(
    id: string,
    updates: Partial<CreateTaskInput>,
  ): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    this.assertTaskUpdateInput(task, updates);

    const now = new Date();
    const enabledBefore = task.enabled;
    const { cronChanged } = applyTaskUpdatesToTask({
      task,
      updates,
      ...this.createTaskUpdateContext(),
    });

    this.refreshTaskNextRunAfterUpdate(task, {
      enabledBefore,
      cronChanged,
      runFirstInOneMinute: updates.runFirstInOneMinute,
      referenceTime: now,
    });
    await this.finalizeTaskUpdate(task, id, now);
    return task;
  }

  /**
   * Remove a task and flush the corresponding scheduler state.
   */
  async deleteTask(id: string): Promise<boolean> {
    this.unlinkTaskFromOwningJob(id);
    return this.deleteTaskAndPersist(id);
  }

  /**
   * Flip the enabled state for a single task.
   */
  async toggleTask(id: string): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return this.persistEnabledTaskChange(task, !task.enabled);
  }

  /**
   * Persist an explicit enabled value for a task.
   */
  async setTaskEnabled(
    id: string,
    enabled: boolean,
  ): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    return this.persistEnabledTaskChange(task, enabled);
  }

  /**
   * Clone a task using the localized copy suffix.
   */
  async duplicateTask(id: string): Promise<ScheduledTask | undefined> {
    const original = this.tasks.get(id);
    if (!original) return undefined;
    return this.createTask(createDuplicateTaskInput(original, messages.taskCopySuffix()));
  }

  /**
   * Point a workspace task at whichever workspace is currently active.
   */
  async moveTaskToCurrentWorkspace(
    id: string,
  ): Promise<ScheduledTask | undefined> {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    if (task.scope !== "workspace") {
      throw new Error(messages.moveOnlyWorkspaceTasks());
    }

    const workspaceRoot = this.resolveCurrentWorkspaceRootOrThrow();
    this.updateTaskWorkspacePath(task, workspaceRoot);
    await this.saveTasksAndSyncRecurringPromptBackups();
    return task;
  }

  /**
   * Decide whether a task belongs to the active workspace set.
   */
  shouldTaskRunInCurrentWorkspace(task: ScheduledTask): boolean {
    if (task.scope !== "workspace") {
      return true;
    }

    const taskWorkspaceKey = this.getScheduledTaskWorkspaceKey(task);
    if (taskWorkspaceKey.length === 0) {
      return false;
    }

    const openWorkspaceKeys = this.getResolvedWorkspaceRoots().map((workspacePath) =>
      normalizeForCompare(workspacePath),
    );
    return openWorkspaceKeys.includes(taskWorkspaceKey);
  }

  /**
   * Restart the aligned timer loop with a fresh execute callback.
   */
  startScheduler(onExecute: (task: ScheduledTask) => Promise<void>): void {
    this.setOnExecuteCallback(onExecute);
    this.stopScheduler();
    this.scheduleAlignedSchedulerStart();
  }

  private async runSchedulerTick(): Promise<void> {
    if (this.schedulerTickInProgress) {
      this.schedulerTickPending = true;
      return;
    }

    this.schedulerTickInProgress = true;
    try {
      await this.flushSchedulerTicks();
    } catch (error) {
      this.logSchedulerTickFailure(error);
    } finally {
      this.schedulerTickInProgress = false;
    }
  }

  /**
   * Cancel all active timer handles owned by the scheduler loop.
   */
  stopScheduler(): void {
    this.schedulerTimeout = clearScheduledHandle(
      this.schedulerTimeout,
      clearTimeout,
    );
    this.schedulerInterval = clearScheduledHandle(
      this.schedulerInterval,
      clearInterval,
    );
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
    if (!getCompatibleConfigurationValue<boolean>("enabled", true)) {
      return;
    }

    const now = new Date();
    const nowMinute = this.truncateToMinute(now);
    const { maxDailyLimit, defaultJitterSeconds } = this.getSchedulerTickSettings();

    let needsSave = false;
    let executedCount = 0;
    const tasksToDelete: string[] = [];

    for (const task of this.tasks.values()) {
      if (this.shouldSkipScheduledTask(task)) {
        continue;
      }

      const outcome = await this.executeDueTask(
        task,
        now,
        nowMinute,
        maxDailyLimit,
        defaultJitterSeconds,
      );
      executedCount += outcome.executedCount;
      needsSave = outcome.needsSave || needsSave;
      if (outcome.deleteTask) {
        tasksToDelete.push(task.id);
      }
    }

    this.applyScheduledTaskDeletions(tasksToDelete);
    await this.persistDailyExecCountSafely(executedCount);

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
        this.pendingDeletedTaskIds.add(task.id);
        this.suppressedOverdueTaskIds.delete(task.id);
      } else if (task.enabled) {
        task.nextRun = this.getScheduledTaskNextRun(task, executedAt);
        this.suppressedOverdueTaskIds.delete(task.id);
      }
      await this.saveTasks();

      return true;
    } catch (error) {
      logError(
        "[CopilotScheduler] runTaskNow failed:",
        toSafeSchedulerErrorDetails(error),
      );
      task.lastError = toSafeSchedulerErrorDetails(error);
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

      return this.normalizeWorkspaceSchedulerState(config, workspaceRoot);
    } catch (e) {
      console.error('Failed to load tasks from scheduler.json:', e);
      return { tasks: [], jobs: [], jobFolders: [] };
    }
  }
}
