/**
 * Copilot Cockpit - Extension Entry Point
 * Registers commands, initializes components, and starts the scheduler
 */

import * as vscode from "vscode";
import * as path from "path";
import { ScheduleManager } from "./scheduleManager";
import { CopilotExecutor } from "./copilotExecutor";
import { ResearchManager } from "./researchManager";
import { ScheduledTaskTreeProvider, ScheduledTaskItem } from "./treeProvider";
import { SchedulerWebview } from "./schedulerWebview";
import { messages } from "./i18n";
import { logDebug, logError } from "./logger";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { createDefaultCockpitBoard, normalizeCockpitBoard } from "./cockpitBoard";
import {
  addCockpitTodoComment,
  addCockpitSection,
  approveCockpitTodo,
  createCockpitTodo,
  deleteCockpitSection,
  ensureTaskTodos,
  ensureTaskTodosInBoard,
  finalizeCockpitTodo,
  moveCockpitSection,
  moveCockpitTodo,
  purgeCockpitTodo,
  rejectCockpitTodo,
  renameCockpitSection,
  reorderCockpitSection,
  deleteCockpitTodoLabelDefinition,
  saveCockpitTodoLabelDefinition,
  saveCockpitFlagDefinition,
  deleteCockpitFlagDefinition,
  setCockpitBoardPersistenceHooks,
  setCockpitBoardFilters,
  updateCockpitTodo,
} from "./cockpitBoardManager";
import {
  readSchedulerConfig,
  getResolvedWorkspaceRoots,
  setSchedulerConflictNotifier,
  wasSchedulerConfigWrittenRecently,
} from "./schedulerJsonSanitizer";
import { ensurePrivateConfigIgnoredForWorkspaceRoots } from "./privateConfigIgnore";
import {
  type BundledSkillSyncResult,
  type BundledSkillSyncState,
  previewBundledSkillSyncForWorkspaceRoots,
  syncBundledSkillsForWorkspaceRoots,
} from "./skillBootstrap";
import {
  affectsCompatibleConfiguration,
  COCKPIT_TASKS_VIEW_ID,
  getCockpitCommandId,
  getCompatibleConfigurationValue,
  getLegacySchedulerCommandId,
  type SchedulerCommandName,
  updateCompatibleConfigurationValue,
} from "./extensionCompat";
import {
  bootstrapConfiguredSqliteStorage,
  bootstrapGlobalSqliteStorage,
  bootstrapWorkspaceSqliteStorage,
  exportWorkspaceSqliteToJsonMirrors,
  readWorkspaceCockpitBoardFromSqlite,
  syncWorkspaceCockpitBoardToSqlite,
} from "./sqliteBootstrap";
import {
  getTelegramNotificationView,
  saveTelegramNotificationConfig,
  sendTelegramNotificationTest,
} from "./telegramNotificationManager";
import {
  ensureWorkspaceMcpSupportFiles,
  type SchedulerMcpSetupState,
  getSchedulerMcpSetupState,
  upsertSchedulerMcpConfig,
} from "./mcpConfigManager";
import {
  normalizeForCompare,
  resolveGlobalPromptPath,
  resolveLocalPromptPath,
  resolveGlobalPromptsRoot,
} from "./promptResolver";
import {
  handleTodoCockpitAction,
  isTodoCockpitAction,
} from "./todoCockpitActionHandler";
import type {
  AddCockpitTodoCommentInput,
  CockpitBoard,
  CreateCockpitTodoInput,
  ScheduledTask,
  CreateTaskInput,
  CreateResearchProfileInput,
  StorageSettingsView,
  TaskAction,
  ExecutionDefaultsView,
  PromptSource,
  UpdateCockpitBoardFiltersInput,
} from "./types";

type NotificationMode = "sound" | "silentToast" | "silentStatus";

const BUNDLED_SKILL_SYNC_STATE_KEY = "bundledSkillSyncState";
const LAST_MCP_SUPPORT_UPDATE_MAP_KEY = "lastMcpSupportUpdateByWorkspace";
const LAST_BUNDLED_SKILLS_SYNC_MAP_KEY = "lastBundledSkillsSyncByWorkspace";
const SCHEDULER_WATCHER_DEBOUNCE_MS = 150;
const SCHEDULER_WATCHER_SUPPRESSION_MS = 1500;
const SCHEDULER_UI_REFRESH_DEBOUNCE_MS = 50;

const PROMPT_SYNC_DATE_KEY = "promptSyncDate";
const PROMPT_BACKUP_SYNC_MONTH_KEY = "promptBackupSyncMonth";
const LAST_VERSION_KEY = "lastKnownVersion";

type WorkspaceSupportRepairPlan = {
  mcpRootsNeedingRepair: string[];
  autoRepairMcpRoots: string[];
  promptMcpRoots: string[];
  shouldRefreshBundledSkills: boolean;
  shouldAutoRepair: boolean;
  needsPrompt: boolean;
};

type WorkspaceTimestampMap = Record<string, string>;

function getSchedulerSetting<T>(
  key: string,
  defaultValue: T,
  scope?: vscode.ConfigurationScope,
): T {
  return getCompatibleConfigurationValue<T>(key, defaultValue, scope);
}

async function updateSchedulerSetting(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
  scope?: vscode.ConfigurationScope,
): Promise<void> {
  await updateCompatibleConfigurationValue(key, value, target, scope);
}

function registerSchedulerCommand(
  name: SchedulerCommandName,
  callback: (...args: any[]) => unknown,
): vscode.Disposable {
  const cockpitCommandId = getCockpitCommandId(name);

  return vscode.Disposable.from(
    vscode.commands.registerCommand(cockpitCommandId, callback),
    vscode.commands.registerCommand(
      getLegacySchedulerCommandId(name),
      (...args: unknown[]) =>
        vscode.commands.executeCommand(cockpitCommandId, ...args),
    ),
  );
}

function sanitizeErrorDetailsForLog(message: string): string {
  return sanitizeAbsolutePathDetails(message);
}

function shouldNotify(): boolean {
  return getSchedulerSetting<boolean>("showNotifications", true);
}

function getNotificationMode(): NotificationMode {
  const mode = getSchedulerSetting<NotificationMode>("notificationMode", "sound");
  // Legacy: if notifications were disabled, honor that as silentStatus
  if (getSchedulerSetting<boolean>("showNotifications", true) === false) {
    return "silentStatus";
  }
  return mode || "sound";
}

async function maybeWarnCronInterval(cronExpression?: string): Promise<void> {
  if (!cronExpression) return;
  const enabled = getSchedulerSetting<boolean>("minimumIntervalWarning", true);
  if (!enabled) return;
  const warning = scheduleManager.checkMinimumInterval(cronExpression);
  if (warning) {
    // Non-blocking warning: do not stall create/update until the user dismisses
    void vscode.window.showInformationMessage(warning);
  }
}

async function maybeShowDisclaimerOnce(task: ScheduledTask): Promise<void> {
  if (!task.enabled) return;
  if (scheduleManager.isDisclaimerAccepted()) return;
  const choice = await vscode.window.showInformationMessage(
    messages.disclaimerMessage(),
    messages.disclaimerAccept(),
    messages.disclaimerDecline(),
  );
  if (choice !== messages.disclaimerAccept()) {
    return;
  }
  await scheduleManager.setDisclaimerAccepted(true);
}

async function syncPromptTemplatesIfNeeded(
  context: vscode.ExtensionContext,
  force = false,
): Promise<void> {
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (!force) {
    const last = context.globalState.get<string>(PROMPT_SYNC_DATE_KEY, "");
    if (last === todayKey) {
      return;
    }
  }

  const tasks = scheduleManager.getAllTasks();
  const promptUpdates: Array<{ id: string; prompt: string }> = [];

  for (const task of tasks) {
    if (task.promptSource === "inline") continue;
    if (!task.promptPath) continue;
    try {
      // Background sync should only read persisted file contents.
      const latest = await resolvePromptText(task, false);
      if (latest && latest !== task.prompt) {
        // Avoid syncing empty prompts (would break validation and UX)
        if (latest.trim()) {
          promptUpdates.push({ id: task.id, prompt: latest });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error ?? "");
      logError(
        `[CopilotScheduler] Prompt sync failed for task "${task.name}": ${sanitizeErrorDetailsForLog(errorMessage)}`,
      );
    }
  }

  const updated =
    promptUpdates.length > 0
      ? (await scheduleManager.updateTaskPrompts(promptUpdates)) > 0
      : false;

  if (updated) {
    SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
    // treeProvider.refresh() is already triggered by updateTaskPrompts → saveTasks → notifyTasksChanged callback.
  }

  await context.globalState.update(PROMPT_SYNC_DATE_KEY, todayKey);
}

async function syncRecurringPromptBackupsIfNeeded(
  context: vscode.ExtensionContext,
  force = false,
): Promise<void> {
  const now = new Date();
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  if (!force) {
    const last = context.globalState.get<string>(
      PROMPT_BACKUP_SYNC_MONTH_KEY,
      "",
    );
    if (last === monthKey) {
      return;
    }
  }

  const updated = await scheduleManager.ensureRecurringPromptBackups();

  if (updated > 0) {
    SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
  }

  await context.globalState.update(PROMPT_BACKUP_SYNC_MONTH_KEY, monthKey);
}

async function ensureSchedulerSkillOnStartup(
  context: vscode.ExtensionContext,
): Promise<void> {
  const workspaceRoots = getResolvedWorkspaceRoots(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
  );
  if (workspaceRoots.length === 0) {
    return;
  }

  ensurePrivateConfigIgnoredForWorkspaceRoots(workspaceRoots);
}

async function syncBundledSkills(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
): Promise<BundledSkillSyncResult> {
  const syncState = context.globalState.get<BundledSkillSyncState>(
    BUNDLED_SKILL_SYNC_STATE_KEY,
    {},
  );
  const syncResult = await syncBundledSkillsForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
    syncState,
  );
  await context.globalState.update(
    BUNDLED_SKILL_SYNC_STATE_KEY,
    syncResult.nextState,
  );
  if (syncResult.createdPaths.length > 0 || syncResult.updatedPaths.length > 0) {
    await updateWorkspaceTimestampMap(
      context,
      LAST_BUNDLED_SKILLS_SYNC_MAP_KEY,
      workspaceRoots,
    );
  }
  return syncResult;
}

