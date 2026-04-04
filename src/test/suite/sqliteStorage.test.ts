import * as assert from "assert";
import * as path from "path";
import {
  GLOBAL_TASKS_JSON_FILE,
  GLOBAL_TASKS_META_JSON_FILE,
  GLOBAL_SQLITE_DB_FILE,
  GLOBAL_SQLITE_SCHEMA_STATEMENTS,
  JSON_STORAGE_MODE,
  PRIVATE_SECRETS_FILE,
  RESEARCH_JSON_FILE,
  SQLITE_STORAGE_MODE,
  WORKSPACE_SQLITE_DB_FILE,
  WORKSPACE_SQLITE_SCHEMA_STATEMENTS,
  getGlobalStoragePaths,
  getWorkspaceResearchConfigPath,
  getGlobalStorageDatabasePath,
  getWorkspaceStoragePaths,
  normalizeSchedulerStorageMode,
  normalizeSqliteJsonMirrorEnabled,
} from "../../sqliteStorage";

suite("SQLite Storage Foundation Tests", () => {
  test("normalizes storage mode to known values", () => {
    assert.strictEqual(normalizeSchedulerStorageMode(SQLITE_STORAGE_MODE), SQLITE_STORAGE_MODE);
    assert.strictEqual(normalizeSchedulerStorageMode("unexpected"), JSON_STORAGE_MODE);
    assert.strictEqual(normalizeSchedulerStorageMode(undefined), JSON_STORAGE_MODE);
  });

  test("defaults JSON mirror to enabled", () => {
    assert.strictEqual(normalizeSqliteJsonMirrorEnabled(undefined), true);
    assert.strictEqual(normalizeSqliteJsonMirrorEnabled(true), true);
    assert.strictEqual(normalizeSqliteJsonMirrorEnabled(false), false);
  });

  test("builds workspace storage paths under .vscode", () => {
    const paths = getWorkspaceStoragePaths("/repo/workspace");

    assert.strictEqual(paths.databasePath, path.join("/repo/workspace", ".vscode", WORKSPACE_SQLITE_DB_FILE));
    assert.strictEqual(paths.publicSchedulerMirrorPath, path.join("/repo/workspace", ".vscode", "scheduler.json"));
    assert.strictEqual(paths.privateSchedulerMirrorPath, path.join("/repo/workspace", ".vscode", "scheduler.private.json"));
    assert.strictEqual(paths.privateSecretsPath, path.join("/repo/workspace", ".vscode", PRIVATE_SECRETS_FILE));
    assert.strictEqual(paths.migrationJournalPath, path.join("/repo/workspace", ".vscode", "copilot-cockpit.db-migration.json"));
  });

  test("builds global storage database path", () => {
    assert.strictEqual(
      getGlobalStorageDatabasePath("/global/root"),
      path.join("/global/root", GLOBAL_SQLITE_DB_FILE),
    );
  });

  test("builds research and global store helper paths", () => {
    assert.strictEqual(
      getWorkspaceResearchConfigPath("/repo/workspace"),
      path.join("/repo/workspace", ".vscode", RESEARCH_JSON_FILE),
    );

    const globalPaths = getGlobalStoragePaths("/global/root");
    assert.strictEqual(globalPaths.databasePath, path.join("/global/root", GLOBAL_SQLITE_DB_FILE));
    assert.strictEqual(globalPaths.scheduledTasksPath, path.join("/global/root", GLOBAL_TASKS_JSON_FILE));
    assert.strictEqual(globalPaths.scheduledTasksMetaPath, path.join("/global/root", GLOBAL_TASKS_META_JSON_FILE));
  });

  test("defines workspace schema for core state domains", () => {
    const combined = WORKSPACE_SQLITE_SCHEMA_STATEMENTS.join("\n");
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS workspace_tasks"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS cockpit_cards"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS cockpit_card_tombstones"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS research_profiles"));
    assert.ok(combined.includes("workspace_schema_version"));
  });

  test("defines global schema for task state", () => {
    const combined = GLOBAL_SQLITE_SCHEMA_STATEMENTS.join("\n");
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS global_tasks"));
    assert.ok(combined.includes("global_schema_version"));
  });
});