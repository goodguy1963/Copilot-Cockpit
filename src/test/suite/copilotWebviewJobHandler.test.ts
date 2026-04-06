import * as assert from "assert";
import { handleJobWebviewMessage } from "../../copilotWebviewJobHandler";
import type { JobDialogContext } from "../../copilotWebviewJobDialogs";
import type { TaskAction, WebviewToExtensionMessage } from "../../types";

suite("Job Handler Tests", () => {
  function emptyDialogCtx(cb?: (action: TaskAction) => void): JobDialogContext {
    return {
      currentJobs: [],
      currentJobFolders: [],
      currentTasks: [],
      onTaskActionCallback: cb,
    };
  }

  async function collectAction(
    message: WebviewToExtensionMessage,
  ): Promise<TaskAction | undefined> {
    let captured: TaskAction | undefined;
    const ctx = emptyDialogCtx((action) => { captured = action; });
    const handled = await handleJobWebviewMessage(message, ctx.onTaskActionCallback, ctx);
    assert.ok(handled, `Expected message type '${message.type}' to be handled`);
    return captured;
  }

  test("createJob dispatches createJob action", async () => {
    const action = await collectAction({
      type: "createJob",
      data: { name: "J1", cronExpression: "* * * * *" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "createJob");
    assert.strictEqual(action?.taskId, "__job__");
  });

  test("updateJob carries jobId and data", async () => {
    const action = await collectAction({
      type: "updateJob",
      jobId: "j-1",
      data: { name: "Updated" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "updateJob");
    assert.strictEqual((action as unknown as Record<string, unknown>).jobId, "j-1");
  });

  test("deleteJob dispatches delete", async () => {
    const action = await collectAction({
      type: "deleteJob",
      jobId: "j-2",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "deleteJob");
    assert.strictEqual((action as unknown as Record<string, unknown>).jobId, "j-2");
  });

  test("duplicateJob dispatches duplicate", async () => {
    const action = await collectAction({
      type: "duplicateJob",
      jobId: "j-3",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "duplicateJob");
  });

  test("toggleJobPaused dispatches toggle", async () => {
    const action = await collectAction({
      type: "toggleJobPaused",
      jobId: "j-4",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "toggleJobPaused");
  });

  test("createJobFolder dispatches correct action", async () => {
    const action = await collectAction({
      type: "createJobFolder",
      data: { name: "Folder" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "createJobFolder");
    assert.strictEqual(action?.taskId, "__jobfolder__");
  });

  test("renameJobFolder carries folderId", async () => {
    const action = await collectAction({
      type: "renameJobFolder",
      folderId: "f-1",
      data: { name: "Renamed" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "renameJobFolder");
    assert.strictEqual((action as unknown as Record<string, unknown>).folderId, "f-1");
  });

  test("deleteJobFolder carries folderId", async () => {
    const action = await collectAction({
      type: "deleteJobFolder",
      folderId: "f-2",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "deleteJobFolder");
    assert.strictEqual((action as unknown as Record<string, unknown>).folderId, "f-2");
  });

  test("createJobTask dispatches with jobId and data", async () => {
    const action = await collectAction({
      type: "createJobTask",
      jobId: "j-5",
      data: { name: "Task", prompt: "do it" },
      windowMinutes: 10,
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "createJobTask");
    assert.strictEqual((action as unknown as Record<string, unknown>).jobId, "j-5");
  });

  test("attachTaskToJob carries task and job ids", async () => {
    const action = await collectAction({
      type: "attachTaskToJob",
      taskId: "t-1",
      jobId: "j-6",
      windowMinutes: 5,
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "attachTaskToJob");
    assert.strictEqual(action?.taskId, "t-1");
  });

  test("detachTaskFromJob dispatches detach", async () => {
    const action = await collectAction({
      type: "detachTaskFromJob",
      jobId: "j-7",
      nodeId: "n-1",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "detachTaskFromJob");
  });

  test("deleteJobTask dispatches delete", async () => {
    const action = await collectAction({
      type: "deleteJobTask",
      jobId: "j-8",
      nodeId: "n-2",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "deleteJobTask");
  });

  test("createJobPause dispatches createJobPause", async () => {
    const action = await collectAction({
      type: "createJobPause",
      jobId: "j-9",
      data: { title: "pause" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "createJobPause");
    assert.strictEqual(action?.taskId, "__jobpause__");
  });

  test("approveJobPause dispatches approve", async () => {
    const action = await collectAction({
      type: "approveJobPause",
      jobId: "j-10",
      nodeId: "n-3",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "approveJobPause");
  });

  test("rejectJobPause dispatches reject", async () => {
    const action = await collectAction({
      type: "rejectJobPause",
      jobId: "j-11",
      nodeId: "n-4",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "rejectJobPause");
  });

  test("reorderJobNode dispatches reorder with targetIndex", async () => {
    const action = await collectAction({
      type: "reorderJobNode",
      jobId: "j-12",
      nodeId: "n-5",
      targetIndex: 2,
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "reorderJobNode");
    assert.strictEqual((action as unknown as Record<string, unknown>).targetIndex, 2);
  });

  test("updateJobNodeWindow dispatches update with windowMinutes", async () => {
    const action = await collectAction({
      type: "updateJobNodeWindow",
      jobId: "j-13",
      nodeId: "n-6",
      windowMinutes: 30,
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "updateJobNodeWindow");
    assert.strictEqual((action as unknown as Record<string, unknown>).windowMinutes, 30);
  });

  test("compileJob dispatches compile", async () => {
    const action = await collectAction({
      type: "compileJob",
      jobId: "j-14",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "compileJob");
    assert.strictEqual(action?.taskId, "__job__");
  });

  test("returns false for unrelated message type", async () => {
    const ctx = emptyDialogCtx();
    const handled = await handleJobWebviewMessage(
      { type: "runTask", taskId: "t1" } as WebviewToExtensionMessage,
      undefined,
      ctx,
    );
    assert.strictEqual(handled, false);
  });

  test("tolerates undefined callback for direct cases", async () => {
    const ctx = emptyDialogCtx();
    const handled = await handleJobWebviewMessage(
      { type: "createJob", data: { name: "J", cronExpression: "* * * * *" } } as WebviewToExtensionMessage,
      undefined,
      ctx,
    );
    assert.strictEqual(handled, true);
  });
});