async function updateWorkspaceTimestampMap(
  context: vscode.ExtensionContext,
  key: string,
  workspaceRoots: string[],
): Promise<void> {
  if (workspaceRoots.length === 0) {
    return;
  }

  const next = {
    ...context.globalState.get<WorkspaceTimestampMap>(key, {}),
  };
  const timestamp = new Date().toISOString();
  for (const workspaceRoot of workspaceRoots) {
    next[workspaceRoot] = timestamp;
  }
  await context.globalState.update(key, next);
}

function getWorkspaceTimestamp(
  key: string,
  workspaceRoot: string | undefined,
): string {
  if (!workspaceRoot || !extensionContext) {
    return "";
  }

  const map = extensionContext.globalState.get<WorkspaceTimestampMap>(key, {});
  return typeof map[workspaceRoot] === "string" ? map[workspaceRoot] : "";
}

function getCurrentMcpSetupStatus(): StorageSettingsView["mcpSetupStatus"] {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot || !extensionContext) {
    return "workspace-required";
  }

  return getSchedulerMcpSetupState(
    workspaceRoot,
    extensionContext.extensionUri.fsPath,
  ).status;
}

export function notifyInfo(message: string, timeoutMs = 4000): void {
  if (!shouldNotify()) return;
  const mode = getNotificationMode();
  switch (mode) {
    case "silentStatus":
      vscode.window.setStatusBarMessage(message, timeoutMs);
      break;
    case "silentToast":
      void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: message },
        () => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      );
      break;
    default:
      void vscode.window.showInformationMessage(message);
  }
}

export function notifyError(message: string, timeoutMs = 6000): void {
  const safeMessage = sanitizeErrorDetailsForLog(message);
  const displayMessage = safeMessage || messages.webviewUnknown() || "";
  const mode = getNotificationMode();
  if (mode === "silentStatus") {
    vscode.window.setStatusBarMessage(`⚠ ${displayMessage}`, timeoutMs);
    logError(displayMessage);
    return;
  }
  if (mode === "silentToast") {
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `⚠ ${displayMessage}`,
      },
      () => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    );
    logError(displayMessage);
    return;
  }
  void vscode.window.showErrorMessage(displayMessage);
}

// Global instances
let scheduleManager: ScheduleManager;
let copilotExecutor: CopilotExecutor;
let researchManager: ResearchManager;
let treeProvider: ScheduledTaskTreeProvider;
let promptSyncInterval: ReturnType<typeof setInterval> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let currentCockpitBoard: CockpitBoard | undefined;
let currentCockpitBoardWorkspaceRoot: string | undefined;
let cockpitBoardSqliteHydrationPromise: Promise<void> | undefined;
let hasPromptedForMcpSetupThisSession = false;
let extensionVersionChangedThisSession = false;
let shouldAutoRepairWorkspaceSupportThisSession = false;

function createWorkspaceSupportRepairPlan(
  states: Array<{ workspaceRoot: string; status: SchedulerMcpSetupState["status"] }>,
  extensionLifecycleChanged: boolean,
): WorkspaceSupportRepairPlan {
  const autoRepairMcpRoots = extensionLifecycleChanged
    ? states
      .filter((state) => state.status === "missing" || state.status === "stale")
      .map((state) => state.workspaceRoot)
    : [];
  const promptMcpRoots = states
    .filter((state) =>
      state.status === "invalid"
      || (!extensionLifecycleChanged && state.status !== "configured")
    )
    .map((state) => state.workspaceRoot);
  const mcpRootsNeedingRepair = Array.from(
    new Set([...autoRepairMcpRoots, ...promptMcpRoots]),
  );
  const shouldRefreshBundledSkills = extensionLifecycleChanged;
  const shouldAutoRepair =
    autoRepairMcpRoots.length > 0 || shouldRefreshBundledSkills;

  return {
    mcpRootsNeedingRepair,
    autoRepairMcpRoots,
    promptMcpRoots,
    shouldRefreshBundledSkills,
    shouldAutoRepair,
    needsPrompt: promptMcpRoots.length > 0,
  };
}

function createUiRefreshQueue(
  flush: () => void,
  delayMs = SCHEDULER_UI_REFRESH_DEBOUNCE_MS,
): {
  schedule: (immediate?: boolean) => void;
  hasPending: () => boolean;
} {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;

  const flushPending = () => {
    pending = false;
    timer = undefined;
    flush();
  };

  return {
    schedule: (immediate = false) => {
      pending = true;

      if (immediate) {
        if (timer) {
          clearTimeout(timer);
          timer = undefined;
        }
        flushPending();
        return;
      }

      if (timer) {
        return;
      }

      timer = setTimeout(() => {
        if (!pending) {
          timer = undefined;
          return;
        }
        flushPending();
      }, delayMs);
    },
    hasPending: () => pending || timer !== undefined,
  };
}

const schedulerUiRefreshQueue = createUiRefreshQueue(() => {
  SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
  SchedulerWebview.updateJobs(scheduleManager.getAllJobs());
  SchedulerWebview.updateJobFolders(scheduleManager.getAllJobFolders());
  SchedulerWebview.updateCockpitBoard(getCurrentCockpitBoard());
  SchedulerWebview.updateTelegramNotification(getCurrentTelegramNotificationView());
  SchedulerWebview.updateExecutionDefaults(getCurrentExecutionDefaults());
  SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
  SchedulerWebview.updateResearchState(
    researchManager.getAllProfiles(),
    researchManager.getActiveRun(),
    researchManager.getRecentRuns(),
  );
  SchedulerWebview.updateScheduleHistory(
    scheduleManager.getWorkspaceScheduleHistory(),
  );
});

function refreshSchedulerUiState(immediate = false): void {
  schedulerUiRefreshQueue.schedule(immediate);
}

async function showSchedulerWebview(
  context: vscode.ExtensionContext,
  onTestPrompt?: (prompt: string, agent?: string, model?: string) => void,
): Promise<void> {
  await SchedulerWebview.show(
    context.extensionUri,
    scheduleManager.getAllTasks(),
    scheduleManager.getAllJobs(),
    scheduleManager.getAllJobFolders(),
    getCurrentCockpitBoard(),
    getCurrentTelegramNotificationView(),
    getCurrentExecutionDefaults(),
    getCurrentStorageSettings(),
    researchManager.getAllProfiles(),
    researchManager.getActiveRun(),
    researchManager.getRecentRuns(),
    handleTaskAction,
    onTestPrompt,
  );
}

function getCurrentCockpitBoard() {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    return createDefaultCockpitBoard();
  }

  const ensuredBoard = ensureTaskTodos(
    workspaceRoot,
    scheduleManager?.getAllTasks?.() ?? [],
  ).board;
  currentCockpitBoard = normalizeCockpitBoard(ensuredBoard);
  currentCockpitBoardWorkspaceRoot = workspaceRoot;
  return currentCockpitBoard;
}

function isWorkspaceSqliteModeEnabled(workspaceRoot: string): boolean {
  return getSchedulerSetting<string>("storageMode", "sqlite", vscode.Uri.file(workspaceRoot)) === "sqlite";
}

function loadCockpitBoardFromMirrors(workspaceRoot: string): CockpitBoard {
  const config = readSchedulerConfig(workspaceRoot);
  const baseBoard = config.cockpitBoard
    ? normalizeCockpitBoard(config.cockpitBoard)
    : createDefaultCockpitBoard();
  return ensureTaskTodosInBoard(
    baseBoard,
    scheduleManager?.getAllTasks?.() ?? [],
  ).board;
}

function setCurrentCockpitBoard(
  workspaceRoot: string,
  board: CockpitBoard,
): void {
  currentCockpitBoardWorkspaceRoot = workspaceRoot;
  currentCockpitBoard = normalizeCockpitBoard(board);
}

async function syncCockpitBoardToSqliteIfNeeded(
  workspaceRoot: string,
  board: CockpitBoard,
): Promise<void> {
  if (!isWorkspaceSqliteModeEnabled(workspaceRoot)) {
    return;
  }

  await syncWorkspaceCockpitBoardToSqlite(workspaceRoot, board);
}

function scheduleCockpitBoardSqliteHydration(immediate = false): void {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot || !isWorkspaceSqliteModeEnabled(workspaceRoot)) {
    return;
  }
  if (cockpitBoardSqliteHydrationPromise) {
    return;
  }

  cockpitBoardSqliteHydrationPromise = readWorkspaceCockpitBoardFromSqlite(workspaceRoot)
    .then((sqliteBoard) => {
      if (!sqliteBoard) {
        return;
      }

      const hydratedBoard = ensureTaskTodosInBoard(
        normalizeCockpitBoard(sqliteBoard),
        scheduleManager?.getAllTasks?.() ?? [],
      ).board;
      setCurrentCockpitBoard(workspaceRoot, hydratedBoard);
      refreshSchedulerUiState(immediate);
    })
    .catch((error) =>
      logError(
        "[CopilotScheduler] SQLite Cockpit board hydration failed:",
        sanitizeErrorDetailsForLog(
          error instanceof Error ? error.message : String(error ?? ""),
        ),
      ),
    )
    .finally(() => {
      cockpitBoardSqliteHydrationPromise = undefined;
    });
}

