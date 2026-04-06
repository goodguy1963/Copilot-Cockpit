import type * as vscode from "vscode";
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
  ScheduleHistoryEntry,
  ScheduledTask,
  SkillReference,
  StorageSettingsView,
  TaskAction,
  TelegramNotificationView,
} from "./types";
import {
  createDefaultExecutionDefaults,
  createDefaultReviewDefaults,
  createDefaultStorageSettings,
  createEmptyCockpitBoard,
  createEmptyTelegramNotification,
} from "./copilotWebviewState";

export type SchedulerWebviewCatalogState = {
  agents: AgentInfo[];
  models: ModelInfo[];
  promptTemplates: PromptTemplate[];
  skillReferences: SkillReference[];
};

export type SchedulerWebviewRuntimeState = {
  extensionUri: vscode.Uri | undefined;
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
  copilotHistory: ScheduleHistoryEntry[];
  onTaskActionCallback: ((action: TaskAction) => void) | undefined;
  onTestPromptCallback:
    | ((prompt: string, agent?: string, model?: string) => void)
    | undefined;
};

type AssignSchedulerWebviewRuntimeStateParams = {
  extensionUri: vscode.Uri;
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
    extensionUri: undefined,
    tasks: [],
    jobs: [],
    jobFolders: [],
    cockpitBoard: createEmptyCockpitBoard(),
    telegramNotification: createEmptyTelegramNotification(),
    executionDefaults: createDefaultExecutionDefaults(),
    reviewDefaults: createDefaultReviewDefaults(),
    storageSettings: createDefaultStorageSettings(),
    researchProfiles: [],
    activeResearchRun: undefined,
    recentResearchRuns: [],
    copilotHistory: [],
    onTaskActionCallback: undefined,
    onTestPromptCallback: undefined,
  };
}

export function assignSchedulerWebviewRuntimeState(
  state: SchedulerWebviewRuntimeState,
  params: AssignSchedulerWebviewRuntimeStateParams,
): void {
  state.extensionUri = params.extensionUri;
  state.tasks = params.tasks;
  state.jobs = params.jobs;
  state.jobFolders = params.jobFolders;
  state.cockpitBoard = params.cockpitBoard;
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
