import * as assert from "assert";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import {
  createStartCreateTodoMessage,
  createUpdateCockpitBoardMessage,
  handleTodoCockpitWebviewMessage,
} from "../../copilotWebviewCockpitBridge";
import type { TaskAction, WebviewToExtensionMessage } from "../../types";

suite("SchedulerWebview Cockpit Bridge Tests", () => {
  test("creates outgoing cockpit update messages", () => {
    const board = createDefaultCockpitBoard("2026-03-29T08:00:00.000Z");

    assert.deepStrictEqual(createUpdateCockpitBoardMessage(board), {
      type: "updateCockpitBoard",
      cockpitBoard: board,
    });
    assert.deepStrictEqual(createStartCreateTodoMessage(), {
      type: "startCreateTodo",
    });
  });

  test("routes Todo Cockpit messages into task actions", () => {
    const received: TaskAction[] = [];
    const finalizeMessage: WebviewToExtensionMessage = {
      type: "finalizeTodo",
      todoId: "todo-1",
    };
    const moveSectionMessage: WebviewToExtensionMessage = {
      type: "moveCockpitSection",
      sectionId: "section-1",
      direction: "left",
    };

    const handledFinalize = handleTodoCockpitWebviewMessage(
      finalizeMessage,
      (action) => received.push(action),
    );
    const handledMoveSection = handleTodoCockpitWebviewMessage(
      moveSectionMessage,
      (action) => received.push(action),
    );

    assert.strictEqual(handledFinalize, true);
    assert.strictEqual(handledMoveSection, true);
    assert.deepStrictEqual(received, [
      {
        action: "finalizeTodo",
        taskId: "__todo__",
        todoId: "todo-1",
      },
      {
        action: "moveCockpitSection",
        taskId: "__section__",
        sectionId: "section-1",
        sectionDirection: "left",
      },
    ]);
  });

  test("routes linked-task lifecycle messages through the cockpit bridge", () => {
    const received: TaskAction[] = [];

    const handledLink = handleTodoCockpitWebviewMessage(
      { type: "linkTodoTask", todoId: "todo-1", taskId: "task-1" },
      (action) => received.push(action),
    );
    const handledCreate = handleTodoCockpitWebviewMessage(
      { type: "createTaskFromTodo", todoId: "todo-1" },
      (action) => received.push(action),
    );

    assert.strictEqual(handledLink, true);
    assert.strictEqual(handledCreate, true);
    assert.deepStrictEqual(received, [
      {
        action: "linkTodoTask",
        taskId: "__todo__",
        todoId: "todo-1",
        linkedTaskId: "task-1",
      },
      {
        action: "createTaskFromTodo",
        taskId: "__todo__",
        todoId: "todo-1",
      },
    ]);
  });

  test("ignores non-cockpit webview messages", () => {
    const handled = handleTodoCockpitWebviewMessage(
      { type: "refreshTasks" },
      () => {
        throw new Error("callback should not run");
      },
    );

    assert.strictEqual(handled, false);
  });
});