function getPrimaryWorkspaceFolderUri(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function isAutoShowOnStartupEnabled(): boolean {
  const folderUri = getPrimaryWorkspaceFolderUri();
  return getSchedulerSetting<boolean>("autoShowOnStartup", false, folderUri);
}

async function setAutoShowOnStartupEnabled(enabled: boolean): Promise<void> {
  const folderUri = getPrimaryWorkspaceFolderUri();
  const target = folderUri
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Workspace;

  await updateSchedulerSetting("autoShowOnStartup", enabled, target, folderUri);
}

async function openSchedulerUi(context: vscode.ExtensionContext): Promise<void> {
  await showSchedulerWebview(context);
  refreshSchedulerUiState(true);
  SchedulerWebview.switchToTab("help");
  void maybePromptToSetupWorkspaceMcp(context);
}

function getPrimaryWorkspaceRootPath(): string | undefined {
  return getPrimaryWorkspaceFolderUri()?.fsPath;
}

function getExecutionDefaultsTarget(): vscode.ConfigurationTarget {
  return getPrimaryWorkspaceFolderUri()
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Workspace;
}

function getCurrentExecutionDefaults(): ExecutionDefaultsView {
  const folderUri = getPrimaryWorkspaceFolderUri();
  return {
    agent: getSchedulerSetting<string>("defaultAgent", "agent", folderUri).trim(),
    model: getSchedulerSetting<string>("defaultModel", "", folderUri).trim(),
  };
}

function getCurrentStorageSettings(): StorageSettingsView {
  const folderUri = getPrimaryWorkspaceFolderUri();
  const workspaceRoot = folderUri?.fsPath;
  const board = getCurrentCockpitBoard();
  return {
    mode: getSchedulerSetting<string>("storageMode", "sqlite", folderUri) === "sqlite"
      ? "sqlite"
      : "json",
    sqliteJsonMirror: getSchedulerSetting<boolean>("sqliteJsonMirror", true, folderUri) !== false,
    disabledSystemFlagKeys: Array.isArray(board.disabledSystemFlagKeys)
      ? board.disabledSystemFlagKeys.slice()
      : [],
    appVersion: extensionContext?.extension.packageJSON?.version ?? "",
    mcpSetupStatus: getCurrentMcpSetupStatus(),
    lastMcpSupportUpdateAt: getWorkspaceTimestamp(
      LAST_MCP_SUPPORT_UPDATE_MAP_KEY,
      workspaceRoot,
    ),
    lastBundledSkillsSyncAt: getWorkspaceTimestamp(
      LAST_BUNDLED_SKILLS_SYNC_MAP_KEY,
      workspaceRoot,
    ),
  };
}

async function saveExecutionDefaults(
  input: Partial<ExecutionDefaultsView>,
): Promise<ExecutionDefaultsView> {
  const folderUri = getPrimaryWorkspaceFolderUri();
  const target = getExecutionDefaultsTarget();
  const nextAgent = typeof input.agent === "string"
    ? input.agent.trim()
    : getSchedulerSetting<string>("defaultAgent", "agent", folderUri).trim();
  const nextModel = typeof input.model === "string"
    ? input.model.trim()
    : getSchedulerSetting<string>("defaultModel", "", folderUri).trim();

  await updateSchedulerSetting("defaultAgent", nextAgent, target, folderUri);
  await updateSchedulerSetting("defaultModel", nextModel, target, folderUri);

  return getCurrentExecutionDefaults();
}

async function importStorageFromJson(): Promise<void> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    throw new Error(messages.noWorkspaceOpen());
  }

  const storageSettings = getCurrentStorageSettings();
  await bootstrapWorkspaceSqliteStorage(
    workspaceRoot,
    storageSettings.sqliteJsonMirror,
  );

  const globalStorageRoot = extensionContext?.globalStorageUri?.fsPath;
  if (globalStorageRoot) {
    await bootstrapGlobalSqliteStorage(globalStorageRoot);
  }
}

async function exportStorageToJson(): Promise<void> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    throw new Error(messages.noWorkspaceOpen());
  }

  await exportWorkspaceSqliteToJsonMirrors(
    workspaceRoot,
    extensionContext?.globalStorageUri?.fsPath,
  );
}

function getCurrentTelegramNotificationView() {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    return {
      enabled: false,
      hasBotToken: false,
      hookConfigured: false,
    };
  }
  return getTelegramNotificationView(workspaceRoot);
}

async function setupWorkspaceMcpConfig(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    notifyError(messages.mcpSetupWorkspaceRequired());
    return false;
  }

  try {
    const result = upsertSchedulerMcpConfig(
      workspaceRoot,
      context.extensionUri.fsPath,
    );
    await updateWorkspaceTimestampMap(
      context,
      LAST_MCP_SUPPORT_UPDATE_MAP_KEY,
      [workspaceRoot],
    );
    hasPromptedForMcpSetupThisSession = true;
    SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
    notifyInfo(messages.mcpSetupCompleted(result.configPath));
    return true;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "");
    logError(
      "[CopilotScheduler] Failed to update workspace MCP config:",
      sanitizeErrorDetailsForLog(errorMessage),
    );
    notifyError(messages.mcpSetupFailed(sanitizeErrorDetailsForLog(errorMessage)));
    return false;
  }
}

async function repairWorkspaceSupportFiles(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
  mcpRootsNeedingRepair: string[],
  refreshBundledSkills = true,
): Promise<boolean> {
  try {
    for (const workspaceRoot of workspaceRoots) {
      ensureWorkspaceMcpSupportFiles(workspaceRoot, context.extensionUri.fsPath);
    }
    await updateWorkspaceTimestampMap(
      context,
      LAST_MCP_SUPPORT_UPDATE_MAP_KEY,
      workspaceRoots,
    );

    let repairedMcpCount = 0;
    for (const workspaceRoot of mcpRootsNeedingRepair) {
      upsertSchedulerMcpConfig(workspaceRoot, context.extensionUri.fsPath);
      repairedMcpCount += 1;
    }

    ensurePrivateConfigIgnoredForWorkspaceRoots(workspaceRoots);
    const syncResult = refreshBundledSkills
      ? await syncBundledSkills(context, workspaceRoots)
      : {
        createdPaths: [],
        updatedPaths: [],
        skippedPaths: [],
      };
    if (
      refreshBundledSkills
      && (
        syncResult.createdPaths.length > 0 ||
        syncResult.updatedPaths.length > 0
      )
    ) {
      void SchedulerWebview.refreshCachesAndNotifyPanel(true).catch(() => {});
    }

    SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());

    notifyInfo(
      messages.workspaceSupportRepairCompleted(
        repairedMcpCount,
        syncResult.createdPaths.length,
        syncResult.updatedPaths.length,
      ),
    );
    return true;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "");
    logError(
      "[CopilotScheduler] Failed to repair workspace support files:",
      sanitizeErrorDetailsForLog(errorMessage),
    );
    notifyError(
      messages.workspaceSupportRepairFailed(
        sanitizeErrorDetailsForLog(errorMessage),
      ),
    );
    return false;
  }
}

async function maybePromptToSetupWorkspaceMcp(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (hasPromptedForMcpSetupThisSession) {
    return;
  }

  const workspaceRoots = getWorkspaceFolderPaths();
  if (workspaceRoots.length === 0) {
    return;
  }

  const states = workspaceRoots.map((workspaceRoot) => ({
    workspaceRoot,
    state: getSchedulerMcpSetupState(workspaceRoot, context.extensionUri.fsPath),
  }));
  const bundledSkillPreview = await previewBundledSkillSyncForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
    context.globalState.get<BundledSkillSyncState>(
      BUNDLED_SKILL_SYNC_STATE_KEY,
      {},
    ),
  );

  for (const entry of states) {
    if (entry.state.status === "invalid") {
      logError(
        "[CopilotScheduler] Unable to inspect workspace MCP config:",
        sanitizeErrorDetailsForLog(entry.state.reason),
      );
    }
  }

  const repairPlan = createWorkspaceSupportRepairPlan(
    states.map((entry) => ({
      workspaceRoot: entry.workspaceRoot,
      status: entry.state.status,
    })),
    shouldAutoRepairWorkspaceSupportThisSession ||
      bundledSkillPreview.createdPaths.length > 0 ||
      bundledSkillPreview.updatedPaths.length > 0,
  );

  if (repairPlan.shouldAutoRepair) {
    await repairWorkspaceSupportFiles(
      context,
      workspaceRoots,
      repairPlan.autoRepairMcpRoots,
      repairPlan.shouldRefreshBundledSkills,
    );
  }

  if (!repairPlan.needsPrompt) {
    hasPromptedForMcpSetupThisSession = true;
    return;
  }

  hasPromptedForMcpSetupThisSession = true;
  const choice = await vscode.window.showInformationMessage(
    messages.workspaceSupportRepairPrompt(
      repairPlan.mcpRootsNeedingRepair.length,
      repairPlan.shouldRefreshBundledSkills,
    ),
    messages.workspaceSupportRepairAction(),
    messages.actionCancel(),
  );
  if (choice === messages.workspaceSupportRepairAction()) {
    await repairWorkspaceSupportFiles(
      context,
      workspaceRoots,
      repairPlan.promptMcpRoots,
      false,
    );
  }
}

function shouldAutoShowSchedulerOnStartup(): boolean {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    return false;
  }

  return workspaceFolders.some((folder) =>
    getSchedulerSetting<boolean>("autoShowOnStartup", false, folder.uri),
  );
}

function scheduleAutoShowSchedulerOnStartup(
  context: vscode.ExtensionContext,
): void {
  if (!shouldAutoShowSchedulerOnStartup()) {
    return;
  }

  setTimeout(() => {
    void openSchedulerUi(context)
      .then(() => {
        SchedulerWebview.updateAutoShowOnStartup(isAutoShowOnStartupEnabled());
      })
      .catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message : String(error ?? "");
        logError(
          "[CopilotScheduler] Failed to auto-show scheduler on startup:",
          sanitizeErrorDetailsForLog(errorMessage),
        );
      });
  }, 750);
}

async function promptForOverdueTaskDelayMinutes(
  task: ScheduledTask,
): Promise<number | undefined> {
  const value = await vscode.window.showInputBox({
    prompt: messages.overdueTaskReschedulePrompt(task.name),
    placeHolder: messages.overdueTaskReschedulePlaceholder(),
    value: "5",
    ignoreFocusOut: true,
    validateInput: (rawValue) => {
      const minutes = Number(rawValue);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 10080) {
        return messages.overdueTaskRescheduleValidation();
      }
      return undefined;
    },
  });

  if (value === undefined) {
    return undefined;
  }

  return Number(value);
}

