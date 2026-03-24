/**
 * Copilot Scheduler - Scheduler Webview
 * Provides GUI for task creation, editing, and listing
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { notifyError } from "./extension";
import type {
  ScheduledTask,
  ScheduleHistoryEntry,
  CreateTaskInput,
  JobDefinition,
  JobFolder,
  TaskAction,
  AgentInfo,
  ModelInfo,
  PromptTemplate,
  SkillReference,
  ChatSessionBehavior,
  TaskScope,
  WebviewToExtensionMessage,
} from "./types";
import { CopilotExecutor } from "./copilotExecutor";
import { messages, isJapanese, getCronPresets } from "./i18n";
import { logError } from "./logger";
import { validateTemplateLoadRequest } from "./templateValidation";
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
    onTaskAction: (action: TaskAction) => void,
    onTestPrompt?: (prompt: string, agent?: string, model?: string) => void,
  ): Promise<void> {
    this.extensionUri = extensionUri;
    this.currentTasks = tasks;
    this.currentJobs = jobs;
    this.currentJobFolders = jobFolders;
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

  static switchToTab(tab: "create" | "list" | "jobs" | "help"): void {
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

  /**
   * Handle messages from webview
   */
  private static async handleMessage(
    message: WebviewToExtensionMessage,
  ): Promise<void> {
    switch (message.type) {
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
    const config = vscode.workspace.getConfiguration("copilotScheduler");
    return resolveGlobalPromptsRoot(
      config.get<string>("globalPromptsPath", ""),
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
    const config = vscode.workspace.getConfiguration("copilotScheduler");
    const defaultScope = config.get<TaskScope>("defaultScope", "workspace");
    const defaultChatSession = config.get<ChatSessionBehavior>(
      "chatSession",
      "new",
    );
    const defaultJitterSecondsRaw = config.get<number>("jitterSeconds", 600);
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
      tabCreate: messages.tabCreate(),
      tabEdit: messages.tabEdit(),
      tabList: messages.tabList(),
      tabHowTo: messages.tabHowTo(),
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
      helpMcpItemTools: messages.helpMcpItemTools(),
      helpJobsTitle: messages.helpJobsTitle(),
      helpJobsItemBoard: messages.helpJobsItemBoard(),
      helpJobsItemPause: messages.helpJobsItemPause(),
      helpJobsItemLabels: messages.helpJobsItemLabels(),
      helpTipsTitle: messages.helpTipsTitle(),
      helpTipsItem1: messages.helpTipsItem1(),
      helpTipsItem2: messages.helpTipsItem2(),
      helpTipsItem3: messages.helpTipsItem3(),
      labelTaskName: messages.labelTaskName(),
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
      jobsCreateFolder: "New Folder",
      jobsCreateJob: "New Job",
      jobsRenameFolder: "Rename Folder",
      jobsDeleteFolder: "Delete Folder",
      jobsSelectJob: "Select a job to edit its workflow.",
      jobsName: "Job name",
      jobsCron: "Job schedule",
      jobsFolder: "Folder",
      jobsPaused: "Paused",
      jobsRunning: "Active",
      jobsSave: "Save Job",
      jobsDuplicate: "Duplicate Job",
      jobsDelete: "Delete Job",
      jobsPause: "Pause Job",
      jobsResume: "Resume Job",
      jobsSteps: "Workflow steps",
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
    const jobsScreenshotUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "images", "jobs-overview.png"),
    );
    const mcpScreenshotUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "images", "mcp-setup.png"),
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
      padding: 20px;
      color: var(--vscode-foreground);
      background-color: var(--vscode-editor-background);
    }
    
    .tabs {
      display: flex;
      gap: 0;
      margin-bottom: 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    
    .tab-button {
      padding: 10px 20px;
      border: none;
      background: transparent;
      color: var(--vscode-foreground);
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 14px;
    }
    
    .tab-button:hover {
      background-color: var(--vscode-list-hoverBackground);
    }
    
    .tab-button.active {
      border-bottom-color: var(--vscode-focusBorder);
      color: var(--vscode-textLink-foreground);
    }
    
    .tab-content {
      display: none;
    }
    
    .tab-content.active {
      display: block;
    }

    .help-panel {
      display: grid;
      gap: 14px;
    }

    .help-section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 12px;
      background-color: var(--vscode-editor-background);
    }

    .help-section h3 {
      margin: 0 0 8px 0;
      font-size: 13px;
    }

    .help-section p {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
      font-size: 13px;
    }

    .help-section ul {
      margin: 8px 0 0 18px;
      padding: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
      font-size: 13px;
    }

    .help-section li + li {
      margin-top: 6px;
    }

    .help-image {
      width: 100%;
      margin-top: 12px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background-color: var(--vscode-editorWidget-background);
    }
    
    .form-group {
      margin-bottom: 16px;
    }
    
    .form-group label {
      display: block;
      margin-bottom: 6px;
      font-weight: 500;
    }
    
    input[type="text"],
    input[type="number"],
    textarea,
    select {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border);
      background-color: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: 13px;
    }
    
    textarea {
      min-height: 120px;
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
      gap: 8px;
    }
    
    .checkbox-group input[type="checkbox"] {
      width: auto;
    }
    
    .button-group {
      display: flex;
      gap: 10px;
      margin-top: 20px;
    }
    
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 13px;
      font-family: inherit;
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
      padding: 6px 8px;
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
      gap: 6px;
      margin-bottom: 10px;
      flex-wrap: wrap;
      align-items: center;
    }

    .task-filter-select {
      min-width: 180px;
      max-width: 260px;
    }

    .task-filter-btn {
      padding: 4px 10px;
      font-size: 12px;
    }

    .task-filter-btn.active {
      background-color: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }

    .task-sections {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
      align-items: start;
    }

    .task-sections.filtered {
      grid-template-columns: 1fr;
    }

    .task-section {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 7px;
      background-color: var(--vscode-editor-background);
      min-width: 0;
    }

    .task-section-title {
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: var(--vscode-descriptionForeground);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .task-card {
      padding: 8px;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 4px;
      background-color: var(--vscode-editor-background);
      margin-bottom: 6px;
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
      align-items: center;
      margin-bottom: 6px;
    }

    .task-header-main {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .task-name {
      font-weight: 600;
      font-size: 13px;
    }
    
    .task-name.clickable, .task-status, .task-badge.clickable {
      cursor: pointer;
      transition: opacity 0.2s;
    }
    
    .task-name.clickable:hover, .task-status:hover, .task-badge.clickable:hover {
      opacity: 0.7;
    }
    
    .task-status {
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
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
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    
    .task-info span {
      margin-right: 10px;
    }

    .task-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 10px;
      background-color: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      margin-right: 0;
    }

    .task-badges {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 4px;
      margin-bottom: 4px;
    }

    .task-badge.label {
      background-color: var(--vscode-editorInfo-background);
      color: var(--vscode-editorInfo-foreground);
    }
    
    .task-prompt {
      padding: 6px;
      background-color: var(--vscode-textBlockQuote-background);
      border-radius: 4px;
      font-size: 11px;
      white-space: pre-wrap;
      max-height: 34px;
      overflow: hidden;
      margin-bottom: 4px;
    }
    
    .task-actions {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    
    .empty-state {
      text-align: center;
      padding: 14px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    @media (max-width: 920px) {
      .task-sections {
        grid-template-columns: 1fr;
      }
    }
    
    .radio-group {
      display: flex;
      gap: 16px;
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
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 12px;
      color: var(--vscode-foreground);
    }
    
    .inline-group {
      display: flex;
      gap: 16px;
    }
    
    .inline-group .form-group {
      flex: 1;
    }

    .template-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .template-row select {
      flex: 1;
      min-width: 0;
    }

    .friendly-cron {
      margin-top: 10px;
      padding: 12px;
      border: 1px dashed var(--vscode-panel-border);
      border-radius: 6px;
      background-color: var(--vscode-editorWidget-background);
    }

    .friendly-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .friendly-grid .form-group {
      flex: 1 1 160px;
      margin-bottom: 8px;
    }

    .friendly-field {
      display: none;
    }

    .friendly-field.visible {
      display: block;
    }

    .friendly-actions {
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 6px;
    }

    .cron-preview {
      margin-top: 8px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      flex-wrap: wrap;
    }

    .cron-preview strong {
      color: var(--vscode-foreground);
    }

    .note {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
      margin-bottom: 0;
    }

    .history-toolbar {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 8px;
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
      gap: 16px;
      align-items: start;
    }

    .jobs-sidebar,
    .jobs-main {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      background-color: var(--vscode-editor-background);
      padding: 12px;
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
      margin-top: 16px;
    }

    .jobs-list,
    .jobs-folder-list,
    .jobs-step-list {
      display: grid;
      gap: 8px;
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

    .jobs-folder-item.active,
    .jobs-list-item.active,
    .jobs-step-card.drag-over {
      border-color: var(--vscode-focusBorder);
      background-color: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
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

    .jobs-job-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .jobs-step-list {
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    }

    .jobs-step-card {
      min-height: 160px;
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

    @media (max-width: 980px) {
      .jobs-layout {
        grid-template-columns: 1fr;
      }

      .jobs-job-grid {
        grid-template-columns: 1fr;
      }
    }
  </style>
</head>
<body>
  <div class="tabs">
    <button type="button" class="tab-button active" data-tab="help">${escapeHtml(strings.tabHowTo)}</button>
    <button type="button" class="tab-button" data-tab="create">${escapeHtml(strings.tabCreate)}</button>
    <button type="button" class="tab-button" data-tab="list">${escapeHtml(strings.tabList)}</button>
    <button type="button" class="tab-button" data-tab="jobs">${escapeHtml(strings.tabJobs)}</button>
  </div>
  
  <div id="create-tab" class="tab-content">
    <form id="task-form">
      <div id="form-error" style="display:none; background:var(--vscode-inputValidation-errorBackground); color:var(--vscode-inputValidation-errorForeground); padding:8px 12px; border-radius:4px; margin-bottom:12px; font-size:13px;"></div>
      <input type="hidden" id="edit-task-id" value="">
      
      <div class="form-group">
        <label for="task-name">${escapeHtml(strings.labelTaskName)}</label>
        <input type="text" id="task-name" placeholder="${escapeHtmlAttr(strings.placeholderTaskName)}" required>
      </div>

      <div class="form-group">
        <label for="task-labels">${escapeHtml(strings.labelTaskLabels)}</label>
        <input type="text" id="task-labels" placeholder="${escapeHtmlAttr(strings.placeholderTaskLabels)}">
      </div>
      
      <div class="form-group">
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
      
      <div class="form-group" id="template-select-group" style="display: none;">
        <label for="template-select">${escapeHtml(strings.labelPrompt)}</label>
        <div class="template-row">
          <select id="template-select">
            <option value="">${escapeHtml(strings.placeholderSelectTemplate)}</option>
          </select>
          <button type="button" class="btn-secondary" id="template-refresh-btn">${escapeHtml(strings.actionRefresh)}</button>
        </div>
      </div>
      
      <div class="form-group" id="prompt-group">
        <label for="prompt-text">${escapeHtml(strings.labelPrompt)}</label>
        <textarea id="prompt-text" placeholder="${escapeHtmlAttr(strings.placeholderPrompt)}" required></textarea>
      </div>

      <div class="form-group" id="skill-select-group">
        <label for="skill-select">${escapeHtml(strings.labelSkills)}</label>
        <div class="template-row">
          <select id="skill-select">
            <option value="">${escapeHtml(strings.placeholderSelectSkill)}</option>
          </select>
          <button type="button" class="btn-secondary" id="insert-skill-btn">${escapeHtml(strings.actionInsertSkill)}</button>
        </div>
        <p class="note">${escapeHtml(strings.skillInsertNote)}</p>
      </div>
      
      <div class="form-group">
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
        <div class="friendly-cron">
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
      </div>
      
      <div class="inline-group">
        <div class="form-group">
          <label for="agent-select">${escapeHtml(strings.labelAgent)}</label>
          <select id="agent-select">
            ${initialAgents.length > 0 ? `<option value="">${escapeHtml(strings.placeholderSelectAgent)}</option>` + initialAgents.map((a) => `<option value="${escapeHtmlAttr(a.id || "")}">${escapeHtml(a.name || "")}</option>`).join("") : `<option value="">${escapeHtml(strings.placeholderNoAgents)}</option>`}
          </select>
        </div>
        
        <div class="form-group">
          <label for="model-select">${escapeHtml(strings.labelModel)}</label>
          <select id="model-select">
            ${initialModels.length > 0 ? `<option value="">${escapeHtml(strings.placeholderSelectModel)}</option>` + initialModels.map((m) => `<option value="${escapeHtmlAttr(m.id || "")}">${escapeHtml(m.name || "")}</option>`).join("") : `<option value="">${escapeHtml(strings.placeholderNoModels)}</option>`}
          </select>
          <p class="note">${escapeHtml(strings.labelModelNote)}</p>
        </div>
      </div>
      
      <div class="form-group">
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
      
      <div class="form-group">
        <div class="checkbox-group">
          <input type="checkbox" id="run-first">
          <label for="run-first">${escapeHtml(strings.labelRunFirstInOneMinute)}</label>
        </div>
      </div>

      <div class="form-group">
        <div class="checkbox-group">
          <input type="checkbox" id="one-time">
          <label for="one-time">${escapeHtml(strings.labelOneTime)}</label>
        </div>
      </div>

      <div class="form-group" id="chat-session-group">
        <label for="chat-session">${escapeHtml(strings.labelChatSession)}</label>
        <select id="chat-session">
          <option value="new">${escapeHtml(strings.labelChatSessionNew)}</option>
          <option value="continue">${escapeHtml(strings.labelChatSessionContinue)}</option>
        </select>
        <p class="note">${escapeHtml(strings.labelChatSessionRecurringOnly)}</p>
      </div>

      <div class="form-group">
        <label for="jitter-seconds">${escapeHtml(strings.labelJitterSeconds)}</label>
        <input type="number" id="jitter-seconds" min="0" max="1800" value="${escapeHtmlAttr(String(defaultJitterSeconds))}">
        <p class="note">${escapeHtml(strings.webviewJitterNote)}</p>
      </div>
      
      <div class="button-group">
        <button type="submit" class="btn-primary" id="submit-btn">${escapeHtml(strings.actionCreate)}</button>
        <button type="button" class="btn-secondary" id="new-task-btn" style="display:none;">${escapeHtml(strings.actionNewTask)}</button>
        <button type="button" class="btn-secondary" id="test-btn">${escapeHtml(strings.actionTestRun)}</button>
      </div>
    </form>
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

  <div id="jobs-tab" class="tab-content">
    <div class="jobs-layout">
      <aside class="jobs-sidebar">
        <div class="jobs-sidebar-section">
          <div class="section-title">${escapeHtml(strings.jobsFoldersTitle)}</div>
          <div class="jobs-toolbar">
            <button type="button" class="btn-secondary" id="jobs-new-folder-btn">${escapeHtml(strings.jobsCreateFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-rename-folder-btn">${escapeHtml(strings.jobsRenameFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-delete-folder-btn">${escapeHtml(strings.jobsDeleteFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-new-job-btn">${escapeHtml(strings.jobsCreateJob)}</button>
          </div>
          <div id="jobs-folder-list" class="jobs-folder-list"></div>
        </div>
        <div class="jobs-sidebar-section">
          <div class="section-title">${escapeHtml(strings.jobsTitle)}</div>
          <div id="jobs-list" class="jobs-list"></div>
        </div>
      </aside>

      <section class="jobs-main">
        <div id="jobs-empty-state" class="jobs-empty">${escapeHtml(strings.jobsSelectJob)}</div>
        <div id="jobs-details" style="display:none;">
          <div class="jobs-job-toolbar">
            <button type="button" class="btn-primary" id="jobs-save-btn">${escapeHtml(strings.jobsSave)}</button>
            <button type="button" class="btn-secondary" id="jobs-duplicate-btn">${escapeHtml(strings.jobsDuplicate)}</button>
            <button type="button" class="btn-secondary" id="jobs-pause-btn">${escapeHtml(strings.jobsPause)}</button>
            <button type="button" class="btn-danger" id="jobs-delete-btn">${escapeHtml(strings.jobsDelete)}</button>
          </div>

          <div class="jobs-main-section jobs-job-grid">
            <div class="form-group">
              <label for="jobs-name-input">${escapeHtml(strings.jobsName)}</label>
              <input type="text" id="jobs-name-input">
            </div>
            <div class="form-group">
              <label for="jobs-cron-input">${escapeHtml(strings.jobsCron)}</label>
              <input type="text" id="jobs-cron-input" placeholder="${escapeHtmlAttr(strings.placeholderCron)}">
            </div>
            <div class="form-group">
              <label for="jobs-folder-select">${escapeHtml(strings.jobsFolder)}</label>
              <select id="jobs-folder-select"></select>
            </div>
            <div class="form-group">
              <label>${escapeHtml(strings.labelStatus)}</label>
              <div id="jobs-status-pill" class="jobs-pill">${escapeHtml(strings.jobsRunning)}</div>
            </div>
          </div>

          <div class="jobs-main-section">
            <div class="section-title">${escapeHtml(strings.jobsSteps)}</div>
            <p class="note">${escapeHtml(strings.jobsDropHint)}</p>
            <div id="jobs-step-list" class="jobs-step-list"></div>
          </div>

          <div class="jobs-main-section">
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

          <div class="jobs-main-section">
            <div class="section-title">${escapeHtml(strings.jobsAddNewStep)}</div>
            <div class="jobs-inline-form">
              <div class="form-group">
                <label for="jobs-step-name-input">${escapeHtml(strings.jobsStepName)}</label>
                <input type="text" id="jobs-step-name-input">
              </div>
              <div class="form-group">
                <label for="jobs-step-window-input">${escapeHtml(strings.jobsWindowMinutes)}</label>
                <input type="number" id="jobs-step-window-input" min="1" max="1440" value="30">
              </div>
              <div class="form-group" style="flex-basis:100%;">
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
              <button type="button" class="btn-primary" id="jobs-create-step-btn">${escapeHtml(strings.jobsCreateStep)}</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>

  <div id="help-tab" class="tab-content active">
    <div class="help-panel">
      <section class="help-section">
        <h3>${escapeHtml(strings.helpIntroTitle)}</h3>
        <p>${escapeHtml(strings.helpIntroBody)}</p>
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
        <h3>${escapeHtml(strings.helpStorageTitle)}</h3>
        <ul>
          <li>${escapeHtml(strings.helpStorageItemRepo)}</li>
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
        <h3>${escapeHtml(strings.helpJobsTitle)}</h3>
        <ul>
          <li>${escapeHtml(strings.helpJobsItemBoard)}</li>
          <li>${escapeHtml(strings.helpJobsItemPause)}</li>
          <li>${escapeHtml(strings.helpJobsItemLabels)}</li>
        </ul>
        <img class="help-image" src="${jobsScreenshotUri}" alt="Jobs overview">
      </section>
      <section class="help-section">
        <h3>${escapeHtml(strings.helpMcpTitle)}</h3>
        <ul>
          <li>${escapeHtml(strings.helpMcpItemEmbedded)}</li>
          <li>${escapeHtml(strings.helpMcpItemConfig)}</li>
          <li>${escapeHtml(strings.helpMcpItemAutoConfig)}</li>
          <li>${escapeHtml(strings.helpMcpItemTools)}</li>
        </ul>
        <div class="button-group" style="margin-top:12px;">
          <button type="button" class="btn-primary" id="setup-mcp-btn">${escapeHtml(strings.actionSetupMcp)}</button>
        </div>
        <img class="help-image" src="${mcpScreenshotUri}" alt="MCP setup">
      </section>
      <section class="help-section">
        <h3>${escapeHtml(strings.helpTipsTitle)}</h3>
        <ul>
          <li>${escapeHtml(strings.helpTipsItem1)}</li>
          <li>${escapeHtml(strings.helpTipsItem2)}</li>
          <li>${escapeHtml(strings.helpTipsItem3)}</li>
        </ul>
      </section>
    </div>
  </div>
  
  <script nonce="${nonce}" id="initial-data" type="application/json">${serializeForWebview(initialData)}</script>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;

    return rawHtml;
  }
}
