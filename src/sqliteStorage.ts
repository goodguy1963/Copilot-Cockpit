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

export type SchedulerStorageMode =
  | typeof JSON_STORAGE_MODE
  | typeof SQLITE_STORAGE_MODE;

export const WORKSPACE_SQLITE_DB_FILE = "copilot-cockpit.db";
export const GLOBAL_SQLITE_DB_FILE = "copilot-cockpit-global.db";
export const PRIVATE_SECRETS_FILE = "copilot-cockpit.private.json";

export const WORKSPACE_SQLITE_SCHEMA_VERSION = 1;
export const GLOBAL_SQLITE_SCHEMA_VERSION = 1;

export type WorkspaceStoragePaths = {
  workspaceRoot: string;
  vscodeDir: string;
  databasePath: string;
  publicSchedulerMirrorPath: string;
  privateSchedulerMirrorPath: string;
  privateSecretsPath: string;
  migrationJournalPath: string;
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
  return value !== false;
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
      true,
      scope,
    ),
  );
}

export function getWorkspaceStoragePaths(
  workspaceRoot: string,
): WorkspaceStoragePaths {
  const vscodeDir = path.join(workspaceRoot, ".vscode");
  return {
    workspaceRoot,
    vscodeDir,
    databasePath: path.join(vscodeDir, WORKSPACE_SQLITE_DB_FILE),
    publicSchedulerMirrorPath: path.join(vscodeDir, SCHEDULER_PUBLIC_JSON_FILE),
    privateSchedulerMirrorPath: path.join(vscodeDir, SCHEDULER_PRIVATE_JSON_FILE),
    privateSecretsPath: path.join(vscodeDir, PRIVATE_SECRETS_FILE),
    migrationJournalPath: path.join(vscodeDir, SQLITE_MIGRATION_JOURNAL_FILE),
  };
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
  return path.join(workspaceRoot, ".vscode", RESEARCH_JSON_FILE);
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
  `INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('workspace_schema_version', '${WORKSPACE_SQLITE_SCHEMA_VERSION}');`,
];

export const GLOBAL_SQLITE_SCHEMA_STATEMENTS: readonly string[] = [
  "PRAGMA journal_mode = WAL;",
  "CREATE TABLE IF NOT EXISTS app_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS global_tasks (id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);",
  "CREATE TABLE IF NOT EXISTS global_task_tombstones (id TEXT PRIMARY KEY, deleted_at TEXT NOT NULL);",
  `INSERT OR IGNORE INTO app_metadata(key, value) VALUES ('global_schema_version', '${GLOBAL_SQLITE_SCHEMA_VERSION}');`,
];