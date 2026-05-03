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
  TaskScope,
  TelegramNotificationView,
  VersionUpdateView,
} from "./types";

type WebviewScriptAsset = {
  relativeDir: readonly string[];
  fileName: string;
};

const WEBVIEW_SCRIPT_CACHE_ASSETS: readonly WebviewScriptAsset[] = [
  {
    relativeDir: ["media", "generated"],
    fileName: "cockpitWebview.loader.js",
  },
  {
    relativeDir: ["media", "generated"],
    fileName: "cockpitWebview.js",
  },
  {
    relativeDir: ["media"],
    fileName: "cockpitWebview.js",
  },
  {
    relativeDir: ["media"],
    fileName: "cockpitWebviewBoardState.js",
  },
  {
    relativeDir: ["media"],
    fileName: "cockpitWebviewBoardInteractions.js",
  },
];

function buildWebviewScriptCacheToken(extensionUri: vscode.Uri): string {
  const tokenParts: string[] = [];

  for (const asset of WEBVIEW_SCRIPT_CACHE_ASSETS) {
    try {
      const scriptPath = vscode.Uri.joinPath(
        extensionUri,
        ...asset.relativeDir,
        asset.fileName,
      );
      const scriptStats = fs.statSync(scriptPath.fsPath);
      tokenParts.push(`${asset.fileName}:${scriptStats.mtimeMs}-${scriptStats.size}`);
    } catch {
      // Skip unreadable files and fall back to any remaining bundled assets.
    }
  }

  return tokenParts.length > 0 ? tokenParts.join("|") : "static";
}

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
  currentGitHubIntegration: GitHubIntegrationView;
  currentTelegramNotification: TelegramNotificationView;
  currentExecutionDefaults: ExecutionDefaultsView;
  currentReviewDefaults: ReviewDefaultsView;
  currentStorageSettings: StorageSettingsView;
  currentVersionInfo: VersionUpdateView | null;
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
  configuredApprovalMode: string;
  configuredUpdateTrack: "stable" | "edge";
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
  const configuredApprovalMode = getCompatibleConfigurationValue<string>(
    "approvalMode",
    "default",
  );
  const configuredUpdateTrack = getCompatibleConfigurationValue<string>(
    "updateTrack",
    "stable",
    vscode.workspace.workspaceFolders?.[0]?.uri,
  ) === "edge"
    ? "edge"
    : "stable";
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
    currentGitHubIntegration: options.currentGitHubIntegration,
    currentTelegramNotification: options.currentTelegramNotification,
    currentExecutionDefaults: options.currentExecutionDefaults,
    currentReviewDefaults: options.currentReviewDefaults,
    currentStorageSettings: options.currentStorageSettings,
    currentVersionInfo: options.currentVersionInfo,
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
    "cockpitWebview.loader.js",
  );
  const scriptCacheToken = buildWebviewScriptCacheToken(options.extensionUri);
  const scriptUri = options.webview.asWebviewUri(scriptPath).with({
    query: `v=${encodeURIComponent(scriptCacheToken)}`,
  });

  return {
    nonce,
    uiLanguage,
    configuredLanguage,
    configuredApprovalMode,
    allPresets,
    strings,
    initialData,
    initialAgents,
    initialModels,
    configuredUpdateTrack,
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
  currentGitHubIntegration: GitHubIntegrationView;
  currentTelegramNotification: TelegramNotificationView;
  currentExecutionDefaults: ExecutionDefaultsView;
  currentReviewDefaults: ReviewDefaultsView;
  currentStorageSettings: StorageSettingsView;
  currentVersionInfo: VersionUpdateView | null;
  currentResearchProfiles: ResearchProfile[];
  currentActiveResearchRun: ResearchRun | undefined;
  currentRecentResearchRuns: ResearchRun[];
  cachedSkillReferences: SkillReference[];
  workspacePaths: string[];
  currentScheduleHistory: ScheduleHistoryEntry[];
}) {
  return createSchedulerWebviewRenderContext(options);
}

export const __testOnly = {
  buildWebviewScriptCacheToken,
};
