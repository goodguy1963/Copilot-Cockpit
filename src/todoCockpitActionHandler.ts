import {
  COCKPIT_NEEDS_BOT_REVIEW_FLAG,
  COCKPIT_NEEDS_USER_REVIEW_FLAG,
  COCKPIT_FINAL_USER_CHECK_FLAG,
  COCKPIT_ON_SCHEDULE_LIST_FLAG,
  COCKPIT_READY_FLAG,
  getActiveCockpitWorkflowFlag,
  isProtectedCockpitFlagKey,
} from "./cockpitBoard";
import {
  addCockpitTodoComment,
  deleteCockpitTodoComment,
  addCockpitSection,
  approveCockpitTodo,
  createCockpitTodo,
  deleteCockpitFlagDefinition,
  deleteCockpitSection,
  deleteCockpitTodoLabelDefinition,
  finalizeCockpitTodo,
  getCockpitBoard,
  moveCockpitSection,
  moveCockpitTodo,
  purgeCockpitTodo,
  rejectCockpitTodo,
  renameCockpitSection,
  reorderCockpitSection,
  restoreCockpitTodo,
  saveCockpitFlagDefinition,
  saveCockpitTodoLabelDefinition,
  setCockpitBoardFilters,
  setCockpitBoardFiltersInBoard,
  updateCockpitTodo,
} from "./cockpitBoardManager";
import { SchedulerWebview } from "./cockpitWebview";
import type {
  AddCockpitTodoCommentInput,
  CockpitBoard,
  CockpitBoardFilters,
  CockpitTodoCard,
  CreateCockpitTodoInput,
  CreateTaskInput,
  ExecuteOptions,
  ReviewDefaultsView,
  ScheduledTask,
  TaskAction,
  UpdateCockpitBoardFiltersInput,
} from "./types";

