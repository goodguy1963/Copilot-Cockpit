import * as assert from "assert";
import { handleTaskWebviewMessage } from "../../schedulerWebviewTaskHandler";
import type { TaskAction, WebviewToExtensionMessage } from "../../types";

suite("Task Handler Tests", () => {
  function collectAction(message: WebviewToExtensionMessage): TaskAction | undefined {
    let captured: TaskAction | undefined;
    const handled = handleTaskWebviewMessage(message, (action) => {
      captured = action;
    });
    assert.ok(handled, `Expected message type '${message.type}' to be handled`);
    return captured;
  }

  test("refreshTasks dispatches refresh action", () => {
    const action = collectAction({ type: "refreshTasks" } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "refresh");
    assert.strictEqual(action?.taskId, "__refresh__");
  });

  test("createTask dispatches edit action for create mode", () => {
    const action = collectAction({
      type: "createTask",
      data: { name: "New task", prompt: "Prompt", cronExpression: "* * * * *" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "edit");
    assert.strictEqual(action?.taskId, "__create__");
    assert.deepStrictEqual(action?.data, {
      name: "New task",
      prompt: "Prompt",
      cronExpression: "* * * * *",
    });
  });

  test("updateTask dispatches edit action for existing tasks", () => {
    const action = collectAction({
      type: "updateTask",
      taskId: "t-edit",
      data: { name: "Updated task" },
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "edit");
    assert.strictEqual(action?.taskId, "t-edit");
    assert.deepStrictEqual(action?.data, { name: "Updated task" });
  });

  test("runTask dispatches run action with taskId", () => {
    const action = collectAction({ type: "runTask", taskId: "t1" } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "run");
    assert.strictEqual(action?.taskId, "t1");
  });

  test("toggleTask dispatches toggle action", () => {
    const action = collectAction({ type: "toggleTask", taskId: "t2" } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "toggle");
    assert.strictEqual(action?.taskId, "t2");
  });

  test("deleteTask dispatches delete action", () => {
    const action = collectAction({ type: "deleteTask", taskId: "t3" } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "delete");
    assert.strictEqual(action?.taskId, "t3");
  });

  test("duplicateTask dispatches duplicate action", () => {
    const action = collectAction({ type: "duplicateTask", taskId: "t4" } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "duplicate");
    assert.strictEqual(action?.taskId, "t4");
  });

  test("moveTaskToCurrentWorkspace dispatches moveToCurrentWorkspace", () => {
    const action = collectAction({
      type: "moveTaskToCurrentWorkspace",
      taskId: "t5",
    } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "moveToCurrentWorkspace");
    assert.strictEqual(action?.taskId, "t5");
  });

  test("copyTask dispatches copy action", () => {
    const action = collectAction({ type: "copyTask", taskId: "t6" } as WebviewToExtensionMessage);
    assert.strictEqual(action?.action, "copy");
    assert.strictEqual(action?.taskId, "t6");
  });

  test("returns false for unrelated message type", () => {
    const handled = handleTaskWebviewMessage(
      { type: "setLanguage", language: "en" } as WebviewToExtensionMessage,
      () => {},
    );
    assert.strictEqual(handled, false);
  });

  test("tolerates undefined callback", () => {
    const handled = handleTaskWebviewMessage(
      { type: "runTask", taskId: "t1" } as WebviewToExtensionMessage,
      undefined,
    );
    assert.strictEqual(handled, true);
  });
});