async function processOverdueTasksOnStartup(): Promise<void> {
  const overdueTasks = scheduleManager.getOverdueTasks();
  if (overdueTasks.length === 0) {
    return;
  }

  for (let index = 0; index < overdueTasks.length; index += 1) {
    const taskId = overdueTasks[index].id;
    const task = scheduleManager.getTask(taskId);
    if (!task) {
      continue;
    }

    const stillOverdue = scheduleManager
      .getOverdueTasks()
      .some((candidate) => candidate.id === taskId);
    if (!stillOverdue) {
      continue;
    }

    const dueAt = task.nextRun
      ? messages.formatDateTime(task.nextRun)
      : messages.labelNever();

    if (scheduleManager.isOneTimeTask(task)) {
      const choice = await vscode.window.showWarningMessage(
        messages.overdueTaskPromptOneTime(task.name, dueAt),
        { modal: true },
        messages.actionRun(),
        messages.actionReschedule(),
        messages.actionCancel(),
      );

      if (choice === messages.actionRun()) {
        const ran = await scheduleManager.runTaskNow(task.id);
        if (!ran) {
          scheduleManager.suppressOverdueTasks([task.id]);
          const failedTask = scheduleManager.getTask(task.id);
          notifyError(
            messages.taskExecutionFailed(
              task.name,
              failedTask?.lastError || messages.webviewUnknown(),
            ),
          );
        }
        continue;
      }

      if (choice === messages.actionReschedule()) {
        const delayMinutes = await promptForOverdueTaskDelayMinutes(task);
        if (delayMinutes === undefined) {
          scheduleManager.suppressOverdueTasks(
            overdueTasks.slice(index).map((item) => item.id),
          );
          break;
        }

        await scheduleManager.rescheduleTaskInMinutes(task.id, delayMinutes);
        notifyInfo(messages.taskRescheduled(task.name, delayMinutes));
        continue;
      }

      scheduleManager.suppressOverdueTasks(
        overdueTasks.slice(index).map((item) => item.id),
      );
      break;
    }

    const choice = await vscode.window.showWarningMessage(
      messages.overdueTaskPromptRecurring(task.name, dueAt),
      { modal: true },
      messages.actionRun(),
      messages.actionWaitNextCycle(),
      messages.actionCancel(),
    );

    if (choice === messages.actionRun()) {
      const ran = await scheduleManager.runTaskNow(task.id);
      if (!ran) {
        scheduleManager.suppressOverdueTasks([task.id]);
        const failedTask = scheduleManager.getTask(task.id);
        notifyError(
          messages.taskExecutionFailed(
            task.name,
            failedTask?.lastError || messages.webviewUnknown(),
          ),
        );
      }
      continue;
    }

    if (choice === messages.actionWaitNextCycle()) {
      await scheduleManager.deferTaskToNextCycle(task.id);
      notifyInfo(messages.taskDeferredToNextCycle(task.name));
      continue;
    }

    scheduleManager.suppressOverdueTasks(
      overdueTasks.slice(index).map((item) => item.id),
    );
    break;
  }
}

async function runStartupSequence(
  context: vscode.ExtensionContext,
  onExecute: (task: ScheduledTask) => Promise<void>,
): Promise<void> {
  if (getSchedulerSetting<boolean>("enabled", true) !== false) {
    await processOverdueTasksOnStartup();
  }

  scheduleAutoShowSchedulerOnStartup(context);

  if (getSchedulerSetting<boolean>("enabled", true) !== false) {
    scheduleManager.startScheduler(onExecute);
  } else {
    scheduleManager.stopScheduler();
  }
}

/**
 * Extension activation
 */
export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  setSchedulerConflictNotifier((message) => {
    void vscode.window.showWarningMessage(message);
  });
  // Prompt reload when the extension has been updated
  {
    const currentVersion =
      (context.extension.packageJSON as { version?: string }).version ??
      "0.0.0";
    const lastVersion = context.globalState.get<string>(LAST_VERSION_KEY);
    shouldAutoRepairWorkspaceSupportThisSession = !lastVersion
      || lastVersion !== currentVersion;
    extensionVersionChangedThisSession = !!(
      lastVersion && lastVersion !== currentVersion
    );
    if (lastVersion && lastVersion !== currentVersion) {
      void vscode.window
        .showInformationMessage(
          messages.reloadAfterUpdate(currentVersion),
          messages.reloadNow(),
        )
        .then((choice) => {
          if (choice === messages.reloadNow()) {
            void vscode.commands.executeCommand(
              "workbench.action.reloadWindow",
            );
          }
        });
    }
    void context.globalState.update(LAST_VERSION_KEY, currentVersion);
  }

  // Initialize components
  scheduleManager = new ScheduleManager(context);
  copilotExecutor = new CopilotExecutor();
  researchManager = new ResearchManager(context, copilotExecutor);
  const initialWorkspaceRoot = getPrimaryWorkspaceRootPath();
  if (initialWorkspaceRoot) {
    setCurrentCockpitBoard(
      initialWorkspaceRoot,
      loadCockpitBoardFromMirrors(initialWorkspaceRoot),
    );
  }
  setCockpitBoardPersistenceHooks({
    loadBoard: (workspaceRoot) =>
      currentCockpitBoardWorkspaceRoot === workspaceRoot
        ? currentCockpitBoard
        : undefined,
    saveBoard: (workspaceRoot, board) => {
      setCurrentCockpitBoard(workspaceRoot, board);
      void syncCockpitBoardToSqliteIfNeeded(workspaceRoot, board).catch((error) =>
        logError(
          "[CopilotScheduler] SQLite Cockpit board sync failed:",
          sanitizeErrorDetailsForLog(
            error instanceof Error ? error.message : String(error ?? ""),
          ),
        ),
      );
    },
  });
  scheduleCockpitBoardSqliteHydration(true);

  // --- HBG CUSTOM: Watch .vscode/scheduler*.json ---
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const folder = vscode.workspace.workspaceFolders[0];
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.vscode/scheduler.json')
    );
    const privateWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.vscode/scheduler.private.json')
    );

    let reloadTimer: ReturnType<typeof setTimeout> | undefined;
    let reloadQueued = false;
    let reloadInFlight = false;

    const flushReloadQueue = async () => {
      if (!reloadQueued || reloadInFlight) {
        return;
      }

      reloadQueued = false;
      reloadInFlight = true;

      try {
        console.log('[Scheduler] Reloading tasks from .vscode/scheduler.json or .vscode/scheduler.private.json');
        currentCockpitBoard = undefined;
        currentCockpitBoardWorkspaceRoot = undefined;
        scheduleManager.reloadTasks();
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (workspaceRoot) {
          setCurrentCockpitBoard(
            workspaceRoot,
            loadCockpitBoardFromMirrors(workspaceRoot),
          );
        }
        scheduleCockpitBoardSqliteHydration(true);
        refreshSchedulerUiState(true);
        await syncRecurringPromptBackupsIfNeeded(context, true);
      } catch (error) {
        logError(
          "[CopilotScheduler] Prompt backup sync after scheduler reload failed:",
          sanitizeErrorDetailsForLog(
            error instanceof Error ? error.message : String(error ?? ""),
          ),
        );
      } finally {
        reloadInFlight = false;
        if (reloadQueued) {
          queueReload();
        }
      }
    };

    const queueReload = (uri?: vscode.Uri) => {
      if (
        uri?.fsPath
        && wasSchedulerConfigWrittenRecently(
          uri.fsPath,
          SCHEDULER_WATCHER_SUPPRESSION_MS,
        )
      ) {
        return;
      }

      reloadQueued = true;

      if (reloadTimer) {
        clearTimeout(reloadTimer);
      }

      reloadTimer = setTimeout(() => {
        reloadTimer = undefined;
        void flushReloadQueue();
      }, SCHEDULER_WATCHER_DEBOUNCE_MS);
    };

    watcher.onDidChange((uri) => queueReload(uri));
    watcher.onDidCreate((uri) => queueReload(uri));
    watcher.onDidDelete((uri) => queueReload(uri));

    privateWatcher.onDidChange((uri) => queueReload(uri));
    privateWatcher.onDidCreate((uri) => queueReload(uri));
    privateWatcher.onDidDelete((uri) => queueReload(uri));

    context.subscriptions.push(watcher, privateWatcher);

    // Also perform an initial reload to catch any existing file
    scheduleManager.reloadTasks();
    void syncRecurringPromptBackupsIfNeeded(context, true).catch((error) =>
      logError(
        "[CopilotScheduler] Initial prompt backup sync failed:",
        sanitizeErrorDetailsForLog(
          error instanceof Error ? error.message : String(error ?? ""),
        ),
      ),
    );
  }
  // ------------------------------------------------

  treeProvider = new ScheduledTaskTreeProvider(scheduleManager);

  // Register callback to refresh tree when tasks change (e.g. from watcher or MCP)
  scheduleManager.setOnTasksChangedCallback(() => {
    treeProvider.refresh();
    refreshSchedulerUiState();
  });
  researchManager.setOnChangedCallback(() => {
    refreshSchedulerUiState();
  });

  // Register TreeView
  const treeView = vscode.window.createTreeView(COCKPIT_TASKS_VIEW_ID, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Register commands
  const commands = [
    registerCreateTaskCommand(),
    registerCreateTaskGuiCommand(context),
    registerListTasksCommand(context),
    registerEditTaskCommand(context),
    registerDeleteTaskCommand(),
    registerToggleTaskCommand(),
    registerEnableTaskCommand(),
    registerDisableTaskCommand(),
    registerRunNowCommand(),
    registerCopyPromptCommand(),
    registerDuplicateTaskCommand(),
    registerMoveToCurrentWorkspaceCommand(),
    registerOpenSettingsCommand(),
    registerShowVersionCommand(context),
    registerSetupMcpCommand(context),
    registerSyncBundledSkillsCommand(context),
  ];

  const executeScheduledTask = async (task: ScheduledTask): Promise<void> => {
    await executeTask(task);
  };

  scheduleManager.setOnExecuteCallback(executeScheduledTask);
  void runStartupSequence(context, executeScheduledTask).catch((error) =>
    logError(
      "[CopilotScheduler] Startup sequence failed:",
      sanitizeErrorDetailsForLog(
        error instanceof Error ? error.message : String(error ?? ""),
      ),
    ),
  );

  void ensureSchedulerSkillOnStartup(context).catch((error) =>
    logError(
      "[CopilotScheduler] Scheduler skill bootstrap failed:",
      sanitizeErrorDetailsForLog(
        error instanceof Error ? error.message : String(error ?? ""),
      ),
    ),
  );
  void bootstrapConfiguredSqliteStorage(context).catch((error) =>
    logError(
      "[CopilotScheduler] SQLite storage bootstrap failed:",
      sanitizeErrorDetailsForLog(
        error instanceof Error ? error.message : String(error ?? ""),
      ),
    ),
  );
  void maybePromptToSetupWorkspaceMcp(context).catch((error) =>
    logError(
      "[CopilotScheduler] Workspace support repair prompt failed:",
      sanitizeErrorDetailsForLog(
        error instanceof Error ? error.message : String(error ?? ""),
      ),
    ),
  );

  // Sync prompt templates to tasks (startup and daily)
  void syncPromptTemplatesIfNeeded(context, true).catch((error) =>
    logError(
      "[CopilotScheduler] Prompt template sync failed:",
      sanitizeErrorDetailsForLog(
        error instanceof Error ? error.message : String(error ?? ""),
      ),
    ),
  );
  void syncRecurringPromptBackupsIfNeeded(context, true).catch((error) =>
    logError(
      "[CopilotScheduler] Recurring prompt backup sync failed:",
      sanitizeErrorDetailsForLog(
        error instanceof Error ? error.message : String(error ?? ""),
      ),
    ),
  );
  promptSyncInterval = setInterval(
    () => {
      void syncPromptTemplatesIfNeeded(context, false).catch((error) =>
        logError(
          "[CopilotScheduler] Prompt template daily sync failed:",
          sanitizeErrorDetailsForLog(
            error instanceof Error ? error.message : String(error ?? ""),
          ),
        ),
      );
      void syncRecurringPromptBackupsIfNeeded(context, false).catch((error) =>
        logError(
          "[CopilotScheduler] Prompt backup monthly sync failed:",
          sanitizeErrorDetailsForLog(
            error instanceof Error ? error.message : String(error ?? ""),
          ),
        ),
      );
    },
    24 * 60 * 60 * 1000,
  );

  context.subscriptions.push({
    dispose: () => {
      if (promptSyncInterval) {
        clearInterval(promptSyncInterval);
        promptSyncInterval = undefined;
      }
    },
  });

  // Show activation message
  const logLevel = getSchedulerSetting<string>("logLevel", "info");
  if (logLevel === "info" || logLevel === "debug") {
    void vscode.window
      .showInformationMessage(
        messages.extensionActive(),
        messages.actionOpenScheduler(),
      )
      .then((choice) => {
        if (choice === messages.actionOpenScheduler()) {
          void openSchedulerUi(context).catch((error) =>
            logError(
              "[CopilotScheduler] Failed to open scheduler from activation notification:",
              sanitizeErrorDetailsForLog(
                error instanceof Error ? error.message : String(error ?? ""),
              ),
            ),
          );
        }
      });
  }

  // React to language changes so the webview can be re-rendered in the selected locale
  const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (affectsCompatibleConfiguration(e, "language")) {
      SchedulerWebview.refreshLanguage(scheduleManager.getAllTasks());
      treeProvider.refresh();
    }
    if (affectsCompatibleConfiguration(e, "autoShowOnStartup")) {
      SchedulerWebview.updateAutoShowOnStartup(isAutoShowOnStartupEnabled());
    }
    if (
      affectsCompatibleConfiguration(e, "defaultAgent") ||
      affectsCompatibleConfiguration(e, "defaultModel")
    ) {
      SchedulerWebview.updateExecutionDefaults(getCurrentExecutionDefaults());
    }
    const storageModeChanged = affectsCompatibleConfiguration(e, "storageMode");
    const sqliteJsonMirrorChanged = affectsCompatibleConfiguration(e, "sqliteJsonMirror");
    if (storageModeChanged || sqliteJsonMirrorChanged) {
      SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
      if (storageModeChanged && extensionContext) {
        void bootstrapConfiguredSqliteStorage(extensionContext).catch((error) =>
          logError(
            "[CopilotScheduler] SQLite storage bootstrap after settings change failed:",
            sanitizeErrorDetailsForLog(
              error instanceof Error ? error.message : String(error ?? ""),
            ),
          ),
        );
        void vscode.window.showInformationMessage(
          "Storage backend updated. Reload the window to fully apply runtime storage changes.",
          "Reload Now",
        ).then((choice) => {
          if (choice === "Reload Now") {
            void vscode.commands.executeCommand("workbench.action.reloadWindow");
          }
        });
      }
    }
    if (
      affectsCompatibleConfiguration(e, "globalPromptsPath") ||
      affectsCompatibleConfiguration(e, "globalAgentsPath")
    ) {
      void SchedulerWebview.refreshCachesAndNotifyPanel(true);
    }
    // Consolidate timezone / enabled recalculation to avoid duplicate
    // recalculateAllNextRuns() when both change in one event (U22/U24).
    let needsRecalculate = false;
    if (affectsCompatibleConfiguration(e, "timezone")) {
      needsRecalculate = true;
    }
    if (affectsCompatibleConfiguration(e, "enabled")) {
      const enabled = getSchedulerSetting<boolean>("enabled", true);
      if (enabled) {
        scheduleManager.startScheduler(executeScheduledTask);
        needsRecalculate = true;
      } else {
        scheduleManager.stopScheduler();
      }
    }
    if (needsRecalculate) {
      // recalculateAllNextRuns → saveTasks → notifyTasksChanged already
      // refreshes the tree via the callback; only Webview needs explicit update.
      void scheduleManager
        .recalculateAllNextRuns()
        .then(() => {
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        })
        .catch((error) => {
          const errorMessage =
            error instanceof Error ? error.message : String(error ?? "");
          logError(
            "[CopilotScheduler] Failed to recalculate nextRun after config change:",
            sanitizeErrorDetailsForLog(errorMessage),
          );
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        });
    }
    if (affectsCompatibleConfiguration(e, "maxDailyExecutions")) {
      if (getSchedulerSetting<number>("maxDailyExecutions", 24) === 0) {
        void vscode.window.showWarningMessage(messages.unlimitedDailyWarning());
      }
    }
  });

  // Register subscriptions
  context.subscriptions.push(treeView, configWatcher, ...commands);
}

