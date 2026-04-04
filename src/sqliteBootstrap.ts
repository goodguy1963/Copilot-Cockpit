import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import initSqlJs from "sql.js";
import { createDefaultCockpitBoard, normalizeCockpitBoard } from "./cockpitBoard";
import { readSchedulerConfig, writeSchedulerConfig } from "./schedulerJsonSanitizer";
import type { ResearchWorkspaceConfig, SchedulerWorkspaceConfig } from "./types";
import {
  GLOBAL_SQLITE_SCHEMA_STATEMENTS,
  GLOBAL_SQLITE_SCHEMA_VERSION,
  JSON_STORAGE_MODE,
  SQLITE_STORAGE_MODE,
  WORKSPACE_SQLITE_SCHEMA_STATEMENTS,
  WORKSPACE_SQLITE_SCHEMA_VERSION,
  getConfiguredSchedulerStorageMode,
  getConfiguredSqliteJsonMirrorEnabled,
  getGlobalStoragePaths,
  getWorkspaceResearchConfigPath,
  getWorkspaceStoragePaths,
} from "./sqliteStorage";

type SqlJsDatabase = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string) => unknown;
  export: () => Uint8Array;
  close: () => void;
};

export type SqliteWorkspaceSchedulerState = {
  tasks: unknown[];
  deletedTaskIds: string[];
  jobs: unknown[];
  deletedJobIds: string[];
  jobFolders: unknown[];
  deletedJobFolderIds: string[];
};

export type SqliteWorkspaceResearchState = {
  profiles: unknown[];
  runs: unknown[];
};

type SqlJsModule = {
  Database: new (data?: Uint8Array) => SqlJsDatabase;
};

export type SqliteBootstrapResult = {
  databasePath: string;
  created: boolean;
  schemaVersion: number;
  mirroredJsonEnabled: boolean;
  scope: "workspace" | "global";
  importCounts: Record<string, number>;
  journalPath?: string;
};

export type SqliteBootstrapSummary = {
  mode: "json" | "sqlite";
  workspaceResults: SqliteBootstrapResult[];
  globalResult?: SqliteBootstrapResult;
};

export type SqliteJsonExportSummary = {
  workspaceRoot: string;
  databasePath: string;
  exportedCounts: Record<string, number>;
  publicSchedulerMirrorPath: string;
  privateSchedulerMirrorPath: string;
  researchConfigPath: string;
  globalTasksPath?: string;
  globalTasksMetaPath?: string;
};

type MigrationSourceInfo = {
  path: string;
  exists: boolean;
  modifiedAt?: string;
  sizeBytes?: number;
};

type WorkspaceMigrationJournal = {
  version: number;
  storageMode: "sqlite";
  mirroredJsonEnabled: boolean;
  workspaceRoot: string;
  databasePath: string;
  journalPath: string;
  created: boolean;
  bootstrappedAt: string;
  importCounts: Record<string, number>;
  sources: {
    publicSchedulerConfig: MigrationSourceInfo;
    privateSchedulerConfig: MigrationSourceInfo;
    researchConfig: MigrationSourceInfo;
  };
};

const SQLITE_MIGRATION_JOURNAL_VERSION = 1;

let sqlJsModulePromise: Promise<SqlJsModule> | undefined;

function getSqlJsWasmPath(): string {
  return require.resolve("sql.js/dist/sql-wasm.wasm");
}

async function getSqlJsModule(): Promise<SqlJsModule> {
  if (!sqlJsModulePromise) {
    sqlJsModulePromise = initSqlJs({
      locateFile: (file: string) => (file.endsWith(".wasm") ? getSqlJsWasmPath() : file),
    }) as Promise<SqlJsModule>;
  }
  return sqlJsModulePromise;
}

async function openSqliteDatabase(
  databasePath: string,
): Promise<{ db: SqlJsDatabase; created: boolean }> {
  const SQL = await getSqlJsModule();
  if (fs.existsSync(databasePath)) {
    return {
      db: new SQL.Database(fs.readFileSync(databasePath)),
      created: false,
    };
  }

  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  return {
    db: new SQL.Database(),
    created: true,
  };
}

function applySchema(
  db: SqlJsDatabase,
  statements: readonly string[],
): void {
  for (const statement of statements) {
    db.run(statement);
  }
}

