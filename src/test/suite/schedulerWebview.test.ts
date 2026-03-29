import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import * as vm from "vm";
import { messages } from "../../i18n";
import { SchedulerWebview } from "../../schedulerWebview";
import { getResourceScopedSettingsTarget } from "../../schedulerWebviewSettingsHandler";

type WebviewLike = {
  postMessage: (message: unknown) => Thenable<boolean>;
};

type WebviewPanelLike = {
  webview: WebviewLike;
};

suite("SchedulerWebview Message Queue Tests", () => {
  function loadBoardInteractionModule() {
    const scriptPath = path.resolve(
      __dirname,
      "../../../media/schedulerWebviewBoardInteractions.js",
    );
    const scriptSource = fs
      .readFileSync(scriptPath, "utf8")
      .replace(/^export\s+/gm, "");
    const context = vm.createContext({ result: undefined });
    const moduleScript = new vm.Script(
      `${scriptSource}\nresult = { getEventTargetElement, getClosestEventTarget, isBoardDragHandleTarget, isTodoInteractiveTarget, handleBoardTodoCompletion, bindBoardColumnInteractions };`,
      { filename: scriptPath },
    );
    moduleScript.runInContext(context);
    return context.result as {
      getEventTargetElement: (eventOrTarget: unknown) => unknown;
      getClosestEventTarget: (eventOrTarget: unknown, selector: string) => unknown;
      isBoardDragHandleTarget: (target: unknown) => boolean;
      isTodoInteractiveTarget: (target: unknown) => boolean;
      handleBoardTodoCompletion: (completeToggle: Record<string, unknown>, options: Record<string, unknown>) => void;
      bindBoardColumnInteractions: (options: Record<string, unknown>) => void;
    };
  }

  function createListenerTarget<T extends Record<string, unknown>>(base: T): T & {
    addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => void;
    listeners: Record<string, (event: Record<string, unknown>) => void>;
  } {
    const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
    return Object.assign(base, {
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
        listeners[name] = handler;
      },
      listeners,
    });
  }

  test("webview client script parses", () => {
    const scriptPath = path.resolve(
      __dirname,
      "../../../media/generated/schedulerWebview.js",
    );
    const scriptSource = fs.readFileSync(scriptPath, "utf8");

    assert.doesNotThrow(() => {
      new vm.Script(scriptSource, { filename: scriptPath });
    });
  });

  test("Queues messages until ready and flushes (dedup by type)", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      postMessage?: (message: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;

    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };

      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.postMessage === "function");
      assert.ok(typeof wv.flushPendingMessages === "function");

      wv.postMessage({ type: "updateTasks", tasks: [1] });
      wv.postMessage({ type: "updateTasks", tasks: [2] });
      wv.postMessage({ type: "updateAgents", agents: ["a"] });

      const queued = wv.pendingMessages as Array<{
        type?: unknown;
        [k: string]: unknown;
      }>;
      assert.strictEqual(queued.length, 2);

      const updateTasks = queued.find((m) => m.type === "updateTasks") as
        | { tasks?: unknown }
        | undefined;
      assert.ok(updateTasks);
      assert.deepStrictEqual(updateTasks?.tasks, [2]);

      wv.webviewReady = true;
      wv.flushPendingMessages();

      assert.strictEqual(sent.length, 2);

      const sentMessages = sent as Array<{
        type?: unknown;
        [k: string]: unknown;
      }>;
      const sentUpdateTasks = sentMessages.find(
        (m) => m.type === "updateTasks",
      ) as { tasks?: unknown } | undefined;
      assert.ok(sentUpdateTasks);
      assert.deepStrictEqual(sentUpdateTasks?.tasks, [2]);

      const sentUpdateAgents = sentMessages.find(
        (m) => m.type === "updateAgents",
      ) as { agents?: unknown } | undefined;
      assert.ok(sentUpdateAgents);
      assert.deepStrictEqual(sentUpdateAgents?.agents, ["a"]);

      assert.strictEqual((wv.pendingMessages ?? []).length, 0);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues schedule history updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateScheduleHistory?: (entries: unknown[]) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateScheduleHistory === "function");
      wv.updateScheduleHistory!([{ id: "1", createdAt: "2026-03-23T00:00:00.000Z", hasPrivate: true }]);

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateScheduleHistory");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as { type?: unknown; entries?: unknown[] };
      assert.strictEqual(message.type, "updateScheduleHistory");
      assert.strictEqual(Array.isArray(message.entries), true);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues research state updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateResearchState?: (
        profiles: unknown[],
        activeRun: unknown,
        recentRuns: unknown[],
      ) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateResearchState === "function");
      wv.updateResearchState!(
        [{ id: "profile-1", name: "Research" }],
        { id: "run-1", status: "running" },
        [{ id: "run-1", status: "running" }],
      );

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateResearchState");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        profiles?: unknown[];
        recentRuns?: unknown[];
        activeRun?: { id?: string };
      };
      assert.strictEqual(message.type, "updateResearchState");
      assert.strictEqual(Array.isArray(message.profiles), true);
      assert.strictEqual(Array.isArray(message.recentRuns), true);
      assert.strictEqual(message.activeRun?.id, "run-1");
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues Telegram notification updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateTelegramNotification?: (telegramNotification: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateTelegramNotification === "function");
      wv.updateTelegramNotification!({
        enabled: true,
        chatId: "123456789",
        hasBotToken: true,
        hookConfigured: true,
      });

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateTelegramNotification");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        telegramNotification?: { enabled?: boolean; hasBotToken?: boolean };
      };
      assert.strictEqual(message.type, "updateTelegramNotification");
      assert.strictEqual(message.telegramNotification?.enabled, true);
      assert.strictEqual(message.telegramNotification?.hasBotToken, true);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues execution default updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateExecutionDefaults?: (executionDefaults: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateExecutionDefaults === "function");
      wv.updateExecutionDefaults!({
        agent: "agent",
        model: "gpt-test",
      });

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateExecutionDefaults");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        executionDefaults?: { agent?: string; model?: string };
      };
      assert.strictEqual(message.type, "updateExecutionDefaults");
      assert.strictEqual(message.executionDefaults?.agent, "agent");
      assert.strictEqual(message.executionDefaults?.model, "gpt-test");
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("Queues cockpit board updates until ready", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      updateCockpitBoard?: (cockpitBoard: unknown) => void;
      flushPendingMessages?: () => void;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = false;
      wv.pendingMessages = [];

      assert.ok(typeof wv.updateCockpitBoard === "function");
      wv.updateCockpitBoard!({
        version: 1,
        sections: [{ id: "section_0", title: "Bugs", order: 0 }],
        cards: [{ id: "card_1", title: "Fix config leak", sectionId: "section_0", order: 0 }],
      });

      const queued = wv.pendingMessages as Array<{ type?: unknown }>;
      assert.strictEqual(queued.length, 1);
      assert.strictEqual(queued[0]?.type, "updateCockpitBoard");

      wv.webviewReady = true;
      wv.flushPendingMessages!();

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        cockpitBoard?: { sections?: unknown[]; cards?: unknown[] };
      };
      assert.strictEqual(message.type, "updateCockpitBoard");
      assert.strictEqual(message.cockpitBoard?.sections?.length, 1);
      assert.strictEqual(message.cockpitBoard?.cards?.length, 1);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("board target helpers resolve text-node button clicks", () => {
    const helpers = loadBoardInteractionModule();
    const button = {
      id: "edit-button",
      closest: (selector: string) => (selector === "[data-todo-edit]" ? button : null),
    };
    const textNode = {
      nodeType: 3,
      parentElement: button,
    };

    assert.strictEqual(
      helpers.getEventTargetElement({ target: textNode }),
      button,
    );
    assert.strictEqual(
      helpers.getClosestEventTarget({ target: textNode }, "[data-todo-edit]"),
      button,
    );
  });

  test("board drag-handle helper keeps drag handles draggable", () => {
    const helpers = loadBoardInteractionModule();
    const dragHandle = {
      closest: (selector: string) => {
        if (selector === "[data-todo-drag-handle], [data-section-drag-handle]") {
          return dragHandle;
        }
        if (selector.includes("[data-no-drag]")) {
          return dragHandle;
        }
        return null;
      },
    };
    const textNode = {
      nodeType: 3,
      parentElement: dragHandle,
    };

    assert.strictEqual(helpers.isBoardDragHandleTarget(textNode), true);
    assert.strictEqual(helpers.isTodoInteractiveTarget(textNode), true);
  });

  test("board target helpers treat custom todo action controls as interactive", () => {
    const helpers = loadBoardInteractionModule();
    const actionControl = {
      closest: (selector: string) => {
        if (selector.includes("[data-todo-delete]")) {
          return actionControl;
        }
        return null;
      },
    };

    assert.strictEqual(helpers.isTodoInteractiveTarget(actionControl), true);
  });

  test("board target helpers ignore plain non-interactive text nodes", () => {
    const helpers = loadBoardInteractionModule();
    const cardBody = {
      closest: () => null,
    };
    const textNode = {
      nodeType: 3,
      parentElement: cardBody,
    };

    assert.strictEqual(helpers.isTodoInteractiveTarget(textNode), false);
    assert.strictEqual(
      helpers.getClosestEventTarget({ target: textNode }, "[data-todo-delete]"),
      null,
    );
  });

  test("board interaction binding installs direct listeners and routes text-node edit clicks", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    const editButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-edit" ? "todo-1" : ""),
      closest: (selector: string) => (selector === "[data-todo-edit]" ? editButton : selector === "[data-todo-id]" ? null : null),
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === editButton || value === textNode,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-todo-edit]") return [editButton];
        return [];
      },
    });
    const textNode = {
      nodeType: 3,
      parentElement: editButton,
    };

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: (todoId: string) => calls.push(`edit:${todoId}`),
      openTodoDeleteModal: () => calls.push("delete"),
      handleSectionCollapse: () => calls.push("collapse"),
      handleSectionRename: () => calls.push("rename"),
      handleSectionDelete: () => calls.push("section-delete"),
      handleTodoCompletion: () => calls.push("complete"),
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: () => undefined,
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => undefined,
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof boardColumns.listeners.click === "function");
    assert.ok(typeof windowListeners.pointermove === "function");
    assert.ok(typeof windowListeners.pointerup === "function");

    boardColumns.listeners.click({
      target: textNode,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.deepStrictEqual(calls, ["edit:todo-1"]);
  });

  test("board interaction binding handles todo completion on click", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const checkbox = createListenerTarget({
      checked: true,
      getAttribute: (name: string) => (name === "data-todo-complete" ? "todo-1" : ""),
      closest: (selector: string) => (selector === "[data-todo-complete]" ? checkbox : null),
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === checkbox,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-todo-complete]") return [checkbox];
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: () => undefined,
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: () => calls.push("edit"),
      openTodoDeleteModal: () => calls.push("delete"),
      handleSectionCollapse: () => calls.push("collapse"),
      handleSectionRename: () => calls.push("rename"),
      handleSectionDelete: () => calls.push("section-delete"),
      handleTodoCompletion: () => calls.push("complete"),
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: () => undefined,
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => undefined,
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof boardColumns.listeners.click === "function");
    boardColumns.listeners.click({
      target: checkbox,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    assert.deepStrictEqual(calls, ["complete"]);
  });

  test("board todo completion approves active cards and finalizes ready cards", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const activeToggle = {
      checked: true,
      disabled: false,
      getAttribute: (name: string) => (name === "data-todo-complete" ? "todo-active" : ""),
      closest: () => null,
    };
    const readyCardElement = {
      style: {
        opacity: "",
        pointerEvents: "",
      },
    };
    const readyToggle = {
      checked: true,
      disabled: false,
      getAttribute: (name: string) => (name === "data-todo-complete" ? "todo-ready" : ""),
      closest: (selector: string) => (selector === "[data-todo-id]" ? readyCardElement : null),
    };

    helpers.handleBoardTodoCompletion(activeToggle, {
      cockpitBoard: {
        cards: [
          { id: "todo-active", status: "active" },
        ],
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
    });

    helpers.handleBoardTodoCompletion(readyToggle, {
      cockpitBoard: {
        cards: [
          { id: "todo-ready", status: "ready" },
        ],
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
    });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [
      { type: "approveTodo", todoId: "todo-active" },
      { type: "finalizeTodo", todoId: "todo-ready" },
    ]);
    assert.strictEqual(readyToggle.disabled, true);
    assert.strictEqual(readyCardElement.style.opacity, "0.35");
    assert.strictEqual(readyCardElement.style.pointerEvents, "none");
  });

  test("board interaction binding uses pointer drag for todo moves", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    const classAdds: string[] = [];
    const classRemoves: string[] = [];
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;
    const bodyClassToggles: string[] = [];
    const section = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-b";
        if (name === "data-card-count") return "3";
        return "";
      },
      classList: {
        add: (name: string) => classAdds.push(`section:${name}`),
        remove: (name: string) => classRemoves.push(`section:${name}`),
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? section : null),
    };
    const dropCard = {
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-2";
        if (name === "data-order") return "2";
        return "";
      },
      classList: {
        add: (name: string) => classAdds.push(`drop:${name}`),
        remove: (name: string) => classRemoves.push(`drop:${name}`),
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return dropCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-id" ? "todo-1" : ""),
      classList: {
        add: (name: string) => classAdds.push(`dragged:${name}`),
        remove: (name: string) => classRemoves.push(`dragged:${name}`),
      },
    });
    const dragHandle = {
      getAttribute: (name: string) => (name === "data-todo-drag-handle" ? "todo-1" : ""),
      closest: (selector: string) => {
        if (selector === "[data-todo-drag-handle]") return dragHandle;
        if (selector === "[data-todo-id]") return draggedCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const boardColumns = {
      contains: (value: unknown) => value === dragHandle || value === draggedCard || value === dropCard || value === section,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-section-id]") return [section];
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    };

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
        body: {
          classList: {
            toggle: (name: string, value: boolean) => {
              bodyClassToggles.push(`${name}:${value}`);
            },
          },
          style: {
            userSelect: "",
            webkitUserSelect: "",
            cursor: "",
          },
        },
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof draggedCard.listeners.pointerdown === "function");

    draggedCard.listeners.pointerdown({
      button: 0,
      target: dragHandle,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.strictEqual(draggingTodoId, "todo-1");
    assert.strictEqual(isBoardDragging, true);

    pointTarget = dropCard;
    windowListeners.pointermove({ clientX: 20, clientY: 30 });
    windowListeners.pointerup({ clientX: 20, clientY: 30 });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [{
      type: "moveTodo",
      todoId: "todo-1",
      sectionId: "section-b",
      targetIndex: 2,
    }]);
    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
    assert.ok(classAdds.includes("dragged:todo-dragging"));
    assert.ok(bodyClassToggles.includes("cockpit-board-dragging:true"));
    assert.ok(bodyClassToggles.includes("cockpit-board-dragging:false"));
  });

  test("board interaction binding starts todo drag from card body after movement threshold", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;
    const section = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-b";
        if (name === "data-card-count") return "3";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? section : null),
    };
    const dropCard = {
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-2";
        if (name === "data-order") return "2";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return dropCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-1";
        if (name === "data-section-id") return "section-a";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    });
    const cardBody = {
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    };
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === cardBody || value === draggedCard || value === dropCard || value === section,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-section-id]") return [section];
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    draggedCard.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: cardBody,
    });

    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);

    pointTarget = dropCard;
    windowListeners.pointermove({ clientX: 24, clientY: 24 });

    assert.strictEqual(draggingTodoId, "todo-1");
    assert.strictEqual(isBoardDragging, true);

    windowListeners.pointerup({ clientX: 24, clientY: 24 });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [{
      type: "moveTodo",
      todoId: "todo-1",
      sectionId: "section-b",
      targetIndex: 2,
    }]);
    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
  });

  test("board interaction binding does not start todo drag from todo action buttons", () => {
    const helpers = loadBoardInteractionModule();
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-1";
        if (name === "data-section-id") return "section-a";
        return "";
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    });
    const editButton = {
      closest: (selector: string) => {
        if (selector.includes("button") || selector.includes("[data-todo-edit]")) return editButton;
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    };
    const boardColumns = {
      contains: (value: unknown) => value === editButton || value === draggedCard,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    };

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    draggedCard.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: editButton,
    });

    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);

    if (windowListeners.pointermove) {
      windowListeners.pointermove({ clientX: 24, clientY: 24 });
    }

    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
  });

  test("board interaction binding suppresses follow-up click selection after drag", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;
    const section = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-b";
        if (name === "data-card-count") return "3";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? section : null),
    };
    const dropCard = {
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-2";
        if (name === "data-order") return "2";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return dropCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-1";
        if (name === "data-section-id") return "section-a";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    });
    const cardBody = {
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    };
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === cardBody || value === draggedCard || value === dropCard || value === section,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-section-id]") return [section];
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: () => undefined,
      },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    draggedCard.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: cardBody,
    });

    pointTarget = dropCard;
    windowListeners.pointermove({ clientX: 24, clientY: 24 });
    windowListeners.pointerup({ clientX: 24, clientY: 24 });

    assert.ok(typeof boardColumns.listeners.click === "function");

    boardColumns.listeners.click({
      target: draggedCard,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
  });
});

