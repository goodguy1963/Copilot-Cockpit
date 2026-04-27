import * as fs from "fs";
import * as vscode from "vscode";
import * as path from "path";
import { ScheduleManager } from "./cockpitManager"; // local-diverge-3
import { CopilotExecutor } from "./copilotExecutor";
import { ResearchManager } from "./researchManager";
import {
  ScheduledTaskTreeProvider,
  ScheduledTaskItem,
  type WorkspaceTreeNode,
} from "./treeProvider";
import { SchedulerWebview } from "./cockpitWebview";
import { messages } from "./i18n";
import { logDebug } from "./logger";
import { logError } from "./logger";
import { logInfo } from "./logger";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import {
  COCKPIT_NEEDS_USER_REVIEW_FLAG,
  COCKPIT_READY_FLAG,
  createDefaultCockpitBoard,
  getActiveCockpitWorkflowFlag,
  normalizeCockpitBoard,
} from "./cockpitBoard";
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
} from "./cockpitJsonSanitizer";
import {
  applyPrivateConfigIgnoreForWorkspaceRoots,
  ensurePrivateConfigIgnoredForWorkspaceRoots,
} from "./privateConfigIgnore";
import { AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY } from "./privateConfigIgnore";
import {
  type BundledSkillSyncResult,
  type BundledSkillSyncState,
  type StagedBundledAgentsResult,
  previewBundledSkillSyncForWorkspaceRoots,
  stageBundledAgentsForWorkspaceRoots,
  syncBundledAgentsForWorkspaceRoots,
  syncBundledCodexSkillsForWorkspaceRoots,
  syncBundledSkillsForWorkspaceRoots,
} from "./skillBootstrap";
import {
  findLinkedTodoByTaskId,
  isTodoDraftTask,
} from "./todoDraftTasks";
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
  getGitHubIntegrationView,
  saveGitHubIntegrationConfig,
  syncGitHubIntegrationInbox,
} from "./githubIntegrationManager";
import { resolveGitHubAuthentication } from "./githubAuthResolver";
import { createEmptyGitHubInboxSnapshot } from "./githubRestClient";
import {
  getTelegramNotificationView,
  saveTelegramNotificationConfig,
  sendTelegramNotificationTest,
} from "./telegramNotificationManager";
import {
  SCHEDULER_PRIVATE_JSON_FILE,
  SCHEDULER_PUBLIC_JSON_FILE,
  WORKSPACE_SQLITE_DB_FILE,
} from "./sqliteStorage";
import {
  ensureWorkspaceMcpSupportFiles,
  buildNodeShellExecutionCommand,
  resolveNodeLaunchCommand,
  type SchedulerMcpSetupState,
  getSchedulerMcpSetupState,
  upsertSchedulerCodexConfig,
  upsertSchedulerMcpConfig,
} from "./mcpConfigManager";
import {
  ExternalAgentAccessManager,
} from "./externalAgentAccessManager";
import {
  buildExternalAgentControlSocketPath,
  evaluateExternalAgentAuthorization,
  ExternalAgentControlServerManager,
  type ExternalAgentControlRequest,
} from "./externalAgentControl";
import {
  ensureWorkspaceExternalAgentSupportFiles,
  EXTERNAL_AGENT_KEY_ENV_VAR,
  EXTERNAL_AGENT_REPO_ID_ENV_VAR,
  getWorkspaceExternalAgentLauncherPath,
  getWorkspaceExternalAgentSupportDirectory,
} from "./externalAgentConfigManager";
import { resolveGlobalPromptsRoot } from "./promptResolver";
import {
  handleTodoCockpitAction,
  isTodoCockpitAction,
} from "./todoCockpitActionHandler";
import { resolveTaskPromptTextFromSource } from "./extensionPromptText";
import {
  promptToPickTask,
  promptToPickTaskId,
} from "./extensionTaskPicker";
import {
  runPromptMaintenanceCycle as runPromptMaintenanceCycleWithDeps,
  syncRecurringPromptBackupsIfNeeded as syncRecurringPromptBackupsIfNeededWithDeps,
} from "./extensionPromptMaintenance";
import {
  normalizeSearchProvider,
  resolveProviderSettings,
} from "./providerSettings";
import {
  backupGithubFolderSnapshot,
} from "./cockpitWebviewSupport";
import {
  inspectBundledAgentSyncWorkspaces,
  summarizeBundledAgentSystemSignals,
} from "./bundledAgentSyncPreflight";
import {
  maybePromptReloadAfterUpdate as maybePromptReloadAfterUpdateWithUi,
  maybeShowDisclaimerOnce as maybeShowDisclaimerOnceWithUi,
  warnIfCronTooFrequent as maybeWarnCronIntervalWithUi,
  notifyError as notifyErrorWithUi,
  notifyInfo as notifyInfoWithUi,
  warnStaleRuntimeSqliteSuppressed as warnStaleRuntimeSqliteSuppressedWithUi,
} from "./extensionUiFlows";
import { shouldSuppressSqliteWorkForExtensionContext } from "./staleExtensionRuntime";
import type {
  AddCockpitTodoCommentInput,
  ApprovalMode,
  CockpitBoard,
  CreateCockpitTodoInput,
  ScheduledTask,
  CreateTaskInput,
  CreateResearchProfileInput,
  GitHubAuthStatus,
  GitHubIntegrationView,
  ResearchProvider,
  StorageSettingsView,
  SearchProvider,
  TaskAction,
  ExecutionDefaultsView,
  ReviewDefaultsView,
  PromptSource,
  UpdateCockpitBoardFiltersInput,
} from "./types";

type NotificationMode = "sound" | "silentToast" | "silentStatus";

const BUNDLED_SKILL_SYNC_STATE_KEY = "bundledSkillSyncState";
const BUNDLED_AGENT_SYNC_STATE_KEY = "bundledAgentSyncState";
const CODEX_SKILL_SYNC_STATE_KEY = "codexSkillSyncState";
const COCKPIT_WORKSPACE_ACTIVATION_MAP_KEY = "cockpitWorkspaceActivationByRoot";
const LAST_MCP_SUPPORT_UPDATE_MAP_KEY = "lastMcpSupportUpdateByWorkspace";
const LAST_BUNDLED_SKILLS_SYNC_MAP_KEY = "lastBundledSkillsSyncByWorkspace";
const LAST_BUNDLED_AGENTS_SYNC_MAP_KEY = "lastBundledAgentsSyncByWorkspace";
const SCHEDULER_WATCHER_DEBOUNCE_MS = 150;
const EXTERNAL_AGENT_HEARTBEAT_INTERVAL_MS = 2000;
const CUSTOM_SUBAGENT_SETTING_KEY = "chat.customAgentInSubagent.enabled";
const OPEN_COPILOT_SETTING_ACTION = "Open Copilot Setting";
const DEFAULT_NEEDS_BOT_REVIEW_COMMENT_TEMPLATE = "Needs bot review: inspect the current context, call out risks or unclear assumptions, and propose the smallest safe next step.";

function getSearchProviderPromptLabel(searchProvider: SearchProvider): string {
  switch (searchProvider) {
    case "tavily":
      return "Tavily";
    default:
      return "VS Code built-in web search";
  }
}

function getResearchProviderPromptLabel(researchProvider: ResearchProvider): string {
  switch (researchProvider) {
    case "google-grounded":
      return "Google grounded research";
    case "perplexity":
      return "Perplexity";
    case "tavily":
      return "Tavily research";
    default:
      return "no dedicated external research provider";
  }
}

function buildDefaultNeedsBotReviewPromptTemplate(
  searchProvider: SearchProvider,
  researchProvider: ResearchProvider,
): string {
  return [
    "You are handling a Todo that just entered needs-bot-review.",
    "",
    "{{todo_context}}",
    "",
    "{{mcp_skill_guidance}}",
    "",
    `Research what is needed to review this item using available tools. If the user or request already includes a URL, inspect it with built-in tools first before using external research providers, especially Google grounded research, to minimize API calls. Use ${getSearchProviderPromptLabel(searchProvider)} for lightweight external search. Use ${getResearchProviderPromptLabel(researchProvider)} for deeper research when needed.`,
    "Return a plain-text review comment ready for direct Todo writeback with short titled sections and bullets:",
    "Review Summary:",
    "- 1-2 bullets on the request and current repo state",
    "Risks / Gaps:",
    "- bullets for missing context, risks, or unclear assumptions",
    "Recommendation:",
    "- one compact next step or blocking clarification; if the request is already clear, give two implementation options instead",
    "Use real line breaks. Do not emit JSON or escaped newline sequences such as \\n.",
    "When the review is complete, add that comment to this Todo using the cockpit MCP tools and set the flag to needs-user-review.",
  ].join("\n");
}

const DEFAULT_NEEDS_BOT_REVIEW_PROMPT_TEMPLATE = buildDefaultNeedsBotReviewPromptTemplate("built-in", "none");
const DEFAULT_READY_PROMPT_TEMPLATE = [
  "You are handling a Todo that is now ready for implementation.",
  "",
  "{{todo_context}}",
  "",
  "{{mcp_skill_guidance}}",
  "",
  "Analyze this Todo using the Todo Cockpit skill and implement what the user decided in the last comment or the latest bot recommendation.",
  "If there is no recent user comment, proceed with the bot's recommendation.",
  "Add one compact Todo comment covering implementation changes, validation, and any remaining follow-up before or as you update the Todo to the correct workflow state.",
  "Check the cockpit-todo-agent and cockpit-scheduler-router skills to determine the correct post-implementation state, and tell the user whether that guidance was found.",
  "If the expected post-implementation state is not documented in the skills, add it there so the next editable default flag in settings has clear guidance.",
].join("\n");
const SCHEDULER_WATCHER_SUPPRESSION_MS = 1500;
const SCHEDULER_UI_REFRESH_DEBOUNCE_MS = 50;

let cachedGitHubAuthStatus: GitHubAuthStatus = {
  hasConnection: false,
  authStatusText: "No VS Code GitHub connection is available. Sign in with the built-in GitHub authentication provider to enable refresh.",
};

function getGitHubAuthResolverOptions(apiBaseUrl: string | undefined): {
  apiBaseUrl?: string;
  configurationScope?: vscode.ConfigurationScope;
  configurationTarget: vscode.ConfigurationTarget;
} {
  const configurationScope = getPrimaryWorkspaceFolderUri();
  return {
    apiBaseUrl,
    configurationScope,
    configurationTarget: configurationScope
      ? vscode.ConfigurationTarget.WorkspaceFolder
      : vscode.ConfigurationTarget.Workspace,
  };
}

async function refreshCachedGitHubAuthStatus(
  workspaceRoot: string | undefined,
): Promise<void> {
  if (!workspaceRoot) {
    cachedGitHubAuthStatus = {
      hasConnection: false,
      authStatusText: "No workspace is open.",
    };
    return;
  }

  const currentView = getGitHubIntegrationView(workspaceRoot);
  cachedGitHubAuthStatus = await resolveGitHubAuthentication(
    getGitHubAuthResolverOptions(currentView.apiBaseUrl),
  );
  SchedulerWebview.updateGitHubIntegration(
    getGitHubIntegrationView(workspaceRoot, cachedGitHubAuthStatus),
  );
}

const SYNC_TIMESTAMP_KEY = "promptSyncDate";
const PROMPT_BACKUP_SYNC_MONTH_KEY = "promptBackupSyncMonth";
const PREVIOUS_VERSION_KEY = "lastKnownVersion";

type WorkspaceSupportRepairPlan = {
  mcpRootsNeedingRepair: string[];
  autoRepairMcpRoots: string[];
  promptMcpRoots: string[];
  shouldRefreshBundledSkills: boolean;
  shouldAutoRepair: boolean;
  needsPrompt: boolean;
};

type WorkspaceTimestampMap = Record<string, string>;
type WorkspaceActivationMap = Record<string, boolean>;

type GitHeadLike = {
  name?: string;
};

type GitRepositoryLike = {
  rootUri: vscode.Uri;
  state?: {
    HEAD?: GitHeadLike;
  };
};

type GitApiLike = {
  repositories: GitRepositoryLike[];
};

type GitExtensionExportsLike = {
  getAPI: (version: 1) => GitApiLike;
};

type StartupSqliteHydrationDeps = {
  workspaceRoot?: string;
  isSqliteModeEnabled: (workspaceRoot: string) => boolean;
  waitForTaskHydration: () => Promise<void>;
  getBoardHydrationPromise: () => Promise<void> | undefined;
  timeoutMs?: number;
  createTimeout?: (callback: () => void, timeoutMs: number) => NodeJS.Timeout;
  clearTimeoutHandle?: (handle: NodeJS.Timeout) => void;
};

const SQLITE_STARTUP_HYDRATION_TIMEOUT_MS = 10_000;

type OpenSchedulerUiOptions = {
  onTestPrompt?: (prompt: string, agent?: string, model?: string) => void;
  focusHelpTab?: boolean;
  afterShow?: () => void | Promise<void>;
};

function getSchedulerSetting<T>(
  key: string,
  defaultValue: T,
  scope?: vscode.ConfigurationScope,
): T {
  return getCompatibleConfigurationValue<T>(key, defaultValue, scope);
}

function getWorkspaceSettingWithFallback<T>(
  keys: string[],
  defaultValue: T,
  scope?: vscode.ConfigurationScope,
): T {
  const configuration = vscode.workspace.getConfiguration("copilotCockpit", scope);
  for (const key of keys) {
    const inspected = configuration.inspect<T>(key);
    const explicitValue = inspected?.workspaceFolderValue
      ?? inspected?.workspaceValue
      ?? inspected?.globalValue;
    if (explicitValue !== undefined) {
      return explicitValue as T;
    }
  }

  return defaultValue;
}

function hasExplicitWorkspaceSetting(
  key: string,
  scope?: vscode.ConfigurationScope,
): boolean {
  const configuration = vscode.workspace.getConfiguration("copilotCockpit", scope);
  const inspected = configuration.inspect(key);

  return inspected?.workspaceFolderValue !== undefined
    || inspected?.workspaceValue !== undefined
    || inspected?.globalValue !== undefined;
}

function getCurrentProviderSettings(scope?: vscode.ConfigurationScope): {
  searchProvider: SearchProvider;
  researchProvider: ResearchProvider;
} {
  return resolveProviderSettings({
    searchProvider: getSchedulerSetting<string>("searchProvider", "built-in", scope),
    researchProvider: getSchedulerSetting<string>("researchProvider", "none", scope),
    hasExplicitResearchProvider: hasExplicitWorkspaceSetting("researchProvider", scope),
  });
}

