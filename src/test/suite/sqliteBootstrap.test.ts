import * as fs from "fs";
import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import initSqlJs from "sql.js";
import {
  bootstrapGlobalSqliteStorage,
  bootstrapWorkspaceSqliteStorage,
  exportWorkspaceSqliteToJsonMirrors,
  pruneSqliteBackups,
  readWorkspaceCockpitBoardFromSqlite,
  setSqliteAtomicWriteFsForTests,
  setSqliteLockOptionsForTests,
  syncGlobalTasksToSqlite,
  syncWorkspaceCockpitBoardToSqlite,
  syncWorkspaceResearchStateToSqlite,
  syncWorkspaceSchedulerStateToSqlite,
} from "../../sqliteBootstrap";
import {
  GLOBAL_SQLITE_SCHEMA_VERSION,
  WORKSPACE_SQLITE_SCHEMA_VERSION,
  getGlobalStoragePaths,
  getGlobalStorageDatabasePath,
  getWorkspaceStoragePaths,
} from "../../sqliteStorage";
import { wasSchedulerConfigWrittenRecently } from "../../cockpitJsonSanitizer";

type SqlJsDatabase = {
  exec: (sql: string) => Array<{ values?: unknown[][] }>;
  run: (sql: string, params?: unknown[]) => void;
  export: () => Uint8Array;
  close: () => void;
};

async function openDatabase(databasePath: string): Promise<SqlJsDatabase> {
  const SQL = await initSqlJs({
    locateFile: (file: string) => require.resolve(`sql.js/dist/${file}`),
  }) as { Database: new (data?: Uint8Array) => SqlJsDatabase };
  return new SQL.Database(fs.readFileSync(databasePath));
}

function firstScalar(db: SqlJsDatabase, sql: string): unknown {
  const result = db.exec(sql);
  return result[0]?.values?.[0]?.[0];
}

function getSqliteLockPath(databasePath: string): string {
  return path.join(path.dirname(databasePath), `${path.basename(databasePath)}.lock`);
}

