/**
 * Copilot Cockpit - Scheduler Webview
 * Provides GUI for task creation, editing, and listing
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { notifyError } from "./extension";
import type {
  CockpitBoard,
  ScheduledTask,
  ScheduleHistoryEntry,
  CreateTaskInput,
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
import { messages, isJapanese, getCronPresets } from "./i18n";
import { logError } from "./logger";
import { validateTemplateLoadRequest } from "./templateValidation";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import { resolveGlobalPromptsRoot } from "./promptResolver";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";
import { getResolvedWorkspaceRoots } from "./schedulerJsonSanitizer";

type OutgoingWebviewMessage = { type: string;[key: string]: unknown };

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
    version: 2,
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
      showArchived: false,
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
  private static webviewReady = false;
  private static pendingMessages: OutgoingWebviewMessage[] = [];

  private static resetWebviewReadyState(): void {
    this.webviewReady = false;
    this.pendingMessages = [];
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

  private static postMessage(message: OutgoingWebviewMessage): void {
    if (!this.panel) return;
    if (!this.webviewReady) {
      this.enqueueMessage(message);
      return;
    }
    void this.panel.webview.postMessage(message);
  }

  private static flushPendingMessages(): void {
    if (!this.panel || !this.webviewReady) return;
    if (this.pendingMessages.length === 0) return;
    const queue = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of queue) {
      // Route through the wrapper to keep all sending logic consistent (U2).
      this.postMessage(message);
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
      void this.refreshAgentsAndModels(true)
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

      void this.refreshPromptTemplates(true)
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

      void this.refreshSkillReferences(true)
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
      // Reveal existing panel — send cached data only (no heavy re-scan)
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
          retainContextWhenHidden: true,
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
        light: vscode.Uri.joinPath(extensionUri, "images", "sidebar-icon.svg"),
        dark: vscode.Uri.joinPath(extensionUri, "images", "sidebar-icon.svg"),
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
    this.postMessage({
      type: "updateCockpitBoard",
      cockpitBoard,
    });
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
      await this.refreshAgentsAndModels(force);
    } catch {
      this.cachedAgents = CopilotExecutor.getBuiltInAgents();
      this.cachedModels = CopilotExecutor.getFallbackModels();
    }

    try {
      await this.refreshPromptTemplates(force);
    } catch {
      this.cachedPromptTemplates = [];
    }

    try {
      await this.refreshSkillReferences(force);
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

  private static async promptForJobFolderName(
    title: string,
    value = "",
  ): Promise<string | undefined> {
    const result = await vscode.window.showInputBox({
      title,
      prompt: messages.jobFolderNamePrompt(),
      value,
      ignoreFocusOut: true,
      validateInput: (input) =>
        input.trim() ? undefined : messages.taskNameRequired(),
    });
    const trimmed = result?.trim();
    return trimmed ? trimmed : undefined;
  }

  private static async handleCreateJobRequest(folderId?: string): Promise<void> {
    const name = await vscode.window.showInputBox({
      title: messages.jobCreateTitle(),
      prompt: messages.jobNamePrompt(),
      ignoreFocusOut: true,
      validateInput: (input) =>
        input.trim() ? undefined : messages.taskNameRequired(),
    });
    const trimmedName = name?.trim();
    if (!trimmedName || !this.onTaskActionCallback) {
      return;
    }

    this.onTaskActionCallback({
      action: "createJob",
      taskId: "__job__",
      jobData: {
        name: trimmedName,
        cronExpression: "0 9 * * 1-5",
        folderId,
      },
    });
  }

  private static async handleCreateJobFolderRequest(
    parentFolderId?: string,
  ): Promise<void> {
    const name = await this.promptForJobFolderName(
      messages.jobFolderCreateTitle(),
    );
    if (!name || !this.onTaskActionCallback) {
      return;
    }

    this.onTaskActionCallback({
      action: "createJobFolder",
      taskId: "__jobfolder__",
      folderData: {
        name,
        parentId: parentFolderId,
      },
    });
  }

  private static async handleRenameJobFolderRequest(
    folderId: string,
  ): Promise<void> {
    const folder = this.currentJobFolders.find((entry) => entry.id === folderId);
    if (!folder) {
      return;
    }

    const name = await this.promptForJobFolderName(
      messages.jobFolderRenameTitle(),
      folder.name,
    );
    if (!name || !this.onTaskActionCallback) {
      return;
    }

    this.onTaskActionCallback({
      action: "renameJobFolder",
      taskId: "__jobfolder__",
      folderId,
      folderData: { name },
    });
  }

  private static async handleDeleteJobFolderRequest(
    folderId: string,
  ): Promise<void> {
    const folder = this.currentJobFolders.find((entry) => entry.id === folderId);
    if (!folder || !this.onTaskActionCallback) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      messages.confirmDeleteJobFolder(folder.name),
      { modal: true },
      messages.confirmDeleteYes(),
      messages.actionCancel(),
    );
    if (confirm !== messages.confirmDeleteYes()) {
      return;
    }

    this.onTaskActionCallback({
      action: "deleteJobFolder",
      taskId: "__jobfolder__",
      folderId,
    });
  }

  private static async handleDeleteJobTaskRequest(
    jobId: string,
    nodeId: string,
  ): Promise<void> {
    const job = this.currentJobs.find((entry) => entry.id === jobId);
    const node = job?.nodes.find((entry) => entry.id === nodeId);
    const task = node && "taskId" in node
      ? this.currentTasks.find((entry) => entry.id === node.taskId)
      : undefined;

    if (!job || !node || !task || !this.onTaskActionCallback) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      messages.confirmDeleteJobStep(task.name),
      { modal: true },
      messages.confirmDeleteYes(),
      messages.actionCancel(),
    );
    if (confirm !== messages.confirmDeleteYes()) {
      return;
    }

    this.onTaskActionCallback({
      action: "deleteJobTask",
      taskId: "__jobtask__",
      jobId,
      nodeId,
    });
  }

  private static async handleRenameJobPauseRequest(
    jobId: string,
    nodeId: string,
  ): Promise<void> {
    const job = this.currentJobs.find((entry) => entry.id === jobId);
    const node = job?.nodes.find((entry) => entry.id === nodeId);
    if (!job || !node || !this.onTaskActionCallback || node.type !== "pause") {
      return;
    }

    const title = await vscode.window.showInputBox({
      title: messages.jobsPauseTitle(),
      prompt: messages.jobsPauseName(),
      value: node.title || messages.jobsPauseDefaultTitle(),
      ignoreFocusOut: true,
      validateInput: (input) =>
        input.trim() ? undefined : messages.taskNameRequired(),
    });
    const trimmed = title?.trim();
    if (!trimmed) {
      return;
    }

    this.onTaskActionCallback({
      action: "updateJobPause",
      taskId: "__jobpause__",
      jobId,
      nodeId,
      pauseUpdateData: { title: trimmed },
    });
  }

  private static async handleDeleteJobPauseRequest(
    jobId: string,
    nodeId: string,
  ): Promise<void> {
    const job = this.currentJobs.find((entry) => entry.id === jobId);
    const node = job?.nodes.find((entry) => entry.id === nodeId);
    if (!job || !node || !this.onTaskActionCallback || node.type !== "pause") {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Delete pause checkpoint "${node.title || messages.jobsPauseDefaultTitle()}"? Downstream steps will no longer wait here.`,
      { modal: true },
      messages.confirmDeleteYes(),
      messages.actionCancel(),
    );
    if (confirm !== messages.confirmDeleteYes()) {
      return;
    }

    this.onTaskActionCallback({
      action: "deleteJobPause",
      taskId: "__jobpause__",
      jobId,
      nodeId,
    });
  }

  /**
   * Handle messages from webview
   */
  private static async handleMessage(
    message: WebviewToExtensionMessage,
  ): Promise<void> {
    switch (message.type) {
      case "requestCreateJob":
        await this.handleCreateJobRequest(message.folderId);
        break;

      case "requestCreateJobFolder":
        await this.handleCreateJobFolderRequest(message.parentFolderId);
        break;

      case "requestRenameJobFolder":
        await this.handleRenameJobFolderRequest(message.folderId);
        break;

      case "requestDeleteJobFolder":
        await this.handleDeleteJobFolderRequest(message.folderId);
        break;

      case "requestDeleteJobTask":
        await this.handleDeleteJobTaskRequest(message.jobId, message.nodeId);
        break;

      case "requestRenameJobPause":
        await this.handleRenameJobPauseRequest(message.jobId, message.nodeId);
        break;

      case "requestDeleteJobPause":
        await this.handleDeleteJobPauseRequest(message.jobId, message.nodeId);
        break;

      case "createTask":
        if (this.onTaskActionCallback) {
          // Use a special action for create
          this.onTaskActionCallback({
            action: "edit",
            taskId: "__create__",
            data: message.data,
          });
        }
        break;

      case "updateTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "edit",
            taskId: message.taskId,
            data: message.data,
          });
        }
        break;

      case "testPrompt":
        if (this.onTestPromptCallback) {
          this.onTestPromptCallback(
            message.prompt,
            message.agent,
            message.model,
          );
        }
        break;

      case "toggleAutoShowOnStartup":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "refresh",
            taskId: "__toggleAutoShowOnStartup__",
          });
        }
        break;

      case "restoreScheduleHistory":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "restoreHistory",
            taskId: "__restoreScheduleHistory__",
            historyId: message.snapshotId,
          });
        }
        break;

      case "refreshAgents":
        await this.refreshAgentsAndModels(true);
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
        await this.refreshPromptTemplates(true);
        this.postMessage({
          type: "updatePromptTemplates",
          templates: this.cachedPromptTemplates,
        });
        await this.refreshSkillReferences(true);
        this.postMessage({
          type: "updateSkills",
          skills: this.cachedSkillReferences,
        });
        break;

      case "setupMcp":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "setupMcp",
            taskId: "__setupMcp__",
          });
        }
        break;

      case "saveTelegramNotification":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "saveTelegramNotification",
            taskId: "__telegram__",
            telegramData: message.data,
          });
        }
        break;

      case "testTelegramNotification":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "testTelegramNotification",
            taskId: "__telegram__",
            telegramData: message.data,
          });
        }
        break;

      case "saveExecutionDefaults":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "saveExecutionDefaults",
            taskId: "__defaults__",
            executionDefaults: message.data,
          });
        }
        break;

      case "createTodo":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createTodo",
            taskId: "__todo__",
            todoData: message.data,
          });
        }
        break;

      case "updateTodo":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "updateTodo",
            taskId: "__todo__",
            todoId: message.todoId,
            todoData: message.data,
          });
        }
        break;

      case "deleteTodo":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteTodo",
            taskId: "__todo__",
            todoId: message.todoId,
          });
        }
        break;

      case "archiveTodo":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "archiveTodo",
            taskId: "__todo__",
            todoId: message.todoId,
            todoData: {
              archived: message.archived !== false,
            },
          });
        }
        break;

      case "moveTodo":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "moveTodo",
            taskId: "__todo__",
            todoId: message.todoId,
            targetSectionId: message.sectionId,
            targetOrder: message.targetIndex,
          });
        }
        break;

      case "addTodoComment":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "addTodoComment",
            taskId: "__todo__",
            todoId: message.todoId,
            todoCommentData: message.data,
          });
        }
        break;

      case "setTodoFilters":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "setTodoFilters",
            taskId: "__todo__",
            todoFilters: message.data,
          });
        }
        break;

      case "saveTodoLabelDefinition":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "saveTodoLabelDefinition",
            taskId: "__todo__",
            todoLabelData: message.data,
          });
        }
        break;

      case "deleteTodoLabelDefinition":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteTodoLabelDefinition",
            taskId: "__todo__",
            todoLabelData: { name: message.data.name },
          });
        }
        break;

      case "saveTodoFlagDefinition":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "saveTodoFlagDefinition",
            taskId: "__todo__",
            todoFlagData: message.data,
          });
        }
        break;

      case "deleteTodoFlagDefinition":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteTodoFlagDefinition",
            taskId: "__todo__",
            todoFlagData: { name: message.data.name },
          });
        }
        break;

      case "linkTodoTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "linkTodoTask",
            taskId: "__todo__",
            todoId: message.todoId,
            linkedTaskId: message.taskId,
          });
        }
        break;

      case "createTaskFromTodo":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createTaskFromTodo",
            taskId: "__todo__",
            todoId: message.todoId,
          });
        }
        break;

      case "addCockpitSection":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "addCockpitSection",
            taskId: "__section__",
            sectionTitle: message.title,
          });
        }
        break;

      case "renameCockpitSection":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "renameCockpitSection",
            taskId: "__section__",
            sectionId: message.sectionId,
            sectionTitle: message.title,
          });
        }
        break;

      case "deleteCockpitSection":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteCockpitSection",
            taskId: "__section__",
            sectionId: message.sectionId,
          });
        }
        break;

      case "moveCockpitSection":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "moveCockpitSection",
            taskId: "__section__",
            sectionId: message.sectionId,
            sectionDirection: message.direction,
          });
        }
        break;

      case "reorderCockpitSection":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "reorderCockpitSection",
            taskId: "__section__",
            sectionId: message.sectionId,
            targetIndex: message.targetIndex,
          });
        }
        break;

      case "refreshTasks":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "refresh",
            taskId: "__refresh__",
          });
        }
        break;

      case "runTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "run",
            taskId: message.taskId,
          });
        }
        break;

      case "toggleTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "toggle",
            taskId: message.taskId,
          });
        }
        break;

      case "deleteTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "delete",
            taskId: message.taskId,
          });
        }
        break;

      case "duplicateTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "duplicate",
            taskId: message.taskId,
          });
        }
        break;

      case "createJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createJob",
            taskId: "__job__",
            jobData: message.data,
          });
        }
        break;

      case "updateJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "updateJob",
            taskId: "__job__",
            jobId: message.jobId,
            jobData: message.data,
          });
        }
        break;

      case "deleteJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteJob",
            taskId: "__job__",
            jobId: message.jobId,
          });
        }
        break;

      case "duplicateJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "duplicateJob",
            taskId: "__job__",
            jobId: message.jobId,
          });
        }
        break;

      case "toggleJobPaused":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "toggleJobPaused",
            taskId: "__job__",
            jobId: message.jobId,
          });
        }
        break;

      case "createJobFolder":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createJobFolder",
            taskId: "__jobfolder__",
            folderData: message.data,
          });
        }
        break;

      case "renameJobFolder":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "renameJobFolder",
            taskId: "__jobfolder__",
            folderId: message.folderId,
            folderData: message.data,
          });
        }
        break;

      case "deleteJobFolder":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteJobFolder",
            taskId: "__jobfolder__",
            folderId: message.folderId,
          });
        }
        break;

      case "createJobTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createJobTask",
            taskId: "__jobtask__",
            jobId: message.jobId,
            data: message.data,
            windowMinutes: message.windowMinutes,
          });
        }
        break;

      case "attachTaskToJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "attachTaskToJob",
            taskId: message.taskId,
            jobId: message.jobId,
            windowMinutes: message.windowMinutes,
          });
        }
        break;

      case "detachTaskFromJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "detachTaskFromJob",
            taskId: "__jobtask__",
            jobId: message.jobId,
            nodeId: message.nodeId,
          });
        }
        break;

      case "deleteJobTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteJobTask",
            taskId: "__jobtask__",
            jobId: message.jobId,
            nodeId: message.nodeId,
          });
        }
        break;

      case "createJobPause":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createJobPause",
            taskId: "__jobpause__",
            jobId: message.jobId,
            pauseData: message.data,
          });
        }
        break;

      case "approveJobPause":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "approveJobPause",
            taskId: "__jobpause__",
            jobId: message.jobId,
            nodeId: message.nodeId,
          });
        }
        break;

      case "rejectJobPause":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "rejectJobPause",
            taskId: "__jobpause__",
            jobId: message.jobId,
            nodeId: message.nodeId,
          });
        }
        break;

      case "reorderJobNode":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "reorderJobNode",
            taskId: "__jobtask__",
            jobId: message.jobId,
            nodeId: message.nodeId,
            targetIndex: message.targetIndex,
          });
        }
        break;

      case "updateJobNodeWindow":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "updateJobNodeWindow",
            taskId: "__jobtask__",
            jobId: message.jobId,
            nodeId: message.nodeId,
            windowMinutes: message.windowMinutes,
          });
        }
        break;

      case "compileJob":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "compileJob",
            taskId: "__job__",
            jobId: message.jobId,
          });
        }
        break;

      case "moveTaskToCurrentWorkspace":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "moveToCurrentWorkspace",
            taskId: message.taskId,
          });
        }
        break;

      case "copyTask":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "copy",
            taskId: message.taskId,
          });
        }
        break;

      case "createResearchProfile":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "createResearchProfile",
            taskId: "__research__",
            researchData: message.data,
          });
        }
        break;

      case "updateResearchProfile":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "updateResearchProfile",
            taskId: "__research__",
            researchId: message.researchId,
            researchData: message.data,
          });
        }
        break;

      case "deleteResearchProfile":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "deleteResearchProfile",
            taskId: "__research__",
            researchId: message.researchId,
          });
        }
        break;

      case "duplicateResearchProfile":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "duplicateResearchProfile",
            taskId: "__research__",
            researchId: message.researchId,
          });
        }
        break;

      case "startResearchRun":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "startResearchRun",
            taskId: "__research__",
            researchId: message.researchId,
          });
        }
        break;

      case "stopResearchRun":
        if (this.onTaskActionCallback) {
          this.onTaskActionCallback({
            action: "stopResearchRun",
            taskId: "__research__",
          });
        }
        break;

      case "loadPromptTemplate":
        await this.loadPromptTemplateContent(message.path, message.source);
        break;

      case "webviewReady":
        this.webviewReady = true;
        // Flush any messages that were queued while the webview was not ready.
        // Cached agents/models/templates are already enqueued by refreshLanguage
        // or show(), so we only need to flush here to avoid duplicates.
        this.flushPendingMessages();
        break;
    }
  }

  /**
   * Refresh agents and models cache
   */
  private static async refreshAgentsAndModels(force = false): Promise<void> {
    if (
      !force &&
      this.cachedAgents.length > 0 &&
      this.cachedModels.length > 0
    ) {
      return;
    }

    try {
      this.cachedAgents = await CopilotExecutor.getAllAgents();
    } catch {
      this.cachedAgents = CopilotExecutor.getBuiltInAgents();
    }

    try {
      this.cachedModels = await CopilotExecutor.getAvailableModels();
    } catch {
      this.cachedModels = CopilotExecutor.getFallbackModels();
    }

    // Ensure we always have at least fallback data
    if (this.cachedAgents.length === 0) {
      this.cachedAgents = CopilotExecutor.getBuiltInAgents();
    }
    if (this.cachedModels.length === 0) {
      this.cachedModels = CopilotExecutor.getFallbackModels();
    }
  }

  /**
   * Refresh prompt templates cache
   */
  private static async refreshPromptTemplates(force = false): Promise<void> {
    if (!force && this.cachedPromptTemplates.length > 0) {
      return;
    }

    this.cachedPromptTemplates = await this.getPromptTemplates();
  }

  private static getResolvedWorkspaceRootPaths(): string[] {
    const startPaths = (vscode.workspace.workspaceFolders ?? [])
      .map((folder) => folder.uri.fsPath)
      .filter(
        (folderPath): folderPath is string =>
          typeof folderPath === "string" && folderPath.trim().length > 0,
      );

    return getResolvedWorkspaceRoots(startPaths);
  }

  /**
   * Get prompt templates from local and global locations
   */
  private static async getPromptTemplates(): Promise<PromptTemplate[]> {
    const templates: PromptTemplate[] = [];

    // Get local templates (.github/prompts/*.md)
    const workspaceRoots = this.getResolvedWorkspaceRootPaths();
    for (const workspaceRoot of workspaceRoots) {
      const localPromptDir = path.join(workspaceRoot, ".github", "prompts");
      try {
        const entries = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(localPromptDir),
        );
        for (const [file, fileType] of entries) {
          if (fileType !== vscode.FileType.File) continue;
          const lower = file.toLowerCase();
          if (!lower.endsWith(".md")) continue;
          if (lower.endsWith(".agent.md")) continue;
          templates.push({
            path: path.join(localPromptDir, file),
            name: path.basename(file, ".md"),
            source: "local",
          });
        }
      } catch {
        // Ignore errors
      }
    }

    // Get global templates
    const globalPath = this.getGlobalPromptsPath();
    if (globalPath) {
      try {
        const entries = await vscode.workspace.fs.readDirectory(
          vscode.Uri.file(globalPath),
        );
        for (const [file, fileType] of entries) {
          if (fileType !== vscode.FileType.File) continue;
          const lower = file.toLowerCase();
          if (!lower.endsWith(".md")) continue;
          if (lower.endsWith(".agent.md")) continue;
          templates.push({
            path: path.join(globalPath, file),
            name: path.basename(file, ".md"),
            source: "global",
          });
        }
      } catch {
        // Ignore errors
      }
    }

    templates.sort((a, b) => a.name.localeCompare(b.name));
    return templates;
  }

  private static async refreshSkillReferences(force = false): Promise<void> {
    if (!force && this.cachedSkillReferences.length > 0) {
      return;
    }

    this.cachedSkillReferences = await this.getSkillReferences();
  }

  private static async getSkillReferences(): Promise<SkillReference[]> {
    const results: SkillReference[] = [];
    const seen = new Set<string>();
    const workspaceRoots = this.getResolvedWorkspaceRootPaths();

    const addSkill = (
      filePath: string,
      source: "workspace" | "global",
      basePath?: string,
    ): void => {
      const resolved = path.resolve(filePath);
      const key = process.platform === "win32"
        ? resolved.toLowerCase()
        : resolved;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      const reference = basePath
        ? path.relative(basePath, resolved) || path.basename(resolved)
        : path.basename(resolved);
      results.push({
        path: resolved,
        name: path.basename(resolved),
        reference,
        source,
      });
    };

    const workspaceSkills = await vscode.workspace.findFiles(
      "**/{SKILL.md,*.skill.md}",
      "**/{node_modules,.git,out,dist,build,.next}/**",
      200,
    );
    for (const uri of workspaceSkills) {
      if (uri.scheme !== "file") {
        continue;
      }
      const matchedRoot = workspaceRoots.find((candidate) => {
        const resolvedRoot = path.resolve(candidate);
        const lhs = process.platform === "win32"
          ? uri.fsPath.toLowerCase()
          : uri.fsPath;
        const rhs = process.platform === "win32"
          ? resolvedRoot.toLowerCase()
          : resolvedRoot;
        return lhs === rhs || lhs.startsWith(`${rhs}${path.sep}`);
      });
      addSkill(uri.fsPath, "workspace", matchedRoot);
    }

    const globalRoot = this.getGlobalPromptsPath();
    if (globalRoot && fs.existsSync(globalRoot)) {
      const stack = [globalRoot];
      while (stack.length > 0 && results.length < 250) {
        const current = stack.pop();
        if (!current) {
          continue;
        }
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const entry of entries) {
          const entryPath = path.join(current, entry.name);
          if (entry.isDirectory()) {
            if (["node_modules", ".git", "out", "dist", "build"].includes(entry.name)) {
              continue;
            }
            stack.push(entryPath);
            continue;
          }
          const lower = entry.name.toLowerCase();
          if (lower !== "skill.md" && !lower.endsWith(".skill.md")) {
            continue;
          }
          addSkill(entryPath, "global", globalRoot);
        }
      }
    }

    results.sort((a, b) => a.reference.localeCompare(b.reference));
    return results;
  }

  /**
   * Get global prompts path
   */
  private static getGlobalPromptsPath(): string | undefined {
    return resolveGlobalPromptsRoot(
      getCompatibleConfigurationValue<string>("globalPromptsPath", ""),
    );
  }

  /**
   * Load prompt template content
   */
  private static async loadPromptTemplateContent(
    templatePath: string,
    source: "local" | "global",
  ): Promise<void> {
    try {
      const validation = validateTemplateLoadRequest({
        templatePath,
        source,
        cachedTemplates: this.cachedPromptTemplates,
        workspaceFolderPaths: this.getResolvedWorkspaceRootPaths(),
        globalPromptsPath: this.getGlobalPromptsPath(),
      });

      if (!validation.ok) {
        throw new Error(`Template load rejected: ${validation.reason}`);
      }

      const resolvedPath = path.resolve(templatePath);
      const bytes = await vscode.workspace.fs.readFile(
        vscode.Uri.file(resolvedPath),
      );
      const content = Buffer.from(bytes).toString("utf8");
      this.postMessage({
        type: "promptTemplateLoaded",
        content: content,
        path: templatePath,
      });
    } catch (error) {
      const templateFile = path.basename(templatePath);
      const rawError =
        error instanceof Error ? error.message : String(error ?? "");
      const safeError =
        this.sanitizeErrorDetailsForUser(rawError) || messages.webviewUnknown();
      logError("[CopilotScheduler] Template load failed:", {
        templateFile,
        source,
        error: safeError,
      });
      notifyError(messages.templateLoadError());
    }
  }

  /**
   * Generate nonce for CSP
   */
  private static getNonce(): string {
    let text = "";
    const possible =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }

  private static serializeForWebview(value: unknown): string {
    const json = JSON.stringify(value ?? null) ?? "null";
    // Escape < and U+2028/U+2029 to avoid breaking the surrounding <script>
    return json
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");
  }

  private static escapeHtmlAttr(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private static escapeHtml(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private static getModelSourceLabel(model: ModelInfo): string {
    const id = String(model.id || "").trim();
    const name = String(model.name || "").trim();
    const vendor = String(model.vendor || "").trim();
    const description = String(model.description || "").trim();
    const normalized = [id, name, vendor, description].join(" ").toLowerCase();

    if (normalized.includes("openrouter")) {
      return "OpenRouter";
    }

    if (
      normalized.includes("copilot") ||
      normalized.includes("codex") ||
      normalized.includes("github") ||
      normalized.includes("microsoft")
    ) {
      return "Copilot";
    }

    return vendor;
  }

  private static formatModelLabel(model: ModelInfo): string {
    const name = String(model.name || model.id || "").trim();
    const source = this.getModelSourceLabel(model);
    if (!source || source.toLowerCase() === name.toLowerCase()) {
      return name;
    }

    return `${name} • ${source}`;
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
    const nonce = this.getNonce();
    const isJa = isJapanese();
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

    // Localized strings
    const strings = {
      title: messages.webviewTitle(),
      tabTodoEditor: "Create Todo",
      tabTaskEditor: "Create Task",
      tabCreate: messages.tabCreate(),
      tabEdit: messages.tabEdit(),
      tabList: messages.tabList(),
      tabHowTo: messages.tabHowTo(),
      tabHelpGlyph: "?",
      helpIntroTitle: messages.helpIntroTitle(),
      helpIntroBody: messages.helpIntroBody(),
      helpCreateTitle: messages.helpCreateTitle(),
      helpCreateItemName: messages.helpCreateItemName(),
      helpCreateItemTemplates: messages.helpCreateItemTemplates(),
      helpCreateItemSkills: messages.helpCreateItemSkills(),
      helpCreateItemAgentModel: messages.helpCreateItemAgentModel(),
      helpCreateItemRunFirst: messages.helpCreateItemRunFirst(),
      helpListTitle: messages.helpListTitle(),
      helpListItemSections: messages.helpListItemSections(),
      helpListItemActions: messages.helpListItemActions(),
      helpListItemStartup: messages.helpListItemStartup(),
      helpStorageTitle: messages.helpStorageTitle(),
      helpStorageItemRepo: messages.helpStorageItemRepo(),
      helpStorageItemBackups: messages.helpStorageItemBackups(),
      helpStorageItemIsolation: messages.helpStorageItemIsolation(),
      helpStorageItemGlobal: messages.helpStorageItemGlobal(),
      helpOverdueTitle: messages.helpOverdueTitle(),
      helpOverdueItemReview: messages.helpOverdueItemReview(),
      helpOverdueItemRecurring: messages.helpOverdueItemRecurring(),
      helpOverdueItemOneTime: messages.helpOverdueItemOneTime(),
      helpSessionTitle: messages.helpSessionTitle(),
      helpSessionItemPerTask: messages.helpSessionItemPerTask(),
      helpSessionItemNewChat: messages.helpSessionItemNewChat(),
      helpSessionItemCareful: messages.helpSessionItemCareful(),
      helpSessionItemSeparate: messages.helpSessionItemSeparate(),
      helpMcpTitle: messages.helpMcpTitle(),
      helpMcpItemEmbedded: messages.helpMcpItemEmbedded(),
      helpMcpItemConfig: messages.helpMcpItemConfig(),
      helpMcpItemAutoConfig: messages.helpMcpItemAutoConfig(),
      helpMcpItemDanger: messages.helpMcpItemDanger(),
      helpMcpItemInspect: messages.helpMcpItemInspect(),
      helpMcpItemWrite: messages.helpMcpItemWrite(),
      helpMcpItemTools: messages.helpMcpItemTools(),
      helpJobsTitle: messages.helpJobsTitle(),
      tabBoard: "Todo Cockpit",
      tabResearch: "Research",
      helpJobsItemBoard: messages.helpJobsItemBoard(),
      helpJobsItemPause: messages.helpJobsItemPause(),
      helpJobsItemCompile: messages.helpJobsItemCompile(),
      helpJobsItemLabels: messages.helpJobsItemLabels(),
      helpJobsItemFolders: messages.helpJobsItemFolders(),
      helpJobsItemDelete: messages.helpJobsItemDelete(),
      helpResearchTitle: messages.helpResearchTitle(),
      helpResearchItemProfiles: messages.helpResearchItemProfiles(),
      helpResearchItemBounds: messages.helpResearchItemBounds(),
      helpResearchItemHistory: messages.helpResearchItemHistory(),
      tabTelegram: "Settings",
      telegramTitle: "Telegram Notifications",
      telegramDescription:
        "Configure a repo-local Stop hook that sends the last assistant reply to your Telegram bot.",
      telegramEnable: "Enable Telegram Stop notification",
      telegramBotToken: "Bot token",
      telegramBotTokenPlaceholder: "123456:ABCDEF...",
      telegramBotTokenHelp:
        "Stored only in .vscode/scheduler.private.json. Leave blank to keep the currently saved token.",
      telegramChatId: "Chat ID",
      telegramChatIdPlaceholder: "123456789 or -100...",
      telegramMessagePrefix: "Message prefix",
      telegramMessagePrefixPlaceholder: "Optional short header shown above the last assistant reply.",
      telegramSave: "Save Telegram Settings",
      telegramTest: "Send Test Message",
      telegramSavedToken: "Bot token stored privately",
      telegramMissingToken: "No bot token saved yet",
      telegramHookReady: "Stop hook configured",
      telegramHookMissing: "Stop hook files not configured",
      telegramUpdatedAt: "Last updated",
      telegramWorkspaceNote:
        "The hook files are generated under .github/hooks and read secrets from .vscode/scheduler.private.json.",
      telegramValidationChatId: "Telegram chat ID is required.",
      telegramValidationBotToken: "Telegram bot token is required.",
      telegramStatusSaved:
        "Settings are repo-local. Save after changing chat ID, prefix, or token.",
      executionDefaultsTitle: "Execution Defaults",
      executionDefaultsDescription:
        "These workspace settings apply when a task, job step, research profile, or test run leaves agent or model empty.",
      executionDefaultsAgent: "Default agent",
      executionDefaultsModel: "Default model",
      executionDefaultsSave: "Save Defaults",
      executionDefaultsSaved: "Workspace default agent and model settings.",
      boardTitle: "Todo Cockpit",
      boardDescription:
        "Local-only planning and approval workspace. Todos stay distinct from scheduled tasks, while existing task drafts also surface here under Unsorted.",
      boardEmpty: "No todos yet. Create one here or let existing scheduled tasks appear under Unsorted.",
      boardSections: "Sections",
      boardCards: "Cards",
      boardComments: "Comments",
      boardPrivacyNote:
        "Todo Cockpit state is kept only in .vscode/scheduler.private.json so user-system planning stays local to this workspace.",
      boardToolbarNew: "New Todo",
      boardToolbarClear: "Clear Selection",
      boardSearchLabel: "Search",
      boardSearchPlaceholder: "Search title, description, labels, comments",
      boardSortLabel: "Sort",
      boardSectionFilterLabel: "Section",
      boardLabelFilterLabel: "Label",
      boardPriorityFilterLabel: "Priority",
      boardStatusFilterLabel: "Status",
      boardArchiveOutcomeFilterLabel: "Archive outcome",
      boardShowArchived: "Show archived",
      boardAllSections: "All sections",
      boardAllLabels: "All labels",
      boardAllPriorities: "All priorities",
      boardAllStatuses: "All statuses",
      boardAllArchiveOutcomes: "All outcomes",
      boardSortManual: "Manual order",
      boardSortDueAt: "Due date",
      boardSortPriority: "Priority",
      boardSortUpdatedAt: "Last updated",
      boardSortCreatedAt: "Created date",
      boardSortAsc: "Ascending",
      boardSortDesc: "Descending",
      boardDetailTitleCreate: "Create Todo",
      boardDetailTitleEdit: "Edit Todo",
      boardDetailModeCreate: "Fill the form to create a new Todo Cockpit item.",
      boardDetailModeEdit: "Update fields, manage labels, and move the item through approval, completion, or rejection.",
      boardFieldTitle: "Title",
      boardFieldDescription: "Description",
      boardFieldDueAt: "Due date",
      boardFieldSection: "Section",
      boardFieldPriority: "Priority",
      boardFieldLabels: "Labels",
      boardFieldFlags: "Flag (agent state)",
      boardFlagAdd: "Add Flag",
      boardFlagClear: "Clear",
      boardFlagCatalogHint: "Click a flag to set it. Only one flag at a time.",
      boardFieldLinkedTask: "Linked scheduled task",
      boardLinkedTaskNone: "No linked task",
      boardSaveCreate: "Create Todo",
      boardSaveUpdate: "Save Todo",
      boardAddComment: "Add Comment",
      boardCreateTask: "Create Task Draft",
      boardApproveTodo: "Approve",
      boardFinalizeTodo: "Final Accept",
      boardDeleteTodo: "Delete Todo",
      boardDeleteTodoHelp: "Reject and archive this todo.",
      boardReadOnlyArchived: "Archived items are read-only. Toggle archived visibility to review outcomes and history.",
      boardReadyForTask: "Approved items can become scheduled task drafts or be final accepted.",
      boardCommentsTitle: "Comments",
      boardCommentsEmpty: "No comments yet.",
      boardCommentPlaceholder: "Add a comment with context, provenance, or approval notes...",
      boardCommentSourceHumanForm: "Human form",
      boardCommentSourceBotMcp: "Bot MCP",
      boardCommentSourceBotManual: "Bot manual",
      boardCommentSourceSystemEvent: "System event",
      boardTaskDraftNote: "Scheduled tasks are downstream execution artifacts. Creating a task draft here does not replace the todo.",
      boardDueLabel: "Due",
      boardTaskMissing: "Linked task not found in Task List.",
      boardTaskLinked: "Linked task",
      boardStatusLabel: "Status",
      boardStatusActive: "Active",
      boardStatusReady: "Ready",
      boardStatusCompleted: "Completed",
      boardStatusRejected: "Rejected",
      boardArchiveCompletedSuccessfully: "Completed successfully",
      boardArchiveRejected: "Rejected",
      boardLatestComment: "Latest comment",
      boardLabelInputPlaceholder: "Type a label and press Enter",
      boardLabelAdd: "Add",
      boardLabelSaveColor: "Save Color",
      boardLabelHint: "Click a chip to target its shared color. Press Enter to add more labels.",
      boardNoLinkedTask: "No linked task yet",
      boardLinkedTaskShort: "Linked",
      boardDescriptionPreviewEmpty: "No description yet.",
      boardEditTodo: "Open Editor",
      boardBackToCockpit: "Back to Cockpit",
      boardPriorityNone: "None",
      boardPriorityLow: "Low",
      boardPriorityMedium: "Medium",
      boardPriorityHigh: "High",
      boardPriorityUrgent: "Urgent",
      boardDropHint: "Drag between columns to reorder or move todos.",
      helpTipsTitle: messages.helpTipsTitle(),
      helpTipsItem1: messages.helpTipsItem1(),
      helpTipsItem2: messages.helpTipsItem2(),
      helpTipsItem3: messages.helpTipsItem3(),
      labelTaskName: messages.labelTaskName(),
      tabJobsEditor: "Create / Edit Job",
      tabJobs: "Jobs",
      labelTaskLabels: "Labels",
      placeholderTaskLabels: "marketing, finance, weekly",
      labelSkills: messages.labelSkills(),
      placeholderSelectSkill: messages.placeholderSelectSkill(),
      actionInsertSkill: messages.actionInsertSkill(),
      skillInsertNote: messages.skillInsertNote(),
      skillSentenceTemplate: messages.skillSentenceTemplate("{skill}"),
      actionSetupMcp: messages.mcpSetupAction(),
      labelFilterByLabel: "Filter by label",
      labelAllLabels: "All labels",
      jobsTitle: "Jobs",
      jobsFoldersTitle: "Folders",
      jobsRootFolder: "All jobs",
      jobsCurrentFolderLabel: "Current folder",
      jobsCurrentFolderBadge: "Current",
      jobsArchiveFolder: "Bundled Jobs",
      jobsCreateFolder: "New Folder",
      jobsCreateJob: "New Job",
      jobsOpenEditor: "Open Editor",
      jobsBackToJobs: "Back to Jobs",
      jobsOverviewTitle: "Jobs Overview",
      jobsOverviewNote: "Keep folders and job selection here, then open the dedicated editor tab when you want to change workflow details.",
      taskEditorTitle: "Create / Edit Task",
      taskEditorDescription: "Configure the prompt, schedule, and runtime behavior in a single compact view.",
      taskEditorPromptTitle: "Prompt",
      taskEditorScheduleTitle: "Schedule",
      taskEditorRuntimeTitle: "Runtime",
      taskEditorOptionsTitle: "Options",
      taskEditorActionsTitle: "Actions",
      taskEditorTestPrompt: "Test Prompt",
      jobsRenameFolder: "Rename Folder",
      jobsDeleteFolder: "Delete Folder",
      jobsSelectJob: "Select a job to edit its workflow.",
      jobsName: "Job name",
      jobsCron: "Job schedule",
      jobsFolder: "Folder",
      jobsPaused: "Inactive",
      jobsRunning: "Active",
      jobsSave: "Save Job",
      jobsDuplicate: "Duplicate Job",
      jobsDelete: "Delete Job",
      jobsPause: "Deactivate Job",
      jobsResume: "Activate Job",
      jobsCompile: "Compile To Task",
      jobsHideSidebar: "Hide Sidebar",
      jobsShowSidebar: "Show Sidebar",
      jobsCompactTimeline: "Workflow timeline",
      jobsTimelineEmpty: "No steps yet",
      jobsToggleStatus: "Toggle active status",
      jobsSteps: "Workflow steps",
      jobsPauseTitle: "Pause checkpoints",
      jobsCreatePause: "Create Pause",
      jobsPauseName: "Pause title",
      jobsPauseHelpText: "This checkpoint blocks downstream steps until you approve the previous result.",
      jobsPauseWaiting: "Waiting for approval",
      jobsPauseApproved: "Approved",
      jobsPauseApprove: "Approve",
      jobsPauseReject: "Reject and edit previous step",
      jobsPauseDefaultTitle: "Manual review",
      jobsArchivedBadge: "Archived",
      jobsPauseEdit: "Edit",
      jobsPauseDelete: "Delete",
      jobsArchiveFolderBadge: "Bundled jobs",
      jobsWindowMinutes: "Window (minutes)",
      jobsAddExistingTask: "Add Existing Task",
      jobsAttach: "Attach Task",
      jobsStandaloneTasks: "Standalone tasks",
      jobsAddNewStep: "Add New Step",
      jobsCreateStep: "Create Step",
      jobsStepName: "Step name",
      jobsStepPrompt: "Step prompt",
      jobsNoJobs: "No jobs in this folder yet.",
      jobsNoFolders: "No folders yet.",
      jobsNoStandaloneTasks: "No standalone tasks available.",
      jobsEmptySteps: "This job has no steps yet.",
      jobsDropHint: "Drag steps to reorder the timeline.",
      researchTitle: "Benchmark Research",
      researchProfilesTitle: "Profiles",
      researchActiveRunTitle: "Run details",
      researchHistoryTitle: "Recent runs",
      researchEmptyProfiles: "No research profiles yet.",
      researchEmptyRuns: "No research runs yet.",
      researchNewProfile: "New Profile",
      researchCreateProfile: "Create Profile",
      researchSaveProfile: "Save Profile",
      researchDuplicateProfile: "Duplicate Profile",
      researchDeleteProfile: "Delete Profile",
      researchStartRun: "Start Run",
      researchStopRun: "Stop Run",
      researchName: "Profile name",
      researchInstructions: "Instructions",
      researchInstructionsPlaceholder: "Describe the goal and the kind of focused edits Copilot should attempt.",
      researchEditablePaths: "Editable files",
      researchEditablePathsPlaceholder: "src/file.ts\nsrc/other.ts",
      researchBenchmarkCommand: "Benchmark command",
      researchBenchmarkPlaceholder: "npm test -- --runInBand",
      researchMetricPattern: "Metric regex",
      researchMetricPatternPlaceholder: "score:\\s*([0-9.]+)",
      researchMetricDirection: "Metric direction",
      researchDirectionMaximize: "Maximize",
      researchDirectionMinimize: "Minimize",
      researchMaxIterations: "Max iterations",
      researchMaxMinutes: "Max minutes",
      researchMaxFailures: "Max consecutive failures",
      researchBenchmarkTimeout: "Benchmark timeout (seconds)",
      researchEditWait: "Copilot edit settle time (seconds)",
      researchCurrentBest: "Current best",
      researchNoScore: "No score yet",
      researchStatusIdle: "Idle",
      researchStatusRunning: "Running",
      researchStatusStopping: "Stopping",
      researchStatusCompleted: "Completed",
      researchStatusFailed: "Failed",
      researchStatusStopped: "Stopped",
      researchAttempts: "Attempts",
      researchLastOutcome: "Last outcome",
      researchStopReason: "Stop reason",
      researchActiveRunEmpty: "No research run is active.",
      researchAttemptTimeline: "Attempt timeline",
      researchBaselineLabel: "Baseline",
      researchIterationLabel: "Iteration",
      researchStartedAt: "Started",
      researchFinishedAt: "Finished",
      researchDuration: "Duration",
      researchBaselineScore: "Baseline score",
      researchBestScore: "Best score",
      researchCompletedIterations: "Completed iterations",
      researchChangedFiles: "Changed files",
      researchViolationFiles: "Policy violation files",
      researchBenchmarkOutput: "Benchmark output",
      researchExitCode: "Exit code",
      researchSnapshot: "Snapshot",
      researchMetricPatternShort: "Metric",
      researchBudgetShort: "Budget",
      researchEditableCount: "Editable files",
      researchUnsavedNew: "New profile",
      researchUnsavedChanges: "Unsaved changes",
      researchNoRunSelected: "Select a recent run to inspect its attempts.",
      researchProfileNameRequired: "Research profile name is required.",
      researchBenchmarkRequired: "Benchmark command is required.",
      researchMetricRequired: "Metric regex is required.",
      researchEditableRequired: "Add at least one editable file path.",
      researchHelpText: "This first implementation runs bounded benchmark iterations against a small allowlisted file set and records keep or revert outcomes in repo-local history.",
      labelPromptType: messages.labelPromptType(),
      labelPromptInline: messages.labelPromptInline(),
      labelPromptLocal: messages.labelPromptLocal(),
      labelPromptGlobal: messages.labelPromptGlobal(),
      labelPrompt: messages.labelPrompt(),
      labelSchedule: messages.labelSchedule(),
      labelCronExpression: messages.labelCronExpression(),
      labelPreset: messages.labelPreset(),
      labelCustom: messages.labelCustom(),
      labelAgent: messages.labelAgent(),
      labelModel: messages.labelModel(),
      labelModelNote: messages.labelModelNote(),
      labelScope: messages.labelScope(),
      labelScopeGlobal: messages.labelScopeGlobal(),
      labelScopeWorkspace: messages.labelScopeWorkspace(),
      labelEnabled: messages.labelEnabled(),
      labelDisabled: messages.labelDisabled(),
      labelStatus: messages.labelStatus(),
      labelNextRun: messages.labelNextRun(),
      labelLastRun: messages.labelLastRun(),
      labelNever: messages.labelNever(),
      labelRunFirstInOneMinute: messages.labelRunFirstInOneMinute(),
      labelOneTime: messages.labelOneTime(),
      labelChatSession: messages.labelChatSession(),
      labelChatSessionNew: messages.labelChatSessionNew(),
      labelChatSessionContinue: messages.labelChatSessionContinue(),
      labelChatSessionBadgeNew: messages.labelChatSessionBadgeNew(),
      labelChatSessionBadgeContinue: messages.labelChatSessionBadgeContinue(),
      labelChatSessionRecurringOnly: messages.labelChatSessionRecurringOnly(),
      labelAllTasks: messages.labelAllTasks(),
      labelRecurringTasks: messages.labelRecurringTasks(),
      labelOneTimeTasks: messages.labelOneTimeTasks(),
      labelJitterSeconds: messages.labelJitterSeconds(),
      placeholderTaskName: messages.placeholderTaskName(),
      placeholderPrompt: messages.placeholderPrompt(),
      placeholderCron: messages.placeholderCron(),
      invalidCronExpression: messages.invalidCronExpression(),
      taskNameRequired: messages.taskNameRequired(),
      promptRequired: messages.promptRequired(),
      templateRequired: messages.templateRequired(),
      cronExpressionRequired: messages.cronExpressionRequired(),
      actionCreate: messages.actionCreate(),
      actionSave: messages.actionSave(),
      actionNewTask: messages.actionNewTask(),
      actionTestRun: messages.actionTestRun(),
      actionRun: messages.actionRun(),
      actionEdit: messages.actionEdit(),
      actionDelete: messages.actionDelete(),
      actionRefresh: messages.actionRefresh(),
      actionCopyPrompt: messages.actionCopyPrompt(),
      actionDuplicate: messages.actionDuplicate(),
      actionMoveToCurrentWorkspace: messages.actionMoveToCurrentWorkspace(),
      actionEnable: messages.actionEnable(),
      actionDisable: messages.actionDisable(),
      noTasksFound: messages.noTasksFound(),
      labelAdvanced: messages.labelAdvanced(),
      labelFrequency: messages.labelFrequency(),
      labelFrequencyMinute: messages.labelFrequencyMinute(),
      labelFrequencyHourly: messages.labelFrequencyHourly(),
      labelFrequencyDaily: messages.labelFrequencyDaily(),
      labelFrequencyWeekly: messages.labelFrequencyWeekly(),
      labelFrequencyMonthly: messages.labelFrequencyMonthly(),
      labelSelectDays: messages.labelSelectDays(),
      labelSelectTime: messages.labelSelectTime(),
      labelInterval: messages.labelInterval(),
      daySun: messages.daySun(),
      dayMon: messages.dayMon(),
      dayTue: messages.dayTue(),
      dayWed: messages.dayWed(),
      dayThu: messages.dayThu(),
      dayFri: messages.dayFri(),
      daySat: messages.daySat(),
      labelFriendlyBuilder: messages.labelFriendlyBuilder(),
      labelFriendlyGenerate: messages.labelFriendlyGenerate(),
      labelFriendlyPreview: messages.labelFriendlyPreview(),
      labelFriendlyFallback: messages.labelFriendlyFallback(),
      labelFriendlySelect: messages.labelFriendlySelect(),
      labelEveryNMinutes: messages.labelEveryNMinutes(),
      labelHourlyAtMinute: messages.labelHourlyAtMinute(),
      labelDailyAtTime: messages.labelDailyAtTime(),
      labelWeeklyAtTime: messages.labelWeeklyAtTime(),
      labelMonthlyAtTime: messages.labelMonthlyAtTime(),
      labelMinute: messages.labelMinute(),
      labelHour: messages.labelHour(),
      labelDayOfMonth: messages.labelDayOfMonth(),
      labelDayOfWeek: messages.labelDayOfWeek(),
      labelOpenInGuru: messages.labelOpenInGuru(),

      cronPreviewEveryNMinutes: messages.cronPreviewEveryNMinutes(),
      cronPreviewHourlyAtMinute: messages.cronPreviewHourlyAtMinute(),
      cronPreviewDailyAt: messages.cronPreviewDailyAt(),
      cronPreviewWeekdaysAt: messages.cronPreviewWeekdaysAt(),
      cronPreviewWeeklyOnAt: messages.cronPreviewWeeklyOnAt(),
      cronPreviewMonthlyOnAt: messages.cronPreviewMonthlyOnAt(),
      placeholderSelectAgent: messages.webviewSelectAgentPlaceholder(),
      placeholderNoAgents: messages.webviewNoAgentsAvailable(),
      placeholderSelectModel: messages.webviewSelectModelPlaceholder(),
      placeholderNoModels: messages.webviewNoModelsAvailable(),
      placeholderSelectTemplate: messages.webviewSelectTemplatePlaceholder(),

      // Webview JS error text
      webviewScriptErrorPrefix: messages.webviewScriptErrorPrefix(),
      webviewUnhandledErrorPrefix: messages.webviewUnhandledErrorPrefix(),
      webviewLinePrefix: messages.webviewLinePrefix(),
      webviewLineSuffix: messages.webviewLineSuffix(),
      webviewUnknown: messages.webviewUnknown(),
      webviewApiUnavailable: messages.webviewApiUnavailable(),
      webviewClientErrorPrefix: messages.webviewClientErrorPrefix(),
      webviewSuccessPrefix: messages.webviewSuccessPrefix(),

      // Webview notes
      webviewJitterNote: messages.webviewJitterNote(),

      labelThisWorkspaceShort: messages.labelThisWorkspaceShort(),
      labelOtherWorkspaceShort: messages.labelOtherWorkspaceShort(),
      autoShowOnStartupEnabled: messages.autoShowOnStartupEnabled(),
      autoShowOnStartupDisabled: messages.autoShowOnStartupDisabled(),
      autoShowOnStartupToggleEnabled: messages.autoShowOnStartupToggleEnabled(),
      autoShowOnStartupToggleDisabled: messages.autoShowOnStartupToggleDisabled(),
      scheduleHistoryLabel: messages.scheduleHistoryLabel(),
      scheduleHistoryPlaceholder: messages.scheduleHistoryPlaceholder(),
      scheduleHistoryEmpty: messages.scheduleHistoryEmpty(),
      scheduleHistoryNote: messages.scheduleHistoryNote(),
      scheduleHistoryRestoreConfirm: messages.scheduleHistoryRestoreConfirm(
        "{createdAt}",
      ),
      scheduleHistoryRestoreSelectRequired:
        messages.scheduleHistoryRestoreSelectRequired(),
      actionRestoreBackup: messages.actionRestoreBackup(),
    };

    const allPresets = presets;

    const serializeForWebview = this.serializeForWebview;
    const escapeHtmlAttr = this.escapeHtmlAttr;
    const escapeHtml = this.escapeHtml;

    const initialData = {
      tasks: initialTasks,
      jobs: this.currentJobs,
      jobFolders: this.currentJobFolders,
      cockpitBoard: this.currentCockpitBoard,
      telegramNotification: this.currentTelegramNotification,
      executionDefaults: this.currentExecutionDefaults,
      researchProfiles: this.currentResearchProfiles,
      activeResearchRun: this.currentActiveResearchRun,
      recentResearchRuns: this.currentRecentResearchRuns,
      agents: initialAgents,
      models: initialModels,
      promptTemplates: initialTemplates,
      skills: this.cachedSkillReferences,
      workspacePaths: this.getResolvedWorkspaceRootPaths(),
      caseInsensitivePaths: process.platform === "win32",
      defaultJitterSeconds,
      defaultChatSession,
      scheduleHistory: this.currentScheduleHistory,
      autoShowOnStartup: vscode.workspace
        .getConfiguration(
          "copilotScheduler",
          vscode.workspace.workspaceFolders?.[0]?.uri,
        )
        .get<boolean>("autoShowOnStartup", false),
      locale: isJa ? "ja-JP" : "en-US",
      strings,
    };

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "media", "schedulerWebview.js"),
    );
    const rawHtml = `<!DOCTYPE html>
<html lang="${isJa ? "ja" : "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource}; font-src ${webview.cspSource};">
  <title>${escapeHtmlAttr(strings.title)}</title>
  <style>
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
      z-index: 20;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 6px;
      margin: -12px -14px 10px -14px;
      padding: 6px 12px 4px 12px;
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
      gap: 4px;
    }

    .tab-help-button {
      width: 28px;
      min-width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      margin-right: 4px;
    }

    .tab-settings-button {
      width: 28px;
      min-width: 28px;
      height: 28px;
      padding: 0;
      border-radius: 999px;
      border: 1px solid var(--vscode-panel-border);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      line-height: 1;
      margin-left: 4px;
    }
    
    .tab-button {
      padding: 6px 10px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 11px;
      line-height: 1.15;
      flex: 1 1 auto;
      text-align: center;
      min-width: max-content;
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
      margin: 4px 3px;
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
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }

    .help-panel {
      display: grid;
      gap: 10px;
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
      font-size: 14px;
      font-weight: 700;
      line-height: 1.2;
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

    .form-group {
      margin-bottom: 12px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 4px;
      font-weight: 500;
      font-size: 12px;
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
    }
    
    .checkbox-group input[type="checkbox"] {
      width: auto;
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

    .task-sections.filtered {
      grid-template-columns: 1fr;
    }

    .task-section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 5px;
      background-color: var(--vscode-editor-background);
      min-width: 0;
    }

    .task-section-title {
      font-size: 10px;
      font-weight: 600;
      margin-bottom: 3px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      justify-content: space-between;
      align-items: center;
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
      font-size: 11px;
      line-height: 1.25;
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
      font-size: 9px;
      line-height: 1.25;
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
      font-size: 9px;
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
      font-size: 9px;
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
      font-size: 9px;
      line-height: 1.3;
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
      font-size: 10px;
      line-height: 1.1;
    }
    
    .empty-state {
      text-align: center;
      padding: 10px;
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
    }

    @media (max-width: 920px) {
      .task-sections {
        grid-template-columns: 1fr;
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
      overflow-y: hidden;
      padding-bottom: 10px;
      min-height: 200px;
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
      gap: 6px;
      margin-left: auto;
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
    }

    .board-col-width-group input[type="range"] {
      width: 100px;
      cursor: pointer;
    }

    .cockpit-section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
      cursor: grab;
      user-select: none;
    }

    .cockpit-section-header:active {
      cursor: grabbing;
    }

    .cockpit-section-header strong {
      padding-left: 2px;
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

    .section-body-wrapper {
      display: grid;
      grid-template-rows: 1fr;
      transition: grid-template-rows 0.22s ease;
      overflow: hidden;
    }

    .section-body-wrapper.collapsed {
      grid-template-rows: 0fr;
    }

    .section-body-inner {
      min-height: 0;
      overflow: hidden;
    }

    .card-labels [data-label-index]:not([data-label-index="0"]) {
      display: none;
    }

    @container (min-width: 300px) {
      .card-labels [data-label-index="1"],
      .card-labels [data-label-index="2"] {
        display: inline-flex;
      }
    }

    @container (min-width: 390px) {
      .card-labels [data-label-index="3"],
      .card-labels [data-label-index="4"],
      .card-labels [data-label-index="5"] {
        display: inline-flex;
      }
    }

    section[data-section-id] {
      transition: opacity 0.15s ease, outline-color 0.1s ease;
    }

    section[data-section-id].section-dragging {
      opacity: 0.4;
    }

    section[data-section-id].section-drag-over {
      outline: 2px solid var(--vscode-focusBorder);
      outline-offset: 2px;
      background: color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent) !important;
    }

    article[data-todo-id] {
      transition: opacity 0.15s ease, transform 0.15s ease, box-shadow 0.12s ease;
    }

    article[data-todo-id].todo-dragging {
      opacity: 0.35;
      transform: rotate(1.5deg) scale(0.97) !important;
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
      padding: 2px 6px !important;
      line-height: 1.3;
    }

    .todo-card-edit {
      background-color: color-mix(in srgb, var(--vscode-button-secondaryBackground) 80%, transparent) !important;
    }

    .todo-card-approve {
      background-color: color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 22%, var(--vscode-button-secondaryBackground)) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-finalize {
      background-color: color-mix(in srgb, var(--vscode-focusBorder) 25%, var(--vscode-button-secondaryBackground)) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .todo-card-delete {
      background-color: color-mix(in srgb, var(--vscode-inputValidation-errorBackground, #f44) 30%, var(--vscode-button-secondaryBackground)) !important;
      color: var(--vscode-button-secondaryForeground) !important;
    }

    .cockpit-section-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0.45;
      transition: opacity 0.15s;
    }

    .board-column {
      container-type: inline-size;
    }

    .board-column:hover .cockpit-section-actions {
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
        padding: 8px 10px;
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
    <button type="button" class="tab-button tab-help-button active" data-tab="help" title="${escapeHtmlAttr(strings.tabHowTo)}">${escapeHtml(strings.tabHelpGlyph)}</button>
    <div class="tabs">
      <button type="button" class="tab-button" data-tab="todo-edit">${escapeHtml(strings.tabTodoEditor)}</button>
      <button type="button" class="tab-button" data-tab="board">${escapeHtml(strings.tabBoard)}</button>
      <span class="tab-group-sep"></span>
      <button type="button" class="tab-button" data-tab="create">${escapeHtml(strings.tabTaskEditor)}</button>
      <button type="button" class="tab-button" data-tab="list">${escapeHtml(strings.tabList)}</button>
      <span class="tab-group-sep"></span>
      <button type="button" class="tab-button" data-tab="jobs-edit">${escapeHtml(strings.tabJobsEditor)}</button>
      <button type="button" class="tab-button" data-tab="jobs">${escapeHtml(strings.tabJobs)}</button>
      <span class="tab-group-sep"></span>
      <button type="button" class="tab-button" data-tab="research">${escapeHtml(strings.tabResearch)}</button>
    </div>
    <div class="tab-actions">
      <button type="button" class="btn-secondary" id="jobs-show-sidebar-btn" style="display:none;">${escapeHtml(strings.jobsShowSidebar)}</button>
      <button type="button" class="tab-button tab-settings-button" data-tab="settings" title="${escapeHtmlAttr(strings.tabTelegram)}">&#9881;</button>
    </div>
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
              <label for="todo-labels-input">${escapeHtml(strings.boardFieldLabels)}</label>
              <div id="todo-label-chip-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>
              <div style="display:flex;gap:8px;align-items:center;">
                <input type="text" id="todo-labels-input" autocomplete="off" placeholder="${escapeHtmlAttr(strings.boardLabelInputPlaceholder)}" style="flex:1;">
                <input type="color" id="todo-label-color-input" value="#4f8cff" title="${escapeHtmlAttr(strings.boardLabelSaveColor)}" style="width:42px;padding:4px;">
                <button type="button" class="btn-secondary" id="todo-label-add-btn">${escapeHtml(strings.boardLabelAdd)}</button>
                <button type="button" class="btn-secondary" id="todo-label-color-save-btn">${escapeHtml(strings.boardLabelSaveColor)}</button>
              </div>
              <div id="todo-label-suggestions" class="label-suggestion-list"></div>
              <div id="todo-label-catalog" class="label-catalog-section"></div>
            </div>
            <div class="form-group" style="margin:0;">
              <label>${escapeHtml(strings.boardFieldFlags)}</label>
              <div id="todo-flag-current" style="min-height:24px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
              <div style="display:flex;gap:6px;align-items:center;margin-top:4px;margin-bottom:8px;">
                <input type="text" id="todo-flag-name-input" autocomplete="off" placeholder="New flag name..." style="flex:1;">
                <input type="color" id="todo-flag-color-input" value="#f59e0b" title="Flag color" style="width:42px;padding:4px;">
                <button type="button" class="btn-secondary" id="todo-flag-add-btn">${escapeHtml(strings.boardFlagAdd)}</button>
              </div>
              <div id="todo-flag-picker" class="flag-catalog-section"></div>
              <div class="note" style="margin-top:4px;">${escapeHtml(strings.boardFlagCatalogHint)}</div>
            </div>
            <div id="todo-linked-task-note" class="note">${escapeHtml(strings.boardTaskDraftNote)}</div>
            <div class="button-group" style="margin:0;">
              <button type="submit" class="btn-primary" id="todo-save-btn">${escapeHtml(strings.boardSaveCreate)}</button>
              <button type="button" class="btn-secondary" id="todo-create-task-btn">${escapeHtml(strings.boardCreateTask)}</button>
              <button type="button" class="btn-secondary" id="todo-approve-btn">${escapeHtml(strings.boardApproveTodo)}</button>
              <button type="button" class="btn-secondary" id="todo-finalize-btn">${escapeHtml(strings.boardFinalizeTodo)}</button>
              <button type="button" class="btn-secondary" id="todo-delete-btn">${escapeHtml(strings.boardDeleteTodo)}</button>
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
                  ${initialModels.length > 0 ? `<option value="">${escapeHtml(strings.placeholderSelectModel)}</option>` + initialModels.map((m) => `<option value="${escapeHtmlAttr(m.id || "")}">${escapeHtml(SchedulerWebview.formatModelLabel(m))}</option>`).join("") : `<option value="">${escapeHtml(strings.placeholderNoModels)}</option>`}
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
    <div id="board-filter-sticky" style="position:sticky;top:0;z-index:20;background:var(--vscode-sideBar-background);border-bottom:1px solid var(--vscode-panel-border);padding:8px 0 6px;margin-bottom:8px;">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;max-width:1600px;">
        <div class="form-group" style="margin:0;min-width:220px;flex:1 1 220px;">
          <label for="todo-search-input">${escapeHtml(strings.boardSearchLabel)}</label>
          <input type="text" id="todo-search-input" placeholder="${escapeHtmlAttr(strings.boardSearchPlaceholder)}">
        </div>
        <div class="form-group" style="margin:0;min-width:130px;">
          <label for="todo-section-filter">${escapeHtml(strings.boardSectionFilterLabel)}</label>
          <select id="todo-section-filter"></select>
        </div>
        <div class="form-group" style="margin:0;min-width:130px;">
          <label for="todo-label-filter">${escapeHtml(strings.boardLabelFilterLabel)}</label>
          <select id="todo-label-filter"></select>
        </div>
        <div class="form-group" style="margin:0;min-width:120px;">
          <label for="todo-priority-filter">${escapeHtml(strings.boardPriorityFilterLabel)}</label>
          <select id="todo-priority-filter"></select>
        </div>
        <div class="form-group" style="margin:0;min-width:120px;">
          <label for="todo-status-filter">${escapeHtml(strings.boardStatusFilterLabel)}</label>
          <select id="todo-status-filter"></select>
        </div>
        <div class="form-group" style="margin:0;min-width:140px;">
          <label for="todo-archive-outcome-filter">${escapeHtml(strings.boardArchiveOutcomeFilterLabel)}</label>
          <select id="todo-archive-outcome-filter"></select>
        </div>
        <div class="form-group" style="margin:0;min-width:130px;">
          <label for="todo-sort-by">${escapeHtml(strings.boardSortLabel)}</label>
          <select id="todo-sort-by"></select>
        </div>
        <div class="form-group" style="margin:0;min-width:110px;">
          <label for="todo-sort-direction">${escapeHtml(strings.boardSortAsc)}</label>
          <select id="todo-sort-direction"></select>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:6px;max-width:1600px;">
        <button type="button" class="btn-primary" id="todo-new-btn">${escapeHtml(strings.boardToolbarNew)}</button>
        <button type="button" class="btn-secondary" id="todo-clear-selection-btn">${escapeHtml(strings.boardToolbarClear)}</button>
        <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
          <input type="checkbox" id="todo-show-archived" style="margin:0;">
          ${escapeHtml(strings.boardShowArchived)}
        </label>
        <div class="board-col-width-group" style="margin-left:auto;">
          <label for="cockpit-col-slider">Column width</label>
          <input type="range" id="cockpit-col-slider" min="180" max="520" value="240" step="10">
        </div>
      </div>
    </div>
    <div id="board-summary" class="note"></div>
    <div class="note" style="margin-bottom:12px;">${escapeHtml(strings.boardDropHint)}</div>
    <div class="board-toolbar">
      <button type="button" class="btn-secondary" id="board-add-section-btn">+ Add Section</button>
      <div id="board-section-inline-form" style="display:none;align-items:center;gap:6px;">
        <input type="text" id="board-section-name-input" placeholder="Section name..." style="max-width:180px;">
        <button type="button" class="btn-primary" id="board-section-save-btn">Add</button>
        <button type="button" class="btn-secondary" id="board-section-cancel-btn">Cancel</button>
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
    <div id="jobs-empty-state" class="jobs-empty">${escapeHtml(strings.jobsSelectJob)}</div>
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
            <div class="section-title">Job details</div>
            <p class="note">Name the job, place it in a folder, and toggle whether it is active.</p>
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
            <div class="section-title">Schedule</div>
            <p class="note">Choose a preset, edit the cron expression, or use the friendly builder.</p>
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

          <section class="jobs-main-section jobs-editor-card is-wide">
            <div class="section-title">Workflow</div>
            <p class="note">Steps run in order. Pause checkpoints stop the job until you approve the previous result.</p>
            <div class="form-group wide">
              <label>${escapeHtml(strings.jobsCompactTimeline)}</label>
              <div id="jobs-timeline-inline" class="jobs-timeline-inline">${escapeHtml(strings.jobsTimelineEmpty)}</div>
            </div>
            <div class="form-group wide">
              <div class="section-title">${escapeHtml(strings.jobsSteps)}</div>
              <p class="note">${escapeHtml(strings.jobsDropHint)}</p>
              <div id="jobs-step-list" class="jobs-step-list"></div>
            </div>
          </section>

          <section class="jobs-main-section jobs-editor-card is-wide">
            <div class="section-title">Add to workflow</div>
            <p class="note">Use these quick actions to insert pause checkpoints, attach existing tasks, or create a brand new step.</p>
            <div class="jobs-action-grid">
              <div class="jobs-action-card">
                <div class="section-title">${escapeHtml(strings.jobsPauseTitle)}</div>
                <div class="jobs-inline-form">
                  <div class="form-group">
                    <label for="jobs-pause-name-input">${escapeHtml(strings.jobsPauseName)}</label>
                    <input type="text" id="jobs-pause-name-input" placeholder="${escapeHtmlAttr(strings.jobsPauseDefaultTitle)}">
                  </div>
                  <button type="button" class="btn-secondary" id="jobs-create-pause-btn">${escapeHtml(strings.jobsCreatePause)}</button>
                </div>
              </div>

              <div class="jobs-action-card">
                <div class="section-title">${escapeHtml(strings.jobsAddExistingTask)}</div>
                <div class="jobs-inline-form">
                  <div class="form-group">
                    <label for="jobs-existing-task-select">${escapeHtml(strings.jobsStandaloneTasks)}</label>
                    <select id="jobs-existing-task-select"></select>
                  </div>
                  <div class="form-group">
                    <label for="jobs-existing-window-input">${escapeHtml(strings.jobsWindowMinutes)}</label>
                    <input type="number" id="jobs-existing-window-input" min="1" max="1440" value="30">
                  </div>
                  <button type="button" class="btn-secondary" id="jobs-attach-btn">${escapeHtml(strings.jobsAttach)}</button>
                </div>
              </div>

              <div class="jobs-action-card jobs-action-card-wide">
                <div class="section-title">${escapeHtml(strings.jobsAddNewStep)}</div>
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
                  <div class="form-group">
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
    </div>
  </div>

  <div id="help-tab" class="tab-content active">
    <div class="help-panel">
      <div class="help-intro">
        <h2 class="help-intro-title">${escapeHtml(strings.helpIntroTitle)}</h2>
        <p class="help-intro-body">${escapeHtml(strings.helpIntroBody)}</p>
      </div>
      <div class="help-grid">
        <section class="help-section">
          <h3>${escapeHtml(strings.helpCreateTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpCreateItemName)}</li>
            <li>${escapeHtml(strings.helpCreateItemTemplates)}</li>
            <li>${escapeHtml(strings.helpCreateItemSkills)}</li>
            <li>${escapeHtml(strings.helpCreateItemAgentModel)}</li>
            <li>${escapeHtml(strings.helpCreateItemRunFirst)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpListTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpListItemSections)}</li>
            <li>${escapeHtml(strings.helpListItemActions)}</li>
            <li>${escapeHtml(strings.helpListItemStartup)}</li>
          </ul>
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
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpResearchTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpResearchItemProfiles)}</li>
            <li>${escapeHtml(strings.helpResearchItemBounds)}</li>
            <li>${escapeHtml(strings.helpResearchItemHistory)}</li>
          </ul>
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
      </div>
    </div>
  </div>
  
  <script nonce="${nonce}" id="initial-data" type="application/json">${serializeForWebview(initialData)}</script>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;

    return rawHtml;
  }
}
