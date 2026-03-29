import * as assert from "assert";
import {
  DEFAULT_ARCHIVE_COMPLETED_SECTION_ID,
  DEFAULT_ARCHIVE_REJECTED_SECTION_ID,
  createDefaultCockpitBoard,
  normalizeCockpitBoard,
} from "../../cockpitBoard";
import {
  approveTodoInBoard,
  deleteTodoInBoard,
  finalizeTodoInBoard,
  restoreArchivedTodoInBoard,
} from "../../cockpitBoardManager";

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

    assert.strictEqual(board.version, 3);
    assert.strictEqual(board.archives, undefined);
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
});