suite("SchedulerWebview Jobs Request Tests", () => {
  test("requestCreateJob uses VS Code input boxes and dispatches createJob", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalShowInputBox = (vscode.window as any).showInputBox;
    const actions: unknown[] = [];
    let promptCount = 0;

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      (vscode.window as any).showInputBox = async () => {
        promptCount += 1;
        return "Morning Review";
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestCreateJob",
        folderId: "folder-1",
      });

      assert.strictEqual(promptCount, 1);
      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "createJob",
        taskId: "__job__",
        jobData: {
          name: "Morning Review",
          cronExpression: "0 9 * * 1-5",
          folderId: "folder-1",
        },
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("requestDeleteJobFolder confirms before dispatching deleteJobFolder", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobFolders?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalFolders = wv.currentJobFolders;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobFolders = [{ id: "folder-1", name: "Ops" }];
      (vscode.window as any).showWarningMessage = async () => "Yes, delete";

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobFolder",
        folderId: "folder-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "deleteJobFolder",
        taskId: "__jobfolder__",
        folderId: "folder-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobFolders = originalFolders;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("requestDeleteJobTask can detach from workflow without deleting the task", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; taskId: string }>;
      }>;
      currentTasks?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalTasks = wv.currentTasks;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{ id: "job-1", nodes: [{ id: "node-1", taskId: "task-1" }] }];
      wv.currentTasks = [{ id: "task-1", name: "Review prompt" }];
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDetachOnly();

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobTask",
        jobId: "job-1",
        nodeId: "node-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "detachTaskFromJob",
        taskId: "__jobtask__",
        jobId: "job-1",
        nodeId: "node-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      wv.currentTasks = originalTasks;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("requestDeleteJobTask can delete the task entirely", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; taskId: string }>;
      }>;
      currentTasks?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalTasks = wv.currentTasks;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{ id: "job-1", nodes: [{ id: "node-1", taskId: "task-1" }] }];
      wv.currentTasks = [{ id: "task-1", name: "Review prompt" }];
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDeleteTask();

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobTask",
        jobId: "job-1",
        nodeId: "node-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "deleteJobTask",
        taskId: "__jobtask__",
        jobId: "job-1",
        nodeId: "node-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      wv.currentTasks = originalTasks;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("createJobPause and compileJob forward the expected task actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "createJobPause",
        jobId: "job-1",
        data: { title: "Review checkpoint" },
      });
      await wv.handleMessage!({
        type: "compileJob",
        jobId: "job-1",
      });

      assert.deepStrictEqual(actions, [
        {
          action: "createJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          pauseData: { title: "Review checkpoint" },
        },
        {
          action: "compileJob",
          taskId: "__job__",
          jobId: "job-1",
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("requestRenameJobPause and requestDeleteJobPause prompt before dispatching", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; type?: string; title?: string }>;
      }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalShowInputBox = (vscode.window as any).showInputBox;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{
        id: "job-1",
        nodes: [{ id: "pause-1", type: "pause", title: "Review" }],
      }];
      (vscode.window as any).showInputBox = async () => "Updated Review";
      (vscode.window as any).showWarningMessage = async () => "Yes, delete";

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestRenameJobPause",
        jobId: "job-1",
        nodeId: "pause-1",
      });
      await wv.handleMessage!({
        type: "requestDeleteJobPause",
        jobId: "job-1",
        nodeId: "pause-1",
      });

      assert.deepStrictEqual(actions, [
        {
          action: "updateJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          nodeId: "pause-1",
          pauseUpdateData: { title: "Updated Review" },
        },
        {
          action: "deleteJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          nodeId: "pause-1",
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("createTask and updateTask dispatch edit actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "createTask",
        data: { name: "New task", prompt: "Prompt", cronExpression: "* * * * *" },
      });
      await wv.handleMessage!({
        type: "updateTask",
        taskId: "task-1",
        data: { name: "Updated task" },
      });

      assert.deepStrictEqual(actions, [
        {
          action: "edit",
          taskId: "__create__",
          data: { name: "New task", prompt: "Prompt", cronExpression: "* * * * *" },
        },
        {
          action: "edit",
          taskId: "task-1",
          data: { name: "Updated task" },
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("settings messages dispatch the expected task actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({ type: "restoreScheduleHistory", snapshotId: "snap-1" });
      await wv.handleMessage!({ type: "toggleAutoShowOnStartup" });
      await wv.handleMessage!({ type: "setupMcp" });
      await wv.handleMessage!({ type: "syncBundledSkills" });
      await wv.handleMessage!({
        type: "saveTelegramNotification",
        data: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
      });
      await wv.handleMessage!({
        type: "testTelegramNotification",
        data: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
      });
      await wv.handleMessage!({
        type: "saveExecutionDefaults",
        data: { agent: "agent", model: "gpt-4o" },
      });

      assert.deepStrictEqual(actions, [
        {
          action: "restoreHistory",
          taskId: "__history__",
          historyId: "snap-1",
        },
        {
          action: "refresh",
          taskId: "__toggleAutoShowOnStartup__",
        },
        {
          action: "setupMcp",
          taskId: "__settings__",
        },
        {
          action: "syncBundledSkills",
          taskId: "__settings__",
        },
        {
          action: "saveTelegramNotification",
          taskId: "__settings__",
          telegramData: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
        },
        {
          action: "testTelegramNotification",
          taskId: "__settings__",
          telegramData: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
        },
        {
          action: "saveExecutionDefaults",
          taskId: "__settings__",
          executionDefaults: { agent: "agent", model: "gpt-4o" },
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("testPrompt invokes the configured callback", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTestPromptCallback?: ((prompt: string, agent?: string, model?: string) => void) | undefined;
    };

    const originalCallback = wv.onTestPromptCallback;
    const calls: Array<{ prompt: string; agent?: string; model?: string }> = [];

    try {
      wv.onTestPromptCallback = (prompt: string, agent?: string, model?: string) => {
        calls.push({ prompt, agent, model });
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "testPrompt",
        prompt: "Ping",
        agent: "agent",
        model: "gpt-4o",
      });

      assert.deepStrictEqual(calls, [
        { prompt: "Ping", agent: "agent", model: "gpt-4o" },
      ]);
    } finally {
      wv.onTestPromptCallback = originalCallback;
    }
  });

  test("refreshAgents and refreshPrompts post refreshed caches", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
      cachedAgents?: unknown[];
      cachedModels?: unknown[];
      cachedPromptTemplates?: unknown[];
      cachedSkillReferences?: unknown[];
      refreshAgentsAndModelsCache?: (force?: boolean) => Promise<void>;
      refreshPromptTemplatesCache?: (force?: boolean) => Promise<void>;
      refreshSkillReferencesCache?: (force?: boolean) => Promise<void>;
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;
    const originalAgents = wv.cachedAgents;
    const originalModels = wv.cachedModels;
    const originalTemplates = wv.cachedPromptTemplates;
    const originalSkills = wv.cachedSkillReferences;
    const originalRefreshAgents = wv.refreshAgentsAndModelsCache;
    const originalRefreshPrompts = wv.refreshPromptTemplatesCache;
    const originalRefreshSkills = wv.refreshSkillReferencesCache;
    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = true;
      wv.pendingMessages = [];
      wv.cachedAgents = [];
      wv.cachedModels = [];
      wv.cachedPromptTemplates = [];
      wv.cachedSkillReferences = [];
      wv.refreshAgentsAndModelsCache = async () => {
        wv.cachedAgents = [{ id: "agent" }];
        wv.cachedModels = [{ id: "gpt-4o" }];
      };
      wv.refreshPromptTemplatesCache = async () => {
        wv.cachedPromptTemplates = [{ path: "prompt.md" }];
      };
      wv.refreshSkillReferencesCache = async () => {
        wv.cachedSkillReferences = [{ path: "SKILL.md" }];
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({ type: "refreshAgents" });
      await wv.handleMessage!({ type: "refreshPrompts" });

      assert.deepStrictEqual(sent, [
        { type: "updateAgents", agents: [{ id: "agent" }] },
        { type: "updateModels", models: [{ id: "gpt-4o" }] },
        { type: "updatePromptTemplates", templates: [{ path: "prompt.md" }] },
        { type: "updateSkills", skills: [{ path: "SKILL.md" }] },
      ]);
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
      wv.cachedAgents = originalAgents;
      wv.cachedModels = originalModels;
      wv.cachedPromptTemplates = originalTemplates;
      wv.cachedSkillReferences = originalSkills;
      wv.refreshAgentsAndModelsCache = originalRefreshAgents;
      wv.refreshPromptTemplatesCache = originalRefreshPrompts;
      wv.refreshSkillReferencesCache = originalRefreshSkills;
    }
  });
});

suite("SchedulerWebview settings target Tests", () => {
  function setWorkspaceFolders(
    folders: Array<{ uri: vscode.Uri }> | undefined,
  ): () => void {
    const original = vscode.workspace.workspaceFolders;
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      value: folders,
      configurable: true,
    });
    return () => {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: original,
        configurable: true,
      });
    };
  }

  test("uses workspace target for resource-scoped settings when a folder is open", () => {
    const restore = setWorkspaceFolders([
      { uri: vscode.Uri.file(path.join(process.cwd(), "test-workspace")) },
    ]);

    try {
      assert.strictEqual(
        getResourceScopedSettingsTarget(),
        vscode.ConfigurationTarget.Workspace,
      );
    } finally {
      restore();
    }
  });

  test("falls back to global target when no workspace folder is open", () => {
    const restore = setWorkspaceFolders(undefined);

    try {
      assert.strictEqual(
        getResourceScopedSettingsTarget(),
        vscode.ConfigurationTarget.Global,
      );
    } finally {
      restore();
    }
  });
});