/**
 * Extension deactivation
 */
export function deactivate(): void {
  setSchedulerConflictNotifier(undefined);
  scheduleManager?.stopScheduler();
  SchedulerWebview.dispose();
  // promptSyncInterval is cleared by the disposable registered in context.subscriptions.
}

/**
 * Execute a scheduled task
 */
async function executeTask(task: ScheduledTask): Promise<void> {
  try {
    // Resolve prompt text
    const promptText = await resolvePromptText(task);

    // Execute the prompt
    await copilotExecutor.executePrompt(promptText, {
      agent: task.agent,
      model: task.model,
      chatSession: resolveTaskExecutionChatSession(task),
    });
  } catch (error) {
    // executePrompt already shows a warning with copy-to-clipboard option,
    // so only log the error here to avoid double notification.
    // Re-throw so callers (checkAndExecuteTasks / runTaskNow) can distinguish
    // success from failure and avoid recording lastRun on failure (U15).
    const errorMessage = error instanceof Error ? error.message : String(error);
    const safeErrorMessage =
      sanitizeErrorDetailsForLog(errorMessage) || errorMessage;
    logError(messages.taskExecutionFailed(task.name, safeErrorMessage));
    throw error;
  }
}

function resolveTaskExecutionChatSession(
  task: ScheduledTask,
): ScheduledTask["chatSession"] {
  if (task.chatSession) {
    return task.chatSession;
  }

  if (task.oneTime) {
    return "new";
  }

  return undefined;
}

/**
 * Resolve prompt text from task (inline, local, or global)
 */
async function resolvePromptText(
  task: ScheduledTask,
  preferOpenDocument = true,
): Promise<string> {
  if (task.promptSource === "inline") {
    logDebug(`[CopilotScheduler] resolvePromptText: inline (task=${task.id})`);
    return task.prompt;
  }

  if (!task.promptPath) {
    logDebug(
      `[CopilotScheduler] resolvePromptText: missing promptPath (source=${task.promptSource}, task=${task.id})`,
    );
    return task.prompt;
  }

  const promptPath = task.promptPath.trim();
  if (!promptPath) {
    logDebug(
      `[CopilotScheduler] resolvePromptText: empty promptPath (source=${task.promptSource}, task=${task.id})`,
    );
    return task.prompt;
  }

  // Resolve file path
  let filePath: string | undefined;

  if (task.promptSource === "global") {
    filePath = resolveGlobalPromptPath(getGlobalPromptsRoot(), promptPath);
  } else if (task.promptSource === "local") {
    filePath = resolveLocalPromptPath(getWorkspaceFolderPaths(), promptPath);
  }

  if (filePath) {
    if (preferOpenDocument) {
      // Prefer in-memory document text when the file is open (supports unsaved edits).
      const normalizedTarget = normalizeForCompare(filePath);
      const openDoc = vscode.workspace.textDocuments.find(
        (d) =>
          d.uri.scheme === "file" &&
          normalizeForCompare(d.uri.fsPath) === normalizedTarget,
      );
      if (openDoc) {
        const text = openDoc.getText();
        if (text.trim()) {
          logDebug(
            `[CopilotScheduler] resolvePromptText: openDocument (file=${path.basename(filePath)}, dirty=${openDoc.isDirty}, task=${task.id})`,
          );
          return text;
        }
      }
    }

    try {
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.file(filePath),
      );
      const content = Buffer.from(bytes).toString("utf8");
      // If the template file is empty, fall back to the task's stored prompt.
      if (content.trim()) {
        logDebug(
          `[CopilotScheduler] resolvePromptText: file (file=${path.basename(filePath)}, task=${task.id})`,
        );
        return content;
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error ?? "");
      logDebug(
        `[CopilotScheduler] resolvePromptText: readFile failed (file=${path.basename(filePath)}, task=${task.id})`,
        sanitizeErrorDetailsForLog(errorMessage),
      );
      // Fall back to inline prompt (file may not exist or be unreadable)
    }
  } else {
    logDebug(
      `[CopilotScheduler] resolvePromptText: path resolution failed (source=${task.promptSource}, file=${path.basename(promptPath)}, task=${task.id})`,
    );
  }

  logDebug(
    `[CopilotScheduler] resolvePromptText: fallback to stored prompt (source=${task.promptSource}, task=${task.id})`,
  );
  return task.prompt;
}

