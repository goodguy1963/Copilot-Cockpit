import * as assert from "assert";
import { MCP_TOOL_DEFINITIONS, handleSchedulerToolCall } from "../../server";

function parseJsonText(result: any): any {
  assert.ok(result);
  assert.ok(Array.isArray(result.content));
  assert.strictEqual(result.content[0]?.type, "text");
  return JSON.parse(result.content[0].text);
}

function createServerContext(initialConfig?: { tasks: any[] }) {
  let currentConfig = JSON.parse(JSON.stringify(initialConfig || { tasks: [] }));
  const createdSnapshots: Array<{ publicConfig: any; privateConfig: any }> = [];
  const snapshots = new Map<string, { publicConfig?: any; privateConfig?: any }>();
  const historyEntries: Array<{ id: string; createdAt: string; hasPrivate: boolean }> = [];

  return {
    context: {
      workspaceRoot: "/tmp/workspace",
      historyRoot: "/tmp/workspace/.vscode/scheduler-history",
      readConfig: () => JSON.parse(JSON.stringify(currentConfig)),
      writeConfig: (config: { tasks: any[] }) => {
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

suite("Scheduler MCP Server Tests", () => {
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