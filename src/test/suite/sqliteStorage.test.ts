import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  GLOBAL_TASKS_JSON_FILE,
  GLOBAL_TASKS_META_JSON_FILE,
  GLOBAL_SQLITE_DB_FILE,
  GLOBAL_SQLITE_SCHEMA_MIGRATIONS,
  GLOBAL_SQLITE_SCHEMA_STATEMENTS,
  JSON_STORAGE_MODE,
  PRIVATE_SECRETS_FILE,
  RESEARCH_JSON_FILE,
  SQLITE_STORAGE_MODE,
  WORKSPACE_SQLITE_SCHEMA_MIGRATIONS,
  WORKSPACE_SQLITE_DB_FILE,
  WORKSPACE_SQLITE_SCHEMA_STATEMENTS,
  getGlobalStoragePaths,
  getWorkspaceResearchConfigPath,
  getGlobalStorageDatabasePath,
  getWorkspaceStoragePaths,
  migrateLegacyWorkspaceStorageArtifacts,
  normalizeMaxSqliteBackups,
  normalizeSchedulerStorageMode,
  normalizeSqliteJsonMirrorEnabled,
} from "../../sqliteStorage";

suite("SQLite Storage Foundation Tests", () => {
  test("normalizes storage mode to known values", () => {
    assert.strictEqual(normalizeSchedulerStorageMode(SQLITE_STORAGE_MODE), SQLITE_STORAGE_MODE);
    assert.strictEqual(normalizeSchedulerStorageMode("unexpected"), JSON_STORAGE_MODE);
    assert.strictEqual(normalizeSchedulerStorageMode(undefined), JSON_STORAGE_MODE);
  });

  test("defaults JSON mirror to disabled", () => {
    assert.strictEqual(normalizeSqliteJsonMirrorEnabled(undefined), false);
    assert.strictEqual(normalizeSqliteJsonMirrorEnabled(true), true);
    assert.strictEqual(normalizeSqliteJsonMirrorEnabled(false), false);
  });

  function createTempRoot(prefix: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }

  function cleanup(root: string): void {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }

  test("builds workspace sqlite artifact paths under the cockpit data root", () => {
    const paths = getWorkspaceStoragePaths("/repo/workspace");
    const cockpitRoot = path.join("/repo/workspace", ".vscode", "copilot-cockpit");

    assert.strictEqual(paths.cockpitDataDir, cockpitRoot);
    assert.strictEqual(paths.databasePath, path.join(cockpitRoot, WORKSPACE_SQLITE_DB_FILE));
    assert.strictEqual(paths.publicSchedulerMirrorPath, path.join("/repo/workspace", ".vscode", "scheduler.json"));
    assert.strictEqual(paths.privateSchedulerMirrorPath, path.join("/repo/workspace", ".vscode", "scheduler.private.json"));
    assert.strictEqual(paths.privateSecretsPath, path.join(cockpitRoot, PRIVATE_SECRETS_FILE));
    assert.strictEqual(paths.migrationJournalPath, path.join(cockpitRoot, "copilot-cockpit.db-migration.json"));
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
      path.join("/repo/workspace", ".vscode", "copilot-cockpit", RESEARCH_JSON_FILE),
    );

    const globalPaths = getGlobalStoragePaths("/global/root");
    assert.strictEqual(globalPaths.databasePath, path.join("/global/root", GLOBAL_SQLITE_DB_FILE));
    assert.strictEqual(globalPaths.scheduledTasksPath, path.join("/global/root", GLOBAL_TASKS_JSON_FILE));
    assert.strictEqual(globalPaths.scheduledTasksMetaPath, path.join("/global/root", GLOBAL_TASKS_META_JSON_FILE));
  });

  test("migrates legacy workspace sqlite artifacts into the cockpit data root", () => {
    const workspaceRoot = createTempRoot("copilot-storage-migrate-");

    try {
      const vscodeDir = path.join(workspaceRoot, ".vscode");
      const paths = getWorkspaceStoragePaths(workspaceRoot);
      fs.mkdirSync(vscodeDir, { recursive: true });
      fs.mkdirSync(paths.cockpitDataDir, { recursive: true });

      const legacyDatabasePath = path.join(vscodeDir, WORKSPACE_SQLITE_DB_FILE);
      const legacyJournalPath = path.join(vscodeDir, "copilot-cockpit.db-migration.json");
      const legacySecretsPath = path.join(vscodeDir, PRIVATE_SECRETS_FILE);
      const legacyResearchPath = path.join(vscodeDir, RESEARCH_JSON_FILE);

      fs.writeFileSync(legacyDatabasePath, "legacy-db", "utf8");
      fs.writeFileSync(legacyJournalPath, "legacy-journal", "utf8");
      fs.writeFileSync(legacySecretsPath, "legacy-secrets", "utf8");
      fs.writeFileSync(legacyResearchPath, "legacy-research", "utf8");
      fs.writeFileSync(paths.privateSecretsPath, "canonical-secrets", "utf8");

      const migrated = migrateLegacyWorkspaceStorageArtifacts(workspaceRoot);

      assert.ok(migrated.includes(paths.databasePath));
      assert.ok(migrated.includes(paths.migrationJournalPath));
      assert.ok(migrated.includes(paths.researchConfigPath));
      assert.strictEqual(fs.readFileSync(paths.databasePath, "utf8"), "legacy-db");
      assert.strictEqual(fs.readFileSync(paths.migrationJournalPath, "utf8"), "legacy-journal");
      assert.strictEqual(fs.readFileSync(paths.researchConfigPath, "utf8"), "legacy-research");
      assert.strictEqual(fs.readFileSync(paths.privateSecretsPath, "utf8"), "canonical-secrets");
      assert.strictEqual(fs.existsSync(legacyDatabasePath), false);
      assert.strictEqual(fs.existsSync(legacyJournalPath), false);
      assert.strictEqual(fs.existsSync(legacyResearchPath), false);
      assert.strictEqual(fs.existsSync(legacySecretsPath), true);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("defines workspace schema for core state domains", () => {
    const combined = [
      ...WORKSPACE_SQLITE_SCHEMA_STATEMENTS,
      ...WORKSPACE_SQLITE_SCHEMA_MIGRATIONS.flatMap((migration) => migration.statements),
    ].join("\n");
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS workspace_tasks"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS cockpit_cards"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS cockpit_card_tombstones"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS research_profiles"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS schema_migrations"));
    assert.ok(combined.includes("CREATE INDEX IF NOT EXISTS idx_workspace_tasks_due"));
    assert.ok(combined.includes("workspace_schema_version"));
  });

  test("defines global schema for task state", () => {
    const combined = [
      ...GLOBAL_SQLITE_SCHEMA_STATEMENTS,
      ...GLOBAL_SQLITE_SCHEMA_MIGRATIONS.flatMap((migration) => migration.statements),
    ].join("\n");
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS global_tasks"));
    assert.ok(combined.includes("CREATE TABLE IF NOT EXISTS schema_migrations"));
    assert.ok(combined.includes("CREATE INDEX IF NOT EXISTS idx_global_tasks_due"));
    assert.ok(combined.includes("global_schema_version"));
  });

  test("normalizeMaxSqliteBackups clamps to 0-20 range", () => {
    assert.strictEqual(normalizeMaxSqliteBackups(3), 3);
    assert.strictEqual(normalizeMaxSqliteBackups(0), 0);
    assert.strictEqual(normalizeMaxSqliteBackups(20), 20);
    assert.strictEqual(normalizeMaxSqliteBackups(21), 20);
    assert.strictEqual(normalizeMaxSqliteBackups(-1), 0);
    assert.strictEqual(normalizeMaxSqliteBackups(-100), 0);
    assert.strictEqual(normalizeMaxSqliteBackups(100), 20);
  });

  test("normalizeMaxSqliteBackups defaults to 3 for non-number inputs", () => {
    assert.strictEqual(normalizeMaxSqliteBackups(undefined), 3);
    assert.strictEqual(normalizeMaxSqliteBackups(null), 3);
    assert.strictEqual(normalizeMaxSqliteBackups("5"), 3);
    assert.strictEqual(normalizeMaxSqliteBackups(NaN), 3);
    assert.strictEqual(normalizeMaxSqliteBackups(Infinity), 3);
  });

  test("normalizeMaxSqliteBackups rounds to the nearest integer", () => {
    assert.strictEqual(normalizeMaxSqliteBackups(3.2), 3);
    assert.strictEqual(normalizeMaxSqliteBackups(3.9), 4);
    assert.strictEqual(normalizeMaxSqliteBackups(0.5), 1);
    assert.strictEqual(normalizeMaxSqliteBackups(19.5), 20);
  });
});
