/**
 * Copilot Cockpit - Scheduler Webview
 * Provides GUI for task creation, editing, and listing
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import type {
  CockpitBoard,
  ScheduledTask,
  ScheduleHistoryEntry,
  JobDefinition,
  JobFolder,
  TaskAction,
  AgentInfo,
  ModelInfo,
  PromptTemplate,
  ResearchProfile,
  ResearchRun,
  SkillReference,
  ChatSessionBehavior,
  ExecutionDefaultsView,
  TelegramNotificationView,
  TaskScope,
  WebviewToExtensionMessage,
} from "./types";
import { CopilotExecutor } from "./copilotExecutor";
import {
  messages,
  getConfiguredLanguage,
  getCurrentLanguage,
  getCurrentLocaleTag,
  getCronPresets,
} from "./i18n";
import {
  getConfiguredLogLevel,
  getLogDirectoryPath,
  logError,
} from "./logger";
import {
  getCompatibleConfigurationValue,
} from "./extensionCompat";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import {
  buildSchedulerWebviewInitialData,
  escapeHtml,
  escapeHtmlAttr,
  formatModelLabel,
  getWebviewNonce,
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
import { handleSettingsWebviewMessage } from "./schedulerWebviewSettingsHandler";
import { handleTaskWebviewMessage } from "./schedulerWebviewTaskHandler";
import { handleJobWebviewMessage } from "./schedulerWebviewJobHandler";
import { handleResearchWebviewMessage } from "./schedulerWebviewResearchHandler";
import {
  getResolvedWorkspaceRootPaths,
  getGlobalPromptsPath,
  refreshAgentsAndModels,
  refreshPromptTemplates,
  refreshSkillReferences,
  loadPromptTemplateContent,
} from "./schedulerWebviewTemplateCache";

type OutgoingWebviewMessage = { type: string;[key: string]: unknown };
const TODO_INPUT_UPLOADS_FOLDER = "cockpit-input-uploads";

/**
 * Manages the Webview panel for task management
 */
export class SchedulerWebview {
  private static panel: vscode.WebviewPanel | undefined;
  private static cachedAgents: AgentInfo[] = [];
  private static cachedModels: ModelInfo[] = [];
  private static cachedPromptTemplates: PromptTemplate[] = [];
  private static cachedSkillReferences: SkillReference[] = [];
  private static onTaskActionCallback:
    | ((action: TaskAction) => void)
    | undefined;
  private static onTestPromptCallback:
    | ((prompt: string, agent?: string, model?: string) => void)
    | undefined;
  private static extensionUri: vscode.Uri;
  private static currentTasks: ScheduledTask[] = [];
  private static currentJobs: JobDefinition[] = [];
  private static currentJobFolders: JobFolder[] = [];
  private static currentCockpitBoard: CockpitBoard = {
    version: 4,
    sections: [],
    cards: [],
    labelCatalog: [],
    archives: {
      completedSuccessfully: [],
      rejected: [],
    },
    filters: {
      labels: [],
      priorities: [],
      statuses: [],
      archiveOutcomes: [],
      flags: [],
      sortBy: "manual",
      sortDirection: "asc",
      viewMode: "board",
      showArchived: false,
      showRecurringTasks: false,
      hideCardDetails: false,
    },
    updatedAt: "",
  };
  private static currentTelegramNotification: TelegramNotificationView = {
    enabled: false,
    hasBotToken: false,
    hookConfigured: false,
  };
  private static currentExecutionDefaults: ExecutionDefaultsView = {
    agent: "agent",
    model: "",
  };
  private static currentResearchProfiles: ResearchProfile[] = [];
  private static currentActiveResearchRun: ResearchRun | undefined;
  private static currentRecentResearchRuns: ResearchRun[] = [];
  private static currentScheduleHistory: ScheduleHistoryEntry[] = [];
  private static readonly batchedMessageTypes = new Set<string>([
    "updateTasks",
    "updateJobs",
    "updateJobFolders",
    "updateCockpitBoard",
    "updateTelegramNotification",
    "updateExecutionDefaults",
    "updateResearchState",
    "updateScheduleHistory",
    "updateAgents",
    "updateModels",
    "updatePromptTemplates",
    "updateSkills",
  ]);
  private static readonly messageBatchDelayMs = 25;
  private static webviewReady = false;
  private static pendingMessages: OutgoingWebviewMessage[] = [];
  private static lastBatchedMessageSignatures = new Map<string, string>();
  private static pendingMessageFlushTimer:
    | ReturnType<typeof setTimeout>
    | undefined;

  private static resetWebviewReadyState(): void {
    if (this.pendingMessageFlushTimer) {
      clearTimeout(this.pendingMessageFlushTimer);
      this.pendingMessageFlushTimer = undefined;
    }
    this.webviewReady = false;
    this.pendingMessages = [];
    this.lastBatchedMessageSignatures.clear();
  }

  private static getMessageSignature(message: OutgoingWebviewMessage): string {
    return JSON.stringify(message);
  }

  private static shouldSkipRedundantBatchedMessage(
    message: OutgoingWebviewMessage,
  ): boolean {
    if (!this.shouldBatchMessage(message)) {
      return false;
    }

    const signature = this.getMessageSignature(message);
    const previousSignature = this.lastBatchedMessageSignatures.get(message.type);
    if (previousSignature === signature) {
      return true;
    }

    this.lastBatchedMessageSignatures.set(message.type, signature);
    return false;
  }

  private static getHelpChatLanguageInstruction(): string {
    switch (getCurrentLanguage()) {
      case "de":
        return "Answer in Deutsch.";
      case "ja":
        return "Answer in Japanese.";
      default:
        return "Answer in English.";
    }
  }

  private static async launchHelpChat(prompt: string): Promise<void> {
    const fullPrompt = `${this.getHelpChatLanguageInstruction()}\n\n${prompt}`;

    await new CopilotExecutor().executePrompt(fullPrompt, {
      chatSession: "new",
    });
  }

  private static async backupGithubFolder(
    workspaceRoot: string,
  ): Promise<string | undefined> {
    const sourceDir = path.join(workspaceRoot, ".github");
    if (!fs.existsSync(sourceDir)) {
      return undefined;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDir = path.join(
      workspaceRoot,
      ".github-scheduler-backups",
      timestamp,
    );

    fs.mkdirSync(path.dirname(backupDir), { recursive: true });
    fs.cpSync(sourceDir, backupDir, { recursive: true });
    return backupDir;
  }

  /**
   * Dispose the webview panel (e.g., on extension deactivation)
   */
  static dispose(): void {
    if (this.panel) {
      this.panel.dispose();
      // onDidDispose handler will reset panel & readyState
    }
  }

  private static enqueueMessage(message: OutgoingWebviewMessage): void {
    const existingIndex = this.pendingMessages.findIndex(
      (m) => m.type === message.type,
    );
    if (existingIndex >= 0) {
      this.pendingMessages[existingIndex] = message;
      return;
    }
    this.pendingMessages.push(message);
  }

  private static shouldBatchMessage(message: OutgoingWebviewMessage): boolean {
    return this.batchedMessageTypes.has(message.type);
  }

  private static sendMessageNow(message: OutgoingWebviewMessage): void {
    if (!this.panel || !this.webviewReady) {
      return;
    }

    void this.panel.webview.postMessage(message);
  }

  private static schedulePendingMessagesFlush(): void {
    if (this.pendingMessageFlushTimer) {
      return;
    }

    this.pendingMessageFlushTimer = setTimeout(() => {
      this.pendingMessageFlushTimer = undefined;
      this.flushPendingMessages();
    }, this.messageBatchDelayMs);
  }

  private static postMessage(message: OutgoingWebviewMessage): void {
    if (!this.panel) return;

    if (this.shouldSkipRedundantBatchedMessage(message)) {
      return;
    }

    if (!this.webviewReady) {
      this.enqueueMessage(message);
      return;
    }

    if (this.shouldBatchMessage(message)) {
      this.enqueueMessage(message);
      this.schedulePendingMessagesFlush();
      return;
    }

    this.sendMessageNow(message);
  }

  private static flushPendingMessages(): void {
    if (!this.panel || !this.webviewReady) return;

    if (this.pendingMessageFlushTimer) {
      clearTimeout(this.pendingMessageFlushTimer);
      this.pendingMessageFlushTimer = undefined;
    }

    if (this.pendingMessages.length === 0) return;
    const queue = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of queue) {
      this.sendMessageNow(message);
    }
  }

