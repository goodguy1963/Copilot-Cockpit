import * as vscode from "vscode";
import type {
  AgentInfo,
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
  StorageSettingsView,
  TelegramNotificationView,
  WebviewToExtensionMessage,
} from "./types";
import { messages } from "./i18n";
import { logError } from "./logger";
import { createSchedulerWebviewPanel } from "./schedulerWebviewPanelSupport";
import { replayExistingSchedulerWebviewPanel } from "./schedulerWebviewRenderSupport";

type RenderSchedulerHtml = (
  webview: vscode.Webview,
  tasks: ScheduledTask[],
  agents: AgentInfo[],
  models: ModelInfo[],
  promptTemplates: PromptTemplate[],
) => string;

export function replaySchedulerPanel(options: {
  panel: vscode.WebviewPanel;
  tasks: ScheduledTask[];
  jobs: JobDefinition[];
  jobFolders: JobFolder[];
  cockpitBoard: CockpitBoard;
  telegramNotification: TelegramNotificationView;
  executionDefaults: ExecutionDefaultsView;
  reviewDefaults: ReviewDefaultsView;
  storageSettings: StorageSettingsView;
  researchProfiles: ResearchProfile[];
  activeResearchRun: ResearchRun | undefined;
  recentResearchRuns: ResearchRun[];
  cachedAgents: AgentInfo[];
  cachedModels: ModelInfo[];
  cachedPromptTemplates: PromptTemplate[];
  resetReadyState: () => void;
  renderHtml: RenderSchedulerHtml;
  updateTasks: (tasks: ScheduledTask[]) => void;
  updateJobs: (jobs: JobDefinition[]) => void;
  updateJobFolders: (jobFolders: JobFolder[]) => void;
  updateCockpitBoard: (board: CockpitBoard) => void;
  updateTelegramNotification: (notification: TelegramNotificationView) => void;
  updateExecutionDefaults: (defaults: ExecutionDefaultsView) => void;
  updateReviewDefaults: (defaults: ReviewDefaultsView) => void;
  updateStorageSettings: (settings: StorageSettingsView) => void;
  updateResearchState: (
    profiles: ResearchProfile[],
    activeRun: ResearchRun | undefined,
    recentRuns: ResearchRun[],
  ) => void;
  postCachedCatalogMessages: () => void;
}): void {
  replayExistingSchedulerWebviewPanel({
    panel: options.panel,
    tasks: options.tasks,
    jobs: options.jobs,
    jobFolders: options.jobFolders,
    cockpitBoard: options.cockpitBoard,
    telegramNotification: options.telegramNotification,
    executionDefaults: options.executionDefaults,
    reviewDefaults: options.reviewDefaults,
    storageSettings: options.storageSettings,
    researchProfiles: options.researchProfiles,
    activeResearchRun: options.activeResearchRun,
    recentResearchRuns: options.recentResearchRuns,
    cachedAgents: options.cachedAgents,
    cachedModels: options.cachedModels,
    cachedPromptTemplates: options.cachedPromptTemplates,
    resetReadyState: options.resetReadyState,
    renderHtml: options.renderHtml,
    updateTasks: options.updateTasks,
    updateJobs: options.updateJobs,
    updateJobFolders: options.updateJobFolders,
    updateCockpitBoard: (board) =>
      options.updateCockpitBoard(board as CockpitBoard),
    updateTelegramNotification: options.updateTelegramNotification,
    updateExecutionDefaults: options.updateExecutionDefaults,
    updateReviewDefaults: options.updateReviewDefaults,
    updateStorageSettings: options.updateStorageSettings,
    updateResearchState: options.updateResearchState,
    postCachedCatalogMessages: options.postCachedCatalogMessages,
  });
}

export function createFreshSchedulerPanel(options: {
  extensionUri: vscode.Uri;
  tasks: ScheduledTask[];
  cachedAgents: AgentInfo[];
  cachedModels: ModelInfo[];
  cachedPromptTemplates: PromptTemplate[];
  renderHtml: RenderSchedulerHtml;
  handleMessage: (message: WebviewToExtensionMessage) => Promise<void>;
  sanitizeErrorDetailsForUser: (message: string) => string;
  showError: (message: string) => void;
  onDidDispose: () => void;
}): vscode.WebviewPanel {
  return createSchedulerWebviewPanel({
    extensionUri: options.extensionUri,
    title: messages.webviewTitle(),
    renderHtml: (webview) =>
      options.renderHtml(
        webview,
        options.tasks,
        options.cachedAgents,
        options.cachedModels,
        options.cachedPromptTemplates,
      ),
    onDidReceiveMessage: async (message: WebviewToExtensionMessage) => {
      try {
        await options.handleMessage(message);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error ?? "");
        const detailsForLog =
          options.sanitizeErrorDetailsForUser(errorMessage);
        const detailsForUser =
          options.sanitizeErrorDetailsForUser(errorMessage);
        logError("[CopilotScheduler] Webview message handling failed:", {
          type: (message as { type?: unknown } | undefined)?.type,
          error: detailsForLog,
        });
        options.showError(
          messages.webviewMessageHandlingFailed(
            detailsForUser || messages.webviewUnknown(),
          ),
        );
      }
    },
    onDidDispose: options.onDidDispose,
  });
}
