import * as fs from "fs";
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import { createCockpitTodo } from "../../cockpitBoardManager";
import { readSchedulerConfig } from "../../cockpitJsonSanitizer";
import { SchedulerWebview } from "../../cockpitWebview";
import { handleTodoCockpitAction } from "../../todoCockpitActionHandler";
import type { CockpitBoard, CreateTaskInput, ExecuteOptions } from "../../types";

suite("Todo Cockpit Action Handler", () => {
  function createWorkspaceRoot(): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), "todo-cockpit-handler-"));
  }

  function createDeps(workspaceRoot: string) {
    return {
      getPrimaryWorkspaceRootPath: () => workspaceRoot,
      getCurrentCockpitBoard: () => ({
        version: 4,
        sections: [],
        cards: [],
        labelCatalog: [],
        archives: { completedSuccessfully: [], rejected: [] },
        filters: {
          labels: [],
          priorities: [],
          statuses: [],
          archiveOutcomes: [],
          flags: [],
          sortBy: "manual",
          sortDirection: "asc",
          viewMode: "board",
          showArchived: false,
          showRecurringTasks: false,
          hideCardDetails: false,
        },
        updatedAt: "",
      }) as CockpitBoard,
      getCurrentTasks: () => [],
      getReviewDefaults: () => ({
        needsBotReviewCommentTemplate: "Needs bot review",
        needsBotReviewPromptTemplate: "BOT\n{{todo_context}}\n\n{{mcp_skill_guidance}}",
        needsBotReviewAgent: "agent",
        needsBotReviewModel: "gpt-5",
        needsBotReviewChatSession: "new" as const,
        readyPromptTemplate: "READY\n{{todo_context}}\n\n{{mcp_skill_guidance}}",
      }),
      executeBotReviewPrompt: async (_prompt: string, _options: ExecuteOptions) => undefined,
      createTask: async (_input: CreateTaskInput) => ({ id: "task-1", name: "Task" }),
      deleteTask: async (_taskId: string) => true,
      removeLabelFromAllTasks: async () => undefined,
      refreshSchedulerUiState: () => undefined,
      notifyError: (_message: string) => undefined,
      notifyInfo: (_message: string) => undefined,
      showError: (_message: string) => undefined,
      noWorkspaceOpenMessage: "No workspace",
    };
  }

  test("updateTodo returns to the board and resets the todo editor", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const webview = SchedulerWebview as unknown as {
      startCreateTodo: () => void;
      switchToTab: (tab: string) => void;
    };
    const originalStartCreateTodo = webview.startCreateTodo;
    const originalSwitchToTab = webview.switchToTab;
    let startCreateTodoCalls = 0;
    const switchedTabs: string[] = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Todo",
        sectionId: "",
        priority: "low",
      });

      webview.startCreateTodo = () => {
        startCreateTodoCalls += 1;
      };
      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { title: "Updated Todo", priority: "high" },
        },
        createDeps(workspaceRoot),
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(startCreateTodoCalls, 1);
      assert.deepStrictEqual(switchedTabs, ["board"]);
    } finally {
      webview.startCreateTodo = originalStartCreateTodo;
      webview.switchToTab = originalSwitchToTab;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("updateTodo entering ready opens the task draft editor", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const webview = SchedulerWebview as unknown as {
      startCreateTodo: () => void;
      switchToTab: (tab: string) => void;
      editTask: (taskId?: string) => void;
    };
    const originalStartCreateTodo = webview.startCreateTodo;
    const originalSwitchToTab = webview.switchToTab;
    const originalEditTask = webview.editTask;
    let startCreateTodoCalls = 0;
    const switchedTabs: string[] = [];
    const editedTaskIds: string[] = [];
    const createdTaskInputs: CreateTaskInput[] = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Todo",
        sectionId: "",
        priority: "low",
        flags: ["needs-user-review"],
      });

      webview.startCreateTodo = () => {
        startCreateTodoCalls += 1;
      };
      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };
      webview.editTask = (taskId?: string) => {
        if (taskId) {
          editedTaskIds.push(taskId);
        }
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { flags: ["ready"] },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard,
          createTask: async (input: CreateTaskInput) => {
            createdTaskInputs.push(input);
            return { id: "task-draft-2", name: input.name };
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(startCreateTodoCalls, 0);
      assert.deepStrictEqual(switchedTabs, []);
      assert.deepStrictEqual(editedTaskIds, ["task-draft-2"]);
      assert.strictEqual(createdTaskInputs.length, 1);

      const board = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      const updatedTodo = board.cards.find((card) => card.id === created.todo.id);
      assert.strictEqual(updatedTodo?.taskId, "task-draft-2");
      assert.deepStrictEqual(updatedTodo?.flags, ["ready"]);
    } finally {
      webview.startCreateTodo = originalStartCreateTodo;
      webview.switchToTab = originalSwitchToTab;
      webview.editTask = originalEditTask;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("addTodoComment keeps the active todo editor open", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const webview = SchedulerWebview as unknown as {
      switchToTab: (tab: string) => void;
    };
    const originalSwitchToTab = webview.switchToTab;
    const switchedTabs: string[] = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Todo",
        sectionId: "",
        priority: "low",
      });

      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "addTodoComment",
          taskId: "",
          todoId: created.todo.id,
          todoCommentData: { body: "Keep editor open", author: "user", source: "human-form" },
        },
        createDeps(workspaceRoot),
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(switchedTabs, []);
    } finally {
      webview.switchToTab = originalSwitchToTab;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("createTodo seeds the configured needs-bot-review comment when created in needs-bot-review", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const handled = await handleTodoCockpitAction(
        {
          action: "createTodo",
          taskId: "",
          todoData: {
            title: "Needs review",
            sectionId: "",
            priority: "low",
            flags: ["needs-bot-review"],
          },
        },
        createDeps(workspaceRoot),
      );

      assert.strictEqual(handled, true);
      const board = readSchedulerConfig(workspaceRoot).cockpitBoard;
      const createdTodo = board?.cards.find((card) => card.title === "Needs review");
      assert.ok(createdTodo);
      assert.ok(
        createdTodo?.comments?.some((comment) =>
          comment.body === "Needs bot review"
          && Array.isArray(comment.labels)
          && comment.labels.includes("needs-bot-review-template")
        ),
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("createTodo launches bot review immediately when created in needs-bot-review", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const launches: Array<{ prompt: string; options: ExecuteOptions }> = [];

    try {
      const handled = await handleTodoCockpitAction(
        {
          action: "createTodo",
          taskId: "",
          todoData: {
            title: "Review me",
            description: "Inspect this todo",
            sectionId: "",
            priority: "low",
            labels: ["alpha"],
            flags: ["needs-bot-review"],
          },
        },
        {
          ...createDeps(workspaceRoot),
          executeBotReviewPrompt: async (prompt: string, options: ExecuteOptions) => {
            launches.push({ prompt, options });
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(launches.length, 1);
      assert.ok(launches[0]?.prompt.includes("BOT"));
      assert.ok(launches[0]?.prompt.includes("Todo title: Review me"));
      assert.ok(launches[0]?.prompt.includes("Inspect this todo"));
      assert.ok(launches[0]?.prompt.includes("alpha"));
      assert.ok(launches[0]?.prompt.includes("MCP and skill usage guidance:"));
      assert.deepStrictEqual(launches[0]?.options, {
        agent: "agent",
        model: "gpt-5",
        chatSession: "new",
      });
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("updateTodo seeds the configured needs-bot-review comment only when entering needs-bot-review", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Review later",
        sectionId: "",
        priority: "low",
        flags: ["new"],
      });

      const boardBeforeUpdate = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      const handled = await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { flags: ["needs-bot-review"] },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => boardBeforeUpdate,
        },
      );

      assert.strictEqual(handled, true);
      let board = readSchedulerConfig(workspaceRoot).cockpitBoard;
      let updatedTodo = board?.cards.find((card) => card.id === created.todo.id);
      assert.strictEqual(
        updatedTodo?.comments?.filter((comment) => comment.body === "Needs bot review").length,
        1,
      );

      const boardBeforeSecondUpdate = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { description: "Minor edit" },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => boardBeforeSecondUpdate,
        },
      );

      board = readSchedulerConfig(workspaceRoot).cockpitBoard;
      updatedTodo = board?.cards.find((card) => card.id === created.todo.id);
      assert.strictEqual(
        updatedTodo?.comments?.filter((comment) => comment.body === "Needs bot review").length,
        1,
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("needs-user-review does not seed the needs-bot-review comment or launch bot review", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const launches: Array<{ prompt: string; options: ExecuteOptions }> = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "User review first",
        sectionId: "",
        priority: "low",
        flags: ["new"],
      });

      const boardBeforeUpdate = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { flags: ["needs-user-review"] },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => boardBeforeUpdate,
          executeBotReviewPrompt: async (prompt: string, options: ExecuteOptions) => {
            launches.push({ prompt, options });
          },
        },
      );

      const board = readSchedulerConfig(workspaceRoot).cockpitBoard;
      const updatedTodo = board?.cards.find((card) => card.id === created.todo.id);
      assert.strictEqual(
        updatedTodo?.comments?.filter((comment) => comment.body === "Needs bot review").length,
        0,
      );
      assert.strictEqual(launches.length, 0);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("updateTodo launches bot review only on transition into needs-bot-review", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const launches: Array<{ prompt: string; options: ExecuteOptions }> = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Review transition",
        description: "Body",
        sectionId: "",
        priority: "low",
        flags: ["new"],
      });

      const boardBeforeUpdate = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { flags: ["needs-bot-review"] },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => boardBeforeUpdate,
          executeBotReviewPrompt: async (prompt: string, options: ExecuteOptions) => {
            launches.push({ prompt, options });
          },
        },
      );

      const boardBeforeSecondUpdate = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      await handleTodoCockpitAction(
        {
          action: "updateTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { description: "Still reviewing" },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => boardBeforeSecondUpdate,
          executeBotReviewPrompt: async (prompt: string, options: ExecuteOptions) => {
            launches.push({ prompt, options });
          },
        },
      );

      assert.strictEqual(launches.length, 1);
      assert.ok(launches[0]?.prompt.includes("Review transition"));
      assert.ok(launches[0]?.prompt.includes("MCP and skill usage guidance:"));
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("deleteTodo removes a linked draft task before archiving the todo", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const deletedTaskIds: string[] = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Draft-backed todo",
        sectionId: "",
        priority: "low",
        taskId: "task-draft-1",
        flags: ["ready"],
      });

      const handled = await handleTodoCockpitAction(
        {
          action: "deleteTodo",
          taskId: "",
          todoId: created.todo.id,
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard,
          getCurrentTasks: () => [{
            id: "task-draft-1",
            name: "Draft task",
            createdAt: new Date(),
            updatedAt: new Date(),
            cronExpression: "0 9 * * 1-5",
            prompt: "Draft",
            enabled: false,
            oneTime: true,
            scope: "workspace",
            promptSource: "inline",
            labels: ["from-todo-cockpit"],
          }],
          deleteTask: async (taskId: string) => {
            deletedTaskIds.push(taskId);
            return true;
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(deletedTaskIds, ["task-draft-1"]);

      const board = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      const archivedTodo = board.cards.find((card) => card.id === created.todo.id);
      assert.ok(archivedTodo?.archived);
      assert.strictEqual(archivedTodo?.status, "rejected");
      assert.ok(
        archivedTodo?.comments.some((comment) => comment.body.includes("Deleted linked task draft")),
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("createTaskFromTodo uses the ready prompt with Todo context and MCP guidance", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const createdTaskInputs: CreateTaskInput[] = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Ready todo",
        description: "Ship the actual task draft",
        sectionId: "",
        priority: "low",
        labels: ["ops"],
        flags: ["ready"],
      });

      const boardBeforeAction = readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard;
      const handled = await handleTodoCockpitAction(
        {
          action: "createTaskFromTodo",
          taskId: "",
          todoId: created.todo.id,
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => boardBeforeAction,
          createTask: async (input: CreateTaskInput) => {
            createdTaskInputs.push(input);
            return { id: "task-1", name: input.name };
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(createdTaskInputs.length, 1);
      assert.ok(createdTaskInputs[0]?.prompt.includes("READY"));
      assert.ok(createdTaskInputs[0]?.prompt.includes("Todo title: Ready todo"));
      assert.ok(createdTaskInputs[0]?.prompt.includes("Ship the actual task draft"));
      assert.ok(createdTaskInputs[0]?.prompt.includes("ops"));
      assert.ok(createdTaskInputs[0]?.prompt.includes("MCP and skill usage guidance:"));
      assert.ok(createdTaskInputs[0]?.prompt.includes("Treat Todo Cockpit cards and scheduled tasks as separate artifacts"));
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("createTodo clears hiding filters so the new card is visible in the board", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const seededBoard = createDefaultCockpitBoard();
    seededBoard.filters = {
      searchText: seededBoard.filters?.searchText,
      labels: ["bug"],
      priorities: seededBoard.filters?.priorities ?? [],
      statuses: seededBoard.filters?.statuses ?? [],
      archiveOutcomes: seededBoard.filters?.archiveOutcomes ?? [],
      flags: seededBoard.filters?.flags ?? [],
      sectionId: seededBoard.filters?.sectionId,
      sortBy: seededBoard.filters?.sortBy ?? "manual",
      sortDirection: seededBoard.filters?.sortDirection ?? "asc",
      viewMode: seededBoard.filters?.viewMode ?? "board",
      showArchived: seededBoard.filters?.showArchived === true,
      showRecurringTasks: seededBoard.filters?.showRecurringTasks === true,
      hideCardDetails: seededBoard.filters?.hideCardDetails === true,
    };

    const webview = SchedulerWebview as unknown as {
      startCreateTodo: () => void;
      switchToTab: (tab: string) => void;
    };
    const originalStartCreateTodo = webview.startCreateTodo;
    const originalSwitchToTab = webview.switchToTab;
    const switchedTabs: string[] = [];
    let startCreateTodoCalls = 0;

    try {
      webview.startCreateTodo = () => {
        startCreateTodoCalls += 1;
      };
      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "createTodo",
          taskId: "",
          todoData: {
            title: "Fresh todo",
            description: "Should still be visible",
            priority: "none",
            sectionId: "unsorted",
            labels: [],
          },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => seededBoard,
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(startCreateTodoCalls, 1);
      assert.deepStrictEqual(switchedTabs, ["board"]);

      const savedBoard = readSchedulerConfig(workspaceRoot).cockpitBoard;
      assert.ok(savedBoard);
      assert.deepStrictEqual(savedBoard?.filters?.labels ?? [], []);
      assert.ok(
        savedBoard?.cards.some((card) => card.title === "Fresh todo"),
      );
    } finally {
      webview.startCreateTodo = originalStartCreateTodo;
      webview.switchToTab = originalSwitchToTab;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("setTodoFilters skips refresh when the effective filters are unchanged", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const seededBoard = createDefaultCockpitBoard();
    const webview = SchedulerWebview as unknown as {
      switchToTab: (tab: string) => void;
    };
    const originalSwitchToTab = webview.switchToTab;
    const switchedTabs: string[] = [];
    let refreshCalls = 0;

    try {
      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "setTodoFilters",
          taskId: "",
          todoFilters: {
            searchText: "",
            labels: [],
            priorities: [],
            statuses: [],
            archiveOutcomes: [],
            flags: [],
            sectionId: "",
            sortBy: "manual",
            sortDirection: "asc",
            viewMode: "board",
            showArchived: false,
            showRecurringTasks: false,
            hideCardDetails: false,
          },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => seededBoard,
          refreshSchedulerUiState: () => {
            refreshCalls += 1;
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(refreshCalls, 0);
      assert.deepStrictEqual(switchedTabs, []);
    } finally {
      webview.switchToTab = originalSwitchToTab;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("setTodoFilters triggers one immediate scheduler refresh after persisting recurring visibility", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const seededBoard = createDefaultCockpitBoard();
    const webview = SchedulerWebview as unknown as {
      switchToTab: (tab: string) => void;
    };
    const originalSwitchToTab = webview.switchToTab;
    const switchedTabs: string[] = [];
    const refreshCalls: boolean[] = [];

    try {
      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "setTodoFilters",
          taskId: "",
          todoFilters: {
            showRecurringTasks: true,
            hideCardDetails: true,
          },
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => seededBoard,
          refreshSchedulerUiState: (immediate?: boolean) => {
            refreshCalls.push(immediate === true);
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(refreshCalls, [true]);
      assert.deepStrictEqual(switchedTabs, ["board"]);
      assert.strictEqual(
        readSchedulerConfig(workspaceRoot).cockpitBoard?.filters?.showRecurringTasks,
        true,
      );
      assert.strictEqual(
        readSchedulerConfig(workspaceRoot).cockpitBoard?.filters?.hideCardDetails,
        true,
      );
    } finally {
      webview.switchToTab = originalSwitchToTab;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("archiveTodo with archived false restores an archived card", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const webview = SchedulerWebview as unknown as {
      switchToTab: (tab: string) => void;
    };
    const originalSwitchToTab = webview.switchToTab;
    const switchedTabs: string[] = [];

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Restore me",
        sectionId: "",
        priority: "low",
      });

      await handleTodoCockpitAction(
        {
          action: "rejectTodo",
          taskId: "",
          todoId: created.todo.id,
        },
        createDeps(workspaceRoot),
      );

      webview.switchToTab = (tab: string) => {
        switchedTabs.push(tab);
      };

      const handled = await handleTodoCockpitAction(
        {
          action: "archiveTodo",
          taskId: "",
          todoId: created.todo.id,
          todoData: { archived: false },
        },
        createDeps(workspaceRoot),
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(switchedTabs, ["board"]);

      const restored = readSchedulerConfig(workspaceRoot).cockpitBoard?.cards.find(
        (card) => card.id === created.todo.id,
      );
      assert.ok(restored);
      assert.strictEqual(restored?.archived, false);
      assert.strictEqual(restored?.status, "active");
      assert.strictEqual(restored?.archiveOutcome, undefined);
    } finally {
      webview.switchToTab = originalSwitchToTab;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("linkTodoTask keeps ready when the linked one-time task is still draft-only", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Draft todo",
        sectionId: "unsorted",
        priority: "medium",
        flags: ["ready"],
      });

      const handled = await handleTodoCockpitAction(
        {
          action: "linkTodoTask",
          taskId: "",
          todoId: created.todo.id,
          linkedTaskId: "task-draft",
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard,
          getCurrentTasks: () => [{
            id: "task-draft",
            name: "Draft task",
            cronExpression: "0 9 * * 1-5",
            prompt: "Do the work",
            enabled: false,
            oneTime: true,
            scope: "workspace",
            promptSource: "inline",
            createdAt: new Date("2026-04-05T00:00:00.000Z"),
            updatedAt: new Date("2026-04-05T00:05:00.000Z"),
          }],
        },
      );

      assert.strictEqual(handled, true);
      const linked = readSchedulerConfig(workspaceRoot).cockpitBoard?.cards.find(
        (card) => card.id === created.todo.id,
      );
      assert.strictEqual(linked?.taskId, "task-draft");
      assert.deepStrictEqual(linked?.flags, ["ready"]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("linkTodoTask moves to ON-SCHEDULE-LIST when the linked one-time task is enabled", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const created = createCockpitTodo(workspaceRoot, {
        title: "Scheduled todo",
        sectionId: "unsorted",
        priority: "medium",
        flags: ["ready"],
      });

      const handled = await handleTodoCockpitAction(
        {
          action: "linkTodoTask",
          taskId: "",
          todoId: created.todo.id,
          linkedTaskId: "task-enabled",
        },
        {
          ...createDeps(workspaceRoot),
          getCurrentCockpitBoard: () => readSchedulerConfig(workspaceRoot).cockpitBoard as CockpitBoard,
          getCurrentTasks: () => [{
            id: "task-enabled",
            name: "Enabled task",
            cronExpression: "0 9 * * 1-5",
            prompt: "Do the work",
            enabled: true,
            oneTime: true,
            scope: "workspace",
            promptSource: "inline",
            createdAt: new Date("2026-04-05T00:00:00.000Z"),
            updatedAt: new Date("2026-04-05T00:05:00.000Z"),
          }],
        },
      );

      assert.strictEqual(handled, true);
      const linked = readSchedulerConfig(workspaceRoot).cockpitBoard?.cards.find(
        (card) => card.id === created.todo.id,
      );
      assert.strictEqual(linked?.taskId, "task-enabled");
      assert.deepStrictEqual(linked?.flags, ["ON-SCHEDULE-LIST"]);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