function normalizeWorkspacePathForGitComparison(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32"
    ? resolved.toLowerCase()
    : resolved;
}

function findGitRepositoryForWorkspace(
  api: GitApiLike,
  workspaceRoot: string | undefined,
): GitRepositoryLike | undefined {
  if (!workspaceRoot) {
    return api.repositories[0];
  }

  const targetRoot = normalizeWorkspacePathForGitComparison(workspaceRoot);
  const exactMatch = api.repositories.find((repository) =>
    normalizeWorkspacePathForGitComparison(repository.rootUri.fsPath) === targetRoot,
  );
  if (exactMatch) {
    return exactMatch;
  }

  return api.repositories.find((repository) => {
    const repositoryRoot = normalizeWorkspacePathForGitComparison(
      repository.rootUri.fsPath,
    );
    return targetRoot.startsWith(`${repositoryRoot}${path.sep}`)
      || repositoryRoot.startsWith(`${targetRoot}${path.sep}`);
  });
}

async function getCurrentGitBranchNameForWorkspace(
  workspaceRoot: string | undefined,
): Promise<string | undefined> {
  try {
    const gitExtension = vscode.extensions.getExtension<GitExtensionExportsLike>(
      "vscode.git",
    );
    if (!gitExtension) {
      return undefined;
    }

    const gitExports = gitExtension.isActive
      ? gitExtension.exports
      : await gitExtension.activate();
    const api = gitExports?.getAPI?.(1);
    if (!api) {
      return undefined;
    }

    const repository = findGitRepositoryForWorkspace(api, workspaceRoot);
    const headName = repository?.state?.HEAD?.name;
    return typeof headName === "string" && headName.trim()
      ? headName.trim()
      : undefined;
  } catch {
    return undefined;
  }
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

function redactPathsForLog(message: string): string {
  return sanitizeAbsolutePathDetails(message);
}

function isNotificationActive(): boolean {
  return getSchedulerSetting<boolean>("showNotifications", true);
}

function resolveNotifyMode(): NotificationMode {
  const mode = getSchedulerSetting<NotificationMode>("notificationMode", "sound");
  // Backward-compat: treat the old disabled-notifications flag as silentStatus
  if (getSchedulerSetting<boolean>("showNotifications", true) === false) {
    return "silentStatus" as const;
  }
  return mode ?? "sound";
}

async function warnIfCronTooFrequent(cronExpression?: string): Promise<void> {
  await maybeWarnCronIntervalWithUi({
    cronExpression,
    cockpitManager: scheduler,
    getSetting: getSchedulerSetting,
  });
}

async function maybeShowDisclaimerOnce(task: ScheduledTask): Promise<void> {
  await maybeShowDisclaimerOnceWithUi({
    task,
    cockpitManager: scheduler,
  });
}

function logExtensionErrorWithSanitizedDetails(
  prefix: string,
  error: unknown,
): void {
  logError(
    prefix,
    redactPathsForLog(
      toErrorMessage(error),
    ),
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "");
}

function normalizeApprovalMode(value: string): ApprovalMode {
  switch (value) {
    case "auto-approve":
    case "autopilot":
    case "yolo":
      return value;
    default:
      return "default";
  }
}

function runPromptMaintenanceCycle(
  context: vscode.ExtensionContext,
  force: boolean,
): void {
  runPromptMaintenanceCycleWithDeps(
    context,
    getPromptMaintenanceDeps(),
    getPromptMaintenanceKeys(),
    force,
    logExtensionErrorWithSanitizedDetails,
  );
}

function getPromptMaintenanceDeps() {
  return {
    getAllTasks: () => scheduler.getAllTasks(),
    updateTaskPrompts: (updates: Array<{ id: string; prompt: string }>) =>
      scheduler.updateTaskPrompts(updates),
    ensureRecurringPromptBackups: () =>
      scheduler.ensureRecurringPromptBackups(),
    updateWebviewTasks: (tasks: ScheduledTask[]) =>
      SchedulerWebview.updateTasks(tasks),
    resolvePromptText, // prompt-fn
    logError,
    redactPathsForLog,
  };
}

function getPromptMaintenanceKeys() {
  return {
    promptSyncDateKey: SYNC_TIMESTAMP_KEY,
    promptBackupSyncMonthKey: PROMPT_BACKUP_SYNC_MONTH_KEY,
  };
}

function clearPromptSyncIntervalHandle(): void {
  if (!promptRefreshTimer) return;
  clearInterval(promptRefreshTimer);
  promptRefreshTimer = undefined;
}

function createSchedulerTreeView(): vscode.TreeView<WorkspaceTreeNode> {
  return vscode.window.createTreeView(COCKPIT_TASKS_VIEW_ID, {
    showCollapseAll: true, // sidebar-opt
    treeDataProvider: taskTreeView,
  });
}

function registerSchedulerCommands(
  context: vscode.ExtensionContext,
): vscode.Disposable[] {
  const commandDisposables: vscode.Disposable[] = [];
  commandDisposables.push(registerNewTaskCommand(), registerCreateTaskGuiCommand(context));
  commandDisposables.push(registerListTasksCommand(context), registerOpenCockpitCommand(context));
  commandDisposables.push(registerEditTaskCommand(context));
  commandDisposables.push(registerRemoveTaskCommand(), registerToggleCommand());
  commandDisposables.push(registerActivateCommand(), registerDeactivateCommand());
  commandDisposables.push(registerImmediateRunCommand(), registerCopyCommand());
  commandDisposables.push(registerCloneTaskCommand(), registerRelocateToWorkspaceCommand());
  commandDisposables.push(registerPreferencesCommand(), registerShowVersionCommand(context));
  commandDisposables.push(registerSetupMcpCommand(context), registerSyncBundledSkillsCommand(context));
  commandDisposables.push(registerEnableExternalAgentAccessCommand(context));
  commandDisposables.push(registerDisableExternalAgentAccessCommand(context));
  commandDisposables.push(registerRotateExternalAgentKeyCommand(context));
  commandDisposables.push(registerCopyExternalAgentSetupInfoCommand(context));
  return commandDisposables;
}

function refreshTasksAfterConfigurationRecalculation(): void {
  void scheduler.recomputeAllSchedules()
    .then(refreshWebviewTasks)
    .catch((error) => {
      logExtensionErrorWithSanitizedDetails(
        "[CopilotCockpit] nextRun recalc after config change failed:",
        error,
      );
      refreshWebviewTasks();
    });
}

function maybePromptReloadAfterUpdate(
  currentVersion: string,
  lastVersion: string | undefined,
): void {
  maybePromptReloadAfterUpdateWithUi(currentVersion, lastVersion);
}

async function ensureSchedulerSkillOnStartup(
  context: vscode.ExtensionContext,
  workspaceRoots = collectWorkspacePaths(),
): Promise<void> {
  void context;
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

async function syncBundledAgents(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
): Promise<BundledSkillSyncResult | undefined> {
  const inspections = inspectBundledAgentSyncWorkspaces(workspaceRoots);
  const signalSummary = summarizeBundledAgentSystemSignals(inspections);
  const confirmationAction = messages.bundledAgentsSyncConfirmAction();
  const detail = [
    signalSummary.length > 0
      ? messages.bundledAgentsSyncConfirmExistingSurfaces(signalSummary)
      : messages.bundledAgentsSyncConfirmNoExistingSurfaces(),
    inspections.some((inspection) => inspection.hasGithubFolder)
      ? messages.bundledAgentsSyncConfirmBackup()
      : messages.bundledAgentsSyncConfirmNoBackup(),
    messages.bundledAgentsSyncConfirmCustomizedPreserved(),
  ].join("\n\n");

  const confirmation = await vscode.window.showWarningMessage(
    messages.bundledAgentsSyncConfirmTitle(workspaceRoots.length),
    {
      modal: true,
      detail,
    },
    confirmationAction,
    messages.actionCancel(),
  );

  if (confirmation !== confirmationAction) {
    return undefined;
  }

  try {
    for (const inspection of inspections) {
      if (!inspection.hasGithubFolder) {
        continue;
      }
      await backupGithubFolderSnapshot(inspection.workspaceRoot);
    }
  } catch (error) {
    logError(
      "[CopilotScheduler] Failed to create a .github backup before syncing bundled agents.",
      error,
    );
    notifyError(messages.bundledAgentsSyncBackupFailed());
    return undefined;
  }

  const syncState = context.globalState.get<BundledSkillSyncState>(
    BUNDLED_AGENT_SYNC_STATE_KEY,
    {},
  );
  const syncResult = await syncBundledAgentsForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
    syncState,
  );
  await context.globalState.update(
    BUNDLED_AGENT_SYNC_STATE_KEY,
    syncResult.nextState,
  );
  if (syncResult.createdPaths.length > 0 || syncResult.updatedPaths.length > 0) {
    await updateWorkspaceTimestampMap(
      context,
      LAST_BUNDLED_AGENTS_SYNC_MAP_KEY,
      workspaceRoots,
    );
  }
  return syncResult;
}

async function stageBundledAgents(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
): Promise<StagedBundledAgentsResult | undefined> {
  const inspections = inspectBundledAgentSyncWorkspaces(workspaceRoots);
  const signalSummary = summarizeBundledAgentSystemSignals(inspections);
  const confirmationAction = messages.bundledAgentsStageConfirmAction();
  const detail = [
    signalSummary.length > 0
      ? messages.bundledAgentsStageConfirmExistingSurfaces(signalSummary)
      : messages.bundledAgentsStageConfirmNoExistingSurfaces(),
    messages.bundledAgentsStageConfirmLocation(),
    messages.bundledAgentsStageConfirmLiveTreeUntouched(),
  ].join("\n\n");

  const confirmation = await vscode.window.showInformationMessage(
    messages.bundledAgentsStageConfirmTitle(workspaceRoots.length),
    {
      modal: true,
      detail,
    },
    confirmationAction,
    messages.actionCancel(),
  );

  if (confirmation !== confirmationAction) {
    return undefined;
  }

  return stageBundledAgentsForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
  );
}

function formatPromptPathForWorkspace(
  workspaceRoot: string,
  targetPath: string,
): string {
  const relativePath = path.relative(workspaceRoot, targetPath);
  if (!relativePath || relativePath.startsWith("..")) {
    return targetPath;
  }

  return relativePath.replace(/\\/g, "/");
}

function buildBundledAgentMergePrompt(
  workspaceRoots: string[],
  stageResult: StagedBundledAgentsResult,
): string {
  const workspaceSections = workspaceRoots.map((workspaceRoot, index) => {
    const stagedRoot = stageResult.stagedRoots[index]
      ?? path.join(workspaceRoot, ".vscode", "copilot-cockpit-support", "bundled-agents");
    const manifestPath = stageResult.manifestPaths[index]
      ?? path.join(stagedRoot, "manifest.json");

    return [
      `Workspace root: ${workspaceRoot}`,
      "Live repo-local surfaces to inspect first: .github/agents/, .github/skills/, .github/prompts/, .agents/, AGENTS.md, and nearby *.agent.md or *.instructions.md files.",
      `Staged bundled mirror: ${formatPromptPathForWorkspace(workspaceRoot, stagedRoot)}`,
      `Staged manifest: ${formatPromptPathForWorkspace(workspaceRoot, manifestPath)}`,
    ].join("\n");
  });

  return [
    "Please use the copilot-scheduler-agent-merge skill for this task.",
    "Treat the live repo-local agent system as user-owned and as the source of truth.",
    "Compare the live repo-local agent surfaces against the staged bundled starter-agent mirror and summarize merge candidates instead of replacing whole trees.",
    "Do not modify the live .github/agents tree during this comparison, and keep the staged mirror reference-only unless I explicitly ask to regenerate it.",
    "",
    "Compare these surfaces:",
    workspaceSections.join("\n\n"),
    "",
    "Focus on role ideas worth adopting, routing or escalation rules worth copying, reusable skills or knowledge files worth adding, and overlapping files where only selected sections should be merged.",
    "After the comparison, ask me which merge candidates I want to adopt before editing.",
  ].join("\n");
}

async function launchBundledAgentMergePrompt(
  workspaceRoots: string[],
  stageResult: StagedBundledAgentsResult,
): Promise<void> {
  try {
    await copilotExecutor.executePrompt(
      buildBundledAgentMergePrompt(workspaceRoots, stageResult),
      {
        chatSession: "new",
      },
    );
  } catch (error) {
    // executePrompt already warns and offers clipboard fallback when needed.
    logExtensionErrorWithSanitizedDetails(
      "[CopilotScheduler] Failed to launch bundled agent merge chat:",
      error,
    );
  }
}

async function syncCodexSkills(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
): Promise<BundledSkillSyncResult> {
  const syncState = context.globalState.get<BundledSkillSyncState>(
    CODEX_SKILL_SYNC_STATE_KEY,
    {},
  );
  const syncResult = await syncBundledCodexSkillsForWorkspaceRoots(
    context.extensionUri.fsPath,
    workspaceRoots,
    syncState,
  );
  await context.globalState.update(
    CODEX_SKILL_SYNC_STATE_KEY,
    syncResult.nextState,
  );
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
  notifyInfoWithUi({
    message,
    timeoutMs,
    shouldNotify: isNotificationActive(),
    mode: resolveNotifyMode(),
  });
}

export function notifyError(message: string, timeoutMs = 6000): void {
  notifyErrorWithUi({
    message,
    timeoutMs,
    mode: resolveNotifyMode(),
    redactPathsForLog,
    fallbackMessage: messages.webviewUnknown() || "",
    logError,
  });
}

function buildCustomSubAgentSettingUri(
  uriScheme = vscode.env.uriScheme,
): vscode.Uri {
  return vscode.Uri.parse(`${uriScheme}://settings/${CUSTOM_SUBAGENT_SETTING_KEY}`);
}

async function openCustomSubAgentSetting(): Promise<void> {
  try {
    const opened = await vscode.env.openExternal(buildCustomSubAgentSettingUri());
    if (opened) {
      return;
    }
  } catch {
    // Fall back to the command-based settings search below.
  }

  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    CUSTOM_SUBAGENT_SETTING_KEY,
  );
}

