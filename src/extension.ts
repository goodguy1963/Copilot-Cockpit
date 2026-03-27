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
import { createDefaultCockpitBoard } from "./cockpitBoard";
import {
  addCockpitTodoComment,
  approveCockpitTodo,
  addCockpitSection,
  createCockpitTodo,
  deleteCockpitSection,
  deleteCockpitTodo,
  ensureTaskTodos,
  finalizeCockpitTodo,
  getCockpitBoard,
  moveCockpitSection,
  moveCockpitTodo,
  rejectCockpitTodo,
  renameCockpitSection,
  reorderCockpitSection,
  deleteCockpitTodoLabelDefinition,
  saveCockpitTodoLabelDefinition,
  saveCockpitFlagDefinition,
  deleteCockpitFlagDefinition,
  setCockpitBoardFilters,
  updateCockpitTodo,
} from "./cockpitBoardManager";
import { getResolvedWorkspaceRoots } from "./schedulerJsonSanitizer";
import { ensurePrivateConfigIgnoredForWorkspaceRoots } from "./privateConfigIgnore";
import {
  ensureCockpitTodoSkillForWorkspaceRoots,
  ensureSchedulerSkillForWorkspaceRoots,
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
  getTelegramNotificationView,
  saveTelegramNotificationConfig,
  sendTelegramNotificationTest,
} from "./telegramNotificationManager";
import {
  getSchedulerMcpSetupState,
  upsertSchedulerMcpConfig,
} from "./mcpConfigManager";
import {
  normalizeForCompare,
  resolveGlobalPromptPath,
  resolveLocalPromptPath,
  resolveGlobalPromptsRoot,
} from "./promptResolver";
import type {
  AddCockpitTodoCommentInput,
  CreateCockpitTodoInput,
  ScheduledTask,
  CreateTaskInput,
  CreateResearchProfileInput,
  TaskAction,
  ExecutionDefaultsView,
  PromptSource,
  UpdateCockpitBoardFiltersInput,
} from "./types";

type NotificationMode = "sound" | "silentToast" | "silentStatus";

const PROMPT_SYNC_DATE_KEY = "promptSyncDate";
const PROMPT_BACKUP_SYNC_MONTH_KEY = "promptBackupSyncMonth";
const LAST_VERSION_KEY = "lastKnownVersion";

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

  await ensureSchedulerSkillForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
  );
  await ensureCockpitTodoSkillForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
  );
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
let hasPromptedForMcpSetupThisSession = false;

function refreshSchedulerUiState(): void {
  SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
  SchedulerWebview.updateJobs(scheduleManager.getAllJobs());
  SchedulerWebview.updateJobFolders(scheduleManager.getAllJobFolders());
  SchedulerWebview.updateCockpitBoard(getCurrentCockpitBoard());
  SchedulerWebview.updateTelegramNotification(getCurrentTelegramNotificationView());
  SchedulerWebview.updateExecutionDefaults(getCurrentExecutionDefaults());
  SchedulerWebview.updateResearchState(
    researchManager.getAllProfiles(),
    researchManager.getActiveRun(),
    researchManager.getRecentRuns(),
  );
  SchedulerWebview.updateScheduleHistory(
    scheduleManager.getWorkspaceScheduleHistory(),
  );
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

  return ensureTaskTodos(
    workspaceRoot,
    scheduleManager?.getAllTasks?.() ?? [],
  ).board;
}

function buildTaskPromptFromTodo(taskSource: {
  title: string;
  description?: string;
  comments?: Array<{ author?: string; body?: string }>;
}): string {
  const sections: string[] = [
    `Task goal: ${taskSource.title}`,
  ];

  if (taskSource.description?.trim()) {
    sections.push(`Context:\n${taskSource.description.trim()}`);
  }

  const commentLines = (taskSource.comments ?? [])
    .filter((comment) => comment?.body)
    .slice(-5)
    .map((comment) => `- ${comment.author || "system"}: ${comment.body}`);
  if (commentLines.length > 0) {
    sections.push(`Recent coordination:\n${commentLines.join("\n")}`);
  }

  sections.push("Produce the approved execution artifact for this todo and keep any unresolved questions explicit.");
  return sections.join("\n\n");
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
  refreshSchedulerUiState();
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
    hasPromptedForMcpSetupThisSession = true;
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

async function maybePromptToSetupWorkspaceMcp(
  context: vscode.ExtensionContext,
): Promise<void> {
  if (hasPromptedForMcpSetupThisSession) {
    return;
  }

  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    return;
  }

  const state = getSchedulerMcpSetupState(
    workspaceRoot,
    context.extensionUri.fsPath,
  );
  if (state.status === "configured") {
    hasPromptedForMcpSetupThisSession = true;
    return;
  }

  if (state.status === "invalid") {
    logError(
      "[CopilotScheduler] Unable to inspect workspace MCP config:",
      sanitizeErrorDetailsForLog(state.reason),
    );
    return;
  }

  hasPromptedForMcpSetupThisSession = true;
  const choice = await vscode.window.showInformationMessage(
    messages.mcpSetupPrompt(),
    messages.mcpSetupAction(),
    messages.actionCancel(),
  );
  if (choice === messages.mcpSetupAction()) {
    await setupWorkspaceMcpConfig(context);
  }
}