suite("SQLite Bootstrap Tests", () => {
  function createTempRoot(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  function cleanup(root: string): void {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // ignore
    }
  }

  test("bootstraps a workspace sqlite database file", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-workspace-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(path.dirname(paths.publicSchedulerMirrorPath), { recursive: true });
      fs.writeFileSync(
        paths.publicSchedulerMirrorPath,
        JSON.stringify({
          tasks: [{ id: "task-1", name: "Task 1", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          deletedTaskIds: ["task-deleted"],
          jobs: [{ id: "job-1", name: "Job 1", cronExpression: "0 * * * *", nodes: [], createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          jobFolders: [{ id: "folder-1", name: "Folder 1", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        }, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        paths.privateSchedulerMirrorPath,
        JSON.stringify({
          tasks: [],
          cockpitBoard: {
            version: 4,
            sections: [{ id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
            cards: [{
              id: "card-1",
              title: "Card 1",
              sectionId: "unsorted",
              order: 0,
              priority: "medium",
              status: "active",
              labels: ["ops"],
              flags: ["go"],
              comments: [{ id: "comment-1", author: "user", body: "hello", source: "human-form", sequence: 1, createdAt: "2026-04-04T00:00:00.000Z" }],
              createdAt: "2026-04-04T00:00:00.000Z",
              updatedAt: "2026-04-04T00:00:00.000Z",
            }],
            labelCatalog: [{ key: "ops", name: "Ops", color: "#112233", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
            flagCatalog: [{ key: "go", name: "go", color: "#445566", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z", system: true }],
            deletedCardIds: ["card-deleted"],
            filters: { labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false },
            updatedAt: "2026-04-04T00:00:00.000Z",
          },
        }, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "research.json"),
        JSON.stringify({
          version: 1,
          profiles: [{ id: "research-1", name: "Profile 1", instructions: "Do work", editablePaths: [], benchmarkCommand: "npm test", metricPattern: "ok", metricDirection: "maximize", maxIterations: 1, maxMinutes: 5, maxConsecutiveFailures: 1, benchmarkTimeoutSeconds: 60, editWaitSeconds: 5, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          runs: [{ id: "run-1", profileId: "research-1", profileName: "Profile 1", status: "completed", startedAt: "2026-04-04T00:00:00.000Z", finishedAt: "2026-04-04T00:05:00.000Z", completedIterations: 1, attempts: [] }],
        }, null, 2),
        "utf8",
      );

      const result = await bootstrapWorkspaceSqliteStorage(workspaceRoot, true);

      assert.strictEqual(result.created, true);
      assert.strictEqual(result.schemaVersion, WORKSPACE_SQLITE_SCHEMA_VERSION);
      assert.strictEqual(result.databasePath, paths.databasePath);
      assert.strictEqual(fs.existsSync(paths.databasePath), true);
      assert.ok(fs.statSync(paths.databasePath).size > 0);
      assert.strictEqual(result.importCounts.workspaceTasks, 1);
      assert.strictEqual(result.importCounts.cockpitCards, 1);
      assert.strictEqual(result.importCounts.researchProfiles, 1);
      assert.strictEqual(fs.existsSync(paths.migrationJournalPath), true);

      const journal = JSON.parse(fs.readFileSync(paths.migrationJournalPath, "utf8"));
      assert.strictEqual(journal.importCounts.workspaceTasks, 1);
      assert.strictEqual(journal.importCounts.cockpitComments, 1);

      const db = await openDatabase(paths.databasePath);
      try {
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_tasks"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM cockpit_cards"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM cockpit_comments"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM research_profiles"), 1);
        assert.strictEqual(
          firstScalar(db, "SELECT value FROM app_metadata WHERE key = 'workspace_schema_version'"),
          String(WORKSPACE_SQLITE_SCHEMA_VERSION),
        );
        assert.strictEqual(
          firstScalar(db, "SELECT name FROM schema_migrations WHERE version = 2"),
          "initialize_schema_migrations_journal",
        );
      } finally {
        db.close();
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("bootstraps from the private scheduler mirror when the public mirror is malformed", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-private-fallback-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(path.dirname(paths.publicSchedulerMirrorPath), { recursive: true });
      fs.writeFileSync(paths.publicSchedulerMirrorPath, "{ invalid json", "utf8");
      fs.writeFileSync(
        paths.privateSchedulerMirrorPath,
        JSON.stringify({
          tasks: [{ id: "task-private-1", name: "Private Task", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          deletedTaskIds: ["task-private-deleted"],
          jobs: [{ id: "job-private-1", name: "Private Job", cronExpression: "0 * * * *", nodes: [], createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          jobFolders: [{ id: "folder-private-1", name: "Private Folder", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        }, null, 2),
        "utf8",
      );

      const result = await bootstrapWorkspaceSqliteStorage(workspaceRoot, true);
      const db = await openDatabase(paths.databasePath);

      try {
        assert.strictEqual(result.importCounts.workspaceTasks, 1);
        assert.strictEqual(result.importCounts.deletedTaskIds, 1);
        assert.strictEqual(result.importCounts.jobs, 1);
        assert.strictEqual(result.importCounts.jobFolders, 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_tasks"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_task_tombstones"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_jobs"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_job_folders"), 1);
      } finally {
        db.close();
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("bootstraps a global sqlite database file", async () => {
    const globalRoot = createTempRoot("copilot-sqlite-global-");

    try {
      const globalPaths = getGlobalStoragePaths(globalRoot);
      fs.mkdirSync(globalRoot, { recursive: true });
      fs.writeFileSync(
        globalPaths.scheduledTasksPath,
        JSON.stringify([
          { id: "global-task-1", name: "Global Task 1", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" },
        ], null, 2),
        "utf8",
      );

      const result = await bootstrapGlobalSqliteStorage(globalRoot);
      const databasePath = getGlobalStorageDatabasePath(globalRoot);

      assert.strictEqual(result.created, true);
      assert.strictEqual(result.schemaVersion, GLOBAL_SQLITE_SCHEMA_VERSION);
      assert.strictEqual(result.databasePath, databasePath);
      assert.strictEqual(fs.existsSync(databasePath), true);
      assert.ok(fs.statSync(databasePath).size > 0);
      assert.strictEqual(result.importCounts.globalTasks, 1);

      const db = await openDatabase(databasePath);
      try {
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM global_tasks"), 1);
        assert.strictEqual(
          firstScalar(db, "SELECT value FROM app_metadata WHERE key = 'global_schema_version'"),
          String(GLOBAL_SQLITE_SCHEMA_VERSION),
        );
        assert.strictEqual(
          firstScalar(db, "SELECT name FROM schema_migrations WHERE version = 2"),
          "initialize_schema_migrations_journal",
        );
      } finally {
        db.close();
      }
    } finally {
      cleanup(globalRoot);
    }
  });

  test("syncs and reads cockpit board state through sqlite", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-cockpit-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(path.dirname(paths.databasePath), { recursive: true });

      await syncWorkspaceCockpitBoardToSqlite(workspaceRoot, {
        version: 4,
        sections: [
          {
            id: "unsorted",
            title: "Unsorted",
            order: 0,
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        cards: [
          {
            id: "card-1",
            title: "SQLite cockpit card",
            sectionId: "unsorted",
            order: 0,
            priority: "medium",
            status: "active",
            labels: ["ops"],
            flags: ["go"],
            comments: [
              {
                id: "comment-1",
                author: "user",
                body: "hello",
                source: "human-form",
                sequence: 1,
                createdAt: "2026-04-04T00:00:00.000Z",
              },
            ],
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:00:00.000Z",
            archived: false,
          },
        ],
        labelCatalog: [
          {
            key: "ops",
            name: "Ops",
            color: "#112233",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:00:00.000Z",
          },
        ],
        flagCatalog: [
          {
            key: "go",
            name: "go",
            color: "#445566",
            createdAt: "2026-04-04T00:00:00.000Z",
            updatedAt: "2026-04-04T00:00:00.000Z",
            system: true,
          },
        ],
        deletedCardIds: ["card-deleted"],
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
        updatedAt: "2026-04-04T00:00:00.000Z",
      } as any);

      const board = await readWorkspaceCockpitBoardFromSqlite(workspaceRoot);

      assert.ok(board);
      assert.strictEqual(board?.cards?.[0]?.title, "SQLite cockpit card");
      assert.strictEqual(board?.cards?.[0]?.comments?.[0]?.body, "hello");
      assert.strictEqual(board?.labelCatalog?.[0]?.name, "Ops");
      assert.strictEqual(board?.flagCatalog?.[0]?.name, "new");
      assert.deepStrictEqual(board?.deletedCardIds ?? [], ["card-deleted"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("contextualizes invalid cockpit card payloads before sqlite insert", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-cockpit-invalid-payload-");
    const originalStringify = JSON.stringify;

    JSON.stringify = ((value: unknown, replacer?: unknown, space?: string | number) => {
      if (
        value
        && typeof value === "object"
        && "id" in value
        && (value as { id?: unknown }).id === "card-bad"
      ) {
        return undefined;
      }
      return originalStringify(value, replacer as Parameters<typeof JSON.stringify>[1], space);
    }) as typeof JSON.stringify;

    try {
      await assert.rejects(
        syncWorkspaceCockpitBoardToSqlite(workspaceRoot, {
          version: 4,
          sections: [{ id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          cards: [{ id: "card-bad", title: "Bad card", sectionId: "unsorted", order: 0, priority: "medium", status: "active", labels: [], flags: [], comments: [], archived: false, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          filters: { labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false },
          updatedAt: "2026-04-04T00:00:00.000Z",
        } as any),
        /Invalid sqlite payload for cockpit card in cockpit_cards \(id: card-bad\): JSON serialization returned undefined\./,
      );
    } finally {
      JSON.stringify = originalStringify;
      cleanup(workspaceRoot);
    }
  });

  test("sync writes sqlite databases through a temp-file rename instead of overwriting in place", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-atomic-write-");
    const paths = getWorkspaceStoragePaths(workspaceRoot);
    const originalWriteFileSync = fs.writeFileSync;
    const originalRenameSync = fs.renameSync;
    const writeTargets: string[] = [];
    const renameTargets: Array<{ from: string; to: string }> = [];

    setSqliteAtomicWriteFsForTests({
      writeFileSync: ((...args: Parameters<typeof fs.writeFileSync>) => {
        writeTargets.push(String(args[0]));
        return originalWriteFileSync(...args);
      }) as typeof fs.writeFileSync,
      renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
        renameTargets.push({ from: String(oldPath), to: String(newPath) });
        return originalRenameSync(oldPath, newPath);
      }) as typeof fs.renameSync,
    });

    try {
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      assert.ok(fs.existsSync(paths.databasePath));
      assert.strictEqual(writeTargets.includes(paths.databasePath), false);
      assert.ok(
        writeTargets.some((target) => target.startsWith(`${paths.databasePath}.`) && target.endsWith(".tmp")),
      );
      assert.ok(
        renameTargets.some(({ from, to }) => from.startsWith(`${paths.databasePath}.`) && from.endsWith(".tmp") && to === paths.databasePath),
      );
    } finally {
      setSqliteAtomicWriteFsForTests();
      cleanup(workspaceRoot);
    }
  });

  test("sync marks its sqlite authority write so workspace watchers can ignore self-triggered reloads", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-recent-authority-write-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      assert.strictEqual(
        wasSchedulerConfigWrittenRecently(paths.databasePath),
        true,
      );
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("records pending workspace schema migrations when an older database is reopened", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-migration-reopen-");

    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-old", name: "Old Task", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      const downgraded = await openDatabase(databasePath);
      try {
        downgraded.run("DELETE FROM schema_migrations WHERE version = 2");
        downgraded.run(
          "UPDATE app_metadata SET value = '1' WHERE key = 'workspace_schema_version'",
        );
        fs.writeFileSync(databasePath, Buffer.from(downgraded.export()));
      } finally {
        downgraded.close();
      }

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-new", name: "New Task", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      const migrated = await openDatabase(databasePath);
      try {
        assert.strictEqual(
          firstScalar(migrated, "SELECT value FROM app_metadata WHERE key = 'workspace_schema_version'"),
          String(WORKSPACE_SQLITE_SCHEMA_VERSION),
        );
        assert.strictEqual(
          firstScalar(migrated, "SELECT name FROM schema_migrations WHERE version = 2"),
          "initialize_schema_migrations_journal",
        );
      } finally {
        migrated.close();
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("quarantines an invalid sqlite database before rebuilding", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-quarantine-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(path.dirname(paths.databasePath), { recursive: true });
      fs.writeFileSync(paths.databasePath, "not sqlite", "utf8");

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      const quarantined = fs.readdirSync(path.dirname(paths.databasePath))
        .filter((fileName) => fileName.startsWith(`${path.basename(paths.databasePath)}.`) && fileName.endsWith(".corrupt"));
      assert.strictEqual(quarantined.length, 1);
      assert.strictEqual(
        fs.readFileSync(path.join(path.dirname(paths.databasePath), quarantined[0]), "utf8"),
        "not sqlite",
      );

      const db = await openDatabase(paths.databasePath);
      try {
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_tasks"), 1);
      } finally {
        db.close();
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("fails after a bounded wait when another sqlite writer holds the database lock", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-lock-timeout-");

    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const lockPath = getSqliteLockPath(databasePath);
      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 123 }), "utf8");
      setSqliteLockOptionsForTests({ staleMs: 60_000, maxWaitMs: 25, retryMs: 5 });

      await assert.rejects(
        syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
          tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
          deletedTaskIds: [],
          jobs: [],
          deletedJobIds: [],
          jobFolders: [],
          deletedJobFolderIds: [],
        } as any),
        /SQLite database is locked by another writer/,
      );
    } finally {
      setSqliteLockOptionsForTests();
      cleanup(workspaceRoot);
    }
  });

  test("clears a stale sqlite database lock before writing", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-stale-lock-");

    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const lockPath = getSqliteLockPath(databasePath);
      fs.mkdirSync(lockPath, { recursive: true });
      fs.writeFileSync(path.join(lockPath, "owner.json"), JSON.stringify({ pid: 123 }), "utf8");
      const staleAt = new Date(Date.now() - 10_000);
      fs.utimesSync(lockPath, staleAt, staleAt);
      setSqliteLockOptionsForTests({ staleMs: 50, maxWaitMs: 200, retryMs: 5 });

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      const db = await openDatabase(databasePath);
      try {
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_tasks"), 1);
      } finally {
        db.close();
      }
      assert.strictEqual(fs.existsSync(lockPath), false);
    } finally {
      setSqliteLockOptionsForTests();
      cleanup(workspaceRoot);
    }
  });

  test("exports sqlite workspace state back into json mirrors", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-export-workspace-");
    const globalRoot = createTempRoot("copilot-sqlite-export-global-");

    try {
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: ["task-deleted"],
        jobs: [{ id: "job-1", name: "Job 1", cronExpression: "0 * * * *", nodes: [], createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedJobIds: ["job-deleted"],
        jobFolders: [{ id: "folder-1", name: "Folder 1", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedJobFolderIds: ["folder-deleted"],
      } as any);
      await syncWorkspaceCockpitBoardToSqlite(workspaceRoot, {
        version: 4,
        sections: [{ id: "unsorted", title: "Unsorted", order: 0, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        cards: [{ id: "card-1", title: "Card 1", sectionId: "unsorted", order: 0, priority: "medium", status: "active", labels: [], flags: [], comments: [], archived: false, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        filters: { labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false, hideCardDetails: false },
        updatedAt: "2026-04-04T00:00:00.000Z",
      } as any);
      await syncWorkspaceResearchStateToSqlite(workspaceRoot, {
        profiles: [{ id: "research-1", name: "Profile 1", instructions: "Do work", editablePaths: [], benchmarkCommand: "npm test", metricPattern: "ok", metricDirection: "maximize", maxIterations: 1, maxMinutes: 5, maxConsecutiveFailures: 1, benchmarkTimeoutSeconds: 60, editWaitSeconds: 5, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        runs: [{ id: "run-1", profileId: "research-1", profileName: "Profile 1", status: "completed", startedAt: "2026-04-04T00:00:00.000Z", finishedAt: "2026-04-04T00:05:00.000Z", completedIterations: 1, attempts: [] }],
      } as any);
      await syncGlobalTasksToSqlite(globalRoot, [
        { id: "global-task-1", name: "Global Task 1", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" },
      ]);

      const summary = await exportWorkspaceSqliteToJsonMirrors(workspaceRoot, globalRoot);
      const workspacePaths = getWorkspaceStoragePaths(workspaceRoot);
      const globalPaths = getGlobalStoragePaths(globalRoot);
      const publicConfig = JSON.parse(fs.readFileSync(workspacePaths.publicSchedulerMirrorPath, "utf8"));
      const privateConfig = JSON.parse(fs.readFileSync(workspacePaths.privateSchedulerMirrorPath, "utf8"));
      const researchConfig = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".vscode", "research.json"), "utf8"));
      const globalTasks = JSON.parse(fs.readFileSync(globalPaths.scheduledTasksPath, "utf8"));
      const globalMeta = JSON.parse(fs.readFileSync(globalPaths.scheduledTasksMetaPath, "utf8"));

      assert.strictEqual(summary.exportedCounts.workspaceTasks, 1);
      assert.strictEqual(summary.exportedCounts.cockpitCards, 1);
      assert.strictEqual(summary.exportedCounts.researchProfiles, 1);
      assert.strictEqual(publicConfig.tasks.length, 1);
      assert.strictEqual(publicConfig.deletedTaskIds[0], "task-deleted");
      assert.strictEqual(publicConfig.jobs.length, 1);
      assert.strictEqual(privateConfig.cockpitBoard.cards.length, 1);
      assert.strictEqual(researchConfig.profiles.length, 1);
      assert.strictEqual(globalTasks.length, 1);
      assert.ok(typeof globalMeta.revision === "number");
      assert.ok(typeof globalMeta.savedAt === "string");
    } finally {
      cleanup(workspaceRoot);
      cleanup(globalRoot);
    }
  });

  test("bootstraps successfully when both scheduler mirrors are absent (empty state)", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-empty-bootstrap-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(path.dirname(paths.publicSchedulerMirrorPath), { recursive: true });

      const result = await bootstrapWorkspaceSqliteStorage(workspaceRoot, false);
      const db = await openDatabase(paths.databasePath);

      try {
        assert.strictEqual(result.created, true);
        assert.strictEqual(result.importCounts.workspaceTasks, 0);
        assert.strictEqual(result.importCounts.cockpitCards, 0);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_tasks"), 0);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM cockpit_cards"), 0);
      } finally {
        db.close();
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("export skips global tasks when global sqlite database does not exist", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-export-no-global-");
    const ghostGlobalRoot = createTempRoot("copilot-sqlite-ghost-global-");

    try {
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-a", name: "Task A", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      // ghostGlobalRoot has no database file at all
      const summary = await exportWorkspaceSqliteToJsonMirrors(workspaceRoot, ghostGlobalRoot);
      const globalPaths = getGlobalStoragePaths(ghostGlobalRoot);

      assert.strictEqual(summary.exportedCounts.workspaceTasks, 1);
      assert.strictEqual(summary.globalTasksPath, undefined);
      assert.ok(!fs.existsSync(globalPaths.scheduledTasksPath));
    } finally {
      cleanup(workspaceRoot);
      cleanup(ghostGlobalRoot);
    }
  });

  test("export preserves tombstones in the public scheduler mirror", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-export-tombstone-");
    const globalRoot = createTempRoot("copilot-sqlite-export-tombstone-global-");

    try {
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "live-task", name: "Live Task", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: ["dead-task-1", "dead-task-2"],
        jobs: [{ id: "live-job", name: "Live Job", cronExpression: "0 * * * *", nodes: [], createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedJobIds: ["dead-job"],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      await exportWorkspaceSqliteToJsonMirrors(workspaceRoot, globalRoot);

      const workspacePaths = getWorkspaceStoragePaths(workspaceRoot);
      const publicConfig = JSON.parse(fs.readFileSync(workspacePaths.publicSchedulerMirrorPath, "utf8"));

      assert.strictEqual(publicConfig.tasks.length, 1);
      assert.strictEqual(publicConfig.tasks[0].id, "live-task");
      assert.deepStrictEqual(publicConfig.deletedTaskIds.sort(), ["dead-task-1", "dead-task-2"]);
      assert.strictEqual(publicConfig.jobs.length, 1);
      assert.deepStrictEqual(publicConfig.deletedJobIds, ["dead-job"]);
    } finally {
      cleanup(workspaceRoot);
      cleanup(globalRoot);
    }
  });

  test("exports authoritative sqlite state into stale mirrors and preserves metadata versions", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-export-preserve-");
    const globalRoot = createTempRoot("copilot-sqlite-export-preserve-global-");

    try {
      const workspacePaths = getWorkspaceStoragePaths(workspaceRoot);
      const globalPaths = getGlobalStoragePaths(globalRoot);
      fs.mkdirSync(path.dirname(workspacePaths.publicSchedulerMirrorPath), { recursive: true });
      fs.mkdirSync(globalRoot, { recursive: true });

      fs.writeFileSync(
        workspacePaths.publicSchedulerMirrorPath,
        JSON.stringify({
          tasks: [{ id: "stale-task", name: "Stale Task", createdAt: "2026-04-03T00:00:00.000Z", updatedAt: "2026-04-03T00:00:00.000Z" }],
          jobs: [],
          jobFolders: [],
        }, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        workspacePaths.privateSchedulerMirrorPath,
        JSON.stringify({
          tasks: [],
          jobs: [],
          jobFolders: [],
          telegramNotification: {
            enabled: true,
            botToken: "secret-token",
            chatId: "12345",
          },
        }, null, 2),
        "utf8",
      );
      const now = new Date();
      fs.utimesSync(workspacePaths.privateSchedulerMirrorPath, now, new Date(now.getTime() + 1000));
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "research.json"),
        JSON.stringify({
          version: 7,
          profiles: [],
          runs: [],
        }, null, 2),
        "utf8",
      );
      fs.writeFileSync(
        globalPaths.scheduledTasksMetaPath,
        JSON.stringify({
          revision: 9,
          savedAt: "2026-04-03T00:00:00.000Z",
        }, null, 2),
        "utf8",
      );

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Fresh Task", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: ["task-deleted"],
        jobs: [{ id: "job-1", name: "Fresh Job", cronExpression: "0 * * * *", nodes: [], createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);
      await syncWorkspaceResearchStateToSqlite(workspaceRoot, {
        profiles: [{ id: "research-1", name: "Profile 1", instructions: "Do work", editablePaths: [], benchmarkCommand: "npm test", metricPattern: "ok", metricDirection: "maximize", maxIterations: 1, maxMinutes: 5, maxConsecutiveFailures: 1, benchmarkTimeoutSeconds: 60, editWaitSeconds: 5, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        runs: [],
      } as any);
      await syncGlobalTasksToSqlite(globalRoot, [
        { id: "global-task-1", name: "Global Task 1", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" },
      ]);

      const summary = await exportWorkspaceSqliteToJsonMirrors(workspaceRoot, globalRoot);
      const publicConfig = JSON.parse(fs.readFileSync(workspacePaths.publicSchedulerMirrorPath, "utf8"));
      const privateConfig = JSON.parse(fs.readFileSync(workspacePaths.privateSchedulerMirrorPath, "utf8"));
      const researchConfig = JSON.parse(fs.readFileSync(path.join(workspaceRoot, ".vscode", "research.json"), "utf8"));
      const globalMeta = JSON.parse(fs.readFileSync(globalPaths.scheduledTasksMetaPath, "utf8"));

      assert.strictEqual(summary.exportedCounts.workspaceTasks, 1);
      assert.strictEqual(publicConfig.tasks.length, 1);
      assert.strictEqual(publicConfig.tasks[0].id, "task-1");
      assert.deepStrictEqual(publicConfig.deletedTaskIds, ["task-deleted"]);
      assert.strictEqual(privateConfig.telegramNotification.botToken, "secret-token");
      assert.strictEqual(researchConfig.version, 7);
      assert.strictEqual(researchConfig.profiles.length, 1);
      assert.strictEqual(globalMeta.revision, 10);
      assert.ok(typeof globalMeta.savedAt === "string");
    } finally {
      cleanup(workspaceRoot);
      cleanup(globalRoot);
    }
  });

  test("copies over the live sqlite database on Windows without removing the canonical path", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-windows-backup-");
    const paths = getWorkspaceStoragePaths(workspaceRoot);
    fs.mkdirSync(path.dirname(paths.publicSchedulerMirrorPath), { recursive: true });
    fs.writeFileSync(paths.publicSchedulerMirrorPath, JSON.stringify({ tasks: [], jobs: [], jobFolders: [] }, null, 2), "utf8");
    fs.writeFileSync(paths.privateSchedulerMirrorPath, JSON.stringify({ tasks: [], jobs: [], jobFolders: [] }, null, 2), "utf8");

    // Bootstrap first so an existing database triggers the backup-rename path
    await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
      tasks: [{ id: "task-init", name: "Init", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
      deletedTaskIds: [],
      jobs: [],
      deletedJobIds: [],
      jobFolders: [],
      deletedJobFolderIds: [],
    } as any);

    const originalRenameSync = fs.renameSync;
    const originalCopyFileSync = fs.copyFileSync;
    const originalRmSync = fs.rmSync;
    const originalPlatform = process.platform;
    let copyFileCalls: Array<{ src: string; dest: string }> = [];
    let removedDatabase = false;

    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      setSqliteAtomicWriteFsForTests({
        renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
          return originalRenameSync(oldPath, newPath);
        }) as typeof fs.renameSync,
        copyFileSync: ((src: fs.PathLike, dest: fs.PathLike) => {
          copyFileCalls.push({ src: String(src), dest: String(dest) });
          return originalCopyFileSync(src, dest);
        }) as typeof fs.copyFileSync,
        rmSync: ((target: fs.PathLike, options?: fs.RmOptions) => {
          if (String(target) === paths.databasePath) {
            removedDatabase = true;
          }
          return originalRmSync(target, options as fs.RmOptions);
        }) as typeof fs.rmSync,
      });

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      assert.strictEqual(removedDatabase, false);
      assert.ok(copyFileCalls.some((call) => call.dest === paths.databasePath));
      assert.ok(copyFileCalls.some((call) => call.src === paths.databasePath && call.dest.endsWith(".bak")));
      assert.ok(fs.existsSync(paths.databasePath));
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      setSqliteAtomicWriteFsForTests();
      cleanup(workspaceRoot);
    }
  });

  test("falls back to copyFileSync when renameSync commit also fails on Windows", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-windows-commit-");
    const paths = getWorkspaceStoragePaths(workspaceRoot);
    fs.mkdirSync(path.dirname(paths.publicSchedulerMirrorPath), { recursive: true });
    fs.writeFileSync(paths.publicSchedulerMirrorPath, JSON.stringify({ tasks: [], jobs: [], jobFolders: [] }, null, 2), "utf8");
    fs.writeFileSync(paths.privateSchedulerMirrorPath, JSON.stringify({ tasks: [], jobs: [], jobFolders: [] }, null, 2), "utf8");

    const originalRenameSync = fs.renameSync;
    const originalCopyFileSync = fs.copyFileSync;
    const originalPlatform = process.platform;
    let copyFileCalls: Array<{ src: string; dest: string }> = [];
    let renameAttempts = 0;

    try {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      setSqliteAtomicWriteFsForTests({
        renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
          renameAttempts++;
          // Fail the commit rename (should be the one moving .tmp -> database) with EBUSY
          const newPathStr = String(newPath);
          if (newPathStr === paths.databasePath) {
            const err = new Error("EBUSY: resource busy") as NodeJS.ErrnoException;
            err.code = "EBUSY";
            throw err;
          }
          return originalRenameSync(oldPath, newPath);
        }) as typeof fs.renameSync,
        copyFileSync: ((src: fs.PathLike, dest: fs.PathLike) => {
          copyFileCalls.push({ src: String(src), dest: String(dest) });
          return originalCopyFileSync(src, dest);
        }) as typeof fs.copyFileSync,
      });

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cronExpression: "0 * * * *", prompt: "run", enabled: true, scope: "workspace", promptSource: "inline", createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      assert.ok(copyFileCalls.length >= 1, "Expected at least one copyFileSync fallback call");
      assert.ok(fs.existsSync(paths.databasePath));
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      setSqliteAtomicWriteFsForTests();
      cleanup(workspaceRoot);
    }
  });

  test("compacts sqlite database after replace-style sync so file does not grow unbounded", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-compact-");

    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const baseTask = {
        cronExpression: "0 * * * *",
        prompt: "run",
        enabled: true,
        scope: "workspace" as const,
        promptSource: "inline" as const,
        createdAt: "2026-04-04T00:00:00.000Z",
        updatedAt: "2026-04-04T00:00:00.000Z",
      };

      // 1) Sync a large set of tasks to grow the database
      const largeTasks = Array.from({ length: 50 }, (_, i) => ({
        id: `task-${i}`,
        name: `Task ${i} `.repeat(20).trim(),
        ...baseTask,
      }));

      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: largeTasks as any[],
        deletedTaskIds: Array.from({ length: 50 }, (_, i) => `deleted-${i}`),
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      assert.ok(fs.existsSync(databasePath));
      const sizeAfterLarge = fs.statSync(databasePath).size;
      assert.ok(sizeAfterLarge > 8192, `Expected database to grow above 8KB after 50 tasks, got ${sizeAfterLarge}`);

      // 2) Sync a tiny state (single task) — triggers delete-all + insert + vacuum + persist
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{
          id: "task-single",
          name: "Single",
          ...baseTask,
        }] as any[],
        deletedTaskIds: [],
        jobs: [],
        deletedJobIds: [],
        jobFolders: [],
        deletedJobFolderIds: [],
      } as any);

      const sizeAfterCompact = fs.statSync(databasePath).size;

      // After VACUUM, the database file should be strictly smaller than after the
      // large payload.  The large dataset had 100 rows (50 tasks + 50 tombstones),
      // the compacted dataset has 1 row, so any increase would indicate VACUUM
      // was not called or is not working.
      assert.ok(
        sizeAfterCompact < sizeAfterLarge,
        `Expected compacted DB size (${sizeAfterCompact}) to be strictly smaller than large-DB size (${sizeAfterLarge})`,
      );

      const db = await openDatabase(databasePath);
      try {
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_tasks"), 1);
        assert.strictEqual(firstScalar(db, "SELECT COUNT(*) FROM workspace_task_tombstones"), 0);
      } finally {
        db.close();
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  // ──────────────────────────────────────────────
  // Backup pruning tests
  // ──────────────────────────────────────────────

  test("pruneSqliteBackups deletes old .bak files keeping only the N newest", () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-prune-1-");
    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const vscodeDir = path.dirname(databasePath);
      fs.mkdirSync(vscodeDir, { recursive: true });

      // Create 5 fake .bak files with staggered mtimes
      const bakFiles: string[] = [];
      for (let i = 0; i < 5; i++) {
        const bakPath = path.join(vscodeDir, `copilot-cockpit.db.test${i}.bak`);
        fs.writeFileSync(bakPath, `backup-${i}`);
        // Set increasing mtimes so 0 is oldest, 4 is newest
        const mtime = new Date(Date.now() - (5 - i) * 10000);
        fs.utimesSync(bakPath, mtime, mtime);
        bakFiles.push(bakPath);
      }

      // Also create a non-bak file that should be ignored
      fs.writeFileSync(path.join(vscodeDir, "other-file.txt"), "not a bak");

      // Prune to 2
      pruneSqliteBackups(databasePath, 2);

      // Only the 2 newest should survive (test4, test3)
      assert.strictEqual(fs.existsSync(bakFiles[0]), false, "bak[0] oldest should be deleted");
      assert.strictEqual(fs.existsSync(bakFiles[1]), false, "bak[1] should be deleted");
      assert.strictEqual(fs.existsSync(bakFiles[2]), false, "bak[2] should be deleted");
      assert.strictEqual(fs.existsSync(bakFiles[3]), true, "bak[3] should survive");
      assert.strictEqual(fs.existsSync(bakFiles[4]), true, "bak[4] newest should survive");

      // Non-bak file should be untouched
      assert.strictEqual(fs.existsSync(path.join(vscodeDir, "other-file.txt")), true);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("pruneSqliteBackups is a no-op when bak files are within limit", () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-prune-2-");
    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const vscodeDir = path.dirname(databasePath);
      fs.mkdirSync(vscodeDir, { recursive: true });

      // Create only 2 bak files
      for (let i = 0; i < 2; i++) {
        fs.writeFileSync(path.join(vscodeDir, `copilot-cockpit.db.bak-${i}.bak`), `backup-${i}`);
      }

      // Prune to 5 (more than we have)
      pruneSqliteBackups(databasePath, 5);

      // Both should survive
      assert.strictEqual(fs.existsSync(path.join(vscodeDir, "copilot-cockpit.db.bak-0.bak")), true);
      assert.strictEqual(fs.existsSync(path.join(vscodeDir, "copilot-cockpit.db.bak-1.bak")), true);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("pruneSqliteBackups deletes all when maxBackups is 0", () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-prune-3-");
    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const vscodeDir = path.dirname(databasePath);
      fs.mkdirSync(vscodeDir, { recursive: true });

      // Create 3 bak files
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(vscodeDir, `copilot-cockpit.db.bak-${i}.bak`), `backup-${i}`);
      }

      // Prune to 0
      pruneSqliteBackups(databasePath, 0);

      // All should be deleted
      for (let i = 0; i < 3; i++) {
        assert.strictEqual(
          fs.existsSync(path.join(vscodeDir, `copilot-cockpit.db.bak-${i}.bak`)),
          false,
          `bak-${i} should be deleted when maxBackups is 0`,
        );
      }
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("pruneSqliteBackups works through sqliteAtomicWriteFs indirection", () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-prune-4-");
    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      const vscodeDir = path.dirname(databasePath);
      fs.mkdirSync(vscodeDir, { recursive: true });

      // Create bak files directly on disk
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(path.join(vscodeDir, `copilot-cockpit.db.bak-${i}.bak`), `backup-${i}`);
      }

      // Use the default fs (setSqliteAtomicWriteFsForTests was not called here)
      // but verify pruneSqliteBackups uses sqliteAtomicWriteFs by checking
      // it still works with the real filesystem
      pruneSqliteBackups(databasePath, 1);

      // Exactly 1 should survive (the one with highest mtime)
      const surviving = fs.readdirSync(vscodeDir).filter((f) => f.endsWith(".bak"));
      assert.strictEqual(surviving.length, 1, `Expected 1 surviving bak, got ${surviving.length}`);
    } finally {
      setSqliteAtomicWriteFsForTests(); // Reset to real fs
      cleanup(workspaceRoot);
    }
  });

  test("pruneSqliteBackups handles missing directory gracefully", () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-prune-5-");
    try {
      const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
      // Don't create the directory

      // Should not throw
      pruneSqliteBackups(databasePath, 3);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("persistSqliteDatabase skips .bak creation when maxBackups is 0", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-prune-6-");

    try {
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(path.dirname(paths.publicSchedulerMirrorPath), { recursive: true });
      fs.writeFileSync(paths.publicSchedulerMirrorPath, JSON.stringify({ tasks: [], jobs: [], jobFolders: [] }, null, 2), "utf8");
      fs.writeFileSync(paths.privateSchedulerMirrorPath, JSON.stringify({ tasks: [], jobs: [], jobFolders: [] }, null, 2), "utf8");

      const originalRenameSync = fs.renameSync;
      const renameTargets: string[] = [];

      setSqliteAtomicWriteFsForTests({
        renameSync: ((oldPath: fs.PathLike, newPath: fs.PathLike) => {
          renameTargets.push(String(newPath));
          return originalRenameSync(oldPath, newPath);
        }) as typeof fs.renameSync,
      });

      // Bootstrap with maxBackups=0
      await bootstrapWorkspaceSqliteStorage(workspaceRoot, true, 0);

      // No .bak file should have been created
      const allFiles = fs.readdirSync(path.dirname(paths.databasePath));
      const bakFiles = allFiles.filter((f) => f.endsWith(".bak"));
      assert.strictEqual(bakFiles.length, 0, `Expected 0 .bak files, got: ${bakFiles.join(", ")}`);
      assert.ok(fs.existsSync(paths.databasePath), "Database should exist");
    } finally {
      setSqliteAtomicWriteFsForTests();
      cleanup(workspaceRoot);
    }
  });
});
