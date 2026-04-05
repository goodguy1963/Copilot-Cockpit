import type {
  AgentInfo,
  CockpitBoard,
  ExecutionDefaultsView,
  PromptTemplate,
  ReviewDefaultsView,
  SkillReference,
  StorageSettingsView,
  TelegramNotificationView,
  ModelInfo,
} from "./types";

export type SchedulerCatalogMessage = { type: string; [key: string]: unknown };

type SchedulerCatalogSnapshot = {
  agents: AgentInfo[];
  models: ModelInfo[];
  promptTemplates: PromptTemplate[];
  skillReferences: SkillReference[];
};

type SchedulerCatalogRefreshTask = {
  refresh: () => Promise<void>;
  getMessages: () => SchedulerCatalogMessage[];
  errorPrefix: string;
};

type RunSchedulerCatalogRefreshTasksParams = {
  tasks: SchedulerCatalogRefreshTask[];
  postMessage: (message: SchedulerCatalogMessage) => void;
  logError: (prefix: string, details: string) => void;
  sanitizeError: (details: string) => string;
};

export function createEmptyCockpitBoard(): CockpitBoard {
  return {
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
}

export function createEmptyTelegramNotification(): TelegramNotificationView {
  return {
    enabled: false,
    hasBotToken: false,
    hookConfigured: false,
  };
}

export function createDefaultExecutionDefaults(): ExecutionDefaultsView {
  return {
    agent: "agent",
    model: "",
  };
}

export function createDefaultReviewDefaults(): ReviewDefaultsView {
  return {
    spotReviewTemplate: "",
    botReviewPromptTemplate: "",
    botReviewAgent: "agent",
    botReviewModel: "",
    botReviewChatSession: "new",
  };
}

export function createDefaultStorageSettings(): StorageSettingsView {
  return {
    mode: "sqlite",
    sqliteJsonMirror: true,
    disabledSystemFlagKeys: [],
    appVersion: "",
    mcpSetupStatus: "workspace-required",
    lastMcpSupportUpdateAt: "",
    lastBundledSkillsSyncAt: "",
  };
}

export function buildSchedulerCatalogMessages(
  snapshot: SchedulerCatalogSnapshot,
): SchedulerCatalogMessage[] {
  return [
    {
      type: "updateAgents",
      agents: snapshot.agents,
    },
    {
      type: "updateModels",
      models: snapshot.models,
    },
    {
      type: "updatePromptTemplates",
      templates: snapshot.promptTemplates,
    },
    {
      type: "updateSkills",
      skills: snapshot.skillReferences,
    },
  ];
}

export function postSchedulerCatalogMessages(
  postMessage: (message: SchedulerCatalogMessage) => void,
  snapshot: SchedulerCatalogSnapshot,
): void {
  for (const message of buildSchedulerCatalogMessages(snapshot)) {
    postMessage(message);
  }
}

export function runSchedulerCatalogRefreshTasks(
  params: RunSchedulerCatalogRefreshTasksParams,
): void {
  for (const task of params.tasks) {
    void task
      .refresh()
      .then(() => {
        for (const message of task.getMessages()) {
          params.postMessage(message);
        }
      })
      .catch((error) => {
        const rawDetails =
          error instanceof Error ? error.message : String(error ?? "");
        params.logError(task.errorPrefix, params.sanitizeError(rawDetails));
      });
  }
}
