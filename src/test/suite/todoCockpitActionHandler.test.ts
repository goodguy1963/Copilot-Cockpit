import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import { createCockpitTodo } from "../../cockpitBoardManager";
import { readSchedulerConfig } from "../../schedulerJsonSanitizer";
import { SchedulerWebview } from "../../schedulerWebview";
import { handleTodoCockpitAction } from "../../todoCockpitActionHandler";
import type { CockpitBoard, CreateTaskInput } from "../../types";

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
      createTask: async (_input: CreateTaskInput) => ({ id: "task-1", name: "Task" }),
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