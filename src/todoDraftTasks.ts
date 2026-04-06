import type { CockpitBoard, CockpitTodoCard, ScheduledTask } from "./types";

const TODO_DRAFT_LABEL = "from-todo-cockpit";

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

  return Array.isArray(task.labels)
    && task.labels.some((label) =>
      String(label || "").trim().toLowerCase() === TODO_DRAFT_LABEL
    );
}

export function findLinkedTodoByTaskId(
  board: Pick<CockpitBoard, "cards">,
  taskId: string,
): CockpitTodoCard | undefined {
  return (board.cards ?? []).find((card) => !!card && card.taskId === taskId);
}