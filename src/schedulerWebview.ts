/** Webview controller for the Cockpit scheduler surface. */

import * as vscode from "vscode";
import * as path from "path";
import type {
  AgentInfo,
  ChatSessionBehavior,
  CockpitBoard,
  ExecutionDefaultsView,
  JobDefinition,
  JobFolder,
  ModelInfo,
  PromptTemplate,
  ResearchProfile,
  ResearchRun,
  ReviewDefaultsView,
  ScheduledTask,
  ScheduleHistoryEntry,
  SkillReference,
  StorageSettingsView,
  TaskAction,
  TaskScope,
  TelegramNotificationView,
  WebviewToExtensionMessage,
} from "./types";
import { CopilotExecutor } from "./copilotExecutor";
import {
  messages,
  getCurrentLanguage,
} from "./i18n";
import {
  logError,
} from "./logger";
import {
  getCompatibleConfigurationValue,
} from "./extensionCompat";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import {
  buildFriendlyCronBuilderMarkup,
  buildPromptSourceRadioGroupMarkup,
  buildTaskScopeRadioGroupMarkup,
  escapeHtml,
  escapeHtmlAttr,
  formatModelLabel,
  serializeForWebview,
} from "./schedulerWebviewContentUtils";
import { renderSchedulerWebviewDocument } from "./schedulerWebviewDocument";
import { buildSchedulerWebviewStrings } from "./schedulerWebviewStrings";
import { ensurePrivateConfigIgnoredForWorkspaceRoot } from "./privateConfigIgnore";
import {
  createStartCreateTodoMessage,
  createUpdateCockpitBoardMessage,
  handleTodoCockpitWebviewMessage,
} from "./schedulerWebviewCockpitBridge";
import {
  createShowErrorMessage,
  createUpdateExecutionDefaultsMessage,
  createUpdateJobFoldersMessage,
  createUpdateJobsMessage,
  createUpdateResearchStateMessage,
  createUpdateReviewDefaultsMessage,
  createUpdateScheduleHistoryMessage,
  createUpdateStorageSettingsMessage,
  createUpdateTasksMessage,
  createUpdateTelegramNotificationMessage,
} from "./schedulerWebviewMessageFactory";
import { handleSettingsWebviewMessage } from "./schedulerWebviewSettingsHandler";
import { handleTaskWebviewMessage } from "./schedulerWebviewTaskHandler";
import { handleJobWebviewMessage } from "./schedulerWebviewJobHandler";
import { handleResearchWebviewMessage } from "./schedulerWebviewResearchHandler";
import {
  handleTodoFileUploadRequest as handleTodoFileUploadRequestWithHelper,
  sanitizeTodoUploadFileName as sanitizeTodoUploadFileNameWithHelper,
} from "./schedulerWebviewTodoUploads";
import {
  getResolvedWorkspaceRootPaths,
  getGlobalPromptsPath,
} from "./schedulerWebviewTemplateCache";
import {
  createSchedulerWebviewJobDialogContext,
  postAutoShowOnStartup,
  postEditTask,
  postFocusJob,
  postFocusResearchProfile,
  postFocusResearchRun,
  postFocusTask,
  postStartCreateJob,
  postStartCreateTask,
  postSwitchToList,
  postSwitchToTab,
  refreshSchedulerAgentsAndModelsState,
  refreshSchedulerPromptTemplatesState,
  refreshSchedulerSkillReferencesState,
} from "./schedulerWebviewCommands";
import { createSchedulerWebviewCurrentRenderContext } from "./schedulerWebviewRenderContext";
import { buildSchedulerTaskEditorMarkup } from "./schedulerWebviewTaskEditorMarkup";
import { buildSchedulerWebviewChromeStyles } from "./schedulerWebviewChromeStyles";
import { buildSchedulerWebviewSharedStyles } from "./schedulerWebviewSharedStyles";
import { buildSchedulerWebviewExtendedStyles } from "./schedulerWebviewExtendedStyles";
import {
  runSchedulerWebviewBackgroundRefresh,
  seedSchedulerWebviewCatalogFallbacks,
} from "./schedulerWebviewShowSupport";
import { handleSchedulerWebviewCoreMessage } from "./schedulerWebviewMessageRouting";
import {
  postSchedulerCatalogMessages,
} from "./schedulerWebviewState";
import {
  backupGithubFolderSnapshot,
  buildHelpChatPrompt,
  createSchedulerWebviewQueueState,
  flushSchedulerWebviewPendingMessages,
  postSchedulerWebviewMessage,
  resetSchedulerWebviewQueueState,
  type SchedulerWebviewQueueState,
  type SchedulerWebviewMessage,
} from "./schedulerWebviewSupport";
import {
  refreshSchedulerCatalogCaches,
  refreshSchedulerWebviewLanguagePanel,
} from "./schedulerWebviewRenderSupport";
import {
  dispatchCachedCatalogMessages,
  dispatchCockpitBoardUpdate,
  dispatchExecutionDefaultsUpdate,
  dispatchJobFolderUpdate,
  dispatchJobUpdate,
  dispatchResearchStateUpdate,
  dispatchReviewDefaultsUpdate,
  dispatchScheduleHistoryUpdate,
  dispatchStorageSettingsUpdate,
  dispatchTaskUpdate,
  dispatchTelegramNotificationUpdate,
  dispatchWebviewError,
} from "./schedulerWebviewUpdateDispatch";
import {
  createFreshSchedulerPanel,
  replaySchedulerPanel,
} from "./schedulerWebviewPanelLifecycle";
import {
  assignSchedulerWebviewRuntimeState,
  createSchedulerWebviewCatalogState,
  createSchedulerWebviewRuntimeState,
  type SchedulerWebviewCatalogState,
  type SchedulerWebviewRuntimeState,
} from "./schedulerWebviewStateStore";

type OutgoingWebviewMessage = SchedulerWebviewMessage;
const TODO_INPUT_UPLOADS_FOLDER = "cockpit-input-uploads";

export class SchedulerWebview {
  private static panel: vscode.WebviewPanel | undefined;
  private static readonly catalogState = createSchedulerWebviewCatalogState();
  private static readonly runtimeState = createSchedulerWebviewRuntimeState();
  private static readonly messageQueueState = createSchedulerWebviewQueueState({
    batchedMessageTypes: [
      "updateTasks",
      "updateJobs",
      "updateJobFolders",
      "updateCockpitBoard",
      "updateTelegramNotification",
      "updateExecutionDefaults",
      "updateReviewDefaults",
      "updateStorageSettings",
      "updateResearchState",
      "updateScheduleHistory",
      "updateAgents",
      "updateModels",
      "updatePromptTemplates",
      "updateSkills",
    ],
    messageBatchDelayMs: 25,
  });

  private static readCatalogState<K extends keyof SchedulerWebviewCatalogState>(
    key: K,
  ): SchedulerWebviewCatalogState[K] {
    return this.catalogState[key];
  }

  private static writeCatalogState<K extends keyof SchedulerWebviewCatalogState>(
    key: K,
    value: SchedulerWebviewCatalogState[K],
  ): void {
    this.catalogState[key] = value;
  }

  private static readRuntimeState<K extends keyof SchedulerWebviewRuntimeState>(
    key: K,
  ): SchedulerWebviewRuntimeState[K] {
    return this.runtimeState[key];
  }

  private static writeRuntimeState<K extends keyof SchedulerWebviewRuntimeState>(
    key: K,
    value: SchedulerWebviewRuntimeState[K],
  ): void {
    this.runtimeState[key] = value;
  }

  private static readQueueState<K extends keyof SchedulerWebviewQueueState>(
    key: K,
  ): SchedulerWebviewQueueState[K] {
    return this.messageQueueState[key];
  }

  private static writeQueueState<K extends keyof SchedulerWebviewQueueState>(
    key: K,
    value: SchedulerWebviewQueueState[K],
  ): void {
    this.messageQueueState[key] = value;
  }

  private static get cachedAgents(): AgentInfo[] { return this.readCatalogState("agents"); }
  private static set cachedAgents(value: AgentInfo[]) { this.writeCatalogState("agents", value); }
  private static get cachedModels(): ModelInfo[] { return this.readCatalogState("models"); }
  private static set cachedModels(value: ModelInfo[]) { this.writeCatalogState("models", value); }
  private static get cachedPromptTemplates(): PromptTemplate[] { return this.readCatalogState("promptTemplates"); }
  private static set cachedPromptTemplates(value: PromptTemplate[]) { this.writeCatalogState("promptTemplates", value); }
  private static get cachedSkillReferences(): SkillReference[] { return this.readCatalogState("skillReferences"); }
  private static set cachedSkillReferences(value: SkillReference[]) { this.writeCatalogState("skillReferences", value); }
  private static get onTaskActionCallback(): ((action: TaskAction) => void) | undefined { return this.readRuntimeState("onTaskActionCallback"); }
  private static set onTaskActionCallback(value: ((action: TaskAction) => void) | undefined) { this.writeRuntimeState("onTaskActionCallback", value); }
  private static get onTestPromptCallback(): ((prompt: string, agent?: string, model?: string) => void) | undefined { return this.readRuntimeState("onTestPromptCallback"); }
  private static set onTestPromptCallback(value: ((prompt: string, agent?: string, model?: string) => void) | undefined) { this.writeRuntimeState("onTestPromptCallback", value); }
  private static get extensionUri(): vscode.Uri { return this.readRuntimeState("extensionUri") as vscode.Uri; }
  private static set extensionUri(value: vscode.Uri) { this.writeRuntimeState("extensionUri", value); }
  private static get currentTasks(): ScheduledTask[] { return this.readRuntimeState("tasks"); }
  private static set currentTasks(value: ScheduledTask[]) { this.writeRuntimeState("tasks", value); }
  private static get currentJobs(): JobDefinition[] { return this.readRuntimeState("jobs"); }
  private static set currentJobs(value: JobDefinition[]) { this.writeRuntimeState("jobs", value); }
  private static get currentJobFolders(): JobFolder[] { return this.readRuntimeState("jobFolders"); }
  private static set currentJobFolders(value: JobFolder[]) { this.writeRuntimeState("jobFolders", value); }
  private static get currentCockpitBoard(): CockpitBoard { return this.readRuntimeState("cockpitBoard"); }
  private static set currentCockpitBoard(value: CockpitBoard) { this.writeRuntimeState("cockpitBoard", value); }
  private static get currentTelegramNotification(): TelegramNotificationView { return this.readRuntimeState("telegramNotification"); }
  private static set currentTelegramNotification(value: TelegramNotificationView) { this.writeRuntimeState("telegramNotification", value); }
  private static get currentExecutionDefaults(): ExecutionDefaultsView { return this.readRuntimeState("executionDefaults"); }
  private static set currentExecutionDefaults(value: ExecutionDefaultsView) { this.writeRuntimeState("executionDefaults", value); }
  private static get currentReviewDefaults(): ReviewDefaultsView { return this.readRuntimeState("reviewDefaults"); }
  private static set currentReviewDefaults(value: ReviewDefaultsView) { this.writeRuntimeState("reviewDefaults", value); }
  private static get currentStorageSettings(): StorageSettingsView { return this.readRuntimeState("storageSettings"); }
  private static set currentStorageSettings(value: StorageSettingsView) { this.writeRuntimeState("storageSettings", value); }
  private static get currentResearchProfiles(): ResearchProfile[] { return this.readRuntimeState("researchProfiles"); }
  private static set currentResearchProfiles(value: ResearchProfile[]) { this.writeRuntimeState("researchProfiles", value); }
  private static get currentActiveResearchRun(): ResearchRun | undefined { return this.readRuntimeState("activeResearchRun"); }
  private static set currentActiveResearchRun(value: ResearchRun | undefined) { this.writeRuntimeState("activeResearchRun", value); }
  private static get currentRecentResearchRuns(): ResearchRun[] { return this.readRuntimeState("recentResearchRuns"); }
  private static set currentRecentResearchRuns(value: ResearchRun[]) { this.writeRuntimeState("recentResearchRuns", value); }
  private static get currentScheduleHistory(): ScheduleHistoryEntry[] { return this.readRuntimeState("scheduleHistory"); }
  private static set currentScheduleHistory(value: ScheduleHistoryEntry[]) { this.writeRuntimeState("scheduleHistory", value); }
  private static get webviewReady(): boolean { return this.readQueueState("webviewReady"); }
  private static set webviewReady(value: boolean) { this.writeQueueState("webviewReady", value); }
  private static get pendingMessages(): OutgoingWebviewMessage[] { return this.readQueueState("pendingMessages"); }
  private static set pendingMessages(value: OutgoingWebviewMessage[]) { this.writeQueueState("pendingMessages", value); }
  private static get lastBatchedMessageSignatures(): Map<string, string> { return this.readQueueState("lastBatchedMessageSignatures"); }
  private static set lastBatchedMessageSignatures(value: Map<string, string>) { this.writeQueueState("lastBatchedMessageSignatures", value); }
  private static get pendingMessageFlushTimer(): ReturnType<typeof setTimeout> | undefined { return this.readQueueState("pendingMessageFlushTimer"); }
  private static set pendingMessageFlushTimer(value: ReturnType<typeof setTimeout> | undefined) { this.writeQueueState("pendingMessageFlushTimer", value); }

