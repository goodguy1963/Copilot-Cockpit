/**
 * Task-tab message handler extracted from SchedulerWebview.handleMessage().
 * Covers: refreshTasks, runTask, toggleTask, deleteTask, duplicateTask,
 * moveTaskToCurrentWorkspace, copyTask.
 */

import type { TaskAction, WebviewToExtensionMessage } from "./types";

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

/**
 * Handle task-related webview messages.
 * Returns `true` if the message was handled, `false` otherwise.
 */
export function handleTaskWebviewMessage(
  message: WebviewToExtensionMessage,
  onTaskActionCallback: TaskActionCallback,
): boolean {
  switch (message.type) {
    case "createTask":
      onTaskActionCallback?.({
        action: "edit",
        taskId: "__create__",
        data: message.data,
      });
      return true;

    case "updateTask":
      onTaskActionCallback?.({
        action: "edit",
        taskId: message.taskId,
        data: message.data,
      });
      return true;

    case "refreshTasks":
      onTaskActionCallback?.({
        action: "refresh",
        taskId: "__refresh__",
      });
      return true;

    case "runTask":
      onTaskActionCallback?.({
        action: "run",
        taskId: message.taskId,
      });
      return true;

    case "toggleTask":
      onTaskActionCallback?.({
        action: "toggle",
        taskId: message.taskId,
      });
      return true;

    case "deleteTask":
      onTaskActionCallback?.({
        action: "delete",
        taskId: message.taskId,
      });
      return true;

    case "duplicateTask":
      onTaskActionCallback?.({
        action: "duplicate",
        taskId: message.taskId,
      });
      return true;

    case "moveTaskToCurrentWorkspace":
      onTaskActionCallback?.({
        action: "moveToCurrentWorkspace",
        taskId: message.taskId,
      });
      return true;

    case "copyTask":
      onTaskActionCallback?.({
        action: "copy",
        taskId: message.taskId,
      });
      return true;

    default:
      return false;
  }
}
