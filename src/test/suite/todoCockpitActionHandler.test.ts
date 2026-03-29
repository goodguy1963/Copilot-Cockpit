import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createCockpitTodo } from "../../cockpitBoardManager";
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
});