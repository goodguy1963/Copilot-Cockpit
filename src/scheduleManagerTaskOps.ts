import {
  resolveGlobalPromptPath,
  resolveGlobalPromptsRoot,
  resolveLocalPromptPath,
} from "./promptResolver";
import type { CreateTaskInput, PromptSource, ScheduledTask } from "./types";

type NextRunResolver = (
  cronExpression: string,
  referenceTime: Date,
) => Date | undefined;

type MinuteTruncator = (date: Date) => Date;

const supportedPromptSources: readonly PromptSource[] = [
  "local",
  "global",
  "inline",
];

function isPromptSource(value: unknown): value is PromptSource {
  return supportedPromptSources.includes(value as PromptSource);
}

function inferPromptSourceFromPath(
  promptPath: string,
  workspaceRoots: readonly string[],
  configuredGlobalPromptsPath: string,
): PromptSource {
  if (promptPath.length === 0) {
    return "inline";
  }

  const promptScopes: Array<[PromptSource, boolean]> = [
    [
      "global",
      Boolean(
        resolveGlobalPromptPath(
          resolveGlobalPromptsRoot(configuredGlobalPromptsPath),
          promptPath,
        ),
      ),
    ],
    [
      "local",
      Boolean(resolveLocalPromptPath([...workspaceRoots], promptPath)),
    ],
  ];

  return promptScopes.find(([, matches]) => matches)?.[0] ?? "inline";
}

export function repairStoredTaskPromptSource(
  task: ScheduledTask,
  workspaceRoots: readonly string[],
  configuredGlobalPromptsPath: string,
): boolean {
  const promptPath = typeof task.promptPath === "string" ? task.promptPath.trim() : "";
  const inferredSource = inferPromptSourceFromPath(
    promptPath,
    workspaceRoots,
    configuredGlobalPromptsPath,
  );

  if (!isPromptSource(task.promptSource)) {
    task.promptSource = inferredSource;
    if (inferredSource === "inline" && promptPath.length === 0) {
      task.promptPath = undefined;
    }
    return true;
  }

  if (
    task.promptSource === "inline" &&
    promptPath.length > 0 &&
    inferredSource !== "inline"
  ) {
    task.promptSource = inferredSource;
    return true;
  }

  return false;
}

export function applyTaskPromptUpdates(
  tasks: ReadonlyMap<string, ScheduledTask>,
  updates: ReadonlyArray<{ id: string; prompt: string }>,
  changedAt: Date,
): number {
  let changedCount = 0;

  for (const update of updates) {
    if (typeof update?.id !== "string") {
      continue;
    }

    const promptText = typeof update.prompt === "string" ? update.prompt : "";
    if (promptText.trim().length === 0) {
      continue;
    }

    const task = tasks.get(update.id);
    if (!task || task.prompt === promptText) {
      continue;
    }

    task.prompt = promptText;
    task.updatedAt = changedAt;
    changedCount += 1;
  }

  return changedCount;
}

export function resolveCreatedTaskNextRun(params: {
  enabled: boolean;
  runFirstInOneMinute?: boolean;
  now: Date;
  firstRunDelayMinutes: number;
  cronExpression: string;
  truncateToMinute: MinuteTruncator;
  getNextRun: NextRunResolver;
}): Date | undefined {
  const {
    cronExpression,
    enabled,
    firstRunDelayMinutes,
    getNextRun,
    now,
    runFirstInOneMinute,
    truncateToMinute,
  } = params;

  if (!enabled) {
    return undefined;
  }

  if (runFirstInOneMinute) {
    const delayedStart = new Date(
      now.getTime() + firstRunDelayMinutes * 60 * 1000,
    );
    return truncateToMinute(delayedStart);
  }

  return getNextRun(cronExpression, now);
}

export function setTaskEnabledState(
  task: ScheduledTask,
  enabled: boolean,
  referenceTime: Date,
  getNextRun: NextRunResolver,
): void {
  task.enabled = enabled;
  task.nextRun = enabled ? getNextRun(task.cronExpression, referenceTime) : undefined;
}