function stampMetadata(
  db: SqlJsDatabase,
  metadata: Record<string, string>,
): void {
  db.run("BEGIN");
  try {
    for (const [key, value] of Object.entries(metadata)) {
      db.run(
        "INSERT OR REPLACE INTO app_metadata(key, value) VALUES (?, ?)",
        [key, value],
      );
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function persistSqliteDatabase(databasePath: string, db: SqlJsDatabase): void {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  fs.writeFileSync(databasePath, Buffer.from(db.export()));
}

function getSourceInfo(filePath: string): MigrationSourceInfo {
  if (!fs.existsSync(filePath)) {
    return { path: filePath, exists: false };
  }

  const stats = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    modifiedAt: stats.mtime.toISOString(),
    sizeBytes: stats.size,
  };
}

function readJsonFile<T>(filePath: string): T | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return undefined;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function toIsoTimestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function resetTables(db: SqlJsDatabase, tableNames: readonly string[]): void {
  db.run("BEGIN");
  try {
    for (const tableName of tableNames) {
      db.run(`DELETE FROM ${tableName}`);
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }
}

function insertWorkspaceJsonSnapshot(
  db: SqlJsDatabase,
  workspaceRoot: string,
  importedAt: string,
): { importCounts: Record<string, number>; journal: WorkspaceMigrationJournal } {
  const paths = getWorkspaceStoragePaths(workspaceRoot);
  const researchConfigPath = getWorkspaceResearchConfigPath(workspaceRoot);
  const publicConfig = readJsonFile<Partial<SchedulerWorkspaceConfig>>(paths.publicSchedulerMirrorPath);
  const privateConfig = readJsonFile<Partial<SchedulerWorkspaceConfig>>(paths.privateSchedulerMirrorPath);
  const researchConfig = readJsonFile<Partial<ResearchWorkspaceConfig>>(researchConfigPath);
  const schedulerConfig = publicConfig ?? privateConfig ?? {};
  const privateSchedulerConfig = privateConfig ?? {};
  const board = privateSchedulerConfig.cockpitBoard;

  const tasks = Array.isArray(schedulerConfig.tasks) ? schedulerConfig.tasks : [];
  const deletedTaskIds = asStringArray(schedulerConfig.deletedTaskIds);
  const jobs = Array.isArray(schedulerConfig.jobs) ? schedulerConfig.jobs : [];
  const deletedJobIds = asStringArray(schedulerConfig.deletedJobIds);
  const jobFolders = Array.isArray(schedulerConfig.jobFolders) ? schedulerConfig.jobFolders : [];
  const deletedJobFolderIds = asStringArray(schedulerConfig.deletedJobFolderIds);
  const sections = Array.isArray(board?.sections) ? board.sections : [];
  const cards = Array.isArray(board?.cards) ? board.cards : [];
  const comments = cards.flatMap((card) =>
    Array.isArray(card?.comments)
      ? card.comments
          .filter((comment) => comment && typeof comment.id === "string")
          .map((comment) => ({ cardId: card.id, comment }))
      : [],
  );
  const labelCatalog = Array.isArray(board?.labelCatalog) ? board.labelCatalog : [];
  const deletedLabelCatalogKeys = asStringArray(board?.deletedLabelCatalogKeys);
  const flagCatalog = Array.isArray(board?.flagCatalog) ? board.flagCatalog : [];
  const deletedFlagCatalogKeys = asStringArray(board?.deletedFlagCatalogKeys);
  const deletedCardIds = asStringArray(board?.deletedCardIds);
  const researchProfiles = Array.isArray(researchConfig?.profiles) ? researchConfig.profiles : [];
  const researchRuns = Array.isArray(researchConfig?.runs) ? researchConfig.runs : [];

  resetTables(db, [
    "workspace_tasks",
    "workspace_task_tombstones",
    "workspace_jobs",
    "workspace_job_tombstones",
    "workspace_job_folders",
    "workspace_job_folder_tombstones",
    "cockpit_sections",
    "cockpit_cards",
    "cockpit_comments",
    "cockpit_label_catalog",
    "cockpit_label_catalog_tombstones",
    "cockpit_flag_catalog",
    "cockpit_flag_catalog_tombstones",
    "cockpit_card_tombstones",
    "cockpit_filters",
    "research_profiles",
    "research_runs",
  ]);

  db.run("BEGIN");
  try {
    for (const task of tasks) {
      if (!task || typeof task.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO workspace_tasks(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          task.id,
          JSON.stringify(task),
          toIsoTimestamp(task.createdAt, importedAt),
          toIsoTimestamp(task.updatedAt, importedAt),
        ],
      );
    }

    for (const deletedTaskId of deletedTaskIds) {
      db.run(
        "INSERT INTO workspace_task_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedTaskId, importedAt],
      );
    }

    for (const job of jobs) {
      if (!job || typeof job.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO workspace_jobs(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          job.id,
          JSON.stringify(job),
          toIsoTimestamp(job.createdAt, importedAt),
          toIsoTimestamp(job.updatedAt, importedAt),
        ],
      );
    }

    for (const deletedJobId of deletedJobIds) {
      db.run(
        "INSERT INTO workspace_job_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedJobId, importedAt],
      );
    }

    for (const jobFolder of jobFolders) {
      if (!jobFolder || typeof jobFolder.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO workspace_job_folders(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          jobFolder.id,
          JSON.stringify(jobFolder),
          toIsoTimestamp(jobFolder.createdAt, importedAt),
          toIsoTimestamp(jobFolder.updatedAt, importedAt),
        ],
      );
    }

    for (const deletedJobFolderId of deletedJobFolderIds) {
      db.run(
        "INSERT INTO workspace_job_folder_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedJobFolderId, importedAt],
      );
    }

    for (const section of sections) {
      if (!section || typeof section.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_sections(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          section.id,
          JSON.stringify(section),
          toIsoTimestamp(section.createdAt, importedAt),
          toIsoTimestamp(section.updatedAt, importedAt),
        ],
      );
    }

    for (const card of cards) {
      if (!card || typeof card.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_cards(id, payload_json, section_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [
          card.id,
          JSON.stringify(card),
          typeof card.sectionId === "string" ? card.sectionId : null,
          toIsoTimestamp(card.createdAt, importedAt),
          toIsoTimestamp(card.updatedAt, importedAt),
        ],
      );
    }

    for (const { cardId, comment } of comments) {
      db.run(
        "INSERT INTO cockpit_comments(id, card_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
        [
          comment.id,
          cardId,
          JSON.stringify(comment),
          toIsoTimestamp(comment.createdAt, importedAt),
        ],
      );
    }

    for (const definition of labelCatalog) {
      const key = typeof definition?.key === "string" && definition.key.trim().length > 0
        ? definition.key
        : typeof definition?.name === "string"
          ? definition.name
          : undefined;
      if (!key) {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_label_catalog(key, payload_json, updated_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(definition), toIsoTimestamp(definition.updatedAt, importedAt)],
      );
    }

    for (const deletedLabelCatalogKey of deletedLabelCatalogKeys) {
      db.run(
        "INSERT INTO cockpit_label_catalog_tombstones(key, deleted_at) VALUES (?, ?)",
        [deletedLabelCatalogKey, importedAt],
      );
    }

    for (const definition of flagCatalog) {
      const key = typeof definition?.key === "string" && definition.key.trim().length > 0
        ? definition.key
        : typeof definition?.name === "string"
          ? definition.name
          : undefined;
      if (!key) {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_flag_catalog(key, payload_json, updated_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(definition), toIsoTimestamp(definition.updatedAt, importedAt)],
      );
    }

    for (const deletedFlagCatalogKey of deletedFlagCatalogKeys) {
      db.run(
        "INSERT INTO cockpit_flag_catalog_tombstones(key, deleted_at) VALUES (?, ?)",
        [deletedFlagCatalogKey, importedAt],
      );
    }

    for (const deletedCardId of deletedCardIds) {
      db.run(
        "INSERT INTO cockpit_card_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedCardId, importedAt],
      );
    }

    if (board?.filters) {
      db.run(
        "INSERT INTO cockpit_filters(id, payload_json, updated_at) VALUES (1, ?, ?)",
        [JSON.stringify(board.filters), toIsoTimestamp(board.updatedAt, importedAt)],
      );
    }

    for (const profile of researchProfiles) {
      if (!profile || typeof profile.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO research_profiles(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          profile.id,
          JSON.stringify(profile),
          toIsoTimestamp(profile.createdAt, importedAt),
          toIsoTimestamp(profile.updatedAt, importedAt),
        ],
      );
    }

    for (const run of researchRuns) {
      if (!run || typeof run.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO research_runs(id, payload_json, started_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          run.id,
          JSON.stringify(run),
          toIsoTimestamp(run.startedAt, importedAt),
          toIsoTimestamp(run.finishedAt, importedAt),
        ],
      );
    }

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  const importCounts: Record<string, number> = {
    workspaceTasks: tasks.length,
    deletedTaskIds: deletedTaskIds.length,
    jobs: jobs.length,
    deletedJobIds: deletedJobIds.length,
    jobFolders: jobFolders.length,
    deletedJobFolderIds: deletedJobFolderIds.length,
    cockpitSections: sections.length,
    cockpitCards: cards.length,
    cockpitComments: comments.length,
    cockpitLabelCatalog: labelCatalog.length,
    deletedCockpitLabelCatalogKeys: deletedLabelCatalogKeys.length,
    cockpitFlagCatalog: flagCatalog.length,
    deletedCockpitFlagCatalogKeys: deletedFlagCatalogKeys.length,
    deletedCockpitCardIds: deletedCardIds.length,
    researchProfiles: researchProfiles.length,
    researchRuns: researchRuns.length,
  };

  return {
    importCounts,
    journal: {
      version: SQLITE_MIGRATION_JOURNAL_VERSION,
      storageMode: SQLITE_STORAGE_MODE,
      mirroredJsonEnabled: false,
      workspaceRoot,
      databasePath: paths.databasePath,
      journalPath: paths.migrationJournalPath,
      created: false,
      bootstrappedAt: importedAt,
      importCounts,
      sources: {
        publicSchedulerConfig: getSourceInfo(paths.publicSchedulerMirrorPath),
        privateSchedulerConfig: getSourceInfo(paths.privateSchedulerMirrorPath),
        researchConfig: getSourceInfo(researchConfigPath),
      },
    },
  };
}

function writeWorkspaceMigrationJournal(journal: WorkspaceMigrationJournal): void {
  fs.mkdirSync(path.dirname(journal.journalPath), { recursive: true });
  fs.writeFileSync(journal.journalPath, JSON.stringify(journal, null, 2), "utf8");
}

function insertGlobalJsonSnapshot(
  db: SqlJsDatabase,
  globalStorageRoot: string,
  importedAt: string,
): Record<string, number> {
  const globalPaths = getGlobalStoragePaths(globalStorageRoot);
  const tasks = readJsonFile<unknown[]>(globalPaths.scheduledTasksPath);
  const taskEntries = Array.isArray(tasks) ? tasks : [];

  resetTables(db, [
    "global_tasks",
    "global_task_tombstones",
  ]);

  db.run("BEGIN");
  try {
    for (const task of taskEntries) {
      if (!task || typeof task !== "object" || typeof (task as { id?: unknown }).id !== "string") {
        continue;
      }
      const taskRecord = task as { id: string; createdAt?: unknown; updatedAt?: unknown };
      db.run(
        "INSERT INTO global_tasks(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          taskRecord.id,
          JSON.stringify(task),
          toIsoTimestamp(taskRecord.createdAt, importedAt),
          toIsoTimestamp(taskRecord.updatedAt, importedAt),
        ],
      );
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  return {
    globalTasks: taskEntries.length,
  };
}

export async function bootstrapWorkspaceSqliteStorage(
  workspaceRoot: string,
  mirroredJsonEnabled: boolean,
): Promise<SqliteBootstrapResult> {
  const paths = getWorkspaceStoragePaths(workspaceRoot);
  const { db, created } = await openSqliteDatabase(paths.databasePath);
  const now = new Date().toISOString();
  let importCounts: Record<string, number> = {};

  try {
    applySchema(db, WORKSPACE_SQLITE_SCHEMA_STATEMENTS);
    const imported = insertWorkspaceJsonSnapshot(db, workspaceRoot, now);
    importCounts = imported.importCounts;
    stampMetadata(db, {
      workspace_schema_version: String(WORKSPACE_SQLITE_SCHEMA_VERSION),
      storage_scope: "workspace",
      storage_mode: SQLITE_STORAGE_MODE,
      workspace_root: workspaceRoot,
      sqlite_json_mirror: String(mirroredJsonEnabled),
      bootstrapped_at: now,
      last_bootstrapped_at: now,
      last_imported_at: now,
      last_workspace_import_counts: JSON.stringify(importCounts),
    });
    persistSqliteDatabase(paths.databasePath, db);
    writeWorkspaceMigrationJournal({
      ...imported.journal,
      mirroredJsonEnabled,
      created,
    });
  } finally {
    db.close();
  }

  return {
    databasePath: paths.databasePath,
    created,
    schemaVersion: WORKSPACE_SQLITE_SCHEMA_VERSION,
    mirroredJsonEnabled,
    scope: "workspace",
    importCounts,
    journalPath: paths.migrationJournalPath,
  };
}

export async function bootstrapGlobalSqliteStorage(
  globalStorageRoot: string,
): Promise<SqliteBootstrapResult> {
  const globalPaths = getGlobalStoragePaths(globalStorageRoot);
  const databasePath = globalPaths.databasePath;
  const { db, created } = await openSqliteDatabase(databasePath);
  const now = new Date().toISOString();
  let importCounts: Record<string, number> = {};

  try {
    applySchema(db, GLOBAL_SQLITE_SCHEMA_STATEMENTS);
    importCounts = insertGlobalJsonSnapshot(db, globalStorageRoot, now);
    stampMetadata(db, {
      global_schema_version: String(GLOBAL_SQLITE_SCHEMA_VERSION),
      storage_scope: "global",
      storage_mode: SQLITE_STORAGE_MODE,
      global_storage_root: globalStorageRoot,
      bootstrapped_at: now,
      last_bootstrapped_at: now,
      last_imported_at: now,
      last_global_import_counts: JSON.stringify(importCounts),
    });
    persistSqliteDatabase(databasePath, db);
  } finally {
    db.close();
  }

  return {
    databasePath,
    created,
    schemaVersion: GLOBAL_SQLITE_SCHEMA_VERSION,
    mirroredJsonEnabled: false,
    scope: "global",
    importCounts,
  };
}

export async function bootstrapConfiguredSqliteStorage(
  context: vscode.ExtensionContext,
): Promise<SqliteBootstrapSummary> {
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
  const workspaceResults: SqliteBootstrapResult[] = [];

  for (const folder of workspaceFolders) {
    const storageMode = getConfiguredSchedulerStorageMode(folder.uri);
    if (storageMode !== SQLITE_STORAGE_MODE) {
      continue;
    }

    workspaceResults.push(
      await bootstrapWorkspaceSqliteStorage(
        folder.uri.fsPath,
        getConfiguredSqliteJsonMirrorEnabled(folder.uri),
      ),
    );
  }

  if (workspaceResults.length === 0) {
    return {
      mode: JSON_STORAGE_MODE,
      workspaceResults,
    };
  }

  const globalResult = await bootstrapGlobalSqliteStorage(
    context.globalStorageUri.fsPath,
  );

  return {
    mode: SQLITE_STORAGE_MODE,
    workspaceResults,
    globalResult,
  };
}

function readStoredPayloadRows<T>(db: SqlJsDatabase, sql: string): T[] {
  const result = db.exec(sql) as Array<{ values?: unknown[][] }>;
  const rows = result[0]?.values ?? [];
  const payloads: T[] = [];

  for (const row of rows) {
    const payloadJson = typeof row?.[0] === "string" ? row[0] : undefined;
    if (!payloadJson) {
      continue;
    }
    try {
      payloads.push(JSON.parse(payloadJson) as T);
    } catch {
      // Skip malformed payloads and keep bootstrapped storage readable.
    }
  }

  return payloads;
}

function readStoredStringRows(db: SqlJsDatabase, sql: string): string[] {
  const result = db.exec(sql) as Array<{ values?: unknown[][] }>;
  const rows = result[0]?.values ?? [];
  return rows
    .map((row) => (typeof row?.[0] === "string" ? row[0] : undefined))
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function replaceWorkspaceSchedulerState(
  db: SqlJsDatabase,
  config: Partial<SchedulerWorkspaceConfig>,
  syncedAt: string,
): Record<string, number> {
  const tasks = Array.isArray(config.tasks) ? config.tasks : [];
  const deletedTaskIds = asStringArray(config.deletedTaskIds);
  const jobs = Array.isArray(config.jobs) ? config.jobs : [];
  const deletedJobIds = asStringArray(config.deletedJobIds);
  const jobFolders = Array.isArray(config.jobFolders) ? config.jobFolders : [];
  const deletedJobFolderIds = asStringArray(config.deletedJobFolderIds);

  resetTables(db, [
    "workspace_tasks",
    "workspace_task_tombstones",
    "workspace_jobs",
    "workspace_job_tombstones",
    "workspace_job_folders",
    "workspace_job_folder_tombstones",
  ]);

  db.run("BEGIN");
  try {
    for (const task of tasks) {
      if (!task || typeof task.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO workspace_tasks(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          task.id,
          JSON.stringify(task),
          toIsoTimestamp(task.createdAt, syncedAt),
          toIsoTimestamp(task.updatedAt, syncedAt),
        ],
      );
    }

    for (const deletedTaskId of deletedTaskIds) {
      db.run(
        "INSERT INTO workspace_task_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedTaskId, syncedAt],
      );
    }

    for (const job of jobs) {
      if (!job || typeof job.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO workspace_jobs(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          job.id,
          JSON.stringify(job),
          toIsoTimestamp(job.createdAt, syncedAt),
          toIsoTimestamp(job.updatedAt, syncedAt),
        ],
      );
    }

    for (const deletedJobId of deletedJobIds) {
      db.run(
        "INSERT INTO workspace_job_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedJobId, syncedAt],
      );
    }

    for (const jobFolder of jobFolders) {
      if (!jobFolder || typeof jobFolder.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO workspace_job_folders(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          jobFolder.id,
          JSON.stringify(jobFolder),
          toIsoTimestamp(jobFolder.createdAt, syncedAt),
          toIsoTimestamp(jobFolder.updatedAt, syncedAt),
        ],
      );
    }

    for (const deletedJobFolderId of deletedJobFolderIds) {
      db.run(
        "INSERT INTO workspace_job_folder_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedJobFolderId, syncedAt],
      );
    }

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  return {
    workspaceTasks: tasks.length,
    deletedTaskIds: deletedTaskIds.length,
    jobs: jobs.length,
    deletedJobIds: deletedJobIds.length,
    jobFolders: jobFolders.length,
    deletedJobFolderIds: deletedJobFolderIds.length,
  };
}

function replaceGlobalTasksState(
  db: SqlJsDatabase,
  tasks: readonly unknown[],
  syncedAt: string,
): Record<string, number> {
  resetTables(db, [
    "global_tasks",
    "global_task_tombstones",
  ]);

  db.run("BEGIN");
  try {
    for (const task of tasks) {
      if (!task || typeof task !== "object" || typeof (task as { id?: unknown }).id !== "string") {
        continue;
      }
      const taskRecord = task as { id: string; createdAt?: unknown; updatedAt?: unknown };
      db.run(
        "INSERT INTO global_tasks(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          taskRecord.id,
          JSON.stringify(task),
          toIsoTimestamp(taskRecord.createdAt, syncedAt),
          toIsoTimestamp(taskRecord.updatedAt, syncedAt),
        ],
      );
    }
    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  return {
    globalTasks: tasks.length,
  };
}

function replaceWorkspaceResearchState(
  db: SqlJsDatabase,
  config: Partial<ResearchWorkspaceConfig>,
  syncedAt: string,
): Record<string, number> {
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  const runs = Array.isArray(config.runs) ? config.runs : [];

  resetTables(db, [
    "research_profiles",
    "research_runs",
  ]);

  db.run("BEGIN");
  try {
    for (const profile of profiles) {
      if (!profile || typeof profile.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO research_profiles(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          profile.id,
          JSON.stringify(profile),
          toIsoTimestamp(profile.createdAt, syncedAt),
          toIsoTimestamp(profile.updatedAt, syncedAt),
        ],
      );
    }

    for (const run of runs) {
      if (!run || typeof run.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO research_runs(id, payload_json, started_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          run.id,
          JSON.stringify(run),
          toIsoTimestamp(run.startedAt, syncedAt),
          toIsoTimestamp(run.finishedAt, syncedAt),
        ],
      );
    }

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  return {
    researchProfiles: profiles.length,
    researchRuns: runs.length,
  };
}

function replaceWorkspaceCockpitState(
  db: SqlJsDatabase,
  boardValue: SchedulerWorkspaceConfig["cockpitBoard"],
  syncedAt: string,
): Record<string, number> {
  const board = boardValue ? normalizeCockpitBoard(boardValue) : createDefaultCockpitBoard(syncedAt);
  const sections = Array.isArray(board.sections) ? board.sections : [];
  const cards = Array.isArray(board.cards) ? board.cards : [];
  const comments = cards.flatMap((card) =>
    Array.isArray(card?.comments)
      ? card.comments
          .filter((comment) => comment && typeof comment.id === "string")
          .map((comment) => ({ cardId: card.id, comment }))
      : [],
  );
  const labelCatalog = Array.isArray(board.labelCatalog) ? board.labelCatalog : [];
  const deletedLabelCatalogKeys = asStringArray(board.deletedLabelCatalogKeys);
  const flagCatalog = Array.isArray(board.flagCatalog) ? board.flagCatalog : [];
  const deletedFlagCatalogKeys = asStringArray(board.deletedFlagCatalogKeys);
  const deletedCardIds = asStringArray(board.deletedCardIds);

  resetTables(db, [
    "cockpit_sections",
    "cockpit_cards",
    "cockpit_comments",
    "cockpit_label_catalog",
    "cockpit_label_catalog_tombstones",
    "cockpit_flag_catalog",
    "cockpit_flag_catalog_tombstones",
    "cockpit_card_tombstones",
    "cockpit_filters",
  ]);

  db.run("BEGIN");
  try {
    for (const section of sections) {
      if (!section || typeof section.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_sections(id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?)",
        [
          section.id,
          JSON.stringify(section),
          toIsoTimestamp(section.createdAt, syncedAt),
          toIsoTimestamp(section.updatedAt, syncedAt),
        ],
      );
    }

    for (const card of cards) {
      if (!card || typeof card.id !== "string") {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_cards(id, payload_json, section_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [
          card.id,
          JSON.stringify(card),
          typeof card.sectionId === "string" ? card.sectionId : null,
          toIsoTimestamp(card.createdAt, syncedAt),
          toIsoTimestamp(card.updatedAt, syncedAt),
        ],
      );
    }

    for (const { cardId, comment } of comments) {
      db.run(
        "INSERT INTO cockpit_comments(id, card_id, payload_json, created_at) VALUES (?, ?, ?, ?)",
        [
          comment.id,
          cardId,
          JSON.stringify(comment),
          toIsoTimestamp(comment.createdAt, syncedAt),
        ],
      );
    }

    for (const definition of labelCatalog) {
      const key = typeof definition?.key === "string" && definition.key.trim().length > 0
        ? definition.key
        : typeof definition?.name === "string"
          ? definition.name
          : undefined;
      if (!key) {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_label_catalog(key, payload_json, updated_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(definition), toIsoTimestamp(definition.updatedAt, syncedAt)],
      );
    }

    for (const deletedLabelCatalogKey of deletedLabelCatalogKeys) {
      db.run(
        "INSERT INTO cockpit_label_catalog_tombstones(key, deleted_at) VALUES (?, ?)",
        [deletedLabelCatalogKey, syncedAt],
      );
    }

    for (const definition of flagCatalog) {
      const key = typeof definition?.key === "string" && definition.key.trim().length > 0
        ? definition.key
        : typeof definition?.name === "string"
          ? definition.name
          : undefined;
      if (!key) {
        continue;
      }
      db.run(
        "INSERT INTO cockpit_flag_catalog(key, payload_json, updated_at) VALUES (?, ?, ?)",
        [key, JSON.stringify(definition), toIsoTimestamp(definition.updatedAt, syncedAt)],
      );
    }

    for (const deletedFlagCatalogKey of deletedFlagCatalogKeys) {
      db.run(
        "INSERT INTO cockpit_flag_catalog_tombstones(key, deleted_at) VALUES (?, ?)",
        [deletedFlagCatalogKey, syncedAt],
      );
    }

    for (const deletedCardId of deletedCardIds) {
      db.run(
        "INSERT INTO cockpit_card_tombstones(id, deleted_at) VALUES (?, ?)",
        [deletedCardId, syncedAt],
      );
    }

    db.run(
      "INSERT INTO cockpit_filters(id, payload_json, updated_at) VALUES (1, ?, ?)",
      [JSON.stringify(board.filters), toIsoTimestamp(board.updatedAt, syncedAt)],
    );

    db.run("COMMIT");
  } catch (error) {
    db.run("ROLLBACK");
    throw error;
  }

  return {
    cockpitSections: sections.length,
    cockpitCards: cards.length,
    cockpitComments: comments.length,
    cockpitLabelCatalog: labelCatalog.length,
    deletedCockpitLabelCatalogKeys: deletedLabelCatalogKeys.length,
    cockpitFlagCatalog: flagCatalog.length,
    deletedCockpitFlagCatalogKeys: deletedFlagCatalogKeys.length,
    deletedCockpitCardIds: deletedCardIds.length,
  };
}

export async function readWorkspaceTasksFromSqlite(
  workspaceRoot: string,
): Promise<unknown[]> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  if (!fs.existsSync(databasePath)) {
    return [];
  }

  const { db } = await openSqliteDatabase(databasePath);
  try {
    return readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM workspace_tasks ORDER BY created_at ASC, id ASC",
    );
  } finally {
    db.close();
  }
}

export async function readWorkspaceSchedulerStateFromSqlite(
  workspaceRoot: string,
): Promise<SqliteWorkspaceSchedulerState> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  if (!fs.existsSync(databasePath)) {
    return {
      tasks: [],
      deletedTaskIds: [],
      jobs: [],
      deletedJobIds: [],
      jobFolders: [],
      deletedJobFolderIds: [],
    };
  }

  const { db } = await openSqliteDatabase(databasePath);
  try {
    return {
      tasks: readStoredPayloadRows<unknown>(
        db,
        "SELECT payload_json FROM workspace_tasks ORDER BY created_at ASC, id ASC",
      ),
      deletedTaskIds: readStoredStringRows(
        db,
        "SELECT id FROM workspace_task_tombstones ORDER BY deleted_at ASC, id ASC",
      ),
      jobs: readStoredPayloadRows<unknown>(
        db,
        "SELECT payload_json FROM workspace_jobs ORDER BY created_at ASC, id ASC",
      ),
      deletedJobIds: readStoredStringRows(
        db,
        "SELECT id FROM workspace_job_tombstones ORDER BY deleted_at ASC, id ASC",
      ),
      jobFolders: readStoredPayloadRows<unknown>(
        db,
        "SELECT payload_json FROM workspace_job_folders ORDER BY created_at ASC, id ASC",
      ),
      deletedJobFolderIds: readStoredStringRows(
        db,
        "SELECT id FROM workspace_job_folder_tombstones ORDER BY deleted_at ASC, id ASC",
      ),
    };
  } finally {
    db.close();
  }
}

export async function readGlobalTasksFromSqlite(
  globalStorageRoot: string,
): Promise<unknown[]> {
  const { databasePath } = getGlobalStoragePaths(globalStorageRoot);
  if (!fs.existsSync(databasePath)) {
    return [];
  }

  const { db } = await openSqliteDatabase(databasePath);
  try {
    return readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM global_tasks ORDER BY created_at ASC, id ASC",
    );
  } finally {
    db.close();
  }
}

export async function readWorkspaceResearchStateFromSqlite(
  workspaceRoot: string,
): Promise<SqliteWorkspaceResearchState> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  if (!fs.existsSync(databasePath)) {
    return {
      profiles: [],
      runs: [],
    };
  }

  const { db } = await openSqliteDatabase(databasePath);
  try {
    return {
      profiles: readStoredPayloadRows<unknown>(
        db,
        "SELECT payload_json FROM research_profiles ORDER BY created_at ASC, id ASC",
      ),
      runs: readStoredPayloadRows<unknown>(
        db,
        "SELECT payload_json FROM research_runs ORDER BY started_at DESC, id DESC",
      ),
    };
  } finally {
    db.close();
  }
}

export async function readWorkspaceCockpitBoardFromSqlite(
  workspaceRoot: string,
): Promise<SchedulerWorkspaceConfig["cockpitBoard"] | undefined> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  if (!fs.existsSync(databasePath)) {
    return undefined;
  }

  const { db } = await openSqliteDatabase(databasePath);
  try {
    const sections = readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM cockpit_sections ORDER BY created_at ASC, id ASC",
    );
    const cards = readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM cockpit_cards ORDER BY section_id ASC, created_at ASC, id ASC",
    );
    const labelCatalog = readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM cockpit_label_catalog ORDER BY key ASC",
    );
    const deletedLabelCatalogKeys = readStoredStringRows(
      db,
      "SELECT key FROM cockpit_label_catalog_tombstones ORDER BY deleted_at ASC, key ASC",
    );
    const flagCatalog = readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM cockpit_flag_catalog ORDER BY key ASC",
    );
    const deletedFlagCatalogKeys = readStoredStringRows(
      db,
      "SELECT key FROM cockpit_flag_catalog_tombstones ORDER BY deleted_at ASC, key ASC",
    );
    const deletedCardIds = readStoredStringRows(
      db,
      "SELECT id FROM cockpit_card_tombstones ORDER BY deleted_at ASC, id ASC",
    );
    const filters = readStoredPayloadRows<unknown>(
      db,
      "SELECT payload_json FROM cockpit_filters WHERE id = 1",
    )[0];

    if (
      sections.length === 0 &&
      cards.length === 0 &&
      labelCatalog.length === 0 &&
      flagCatalog.length === 0 &&
      !filters
    ) {
      return undefined;
    }

    return normalizeCockpitBoard({
      sections,
      cards,
      labelCatalog,
      deletedLabelCatalogKeys,
      flagCatalog,
      deletedFlagCatalogKeys,
      deletedCardIds,
      filters,
    });
  } finally {
    db.close();
  }
}

