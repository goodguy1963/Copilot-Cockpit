import {
  addCockpitTodoComment,
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
import { SchedulerWebview } from "./schedulerWebview";
import type {
  AddCockpitTodoCommentInput,
  CockpitBoard,
  CockpitBoardFilters,
  CockpitTodoCard,
  CreateCockpitTodoInput,
  CreateTaskInput,
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
  comments?: Array<{ author?: string; body?: string }>;
};

type TodoCockpitActionHandlerDeps = {
  getPrimaryWorkspaceRootPath: () => string | undefined;
  getCurrentCockpitBoard: () => CockpitBoard;
  createTask: (input: CreateTaskInput) => Promise<{ id: string; name: string }>;
  removeLabelFromAllTasks: (labelName: string) => Promise<unknown>;
  refreshSchedulerUiState: () => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  showError: (message: string) => void;
  noWorkspaceOpenMessage: string;
};

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
      const revealFilters = getRevealFiltersForCreatedTodo(
        currentBoard.filters,
        result.todo,
      );
      if (revealFilters) {
        setCockpitBoardFilters(workspaceRoot, revealFilters);
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.startCreateTodo();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo("Todo Cockpit item created.");
      return true;
    }

    case "updateTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = updateCockpitTodo(
        workspaceRoot,
        action.todoId,
        action.todoData ?? {},
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.startCreateTodo();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Updated Todo Cockpit item: ${result.todo.title}`);
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
      const result = restoreRequested
        ? restoreCockpitTodo(workspaceRoot, action.todoId)
        : (currentTodo.status === "ready"
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
          : (currentTodo.status === "ready"
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
      addCockpitSection(workspaceRoot, action.sectionTitle);
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "renameCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId || !action.sectionTitle) {
        return true;
      }
      renameCockpitSection(workspaceRoot, action.sectionId, action.sectionTitle);
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
      SchedulerWebview.updateCockpitBoard(persistedBoard);
      deps.refreshSchedulerUiState();
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
      deleteCockpitFlagDefinition(workspaceRoot, action.todoFlagData.name);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "linkTodoTask": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = updateCockpitTodo(
        workspaceRoot,
        action.todoId,
        { taskId: action.linkedTaskId ?? null },
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

      const createdTask = await deps.createTask({
        name: todo.title,
        description: todo.description,
        cronExpression: "0 9 * * 1-5",
        prompt: buildTaskPromptFromTodo(todo),
        enabled: false,
        oneTime: true,
        labels: Array.from(new Set([...(todo.labels ?? []), "from-todo-cockpit"])),
        scope: "workspace",
        promptSource: "inline",
      });
      updateCockpitTodo(workspaceRoot, todo.id, { taskId: createdTask.id });
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("list");
      SchedulerWebview.focusTask(createdTask.id);
      deps.notifyInfo(`Created scheduled task draft from Todo Cockpit: ${createdTask.name}`);
      return true;
    }
  }
}

function buildTaskPromptFromTodo(taskSource: TodoPromptSource): string {
  const sections: string[] = [
    `Task goal: ${taskSource.title}`,
  ];

  if (taskSource.description?.trim()) {
    sections.push(`Context:\n${taskSource.description.trim()}`);
  }

  const commentLines = (taskSource.comments ?? [])
    .filter((comment) => comment?.body)
    .slice(-5)
    .map((comment) => `- ${comment.author || "system"}: ${comment.body}`);
  if (commentLines.length > 0) {
    sections.push(`Recent coordination:\n${commentLines.join("\n")}`);
  }

  sections.push(
    "Produce the approved execution artifact for this todo and keep any unresolved questions explicit.",
  );
  return sections.join("\n\n");
}