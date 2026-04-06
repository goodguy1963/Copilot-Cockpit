import type { CockpitBoard, CockpitTodoCard, ScheduledTask } from "./types";

const TODO_DRAFT_LABEL = "from-todo-cockpit";

function normalizeDraftTaskText(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

function hasTodoDraftLabel(task: Pick<ScheduledTask, "labels">): boolean {
  return Array.isArray(task.labels)
    && task.labels.some((label) => normalizeDraftTaskText(label) === TODO_DRAFT_LABEL);
}

export function isTodoDraftTask(
  task: Pick<ScheduledTask, "oneTime" | "id" | "labels"> | undefined,
): boolean {
  if (!task) {
    return false;
  }

  const isOneTimeTask = task.oneTime === true || task.id.startsWith("exec-");
  if (!isOneTimeTask) {
    return false;
  }

  return hasTodoDraftLabel(task);
}

export function findLinkedTodoByTaskId(
  board: Pick<CockpitBoard, "cards">,
  taskId: string,
): CockpitTodoCard | undefined {
  return (board.cards ?? []).find((card) => !!card && card.taskId === taskId);
}

export function findTodoDraftTaskForTodo(
  tasks: ScheduledTask[] | undefined,
  todo: Pick<CockpitTodoCard, "id" | "title" | "description" | "labels">,
): ScheduledTask | undefined {
  if (!Array.isArray(tasks)) {
    return undefined;
  }

  const todoId = normalizeDraftTaskText(todo.id);
  const todoTitle = normalizeDraftTaskText(todo.title);
  const todoDescription = normalizeDraftTaskText(todo.description);
  const todoLabelSet = new Set(
    (todo.labels ?? [])
      .map((label) => normalizeDraftTaskText(label))
      .filter((label) => label.length > 0),
  );

  return tasks.find((task) => {
    if (!isTodoDraftTask(task)) {
      return false;
    }

    const taskPrompt = normalizeDraftTaskText(task.prompt);
    if (todoId && taskPrompt.includes(`todo id: ${todoId}`)) {
      return true;
    }

    const taskName = normalizeDraftTaskText(task.name);
    if (!todoTitle || taskName !== todoTitle) {
      return false;
    }

    const taskDescription = normalizeDraftTaskText(task.description);
    if (todoDescription && taskDescription !== todoDescription) {
      return false;
    }

    return [...todoLabelSet].every((label) =>
      Array.isArray(task.labels)
      && task.labels.some((entry) => normalizeDraftTaskText(entry) === label),
    );
  });
}