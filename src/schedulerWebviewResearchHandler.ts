/**
 * Research-tab message handler extracted from SchedulerWebview.handleMessage().
 * Covers: createResearchProfile, updateResearchProfile, deleteResearchProfile,
 * duplicateResearchProfile, startResearchRun, stopResearchRun.
 */

import type { TaskAction, WebviewToExtensionMessage } from "./types";

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

/**
 * Handle research-related webview messages.
 * Returns `true` if the message was handled, `false` otherwise.
 */
export function handleResearchWebviewMessage(
  message: WebviewToExtensionMessage,
  onTaskActionCallback: TaskActionCallback,
): boolean {
  switch (message.type) {
    case "createResearchProfile":
      onTaskActionCallback?.({
        action: "createResearchProfile",
        taskId: "__research__",
        researchData: message.data,
      });
      return true;

    case "updateResearchProfile":
      onTaskActionCallback?.({
        action: "updateResearchProfile",
        taskId: "__research__",
        researchId: message.researchId,
        researchData: message.data,
      });
      return true;

    case "deleteResearchProfile":
      onTaskActionCallback?.({
        action: "deleteResearchProfile",
        taskId: "__research__",
        researchId: message.researchId,
      });
      return true;

    case "duplicateResearchProfile":
      onTaskActionCallback?.({
        action: "duplicateResearchProfile",
        taskId: "__research__",
        researchId: message.researchId,
      });
      return true;

    case "startResearchRun":
      onTaskActionCallback?.({
        action: "startResearchRun",
        taskId: "__research__",
        researchId: message.researchId,
      });
      return true;

    case "stopResearchRun":
      onTaskActionCallback?.({
        action: "stopResearchRun",
        taskId: "__research__",
      });
      return true;

    default:
      return false;
  }
}