async function notifyCustomSubAgentSetupRequirement(): Promise<void> {
  const choice = await vscode.window.showInformationMessage(
    "Setup completed. Enable GitHub Copilot custom sub-agents to use this workspace setup.",
    OPEN_COPILOT_SETTING_ACTION,
  );

  if (choice === OPEN_COPILOT_SETTING_ACTION) {
    await openCustomSubAgentSetting();
  }
}

// Global instances
let scheduler: ScheduleManager;
let copilotExecutor: CopilotExecutor; // local-diverge-452
let researchManager: ResearchManager;
let taskTreeView: ScheduledTaskTreeProvider;
let promptRefreshTimer: ReturnType<typeof setInterval> | undefined;
let extensionContext: vscode.ExtensionContext | undefined;
let currentCockpitBoard: CockpitBoard | undefined;
let currentCockpitBoardWorkspaceRoot: string | undefined;
let cockpitBoardSqliteHydrationPromise: Promise<void> | undefined;
let hasPromptedForMcpSetupThisSession = false;
let extensionVersionChangedThisSession = false;
let shouldAutoRepairWorkspaceSupportThisSession = false;
let externalAgentAccessManager: ExternalAgentAccessManager | undefined;
let externalAgentControlServerManager: ExternalAgentControlServerManager | undefined;
let externalAgentSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

function shouldSuppressSqliteWorkForStaleRuntime(operation: string): boolean {
  if (!extensionContext) {
    return false;
  }

  return shouldSuppressSqliteWorkForExtensionContext({
    context: extensionContext,
    onStaleRuntimeDetected: (status) => {
      const latestInstalledVersion = status.latestInstalledVersion ?? status.activeVersion;
      logInfo(
        `[CopilotScheduler] Suppressing SQLite ${operation} in stale runtime v${status.activeVersion}; installed v${latestInstalledVersion} is waiting for reload.`,
      );
      warnStaleRuntimeSqliteSuppressedWithUi(status.activeVersion, latestInstalledVersion);
    },
  });
}

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

let lastPendingReadyTodoDraftIds = new Set<string>();

function getPendingReadyTodoDrafts(
  board: CockpitBoard,
  tasks: ScheduledTask[],
) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return (board.cards ?? []).filter((card) => {
    if (!card || card.archived || card.sectionId === "recurring-tasks") {
      return false;
    }
    if (getActiveCockpitWorkflowFlag(card.flags) !== COCKPIT_READY_FLAG) {
      return false;
    }
    const linkedTask = card.taskId ? taskById.get(card.taskId) : undefined;
    return !isTodoDraftTask(linkedTask);
  });
}

function notifyPendingReadyTodoDrafts(
  board: CockpitBoard,
  tasks: ScheduledTask[],
): void {
  const pendingReadyTodos = getPendingReadyTodoDrafts(board, tasks);
  const nextIds = new Set(pendingReadyTodos.map((todo) => todo.id));
  const addedTodos = pendingReadyTodos.filter((todo) =>
    !lastPendingReadyTodoDraftIds.has(todo.id)
  );
  lastPendingReadyTodoDraftIds = nextIds;

  if (addedTodos.length === 0) {
    return;
  }

  if (addedTodos.length === 1) {
    const todo = addedTodos[0];
    const action = messages.readyTodoDraftActionSingle();
    void vscode.window.showInformationMessage(
      `Ready Todo waiting for task draft: ${todo?.title || "Untitled Todo"}`,
      action,
    ).then(async (choice) => {
      if (choice !== action || !todo?.id || !extensionContext) {
        return;
      }
      await openSchedulerUi(extensionContext, {
        afterShow: () => {
          SchedulerWebview.focusReadyTodoDraft(todo.id);
        },
      });
    });
    return;
  }

  const action = messages.readyTodoDraftActionMultiple();
  void vscode.window.showInformationMessage(
    `${addedTodos.length} ready Todos are waiting for task drafts.`,
    action,
  ).then(async (choice) => {
    if (choice !== action || !extensionContext) {
      return;
    }
    await openSchedulerUi(extensionContext, {
      afterShow: () => {
        SchedulerWebview.switchToTab("list");
      },
    });
  });
}

const schedulerUiRefreshQueue = createUiRefreshQueue(() => {
  const tasks = scheduler.getAllTasks();
  const cockpitBoard = getCurrentCockpitBoard();

  SchedulerWebview.updateTasks(tasks);
  SchedulerWebview.updateJobs(scheduler.getAllJobs());
  SchedulerWebview.updateJobFolders(scheduler.getAllJobFolders());
  SchedulerWebview.updateCockpitBoard(cockpitBoard);
  SchedulerWebview.updateGitHubIntegration(getCurrentGitHubIntegrationView());
  SchedulerWebview.updateTelegramNotification(getCurrentTelegramNotificationView());
  SchedulerWebview.updateExecutionDefaults(getCurrentExecutionDefaults());
  SchedulerWebview.updateReviewDefaults(getCurrentReviewDefaults());
  SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
  SchedulerWebview.updateResearchState(
    researchManager.getAllProfiles(),
    researchManager.getActiveRun(),
    researchManager.getRecentRuns(),
  );
  SchedulerWebview.updateScheduleHistory(
    scheduler.getWorkspaceScheduleHistory(),
  );
  notifyPendingReadyTodoDrafts(cockpitBoard, tasks);
});

function refreshSchedulerUiState(immediate = false): void {
  schedulerUiRefreshQueue.schedule(immediate);
}

async function showSchedulerWebview(
  context: vscode.ExtensionContext,
  onTestPrompt?: (prompt: string, agent?: string, model?: string) => void,
): Promise<void> {
  const tasks = scheduler.getAllTasks();
  await SchedulerWebview.show( // local-diverge-631
    context.extensionUri,
    tasks,
    scheduler.getAllJobs(),
    scheduler.getAllJobFolders(),
    getCurrentCockpitBoard(),
    getCurrentGitHubIntegrationView(),
    getCurrentTelegramNotificationView(),
    getCurrentExecutionDefaults(),
    getCurrentReviewDefaults(),
    getCurrentStorageSettings(),
    researchManager.getAllProfiles(),
    researchManager.getActiveRun(),
    researchManager.getRecentRuns(),
    dispatchTaskAction,
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
    scheduler?.getAllTasks?.() ?? [],
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
    scheduler?.getAllTasks?.() ?? [],
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
  if (shouldSuppressSqliteWorkForStaleRuntime("Cockpit board sync")) {
    return;
  }

  await syncWorkspaceCockpitBoardToSqlite(workspaceRoot, board);
}

async function waitForSqliteStartupHydration(
  deps: StartupSqliteHydrationDeps,
): Promise<void> {
  if (!deps.workspaceRoot || !deps.isSqliteModeEnabled(deps.workspaceRoot)) {
    return;
  }

  const timeoutMs = deps.timeoutMs ?? SQLITE_STARTUP_HYDRATION_TIMEOUT_MS;
  const createTimeout = deps.createTimeout ?? setTimeout;
  const clearTimeoutHandle = deps.clearTimeoutHandle ?? clearTimeout;

  let timedOut = false;

  const hydrationPromise = (async () => {
    try {
      await deps.waitForTaskHydration();
    } catch (error) {
      logError(
        "[CopilotScheduler] SQLite startup task hydration failed; continuing with mirror state:",
        redactPathsForLog(
          toErrorMessage(error),
        ),
      );
    }

    try {
      const boardHydrationPromise = deps.getBoardHydrationPromise();
      if (boardHydrationPromise) {
        await boardHydrationPromise;
      }
    } catch (error) {
      logError(
        "[CopilotScheduler] SQLite startup board hydration failed; continuing with mirror state:",
        redactPathsForLog(
          toErrorMessage(error),
        ),
      );
    }
  })();

  const timeoutPromise = new Promise<void>((resolve) => {
    const timeoutHandle = createTimeout(() => {
      timedOut = true;
      logInfo(
        `[CopilotScheduler] Warning: SQLite startup hydration timed out after ${timeoutMs}ms; continuing with available state.`,
      );
      resolve();
    }, timeoutMs);

    void hydrationPromise.finally(() => {
      if (!timedOut) {
        clearTimeoutHandle(timeoutHandle);
        resolve();
      }
    });
  });

  await timeoutPromise;
}

function scheduleCockpitBoardSqliteHydration(immediate = false): void {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot || !isWorkspaceSqliteModeEnabled(workspaceRoot)) {
    return;
  }
  if (shouldSuppressSqliteWorkForStaleRuntime("Cockpit board hydration")) {
    return;
  }
  if (cockpitBoardSqliteHydrationPromise) {
    return;
  }

  const sqliteDatabasePath = path.join(
    workspaceRoot,
    ".vscode",
    WORKSPACE_SQLITE_DB_FILE,
  );
  const sqliteAuthorityExists = fs.existsSync(sqliteDatabasePath);

  cockpitBoardSqliteHydrationPromise = scheduler.waitForSqliteWorkspaceHydration()
    .then(() => readWorkspaceCockpitBoardFromSqlite(workspaceRoot))
    .then((sqliteBoard) => {
      if (!sqliteBoard && !sqliteAuthorityExists) {
        return;
      }

      const hydratedBoard = ensureTaskTodosInBoard(
        sqliteBoard
          ? normalizeCockpitBoard(sqliteBoard)
          : createDefaultCockpitBoard(),
        scheduler?.getAllTasks?.() ?? [],
      ).board;
      setCurrentCockpitBoard(workspaceRoot, hydratedBoard);
      refreshSchedulerUiState(immediate);
    })
    .catch((error) =>
      logError(
        "[CopilotScheduler] SQLite Cockpit board hydration failed:",
        redactPathsForLog(
          toErrorMessage(error),
        ),
      ),
    )
    .finally(() => {
      cockpitBoardSqliteHydrationPromise = undefined;
    });
}

async function waitForAuthoritativeStartupState(): Promise<void> {
  await waitForSqliteStartupHydration({
    workspaceRoot: getPrimaryWorkspaceRootPath(),
    isSqliteModeEnabled: (workspaceRoot) => isWorkspaceSqliteModeEnabled(workspaceRoot),
    waitForTaskHydration: () => scheduler.waitForSqliteWorkspaceHydration(),
    getBoardHydrationPromise: () => cockpitBoardSqliteHydrationPromise,
  });
}

function getWorkspaceStorageWatchFileNames(): readonly string[] {
  return [
    SCHEDULER_PUBLIC_JSON_FILE,
    SCHEDULER_PRIVATE_JSON_FILE,
    WORKSPACE_SQLITE_DB_FILE,
  ];
}

