/**
 * Job dialog helpers extracted from SchedulerWebview.
 * Each function shows a VS Code input / confirmation dialog and, on success,
 * invokes the supplied TaskAction callback.
 */

import * as vscode from "vscode";
import type {
  JobDefinition,
  JobFolder,
  ScheduledTask,
  TaskAction,
} from "./types";
import { messages } from "./i18n";

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

export interface JobDialogContext {
  currentJobs: JobDefinition[];
  currentJobFolders: JobFolder[];
  currentTasks: ScheduledTask[];
  onTaskActionCallback: TaskActionCallback;
}

export async function promptForJobFolderName(
  title: string,
  value = "",
): Promise<string | undefined> {
  const result = await vscode.window.showInputBox({
    title,
    prompt: messages.jobFolderNamePrompt(),
    value,
    ignoreFocusOut: true,
    validateInput: (input) =>
      input.trim() ? undefined : messages.taskNameRequired(),
  });
  const trimmed = result?.trim();
  return trimmed ? trimmed : undefined;
}

export async function handleCreateJobRequest(
  ctx: JobDialogContext,
  folderId?: string,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    title: messages.jobCreateTitle(),
    prompt: messages.jobNamePrompt(),
    ignoreFocusOut: true,
    validateInput: (input) =>
      input.trim() ? undefined : messages.taskNameRequired(),
  });
  const trimmedName = name?.trim();
  if (!trimmedName || !ctx.onTaskActionCallback) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "createJob",
    taskId: "__job__",
    jobData: {
      name: trimmedName,
      cronExpression: "0 9 * * 1-5",
      folderId,
    },
  });
}

export async function handleCreateJobFolderRequest(
  ctx: JobDialogContext,
  parentFolderId?: string,
): Promise<void> {
  const name = await promptForJobFolderName(
    messages.jobFolderCreateTitle(),
  );
  if (!name || !ctx.onTaskActionCallback) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "createJobFolder",
    taskId: "__jobfolder__",
    folderData: {
      name,
      parentId: parentFolderId,
    },
  });
}

export async function handleRenameJobFolderRequest(
  ctx: JobDialogContext,
  folderId: string,
): Promise<void> {
  const folder = ctx.currentJobFolders.find((entry) => entry.id === folderId);
  if (!folder) {
    return;
  }

  const name = await promptForJobFolderName(
    messages.jobFolderRenameTitle(),
    folder.name,
  );
  if (!name || !ctx.onTaskActionCallback) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "renameJobFolder",
    taskId: "__jobfolder__",
    folderId,
    folderData: { name },
  });
}

export async function handleDeleteJobFolderRequest(
  ctx: JobDialogContext,
  folderId: string,
): Promise<void> {
  const folder = ctx.currentJobFolders.find((entry) => entry.id === folderId);
  if (!folder || !ctx.onTaskActionCallback) {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    messages.confirmDeleteJobFolder(folder.name),
    { modal: true },
    messages.confirmDeleteYes(),
    messages.actionCancel(),
  );
  if (confirm !== messages.confirmDeleteYes()) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "deleteJobFolder",
    taskId: "__jobfolder__",
    folderId,
  });
}

export async function handleDeleteJobTaskRequest(
  ctx: JobDialogContext,
  jobId: string,
  nodeId: string,
): Promise<void> {
  const job = ctx.currentJobs.find((entry) => entry.id === jobId);
  const node = job?.nodes.find((entry) => entry.id === nodeId);
  const task = node && "taskId" in node
    ? ctx.currentTasks.find((entry) => entry.id === node.taskId)
    : undefined;

  if (!job || !node || !task || !ctx.onTaskActionCallback) {
    return;
  }

  const detachOnly = messages.confirmDeleteJobStepDetachOnly();
  const deleteTask = messages.confirmDeleteJobStepDeleteTask();
  const confirm = await vscode.window.showWarningMessage(
    messages.confirmDeleteJobStep(task.name),
    { modal: true },
    detachOnly,
    deleteTask,
    messages.actionCancel(),
  );
  if (confirm === detachOnly) {
    ctx.onTaskActionCallback({
      action: "detachTaskFromJob",
      taskId: "__jobtask__",
      jobId,
      nodeId,
    });
    return;
  }

  if (confirm !== deleteTask) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "deleteJobTask",
    taskId: "__jobtask__",
    jobId,
    nodeId,
  });
}

export async function handleRenameJobPauseRequest(
  ctx: JobDialogContext,
  jobId: string,
  nodeId: string,
): Promise<void> {
  const job = ctx.currentJobs.find((entry) => entry.id === jobId);
  const node = job?.nodes.find((entry) => entry.id === nodeId);
  if (!job || !node || !ctx.onTaskActionCallback || node.type !== "pause") {
    return;
  }

  const title = await vscode.window.showInputBox({
    title: messages.jobsPauseTitle(),
    prompt: messages.jobsPauseName(),
    value: node.title || messages.jobsPauseDefaultTitle(),
    ignoreFocusOut: true,
    validateInput: (input) =>
      input.trim() ? undefined : messages.taskNameRequired(),
  });
  const trimmed = title?.trim();
  if (!trimmed) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "updateJobPause",
    taskId: "__jobpause__",
    jobId,
    nodeId,
    pauseUpdateData: { title: trimmed },
  });
}

export async function handleDeleteJobPauseRequest(
  ctx: JobDialogContext,
  jobId: string,
  nodeId: string,
): Promise<void> {
  const job = ctx.currentJobs.find((entry) => entry.id === jobId);
  const node = job?.nodes.find((entry) => entry.id === nodeId);
  if (!job || !node || !ctx.onTaskActionCallback || node.type !== "pause") {
    return;
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete pause checkpoint "${node.title || messages.jobsPauseDefaultTitle()}"? Downstream steps will no longer wait here.`,
    { modal: true },
    messages.confirmDeleteYes(),
    messages.actionCancel(),
  );
  if (confirm !== messages.confirmDeleteYes()) {
    return;
  }

  ctx.onTaskActionCallback({
    action: "deleteJobPause",
    taskId: "__jobpause__",
    jobId,
    nodeId,
  });
}