function normalizeTodoFilterValue(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function matchesTodoSearchFilter(
  todo: Pick<CockpitTodoCard, "title" | "description" | "labels" | "flags">,
  searchText: string | undefined,
): boolean {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    todo.title || "",
    todo.description || "",
    ...(todo.labels || []),
    ...(todo.flags || []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function getRevealFiltersForCreatedTodo(
  filters: CockpitBoardFilters | undefined,
  todo: CockpitTodoCard,
): UpdateCockpitBoardFiltersInput | undefined {
  if (!filters) {
    return undefined;
  }

  const updates: UpdateCockpitBoardFiltersInput = {};
  let changed = false;

  if (!matchesTodoSearchFilter(todo, filters.searchText)) {
    updates.searchText = "";
    changed = true;
  }

  if (filters.sectionId && filters.sectionId !== todo.sectionId) {
    updates.sectionId = "";
    changed = true;
  }

  if (
    filters.labels.length > 0
    && !filters.labels.some((label) =>
      todo.labels.some(
        (todoLabel) =>
          normalizeTodoFilterValue(todoLabel) === normalizeTodoFilterValue(label),
      ),
    )
  ) {
    updates.labels = [];
    changed = true;
  }

  if (
    filters.priorities.length > 0
    && !filters.priorities.includes(todo.priority)
  ) {
    updates.priorities = [];
    changed = true;
  }

  if (
    filters.statuses.length > 0
    && !filters.statuses.includes(todo.status)
  ) {
    updates.statuses = [];
    changed = true;
  }

  if (filters.archiveOutcomes.length > 0) {
    updates.archiveOutcomes = [];
    changed = true;
  }

  if (
    filters.flags.length > 0
    && !filters.flags.some((flag) =>
      todo.flags.some(
        (todoFlag) =>
          normalizeTodoFilterValue(todoFlag) === normalizeTodoFilterValue(flag),
      ),
    )
  ) {
    updates.flags = [];
    changed = true;
  }

  return changed ? updates : undefined;
}

function areStringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function areCockpitBoardFiltersEqual(
  left: CockpitBoardFilters | undefined,
  right: CockpitBoardFilters | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (left.searchText ?? "") === (right.searchText ?? "")
    && areStringListsEqual(left.labels, right.labels)
    && areStringListsEqual(left.priorities, right.priorities)
    && areStringListsEqual(left.statuses, right.statuses)
    && areStringListsEqual(left.archiveOutcomes, right.archiveOutcomes)
    && areStringListsEqual(left.flags, right.flags)
    && (left.sectionId ?? "") === (right.sectionId ?? "")
    && left.sortBy === right.sortBy
    && left.sortDirection === right.sortDirection
    && left.viewMode === right.viewMode
    && left.showArchived === right.showArchived
    && left.showRecurringTasks === right.showRecurringTasks
    && left.hideCardDetails === right.hideCardDetails;
}

type TodoCockpitTaskAction = Extract<
  TaskAction["action"],
  | "createTodo"
  | "updateTodo"
  | "deleteTodo"
  | "purgeTodo"
  | "approveTodo"
  | "rejectTodo"
  | "finalizeTodo"
  | "archiveTodo"
  | "moveTodo"
  | "addTodoComment"
  | "deleteTodoComment"
  | "setTodoFilters"
  | "saveTodoLabelDefinition"
  | "deleteTodoLabelDefinition"
  | "saveTodoFlagDefinition"
  | "deleteTodoFlagDefinition"
  | "linkTodoTask"
  | "createTaskFromTodo"
  | "addCockpitSection"
  | "renameCockpitSection"
  | "deleteCockpitSection"
  | "moveCockpitSection"
  | "reorderCockpitSection"
>;

const TODO_COCKPIT_ACTIONS = new Set<TodoCockpitTaskAction>([
  "createTodo",
  "updateTodo",
  "deleteTodo",
  "purgeTodo",
  "approveTodo",
  "rejectTodo",
  "finalizeTodo",
  "archiveTodo",
  "moveTodo",
  "addTodoComment",
  "deleteTodoComment",
  "setTodoFilters",
  "saveTodoLabelDefinition",
  "deleteTodoLabelDefinition",
  "saveTodoFlagDefinition",
  "deleteTodoFlagDefinition",
  "linkTodoTask",
  "createTaskFromTodo",
  "addCockpitSection",
  "renameCockpitSection",
  "deleteCockpitSection",
  "moveCockpitSection",
  "reorderCockpitSection",
]);

type TodoPromptSource = {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  taskId?: string | null;
  comments?: Array<{ author?: string; body?: string }>;
};

type TodoCockpitActionHandlerDeps = {
  getPrimaryWorkspaceRootPath: () => string | undefined;
  getCurrentCockpitBoard: () => CockpitBoard;
  getCurrentTasks: () => ScheduledTask[];
  getReviewDefaults: () => ReviewDefaultsView;
  executeBotReviewPrompt: (prompt: string, options: ExecuteOptions) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<{ id: string; name: string }>;
  removeLabelFromAllTasks: (labelName: string) => Promise<unknown>;
  refreshSchedulerUiState: (immediate?: boolean) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  showError: (message: string) => void;
  noWorkspaceOpenMessage: string;
};

function getTodoWorkflowFlag(todo: Pick<CockpitTodoCard, "flags">): string | undefined {
  return getActiveCockpitWorkflowFlag(todo.flags);
}

const NEEDS_BOT_REVIEW_COMMENT_LABEL = "needs-bot-review-template";

function maybeSeedNeedsBotReviewCommentTemplate(
  workspaceRoot: string,
  todo: CockpitTodoCard,
  previousWorkflowFlag: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): void {
  const nextWorkflowFlag = getTodoWorkflowFlag(todo);
  if (
    nextWorkflowFlag !== COCKPIT_NEEDS_BOT_REVIEW_FLAG
    || nextWorkflowFlag === previousWorkflowFlag
  ) {
    return;
  }

  const template = deps.getReviewDefaults().needsBotReviewCommentTemplate.trim();
  if (!template) {
    return;
  }

  const comments = Array.isArray(todo.comments) ? todo.comments : [];
  const lastComment = comments.length > 0 ? comments[comments.length - 1] : undefined;
  const lastCommentLabels = Array.isArray(lastComment?.labels) ? lastComment.labels : [];
  const lastCommentIsTemplate = lastComment?.source === "system-event"
    && lastComment?.body?.trim() === template
    && lastCommentLabels.includes(NEEDS_BOT_REVIEW_COMMENT_LABEL);
  if (lastCommentIsTemplate) {
    return;
  }

  addCockpitTodoComment(workspaceRoot, todo.id, {
    body: template,
    author: "system",
    source: "system-event",
    labels: [NEEDS_BOT_REVIEW_COMMENT_LABEL],
  });
}

function buildTodoRecentCommentsText(todo: TodoPromptSource): string {
  return (todo.comments ?? [])
    .filter((comment) => comment?.body)
    .slice(-5)
    .map((comment) => `- ${comment.author || "system"}: ${comment.body}`)
    .join("\n") || "- none";
}

function buildTodoContextBlock(todo: TodoPromptSource): string {
  const sections: string[] = [
    `Todo title: ${todo.title || ""}`,
    `Todo description:\n${todo.description?.trim() || "(none)"}`,
    `Todo labels: ${(todo.labels ?? []).join(", ") || "none"}`,
    `Linked task: ${todo.taskId || "none"}`,
    `Recent coordination:\n${buildTodoRecentCommentsText(todo)}`,
  ];

  return sections.join("\n\n");
}

function buildMcpSkillGuidanceBlock(intent: "needs-bot-review" | "ready"): string {
  const baseLines = [
    "MCP and skill usage guidance:",
    "- Prefer the repo-local cockpit-scheduler-router and cockpit-todo-agent skills when they apply.",
    "- Treat Todo Cockpit cards and scheduled tasks as separate artifacts; do not conflate cockpit_ tools with scheduler_ tools.",
    "- If MCP tools are available, prefer cockpit_ and scheduler_ tools over editing repo-local JSON files by hand.",
    "- Confirm the required MCP tool exists before claiming a mutation or scheduler change succeeded.",
  ];

  if (intent === "needs-bot-review") {
    baseLines.push(
      "- This is a needs-bot-review handoff: stay in planning/review mode, research what is needed, and avoid pretending implementation or scheduling is complete.",
    );
  } else {
    baseLines.push(
      "- This is a ready handoff: prepare or refine the execution-ready draft, preserve the requested work, and reuse an existing linked task when it is still valid instead of creating duplicates.",
    );
  }

  return baseLines.join("\n");
}

function applyTodoPromptTemplate(
  todo: TodoPromptSource,
  template: string,
  intent: "needs-bot-review" | "ready",
): string {
  const labels = (todo.labels ?? []).join(", ") || "none";
  const recentComments = buildTodoRecentCommentsText(todo);
  const linkedTask = todo.taskId || "none";
  const todoContext = buildTodoContextBlock(todo);
  const mcpSkillGuidance = buildMcpSkillGuidanceBlock(intent);

  return template
    .replace(/\{\{title\}\}/g, todo.title || "")
    .replace(/\{\{description\}\}/g, todo.description?.trim() || "")
    .replace(/\{\{labels\}\}/g, labels)
    .replace(/\{\{recent_comments\}\}/g, recentComments)
    .replace(/\{\{linked_task\}\}/g, linkedTask)
    .replace(/\{\{todo_context\}\}/g, todoContext)
    .replace(/\{\{mcp_skill_guidance\}\}/g, mcpSkillGuidance)
    .trim();
}

async function maybeRunBotReviewPlanning(
  todo: CockpitTodoCard,
  previousWorkflowFlag: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): Promise<"skipped" | "launched" | "failed"> {
  const nextWorkflowFlag = getTodoWorkflowFlag(todo);
  if (
    nextWorkflowFlag !== COCKPIT_NEEDS_BOT_REVIEW_FLAG
    || previousWorkflowFlag === COCKPIT_NEEDS_BOT_REVIEW_FLAG
  ) {
    return "skipped";
  }

  const reviewDefaults = deps.getReviewDefaults();
  const promptTemplate = reviewDefaults.needsBotReviewPromptTemplate.trim();
  if (!promptTemplate) {
    return "skipped";
  }

  const prompt = applyTodoPromptTemplate(todo, promptTemplate, "needs-bot-review");
  if (!prompt) {
    return "skipped";
  }

  try {
    await deps.executeBotReviewPrompt(prompt, {
      agent: reviewDefaults.needsBotReviewAgent,
      model: reviewDefaults.needsBotReviewModel,
      chatSession: reviewDefaults.needsBotReviewChatSession,
    });
    return "launched";
  } catch (_error) {
    deps.notifyError("Todo saved, but the immediate bot review could not be started.");
    return "failed";
  }
}

export function isTodoCockpitAction(
  action: TaskAction["action"],
): action is TodoCockpitTaskAction {
  return TODO_COCKPIT_ACTIONS.has(action as TodoCockpitTaskAction);
}

export async function handleTodoCockpitAction(
  action: TaskAction,
  deps: TodoCockpitActionHandlerDeps,
): Promise<boolean> {
  if (!isTodoCockpitAction(action.action)) {
    return false;
  }

  switch (action.action) {
    case "createTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoData?.title) {
        deps.notifyError(deps.noWorkspaceOpenMessage);
        deps.showError(deps.noWorkspaceOpenMessage);
        return true;
      }
      const currentBoard = deps.getCurrentCockpitBoard();
      const result = createCockpitTodo(
        workspaceRoot,
        action.todoData as CreateCockpitTodoInput,
      );
      maybeSeedNeedsBotReviewCommentTemplate(workspaceRoot, result.todo, undefined, deps);
      const revealFilters = getRevealFiltersForCreatedTodo(
        currentBoard.filters,
        result.todo,
      );
      const botReviewLaunchState = await maybeRunBotReviewPlanning(
        result.todo,
        undefined,
        deps,
      );
      if (revealFilters) {
        setCockpitBoardFilters(workspaceRoot, revealFilters);
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.startCreateTodo();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(
        botReviewLaunchState === "launched"
          ? "Todo Cockpit item created and bot review started."
          : "Todo Cockpit item created.",
      );
      return true;
    }

    case "updateTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const previousTodo = deps.getCurrentCockpitBoard().cards.find((entry) => entry.id === action.todoId);
      const result = updateCockpitTodo(
        workspaceRoot,
        action.todoId,
        action.todoData ?? {},
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      maybeSeedNeedsBotReviewCommentTemplate(
        workspaceRoot,
        result.todo,
        previousTodo ? getTodoWorkflowFlag(previousTodo) : undefined,
        deps,
      );
      const botReviewLaunchState = await maybeRunBotReviewPlanning(
        result.todo,
        previousTodo ? getTodoWorkflowFlag(previousTodo) : undefined,
        deps,
      );
      deps.refreshSchedulerUiState();
      SchedulerWebview.startCreateTodo();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(
        botReviewLaunchState === "launched"
          ? `Updated Todo Cockpit item and started bot review: ${result.todo.title}`
          : `Updated Todo Cockpit item: ${result.todo.title}`,
      );
      return true;
    }

    case "deleteTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = rejectCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo("Todo Cockpit item rejected and archived.");
      return true;
    }

    case "purgeTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = purgeCockpitTodo(workspaceRoot, action.todoId);
      if (!result.deleted) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo("Todo Cockpit item permanently deleted.");
      return true;
    }

    case "approveTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = approveCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Approved Todo Cockpit item: ${result.todo.title}`);
      return true;
    }

    case "rejectTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = rejectCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Rejected Todo Cockpit item: ${result.todo.title}`);
      return true;
    }

    case "archiveTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const currentTodo = getCockpitBoard(workspaceRoot).cards.find((card) =>
        card.id === action.todoId,
      );
      if (!currentTodo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }

      const restoreRequested = (
        action.todoData as { archived?: boolean } | undefined
      )?.archived === false;
      const currentWorkflowFlag = getTodoWorkflowFlag(currentTodo);
      const result = restoreRequested
        ? restoreCockpitTodo(workspaceRoot, action.todoId)
        : (currentWorkflowFlag === COCKPIT_FINAL_USER_CHECK_FLAG
          ? finalizeCockpitTodo(workspaceRoot, action.todoId)
          : rejectCockpitTodo(workspaceRoot, action.todoId));
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(
        restoreRequested
          ? `Restored Todo Cockpit item: ${result.todo.title}`
          : (currentWorkflowFlag === COCKPIT_FINAL_USER_CHECK_FLAG
            ? `Completed Todo Cockpit item: ${result.todo.title}`
            : `Archived Todo Cockpit item: ${result.todo.title}`),
      );
      return true;
    }

    case "finalizeTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = finalizeCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Completed Todo Cockpit item: ${result.todo.title}`);
      return true;
    }

    case "moveTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = moveCockpitTodo(
        workspaceRoot,
        action.todoId,
        action.targetSectionId,
        action.targetOrder ?? 0,
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "addCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionTitle) {
        return true;
      }
      const result = addCockpitSection(workspaceRoot, action.sectionTitle);
      if (result.validationError) {
        deps.notifyError(result.validationError);
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "renameCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId || !action.sectionTitle) {
        return true;
      }
      const result = renameCockpitSection(workspaceRoot, action.sectionId, action.sectionTitle);
      if (result.validationError) {
        deps.notifyError(result.validationError);
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "deleteCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId) {
        return true;
      }
      deleteCockpitSection(workspaceRoot, action.sectionId);
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "moveCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId || !action.sectionDirection) {
        return true;
      }
      moveCockpitSection(workspaceRoot, action.sectionId, action.sectionDirection);
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "reorderCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || action.sectionId == null || action.targetIndex == null) {
        return true;
      }
      reorderCockpitSection(workspaceRoot, action.sectionId, action.targetIndex);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "addTodoComment": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId || !action.todoCommentData?.body) {
        return true;
      }
      const result = addCockpitTodoComment(
        workspaceRoot,
        action.todoId,
        action.todoCommentData as AddCockpitTodoCommentInput,
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "deleteTodoComment": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId || action.todoCommentIndex == null) {
        return true;
      }
      const result = deleteCockpitTodoComment(
        workspaceRoot,
        action.todoId,
        action.todoCommentIndex,
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "setTodoFilters": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot) {
        return true;
      }
      const filterUpdates =
        (action.todoFilters ?? {}) as UpdateCockpitBoardFiltersInput;
      const currentBoard = deps.getCurrentCockpitBoard();
      const nextBoard = setCockpitBoardFiltersInBoard(currentBoard, filterUpdates);
      if (areCockpitBoardFiltersEqual(currentBoard.filters, nextBoard.filters)) {
        return true;
      }
      const persistedBoard = setCockpitBoardFilters(
        workspaceRoot,
        filterUpdates,
      );
      void persistedBoard;
      deps.refreshSchedulerUiState(true);
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "saveTodoLabelDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoLabelData?.name) {
        return true;
      }
      const result = saveCockpitTodoLabelDefinition(
        workspaceRoot,
        action.todoLabelData,
      );
      if (!result.label) {
        deps.notifyError("Todo Cockpit label could not be saved.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "deleteTodoLabelDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoLabelData?.name) {
        return true;
      }
      deleteCockpitTodoLabelDefinition(workspaceRoot, action.todoLabelData.name);
      await deps.removeLabelFromAllTasks(action.todoLabelData.name);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "saveTodoFlagDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoFlagData?.name) {
        return true;
      }
      const result = saveCockpitFlagDefinition(
        workspaceRoot,
        action.todoFlagData,
      );
      if (!result.label) {
        deps.notifyError("Todo Cockpit flag could not be saved.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "deleteTodoFlagDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoFlagData?.name) {
        return true;
      }
      if (isProtectedCockpitFlagKey(action.todoFlagData.name)) {
        deps.notifyError("Built-in Todo Cockpit flags cannot be deleted.");
        return true;
      }
      deleteCockpitFlagDefinition(workspaceRoot, action.todoFlagData.name);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "linkTodoTask": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const currentTodo = deps.getCurrentCockpitBoard().cards.find((entry) => entry.id === action.todoId);
      const linkedTask = deps.getCurrentTasks().find((task) => task.id === action.linkedTaskId);
      const nextFlags = linkedTask?.enabled !== false
        ? [COCKPIT_ON_SCHEDULE_LIST_FLAG]
        : (currentTodo ? [getTodoWorkflowFlag(currentTodo) ?? COCKPIT_READY_FLAG] : undefined);
      const result = updateCockpitTodo(
        workspaceRoot,
        action.todoId,
        {
          taskId: action.linkedTaskId ?? null,
          flags: nextFlags,
        },
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "createTaskFromTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const board = deps.getCurrentCockpitBoard();
      const todo = board.cards.find((entry) => entry.id === action.todoId);
      if (!todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      if (getTodoWorkflowFlag(todo) !== COCKPIT_READY_FLAG) {
        deps.notifyError("Task drafts can only be created or refreshed from ready todos.");
        return true;
      }

      const existingTask = todo.taskId
        ? deps.getCurrentTasks().find((task) => task.id === todo.taskId)
        : undefined;
      if (existingTask) {
        if (existingTask.enabled !== false) {
          updateCockpitTodo(workspaceRoot, todo.id, {
            taskId: existingTask.id,
            flags: [COCKPIT_ON_SCHEDULE_LIST_FLAG],
          });
        }
        deps.refreshSchedulerUiState();
        SchedulerWebview.switchToTab("list");
        SchedulerWebview.focusTask(existingTask.id);
        deps.notifyInfo(`Reused linked task for Todo Cockpit: ${existingTask.name || todo.title}`);
        return true;
      }

      const createdTask = await deps.createTask({
        name: todo.title,
        description: todo.description,
        cronExpression: "0 9 * * 1-5",
        prompt: buildReadyTaskPromptFromTodo(todo, deps.getReviewDefaults()),
        enabled: false,
        oneTime: true,
        labels: Array.from(new Set([...(todo.labels ?? []), "from-todo-cockpit"])),
        scope: "workspace",
        promptSource: "inline",
      });
      updateCockpitTodo(workspaceRoot, todo.id, {
        taskId: createdTask.id,
        flags: [COCKPIT_READY_FLAG],
      });
      addCockpitTodoComment(workspaceRoot, todo.id, {
        body: `Linked task draft created: ${createdTask.name}.`,
        author: "system",
        source: "system-event",
        labels: ["task-draft"],
      });
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("list");
      SchedulerWebview.focusTask(createdTask.id);
      deps.notifyInfo(`Created scheduled task draft from Todo Cockpit: ${createdTask.name}`);
      return true;
    }
  }
}

function buildReadyTaskPromptFromTodo(
  taskSource: TodoPromptSource,
  reviewDefaults: ReviewDefaultsView,
): string {
  const promptTemplate = reviewDefaults.readyPromptTemplate.trim();
  if (promptTemplate) {
    return applyTodoPromptTemplate(taskSource, promptTemplate, "ready");
  }

  return [
    buildTodoContextBlock(taskSource),
    buildMcpSkillGuidanceBlock("ready"),
    "Analyze this Todo using the Todo Cockpit skill and implement what the user decided in the last comment or the latest bot recommendation. If there is no recent user comment, proceed with the bot's recommendation and update the Todo to the correct workflow state afterward.",
  ].join("\n\n");
}