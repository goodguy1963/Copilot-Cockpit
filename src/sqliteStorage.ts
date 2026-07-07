import * as fs from "fs";
import * as path from "path";
import type * as vscode from "vscode";

export const JSON_STORAGE_MODE = "json" as const;
export const SQLITE_STORAGE_MODE = "sqlite" as const;
export const SCHEDULER_PUBLIC_JSON_FILE = "scheduler.json";
export const SCHEDULER_PRIVATE_JSON_FILE = "scheduler.private.json";
export const RESEARCH_JSON_FILE = "research.json";
export const SQLITE_MIGRATION_JOURNAL_FILE = "copilot-cockpit.db-migration.json";
export const GLOBAL_TASKS_JSON_FILE = "scheduledTasks.json";
export const GLOBAL_TASKS_META_JSON_FILE = "scheduledTasks.meta.json";
export const WORKSPACE_COCKPIT_DATA_DIR = "copilot-cockpit";

export type SchedulerStorageMode =
  | typeof JSON_STORAGE_MODE
  | typeof SQLITE_STORAGE_MODE;

export const WORKSPACE_SQLITE_DB_FILE = "copilot-cockpit.db";
export const GLOBAL_SQLITE_DB_FILE = "copilot-cockpit-global.db";
export const PRIVATE_SECRETS_FILE = "copilot-cockpit.private.json";

export const WORKSPACE_SQLITE_SCHEMA_VERSION = 5;
export const GLOBAL_SQLITE_SCHEMA_VERSION = 4;

export type SqliteSchemaMigration = {
  version: number;
  name: string;
  statements: readonly string[];
};

export type WorkspaceStoragePaths = {
  workspaceRoot: string;
  vscodeDir: string;
  cockpitDataDir: string;
  databasePath: string;
  publicSchedulerMirrorPath: string;
  privateSchedulerMirrorPath: string;
  privateSecretsPath: string;
  migrationJournalPath: string;
  researchConfigPath: string;
};

export type WorkspaceSchedulerMirrorPaths = {
  publicSchedulerMirrorPath: string;
  privateSchedulerMirrorPath: string;
};

export type GlobalStoragePaths = {
  globalStorageRoot: string;
  databasePath: string;
  scheduledTasksPath: string;
  scheduledTasksMetaPath: string;
};

export function normalizeSchedulerStorageMode(
  value: unknown,
): SchedulerStorageMode {
  return value === SQLITE_STORAGE_MODE ? SQLITE_STORAGE_MODE : JSON_STORAGE_MODE;
}

export function normalizeSqliteJsonMirrorEnabled(value: unknown): boolean {
  return value === true;
}

export function getConfiguredSchedulerStorageMode(
  scope?: vscode.ConfigurationScope,
): SchedulerStorageMode {
  const { getCompatibleConfigurationValue } = require("./extensionCompat") as typeof import("./extensionCompat");
  return normalizeSchedulerStorageMode(
    getCompatibleConfigurationValue<SchedulerStorageMode>(
      "storageMode",
      SQLITE_STORAGE_MODE,
      scope,
    ),
  );
}

export function getConfiguredSqliteJsonMirrorEnabled(
  scope?: vscode.ConfigurationScope,
): boolean {
  const { getCompatibleConfigurationValue } = require("./extensionCompat") as typeof import("./extensionCompat");
  return normalizeSqliteJsonMirrorEnabled(
    getCompatibleConfigurationValue<boolean>(
      "sqliteJsonMirror",
      false,
      scope,
    ),
  );
}

export function normalizeMaxSqliteBackups(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 3;
  }
  return Math.max(0, Math.min(20, Math.round(value)));
}

export function getConfiguredMaxSqliteBackups(
  scope?: vscode.ConfigurationScope,
): number {
  const { getCompatibleConfigurationValue } = require("./extensionCompat") as typeof import("./extensionCompat");
  return normalizeMaxSqliteBackups(
    getCompatibleConfigurationValue<number>(
      "maxSqliteBackups",
      3,
      scope,
    ),
  );
}

