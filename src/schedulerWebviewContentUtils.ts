import type {
  AgentInfo,
  ChatSessionBehavior,
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
  LogLevel,
  TelegramNotificationView,
} from "./types";

export function getWebviewNonce(): string {
  let text = "";
  const possible =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let index = 0; index < 32; index += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function serializeForWebview(value: unknown): string {
  const json = JSON.stringify(value ?? null) ?? "null";
  return json
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function escapeHtmlAttr(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function getModelSourceLabel(model: ModelInfo): string {
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

export function formatModelLabel(model: ModelInfo): string {
  const name = String(model.name || model.id || "").trim();
  const source = getModelSourceLabel(model);
  if (!source || source.toLowerCase() === name.toLowerCase()) {
    return name;
  }

  return `${name} • ${source}`;
}

type BuildSchedulerWebviewInitialDataParams = {
  initialTasks: ScheduledTask[];
  currentJobs: JobDefinition[];
  currentJobFolders: JobFolder[];
  currentCockpitBoard: CockpitBoard;
  currentTelegramNotification: TelegramNotificationView;
  currentExecutionDefaults: ExecutionDefaultsView;
  currentReviewDefaults: ReviewDefaultsView;
  currentStorageSettings: StorageSettingsView;
  currentResearchProfiles: ResearchProfile[];
  currentActiveResearchRun: ResearchRun | undefined;
  currentRecentResearchRuns: ResearchRun[];
  initialAgents: AgentInfo[];
  initialModels: ModelInfo[];
  initialTemplates: PromptTemplate[];
  cachedSkillReferences: SkillReference[];
  workspacePaths: string[];
  defaultJitterSeconds: number;
  defaultChatSession: ChatSessionBehavior;
  currentScheduleHistory: ScheduleHistoryEntry[];
  autoShowOnStartup: boolean;
  currentLogLevel: LogLevel;
  currentLogDirectory: string;
  configuredLanguage: string;
  locale: string;
  strings: Record<string, unknown>;
};

export function buildSchedulerWebviewInitialData(
  params: BuildSchedulerWebviewInitialDataParams,
): Record<string, unknown> {
  return {
    tasks: params.initialTasks,
    jobs: params.currentJobs,
    jobFolders: params.currentJobFolders,
    cockpitBoard: params.currentCockpitBoard,
    telegramNotification: params.currentTelegramNotification,
    executionDefaults: params.currentExecutionDefaults,
    reviewDefaults: params.currentReviewDefaults,
    storageSettings: params.currentStorageSettings,
    researchProfiles: params.currentResearchProfiles,
    activeResearchRun: params.currentActiveResearchRun,
    recentResearchRuns: params.currentRecentResearchRuns,
    agents: params.initialAgents,
    models: params.initialModels,
    promptTemplates: params.initialTemplates,
    skills: params.cachedSkillReferences,
    workspacePaths: params.workspacePaths,
    caseInsensitivePaths: process.platform === "win32",
    defaultJitterSeconds: params.defaultJitterSeconds,
    defaultChatSession: params.defaultChatSession,
    scheduleHistory: params.currentScheduleHistory,
    initialTab: "help",
    autoShowOnStartup: params.autoShowOnStartup,
    logLevel: params.currentLogLevel,
    logDirectory: params.currentLogDirectory,
    languageSetting: params.configuredLanguage,
    locale: params.locale,
    strings: params.strings,
  };
}