  /**
   * Show or reveal the webview panel
   */
  static async show(
    extensionUri: vscode.Uri,
    tasks: ScheduledTask[],
    jobs: JobDefinition[],
    jobFolders: JobFolder[],
    cockpitBoard: CockpitBoard,
    telegramNotification: TelegramNotificationView,
    executionDefaults: ExecutionDefaultsView,
    researchProfiles: ResearchProfile[],
    activeResearchRun: ResearchRun | undefined,
    recentResearchRuns: ResearchRun[],
    onTaskAction: (action: TaskAction) => void,
    onTestPrompt?: (prompt: string, agent?: string, model?: string) => void,
  ): Promise<void> {
    this.extensionUri = extensionUri;
    this.currentTasks = tasks;
    this.currentJobs = jobs;
    this.currentJobFolders = jobFolders;
    this.currentCockpitBoard = cockpitBoard;
    this.currentTelegramNotification = telegramNotification;
    this.currentExecutionDefaults = executionDefaults;
    this.currentResearchProfiles = researchProfiles;
    this.currentActiveResearchRun = activeResearchRun;
    this.currentRecentResearchRuns = recentResearchRuns;
    this.onTaskActionCallback = onTaskAction;
    this.onTestPromptCallback = onTestPrompt;

    // Ensure we have baseline data for the first render (do not block the UI)
    if (this.cachedAgents.length === 0) {
      this.cachedAgents = CopilotExecutor.getBuiltInAgents();
    }
    if (this.cachedModels.length === 0) {
      this.cachedModels = CopilotExecutor.getFallbackModels();
    }

    const refreshInBackground = (): void => {
      void this.refreshAgentsAndModelsCache(true)
        .then(() => {
          this.postMessage({
            type: "updateAgents",
            agents: this.cachedAgents,
          });
          this.postMessage({
            type: "updateModels",
            models: this.cachedModels,
          });
        })
        .catch((error) => {
          const rawMessage =
            error instanceof Error ? error.message : String(error ?? "");
          logError(
            "[CopilotScheduler] Failed to refresh agents/models:",
            this.sanitizeErrorDetailsForUser(rawMessage),
          );
        });

      void this.refreshPromptTemplatesCache(true)
        .then(() => {
          this.postMessage({
            type: "updatePromptTemplates",
            templates: this.cachedPromptTemplates,
          });
        })
        .catch((error) => {
          const rawMessage =
            error instanceof Error ? error.message : String(error ?? "");
          logError(
            "[CopilotScheduler] Failed to refresh prompt templates:",
            this.sanitizeErrorDetailsForUser(rawMessage),
          );
        });

      void this.refreshSkillReferencesCache(true)
        .then(() => {
          this.postMessage({
            type: "updateSkills",
            skills: this.cachedSkillReferences,
          });
        })
        .catch((error) => {
          const rawMessage =
            error instanceof Error ? error.message : String(error ?? "");
          logError(
            "[CopilotScheduler] Failed to refresh skills:",
            this.sanitizeErrorDetailsForUser(rawMessage),
          );
        });
    };

    if (this.panel) {
      // Rebuild the webview when reopening an existing panel so updated bundled
      // scripts/styles are applied instead of relying on a retained stale context.
      this.resetWebviewReadyState();
      this.panel.webview.html = this.getWebviewContent(
        this.panel.webview,
        tasks,
        this.cachedAgents,
        this.cachedModels,
        this.cachedPromptTemplates,
      );
      this.panel.reveal(vscode.ViewColumn.One);
      this.updateTasks(tasks);
      this.updateJobs(jobs);
      this.updateJobFolders(jobFolders);
      this.updateCockpitBoard(cockpitBoard);
      this.updateTelegramNotification(telegramNotification);
      this.updateExecutionDefaults(executionDefaults);
      this.updateResearchState(
        researchProfiles,
        activeResearchRun,
        recentResearchRuns,
      );
      // Send already-cached agents/models/templates without rescanning
      this.postMessage({
        type: "updateAgents",
        agents: this.cachedAgents,
      });
      this.postMessage({
        type: "updateModels",
        models: this.cachedModels,
      });
      this.postMessage({
        type: "updatePromptTemplates",
        templates: this.cachedPromptTemplates,
      });
      this.postMessage({
        type: "updateSkills",
        skills: this.cachedSkillReferences,
      });
    } else {
      // Create new panel
      this.panel = vscode.window.createWebviewPanel(
        "copilotScheduler",
        messages.webviewTitle(),
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [
            vscode.Uri.joinPath(extensionUri, "media"),
            vscode.Uri.joinPath(extensionUri, "images"),
          ],
        },
      );

      // New webview instance (or re-created panel) starts as not-ready.
      this.resetWebviewReadyState();

      // Set icon
      this.panel.iconPath = {
        light: vscode.Uri.joinPath(extensionUri, "images", "icon.svg"),
        dark: vscode.Uri.joinPath(extensionUri, "images", "icon.svg"),
      };

      // Set HTML content
      const htmlContent = this.getWebviewContent(
        this.panel.webview,
        tasks,
        this.cachedAgents,
        this.cachedModels,
        this.cachedPromptTemplates,
      );

      // Handle messages from webview (register before setting HTML to avoid races)
      this.panel.webview.onDidReceiveMessage(
        async (message: WebviewToExtensionMessage) => {
          try {
            await this.handleMessage(message);
          } catch (error) {
            const rawDetailsForLog =
              error instanceof Error ? error.message : String(error ?? "");
            const detailsForLog =
              this.sanitizeErrorDetailsForUser(rawDetailsForLog);
            const rawDetailsForUser =
              error instanceof Error ? error.message : String(error ?? "");
            const detailsForUser =
              this.sanitizeErrorDetailsForUser(rawDetailsForUser);
            logError("[CopilotScheduler] Webview message handling failed:", {
              type: (message as { type?: unknown } | undefined)?.type,
              error: detailsForLog,
            });
            this.showError(
              messages.webviewMessageHandlingFailed(
                detailsForUser || messages.webviewUnknown(),
              ),
            );
          }
        },
      );

      // Set HTML content
      this.panel.webview.html = htmlContent;

      // Handle panel disposal
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.resetWebviewReadyState();
      });

      refreshInBackground();
    }
  }

  /**
   * Update tasks in the webview
   */
  static updateTasks(tasks: ScheduledTask[]): void {
    this.currentTasks = tasks;
    this.postMessage({
      type: "updateTasks",
      tasks: tasks,
    });
  }

  static updateJobs(jobs: JobDefinition[]): void {
    this.currentJobs = jobs;
    this.postMessage({
      type: "updateJobs",
      jobs,
    });
  }

  static updateJobFolders(jobFolders: JobFolder[]): void {
    this.currentJobFolders = jobFolders;
    this.postMessage({
      type: "updateJobFolders",
      jobFolders,
    });
  }

  static updateCockpitBoard(cockpitBoard: CockpitBoard): void {
    this.currentCockpitBoard = cockpitBoard;
    this.postMessage(createUpdateCockpitBoardMessage(cockpitBoard));
  }

  static updateTelegramNotification(
    telegramNotification: TelegramNotificationView,
  ): void {
    this.currentTelegramNotification = telegramNotification;
    this.postMessage({
      type: "updateTelegramNotification",
      telegramNotification,
    });
  }

  static updateExecutionDefaults(
    executionDefaults: ExecutionDefaultsView,
  ): void {
    this.currentExecutionDefaults = executionDefaults;
    this.postMessage({
      type: "updateExecutionDefaults",
      executionDefaults,
    });
  }

  static updateResearchState(
    profiles: ResearchProfile[],
    activeRun: ResearchRun | undefined,
    recentRuns: ResearchRun[],
  ): void {
    this.currentResearchProfiles = profiles;
    this.currentActiveResearchRun = activeRun;
    this.currentRecentResearchRuns = recentRuns;
    this.postMessage({
      type: "updateResearchState",
      profiles,
      activeRun,
      recentRuns,
    });
  }

  static updateScheduleHistory(entries: ScheduleHistoryEntry[]): void {
    this.currentScheduleHistory = entries;
    this.postMessage({
      type: "updateScheduleHistory",
      entries,
    });
  }

  /**
   * Show an error message inside the webview
   */
  static showError(errorMessage: string): void {
    const safe = this.sanitizeErrorDetailsForUser(errorMessage);
    this.postMessage({
      type: "showError",
      text: safe || messages.webviewUnknown(),
    });
  }

  private static sanitizeErrorDetailsForUser(message: string): string {
    return sanitizeAbsolutePathDetails(message);
  }

  /**
   * Refresh language in the webview
   */
  static refreshLanguage(tasks: ScheduledTask[]): void {
    if (this.panel) {
      // Re-rendering HTML resets the webview context; wait for the new instance to become ready.
      this.resetWebviewReadyState();

      // Synchronously rebuild built-in agents/models so the initial HTML
      // already reflects the new language (U17: avoid stale localized names).
      this.cachedAgents = CopilotExecutor.getBuiltInAgents();
      this.cachedModels = CopilotExecutor.getFallbackModels();

      // Regenerate HTML with new language
      this.panel.webview.html = this.getWebviewContent(
        this.panel.webview,
        tasks,
        this.cachedAgents,
        this.cachedModels,
        this.cachedPromptTemplates,
      );

      // Re-send cached data once the webview is ready again.
      this.postMessage({
        type: "updateAgents",
        agents: this.cachedAgents,
      });
      this.postMessage({
        type: "updateModels",
        models: this.cachedModels,
      });
      this.postMessage({
        type: "updatePromptTemplates",
        templates: this.cachedPromptTemplates,
      });
      this.postMessage({
        type: "updateSkills",
        skills: this.cachedSkillReferences,
      });

      // Re-fetch agents/models/templates so that localized names reflect the new language
      void this.refreshCachesAndNotifyPanel(true).catch(() => { });
    }
  }

  /**
   * Refresh cached agents/models/templates and notify the webview without rebuilding HTML.
   * Use this for settings changes (e.g., global paths) to avoid resetting form state.
   */
  static async refreshCachesAndNotifyPanel(force = true): Promise<void> {
    try {
      await this.refreshAgentsAndModelsCache(force);
    } catch {
      this.cachedAgents = CopilotExecutor.getBuiltInAgents();
      this.cachedModels = CopilotExecutor.getFallbackModels();
    }

    try {
      await this.refreshPromptTemplatesCache(force);
    } catch {
      this.cachedPromptTemplates = [];
    }

    try {
      await this.refreshSkillReferencesCache(force);
    } catch {
      this.cachedSkillReferences = [];
    }

    if (!this.panel) return;

    this.postMessage({
      type: "updateAgents",
      agents: this.cachedAgents,
    });
    this.postMessage({
      type: "updateModels",
      models: this.cachedModels,
    });
    this.postMessage({
      type: "updatePromptTemplates",
      templates: this.cachedPromptTemplates,
    });
    this.postMessage({
      type: "updateSkills",
      skills: this.cachedSkillReferences,
    });
  }

  /**
   * Switch to the list tab, optionally showing a success toast
   */
  static switchToList(successMessage?: string): void {
    this.postMessage({ type: "switchToList", successMessage });
  }

  static switchToTab(tab: "create" | "list" | "jobs" | "board" | "research" | "settings" | "help"): void {
    this.postMessage({ type: "switchToTab", tab });
  }

  static updateAutoShowOnStartup(enabled: boolean): void {
    this.postMessage({
      type: "updateAutoShowOnStartup",
      enabled,
    });
  }

  /**
   * Force the webview into "create new task" mode (clears edit state and form).
   */
  static startCreateTask(): void {
    this.postMessage({ type: "startCreateTask" });
  }

  static startCreateTodo(): void {
    this.postMessage(createStartCreateTodoMessage());
  }

  static startCreateJob(): void {
    this.postMessage({ type: "startCreateJob" });
  }

  /**
   * Focus on a specific task
   */
  static focusTask(taskId: string): void {
    if (!taskId) return;
    this.postMessage({
      type: "focusTask",
      taskId: taskId,
    });
  }

  static focusJob(jobId: string, folderId?: string): void {
    if (!jobId) return;
    this.postMessage({
      type: "focusJob",
      jobId,
      folderId,
    });
  }

  /**
   * Start editing a specific task (opens edit mode in the webview)
   */
  static editTask(taskId?: string): void {
    if (!taskId) return;
    this.postMessage({
      type: "editTask",
      taskId: taskId,
    });
  }

  private static getJobDialogContext() {
    return {
      currentJobs: this.currentJobs,
      currentJobFolders: this.currentJobFolders,
      currentTasks: this.currentTasks,
      onTaskActionCallback: this.onTaskActionCallback,
    };
  }

  /**
   * Handle messages from webview
   */
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

    switch (message.type) {
      case "createTask":
        this.onTaskActionCallback?.({
          action: "edit",
          taskId: "__create__",
          data: message.data,
        });
        break;

      case "updateTask":
        this.onTaskActionCallback?.({
          action: "edit",
          taskId: message.taskId,
          data: message.data,
        });
        break;

      case "testPrompt":
        this.onTestPromptCallback?.(
          message.prompt,
          message.agent,
          message.model,
        );
        break;

      case "refreshAgents":
        await this.refreshAgentsAndModelsCache(true);
        this.postMessage({
          type: "updateAgents",
          agents: this.cachedAgents,
        });
        this.postMessage({
          type: "updateModels",
          models: this.cachedModels,
        });
        break;

      case "refreshPrompts":
        await this.refreshPromptTemplatesCache(true);
        await this.refreshSkillReferencesCache(true);
        this.postMessage({
          type: "updatePromptTemplates",
          templates: this.cachedPromptTemplates,
        });
        this.postMessage({
          type: "updateSkills",
          skills: this.cachedSkillReferences,
        });
        break;

      case "restoreScheduleHistory":
        this.onTaskActionCallback?.({
          action: "restoreHistory",
          taskId: "__history__",
          historyId: message.snapshotId,
        });
        break;

      case "toggleAutoShowOnStartup":
        this.onTaskActionCallback?.({
          action: "refresh",
          taskId: "__toggleAutoShowOnStartup__",
        });
        break;

      case "setupMcp":
        this.onTaskActionCallback?.({
          action: "setupMcp",
          taskId: "__settings__",
        });
        break;

      case "syncBundledSkills":
        this.onTaskActionCallback?.({
          action: "syncBundledSkills",
          taskId: "__settings__",
        });
        break;

      case "saveTelegramNotification":
        this.onTaskActionCallback?.({
          action: "saveTelegramNotification",
          taskId: "__settings__",
          telegramData: message.data,
        });
        break;

      case "testTelegramNotification":
        this.onTaskActionCallback?.({
          action: "testTelegramNotification",
          taskId: "__settings__",
          telegramData: message.data,
        });
        break;

      case "saveExecutionDefaults":
        this.onTaskActionCallback?.({
          action: "saveExecutionDefaults",
          taskId: "__settings__",
          executionDefaults: message.data,
        });
        break;

      case "loadPromptTemplate":
        await loadPromptTemplateContent(
          message.path,
          message.source,
          this.cachedPromptTemplates,
          (m) => this.postMessage(m),
        );
        break;

      case "webviewReady":
        this.webviewReady = true;
        this.flushPendingMessages();
        break;

      case "requestTodoFileUpload":
        await this.handleTodoFileUploadRequest();
        break;
    }
  }

  private static sanitizeTodoUploadFileName(fileName: string): string {
    const parsed = path.parse(fileName || "upload");
    const rawBase = parsed.name || "upload";
    const safeBase = rawBase
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .slice(0, 48) || "upload";
    const safeExt = (parsed.ext || "").replace(/[^a-zA-Z0-9.]+/g, "").slice(0, 12);
    return `${safeBase}${safeExt}`;
  }

  private static async handleTodoFileUploadRequest(): Promise<void> {
    const strings = buildSchedulerWebviewStrings(getCurrentLanguage());
    const workspaceRoot = getResolvedWorkspaceRootPaths()[0];
    if (!workspaceRoot) {
      this.postMessage({
        type: "todoFileUploadResult",
        ok: false,
        message: strings.boardUploadFilesError || "File upload failed.",
      });
      return;
    }

    try {
      const selectedFiles = await vscode.window.showOpenDialog({
        canSelectMany: true,
        canSelectFiles: true,
        canSelectFolders: false,
        openLabel: strings.boardUploadFiles || "Upload Files",
      });

      if (!selectedFiles || selectedFiles.length === 0) {
        this.postMessage({
          type: "todoFileUploadResult",
          ok: false,
          cancelled: true,
          message: strings.boardUploadFilesEmpty || "No files selected.",
        });
        return;
      }

      const uploadFolderPath = path.join(
        workspaceRoot,
        ".vscode",
        TODO_INPUT_UPLOADS_FOLDER,
      );
      fs.mkdirSync(uploadFolderPath, { recursive: true });
      ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);

      const relativePaths: string[] = [];
      const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);

      selectedFiles.forEach((fileUri, index) => {
        const sourcePath = fileUri.fsPath;
        const safeName = this.sanitizeTodoUploadFileName(path.basename(sourcePath));
        const parsed = path.parse(safeName);
        const prefix = `${stamp}-${String(index + 1).padStart(2, "0")}`;
        let targetName = `${prefix}-${parsed.name}${parsed.ext}`;
        let targetPath = path.join(uploadFolderPath, targetName);
        let attempt = 2;

        while (fs.existsSync(targetPath)) {
          targetName = `${prefix}-${parsed.name}-${attempt}${parsed.ext}`;
          targetPath = path.join(uploadFolderPath, targetName);
          attempt += 1;
        }

        fs.copyFileSync(sourcePath, targetPath);
        relativePaths.push(path.relative(workspaceRoot, targetPath).split(path.sep).join("/"));
      });

      const insertedText = [
        relativePaths.length === 1 ? "Attachment:" : "Attachments:",
        ...relativePaths.map((relativePath) => `- ${relativePath}`),
      ].join("\n");

      this.postMessage({
        type: "todoFileUploadResult",
        ok: true,
        message: strings.boardUploadFilesSuccess || "Files copied into the workspace input folder and added to the description.",
        insertedText,
        relativePaths,
        folderRelativePath: `.vscode/${TODO_INPUT_UPLOADS_FOLDER}`,
      });
    } catch (error) {
      logError("Todo file upload failed", error);
      this.postMessage({
        type: "todoFileUploadResult",
        ok: false,
        message: (strings.boardUploadFilesError || "File upload failed.") + " " + sanitizeAbsolutePathDetails(
          error instanceof Error ? error.message : String(error ?? ""),
        ),
      });
    }
  }

  private static async refreshAgentsAndModelsCache(force = false): Promise<void> {
    const result = await refreshAgentsAndModels(this.cachedAgents, this.cachedModels, force);
    this.cachedAgents = result.agents;
    this.cachedModels = result.models;
  }

  private static async refreshPromptTemplatesCache(force = false): Promise<void> {
    this.cachedPromptTemplates = await refreshPromptTemplates(this.cachedPromptTemplates, force);
  }

  private static async refreshSkillReferencesCache(force = false): Promise<void> {
    this.cachedSkillReferences = await refreshSkillReferences(this.cachedSkillReferences, force);
  }

  /**
   * Generate webview HTML content
   */
  private static getWebviewContent(
    webview: vscode.Webview,
    tasks: ScheduledTask[],
    agents: AgentInfo[],
    models: ModelInfo[],
    promptTemplates: PromptTemplate[],
  ): string {
    const nonce = getWebviewNonce();
    const uiLanguage = getCurrentLanguage();
    const configuredLanguage = getConfiguredLanguage();
    const presets = getCronPresets();
    const defaultScope = getCompatibleConfigurationValue<TaskScope>(
      "defaultScope",
      "workspace",
    );
    const defaultChatSession = getCompatibleConfigurationValue<ChatSessionBehavior>(
      "chatSession",
      "new",
    );
    const defaultJitterSecondsRaw = getCompatibleConfigurationValue<number>(
      "jitterSeconds",
      600,
    );
    // Keep the Webview resilient even if settings are corrupted/out-of-range.
    const defaultJitterSeconds = (() => {
      const n =
        typeof defaultJitterSecondsRaw === "number"
          ? defaultJitterSecondsRaw
          : Number(defaultJitterSecondsRaw);
      if (!Number.isFinite(n)) return 600;
      const i = Math.floor(n);
      return Math.min(Math.max(i, 0), 1800);
    })();
    const initialTasks = Array.isArray(tasks) ? tasks : [];
    const initialAgents = Array.isArray(agents) ? agents : [];
    const initialModels = Array.isArray(models) ? models : [];
    const initialTemplates = Array.isArray(promptTemplates)
      ? promptTemplates
      : [];

    const strings = buildSchedulerWebviewStrings(uiLanguage);

    const allPresets = presets;

    const initialData = buildSchedulerWebviewInitialData({
      initialTasks,
      currentJobs: this.currentJobs,
      currentJobFolders: this.currentJobFolders,
      currentCockpitBoard: this.currentCockpitBoard,
      currentTelegramNotification: this.currentTelegramNotification,
      currentExecutionDefaults: this.currentExecutionDefaults,
      currentResearchProfiles: this.currentResearchProfiles,
      currentActiveResearchRun: this.currentActiveResearchRun,
      currentRecentResearchRuns: this.currentRecentResearchRuns,
      initialAgents,
      initialModels,
      initialTemplates,
      cachedSkillReferences: this.cachedSkillReferences,
      workspacePaths: getResolvedWorkspaceRootPaths(),
      defaultJitterSeconds,
      defaultChatSession,
      currentScheduleHistory: this.currentScheduleHistory,
      autoShowOnStartup: getCompatibleConfigurationValue<boolean>(
        "autoShowOnStartup",
        false,
        vscode.workspace.workspaceFolders?.[0]?.uri,
      ),
      currentLogLevel: getConfiguredLogLevel(),
      currentLogDirectory: getLogDirectoryPath(),
      configuredLanguage,
      locale: getCurrentLocaleTag(),
      strings,
    });
    const helpIntroTitle = typeof strings.helpIntroTitle === "string"
      ? strings.helpIntroTitle
      : "";
    const helpIntroTitleText = helpIntroTitle.replace(/^\s*🚀\s*/u, "").trim() || helpIntroTitle;

    const scriptPath = vscode.Uri.joinPath(
      this.extensionUri,
      "media",
      "generated",
      "schedulerWebview.js",
    );
    let scriptCacheToken = "static";
    try {
      const scriptStats = fs.statSync(scriptPath.fsPath);
      scriptCacheToken = `${scriptStats.mtimeMs}-${scriptStats.size}`;
    } catch {
      // Fall back to a stable token if the bundled file isn't readable.
    }
    const scriptUri = webview.asWebviewUri(scriptPath).with({
      query: `v=${encodeURIComponent(scriptCacheToken)}`,
    });
    const documentContent = `  <style>
    * {
      box-sizing: border-box;
    }
    
    body {
      font-family: var(--vscode-font-family);
      padding: 12px 14px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
      font-size: 12px;
      line-height: 1.35;
    }

    .tab-bar {
      position: sticky;
      top: 0;
      z-index: 30;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 8px;
      margin: -12px -14px 10px -14px;
      padding: 8px 16px 6px 16px;
      background-color: var(--vscode-editor-background);
      background: linear-gradient(
        to bottom,
        var(--vscode-editor-background) 0%,
        var(--vscode-editor-background) 85%,
        color-mix(in srgb, var(--vscode-editor-background) 75%, transparent) 100%
      );
      border-bottom: 1px solid color-mix(in srgb, var(--vscode-panel-border) 65%, transparent);
    }
    
    .tabs {
      display: flex;
      gap: 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      flex: 1 1 auto;
      min-width: 0;
      overflow-x: auto;
      overflow-y: hidden;
      white-space: nowrap;
      scrollbar-gutter: stable both-edges;
      scrollbar-width: thin;
    }

    .tabs::-webkit-scrollbar {
      height: 6px;
    }

    .tabs::-webkit-scrollbar-thumb {
      background: var(--vscode-scrollbarSlider-background);
      border-radius: 999px;
    }

    .tab-actions {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .tab-button-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 7px;
      min-height: 1.2em;
    }

    .tab-button-symbol {
      font-size: 1.1em;
      line-height: 1;
      opacity: 0.95;
    }

    .tab-button-label {
      min-width: 0;
    }

    .tab-button-label:empty {
      display: none;
    }

    .tab-button-label.is-dirty {
      display: inline-flex;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground, #d97706));
      box-shadow: 0 0 0 1px var(--vscode-editor-background);
    }

    .tab-help-button {
      width: 40px;
      min-width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 16px;
      margin-right: 2px;
    }

    .tab-settings-button {
      width: 40px;
      min-width: 40px;
      height: 40px;
      padding: 0;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      line-height: 1;
      margin-left: 2px;
    }
    
    .tab-button {
      padding: 9px 14px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 15px;
      font-weight: 600;
      line-height: 1.15;
      flex: 1 1 auto;
      text-align: center;
      min-width: max-content;
    }

    .tab-button[data-tab="todo-edit"],
    .tab-button[data-tab="create"],
    .tab-button[data-tab="jobs-edit"] {
      flex: 0 0 auto;
      padding-left: 10px;
      padding-right: 10px;
    }
    
    .tab-button:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .tab-button.active {
      border-bottom-color: var(--vscode-focusBorder);
      color: var(--vscode-textLink-foreground);
    }

    .tab-group-sep {
      flex: 0 0 1px;
      width: 1px;
      align-self: stretch;
      background: var(--vscode-panel-border);
      margin: 6px 4px;
      opacity: 0.6;
    }

    .label-suggestion-list {
      display: none;
      flex-wrap: wrap;
      gap: 6px;
      padding: 8px;
      margin-top: 4px;
      background: var(--vscode-editorWidget-background);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
    }

    .label-catalog-section {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 8px;
    }

    .label-catalog-section:empty {
      display: none;
    }

    .flag-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 9px;
      border-radius: 4px;
      font-size: inherit;
      line-height: 1.4;
      font-weight: 600;
      border: 1px solid var(--vscode-panel-border);
    }

    .flag-catalog-section {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }

    .flag-catalog-section:empty {
      display: none;
    }

    .todo-inline-actions-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .todo-inline-actions-row > input[type="text"] {
      flex: 1 1 200px;
      min-width: 180px;
    }

    .todo-inline-actions-row > button {
      position: relative;
      z-index: 1;
      flex: 0 0 auto;
    }

    .todo-color-input-shell {
      position: relative;
      z-index: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 42px;
      width: 42px;
      min-width: 42px;
      height: 30px;
      overflow: hidden;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      background: var(--vscode-input-background);
      box-sizing: border-box;
    }

    .todo-color-input-shell input[type="color"] {
      appearance: none;
      -webkit-appearance: none;
      display: block;
      width: 100%;
      min-width: 100%;
      height: 100%;
      padding: 0;
      margin: 0;
      border: 0;
      background: transparent;
      cursor: pointer;
      box-sizing: border-box;
    }

    .todo-color-input-shell input[type="color"]::-webkit-color-swatch-wrapper {
      padding: 0;
    }

    .todo-color-input-shell input[type="color"]::-webkit-color-swatch {
      border: 0;
      border-radius: 3px;
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }

    .global-error-banner {
      display: none;
      align-items: center;
      gap: 10px;
      margin: 0 0 12px 0;
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      font-size: 13px;
      line-height: 1.4;
    }

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
        transform: translate3d(190px, -150px, 0) rotate(22deg) scale(0.34);
      }
    }

    .form-group {
      margin-bottom: 12px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
      font-size: 12px;
    }

    .form-group label[for] {
      cursor: pointer;
    }
    
    input[type="text"],
    input[type="number"],
    textarea,
    select {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
    }
    
    textarea {
      min-height: 92px;
      resize: vertical;
    }
    
    input:focus,
    textarea:focus,
    select:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    
    .checkbox-group {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
    }
    
    .checkbox-group input[type="checkbox"] {
      width: auto;
    }

    .checkbox-group span {
      cursor: pointer;
    }
    
    .button-group {
      display: flex;
      gap: 8px;
      margin-top: 12px;
      flex-wrap: wrap;
    }
    
    button {
      padding: 6px 10px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
      line-height: 1.2;
    }
    
    .btn-primary {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    
    .btn-primary:hover {
      background-color: var(--vscode-button-hoverBackground);
    }
    
    .btn-secondary {
      background-color: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    
    .btn-secondary:hover {
      background-color: var(--vscode-button-secondaryHoverBackground);
    }
    
    .btn-danger {
      background-color: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }
    
    .btn-icon {
      padding: 4px 6px;
      background: transparent;
      color: var(--vscode-foreground);
    }
    
    .btn-icon:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .task-list {
      display: block;
      font-size: 12px;
      line-height: 1.4;
    }

    .task-filter-bar {
      display: flex;
      gap: 5px;
      margin-bottom: 6px;
      flex-wrap: wrap;
      align-items: center;
    }

    .task-filter-select {
      min-width: 160px;
      max-width: 220px;
    }

    .task-filter-btn {
      padding: 3px 8px;
      font-size: 11px;
    }

    .task-filter-btn.active {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .task-sections {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 5px;
      align-items: start;
    }

    .task-sections-column {
      display: grid;
      gap: 5px;
      align-content: start;
      min-width: 0;
    }

    .task-sections.filtered {
      grid-template-columns: 1fr;
    }

    .task-sections.filtered .task-sections-column {
      display: contents;
    }

    .task-section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 5px;
      background-color: var(--vscode-editor-background);
      min-width: 0;
    }

    .task-section-title {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 3px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }

    .task-section-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 3px;
      padding: 0;
      opacity: 0.7;
      transition: opacity 0.12s ease, transform 0.2s ease;
      font-size: 10px;
      line-height: 1;
    }

    .task-section-toggle:hover {
      opacity: 1;
      background: var(--vscode-list-hoverBackground);
    }

    .task-section.is-collapsed .task-section-toggle {
      transform: rotate(-90deg);
    }

    .task-section-body {
      display: grid;
      grid-template-rows: 1fr;
      overflow: hidden;
      transition: grid-template-rows 0.2s ease, opacity 0.2s ease;
    }

    .task-section.is-collapsed .task-section-body {
      grid-template-rows: 0fr;
      opacity: 0.8;
    }

    .task-section-body-inner {
      min-height: 0;
      overflow: hidden;
    }

    .task-subsection {
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 72%, transparent);
      border-radius: 5px;
      padding: 4px;
      margin-bottom: 6px;
      background: color-mix(in srgb, var(--vscode-editor-background) 92%, var(--vscode-editorWidget-background));
      min-width: 0;
    }

    .task-subsection:last-child {
      margin-bottom: 0;
    }

    .task-subsection-title {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      font-weight: 600;
      min-width: 0;
    }

    .task-subsection-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .task-subsection-count,
    .task-section-count {
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .task-subsection-body {
      min-width: 0;
    }
    
    .task-card {
      display: grid;
      gap: 3px;
      padding: 5px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background-color: var(--vscode-editor-background);
      margin-bottom: 4px;
    }

    .task-card.other-workspace {
      border-left-width: 4px;
      border-left-color: var(--vscode-inputValidation-warningBorder);
    }
    
    .task-card.disabled {
      opacity: 0.6;
    }
    
    .task-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 6px;
      margin-bottom: 1px;
    }

    .task-header-main {
      display: flex;
      align-items: center;
      gap: 5px;
      min-width: 0;
    }
    
    .task-name {
      font-weight: 600;
      font-size: 12px;
      line-height: 1.35;
    }
    
    .task-name.clickable, .task-status, .task-badge.clickable {
      cursor: pointer;
      transition: opacity 0.2s;
    }
    
    .task-name.clickable:hover, .task-status:hover, .task-badge.clickable:hover {
      opacity: 0.7;
    }
    
    .task-status {
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      line-height: 1.3;
    }
    
    .task-status.enabled {
      background-color: var(--vscode-testing-iconPassed);
      color: var(--vscode-button-foreground);
    }
    
    .task-status.disabled {
      background-color: var(--vscode-disabledForeground);
      color: var(--vscode-button-foreground);
    }
    
    .task-info {
      display: flex;
      flex-wrap: wrap;
      gap: 3px 8px;
      font-size: 11px;
      line-height: 1.4;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 1px;
    }
    
    .task-info span {
      margin-right: 0;
    }

    .task-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 11px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-right: 0;
    }

    .task-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 3px;
      margin-top: 1px;
      margin-bottom: 1px;
    }

    .task-badge.label {
      background-color: var(--vscode-editorInfo-background);
      color: var(--vscode-editorInfo-foreground);
    }
    
    .task-prompt {
      padding: 4px 5px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
      font-size: 11px;
      line-height: 1.4;
      white-space: pre-wrap;
      max-height: 28px;
      overflow: hidden;
      margin-bottom: 1px;
    }
    
    .task-actions {
      display: flex;
      gap: 3px;
      flex-wrap: wrap;
      align-items: center;
    }

    .task-actions button {
      padding: 3px 6px;
      font-size: 11px;
      line-height: 1.2;
    }
    
    .empty-state {
      text-align: center;
      padding: 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    @media (max-width: 920px) {
      .task-sections {
        grid-template-columns: 1fr;
      }

      .task-sections-column {
        display: grid;
      }
    }
    
    .radio-group {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    
    .radio-group label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: normal;
      cursor: pointer;
      user-select: none;
      min-height: 28px;
    }
    
    .preset-select {
      margin-bottom: 8px;
    }
    
    .section-title {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 8px;
      color: var(--vscode-foreground);
    }
    
    .inline-group {
      display: flex;
      gap: 12px;
    }
    
    .inline-group .form-group {
      flex: 1;
    }

    .template-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .template-row select {
      flex: 1;
      min-width: 0;
    }

    .friendly-cron {
      margin-top: 8px;
      padding: 8px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      background-color: var(--vscode-editorWidget-background);
    }

    .friendly-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .friendly-grid .form-group {
      flex: 1 1 160px;
      margin-bottom: 6px;
    }

    .friendly-field {
      display: none;
    }

    .friendly-field.visible {
      display: block;
    }

    .friendly-actions {
      display: flex;
      gap: 6px;
      align-items: center;
      margin-top: 6px;
    }

    .task-editor-shell {
      display: grid;
      gap: 12px;
    }

    .task-editor-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent),
        color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)
      );
    }

    .task-editor-header-copy {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .task-editor-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(340px, 0.9fr);
      gap: 12px;
      align-items: start;
    }

    .task-editor-card {
      display: grid;
      gap: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background-color: var(--vscode-editor-background);
      padding: 12px;
    }

    .task-editor-card.is-wide {
      grid-column: 1 / -1;
    }

    .task-editor-card .section-title {
      margin-bottom: 0;
    }

    .task-editor-card .note {
      margin-top: -3px;
    }

    .task-editor-options-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px 12px;
      align-items: start;
    }

    .task-editor-options-grid .form-group.wide {
      grid-column: 1 / -1;
    }

    .cron-preview {
      margin-top: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      flex-wrap: wrap;
    }

    .cron-preview strong {
      color: var(--vscode-foreground);
    }

    .note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 3px;
      margin-bottom: 0;
    }

    .board-columns-shell {
      width: 100%;
      overflow-x: auto;
      overflow-y: visible;
      padding-bottom: 10px;
      min-height: 200px;
    }

    .cockpit-card-details {
      display: block;
    }

    .cockpit-board-hide-card-details .cockpit-card-details,
    .cockpit-board-compact-details .cockpit-card-details {
      display: none;
    }

    .board-filter-sticky {
      position: sticky;
      top: var(--cockpit-tab-bar-sticky-top, 0px);
      z-index: 24;
      display: grid;
      gap: 8px;
      background: var(--vscode-sideBar-background);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding: 8px 0 6px;
      margin-bottom: 8px;
    }

    .board-filter-sticky.is-collapsed {
      padding-bottom: 4px;
    }

    .board-filter-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
      width: 100%;
      max-width: 1600px;
    }

    .board-filter-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
    }

    .board-filter-body {
      display: grid;
      gap: 8px;
      min-width: 0;
    }

    .board-filter-grid-shell {
      min-width: 0;
    }

    .board-filter-sticky.is-collapsed .board-filter-grid-shell {
      display: none;
    }

    .board-filter-footer {
      display: grid;
      gap: 6px;
      min-width: 0;
    }

    .board-filter-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 8px;
      align-items: end;
      max-width: 1600px;
      min-width: 0;
    }

    .board-filter-grid .form-group {
      margin: 0;
      min-width: 0;
    }

    .board-filter-grid .board-filter-search {
      grid-column: span 2;
      min-width: 220px;
    }

    .board-filter-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-end;
      margin-top: 6px;
      max-width: 1600px;
      min-width: 0;
    }

    .board-filter-primary-actions {
      display: flex;
      flex: 1 1 340px;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      min-width: 0;
    }

    .board-filter-view-group {
      display: flex;
      justify-content: center;
      flex: 0 1 160px;
      min-width: 140px;
    }

    .board-filter-view-group .form-group {
      width: 100%;
      max-width: 140px;
      margin: 0;
      min-width: 110px;
    }

    .board-filter-options {
      display: flex;
      flex: 1 1 340px;
      flex-wrap: wrap;
      gap: 8px 12px;
      align-items: center;
      justify-content: flex-end;
      min-width: 0;
    }

    .board-filter-options label {
      min-width: 0;
      white-space: nowrap;
    }

    .board-toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .board-col-width-group {
      display: flex;
      align-items: center;
      flex: 0 1 220px;
      flex-wrap: wrap;
      gap: 6px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      min-width: 170px;
    }

    .board-col-width-group input[type="range"] {
      width: min(100%, 140px);
      flex: 1 1 120px;
      cursor: pointer;
    }

    .todo-list-view {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }

    .todo-list-section {
      border-radius: 10px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editorWidget-background);
      overflow: visible;
    }

    .section-body-wrapper {
      display: grid;
      grid-template-rows: 1fr;
      min-height: 0;
      transition: grid-template-rows 0.18s ease, opacity 0.18s ease;
    }

    .section-body-wrapper.collapsed {
      grid-template-rows: 0fr;
      opacity: 0;
    }

    .section-body-inner {
      min-height: 0;
      overflow: hidden;
    }

    .todo-list-section.is-collapsed .todo-list-items {
      padding-bottom: 0;
    }

    .todo-list-items {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 0 var(--cockpit-card-pad, 9px) var(--cockpit-card-pad, 9px);
    }

    .todo-list-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: start;
      transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.12s ease;
    }

    .todo-list-row:active {
      cursor: grabbing;
    }

    .todo-list-main {
      width: 100%;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .todo-list-title-line {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }

    .todo-list-title-block {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
      flex: 1 1 auto;
    }

    .todo-list-meta-trail {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 6px;
      align-items: center;
      justify-content: flex-end;
      min-width: 0;
      flex: 0 1 auto;
    }

    .todo-list-title {
      min-width: 0;
      font-weight: 600;
      line-height: 1.25;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1 1 220px;
    }

    .todo-list-summary {
      display: -webkit-box;
      -webkit-box-orient: vertical;
      -webkit-line-clamp: 1;
      overflow: hidden;
      line-clamp: 1;
      min-height: 1.2em;
      min-width: 0;
      flex: 1 1 auto;
      color: var(--vscode-descriptionForeground);
      line-height: 1.4;
    }

    .todo-list-card-details {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .todo-list-chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
      min-width: 0;
    }

    .todo-list-chip-row .card-labels {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      min-width: 0;
    }

    .todo-list-detail-line {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 8px;
      align-items: flex-start;
      min-width: 0;
    }

    .todo-list-detail-line strong {
      flex: 0 0 auto;
      white-space: nowrap;
      color: var(--vscode-foreground);
    }

    .todo-list-detail-line-comment .todo-list-summary {
      font-style: italic;
    }

    .card-labels {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cockpit-chip-gap, 4px);
      min-width: 0;
    }

    .card-labels [data-label-slot] {
      display: inline-flex;
      min-width: 0;
    }

    [data-label-chip],
    [data-flag-chip] {
      display: inline-flex;
      align-items: center;
      gap: var(--cockpit-chip-gap, 4px);
      max-width: 100%;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: var(--cockpit-chip-font, inherit);
    }

    [data-label-chip] {
      padding: var(--cockpit-label-pad-y, 2px) var(--cockpit-label-pad-x, 7px);
    }

    [data-flag-chip] > span:first-child {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    [data-label-chip-select] {
      max-width: 100%;
    }

    .todo-list-actions {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(28px, 1fr);
      gap: 6px;
      width: max-content;
      min-width: max-content;
      align-self: start;
    }

    .todo-list-actions.has-single-action {
      grid-auto-columns: minmax(28px, 1fr);
    }

    .todo-list-action-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      min-width: 28px;
      padding: 3px 6px !important;
      font-weight: 600;
      text-align: center;
      cursor: pointer !important;
    }

    .todo-card-icon-btn {
      min-height: 24px !important;
      padding: 2px 0 !important;
      font-size: 12px !important;
      line-height: 1 !important;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent) !important;
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #ffffff 22%, transparent),
        0 1px 2px color-mix(in srgb, #000000 18%, transparent);
      filter: saturate(1.08) brightness(1.05);
      transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
    }

    .todo-card-icon-btn:hover,
    .todo-card-icon-btn:focus-visible {
      box-shadow:
        inset 0 1px 0 color-mix(in srgb, #ffffff 28%, transparent),
        0 2px 6px color-mix(in srgb, #000000 22%, transparent);
      filter: saturate(1.14) brightness(1.1);
      transform: translateY(-1px);
    }

    .cockpit-section-header {
      display: flex;
      justify-content: flex-start;
      align-items: center;
      gap: 6px;
      cursor: grab;
      user-select: none;
      min-width: 0;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 94%, transparent);
      backdrop-filter: blur(10px);
      box-shadow: 0 1px 0 color-mix(in srgb, var(--vscode-panel-border) 78%, transparent);
    }

    .todo-list-section .cockpit-section-header {
      position: sticky;
      top: var(--cockpit-board-sticky-top, 0px);
      z-index: 8;
      gap: 8px;
    }

    .todo-list-section .cockpit-section-title-group {
      min-width: 0;
      flex: 1 1 auto;
    }

    .todo-list-section .cockpit-section-title {
      display: block;
    }

    .todo-list-section .cockpit-section-count {
      margin-left: auto;
      color: var(--vscode-descriptionForeground);
    }

    .todo-list-section .cockpit-section-actions {
      margin-left: 0;
    }

    .todo-list-section.is-collapsed .cockpit-section-actions {
      display: none;
    }

    .cockpit-board-hide-card-details .todo-list-card-details,
    .cockpit-board-compact-details .todo-list-card-details {
      display: none;
    }

    .board-column .cockpit-section-header {
      position: relative;
      z-index: 1;
    }

    .cockpit-section-header:active {
      cursor: grabbing;
    }

    .cockpit-section-header strong {
      padding-left: 2px;
    }

    .cockpit-section-title-group {
      display: flex;
      align-items: baseline;
      gap: 6px;
      flex: 1 1 auto;
      min-width: 0;
    }

    .cockpit-section-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .cockpit-section-count {
      flex: 0 0 auto;
      white-space: nowrap;
    }

    .cockpit-drag-handle {
      flex: 0 0 auto;
      touch-action: none;
    }

    .cockpit-collapse-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-radius: 3px;
      flex-shrink: 0;
      padding: 0;
      opacity: 0.6;
      transition: opacity 0.12s, transform 0.2s ease;
      font-size: 10px;
      line-height: 1;
    }

    .cockpit-collapse-btn:hover {
      opacity: 1;
      background: var(--vscode-list-hoverBackground);
    }

    .cockpit-collapse-btn.collapsed {
      transform: rotate(-90deg);
    }

    @media (max-width: 760px) {
      .todo-list-row {
        grid-template-columns: 1fr;
      }

      .todo-list-actions {
        width: 100%;
        min-width: 0;
        grid-auto-columns: minmax(0, 1fr);
      }

      .todo-list-action-btn {
        width: 100%;
      }
    }

    section[data-section-id] {
      transition: none;
    }

    section[data-section-id].section-dragging {
      opacity: 0.4;
    }

    section[data-section-id].section-drag-over {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent) !important;
    }

    body.cockpit-board-dragging,
    body.cockpit-board-dragging * {
      user-select: none !important;
      -webkit-user-select: none !important;
      cursor: grabbing !important;
    }

    article[data-todo-id] {
      transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.12s ease;
    }

    article[data-todo-id][data-selected="true"] {
      box-shadow:
        inset 0 0 0 1px var(--vscode-focusBorder),
        0 0 0 1px color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent);
      background-clip: padding-box;
    }

    article[data-todo-id].todo-dragging {
      opacity: 0.35;
      transform: rotate(1.5deg) scale(0.97) !important;
    }

    @media (max-width: 1180px) {
      .board-filter-footer {
        gap: 4px;
      }

      .board-filter-actions {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
        gap: 8px 10px;
        align-items: end;
        margin-top: 2px;
      }

      .board-filter-primary-actions {
        grid-column: 1 / 3;
        flex: none;
        gap: 6px;
      }

      .board-filter-view-group {
        grid-column: 3;
        justify-content: flex-end;
        min-width: 112px;
      }

      .board-filter-view-group .form-group {
        max-width: 112px;
        min-width: 112px;
      }

      .board-filter-options {
        grid-column: 1 / 3;
        flex: none;
        gap: 4px 10px;
        justify-content: flex-start;
        align-items: center;
        font-size: 11px;
      }

      .board-col-width-group {
        grid-column: 3;
        flex: none;
        min-width: 132px;
        justify-content: flex-end;
        gap: 4px;
      }

      .board-col-width-group input[type="range"] {
        width: min(100%, 96px);
        flex-basis: 96px;
      }
    }

    @media (max-width: 920px) {
      .board-filter-grid .board-filter-search {
        grid-column: auto;
      }

      .board-filter-actions {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: stretch;
      }

      .board-filter-primary-actions {
        grid-column: 1 / -1;
      }

      .board-filter-view-group,
      .board-filter-options {
        flex: none;
        justify-content: flex-start;
      }

      .board-filter-options {
        grid-column: 1;
      }

      .board-col-width-group {
        grid-column: 2;
        flex: none;
        min-width: 120px;
        justify-content: flex-end;
      }
    }

    @media (max-width: 640px) {
      .board-filter-grid {
        grid-template-columns: 1fr;
      }

      .board-filter-header {
        align-items: flex-start;
      }

      .board-filter-actions {
        grid-template-columns: 1fr;
        gap: 6px;
      }

      .board-filter-view-group,
      .board-filter-options,
      .board-col-width-group {
        grid-column: 1;
        min-width: 0;
      }

      .board-col-width-group {
        justify-content: flex-start;
      }

      .board-col-width-group input[type="range"] {
        width: min(100%, 140px);
        flex-basis: 120px;
      }
    }

    article[data-todo-id].todo-drop-target {
      box-shadow: 0 -3px 0 0 var(--vscode-focusBorder) !important;
      transform: translateY(2px);
    }

    [data-card-meta] {
      font-size: var(--cockpit-col-font, 11px) !important;
    }

    section[data-section-id] {
      padding: 0 !important;
    }

    article[data-todo-id] {
      padding: var(--cockpit-card-pad, 8px) !important;
      font-size: var(--cockpit-col-font, 11px) !important;
    }

    article[data-todo-id] .note {
      font-size: inherit !important;
    }

    article[data-todo-id] button {
      font-size: inherit !important;
      padding: 4px 8px !important;
      line-height: 1.3;
      min-height: 26px;
    }

    .todo-card-action-row {
      display: grid;
      grid-auto-flow: column;
      grid-auto-columns: minmax(0, 1fr);
      align-items: stretch;
      gap: 4px;
      width: 100%;
      position: relative;
      z-index: 1;
    }

    .todo-card-action-row.has-single-action {
      grid-template-columns: 1fr;
    }

    .todo-card-action-row > button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-width: 0;
      text-align: center;
      min-height: 24px;
      padding: 2px 0 !important;
      font-size: 12px !important;
      line-height: 1.15;
    }

    .todo-card-action-row > .todo-card-icon-btn {
      white-space: nowrap;
      line-height: 1;
    }

    .todo-card-action-row > button:not(.todo-card-icon-btn) {
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
      min-height: 38px;
      padding: 4px 6px !important;
    }

    .todo-card-edit {
      background:
        linear-gradient(180deg,
          color-mix(in srgb, var(--vscode-textLink-foreground) 28%, var(--vscode-button-secondaryBackground)) 0%,
          color-mix(in srgb, var(--vscode-button-secondaryBackground) 88%, transparent) 100%) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-approve {
      background-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 22%, var(--vscode-button-secondaryBackground)) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-approve.is-confirming {
      background-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #f5c451) 26%, var(--vscode-button-secondaryBackground)) !important;
    }

    .todo-complete-button.is-confirming {
      min-width: 34px !important;
      padding: 0 9px !important;
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 18%, var(--vscode-input-background)) !important;
      border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 62%, var(--vscode-panel-border)) !important;
    }

    .todo-complete-button.is-ready-to-finalize {
      border-style: dashed !important;
    }

    .todo-complete-button.is-cancel {
      min-width: 34px !important;
      height: 28px !important;
      padding: 0 9px !important;
      border-radius: 999px !important;
      border: 1px solid var(--vscode-panel-border) !important;
      background: color-mix(in srgb, var(--vscode-input-background) 88%, var(--vscode-editor-background)) !important;
      color: var(--vscode-foreground) !important;
      font-size: 11px !important;
      font-weight: 700 !important;
      line-height: 1 !important;
      flex: 0 0 auto !important;
    }

    .todo-complete-button.is-completed {
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 82%, var(--vscode-button-background)) !important;
      border-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 88%, var(--vscode-panel-border)) !important;
      color: var(--vscode-button-foreground) !important;
    }

    .todo-card-finalize {
      background-color: color-mix(in srgb, var(--vscode-focusBorder) 25%, var(--vscode-button-secondaryBackground)) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-delete {
      background:
        linear-gradient(180deg,
          color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 48%, var(--vscode-button-secondaryBackground)) 0%,
          color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 28%, var(--vscode-button-secondaryBackground)) 100%) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-delete-reject {
      background:
        linear-gradient(180deg,
          color-mix(in srgb, var(--vscode-editorWarning-foreground, #f5c451) 42%, var(--vscode-button-secondaryBackground)) 0%,
          color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 18%, var(--vscode-button-secondaryBackground)) 100%) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-delete-permanent {
      background:
        linear-gradient(180deg,
          color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 60%, var(--vscode-button-secondaryBackground)) 0%,
          color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 32%, var(--vscode-button-secondaryBackground)) 100%) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-delete-cancel {
      background:
        linear-gradient(180deg,
          color-mix(in srgb, var(--vscode-input-background) 78%, var(--vscode-button-secondaryBackground)) 0%,
          color-mix(in srgb, var(--vscode-button-secondaryBackground) 88%, transparent) 100%) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .cockpit-inline-modal {
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: rgba(0, 0, 0, 0.38);
      z-index: 250;
    }

    .cockpit-inline-modal.is-open {
      display: flex;
    }

    .cockpit-inline-modal-card {
      width: min(460px, calc(100vw - 32px));
      border-radius: 14px;
      border: 1px solid var(--vscode-widget-border);
      background: var(--vscode-editorWidget-background);
      color: var(--vscode-foreground);
      box-shadow: 0 20px 48px rgba(0, 0, 0, 0.28);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .cockpit-inline-modal-card.comment-detail-modal {
      width: min(860px, calc(100vw - 40px));
      max-height: min(84vh, 920px);
    }

    .cockpit-inline-modal-title {
      font-size: 16px;
      font-weight: 700;
      line-height: 1.25;
    }

    .cockpit-inline-modal-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .cockpit-section-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0.55;
      transition: opacity 0.12s ease;
      margin-left: auto;
    }

    .cockpit-section-header:hover .cockpit-section-actions,
    .cockpit-section-header:focus-within .cockpit-section-actions {
      opacity: 1;
    }

    .board-column.is-collapsed .cockpit-section-actions {
      display: none;
    }

    .board-column.is-collapsed .cockpit-section-header strong {
      overflow: visible;
      text-overflow: unset;
      white-space: normal;
    }

    .btn-icon {
      padding: 1px 4px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      font-size: 11px;
      border-radius: 3px;
      line-height: 1.4;
    }

    .btn-icon:hover {
      background: var(--vscode-list-hoverBackground);
    }

    .todo-editor-shell {
      display: grid;
      gap: 12px;
    }

    .todo-editor-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent),
        color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)
      );
    }

    .todo-editor-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.8fr);
      gap: 12px;
      align-items: start;
    }

    .todo-editor-card {
      display: grid;
      gap: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background-color: var(--vscode-editor-background);
      padding: 12px;
    }

    .todo-editor-card .section-title {
      margin-bottom: 0;
    }

    .todo-editor-comments {
      max-height: 34vh;
      overflow: auto;
      padding-right: 4px;
    }

    .todo-comment-card {
      padding: 10px;
      border-radius: 8px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-sideBar-background);
      border-left: 4px solid color-mix(in srgb, var(--vscode-panel-border) 70%, transparent);
      cursor: pointer;
      transition: transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease;
    }

    .todo-comment-card:hover,
    .todo-comment-card:focus-visible {
      transform: translateY(-1px);
      box-shadow: 0 10px 22px rgba(0, 0, 0, 0.16);
      outline: none;
    }

    .todo-comment-card.is-human-form {
      background: color-mix(in srgb, var(--vscode-testing-runAction, #5aa9e6) 12%, var(--vscode-sideBar-background));
      border-left-color: color-mix(in srgb, var(--vscode-testing-runAction, #5aa9e6) 70%, white);
    }

    .todo-comment-card.is-bot-mcp {
      background: color-mix(in srgb, var(--vscode-debugIcon-startForeground, #4caf50) 14%, var(--vscode-sideBar-background));
      border-left-color: color-mix(in srgb, var(--vscode-debugIcon-startForeground, #4caf50) 74%, white);
    }

    .todo-comment-card.is-bot-manual {
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground, #f5c451) 14%, var(--vscode-sideBar-background));
      border-left-color: color-mix(in srgb, var(--vscode-editorWarning-foreground, #f5c451) 76%, white);
    }

    .todo-comment-card.is-system-event {
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 10%, var(--vscode-sideBar-background));
      border-left-color: color-mix(in srgb, var(--vscode-descriptionForeground) 72%, white);
    }

    .todo-comment-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
      margin-bottom: 6px;
    }

    .todo-comment-author {
      margin-bottom: 6px;
    }

    .todo-comment-body {
      white-space: pre-wrap;
    }

    .todo-comment-card.is-user-form .todo-comment-author,
    .todo-comment-card.is-user-form .todo-comment-body {
      color: var(--vscode-descriptionForeground);
    }

    .todo-comment-expand-hint {
      margin-top: 8px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .todo-comment-modal-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 12px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    .todo-comment-modal-body {
      white-space: pre-wrap;
      line-height: 1.55;
      font-size: 13px;
      border-radius: 10px;
      border: 1px solid var(--vscode-panel-border);
      background: var(--vscode-editor-background);
      padding: 14px;
    }

    .todo-upload-row {
      display: grid;
      gap: 8px;
      align-items: start;
    }

    .todo-upload-note {
      min-height: 1.3em;
    }

    .todo-upload-note.is-success {
      color: var(--vscode-testing-iconPassed, #4caf50);
    }

    .todo-upload-note.is-error {
      color: var(--vscode-errorForeground);
    }

    .todo-editor-action-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0;
    }

    .todo-editor-action-row > button {
      min-height: 38px;
      padding: 8px 14px;
      font-weight: 700;
    }

    #todo-complete-btn {
      background: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 20%, var(--vscode-button-secondaryBackground));
      color: var(--vscode-button-secondaryForeground);
    }

    #todo-delete-btn {
      background: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 30%, var(--vscode-button-secondaryBackground));
      color: var(--vscode-button-secondaryForeground);
    }

    #todo-priority-input {
      font-weight: 700;
      transition: background-color 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    }

    #todo-priority-input option {
      color: var(--vscode-input-foreground);
      background: var(--vscode-dropdown-background, var(--vscode-input-background));
    }

    #todo-priority-input option:hover {
      color: var(--vscode-list-highlightForeground, var(--vscode-input-foreground));
    }

    #todo-priority-input[data-priority="none"] {
      background: color-mix(in srgb, var(--vscode-button-secondaryBackground) 88%, transparent);
      color: var(--vscode-foreground);
    }

    #todo-priority-input[data-priority="low"] {
      background: color-mix(in srgb, #64748b 28%, var(--vscode-input-background));
      color: var(--vscode-input-foreground);
    }

    #todo-priority-input[data-priority="medium"] {
      background: color-mix(in srgb, #3b82f6 26%, var(--vscode-input-background));
      color: var(--vscode-input-foreground);
    }

    #todo-priority-input[data-priority="high"] {
      background: color-mix(in srgb, #f59e0b 24%, var(--vscode-input-background));
      color: var(--vscode-input-foreground);
    }

    #todo-priority-input[data-priority="urgent"] {
      background: color-mix(in srgb, #ef4444 22%, var(--vscode-input-background));
      color: var(--vscode-input-foreground);
    }

    .history-toolbar {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 6px;
    }

    .history-toolbar label {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .history-toolbar select {
      min-width: 280px;
      max-width: 100%;
      flex: 1 1 280px;
    }

    .jobs-layout {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .jobs-layout.sidebar-collapsed {
      grid-template-columns: minmax(0, 1fr);
    }

    .jobs-layout.sidebar-collapsed .jobs-sidebar {
      display: none;
    }

    .jobs-sidebar,
    .jobs-main {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background-color: var(--vscode-editor-background);
      padding: 12px;
    }

    .jobs-overview-main {
      display: grid;
      gap: 12px;
      position: sticky;
      top: 0;
    }

    .jobs-overview-card {
      display: grid;
      gap: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background-color: var(--vscode-sideBar-background);
    }

    .jobs-toolbar,
    .jobs-job-toolbar,
    .jobs-inline-form,
    .jobs-step-toolbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .jobs-toolbar,
    .jobs-job-toolbar {
      margin-bottom: 12px;
    }

    .jobs-sidebar-section + .jobs-sidebar-section,
    .jobs-main-section + .jobs-main-section {
      margin-top: 0;
    }

    .jobs-list,
    .jobs-folder-list,
    .jobs-step-list {
      display: grid;
      gap: 8px;
    }

    .jobs-main-header {
      display: none;
    }

    .jobs-folder-item,
    .jobs-list-item,
    .jobs-step-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px;
      background-color: var(--vscode-sideBar-background);
    }

    .jobs-folder-item,
    .jobs-list-item {
      cursor: pointer;
    }

    .jobs-list-item[draggable="true"] {
      cursor: grab;
    }

    .jobs-list-item.dragging {
      opacity: 0.55;
    }

    .jobs-current-folder-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 8px;
      margin-bottom: 10px;
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 55%, var(--vscode-panel-border));
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 58%, transparent),
        color-mix(in srgb, var(--vscode-editorWidget-background) 85%, transparent)
      );
    }

    .jobs-current-folder-label {
      display: block;
      font-size: 11px;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }

    .jobs-current-folder-name {
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: var(--vscode-foreground);
      word-break: break-word;
    }

    .jobs-folder-path {
      margin-top: 4px;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      word-break: break-word;
    }

    .jobs-folder-item.active,
    .jobs-list-item.active,
    .jobs-folder-item.drag-over,
    .jobs-step-card.drag-over {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .jobs-folder-item.active {
      box-shadow: inset 4px 0 0 var(--vscode-focusBorder);
      font-weight: 600;
    }

    .jobs-folder-item.active .jobs-folder-item-header strong,
    .jobs-folder-item.active .jobs-folder-item-header span {
      color: inherit;
    }

    .jobs-folder-item.active .jobs-folder-path {
      color: color-mix(in srgb, var(--vscode-list-activeSelectionForeground) 80%, transparent);
    }

    .jobs-folder-item.is-archive {
      border-style: dashed;
    }

    .jobs-folder-item.is-archive .jobs-folder-item-header span:first-child {
      font-style: italic;
    }

    .jobs-folder-item-header,
    .jobs-list-item-header,
    .jobs-step-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }

    .jobs-list-item-meta,
    .jobs-folder-item-meta,
    .jobs-step-meta {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      margin-top: 4px;
    }

    .jobs-empty {
      padding: 16px;
      color: var(--vscode-descriptionForeground);
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      text-align: center;
    }

    .jobs-editor-shell {
      display: grid;
      gap: 16px;
    }

    .jobs-editor-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding: 14px 16px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent),
        color-mix(in srgb, var(--vscode-sideBar-background) 88%, transparent)
      );
    }

    .jobs-editor-intro {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .jobs-editor-subtitle {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
      line-height: 1.45;
      max-width: 72ch;
    }

    .jobs-editor-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(360px, 0.92fr);
      gap: 12px;
    }

    .jobs-editor-card.is-wide {
      grid-column: 1 / -1;
    }

    .jobs-editor-card {
      display: grid;
      gap: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 10px;
      background-color: var(--vscode-editor-background);
      padding: 14px;
    }

    .jobs-editor-card .section-title {
      margin-bottom: 0;
    }

    .jobs-editor-card .note {
      margin-top: -4px;
    }

    .jobs-workflow-builder-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.34fr) minmax(340px, 0.92fr);
      gap: 14px;
      align-items: start;
      grid-column: 1 / -1;
    }

    .jobs-workflow-builder-layout .jobs-main-section {
      min-width: 0;
    }

    .jobs-workflow-card {
      position: relative;
      overflow: hidden;
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 38%, var(--vscode-panel-border));
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--vscode-focusBorder) 16%, transparent) 0%, transparent 34%),
        linear-gradient(
          135deg,
          color-mix(in srgb, var(--vscode-editorWidget-background) 96%, transparent),
          color-mix(in srgb, var(--vscode-list-activeSelectionBackground) 18%, var(--vscode-editor-background))
        );
      box-shadow: 0 16px 32px color-mix(in srgb, var(--vscode-editor-background) 76%, transparent);
    }

    .jobs-workflow-actions-card {
      position: relative;
      overflow: hidden;
      gap: 12px;
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 34%, var(--vscode-panel-border));
      background:
        radial-gradient(circle at bottom left, color-mix(in srgb, var(--vscode-focusBorder) 15%, transparent) 0%, transparent 42%),
        linear-gradient(
          160deg,
          color-mix(in srgb, var(--vscode-editorWidget-background) 96%, transparent),
          color-mix(in srgb, var(--vscode-button-secondaryBackground) 38%, var(--vscode-editor-background))
        );
      box-shadow: 0 14px 28px color-mix(in srgb, var(--vscode-editor-background) 82%, transparent);
    }

    .jobs-workflow-card::before {
      content: "";
      position: absolute;
      top: -72px;
      right: -56px;
      width: 220px;
      height: 220px;
      border-radius: 999px;
      background: radial-gradient(circle, color-mix(in srgb, var(--vscode-focusBorder) 22%, transparent) 0%, transparent 70%);
      pointer-events: none;
    }

    .jobs-workflow-actions-card::before {
      content: "";
      position: absolute;
      bottom: -82px;
      left: -58px;
      width: 210px;
      height: 210px;
      border-radius: 999px;
      background: radial-gradient(circle, color-mix(in srgb, var(--vscode-focusBorder) 16%, transparent) 0%, transparent 72%);
      pointer-events: none;
    }

    .jobs-workflow-hero {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(260px, 0.85fr);
      gap: 14px;
      align-items: stretch;
      position: relative;
      z-index: 1;
    }

    .jobs-workflow-copy {
      display: grid;
      gap: 8px;
      align-content: start;
      min-width: 0;
    }

    .jobs-workflow-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      max-width: 100%;
      padding: 5px 11px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 14%, var(--vscode-editorWidget-background));
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 28%, var(--vscode-panel-border));
      color: var(--vscode-foreground);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      line-height: 1.25;
      white-space: normal;
    }

    .jobs-workflow-title {
      margin: 0;
      font-size: 22px;
      line-height: 1.1;
      letter-spacing: -0.02em;
    }

    .jobs-workflow-note {
      margin: 0;
      max-width: 62ch;
      color: var(--vscode-descriptionForeground);
      font-size: 13px;
      line-height: 1.55;
    }

    .jobs-workflow-metrics {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
      align-content: start;
    }

    .jobs-workflow-metric {
      display: grid;
      gap: 5px;
      padding: 12px;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 88%, transparent);
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent);
      min-height: 86px;
    }

    .jobs-workflow-metric.is-accent {
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 42%, var(--vscode-panel-border));
      background: color-mix(in srgb, var(--vscode-focusBorder) 10%, var(--vscode-editorWidget-background));
    }

    .jobs-workflow-metric.is-waiting {
      border-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 44%, var(--vscode-panel-border));
      background: color-mix(in srgb, var(--vscode-editorWarning-foreground) 13%, var(--vscode-editorWidget-background));
    }

    .jobs-workflow-metric.is-muted {
      border-color: color-mix(in srgb, var(--vscode-descriptionForeground) 36%, var(--vscode-panel-border));
      background: color-mix(in srgb, var(--vscode-descriptionForeground) 9%, var(--vscode-editorWidget-background));
    }

    .jobs-workflow-metric-label {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .jobs-workflow-metric-value {
      font-size: 20px;
      font-weight: 700;
      line-height: 1.15;
      color: var(--vscode-foreground);
      word-break: break-word;
    }

    .jobs-workflow-metric.is-compact .jobs-workflow-metric-value {
      font-size: 15px;
      line-height: 1.25;
    }

    .jobs-workflow-panel {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-radius: 16px;
      border: 1px solid color-mix(in srgb, var(--vscode-panel-border) 92%, transparent);
      background: color-mix(in srgb, var(--vscode-sideBar-background) 84%, transparent);
      position: relative;
      z-index: 1;
    }

    .jobs-workflow-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .jobs-workflow-panel-copy {
      display: grid;
      gap: 4px;
      min-width: 0;
    }

    .jobs-workflow-panel .note {
      margin: 0;
    }

    .jobs-workflow-actions-header {
      display: grid;
      gap: 6px;
      position: relative;
      z-index: 1;
    }

    .jobs-workflow-actions-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      padding: 5px 11px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-button-background) 16%, var(--vscode-editorWidget-background));
      border: 1px solid color-mix(in srgb, var(--vscode-button-background) 32%, var(--vscode-panel-border));
      color: var(--vscode-foreground);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .jobs-workflow-actions-grid {
      display: grid;
      gap: 10px;
      position: relative;
      z-index: 1;
    }

    .jobs-workflow-quick-actions {
      display: grid;
      grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
      gap: 10px;
      align-items: start;
    }

    .jobs-job-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .jobs-job-grid-overview {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .jobs-job-grid .form-group.wide {
      grid-column: 1 / -1;
    }

    .jobs-schedule-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .jobs-schedule-grid .wide {
      grid-column: 1 / -1;
    }

    .jobs-action-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .jobs-action-card {
      display: grid;
      gap: 10px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
      background-color: var(--vscode-sideBar-background);
    }

    .jobs-action-card-wide {
      grid-column: 1 / -1;
    }

    .jobs-workflow-actions-card .jobs-action-card {
      gap: 8px;
      padding: 10px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--vscode-sideBar-background) 82%, transparent);
      border-color: color-mix(in srgb, var(--vscode-panel-border) 92%, transparent);
    }

    .jobs-workflow-actions-card .jobs-action-card .section-title {
      font-size: 11px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .jobs-action-title-with-icon {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }

    .jobs-action-title-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 16%, var(--vscode-editorWidget-background));
      border: 1px solid color-mix(in srgb, var(--vscode-focusBorder) 28%, var(--vscode-panel-border));
      font-size: 11px;
      line-height: 1;
    }

    .jobs-action-title-icon.jobs-action-title-icon-pause {
      gap: 2px;
      font-size: 0;
    }

    .jobs-action-title-icon.jobs-action-title-icon-pause span {
      display: block;
      width: 2px;
      height: 8px;
      border-radius: 999px;
      background: currentColor;
    }

    .jobs-workflow-actions-card .jobs-inline-form {
      display: grid;
      gap: 8px;
      margin-top: 0;
    }

    .jobs-workflow-actions-card .jobs-inline-form .form-group {
      margin-bottom: 0;
    }

    .jobs-workflow-actions-card .jobs-inline-form button {
      justify-self: end;
    }

    .jobs-workflow-save-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-top: 2px;
    }

    .jobs-workflow-save-row .btn-primary,
    .jobs-workflow-save-row .btn-secondary {
      min-width: 0;
    }

    .jobs-workflow-actions-card label {
      margin-bottom: 3px;
      font-size: 11px;
    }

    .jobs-workflow-actions-card input[type="text"],
    .jobs-workflow-actions-card input[type="number"],
    .jobs-workflow-actions-card select,
    .jobs-workflow-actions-card textarea {
      padding: 5px 7px;
      font-size: 12px;
    }

    .jobs-workflow-actions-card textarea {
      min-height: 68px;
    }

    .jobs-new-step-form {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
      align-items: end;
    }

    .jobs-new-step-form .wide {
      grid-column: 1 / -1;
    }

    .jobs-new-step-actions {
      grid-column: 1 / -1;
      display: flex;
      justify-content: flex-end;
    }

    .jobs-workflow-actions-card .jobs-new-step-form {
      gap: 10px;
    }

    .jobs-step-list {
      grid-template-columns: repeat(5, minmax(0, 1fr));
    }

    .jobs-step-card {
      min-height: 124px;
      padding: 8px;
      font-size: 12px;
    }

    .jobs-step-card.is-waiting,
    .jobs-pill.is-waiting {
      border-color: var(--vscode-focusBorder);
      background-color: color-mix(in srgb, var(--vscode-editorWarning-foreground) 18%, var(--vscode-sideBar-background));
      color: var(--vscode-editorWarning-foreground);
    }

    .jobs-pause-card {
      background: linear-gradient(
        135deg,
        color-mix(in srgb, var(--vscode-editorWidget-background) 92%, transparent),
        color-mix(in srgb, var(--vscode-button-secondaryBackground) 72%, transparent)
      );
    }

    .jobs-pause-card .jobs-step-toolbar {
      margin-top: 10px;
    }

    .jobs-pause-copy {
      margin-top: 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
    }

    .jobs-list-item-meta-row {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 4px;
    }

    .jobs-step-card[draggable="true"] {
      cursor: grab;
    }

    .jobs-step-card.dragging {
      opacity: 0.55;
    }

    .jobs-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 999px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      font-size: 11px;
    }

    .jobs-pill.is-toggle {
      cursor: pointer;
      border: 1px solid transparent;
    }

    .jobs-pill.is-toggle:hover {
      border-color: var(--vscode-focusBorder);
    }

    .jobs-pill.is-inactive {
      background-color: var(--vscode-inputValidation-warningBackground);
      color: var(--vscode-inputValidation-warningForeground);
    }

    .jobs-timeline-inline {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: auto;
      white-space: nowrap;
      padding-bottom: 4px;
      scrollbar-width: thin;
    }

    .jobs-timeline-node {
      display: inline-flex;
      align-items: center;
      max-width: 220px;
      padding: 4px 8px;
      border-radius: 999px;
      background: var(--vscode-sideBar-background);
      border: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .jobs-timeline-arrow {
      color: var(--vscode-descriptionForeground);
      flex: 0 0 auto;
    }

    .jobs-workflow-card .jobs-timeline-inline {
      gap: 8px;
      padding-bottom: 2px;
    }

    .jobs-workflow-card .jobs-timeline-node {
      max-width: 280px;
      padding: 8px 12px;
      border-radius: 12px;
      background: color-mix(in srgb, var(--vscode-editorWidget-background) 90%, transparent);
      border-color: color-mix(in srgb, var(--vscode-focusBorder) 20%, var(--vscode-panel-border));
      font-size: 12px;
      font-weight: 600;
    }

    .jobs-workflow-card .jobs-timeline-arrow {
      font-size: 16px;
    }

    .jobs-step-summary {
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-top: 6px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.35;
      min-height: 2.7em;
    }

    .jobs-step-toolbar {
      justify-content: space-between;
      margin-top: 8px;
    }

    .jobs-step-toolbar .btn-secondary,
    .jobs-step-toolbar .btn-danger {
      padding: 4px 8px;
      font-size: 11px;
    }

    .jobs-step-toolbar .btn-danger {
      margin-left: auto;
    }

    .jobs-inline-form {
      margin-top: 10px;
    }

    .jobs-inline-form .form-group {
      margin-bottom: 0;
      flex: 1 1 180px;
    }

    .jobs-folder-indent {
      display: inline-block;
      width: 14px;
      flex: 0 0 14px;
    }

    .research-layout {
      display: grid;
      grid-template-columns: 290px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .research-sidebar,
    .research-main,
    .research-panel {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background-color: var(--vscode-editor-background);
      padding: 10px;
    }

    .research-sidebar {
      display: grid;
      gap: 10px;
    }

    .research-panel-header,
    .settings-card-header {
      display: grid;
      gap: 4px;
      margin-bottom: 8px;
    }

    .research-profile-list,
    .research-run-list,
    .research-attempt-list {
      display: grid;
      gap: 6px;
    }

    .research-card,
    .research-run-card,
    .research-attempt-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px 9px;
      background-color: var(--vscode-sideBar-background);
    }

    .research-card.active {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .research-run-card {
      cursor: pointer;
    }

    .research-run-card.active {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }

    .research-card-header,
    .research-run-card-header,
    .research-attempt-card-header {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }

    .research-meta,
    .research-run-meta,
    .research-attempt-meta {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-top: 3px;
      white-space: pre-wrap;
    }

    .research-main {
      display: grid;
      gap: 12px;
    }

    .research-form-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .research-form-grid .form-group.wide {
      grid-column: 1 / -1;
    }

    .research-toolbar,
    .research-run-toolbar {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      align-items: center;
      margin-top: 10px;
    }

    .research-form-error {
      display: none;
      margin-bottom: 10px;
      padding: 7px 10px;
      border-radius: 6px;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      font-size: 11px;
      white-space: pre-wrap;
    }

    .research-chip-row {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 6px;
    }

    .research-chip {
      display: inline-flex;
      align-items: center;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 11px;
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
    }

    .research-attempt-card {
      display: grid;
      gap: 6px;
    }

    .research-attempt-paths {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      white-space: pre-wrap;
    }

    .research-output details {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 7px 8px;
      background: var(--vscode-editorWidget-background);
    }

    .research-output summary {
      cursor: pointer;
      font-size: 12px;
      color: var(--vscode-foreground);
    }

    .research-output pre {
      margin: 6px 0 0 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 11px;
      color: var(--vscode-editor-foreground);
      max-height: 180px;
      overflow: auto;
    }

    .telegram-layout {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(240px, 0.85fr) minmax(240px, 0.85fr);
      gap: 12px;
      align-items: start;
    }

    .telegram-card,
    .telegram-status-card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background-color: var(--vscode-editor-background);
      padding: 10px;
    }

    .telegram-status-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
    }

    .telegram-status-item {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background-color: var(--vscode-sideBar-background);
      padding: 8px;
    }

    .telegram-status-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 3px;
    }

    .telegram-status-value {
      font-size: 12px;
      font-weight: 600;
      word-break: break-word;
    }

    .telegram-feedback {
      display: none;
      margin-bottom: 10px;
      padding: 7px 10px;
      border-radius: 6px;
      font-size: 11px;
      white-space: pre-wrap;
      background: var(--vscode-inputValidation-infoBackground, var(--vscode-editorInfo-background));
      color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border);
    }

    .telegram-feedback.error {
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
    }

    .research-stat-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 6px;
      margin-top: 8px;
    }

    .research-stat {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 8px;
      background-color: var(--vscode-sideBar-background);
    }

    .research-stat-label {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 3px;
    }

    .research-stat-value {
      font-size: 13px;
      font-weight: 600;
    }

    @media (max-width: 980px) {
      .research-layout {
        grid-template-columns: 1fr;
      }

      .research-form-grid,
      .research-stat-grid {
        grid-template-columns: 1fr;
      }

      .telegram-layout {
        grid-template-columns: 1fr;
      }

      .help-grid {
        grid-template-columns: 1fr;
      }

      .help-section.is-featured {
        grid-column: 1 / -1;
      }
    }

    @media (max-width: 760px) {
      .telegram-status-grid,
      .research-stat-grid,
      .research-form-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 980px) {
      .tab-bar {
        gap: 6px;
        padding: 8px 10px 6px 10px;
        margin: -20px -20px 16px -20px;
      }

      .jobs-layout {
        grid-template-columns: 1fr;
      }

      .todo-editor-grid,
      .jobs-editor-grid,
      .task-editor-grid {
        grid-template-columns: 1fr;
      }

      .jobs-job-grid {
        grid-template-columns: 1fr;
      }

      .jobs-job-grid-overview,
      .jobs-schedule-grid,
      .jobs-action-grid,
      .jobs-new-step-form,
      .task-editor-options-grid {
        grid-template-columns: 1fr;
      }

      .jobs-workflow-builder-layout,
      .jobs-workflow-quick-actions {
        grid-template-columns: 1fr;
      }

      .jobs-action-card-wide,
      .jobs-new-step-actions,
      .jobs-schedule-grid .wide,
      .jobs-new-step-form .wide,
      .task-editor-options-grid .form-group.wide,
      .task-editor-card.is-wide {
        grid-column: 1 / -1;
      }

      .jobs-editor-header,
      .task-editor-header {
        flex-direction: column;
      }

      .jobs-workflow-hero {
        grid-template-columns: 1fr;
      }

      .jobs-step-list {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }
    }

    @media (max-width: 768px) {
      .tab-bar {
        flex-wrap: wrap;
        align-items: stretch;
      }

      .tabs {
        order: 2;
        flex: 1 1 100%;
      }

      .tab-actions {
        order: 1;
        width: 100%;
        justify-content: flex-end;
      }

      .tab-button {
        padding: 10px 12px;
        font-size: 14px;
      }

      .jobs-step-list {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 560px) {
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
            <div>
              <div class="section-title" style="font-size:13px;">${escapeHtml(strings.boardCommentsTitle)}</div>
              <div id="todo-comment-list" class="todo-editor-comments" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px;"></div>
              <div class="form-group" style="margin:0;">
                <label for="todo-comment-input">${escapeHtml(strings.boardAddComment)}</label>
                <textarea id="todo-comment-input" placeholder="${escapeHtmlAttr(strings.boardCommentPlaceholder)}" style="min-height:90px;"></textarea>
              </div>
              <div class="button-group" style="margin:8px 0 0 0;justify-content:flex-end;">
                <button type="button" class="btn-secondary" id="todo-add-comment-btn">${escapeHtml(strings.boardAddComment)}</button>
              </div>
            </div>
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

      <form id="task-form">
        <div id="form-error" style="display:none; background:var(--vscode-inputValidation-errorBackground); color:var(--vscode-inputValidation-errorForeground); padding:8px 12px; border-radius:4px; margin-bottom:12px; font-size:13px;"></div>
        <input type="hidden" id="edit-task-id" value="">

        <div class="task-editor-grid">
          <section class="task-editor-card">
            <div class="section-title">${escapeHtml(strings.taskEditorPromptTitle)}</div>

            <div class="form-group" style="margin:0;">
              <label for="task-name">${escapeHtml(strings.labelTaskName)}</label>
              <input type="text" id="task-name" placeholder="${escapeHtmlAttr(strings.placeholderTaskName)}" required>
            </div>

            <div class="form-group" style="margin:0;">
              <label for="task-labels">${escapeHtml(strings.labelTaskLabels)}</label>
              <input type="text" id="task-labels" placeholder="${escapeHtmlAttr(strings.placeholderTaskLabels)}">
            </div>

            <div class="form-group" style="margin:0;">
              <label>${escapeHtml(strings.labelPromptType)}</label>
              <div class="radio-group">
                <label>
                  <input type="radio" name="prompt-source" value="inline" checked>
                  ${escapeHtml(strings.labelPromptInline)}
                </label>
                <label>
                  <input type="radio" name="prompt-source" value="local">
                  ${escapeHtml(strings.labelPromptLocal)}
                </label>
                <label>
                  <input type="radio" name="prompt-source" value="global">
                  ${escapeHtml(strings.labelPromptGlobal)}
                </label>
              </div>
            </div>

            <div class="form-group" id="template-select-group" style="display: none; margin:0;">
              <label for="template-select">${escapeHtml(strings.labelPrompt)}</label>
              <div class="template-row">
                <select id="template-select">
                  <option value="">${escapeHtml(strings.placeholderSelectTemplate)}</option>
                </select>
                <button type="button" class="btn-secondary" id="template-refresh-btn">${escapeHtml(strings.actionRefresh)}</button>
              </div>
            </div>

            <div class="form-group" id="prompt-group" style="margin:0;">
              <label for="prompt-text">${escapeHtml(strings.labelPrompt)}</label>
              <textarea id="prompt-text" placeholder="${escapeHtmlAttr(strings.placeholderPrompt)}" required style="min-height:220px;"></textarea>
            </div>

            <div class="form-group" id="skill-select-group" style="margin:0;">
              <label for="skill-select">${escapeHtml(strings.labelSkills)}</label>
              <div class="template-row">
                <select id="skill-select">
                  <option value="">${escapeHtml(strings.placeholderSelectSkill)}</option>
                </select>
                <button type="button" class="btn-secondary" id="insert-skill-btn">${escapeHtml(strings.actionInsertSkill)}</button>
              </div>
              <p class="note">${escapeHtml(strings.skillInsertNote)}</p>
            </div>
          </section>

          <section class="task-editor-card">
            <div class="section-title">${escapeHtml(strings.taskEditorScheduleTitle)}</div>

            <div class="form-group" style="margin:0;">
              <label>${escapeHtml(strings.labelSchedule)}</label>
              <div class="preset-select">
                <select id="cron-preset">
                  <option value="">${escapeHtml(strings.labelCustom)}</option>
                  ${allPresets.map((p) => `<option value="${escapeHtmlAttr(p.expression)}">${escapeHtml(p.name)}</option>`).join("")}
                </select>
              </div>
              <input type="text" id="cron-expression" placeholder="${escapeHtmlAttr(strings.placeholderCron)}" required>
              <div class="cron-preview">
                <strong>${escapeHtml(strings.labelFriendlyPreview)}:</strong>
                <span id="cron-preview-text">${escapeHtml(strings.labelFriendlyFallback)}</span>
                <button type="button" class="btn-secondary btn-icon" id="open-guru-btn">${escapeHtml(strings.labelOpenInGuru)}</button>
              </div>
            </div>

            <div class="friendly-cron" id="friendly-builder">
              <div class="section-title">${escapeHtml(strings.labelFriendlyBuilder)}</div>
              <div class="friendly-grid">
                <div class="form-group">
                  <label for="friendly-frequency">${escapeHtml(strings.labelFrequency)}</label>
                  <select id="friendly-frequency">
                    <option value="">${escapeHtml(strings.labelFriendlySelect)}</option>
                    <option value="every-n">${escapeHtml(strings.labelEveryNMinutes)}</option>
                    <option value="hourly">${escapeHtml(strings.labelHourlyAtMinute)}</option>
                    <option value="daily">${escapeHtml(strings.labelDailyAtTime)}</option>
                    <option value="weekly">${escapeHtml(strings.labelWeeklyAtTime)}</option>
                    <option value="monthly">${escapeHtml(strings.labelMonthlyAtTime)}</option>
                  </select>
                </div>
                <div class="form-group friendly-field" data-field="interval">
                  <label for="friendly-interval">${escapeHtml(strings.labelInterval)}</label>
                  <input type="number" id="friendly-interval" min="1" max="59" value="5">
                </div>
                <div class="form-group friendly-field" data-field="minute">
                  <label for="friendly-minute">${escapeHtml(strings.labelMinute)}</label>
                  <input type="number" id="friendly-minute" min="0" max="59" value="0">
                </div>
                <div class="form-group friendly-field" data-field="hour">
                  <label for="friendly-hour">${escapeHtml(strings.labelHour)}</label>
                  <input type="number" id="friendly-hour" min="0" max="23" value="9">
                </div>
                <div class="form-group friendly-field" data-field="dow">
                  <label for="friendly-dow">${escapeHtml(strings.labelDayOfWeek)}</label>
                  <select id="friendly-dow">
                    <option value="0">${escapeHtml(strings.daySun)}</option>
                    <option value="1">${escapeHtml(strings.dayMon)}</option>
                    <option value="2">${escapeHtml(strings.dayTue)}</option>
                    <option value="3">${escapeHtml(strings.dayWed)}</option>
                    <option value="4">${escapeHtml(strings.dayThu)}</option>
                    <option value="5">${escapeHtml(strings.dayFri)}</option>
                    <option value="6">${escapeHtml(strings.daySat)}</option>
                  </select>
                </div>
                <div class="form-group friendly-field" data-field="dom">
                  <label for="friendly-dom">${escapeHtml(strings.labelDayOfMonth)}</label>
                  <input type="number" id="friendly-dom" min="1" max="31" value="1">
                </div>
              </div>
              <div class="friendly-actions">
                <button type="button" class="btn-secondary" id="friendly-generate">${escapeHtml(strings.labelFriendlyGenerate)}</button>
              </div>
            </div>

            <div class="section-title">${escapeHtml(strings.taskEditorRuntimeTitle)}</div>
            <div class="inline-group">
              <div class="form-group" style="margin:0;">
                <label for="agent-select">${escapeHtml(strings.labelAgent)}</label>
                <select id="agent-select">
                  ${initialAgents.length > 0 ? `<option value="">${escapeHtml(strings.placeholderSelectAgent)}</option>` + initialAgents.map((a) => `<option value="${escapeHtmlAttr(a.id || "")}">${escapeHtml(a.name || "")}</option>`).join("") : `<option value="">${escapeHtml(strings.placeholderNoAgents)}</option>`}
                </select>
              </div>

              <div class="form-group" style="margin:0;">
                <label for="model-select">${escapeHtml(strings.labelModel)}</label>
                <select id="model-select">
                  ${initialModels.length > 0 ? `<option value="">${escapeHtml(strings.placeholderSelectModel)}</option>` + initialModels.map((m) => `<option value="${escapeHtmlAttr(m.id || "")}">${escapeHtml(formatModelLabel(m))}</option>`).join("") : `<option value="">${escapeHtml(strings.placeholderNoModels)}</option>`}
                </select>
                <p class="note">${escapeHtml(strings.labelModelNote)}</p>
              </div>
            </div>
          </section>

          <section class="task-editor-card is-wide">
            <div class="section-title">${escapeHtml(strings.taskEditorOptionsTitle)}</div>
            <div class="task-editor-options-grid">
              <div class="form-group" style="margin:0;">
                <label>${escapeHtml(strings.labelScope)}</label>
                <div class="radio-group">
                  <label>
                    <input type="radio" name="scope" value="workspace" ${defaultScope === "workspace" ? "checked" : ""}>
                    ${escapeHtml(strings.labelScopeWorkspace)}
                  </label>
                  <label>
                    <input type="radio" name="scope" value="global" ${defaultScope === "global" ? "checked" : ""}>
                    ${escapeHtml(strings.labelScopeGlobal)}
                  </label>
                </div>
              </div>

              <div class="form-group" style="margin:0;">
                <label for="jitter-seconds">${escapeHtml(strings.labelJitterSeconds)}</label>
                <input type="number" id="jitter-seconds" min="0" max="1800" value="${escapeHtmlAttr(String(defaultJitterSeconds))}">
                <p class="note">${escapeHtml(strings.webviewJitterNote)}</p>
              </div>

              <div class="form-group" style="margin:0;">
                <label class="checkbox-group">
                  <input type="checkbox" id="run-first">
                  <span>${escapeHtml(strings.labelRunFirstInOneMinute)}</span>
                </label>
              </div>

              <div class="form-group" style="margin:0;">
                <label class="checkbox-group">
                  <input type="checkbox" id="one-time">
                  <span>${escapeHtml(strings.labelOneTime)}</span>
                </label>
              </div>

              <div class="form-group" style="margin:0;">
                <label class="checkbox-group">
                  <input type="checkbox" id="manual-session">
                  <span>${escapeHtml(strings.labelManualSession)}</span>
                </label>
                <p class="note">${escapeHtml(strings.labelManualSessionNote)}</p>
              </div>

              <div class="form-group wide" id="chat-session-group" style="margin:0;">
                <label for="chat-session">${escapeHtml(strings.labelChatSession)}</label>
                <select id="chat-session">
                  <option value="new">${escapeHtml(strings.labelChatSessionNew)}</option>
                  <option value="continue">${escapeHtml(strings.labelChatSessionContinue)}</option>
                </select>
                <p class="note">${escapeHtml(strings.labelChatSessionRecurringOnly)}</p>
              </div>
            </div>

            <div class="section-title">${escapeHtml(strings.taskEditorActionsTitle)}</div>
            <div class="button-group" style="margin:0;">
              <button type="submit" class="btn-primary" id="submit-btn">${escapeHtml(strings.actionCreate)}</button>
              <button type="button" class="btn-secondary" id="new-task-btn" style="display:none;">${escapeHtml(strings.actionNewTask)}</button>
              <button type="button" class="btn-secondary" id="test-btn">${escapeHtml(strings.taskEditorTestPrompt)}</button>
            </div>
          </section>
        </div>
      </form>
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
                <div class="friendly-cron" id="jobs-friendly-builder">
                  <div class="section-title">${escapeHtml(strings.labelFriendlyBuilder)}</div>
                  <div class="friendly-grid">
                    <div class="form-group">
                      <label for="jobs-friendly-frequency">${escapeHtml(strings.labelFrequency)}</label>
                      <select id="jobs-friendly-frequency">
                        <option value="">${escapeHtml(strings.labelFriendlySelect)}</option>
                        <option value="every-n">${escapeHtml(strings.labelEveryNMinutes)}</option>
                        <option value="hourly">${escapeHtml(strings.labelHourlyAtMinute)}</option>
                        <option value="daily">${escapeHtml(strings.labelDailyAtTime)}</option>
                        <option value="weekly">${escapeHtml(strings.labelWeeklyAtTime)}</option>
                        <option value="monthly">${escapeHtml(strings.labelMonthlyAtTime)}</option>
                      </select>
                    </div>
                    <div class="form-group friendly-field" data-field="interval">
                      <label for="jobs-friendly-interval">${escapeHtml(strings.labelInterval)}</label>
                      <input type="number" id="jobs-friendly-interval" min="1" max="59" value="5">
                    </div>
                    <div class="form-group friendly-field" data-field="minute">
                      <label for="jobs-friendly-minute">${escapeHtml(strings.labelMinute)}</label>
                      <input type="number" id="jobs-friendly-minute" min="0" max="59" value="0">
                    </div>
                    <div class="form-group friendly-field" data-field="hour">
                      <label for="jobs-friendly-hour">${escapeHtml(strings.labelHour)}</label>
                      <input type="number" id="jobs-friendly-hour" min="0" max="23" value="9">
                    </div>
                    <div class="form-group friendly-field" data-field="dow">
                      <label for="jobs-friendly-dow">${escapeHtml(strings.labelDayOfWeek)}</label>
                      <select id="jobs-friendly-dow">
                        <option value="0">${escapeHtml(strings.daySun)}</option>
                        <option value="1">${escapeHtml(strings.dayMon)}</option>
                        <option value="2">${escapeHtml(strings.dayTue)}</option>
                        <option value="3">${escapeHtml(strings.dayWed)}</option>
                        <option value="4">${escapeHtml(strings.dayThu)}</option>
                        <option value="5">${escapeHtml(strings.dayFri)}</option>
                        <option value="6">${escapeHtml(strings.daySat)}</option>
                      </select>
                    </div>
                    <div class="form-group friendly-field" data-field="dom">
                      <label for="jobs-friendly-dom">${escapeHtml(strings.labelDayOfMonth)}</label>
                      <input type="number" id="jobs-friendly-dom" min="1" max="31" value="1">
                    </div>
                  </div>
                  <div class="friendly-actions">
                    <button type="button" class="btn-secondary" id="jobs-friendly-generate">${escapeHtml(strings.labelFriendlyGenerate)}</button>
                  </div>
                </div>
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
          <button type="button" class="btn-primary" id="sync-bundled-skills-btn">${escapeHtml(strings.actionSyncBundledSkills)}</button>
        </div>
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




