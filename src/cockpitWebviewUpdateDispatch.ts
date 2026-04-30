import { messages } from "./i18n";
import { createUpdateCockpitBoardMessage } from "./cockpitWebviewCockpitBridge";
import {
  createShowErrorMessage,
  createUpdateExecutionDefaultsMessage,
  createUpdateGitHubIntegrationMessage,
  createUpdateJobFoldersMessage,
  createUpdateJobsMessage,
  createUpdateResearchStateMessage,
  createUpdateReviewDefaultsMessage,
  createUpdateScheduleHistoryMessage,
  createUpdateStorageSettingsMessage,
  createUpdateTasksMessage,
  createUpdateTelegramNotificationMessage,
  createUpdateVersionInfoMessage,
} from "./cockpitWebviewMessageFactory";
import { postSchedulerCatalogMessages } from "./cockpitWebviewState";
import type {
  CockpitBoard,
  ExecutionDefaultsView,
  GitHubIntegrationView,
  JobDefinition,
  JobFolder,
  ResearchProfile,
  ResearchRun,
  ReviewDefaultsView,
  ScheduleHistoryEntry,
  ScheduledTask,
  StorageSettingsView,
  TelegramNotificationView,
  VersionUpdateView,
} from "./types";
import type {
  SchedulerWebviewCatalogState,
  SchedulerWebviewRuntimeState,
} from "./cockpitWebviewStateStore";

type PostMessage = (message: { type: string; [key: string]: unknown }) => void;

export function dispatchTaskUpdate(
  state: SchedulerWebviewRuntimeState,
  tasks: ScheduledTask[],
  postMessage: PostMessage,
): void {
  state.tasks = tasks;
  postMessage(createUpdateTasksMessage(tasks));
}

export function dispatchJobUpdate(
  state: SchedulerWebviewRuntimeState,
  jobs: JobDefinition[],
  postMessage: PostMessage,
): void {
  state.jobs = jobs;
  postMessage(createUpdateJobsMessage(jobs));
}

export function dispatchJobFolderUpdate(
  state: SchedulerWebviewRuntimeState,
  jobFolders: JobFolder[],
  postMessage: PostMessage,
): void {
  state.jobFolders = jobFolders;
  postMessage(createUpdateJobFoldersMessage(jobFolders));
}

export function dispatchCockpitBoardUpdate(
  state: SchedulerWebviewRuntimeState,
  cockpitBoard: CockpitBoard,
  postMessage: PostMessage,
): void {
  state.cockpitBoard = cockpitBoard;
  postMessage(createUpdateCockpitBoardMessage(cockpitBoard));
}

export function dispatchGitHubIntegrationUpdate(
  state: SchedulerWebviewRuntimeState,
  githubIntegration: GitHubIntegrationView,
  postMessage: PostMessage,
): void {
  state.githubIntegration = githubIntegration;
  postMessage(createUpdateGitHubIntegrationMessage(githubIntegration));
}

export function dispatchTelegramNotificationUpdate(
  state: SchedulerWebviewRuntimeState,
  telegramNotification: TelegramNotificationView,
  postMessage: PostMessage,
): void {
  state.telegramNotification = telegramNotification;
  postMessage(createUpdateTelegramNotificationMessage(telegramNotification));
}

export function dispatchExecutionDefaultsUpdate(
  state: SchedulerWebviewRuntimeState,
  executionDefaults: ExecutionDefaultsView,
  postMessage: PostMessage,
): void {
  state.executionDefaults = executionDefaults;
  postMessage(createUpdateExecutionDefaultsMessage(executionDefaults));
}

export function dispatchReviewDefaultsUpdate(
  state: SchedulerWebviewRuntimeState,
  reviewDefaults: ReviewDefaultsView,
  postMessage: PostMessage,
): void {
  state.reviewDefaults = reviewDefaults;
  postMessage(createUpdateReviewDefaultsMessage(reviewDefaults));
}

export function dispatchStorageSettingsUpdate(
  state: SchedulerWebviewRuntimeState,
  storageSettings: StorageSettingsView,
  postMessage: PostMessage,
): void {
  state.storageSettings = storageSettings;
  postMessage(createUpdateStorageSettingsMessage(storageSettings));
}

export function dispatchResearchStateUpdate(
  state: SchedulerWebviewRuntimeState,
  profiles: ResearchProfile[],
  activeRun: ResearchRun | undefined,
  recentRuns: ResearchRun[],
  postMessage: PostMessage,
): void {
  state.researchProfiles = profiles;
  state.activeResearchRun = activeRun;
  state.recentResearchRuns = recentRuns;
  postMessage(createUpdateResearchStateMessage(profiles, activeRun, recentRuns));
}

export function dispatchScheduleHistoryUpdate(
  state: SchedulerWebviewRuntimeState,
  entries: ScheduleHistoryEntry[],
  postMessage: PostMessage,
): void {
  state.cockpitHistory = entries;
  postMessage(createUpdateScheduleHistoryMessage(entries));
}

export function dispatchVersionInfoUpdate(
  state: SchedulerWebviewRuntimeState,
  versionUpdate: VersionUpdateView,
  postMessage: PostMessage,
): void {
  state.versionInfo = versionUpdate;
  postMessage(createUpdateVersionInfoMessage(versionUpdate));
}

export function dispatchWebviewError(
  errorMessage: string,
  postMessage: PostMessage,
  sanitizeError: (message: string) => string,
): void {
  const safe = sanitizeError(errorMessage);
  postMessage(createShowErrorMessage(safe || messages.webviewUnknown()));
}

export function dispatchCachedCatalogMessages(
  catalogState: SchedulerWebviewCatalogState,
  postMessage: PostMessage,
): void {
  postSchedulerCatalogMessages(postMessage, {
    agents: catalogState.agents,
    models: catalogState.models,
    promptTemplates: catalogState.promptTemplates,
    skillReferences: catalogState.skillReferences,
  });
}

