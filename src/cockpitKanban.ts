import type { CockpitTodoCard, TaskAction } from "./types";

export type CockpitKanbanLaneId =
  | "inbox"
  | "bot-review"
  | "user-review"
  | "ready"
  | "scheduled"
  | "done";

export const KANBAN_LANES: Array<{ id: CockpitKanbanLaneId; title: string }> = [
  { id: "inbox", title: "Inbox" },
  { id: "bot-review", title: "Bot Review" },
  { id: "user-review", title: "User Review" },
  { id: "ready", title: "Ready" },
  { id: "scheduled", title: "Scheduled" },
  { id: "done", title: "Done" },
];

type KanbanTransitionAction = Pick<TaskAction, "action" | "todoId" | "todoData">;

export type KanbanTransitionPlan =
  | KanbanTransitionAction
  | { blocked: true; reason: string };

function hasFlag(card: CockpitTodoCard, flag: string): boolean {
  return Array.isArray(card.flags) && card.flags.includes(flag);
}

export function deriveKanbanLane(card: CockpitTodoCard): CockpitKanbanLaneId {
  if (
    card.archived
    || card.status === "completed"
    || card.status === "rejected"
  ) {
    return "done";
  }

  if (hasFlag(card, "needs-bot-review")) {
    return "bot-review";
  }

  if (hasFlag(card, "needs-user-review") || hasFlag(card, "FINAL-USER-CHECK")) {
    return "user-review";
  }

  if (card.taskId || hasFlag(card, "ON-SCHEDULE-LIST")) {
    return "scheduled";
  }

  if (hasFlag(card, "ready")) {
    return "ready";
  }

  return "inbox";
}

function withWorkflowFlag(card: CockpitTodoCard, flag: string): string[] {
  const workflowFlags = new Set([
    "new",
    "needs-bot-review",
    "needs-user-review",
    "ready",
    "ON-SCHEDULE-LIST",
    "FINAL-USER-CHECK",
  ]);
  const rest = (card.flags ?? []).filter((value) => !workflowFlags.has(value));
  return [flag, ...rest];
}

export function planKanbanLaneTransition(
  card: CockpitTodoCard,
  targetLane: CockpitKanbanLaneId,
): KanbanTransitionPlan {
  const currentLane = deriveKanbanLane(card);
  if (currentLane === targetLane) {
    return { blocked: true, reason: "Todo is already in that lane." };
  }

  switch (targetLane) {
    case "inbox":
      return { action: "updateTodo", todoId: card.id, todoData: { flags: withWorkflowFlag(card, "new") } };
    case "bot-review":
      return { action: "updateTodo", todoId: card.id, todoData: { flags: withWorkflowFlag(card, "needs-bot-review") } };
    case "user-review":
      return { action: "updateTodo", todoId: card.id, todoData: { flags: withWorkflowFlag(card, "needs-user-review") } };
    case "ready":
      return currentLane === "bot-review" || currentLane === "user-review" || currentLane === "inbox"
        ? { action: "approveTodo", todoId: card.id }
        : { blocked: true, reason: "Only review or inbox todos can be approved into Ready." };
    case "scheduled":
      return currentLane === "ready"
        ? { action: "createTaskFromTodo", todoId: card.id }
        : { blocked: true, reason: "Move this todo to Ready before scheduling it." };
    case "done":
      return currentLane === "scheduled" || currentLane === "user-review"
        ? { action: "finalizeTodo", todoId: card.id }
        : { blocked: true, reason: "Only scheduled or final-review todos can be completed." };
  }
}
