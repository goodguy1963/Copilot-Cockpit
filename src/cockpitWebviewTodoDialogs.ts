import * as vscode from "vscode";

import type { CockpitBoard, TaskAction, WebviewToExtensionMessage } from "./types";
import type { SchedulerWebviewStrings } from "./cockpitWebviewStrings";

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

export type TodoDialogContext = {
  currentCockpitBoard: CockpitBoard;
  onTaskActionCallback: TaskActionCallback;
  strings: SchedulerWebviewStrings;
};

function hasTodo(board: CockpitBoard, todoId: string): boolean {
  return Array.isArray(board.cards)
    && board.cards.some((card) => card && card.id === todoId);
}

async function handleApproveTodoRequest(
  ctx: TodoDialogContext,
  todoId: string,
): Promise<void> {
  if (!ctx.onTaskActionCallback || !hasTodo(ctx.currentCockpitBoard, todoId)) {
    return;
  }

  const confirmLabel = ctx.strings.boardApproveTodo || "Approve";
  const cancelLabel = ctx.strings.boardDeleteTodoCancel
    || ctx.strings.boardCancelAction
    || "Cancel";
  const confirm = await vscode.window.showWarningMessage(
    ctx.strings.boardApprovePrompt || "Mark this todo ready for task draft creation?",
    { modal: true },
    confirmLabel,
    cancelLabel,
  );
  if (confirm !== confirmLabel) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "approveTodo",
    taskId: "__todo__",
    todoId,
  });
}

async function handleFinalizeTodoRequest(
  ctx: TodoDialogContext,
  todoId: string,
): Promise<void> {
  if (!ctx.onTaskActionCallback || !hasTodo(ctx.currentCockpitBoard, todoId)) {
    return;
  }

  const confirmLabel = ctx.strings.boardFinalizeTodo || "Final Accept";
  const cancelLabel = ctx.strings.boardDeleteTodoCancel
    || ctx.strings.boardCancelAction
    || "Cancel";
  const confirm = await vscode.window.showWarningMessage(
    ctx.strings.boardFinalizePrompt || "Archive this todo as completed successfully?",
    { modal: true },
    confirmLabel,
    cancelLabel,
  );
  if (confirm !== confirmLabel) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "finalizeTodo",
    taskId: "__todo__",
    todoId,
  });
}

export async function handleTodoDialogWebviewMessage(
  message: WebviewToExtensionMessage,
  ctx: TodoDialogContext,
): Promise<boolean> {
  switch (message.type) {
    case "requestApproveTodo":
      await handleApproveTodoRequest(ctx, message.todoId);
      return true;

    case "requestFinalizeTodo":
      await handleFinalizeTodoRequest(ctx, message.todoId);
      return true;

    default:
      return false;
  }
}