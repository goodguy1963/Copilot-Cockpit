import * as assert from "assert";
import * as vscode from "vscode";
import {
  handleCreateJobFolderRequest,
  handleCreateJobRequest,
  handleDeleteJobFolderRequest,
  handleDeleteJobPauseRequest,
  handleDeleteJobTaskRequest,
  handleRenameJobFolderRequest,
  handleRenameJobPauseRequest,
  promptForJobFolderName,
  type JobDialogContext,
} from "../../cockpitWebviewJobDialogs";
import { messages } from "../../i18n";
import type { JobDefinition, JobFolder, ScheduledTask, TaskAction } from "../../types";

suite("Scheduler Webview Job Dialog Tests", () => {
  function createTask(id: string, name: string): ScheduledTask {
    return {
      id,
      name,
      cronExpression: "0 * * * *",
      prompt: "run",
      enabled: true,
      scope: "workspace",
      promptSource: "inline",
      createdAt: new Date("2026-04-04T00:00:00.000Z"),
      updatedAt: new Date("2026-04-04T00:00:00.000Z"),
    };
  }

  function createContext(options?: {
    jobs?: JobDefinition[];
    folders?: JobFolder[];
    tasks?: ScheduledTask[];
    callback?: (action: TaskAction) => void;
  }): JobDialogContext {
    return {
      currentJobs: options?.jobs ?? [],
      currentJobFolders: options?.folders ?? [],
      currentTasks: options?.tasks ?? [],
      onTaskActionCallback: options?.callback,
    };
  }

  test("promptForJobFolderName trims valid input", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;

    try {
      (vscode.window as any).showInputBox = async () => "  Folder Name  ";

      const result = await promptForJobFolderName("Create Folder");

      assert.strictEqual(result, "Folder Name");
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("promptForJobFolderName returns undefined for whitespace input", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;

    try {
      (vscode.window as any).showInputBox = async () => "   ";

      const result = await promptForJobFolderName("Create Folder");

      assert.strictEqual(result, undefined);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleCreateJobRequest dispatches trimmed name with default cron", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => "  Morning Sync  ";

      await handleCreateJobRequest(createContext({
        callback: (action) => { captured = action; },
      }), "folder-1");

      assert.strictEqual(captured?.action, "createJob");
      assert.strictEqual(captured?.taskId, "__job__");
      assert.deepStrictEqual((captured as any)?.jobData, {
        name: "Morning Sync",
        cronExpression: "0 9 * * 1-5",
        folderId: "folder-1",
      });
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleCreateJobFolderRequest dispatches parent folder with trimmed name", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => "  Child Folder  ";

      await handleCreateJobFolderRequest(createContext({
        callback: (action) => { captured = action; },
      }), "parent-1");

      assert.strictEqual(captured?.action, "createJobFolder");
      assert.strictEqual(captured?.taskId, "__jobfolder__");
      assert.deepStrictEqual((captured as any)?.folderData, {
        name: "Child Folder",
        parentId: "parent-1",
      });
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleRenameJobFolderRequest ignores unknown folder ids", async () => {
    let captured: TaskAction | undefined;

    await handleRenameJobFolderRequest(createContext({
      folders: [],
      callback: (action) => { captured = action; },
    }), "missing-folder");

    assert.strictEqual(captured, undefined);
  });

  test("handleRenameJobFolderRequest dispatches trimmed rename", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => "  Renamed Folder  ";

      await handleRenameJobFolderRequest(createContext({
        folders: [{
          id: "folder-1",
          name: "Original Folder",
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "folder-1");

      assert.strictEqual(captured?.action, "renameJobFolder");
      assert.strictEqual((captured as any)?.folderId, "folder-1");
      assert.deepStrictEqual((captured as any)?.folderData, { name: "Renamed Folder" });
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleDeleteJobFolderRequest dispatches only after confirmation", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteYes();

      await handleDeleteJobFolderRequest(createContext({
        folders: [{
          id: "folder-1",
          name: "Folder 1",
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "folder-1");

      assert.strictEqual(captured?.action, "deleteJobFolder");
      assert.strictEqual((captured as any)?.folderId, "folder-1");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("handleDeleteJobTaskRequest dispatches detach when chosen", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDetachOnly();

      await handleDeleteJobTaskRequest(createContext({
        jobs: [{
          id: "job-1",
          name: "Job 1",
          cronExpression: "0 * * * *",
          nodes: [{ id: "node-1", taskId: "task-1", windowMinutes: 10 }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        tasks: [createTask("task-1", "Task 1")],
        callback: (action) => { captured = action; },
      }), "job-1", "node-1");

      assert.strictEqual(captured?.action, "detachTaskFromJob");
      assert.strictEqual((captured as any)?.jobId, "job-1");
      assert.strictEqual((captured as any)?.nodeId, "node-1");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("handleDeleteJobTaskRequest dispatches delete when chosen", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDeleteTask();

      await handleDeleteJobTaskRequest(createContext({
        jobs: [{
          id: "job-1",
          name: "Job 1",
          cronExpression: "0 * * * *",
          nodes: [{ id: "node-1", taskId: "task-1", windowMinutes: 10 }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        tasks: [createTask("task-1", "Task 1")],
        callback: (action) => { captured = action; },
      }), "job-1", "node-1");

      assert.strictEqual(captured?.action, "deleteJobTask");
      assert.strictEqual((captured as any)?.jobId, "job-1");
      assert.strictEqual((captured as any)?.nodeId, "node-1");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("handleRenameJobPauseRequest dispatches trimmed pause title", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => "  Approval Gate  ";

      await handleRenameJobPauseRequest(createContext({
        jobs: [{
          id: "job-1",
          name: "Job 1",
          cronExpression: "0 * * * *",
          nodes: [{ id: "pause-1", type: "pause", title: "Review" }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "job-1", "pause-1");

      assert.strictEqual(captured?.action, "updateJobPause");
      assert.strictEqual((captured as any)?.jobId, "job-1");
      assert.strictEqual((captured as any)?.nodeId, "pause-1");
      assert.deepStrictEqual((captured as any)?.pauseUpdateData, { title: "Approval Gate" });
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleDeleteJobPauseRequest dispatches delete after confirmation", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteYes();

      await handleDeleteJobPauseRequest(createContext({
        jobs: [{
          id: "job-1",
          name: "Job 1",
          cronExpression: "0 * * * *",
          nodes: [{ id: "pause-1", type: "pause", title: "Review" }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "job-1", "pause-1");

      assert.strictEqual(captured?.action, "deleteJobPause");
      assert.strictEqual((captured as any)?.jobId, "job-1");
      assert.strictEqual((captured as any)?.nodeId, "pause-1");
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  // ─── Cancel / negative paths ───────────────────────────────────────────────

  test("promptForJobFolderName returns undefined when user dismisses (undefined result)", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;

    try {
      (vscode.window as any).showInputBox = async () => undefined;

      const result = await promptForJobFolderName("Create Folder", "existing");

      assert.strictEqual(result, undefined);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleCreateJobRequest does not dispatch when user cancels the input box", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => undefined;

      await handleCreateJobRequest(createContext({
        callback: (action) => { captured = action; },
      }));

      assert.strictEqual(captured, undefined);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleCreateJobRequest dispatches without folderId when no folder is given", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => "Standalone Job";

      await handleCreateJobRequest(createContext({
        callback: (action) => { captured = action; },
      }));

      assert.strictEqual(captured?.action, "createJob");
      assert.strictEqual((captured as any)?.jobData?.name, "Standalone Job");
      assert.strictEqual((captured as any)?.jobData?.folderId, undefined);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleCreateJobFolderRequest does not dispatch when user cancels", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => undefined;

      await handleCreateJobFolderRequest(createContext({
        callback: (action) => { captured = action; },
      }));

      assert.strictEqual(captured, undefined);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("handleDeleteJobFolderRequest does not dispatch when user cancels the confirmation", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.actionCancel();

      await handleDeleteJobFolderRequest(createContext({
        folders: [{
          id: "folder-cancel",
          name: "Folder to cancel",
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "folder-cancel");

      assert.strictEqual(captured, undefined);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("handleDeleteJobFolderRequest does nothing for an unknown folder id", async () => {
    let captured: TaskAction | undefined;

    await handleDeleteJobFolderRequest(createContext({
      folders: [],
      callback: (action) => { captured = action; },
    }), "ghost-folder");

    assert.strictEqual(captured, undefined);
  });

  test("handleDeleteJobTaskRequest does not dispatch when user cancels", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.actionCancel();

      await handleDeleteJobTaskRequest(createContext({
        jobs: [{
          id: "job-cancel",
          name: "Job Cancel",
          cronExpression: "0 * * * *",
          nodes: [{ id: "node-cancel", taskId: "task-cancel", windowMinutes: 10 }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        tasks: [createTask("task-cancel", "Cancel Task")],
        callback: (action) => { captured = action; },
      }), "job-cancel", "node-cancel");

      assert.strictEqual(captured, undefined);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("handleRenameJobPauseRequest does nothing when the node is a task type, not a pause", async () => {
    let captured: TaskAction | undefined;

    await handleRenameJobPauseRequest(createContext({
      jobs: [{
        id: "job-1",
        name: "Job 1",
        cronExpression: "0 * * * *",
        nodes: [{ id: "node-task", taskId: "task-1", windowMinutes: 10 }],
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
      }],
      callback: (action) => { captured = action; },
    }), "job-1", "node-task");

    assert.strictEqual(captured, undefined);
  });

  test("handleDeleteJobPauseRequest does nothing when the node is a task type, not a pause", async () => {
    let captured: TaskAction | undefined;

    await handleDeleteJobPauseRequest(createContext({
      jobs: [{
        id: "job-1",
        name: "Job 1",
        cronExpression: "0 * * * *",
        nodes: [{ id: "node-task", taskId: "task-1", windowMinutes: 10 }],
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
      }],
      callback: (action) => { captured = action; },
    }), "job-1", "node-task");

    assert.strictEqual(captured, undefined);
  });

  test("handleDeleteJobPauseRequest does not dispatch when user cancels the confirmation", async () => {
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showWarningMessage = async () => messages.actionCancel();

      await handleDeleteJobPauseRequest(createContext({
        jobs: [{
          id: "job-1",
          name: "Job 1",
          cronExpression: "0 * * * *",
          nodes: [{ id: "pause-cancel", type: "pause", title: "Gate" }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "job-1", "pause-cancel");

      assert.strictEqual(captured, undefined);
    } finally {
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("handleRenameJobPauseRequest does not dispatch when user cancels", async () => {
    const originalShowInputBox = (vscode.window as any).showInputBox;
    let captured: TaskAction | undefined;

    try {
      (vscode.window as any).showInputBox = async () => undefined;

      await handleRenameJobPauseRequest(createContext({
        jobs: [{
          id: "job-1",
          name: "Job 1",
          cronExpression: "0 * * * *",
          nodes: [{ id: "pause-1", type: "pause", title: "Gate" }],
          createdAt: "2026-04-04T00:00:00.000Z",
          updatedAt: "2026-04-04T00:00:00.000Z",
        }],
        callback: (action) => { captured = action; },
      }), "job-1", "pause-1");

      assert.strictEqual(captured, undefined);
    } finally {
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });
});