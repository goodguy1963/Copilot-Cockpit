import {
  createEditTaskMessage,
  createFocusJobMessage,
  createFocusResearchProfileMessage,
  createFocusResearchRunMessage,
  createFocusTaskMessage,
  createStartCreateJobMessage,
  createStartCreateTaskMessage,
  createSwitchToListMessage,
  createSwitchToTabMessage,
  createUpdateAutoShowOnStartupMessage,
} from "./cockpitWebviewMessageFactory";
import {
  refreshAgentsAndModels,
  refreshPromptTemplates,
  refreshSkillReferences,
} from "./cockpitWebviewTemplateCache";
import type {
  AgentInfo,
  JobDefinition,
  JobFolder,
  ModelInfo,
  PromptTemplate,
  ScheduledTask,
  SkillReference,
  TaskAction,
} from "./types";

type PostMessage = (message: { type: string; [key: string]: unknown }) => void;

export function postSwitchToList(postMessage: PostMessage, successMessage?: string): void {
  postMessage(createSwitchToListMessage(successMessage));
}

export function postSwitchToTab(
  postMessage: PostMessage,
  tab: "create" | "list" | "jobs" | "board" | "research" | "settings" | "help",
): void {
  postMessage(createSwitchToTabMessage(tab));
}

export function postAutoShowOnStartup(postMessage: PostMessage, enabled: boolean): void {
  postMessage(createUpdateAutoShowOnStartupMessage(enabled));
}

export function postStartCreateTask(postMessage: PostMessage): void {
  postMessage(createStartCreateTaskMessage());
}

export function postStartCreateJob(postMessage: PostMessage): void {
  postMessage(createStartCreateJobMessage());
}

export function postFocusTask(postMessage: PostMessage, taskId: string): void {
  if (!taskId) {
    return;
  }
  postMessage(createFocusTaskMessage(taskId));
}

export function postFocusJob(
  postMessage: PostMessage,
  jobId: string,
  folderId?: string,
): void {
  if (!jobId) {
    return;
  }
  postMessage(createFocusJobMessage(jobId, folderId));
}

export function postFocusResearchProfile(
  postMessage: PostMessage,
  researchId?: string,
): void {
  postMessage(createFocusResearchProfileMessage(researchId));
}

export function postFocusResearchRun(postMessage: PostMessage, runId?: string): void {
  postMessage(createFocusResearchRunMessage(runId));
}

export function postEditTask(postMessage: PostMessage, taskId?: string): void {
  if (!taskId) {
    return;
  }
  postMessage(createEditTaskMessage(taskId));
}

export function createSchedulerWebviewJobDialogContext(state: {
  currentJobs: JobDefinition[];
  currentJobFolders: JobFolder[];
  currentTasks: ScheduledTask[];
  onTaskActionCallback: ((action: TaskAction) => void) | undefined;
}): {
  currentJobs: JobDefinition[];
  currentJobFolders: JobFolder[];
  currentTasks: ScheduledTask[];
  onTaskActionCallback: ((action: TaskAction) => void) | undefined;
} {
  return {
    currentJobs: state.currentJobs,
    currentJobFolders: state.currentJobFolders,
    currentTasks: state.currentTasks,
    onTaskActionCallback: state.onTaskActionCallback,
  };
}

export async function refreshSchedulerAgentsAndModelsState(
  agentListCache: AgentInfo[],
  modelListCache: ModelInfo[],
  force = false,
): Promise<{ agents: AgentInfo[]; models: ModelInfo[] }> {
  return refreshAgentsAndModels(agentListCache, modelListCache, force);
}

export async function refreshSchedulerPromptTemplatesState(
  templateCache: PromptTemplate[],
  force = false,
): Promise<PromptTemplate[]> {
  return refreshPromptTemplates(templateCache, force);
}

export async function refreshSchedulerSkillReferencesState(
  cachedSkillReferences: SkillReference[],
  force = false,
): Promise<SkillReference[]> {
  return refreshSkillReferences(cachedSkillReferences, force);
}
