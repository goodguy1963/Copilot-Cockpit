import type * as vscode from "vscode";
import type {
  AgentInfo,
  CockpitBoard,
  ExecutionDefaultsView,
  GitHubIntegrationView,
  JobDefinition,
  JobFolder,
  ModelInfo,
  PromptTemplate,
  ResearchProfile,
  ResearchRun,
  ReviewDefaultsView,
  ScheduleHistoryEntry,
  ScheduledTask,
  SkillReference,
  StorageSettingsView,
  TaskAction,
  TelegramNotificationView,
  VersionUpdateView,
} from "./types";
import {
  createDefaultExecutionDefaults,
  createEmptyGitHubIntegration,
  createDefaultReviewDefaults,
  createDefaultStorageSettings,
  createEmptyCockpitBoard,
  createEmptyTelegramNotification,
} from "./cockpitWebviewState";

export type SchedulerWebviewCatalogState = {
  agents: AgentInfo[];
  models: ModelInfo[];
  promptTemplates: PromptTemplate[];
  skillReferences: SkillReference[];
};

export type SchedulerWebviewRuntimeState = {
  extensionContext: vscode.ExtensionContext | undefined;
  extensionUri: vscode.Uri | undefined;
  tasks: ScheduledTask[];
  jobs: JobDefinition[];
  jobFolders: JobFolder[];
  cockpitBoard: CockpitBoard;
  githubIntegration: GitHubIntegrationView;
  telegramNotification: TelegramNotificationView;
  executionDefaults: ExecutionDefaultsView;
  reviewDefaults: ReviewDefaultsView;
  storageSettings: StorageSettingsView;
  versionInfo: VersionUpdateView | null;
  researchProfiles: ResearchProfile[];
  activeResearchRun: ResearchRun | undefined;
  recentResearchRuns: ResearchRun[];
  cockpitHistory: ScheduleHistoryEntry[];
  onTaskActionCallback: ((action: TaskAction) => void) | undefined;
  onTestPromptCallback:
    | ((prompt: string, agent?: string, model?: string) => void)
    | undefined;
};

type AssignSchedulerWebviewRuntimeStateParams = {
  extensionContext: vscode.ExtensionContext;
  extensionUri: vscode.Uri;
  tasks: ScheduledTask[];
  jobs: JobDefinition[];
  jobFolders: JobFolder[];
  cockpitBoard: CockpitBoard;
  githubIntegration: GitHubIntegrationView;
  telegramNotification: TelegramNotificationView;
  executionDefaults: ExecutionDefaultsView;
  reviewDefaults: ReviewDefaultsView;
  storageSettings: StorageSettingsView;
  researchProfiles: ResearchProfile[];
  activeResearchRun: ResearchRun | undefined;
  recentResearchRuns: ResearchRun[];
  onTaskAction: (action: TaskAction) => void;
  onTestPrompt?: (prompt: string, agent?: string, model?: string) => void;
};

export function createSchedulerWebviewCatalogState(): SchedulerWebviewCatalogState {
  return {
    agents: [],
    models: [],
    promptTemplates: [],
    skillReferences: [],
  };
}

export function createSchedulerWebviewRuntimeState(): SchedulerWebviewRuntimeState {
  return {
    extensionContext: undefined,
    extensionUri: undefined,
    tasks: [],
    jobs: [],
    jobFolders: [],
    cockpitBoard: createEmptyCockpitBoard(),
    githubIntegration: createEmptyGitHubIntegration(),
    telegramNotification: createEmptyTelegramNotification(),
    executionDefaults: createDefaultExecutionDefaults(),
    reviewDefaults: createDefaultReviewDefaults(),
    storageSettings: createDefaultStorageSettings(),
    versionInfo: null,
    researchProfiles: [],
    activeResearchRun: undefined,
    recentResearchRuns: [],
    cockpitHistory: [],
    onTaskActionCallback: undefined,
    onTestPromptCallback: undefined,
  };
}

export function assignSchedulerWebviewRuntimeState(
  state: SchedulerWebviewRuntimeState,
  params: AssignSchedulerWebviewRuntimeStateParams,
): void {
  state.extensionContext = params.extensionContext;
  state.extensionUri = params.extensionUri;
  state.tasks = params.tasks;
  state.jobs = params.jobs;
  state.jobFolders = params.jobFolders;
  state.cockpitBoard = params.cockpitBoard;
  state.githubIntegration = params.githubIntegration;
  state.telegramNotification = params.telegramNotification;
  state.executionDefaults = params.executionDefaults;
  state.reviewDefaults = params.reviewDefaults;
  state.storageSettings = params.storageSettings;
  state.researchProfiles = params.researchProfiles;
  state.activeResearchRun = params.activeResearchRun;
  state.recentResearchRuns = params.recentResearchRuns;
  state.onTaskActionCallback = params.onTaskAction;
  state.onTestPromptCallback = params.onTestPrompt;
}
