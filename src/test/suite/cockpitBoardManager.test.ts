import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  DEFAULT_ARCHIVE_COMPLETED_SECTION_ID,
  DEFAULT_ARCHIVE_REJECTED_SECTION_ID,
  DEFAULT_RECURRING_TASKS_SECTION_ID,
  createDefaultCockpitBoard,
  normalizeCockpitBoard,
} from "../../cockpitBoard";
import {
  approveTodoInBoard,
  createCockpitTodo,
  deleteTodoInBoard,
  ensureTaskTodosInBoard,
  finalizeTodoInBoard,
  getCockpitBoard,
  restoreArchivedTodoInBoard,
  saveCockpitFlagDefinition,
  saveCockpitTodoLabelDefinition,
  setCockpitBoardFilters,
} from "../../cockpitBoardManager";
import type { ScheduledTask } from "../../types";

suite("Cockpit Board Manager Tests", () => {
  test("migrates legacy archive buckets into archive sections", () => {
    const board = normalizeCockpitBoard({
      version: 2,
      sections: [
        {
          id: "unsorted",
          title: "Unsorted",
          order: 0,
          createdAt: "2026-03-28T10:00:00.000Z",
          updatedAt: "2026-03-28T10:00:00.000Z",
        },
      ],
      cards: [
        {
          id: "active-card",
          title: "Active",
          sectionId: "unsorted",
          order: 0,
          status: "active",
          labels: [],
          flags: [],
          comments: [],
          archived: false,
          createdAt: "2026-03-28T10:00:00.000Z",
          updatedAt: "2026-03-28T10:00:00.000Z",
        },
      ],
      archives: {
        completedSuccessfully: [
          {
            id: "done-card",
            title: "Done",
            sectionId: "unsorted",
            order: 0,
            status: "completed",
            labels: [],
            flags: [],
            comments: [],
            archived: true,
            createdAt: "2026-03-28T10:00:00.000Z",
            updatedAt: "2026-03-28T10:00:00.000Z",
          },
        ],
        rejected: [
          {
            id: "rejected-card",
            title: "Rejected",
            sectionId: "unsorted",
            order: 0,
            status: "rejected",
            labels: [],
            flags: [],
            comments: [],
            archived: true,
            createdAt: "2026-03-28T10:00:00.000Z",
            updatedAt: "2026-03-28T10:00:00.000Z",
          },
        ],
      },
    });

    assert.strictEqual(board.version, 4);
    assert.strictEqual(board.archives, undefined);
    assert.ok(board.sections.some((section) => section.id === DEFAULT_RECURRING_TASKS_SECTION_ID));
    assert.ok(board.sections.some((section) => section.id === DEFAULT_ARCHIVE_COMPLETED_SECTION_ID));
    assert.ok(board.sections.some((section) => section.id === DEFAULT_ARCHIVE_REJECTED_SECTION_ID));
    assert.strictEqual(board.cards.length, 3);

    const completed = board.cards.find((card) => card.id === "done-card");
    const rejected = board.cards.find((card) => card.id === "rejected-card");
    assert.strictEqual(completed?.sectionId, DEFAULT_ARCHIVE_COMPLETED_SECTION_ID);
    assert.strictEqual(completed?.archived, true);
    assert.strictEqual(completed?.archiveOutcome, "completed-successfully");
    assert.strictEqual(rejected?.sectionId, DEFAULT_ARCHIVE_REJECTED_SECTION_ID);
    assert.strictEqual(rejected?.archived, true);
    assert.strictEqual(rejected?.archiveOutcome, "rejected");
  });

  test("approving a todo marks it ready without archiving it", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    board.cards.push({
      id: "todo-1",
      title: "Ship change",
      sectionId: "unsorted",
      order: 0,
      priority: "high",
      status: "active",
      labels: [],
      flags: [],
      comments: [],
      archived: false,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:00:00.000Z",
    });

    const result = approveTodoInBoard(board, "todo-1");

    assert.ok(result.todo);
    assert.strictEqual(result.todo?.status, "ready");
    assert.strictEqual(result.todo?.archived, false);
    assert.strictEqual(result.todo?.sectionId, "unsorted");
    assert.ok(result.todo?.approvedAt);
    assert.ok(result.todo?.comments.some((comment) => comment.body.includes("marked ready")));
  });

  test("finalizing a ready todo archives it into the completed archive section", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    board.cards.push({
      id: "todo-1",
      title: "Ship change",
      sectionId: "unsorted",
      order: 0,
      priority: "high",
      status: "ready",
      labels: [],
      flags: [],
      comments: [],
      approvedAt: "2026-03-28T10:05:00.000Z",
      archived: false,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:05:00.000Z",
    });

    const result = finalizeTodoInBoard(board, "todo-1");

    assert.ok(result.todo);
    assert.strictEqual(result.todo?.status, "completed");
    assert.strictEqual(result.todo?.archived, true);
    assert.strictEqual(result.todo?.sectionId, DEFAULT_ARCHIVE_COMPLETED_SECTION_ID);
    assert.ok(result.todo?.comments.some((comment) => comment.body.includes("completed archive")));
    assert.strictEqual(result.board.cards[0]?.id, "todo-1");
  });

  test("deleting a todo archives it into the rejected archive section", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    board.cards.push({
      id: "todo-2",
      title: "Reject change",
      sectionId: "unsorted",
      order: 0,
      priority: "medium",
      status: "active",
      labels: [],
      flags: [],
      comments: [],
      archived: false,
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:00:00.000Z",
    });

    const result = deleteTodoInBoard(board, "todo-2");
    const archived = result.board.cards.find((card) => card.id === "todo-2");

    assert.strictEqual(result.deleted, true);
    assert.strictEqual(archived?.status, "rejected");
    assert.strictEqual(archived?.archived, true);
    assert.strictEqual(archived?.sectionId, DEFAULT_ARCHIVE_REJECTED_SECTION_ID);
    assert.ok(archived?.comments.some((comment) => comment.body.includes("rejected archive")));
  });

  test("restoring a rejected archived todo reopens it as active in unsorted", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    board.cards.push({
      id: "todo-3",
      title: "Retry change",
      sectionId: DEFAULT_ARCHIVE_REJECTED_SECTION_ID,
      order: 0,
      priority: "medium",
      status: "rejected",
      labels: [],
      flags: [],
      comments: [],
      archived: true,
      archivedAt: "2026-03-28T10:03:00.000Z",
      archiveOutcome: "rejected",
      rejectedAt: "2026-03-28T10:03:00.000Z",
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:03:00.000Z",
    });

    const result = restoreArchivedTodoInBoard(board, "todo-3");

    assert.ok(result.todo);
    assert.strictEqual(result.todo?.archived, false);
    assert.strictEqual(result.todo?.archiveOutcome, undefined);
    assert.strictEqual(result.todo?.status, "active");
    assert.strictEqual(result.todo?.sectionId, "unsorted");
    assert.ok(result.todo?.comments.some((comment) => comment.body.includes("reopened for follow-up")));
  });

  test("restoring a completed archived todo brings it back as ready", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    board.cards.push({
      id: "todo-4",
      title: "Reopen complete",
      sectionId: DEFAULT_ARCHIVE_COMPLETED_SECTION_ID,
      order: 0,
      priority: "high",
      status: "completed",
      labels: [],
      flags: [],
      comments: [],
      archived: true,
      archivedAt: "2026-03-28T10:05:00.000Z",
      archiveOutcome: "completed-successfully",
      approvedAt: "2026-03-28T10:02:00.000Z",
      completedAt: "2026-03-28T10:05:00.000Z",
      createdAt: "2026-03-28T10:00:00.000Z",
      updatedAt: "2026-03-28T10:05:00.000Z",
    });

    const result = restoreArchivedTodoInBoard(board, "todo-4");

    assert.ok(result.todo);
    assert.strictEqual(result.todo?.archived, false);
    assert.strictEqual(result.todo?.status, "ready");
    assert.strictEqual(result.todo?.sectionId, "unsorted");
    assert.ok(result.todo?.comments.some((comment) => comment.body.includes("marked ready again")));
  });

  test("syncing tasks creates one recurring history card and skips one-time task cards", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    const recurringTask: ScheduledTask = {
      id: "task-recurring",
      name: "Daily sync",
      description: "Run daily",
      cronExpression: "0 9 * * *",
      prompt: "Do the daily sync",
      enabled: true,
      scope: "workspace",
      promptSource: "inline",
      oneTime: false,
      labels: ["ops"],
      createdAt: new Date("2026-03-28T10:00:00.000Z"),
      updatedAt: new Date("2026-03-28T10:00:00.000Z"),
    };
    const oneTimeTask: ScheduledTask = {
      id: "task-once",
      name: "One-shot",
      description: "Run once",
      cronExpression: "0 11 * * *",
      prompt: "Do the one-shot task",
      enabled: false,
      scope: "workspace",
      promptSource: "inline",
      oneTime: true,
      labels: ["draft"],
      createdAt: new Date("2026-03-28T10:00:00.000Z"),
      updatedAt: new Date("2026-03-28T10:00:00.000Z"),
    };

    const result = ensureTaskTodosInBoard(board, [recurringTask, oneTimeTask]);

    assert.strictEqual(result.createdTodoIds.length, 1);
    const recurringCard = result.board.cards.find((card) => card.taskId === recurringTask.id);
    const oneTimeCard = result.board.cards.find((card) => card.taskId === oneTimeTask.id);
    assert.ok(recurringCard);
    assert.strictEqual(recurringCard?.sectionId, DEFAULT_RECURRING_TASKS_SECTION_ID);
    assert.ok(recurringCard?.comments.some((comment) => comment.body.includes("Recurring task linked")));
    assert.strictEqual(oneTimeCard, undefined);
  });

  test("syncing a changed recurring task adds one history comment and updates the snapshot", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    const baseTask: ScheduledTask = {
      id: "task-recurring",
      name: "Daily sync",
      description: "Run daily",
      cronExpression: "0 9 * * *",
      prompt: "Do the daily sync",
      enabled: true,
      scope: "workspace",
      promptSource: "inline",
      oneTime: false,
      labels: ["ops"],
      createdAt: new Date("2026-03-28T10:00:00.000Z"),
      updatedAt: new Date("2026-03-28T10:00:00.000Z"),
    };

    const seeded = ensureTaskTodosInBoard(board, [baseTask]).board;
    const updatedTask: ScheduledTask = {
      ...baseTask,
      cronExpression: "30 10 * * *",
      model: "gpt-5.4",
      prompt: "Do the updated daily sync",
      updatedAt: new Date("2026-03-28T11:00:00.000Z"),
    };

    const result = ensureTaskTodosInBoard(seeded, [updatedTask]);
    const recurringCard = result.board.cards.find((card) => card.taskId === updatedTask.id);

    assert.ok(recurringCard);
    assert.strictEqual(
      recurringCard?.comments.filter((comment) => comment.body.includes("Recurring task updated")).length,
      1,
    );
    assert.strictEqual(recurringCard?.taskSnapshot?.cronExpression, "30 10 * * *");
    assert.strictEqual(recurringCard?.taskSnapshot?.model, "gpt-5.4");
  });

  test("syncing a disabled recurring task reopens the linked todo and drops stale enabled comments", () => {
    const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
    const baseTask: ScheduledTask = {
      id: "task-recurring",
      name: "Daily sync",
      description: "Run daily",
      cronExpression: "0 9 * * *",
      prompt: "Do the daily sync",
      enabled: true,
      scope: "workspace",
      promptSource: "inline",
      oneTime: false,
      labels: ["ops"],
      createdAt: new Date("2026-03-28T10:00:00.000Z"),
      updatedAt: new Date("2026-03-28T10:00:00.000Z"),
    };

    const seeded = ensureTaskTodosInBoard(board, [baseTask]).board;
    const recurringCard = seeded.cards.find((card) => card.taskId === baseTask.id);
    assert.ok(recurringCard);

    recurringCard!.status = "ready";
    recurringCard!.approvedAt = "2026-03-28T10:05:00.000Z";
    recurringCard!.comments.push({
      id: "comment-enabled",
      author: "system",
      body: "Linked task is enabled again.",
      labels: ["task-enabled"],
      source: "system-event",
      sequence: recurringCard!.comments.length + 1,
      createdAt: "2026-03-28T10:05:00.000Z",
    });

    const disabledTask: ScheduledTask = {
      ...baseTask,
      enabled: false,
      updatedAt: new Date("2026-03-28T11:00:00.000Z"),
    };

    const result = ensureTaskTodosInBoard(seeded, [disabledTask]);
    const disabledCard = result.board.cards.find((card) => card.taskId === disabledTask.id);

    assert.ok(disabledCard);
    assert.strictEqual(disabledCard?.status, "active");
    assert.strictEqual(disabledCard?.approvedAt, undefined);
    assert.strictEqual(disabledCard?.taskSnapshot?.enabled, false);
    assert.strictEqual(
      disabledCard?.comments.some((comment) => (comment.labels ?? []).includes("task-enabled")),
      false,
    );
    assert.strictEqual(
      disabledCard?.comments.filter((comment) => comment.body.includes("Recurring task updated")).length,
      1,
    );
  });

  test("renaming a todo label definition migrates applied card labels and filters", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-label-rename-"));

    try {
      createCockpitTodo(workspaceRoot, {
        title: "Todo",
        sectionId: "unsorted",
        priority: "none",
        labels: ["Urgent"],
      });
      setCockpitBoardFilters(workspaceRoot, { labels: ["Urgent"] });
      saveCockpitTodoLabelDefinition(workspaceRoot, { name: "Urgent", color: "#ff0000" });

      const result = saveCockpitTodoLabelDefinition(workspaceRoot, {
        name: "Critical",
        previousName: "Urgent",
        color: "#00aa00",
      });
      const board = getCockpitBoard(workspaceRoot);

      assert.strictEqual(result.label?.name, "Critical");
      assert.deepStrictEqual(board.cards[0]?.labels, ["Critical"]);
      assert.deepStrictEqual(board.filters?.labels ?? [], ["Critical"]);
      assert.strictEqual(board.labelCatalog?.some((entry) => entry.name === "Urgent"), false);
      assert.strictEqual(board.labelCatalog?.some((entry) => entry.name === "Critical"), true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("renaming a todo flag definition migrates applied card flags and filters", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-flag-rename-"));

    try {
      createCockpitTodo(workspaceRoot, {
        title: "Todo",
        sectionId: "unsorted",
        priority: "none",
        flags: ["Now"],
      });
      setCockpitBoardFilters(workspaceRoot, { flags: ["Now"] });
      saveCockpitFlagDefinition(workspaceRoot, { name: "Now", color: "#ff8800" });

      const result = saveCockpitFlagDefinition(workspaceRoot, {
        name: "Focus",
        previousName: "Now",
        color: "#3366ff",
      });
      const board = getCockpitBoard(workspaceRoot);

      assert.strictEqual(result.label?.name, "Focus");
      assert.deepStrictEqual(board.cards[0]?.flags, ["Focus"]);
      assert.deepStrictEqual(board.filters?.flags ?? [], ["Focus"]);
      assert.strictEqual(board.flagCatalog?.some((entry) => entry.name === "Now"), false);
      assert.strictEqual(board.flagCatalog?.some((entry) => entry.name === "Focus"), true);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});