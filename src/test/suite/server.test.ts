import * as fs from "fs";
import * as os from "os";
import * as assert from "assert";
import * as path from "path";
import {
  createDefaultCockpitBoard,
  DEFAULT_ARCHIVE_REJECTED_SECTION_ID,
} from "../../cockpitBoard";
import { writeSchedulerConfig } from "../../cockpitJsonSanitizer";
import {
  MCP_TOOL_DEFINITIONS,
  handleSchedulerToolCall,
  readSchedulerServerConfigForWorkspace,
  writeSchedulerServerConfigForWorkspace,
} from "../../server";
import {
  readWorkspaceCockpitBoardFromSqlite,
  readWorkspaceSchedulerStateFromSqlite,
  syncWorkspaceCockpitBoardToSqlite,
  syncWorkspaceSchedulerStateToSqlite,
} from "../../sqliteBootstrap";

function parseJsonText(result: any): any {
  assert.ok(result);
  assert.ok(Array.isArray(result.content));
  assert.strictEqual(result.content[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

function createServerContext(initialConfig?: { tasks?: any[]; jobs?: any[]; jobFolders?: any[]; cockpitBoard?: any; telegramNotification?: any }) {
  let currentConfig = JSON.parse(
    JSON.stringify(initialConfig || { tasks: [], jobs: [], jobFolders: [] }),
  );
  const createdSnapshots: Array<{ publicConfig: any; privateConfig: any }> = [];
  const snapshots = new Map<string, { publicConfig?: any; privateConfig?: any }>();
  const historyEntries: Array<{ id: string; createdAt: string; hasPrivate: boolean }> = [];

  return {
    context: {
      workspaceRoot: "/tmp/workspace",
      historyRoot: "/tmp/workspace/.vscode/scheduler-history",
      readConfig: () => JSON.parse(JSON.stringify(currentConfig)),
      writeConfig: (config: { tasks: any[]; jobs?: any[]; jobFolders?: any[] }) => {
        currentConfig = JSON.parse(JSON.stringify(config));
      },
      listHistory: () => historyEntries.slice(),
      readHistorySnapshot: (snapshotId: string) => snapshots.get(snapshotId),
      createHistorySnapshot: (publicConfig: any, privateConfig: any) => {
        createdSnapshots.push({
          publicConfig: JSON.parse(JSON.stringify(publicConfig)),
          privateConfig: JSON.parse(JSON.stringify(privateConfig)),
        });
      },
      readCurrentConfigs: () => ({
        publicConfig: JSON.parse(JSON.stringify(currentConfig)),
        privateConfig: JSON.parse(JSON.stringify(currentConfig)),
      }),
    },
    getConfig: () => JSON.parse(JSON.stringify(currentConfig)),
    createdSnapshots,
    historyEntries,
    snapshots,
  };
}

function createTempWorkspace(): string {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cockpit-server-"));
  fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
  fs.writeFileSync(
    path.join(workspaceRoot, ".vscode", "settings.json"),
    JSON.stringify({ "copilotCockpit.storageMode": "sqlite" }, null, 2),
    "utf8",
  );
  return workspaceRoot;
}

suite("Scheduler MCP Server Tests", () => {
  test("server workspace writes sync sqlite when sqlite mode is enabled", async () => {
    const workspaceRoot = createTempWorkspace();
    try {
      const board = createDefaultCockpitBoard();
      assert.ok(board.filters);
      board.filters.showRecurringTasks = true;

      await writeSchedulerServerConfigForWorkspace(workspaceRoot, {
        tasks: [
          {
            id: "demo-task",
            name: "Demo task",
            cron: "15 0 * * *",
            prompt: "Run the demo loop.",
            enabled: true,
          },
        ],
        jobs: [],
        jobFolders: [],
        cockpitBoard: board,
      });

      const schedulerState = await readWorkspaceSchedulerStateFromSqlite(workspaceRoot);
      const cockpitBoard = await readWorkspaceCockpitBoardFromSqlite(workspaceRoot);

      assert.strictEqual(schedulerState.tasks.length, 1);
      assert.strictEqual((schedulerState.tasks[0] as any).id, "demo-task");
      assert.ok(cockpitBoard);
      assert.ok(cockpitBoard?.filters);
      assert.strictEqual(cockpitBoard.filters.showRecurringTasks, true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("server workspace reads prefer sqlite authority when sqlite mode is enabled", async () => {
    const workspaceRoot = createTempWorkspace();
    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [
          {
            id: "json-task",
            name: "JSON task",
            cron: "0 0 * * *",
            prompt: "Read from json.",
          },
        ],
        jobs: [],
        jobFolders: [],
        cockpitBoard: createDefaultCockpitBoard(),
      });

      const sqliteBoard = createDefaultCockpitBoard();
      sqliteBoard.cards.push({
        id: "todo-live",
        title: "Live todo",
        sectionId: sqliteBoard.sections[0].id,
        order: 0,
        priority: "medium",
        status: "active",
        labels: ["scheduled-task"],
        flags: ["ON-SCHEDULE-LIST"],
        comments: [],
        archived: false,
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
      } as any);

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [
          {
            id: "sqlite-task",
            name: "SQLite task",
            cron: "30 1 * * *",
            prompt: "Read from sqlite.",
          },
        ],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      });
      await syncWorkspaceCockpitBoardToSqlite(workspaceRoot, sqliteBoard);

      const config = await readSchedulerServerConfigForWorkspace(workspaceRoot);

      assert.deepStrictEqual(config.tasks.map((task) => task.id), ["sqlite-task"]);
      assert.strictEqual(config.cockpitBoard?.cards[0]?.id, "todo-live");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("exports the expanded MCP tool set", () => {
    const toolNames = MCP_TOOL_DEFINITIONS.map((tool) => tool.name);

    assert.ok(toolNames.includes("scheduler_list_tasks"));
    assert.ok(toolNames.includes("scheduler_get_task"));
    assert.ok(toolNames.includes("scheduler_add_task"));
    assert.ok(toolNames.includes("scheduler_update_task"));
    assert.ok(toolNames.includes("scheduler_duplicate_task"));
    assert.ok(toolNames.includes("scheduler_remove_task"));
    assert.ok(toolNames.includes("scheduler_run_task"));
    assert.ok(toolNames.includes("scheduler_toggle_task"));
    assert.ok(toolNames.includes("scheduler_list_history"));
    assert.ok(toolNames.includes("scheduler_restore_snapshot"));
    assert.ok(toolNames.includes("scheduler_get_overdue_tasks"));
    assert.ok(toolNames.includes("scheduler_list_jobs"));
    assert.ok(toolNames.includes("scheduler_create_job"));
    assert.ok(toolNames.includes("scheduler_compile_job_to_task"));
    assert.ok(toolNames.includes("cockpit_get_board"));
    assert.ok(toolNames.includes("cockpit_create_todo"));
    assert.ok(toolNames.includes("cockpit_add_todo_comment"));
    assert.ok(toolNames.includes("cockpit_update_todo"));
    assert.ok(toolNames.includes("cockpit_closeout_todo"));
    assert.ok(toolNames.includes("cockpit_delete_todo"));
    assert.ok(toolNames.includes("cockpit_move_todo"));
    assert.ok(toolNames.includes("cockpit_set_filters"));
    assert.ok(toolNames.includes("cockpit_seed_todos_from_tasks"));
    assert.ok(toolNames.includes("research_list_profiles"));
    assert.ok(toolNames.includes("research_create_profile"));
    assert.ok(toolNames.includes("research_list_runs"));
  });

  test("MCP tool definitions match the dispatch switch cases", () => {
    const serverSource = fs.readFileSync(
      path.resolve(__dirname, "../../../src/server.ts"),
      "utf8",
    );
    const dispatchCases = Array.from(
      serverSource.matchAll(/case\s+"((?:scheduler|cockpit|research)_[^"]+)":/g),
      (match) => match[1],
    ).sort();
    const definedTools = MCP_TOOL_DEFINITIONS
      .map((tool) => tool.name)
      .filter((name) => /^(scheduler|cockpit|research)_/.test(name))
      .sort();

    assert.deepStrictEqual(dispatchCases, definedTools);
  });

  test("cockpit tools create and comment on internal todos", async () => {
    const server = createServerContext({
      tasks: [],
      jobs: [],
      jobFolders: [],
    });

    const boardResponse = await handleSchedulerToolCall(
      "cockpit_get_board",
      {},
      server.context as any,
    );
    const boardPayload = parseJsonText(boardResponse);

    const createResponse = await handleSchedulerToolCall(
      "cockpit_create_todo",
      {
        title: "Review launch blockers",
        sectionId: boardPayload.board.sections[0].id,
        priority: "high",
        labels: ["needs-user-review"],
        comment: "Waiting for GO.",
      },
      server.context as any,
    );
    const created = parseJsonText(createResponse);

    const commentResponse = await handleSchedulerToolCall(
      "cockpit_add_todo_comment",
      {
        todoId: created.todo.id,
        author: "user",
        body: "GO after the final check.",
        labels: ["go"],
      },
      server.context as any,
    );
    const commented = parseJsonText(commentResponse);

    assert.strictEqual(created.todo.title, "Review launch blockers");
    assert.strictEqual(created.todo.commentCount, 2);
    assert.strictEqual(commented.todo.commentCount, 3);
    assert.strictEqual(server.getConfig().cockpitBoard.cards.length, 1);
    assert.strictEqual(server.getConfig().cockpitBoard.cards[0].comments.length, 3);
  });

  test("routing cards tool matches canonical workflow flags only", async () => {
    const server = createServerContext({
      tasks: [],
      jobs: [],
      jobFolders: [],
      cockpitBoard: {
        version: 4,
        sections: [
          { id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-03-30T00:00:00.000Z", updatedAt: "2026-03-30T00:00:00.000Z" },
          { id: "features", title: "Features", order: 1, createdAt: "2026-03-30T00:00:00.000Z", updatedAt: "2026-03-30T00:00:00.000Z" },
        ],
        cards: [
          {
            id: "card-new",
            title: "New card",
            sectionId: "unsorted",
            order: 0,
            priority: "medium",
            status: "active",
            labels: ["launch"],
            flags: ["new"],
            comments: [
              { id: "c1", author: "system", body: "Scheduled as task-1", labels: [], source: "system-event", sequence: 1, createdAt: "2026-03-30T01:00:00.000Z" },
              { id: "c2", author: "user", body: "Please run this.", labels: ["needs-bot-review"], source: "human-form", sequence: 2, createdAt: "2026-03-30T02:00:00.000Z" },
              { id: "c3", author: "system", body: "Done", labels: [], source: "system-event", sequence: 3, createdAt: "2026-03-30T03:00:00.000Z" },
            ],
            archived: false,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T03:00:00.000Z",
          },
          {
            id: "card-ready",
            title: "Flag match",
            sectionId: "features",
            order: 0,
            priority: "high",
            status: "active",
            labels: [],
            flags: ["ready"],
            comments: [],
            archived: false,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
          },
          {
            id: "card-final-check",
            title: "Comment match",
            sectionId: "features",
            order: 1,
            priority: "low",
            status: "active",
            labels: [],
            flags: ["FINAL-USER-CHECK"],
            comments: [
              { id: "c4", author: "user", body: "Needs review", labels: ["needs-bot-review"], source: "human-form", sequence: 1, createdAt: "2026-03-30T04:00:00.000Z" },
            ],
            archived: false,
            createdAt: "2026-03-30T04:00:00.000Z",
            updatedAt: "2026-03-30T04:00:00.000Z",
          },
        ],
        filters: {
          labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false,
        },
        updatedAt: "2026-03-30T00:00:00.000Z",
      },
    });

    const response = await handleSchedulerToolCall(
      "cockpit_list_routing_cards",
      {},
      server.context as any,
    );
    const payload = parseJsonText(response);

    assert.strictEqual(payload.cardCount, 3);
    assert.deepStrictEqual(payload.cards.map((card: any) => card.id), [
      "card-new",
      "card-ready",
      "card-final-check",
    ]);
    const newCard = payload.cards.find((card: any) => card.id === "card-new");
    const readyCard = payload.cards.find((card: any) => card.id === "card-ready");
    const finalCheckCard = payload.cards.find((card: any) => card.id === "card-final-check");
    assert.deepStrictEqual(newCard.matchedSignals, ["new"]);
    assert.deepStrictEqual(readyCard.matchedSignals, ["ready"]);
    assert.deepStrictEqual(finalCheckCard.matchedSignals, ["FINAL-USER-CHECK"]);
    assert.strictEqual(newCard.latestActionableUserComment.body, "Please run this.");
    assert.strictEqual(newCard.comments[0].body, "Done");
    assert.strictEqual(newCard.comments[1].body, "Please run this.");
    assert.strictEqual(newCard.comments[2].body, "Scheduled as task-1");
  });

  test("cockpit tools update move filter and delete todos", async () => {
    const server = createServerContext({ tasks: [], jobs: [], jobFolders: [] });

    const boardResponse = await handleSchedulerToolCall(
      "cockpit_get_board",
      {},
      server.context as any,
    );
    const boardPayload = parseJsonText(boardResponse);
    const unsortedId = boardPayload.board.sections[0].id;
    const featuresId = boardPayload.board.sections[2].id;

    const createResponse = await handleSchedulerToolCall(
      "cockpit_create_todo",
      {
        title: "Shape Todo Cockpit",
        sectionId: unsortedId,
      },
      server.context as any,
    );
    const created = parseJsonText(createResponse);

    const updateResponse = await handleSchedulerToolCall(
      "cockpit_update_todo",
      {
        todoId: created.todo.id,
        dueAt: "2026-03-30T09:00:00.000Z",
        priority: "urgent",
        labels: ["ux", "approval"],
      },
      server.context as any,
    );
    const updated = parseJsonText(updateResponse);

    const moveResponse = await handleSchedulerToolCall(
      "cockpit_move_todo",
      {
        todoId: created.todo.id,
        sectionId: featuresId,
        targetIndex: 0,
      },
      server.context as any,
    );
    const moved = parseJsonText(moveResponse);

    const filterResponse = await handleSchedulerToolCall(
      "cockpit_set_filters",
      {
        searchText: "Shape",
        sectionId: featuresId,
        sortBy: "dueAt",
        sortDirection: "desc",
      },
      server.context as any,
    );
    const filters = parseJsonText(filterResponse);

    const deleteResponse = await handleSchedulerToolCall(
      "cockpit_delete_todo",
      { todoId: created.todo.id },
      server.context as any,
    );
    const deleted = parseJsonText(deleteResponse);

    assert.strictEqual(updated.todo.priority, "urgent");
    assert.strictEqual(updated.todo.dueAt, "2026-03-30T09:00:00.000Z");
    assert.strictEqual(moved.todo.sectionId, featuresId);
    assert.strictEqual(filters.filters.sortBy, "dueAt");
    assert.strictEqual(filters.filters.sortDirection, "desc");
    assert.strictEqual(deleted.todoId, created.todo.id);
    assert.strictEqual(server.getConfig().cockpitBoard.cards.length, 1);
    assert.strictEqual(server.getConfig().cockpitBoard.cards[0].archived, true);
    assert.strictEqual(server.getConfig().cockpitBoard.cards[0].archiveOutcome, "rejected");
    assert.strictEqual(server.getConfig().cockpitBoard.cards[0].sectionId, DEFAULT_ARCHIVE_REJECTED_SECTION_ID);
  });

  test("protected cockpit flag definitions cannot be removed", async () => {
    const server = createServerContext({ tasks: [], jobs: [], jobFolders: [] });

    const response = await handleSchedulerToolCall(
      "cockpit_delete_flag_definition",
      { name: "go" },
      server.context as any,
    );
    const payload = parseJsonText(response);

    assert.strictEqual(
      payload.message,
      "Flag definition 'go' is built-in and cannot be removed.",
    );
  });

  test("closeout helper clears stale task links and keeps the current section when the requested section is missing", async () => {
    const server = createServerContext({
      tasks: [],
      jobs: [],
      jobFolders: [],
      cockpitBoard: {
        version: 4,
        sections: [
          { id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-03-30T00:00:00.000Z", updatedAt: "2026-03-30T00:00:00.000Z" },
          { id: "features", title: "Features", order: 1, createdAt: "2026-03-30T00:00:00.000Z", updatedAt: "2026-03-30T00:00:00.000Z" },
        ],
        cards: [
          {
            id: "card-closeout",
            title: "Security remediation",
            sectionId: "unsorted",
            order: 0,
            priority: "high",
            status: "active",
            labels: ["security"],
            flags: [],
            taskId: "task-missing",
            comments: [],
            archived: false,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
          },
        ],
        filters: {
          labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false,
        },
        updatedAt: "2026-03-30T00:00:00.000Z",
      },
    });

    const response = await handleSchedulerToolCall(
      "cockpit_closeout_todo",
      {
        todoId: "card-closeout",
        sectionId: "final-user-check",
        flags: ["needs-user-review"],
        labels: ["security", "remediated"],
        clearTaskIdIfMissing: true,
        summary: "Implementation is complete and ready for user review.",
      },
      server.context as any,
    );
    const payload = parseJsonText(response);

    assert.strictEqual(payload.requestedSectionId, "final-user-check");
    assert.strictEqual(payload.requestedSectionFound, false);
    assert.strictEqual(
      payload.sectionValidationError,
      "Section name 'final-user-check' is deprecated. Use an existing review-state flag such as 'needs-user-review' instead of 'final-user-check'.",
    );
    assert.strictEqual(payload.checkedTaskId, "task-missing");
    assert.strictEqual(payload.linkedTaskExists, false);
    assert.strictEqual(payload.staleTaskIdCleared, true);
    assert.strictEqual(payload.commentAdded, true);
    assert.strictEqual(payload.todo.sectionId, "unsorted");
    assert.deepStrictEqual(payload.todo.flags, ["needs-user-review"]);
    assert.deepStrictEqual(payload.todo.labels, ["security", "remediated"]);
    assert.strictEqual(payload.todo.taskId, undefined);
    assert.strictEqual(payload.todo.commentCount, 1);
    assert.strictEqual(server.getConfig().cockpitBoard.cards[0].taskId, undefined);
  });

  test("closeout helper preserves requested flags", async () => {
    const server = createServerContext({
      tasks: [],
      jobs: [],
      jobFolders: [],
      cockpitBoard: {
        version: 4,
        sections: [
          { id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-03-30T00:00:00.000Z", updatedAt: "2026-03-30T00:00:00.000Z" },
        ],
        cards: [
          {
            id: "card-flags",
            title: "Dispatcher closeout",
            sectionId: "unsorted",
            order: 0,
            priority: "medium",
            status: "active",
            labels: ["security"],
            flags: ["ready"],
            comments: [],
            archived: false,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z",
          },
        ],
        filters: {
          labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false,
        },
        updatedAt: "2026-03-30T00:00:00.000Z",
      },
    });

    const response = await handleSchedulerToolCall(
      "cockpit_closeout_todo",
      {
        todoId: "card-flags",
        flags: ["needs-user-review", "scheduled-task", "on-schedule-list"],
      },
      server.context as any,
    );
    const payload = parseJsonText(response);

    assert.deepStrictEqual(payload.todo.flags, [
      "scheduled-task",
      "ON-SCHEDULE-LIST",
    ]);
    assert.deepStrictEqual(server.getConfig().cockpitBoard.cards[0].flags, [
      "scheduled-task",
      "ON-SCHEDULE-LIST",
    ]);
  });

  test("closeout helper does not recreate a missing todo", async () => {
    const server = createServerContext({
      tasks: [],
      jobs: [],
      jobFolders: [],
      cockpitBoard: {
        version: 4,
        sections: [
          { id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-03-30T00:00:00.000Z", updatedAt: "2026-03-30T00:00:00.000Z" },
        ],
        cards: [],
        filters: {
          labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false,
        },
        updatedAt: "2026-03-30T00:00:00.000Z",
      },
    });

    const response = await handleSchedulerToolCall(
      "cockpit_closeout_todo",
      {
        todoId: "missing-card",
        flags: ["needs-user-review"],
        summary: "Should not be written.",
      },
      server.context as any,
    );
    assert.ok(response);
    assert.ok(Array.isArray(response.content));
    assert.strictEqual(response.content[0]?.type, "text");
    assert.strictEqual(response.content[0]?.text, "Cockpit todo 'missing-card' not found.");
    assert.strictEqual(server.getConfig().cockpitBoard.cards.length, 0);
    return;
    const payload = parseJsonText(response);

    assert.strictEqual(payload.error, "Cockpit todo 'missing-card' not found.");
    assert.strictEqual(server.getConfig().cockpitBoard.cards.length, 0);
  });

  test("cockpit seed tool surfaces scheduled tasks inside Todo Cockpit", async () => {
    const server = createServerContext({
      tasks: [
        {
          id: "task-a",
          name: "Publish approved launch note",
          description: "Ship after GO.",
          labels: ["launch"],
          enabled: true,
          nextRun: "2026-03-28T09:00:00.000Z",
          createdAt: "2026-03-27T09:00:00.000Z",
          updatedAt: "2026-03-27T09:05:00.000Z",
        },
      ],
      jobs: [],
      jobFolders: [],
    });

    const seedResponse = await handleSchedulerToolCall(
      "cockpit_seed_todos_from_tasks",
      {},
      server.context as any,
    );
    const seeded = parseJsonText(seedResponse);
    const createdCard = server.getConfig().cockpitBoard.cards[0];

    assert.strictEqual(seeded.createdTodoIds.length, 1);
    assert.strictEqual(createdCard.taskId, "task-a");
    assert.ok(createdCard.labels.includes("scheduled-task"));
  });

  test("job tools can create a job, attach a task, and compile it", async () => {
    const server = createServerContext({
      tasks: [
        {
          id: "task-a",
          name: "Draft brief",
          cron: "0 9 * * 1-5",
          prompt: "Write the brief.",
          enabled: true,
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
      ],
      jobs: [],
      jobFolders: [],
    });

    const folderResponse = await handleSchedulerToolCall(
      "scheduler_create_job_folder",
      { name: "Active Jobs" },
      server.context as any,
    );
    const folderPayload = parseJsonText(folderResponse);

    const jobResponse = await handleSchedulerToolCall(
      "scheduler_create_job",
      {
        name: "Campaign flow",
        cronExpression: "0 9 * * 1-5",
        folderId: folderPayload.folder.id,
      },
      server.context as any,
    );
    const jobPayload = parseJsonText(jobResponse);

    await handleSchedulerToolCall(
      "scheduler_add_job_pause",
      { jobId: jobPayload.job.id, title: "Manager review" },
      server.context as any,
    );
    await handleSchedulerToolCall(
      "scheduler_add_job_task",
      { jobId: jobPayload.job.id, taskId: "task-a", windowMinutes: 45 },
      server.context as any,
    );

    const compiledResponse = await handleSchedulerToolCall(
      "scheduler_compile_job_to_task",
      { jobId: jobPayload.job.id },
      server.context as any,
    );
    const compiledPayload = parseJsonText(compiledResponse);

    assert.strictEqual(compiledPayload.job.archived, true);
    assert.strictEqual(compiledPayload.job.paused, true);
    assert.strictEqual(compiledPayload.task.name, "Bundled Task");
    assert.ok(server.getConfig().tasks.some((task: any) => task.name === "Bundled Task"));
  });

  test("research tools create and list profiles", async () => {
    const workspaceRoot = process.platform === "win32"
      ? "C:/tmp/copilot-scheduler-research-tests"
      : "/tmp/copilot-scheduler-research-tests";
    const researchPath = `${workspaceRoot}/.vscode/research.json`;

    const fs = require("fs");
    const path = require("path");
    fs.mkdirSync(path.dirname(researchPath), { recursive: true });
    fs.writeFileSync(researchPath, JSON.stringify({ version: 1, profiles: [], runs: [] }, null, 2));

    const server = createServerContext();
    (server.context as any).workspaceRoot = workspaceRoot;

    const createResponse = await handleSchedulerToolCall(
      "research_create_profile",
      {
        researchData: {
          name: "Market loop",
          instructions: "Improve growth loops.",
          editablePaths: ["README.md"],
          benchmarkCommand: "npm test",
          metricPattern: "score: (\\d+)",
          metricDirection: "maximize",
          maxIterations: 2,
          maxMinutes: 10,
          maxConsecutiveFailures: 2,
          benchmarkTimeoutSeconds: 60,
          editWaitSeconds: 10,
        },
      },
      server.context as any,
    );
    const created = parseJsonText(createResponse);

    const listResponse = await handleSchedulerToolCall(
      "research_list_profiles",
      {},
      server.context as any,
    );
    const listed = parseJsonText(listResponse);

    assert.strictEqual(created.profile.name, "Market loop");
    assert.strictEqual(listed.profileCount, 1);
    assert.strictEqual(listed.profiles[0].name, "Market loop");
  });

  test("update_task preserves existing metadata while updating selected fields", async () => {
    const server = createServerContext({
      tasks: [
        {
          id: "task-1",
          name: "Original",
          cron: "0 * * * *",
          prompt: "old prompt",
          enabled: true,
          chatSession: "continue",
          model: "gpt-test",
          createdAt: "2026-03-23T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
          nextRun: "2026-03-23T01:00:00.000Z",
        },
      ],
    });

    const response = await handleSchedulerToolCall(
      "scheduler_update_task",
      {
        id: "task-1",
        prompt: "new prompt",
      },
      server.context as any,
    );

    const payload = parseJsonText(response);
    assert.strictEqual(payload.task.prompt, "new prompt");
    assert.strictEqual(payload.task.model, "gpt-test");
    assert.strictEqual(payload.task.chatSession, "continue");
    assert.strictEqual(payload.task.createdAt, "2026-03-23T00:00:00.000Z");

    const savedTask = server.getConfig().tasks[0];
    assert.strictEqual(savedTask.prompt, "new prompt");
    assert.strictEqual(savedTask.model, "gpt-test");
    assert.strictEqual(savedTask.chatSession, "continue");
    assert.strictEqual(savedTask.createdAt, "2026-03-23T00:00:00.000Z");
  });

  test("one-time tasks do not keep a task-level chat session", async () => {
    const server = createServerContext();

    const response = await handleSchedulerToolCall(
      "scheduler_add_task",
      {
        id: "task-one-time",
        name: "One-time",
        cron: "0 * * * *",
        prompt: "prompt",
        oneTime: true,
        chatSession: "continue",
      },
      server.context as any,
    );

    const payload = parseJsonText(response);
    assert.strictEqual(payload.task.oneTime, true);
    assert.strictEqual(payload.task.chatSession, undefined);
    assert.strictEqual(server.getConfig().tasks[0].chatSession, undefined);
  });

  test("run_task marks an enabled task due now", async () => {
    const server = createServerContext({
      tasks: [
        {
          id: "task-2",
          name: "Runnable",
          cron: "0 * * * *",
          prompt: "run me",
          enabled: true,
          nextRun: "2026-03-24T00:00:00.000Z",
          updatedAt: "2026-03-23T00:00:00.000Z",
        },
      ],
    });

    const response = await handleSchedulerToolCall(
      "scheduler_run_task",
      { id: "task-2" },
      server.context as any,
    );

    const payload = parseJsonText(response);
    assert.strictEqual(payload.id, "task-2");

    const savedTask = server.getConfig().tasks[0];
    assert.ok(typeof savedTask.nextRun === "string");
    assert.ok(new Date(savedTask.nextRun).getTime() <= Date.now());
  });

  test("restore_snapshot snapshots current state before writing restored config", async () => {
    const server = createServerContext({
      tasks: [
        {
          id: "task-3",
          name: "Current",
          cron: "0 * * * *",
          prompt: "current prompt",
          enabled: true,
        },
      ],
    });

    server.historyEntries.push({
      id: "snapshot-1",
      createdAt: "2026-03-23T10:00:00.000Z",
      hasPrivate: true,
    });
    server.snapshots.set("snapshot-1", {
      privateConfig: {
        tasks: [
          {
            id: "task-3",
            name: "Restored",
            cron: "5 * * * *",
            prompt: "restored prompt",
            enabled: false,
          },
        ],
      },
    });

    const response = await handleSchedulerToolCall(
      "scheduler_restore_snapshot",
      { snapshotId: "snapshot-1" },
      server.context as any,
    );

    const payload = parseJsonText(response);
    assert.strictEqual(payload.snapshotId, "snapshot-1");
    assert.strictEqual(server.createdSnapshots.length, 1);
    assert.strictEqual(
      server.createdSnapshots[0].privateConfig.tasks[0].prompt,
      "current prompt",
    );
    assert.strictEqual(
      server.getConfig().tasks[0].prompt,
      "restored prompt",
    );
  });
});