export function getWorkspaceStoragePaths(
  workspaceRoot: string,
): WorkspaceStoragePaths {
  const vscodeDir = path.join(workspaceRoot, ".vscode");
  const cockpitDataDir = path.join(vscodeDir, WORKSPACE_COCKPIT_DATA_DIR);
  return {
    workspaceRoot,
    vscodeDir,
    cockpitDataDir,
    databasePath: path.join(cockpitDataDir, WORKSPACE_SQLITE_DB_FILE),
    publicSchedulerMirrorPath: path.join(vscodeDir, SCHEDULER_PUBLIC_JSON_FILE),
    privateSchedulerMirrorPath: path.join(vscodeDir, SCHEDULER_PRIVATE_JSON_FILE),
    privateSecretsPath: path.join(cockpitDataDir, PRIVATE_SECRETS_FILE),
    migrationJournalPath: path.join(cockpitDataDir, SQLITE_MIGRATION_JOURNAL_FILE),
    researchConfigPath: path.join(cockpitDataDir, RESEARCH_JSON_FILE),
  };
}

function getLegacyWorkspaceStoragePaths(workspaceRoot: string): Pick<
  WorkspaceStoragePaths,
  "databasePath" | "privateSecretsPath" | "migrationJournalPath" | "researchConfigPath"
> {
  const vscodeDir = path.join(workspaceRoot, ".vscode");
  return {
    databasePath: path.join(vscodeDir, WORKSPACE_SQLITE_DB_FILE),
    privateSecretsPath: path.join(vscodeDir, PRIVATE_SECRETS_FILE),
    migrationJournalPath: path.join(vscodeDir, SQLITE_MIGRATION_JOURNAL_FILE),
    researchConfigPath: path.join(vscodeDir, RESEARCH_JSON_FILE),
  };
}