suite("SchedulerWebview Error Detail Sanitization Tests", () => {
  test("Sanitizes absolute paths to basenames (Windows and POSIX)", () => {
    const wv = SchedulerWebview as unknown as {
      sanitizeErrorDetailsForUser?: (message: string) => string;
    };

    assert.ok(typeof wv.sanitizeErrorDetailsForUser === "function");

    const sanitize = wv.sanitizeErrorDetailsForUser!;

    const win =
      "ENOENT: no such file or directory, open 'C:\\Users\\me\\secret folder\\a b.md'";
    const winOut = sanitize(win);
    assert.ok(!winOut.includes("C:\\Users\\me"));
    assert.ok(winOut.includes("'a b.md'"));

    const posix =
      "ENOENT: no such file or directory, open '/Users/me/secret folder/a b.md'";
    const posixOut = sanitize(posix);
    assert.ok(!posixOut.includes("/Users/me/secret folder"));
    assert.ok(posixOut.includes("'a b.md'"));

    const posixUnquoted = "open /Users/me/a.md";
    const posixUnquotedOut = sanitize(posixUnquoted);
    assert.ok(!posixUnquotedOut.includes("/Users/me/"));
    assert.ok(posixUnquotedOut.includes("a.md"));

    const posixParen = "at foo (/Users/me/a.md:1:2)";
    const posixParenOut = sanitize(posixParen);
    assert.ok(!posixParenOut.includes("/Users/me/"));
    assert.ok(posixParenOut.includes("(a.md:1:2)"));

    const winForward = "open C:/Users/me/a.md";
    const winForwardOut = sanitize(winForward);
    assert.ok(!winForwardOut.includes("C:/Users/me/"));
    assert.ok(winForwardOut.includes("a.md"));

    const uncPath = "open \\\\server\\share\\secret\\a.md";
    const uncOut = sanitize(uncPath);
    assert.ok(!uncOut.includes("\\\\server\\share"));
    assert.ok(uncOut.includes("a.md"));

    const fileUri = "open file:///C:/Users/me/secret%20folder/a%20b.md";
    const fileUriOut = sanitize(fileUri);
    assert.ok(!fileUriOut.includes("file:///C:/Users/me"));
    assert.ok(fileUriOut.includes("a b.md"));

    const fileUriHost = "open file://server/share/secret/a.md";
    const fileUriHostOut = sanitize(fileUriHost);
    assert.ok(!fileUriHostOut.includes("file://server/share"));
    assert.ok(fileUriHostOut.includes("a.md"));

    const webUrl = "see https://example.com/path";
    const webUrlOut = sanitize(webUrl);
    assert.strictEqual(webUrlOut, webUrl);
  });
});

