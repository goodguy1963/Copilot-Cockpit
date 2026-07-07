import * as assert from "assert";
import {
  deriveKanbanLane,
  KANBAN_LANES,
  planKanbanLaneTransition,
} from "../../cockpitKanban";
import type { CockpitTodoCard } from "../../types";

function todo(overrides: Partial<CockpitTodoCard>): CockpitTodoCard {
  return {
    id: "todo-1",
    title: "Todo",
    sectionId: "unsorted",
    order: 0,
    priority: "none",
    status: "active",
    labels: [],
    flags: [],
    comments: [],
    archived: false,
    createdAt: "2026-07-08T00:00:00.000Z",
    updatedAt: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

suite("Cockpit Kanban projection", () => {
  test("maps existing todo workflow state into fixed lanes without storage migration", () => {
    assert.deepStrictEqual(
      KANBAN_LANES.map((lane) => lane.id),
      ["inbox", "bot-review", "user-review", "ready", "scheduled", "done"],
    );
    assert.strictEqual(deriveKanbanLane(todo({ flags: ["new"] })), "inbox");
    assert.strictEqual(deriveKanbanLane(todo({ flags: ["needs-bot-review"] })), "bot-review");
    assert.strictEqual(deriveKanbanLane(todo({ flags: ["needs-user-review"] })), "user-review");
    assert.strictEqual(deriveKanbanLane(todo({ flags: ["ready"] })), "ready");
    assert.strictEqual(deriveKanbanLane(todo({ flags: ["ON-SCHEDULE-LIST"] })), "scheduled");
    assert.strictEqual(deriveKanbanLane(todo({ taskId: "task-1" })), "scheduled");
    assert.strictEqual(deriveKanbanLane(todo({ flags: ["FINAL-USER-CHECK"] })), "user-review");
    assert.strictEqual(deriveKanbanLane(todo({ archived: true, archiveOutcome: "completed-successfully" })), "done");
    assert.strictEqual(deriveKanbanLane(todo({ status: "rejected" })), "done");
  });

  test("plans lane drops as existing todo actions and blocks illegal jumps", () => {
    assert.deepStrictEqual(
      planKanbanLaneTransition(todo({ flags: ["needs-user-review"] }), "ready"),
      { action: "approveTodo", todoId: "todo-1" },
    );
    assert.deepStrictEqual(
      planKanbanLaneTransition(todo({ flags: ["ready"] }), "scheduled"),
      { action: "createTaskFromTodo", todoId: "todo-1" },
    );
    assert.deepStrictEqual(
      planKanbanLaneTransition(todo({ flags: ["ON-SCHEDULE-LIST"] }), "done"),
      { action: "finalizeTodo", todoId: "todo-1" },
    );
    assert.deepStrictEqual(
      planKanbanLaneTransition(todo({ flags: ["new"] }), "scheduled"),
      {
        blocked: true,
        reason: "Move this todo to Ready before scheduling it.",
      },
    );
  });
});
