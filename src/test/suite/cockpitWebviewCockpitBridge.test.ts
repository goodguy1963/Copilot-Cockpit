import * as assert from "assert";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import * as cockpitBridge from "../../cockpitWebviewCockpitBridge";
import type { CockpitBoard, CockpitTodoCard, TaskAction, WebviewToExtensionMessage } from "../../types";

suite("SchedulerWebview Cockpit Bridge Tests", () => {
  test("creates outgoing cockpit update messages", () => {
    const board = createDefaultCockpitBoard("2026-03-29T08:00:00.000Z");

    assert.deepStrictEqual(cockpitBridge.createUpdateCockpitBoardMessage(board), {
      type: "updateCockpitBoard",
      cockpitBoard: board,
    });
    assert.deepStrictEqual(cockpitBridge.createStartCreateTodoMessage(), {
      type: "startCreateTodo",
    });
  });

  test("creates board update messages with latest-comment previews instead of full threads", () => {
    const board = createDefaultCockpitBoard("2026-03-29T08:00:00.000Z") as CockpitBoard;
    const sectionId = board.sections[0]?.id ?? "inbox";
    const card: CockpitTodoCard = {
      id: "todo-1",
      title: "Heavy thread",
      sectionId,
      order: 1,
      priority: "medium",
      status: "active",
      labels: [],
      flags: ["needs-user-review"],
      comments: [
        { id: "c1", author: "user", body: "first", source: "human-form", sequence: 1, createdAt: "2026-03-29T08:00:00.000Z" },
        { id: "c2", author: "system", body: "latest", source: "bot-manual", sequence: 2, createdAt: "2026-03-29T09:00:00.000Z" },
      ],
      createdAt: "2026-03-29T08:00:00.000Z",
      updatedAt: "2026-03-29T09:00:00.000Z",
    };
    board.cards = [card];

    const message = cockpitBridge.createUpdateCockpitBoardMessage(board);
    const payloadCard = (message.cockpitBoard as CockpitBoard).cards[0] as CockpitTodoCard & { commentCount?: number };

    assert.notStrictEqual(message.cockpitBoard, board);
    assert.strictEqual(payloadCard.comments.length, 1);
    assert.strictEqual(payloadCard.comments[0]?.body, "latest");
    assert.strictEqual(payloadCard.commentCount, 2);
    assert.strictEqual(card.comments.length, 2);
  });

  test("creates full todo details messages from the cached board", () => {
    const board = createDefaultCockpitBoard("2026-03-29T08:00:00.000Z") as CockpitBoard;
    const sectionId = board.sections[0]?.id ?? "inbox";
    board.cards = [{
      id: "todo-1",
      title: "Full thread",
      sectionId,
      order: 1,
      priority: "medium",
      status: "active",
      labels: [],
      flags: [],
      comments: [
        { id: "c1", author: "user", body: "first", source: "human-form", sequence: 1, createdAt: "2026-03-29T08:00:00.000Z" },
        { id: "c2", author: "system", body: "second", source: "bot-manual", sequence: 2, createdAt: "2026-03-29T09:00:00.000Z" },
      ],
      createdAt: "2026-03-29T08:00:00.000Z",
      updatedAt: "2026-03-29T09:00:00.000Z",
    }];

    const createTodoDetailsMessage = (cockpitBridge as typeof cockpitBridge & {
      createTodoDetailsMessage?: (board: CockpitBoard, todoId: string) => unknown;
    }).createTodoDetailsMessage;

    assert.strictEqual(typeof createTodoDetailsMessage, "function");
    if (typeof createTodoDetailsMessage !== "function") {
      throw new Error("createTodoDetailsMessage missing");
    }
    assert.deepStrictEqual(createTodoDetailsMessage(board, "todo-1"), {
      type: "updateTodoDetails",
      todo: board.cards[0],
    });
    assert.deepStrictEqual(createTodoDetailsMessage(board, "missing"), {
      type: "updateTodoDetails",
      todoId: "missing",
      todo: null,
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

    const handledFinalize = cockpitBridge.handleTodoCockpitWebviewMessage(
      finalizeMessage,
      (action) => received.push(action),
    );
    const handledMoveSection = cockpitBridge.handleTodoCockpitWebviewMessage(
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

    const handledLink = cockpitBridge.handleTodoCockpitWebviewMessage(
      { type: "linkTodoTask", todoId: "todo-1", taskId: "task-1" },
      (action) => received.push(action),
    );
    const handledCreate = cockpitBridge.handleTodoCockpitWebviewMessage(
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
    const handled = cockpitBridge.handleTodoCockpitWebviewMessage(
      { type: "refreshTasks" },
      () => {
        throw new Error("callback should not run");
      },
    );

    assert.strictEqual(handled, false);
  });
});