export const __testOnly = {
  createUiRefreshQueue,
  createWorkspaceSupportRepairPlan,
  createImmediateManualRunRefresh,
  resolveTaskExecutionChatSession,
  resolvePromptText,
  sanitizeErrorDetailsForLog,
  ensureSchedulerSkillOnStartup,
  getCurrentStorageSettings,
};

function createImmediateManualRunRefresh(
  refreshUiState: (immediate?: boolean) => void,
): () => void {
  return () => {
    refreshUiState(true);
  };
}

function getWorkspaceFolderPaths(): string[] {
  const startPaths = (vscode.workspace.workspaceFolders ?? [])
    .map((f) => f.uri.fsPath)
    .filter((p): p is string => typeof p === "string" && p.length > 0);

  return getResolvedWorkspaceRoots(startPaths);
}

function getGlobalPromptsRoot(): string | undefined {
  return resolveGlobalPromptsRoot(
    getSchedulerSetting<string>("globalPromptsPath", ""),
  );
}

/**
 * Handle task actions from Webview
 */
function handleTaskAction(action: TaskAction): void {
  void handleTaskActionAsync(action);
}

async function confirmManualRunIfWorkspaceMismatch(
  task: ScheduledTask,
): Promise<boolean> {
  if (task.scope !== "workspace") {
    return true;
  }
  if (scheduleManager.shouldTaskRunInCurrentWorkspace(task)) {
    return true;
  }
  const choice = await vscode.window.showWarningMessage(
    messages.confirmRunOutsideWorkspace(task.name),
    { modal: true },
    messages.confirmRunAnyway(),
    messages.actionCancel(),
  );
  return choice === messages.confirmRunAnyway();
}