function shouldAutoShowSchedulerOnStartup(): boolean {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    return false;
  }

  return workspaceFolders.some((folder) =>
    vscode.workspace
      .getConfiguration("copilotScheduler", folder.uri)
      .get<boolean>("autoShowOnStartup", false),
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
  // Prompt reload when the extension has been updated
  {
    const currentVersion =
      (context.extension.packageJSON as { version?: string }).version ??
      "0.0.0";
    const lastVersion = context.globalState.get<string>(LAST_VERSION_KEY);
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

  // --- HBG CUSTOM: Watch .vscode/scheduler*.json ---
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const folder = vscode.workspace.workspaceFolders[0];
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.vscode/scheduler.json')
    );
    const privateWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(folder, '.vscode/scheduler.private.json')
    );

    const reloadHandler = () => {
      console.log('[Scheduler] Reloading tasks from .vscode/scheduler.json or .vscode/scheduler.private.json');
      scheduleManager.reloadTasks();
      void syncRecurringPromptBackupsIfNeeded(context, true).catch((error) =>
        logError(
          "[CopilotScheduler] Prompt backup sync after scheduler reload failed:",
          sanitizeErrorDetailsForLog(
            error instanceof Error ? error.message : String(error ?? ""),
          ),
        ),
      );
    };

    watcher.onDidChange(reloadHandler);
    watcher.onDidCreate(reloadHandler);
    watcher.onDidDelete(reloadHandler);

    privateWatcher.onDidChange(reloadHandler);
    privateWatcher.onDidCreate(reloadHandler);
    privateWatcher.onDidDelete(reloadHandler);

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
      chatSession: task.chatSession,
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
  resolvePromptText,
  sanitizeErrorDetailsForLog,
  ensureSchedulerSkillOnStartup,
};

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
  try {
    if (action.taskId === "__toggleAutoShowOnStartup__") {
      const nextValue = !isAutoShowOnStartupEnabled();
      await setAutoShowOnStartupEnabled(nextValue);
      SchedulerWebview.updateAutoShowOnStartup(nextValue);
      notifyInfo(messages.autoShowOnStartupUpdated(nextValue));
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
        SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
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
        if (hasFolderUpdate) {
          SchedulerWebview.focusJob(job.id, job.folderId);
        }
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

      case "createTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoData?.title) {
          const msg = messages.noWorkspaceOpen();
          notifyError(msg);
          SchedulerWebview.showError(msg);
          break;
        }
        createCockpitTodo(
          workspaceRoot,
          action.todoData as CreateCockpitTodoInput,
        );
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo("Todo Cockpit item created.");
        break;
      }

      case "updateTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = updateCockpitTodo(
          workspaceRoot,
          action.todoId,
          action.todoData ?? {},
        );
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo(`Updated Todo Cockpit item: ${result.todo.title}`);
        break;
      }

      case "deleteTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = deleteCockpitTodo(workspaceRoot, action.todoId);
        if (!result.deleted) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo("Todo Cockpit item rejected and archived.");
        break;
      }

      case "approveTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = approveCockpitTodo(workspaceRoot, action.todoId);
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo(`Approved Todo Cockpit item: ${result.todo.title}`);
        break;
      }

      case "rejectTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = rejectCockpitTodo(workspaceRoot, action.todoId);
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo(`Rejected Todo Cockpit item: ${result.todo.title}`);
        break;
      }

      case "finalizeTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = finalizeCockpitTodo(workspaceRoot, action.todoId);
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo(`Completed Todo Cockpit item: ${result.todo.title}`);
        break;
      }

      case "saveTodoLabelDefinition": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoLabelData?.name) {
          break;
        }
        const result = saveCockpitTodoLabelDefinition(
          workspaceRoot,
          action.todoLabelData,
        );
        if (!result.label) {
          notifyError("Todo Cockpit label could not be saved.");
          break;
        }
        refreshSchedulerUiState();
        notifyInfo(`Saved label palette entry: ${result.label.name}`);
        break;
      }

      case "deleteTodoLabelDefinition": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoLabelData?.name) {
          break;
        }
        deleteCockpitTodoLabelDefinition(workspaceRoot, action.todoLabelData.name);
        refreshSchedulerUiState();
        break;
      }

      case "saveTodoFlagDefinition": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoFlagData?.name) {
          break;
        }
        const result = saveCockpitFlagDefinition(
          workspaceRoot,
          action.todoFlagData,
        );
        if (!result.label) {
          notifyError("Todo Cockpit flag could not be saved.");
          break;
        }
        refreshSchedulerUiState();
        notifyInfo(`Saved flag palette entry: ${result.label.name}`);
        break;
      }

      case "deleteTodoFlagDefinition": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoFlagData?.name) {
          break;
        }
        deleteCockpitFlagDefinition(workspaceRoot, action.todoFlagData.name);
        refreshSchedulerUiState();
        break;
      }

      case "archiveTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = finalizeCockpitTodo(workspaceRoot, action.todoId);
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        notifyInfo(`Completed Todo Cockpit item: ${result.todo.title}`);
        break;
      }

      case "moveTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = moveCockpitTodo(
          workspaceRoot,
          action.todoId,
          action.targetSectionId,
          action.targetOrder ?? 0,
        );
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "addCockpitSection": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.sectionTitle) break;
        addCockpitSection(workspaceRoot, action.sectionTitle);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "renameCockpitSection": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.sectionId || !action.sectionTitle) break;
        renameCockpitSection(workspaceRoot, action.sectionId, action.sectionTitle);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "deleteCockpitSection": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.sectionId) break;
        deleteCockpitSection(workspaceRoot, action.sectionId);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "moveCockpitSection": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.sectionId || !action.sectionDirection) break;
        moveCockpitSection(workspaceRoot, action.sectionId, action.sectionDirection);
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "reorderCockpitSection": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.sectionId || action.targetIndex == null) break;
        reorderCockpitSection(workspaceRoot, action.sectionId, action.targetIndex);
        refreshSchedulerUiState();
        break;
      }

      case "addTodoComment": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId || !action.todoCommentData?.body) {
          break;
        }
        const result = addCockpitTodoComment(
          workspaceRoot,
          action.todoId,
          action.todoCommentData as AddCockpitTodoCommentInput,
        );
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "setTodoFilters": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          break;
        }
        setCockpitBoardFilters(
          workspaceRoot,
          (action.todoFilters ?? {}) as UpdateCockpitBoardFiltersInput,
        );
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "linkTodoTask": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const result = updateCockpitTodo(
          workspaceRoot,
          action.todoId,
          { taskId: action.linkedTaskId ?? null },
        );
        if (!result.todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("board");
        break;
      }

      case "createTaskFromTodo": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot || !action.todoId) {
          break;
        }
        const board = getCurrentCockpitBoard();
        const todo = board.cards.find((entry) => entry.id === action.todoId);
        if (!todo) {
          notifyError("Todo Cockpit item not found.");
          break;
        }

        const createdTask = await scheduleManager.createTask({
          name: todo.title,
          description: todo.description,
          cronExpression: "0 9 * * 1-5",
          prompt: buildTaskPromptFromTodo(todo),
          enabled: false,
          labels: Array.from(new Set([...(todo.labels ?? []), "from-todo-cockpit"])),
          scope: "workspace",
          promptSource: "inline",
        });
        updateCockpitTodo(workspaceRoot, todo.id, { taskId: createdTask.id });
        refreshSchedulerUiState();
        SchedulerWebview.switchToTab("list");
        SchedulerWebview.focusTask(createdTask.id);
        notifyInfo(`Created scheduled task draft from Todo Cockpit: ${createdTask.name}`);
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
        SchedulerWebview.updateTasks(scheduleManager.getAllTasks());
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
          "@ext:local-dev.copilot-scheduler-local",
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
