import * as vscode from "vscode";
import type {
  ExecutionDefaultsView,
  JobDefinition,
  JobFolder,
  PromptTemplate,
  ResearchProfile,
  ResearchRun,
  ReviewDefaultsView,
  ScheduledTask,
  StorageSettingsView,
  TelegramNotificationView,
} from "./types";
import type { AgentInfo, ModelInfo } from "./types";

type RenderHtml = (webview: vscode.Webview, tasks: ScheduledTask[], agents: AgentInfo[], models: ModelInfo[], promptTemplates: PromptTemplate[]) => string;

type ReplayPanelStateParams = {
  panel: vscode.WebviewPanel;
  tasks: ScheduledTask[];
  jobs: JobDefinition[];
  jobFolders: JobFolder[];
  cockpitBoard: unknown;
  telegramNotification: TelegramNotificationView;
  executionDefaults: ExecutionDefaultsView;
  reviewDefaults: ReviewDefaultsView;
  storageSettings: StorageSettingsView;
  researchProfiles: ResearchProfile[];
  activeResearchRun: ResearchRun | undefined;
  recentResearchRuns: ResearchRun[];
  agentListCache: AgentInfo[];
  modelListCache: ModelInfo[];
  templateCache: PromptTemplate[];
  resetReadyState: () => void;
  renderHtml: RenderHtml;
  updateTasks: (tasks: ScheduledTask[]) => void;
  updateJobs: (jobs: JobDefinition[]) => void;
  updateJobFolders: (folders: JobFolder[]) => void;
  updateCockpitBoard: (board: unknown) => void;
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
};

type RefreshLanguagePanelParams = {
  panel: vscode.WebviewPanel | undefined;
  tasks: ScheduledTask[];
  agentListCache: AgentInfo[];
  modelListCache: ModelInfo[];
  templateCache: PromptTemplate[];
  resetReadyState: () => void;
  renderHtml: RenderHtml;
  postCachedCatalogMessages: () => void;
  reloadCachesAndSync: (force?: boolean) => Promise<void>;
};

type RefreshCatalogCachesParams = {
  refreshAgentsAndModelsCache: (force: boolean) => Promise<void>;
  refreshPromptTemplatesCache: (force: boolean) => Promise<void>;
  refreshSkillReferencesCache: (force: boolean) => Promise<void>;
  resetAgentsAndModels: () => void;
  resetPromptTemplates: () => void;
  resetSkillReferences: () => void;
  panel: vscode.WebviewPanel | undefined;
  postCachedCatalogMessages: () => void;
  force: boolean;
};

export function replayExistingSchedulerWebviewPanel(
  params: ReplayPanelStateParams,
): void {
  params.resetReadyState();
  params.panel.webview.html = params.renderHtml(
    params.panel.webview,
    params.tasks,
    params.agentListCache,
    params.modelListCache,
    params.templateCache,
  );
  params.panel.reveal(vscode.ViewColumn.One);
  params.updateTasks(params.tasks);
  params.updateJobs(params.jobs);
  params.updateJobFolders(params.jobFolders);
  params.updateCockpitBoard(params.cockpitBoard);
  params.updateTelegramNotification(params.telegramNotification);
  params.updateExecutionDefaults(params.executionDefaults);
  params.updateReviewDefaults(params.reviewDefaults);
  params.updateStorageSettings(params.storageSettings);
  params.updateResearchState(
    params.researchProfiles,
    params.activeResearchRun,
    params.recentResearchRuns,
  );
  params.postCachedCatalogMessages();
}

export function refreshSchedulerWebviewLanguagePanel(
  params: RefreshLanguagePanelParams,
): void {
  if (!params.panel) {
    return;
  }

  params.resetReadyState();
  params.panel.webview.html = params.renderHtml(
    params.panel.webview,
    params.tasks,
    params.agentListCache,
    params.modelListCache,
    params.templateCache,
  );
  params.postCachedCatalogMessages();
  void params.reloadCachesAndSync(true).catch(() => {});
}

export async function refreshSchedulerCatalogCaches(
  params: RefreshCatalogCachesParams,
): Promise<void> {
  try {
    await params.refreshAgentsAndModelsCache(params.force);
  } catch {
    params.resetAgentsAndModels();
  }

  try {
    await params.refreshPromptTemplatesCache(params.force);
  } catch {
    params.resetPromptTemplates();
  }

  try {
    await params.refreshSkillReferencesCache(params.force);
  } catch {
    params.resetSkillReferences();
  }

  if (params.panel) {
    params.postCachedCatalogMessages();
  }
}