suite("SchedulerWebview showError Sanitization Tests", () => {
  test("focusJob posts job selection message", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;

    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = true;
      wv.pendingMessages = [];

      SchedulerWebview.focusJob("job-1", "folder-1");

      assert.strictEqual(sent.length, 1);
      const message = sent[0] as {
        type?: unknown;
        jobId?: unknown;
        folderId?: unknown;
      };
      assert.strictEqual(message.type, "focusJob");
      assert.strictEqual(message.jobId, "job-1");
      assert.strictEqual(message.folderId, "folder-1");
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });

  test("showError sanitizes absolute paths before posting", () => {
    const wv = SchedulerWebview as unknown as {
      panel?: WebviewPanelLike;
      webviewReady?: boolean;
      pendingMessages?: unknown[];
    };

    const originalPanel = wv.panel;
    const originalReady = wv.webviewReady;
    const originalPending = wv.pendingMessages;

    const sent: unknown[] = [];

    try {
      wv.panel = {
        webview: {
          postMessage: (message: unknown) => {
            sent.push(message);
            return Promise.resolve(true);
          },
        },
      };
      wv.webviewReady = true;
      wv.pendingMessages = [];

      SchedulerWebview.showError(
        "ENOENT: no such file or directory, open 'C:\\Users\\me\\secret folder\\a b.md'",
      );

      assert.strictEqual(sent.length, 1);
      const m = sent[0] as { type?: unknown; text?: unknown };
      assert.strictEqual(m.type, "showError");
      assert.ok(typeof m.text === "string");
      assert.ok(!(m.text as string).includes("C:\\Users\\me"));
      assert.ok((m.text as string).includes("a b.md"));
    } finally {
      wv.panel = originalPanel;
      wv.webviewReady = originalReady;
      wv.pendingMessages = originalPending;
    }
  });
});