function getPrimaryWorkspaceFolderUri(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function collectCurrentWorkspaceRoots(): string[] {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  return workspaceRoot ? [workspaceRoot] : [];
}

function isWorkspaceEnabledForCockpit(workspaceRoot: string): boolean {
  return getSchedulerSetting<boolean>("enabled", true, vscode.Uri.file(workspaceRoot)) !== false;
}

function isWorkspaceRootCurrentlyOpen(workspaceRoot: string): boolean {
  const normalizedWorkspaceRoot = path.resolve(workspaceRoot);
  return collectWorkspacePaths().some(
    (candidate) => path.resolve(candidate) === normalizedWorkspaceRoot,
  );
}

function getActiveEditorWorkspaceRoot(): string | undefined {
  const documentUri = vscode.window.activeTextEditor?.document.uri;
  if (!documentUri) {
    return undefined;
  }

  return vscode.workspace.getWorkspaceFolder(documentUri)?.uri.fsPath;
}

async function promptToSelectWorkspaceRootForExternalAgent(
  title: string,
): Promise<string | undefined> {
  const workspaceRoots = collectWorkspacePaths();
  if (workspaceRoots.length === 0) {
    notifyError("Open a workspace folder before configuring external-agent access.");
    return undefined;
  }

  if (workspaceRoots.length === 1) {
    return workspaceRoots[0];
  }

  const activeWorkspaceRoot = getActiveEditorWorkspaceRoot();
  const normalizedActiveWorkspaceRoot = activeWorkspaceRoot
    ? path.resolve(activeWorkspaceRoot)
    : undefined;
  const pick = await vscode.window.showQuickPick(
    workspaceRoots.map((workspaceRoot) => ({
      label: path.basename(workspaceRoot) || workspaceRoot,
      description: workspaceRoot,
      detail:
        normalizedActiveWorkspaceRoot === path.resolve(workspaceRoot)
          ? "Active editor workspace"
          : undefined,
      workspaceRoot,
    })),
    {
      title,
      placeHolder: "Select the workspace folder to configure.",
    },
  );

  return pick?.workspaceRoot;
}

function getExternalAgentControlSocketPath(repoId: string): string {
  return buildExternalAgentControlSocketPath({
    repoId,
    sessionId: externalAgentSessionId,
  });
}

function buildExternalAgentCommandInfo(workspaceRoot: string): {
  command: string;
  args: string[];
  env?: Record<string, string>;
} {
  const launcherPath = getWorkspaceExternalAgentLauncherPath(workspaceRoot);
  const nodeLaunch = resolveNodeLaunchCommand();
  const args =
    nodeLaunch.argsPrefix.length > 0
      ? [...nodeLaunch.argsPrefix, buildNodeShellExecutionCommand(launcherPath)]
      : [launcherPath];

  return {
    command: nodeLaunch.command,
    args,
    ...(nodeLaunch.env ? { env: nodeLaunch.env } : {}),
  };
}

function buildExternalAgentSetupInfoText(
  workspaceRoot: string,
  repoId: string,
): string {
  const launcherPath = getWorkspaceExternalAgentLauncherPath(workspaceRoot);
  const supportDirectory = getWorkspaceExternalAgentSupportDirectory(workspaceRoot);
  const controlSocketPath = getExternalAgentControlSocketPath(repoId);
  const commandInfo = buildExternalAgentCommandInfo(workspaceRoot);
  const environment = {
    ...(commandInfo.env ?? {}),
    [EXTERNAL_AGENT_REPO_ID_ENV_VAR]: repoId,
    [EXTERNAL_AGENT_KEY_ENV_VAR]: "<paste repo key here>",
  };

  return [
    "Copilot Cockpit external-agent setup",
    `Workspace root: ${workspaceRoot}`,
    `Repo ID: ${repoId}`,
    `Launcher path: ${launcherPath}`,
    `Support folder: ${supportDirectory}`,
    `Control endpoint: ${controlSocketPath}`,
    `Command: ${commandInfo.command}`,
    `Args: ${JSON.stringify(commandInfo.args)}`,
    `Environment: ${JSON.stringify(environment, null, 2)}`,
  ].join("\n");
}

async function revealExternalAgentSupportDirectory(workspaceRoot: string): Promise<void> {
  await vscode.commands.executeCommand(
    "revealFileInOS",
    vscode.Uri.file(getWorkspaceExternalAgentSupportDirectory(workspaceRoot)),
  );
}

async function showExternalAgentSetupActions(options: {
  workspaceRoot: string;
  repoId: string;
  key?: string;
  message: string;
  copySetupFirst?: boolean;
}): Promise<void> {
  if (options.copySetupFirst) {
    await vscode.env.clipboard.writeText(
      buildExternalAgentSetupInfoText(options.workspaceRoot, options.repoId),
    );
  }

  const copySetupAction = options.copySetupFirst ? "Copy Setup Again" : "Copy Setup Info";
  const copyKeyAction = options.key ? "Copy Repo Key" : undefined;
  const revealSupportAction = "Reveal Support Folder";
  const choice = await vscode.window.showInformationMessage(
    options.message,
    ...[copySetupAction, copyKeyAction, revealSupportAction].filter(
      (action): action is string => typeof action === "string",
    ),
  );

  if (choice === copySetupAction) {
    await vscode.env.clipboard.writeText(
      buildExternalAgentSetupInfoText(options.workspaceRoot, options.repoId),
    );
    notifyInfo("External-agent setup info copied to clipboard.");
    return;
  }

  if (choice === copyKeyAction && options.key) {
    await vscode.env.clipboard.writeText(options.key);
    notifyInfo("External-agent repo key copied to clipboard.");
    return;
  }

  if (choice === revealSupportAction) {
    await revealExternalAgentSupportDirectory(options.workspaceRoot);
  }
}

async function authorizeExternalAgentWorkspaceRequest(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  request: ExternalAgentControlRequest,
) {
  const accessState = await externalAgentAccessManager?.getWorkspaceAccessState(workspaceRoot);
  const repoKey = await externalAgentAccessManager?.getWorkspaceKey(workspaceRoot);

  return evaluateExternalAgentAuthorization({
    request,
    expectedRepoId: accessState?.repoId,
    expectedKey: repoKey,
    workspaceOpen: isWorkspaceRootCurrentlyOpen(workspaceRoot),
    cockpitActivated: isCockpitWorkspaceActivated(context, workspaceRoot),
    externalAgentEnabled: accessState?.enabled === true,
    extensionEnabled: isWorkspaceEnabledForCockpit(workspaceRoot),
  });
}

async function syncExternalAgentWorkspaceServer(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<void> {
  if (!externalAgentAccessManager || !externalAgentControlServerManager) {
    return;
  }

  const accessState = await externalAgentAccessManager.getWorkspaceAccessState(workspaceRoot);
  const shouldServe =
    accessState?.enabled === true
    && isWorkspaceRootCurrentlyOpen(workspaceRoot)
    && isCockpitWorkspaceActivated(context, workspaceRoot)
    && isWorkspaceEnabledForCockpit(workspaceRoot);

  if (accessState) {
    ensureWorkspaceMcpSupportFiles(workspaceRoot, context.extensionUri.fsPath);
    ensureWorkspaceExternalAgentSupportFiles({
      workspaceRoot,
      repoId: accessState.repoId,
      controlSocketPath: getExternalAgentControlSocketPath(accessState.repoId),
      heartbeatIntervalMs: EXTERNAL_AGENT_HEARTBEAT_INTERVAL_MS,
    });
  }

  if (!shouldServe || !accessState) {
    await externalAgentControlServerManager.stopWorkspaceServer(
      workspaceRoot,
      "workspace access is no longer available",
    );
    return;
  }
  await externalAgentControlServerManager.ensureWorkspaceServer({
    workspaceRoot,
    controlSocketPath: getExternalAgentControlSocketPath(accessState.repoId),
    authorize: (request) => authorizeExternalAgentWorkspaceRequest(context, workspaceRoot, request),
  });
}

async function syncExternalAgentConnectorServers(
  context: vscode.ExtensionContext,
  workspaceRoots = collectWorkspacePaths(),
): Promise<void> {
  const knownWorkspaceRoots = Object.keys(
    externalAgentAccessManager?.getAllWorkspaceAccessEntries() ?? {},
  );
  const uniqueWorkspaceRoots = Array.from(
    new Set([...workspaceRoots, ...knownWorkspaceRoots]),
  );
  for (const workspaceRoot of uniqueWorkspaceRoots) {
    await syncExternalAgentWorkspaceServer(context, workspaceRoot);
  }
}

function getCockpitWorkspaceActivationMap(
  context: vscode.ExtensionContext,
): WorkspaceActivationMap {
  return context.workspaceState.get<WorkspaceActivationMap>(
    COCKPIT_WORKSPACE_ACTIVATION_MAP_KEY,
    {},
  );
}

function isCockpitWorkspaceActivated(
  context: vscode.ExtensionContext,
  workspaceRoot: string | undefined,
): boolean {
  if (!workspaceRoot) {
    return false;
  }

  return getCockpitWorkspaceActivationMap(context)[workspaceRoot] === true;
}

function isCurrentWorkspaceActivatedForCockpit(
  context: vscode.ExtensionContext,
): boolean {
  return isCockpitWorkspaceActivated(context, getPrimaryWorkspaceRootPath());
}

async function setCockpitWorkspaceActivated(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
  activated: boolean,
): Promise<void> {
  const nextState = {
    ...getCockpitWorkspaceActivationMap(context),
  };

  if (activated) {
    nextState[workspaceRoot] = true;
  } else {
    delete nextState[workspaceRoot];
  }

  await context.workspaceState.update(
    COCKPIT_WORKSPACE_ACTIVATION_MAP_KEY,
    nextState,
  );

  void syncExternalAgentConnectorServers(context, [workspaceRoot]).catch((error) =>
    logError(
      "[CopilotScheduler] Failed to sync external-agent connector after workspace activation change:",
      redactPathsForLog(toErrorMessage(error)),
    ),
  );
}

async function promptToActivateWorkspaceForCockpit(
  context: vscode.ExtensionContext,
  workspaceRoot: string,
): Promise<boolean> {
  const activateAction = "Activate for This Workspace";
  const activateAndAutoOpenAction = "Activate and Auto-Open on Startup";
  const choice = await vscode.window.showInformationMessage(
    "Copilot Cockpit needs your approval before creating workspace support files.",
    {
      modal: true,
      detail: [
        "Activating Copilot Cockpit for this workspace may create or update files under .github and .vscode.",
        "Choose whether to activate it once now or also auto-open it for this workspace on startup.",
      ].join("\n\n"),
    },
    activateAction,
    activateAndAutoOpenAction,
    messages.actionCancel(),
  );

  if (choice !== activateAction && choice !== activateAndAutoOpenAction) {
    return false;
  }

  await setCockpitWorkspaceActivated(context, workspaceRoot, true);
  if (choice === activateAndAutoOpenAction) {
    await setAutoShowOnStartupEnabled(true);
  }
  return true;
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

async function initializeCurrentWorkspaceForCockpit(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    return false;
  }

  await ensureSchedulerSkillOnStartup(context, [workspaceRoot]);

  if (isWorkspaceSqliteModeEnabled(workspaceRoot)) {
    await bootstrapWorkspaceSqliteStorage(
      workspaceRoot,
      getSchedulerSetting<boolean>(
        "sqliteJsonMirror",
        true,
        vscode.Uri.file(workspaceRoot),
      ) !== false,
    );
    await bootstrapGlobalSqliteStorage(context.globalStorageUri.fsPath);
    scheduleCockpitBoardSqliteHydration(true);
  }

  SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
  return true;
}

async function ensureWorkspaceActivatedForCockpit(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    return true;
  }

  if (!isCockpitWorkspaceActivated(context, workspaceRoot)) {
    const approved = await promptToActivateWorkspaceForCockpit(
      context,
      workspaceRoot,
    );
    if (!approved) {
      return false;
    }
  }

  await initializeCurrentWorkspaceForCockpit(context);
  return true;
}

async function ensureWorkspaceRootsActivatedForCockpitWrites(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
): Promise<boolean> {
  const uniqueWorkspaceRoots = Array.from(
    new Set(workspaceRoots.filter((workspaceRoot): workspaceRoot is string => !!workspaceRoot)),
  );
  for (const workspaceRoot of uniqueWorkspaceRoots) {
    if (isCockpitWorkspaceActivated(context, workspaceRoot)) {
      continue;
    }

    const approved = await promptToActivateWorkspaceForCockpit(
      context,
      workspaceRoot,
    );
    if (!approved) {
      return false;
    }
  }

  return true;
}

async function openSchedulerUi(
  context: vscode.ExtensionContext,
  options: OpenSchedulerUiOptions = {},
): Promise<void> {
  const workspaceActivated = await ensureWorkspaceActivatedForCockpit(context);

  await showSchedulerWebview(context, options.onTestPrompt);
  refreshSchedulerUiState(true);
  if (options.focusHelpTab) {
    SchedulerWebview.switchToTab("help");
  }
  if (options.afterShow) {
    await options.afterShow();
  }
  if (workspaceActivated) {
    void maybePromptToSetupWorkspaceMcp(context, collectCurrentWorkspaceRoots());
  }
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

function getCurrentReviewDefaults(): ReviewDefaultsView {
  const folderUri = getPrimaryWorkspaceFolderUri();
  const providerSettings = getCurrentProviderSettings(folderUri);
  const defaultNeedsBotReviewPromptTemplate = buildDefaultNeedsBotReviewPromptTemplate(
    providerSettings.searchProvider,
    providerSettings.researchProvider,
  );
  return {
    needsBotReviewCommentTemplate: getWorkspaceSettingWithFallback<string>(
      ["needsBotReviewCommentTemplate", "spotReviewTemplate"],
      DEFAULT_NEEDS_BOT_REVIEW_COMMENT_TEMPLATE,
      folderUri,
    ).trim(),
    needsBotReviewPromptTemplate: getWorkspaceSettingWithFallback<string>(
      ["needsBotReviewPromptTemplate", "botReviewPromptTemplate"],
      defaultNeedsBotReviewPromptTemplate,
      folderUri,
    ),
    needsBotReviewAgent: getWorkspaceSettingWithFallback<string>(
      ["needsBotReviewAgent", "botReviewAgent"],
      "agent",
      folderUri,
    ).trim(),
    needsBotReviewModel: getWorkspaceSettingWithFallback<string>(
      ["needsBotReviewModel", "botReviewModel"],
      "",
      folderUri,
    ).trim(),
    needsBotReviewChatSession: getWorkspaceSettingWithFallback<"new" | "continue">(
      ["needsBotReviewChatSession", "botReviewChatSession"],
      "new",
      folderUri,
    ) === "continue"
      ? "continue"
      : "new",
    readyPromptTemplate: getWorkspaceSettingWithFallback<string>(
      ["readyPromptTemplate"],
      DEFAULT_READY_PROMPT_TEMPLATE,
      folderUri,
    ),
  };
}

function getCurrentStorageSettings(): StorageSettingsView {
  const folderUri = getPrimaryWorkspaceFolderUri();
  const workspaceRoot = folderUri?.fsPath;
  const board = getCurrentCockpitBoard();
  const providerSettings = getCurrentProviderSettings(folderUri);
  return {
    mode: getSchedulerSetting<string>("storageMode", "sqlite", folderUri) === "sqlite"
      ? "sqlite"
      : "json",
    searchProvider: providerSettings.searchProvider,
    researchProvider: providerSettings.researchProvider,
    sqliteJsonMirror: getSchedulerSetting<boolean>("sqliteJsonMirror", true, folderUri) !== false,
    autoIgnorePrivateFiles: getSchedulerSetting<boolean>(
      AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY,
      true,
      folderUri,
    ) !== false,
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
    lastBundledAgentsSyncAt: getWorkspaceTimestamp(
      LAST_BUNDLED_AGENTS_SYNC_MAP_KEY,
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

async function saveReviewDefaults(
  input: Partial<ReviewDefaultsView>,
): Promise<ReviewDefaultsView> {
  const folderUri = getPrimaryWorkspaceFolderUri();
  const target = getExecutionDefaultsTarget();
  const nextNeedsBotReviewCommentTemplate = typeof input.needsBotReviewCommentTemplate === "string"
    ? input.needsBotReviewCommentTemplate.trim()
    : getCurrentReviewDefaults().needsBotReviewCommentTemplate;
  const nextNeedsBotReviewPromptTemplate = typeof input.needsBotReviewPromptTemplate === "string"
    ? input.needsBotReviewPromptTemplate
    : getCurrentReviewDefaults().needsBotReviewPromptTemplate;
  const nextNeedsBotReviewAgent = typeof input.needsBotReviewAgent === "string"
    ? input.needsBotReviewAgent.trim()
    : getCurrentReviewDefaults().needsBotReviewAgent;
  const nextNeedsBotReviewModel = typeof input.needsBotReviewModel === "string"
    ? input.needsBotReviewModel.trim()
    : getCurrentReviewDefaults().needsBotReviewModel;
  const nextNeedsBotReviewChatSession = input.needsBotReviewChatSession === "continue"
    ? "continue"
    : (input.needsBotReviewChatSession === "new"
      ? "new"
      : getCurrentReviewDefaults().needsBotReviewChatSession);
  const nextReadyPromptTemplate = typeof input.readyPromptTemplate === "string"
    ? input.readyPromptTemplate
    : getCurrentReviewDefaults().readyPromptTemplate;

  await updateSchedulerSetting(
    "needsBotReviewCommentTemplate",
    nextNeedsBotReviewCommentTemplate,
    target,
    folderUri,
  );
  await updateSchedulerSetting(
    "needsBotReviewPromptTemplate",
    nextNeedsBotReviewPromptTemplate,
    target,
    folderUri,
  );
  await updateSchedulerSetting(
    "needsBotReviewAgent",
    nextNeedsBotReviewAgent,
    target,
    folderUri,
  );
  await updateSchedulerSetting(
    "needsBotReviewModel",
    nextNeedsBotReviewModel,
    target,
    folderUri,
  );
  await updateSchedulerSetting(
    "needsBotReviewChatSession",
    nextNeedsBotReviewChatSession,
    target,
    folderUri,
  );
  await updateSchedulerSetting(
    "readyPromptTemplate",
    nextReadyPromptTemplate,
    target,
    folderUri,
  );

  return getCurrentReviewDefaults();
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

function getCurrentGitHubIntegrationView(): GitHubIntegrationView {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    const inbox = createEmptyGitHubInboxSnapshot();
    return {
      enabled: false,
      hasConnection: false,
      authStatusText: "No workspace is open.",
      syncStatus: "disabled",
      statusMessage: "GitHub integration is disabled.",
      inbox,
      inboxCounts: {
        issues: 0,
        pullRequests: 0,
        securityAlerts: 0,
        total: 0,
      },
    };
  }
  void refreshCachedGitHubAuthStatus(workspaceRoot);
  return getGitHubIntegrationView(workspaceRoot, cachedGitHubAuthStatus);
}

async function setupWorkspaceMcpConfig(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    notifyError(messages.mcpSetupWorkspaceRequired());
    return false;
  }

  if (!await ensureWorkspaceRootsActivatedForCockpitWrites(context, [workspaceRoot])) {
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
    await notifyCustomSubAgentSetupRequirement();
    return true;
  } catch (error) {
    const errorMessage = // local-diverge-989
      toErrorMessage(error);
    logError(
      "[CopilotScheduler] Failed to update workspace MCP config:",
      redactPathsForLog(errorMessage),
    );
    notifyError(messages.mcpSetupFailed(redactPathsForLog(errorMessage)));
    return false;
  }
}

async function setupWorkspaceCodexConfig(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    notifyError(messages.mcpSetupWorkspaceRequired());
    return false;
  }

  if (!await ensureWorkspaceRootsActivatedForCockpitWrites(context, [workspaceRoot])) {
    return false;
  }

  try {
    const result = upsertSchedulerCodexConfig(
      workspaceRoot,
      context.extensionUri.fsPath,
    );
    notifyInfo(messages.codexSetupCompleted(result.configPath));
    return true;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    logError(
      "[CopilotScheduler] Failed to update workspace Codex config:",
      redactPathsForLog(errorMessage),
    );
    notifyError(messages.codexSetupFailed(redactPathsForLog(errorMessage)));
    return false;
  }
}

async function setupWorkspaceCodexSkills(
  context: vscode.ExtensionContext,
): Promise<boolean> {
  const workspaceRoots = getResolvedWorkspaceRoots(
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
  );
  if (workspaceRoots.length === 0) {
    notifyError(messages.mcpSetupWorkspaceRequired());
    return false;
  }

  if (!await ensureWorkspaceRootsActivatedForCockpitWrites(context, workspaceRoots)) {
    return false;
  }

  try {
    const result = await syncCodexSkills(context, workspaceRoots);
    notifyInfo(
      messages.codexSkillsSetupCompleted(
        result.createdPaths.length,
        result.updatedPaths.length,
        result.skippedPaths.length,
      ),
    );
    return true;
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    logError(
      "[CopilotScheduler] Failed to sync workspace Codex skills:",
      redactPathsForLog(errorMessage),
    );
    notifyError(messages.codexSkillsSetupFailed(redactPathsForLog(errorMessage)));
    return false;
  }
}

async function repairWorkspaceSupportFiles(
  context: vscode.ExtensionContext,
  workspaceRoots: string[],
  mcpRootsNeedingRepair: string[],
  refreshBundledSkills = true,
): Promise<boolean> {
  if (!await ensureWorkspaceRootsActivatedForCockpitWrites(context, workspaceRoots)) {
    return false;
  }

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
      void SchedulerWebview.reloadCachesAndSync(true).catch(() => {});
    }

    SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());

    notifyInfo(
      messages.workspaceSupportRepairCompleted(
        repairedMcpCount,
        syncResult.createdPaths.length,
        syncResult.updatedPaths.length,
      ),
    );
    await notifyCustomSubAgentSetupRequirement();
    return true;
  } catch (error) {
    const errorMessage = // local-diverge-1051
      toErrorMessage(error);
    logError(
      "[CopilotScheduler] Failed to repair workspace support files:",
      redactPathsForLog(errorMessage),
    );
    notifyError(
      messages.workspaceSupportRepairFailed(
        redactPathsForLog(errorMessage),
      ),
    );
    return false;
  }
}