export function createDuplicateTaskInput(
  original: ScheduledTask,
  copySuffix: string,
): CreateTaskInput {
  const suffix = copySuffix.trim();
  const name = suffix.length > 0 ? `${original.name} ${suffix}` : original.name;
  const recurringTask = original.oneTime !== true;

  return {
    name,
    cronExpression: original.cronExpression,
    prompt: original.prompt,
    enabled: false,
    agent: original.agent,
    model: original.model,
    scope: original.scope,
    oneTime: original.oneTime,
    manualSession: recurringTask ? original.manualSession : undefined,
    chatSession: recurringTask ? original.chatSession : undefined,
    labels: original.labels ? [...original.labels] : undefined,
    promptSource: original.promptSource,
    promptPath: original.promptPath,
    jitterSeconds: original.jitterSeconds,
  };
}

export function applyTaskUpdatesToTask(params: {
  task: ScheduledTask;
  updates: Partial<CreateTaskInput>;
  getPrimaryWorkspaceRoot: () => string | undefined;
  clampJitterSeconds: (value: unknown) => number;
  normalizeTaskManualSession: (
    manualSession: unknown,
    oneTime: boolean,
  ) => boolean | undefined;
  normalizeTaskChatSession: (
    chatSession: unknown,
    oneTime: boolean,
  ) => ScheduledTask["chatSession"];
  normalizeLabels: (labels: unknown) => string[] | undefined;
}): { cronChanged: boolean } {
  const {
    clampJitterSeconds,
    getPrimaryWorkspaceRoot,
    normalizeLabels,
    normalizeTaskChatSession,
    normalizeTaskManualSession,
    task,
    updates,
  } = params;

  let cronChanged = false;
  if (updates.name !== undefined) {
    task.name = updates.name;
  }
  if (updates.cronExpression !== undefined) {
    task.cronExpression = updates.cronExpression;
    cronChanged = true;
  }
  if (updates.prompt !== undefined) {
    task.prompt = updates.prompt;
  }
  if (updates.enabled !== undefined) {
    task.enabled = updates.enabled;
  }
  if (updates.agent !== undefined) {
    task.agent = updates.agent;
  }
  if (updates.model !== undefined) {
    task.model = updates.model;
  }

  const nextScope = updates.scope;
  if (nextScope !== undefined) {
    const workspaceRoot = getPrimaryWorkspaceRoot();
    if (task.scope !== nextScope) {
      task.scope = nextScope;
      task.workspacePath = nextScope === "workspace" ? workspaceRoot : undefined;
    } else if (nextScope === "workspace" && !task.workspacePath) {
      task.workspacePath = workspaceRoot;
    }
  }

  if (updates.promptSource !== undefined) {
    task.promptSource = updates.promptSource;
  }
  if (updates.promptPath !== undefined) {
    task.promptPath = updates.promptPath;
  }
  if (updates.jitterSeconds !== undefined) {
    task.jitterSeconds = clampJitterSeconds(updates.jitterSeconds);
  }
  if (updates.oneTime !== undefined) {
    task.oneTime = updates.oneTime;
  }

  const oneTimeExecution = task.oneTime === true;
  if (updates.manualSession !== undefined || updates.oneTime !== undefined) {
    const manualSessionValue =
      updates.manualSession !== undefined
        ? updates.manualSession
        : task.manualSession;
    task.manualSession = normalizeTaskManualSession(
      manualSessionValue,
      oneTimeExecution,
    );
  }
  if (updates.chatSession !== undefined || updates.oneTime !== undefined) {
    const chatSessionValue =
      updates.chatSession !== undefined ? updates.chatSession : task.chatSession;
    task.chatSession = normalizeTaskChatSession(
      chatSessionValue,
      oneTimeExecution,
    );
  }
  if (updates.labels !== undefined) {
    task.labels = normalizeLabels(updates.labels);
  }

  return { cronChanged };
}
