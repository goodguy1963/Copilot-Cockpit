import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import initSqlJs from "sql.js";
import {
  bootstrapGlobalSqliteStorage,
  bootstrapWorkspaceSqliteStorage,
  exportWorkspaceSqliteToJsonMirrors,
  readWorkspaceCockpitBoardFromSqlite,
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

type SqlJsDatabase = {
  exec: (sql: string) => Array<{ values?: unknown[][] }>;
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
      assert.strictEqual(board?.flagCatalog?.[0]?.name, "go");
      assert.deepStrictEqual(board?.deletedCardIds ?? [], ["card-deleted"]);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("exports sqlite workspace state back into json mirrors", async () => {
    const workspaceRoot = createTempRoot("copilot-sqlite-export-workspace-");
    const globalRoot = createTempRoot("copilot-sqlite-export-global-");

    try {
      await syncWorkspaceSchedulerStateToSqlite(workspaceRoot, {
        tasks: [{ id: "task-1", name: "Task 1", cron: "0 * * * *", prompt: "run", enabled: true, createdAt: "2026-04-04T00:00:00.000Z", updatedAt: "2026-04-04T00:00:00.000Z" }],
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
});