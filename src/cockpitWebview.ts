/** Webview controller for the Cockpit scheduler surface. */

import * as path from "path";
import * as vscode from "vscode";
import type { // local-diverge-5
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
} from "./types";
import { CopilotExecutor } from "./copilotExecutor";
import type { WebviewToExtensionMessage } from "./types";
import { getCurrentLanguage } from "./i18n";
import {
  logError,
} from "./logger";
import {
  getCompatibleConfigurationValue,
} from "./extensionCompat";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import {
  escapeHtml,
  escapeHtmlAttr,
  serializeForWebview,
} from "./cockpitWebviewContentUtils";
import { renderSchedulerWebviewDocument } from "./cockpitWebviewDocument";
import { buildSchedulerWebviewStrings } from "./cockpitWebviewStrings";
import { ensurePrivateConfigIgnoredForWorkspaceRoot } from "./privateConfigIgnore";
import {
  createStartCreateTodoMessage,
  createUpdateCockpitBoardMessage,
  handleTodoCockpitWebviewMessage,
} from "./cockpitWebviewCockpitBridge";
import { handleTodoDialogWebviewMessage } from "./cockpitWebviewTodoDialogs";
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
} from "./cockpitWebviewMessageFactory";
import { handleSettingsWebviewMessage } from "./cockpitWebviewSettingsHandler";
import { handleTaskWebviewMessage } from "./cockpitWebviewTaskHandler";
import { handleJobWebviewMessage } from "./cockpitWebviewJobHandler";
import { handleResearchWebviewMessage } from "./cockpitWebviewResearchHandler";
import {
  handleTodoFileUploadRequest as handleTodoFileUploadRequestWithHelper,
  sanitizeTodoUploadFileName as sanitizeTodoUploadFileNameWithHelper,
} from "./cockpitWebviewTodoUploads";
import {
  getResolvedWorkspaceRootPaths,
  getGlobalPromptsPath,
} from "./cockpitWebviewTemplateCache";
import {
  createSchedulerWebviewJobDialogContext,
  postAutoShowOnStartup,
  postEditTask,
  postFocusJob,
  postFocusReadyTodoDraft,
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
} from "./cockpitWebviewCommands";
import { createSchedulerWebviewCurrentRenderContext } from "./cockpitWebviewRenderContext";
import { buildSchedulerTaskEditorMarkup } from "./cockpitWebviewTaskEditorMarkup";
import { buildSchedulerWebviewChromeStyles } from "./cockpitWebviewChromeStyles";
import { buildSchedulerWebviewSharedStyles } from "./cockpitWebviewSharedStyles";
import { buildSchedulerWebviewExtendedStyles } from "./cockpitWebviewExtendedStyles";
import {
  buildSchedulerListTabMarkup,
  buildSchedulerTodoEditorMarkup,
} from "./cockpitWebviewTodoMarkup";
import { buildSchedulerWorkspaceTabsMarkup } from "./cockpitWebviewWorkspaceTabsMarkup";
import {
  runSchedulerWebviewBackgroundRefresh,
  seedSchedulerWebviewCatalogFallbacks,
} from "./cockpitWebviewShowSupport";
import { handleSchedulerWebviewCoreMessage } from "./cockpitWebviewMessageRouting";
import {
  postSchedulerCatalogMessages,
} from "./cockpitWebviewState";
import {
  backupGithubFolderSnapshot,
  buildHelpChatPrompt,
  createSchedulerWebviewQueueState,
  flushSchedulerWebviewPendingMessages,
  postSchedulerWebviewMessage,
  resetSchedulerWebviewQueueState,
  type SchedulerWebviewQueueState,
  type SchedulerWebviewMessage,
} from "./cockpitWebviewSupport";
import {
  refreshSchedulerCatalogCaches,
  refreshSchedulerWebviewLanguagePanel,
} from "./cockpitWebviewRenderSupport";
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
} from "./cockpitWebviewUpdateDispatch";
import {
  createFreshSchedulerPanel,
  replaySchedulerPanel,
} from "./cockpitWebviewPanelLifecycle";
import {
  assignSchedulerWebviewRuntimeState,
  createSchedulerWebviewCatalogState,
  createSchedulerWebviewRuntimeState,
  type SchedulerWebviewCatalogState,
  type SchedulerWebviewRuntimeState,
} from "./cockpitWebviewStateStore";

type OutgoingWebviewMessage = SchedulerWebviewMessage;
const TODO_INPUT_UPLOADS_FOLDER = "cockpit-input-uploads";

