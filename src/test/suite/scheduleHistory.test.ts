import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  createScheduleHistorySnapshot,
  getScheduleHistoryRoot,
  listScheduleHistoryEntries,
  readScheduleHistorySnapshot,
} from "../../scheduleHistory";

suite("ScheduleHistory Tests", () => {
  let workspaceRoot: string;

  setup(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cockpit-history-"));
  });

  teardown(() => {
    try {
      fs.rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // ignore cleanup failures in tests
    }
  });

  test("creates and reads paired public/private snapshots", () => {
    const publicConfig = { tasks: [{ id: "public-task" }], jobs: [{ id: "job-1" }] };
    const privateConfig = { tasks: [{ id: "private-task" }], jobFolders: [{ id: "folder-1" }] };
    const createdAt = new Date("2026-04-04T12:00:00.000Z");

    const snapshot = createScheduleHistorySnapshot(
      workspaceRoot,
      publicConfig,
      privateConfig,
      createdAt,
    );
    const historyRoot = getScheduleHistoryRoot(workspaceRoot);

    assert.strictEqual(snapshot.id, String(createdAt.getTime()));
    assert.strictEqual(snapshot.createdAt, createdAt.toISOString());
    assert.strictEqual(snapshot.hasPrivate, true);
    assert.ok(fs.existsSync(path.join(historyRoot, `scheduler-${snapshot.id}.json`)));
    assert.ok(fs.existsSync(path.join(historyRoot, `scheduler-${snapshot.id}.private.json`)));

    assert.deepStrictEqual(readScheduleHistorySnapshot(workspaceRoot, snapshot.id), {
      publicConfig: { tasks: [{ id: "public-task" }], jobs: [{ id: "job-1" }], jobFolders: [] },
      privateConfig: { tasks: [{ id: "private-task" }], jobs: [], jobFolders: [{ id: "folder-1" }] },
    });
  });

  test("increments the snapshot id when the timestamp already exists", () => {
    const createdAt = new Date("2026-04-04T12:00:00.000Z");

    const first = createScheduleHistorySnapshot(
      workspaceRoot,
      { tasks: [{ id: "task-1" }] },
      { tasks: [{ id: "task-1" }] },
      createdAt,
    );
    const second = createScheduleHistorySnapshot(
      workspaceRoot,
      { tasks: [{ id: "task-2" }] },
      { tasks: [{ id: "task-2" }] },
      createdAt,
    );

    assert.strictEqual(first.id, String(createdAt.getTime()));
    assert.strictEqual(second.id, String(createdAt.getTime() + 1));

    const entries = listScheduleHistoryEntries(workspaceRoot);
    assert.deepStrictEqual(entries.map((entry) => entry.id), [second.id, first.id]);
  });

  test("trims history to the newest 100 entries", () => {
    const baseTimestamp = Date.UTC(2026, 3, 4, 12, 0, 0);

    for (let index = 0; index < 101; index += 1) {
      createScheduleHistorySnapshot(
        workspaceRoot,
        { tasks: [{ id: `public-${index}` }] },
        { tasks: [{ id: `private-${index}` }] },
        new Date(baseTimestamp + index),
      );
    }

    const entries = listScheduleHistoryEntries(workspaceRoot);
    const historyRoot = getScheduleHistoryRoot(workspaceRoot);

    assert.strictEqual(entries.length, 100);
    assert.strictEqual(entries[0].id, String(baseTimestamp + 100));
    assert.strictEqual(entries[99].id, String(baseTimestamp + 1));
    assert.ok(!fs.existsSync(path.join(historyRoot, `scheduler-${baseTimestamp}.json`)));
    assert.ok(!fs.existsSync(path.join(historyRoot, `scheduler-${baseTimestamp}.private.json`)));
  });

  test("listScheduleHistoryEntries returns empty array when the history directory does not exist", () => {
    const entries = listScheduleHistoryEntries(workspaceRoot);

    assert.deepStrictEqual(entries, []);
  });

  test("listScheduleHistoryEntries returns entries in descending order (newest first)", () => {
    const t1 = new Date(Date.UTC(2026, 3, 4, 9, 0, 0));
    const t2 = new Date(Date.UTC(2026, 3, 4, 10, 0, 0));
    const t3 = new Date(Date.UTC(2026, 3, 4, 11, 0, 0));

    createScheduleHistorySnapshot(workspaceRoot, { tasks: [] }, { tasks: [] }, t2);
    createScheduleHistorySnapshot(workspaceRoot, { tasks: [] }, { tasks: [] }, t1);
    createScheduleHistorySnapshot(workspaceRoot, { tasks: [] }, { tasks: [] }, t3);

    const entries = listScheduleHistoryEntries(workspaceRoot);

    assert.deepStrictEqual(
      entries.map((entry) => entry.id),
      [String(t3.getTime()), String(t2.getTime()), String(t1.getTime())],
    );
  });

  test("ignores invalid snapshot payloads when reading and listing", () => {
    const historyRoot = getScheduleHistoryRoot(workspaceRoot);
    fs.mkdirSync(historyRoot, { recursive: true });

    const validTimestamp = String(Date.UTC(2026, 3, 4, 12, 0, 0));
    fs.writeFileSync(path.join(historyRoot, `scheduler-${validTimestamp}.json`), "not-json", "utf8");
    fs.writeFileSync(path.join(historyRoot, `scheduler-${validTimestamp}.private.json`), "also-not-json", "utf8");
    fs.writeFileSync(path.join(historyRoot, "scheduler-invalid.json"), JSON.stringify({ tasks: [] }), "utf8");

    const entries = listScheduleHistoryEntries(workspaceRoot);

    assert.deepStrictEqual(entries.map((entry) => entry.id), [validTimestamp]);
    assert.strictEqual(readScheduleHistorySnapshot(workspaceRoot, validTimestamp), undefined);
    assert.strictEqual(readScheduleHistorySnapshot(workspaceRoot, "does-not-exist"), undefined);
  });
});
