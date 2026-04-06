import * as fs from "fs";
import * as vscode from "vscode";
import { getConfiguredLanguage, getCurrentLanguage, getCurrentLocaleTag, getCronPresets } from "./i18n";
import { getCompatibleConfigurationValue } from "./extensionCompat";
import { getConfiguredLogLevel, getLogDirectoryPath } from "./logger";
import {
  buildSchedulerWebviewInitialData,
  getWebviewNonce,
  normalizeSchedulerWebviewJitterSeconds,
} from "./cockpitWebviewContentUtils";
import { buildSchedulerWebviewStrings } from "./cockpitWebviewStrings";
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
  TaskScope,
  TelegramNotificationView,
} from "./types";

export function createSchedulerWebviewRenderContext(options: {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  tasks: ScheduledTask[];
  agents: AgentInfo[];
  models: ModelInfo[];
  promptTemplates: PromptTemplate[];
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
  cachedSkillReferences: SkillReference[];
  workspacePaths: string[];
  currentScheduleHistory: ScheduleHistoryEntry[];
}): {
  nonce: string;
  uiLanguage: string;
  configuredLanguage: string;
  allPresets: ReturnType<typeof getCronPresets>;
  strings: ReturnType<typeof buildSchedulerWebviewStrings>;
  initialData: ReturnType<typeof buildSchedulerWebviewInitialData>;
  initialAgents: AgentInfo[];
  initialModels: ModelInfo[];
  defaultScope: TaskScope;
  defaultJitterSeconds: number;
  helpIntroTitleText: string;
  scriptUri: vscode.Uri;
} {
  const nonce = getWebviewNonce();
  const uiLanguage = getCurrentLanguage();
  const configuredLanguage = getConfiguredLanguage();
  const allPresets = getCronPresets();
  const defaultScope = getCompatibleConfigurationValue<TaskScope>(
    "defaultScope",
    "workspace",
  );
  const defaultChatSession = getCompatibleConfigurationValue<ChatSessionBehavior>(
    "chatSession",
    "new",
  );
  const defaultJitterSecondsRaw = getCompatibleConfigurationValue<number>(
    "jitterSeconds",
    600,
  );
  const defaultJitterSeconds = normalizeSchedulerWebviewJitterSeconds(
    defaultJitterSecondsRaw,
  );
  const initialTasks = Array.isArray(options.tasks) ? options.tasks : [];
  const initialAgents = Array.isArray(options.agents) ? options.agents : [];
  const initialModels = Array.isArray(options.models) ? options.models : [];
  const initialTemplates = Array.isArray(options.promptTemplates)
    ? options.promptTemplates
    : [];
  const strings = buildSchedulerWebviewStrings(uiLanguage);
  const initialData = buildSchedulerWebviewInitialData({
    initialTasks,
    currentJobs: options.currentJobs,
    currentJobFolders: options.currentJobFolders,
    currentCockpitBoard: options.currentCockpitBoard,
    currentTelegramNotification: options.currentTelegramNotification,
    currentExecutionDefaults: options.currentExecutionDefaults,
    currentReviewDefaults: options.currentReviewDefaults,
    currentStorageSettings: options.currentStorageSettings,
    currentResearchProfiles: options.currentResearchProfiles,
    currentActiveResearchRun: options.currentActiveResearchRun,
    currentRecentResearchRuns: options.currentRecentResearchRuns,
    initialAgents,
    initialModels,
    initialTemplates,
    cachedSkillReferences: options.cachedSkillReferences,
    workspacePaths: options.workspacePaths,
    defaultJitterSeconds,
    defaultChatSession,
    currentScheduleHistory: options.currentScheduleHistory,
    autoShowOnStartup: getCompatibleConfigurationValue<boolean>(
      "autoShowOnStartup",
      false,
      vscode.workspace.workspaceFolders?.[0]?.uri,
    ),
    currentLogLevel: getConfiguredLogLevel(),
    currentLogDirectory: getLogDirectoryPath(),
    configuredLanguage,
    locale: getCurrentLocaleTag(),
    strings,
  });
  const helpIntroTitle = typeof strings.helpIntroTitle === "string"
    ? strings.helpIntroTitle
    : "";
  const helpIntroTitleText =
    helpIntroTitle.replace(/^\s*🚀\s*/u, "").trim() || helpIntroTitle;

  const scriptPath = vscode.Uri.joinPath(
    options.extensionUri,
    "media",
    "generated",
    "cockpitWebview.js",
  );
  let scriptCacheToken = "static";
  try {
    const scriptStats = fs.statSync(scriptPath.fsPath);
    scriptCacheToken = `${scriptStats.mtimeMs}-${scriptStats.size}`;
  } catch {
    // Fall back to a stable token if the bundled file isn't readable.
  }
  const scriptUri = options.webview.asWebviewUri(scriptPath).with({
    query: `v=${encodeURIComponent(scriptCacheToken)}`,
  });

  return {
    nonce,
    uiLanguage,
    configuredLanguage,
    allPresets,
    strings,
    initialData,
    initialAgents,
    initialModels,
    defaultScope,
    defaultJitterSeconds,
    helpIntroTitleText,
    scriptUri,
  };
}

export function createSchedulerWebviewCurrentRenderContext(options: {
  extensionUri: vscode.Uri;
  webview: vscode.Webview;
  tasks: ScheduledTask[];
  agents: AgentInfo[];
  models: ModelInfo[];
  promptTemplates: PromptTemplate[];
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
  cachedSkillReferences: SkillReference[];
  workspacePaths: string[];
  currentScheduleHistory: ScheduleHistoryEntry[];
}) {
  return createSchedulerWebviewRenderContext(options);
}
