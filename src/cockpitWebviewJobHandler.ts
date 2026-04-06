/**
 * Job-tab message handler extracted from SchedulerWebview.handleMessage().
 * Covers all job, job-folder, job-task, and job-pause message types
 * (both the direct callback cases and the dialog-based "request*" cases).
 */

import type { TaskAction, WebviewToExtensionMessage } from "./types";
import type { JobDialogContext } from "./cockpitWebviewJobDialogs";
import {
  handleCreateJobRequest,
  handleCreateJobFolderRequest,
  handleRenameJobFolderRequest,
  handleDeleteJobFolderRequest,
  handleDeleteJobTaskRequest,
  handleRenameJobPauseRequest,
  handleDeleteJobPauseRequest,
} from "./cockpitWebviewJobDialogs";

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

/**
 * Handle job-related webview messages.
 * Returns `true` if the message was handled, `false` otherwise.
 */
export async function handleJobWebviewMessage(
  message: WebviewToExtensionMessage,
  onTaskActionCallback: TaskActionCallback,
  dialogCtx: JobDialogContext,
): Promise<boolean> {
  switch (message.type) {
    // --------------- dialog-based requests ---------------
    case "requestCreateJob":
      await handleCreateJobRequest(dialogCtx, message.folderId);
      return true;

    case "requestCreateJobFolder":
      await handleCreateJobFolderRequest(dialogCtx, message.parentFolderId);
      return true;

    case "requestRenameJobFolder":
      await handleRenameJobFolderRequest(dialogCtx, message.folderId);
      return true;

    case "requestDeleteJobFolder":
      await handleDeleteJobFolderRequest(dialogCtx, message.folderId);
      return true;

    case "requestDeleteJobTask":
      await handleDeleteJobTaskRequest(dialogCtx, message.jobId, message.nodeId);
      return true;

    case "requestRenameJobPause":
      await handleRenameJobPauseRequest(dialogCtx, message.jobId, message.nodeId);
      return true;

    case "requestDeleteJobPause":
      await handleDeleteJobPauseRequest(dialogCtx, message.jobId, message.nodeId);
      return true;

    // --------------- direct callback cases ---------------
    case "createJob":
      onTaskActionCallback?.({
        action: "createJob",
        taskId: "__job__",
        jobData: message.data,
      });
      return true;

    case "updateJob":
      onTaskActionCallback?.({
        action: "updateJob",
        taskId: "__job__",
        jobId: message.jobId,
        jobData: message.data,
      });
      return true;

    case "deleteJob":
      onTaskActionCallback?.({
        action: "deleteJob",
        taskId: "__job__",
        jobId: message.jobId,
      });
      return true;

    case "duplicateJob":
      onTaskActionCallback?.({
        action: "duplicateJob",
        taskId: "__job__",
        jobId: message.jobId,
      });
      return true;

    case "toggleJobPaused":
      onTaskActionCallback?.({
        action: "toggleJobPaused",
        taskId: "__job__",
        jobId: message.jobId,
      });
      return true;

    case "createJobFolder":
      onTaskActionCallback?.({
        action: "createJobFolder",
        taskId: "__jobfolder__",
        folderData: message.data,
      });
      return true;

    case "renameJobFolder":
      onTaskActionCallback?.({
        action: "renameJobFolder",
        taskId: "__jobfolder__",
        folderId: message.folderId,
        folderData: message.data,
      });
      return true;

    case "deleteJobFolder":
      onTaskActionCallback?.({
        action: "deleteJobFolder",
        taskId: "__jobfolder__",
        folderId: message.folderId,
      });
      return true;

    case "createJobTask":
      onTaskActionCallback?.({
        action: "createJobTask",
        taskId: "__jobtask__",
        jobId: message.jobId,
        data: message.data,
        windowMinutes: message.windowMinutes,
      });
      return true;

    case "attachTaskToJob":
      onTaskActionCallback?.({
        action: "attachTaskToJob",
        taskId: message.taskId,
        jobId: message.jobId,
        windowMinutes: message.windowMinutes,
      });
      return true;

    case "detachTaskFromJob":
      onTaskActionCallback?.({
        action: "detachTaskFromJob",
        taskId: "__jobtask__",
        jobId: message.jobId,
        nodeId: message.nodeId,
      });
      return true;

    case "deleteJobTask":
      onTaskActionCallback?.({
        action: "deleteJobTask",
        taskId: "__jobtask__",
        jobId: message.jobId,
        nodeId: message.nodeId,
      });
      return true;

    case "createJobPause":
      onTaskActionCallback?.({
        action: "createJobPause",
        taskId: "__jobpause__",
        jobId: message.jobId,
        pauseData: message.data,
      });
      return true;

    case "approveJobPause":
      onTaskActionCallback?.({
        action: "approveJobPause",
        taskId: "__jobpause__",
        jobId: message.jobId,
        nodeId: message.nodeId,
      });
      return true;

    case "rejectJobPause":
      onTaskActionCallback?.({
        action: "rejectJobPause",
        taskId: "__jobpause__",
        jobId: message.jobId,
        nodeId: message.nodeId,
      });
      return true;

    case "reorderJobNode":
      onTaskActionCallback?.({
        action: "reorderJobNode",
        taskId: "__jobtask__",
        jobId: message.jobId,
        nodeId: message.nodeId,
        targetIndex: message.targetIndex,
      });
      return true;

    case "updateJobNodeWindow":
      onTaskActionCallback?.({
        action: "updateJobNodeWindow",
        taskId: "__jobtask__",
        jobId: message.jobId,
        nodeId: message.nodeId,
        windowMinutes: message.windowMinutes,
      });
      return true;

    case "compileJob":
      onTaskActionCallback?.({
        action: "compileJob",
        taskId: "__job__",
        jobId: message.jobId,
      });
      return true;

    default:
      return false;
  }
}
