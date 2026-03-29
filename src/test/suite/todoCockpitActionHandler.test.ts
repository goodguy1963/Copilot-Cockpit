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
        version: 2,
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
        },
        updatedAt: "",
      }) as CockpitBoard,
      createTask: async (_input: CreateTaskInput) => ({ id: "task-1", name: "Task" }),
      removeLabelFromAllTasks: async () => undefined,
      refreshSchedulerUiState: () => undefined,
      notifyError: (_message: string) => undefined,
      notifyInfo: (_message: string) => undefined,
      showError: (_message: string) => undefined,
      noWorkspaceOpenMessage: "No workspace",
    };
  }

  test("updateTodo keeps the active todo editor context", async () => {
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
      assert.strictEqual(startCreateTodoCalls, 0);
      assert.deepStrictEqual(switchedTabs, []);
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
});