export class SchedulerWebview {
  private static activePanel: vscode.WebviewPanel | undefined;
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

  private static get agentListCache(): AgentInfo[] { return this.readCatalogState("agents"); }
  private static set agentListCache(value: AgentInfo[]) { this.writeCatalogState("agents", value); }
  private static get modelListCache(): ModelInfo[] { return this.readCatalogState("models"); }
  private static set modelListCache(value: ModelInfo[]) { this.writeCatalogState("models", value); }
  private static get templateCache(): PromptTemplate[] { return this.readCatalogState("promptTemplates"); }
  private static set templateCache(value: PromptTemplate[]) { this.writeCatalogState("promptTemplates", value); }
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
  private static get currentScheduleHistory(): ScheduleHistoryEntry[] { return this.readRuntimeState("cockpitHistory"); }
  private static set currentScheduleHistory(value: ScheduleHistoryEntry[]) { this.writeRuntimeState("cockpitHistory", value); }
  private static get webviewReady(): boolean { return this.readQueueState("webviewReady"); }
  private static set webviewReady(value: boolean) { this.writeQueueState("webviewReady", value); }
  private static get pendingMessages(): OutgoingWebviewMessage[] { return this.readQueueState("pendingMessages"); }
  private static set pendingMessages(value: OutgoingWebviewMessage[]) { this.writeQueueState("pendingMessages", value); }
  private static get lastBatchedMessageSignatures(): Map<string, string> { return this.readQueueState("lastBatchedMessageSignatures"); }
  private static set lastBatchedMessageSignatures(value: Map<string, string>) { this.writeQueueState("lastBatchedMessageSignatures", value); }
  private static get pendingMessageFlushTimer(): ReturnType<typeof setTimeout> | undefined { return this.readQueueState("pendingMessageFlushTimer"); }
  private static set pendingMessageFlushTimer(value: ReturnType<typeof setTimeout> | undefined) { this.writeQueueState("pendingMessageFlushTimer", value); }

