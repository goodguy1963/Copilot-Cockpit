import { loadPromptTemplateContent } from "./cockpitWebviewTemplateCache";
import type {
  SkillReference,
  PromptTemplate,
  TaskAction,
  WebviewToExtensionMessage,
} from "./types";
import type { AgentInfo, ModelInfo } from "./types";

type PostMessage = (message: { type: string; [key: string]: unknown }) => void;
type TaskActionCallback = ((action: TaskAction) => void) | undefined;

export async function handleSchedulerWebviewCoreMessage(
  message: WebviewToExtensionMessage,
  deps: {
    onTestPrompt?: (prompt: string, agent?: string, model?: string) => void;
    refreshAgentsAndModelsCache: (force?: boolean) => Promise<void>;
    refreshPromptTemplatesCache: (force?: boolean) => Promise<void>;
    refreshSkillReferencesCache: (force?: boolean) => Promise<void>;
    getCachedAgents: () => AgentInfo[];
    getCachedModels: () => ModelInfo[];
    getCachedPromptTemplates: () => PromptTemplate[];
    getCachedSkillReferences: () => SkillReference[];
    postMessage: PostMessage;
    onTaskAction: TaskActionCallback;
    setWebviewReady: (value: boolean) => void;
    drainQueuedMessages: () => void;
    handleTodoFileUploadRequest: () => Promise<void>;
  },
): Promise<boolean> {
  switch (message.type) {
    case "testPrompt":
      deps.onTestPrompt?.(message.prompt, message.agent, message.model);
      return true;

    case "refreshAgents":
      await deps.refreshAgentsAndModelsCache(true);
      deps.postMessage({
        type: "updateAgents",
        agents: deps.getCachedAgents(),
      });
      deps.postMessage({
        type: "updateModels",
        models: deps.getCachedModels(),
      });
      return true;

    case "refreshPrompts":
      await deps.refreshPromptTemplatesCache(true);
      await deps.refreshSkillReferencesCache(true);
      deps.postMessage({
        type: "updatePromptTemplates",
        templates: deps.getCachedPromptTemplates(),
      });
      deps.postMessage({
        type: "updateSkills",
        skills: deps.getCachedSkillReferences(),
      });
      return true;

    case "restoreScheduleHistory":
      deps.onTaskAction?.({
        action: "restoreHistory",
        taskId: "__history__",
        historyId: message.snapshotId,
      });
      return true;

    case "toggleAutoShowOnStartup":
      deps.onTaskAction?.({
        action: "refresh",
        taskId: "__toggleAutoShowOnStartup__",
      });
      return true;

    case "setupMcp":
    case "setupCodex":
    case "setupCodexSkills":
    case "syncBundledSkills":
    case "stageBundledAgents":
    case "syncBundledAgents":
    case "importStorageFromJson":
    case "exportStorageToJson":
      deps.onTaskAction?.({
        action: message.type,
        taskId: "__settings__",
      });
      return true;

    case "saveTelegramNotification":
      deps.onTaskAction?.({
        action: "saveTelegramNotification",
        taskId: "__settings__",
        telegramData: message.data,
      });
      return true;

    case "testTelegramNotification":
      deps.onTaskAction?.({
        action: "testTelegramNotification",
        taskId: "__settings__",
        telegramData: message.data,
      });
      return true;

    case "saveExecutionDefaults":
      deps.onTaskAction?.({
        action: "saveExecutionDefaults",
        taskId: "__settings__",
        executionDefaults: message.data,
      });
      return true;

    case "saveReviewDefaults":
      deps.onTaskAction?.({
        action: "saveReviewDefaults",
        taskId: "__settings__",
        reviewDefaults: message.data,
      });
      return true;

    case "loadPromptTemplate":
      await loadPromptTemplateContent(
        message.path,
        message.source,
        deps.getCachedPromptTemplates(),
        deps.postMessage,
      );
      return true;

    case "webviewReady":
      deps.setWebviewReady(true);
      deps.drainQueuedMessages();
      return true;

    case "requestTodoFileUpload":
      await deps.handleTodoFileUploadRequest();
      return true;

    default:
      return false;
  }
}