export async function syncWorkspaceSchedulerStateToSqlite(
  workspaceRoot: string,
  config: Partial<SchedulerWorkspaceConfig>,
): Promise<Record<string, number>> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  const { db } = await openSqliteDatabase(databasePath);
  const syncedAt = new Date().toISOString();

  try {
    applySchema(db, WORKSPACE_SQLITE_SCHEMA_STATEMENTS);
    const counts = replaceWorkspaceSchedulerState(db, config, syncedAt);
    stampMetadata(db, {
      workspace_schema_version: String(WORKSPACE_SQLITE_SCHEMA_VERSION),
      storage_scope: "workspace",
      storage_mode: SQLITE_STORAGE_MODE,
      workspace_root: workspaceRoot,
      last_scheduler_sync_at: syncedAt,
      last_scheduler_sync_counts: JSON.stringify(counts),
    });
    persistSqliteDatabase(databasePath, db);
    return counts;
  } finally {
    db.close();
  }
}

export async function syncGlobalTasksToSqlite(
  globalStorageRoot: string,
  tasks: readonly unknown[],
): Promise<Record<string, number>> {
  const { databasePath } = getGlobalStoragePaths(globalStorageRoot);
  const { db } = await openSqliteDatabase(databasePath);
  const syncedAt = new Date().toISOString();

  try {
    applySchema(db, GLOBAL_SQLITE_SCHEMA_STATEMENTS);
    const counts = replaceGlobalTasksState(db, tasks, syncedAt);
    stampMetadata(db, {
      global_schema_version: String(GLOBAL_SQLITE_SCHEMA_VERSION),
      storage_scope: "global",
      storage_mode: SQLITE_STORAGE_MODE,
      global_storage_root: globalStorageRoot,
      last_global_task_sync_at: syncedAt,
      last_global_task_sync_counts: JSON.stringify(counts),
    });
    persistSqliteDatabase(databasePath, db);
    return counts;
  } finally {
    db.close();
  }
}