async function maybePromptToSetupWorkspaceMcp(
  context: vscode.ExtensionContext,
  workspaceRoots = collectWorkspacePaths(),
): Promise<void> {
  if (hasPromptedForMcpSetupThisSession) {
    return;
  }

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
        redactPathsForLog(entry.state.reason),
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
  const choice = await vscode.window.showInformationMessage( // info-dialog
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

function shouldAutoShowSchedulerOnStartup(
  context: vscode.ExtensionContext,
): boolean {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  if (workspaceFolders.length === 0) {
    return false;
  }

  return workspaceFolders.some((folder) =>
    getSchedulerSetting<boolean>("autoShowOnStartup", false, folder.uri)
    && isCockpitWorkspaceActivated(context, folder.uri.fsPath),
  );
}

function scheduleAutoShowSchedulerOnStartup(
  context: vscode.ExtensionContext,
): void {
  if (!shouldAutoShowSchedulerOnStartup(context)) {
    return;
  }

  setTimeout(() => {
    void openSchedulerUi(context, { focusHelpTab: true })
      .then(() => {
        SchedulerWebview.updateAutoShowOnStartup(isAutoShowOnStartupEnabled());
      })
      .catch((error) => {
        const errorMessage =
          toErrorMessage(error);
        logError(
          "[CopilotScheduler] Failed to auto-show scheduler on startup:",
          redactPathsForLog(errorMessage),
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
  const overdueTasks = scheduler.getOverdueTasks();
  if (overdueTasks.length === 0) {
    return;
  }

  for (let index = 0; index < overdueTasks.length; index += 1) {
    const taskId = overdueTasks[index].id;
    const task = scheduler.getTask(taskId);
    if (!task) {
      continue;
    }

    const stillOverdue = scheduler
      .getOverdueTasks()
      .some((candidate) => candidate.id === taskId);
    if (!stillOverdue) {
      continue;
    }

    const dueAt = task.nextRun
      ? messages.formatDateTime(task.nextRun)
      : messages.labelNever();

    if (scheduler.isOneTimeTask(task)) {
      const choice = await vscode.window.showWarningMessage( // warn-dialog
        messages.overdueTaskPromptOneTime(task.name, dueAt),
        { modal: true },
        messages.actionRun(),
        messages.actionReschedule(),
        messages.actionCancel(),
      );

      if (choice === messages.actionRun()) {
        const ran = await scheduler.runTaskNow(task.id);
        if (!ran) {
          scheduler.suppressOverdueTasks([task.id]);
          const failedTask = scheduler.getTask(task.id);
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
          scheduler.suppressOverdueTasks(
            overdueTasks.slice(index).map((item) => item.id),
          );
          break;
        }

        await scheduler.rescheduleTaskInMinutes(task.id, delayMinutes);
        notifyInfo(messages.taskRescheduled(task.name, delayMinutes));
        continue;
      }

      scheduler.suppressOverdueTasks(
        overdueTasks.slice(index).map((item) => item.id),
      );
      break;
    }

    const choice = await vscode.window.showWarningMessage( // confirm-dialog
      messages.overdueTaskPromptRecurring(task.name, dueAt),
      { modal: true },
      messages.actionRun(),
      messages.actionWaitNextCycle(),
      messages.actionCancel(),
    );

    if (choice === messages.actionRun()) {
      const ran = await scheduler.runTaskNow(task.id);
      if (!ran) {
        scheduler.suppressOverdueTasks([task.id]);
        const failedTask = scheduler.getTask(task.id);
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
      await scheduler.deferTaskToNextCycle(task.id);
      notifyInfo(messages.taskDeferredToNextCycle(task.name));
      continue;
    }

    scheduler.suppressOverdueTasks(
      overdueTasks.slice(index).map((item) => item.id),
    );
    break;
  }
}

async function runStartupSequence(
  context: vscode.ExtensionContext,
  onExecute: (task: ScheduledTask) => Promise<void>,
): Promise<void> {
  await waitForAuthoritativeStartupState();

  if (getSchedulerSetting<boolean>("enabled", true) !== false) {
    await processOverdueTasksOnStartup();
  }

  scheduleAutoShowSchedulerOnStartup(context);

  if (getSchedulerSetting<boolean>("enabled", true) !== false) {
    scheduler.startScheduler(onExecute);
  } else {
    scheduler.stopScheduler();
  }
}

/**
 * Sync the VS Code chat approval settings to match the configured approval mode.
 */
async function syncApprovalMode(): Promise<void> {
  const mode = normalizeApprovalMode(getSchedulerSetting<string>("approvalMode", "default"));
  const chatToolsConfig = vscode.workspace.getConfiguration("chat.tools");
  const chatConfig = vscode.workspace.getConfiguration("chat");

  const updateNativeApprovalSettings = async (
    autoApprove: boolean,
    autopilotEnabled: boolean,
  ): Promise<void> => {
    await chatToolsConfig.update("autoApprove", autoApprove, vscode.ConfigurationTarget.Global);
    await chatConfig.update("autopilot.enabled", autopilotEnabled, vscode.ConfigurationTarget.Global);
  };

  switch (mode) {
    case "auto-approve":
      CopilotExecutor.setApprovalBootstrapMode("off");
      try {
        await updateNativeApprovalSettings(true, false);
      } catch (error) {
        logExtensionErrorWithSanitizedDetails("[CopilotCockpit] Failed to sync approval mode:", error);
        CopilotExecutor.setApprovalBootstrapMode("yolo");
      }
      return;
    case "autopilot":
      CopilotExecutor.setApprovalBootstrapMode("off");
      try {
        await updateNativeApprovalSettings(true, true);
      } catch (error) {
        logExtensionErrorWithSanitizedDetails("[CopilotCockpit] Failed to sync approval mode:", error);
        CopilotExecutor.setApprovalBootstrapMode("yolo");
      }
      return;
    case "yolo":
      CopilotExecutor.setApprovalBootstrapMode("yolo");
      break;
    default:
      CopilotExecutor.setApprovalBootstrapMode("off");
      break;
  }

  try {
    await updateNativeApprovalSettings(false, false);
  } catch (error) {
    logExtensionErrorWithSanitizedDetails("[CopilotCockpit] Failed to sync approval mode:", error);
  }
}

/**
 * Lifecycle: activate
 */
export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  externalAgentSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  externalAgentAccessManager = new ExternalAgentAccessManager(
    context.globalState,
    context.secrets,
  );
  externalAgentControlServerManager = new ExternalAgentControlServerManager((message, error) => {
    if (error) {
      logError(message, redactPathsForLog(toErrorMessage(error)));
      return;
    }

    logError(message);
  });
  setSchedulerConflictNotifier((message) => { void vscode.window.showWarningMessage(message); });
  // Re-sync prompts after an extension version bump
  {
    const currentVersion = (context.extension.packageJSON as { version?: string }).version ?? "0.0.0";
    const lastVersion = context.globalState.get<string>(PREVIOUS_VERSION_KEY);
    shouldAutoRepairWorkspaceSupportThisSession = !lastVersion || lastVersion !== currentVersion;
    extensionVersionChangedThisSession = Boolean(lastVersion && lastVersion !== currentVersion);
    maybePromptReloadAfterUpdate(currentVersion, lastVersion); void context.globalState.update(PREVIOUS_VERSION_KEY, currentVersion);
  }

  // Bootstrap internal subsystems
  scheduler = new ScheduleManager(context);
  CopilotExecutor.configure(context);
  copilotExecutor = new CopilotExecutor(); // local-diverge-1339
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
          redactPathsForLog(
            toErrorMessage(error),
          ),
        ),
      );
    },
  });
  scheduleCockpitBoardSqliteHydration(true);
  void syncApprovalMode();

  // --- HBG CUSTOM: Watch .vscode/scheduler*.json ---
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const folder = vscode.workspace.workspaceFolders[0];
    const storageWatchers = getWorkspaceStorageWatchFileNames().map((fileName) =>
      vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(folder, `.vscode/${fileName}`),
      )
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
        scheduler.reloadTasks();
        const primaryWorkspaceRoot = getPrimaryWorkspaceRootPath();
        if (primaryWorkspaceRoot) {
          setCurrentCockpitBoard(
            primaryWorkspaceRoot,
            loadCockpitBoardFromMirrors(primaryWorkspaceRoot),
          );
        }
        scheduleCockpitBoardSqliteHydration(true);
        refreshSchedulerUiState(true);
        await syncRecurringPromptBackupsIfNeededWithDeps(
          context,
          getPromptMaintenanceDeps(),
          getPromptMaintenanceKeys(),
          true,
        );
      } catch (error) {
        logError(
          "[CopilotScheduler] Prompt backup sync after scheduler reload failed:",
          redactPathsForLog(
            toErrorMessage(error),
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

    for (const watcher of storageWatchers) {
      watcher.onDidChange((uri) => queueReload(uri));
      watcher.onDidCreate((uri) => queueReload(uri));
      watcher.onDidDelete((uri) => queueReload(uri));
    }

    context.subscriptions.push(...storageWatchers);

    // Also perform an initial reload to catch any existing file
    scheduler.reloadTasks();
    void syncRecurringPromptBackupsIfNeededWithDeps(
      context,
      getPromptMaintenanceDeps(),
      getPromptMaintenanceKeys(),
      true,
    ).catch((error) =>
      logError(
        "[CopilotScheduler] Initial prompt backup sync failed:",
        redactPathsForLog(
          toErrorMessage(error),
        ),
      ),
    );
  }
  // ------------------------------------------------

  taskTreeView = new ScheduledTaskTreeProvider(scheduler);

  // Register callback to refresh tree when tasks change (e.g. from watcher or MCP)
  scheduler.setOnTasksChangedCallback(() => {
    taskTreeView.refresh();
    refreshSchedulerUiState();
  });
  scheduler.setPostExecutionNotifier(() => {
    refreshSchedulerUiState(true);
  });
  researchManager.setOnChangedCallback(() => {
    refreshSchedulerUiState();
  });

  const treeView = createSchedulerTreeView();
  const commands = registerSchedulerCommands(context);

  void syncExternalAgentConnectorServers(context).catch((error) =>
    logError(
      "[CopilotScheduler] Failed to start external-agent connector servers:",
      redactPathsForLog(toErrorMessage(error)),
    ),
  );

  const executeScheduledTask = async (task: ScheduledTask): Promise<void> => {
    await runScheduledTask(task);
  };

  scheduler.setOnExecuteCallback(executeScheduledTask);
  void runStartupSequence(context, executeScheduledTask).catch((error) =>
    logError(
      "[CopilotScheduler] Startup sequence failed:",
      redactPathsForLog(
        toErrorMessage(error),
      ),
    ),
  );

  runPromptMaintenanceCycle(context, true);
  promptRefreshTimer = setInterval(
    () => runPromptMaintenanceCycle(context, false),
    86_400_000, // 24h in ms
  );

  context.subscriptions.push({ // disposable
    dispose: () => clearPromptSyncIntervalHandle(),
  });
  context.subscriptions.push({
    dispose: () => {
      void externalAgentControlServerManager?.dispose();
    },
  });

  // Display the startup banner
  const logLevel = getSchedulerSetting<string>("logLevel", "info");
  if (["info", "debug"].includes(logLevel)) {
    void vscode.window
      .showInformationMessage( // local-diverge-1542
        messages.extensionActive(),
        messages.actionOpenScheduler(),
      )
      .then((choice) => {
        if (choice === messages.actionOpenScheduler()) {
          void openSchedulerUi(context, { focusHelpTab: true }).catch((error) =>
            logError(
              "[CopilotScheduler] Failed to open scheduler from activation notification:",
              redactPathsForLog(
                toErrorMessage(error),
              ),
            ),
          );
        }
      });
  }

  // Listen for locale switches and refresh the webview accordingly
  const workspaceFoldersWatcher = vscode.workspace.onDidChangeWorkspaceFolders(() => {
    void syncExternalAgentConnectorServers(context).catch((error) =>
      logError(
        "[CopilotScheduler] Failed to resync external-agent connector after workspace folder change:",
        redactPathsForLog(toErrorMessage(error)),
      ),
    );
  });
  const settingsWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
    if (affectsCompatibleConfiguration(e, "language")) {
      SchedulerWebview.refreshLanguage(scheduler.getAllTasks());
      taskTreeView.refresh();
    }
    if (affectsCompatibleConfiguration(e, "autoShowOnStartup")) {
      SchedulerWebview.updateAutoShowOnStartup(isAutoShowOnStartupEnabled());
    }
    if (affectsCompatibleConfiguration(e, "approvalMode")) {
      void syncApprovalMode();
      SchedulerWebview.updateApprovalMode(normalizeApprovalMode(getSchedulerSetting<string>("approvalMode", "default")));
    }
    if (
      affectsCompatibleConfiguration(e, "defaultAgent") ||
      affectsCompatibleConfiguration(e, "defaultModel")
    ) {
      SchedulerWebview.updateExecutionDefaults(getCurrentExecutionDefaults());
    }
    if (
      affectsCompatibleConfiguration(e, "spotReviewTemplate") ||
      affectsCompatibleConfiguration(e, "botReviewPromptTemplate") ||
      affectsCompatibleConfiguration(e, "botReviewAgent") ||
      affectsCompatibleConfiguration(e, "botReviewModel") ||
      affectsCompatibleConfiguration(e, "botReviewChatSession") ||
      affectsCompatibleConfiguration(e, "needsBotReviewCommentTemplate") ||
      affectsCompatibleConfiguration(e, "needsBotReviewPromptTemplate") ||
      affectsCompatibleConfiguration(e, "needsBotReviewAgent") ||
      affectsCompatibleConfiguration(e, "needsBotReviewModel") ||
      affectsCompatibleConfiguration(e, "needsBotReviewChatSession") ||
      affectsCompatibleConfiguration(e, "searchProvider") ||
      affectsCompatibleConfiguration(e, "researchProvider") ||
      affectsCompatibleConfiguration(e, "readyPromptTemplate")
    ) {
      SchedulerWebview.updateReviewDefaults(getCurrentReviewDefaults());
    }
    const storageModeChanged = affectsCompatibleConfiguration(e, "storageMode");
    const sqliteJsonMirrorChanged = affectsCompatibleConfiguration(e, "sqliteJsonMirror");
    const autoIgnorePrivateFilesChanged = affectsCompatibleConfiguration(
      e,
      AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY,
    );
    const searchProviderChanged = affectsCompatibleConfiguration(e, "searchProvider");
    const researchProviderChanged = affectsCompatibleConfiguration(e, "researchProvider");
    if (
      storageModeChanged
      || sqliteJsonMirrorChanged
      || autoIgnorePrivateFilesChanged
      || searchProviderChanged
      || researchProviderChanged
    ) {
      SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
      if (autoIgnorePrivateFilesChanged) {
        const workspaceRootsWithAutoIgnoreEnabled = collectWorkspacePaths().filter(
          (workspaceRoot) => getSchedulerSetting<boolean>(
            AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY,
            true,
            vscode.Uri.file(workspaceRoot),
          ) !== false,
        );
        applyPrivateConfigIgnoreForWorkspaceRoots(workspaceRootsWithAutoIgnoreEnabled);
      }
      if (
        storageModeChanged
        && extensionContext
        && isCurrentWorkspaceActivatedForCockpit(extensionContext)
      ) {
        void bootstrapConfiguredSqliteStorage(extensionContext).catch((error) =>
          logError(
            "[CopilotScheduler] SQLite storage bootstrap after settings change failed:",
            redactPathsForLog(
              toErrorMessage(error),
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
    const pathConfigChanged =
      affectsCompatibleConfiguration(e, "globalPromptsPath") ||
      affectsCompatibleConfiguration(e, "globalAgentsPath");
    if (pathConfigChanged) void SchedulerWebview.reloadCachesAndSync(true);
    // Merge timezone and enabled-state recalculation into a single path
    // recomputeAllSchedules() when both change in one event (U22/U24).
    let needsRecalculate = false; // local-diverge-1619
    if (affectsCompatibleConfiguration(e, "timezone")) needsRecalculate = true;
    if (affectsCompatibleConfiguration(e, "enabled")) {
      const enabled = getSchedulerSetting<boolean>("enabled", true);
      if (enabled) { scheduler.startScheduler(executeScheduledTask); needsRecalculate = true; }
      else { scheduler.stopScheduler(); }
      void syncExternalAgentConnectorServers(context).catch((error) =>
        logError(
          "[CopilotScheduler] Failed to resync external-agent connector after enabled change:",
          redactPathsForLog(toErrorMessage(error)),
        ),
      );
    }
    if (needsRecalculate === true) {
      // recomputeAllSchedules → saveTasks → emitTaskListChanged already
      // refreshes the tree via the callback; only Webview needs explicit update. /* local-diverge-1628 */
      refreshTasksAfterConfigurationRecalculation();
    }
    if (affectsCompatibleConfiguration(e, "maxDailyExecutions")) {
      if (getSchedulerSetting<number>("maxDailyExecutions", 24) === 0) {
        void vscode.window.showWarningMessage(messages.unlimitedDailyWarning()); // notify-user
      }
    }
    if (affectsCompatibleConfiguration(e, "maxNewChatSessionsPerHour")) {
      if (getSchedulerSetting<number>("maxNewChatSessionsPerHour", 20) === 0) {
        void vscode.window.showWarningMessage(messages.unlimitedHourlyWarning());
      }
    }
  });

  // Wire up disposable subscriptions
  context.subscriptions.push(treeView, workspaceFoldersWatcher, settingsWatcher, ...commands);
}

/**
 * Lifecycle: deactivate
 */
export function deactivate(): void {
  setSchedulerConflictNotifier(undefined);
  scheduler?.stopScheduler();
  void externalAgentControlServerManager?.dispose();
  SchedulerWebview.dispose(); // cleanup
  // promptRefreshTimer is cleared by the disposable registered in context.subscriptions. /* local-diverge-1649 */
}

/**
 * Run a scheduled task through the executor
 */
async function runScheduledTask(task: ScheduledTask): Promise<void> {
  try {
    // Resolve prompt text
    const promptText = await resolvePromptText(task); // resolve

    // Execute the prompt
    await copilotExecutor.executePrompt(promptText, {
      agent: task.agent,
      model: task.model,
      chatSession: resolveTaskExecutionChatSession(task),
    });
  } catch (error) {
    // executePrompt surfaces its own warning with a clipboard-copy fallback,
    // so only log the error here to avoid double notification. /* local-diverge-1668 */
    // Re-throw so callers (evaluateAndRunDueTasks / runTaskNow) can distinguish
    // distinguish success from failure so lastRun is skipped on error (U15).
    const errorMessage = toErrorMessage(error);
    const safeErrorMessage =
      redactPathsForLog(errorMessage) || errorMessage;
    logError(messages.taskExecutionFailed(task.name, safeErrorMessage)); // exec-err
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

async function resolvePromptText(task: ScheduledTask, preferOpenDocument = true): Promise<string> {
  return resolveTaskPromptTextFromSource({
    task,
    preferOpenDocument,
    workspaceRoots: collectWorkspacePaths(),
    globalPromptsRoot: resolveGlobalPromptsDir(),
    logDebug: (message, details) => logDebug(message, details),
    sanitizeError: redactPathsForLog,
  });
}

function showTaskNotFoundInWebview(): void {
  const message = messages.taskNotFound();
  notifyWebviewError(message);
}

function notifyWebviewError(message: string): void {
  notifyError(message);
  SchedulerWebview.showError(message);
}

function notifyCaughtError(error: unknown): void {
  notifyError(toErrorMessage(error));
}

function notifyCaughtWebviewError(error: unknown): void {
  notifyWebviewError(toErrorMessage(error));
}

function refreshWebviewTasks(): void {
  SchedulerWebview.updateTasks(scheduler.getAllTasks());
}

function notifyAndRefreshTaskList(message: string): void {
  notifyInfo(message);
  refreshWebviewTasks();
}

function notifyToggleState(task: ScheduledTask): void {
  notifyInfo(task.enabled ? messages.taskEnabled(task.name) : messages.taskDisabled(task.name));
}

async function executePromptSmokeTest(prompt: string, agent?: string, model?: string): Promise<void> {
  await copilotExecutor.executePrompt(prompt, { agent, model }).catch((error: unknown) => {
    const errorMessage = toErrorMessage(error);
    const safeErrorMessage = redactPathsForLog(errorMessage) || errorMessage;
    logError(`[CopilotCockpit] Test prompt error: ${safeErrorMessage}`);
  });
}

async function handleWebviewToggleTaskAction(taskId: string): Promise<void> {
  const task = await scheduler.toggleTask(taskId);
  if (!task) {
    notifyWebviewError(messages.taskNotFound());
    return;
  }
  notifyToggleState(task);
  if (task.enabled) await maybeShowDisclaimerOnce(task);
  refreshSchedulerUiState();
}

function finishWebviewTaskEdit(message: string): void {
  notifyInfo(message);
  refreshSchedulerUiState();
  SchedulerWebview.switchToList(message);
}

async function promptForRequiredTaskText(options: {
  prompt: string;
  placeHolder: string;
  value?: string;
}): Promise<string | undefined> {
  const value = await vscode.window.showInputBox(options);
  return value || undefined;
}

async function promptForTaskCreationInput(): Promise<CreateTaskInput | undefined> {
  const name = await promptForRequiredTaskText({
    prompt: messages.enterTaskName(), // input-label
    placeHolder: messages.placeholderTaskName(), // input-hint
  });
  if (!name) return undefined;

  const prompt = await promptForRequiredTaskText({
    prompt: messages.enterPrompt(), // input-label
    placeHolder: messages.placeholderPrompt(), // input-hint
  });
  if (!prompt) return undefined;

  const cronExpression = await promptForRequiredTaskText({
    prompt: messages.enterCronExpression(), placeHolder: messages.placeholderCron(), value: "0 9 * * 1-5",
  });
  if (!cronExpression) return undefined;

  return { name, prompt, cronExpression };
}

async function handleWebviewRunTaskAction(
  taskId: string,
  refreshUiAfterManualRun: () => void,
): Promise<void> {
  const task = scheduler.getTask(taskId);
  if (!task) {
    showTaskNotFoundInWebview();
    return;
  }

  if (!(await confirmRunOutsideWorkspace(task))) {
    return;
  }

  await scheduler.runTaskNow(taskId);
  refreshUiAfterManualRun();
}

async function handleLinkedDraftTaskDeleteChoice(
  task: ScheduledTask,
): Promise<boolean> {
  const workspaceRoot = getPrimaryWorkspaceRootPath();
  if (!workspaceRoot) {
    return false;
  }

  const linkedTodo = findLinkedTodoByTaskId(getCurrentCockpitBoard(), task.id);
  if (!linkedTodo || linkedTodo.archived) {
    return false;
  }

  const deleteDraftOnly = messages.confirmDeleteDraftOnlyAction();
  const deleteDraftAndTodo = messages.confirmDeleteDraftAndTodoAction();
  const choice = await vscode.window.showWarningMessage(
    messages.confirmDeleteLinkedDraftTask(task.name, linkedTodo.title),
    { modal: true },
    deleteDraftOnly,
    deleteDraftAndTodo,
  );
  if (choice !== deleteDraftOnly && choice !== deleteDraftAndTodo) {
    return true;
  }

  if (!(await scheduler.deleteTask(task.id))) {
    showTaskNotFoundInWebview();
    return true;
  }

  if (choice === deleteDraftAndTodo) {
    addCockpitTodoComment(workspaceRoot, linkedTodo.id, {
      body: `Deleted linked draft task: ${task.name || linkedTodo.title}.`,
      author: "system",
      source: "system-event",
      labels: ["task-draft"],
    });
    rejectCockpitTodo(workspaceRoot, linkedTodo.id);
    notifyInfo(messages.draftTaskDeletedWithTodo(task.name, linkedTodo.title));
  } else {
    updateCockpitTodo(workspaceRoot, linkedTodo.id, {
      taskId: "",
      flags: [COCKPIT_NEEDS_USER_REVIEW_FLAG],
    });
    addCockpitTodoComment(workspaceRoot, linkedTodo.id, {
      body: `Deleted linked task draft: ${task.name || linkedTodo.title}. Todo moved back to needs-user-review for manual follow-up.`,
      author: "system",
      source: "system-event",
      labels: ["task-draft", "needs-user-review"],
    });
    notifyInfo(messages.draftTaskDeletedTodoNeedsUserReview(task.name, linkedTodo.title));
  }

  refreshSchedulerUiState();
  return true;
}

async function handleWebviewDeleteTaskAction(taskId: string): Promise<void> {
  const task = scheduler.getTask(taskId);
  if (!task) {
    showTaskNotFoundInWebview();
    return;
  }

  if (task.scope === "workspace" && !scheduler.isTaskBoundToThisWorkspace(task)) {
    const message = messages.cannotDeleteOtherWorkspaceTask(task.name);
    notifyWebviewError(message);
    return;
  }

  if (isTodoDraftTask(task)) {
    const handled = await handleLinkedDraftTaskDeleteChoice(task);
    if (handled) {
      return;
    }
  }

  const confirmation = await vscode.window.showWarningMessage(messages.confirmDelete(task.name), { modal: true }, messages.confirmDeleteYes());
  if (confirmation !== messages.confirmDeleteYes()) {
    return;
  }

  if (!(await scheduler.deleteTask(taskId))) {
    showTaskNotFoundInWebview();
    return;
  }

  notifyInfo(messages.taskDeleted(task?.name ?? "")); // feedback
  refreshSchedulerUiState();
}

async function handleWebviewCopyTaskAction(taskId: string): Promise<void> {
  const task = scheduler.getTask(taskId);
  if (!task) {
    showTaskNotFoundInWebview();
    return;
  }

  await vscode.env.clipboard.writeText(await resolvePromptText(task));
  notifyInfo(messages.promptCopied());
}

async function handleWebviewDuplicateTaskAction(taskId: string): Promise<void> {
  const task = await scheduler.duplicateTask(taskId);
  if (!task) {
    showTaskNotFoundInWebview();
    return;
  }

  notifyInfo(messages.taskDuplicated(task?.name ?? "")); // feedback
  refreshSchedulerUiState();
}

async function handleWebviewMoveTaskAction(taskId: string): Promise<void> {
  const task = scheduler.getTask(taskId);
  if (!task) {
    showTaskNotFoundInWebview();
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(messages.confirmMoveToCurrentWorkspace(task.name), { modal: true }, messages.confirmMoveYes(), messages.actionCancel());
  if (confirmation !== messages.confirmMoveYes()) {
    return;
  }

  const movedTask = await scheduler.moveTaskToCurrentWorkspace(task.id);
  if (!movedTask) {
    showTaskNotFoundInWebview();
    return;
  }

  notifyInfo(messages.taskMovedToCurrentWorkspace(movedTask.name));
  refreshSchedulerUiState();
}

export const __testOnly = {
  buildCustomSubAgentSettingUri,
  buildDefaultNeedsBotReviewPromptTemplate,
  createUiRefreshQueue,
  createWorkspaceSupportRepairPlan,
  createImmediateManualRunRefresh,
  getDefaultReviewTemplateValues: () => ({
    needsBotReviewCommentTemplate: DEFAULT_NEEDS_BOT_REVIEW_COMMENT_TEMPLATE,
    needsBotReviewPromptTemplate: DEFAULT_NEEDS_BOT_REVIEW_PROMPT_TEMPLATE,
    readyPromptTemplate: DEFAULT_READY_PROMPT_TEMPLATE,
  }),
  getCurrentProviderSettings,
  getResearchProviderPromptLabel,
  getSearchProviderPromptLabel,
  getWorkspaceStorageWatchFileNames,
  isCockpitWorkspaceActivated,
  normalizeSearchProvider,
  resolveProviderSettings,
  resolveTaskExecutionChatSession,
  resolvePromptText, // prompt-resolution
  redactPathsForLog,
  ensureSchedulerSkillOnStartup,
  getCurrentStorageSettings,
  shouldSuppressSqliteWorkForExtensionContext,
  waitForSqliteStartupHydration,
};

function createImmediateManualRunRefresh(
  refreshUiState: (immediate?: boolean) => void,
): () => void {
  return () => {
    refreshUiState(true);
  };
}

function collectWorkspacePaths(): string[] {
  const startPaths = (vscode.workspace.workspaceFolders ?? [])
    .map((f) => f.uri.fsPath)
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

  return getResolvedWorkspaceRoots(startPaths);
}

function resolveGlobalPromptsDir(): string | undefined {
  return resolveGlobalPromptsRoot(
    getSchedulerSetting<string>("globalPromptsPath", ""),
  );
}

function dispatchTaskAction(action: TaskAction): void {
  void processTaskActionAsync(action);
}

async function confirmRunOutsideWorkspace(task: ScheduledTask): Promise<boolean> {
  if (task.scope !== "workspace" || scheduler.isTaskBoundToThisWorkspace(task)) return true;
  const choice = await vscode.window.showWarningMessage(messages.confirmRunOutsideWorkspace(task.name), { modal: true }, messages.confirmRunAnyway(), messages.actionCancel());
  return (choice === messages.confirmRunAnyway());
}

async function processTaskActionAsync(action: TaskAction): Promise<void> {
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
        getCurrentTasks: () => scheduler.getAllTasks(),
        getReviewDefaults: () => getCurrentReviewDefaults(),
        executeBotReviewPrompt: async (prompt, options) => {
          await copilotExecutor.executePrompt(prompt, options);
        },
        createTask: (input) => scheduler.createTask(input),
        deleteTask: (taskId) => scheduler.deleteTask(taskId),
        removeLabelFromAllTasks: (labelName) =>
          scheduler.removeLabelFromAllTasks(labelName),
        refreshSchedulerUiState,
        notifyError,
        notifyInfo,
        notifyInfoWithAction: (message, actionLabel, onAction) => {
          void vscode.window.showInformationMessage(message, actionLabel).then((choice) => {
            if (choice === actionLabel) {
              void Promise.resolve(onAction());
            }
          });
        },
        showError: SchedulerWebview.showError,
        noWorkspaceOpenMessage: messages.noWorkspaceOpen(),
        getCurrentGitHubIntegration: () => {
          const workspaceRoot = getPrimaryWorkspaceRootPath();
          return workspaceRoot
            ? getGitHubIntegrationView(workspaceRoot, cachedGitHubAuthStatus)
            : undefined;
        },
        getCurrentGitBranchName: (workspaceRoot) =>
          getCurrentGitBranchNameForWorkspace(workspaceRoot),
      });
      return;
    }

    switch (action.action) {
      case "run": { // action-handler
        await handleWebviewRunTaskAction(action.taskId, refreshUiAfterManualRun);
        break;
      }

      case "toggle": { // action-handler
        await handleWebviewToggleTaskAction(action.taskId);
        break;
      }

      case "delete": { // action-handler
        await handleWebviewDeleteTaskAction(action.taskId);
        break;
      }

      case "edit": { // action-handler
        const isCreateRequest = action.taskId === "__create__";
        if (isCreateRequest && action.data) {
          await warnIfCronTooFrequent(action.data.cronExpression);
          const task = await scheduler.createTask(action.data as CreateTaskInput);
          await maybeShowDisclaimerOnce(task);
          finishWebviewTaskEdit(messages.taskCreated(task.name));
        } else if (action.data != null) {
          await warnIfCronTooFrequent(action.data.cronExpression);
          const task = await scheduler.updateTask(action.taskId, action.data);
          if (!task) {
            const msg = messages.taskNotFound();
            notifyWebviewError(msg);
            break;
          }
          finishWebviewTaskEdit(messages.taskUpdated(task.name));
        }
        break;
      }

      case "copy": { // action-handler
        await handleWebviewCopyTaskAction(action.taskId);
        break;
      }

      case "duplicate": { // action-handler
        await handleWebviewDuplicateTaskAction(action.taskId);
        break;
      }

      case "moveToCurrentWorkspace": { // action-handler
        await handleWebviewMoveTaskAction(action.taskId);
        break;
      }

      case "createJob": {
        if (!action.jobData) {
          break;
        }
        const job = await scheduler.createJob(action.jobData as any);
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
        const job = await scheduler.updateJob(action.jobId, action.jobData as any);
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
        const job = scheduler.getJob(action.jobId);
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
        await scheduler.deleteJob(action.jobId);
        notifyInfo(`Job deleted: ${job.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "duplicateJob": {
        if (!action.jobId) {
          break;
        }
        const duplicated = await scheduler.duplicateJob(action.jobId);
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
        const job = await scheduler.toggleJobPaused(action.jobId);
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
        const folder = await scheduler.createJobFolder(action.folderData as any);
        notifyInfo(`Folder created: ${folder.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "renameJobFolder": {
        if (!action.folderId || !action.folderData) {
          break;
        }
        const folder = await scheduler.renameJobFolder(action.folderId, action.folderData as any);
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
        const folder = scheduler.getJobFolder(action.folderId);
        if (!folder) {
          notifyError(messages.taskNotFound());
          break;
        }
        await scheduler.deleteJobFolder(action.folderId);
        notifyInfo(`Folder deleted: ${folder.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "createJobTask": {
        if (!action.jobId || !action.data) {
          break;
        }
        const task = await scheduler.createTaskInJob(
          action.jobId,
          action.data as CreateTaskInput, // cast
          action.windowMinutes,
        );
        if (!task) {
          notifyError(messages.taskNotFound());
          break; // local-diverge-2139
        }
        notifyInfo(`Job step created: ${task.name}`);
        refreshSchedulerUiState();
        break;
      }

      case "attachTaskToJob": {
        if (!action.jobId || !action.taskId) {
          break;
        }
        const job = await scheduler.attachTaskToJob(
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
        const job = await scheduler.detachTaskFromJob(action.jobId, action.nodeId);
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
        const job = await scheduler.deleteTaskFromJob(
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
        const job = await scheduler.createPauseInJob(action.jobId, {
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
        const job = await scheduler.updateJobPause(
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
        const job = await scheduler.deleteJobPause(action.jobId, action.nodeId);
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
        const job = await scheduler.approveJobPause(action.jobId, action.nodeId);
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
        const resolution = await scheduler.rejectJobPause(
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
        const job = await scheduler.reorderJobNode(
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
        const job = await scheduler.updateJobNodeWindow(
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
        const compiled = await scheduler.compileJobToTask(action.jobId);
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
          const msg = messages.cockpitHistorySnapshotNotFound();
          notifyWebviewError(msg);
          break;
        }

        const historyEntry = scheduler
          .getWorkspaceScheduleHistory()
          .find((entry) => entry.id === action.historyId);
        if (!historyEntry) {
          const msg = messages.cockpitHistorySnapshotNotFound();
          notifyWebviewError(msg);
          break;
        }

        const restored = await scheduler.restoreWorkspaceScheduleHistory(
          action.historyId,
        );
        if (!restored) {
          const msg = messages.cockpitHistorySnapshotNotFound();
          notifyWebviewError(msg);
          break;
        }

        const restoredLabel = messages.formatDateTime(
          new Date(historyEntry.createdAt),
        );
        const restoreMsg = messages.cockpitHistoryRestored(restoredLabel);
        notifyInfo(restoreMsg);
        refreshSchedulerUiState();
        SchedulerWebview.switchToList(restoreMsg);
        break;
      }

      case "refresh": {
        scheduler.reloadTasks();
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

      case "setupCodex": {
        if (!extensionContext) {
          notifyError(messages.mcpSetupWorkspaceRequired());
          break;
        }
        await setupWorkspaceCodexConfig(extensionContext);
        break;
      }

      case "setupCodexSkills": {
        if (!extensionContext) {
          notifyError(messages.mcpSetupWorkspaceRequired());
          break;
        }
        await setupWorkspaceCodexSkills(extensionContext);
        break;
      }

      case "refreshStorageStatus": {
        SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());
        break;
      }

      case "syncBundledSkills": {
        await vscode.commands.executeCommand(
          getCockpitCommandId("syncBundledSkills"),
        );
        break;
      }

      case "syncBundledAgents": {
        if (!extensionContext) {
          notifyError(messages.bundledAgentsSyncWorkspaceRequired());
          break;
        }

        const workspaceRoots = getResolvedWorkspaceRoots(
          (vscode.workspace.workspaceFolders ?? []).map((folder) =>
            folder.uri.fsPath
          ),
        );
        if (workspaceRoots.length === 0) {
          notifyError(messages.bundledAgentsSyncWorkspaceRequired());
          break;
        }

        const syncResult = await syncBundledAgents(extensionContext, workspaceRoots);
        if (!syncResult) {
          break;
        }
        await SchedulerWebview.reloadCachesAndSync(true);
        SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());

        if (
          syncResult.createdPaths.length === 0
          && syncResult.updatedPaths.length === 0
          && syncResult.skippedPaths.length === 0
        ) {
          notifyInfo(messages.bundledAgentsSyncNoChanges());
          break;
        }

        const summary = messages.bundledAgentsSyncCompleted(
          syncResult.createdPaths.length,
          syncResult.updatedPaths.length,
          syncResult.skippedPaths.length,
        );
        if (syncResult.skippedPaths.length > 0) {
          void vscode.window.showWarningMessage(summary);
          break;
        }

        notifyInfo(summary);
        break;
      }

      case "stageBundledAgents": {
        if (!extensionContext) {
          notifyError(messages.bundledAgentsStageWorkspaceRequired());
          break;
        }

        const workspaceRoots = getResolvedWorkspaceRoots(
          (vscode.workspace.workspaceFolders ?? []).map((folder) =>
            folder.uri.fsPath
          ),
        );
        if (workspaceRoots.length === 0) {
          notifyError(messages.bundledAgentsStageWorkspaceRequired());
          break;
        }

        const stageResult = await stageBundledAgents(extensionContext, workspaceRoots);
        if (!stageResult) {
          break;
        }

        notifyInfo(
          messages.bundledAgentsStageCompleted(
            stageResult.stagedPaths.length,
            stageResult.manifestPaths.length,
          ),
        );
        await launchBundledAgentMergePrompt(workspaceRoots, stageResult);
        break;
      }

      case "importStorageFromJson": {
        try {
          await importStorageFromJson();
          scheduler.reloadTasks();
          scheduleCockpitBoardSqliteHydration(true);
          refreshSchedulerUiState(true);
          notifyInfo("Imported JSON mirrors into SQLite storage. Reload the window if you want every runtime surface to rehydrate immediately.");
          SchedulerWebview.switchToTab("settings");
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error ?? "Storage import failed.");
          notifyWebviewError(msg);
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
          notifyWebviewError(msg);
        }
        break;
      }

      case "saveTelegramNotification": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          const msg = messages.noWorkspaceOpen();
          notifyWebviewError(msg);
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

      case "saveGitHubIntegration": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          const msg = messages.noWorkspaceOpen();
          notifyWebviewError(msg);
          break;
        }
        const authStatus = await resolveGitHubAuthentication(
          getGitHubAuthResolverOptions(action.githubData?.apiBaseUrl),
        );
        cachedGitHubAuthStatus = authStatus;
        const view = saveGitHubIntegrationConfig(
          workspaceRoot,
          action.githubData ?? {},
          authStatus,
        );
        SchedulerWebview.updateGitHubIntegration(view);
        notifyInfo("GitHub integration settings saved.");
        SchedulerWebview.switchToTab("settings");
        break;
      }

      case "refreshGitHubIntegration": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          const msg = messages.noWorkspaceOpen();
          notifyWebviewError(msg);
          break;
        }
        const view = await syncGitHubIntegrationInbox(workspaceRoot, {
          resolveAuth: ({ apiBaseUrl }) => resolveGitHubAuthentication(
            getGitHubAuthResolverOptions(apiBaseUrl),
          ),
        });
        cachedGitHubAuthStatus = {
          hasConnection: view.hasConnection,
          authStatusText: view.authStatusText,
        };
        SchedulerWebview.updateGitHubIntegration(view);
        break;
      }

      case "testTelegramNotification": {
        const workspaceRoot = getPrimaryWorkspaceRootPath();
        if (!workspaceRoot) {
          const msg = messages.noWorkspaceOpen();
          notifyWebviewError(msg);
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

      case "saveReviewDefaults": {
        const reviewDefaults = await saveReviewDefaults(
          action.reviewDefaults ?? {},
        );
        SchedulerWebview.updateReviewDefaults(reviewDefaults);
        notifyInfo("Todo workflow prompts updated.");
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
          messages.actionCancel(), // local-diverge-2512
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
    notifyCaughtWebviewError(error);
  }
}

// ────────────────── Command Registration Block ──────────────────

function registerNewTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "createTask",
    async () => {
      try {
        const input = await promptForTaskCreationInput();
        if (!input) return;

        await warnIfCronTooFrequent(input.cronExpression);
        const task = await scheduler.createTask(input);
        await maybeShowDisclaimerOnce(task);
        notifyAndRefreshTaskList(messages.taskCreated(task.name));
      } catch (error) {
        notifyCaughtError(error);
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

      if (!await ensureWorkspaceRootsActivatedForCockpitWrites(context, workspaceRoots)) {
        return;
      }

      try {
        ensurePrivateConfigIgnoredForWorkspaceRoots(workspaceRoots);
        const syncResult = await syncBundledSkills(context, workspaceRoots);
        await SchedulerWebview.reloadCachesAndSync(true);
        SchedulerWebview.updateStorageSettings(getCurrentStorageSettings());

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
        notifyCaughtError(error);
      }
    },
  );
}

function registerCreateTaskGuiCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return registerSchedulerCommand(
    "createTaskGui",
    async () => {
      try {
        await openSchedulerUi(context, {
          onTestPrompt: async (prompt, agent, model) => {
            // Dry-run prompt execution
            // executePrompt already surfaces a user-visible warning with clipboard-copy
            // on failure, so we only log the error here to avoid double notification (U20). /* local-diverge-2664 */
            await executePromptSmokeTest(prompt, agent, model);
          },
          afterShow: () => {
            // The '+' shortcut must always land on a blank create-task form.
            SchedulerWebview.startCreateTask(); // open-form
          },
        });
      } catch (error) { // local-diverge-2673
        notifyCaughtError(error);
      }
    },
  );
}

function registerListTasksCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return registerSchedulerCommand(
    "listTasks",
    async () => {
      try {
        await openSchedulerUi(context, {
          afterShow: () => {
            SchedulerWebview.switchToList();
          },
        });
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerOpenCockpitCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return registerSchedulerCommand(
    "openCockpit",
    async () => {
      try {
        await openSchedulerUi(context);
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerEditTaskCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return registerSchedulerCommand(
    "editTask",
    async (item?: ScheduledTaskItem) => {
      try {
        const taskId =
          item instanceof ScheduledTaskItem
            ? item.task.id
            : await promptToPickTaskId({
                tasks: scheduler.getAllTasks(),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: task.name,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!taskId) return;

        await openSchedulerUi(context, {
          afterShow: () => {
            SchedulerWebview.editTask(taskId); // open-editor
          },
        });
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerRemoveTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "deleteTask",
    async (item?: ScheduledTaskItem) => {
      try {
        const task =
          item instanceof ScheduledTaskItem
            ? item.task
            : await promptToPickTask({
                tasks: scheduler
                  .getAllTasks()
                  .filter(
                    (candidate) =>
                      candidate.scope === "global" ||
                      scheduler.isTaskBoundToThisWorkspace(candidate),
                  ),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: task.name,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!task) return;

        if (task.scope === "workspace" && !scheduler.isTaskBoundToThisWorkspace(task)) {
          notifyError(messages.cannotDeleteOtherWorkspaceTask(task.name)); // guard
          return;
        }

        // Confirm deletion
        const confirm = await vscode.window.showWarningMessage(messages.confirmDelete(task.name), { modal: true }, messages.confirmDeleteYes());

        if (confirm != null && confirm === messages.confirmDeleteYes()) {
          await scheduler.deleteTask(task.id);
          notifyAndRefreshTaskList(messages.taskDeleted(task.name));
        }
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerToggleCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "toggleTask",
    async (item?: ScheduledTaskItem) => {
      try {
        const taskId =
          item instanceof ScheduledTaskItem
            ? item.task.id
            : await promptToPickTaskId({
                tasks: scheduler.getAllTasks(),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: `${task.enabled ? "✅" : "⏸️"} ${task.name}`,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!taskId) return;

        const task = await scheduler.toggleTask(taskId);
        if (task) {
          notifyInfo(task.enabled ? messages.taskEnabled(task.name) : messages.taskDisabled(task.name));
          if (task.enabled) {
            await maybeShowDisclaimerOnce(task);
          }
          refreshWebviewTasks();
        }
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerActivateCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "enableTask",
    async (item?: ScheduledTaskItem) => {
      try {
        const taskId =
          item instanceof ScheduledTaskItem
            ? item.task.id
            : await promptToPickTaskId({
                tasks: scheduler.getAllTasks().filter((task) => !task.enabled),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: `⏸️ ${task.name}`,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!taskId) return;

        const task = await scheduler.setTaskEnabled(taskId, true);
        if (task) {
          notifyInfo(messages.taskEnabled(task.name)); // local-diverge-2823
          await maybeShowDisclaimerOnce(task);
          refreshWebviewTasks();
        }
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerDeactivateCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "disableTask",
    async (item?: ScheduledTaskItem) => {
      try {
        const taskId =
          item instanceof ScheduledTaskItem
            ? item.task.id
            : await promptToPickTaskId({
                tasks: scheduler.getAllTasks().filter((task) => task.enabled),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: `✅ ${task.name}`,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!taskId) return;

        const task = await scheduler.setTaskEnabled(taskId, false);
        if (task) {
          notifyAndRefreshTaskList(messages.taskDisabled(task.name));
        }
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerImmediateRunCommand(): vscode.Disposable {
  const refreshUiAfterManualRun = createImmediateManualRunRefresh(
    refreshSchedulerUiState,
  );

  return registerSchedulerCommand(
    "runNow",
    async (item?: ScheduledTaskItem) => {
      try {
        const task =
          item instanceof ScheduledTaskItem
            ? item.task
            : await promptToPickTask({
                tasks: scheduler.getAllTasks(),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: task.name,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!task) return;

        const confirmed = await confirmRunOutsideWorkspace(task);
        if (!confirmed) return;

        // Immediate execution bypasses jitter and daily caps. Persist lastRun if feasible.
        // Do not retry on failure — executePrompt already shows a warning.
        await scheduler.runTaskNow(task.id);
        refreshUiAfterManualRun();
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerCopyCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "copyPrompt",
    async (item?: ScheduledTaskItem) => {
      try {
        const task =
          item instanceof ScheduledTaskItem
            ? item.task
            : await promptToPickTask({
                tasks: scheduler.getAllTasks(),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: task.name,
                  description:
                    task.prompt.length > 50
                      ? `${task.prompt.substring(0, 50)}...`
                      : task.prompt,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!task) return;

        await vscode.env.clipboard.writeText(await resolvePromptText(task));
        notifyInfo(messages.promptCopied());
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerCloneTaskCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "duplicateTask",
    async (item?: ScheduledTaskItem) => {
      try {
        const taskId =
          item instanceof ScheduledTaskItem
            ? item.task.id
            : await promptToPickTaskId({
                tasks: scheduler.getAllTasks(),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: task.name,
                  description: task.cronExpression,
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!taskId) return;

        const duplicated = await scheduler.duplicateTask(taskId);
        if (duplicated != null) {
          notifyAndRefreshTaskList(messages.taskDuplicated(duplicated.name));
        }
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerRelocateToWorkspaceCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "moveToCurrentWorkspace",
    async (item?: ScheduledTaskItem) => {
      try {
        const task =
          item instanceof ScheduledTaskItem
            ? item.task
            : await promptToPickTask({
                tasks: scheduler
                  .getAllTasks()
                  .filter((task) => task.scope === "workspace"),
                placeHolder: messages.selectTask(),
                describeTask: (task) => ({
                  label: task.name,
                  description: task.workspacePath
                    ? path.basename(task.workspacePath)
                    : "",
                }),
                onEmpty: () => notifyInfo(messages.noTasksFound()),
              });
        if (!task) return;

        const confirm = await vscode.window.showWarningMessage(messages.confirmMoveToCurrentWorkspace(task.name), { modal: true }, messages.confirmMoveYes(), messages.actionCancel());
        if (confirm !== messages.confirmMoveYes()) return;

        const moved = await scheduler.moveTaskToCurrentWorkspace(task.id);
        if (!moved) { notifyError(messages.taskNotFound()); return; }
        notifyAndRefreshTaskList(messages.taskMovedToCurrentWorkspace(moved.name));
      } catch (error) {
        notifyCaughtWebviewError(error);
      }
    },
  );
}

function registerPreferencesCommand(): vscode.Disposable {
  return registerSchedulerCommand(
    "openSettings",
    async () => {
      try {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:local-dev.copilot-cockpit");
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerShowVersionCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return registerSchedulerCommand(
    "showVersion",
    async () => {
      try {
        const packageJson = context.extension.packageJSON as { version: string };
        notifyInfo(messages.versionInfo(packageJson.version || "0.0.0"));
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerEnableExternalAgentAccessCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "enableExternalAgentAccess",
    async () => {
      try {
        const workspaceRoot = await promptToSelectWorkspaceRootForExternalAgent(
          "Enable external-agent access",
        );
        if (!workspaceRoot) {
          return;
        }

        if (!await ensureWorkspaceRootsActivatedForCockpitWrites(context, [workspaceRoot])) {
          return;
        }

        ensureWorkspaceMcpSupportFiles(workspaceRoot, context.extensionUri.fsPath);
        const enabledAccess = await externalAgentAccessManager?.enableWorkspaceAccess(workspaceRoot);
        if (!enabledAccess) {
          notifyError("Unable to enable external-agent access for this workspace.");
          return;
        }

        await syncExternalAgentWorkspaceServer(context, workspaceRoot);
        await showExternalAgentSetupActions({
          workspaceRoot,
          repoId: enabledAccess.repoId,
          key: enabledAccess.key,
          message: `External-agent access enabled for ${path.basename(workspaceRoot) || workspaceRoot}.`,
        });
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerDisableExternalAgentAccessCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "disableExternalAgentAccess",
    async () => {
      try {
        const workspaceRoot = await promptToSelectWorkspaceRootForExternalAgent(
          "Disable external-agent access",
        );
        if (!workspaceRoot) {
          return;
        }

        const disabled = await externalAgentAccessManager?.disableWorkspaceAccess(workspaceRoot);
        await externalAgentControlServerManager?.stopWorkspaceServer(
          workspaceRoot,
          "external-agent access was disabled",
        );

        if (!disabled) {
          notifyInfo("External-agent access was already disabled for this workspace.");
          return;
        }

        notifyInfo(`External-agent access disabled for ${path.basename(workspaceRoot) || workspaceRoot}.`);
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerRotateExternalAgentKeyCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "rotateExternalAgentKey",
    async () => {
      try {
        const workspaceRoot = await promptToSelectWorkspaceRootForExternalAgent(
          "Rotate external-agent repo key",
        );
        if (!workspaceRoot) {
          return;
        }

        const accessState = await externalAgentAccessManager?.getWorkspaceAccessState(workspaceRoot);
        if (!accessState) {
          notifyError("Enable external-agent access for this workspace before rotating its repo key.");
          return;
        }

        const rotated = await externalAgentAccessManager?.rotateWorkspaceKey(workspaceRoot);
        if (!rotated) {
          notifyError("Unable to rotate the external-agent repo key for this workspace.");
          return;
        }

        await externalAgentControlServerManager?.stopWorkspaceServer(
          workspaceRoot,
          "external-agent repo key rotated",
        );
        await syncExternalAgentWorkspaceServer(context, workspaceRoot);
        await showExternalAgentSetupActions({
          workspaceRoot,
          repoId: rotated.repoId,
          key: rotated.key,
          message: `External-agent repo key rotated for ${path.basename(workspaceRoot) || workspaceRoot}.`,
        });
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}

function registerCopyExternalAgentSetupInfoCommand(
  context: vscode.ExtensionContext,
): vscode.Disposable {
  return registerSchedulerCommand(
    "copyExternalAgentSetupInfo",
    async () => {
      try {
        const workspaceRoot = await promptToSelectWorkspaceRootForExternalAgent(
          "Copy external-agent setup info",
        );
        if (!workspaceRoot) {
          return;
        }

        const accessState = await externalAgentAccessManager?.getWorkspaceAccessState(workspaceRoot);
        if (!accessState || accessState.enabled !== true) {
          notifyError("Enable external-agent access for this workspace before copying setup info.");
          return;
        }

        await syncExternalAgentWorkspaceServer(context, workspaceRoot);
        const repoKey = await externalAgentAccessManager?.getWorkspaceKey(workspaceRoot);
        await showExternalAgentSetupActions({
          workspaceRoot,
          repoId: accessState.repoId,
          key: repoKey,
          message: `External-agent setup info copied for ${path.basename(workspaceRoot) || workspaceRoot}.`,
          copySetupFirst: true,
        });
      } catch (error) {
        notifyCaughtError(error);
      }
    },
  );
}