function moveLegacyWorkspaceStorageFile(sourcePath: string, targetPath: string): boolean {
  if (!fs.existsSync(sourcePath) || fs.existsSync(targetPath)) {
    return false;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch {
    fs.copyFileSync(sourcePath, targetPath);
    fs.rmSync(sourcePath, { force: true });
  }
  return true;
}

export function migrateLegacyWorkspaceStorageArtifacts(workspaceRoot: string): string[] {
  const paths = getWorkspaceStoragePaths(workspaceRoot);
  const legacyPaths = getLegacyWorkspaceStoragePaths(workspaceRoot);
  const migratedPaths: string[] = [];
  const moves: Array<[string, string]> = [
    [legacyPaths.databasePath, paths.databasePath],
    [legacyPaths.migrationJournalPath, paths.migrationJournalPath],
    [legacyPaths.privateSecretsPath, paths.privateSecretsPath],
    [legacyPaths.researchConfigPath, paths.researchConfigPath],
  ];

  for (const [sourcePath, targetPath] of moves) {
    if (moveLegacyWorkspaceStorageFile(sourcePath, targetPath)) {
      migratedPaths.push(targetPath);
    }
  }

  return migratedPaths;
}

export function getWorkspaceSchedulerMirrorPaths(
  workspaceRoot: string,
): WorkspaceSchedulerMirrorPaths {
  const paths = getWorkspaceStoragePaths(workspaceRoot);
  return {
    publicSchedulerMirrorPath: paths.publicSchedulerMirrorPath,
    privateSchedulerMirrorPath: paths.privateSchedulerMirrorPath,
  };
}

export function getWorkspaceResearchConfigPath(workspaceRoot: string): string {
  return getWorkspaceStoragePaths(workspaceRoot).researchConfigPath;
}

export function getGlobalStoragePaths(globalStorageRoot: string): GlobalStoragePaths {
  return {
    globalStorageRoot,
    databasePath: getGlobalStorageDatabasePath(globalStorageRoot),
    scheduledTasksPath: path.join(globalStorageRoot, GLOBAL_TASKS_JSON_FILE),
    scheduledTasksMetaPath: path.join(globalStorageRoot, GLOBAL_TASKS_META_JSON_FILE),
  };
}

export function getGlobalStorageDatabasePath(globalStorageRoot: string): string {
  return path.join(globalStorageRoot, GLOBAL_SQLITE_DB_FILE);
}

export const WORKSPACE_SQLITE_SCHEMA_STATEMENTS: readonly string[] = [
  "PRAGMA journal_mode = WAL;",
  "CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS workspace_tasks (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS workspace_task_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS workspace_jobs (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS workspace_job_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS workspace_job_folders (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS workspace_job_folder_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_sections (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_cards (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, section_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_comments (id TEXT PRIMARY KEY, card_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_label_catalog (key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_label_catalog_tombstones (key TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_flag_catalog (key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_flag_catalog_tombstones (key TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_card_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS cockpit_filters (id INTEGER PRIMARY KEY CHECK (id = 1), payload_json TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS research_profiles (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS research_runs (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, started_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS scheduler_history_snapshots (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, public_payload_json TEXT, private_payload_json TEXT, has_private INTEGER NOT NULL DEFAULT 0);",
  "CREATE INDEX IF NOT EXISTS idx_scheduler_history_created_at ON scheduler_history_snapshots(created_at DESC);",
  `INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('workspace_schema_version', '${WORKSPACE_SQLITE_SCHEMA_VERSION}');`,
];

export const GLOBAL_SQLITE_SCHEMA_STATEMENTS: readonly string[] = [
  "PRAGMA journal_mode = WAL;",
  "CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS global_tasks (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS global_task_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  `INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('global_schema_version', '${GLOBAL_SQLITE_SCHEMA_VERSION}');`,
];

export const WORKSPACE_SQLITE_SCHEMA_MIGRATIONS: readonly SqliteSchemaMigration[] = [
  {
    version: 2,
    name: "initialize_schema_migrations_journal",
    statements: [],
  },
  {
    version: 3,
    name: "promote_queryable_scheduler_fields",
    statements: [
      "ALTER TABLE workspace_tasks ADD COLUMN name TEXT;",
      "ALTER TABLE workspace_tasks ADD COLUMN enabled INTEGER;",
      "ALTER TABLE workspace_tasks ADD COLUMN scope TEXT;",
      "ALTER TABLE workspace_tasks ADD COLUMN next_run TEXT;",
      "ALTER TABLE workspace_jobs ADD COLUMN name TEXT;",
      "ALTER TABLE workspace_jobs ADD COLUMN folder_id TEXT;",
      "ALTER TABLE workspace_job_folders ADD COLUMN name TEXT;",
      "ALTER TABLE cockpit_cards ADD COLUMN title TEXT;",
      "ALTER TABLE cockpit_cards ADD COLUMN status TEXT;",
      "ALTER TABLE cockpit_cards ADD COLUMN priority TEXT;",
      "ALTER TABLE cockpit_cards ADD COLUMN order_index REAL;",
      "ALTER TABLE cockpit_cards ADD COLUMN archived INTEGER;",
    ],
  },
  {
    version: 4,
    name: "index_scheduler_due_tasks",
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_workspace_tasks_due ON workspace_tasks(enabled, next_run);",
    ],
  },
  {
    version: 5,
    name: "store_scheduler_history_snapshots",
    statements: [
      "CREATE TABLE IF NOT EXISTS scheduler_history_snapshots (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, public_payload_json TEXT, private_payload_json TEXT, has_private INTEGER NOT NULL DEFAULT 0);",
      "CREATE INDEX IF NOT EXISTS idx_scheduler_history_created_at ON scheduler_history_snapshots(created_at DESC);",
    ],
  },
];

export const GLOBAL_SQLITE_SCHEMA_MIGRATIONS: readonly SqliteSchemaMigration[] = [
  {
    version: 2,
    name: "initialize_schema_migrations_journal",
    statements: [],
  },
  {
    version: 3,
    name: "promote_queryable_global_task_fields",
    statements: [
      "ALTER TABLE global_tasks ADD COLUMN name TEXT;",
      "ALTER TABLE global_tasks ADD COLUMN enabled INTEGER;",
      "ALTER TABLE global_tasks ADD COLUMN scope TEXT;",
      "ALTER TABLE global_tasks ADD COLUMN next_run TEXT;",
    ],
  },
  {
    version: 4,
    name: "index_global_due_tasks",
    statements: [
      "CREATE INDEX IF NOT EXISTS idx_global_tasks_due ON global_tasks(enabled, next_run);",
    ],
  },
];
