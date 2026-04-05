import * as vscode from "vscode";
import type { ScheduledTask } from "./types";

type TaskPickPresentation = {
  label: string;
  description?: string;
  detail?: string;
};

export async function promptToPickTask(params: {
  tasks: readonly ScheduledTask[];
  placeHolder: string;
  describeTask: (task: ScheduledTask) => TaskPickPresentation;
  onEmpty?: () => void;
}): Promise<ScheduledTask | undefined> {
  const { describeTask, onEmpty, placeHolder, tasks } = params;
  if (tasks.length === 0) {
    onEmpty?.();
    return undefined;
  }

  const selected = await vscode.window.showQuickPick(
    tasks.map((task) => ({
      ...describeTask(task),
      task,
    })),
    { placeHolder },
  );

  return selected?.task;
}

export async function promptToPickTaskId(params: {
  tasks: readonly ScheduledTask[];
  placeHolder: string;
  describeTask: (task: ScheduledTask) => TaskPickPresentation;
  onEmpty?: () => void;
}): Promise<string | undefined> {
  return (await promptToPickTask(params))?.id;
}
