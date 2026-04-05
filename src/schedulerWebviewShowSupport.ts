import { CopilotExecutor } from "./copilotExecutor";
import { runSchedulerCatalogRefreshTasks } from "./schedulerWebviewState";
import type { AgentInfo, ModelInfo, PromptTemplate, SkillReference } from "./types";

export function seedSchedulerWebviewCatalogFallbacks(options: {
  cachedAgents: AgentInfo[];
  cachedModels: ModelInfo[];
  setCachedAgents: (agents: AgentInfo[]) => void;
  setCachedModels: (models: ModelInfo[]) => void;
}): void {
  if (options.cachedAgents.length === 0) {
    options.setCachedAgents(CopilotExecutor.getBuiltInAgents());
  }
  if (options.cachedModels.length === 0) {
    options.setCachedModels(CopilotExecutor.getFallbackModels());
  }
}

export function runSchedulerWebviewBackgroundRefresh(options: {
  refreshAgentsAndModelsCache: () => Promise<void>;
  refreshPromptTemplatesCache: () => Promise<void>;
  refreshSkillReferencesCache: () => Promise<void>;
  getCachedAgents: () => AgentInfo[];
  getCachedModels: () => ModelInfo[];
  getCachedPromptTemplates: () => PromptTemplate[];
  getCachedSkillReferences: () => SkillReference[];
  postMessage: (message: unknown) => void;
  logError: (message: string, ...args: unknown[]) => void;
  sanitizeError: (details: string) => string;
}): void {
  runSchedulerCatalogRefreshTasks({
    tasks: [
      {
        refresh: options.refreshAgentsAndModelsCache,
        getMessages: () => [
          { type: "updateAgents", agents: options.getCachedAgents() },
          { type: "updateModels", models: options.getCachedModels() },
        ],
        errorPrefix: "[CopilotScheduler] Failed to refresh agents/models:",
      },
      {
        refresh: options.refreshPromptTemplatesCache,
        getMessages: () => [
          {
            type: "updatePromptTemplates",
            templates: options.getCachedPromptTemplates(),
          },
        ],
        errorPrefix: "[CopilotScheduler] Failed to refresh prompt templates:",
      },
      {
        refresh: options.refreshSkillReferencesCache,
        getMessages: () => [
          { type: "updateSkills", skills: options.getCachedSkillReferences() },
        ],
        errorPrefix: "[CopilotScheduler] Failed to refresh skills:",
      },
    ],
    postMessage: options.postMessage,
    logError: options.logError,
    sanitizeError: options.sanitizeError,
  });
}