  private static clearReadyFlag(): void {
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

  static dispose(): void { // cleanup
    const panel = this.activePanel;
    if (!panel) {
      return;
    }

    // The dispose callback clears the panel reference and ready flag
    panel.dispose();
  }

  private static postMessage(message: OutgoingWebviewMessage): void { // send
    postSchedulerWebviewMessage(
      this.messageQueueState,
      this.activePanel,
      message,
      () => this.drainQueuedMessages(),
    );
  }

  private static drainQueuedMessages(): void {
    flushSchedulerWebviewPendingMessages(this.messageQueueState, this.activePanel);
  }

  static async show( /* present-panel */
    extensionUri: vscode.Uri, tasks: ScheduledTask[], jobs: JobDefinition[], jobFolders: JobFolder[],
    cockpitBoard: CockpitBoard, telegramNotification: TelegramNotificationView,
    executionDefaults: ExecutionDefaultsView, reviewDefaults: ReviewDefaultsView,
    storageSettings: StorageSettingsView, researchProfiles: ResearchProfile[],
    activeResearchRun: ResearchRun | undefined, recentResearchRuns: ResearchRun[],
    onTaskAction: (action: TaskAction) => void, onTestPrompt?: (prompt: string, agent?: string, model?: string) => void,
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

    const refreshInBackground = (): void => {
      runSchedulerWebviewBackgroundRefresh({
        refreshAgentsAndModelsCache: () => this.refreshAgentsAndModelsCache(true),
        refreshPromptTemplatesCache: () => this.refreshPromptTemplatesCache(true),
        refreshSkillReferencesCache: () => this.refreshSkillReferencesCache(true),
        getCachedAgents: () => this.agentListCache,
        getCachedModels: () => this.modelListCache,
        getCachedPromptTemplates: () => this.templateCache,
        getCachedSkillReferences: () => this.cachedSkillReferences,
        postMessage: (message) => this.postMessage(message as OutgoingWebviewMessage),
        logError,
        sanitizeError: (details) => this.redactPathsForDisplay(details),
      });
    };

    const ensureCatalogsForFreshPanel = async (): Promise<void> => {
      if (this.agentListCache.length > 0 && this.modelListCache.length > 0) {
        return;
      }

      await this.refreshAgentsAndModelsCache(true);

      seedSchedulerWebviewCatalogFallbacks({
        agentListCache: this.agentListCache,
        modelListCache: this.modelListCache,
        setCachedAgents: (agents) => {
          this.agentListCache = agents;
        },
        setCachedModels: (models) => {
          this.modelListCache = models;
        },
      });
    };

    if (this.activePanel) {
      replaySchedulerPanel({
        panel: this.activePanel,
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
        agentListCache: this.agentListCache,
        modelListCache: this.modelListCache,
        templateCache: this.templateCache,
        resetReadyState: () => this.clearReadyFlag(),
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
      await ensureCatalogsForFreshPanel();

      // A fresh (or re-created) webview panel begins in the not-ready state.
      this.clearReadyFlag(); // local-diverge-490

      this.activePanel = createFreshSchedulerPanel({
        extensionUri,
        tasks,
        agentListCache: this.agentListCache,
        modelListCache: this.modelListCache,
        templateCache: this.templateCache,
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
        redactPathsForDisplay: (message) =>
          this.redactPathsForDisplay(message),
        showError: (message) => this.showError(message),
        onDidDispose: () => {
          this.activePanel = undefined;
          this.clearReadyFlag();
        },
      });

      refreshInBackground();
    }
  }

  /**
   * Push the latest task list into the webview
   */
  static updateTasks(tasks: ScheduledTask[]): void { // sync
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

  static updateApprovalMode(approvalMode: string): void {
    this.postMessage({
      type: "updateApprovalMode",
      approvalMode,
    });
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
   * Render an error banner within the webview
   */
  static showError(errorMessage: string): void { // display
    dispatchWebviewError(
      errorMessage,
      (message) => this.postMessage(message),
      (message) => this.redactPathsForDisplay(message),
    );
  }

  private static redactPathsForDisplay(message: string): string {
    return sanitizeAbsolutePathDetails(message);
  }

  private static postCachedCatalogMessages(): void {
    dispatchCachedCatalogMessages(
      this.catalogState,
      (message) => this.postMessage(message),
    );
  }

  /**
   * Propagate a locale change into the webview
   */
  static refreshLanguage(tasks: ScheduledTask[]): void { // i18n
    if (this.agentListCache.length === 0) {
      this.agentListCache = CopilotExecutor.getBuiltInAgents();
    }
    if (this.modelListCache.length === 0) {
      this.modelListCache = CopilotExecutor.builtinModels(); // local-diverge-625
    }
    refreshSchedulerWebviewLanguagePanel({
      panel: this.activePanel,
      tasks,
      agentListCache: this.agentListCache,
      modelListCache: this.modelListCache,
      templateCache: this.templateCache,
      resetReadyState: () => this.clearReadyFlag(),
      renderHtml: (webview, currentTasks, agents, models, promptTemplates) =>
        this.getWebviewContent(
          webview,
          currentTasks,
          agents,
          models,
          promptTemplates,
        ),
      postCachedCatalogMessages: () => this.postCachedCatalogMessages(),
      reloadCachesAndSync: (force) =>
        this.reloadCachesAndSync(force),
    });
  }

  /**
   * Reload cached agents/models/templates and push updates to the webview without a full rebuilng HTML.
   * Use this for settings changes (e.g., global paths) to avoid resetting form state.
   */
  static async reloadCachesAndSync(force = true): Promise<void> {
    await refreshSchedulerCatalogCaches({
      refreshAgentsAndModelsCache: (refreshForce) =>
        this.refreshAgentsAndModelsCache(refreshForce),
      refreshPromptTemplatesCache: (refreshForce) =>
        this.refreshPromptTemplatesCache(refreshForce),
      refreshSkillReferencesCache: (refreshForce) =>
        this.refreshSkillReferencesCache(refreshForce),
      resetAgentsAndModels: () => {
        this.agentListCache = CopilotExecutor.getBuiltInAgents();
        this.modelListCache = CopilotExecutor.builtinModels();
      },
      resetPromptTemplates: () => {
        this.templateCache = [];
      },
      resetSkillReferences: () => {
        this.cachedSkillReferences = [];
      },
      panel: this.activePanel,
      postCachedCatalogMessages: () => this.postCachedCatalogMessages(),
      force,
    });
  }

  /**
   * Navigate to the list tab, with an optional success notification
   */
  static switchToList(successMessage?: string): void { // navigate
    postSwitchToList((message) => this.postMessage(message), successMessage);
  }

  static switchToTab(tab: "create" | "list" | "jobs" | "board" | "research" | "settings" | "help"): void {
    postSwitchToTab((message) => this.postMessage(message), tab);
  }

  static updateAutoShowOnStartup(enabled: boolean): void {
    postAutoShowOnStartup((message) => this.postMessage(message), enabled);
  }

  /**
   * Reset the webview to a blank create-task form (discards any in-progress edit).
   */
  static startCreateTask(): void { // new-form
    postStartCreateTask((message) => this.postMessage(message));
  }

  static startCreateTodo(): void {
    this.postMessage(createStartCreateTodoMessage());
  }

  static startCreateJob(): void {
    postStartCreateJob((message) => this.postMessage(message));
  }

  /**
   * Scroll to and highlight a particular task
   */
  static focusTask(taskId: string): void { // highlight
    postFocusTask((message) => this.postMessage(message), taskId);
  }

  static focusReadyTodoDraft(todoId: string): void {
    postFocusReadyTodoDraft((message) => this.postMessage(message), todoId);
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
   * Open the edit form for a given task inside the webview
   */
  static editTask(taskId?: string): void { // open-editor
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

  private static async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
    if (await handleTodoDialogWebviewMessage(message, {
      currentCockpitBoard: this.currentCockpitBoard,
      onTaskActionCallback: this.onTaskActionCallback,
      strings: buildSchedulerWebviewStrings(getCurrentLanguage()),
    })) {
      return;
    }

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
        getCachedAgents: () => this.agentListCache,
        getCachedModels: () => this.modelListCache,
        getCachedPromptTemplates: () => this.templateCache,
        getCachedSkillReferences: () => this.cachedSkillReferences,
        postMessage: (payload) => this.postMessage(payload),
        onTaskAction: this.onTaskActionCallback,
        setWebviewReady: (value) => {
          this.webviewReady = value;
        },
        drainQueuedMessages: () => this.drainQueuedMessages(),
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
      this.agentListCache,
      this.modelListCache,
      force,
    );
    this.agentListCache = result.agents;
    this.modelListCache = result.models;
  }

  private static async refreshPromptTemplatesCache(force = false): Promise<void> {
    this.templateCache = await refreshSchedulerPromptTemplatesState(
      this.templateCache,
      force,
    );
  }

  private static async refreshSkillReferencesCache(force = false): Promise<void> {
    this.cachedSkillReferences = await refreshSchedulerSkillReferencesState(
      this.cachedSkillReferences,
      force,
    );
  }

  private static getWebviewContent( // html-builder
    webview: vscode.Webview, tasks: ScheduledTask[], agents: AgentInfo[],
    models: ModelInfo[], promptTemplates: PromptTemplate[],
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
      configuredApprovalMode,
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
${buildSchedulerWebviewSharedStyles()}

    .global-error-banner.is-visible {
      display: flex;
    }

    .global-error-banner span {
      min-width: 0px;
      overflow-wrap: anywhere;
    }

    .help-panel {
      position: relative;
      display: grid;
      gap: 0.625rem;
      isolation: isolate;
      overflow: hidden; /* clip */
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
      overflow: hidden; /* truncate */
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
      border: 1px solid var(--vscode-panel-border); /* edge */
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
      gap: 10px; // local-diverge-991
      font-size: 0.875rem;
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
      min-width: 0px; /* flex-fix */
    }

    .help-intro-body {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      font-size: 0.6875rem;
      line-height: 1.45;
    }

    .help-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      align-items: start;
    }

    .help-section {
      border: 1px solid var(--vscode-panel-border); /* outline */
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

    .help-flow-diagram {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent);
    }

    .help-flow-node {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 22%, var(--vscode-panel-border));
      background: color-mix(in srgb, var(--vscode-editor-background) 88%, transparent);
      color: var(--vscode-foreground);
      font-size: 11px;
      font-weight: 700;
      line-height: 1.25;
    }

    .help-flow-arrow {
      color: var(--vscode-descriptionForeground);
      font-size: 14px;
      font-weight: 700;
      line-height: 1;
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
        transform: translate3d(190px, -150px, 0) rotate(22deg) scale(0.34);
      }
    }

${buildSchedulerWebviewExtendedStyles()}
  </style>
</head><body>
  <div class="tab-bar">
    <div class="tabs" role="tablist">
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

  ${buildSchedulerTodoEditorMarkup({ strings })}
  
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
  
  ${buildSchedulerListTabMarkup({ strings })}

  ${buildSchedulerWorkspaceTabsMarkup({
    strings,
    allPresets,
    configuredLanguage,
    configuredApprovalMode,
    helpIntroTitleText,
  })}
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




