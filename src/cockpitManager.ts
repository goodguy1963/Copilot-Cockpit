import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode"; // local-diverge-3
import type {
  CreateTaskInput,
  ScheduledTask,
  JobDefinition,
  JobFolder,
  JobNode,
  JobPauseNode,
  JobRuntimeState,
  JobTaskNode,
  CreateJobInput,
  CreateJobFolderInput,
  CreateJobPauseInput,
  SchedulerWorkspaceConfig,
  TaskScope,
} from "./types";
import { messages } from "./i18n";
import { logDebug, logError } from "./logger";
import { // local-diverge-21
  getResolvedWorkspaceRoots,
  getPrivateSchedulerConfigPath,
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./cockpitJsonSanitizer";
import {
  exportWorkspaceSqliteToJsonMirrors,
  readWorkspaceSchedulerStateFromSqlite,
  syncGlobalTasksToSqlite,
  syncWorkspaceSchedulerStateToSqlite,
} from "./sqliteBootstrap";
import {
  getConfiguredSchedulerStorageMode,
  SQLITE_STORAGE_MODE,
  WORKSPACE_SQLITE_DB_FILE,
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
import { createScheduleHistorySnapshot, listScheduleHistoryEntries, readScheduleHistorySnapshot } from "./cockpitHistory";
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
} from "./cockpitManagerPersistence";
import {
  incrementDailyExecState,
  loadDailyExecState,
  notifyDailyLimitReachedOnce,
  persistDailyExecState,
  persistGlobalStateValueBestEffort,
  syncRecurringPromptBackupsForTasks,
} from "./cockpitManagerMaintenance";
import {
  persistScheduleManagerTaskStore,
  resolveScheduleManagerStoragePaths,
  selectScheduleManagerTaskStore,
} from "./cockpitManagerStoragePolicy";
import {
  applyTaskUpdatesToTask,
  applyTaskPromptUpdates,
  createDuplicateTaskInput,
  normalizeOneTimeDelaySeconds,
  repairStoredTaskPromptSource,
  resolveCreatedTaskNextRun,
  resolveOneTimeDelayNextRun,
  setTaskEnabledState,
} from "./cockpitManagerTaskOps";
import {
  applyScheduleJitter,
  clampScheduleJitterSeconds,
  normalizeScheduledTaskChatSession,
  normalizeScheduledTaskLabels,
  normalizeScheduledTaskManualSession,
  normalizeScheduledWindowMinutes,
} from "./cockpitManagerTaskConfig";
import {
  assertValidCronExpression,
  getCronIntervalWarning,
  resolveNextCronRun,
  resolvePreviousCronRun,
  truncateDateToMinute,
} from "./cockpitManagerTiming";

const TASK_STORAGE = {
  stateKey: "scheduledTasks",
  fileName: "scheduledTasks.json",
  metaFileName: "scheduledTasks.meta.json",
  revisionKey: "scheduledTasksRevision",
  savedAtKey: "scheduledTasksSavedAt",
} as const;
const DAILY_EXEC_STATE_KEYS = {
  count: "todayRunCount",
  date: "todayCountDate",
  notifiedDate: "limitWarningDate",
} as const;
const DISCLAIMER_ACCEPTED_STATE_KEY = "disclaimerAccepted";

type TaskExecutionOutcome = {
  executedCount: number;
  pendingWrite: boolean;
  deleteTask: boolean;
};

interface CompiledJobPrompt {
  prompt: string;
  labels: string[];
  model?: string;
  agent?: string;
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

type DeleteTaskStateSnapshot = {
  taskRegistry: Map<string, ScheduledTask>;
  jobs: Map<string, JobDefinition>;
  suppressedOverdueTaskIds: Set<string>;
  pendingDeletedTaskIds: Set<string>;
  recentTaskLaunchTimes: Map<string, number>;
};

/**
 * Central manager for task lifecycle: create, read, update, delete, cron evaluation, and storage
 */
export class ScheduleManager {
  private static readonly BUNDLED_JOB_FOLDER_NAME = "Bundled Jobs";

  private taskRegistry: Map<string, ScheduledTask> = new Map();
  private jobs: Map<string, JobDefinition> = new Map();
  private jobFolders: Map<string, JobFolder> = new Map();
  private suppressedOverdueTaskIds: Set<string> = new Set();
  private pendingDeletedTaskIds: Set<string> = new Set();
  private pendingDeletedJobIds: Set<string> = new Set();
  private pendingDeletedJobFolderIds: Set<string> = new Set();
  private taskStorePath: string;
  private extensionCtx: vscode.ExtensionContext;
  private storageMetaFilePath: string; // local-diverge-187
  private schedulerInterval?: ReturnType<typeof setInterval>;
  private schedulerTimer?: ReturnType<typeof setTimeout>;
  private tickCycleRunning = false;
  private tickCycleQueued = false;
  private activeTaskExecutionIds: Set<string> = new Set();
  private recentTaskLaunchTimes: Map<string, number> = new Map();
  private onTasksChangedCallback?: () => void;
  private postExecutionNotifier?: () => void;
  private taskRunCallback?: (task: ScheduledTask) => Promise<void>;
  private todayRunCount = 0;
  private todayCountDate = "";
  private storageRevision = 0; // local-diverge-196
  private limitWarningDate = "";

  private persistChain: Promise<void> = Promise.resolve();
  private sqliteHydrationPromise: Promise<void> | undefined;

  private static readonly INITIAL_TICK_DELAY_MIN = 3;
  private static readonly CONCURRENT_TASK_STAGGER_MS = 2_000;
  private static readonly RECENT_TASK_LAUNCH_WINDOW_MS = 10_000;

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

  constructor(context: vscode.ExtensionContext) { // cockpit-init
    this.extensionCtx = context;
    const storagePaths = resolveScheduleManagerStoragePaths(
      this.extensionCtx.globalStorageUri.fsPath,
      TASK_STORAGE.fileName,
      TASK_STORAGE.metaFileName,
    );
    this.taskStorePath = storagePaths.taskStorePath;
    this.storageMetaFilePath = storagePaths.storageMetaFilePath;
    this.restoreDailyCounter();
    this.restorePersistedTasks();
  }

  private loadTasksFromFile(): { tasks: ScheduledTask[]; ok: boolean } {
    const loaded = readScheduledTasksFromStorageFile(this.taskStorePath);
    if (loaded.error) {
      logDebug("[CopilotScheduler] Failed to load tasks from file:", loaded.error);
    }
    return loaded;
  }

  private async writeTasksToDisk(tasksArray: ScheduledTask[]): Promise<void> {
    await writeScheduledTasksToStorageFile(this.taskStorePath, tasksArray);
  }

  private async saveTasksToGlobalState(storedTasks: ScheduledTask[]): Promise<void> {
    const globalState = this.extensionCtx.globalState;
    await updateMementoWithTimeout(
      globalState,
      TASK_STORAGE.stateKey,
      storedTasks,
      10000,
      messages.storageWriteTimeout(),
    );
  }

  // ────────────────── Guard: Daily Execution Cap ──────────────────

  /**
   * Hydrate the daily execution counter from persisted global state
   */
  private restoreDailyCounter(): void {
    const state = loadDailyExecState(this.extensionCtx.globalState, {
      ...DAILY_EXEC_STATE_KEYS,
    });
    this.todayRunCount = state.count;
    this.todayCountDate = state.date;
    this.limitWarningDate = state.notifiedDate;
  }

  private bumpDailyCounter(date = new Date()): void {
    const state = incrementDailyExecState(
      { count: this.todayRunCount, date: this.todayCountDate },
      date,
    );
    this.todayRunCount = state.count;
    this.todayCountDate = state.date;
  }

  private async saveDailyCounter(): Promise<void> {
    await persistDailyExecState(
      this.extensionCtx.globalState,
      DAILY_EXEC_STATE_KEYS,
      {
        count: this.todayRunCount,
        date: this.todayCountDate,
      },
    );
  }

  async updateTaskPrompts(updates: Array<{ id: string; prompt: string }>): Promise<number> {
    const updateCount = Array.isArray(updates) ? updates.length : 0;
    if (updateCount < 1) {
      return 0;
    }
    const changedCount = applyTaskPromptUpdates(this.taskRegistry, updates, new Date());
    if (changedCount < 1) {
      return 0;
    }
    await this.persistTasks();
    return changedCount;
  }

  async ensureRecurringPromptBackups(): Promise<number> {
    const { metadataChanged } = await this.syncRecurringPromptBackupsInPlace();
    if (metadataChanged < 1) return 0;
    await this.persistTasks({ bumpRevision: false });
    return metadataChanged;
  }

  private async syncRecurringPromptBackupsInPlace(): Promise<{ metadataChanged: number }> {
    return syncRecurringPromptBackupsForTasks(this.taskRegistry.values(), () => this.getPrimaryWorkspaceRoot());
  }

  /**
   * Determine whether the daily execution cap has been hit.
   * @param maxDailyLimit - Precomputed ceiling (0 means no limit). Forwarded from caller to avoid redundant config reads.
   */
  private hasHitDailyLimit(maxDailyLimit: number): boolean {
    if (maxDailyLimit === 0) return false;
    const todayKey = getSchedulerLocalDateKey();
    if (this.todayCountDate !== todayKey) {
      this.todayRunCount = 0;
      this.todayCountDate = todayKey;
    }
    return this.todayRunCount >= maxDailyLimit;
  }

  private computeScheduledNextRun(
    task: ScheduledTask,
    referenceTime: Date,
  ): Date | undefined {
    if (!task.jobId) {
      return this.computeNextExecution(task.cronExpression, referenceTime);
    }

    const jobContext = this.findJobNodeByTaskId(task.id);
    return jobContext
      ? this.getNextRunForJobNode(
          jobContext.job,
          jobContext.nodeIndex,
          referenceTime,
        )
      : this.computeNextExecution(task.cronExpression, referenceTime);
  }

  private refreshTaskNextRunAfterUpdate(
    task: ScheduledTask,
    options: {
      previouslyEnabled: boolean;
      cronChanged: boolean;
      runFirstInOneMinute?: boolean;
      referenceTime: Date;
    },
  ): void {
    if (!task.enabled) {
      task.nextRun = undefined;
      return;
    }

    const { cronChanged, previouslyEnabled, referenceTime, runFirstInOneMinute } =
      options;
    if (task.oneTime === true) {
      const delayedRun = resolveOneTimeDelayNextRun(
        task.oneTimeDelaySeconds,
        referenceTime,
      );
      if (delayedRun) {
        task.nextRun = delayedRun;
        return;
      }
    }

    if (runFirstInOneMinute) {
      task.nextRun = this.floorToMinute(
        new Date(
          referenceTime.getTime() +
            ScheduleManager.INITIAL_TICK_DELAY_MIN * 60 * 1000,
        ),
      );
      return;
    }

    if (cronChanged || !previouslyEnabled || !task.nextRun) {
      task.nextRun = this.computeNextExecution(task.cronExpression, referenceTime);
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
      this.extensionCtx.globalState,
      key,
      value,
      failurePrefix,
    );
  }

  private notifyDailyLimitReachedOnce(
    todayKey: string,
    maxDailyLimit: number,
  ): void {
    this.limitWarningDate = notifyDailyLimitReachedOnce({
      currentNotifiedDate: this.limitWarningDate,
      todayKey,
      maxDailyLimit,
      globalState: this.extensionCtx.globalState,
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
      this.assertValidCron(task.cronExpression);
      return false; // local-diverge-426
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

    const nextRunIsValid =
      task.nextRun instanceof Date && Number.isFinite(task.nextRun.getTime());
    if (nextRunIsValid) {
      return false;
    }

    if (task.oneTime === true) {
      return this.replaceTaskNextRun(
        task,
        resolveOneTimeDelayNextRun(task.oneTimeDelaySeconds, new Date()),
      );
    }

    return this.replaceTaskNextRun(
      task,
      this.computeNextExecution(task.cronExpression, new Date()),
    );
  }

  private armSchedulerInterval(): void {
    this.schedulerInterval = setInterval(() => void this.performSchedulerCycle(), 60 * 1000);
  }

  private syncEnabledTaskState(
    task: ScheduledTask,
    enabled: boolean,
    referenceTime = new Date(),
  ): void {
    setTaskEnabledState(task, enabled, referenceTime, (cronExpression, when) =>
      this.computeNextExecution(cronExpression, when),
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
    void this.persistTasks(options).catch((error) => {
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
    await this.persistTasks();
    return task;
  }

  private async flushSchedulerTicks(): Promise<void> {
    while (true) {
      this.tickCycleQueued = false;
      await this.evaluateAndRunDueTasks();
      if (!this.tickCycleQueued) {
        return;
      }
    }
  }

  // ────────────────── Guard: Minimum Interval Warning ──────────────────

  /**
   * Detect overly-frequent cron intervals and surface a warning when found
   */
  validateMinimumInterval(cronExpression: string): string | undefined {
    return getCronIntervalWarning(
      cronExpression,
      new Date(),
      messages.minimumIntervalWarning(),
      this.getTimeZone(),
    );
  }

  // ────────────────── Guard: Usage Disclaimer ──────────────────

  /**
   * Query whether the usage disclaimer was acknowledged
   */
  hasAcceptedDisclaimer(): boolean {
    return this.extensionCtx.globalState.get<boolean>(DISCLAIMER_ACCEPTED_STATE_KEY, false);
  }

  /**
   * Mark the usage disclaimer as acknowledged
   */
  async storeDisclaimerAcceptance(accepted: boolean): Promise<void> {
    await this.extensionCtx.globalState.update(DISCLAIMER_ACCEPTED_STATE_KEY, accepted);
  }

  /**
   * Register a listener invoked on task mutations
   */
  setOnTasksChangedCallback(callback: () => void): void { this.onTasksChangedCallback = callback; }

  setPostExecutionNotifier(callback: () => void): void {
    this.postExecutionNotifier = callback;
  }

  setOnExecuteCallback(callback: (task: ScheduledTask) => Promise<void>): void {
    this.taskRunCallback = callback;
  }

  /**
   * Emit a task-changed notification
   */
  private emitTaskListChanged(): void {
    if (this.onTasksChangedCallback) {
      this.onTasksChangedCallback();
    }
  }

  /**
   * Public reload method for file watchers
   */
  public reloadTasks(): void {
    this.restorePersistedTasks();
    if (this.onTasksChangedCallback) {
      this.onTasksChangedCallback();
    }
  }

  /**
   * Hydrate the task list from persisted global state
   */
  private restorePersistedTasks(): void {
    const savedTasks = this.extensionCtx.globalState.get<ScheduledTask[]>(
      TASK_STORAGE.stateKey,
      [],
    );
    const diskResult = this.loadTasksFromFile();
    const selection = selectScheduleManagerTaskStore({
      globalState: this.extensionCtx.globalState,
      keys: {
        taskList: TASK_STORAGE.stateKey,
        revision: TASK_STORAGE.revisionKey,
        savedAt: TASK_STORAGE.savedAtKey,
      },
      savedTasks: savedTasks,
      fileLoad: diskResult,
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

    let pendingWrite = false;

    // Rebuild in-memory cache from selected stores on each load.
    // Without clearing first, removed tasks can linger until full window reload.
    this.taskRegistry.clear();
    const loadedTaskIds = new Set<string>();

    for (const task of tasksToLoad) {
      pendingWrite = reviveScheduledTaskDates(task) || pendingWrite;

      const normalizedChatSession = normalizeScheduledTaskChatSession(
        task.chatSession,
        task.oneTime === true,
      );
      if (task.chatSession !== normalizedChatSession) {
        task.chatSession = normalizedChatSession;
        pendingWrite = true;
      }

      const normalizedLabels = normalizeScheduledTaskLabels(task.labels);
      if (
        JSON.stringify(task.labels ?? []) !== JSON.stringify(normalizedLabels ?? [])
      ) {
        task.labels = normalizedLabels;
        pendingWrite = true;
      }

      if (task.jobId && !this.jobs.has(task.jobId)) {
        task.jobId = undefined;
        task.jobNodeId = undefined;
        pendingWrite = true;
      }

      // Schema migration: back-fill absent fields on legacy tasks
      if (!task.scope) task.scope = "global";
      if (
        repairStoredTaskPromptSource(
          task,
          this.getResolvedWorkspaceRoots(),
          getCompatibleConfigurationValue<string>("globalPromptsPath", ""),
        )
      ) {
        pendingWrite = true;
      }

      // Migration: add jitterSeconds if missing
      if (task.jitterSeconds === undefined) {
        task.jitterSeconds = 0;
      }

      pendingWrite = this.disableStoredTaskIfCronInvalid(task) || pendingWrite;
      pendingWrite = this.reconcileLoadedTaskNextRun(task) || pendingWrite;

      this.taskRegistry.set(task.id, task);
      loadedTaskIds.add(task.id);
    }

    if (this.syncJobTaskSchedules(new Date())) {
      pendingWrite = true;
    }

    this.suppressedOverdueTaskIds = new Set(
      Array.from(this.suppressedOverdueTaskIds).filter((id) =>
        loadedTaskIds.has(id),
      ),
    );
    this.retainRecentTaskLaunches(loadedTaskIds);

    // Persist only when mutations occurred
    if (pendingWrite) {
      this.scheduleBackgroundSave("[CopilotScheduler] Failed to save migrated tasks:");
    } else {
      if (selection.shouldHealFile || selection.shouldHealGlobalState) {
        this.scheduleBackgroundSave(
          "[CopilotCockpit] Task store sync failed:",
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

  public waitForSqliteWorkspaceHydration(): Promise<void> {
    return this.sqliteHydrationPromise ?? Promise.resolve();
  }

  private async hydrateWorkspaceTasksFromSqlite(workspaceRoot: string): Promise<void> {
    const sqliteDatabasePath = path.join(
      workspaceRoot,
      ".vscode",
      WORKSPACE_SQLITE_DB_FILE,
    );
    const sqliteAuthorityExists = fs.existsSync(sqliteDatabasePath);
    const sqliteState = this.normalizeWorkspaceSchedulerState(
      await readWorkspaceSchedulerStateFromSqlite(workspaceRoot),
      workspaceRoot,
    );

    if (
      !sqliteAuthorityExists &&
      sqliteState.tasks.length === 0 &&
      sqliteState.jobs.length === 0 &&
      sqliteState.jobFolders.length === 0
    ) {
      return;
    }

    const nextTasks = new Map<string, ScheduledTask>();
    for (const task of this.taskRegistry.values()) {
      if (task.scope !== "workspace") {
        nextTasks.set(task.id, task);
      }
    }
    for (const task of sqliteState.tasks) {
      nextTasks.set(task.id, task);
    }

    this.jobs = new Map(sqliteState.jobs.map((job) => [job.id, job]));
    this.jobFolders = new Map(sqliteState.jobFolders.map((folder) => [folder.id, folder]));

    this.taskRegistry.clear();
    for (const task of nextTasks.values()) {
      reviveScheduledTaskDates(task);
      this.taskRegistry.set(task.id, task);
    }
    this.retainRecentTaskLaunches(nextTasks.keys());

    this.emitTaskListChanged();
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
        const canonicalPromptBackupPath =
          typeof t.promptBackupPath === "string" && t.promptBackupPath.trim().length > 0
            ? getCanonicalPromptBackupPath(workspaceRoot, t.promptBackupPath)
            : undefined;
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
          oneTimeDelaySeconds: normalizeOneTimeDelaySeconds(t.oneTimeDelaySeconds),
          manualSession:
            t.oneTime === true
              ? undefined
              : t.manualSession === true
                ? true
                : undefined,
          nextRun: t.nextRun ? new Date(t.nextRun) : undefined,
          promptSource: t.promptSource || "inline",
          promptPath: t.promptPath,
          promptBackupPath: canonicalPromptBackupPath
            ? toWorkspaceRelativePromptBackupPath(
              workspaceRoot,
              canonicalPromptBackupPath,
            )
            : t.promptBackupPath,
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
   * Flush the task list to persisted global state
   */
  private async persistTasks(options?: { bumpRevision?: boolean }): Promise<void> {
    const queuedSave = this.persistChain.then(() => this.saveTasksInternal(options));
    this.persistChain = queuedSave.catch((error) => {
      logError(
        "[CopilotCockpit] Persist chain recovered from error:",
        toSafeSchedulerErrorDetails(error),
      );
    });
    return queuedSave;
  }

  private async saveTasksAndSyncRecurringPromptBackups(options?: {
    bumpRevision?: boolean; // persist-opt
  }): Promise<void> {
    await this.persistTasks(options);
    await this.ensureRecurringPromptBackups();
  }

  private async saveTasksInternal(
    options?: { bumpRevision?: boolean },
  ): Promise<void> {
    const shouldBump = options?.bumpRevision !== false;
    const tasksArray = [...this.taskRegistry.values()];

    /* --- HBG CUSTOM: Write tasks to .vscode/scheduler.json --- */
    try {
      const workspaceRoot = this.getPrimaryWorkspaceRoot();
      if (workspaceRoot) {
        const existingConfig = readSchedulerConfig(workspaceRoot);

        const diskTasks = tasksArray.filter(t => t.scope === 'workspace').map(t => ({
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
          oneTimeDelaySeconds: t.oneTimeDelaySeconds,
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
          tasks: diskTasks,
          deletedTaskIds: Array.from(new Set([
            ...(Array.isArray(existingConfig.deletedTaskIds)
              ? existingConfig.deletedTaskIds
              : []),
            ...Array.from(this.pendingDeletedTaskIds),
          ])).filter((taskId) => !diskTasks.some((task) => task.id === taskId)),
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
        if (this.isWorkspaceSqliteModeEnabled()) {
          await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, config);
          await exportWorkspaceSqliteToJsonMirrors(
            workspaceRoot,
            this.extensionCtx.globalStorageUri?.fsPath,
          );
        } else {
          writeSchedulerConfig(workspaceRoot, config, {
            baseConfig: existingConfig,
          });
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

    try {
      this.storageRevision = await persistScheduleManagerTaskStore({
        tasksArray: tasksArray,
        bumpRevision: shouldBump,
        currentRevision: this.storageRevision,
        storageMetaFilePath: this.storageMetaFilePath,
        globalState: this.extensionCtx.globalState,
        keys: {
          revision: TASK_STORAGE.revisionKey,
          savedAt: TASK_STORAGE.savedAtKey,
        },
        writeTasksToDisk: (nextTasks) => this.writeTasksToDisk(nextTasks),
        saveTasksToGlobalState: (nextTasks) => this.saveTasksToGlobalState(nextTasks),
        syncGlobalTasksToSqlite:
          this.extensionCtx.globalStorageUri?.fsPath && this.isWorkspaceSqliteModeEnabled()
            ? async () => {
                await syncGlobalTasksToSqlite(
                  this.extensionCtx.globalStorageUri.fsPath,
                  tasksArray,
                );
              }
            : undefined,
        logDebug: logDebug,
        toSafeSchedulerErrorDetails: toSafeSchedulerErrorDetails,
      });
    } finally {
      this.emitTaskListChanged();
    }
  }

  /**
   * Mint a unique task identifier
   */
  private generateId(): string { return this.generateScopedId("task"); }

  /**
   * Resolve the configured IANA timezone
   */
  private getTimeZone(): string | undefined { // tz-resolve
    const tz = getCompatibleConfigurationValue<string>("timezone", "");
    return tz ? tz : undefined;
  }

  /**
   * Derive the upcoming execution instant from a cron expression
   */
  private getNextRun(cronExpression: string, baseTime?: Date): Date | undefined {
    return resolveNextCronRun(
      cronExpression,
      baseTime || new Date(),
      this.getTimeZone(),
      (tz) =>
        logDebug(
          `[CopilotCockpit] Timezone "${tz}" is invalid \u2014 using local time`,
        ),
    );
  }

  private floorToMinute(date: Date): Date {
    return truncateDateToMinute(date);
  }

  private isTaskDueAt(task: ScheduledTask, referenceTime: Date): boolean {
    if (task.enabled === false || !task.nextRun) {
      return false;
    }

    const nextRunMinute = this.floorToMinute(task.nextRun);
    const referenceMinute = this.floorToMinute(referenceTime);
    return nextRunMinute.getTime() <= referenceMinute.getTime();
  }

  private computeNextExecution(cronExpression: string, baseTime: Date): Date {
    const nextRun = this.getNextRun(cronExpression, baseTime);
    if (nextRun) {
      return nextRun;
    }

    const fallbackRun = new Date(baseTime.getTime() + 60 * 60 * 1000);
    logError(`[CopilotScheduler] Failed to parse cron "${cronExpression}"; falling back to +60 min`);
    return this.floorToMinute(fallbackRun);
  }

  /**
   * Assert that a cron expression is syntactically valid
   * @throws when the expression is malformed
   */
  assertValidCron(expression: string): void {
    assertValidCronExpression(
      expression,
      new Date(),
      messages.invalidCronExpression(),
      this.getTimeZone(),
    );
  }

  private assertTaskUpdateInput(
    task: ScheduledTask,
    updates: Partial<CreateTaskInput>, // field-patch
  ): void {
    if (updates.name !== undefined) { // local-diverge-1236
      const nextName = updates.name.trim();
      if (!nextName) throw new Error(messages.taskNameRequired());
    }

    const nextPromptSource = updates.promptSource ?? task.promptSource ?? "inline";
    const inlinePromptCleared =
      updates.prompt !== undefined &&
      nextPromptSource === "inline" &&
      updates.prompt.trim().length === 0;
    if (inlinePromptCleared) throw new Error(messages.promptRequired());
    if (updates.cronExpression !== undefined) this.assertValidCron(updates.cronExpression);
  }

  private createScheduledTaskRecord(
    input: CreateTaskInput,
    params: {
      id: string;
      enabled: boolean;
      resolvedScope: TaskScope;
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
      resolvedScope,
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

    const createdTask: ScheduledTask = {
      prompt: input.prompt, // user-text
      agent: input.agent, // agent-ref
      createdAt: now, // local-diverge-1282
      cronExpression: input.cronExpression,
      enabled,
      id,
      oneTime,
      oneTimeDelaySeconds: oneTime
        ? normalizeOneTimeDelaySeconds(input.oneTimeDelaySeconds)
        : undefined,
      jitterSeconds,
      model: input.model, // llm-model
      name: input.name, // display-label
      nextRun, // local-diverge-1290
      promptPath: input.promptPath, // template-ref
      promptSource: input.promptSource ?? "inline",
      scope: resolvedScope, // local-diverge-1293
      updatedAt: now,
      workspacePath,
      ...sessionState,
    };
    return createdTask;
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
    this.schedulerTimer = undefined; // loop-reset
    void this.performSchedulerCycle();
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
    this.clearRecentTaskLaunch(taskId);
  }

  private snapshotDeleteTaskState(): DeleteTaskStateSnapshot {
    return {
      taskRegistry: new Map(
        [...this.taskRegistry.entries()].map(([taskId, task]) => [taskId, structuredClone(task)]),
      ),
      jobs: new Map(
        [...this.jobs.entries()].map(([jobId, job]) => [jobId, structuredClone(job)]),
      ),
      suppressedOverdueTaskIds: new Set(this.suppressedOverdueTaskIds),
      pendingDeletedTaskIds: new Set(this.pendingDeletedTaskIds),
      recentTaskLaunchTimes: new Map(this.recentTaskLaunchTimes),
    };
  }

  private restoreDeleteTaskState(snapshot: DeleteTaskStateSnapshot): void {
    this.taskRegistry = snapshot.taskRegistry;
    this.jobs = snapshot.jobs;
    this.suppressedOverdueTaskIds = snapshot.suppressedOverdueTaskIds;
    this.pendingDeletedTaskIds = snapshot.pendingDeletedTaskIds;
    this.recentTaskLaunchTimes = snapshot.recentTaskLaunchTimes;
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
    return [...this.taskRegistry.values()].filter(({ enabled }) => enabled);
  }

  private buildDailyLimitSkipOutcome(
    task: ScheduledTask,
    maxDailyLimit: number,
    now: Date,
  ): TaskExecutionOutcome {
    logDebug(
      `[CopilotCockpit] Daily cap (${maxDailyLimit}) hit \u2014 skipping: ${task.name}`,
    );
    this.notifyDailyLimitReachedOnce(getSchedulerLocalDateKey(), maxDailyLimit);
    const rescheduledAt = this.computeScheduledNextRun(task, now);
    task.nextRun = rescheduledAt;
    return { executedCount: 0, pendingWrite: true, deleteTask: false };
  }

  private buildTaskExecutionRetryOutcome(): TaskExecutionOutcome {
    return {
      executedCount: 0,
      pendingWrite: true,
      deleteTask: false,
    };
  }

  private handleSuccessfulTaskExecution(
    task: ScheduledTask,
    completionTime: Date,
  ): TaskExecutionOutcome {
    this.bumpDailyCounter(completionTime);
    task.lastRun = new Date(completionTime.getTime());
    task.lastError = undefined;
    task.lastErrorAt = undefined;
    this.handleSuccessfulJobTaskExecution(task, completionTime);
    this.syncJobTaskSchedules(completionTime);

    if (this.isOneTimeExecutionTask(task)) {
      return { executedCount: 1, pendingWrite: true, deleteTask: true };
    }

    task.nextRun = this.computeScheduledNextRun(task, new Date());
    return { executedCount: 1, pendingWrite: true, deleteTask: false };
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
    task.nextRun = this.floorToMinute(new Date(now.getTime() + 60 * 1000));
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
    const deleted = this.taskRegistry.delete(taskId);
    if (!deleted) {
      return false;
    }

    this.clearTaskSchedulingState(taskId);
    this.syncJobTaskSchedules(new Date());
    await this.persistTasks();
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
    this.schedulerTimer = setTimeout(
      () => this.beginAlignedSchedulerLoop(),
      delayUntilNextMinute,
    );
  }

  private logSchedulerTickFailure(error: unknown): void {
    logError(
      "[CopilotCockpit] Scheduler cycle error:",
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
    const maxDailyLimit = /* daily-cap */
      normalizedDailyLimit === 0
        ? 0
        : Math.min(Math.max(normalizedDailyLimit, 1), 100);

    return { defaultJitterSeconds, maxDailyLimit };
  }

  private shouldSkipScheduledTask(task: ScheduledTask): boolean {
    if (task.enabled !== true || !task.nextRun) {
      return true;
    }
    if (this.isTaskSuppressedByJob(task)) {
      return true;
    }
    if (!this.isTaskBoundToThisWorkspace(task)) {
      return true;
    }
    return this.suppressedOverdueTaskIds.has(task.id);
  }

  private tryBeginTaskExecution(taskId: string): boolean {
    if (this.activeTaskExecutionIds.has(taskId)) {
      return false;
    }

    this.activeTaskExecutionIds.add(taskId);
    return true;
  }

  private finishTaskExecution(taskId: string): void {
    this.activeTaskExecutionIds.delete(taskId);
  }

  private hasRecentTaskLaunch(taskId: string, nowMs = Date.now()): boolean {
    const launchedAtMs = this.recentTaskLaunchTimes.get(taskId);
    if (launchedAtMs === undefined) {
      return false;
    }

    if (
      nowMs - launchedAtMs >= ScheduleManager.RECENT_TASK_LAUNCH_WINDOW_MS
    ) {
      this.recentTaskLaunchTimes.delete(taskId);
      return false;
    }

    return true;
  }

  private markRecentTaskLaunch(taskId: string, nowMs = Date.now()): void {
    this.recentTaskLaunchTimes.set(taskId, nowMs);
  }

  private clearRecentTaskLaunch(taskId: string): void {
    this.recentTaskLaunchTimes.delete(taskId);
  }

  private retainRecentTaskLaunches(taskIds: Iterable<string>): void {
    const retainedTaskIds = new Set(taskIds);
    this.recentTaskLaunchTimes = new Map(
      Array.from(this.recentTaskLaunchTimes.entries()).filter(([taskId]) =>
        retainedTaskIds.has(taskId),
      ),
    );
  }

  private async executeDueTask(
    task: ScheduledTask,
    now: Date,
    nowMinute: Date,
    maxDailyLimit: number,
    defaultJitterSeconds: number,
  ): Promise<TaskExecutionOutcome> {
    let currentTask = this.findStoredTask(task.id) ?? task;

    if (!this.isTaskDueAt(currentTask, nowMinute)) {
      return { executedCount: 0, pendingWrite: false, deleteTask: false };
    }

    if (this.hasHitDailyLimit(maxDailyLimit)) {
      return this.buildDailyLimitSkipOutcome(currentTask, maxDailyLimit, now);
    }

    if (!this.tryBeginTaskExecution(currentTask.id)) {
      return { executedCount: 0, pendingWrite: false, deleteTask: false };
    }

    try {
      if (this.hasRecentTaskLaunch(currentTask.id)) {
        return { executedCount: 0, pendingWrite: false, deleteTask: false };
      }

      const appliedJitter = (currentTask.jitterSeconds ?? defaultJitterSeconds); // jitter-window
      await applyScheduleJitter(appliedJitter);

      const executeTask = this.taskRunCallback;
      if (executeTask) {
        this.markRecentTaskLaunch(currentTask.id);
        let didLaunchTask = false;
        try {
          await executeTask(currentTask);
          didLaunchTask = true;
          currentTask = this.findStoredTask(currentTask.id) ?? currentTask;
          return this.handleSuccessfulTaskExecution(currentTask, new Date());
        } catch (error) {
          if (!didLaunchTask) {
            this.clearRecentTaskLaunch(currentTask.id);
          }
          currentTask = this.findStoredTask(currentTask.id) ?? currentTask;
          return this.handleFailedTaskExecution(currentTask, error, now);
        }
      }

      currentTask = this.findStoredTask(currentTask.id) ?? currentTask;
      currentTask.nextRun = this.floorToMinute(new Date(now.getTime() + 60 * 1000));
      return this.buildTaskExecutionRetryOutcome();
    } finally {
      this.finishTaskExecution(currentTask.id);
    }
  }

  private applyScheduledTaskDeletions(taskIds: readonly string[]): void {
    for (const taskId of taskIds) {
      this.taskRegistry.delete(taskId);
      this.clearTaskSchedulingState(taskId);
    }
  }

  private async persistDailyExecCountSafely(runCount: number): Promise<void> {
    if (runCount <= 0) {
      return;
    }

    try {
      const persistDailyCount = this.saveDailyCounter.bind(this);
      await persistDailyCount();
    } catch (error) {
      const failureDetails = toSafeSchedulerErrorDetails(error);
      logError(
        "[CopilotCockpit] Could not write daily run counter:",
        failureDetails,
      );
    }
  }

  private findStoredTask(id: string): ScheduledTask | undefined {
    return this.taskRegistry.get(id);
  }

  private generateScopedId(prefix: string): string {
    const nowMs = Date.now();
    const suffix = Math.random().toString(36).substring(2, 8);
    return `${prefix}_${nowMs}_${suffix}`;
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
      const task = this.taskRegistry.get(node.taskId);
      if (this.hasTaskExecutedSince(task, segmentBase)) {
        return undefined;
      }

      return this.floorToMinute(
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
      const previousCandidate = this.floorToMinute(
        new Date(previousBase.getTime() + offsetMinutes * 60 * 1000),
      );
      if (previousCandidate.getTime() > referenceTime.getTime()) {
        return previousCandidate;
      }
    }

    const nextBase = this.computeNextExecution(job.cronExpression, referenceTime);
    return this.floorToMinute(
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
        const task = this.taskRegistry.get(node.taskId);
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
  async createTask(input: CreateTaskInput): Promise<ScheduledTask> { // public-api
    const trimmedName = input.name?.trim();
    const trimmedPrompt = input.prompt?.trim();
    const promptSource = input.promptSource ?? "inline";
    if (!trimmedName) throw new Error(messages.taskNameRequired());
    if (promptSource === "inline" && !trimmedPrompt) {
      throw new Error(messages.promptRequired());
    }
    this.assertValidCron(input.cronExpression);

    const now = new Date();
    const id = this.generateId(); // unique-key

    // Pull default values from the active configuration
    const defaultScope = getCompatibleConfigurationValue<TaskScope>(
      "defaultScope",
      "workspace",
    );
    const defaultJitter = clampScheduleJitterSeconds(
      getCompatibleConfigurationValue<number>("jitterSeconds", 0),
    );

    const isActive = input.enabled !== false;
    const resolvedScope = input.scope || defaultScope;
    const oneTime = input.oneTime ?? id.startsWith("exec-");
    const workspacePath =
      resolvedScope === "workspace"
        ? this.getPrimaryWorkspaceRoot()
        : undefined;
    const jitterSeconds =
      input.jitterSeconds != null
        ? clampScheduleJitterSeconds(input.jitterSeconds)
        : defaultJitter;
    const nextRun = resolveCreatedTaskNextRun({
      enabled: isActive,
      oneTime,
      oneTimeDelaySeconds: input.oneTimeDelaySeconds,
      runFirstInOneMinute: input.runFirstInOneMinute,
      now,
      firstRunDelayMinutes: ScheduleManager.INITIAL_TICK_DELAY_MIN,
      cronExpression: input.cronExpression,
      floorToMinute: (date) => this.floorToMinute(date),
      getNextRun: (cronExpression, referenceTime) =>
        this.computeNextExecution(cronExpression, referenceTime),
    });

    const task = this.createScheduledTaskRecord(input, {
      id,
      enabled: isActive,
      resolvedScope,
      workspacePath,
      jitterSeconds,
      oneTime,
      nextRun,
      now,
    });

    this.taskRegistry.set(id, task);
    await this.saveTasksAndSyncRecurringPromptBackups();

    return task;
  }

  /**
   * Get a task by ID
   */
  getTask(taskId: string): ScheduledTask | undefined {
    return this.taskRegistry.get(taskId);
  }

  getOverdueTasks(referenceTime = new Date()): ScheduledTask[] {
    return Array.from(this.taskRegistry.values()).filter((task) => {
      if (this.suppressedOverdueTaskIds.has(task.id)) {
        return false;
      }

      return (
        this.isTaskBoundToThisWorkspace(task) &&
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
    const task = this.taskRegistry.get(id);
    if (!task || !task.enabled || this.isOneTimeExecutionTask(task)) {
      return false;
    }

    task.nextRun = this.computeNextExecution(task.cronExpression, referenceTime);
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(id);
    await this.persistTasks();
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

    const task = this.taskRegistry.get(id);
    if (!task || !task.enabled) {
      return false;
    }

    task.nextRun = this.floorToMinute(
      new Date(referenceTime.getTime() + delayMinutes * 60 * 1000),
    );
    task.updatedAt = new Date();
    this.suppressedOverdueTaskIds.delete(id);
    await this.persistTasks();
    return true;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ScheduledTask[] { // enumerate
    return [...this.taskRegistry.values()];
  }

  async removeLabelFromAllTasks(labelName: string): Promise<number> {
    const key = String(labelName || "").trim().toLowerCase();
    if (!key) {
      return 0;
    }

    let changedCount = 0;
    const timestamp = new Date();
    for (const task of this.taskRegistry.values()) {
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
      await this.persistTasks();
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
    if (!input.name?.trim()) {
      throw new Error(messages.taskNameRequired());
    }

    this.assertValidCron(input.cronExpression);

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
    await this.persistTasks();
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

    if (typeof updates.name === "string") {
      const nextName = updates.name.trim();
      if (!nextName) {
        throw new Error(messages.taskNameRequired());
      }
      job.name = nextName;
    }

    if (updates.cronExpression !== undefined) {
      this.assertValidCron(updates.cronExpression);
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
    await this.persistTasks();
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
      const task = this.taskRegistry.get(node.taskId);
      if (!task) {
        continue;
      }

      task.jobId = undefined;
      task.jobNodeId = undefined;
      task.nextRun = task.enabled
        ? this.computeNextExecution(task.cronExpression, new Date())
        : undefined;
    }

    this.jobs.delete(id);
    this.pendingDeletedJobIds.add(id);
    await this.persistTasks();
    return true;
  }

  async duplicateJob(id: string): Promise<JobDefinition | undefined> {
    const original = this.jobs.get(id);
    if (original == null) {
      return undefined;
    }

    const duplicate = await this.createJob({
      name: `${original.name} ${messages.taskCopySuffix()}`, /* clone-label */
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

      const originalTask = this.taskRegistry.get(node.taskId);
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
    await this.persistTasks();
    return job;
  }

  async createJobFolder(input: CreateJobFolderInput): Promise<JobFolder> {
    if (!input.name?.trim()) { // folder-name
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
    await this.persistTasks();
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

    if (typeof updates.name === "string") { // rename-check
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
    await this.persistTasks();
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
    await this.persistTasks();
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
    await this.persistTasks();
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
    await this.persistTasks();
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
    runtime.currentSegmentStartedAt = this.floorToMinute(new Date()).toISOString();
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.persistTasks();
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
    return this.taskRegistry.get(task.id);
  }

  async attachTaskToJob(
    jobId: string,
    taskId: string,
    windowMinutes = 30,
  ): Promise<JobDefinition | undefined> {
    const job = this.jobs.get(jobId);
    let task = this.taskRegistry.get(taskId);
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
    await this.persistTasks();
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
    const task = this.isTaskNode(node) ? this.taskRegistry.get(node.taskId) : undefined;
    if (task) {
      task.jobId = undefined;
      task.jobNodeId = undefined;
      task.nextRun = task.enabled
        ? this.computeNextExecution(task.cronExpression, new Date())
        : undefined;
      task.updatedAt = new Date();
    }

    this.clearJobRuntime(job);
    job.updatedAt = new Date().toISOString();
    this.syncJobTaskSchedules(new Date());
    await this.persistTasks();
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
    await this.persistTasks();
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
    await this.persistTasks();
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

      const task = this.taskRegistry.get(node.taskId);
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
    await this.persistTasks();

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
    const op = this.persistChain.then(() =>
      this.restoreWorkspaceScheduleHistoryInternal(snapshotId),
    );
    this.persistChain = op
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
    this.restorePersistedTasks();
    this.emitTaskListChanged();
    return true; // local-diverge-2781
  }

  async recomputeAllSchedules(): Promise<void> {
    const now = new Date();
    let didChange = false;
    const enabledTasks = this.getEnabledTaskArray();
    for (const task of enabledTasks) {
      const nextRun = this.computeScheduledNextRun(task, now);
      didChange = this.replaceTaskNextRun(task, nextRun) || didChange;
    }
    if (!didChange) {
      return;
    }
    await this.persistTasks();
  }

  public queryTasksByScope(scope: TaskScope): ScheduledTask[] {
    return this.getAllTasks().filter((t) => t.scope === scope);
  }

  async updateTask(taskId: string, updates: Partial<CreateTaskInput>): Promise<ScheduledTask | undefined> {
    const task = this.findStoredTask(taskId);
    if (task === undefined) return undefined;
    this.assertTaskUpdateInput(task, updates);

    const now = new Date();
    const previouslyEnabled = Boolean(task.enabled);
    const { cronChanged } = applyTaskUpdatesToTask({
      task,
      updates,
      ...this.createTaskUpdateContext(),
    });

    this.refreshTaskNextRunAfterUpdate(task, {
      previouslyEnabled,
      cronChanged,
      runFirstInOneMinute: updates.runFirstInOneMinute,
      referenceTime: now,
    });
    await this.finalizeTaskUpdate(task, taskId, now);
    return task;
  }

  async deleteTask(id: string): Promise<boolean> { // public-api
    const snapshot = this.snapshotDeleteTaskState();

    try {
      this.unlinkTaskFromOwningJob(id);
      return await this.deleteTaskAndPersist(id);
    } catch (error) {
      this.restoreDeleteTaskState(snapshot);
      throw error;
    }
  }

  async toggleTask(id: string): Promise<ScheduledTask | undefined> { // public-api
    const task = this.findStoredTask(id);
    if (task === undefined) return undefined;
    return this.persistEnabledTaskChange(task, !task.enabled);
  }

  async setTaskEnabled(taskId: string, enabled: boolean): Promise<ScheduledTask | undefined> {
    const task = this.findStoredTask(taskId);
    if (task === undefined) return undefined;
    return this.persistEnabledTaskChange(task, enabled);
  }

  async duplicateTask(id: string): Promise<ScheduledTask | undefined> { // public-api
    const original = this.findStoredTask(id);
    if (original === undefined) return undefined;
    return this.createTask(createDuplicateTaskInput(original, messages.taskCopySuffix()));
  }

  async moveTaskToCurrentWorkspace(taskId: string): Promise<ScheduledTask | undefined> {
    const task = this.findStoredTask(taskId);
    if (task === undefined) return undefined;

    if (task.scope !== "workspace") {
      throw new Error(messages.moveOnlyWorkspaceTasks()); // scope-guard
    }

    const workspaceRoot = this.resolveCurrentWorkspaceRootOrThrow();
    this.updateTaskWorkspacePath(task, workspaceRoot);
    await this.saveTasksAndSyncRecurringPromptBackups();
    return task;
  }

  isTaskBoundToThisWorkspace(task: ScheduledTask): boolean {
    if (task.scope !== "workspace") {
      return true; // local-diverge-2864
    }

    const taskWorkspaceKey = this.getScheduledTaskWorkspaceKey(task);
    if (taskWorkspaceKey.length === 0) {
      return false;
    }

    const openWorkspaceKeys = this.getResolvedWorkspaceRoots().map((workspacePath) => {
      return normalizeForCompare(workspacePath);
    });
    return openWorkspaceKeys.includes(taskWorkspaceKey);
  }

  startScheduler(onExecute: (task: ScheduledTask) => Promise<void>): void { // lifecycle
    this.setOnExecuteCallback(onExecute);
    this.stopScheduler(); // reset-first
    this.scheduleAlignedSchedulerStart();
  }

  private async performSchedulerCycle(): Promise<void> {
    if (this.tickCycleRunning !== false) {
      this.tickCycleQueued = true;
      return;
    }

    const markTickRunning = (): void => {
      this.tickCycleRunning = true;
    };
    markTickRunning();
    try {
      await this.flushSchedulerTicks();
    } catch (error) {
      this.logSchedulerTickFailure(error);
    } finally {
      this.tickCycleRunning = false;
    }
  }

  public stopScheduler(): void {
    this.schedulerTimer = clearScheduledHandle(
      this.schedulerTimer,
      clearTimeout,
    );
    this.schedulerInterval = clearScheduledHandle(
      this.schedulerInterval,
      clearInterval,
    );
    this.tickCycleQueued = false;
  }

  /**
   * Helper to identify one-time execution tasks.
   * Prefer explicit `oneTime` flag; keep `exec-` id fallback for backward compatibility.
   */
  private isOneTimeExecutionTask(task: ScheduledTask): boolean {
    return task.oneTime === true || task.id.startsWith("exec-");
  }

  /**
   * Evaluate pending tasks and dispatch any that are overdue
   */
  private async evaluateAndRunDueTasks(): Promise<void> {
    if (!getCompatibleConfigurationValue<boolean>("enabled", true)) {
      return;
    }

    const now = new Date();
    const nowMinute = this.floorToMinute(now);
    const { maxDailyLimit, defaultJitterSeconds } = this.getSchedulerTickSettings();

    let pendingWrite = false;
    let completedRuns = 0;
    const tasksToDelete: string[] = [];
    const scheduledTaskIds = Array.from(this.taskRegistry.keys());
    const dueTaskEntries: Array<{ task: ScheduledTask; staggerMs: number }> = [];
    let staggerMs = 0;

    // Snapshot task ids so watcher-triggered reloads cannot repopulate the live map
    // and revisit the same due task again inside a single scheduler cycle.
    for (const taskId of scheduledTaskIds) {
      const task = this.taskRegistry.get(taskId);
      if (!task) {
        continue;
      }

      if (this.shouldSkipScheduledTask(task)) {
        continue;
      }

      if (!this.isTaskDueAt(task, nowMinute)) {
        continue;
      }

      dueTaskEntries.push({ task, staggerMs });
      staggerMs += ScheduleManager.CONCURRENT_TASK_STAGGER_MS;
    }

    const settledOutcomes = await Promise.allSettled(
      dueTaskEntries.map(({ task, staggerMs: launchDelayMs }) =>
        (launchDelayMs > 0
          ? new Promise<void>((resolve) => setTimeout(resolve, launchDelayMs))
          : Promise.resolve()
        ).then(() =>
          this.executeDueTask(
            task,
            now,
            nowMinute,
            maxDailyLimit,
            defaultJitterSeconds,
          ).then((outcome) => ({ taskId: task.id, outcome })),
        ),
      ),
    );

    for (const result of settledOutcomes) {
      if (result.status === "fulfilled") {
        const { taskId, outcome } = result.value;
        completedRuns += outcome.executedCount;
        pendingWrite = outcome.pendingWrite || pendingWrite;
        if (outcome.deleteTask) {
          tasksToDelete.push(taskId);
        }
        continue;
      }

      logError(
        "[CopilotCockpit] Unexpected error in concurrent task execution:",
        toSafeSchedulerErrorDetails(result.reason),
      );
      pendingWrite = true;
    }

    this.applyScheduledTaskDeletions(tasksToDelete);
    await this.persistDailyExecCountSafely(completedRuns);

    if (pendingWrite) {
      await this.persistTasks();
      if (completedRuns > 0) {
        this.postExecutionNotifier?.();
      }
    }
  }

  private handleSuccessfulJobTaskExecution(
    task: ScheduledTask,
    completionTime: Date,
  ): void {
    const jobContext = this.findJobNodeByTaskId(task.id);
    if (!jobContext) {
      return;
    }

    const runtime = this.getWorkingRuntimeState(jobContext.job);
    const cycleStart =
      this.parseIsoDate(runtime.cycleStartedAt) ||
      this.getPreviousCronOccurrence(jobContext.job.cronExpression, completionTime) ||
      this.floorToMinute(completionTime);
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
        activatedAt: completionTime.toISOString(),
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
   * Trigger immediate task execution (bypass schedule)
   */
  async runTaskNow(id: string): Promise<boolean> { // manual-run
    const task = this.taskRegistry.get(id);
    if (!task || !this.taskRunCallback) {
      return false;
    }

    if (this.isTaskSuppressedByJob(task)) {
      return false;
    }

    if (!this.tryBeginTaskExecution(task.id)) {
      return false;
    }

    let didLaunchTask = false;
    try {
      if (this.hasRecentTaskLaunch(task.id)) {
        return false;
      }

      this.markRecentTaskLaunch(task.id);
      await this.taskRunCallback(task); // invoke
      didLaunchTask = true;

      // Refresh lastRun / nextRun timestamps following a manual invocation
      const completionTime = new Date(); // completion-stamp
      task.lastRun = completionTime; // local-diverge-3030
      task.lastError = undefined;
      task.lastErrorAt = undefined;
      this.handleSuccessfulJobTaskExecution(task, completionTime);
      this.syncJobTaskSchedules(completionTime);
      if (this.isOneTimeExecutionTask(task)) {
        this.taskRegistry.delete(task.id);
        this.clearTaskSchedulingState(task.id);
      } else if (task.enabled) {
        task.nextRun = this.computeScheduledNextRun(task, completionTime);
        this.suppressedOverdueTaskIds.delete(task.id);
      }
      await this.persistTasks();
      this.postExecutionNotifier?.();

      return true;
    } catch (error) {
      if (!didLaunchTask) {
        this.clearRecentTaskLaunch(task.id);
      }
      logError( // local-diverge-3047
        "[CopilotScheduler] runTaskNow failed:",
        toSafeSchedulerErrorDetails(error),
      );
      task.lastError = toSafeSchedulerErrorDetails(error);
      task.lastErrorAt = new Date();
      await this.persistTasks();
      return false;
    } finally {
      this.finishTaskExecution(task.id);
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

      return this.normalizeWorkspaceSchedulerState(config, workspaceRoot);
    } catch (e) {
      console.error('Failed to load tasks from scheduler.json:', e);
      return { tasks: [], jobs: [], jobFolders: [] };
    }
  }
}
