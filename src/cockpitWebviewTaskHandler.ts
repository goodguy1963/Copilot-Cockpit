/**
 * Task-tab message handler extracted from SchedulerWebview.handleMessage().
 * Covers: refreshTasks, runTask, toggleTask, deleteTask, duplicateTask,
 * moveTaskToCurrentWorkspace, copyTask.
 */

import type { TaskAction, WebviewToExtensionMessage } from "./types";

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

function dispatchTaskAction(
  onTaskActionCallback: TaskActionCallback,
  action: TaskAction["action"],
  taskId: string,
  data?: TaskAction["data"],
) {
  onTaskActionCallback?.({ action, taskId, ...(data === undefined ? {} : { data }) });
}

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
      dispatchTaskAction(onTaskActionCallback, "edit", "__create__", message.data);
      return true;

    case "updateTask":
      dispatchTaskAction(onTaskActionCallback, "edit", message.taskId, message.data);
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
