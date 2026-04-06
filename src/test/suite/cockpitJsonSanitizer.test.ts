import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import {
  getPrivateSchedulerConfigPath,
  readSchedulerConfig,
  setSchedulerFileOpsForTests,
  setSchedulerLockOptionsForTests,
  wasSchedulerConfigWrittenRecently,
  writeSchedulerConfig,
} from "../../cockpitJsonSanitizer";
import type { CockpitTodoCard } from "../../types";

suite("Scheduler Json Sanitizer Tests", () => {
  function createWorkspaceRoot(): string {
    return fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-sanitizer-"),
    );
  }

  function createTaskRecord(id: string, updatedAt: string, overrides?: Record<string, unknown>) {
    return {
      id,
      name: `Task ${id}`,
      cron: "0 * * * *",
      prompt: `Prompt for ${id}`,
      enabled: true,
      scope: "workspace",
      promptSource: "inline",
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt,
      ...overrides,
    };
  }

  function createJobRecord(id: string, updatedAt: string, overrides?: Record<string, unknown>) {
    return {
      id,
      name: `Job ${id}`,
      cronExpression: "0 * * * *",
      paused: false,
      archived: false,
      nodes: [],
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt,
      ...overrides,
    };
  }

  function createJobFolderRecord(id: string, updatedAt: string, overrides?: Record<string, unknown>) {
    return {
      id,
      name: `Folder ${id}`,
      createdAt: "2026-04-02T10:00:00.000Z",
      updatedAt,
      ...overrides,
    };
  }

  function createCardRecord(id: string, title: string, updatedAt: string): CockpitTodoCard {
    return {
      id,
      title,
      sectionId: "unsorted",
      order: 0,
      priority: "medium",
      status: "active",
      labels: [],
      flags: [],
      comments: [],
      createdAt: updatedAt,
      updatedAt,
    };
  }

  function cleanup(root: string): void {
    try {
      const cleanupOptions: fs.RmOptions = {};
      cleanupOptions.recursive = true;
      cleanupOptions.force = true;
      cleanupOptions.maxRetries = 3;
      cleanupOptions.retryDelay = 50;
      fs.rmSync(root, cleanupOptions);
    } catch {
      // ignore
    }
  }

  test("keeps cockpit board state private while round-tripping it from the private config", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const board = createDefaultCockpitBoard("2026-03-27T10:00:00.000Z");
      board.cards.push({
        id: "card_1",
        title: "Ship cockpit board",
        sectionId: board.sections[1].id,
        order: 0,
        priority: "high",
        status: "active",
        labels: ["needs-user-review", "new-idea"],
        flags: ["go"],
        comments: [{
          id: "comment_1",
          author: "system",
          body: "Waiting for GO.",
          labels: ["needs-user-review"],
          source: "system-event",
          sequence: 1,
          createdAt: "2026-03-27T10:00:00.000Z",
        }],
        createdAt: "2026-03-27T10:00:00.000Z",
        updatedAt: "2026-03-27T10:00:00.000Z",
      });

      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        cockpitBoard: board,
        telegramNotification: {
          enabled: true,
          botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
          chatId: "123456789",
          updatedAt: "2026-03-27T10:00:00.000Z",
        },
      });

      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const privateConfigPath = getPrivateSchedulerConfigPath(publicConfigPath);
      const publicContent = fs.readFileSync(publicConfigPath, "utf8");
      const privateContent = fs.readFileSync(privateConfigPath, "utf8");
      const roundTripped = readSchedulerConfig(workspaceRoot);

      assert.ok(!publicContent.includes("cockpitBoard"));
      assert.ok(!publicContent.includes("Ship cockpit board"));
      assert.ok(privateContent.includes("cockpitBoard"));
      assert.ok(privateContent.includes("Ship cockpit board"));
      assert.strictEqual(roundTripped.cockpitBoard?.sections.length, board.sections.length);
      assert.strictEqual(roundTripped.cockpitBoard?.cards[0]?.title, "Ship cockpit board");
      assert.strictEqual(roundTripped.telegramNotification?.botToken, "123456:abcdefghijklmnopqrstuvwxyzABCDE");
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("tracks recent scheduler config writes for watcher suppression", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const result = writeSchedulerConfig(workspaceRoot, {
        tasks: [],
      });

      assert.strictEqual(result.publicChanged, true);
      assert.strictEqual(result.privateChanged, true);
      assert.strictEqual(
        wasSchedulerConfigWrittenRecently(result.publicPath),
        true,
      );
      assert.strictEqual(
        wasSchedulerConfigWrittenRecently(result.privatePath),
        true,
      );
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("merges stale task writes so newer additions are not dropped", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        tasks: [
          ...(baseConfig.tasks ?? []),
          createTaskRecord("task-b", "2026-04-02T10:05:00.000Z"),
        ],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        tasks: [
          createTaskRecord("task-a", "2026-04-02T10:06:00.000Z", {
            name: "Task A edited later",
          }),
        ],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      assert.strictEqual(merged.tasks.length, 2);
      assert.strictEqual(
        merged.tasks.find((task) => task.id === "task-a")?.name,
        "Task A edited later",
      );
      assert.ok(merged.tasks.some((task) => task.id === "task-b"));
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("merges independent field edits on the same task", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z", {
          description: "base description",
          labels: ["base"],
        })],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        tasks: [createTaskRecord("task-a", "2026-04-02T10:05:00.000Z", {
          name: "Renamed task",
          description: "base description",
          labels: ["base"],
        })],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        tasks: [createTaskRecord("task-a", "2026-04-02T10:06:00.000Z", {
          description: "base description",
          labels: ["base", "ops"],
        })],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      const task = merged.tasks.find((entry) => entry.id === "task-a");
      assert.ok(task);
      assert.strictEqual(task?.name, "Renamed task");
      assert.deepStrictEqual(task?.labels, ["base", "ops"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("merges stale cockpit board writes so independent todo edits survive", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        cockpitBoard: createDefaultCockpitBoard("2026-04-02T10:00:00.000Z"),
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);
      const boardWithCardA = createDefaultCockpitBoard("2026-04-02T10:10:00.000Z");
      boardWithCardA.cards.push(
        createCardRecord("card-a", "First concurrent todo", "2026-04-02T10:10:00.000Z"),
      );

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        cockpitBoard: boardWithCardA,
      }, {
        baseConfig,
      });

      const boardWithCardB = createDefaultCockpitBoard("2026-04-02T10:11:00.000Z");
      boardWithCardB.cards.push(
        createCardRecord("card-b", "Second concurrent todo", "2026-04-02T10:11:00.000Z"),
      );

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        cockpitBoard: boardWithCardB,
      }, {
        baseConfig,
      });

      const mergedBoard = readSchedulerConfig(workspaceRoot).cockpitBoard;
      assert.ok(mergedBoard);
      assert.ok(mergedBoard?.cards.some((card) => card.id === "card-a"));
      assert.ok(mergedBoard?.cards.some((card) => card.id === "card-b"));
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("keeps deleted tasks tombstoned against stale concurrent edits", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        tasks: [],
        deletedTaskIds: ["task-a"],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        tasks: [createTaskRecord("task-a", "2026-04-02T10:06:00.000Z", {
          name: "Stale edit should not resurrect",
        })],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      assert.deepStrictEqual(merged.tasks, []);
      assert.deepStrictEqual(merged.deletedTaskIds, ["task-a"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("keeps purged todos tombstoned against stale concurrent edits", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const seededBoard = createDefaultCockpitBoard("2026-04-02T10:00:00.000Z");
      seededBoard.cards.push(
        createCardRecord("card-a", "Concurrent todo", "2026-04-02T10:00:00.000Z"),
      );

      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        cockpitBoard: seededBoard,
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);
      const purgedBoard = createDefaultCockpitBoard("2026-04-02T10:05:00.000Z");
      purgedBoard.deletedCardIds = ["card-a"];

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        cockpitBoard: purgedBoard,
      }, {
        baseConfig,
      });

      const staleEditBoard = createDefaultCockpitBoard("2026-04-02T10:06:00.000Z");
      staleEditBoard.cards.push(
        createCardRecord("card-a", "Stale todo edit", "2026-04-02T10:06:00.000Z"),
      );

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        cockpitBoard: staleEditBoard,
      }, {
        baseConfig,
      });

      const mergedBoard = readSchedulerConfig(workspaceRoot).cockpitBoard;
      assert.ok(mergedBoard);
      assert.strictEqual(mergedBoard?.cards.length, 0);
      assert.deepStrictEqual(mergedBoard?.deletedCardIds, ["card-a"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("merges independent field edits on the same job", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        jobs: [createJobRecord("job-a", "2026-04-02T10:00:00.000Z", {
          folderId: "folder-a",
          paused: false,
        })],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobs: [createJobRecord("job-a", "2026-04-02T10:05:00.000Z", {
          name: "Renamed job",
          folderId: "folder-a",
          paused: false,
        })],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobs: [createJobRecord("job-a", "2026-04-02T10:06:00.000Z", {
          folderId: "folder-a",
          paused: true,
        })],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      const job = (merged.jobs ?? []).find((entry) => entry.id === "job-a");
      assert.ok(job);
      assert.strictEqual(job?.name, "Renamed job");
      assert.strictEqual(job?.paused, true);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("merges independent field edits on the same job folder", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        jobFolders: [createJobFolderRecord("folder-a", "2026-04-02T10:00:00.000Z", {
          parentId: "root",
        })],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobFolders: [createJobFolderRecord("folder-a", "2026-04-02T10:05:00.000Z", {
          name: "Renamed folder",
          parentId: "root",
        })],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobFolders: [createJobFolderRecord("folder-a", "2026-04-02T10:06:00.000Z", {
          parentId: "ops",
        })],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      const folder = (merged.jobFolders ?? []).find((entry) => entry.id === "folder-a");
      assert.ok(folder);
      assert.strictEqual(folder?.name, "Renamed folder");
      assert.strictEqual(folder?.parentId, "ops");
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("keeps deleted jobs tombstoned against stale concurrent edits", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        jobs: [createJobRecord("job-a", "2026-04-02T10:00:00.000Z")],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobs: [],
        deletedJobIds: ["job-a"],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobs: [createJobRecord("job-a", "2026-04-02T10:06:00.000Z", {
          name: "Stale edited job",
        })],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      assert.deepStrictEqual(merged.jobs ?? [], []);
      assert.deepStrictEqual(merged.deletedJobIds, ["job-a"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("keeps deleted job folders tombstoned against stale concurrent edits", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [],
        jobFolders: [createJobFolderRecord("folder-a", "2026-04-02T10:00:00.000Z")],
      });

      const baseConfig = readSchedulerConfig(workspaceRoot);

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobFolders: [],
        deletedJobFolderIds: ["folder-a"],
      }, {
        baseConfig,
      });

      writeSchedulerConfig(workspaceRoot, {
        ...baseConfig,
        jobFolders: [createJobFolderRecord("folder-a", "2026-04-02T10:06:00.000Z", {
          name: "Stale edited folder",
        })],
      }, {
        baseConfig,
      });

      const merged = readSchedulerConfig(workspaceRoot);
      assert.deepStrictEqual(merged.jobFolders ?? [], []);
      assert.deepStrictEqual(merged.deletedJobFolderIds, ["folder-a"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("cleans up temp files and preserves the original config when atomic rename fails", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
      });

      const schedulerDir = path.join(workspaceRoot, ".vscode");
      const publicConfigPath = path.join(schedulerDir, "scheduler.json");
      const originalContent = fs.readFileSync(publicConfigPath, "utf8");

      let failed = false;
      setSchedulerFileOpsForTests({
        renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
          if (!failed && String(newPath).endsWith("scheduler.json")) {
            failed = true;
            throw new Error("simulated rename failure");
          }
          return fs.renameSync(oldPath, newPath);
        }) as typeof fs.renameSync,
      });

      assert.throws(() => {
        writeSchedulerConfig(workspaceRoot, {
          tasks: [createTaskRecord("task-b", "2026-04-02T10:05:00.000Z")],
        });
      }, /simulated rename failure/);

      assert.strictEqual(fs.readFileSync(publicConfigPath, "utf8"), originalContent);
      assert.deepStrictEqual(
        fs.readdirSync(schedulerDir).filter((entry) => entry.includes(".tmp")),
        [],
      );
    } finally {
      setSchedulerFileOpsForTests(undefined);
      cleanup(workspaceRoot);
    }
  });

  test("recovers a pending transaction after a mid-commit failure", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
      });

      let renameCallCount = 0;
      setSchedulerFileOpsForTests({
        renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
          renameCallCount += 1;
          fs.renameSync(oldPath, newPath);
          if (renameCallCount === 1 && String(newPath).endsWith("scheduler.json")) {
            throw new Error("simulated mid-commit failure");
          }
        }) as typeof fs.renameSync,
      });

      assert.throws(() => {
        writeSchedulerConfig(workspaceRoot, {
          tasks: [createTaskRecord("task-b", "2026-04-02T10:05:00.000Z")],
        }, {
          mode: "replace",
        });
      }, /simulated mid-commit failure/);

      setSchedulerFileOpsForTests(undefined);

      const recovered = readSchedulerConfig(workspaceRoot);
      assert.strictEqual(recovered.tasks.length, 1);
      assert.strictEqual(recovered.tasks[0]?.id, "task-b");
      assert.strictEqual(
        fs.existsSync(path.join(workspaceRoot, ".vscode", "scheduler-config.transaction.json")),
        false,
      );
    } finally {
      setSchedulerFileOpsForTests(undefined);
      cleanup(workspaceRoot);
    }
  });

  test("fails fast when another writer holds the scheduler lock", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const lockPath = path.join(workspaceRoot, ".vscode", "scheduler-config.lock");
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.mkdirSync(lockPath, { recursive: true });
      setSchedulerLockOptionsForTests({
        maxWaitMs: 10,
        retryMs: 1,
        staleMs: 60_000,
      });

      assert.throws(() => {
        writeSchedulerConfig(workspaceRoot, {
          tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
        });
      }, /locked by another writer/);
    } finally {
      setSchedulerLockOptionsForTests(undefined);
      try {
        fs.rmSync(path.join(workspaceRoot, ".vscode", "scheduler-config.lock"), { recursive: true, force: true });
      } catch {
        // ignore
      }
      cleanup(workspaceRoot);
    }
  });

  test("reads the transaction snapshot while a writer holds the lock", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
      });

      const vscodeDir = path.join(workspaceRoot, ".vscode");
      const configPath = path.join(vscodeDir, "scheduler.json");
      const privateConfigPath = getPrivateSchedulerConfigPath(configPath);
      const lockPath = path.join(vscodeDir, "scheduler-config.lock");
      const transactionPath = path.join(vscodeDir, "scheduler-config.transaction.json");

      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(
        transactionPath,
        JSON.stringify({
          version: 1,
          createdAt: "2026-04-02T10:05:00.000Z",
          publicPath: configPath,
          privatePath: privateConfigPath,
          publicChanged: true,
          privateChanged: true,
          publicContent: JSON.stringify({
            tasks: [createTaskRecord("task-b", "2026-04-02T10:05:00.000Z")],
            deletedTaskIds: [],
            jobs: [],
            deletedJobIds: [],
            jobFolders: [],
            deletedJobFolderIds: [],
          }),
          privateContent: JSON.stringify({
            tasks: [createTaskRecord("task-b", "2026-04-02T10:05:00.000Z")],
            deletedTaskIds: [],
            jobs: [],
            deletedJobIds: [],
            jobFolders: [],
            deletedJobFolderIds: [],
          }),
        }, null, 2),
        "utf8",
      );

      const snapshot = readSchedulerConfig(workspaceRoot);
      assert.strictEqual(snapshot.tasks.length, 1);
      assert.strictEqual(snapshot.tasks[0]?.id, "task-b");
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("clears a stale scheduler lock before writing", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const lockPath = path.join(workspaceRoot, ".vscode", "scheduler-config.lock");
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.mkdirSync(lockPath, { recursive: true });

      setSchedulerLockOptionsForTests({
        staleMs: 0,
        retryMs: 1,
        maxWaitMs: 25,
      });

      const result = writeSchedulerConfig(workspaceRoot, {
        tasks: [createTaskRecord("task-a", "2026-04-02T10:00:00.000Z")],
      });

      assert.strictEqual(result.publicChanged, true);
      assert.strictEqual(fs.existsSync(lockPath), false);
      assert.strictEqual(readSchedulerConfig(workspaceRoot).tasks[0]?.id, "task-a");
    } finally {
      setSchedulerLockOptionsForTests(undefined);
      cleanup(workspaceRoot);
    }
  });
});