async function handleTaskActionAsync(action: TaskAction): Promise<void> {
  const refreshUiAfterManualRun = createImmediateManualRunRefresh(
    refreshSchedulerUiState,
  );

  try {
    if (action.taskId === "__toggleAutoShowOnStartup__") {
      const nextValue = !isAutoShowOnStartupEnabled();
      await setAutoShowOnStartupEnabled(nextValue);
      SchedulerWebview.updateAutoShowOnStartup(nextValue);
      notifyInfo(messages.autoShowOnStartupUpdated(nextValue));
      return;
    }

    if (isTodoCockpitAction(action.action)) {
      await handleTodoCockpitAction(action, {
        getPrimaryWorkspaceRootPath,
        getCurrentCockpitBoard,
        createTask: (input) => scheduleManager.createTask(input),
        removeLabelFromAllTasks: (labelName) =>
          scheduleManager.removeLabelFromAllTasks(labelName),
        refreshSchedulerUiState,
        notifyError,
        notifyInfo,
        showError: SchedulerWebview.showError,
        noWorkspaceOpenMessage: messages.noWorkspaceOpen(),
      });
      return;
    }

    switch (action.action) {
      case "run": {
        const runTask = scheduleManager.getTask(action.taskId);
        if (!runTask) {
          const msg = messages.taskNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        const confirmed = await confirmManualRunIfWorkspaceMismatch(runTask);
        if (!confirmed) {
          break;
        }

        // Manual run: no jitter / no daily limit. Persist lastRun when possible.
        // runTaskNow returns false only when the task is missing or execution fails.
        // On failure, executePrompt already shows a user-facing warning, so we do
        // not retry (which would show the same error notification a second time).
        await scheduleManager.runTaskNow(action.taskId);
        refreshUiAfterManualRun();
        break;
      }

      case "toggle": {
        const task = await scheduleManager.toggleTask(action.taskId);
        if (!task) {
          const msg = messages.taskNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        notifyInfo(
          task.enabled
            ? messages.taskEnabled(task.name)
            : messages.taskDisabled(task.name),
        );
        if (task.enabled) {
          await maybeShowDisclaimerOnce(task);
        }
        refreshSchedulerUiState();
        break;
      }

      case "delete": {
        const deleteTask = scheduleManager.getTask(action.taskId);
        if (!deleteTask) {
          const msg = messages.taskNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        if (
          deleteTask.scope === "workspace" &&
          !scheduleManager.shouldTaskRunInCurrentWorkspace(deleteTask)
        ) {
          const msg = messages.cannotDeleteOtherWorkspaceTask(deleteTask.name);
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        // Show confirmation dialog
        const confirm = await vscode.window.showWarningMessage(
          messages.confirmDelete(deleteTask.name),
          { modal: true },
          messages.confirmDeleteYes(),
        );

        if (confirm === messages.confirmDeleteYes()) {
          const deleted = await scheduleManager.deleteTask(action.taskId);
          if (!deleted) {
            const msg = messages.taskNotFound();
            notifyError(msg);
            SchedulerWebview.showError(msg);
            break;
          }
          notifyInfo(messages.taskDeleted(deleteTask.name));
          refreshSchedulerUiState();
        }
        break;
      }

      case "edit": {
        if (action.taskId === "__create__" && action.data) {
          await maybeWarnCronInterval(action.data.cronExpression);
          const task = await scheduleManager.createTask(
            action.data as CreateTaskInput,
          );
          await maybeShowDisclaimerOnce(task);
          const createdMsg = messages.taskCreated(task.name);
          notifyInfo(createdMsg);
          refreshSchedulerUiState();
          SchedulerWebview.switchToList(createdMsg);
        } else if (action.data) {
          await maybeWarnCronInterval(action.data.cronExpression);
          const task = await scheduleManager.updateTask(
            action.taskId,
            action.data,
          );
          if (!task) {
            const msg = messages.taskNotFound();
            notifyError(msg);
            SchedulerWebview.showError(msg);
            break;
          }
          const updatedMsg = messages.taskUpdated(task.name);
          notifyInfo(updatedMsg);
          refreshSchedulerUiState();
          SchedulerWebview.switchToList(updatedMsg);
        }
        break;
      }

      case "copy": {
        const copyTask = scheduleManager.getTask(action.taskId);
        if (!copyTask) {
          const msg = messages.taskNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }
        const promptText = await resolvePromptText(copyTask);
        await vscode.env.clipboard.writeText(promptText);
        notifyInfo(messages.promptCopied());
        break;
      }

      case "duplicate": {
        const task = await scheduleManager.duplicateTask(action.taskId);
        if (!task) {
          const msg = messages.taskNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }
        notifyInfo(messages.taskDuplicated(task.name));
        refreshSchedulerUiState();
        break;
      }

      case "moveToCurrentWorkspace": {
        const task = scheduleManager.getTask(action.taskId);
        if (!task) {
          const msg = messages.taskNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        const confirm = await vscode.window.showWarningMessage(
          messages.confirmMoveToCurrentWorkspace(task.name),
          { modal: true },
          messages.confirmMoveYes(),
          messages.actionCancel(),
        );
        if (confirm !== messages.confirmMoveYes()) {
          break;
        }

        const moved = await scheduleManager.moveTaskToCurrentWorkspace(task.id);
        if (moved) {
          notifyInfo(messages.taskMovedToCurrentWorkspace(moved.name));
          refreshSchedulerUiState();
        }
        break;
      }

      case "createJob": {
        if (!action.jobData) {
          break;
        }
        const job = await scheduleManager.createJob(action.jobData as any);
        notifyInfo(`Job created: ${job.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.focusJob(job.id, job.folderId);
        break;
      }

      case "updateJob": {
        if (!action.jobId || !action.jobData) {
          break;
        }
        const hasFolderUpdate = Object.prototype.hasOwnProperty.call(
          action.jobData,
          "folderId",
        );
        const job = await scheduleManager.updateJob(action.jobId, action.jobData as any);
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Job updated: ${job.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.focusJob(job.id, hasFolderUpdate ? job.folderId : undefined);
        break;
      }

      case "deleteJob": {
        if (!action.jobId) {
          break;
        }
        const job = scheduleManager.getJob(action.jobId);
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Delete job \"${job.name}\"? Attached tasks will remain as standalone tasks.`,
          { modal: true },
          messages.confirmDeleteYes(),
        );
        if (confirm !== messages.confirmDeleteYes()) {
          break;
        }
        await scheduleManager.deleteJob(action.jobId);
        notifyInfo(`Job deleted: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "duplicateJob": {
        if (!action.jobId) {
          break;
        }
        const duplicated = await scheduleManager.duplicateJob(action.jobId);
        if (!duplicated) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Job duplicated: ${duplicated.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "toggleJobPaused": {
        if (!action.jobId) {
          break;
        }
        const job = await scheduleManager.toggleJobPaused(action.jobId);
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(job.paused ? `Job paused: ${job.name}` : `Job resumed: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "createJobFolder": {
        if (!action.folderData) {
          break;
        }
        const folder = await scheduleManager.createJobFolder(action.folderData as any);
        notifyInfo(`Folder created: ${folder.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "renameJobFolder": {
        if (!action.folderId || !action.folderData) {
          break;
        }
        const folder = await scheduleManager.renameJobFolder(action.folderId, action.folderData as any);
        if (!folder) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Folder updated: ${folder.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "deleteJobFolder": {
        if (!action.folderId) {
          break;
        }
        const folder = scheduleManager.getJobFolder(action.folderId);
        if (!folder) {
          notifyError(messages.taskNotFound());
          break;
        }
        await scheduleManager.deleteJobFolder(action.folderId);
        notifyInfo(`Folder deleted: ${folder.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "createJobTask": {
        if (!action.jobId || !action.data) {
          break;
        }
        const task = await scheduleManager.createTaskInJob(
          action.jobId,
          action.data as CreateTaskInput,
          action.windowMinutes,
        );
        if (!task) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Job step created: ${task.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "attachTaskToJob": {
        if (!action.jobId || !action.taskId) {
          break;
        }
        const job = await scheduleManager.attachTaskToJob(
          action.jobId,
          action.taskId,
          action.windowMinutes,
        );
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Task added to job: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "detachTaskFromJob": {
        if (!action.jobId || !action.nodeId) {
          break;
        }
        const job = await scheduleManager.detachTaskFromJob(action.jobId, action.nodeId);
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Job step removed: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "deleteJobTask": {
        if (!action.jobId || !action.nodeId) {
          break;
        }
        const job = await scheduleManager.deleteTaskFromJob(
          action.jobId,
          action.nodeId,
        );
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Job step deleted: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "createJobPause": {
        if (!action.jobId || !action.pauseData?.title) {
          break;
        }
        const job = await scheduleManager.createPauseInJob(action.jobId, {
          title: action.pauseData.title,
        });
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Pause added to job: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "updateJobPause": {
        if (!action.jobId || !action.nodeId || !action.pauseUpdateData?.title) {
          break;
        }
        const job = await scheduleManager.updateJobPause(
          action.jobId,
          action.nodeId,
          action.pauseUpdateData as any,
        );
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Pause updated: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "deleteJobPause": {
        if (!action.jobId || !action.nodeId) {
          break;
        }
        const job = await scheduleManager.deleteJobPause(action.jobId, action.nodeId);
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Pause deleted: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "approveJobPause": {
        if (!action.jobId || !action.nodeId) {
          break;
        }
        const job = await scheduleManager.approveJobPause(action.jobId, action.nodeId);
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Checkpoint approved: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "rejectJobPause": {
        if (!action.jobId || !action.nodeId) {
          break;
        }
        const resolution = await scheduleManager.rejectJobPause(
          action.jobId,
          action.nodeId,
        );
        if (!resolution) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Checkpoint still paused: ${resolution.job.name}`);
        refreshSchedulerUiState();
        if (resolution.previousTaskId) {
          SchedulerWebview.editTask(resolution.previousTaskId);
        }
        break;
      }

      case "reorderJobNode": {
        if (!action.jobId || !action.nodeId || action.targetIndex === undefined) {
          break;
        }
        const job = await scheduleManager.reorderJobNode(
          action.jobId,
          action.nodeId,
          action.targetIndex,
        );
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        refreshSchedulerUiState();
        break;
      }

      case "updateJobNodeWindow": {
        if (!action.jobId || !action.nodeId || action.windowMinutes === undefined) {
          break;
        }
        const job = await scheduleManager.updateJobNodeWindow(
          action.jobId,
          action.nodeId,
          action.windowMinutes,
        );
        if (!job) {
          notifyError(messages.taskNotFound());
          break;
        }
        refreshSchedulerUiState();
        break;
      }

      case "compileJob": {
        if (!action.jobId) {
          break;
        }
        const compiled = await scheduleManager.compileJobToTask(action.jobId);
        if (!compiled) {
          notifyError(messages.taskNotFound());
          break;
        }
        notifyInfo(`Compiled job into task: ${compiled.task.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.focusTask(compiled.task.id);
        break;
      }

      case "restoreHistory": {
        if (!action.historyId) {
          const msg = messages.scheduleHistorySnapshotNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        const historyEntry = scheduleManager
          .getWorkspaceScheduleHistory()
          .find((entry) => entry.id === action.historyId);
        if (!historyEntry) {
          const msg = messages.scheduleHistorySnapshotNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        const restored = await scheduleManager.restoreWorkspaceScheduleHistory(
          action.historyId,
        );
        if (!restored) {
          const msg = messages.scheduleHistorySnapshotNotFound();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }

        const restoredLabel = messages.formatDateTime(
          new Date(historyEntry.createdAt),
        );
        const restoreMsg = messages.scheduleHistoryRestored(restoredLabel);
        notifyInfo(restoreMsg);
        refreshSchedulerUiState();
        SchedulerWebview.switchToList(restoreMsg);
        break;
      }

      case "refresh": {
        scheduleManager.reloadTasks();
        refreshSchedulerUiState();
        break;
      }

      case "setupMcp": {
        if (!extensionContext) {
          notifyError(messages.mcpSetupWorkspaceRequired());
          break;
        }
        await setupWorkspaceMcpConfig(extensionContext);
        break;
      }

      case "syncBundledSkills": {
        await vscode.commands.executeCommand(
          getCockpitCommandId("syncBundledSkills"),
        );
        break;
      }

      case "importStorageFromJson": {
        try {
          await importStorageFromJson();
          scheduleManager.reloadTasks();
          scheduleCockpitBoardSqliteHydration(true);
          refreshSchedulerUiState(true);
          notifyInfo("Imported JSON mirrors into SQLite storage. Reload the window if you want every runtime surface to rehydrate immediately.");
          SchedulerWebview.switchToTab("settings");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error ?? "Storage import failed.");
          notifyError(msg);
          SchedulerWebview.showError(msg);
        }
        break;
      }

      case "exportStorageToJson": {
        try {
          await exportStorageToJson();
          notifyInfo("Exported current SQLite state into the JSON compatibility mirrors.");
          SchedulerWebview.switchToTab("settings");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error ?? "Storage export failed.");
          notifyError(msg);
          SchedulerWebview.showError(msg);
        }
        break;
      }

      case "saveTelegramNotification": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          const msg = messages.noWorkspaceOpen();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }
        const view = saveTelegramNotificationConfig(
          workspaceRoot,
          action.telegramData ?? {},
        );
        SchedulerWebview.updateTelegramNotification(view);
        notifyInfo("Telegram notification settings saved.");
        SchedulerWebview.switchToTab("settings");
        break;
      }

      case "testTelegramNotification": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          const msg = messages.noWorkspaceOpen();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }
        await sendTelegramNotificationTest(
          workspaceRoot,
          action.telegramData ?? {},
        );
        SchedulerWebview.updateTelegramNotification(
          getTelegramNotificationView(workspaceRoot),
        );
        notifyInfo("Telegram test message sent.");
        SchedulerWebview.switchToTab("settings");
        break;
      }

      case "saveExecutionDefaults": {
        const defaults = await saveExecutionDefaults(
          action.executionDefaults ?? {},
        );
        SchedulerWebview.updateExecutionDefaults(defaults);
        notifyInfo("Default agent and model updated.");
        SchedulerWebview.switchToTab("settings");
        break;
      }

      case "createResearchProfile": {
        if (!action.researchData) {
          break;
        }
        const profile = await researchManager.createProfile(
          action.researchData as CreateResearchProfileInput,
        );
        notifyInfo(`Research profile created: ${profile.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("research");
        SchedulerWebview.focusResearchProfile(profile.id);
        break;
      }

      case "updateResearchProfile": {
        if (!action.researchId || !action.researchData) {
          break;
        }
        const profile = await researchManager.updateProfile(
          action.researchId,
          action.researchData,
        );
        if (!profile) {
          notifyError("Research profile not found.");
          break;
        }
        notifyInfo(`Research profile updated: ${profile.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("research");
        SchedulerWebview.focusResearchProfile(profile.id);
        break;
      }

      case "deleteResearchProfile": {
        if (!action.researchId) {
          break;
        }
        const profile = researchManager.getProfile(action.researchId);
        if (!profile) {
          notifyError("Research profile not found.");
          break;
        }
        const confirm = await vscode.window.showWarningMessage(
          `Delete research profile "${profile.name}"? Recent run history will stay on disk.`,
          { modal: true },
          messages.confirmDeleteYes(),
          messages.actionCancel(),
        );
        if (confirm !== messages.confirmDeleteYes()) {
          break;
        }
        await researchManager.deleteProfile(action.researchId);
        notifyInfo(`Research profile deleted: ${profile.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("research");
        SchedulerWebview.focusResearchProfile(
          researchManager.getAllProfiles()[0]?.id,
        );
        break;
      }

      case "duplicateResearchProfile": {
        if (!action.researchId) {
          break;
        }
        const duplicate = await researchManager.duplicateProfile(action.researchId);
        if (!duplicate) {
          notifyError("Research profile not found.");
          break;
        }
        notifyInfo(`Research profile duplicated: ${duplicate.name}`);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("research");
        SchedulerWebview.focusResearchProfile(duplicate.id);
        break;
      }

      case "startResearchRun": {
        if (!action.researchId) {
          break;
        }
        const run = await researchManager.startRun(action.researchId);
        notifyInfo(`Research run started: ${run.profileName}`);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("research");
        SchedulerWebview.focusResearchProfile(run.profileId);
        SchedulerWebview.focusResearchRun(run.id);
        break;
      }

      case "stopResearchRun": {
        const stopped = await researchManager.stopRun();
        if (!stopped) {
          notifyInfo("No research run is currently active.");
          break;
        }
        notifyInfo("Research run stop requested.");
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("research");
        SchedulerWebview.focusResearchRun(researchManager.getRecentRuns(1)[0]?.id);
        break;
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error ?? "");
    notifyError(errorMessage);
    SchedulerWebview.showError(errorMessage);
  }
}

// ==================== Command Registrations ====================

function registerCreateTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "createTask",
    async () => {
      try {
        // CLI-style task creation using InputBox
        const name = await vscode.window.showInputBox({
          prompt: messages.enterTaskName(),
          placeHolder: messages.placeholderTaskName(),
        });
        if (!name) return;

        const prompt = await vscode.window.showInputBox({
          prompt: messages.enterPrompt(),
          placeHolder: messages.placeholderPrompt(),
        });
        if (!prompt) return;

        const cronExpression = await vscode.window.showInputBox({
          prompt: messages.enterCronExpression(),
          placeHolder: messages.placeholderCron(),
          value: "0 9 * * 1-5",
        });
        if (!cronExpression) return;

        await maybeWarnCronInterval(cronExpression);
        const task = await scheduleManager.createTask({
          name,
          prompt,
          cronExpression,
        });
        await maybeShowDisclaimerOnce(task);
        notifyInfo(messages.taskCreated(task.name));
        SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerSetupMcpCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "setupMcp",
    async () => {
      await setupWorkspaceMcpConfig(context);
    },
  );
}

function registerSyncBundledSkillsCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "syncBundledSkills",
    async () => {
      const workspaceRoots = getResolvedWorkspaceRoots(
        (vscode.workspace.workspaceFolders ?? []).map((folder) =>
          folder.uri.fsPath
        ),
      );
      if (workspaceRoots.length === 0) {
        notifyError(messages.bundledSkillsSyncWorkspaceRequired());
        return;
      }

      try {
        ensurePrivateConfigIgnoredForWorkspaceRoots(workspaceRoots);
        const syncResult = await syncBundledSkills(context, workspaceRoots);
        await SchedulerWebview.refreshCachesAndNotifyPanel(true);

        if (
          syncResult.createdPaths.length === 0 &&
          syncResult.updatedPaths.length === 0 &&
          syncResult.skippedPaths.length === 0
        ) {
          notifyInfo(messages.bundledSkillsSyncNoChanges());
          return;
        }

        const summary = messages.bundledSkillsSyncCompleted(
          syncResult.createdPaths.length,
          syncResult.updatedPaths.length,
          syncResult.skippedPaths.length,
        );
        if (syncResult.skippedPaths.length > 0) {
          void vscode.window.showWarningMessage(summary);
          return;
        }

        notifyInfo(summary);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerCreateTaskGuiCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "createTaskGui",
    async () => {
      try {
        await showSchedulerWebview(
          context,
          async (prompt, agent, model) => {
            // Test prompt execution
            // executePrompt already shows a user-facing warning with copy-to-clipboard
            // on failure, so we only log the error here to avoid double notification (U20).
            try {
              await copilotExecutor.executePrompt(prompt, { agent, model });
            } catch (error) {
              const errorMessage =
                error instanceof Error ? error.message : String(error);
              const safeErrorMessage =
                sanitizeErrorDetailsForLog(errorMessage) || errorMessage;
              logError(
                `[CopilotScheduler] Test prompt failed: ${safeErrorMessage}`,
              );
            }
          },
        );

        refreshSchedulerUiState();

        // Ensure the '+' command always opens the webview in "new task" mode.
        SchedulerWebview.startCreateTask();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerListTasksCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "listTasks",
    async () => {
      try {
        await showSchedulerWebview(context);
        refreshSchedulerUiState();
        SchedulerWebview.switchToList();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerEditTaskCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "editTask",
    async (item?: ScheduledTaskItem) => {
      try {
        let taskId: string | undefined;

        if (item instanceof ScheduledTaskItem) {
          taskId = item.task.id;
        } else {
          // Show quick pick to select task
          const tasks = scheduleManager.getAllTasks();
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: t.name,
              description: t.cronExpression,
              id: t.id,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          taskId = selected.id;
        }

        await showSchedulerWebview(context);
        refreshSchedulerUiState();
        SchedulerWebview.editTask(taskId);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerDeleteTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "deleteTask",
    async (item?: ScheduledTaskItem) => {
      try {
        let task: ScheduledTask | undefined;

        if (item instanceof ScheduledTaskItem) {
          task = item.task;
        } else {
          // Show quick pick to select task
          const tasks = scheduleManager
            .getAllTasks()
            .filter(
              (t) =>
                t.scope === "global" ||
                scheduleManager.shouldTaskRunInCurrentWorkspace(t),
            );
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: t.name,
              description: t.cronExpression,
              task: t,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          task = selected.task;
        }

        if (
          task.scope === "workspace" &&
          !scheduleManager.shouldTaskRunInCurrentWorkspace(task)
        ) {
          notifyError(messages.cannotDeleteOtherWorkspaceTask(task.name));
          return;
        }

        // Confirm deletion
        const confirm = await vscode.window.showWarningMessage(
          messages.confirmDelete(task.name),
          { modal: true },
          messages.confirmDeleteYes(),
        );

        if (confirm === messages.confirmDeleteYes()) {
          await scheduleManager.deleteTask(task.id);
          notifyInfo(messages.taskDeleted(task.name));
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerToggleTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "toggleTask",
    async (item?: ScheduledTaskItem) => {
      try {
        let taskId: string | undefined;

        if (item instanceof ScheduledTaskItem) {
          taskId = item.task.id;
        } else {
          // Show quick pick to select task
          const tasks = scheduleManager.getAllTasks();
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: `${t.enabled ? "✅" : "⏸️"} ${t.name}`,
              description: t.cronExpression,
              id: t.id,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          taskId = selected.id;
        }

        const task = await scheduleManager.toggleTask(taskId);
        if (task) {
          notifyInfo(
            task.enabled
              ? messages.taskEnabled(task.name)
              : messages.taskDisabled(task.name),
          );
          if (task.enabled) {
            await maybeShowDisclaimerOnce(task);
          }
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerEnableTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "enableTask",
    async (item?: ScheduledTaskItem) => {
      try {
        let taskId: string | undefined;

        if (item instanceof ScheduledTaskItem) {
          taskId = item.task.id;
        } else {
          // Show quick pick to select a disabled task
          const tasks = scheduleManager.getAllTasks().filter((t) => !t.enabled);
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: `⏸️ ${t.name}`,
              description: t.cronExpression,
              id: t.id,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          taskId = selected.id;
        }

        const task = await scheduleManager.setTaskEnabled(taskId, true);
        if (task) {
          notifyInfo(messages.taskEnabled(task.name));
          await maybeShowDisclaimerOnce(task);
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerDisableTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "disableTask",
    async (item?: ScheduledTaskItem) => {
      try {
        let taskId: string | undefined;

        if (item instanceof ScheduledTaskItem) {
          taskId = item.task.id;
        } else {
          // Show quick pick to select an enabled task
          const tasks = scheduleManager.getAllTasks().filter((t) => t.enabled);
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: `✅ ${t.name}`,
              description: t.cronExpression,
              id: t.id,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          taskId = selected.id;
        }

        const task = await scheduleManager.setTaskEnabled(taskId, false);
        if (task) {
          notifyInfo(messages.taskDisabled(task.name));
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerRunNowCommand(): vscode.Disposable {
  const refreshUiAfterManualRun = createImmediateManualRunRefresh(
    refreshSchedulerUiState,
  );

  return registerSchedulerCommand(
    "runNow",
    async (item?: ScheduledTaskItem) => {
      try {
        let task: ScheduledTask | undefined;

        if (item instanceof ScheduledTaskItem) {
          task = item.task;
        } else {
          // Show quick pick to select task
          const tasks = scheduleManager.getAllTasks();
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: t.name,
              description: t.cronExpression,
              task: t,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          task = selected.task;
        }

        const confirmed = await confirmManualRunIfWorkspaceMismatch(task);
        if (!confirmed) {
          return;
        }

        // Manual run: no jitter / no daily limit. Persist lastRun when possible.
        // Do not retry on failure — executePrompt already shows a warning.
        await scheduleManager.runTaskNow(task.id);
        refreshUiAfterManualRun();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerCopyPromptCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "copyPrompt",
    async (item?: ScheduledTaskItem) => {
      try {
        let task: ScheduledTask | undefined;

        if (item instanceof ScheduledTaskItem) {
          task = item.task;
        } else {
          // Show quick pick to select task
          const tasks = scheduleManager.getAllTasks();
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: t.name,
              description:
                t.prompt.length > 50
                  ? t.prompt.substring(0, 50) + "..."
                  : t.prompt,
              task: t,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          task = selected.task;
        }

        const promptText = await resolvePromptText(task);
        await vscode.env.clipboard.writeText(promptText);
        notifyInfo(messages.promptCopied());
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerDuplicateTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "duplicateTask",
    async (item?: ScheduledTaskItem) => {
      try {
        let taskId: string | undefined;

        if (item instanceof ScheduledTaskItem) {
          taskId = item.task.id;
        } else {
          // Show quick pick to select task
          const tasks = scheduleManager.getAllTasks();
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: t.name,
              description: t.cronExpression,
              id: t.id,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          taskId = selected.id;
        }

        const duplicated = await scheduleManager.duplicateTask(taskId);
        if (duplicated) {
          notifyInfo(messages.taskDuplicated(duplicated.name));
          SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerMoveToCurrentWorkspaceCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "moveToCurrentWorkspace",
    async (item?: ScheduledTaskItem) => {
      try {
        let task: ScheduledTask | undefined;

        if (item instanceof ScheduledTaskItem) {
          task = item.task;
        } else {
          const tasks = scheduleManager
            .getAllTasks()
            .filter((t) => t.scope === "workspace");
          if (tasks.length === 0) {
            notifyInfo(messages.noTasksFound());
            return;
          }

          const selected = await vscode.window.showQuickPick(
            tasks.map((t) => ({
              label: t.name,
              description: t.workspacePath
                ? path.basename(t.workspacePath)
                : "",
              task: t,
            })),
            { placeHolder: messages.selectTask() },
          );

          if (!selected) return;
          task = selected.task;
        }

        if (!task) {
          notifyError(messages.taskNotFound());
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          messages.confirmMoveToCurrentWorkspace(task.name),
          { modal: true },
          messages.confirmMoveYes(),
          messages.actionCancel(),
        );
        if (confirm !== messages.confirmMoveYes()) {
          return;
        }

        const moved = await scheduleManager.moveTaskToCurrentWorkspace(task.id);
        if (!moved) {
          notifyError(messages.taskNotFound());
          return;
        }
        notifyInfo(messages.taskMovedToCurrentWorkspace(moved.name));
        SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error ?? "");
        notifyError(errorMessage);
        SchedulerWebview.showError(errorMessage);
      }
    },
  );
}

function registerOpenSettingsCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "openSettings",
    async () => {
      try {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "@ext:local-dev.copilot-cockpit",
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}

function registerShowVersionCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "showVersion",
    async () => {
      try {
        const packageJson = context.extension.packageJSON as {
          version: string;
        };
        const version = packageJson.version || "0.0.0";
        notifyInfo(messages.versionInfo(version));
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        notifyError(errorMessage);
      }
    },
  );
}