export async function syncWorkspaceResearchStateToSqlite(
  workspaceRoot: string,
  config: Partial<ResearchWorkspaceConfig>,
): Promise<Record<string, number>> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  const { db } = await openSqliteDatabase(databasePath);
  const syncedAt = new Date().toISOString();

  try {
    applySchema(db, WORKSPACE_SQLITE_SCHEMA_STATEMENTS);
    const counts = replaceWorkspaceResearchState(db, config, syncedAt);
    stampMetadata(db, {
      workspace_schema_version: String(WORKSPACE_SQLITE_SCHEMA_VERSION),
      storage_scope: "workspace",
      storage_mode: SQLITE_STORAGE_MODE,
      workspace_root: workspaceRoot,
      last_research_sync_at: syncedAt,
      last_research_sync_counts: JSON.stringify(counts),
    });
    persistSqliteDatabase(databasePath, db);
    return counts;
  } finally {
    db.close();
  }
}

export async function syncWorkspaceCockpitBoardToSqlite(
  workspaceRoot: string,
  board: SchedulerWorkspaceConfig["cockpitBoard"],
): Promise<Record<string, number>> {
  const { databasePath } = getWorkspaceStoragePaths(workspaceRoot);
  const { db } = await openSqliteDatabase(databasePath);
  const syncedAt = new Date().toISOString();

  try {
    applySchema(db, WORKSPACE_SQLITE_SCHEMA_STATEMENTS);
    const counts = replaceWorkspaceCockpitState(db, board, syncedAt);
    stampMetadata(db, {
      workspace_schema_version: String(WORKSPACE_SQLITE_SCHEMA_VERSION),
      storage_scope: "workspace",
      storage_mode: SQLITE_STORAGE_MODE,
      workspace_root: workspaceRoot,
      last_cockpit_sync_at: syncedAt,
      last_cockpit_sync_counts: JSON.stringify(counts),
    });
    persistSqliteDatabase(databasePath, db);
    return counts;
  } finally {
    db.close();
  }
}