  private static resetWebviewReadyState(): void {
    resetSchedulerWebviewQueueState(this.messageQueueState);
  }

  private static async launchHelpChat(prompt: string): Promise<void> {
    await new CopilotExecutor().executePrompt(
      buildHelpChatPrompt(getCurrentLanguage(), prompt),
      {
        chatSession: "new",
      },
    );
  }

  private static async backupGithubFolder(
    workspaceRoot: string,
  ): Promise<string | undefined> {
    return backupGithubFolderSnapshot(workspaceRoot);
  }

  static dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      // onDidDispose handler will reset panel & readyState
    }
  }

  private static postMessage(message: OutgoingWebviewMessage): void {
    postSchedulerWebviewMessage(
      this.messageQueueState,
      this.panel,
      message,
      () => this.flushPendingMessages(),
    );
  }

  private static flushPendingMessages(): void {
    flushSchedulerWebviewPendingMessages(this.messageQueueState, this.panel);
  }

  static async show(
    extensionUri: vscode.Uri,
    tasks: ScheduledTask[],
    jobs: JobDefinition[],
    jobFolders: JobFolder[],
    cockpitBoard: CockpitBoard,
    telegramNotification: TelegramNotificationView,
    executionDefaults: ExecutionDefaultsView,
    reviewDefaults: ReviewDefaultsView,
    storageSettings: StorageSettingsView,
    researchProfiles: ResearchProfile[],
    activeResearchRun: ResearchRun | undefined,
    recentResearchRuns: ResearchRun[],
    onTaskAction: (action: TaskAction) => void,
    onTestPrompt?: (prompt: string, agent?: string, model?: string) => void,
  ): Promise<void> {
    assignSchedulerWebviewRuntimeState(this.runtimeState, {
      extensionUri,
      tasks,
      jobs,
      jobFolders,
      cockpitBoard,
      telegramNotification,
      executionDefaults,
      reviewDefaults,
      storageSettings,
      researchProfiles,
      activeResearchRun,
      recentResearchRuns,
      onTaskAction,
      onTestPrompt,
    });

    seedSchedulerWebviewCatalogFallbacks({
      cachedAgents: this.cachedAgents,
      cachedModels: this.cachedModels,
      setCachedAgents: (agents) => {
        this.cachedAgents = agents;
      },
      setCachedModels: (models) => {
        this.cachedModels = models;
      },
    });

    const refreshInBackground = (): void => {
      runSchedulerWebviewBackgroundRefresh({
        refreshAgentsAndModelsCache: () => this.refreshAgentsAndModelsCache(true),
        refreshPromptTemplatesCache: () => this.refreshPromptTemplatesCache(true),
        refreshSkillReferencesCache: () => this.refreshSkillReferencesCache(true),
        getCachedAgents: () => this.cachedAgents,
        getCachedModels: () => this.cachedModels,
        getCachedPromptTemplates: () => this.cachedPromptTemplates,
        getCachedSkillReferences: () => this.cachedSkillReferences,
        postMessage: (message) => this.postMessage(message as OutgoingWebviewMessage),
        logError,
        sanitizeError: (details) => this.sanitizeErrorDetailsForUser(details),
      });
    };

    if (this.panel) {
      replaySchedulerPanel({
        panel: this.panel,
        tasks,
        jobs,
        jobFolders,
        cockpitBoard,
        telegramNotification,
        executionDefaults,
        reviewDefaults,
        storageSettings,
        researchProfiles,
        activeResearchRun,
        recentResearchRuns,
        cachedAgents: this.cachedAgents,
        cachedModels: this.cachedModels,
        cachedPromptTemplates: this.cachedPromptTemplates,
        resetReadyState: () => this.resetWebviewReadyState(),
        renderHtml: (webview, currentTasks, agents, models, promptTemplates) =>
          this.getWebviewContent(
            webview,
            currentTasks,
            agents,
            models,
            promptTemplates,
          ),
        updateTasks: (currentTasks) => this.updateTasks(currentTasks),
        updateJobs: (currentJobs) => this.updateJobs(currentJobs),
        updateJobFolders: (folders) => this.updateJobFolders(folders),
        updateCockpitBoard: (board) =>
          this.updateCockpitBoard(board as CockpitBoard),
        updateTelegramNotification: (notification) =>
          this.updateTelegramNotification(notification),
        updateExecutionDefaults: (defaults) =>
          this.updateExecutionDefaults(defaults),
        updateReviewDefaults: (defaults) => this.updateReviewDefaults(defaults),
        updateStorageSettings: (settings) =>
          this.updateStorageSettings(settings),
        updateResearchState: (profiles, activeRun, recentRuns) =>
          this.updateResearchState(profiles, activeRun, recentRuns),
        postCachedCatalogMessages: () => this.postCachedCatalogMessages(),
      });
    } else {
      // New webview instance (or re-created panel) starts as not-ready.
      this.resetWebviewReadyState();

      this.panel = createFreshSchedulerPanel({
        extensionUri,
        tasks,
        cachedAgents: this.cachedAgents,
        cachedModels: this.cachedModels,
        cachedPromptTemplates: this.cachedPromptTemplates,
        renderHtml: (webview, currentTasks, agents, models, promptTemplates) =>
          this.getWebviewContent(
            webview,
            currentTasks,
            agents,
            models,
            promptTemplates,
          ),
        handleMessage: (message: WebviewToExtensionMessage) =>
          this.handleMessage(message),
        sanitizeErrorDetailsForUser: (message) =>
          this.sanitizeErrorDetailsForUser(message),
        showError: (message) => this.showError(message),
        onDidDispose: () => {
          this.panel = undefined;
          this.resetWebviewReadyState();
        },
      });

      refreshInBackground();
    }
  }

  /**
   * Update tasks in the webview
   */
  static updateTasks(tasks: ScheduledTask[]): void {
    dispatchTaskUpdate(this.runtimeState, tasks, (message) => this.postMessage(message));
  }

  static updateJobs(jobs: JobDefinition[]): void {
    dispatchJobUpdate(this.runtimeState, jobs, (message) => this.postMessage(message));
  }

  static updateJobFolders(jobFolders: JobFolder[]): void {
    dispatchJobFolderUpdate(this.runtimeState, jobFolders, (message) =>
      this.postMessage(message),
    );
  }

  static updateCockpitBoard(cockpitBoard: CockpitBoard): void {
    dispatchCockpitBoardUpdate(this.runtimeState, cockpitBoard, (message) =>
      this.postMessage(message),
    );
  }

  static updateTelegramNotification(
    telegramNotification: TelegramNotificationView,
  ): void {
    dispatchTelegramNotificationUpdate(
      this.runtimeState,
      telegramNotification,
      (message) => this.postMessage(message),
    );
  }

  static updateExecutionDefaults(
    executionDefaults: ExecutionDefaultsView,
  ): void {
    dispatchExecutionDefaultsUpdate(this.runtimeState, executionDefaults, (message) =>
      this.postMessage(message),
    );
  }

  static updateReviewDefaults(
    reviewDefaults: ReviewDefaultsView,
  ): void {
    dispatchReviewDefaultsUpdate(this.runtimeState, reviewDefaults, (message) =>
      this.postMessage(message),
    );
  }

  static updateStorageSettings(
    storageSettings: StorageSettingsView,
  ): void {
    dispatchStorageSettingsUpdate(this.runtimeState, storageSettings, (message) =>
      this.postMessage(message),
    );
  }

  static updateResearchState(
    profiles: ResearchProfile[],
    activeRun: ResearchRun | undefined,
    recentRuns: ResearchRun[],
  ): void {
    dispatchResearchStateUpdate(
      this.runtimeState,
      profiles,
      activeRun,
      recentRuns,
      (message) => this.postMessage(message),
    );
  }

  static updateScheduleHistory(entries: ScheduleHistoryEntry[]): void {
    dispatchScheduleHistoryUpdate(this.runtimeState, entries, (message) =>
      this.postMessage(message),
    );
  }

  /**
   * Show an error message inside the webview
   */
  static showError(errorMessage: string): void {
    dispatchWebviewError(
      errorMessage,
      (message) => this.postMessage(message),
      (message) => this.sanitizeErrorDetailsForUser(message),
    );
  }

  private static sanitizeErrorDetailsForUser(message: string): string {
    return sanitizeAbsolutePathDetails(message);
  }

  private static postCachedCatalogMessages(): void {
    dispatchCachedCatalogMessages(
      this.catalogState,
      (message) => this.postMessage(message),
    );
  }

  /**
   * Refresh language in the webview
   */
  static refreshLanguage(tasks: ScheduledTask[]): void {
    this.cachedAgents = CopilotExecutor.getBuiltInAgents();
    this.cachedModels = CopilotExecutor.getFallbackModels();
    refreshSchedulerWebviewLanguagePanel({
      panel: this.panel,
      tasks,
      cachedAgents: this.cachedAgents,
      cachedModels: this.cachedModels,
      cachedPromptTemplates: this.cachedPromptTemplates,
      resetReadyState: () => this.resetWebviewReadyState(),
      renderHtml: (webview, currentTasks, agents, models, promptTemplates) =>
        this.getWebviewContent(
          webview,
          currentTasks,
          agents,
          models,
          promptTemplates,
        ),
      postCachedCatalogMessages: () => this.postCachedCatalogMessages(),
      refreshCachesAndNotifyPanel: (force) =>
        this.refreshCachesAndNotifyPanel(force),
    });
  }

  /**
   * Refresh cached agents/models/templates and notify the webview without rebuilding HTML.
   * Use this for settings changes (e.g., global paths) to avoid resetting form state.
   */
  static async refreshCachesAndNotifyPanel(force = true): Promise<void> {
    await refreshSchedulerCatalogCaches({
      refreshAgentsAndModelsCache: (refreshForce) =>
        this.refreshAgentsAndModelsCache(refreshForce),
      refreshPromptTemplatesCache: (refreshForce) =>
        this.refreshPromptTemplatesCache(refreshForce),
      refreshSkillReferencesCache: (refreshForce) =>
        this.refreshSkillReferencesCache(refreshForce),
      resetAgentsAndModels: () => {
        this.cachedAgents = CopilotExecutor.getBuiltInAgents();
        this.cachedModels = CopilotExecutor.getFallbackModels();
      },
      resetPromptTemplates: () => {
        this.cachedPromptTemplates = [];
      },
      resetSkillReferences: () => {
        this.cachedSkillReferences = [];
      },
      panel: this.panel,
      postCachedCatalogMessages: () => this.postCachedCatalogMessages(),
      force,
    });
  }

  /**
   * Switch to the list tab, optionally showing a success toast
   */
  static switchToList(successMessage?: string): void {
    postSwitchToList((message) => this.postMessage(message), successMessage);
  }

  static switchToTab(tab: "create" | "list" | "jobs" | "board" | "research" | "settings" | "help"): void {
    postSwitchToTab((message) => this.postMessage(message), tab);
  }

  static updateAutoShowOnStartup(enabled: boolean): void {
    postAutoShowOnStartup((message) => this.postMessage(message), enabled);
  }

  /**
   * Force the webview into "create new task" mode (clears edit state and form).
   */
  static startCreateTask(): void {
    postStartCreateTask((message) => this.postMessage(message));
  }

  static startCreateTodo(): void {
    this.postMessage(createStartCreateTodoMessage());
  }

  static startCreateJob(): void {
    postStartCreateJob((message) => this.postMessage(message));
  }

  /**
   * Focus on a specific task
   */
  static focusTask(taskId: string): void {
    postFocusTask((message) => this.postMessage(message), taskId);
  }

  static focusJob(jobId: string, folderId?: string): void {
    postFocusJob((message) => this.postMessage(message), jobId, folderId);
  }

  static focusResearchProfile(researchId?: string): void {
    postFocusResearchProfile((message) => this.postMessage(message), researchId);
  }

  static focusResearchRun(runId?: string): void {
    postFocusResearchRun((message) => this.postMessage(message), runId);
  }

  /**
   * Start editing a specific task (opens edit mode in the webview)
   */
  static editTask(taskId?: string): void {
    postEditTask((message) => this.postMessage(message), taskId);
  }

  private static getJobDialogContext() {
    return createSchedulerWebviewJobDialogContext({
      currentJobs: this.currentJobs,
      currentJobFolders: this.currentJobFolders,
      currentTasks: this.currentTasks,
      onTaskActionCallback: this.onTaskActionCallback,
    });
  }

  private static async handleMessage(
    message: WebviewToExtensionMessage,
  ): Promise<void> {
    // Delegate to extracted tab handlers (order matches original precedence)
    if (handleTodoCockpitWebviewMessage(message, this.onTaskActionCallback)) {
      return;
    }

    if (await handleSettingsWebviewMessage(message, {
      postMessage: (m) => this.postMessage(m),
      launchHelpChat: (p) => this.launchHelpChat(p),
      backupGithubFolder: (r) => this.backupGithubFolder(r),
      updateStorageSettings: (settings) => this.updateStorageSettings(settings),
      updateCockpitBoard: (board) => this.updateCockpitBoard(board as any),
      getCurrentStorageSettings: () => this.currentStorageSettings,
    })) {
      return;
    }

    if (handleTaskWebviewMessage(message, this.onTaskActionCallback)) {
      return;
    }

    if (await handleJobWebviewMessage(message, this.onTaskActionCallback, this.getJobDialogContext())) {
      return;
    }

    if (handleResearchWebviewMessage(message, this.onTaskActionCallback)) {
      return;
    }

    if (
      await handleSchedulerWebviewCoreMessage(message, {
        onTestPrompt: this.onTestPromptCallback,
        refreshAgentsAndModelsCache: (force) =>
          this.refreshAgentsAndModelsCache(force),
        refreshPromptTemplatesCache: (force) =>
          this.refreshPromptTemplatesCache(force),
        refreshSkillReferencesCache: (force) =>
          this.refreshSkillReferencesCache(force),
        getCachedAgents: () => this.cachedAgents,
        getCachedModels: () => this.cachedModels,
        getCachedPromptTemplates: () => this.cachedPromptTemplates,
        getCachedSkillReferences: () => this.cachedSkillReferences,
        postMessage: (payload) => this.postMessage(payload),
        onTaskAction: this.onTaskActionCallback,
        setWebviewReady: (value) => {
          this.webviewReady = value;
        },
        flushPendingMessages: () => this.flushPendingMessages(),
        handleTodoFileUploadRequest: () => this.handleTodoFileUploadRequest(),
      })
    ) {
      return;
    }
  }

  private static sanitizeTodoUploadFileName(fileName: string): string {
    return sanitizeTodoUploadFileNameWithHelper(fileName);
  }

  private static async handleTodoFileUploadRequest(): Promise<void> {
    await handleTodoFileUploadRequestWithHelper({
      workspaceRoot: getResolvedWorkspaceRootPaths()[0],
      uploadsFolderName: TODO_INPUT_UPLOADS_FOLDER,
      strings: buildSchedulerWebviewStrings(getCurrentLanguage()),
      postMessage: (message) => this.postMessage(message),
      ensurePrivateConfigIgnoredForWorkspaceRoot,
      logError,
    });
  }

  private static async refreshAgentsAndModelsCache(force = false): Promise<void> {
    const result = await refreshSchedulerAgentsAndModelsState(
      this.cachedAgents,
      this.cachedModels,
      force,
    );
    this.cachedAgents = result.agents;
    this.cachedModels = result.models;
  }

  private static async refreshPromptTemplatesCache(force = false): Promise<void> {
    this.cachedPromptTemplates = await refreshSchedulerPromptTemplatesState(
      this.cachedPromptTemplates,
      force,
    );
  }

  private static async refreshSkillReferencesCache(force = false): Promise<void> {
    this.cachedSkillReferences = await refreshSchedulerSkillReferencesState(
      this.cachedSkillReferences,
      force,
    );
  }

  private static getWebviewContent(
    webview: vscode.Webview,
    tasks: ScheduledTask[],
    agents: AgentInfo[],
    models: ModelInfo[],
    promptTemplates: PromptTemplate[],
  ): string {
    const renderContext = createSchedulerWebviewCurrentRenderContext({
      extensionUri: this.extensionUri,
      webview,
      tasks,
      agents,
      models,
      promptTemplates,
      currentJobs: this.currentJobs,
      currentJobFolders: this.currentJobFolders,
      currentCockpitBoard: this.currentCockpitBoard,
      currentTelegramNotification: this.currentTelegramNotification,
      currentExecutionDefaults: this.currentExecutionDefaults,
      currentReviewDefaults: this.currentReviewDefaults,
      currentStorageSettings: this.currentStorageSettings,
      currentResearchProfiles: this.currentResearchProfiles,
      currentActiveResearchRun: this.currentActiveResearchRun,
      currentRecentResearchRuns: this.currentRecentResearchRuns,
      cachedSkillReferences: this.cachedSkillReferences,
      workspacePaths: getResolvedWorkspaceRootPaths(),
      currentScheduleHistory: this.currentScheduleHistory,
    });
    const {
      nonce,
      uiLanguage,
      configuredLanguage,
      allPresets,
      strings,
      initialData,
      initialAgents,
      initialModels,
      defaultScope,
      defaultJitterSeconds,
      helpIntroTitleText,
      scriptUri,
    } = renderContext;
    const documentContent = `  <style>
${buildSchedulerWebviewChromeStyles()}

    .global-error-banner.is-visible {
      display: flex;
    }

    .global-error-banner span {
      min-width: 0;
      overflow-wrap: anywhere;
    }

    .help-panel {
      position: relative;
      display: grid;
      gap: 10px;
      isolation: isolate;
      overflow: hidden;
      padding: 6px;
      border-radius: 16px;
    }

    .help-panel > :not(.help-warp-layer) {
      position: relative;
      z-index: 1;
    }

    .help-warp-layer {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      opacity: 0;
      overflow: hidden;
      border-radius: 16px;
      transition: opacity 0.6s ease;
    }

    .help-warp-layer::before {
      content: "";
      position: absolute;
      inset: -15% -12%;
      background:
        radial-gradient(circle at 18% 50%, color-mix(in srgb, var(--vscode-focusBorder) 34%, transparent) 0%, transparent 36%),
        radial-gradient(circle at 30% 52%, color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 30%, transparent) 0%, transparent 22%),
        linear-gradient(110deg, transparent 0%, color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent) 38%, color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 18%, transparent) 52%, transparent 78%);
      filter: blur(22px);
      opacity: 0;
      transform: scale(1.08);
    }

    .help-warp-layer::after {
      content: "";
      position: absolute;
      inset: 0;
      background-image:
        radial-gradient(circle at 10% 18%, color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 70%, transparent) 0 1px, transparent 1.8px),
        radial-gradient(circle at 22% 71%, color-mix(in srgb, var(--vscode-focusBorder) 72%, transparent) 0 1px, transparent 1.8px),
        radial-gradient(circle at 78% 36%, color-mix(in srgb, white 65%, transparent) 0 1px, transparent 1.7px),
        radial-gradient(circle at 64% 82%, color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 55%, transparent) 0 1px, transparent 1.7px),
        radial-gradient(circle at 90% 14%, color-mix(in srgb, white 58%, transparent) 0 1px, transparent 1.8px);
      opacity: 0;
    }

    .help-warp-layer.is-active {
      opacity: 1;
    }

    .help-warp-layer.is-active::before {
      animation: helpWarpGlow 10s ease-out forwards;
    }

    .help-warp-layer.is-active::after {
      animation: helpWarpStars 10s linear forwards;
    }

    .help-warp-layer.is-fading {
      animation: helpWarpLayerFade 3.8s ease forwards;
    }

    .help-warp-streak {
      position: absolute;
      left: -28%;
      top: var(--warp-top, 50%);
      width: var(--warp-length, 180px);
      height: var(--warp-thickness, 2px);
      border-radius: 999px;
      opacity: 0;
      background: linear-gradient(
        90deg,
        transparent 0%,
        color-mix(in srgb, white 14%, transparent) 12%,
        color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 65%, white 35%) 55%,
        transparent 100%
      );
      box-shadow:
        0 0 8px color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 28%, transparent),
        0 0 18px color-mix(in srgb, var(--vscode-focusBorder) 20%, transparent);
      filter: blur(0.25px);
      transform-origin: left center;
      transform: translate3d(-12vw, 0, 0) scaleX(0.22) rotate(var(--warp-rotate, 0deg));
      animation: helpWarpFlight var(--warp-duration, 1.6s) linear var(--warp-delay, 0s) infinite;
    }

    .help-intro {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 10px 14px 12px 14px;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-editorWidget-background) 86%, var(--vscode-editor-background) 14%) 0%,
        var(--vscode-editor-background) 100%);
    }

    .help-intro-title {
      margin: 0 0 4px 0;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
    }

    .help-intro-rocket {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      padding: 0;
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 45%, var(--vscode-panel-border));
      border-radius: 999px;
      background:
        radial-gradient(circle at 30% 30%, color-mix(in srgb, white 34%, transparent) 0%, transparent 52%),
        linear-gradient(135deg, color-mix(in srgb, var(--vscode-focusBorder) 30%, transparent), color-mix(in srgb, var(--vscode-editorInfo-foreground, #5cc8ff) 24%, transparent));
      color: var(--vscode-foreground);
      cursor: pointer;
      box-shadow: 0 0 0 1px color-mix(in srgb, white 4%, transparent), 0 10px 24px color-mix(in srgb, var(--vscode-focusBorder) 18%, transparent);
      transition: transform 0.22s ease, box-shadow 0.22s ease, border-color 0.22s ease;
      flex: 0 0 auto;
    }

    .help-intro-rocket:hover {
      transform: translateY(-1px) scale(1.04);
      box-shadow: 0 0 0 1px color-mix(in srgb, white 8%, transparent), 0 12px 26px color-mix(in srgb, var(--vscode-focusBorder) 24%, transparent);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 70%, white 30%);
    }

    .help-intro-rocket:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }

    .help-intro-rocket-icon {
      display: inline-block;
      font-size: 18px;
      line-height: 1;
      transform-origin: center center;
    }

    .help-intro-rocket.is-launching {
      animation: helpRocketPadPulse 1.2s ease forwards;
    }

    .help-intro-rocket.is-launching .help-intro-rocket-icon {
      animation: helpRocketFlyAway 1.2s cubic-bezier(0.18, 0.84, 0.24, 1) forwards;
    }

    .help-intro-title-text {
      min-width: 0;
    }

    .help-intro-body {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      line-height: 1.45;
    }

    .help-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      align-items: start;
    }

    .help-section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 10px 12px;
      background-color: var(--vscode-editor-background);
      display: grid;
      gap: 7px;
    }

    .help-section.is-featured {
      grid-column: 1 / -1;
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, var(--vscode-focusBorder) 12%);
    }

    .help-section h3 {
      margin: 0;
      font-size: 12px;
    }

    .help-section p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
      font-size: 12px;
    }

    .help-section ul {
      margin: 0;
      padding-left: 18px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.38;
      font-size: 12px;
    }

    .help-section li + li {
      margin-top: 5px;
    }

    @keyframes helpWarpGlow {
      0% {
        opacity: 0;
        transform: scale(1.12);
      }
      14% {
        opacity: 1;
      }
      100% {
        opacity: 0.44;
        transform: scale(1);
      }
    }

    @keyframes helpWarpStars {
      0% {
        opacity: 0;
        transform: translateX(-5%) scale(1.08);
      }
      16% {
        opacity: 0.9;
      }
      100% {
        opacity: 0.2;
        transform: translateX(18%) scale(1);
      }
    }

    @keyframes helpWarpLayerFade {
      0% {
        opacity: 1;
      }
      100% {
        opacity: 0;
      }
    }

    @keyframes helpWarpFlight {
      0% {
        opacity: 0;
        transform: translate3d(-14vw, 0, 0) scaleX(0.18) rotate(var(--warp-rotate, 0deg));
      }
      10% {
        opacity: 0.88;
      }
      100% {
        opacity: 0;
        transform: translate3d(126vw, 0, 0) scaleX(1.18) rotate(var(--warp-rotate, 0deg));
      }
    }

    @keyframes helpRocketPadPulse {
      0% {
        transform: scale(1);
      }
      28% {
        transform: scale(1.08);
      }
      100% {
        transform: scale(1);
      }
    }

    @keyframes helpRocketFlyAway {
      0% {
        opacity: 1;
        transform: translate3d(0, 0, 0) rotate(-12deg) scale(1);
      }
      18% {
        opacity: 1;
        transform: translate3d(6px, -4px, 0) rotate(4deg) scale(1.08);
      }
      100% {
        opacity: 0;
        transform: translate3d(190px, -150p${buildSchedulerWebviewExtendedStyles()}
dth: 560px) {
      .jobs-step-list {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="tab-bar">
    <div class="tabs">
      <button type="button" class="tab-button" data-tab="todo-edit" title="${escapeHtmlAttr(strings.tabTodoEditorCreate)}" aria-label="${escapeHtmlAttr(strings.tabTodoEditorCreate)}"><span class="tab-button-content"><span class="tab-button-symbol" data-tab-symbol="todo-edit" aria-hidden="true">+</span><span class="tab-button-label" data-tab-label="todo-edit" aria-hidden="true"></span></span></button>
      <button type="button" class="tab-button" data-tab="board"><span class="tab-button-content"><span class="tab-button-symbol" aria-hidden="true">▦</span><span>${escapeHtml(strings.tabBoard)}</span></span></button>
      <span class="tab-group-sep"></span>
      <button type="button" class="tab-button" data-tab="create" title="${escapeHtmlAttr(strings.tabTaskEditorCreate)}" aria-label="${escapeHtmlAttr(strings.tabTaskEditorCreate)}"><span class="tab-button-content"><span class="tab-button-symbol" data-tab-symbol="create" aria-hidden="true">+</span><span class="tab-button-label" data-tab-label="create" aria-hidden="true"></span></span></button>
      <button type="button" class="tab-button" data-tab="list"><span class="tab-button-content"><span class="tab-button-symbol" aria-hidden="true">☰</span><span>${escapeHtml(strings.tabList)}</span></span></button>
      <span class="tab-group-sep"></span>
      <button type="button" class="tab-button" data-tab="jobs-edit" title="${escapeHtmlAttr(strings.tabJobsEditorCreate)}" aria-label="${escapeHtmlAttr(strings.tabJobsEditorCreate)}"><span class="tab-button-content"><span class="tab-button-symbol" data-tab-symbol="jobs-edit" aria-hidden="true">+</span><span class="tab-button-label" data-tab-label="jobs-edit" aria-hidden="true"></span></span></button>
      <button type="button" class="tab-button" data-tab="jobs"><span class="tab-button-content"><span class="tab-button-symbol" aria-hidden="true">⛓</span><span>${escapeHtml(strings.tabJobs)}</span></span></button>
      <span class="tab-group-sep"></span>
      <button type="button" class="tab-button" data-tab="research"><span class="tab-button-content"><span class="tab-button-symbol" aria-hidden="true">⌕</span><span>${escapeHtml(strings.tabResearch)}</span></span></button>
    </div>
    <div class="tab-actions">
      <button type="button" class="btn-secondary" id="jobs-show-sidebar-btn" style="display:none;">${escapeHtml(strings.jobsShowSidebar)}</button>
      <button type="button" class="tab-button tab-help-button active" data-tab="help" title="${escapeHtmlAttr(strings.tabHowTo)}">${escapeHtml(strings.tabHelpGlyph)}</button>
      <button type="button" class="tab-button tab-settings-button" data-tab="settings" title="${escapeHtmlAttr(strings.tabTelegram)}">&#9881;</button>
    </div>
  </div>

  <div
    id="global-error-banner"
    class="global-error-banner"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    <span id="global-error-text"></span>
  </div>

  <div id="todo-edit-tab" class="tab-content">
    <div class="todo-editor-shell">
      <div class="todo-editor-header">
        <div>
          <div class="section-title" id="todo-detail-title">${escapeHtml(strings.boardDetailTitleCreate)}</div>
          <p class="note" id="todo-detail-mode-note">${escapeHtml(strings.boardDetailModeCreate)}</p>
          <div id="todo-detail-status" class="note"></div>
        </div>
        <div class="button-group" style="margin:0;">
          <button type="button" class="btn-secondary" id="todo-back-btn">${escapeHtml(strings.boardBackToCockpit)}</button>
        </div>
      </div>

      <form id="todo-detail-form">
        <input type="hidden" id="todo-detail-id">
        <div class="todo-editor-grid">
          <section class="todo-editor-card">
            <div class="form-group" style="margin:0;">
              <label for="todo-title-input">${escapeHtml(strings.boardFieldTitle)}</label>
              <input type="text" id="todo-title-input">
            </div>
            <div class="form-group" style="margin:0;">
              <label for="todo-description-input">${escapeHtml(strings.boardFieldDescription)}</label>
              <textarea id="todo-description-input" style="min-height:180px;"></textarea>
            </div>
            <div class="todo-upload-row">
              <button type="button" class="btn-secondary" id="todo-upload-files-btn">${escapeHtml(strings.boardUploadFiles)}</button>
              <div id="todo-upload-files-note" class="note todo-upload-note">${escapeHtml(strings.boardUploadFilesHint)}</div>
            </div>
            <section class="todo-comments-spotlight" aria-labelledby="todo-comments-heading">
              <div class="todo-comments-spotlight-header">
                <div class="todo-comments-header-copy">
                  <div class="todo-comments-eyebrow">${escapeHtml(strings.boardCommentsEyebrow || "Conversation thread")}</div>
                  <div class="todo-comments-title-row">
                    <div class="section-title" id="todo-comments-heading" style="font-size:13px;">${escapeHtml(strings.boardCommentsTitle)}</div>
                    <span id="todo-comment-count-badge" class="todo-comments-count-badge">${escapeHtml(strings.boardCommentBadgeDraft || "Draft")}</span>
                  </div>
                  <p id="todo-comment-context-note" class="note todo-comments-context-note">${escapeHtml(strings.boardCommentsCreateIntro || "Start the thread early so context, approvals, and decisions do not get buried in the description.")}</p>
                </div>
                <div id="todo-comment-mode-pill" class="todo-comments-mode-pill">${escapeHtml(strings.boardCommentModeCreate || "Kickoff note")}</div>
              </div>

              <div class="todo-comments-layout">
                <div class="todo-comment-thread-shell">
                  <div class="todo-comment-thread-header">
                    <div class="todo-comment-thread-title">${escapeHtml(strings.boardCommentThreadTitle || "Thread preview")}</div>
                    <div id="todo-comment-thread-note" class="note todo-comment-thread-note">${escapeHtml(strings.boardCommentThreadCreateEmpty || "Start typing to preview the kickoff comment.")}</div>
                  </div>
                  <div id="todo-comment-list" class="todo-editor-comments"></div>
                </div>

                <div class="todo-comment-composer-shell">
                  <div class="todo-comment-composer-topline">
                    <div id="todo-comment-composer-title" class="todo-comment-composer-title">${escapeHtml(strings.boardCommentComposerCreateTitle || "Write the kickoff comment")}</div>
                    <div id="todo-comment-composer-note" class="note todo-comment-composer-note">${escapeHtml(strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.")}</div>
                  </div>

                  <div class="form-group" style="margin:0;">
                    <div class="todo-comment-input-label-row">
                      <label for="todo-comment-input">${escapeHtml(strings.boardCommentComposerEditTitle || "Add to the thread")}</label>
                    </div>
                    <textarea id="todo-comment-input" class="todo-comment-textarea" placeholder="${escapeHtmlAttr(strings.boardCommentCreatePlaceholder || "Capture the first decision, approval note, or handoff context for this todo...")}"></textarea>
                  </div>

                  <div class="todo-comment-composer-footer">
                    <p id="todo-comment-draft-status" class="note todo-comment-draft-status">${escapeHtml(strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.")}</p>
                    <div class="button-group" style="margin:0;justify-content:flex-end;">
                      <button type="button" class="btn-secondary" id="todo-add-comment-btn">${escapeHtml(strings.boardAddComment)}</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </section>

          <section class="todo-editor-card">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
              <div class="form-group" style="margin:0;">
                <label for="todo-due-input">${escapeHtml(strings.boardFieldDueAt)}</label>
                <input type="datetime-local" id="todo-due-input">
              </div>
              <div class="form-group" style="margin:0;">
                <label for="todo-priority-input">${escapeHtml(strings.boardFieldPriority)}</label>
                <select id="todo-priority-input"></select>
              </div>
              <div class="form-group" style="margin:0;">
                <label for="todo-section-input">${escapeHtml(strings.boardFieldSection)}</label>
                <select id="todo-section-input"></select>
              </div>
              <div class="form-group" style="margin:0;">
                <label for="todo-linked-task-select">${escapeHtml(strings.boardFieldLinkedTask)}</label>
                <select id="todo-linked-task-select"></select>
              </div>
            </div>
            <div class="form-group" style="margin:0;">
              <label>${escapeHtml(strings.boardFieldLabels)}</label>
              <div id="todo-label-chip-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>
              
              <div class="todo-inline-actions-row">
                <input type="text" id="todo-labels-input" autocomplete="off" placeholder="${escapeHtmlAttr(strings.boardLabelInputPlaceholder)}" style="flex:1;">
                <button type="button" class="btn-secondary" id="todo-label-add-btn">${escapeHtml(strings.boardLabelAdd)}</button>
                <button type="button" class="btn-secondary" id="todo-label-color-save-btn">Save Label</button>
                <span class="todo-color-input-shell">
                  <input type="color" id="todo-label-color-input" value="#4f8cff" title="${escapeHtmlAttr(strings.boardLabelSaveColor)}">
                </span>
              </div>
              <div id="todo-label-suggestions" class="label-suggestion-list"></div>
              
              <div id="todo-label-catalog" class="label-catalog-section"></div>
            </div>
            
            <div class="form-group" style="margin:0;">
              <label>${escapeHtml(strings.boardFieldFlags)}</label>
              <div id="todo-flag-current" style="min-height:24px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
              
              <div class="todo-inline-actions-row" style="margin-top:4px;">
                <input type="text" id="todo-flag-name-input" autocomplete="off" placeholder="New flag name..." style="flex:1;">
                <button type="button" class="btn-secondary" id="todo-flag-add-btn">${escapeHtml(strings.boardFlagAdd)}</button>
                <button type="button" class="btn-secondary" id="todo-flag-color-save-btn">Save Flag</button>
                <span class="todo-color-input-shell">
                  <input type="color" id="todo-flag-color-input" value="#f59e0b" title="Flag color">
                </span>
              </div>
              
              <div id="todo-flag-picker" class="flag-catalog-section"></div>
              <div class="note" style="margin-top:4px;margin-bottom:8px;">${escapeHtml(strings.boardFlagCatalogHint)}</div>
            </div>
            <div id="todo-linked-task-note" class="note">${escapeHtml(strings.boardTaskDraftNote)}</div>
            <div class="button-group todo-editor-action-row">
              <button type="submit" class="btn-primary" id="todo-save-btn">${escapeHtml(strings.boardSaveCreate)}</button>
              <button type="button" class="btn-secondary" id="todo-complete-btn">${escapeHtml(strings.boardCompleteTodo)}</button>
              <button type="button" class="btn-secondary" id="todo-delete-btn">${escapeHtml(strings.boardDeleteTodo)}</button>
              <button type="button" class="btn-secondary" id="todo-create-task-btn">${escapeHtml(strings.boardCreateTask)}</button>
            </div>
          </section>
        </div>
      </form>
    </div>
  </div>
  
  <div id="create-tab" class="tab-content">
    <div class="task-editor-shell">
      <div class="task-editor-header">
        <div class="task-editor-header-copy">
          <div class="section-title">${escapeHtml(strings.taskEditorTitle)}</div>
          <p class="note">${escapeHtml(strings.taskEditorDescription)}</p>
        </div>
      </div>

      ${buildSchedulerTaskEditorMarkup({
        strings,
        allPresets,
        initialAgents,
        initialModels,
        defaultScope,
        defaultJitterSeconds,
      })}
    </div>
  </div>
  
  <div id="list-tab" class="tab-content">
    <div id="success-toast" style="display:none; background:var(--vscode-notificationsInfoIcon-foreground); color:var(--vscode-button-foreground); padding:8px 14px; border-radius:4px; margin-bottom:12px; font-size:13px; opacity:1; transition:opacity 0.5s ease-out;"></div>
    <div class="button-group" style="margin-bottom: 16px;">
      <button class="btn-secondary" id="refresh-btn">${escapeHtml(strings.actionRefresh)}</button>
      <button class="btn-secondary" id="auto-show-startup-btn"></button>
    </div>
    <p class="note" id="auto-show-startup-note" style="margin-top:-8px; margin-bottom:12px;"></p>
    <div class="history-toolbar">
      <label for="schedule-history-select">${escapeHtml(strings.scheduleHistoryLabel)}</label>
      <select id="schedule-history-select"></select>
      <button class="btn-secondary" id="restore-history-btn">${escapeHtml(strings.actionRestoreBackup)}</button>
    </div>
    <p class="note" id="schedule-history-note">${escapeHtml(strings.scheduleHistoryNote)}</p>
    <div id="task-filter-bar" class="task-filter-bar">
      <button type="button" class="btn-secondary task-filter-btn active" data-filter="all">${escapeHtml(strings.labelAllTasks)}</button>
      <button type="button" class="btn-secondary task-filter-btn" data-filter="manual">${escapeHtml(strings.labelManualSessions)}</button>
      <button type="button" class="btn-secondary task-filter-btn" data-filter="recurring">${escapeHtml(strings.labelRecurringTasks)}</button>
      <button type="button" class="btn-secondary task-filter-btn" data-filter="one-time">${escapeHtml(strings.labelOneTimeTasks)}</button>
      <label for="task-label-filter">${escapeHtml(strings.labelFilterByLabel)}</label>
      <select id="task-label-filter" class="task-filter-select">
        <option value="">${escapeHtml(strings.labelAllLabels)}</option>
      </select>
    </div>
    <div id="task-list" class="task-list">
      <div class="empty-state">${escapeHtml(strings.noTasksFound)}</div>
    </div>
  </div>

  <div id="board-tab" class="tab-content">
    <div class="section-title">${escapeHtml(strings.boardTitle)}</div>
    <p class="note">${escapeHtml(strings.boardDescription)}</p>
    <div id="board-filter-sticky" class="board-filter-sticky">
      <div class="board-filter-header">
        <div class="board-filter-title">${escapeHtml(strings.boardFiltersTitle)}</div>
        <button type="button" class="btn-secondary" id="todo-toggle-filters-btn">${escapeHtml(strings.boardHideFilters)}</button>
      </div>
      <div id="board-filter-body" class="board-filter-body">
        <div class="board-filter-grid-shell">
          <div class="board-filter-grid">
            <div class="form-group board-filter-search">
              <label for="todo-search-input">${escapeHtml(strings.boardSearchLabel)}</label>
              <input type="text" id="todo-search-input" placeholder="${escapeHtmlAttr(strings.boardSearchPlaceholder)}">
            </div>
            <div class="form-group">
              <label for="todo-section-filter">${escapeHtml(strings.boardSectionFilterLabel)}</label>
              <select id="todo-section-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-label-filter">${escapeHtml(strings.boardLabelFilterLabel)}</label>
              <select id="todo-label-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-flag-filter">${escapeHtml(strings.boardFlagFilterLabel)}</label>
              <select id="todo-flag-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-priority-filter">${escapeHtml(strings.boardPriorityFilterLabel)}</label>
              <select id="todo-priority-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-status-filter">${escapeHtml(strings.boardStatusFilterLabel)}</label>
              <select id="todo-status-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-archive-outcome-filter">${escapeHtml(strings.boardArchiveOutcomeFilterLabel)}</label>
              <select id="todo-archive-outcome-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-sort-by">${escapeHtml(strings.boardSortLabel)}</label>
              <select id="todo-sort-by"></select>
            </div>
            <div class="form-group">
              <label for="todo-sort-direction">${escapeHtml(strings.boardSortAsc)}</label>
              <select id="todo-sort-direction"></select>
            </div>
          </div>
        </div>
        <div class="board-filter-footer">
          <div class="board-filter-actions">
            <div class="board-filter-primary-actions">
              <button type="button" class="btn-primary" id="todo-new-btn">${escapeHtml(strings.boardToolbarNew)}</button>
              <button type="button" class="btn-secondary" id="todo-clear-selection-btn">${escapeHtml(strings.boardToolbarClear)}</button>
              <button type="button" class="btn-secondary" id="todo-clear-filters-btn">${escapeHtml(strings.boardToolbarClearFilters)}</button>
            </div>
            <div class="board-filter-view-group">
              <div class="form-group">
                <label for="todo-view-mode">${escapeHtml(strings.boardViewLabel)}</label>
                <select id="todo-view-mode"></select>
              </div>
            </div>
            <div class="board-filter-options">
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
                <input type="checkbox" id="todo-show-recurring-tasks" style="margin:0;">
                ${escapeHtml(strings.boardShowRecurringTasks)}
              </label>
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
                <input type="checkbox" id="todo-show-archived" style="margin:0;">
                ${escapeHtml(strings.boardShowArchived)}
              </label>
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
                <input type="checkbox" id="todo-hide-card-details" style="margin:0;">
                ${escapeHtml(strings.boardHideCardDetails)}
              </label>
              <div class="board-col-width-group">
                <label for="cockpit-col-slider">Column width</label>
                <input type="range" id="cockpit-col-slider" min="180" max="520" value="240" step="10">
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="board-summary" class="note"></div>
    <div class="note" style="margin-bottom:12px;">${escapeHtml(strings.boardDropHint)}</div>
    <div class="board-toolbar">
      <button type="button" class="btn-secondary" id="board-add-section-btn">${escapeHtml(strings.boardAddSection)}</button>
      <div id="board-section-inline-form" style="display:none;align-items:center;gap:6px;">
        <input type="text" id="board-section-name-input" placeholder="${escapeHtmlAttr(strings.boardSectionNamePlaceholder)}" style="max-width:180px;">
        <button type="button" class="btn-primary" id="board-section-save-btn">${escapeHtml(strings.commonAdd)}</button>
        <button type="button" class="btn-secondary" id="board-section-cancel-btn">${escapeHtml(strings.commonCancel)}</button>
      </div>
    </div>
    <div class="board-columns-shell">
      <div id="board-columns"></div>
    </div>
    <p class="note">${escapeHtml(strings.boardPrivacyNote)}</p>
  </div>

  <div id="jobs-tab" class="tab-content">
    <div class="jobs-layout" id="jobs-layout">
      <aside class="jobs-sidebar">
        <div class="jobs-sidebar-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div class="section-title" style="margin:0;">${escapeHtml(strings.jobsFoldersTitle)}</div>
            <button type="button" class="btn-secondary" id="jobs-toggle-sidebar-btn" style="padding:2px 8px;font-size:11px;">${escapeHtml(strings.jobsHideSidebar)}</button>
          </div>
          <div class="jobs-toolbar">
            <button type="button" class="btn-secondary" id="jobs-new-folder-btn">${escapeHtml(strings.jobsCreateFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-rename-folder-btn">${escapeHtml(strings.jobsRenameFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-delete-folder-btn">${escapeHtml(strings.jobsDeleteFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-new-job-btn">${escapeHtml(strings.jobsCreateJob)}</button>
          </div>
          <div id="jobs-current-folder-banner" class="jobs-current-folder-banner"></div>
          <div id="jobs-folder-list" class="jobs-folder-list"></div>
        </div>
        <div class="jobs-sidebar-section">
          <div class="section-title">${escapeHtml(strings.jobsTitle)}</div>
          <div id="jobs-list" class="jobs-list"></div>
        </div>
      </aside>

      <section class="jobs-main">
        <div class="jobs-overview-main">
          <div class="jobs-overview-card">
            <div class="section-title">${escapeHtml(strings.jobsOverviewTitle)}</div>
            <p class="note">${escapeHtml(strings.jobsOverviewNote)}</p>
            <div class="button-group" style="margin:0;">
              <button type="button" class="btn-primary" id="jobs-open-editor-btn">${escapeHtml(strings.jobsOpenEditor)}</button>
            </div>
          </div>
          <div class="jobs-overview-card">
            <div class="section-title">${escapeHtml(strings.jobsCurrentFolderLabel)}</div>
            <p class="note">${escapeHtml(strings.jobsSelectJob)}</p>
          </div>
        </div>
      </section>
    </div>
  </div>

  <div id="jobs-edit-tab" class="tab-content">
    <div id="jobs-empty-state" class="jobs-empty">
      <p>${escapeHtml(strings.jobsSelectJob)}</p>
      <button type="button" class="btn-primary" id="jobs-empty-new-btn">${escapeHtml(strings.jobsCreateJob)}</button>
    </div>
    <div id="jobs-details" style="display:none;">
      <div class="jobs-editor-shell">
        <div class="jobs-editor-header">
          <div class="jobs-editor-intro">
            <div class="section-title">${escapeHtml(strings.jobsTitle)}</div>
            <div class="jobs-editor-subtitle">${escapeHtml(strings.jobsSelectJob)}</div>
          </div>
          <div class="jobs-job-toolbar">
            <button type="button" class="btn-secondary" id="jobs-back-btn">${escapeHtml(strings.jobsBackToJobs)}</button>
            <button type="button" class="btn-primary" id="jobs-save-btn">${escapeHtml(strings.jobsSave)}</button>
            <button type="button" class="btn-secondary" id="jobs-duplicate-btn">${escapeHtml(strings.jobsDuplicate)}</button>
            <button type="button" class="btn-secondary" id="jobs-pause-btn">${escapeHtml(strings.jobsPause)}</button>
            <button type="button" class="btn-secondary" id="jobs-compile-btn">${escapeHtml(strings.jobsCompile)}</button>
            <button type="button" class="btn-danger" id="jobs-delete-btn">${escapeHtml(strings.jobsDelete)}</button>
          </div>
        </div>

        <div class="jobs-editor-grid">
          <section class="jobs-main-section jobs-editor-card">
            <div class="section-title">${escapeHtml(strings.jobsEditorDetailsTitle)}</div>
            <p class="note">${escapeHtml(strings.jobsEditorDetailsNote)}</p>
            <div class="jobs-job-grid jobs-job-grid-overview">
              <div class="form-group">
                <label for="jobs-name-input">${escapeHtml(strings.jobsName)}</label>
                <input type="text" id="jobs-name-input">
              </div>
              <div class="form-group">
                <label for="jobs-folder-select">${escapeHtml(strings.jobsFolder)}</label>
                <select id="jobs-folder-select"></select>
              </div>
              <div class="form-group">
                <label>${escapeHtml(strings.labelStatus)}</label>
                <button type="button" id="jobs-status-pill" class="jobs-pill is-toggle" title="${escapeHtmlAttr(strings.jobsToggleStatus)}">${escapeHtml(strings.jobsRunning)}</button>
              </div>
            </div>
          </section>

          <section class="jobs-main-section jobs-editor-card">
            <div class="section-title">${escapeHtml(strings.taskEditorScheduleTitle)}</div>
            <p class="note">${escapeHtml(strings.jobsEditorScheduleNote)}</p>
            <div class="jobs-schedule-grid">
              <div class="form-group">
                <label for="jobs-cron-preset">${escapeHtml(strings.labelPreset)}</label>
                <div class="preset-select">
                  <select id="jobs-cron-preset">
                    <option value="">${escapeHtml(strings.labelCustom)}</option>
                    ${allPresets.map((p) => `<option value="${escapeHtmlAttr(p.expression)}">${escapeHtml(p.name)}</option>`).join("")}
                  </select>
                </div>
              </div>
              <div class="form-group">
                <label for="jobs-cron-input">${escapeHtml(strings.jobsCron)}</label>
                <input type="text" id="jobs-cron-input" placeholder="${escapeHtmlAttr(strings.placeholderCron)}">
              </div>
              <div class="form-group wide">
                <div class="cron-preview">
                  <strong>${escapeHtml(strings.labelFriendlyPreview)}:</strong>
                  <span id="jobs-cron-preview-text">${escapeHtml(strings.labelFriendlyFallback)}</span>
                  <button type="button" class="btn-secondary btn-icon" id="jobs-open-guru-btn">${escapeHtml(strings.labelOpenInGuru)}</button>
                </div>
              </div>
              <div class="form-group wide">
                ${buildFriendlyCronBuilderMarkup(strings, "jobs-friendly")}
              </div>
            </div>
          </section>

          <div class="jobs-workflow-builder-layout">
            <section class="jobs-main-section jobs-editor-card jobs-workflow-card">
              <div class="jobs-workflow-hero">
                <div class="jobs-workflow-copy">
                  <div class="jobs-workflow-badge">⛓ ${escapeHtml(strings.jobsWorkflowBadge)}</div>
                  <div class="section-title jobs-workflow-title">${escapeHtml(strings.jobsWorkflowTitle)}</div>
                  <p class="jobs-workflow-note">${escapeHtml(strings.jobsWorkflowNote)}</p>
                  <div class="jobs-workflow-save-row">
                    <button type="button" class="btn-primary" id="jobs-save-deck-btn">${escapeHtml(strings.jobsSave)}</button>
                  </div>
                </div>
                <div id="jobs-workflow-metrics" class="jobs-workflow-metrics"></div>
              </div>
              <div class="jobs-workflow-panel">
                <div class="jobs-workflow-panel-header">
                  <div class="jobs-workflow-panel-copy">
                    <div class="section-title">${escapeHtml(strings.jobsCompactTimeline)}</div>
                    <p class="note">${escapeHtml(strings.jobsWorkflowTimelineNote)}</p>
                  </div>
                </div>
                <div id="jobs-timeline-inline" class="jobs-timeline-inline">${escapeHtml(strings.jobsTimelineEmpty)}</div>
              </div>
              <div class="jobs-workflow-panel">
                <div class="jobs-workflow-panel-header">
                  <div class="jobs-workflow-panel-copy">
                    <div class="section-title">${escapeHtml(strings.jobsSteps)}</div>
                    <p class="note">${escapeHtml(strings.jobsDropHint)}</p>
                  </div>
                </div>
                <div id="jobs-step-list" class="jobs-step-list"></div>
              </div>
            </section>

            <section class="jobs-main-section jobs-editor-card jobs-workflow-actions-card">
              <div class="jobs-workflow-actions-header">
                <div class="jobs-workflow-actions-badge">＋ Workflow Builder</div>
                <div class="section-title">Add to workflow</div>
                <p class="note">Use quick actions to insert pause checkpoints, attach existing tasks, and draft a new step without leaving the workflow canvas.</p>
              </div>
              <div class="jobs-workflow-actions-grid">
                <div class="jobs-workflow-quick-actions">
                  <div class="jobs-action-card">
                    <div class="section-title"><span class="jobs-action-title-with-icon"><span class="jobs-action-title-icon jobs-action-title-icon-pause"><span></span><span></span></span><span>${escapeHtml(strings.jobsPauseTitle)}</span></span></div>
                    <div class="jobs-inline-form">
                      <div class="form-group">
                        <label for="jobs-pause-name-input">${escapeHtml(strings.jobsPauseName)}</label>
                        <input type="text" id="jobs-pause-name-input" placeholder="${escapeHtmlAttr(strings.jobsPauseDefaultTitle)}">
                      </div>
                      <button type="button" class="btn-primary" id="jobs-create-pause-btn">⏸ ${escapeHtml(strings.jobsCreatePause)}</button>
                    </div>
                  </div>

                  <div class="jobs-action-card">
                    <div class="section-title"><span class="jobs-action-title-with-icon"><span class="jobs-action-title-icon">⛓</span><span>${escapeHtml(strings.jobsAddExistingTask)}</span></span></div>
                    <div class="jobs-inline-form">
                      <div class="form-group">
                        <label for="jobs-existing-task-select">${escapeHtml(strings.jobsStandaloneTasks)}</label>
                        <select id="jobs-existing-task-select"></select>
                      </div>
                      <div class="form-group">
                        <label for="jobs-existing-window-input">${escapeHtml(strings.jobsWindowMinutes)}</label>
                        <input type="number" id="jobs-existing-window-input" min="1" max="1440" value="30">
                      </div>
                      <button type="button" class="btn-primary" id="jobs-attach-btn">⛓ ${escapeHtml(strings.jobsAttach)}</button>
                    </div>
                  </div>
                </div>

                <div class="jobs-action-card jobs-action-card-wide">
                  <div class="section-title"><span class="jobs-action-title-with-icon"><span class="jobs-action-title-icon">✦</span><span>${escapeHtml(strings.jobsAddNewStep)}</span></span></div>
                  <div class="jobs-inline-form jobs-new-step-form">
                    <div class="form-group">
                      <label for="jobs-step-name-input">${escapeHtml(strings.jobsStepName)}</label>
                      <input type="text" id="jobs-step-name-input">
                    </div>
                    <div class="form-group">
                      <label for="jobs-step-window-input">${escapeHtml(strings.jobsWindowMinutes)}</label>
                      <input type="number" id="jobs-step-window-input" min="1" max="1440" value="30">
                    </div>
                    <div class="form-group wide">
                      <label for="jobs-step-prompt-input">${escapeHtml(strings.jobsStepPrompt)}</label>
                      <textarea id="jobs-step-prompt-input"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="jobs-step-agent-select">${escapeHtml(strings.labelAgent)}</label>
                      <select id="jobs-step-agent-select"></select>
                    </div>
                    <div class="form-group">
                      <label for="jobs-step-model-select">${escapeHtml(strings.labelModel)}</label>
                      <select id="jobs-step-model-select"></select>
                    </div>
                    <div class="form-group wide">
                      <label for="jobs-step-labels-input">${escapeHtml(strings.labelTaskLabels)}</label>
                      <input type="text" id="jobs-step-labels-input" placeholder="${escapeHtmlAttr(strings.placeholderTaskLabels)}">
                    </div>
                    <div class="jobs-new-step-actions">
                      <button type="button" class="btn-primary" id="jobs-create-step-btn">${escapeHtml(strings.jobsCreateStep)}</button>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div id="research-tab" class="tab-content">
    <div class="research-layout">
      <aside class="research-sidebar">
        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title">${escapeHtml(strings.researchProfilesTitle)}</div>
            <p class="note">${escapeHtml(strings.researchHelpText)}</p>
          </div>
          <div class="research-toolbar">
            <button type="button" class="btn-secondary" id="research-new-btn">${escapeHtml(strings.researchNewProfile)}</button>
            <button type="button" class="btn-secondary" id="research-load-autoagent-example-btn">${escapeHtml(strings.researchLoadAutoAgentExample)}</button>
          </div>
          <div id="research-profile-list" class="research-profile-list"></div>
        </section>
        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title">${escapeHtml(strings.researchHistoryTitle)}</div>
          </div>
          <div id="research-run-list" class="research-run-list"></div>
        </section>
      </aside>

      <section class="research-main">
        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title">${escapeHtml(strings.researchTitle)}</div>
            <p class="note">${escapeHtml(strings.researchHelpText)}</p>
          </div>
          <div id="research-form-error" class="research-form-error"></div>
          <input type="hidden" id="research-edit-id" value="">
          <div class="research-form-grid">
            <div class="form-group">
              <label for="research-name">${escapeHtml(strings.researchName)}</label>
              <input type="text" id="research-name">
            </div>
            <div class="form-group">
              <label for="research-benchmark-command">${escapeHtml(strings.researchBenchmarkCommand)}</label>
              <input type="text" id="research-benchmark-command" placeholder="${escapeHtmlAttr(strings.researchBenchmarkPlaceholder)}">
            </div>
            <div class="form-group wide">
              <label for="research-instructions">${escapeHtml(strings.researchInstructions)}</label>
              <textarea id="research-instructions" placeholder="${escapeHtmlAttr(strings.researchInstructionsPlaceholder)}"></textarea>
            </div>
            <div class="form-group wide">
              <label for="research-editable-paths">${escapeHtml(strings.researchEditablePaths)}</label>
              <textarea id="research-editable-paths" placeholder="${escapeHtmlAttr(strings.researchEditablePathsPlaceholder)}"></textarea>
            </div>
            <div class="form-group">
              <label for="research-metric-pattern">${escapeHtml(strings.researchMetricPattern)}</label>
              <input type="text" id="research-metric-pattern" placeholder="${escapeHtmlAttr(strings.researchMetricPatternPlaceholder)}">
            </div>
            <div class="form-group">
              <label for="research-metric-direction">${escapeHtml(strings.researchMetricDirection)}</label>
              <select id="research-metric-direction">
                <option value="maximize">${escapeHtml(strings.researchDirectionMaximize)}</option>
                <option value="minimize">${escapeHtml(strings.researchDirectionMinimize)}</option>
              </select>
            </div>
            <div class="form-group">
              <label for="research-max-iterations">${escapeHtml(strings.researchMaxIterations)}</label>
              <input type="number" id="research-max-iterations" min="0" max="25" value="3">
            </div>
            <div class="form-group">
              <label for="research-max-minutes">${escapeHtml(strings.researchMaxMinutes)}</label>
              <input type="number" id="research-max-minutes" min="1" max="240" value="15">
            </div>
            <div class="form-group">
              <label for="research-max-failures">${escapeHtml(strings.researchMaxFailures)}</label>
              <input type="number" id="research-max-failures" min="1" max="10" value="2">
            </div>
            <div class="form-group">
              <label for="research-benchmark-timeout">${escapeHtml(strings.researchBenchmarkTimeout)}</label>
              <input type="number" id="research-benchmark-timeout" min="5" max="3600" value="180">
            </div>
            <div class="form-group">
              <label for="research-edit-wait">${escapeHtml(strings.researchEditWait)}</label>
              <input type="number" id="research-edit-wait" min="5" max="300" value="20">
            </div>
            <div class="form-group">
              <label for="research-agent-select">${escapeHtml(strings.labelAgent)}</label>
              <select id="research-agent-select"></select>
            </div>
            <div class="form-group">
              <label for="research-model-select">${escapeHtml(strings.labelModel)}</label>
              <select id="research-model-select"></select>
            </div>
          </div>
          <div class="research-toolbar">
            <button type="button" class="btn-primary" id="research-save-btn">${escapeHtml(strings.researchSaveProfile)}</button>
            <button type="button" class="btn-secondary" id="research-duplicate-btn">${escapeHtml(strings.researchDuplicateProfile)}</button>
            <button type="button" class="btn-danger" id="research-delete-btn">${escapeHtml(strings.researchDeleteProfile)}</button>
            <button type="button" class="btn-secondary" id="research-start-btn">${escapeHtml(strings.researchStartRun)}</button>
            <button type="button" class="btn-secondary" id="research-stop-btn">${escapeHtml(strings.researchStopRun)}</button>
          </div>
        </section>

        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title" id="research-run-title">${escapeHtml(strings.researchActiveRunTitle)}</div>
          </div>
          <div id="research-active-empty" class="jobs-empty">${escapeHtml(strings.researchNoRunSelected)}</div>
          <div id="research-active-details" style="display:none;">
            <div class="research-stat-grid">
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.labelStatus)}</div>
                <div class="research-stat-value" id="research-active-status">${escapeHtml(strings.researchStatusIdle)}</div>
              </div>
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.researchCurrentBest)}</div>
                <div class="research-stat-value" id="research-active-best">${escapeHtml(strings.researchNoScore)}</div>
              </div>
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.researchAttempts)}</div>
                <div class="research-stat-value" id="research-active-attempts">0</div>
              </div>
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.researchLastOutcome)}</div>
                <div class="research-stat-value" id="research-active-last-outcome">-</div>
              </div>
            </div>
            <div class="research-run-meta" id="research-active-meta"></div>
            <div class="section-title" style="margin-top:12px;">${escapeHtml(strings.researchAttemptTimeline)}</div>
            <div id="research-attempt-list" class="research-attempt-list"></div>
          </div>
        </section>
      </section>
    </div>
  </div>

  <div id="settings-tab" class="tab-content">
    <div class="telegram-layout">
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.telegramTitle)}</div>
          <p class="note">${escapeHtml(strings.telegramDescription)}</p>
        </div>
        <div id="telegram-feedback" class="telegram-feedback"></div>

        <div class="form-group" style="margin-top:8px;">
          <label class="checkbox-group">
            <input type="checkbox" id="telegram-enabled">
            <span>${escapeHtml(strings.telegramEnable)}</span>
          </label>
        </div>

        <div class="form-group">
          <label for="telegram-bot-token">${escapeHtml(strings.telegramBotToken)}</label>
          <input type="password" id="telegram-bot-token" placeholder="${escapeHtmlAttr(strings.telegramBotTokenPlaceholder)}" autocomplete="off">
          <p class="note">${escapeHtml(strings.telegramBotTokenHelp)}</p>
        </div>

        <div class="form-group">
          <label for="telegram-chat-id">${escapeHtml(strings.telegramChatId)}</label>
          <input type="text" id="telegram-chat-id" placeholder="${escapeHtmlAttr(strings.telegramChatIdPlaceholder)}">
        </div>

        <div class="form-group">
          <label for="telegram-message-prefix">${escapeHtml(strings.telegramMessagePrefix)}</label>
          <textarea id="telegram-message-prefix" placeholder="${escapeHtmlAttr(strings.telegramMessagePrefixPlaceholder)}"></textarea>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="telegram-save-btn">${escapeHtml(strings.telegramSave)}</button>
          <button type="button" class="btn-secondary" id="telegram-test-btn">${escapeHtml(strings.telegramTest)}</button>
        </div>
      </section>

      <aside class="telegram-status-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.tabTelegram)}</div>
          <p class="note">${escapeHtml(strings.telegramWorkspaceNote)}</p>
        </div>
        <div class="telegram-status-grid">
          <div class="telegram-status-item">
            <div class="telegram-status-label">${escapeHtml(strings.telegramBotToken)}</div>
            <div class="telegram-status-value" id="telegram-token-status"></div>
          </div>
          <div class="telegram-status-item">
            <div class="telegram-status-label">${escapeHtml(strings.telegramChatId)}</div>
            <div class="telegram-status-value" id="telegram-chat-status"></div>
          </div>
          <div class="telegram-status-item">
            <div class="telegram-status-label">Hook</div>
            <div class="telegram-status-value" id="telegram-hook-status"></div>
          </div>
          <div class="telegram-status-item">
            <div class="telegram-status-label">${escapeHtml(strings.telegramUpdatedAt)}</div>
            <div class="telegram-status-value" id="telegram-updated-at"></div>
          </div>
        </div>
        <p class="note" id="telegram-status-note">${escapeHtml(strings.telegramStatusSaved)}</p>
      </aside>

      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.executionDefaultsTitle)}</div>
          <p class="note">${escapeHtml(strings.executionDefaultsDescription)}</p>
        </div>

        <div class="form-group" style="margin-top:8px;">
          <label for="default-agent-select">${escapeHtml(strings.executionDefaultsAgent)}</label>
          <select id="default-agent-select"></select>
        </div>

        <div class="form-group">
          <label for="default-model-select">${escapeHtml(strings.executionDefaultsModel)}</label>
          <select id="default-model-select"></select>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="execution-defaults-save-btn">${escapeHtml(strings.executionDefaultsSave)}</button>
        </div>
        <p class="note" id="execution-defaults-note">${escapeHtml(strings.executionDefaultsSaved)}</p>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.reviewDefaultsTitle)}</div>
          <p class="note">${escapeHtml(strings.reviewDefaultsDescription)}</p>
        </div>

        <div class="form-group" style="margin-top:8px;">
          <label for="spot-review-template-input">${escapeHtml(strings.reviewDefaultsSpotReviewLabel)}</label>
          <textarea id="spot-review-template-input" rows="5" placeholder="${escapeHtmlAttr(strings.reviewDefaultsSpotReviewPlaceholder)}"></textarea>
        </div>

        <div class="form-group">
          <label for="bot-review-prompt-template-input">${escapeHtml(strings.reviewDefaultsBotPromptLabel)}</label>
          <textarea id="bot-review-prompt-template-input" rows="8" placeholder="${escapeHtmlAttr(strings.reviewDefaultsBotPromptPlaceholder)}"></textarea>
        </div>

        <div class="form-group">
          <label for="bot-review-agent-select">${escapeHtml(strings.reviewDefaultsBotAgentLabel)}</label>
          <select id="bot-review-agent-select"></select>
        </div>

        <div class="form-group">
          <label for="bot-review-model-select">${escapeHtml(strings.reviewDefaultsBotModelLabel)}</label>
          <select id="bot-review-model-select"></select>
        </div>

        <div class="form-group">
          <label for="bot-review-chat-session-select">${escapeHtml(strings.reviewDefaultsBotChatSessionLabel)}</label>
          <select id="bot-review-chat-session-select">
            <option value="new">${escapeHtml(strings.labelChatSessionNew)}</option>
            <option value="continue">${escapeHtml(strings.labelChatSessionContinue)}</option>
          </select>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="review-defaults-save-btn">${escapeHtml(strings.reviewDefaultsSave)}</button>
        </div>
        <p class="note" id="review-defaults-note">${escapeHtml(strings.reviewDefaultsSaved)}</p>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsStorageTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsStorageBody)}</p>
        </div>

        <div class="form-group" style="margin-top:8px;">
          <label for="settings-storage-mode-select">${escapeHtml(strings.settingsStorageModeLabel)}</label>
          <select id="settings-storage-mode-select">
            <option value="json">${escapeHtml(strings.settingsStorageModeJson)}</option>
            <option value="sqlite">${escapeHtml(strings.settingsStorageModeSqlite)}</option>
          </select>
        </div>

        <div class="form-group">
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="settings-storage-mirror-input">
            <span>${escapeHtml(strings.settingsStorageMirrorLabel)}</span>
          </label>
        </div>

        <div class="form-group">
          <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(strings.settingsDefaultFlagsTitle)}</div>
          <p class="note" style="margin-bottom:8px;">${escapeHtml(strings.settingsDefaultFlagsBody)}</p>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-ready-input">
            <span>${escapeHtml(strings.boardFlagPresetReady)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-needs-bot-review-input">
            <span>${escapeHtml(strings.boardFlagPresetNeedsBotReview)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-needs-user-review-input">
            <span>${escapeHtml(strings.boardFlagPresetNeedsUserReview)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-new-input">
            <span>${escapeHtml(strings.boardFlagPresetNew)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-on-schedule-list-input">
            <span>${escapeHtml(strings.boardFlagPresetOnScheduleList)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="settings-flag-final-user-check-input">
            <span>${escapeHtml(strings.boardFlagPresetFinalUserCheck)}</span>
          </label>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="settings-storage-save-btn">${escapeHtml(strings.settingsStorageSave)}</button>
        </div>
        <p class="note" id="settings-storage-note">${escapeHtml(strings.settingsStorageSaved)}</p>
        <div class="note" style="display:grid;gap:6px;margin-top:10px;">
          <div><strong>${escapeHtml(strings.settingsStorageVersionLabel)}</strong> <span id="settings-version-value">-</span></div>
          <div><strong>${escapeHtml(strings.settingsStorageMcpStatusLabel)}</strong> <span id="settings-mcp-status-value">-</span></div>
          <div><strong>${escapeHtml(strings.settingsStorageLastMcpUpdateLabel)}</strong> <span id="settings-mcp-updated-value">-</span></div>
          <div><strong>${escapeHtml(strings.settingsStorageLastSkillsUpdateLabel)}</strong> <span id="settings-skills-updated-value">-</span></div>
        </div>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsLoggingTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsLoggingBody)}</p>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label for="settings-log-level-select">${escapeHtml(strings.settingsLoggingLevelLabel)}</label>
          <select id="settings-log-level-select">
            <option value="none">${escapeHtml(strings.settingsLoggingLevelNone)}</option>
            <option value="error">${escapeHtml(strings.settingsLoggingLevelError)}</option>
            <option value="info">${escapeHtml(strings.settingsLoggingLevelInfo)}</option>
            <option value="debug">${escapeHtml(strings.settingsLoggingLevelDebug)}</option>
          </select>
        </div>
        <div class="form-group">
          <label for="settings-log-directory">${escapeHtml(strings.settingsLoggingDirectoryLabel)}</label>
          <input type="text" id="settings-log-directory" readonly>
          <p class="note">${escapeHtml(strings.settingsLoggingDirectoryHint)}</p>
        </div>
        <div class="button-group">
          <button type="button" class="btn-secondary" id="settings-open-log-folder-btn">${escapeHtml(strings.settingsLoggingOpenFolder)}</button>
        </div>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsLanguageTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsLanguageBody)}</p>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label for="settings-language-select">${escapeHtml(strings.settingsLanguageLabel)}</label>
          <select id="settings-language-select">
            <option value="auto" ${configuredLanguage === "auto" ? "selected" : ""}>${escapeHtml(strings.helpLanguageAuto)}</option>
            <option value="en" ${configuredLanguage === "en" ? "selected" : ""}>${escapeHtml(strings.helpLanguageEnglish)}</option>
            <option value="ja" ${configuredLanguage === "ja" ? "selected" : ""}>${escapeHtml(strings.helpLanguageJapanese)}</option>
            <option value="de" ${configuredLanguage === "de" ? "selected" : ""}>${escapeHtml(strings.helpLanguageGerman)}</option>
          </select>
        </div>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsMaintenanceTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsMaintenanceBody)}</p>
        </div>
        <div class="button-group">
          <button type="button" class="btn-secondary" id="import-storage-from-json-btn">${escapeHtml(strings.settingsStorageImportJsonToDb)}</button>
          <button type="button" class="btn-secondary" id="export-storage-to-json-btn">${escapeHtml(strings.settingsStorageExportDbToJson)}</button>
          <button type="button" class="btn-primary" id="sync-bundled-skills-btn">${escapeHtml(strings.actionSyncBundledSkills)}</button>
        </div>
        <p class="note">${escapeHtml(strings.settingsStorageMaintenanceNote)}</p>
      </section>
    </div>
  </div>

  <div id="help-tab" class="tab-content active">
    <div class="help-panel">
      <div class="help-warp-layer" id="help-warp-layer" aria-hidden="true"></div>
      <div class="help-intro">
        <h2 class="help-intro-title">
          <button type="button" class="help-intro-rocket" id="help-intro-rocket" title="${escapeHtmlAttr(strings.helpIntroTitle)}" aria-label="${escapeHtmlAttr(strings.helpIntroTitle)}">
            <span class="help-intro-rocket-icon">🚀</span>
          </button>
          <span class="help-intro-title-text">${escapeHtml(helpIntroTitleText)}</span>
        </h2>
        <p class="help-intro-body">${escapeHtml(strings.helpIntroBody)}</p>
      </div>
      <section class="help-section">
        <h3>${escapeHtml(strings.helpLanguageTitle)}</h3>
        <p>${escapeHtml(strings.helpLanguageBody)}</p>
        <div class="form-group" style="margin:0;max-width:320px;">
          <label for="help-language-select">${escapeHtml(strings.helpLanguageLabel)}</label>
          <select id="help-language-select">
            <option value="auto" ${configuredLanguage === "auto" ? "selected" : ""}>${escapeHtml(strings.helpLanguageAuto)}</option>
            <option value="en" ${configuredLanguage === "en" ? "selected" : ""}>${escapeHtml(strings.helpLanguageEnglish)}</option>
            <option value="ja" ${configuredLanguage === "ja" ? "selected" : ""}>${escapeHtml(strings.helpLanguageJapanese)}</option>
            <option value="de" ${configuredLanguage === "de" ? "selected" : ""}>${escapeHtml(strings.helpLanguageGerman)}</option>
          </select>
        </div>
        <div class="form-actions" style="margin-top:0.5rem">
          <button class="btn secondary" id="btn-help-switch-settings">${escapeHtml(strings.helpSwitchTabSettingsBtn)}</button>
        </div>
      </section>
      <div class="help-grid">
        <section class="help-section">
          <h3>${escapeHtml(strings.helpTodoTitle)}</h3>
          <p>${escapeHtml(strings.helpTodoBody)}</p>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn primary" id="btn-help-switch-board">${escapeHtml(strings.helpSwitchTabTodoBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpCreateTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpCreateItemName)}</li>
            <li>${escapeHtml(strings.helpCreateItemTemplates)}</li>
            <li>${escapeHtml(strings.helpCreateItemSkills)}</li>
            <li>${escapeHtml(strings.helpCreateItemAgentModel)}</li>
            <li>${escapeHtml(strings.helpCreateItemRunFirst)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-create">${escapeHtml(strings.helpSwitchTabCreateBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpListTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpListItemSections)}</li>
            <li>${escapeHtml(strings.helpListItemActions)}</li>
            <li>${escapeHtml(strings.helpListItemStartup)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-list">${escapeHtml(strings.helpSwitchTabListBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpJobsTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpJobsItemBoard)}</li>
            <li>${escapeHtml(strings.helpJobsItemPause)}</li>
            <li>${escapeHtml(strings.helpJobsItemCompile)}</li>
            <li>${escapeHtml(strings.helpJobsItemLabels)}</li>
            <li>${escapeHtml(strings.helpJobsItemFolders)}</li>
            <li>${escapeHtml(strings.helpJobsItemDelete)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-jobs">${escapeHtml(strings.helpSwitchTabJobsBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpResearchTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpResearchItemProfiles)}</li>
            <li>${escapeHtml(strings.helpResearchItemBounds)}</li>
            <li>${escapeHtml(strings.helpResearchItemHistory)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-research">${escapeHtml(strings.helpSwitchTabResearchBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpStorageTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpStorageItemRepo)}</li>
            <li>${escapeHtml(strings.helpStorageItemBackups)}</li>
            <li>${escapeHtml(strings.helpStorageItemIsolation)}</li>
            <li>${escapeHtml(strings.helpStorageItemGlobal)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpOverdueTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpOverdueItemReview)}</li>
            <li>${escapeHtml(strings.helpOverdueItemRecurring)}</li>
            <li>${escapeHtml(strings.helpOverdueItemOneTime)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpSessionTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpSessionItemPerTask)}</li>
            <li>${escapeHtml(strings.helpSessionItemNewChat)}</li>
            <li>${escapeHtml(strings.helpSessionItemCareful)}</li>
            <li>${escapeHtml(strings.helpSessionItemSeparate)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpTipsTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpTipsItem1)}</li>
            <li>${escapeHtml(strings.helpTipsItem2)}</li>
            <li>${escapeHtml(strings.helpTipsItem3)}</li>
          </ul>
        </section>
        <section class="help-section is-featured">
          <h3>${escapeHtml(strings.helpMcpTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpMcpItemEmbedded)}</li>
            <li>${escapeHtml(strings.helpMcpItemConfig)}</li>
            <li>${escapeHtml(strings.helpMcpItemAutoConfig)}</li>
            <li>${escapeHtml(strings.helpMcpItemDanger)}</li>
            <li>${escapeHtml(strings.helpMcpItemInspect)}</li>
            <li>${escapeHtml(strings.helpMcpItemWrite)}</li>
            <li>${escapeHtml(strings.helpMcpItemTools)}</li>
          </ul>
          <div class="button-group" style="margin-top:8px;">
            <button type="button" class="btn-primary" id="setup-mcp-btn">${escapeHtml(strings.actionSetupMcp)}</button>
          </div>
        </section>
        <section class="help-section is-featured">
          <h3>${escapeHtml(strings.helpAgentEcosystemTitle)}</h3>
          <p>${escapeHtml(strings.helpAgentEcosystemBody)}</p>
          <div class="button-group" style="margin-top:8px;">
            <button type="button" class="btn-secondary" id="btn-intro-tutorial">${escapeHtml(strings.helpIntroTutorialBtn)}</button>
            <button type="button" class="btn-primary" id="btn-plan-integration">${escapeHtml(strings.helpPlanIntegrationBtn)}</button>
          </div>
        </section>
      </div>
    </div>
  </div>
  
`;

    return renderSchedulerWebviewDocument({
      uiLanguage,
      cspSource: webview.cspSource,
      nonce,
      title: strings.title,
      documentContent,
      initialDataJson: serializeForWebview(initialData),
      scriptUri: scriptUri.toString(),
    });
  }
}




