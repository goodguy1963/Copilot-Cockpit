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
  ReviewDefaultsStateView,
  ReviewDefaultsView,
  ScheduleHistoryEntry,
  ScheduledTask,
  StorageSettingsView,
  TelegramNotificationView,
} from "./types";
import type {
  SchedulerWebviewCatalogState,
  SchedulerWebviewRuntimeState,
} from "./cockpitWebviewStateStore";

type PostMessage = (message: { type: string; [key: string]: unknown }) => void;

// --- Generic dispatch helper ---
// For standard single-field state update + matching factory message.
function dispatchGeneric<T>(
  state: SchedulerWebviewRuntimeState,
  stateKey: keyof SchedulerWebviewRuntimeState,
  value: T,
  postMessage: PostMessage,
  createMessage: (value: T) => { type: string; [key: string]: unknown },
): void {
  (state as Record<string, unknown>)[stateKey as string] = value;
  postMessage(createMessage(value));
}

export function dispatchTaskUpdate(
  state: SchedulerWebviewRuntimeState,
  tasks: ScheduledTask[],
  postMessage: PostMessage,
): void {
  dispatchGeneric(state, "tasks", tasks, postMessage, createUpdateTasksMessage);
}

export function dispatchJobUpdate(
  state: SchedulerWebviewRuntimeState,
  jobs: JobDefinition[],
  postMessage: PostMessage,
): void {
  dispatchGeneric(state, "jobs", jobs, postMessage, createUpdateJobsMessage);
}

export function dispatchJobFolderUpdate(
  state: SchedulerWebviewRuntimeState,
  jobFolders: JobFolder[],
  postMessage: PostMessage,
): void {
  dispatchGeneric(state, "jobFolders", jobFolders, postMessage, createUpdateJobFoldersMessage);
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
  dispatchGeneric(state, "githubIntegration", githubIntegration, postMessage, createUpdateGitHubIntegrationMessage);
}

export function dispatchTelegramNotificationUpdate(
  state: SchedulerWebviewRuntimeState,
  telegramNotification: TelegramNotificationView,
  postMessage: PostMessage,
): void {
  dispatchGeneric(state, "telegramNotification", telegramNotification, postMessage, createUpdateTelegramNotificationMessage);
}

export function dispatchExecutionDefaultsUpdate(
  state: SchedulerWebviewRuntimeState,
  executionDefaults: ExecutionDefaultsView,
  postMessage: PostMessage,
): void {
  dispatchGeneric(state, "executionDefaults", executionDefaults, postMessage, createUpdateExecutionDefaultsMessage);
}

export function dispatchReviewDefaultsUpdate(
  state: SchedulerWebviewRuntimeState,
  reviewDefaults: ReviewDefaultsView,
  postMessage: PostMessage,
): void {
  const nextReviewDefaults: ReviewDefaultsStateView = {
    current: reviewDefaults,
    recommended: state.reviewDefaults.recommended,
  };
  state.reviewDefaults = nextReviewDefaults;
  postMessage(createUpdateReviewDefaultsMessage(nextReviewDefaults));
}

export function dispatchStorageSettingsUpdate(
  state: SchedulerWebviewRuntimeState,
  storageSettings: StorageSettingsView,
  postMessage: PostMessage,
): void {
  dispatchGeneric(state, "storageSettings", storageSettings, postMessage, createUpdateStorageSettingsMessage);
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
  dispatchGeneric(state, "cockpitHistory", entries, postMessage, createUpdateScheduleHistoryMessage);
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