export async function exportWorkspaceSqliteToJsonMirrors(
  workspaceRoot: string,
  globalStorageRoot?: string,
): Promise<SqliteJsonExportSummary> {
  const workspacePaths = getWorkspaceStoragePaths(workspaceRoot);
  if (!fs.existsSync(workspacePaths.databasePath)) {
    throw new Error("Workspace SQLite database not found.");
  }

  const schedulerState = await readWorkspaceSchedulerStateFromSqlite(workspaceRoot);
  const researchState = await readWorkspaceResearchStateFromSqlite(workspaceRoot);
  const cockpitBoard = await readWorkspaceCockpitBoardFromSqlite(workspaceRoot);
  const existingConfig = readSchedulerConfig(workspaceRoot);
  const nextConfig: SchedulerWorkspaceConfig = {
    tasks: schedulerState.tasks as any[],
    deletedTaskIds: schedulerState.deletedTaskIds,
    jobs: schedulerState.jobs as any[],
    deletedJobIds: schedulerState.deletedJobIds,
    jobFolders: schedulerState.jobFolders as any[],
    deletedJobFolderIds: schedulerState.deletedJobFolderIds,
    cockpitBoard: cockpitBoard ?? createDefaultCockpitBoard(),
    telegramNotification: existingConfig.telegramNotification,
  };
  writeSchedulerConfig(workspaceRoot, nextConfig, {
    mode: "replace",
  });

  const researchConfigPath = getWorkspaceResearchConfigPath(workspaceRoot);
  const existingResearchConfig = readJsonFile<Partial<ResearchWorkspaceConfig>>(researchConfigPath);
  writeJsonFile(researchConfigPath, {
    version: typeof existingResearchConfig?.version === "number" ? existingResearchConfig.version : 1,
    profiles: researchState.profiles,
    runs: researchState.runs,
  });

  let globalTasksPath: string | undefined;
  let globalTasksMetaPath: string | undefined;
  if (globalStorageRoot) {
    const globalPaths = getGlobalStoragePaths(globalStorageRoot);
    if (fs.existsSync(globalPaths.databasePath)) {
      const globalTasks = await readGlobalTasksFromSqlite(globalStorageRoot);
      writeJsonFile(globalPaths.scheduledTasksPath, globalTasks);
      const existingMeta = readJsonFile<{ revision?: unknown; savedAt?: unknown }>(globalPaths.scheduledTasksMetaPath);
      const currentRevision = typeof existingMeta?.revision === "number" && Number.isFinite(existingMeta.revision)
        ? Math.max(0, Math.floor(existingMeta.revision))
        : 0;
      writeJsonFile(globalPaths.scheduledTasksMetaPath, {
        revision: currentRevision + 1,
        savedAt: new Date().toISOString(),
      });
      globalTasksPath = globalPaths.scheduledTasksPath;
      globalTasksMetaPath = globalPaths.scheduledTasksMetaPath;
    }
  }

  return {
    workspaceRoot,
    databasePath: workspacePaths.databasePath,
    exportedCounts: {
      workspaceTasks: schedulerState.tasks.length,
      deletedTaskIds: schedulerState.deletedTaskIds.length,
      jobs: schedulerState.jobs.length,
      deletedJobIds: schedulerState.deletedJobIds.length,
      jobFolders: schedulerState.jobFolders.length,
      deletedJobFolderIds: schedulerState.deletedJobFolderIds.length,
      cockpitSections: Array.isArray(cockpitBoard?.sections) ? cockpitBoard.sections.length : 0,
      cockpitCards: Array.isArray(cockpitBoard?.cards) ? cockpitBoard.cards.length : 0,
      researchProfiles: researchState.profiles.length,
      researchRuns: researchState.runs.length,
    },
    publicSchedulerMirrorPath: workspacePaths.publicSchedulerMirrorPath,
    privateSchedulerMirrorPath: workspacePaths.privateSchedulerMirrorPath,
    researchConfigPath,
    globalTasksPath,
    globalTasksMetaPath,
  };
}