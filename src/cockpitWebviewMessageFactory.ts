import type {
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
import type { SchedulerWebviewMessage } from "./cockpitWebviewSupport";

export function createUpdateTasksMessage(
  tasks: ScheduledTask[],
): SchedulerWebviewMessage {
  return { type: "updateTasks", tasks };
}

export function createUpdateJobsMessage(
  jobs: JobDefinition[],
): SchedulerWebviewMessage {
  return { type: "updateJobs", jobs };
}

export function createUpdateJobFoldersMessage(
  jobFolders: JobFolder[],
): SchedulerWebviewMessage {
  return { type: "updateJobFolders", jobFolders };
}

export function createUpdateGitHubIntegrationMessage(
  githubIntegration: GitHubIntegrationView,
): SchedulerWebviewMessage {
  return {
    type: "updateGitHubIntegration",
    githubIntegration,
  };
}

export function createUpdateTelegramNotificationMessage(
  telegramNotification: TelegramNotificationView,
): SchedulerWebviewMessage {
  return {
    type: "updateTelegramNotification",
    telegramNotification,
  };
}

export function createUpdateExecutionDefaultsMessage(
  executionDefaults: ExecutionDefaultsView,
): SchedulerWebviewMessage {
  return {
    type: "updateExecutionDefaults",
    executionDefaults,
  };
}

export function createUpdateReviewDefaultsMessage(
  reviewDefaults: ReviewDefaultsView,
): SchedulerWebviewMessage {
  return {
    type: "updateReviewDefaults",
    reviewDefaults,
  };
}

export function createUpdateStorageSettingsMessage(
  storageSettings: StorageSettingsView,
): SchedulerWebviewMessage {
  return {
    type: "updateStorageSettings",
    storageSettings,
  };
}

export function createUpdateVersionInfoMessage(
  versionUpdate: VersionUpdateView,
): SchedulerWebviewMessage {
  return {
    type: "updateVersionInfo",
    versionUpdate,
  };
}

export function createUpdateResearchStateMessage(
  profiles: ResearchProfile[],
  activeRun: ResearchRun | undefined,
  recentRuns: ResearchRun[],
): SchedulerWebviewMessage {
  return {
    type: "updateResearchState",
    profiles,
    activeRun,
    recentRuns,
  };
}

export function createUpdateScheduleHistoryMessage(
  entries: ScheduleHistoryEntry[],
): SchedulerWebviewMessage {
  return {
    type: "updateScheduleHistory",
    entries,
  };
}

export function createSwitchToListMessage(
  successMessage?: string,
): SchedulerWebviewMessage {
  return {
    type: "switchToList",
    successMessage,
  };
}

export function createSwitchToTabMessage(
  tab: "create" | "list" | "jobs" | "board" | "research" | "settings" | "help",
): SchedulerWebviewMessage {
  return {
    type: "switchToTab",
    tab,
  };
}

export function createUpdateAutoShowOnStartupMessage(
  enabled: boolean,
): SchedulerWebviewMessage {
  return {
    type: "updateAutoShowOnStartup",
    enabled,
  };
}

export function createStartCreateTaskMessage(): SchedulerWebviewMessage {
  return { type: "startCreateTask" };
}

export function createStartCreateJobMessage(): SchedulerWebviewMessage {
  return { type: "startCreateJob" };
}

export function createFocusTaskMessage(taskId: string): SchedulerWebviewMessage {
  return {
    type: "focusTask",
    taskId,
  };
}

export function createFocusReadyTodoDraftMessage(todoId: string): SchedulerWebviewMessage {
  return {
    type: "focusReadyTodoDraft",
    todoId,
  };
}

export function createFocusJobMessage(
  jobId: string,
  folderId?: string,
): SchedulerWebviewMessage {
  return {
    type: "focusJob",
    jobId,
    folderId,
  };
}

export function createFocusResearchProfileMessage(
  researchId?: string,
): SchedulerWebviewMessage {
  return {
    type: "focusResearchProfile",
    researchId: researchId || "",
  };
}

export function createFocusResearchRunMessage(
  runId?: string,
): SchedulerWebviewMessage {
  return {
    type: "focusResearchRun",
    runId: runId || "",
  };
}

export function createEditTaskMessage(taskId: string): SchedulerWebviewMessage {
  return {
    type: "editTask",
    taskId,
  };
}

export function createShowErrorMessage(text: string): SchedulerWebviewMessage {
  return {
    type: "showError",
    text,
  };
}
