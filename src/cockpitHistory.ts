import * as fs from "fs";
import * as path from "path";
import type { ScheduleHistoryEntry } from "./types";
import { openNativeSqliteDatabase, type NativeSqliteDatabase } from "./nativeSqlite";
import { getWorkspaceStoragePaths } from "./sqliteStorage";

const HISTORY_DIR_NAME = "scheduler-history";
const HISTORY_PREFIX = "scheduler-";
const PUBLIC_SUFFIX = ".json";
const PRIVATE_SUFFIX = ".private.json";
const MAX_HISTORY_ENTRIES = 100;
const HISTORY_TABLE = "scheduler_history_snapshots";

type SchedulerConfig = { tasks: any[]; jobs?: any[]; jobFolders?: any[] };

function toHistoryFileId(date = new Date()): string {
  return String(date.getTime());
}

function parseHistoryTimestamp(fileId: string): number | undefined {
  if (!/^\d+$/.test(fileId)) {
    return undefined;
  }

  const timestamp = Number(fileId);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  return timestamp;
}

function getHistoryBaseName(fileId: string): string {
  return `${HISTORY_PREFIX}${fileId}`;
}

function getPublicSnapshotPath(historyRoot: string, fileId: string): string {
  return path.join(historyRoot, `${getHistoryBaseName(fileId)}${PUBLIC_SUFFIX}`);
}

function getPrivateSnapshotPath(historyRoot: string, fileId: string): string {
  return path.join(historyRoot, `${getHistoryBaseName(fileId)}${PRIVATE_SUFFIX}`);
}

function normalizeSchedulerConfigPayload(value: unknown): SchedulerConfig | undefined {
  if (!value || typeof value !== "object" || !Array.isArray((value as { tasks?: unknown }).tasks)) {
    return undefined;
  }

  const parsed = value as SchedulerConfig;
  return {
    ...parsed,
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    jobFolders: Array.isArray(parsed.jobFolders) ? parsed.jobFolders : [],
  };
}

function parseSchedulerConfigJson(raw: unknown): SchedulerConfig | undefined {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }

  try {
    return normalizeSchedulerConfigPayload(JSON.parse(raw.replace(/^\uFEFF/, "")));
  } catch {
    return undefined;
  }
}

function readJsonFile(filePath: string): SchedulerConfig | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    return parseSchedulerConfigJson(fs.readFileSync(filePath, "utf8"));
  } catch {
    // ignore invalid snapshot files and let listing continue
  }

  return undefined;
}

function getHistoryDatabasePath(workspaceRoot: string): string {
  return getWorkspaceStoragePaths(workspaceRoot).databasePath;
}

function hasHistoryDatabase(workspaceRoot: string): boolean {
  return fs.existsSync(getHistoryDatabasePath(workspaceRoot));
}

function firstSqliteRow(
  db: NativeSqliteDatabase,
  sql: string,
  params?: unknown[],
): unknown[] | undefined {
  return db.exec(sql, params)[0]?.values[0];
}

function ensureSqliteHistorySchema(db: NativeSqliteDatabase): void {
  db.run(
    `CREATE TABLE IF NOT EXISTS ${HISTORY_TABLE} (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, public_payload_json TEXT, private_payload_json TEXT, has_private INTEGER NOT NULL DEFAULT 0);`,
  );
  db.run(
    `CREATE INDEX IF NOT EXISTS idx_scheduler_history_created_at ON ${HISTORY_TABLE}(created_at DESC);`,
  );
}

function openHistoryDatabase(workspaceRoot: string): NativeSqliteDatabase | undefined {
  const databasePath = getHistoryDatabasePath(workspaceRoot);
  if (!fs.existsSync(databasePath)) {
    return undefined;
  }

  const db = openNativeSqliteDatabase(databasePath);
  ensureSqliteHistorySchema(db);
  return db;
}

function listSqliteHistoryEntries(workspaceRoot: string): ScheduleHistoryEntry[] {
  const db = openHistoryDatabase(workspaceRoot);
  if (!db) {
    return [];
  }

  try {
    const rows = db.exec(
      `SELECT id, created_at, has_private FROM ${HISTORY_TABLE} ORDER BY CAST(id AS INTEGER) DESC;`,
    )[0]?.values ?? [];
    return rows
      .filter((row) => typeof row[0] === "string" && typeof row[1] === "string")
      .map((row) => ({
        id: row[0] as string,
        createdAt: row[1] as string,
        hasPrivate: row[2] === 1,
      }));
  } finally {
    db.close();
  }
}

function readSqliteHistorySnapshot(
  workspaceRoot: string,
  snapshotId: string,
): { publicConfig?: SchedulerConfig; privateConfig?: SchedulerConfig } | undefined {
  const db = openHistoryDatabase(workspaceRoot);
  if (!db) {
    return undefined;
  }

  try {
    const row = firstSqliteRow(
      db,
      `SELECT public_payload_json, private_payload_json FROM ${HISTORY_TABLE} WHERE id = ? LIMIT 1;`,
      [snapshotId],
    );
    if (!row) {
      return undefined;
    }

    const publicConfig = parseSchedulerConfigJson(row[0]);
    const privateConfig = parseSchedulerConfigJson(row[1]);
    return publicConfig || privateConfig ? { publicConfig, privateConfig } : undefined;
  } finally {
    db.close();
  }
}

function trimSqliteHistoryEntries(db: NativeSqliteDatabase): void {
  const staleRows = db.exec(
    `SELECT id FROM ${HISTORY_TABLE} ORDER BY CAST(id AS INTEGER) DESC LIMIT -1 OFFSET ?;`,
    [MAX_HISTORY_ENTRIES],
  )[0]?.values ?? [];

  for (const row of staleRows) {
    if (typeof row[0] === "string") {
      db.run(`DELETE FROM ${HISTORY_TABLE} WHERE id = ?;`, [row[0]]);
    }
  }
}

function createSqliteHistorySnapshot(
  workspaceRoot: string,
  publicConfig: SchedulerConfig,
  privateConfig: SchedulerConfig,
  createdAt: Date,
): ScheduleHistoryEntry | undefined {
  const db = openHistoryDatabase(workspaceRoot);
  if (!db) {
    return undefined;
  }

  let fileId = toHistoryFileId(createdAt);
  try {
    while (firstSqliteRow(db, `SELECT id FROM ${HISTORY_TABLE} WHERE id = ? LIMIT 1;`, [fileId])) {
      fileId = String(Number(fileId) + 1);
    }

    db.run("BEGIN TRANSACTION;");
    try {
      db.run(
        `INSERT INTO ${HISTORY_TABLE}(id, created_at, public_payload_json, private_payload_json, has_private) VALUES (?, ?, ?, ?, ?);`,
        [
          fileId,
          new Date(Number(fileId)).toISOString(),
          JSON.stringify(publicConfig),
          JSON.stringify(privateConfig),
          1,
        ],
      );
      trimSqliteHistoryEntries(db);
      db.run("COMMIT;");
    } catch (error) {
      db.run("ROLLBACK;");
      throw error;
    }

    return {
      id: fileId,
      createdAt: new Date(Number(fileId)).toISOString(),
      hasPrivate: true,
    };
  } finally {
    db.close();
  }
}

function deleteIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // ignore best-effort cleanup failures
  }
}

function trimHistoryEntries(historyRoot: string): void {
  const entries = listScheduleHistoryEntriesByRoot(historyRoot);
  if (entries.length <= MAX_HISTORY_ENTRIES) {
    return;
  }

  for (const entry of entries.slice(MAX_HISTORY_ENTRIES)) {
    deleteIfExists(getPublicSnapshotPath(historyRoot, entry.id));
    deleteIfExists(getPrivateSnapshotPath(historyRoot, entry.id));
  }
}

function listScheduleHistoryEntriesByRoot(historyRoot: string): ScheduleHistoryEntry[] {
  if (!fs.existsSync(historyRoot)) {
    return [];
  }

  const found = new Map<string, { hasPublic: boolean; hasPrivate: boolean }>();

  for (const dirent of fs.readdirSync(historyRoot, { withFileTypes: true })) {
    if (!dirent.isFile()) {
      continue;
    }

    const fileName = dirent.name;
    let fileId: string | undefined;
    let isPrivate = false;

    if (fileName.startsWith(HISTORY_PREFIX) && fileName.endsWith(PRIVATE_SUFFIX)) {
      fileId = fileName.slice(HISTORY_PREFIX.length, -PRIVATE_SUFFIX.length);
      isPrivate = true;
    } else if (fileName.startsWith(HISTORY_PREFIX) && fileName.endsWith(PUBLIC_SUFFIX)) {
      fileId = fileName.slice(HISTORY_PREFIX.length, -PUBLIC_SUFFIX.length);
    }

    if (!fileId) {
      continue;
    }

    const timestamp = parseHistoryTimestamp(fileId);
    if (timestamp === undefined) {
      continue;
    }

    const current = found.get(fileId) ?? { hasPublic: false, hasPrivate: false };
    if (isPrivate) {
      current.hasPrivate = true;
    } else {
      current.hasPublic = true;
    }
    found.set(fileId, current);
  }

  return Array.from(found.entries())
    .map(([id, flags]) => ({
      id,
      createdAt: new Date(Number(id)).toISOString(),
      hasPrivate: flags.hasPrivate,
    }))
    .sort((left, right) => Number(right.id) - Number(left.id));
}

export function getScheduleHistoryRoot(workspaceRoot: string): string {
  return path.join(getWorkspaceStoragePaths(workspaceRoot).cockpitDataDir, HISTORY_DIR_NAME);
}

function getLegacyScheduleHistoryRoot(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".vscode", HISTORY_DIR_NAME);
}

function getScheduleHistoryRoots(workspaceRoot: string): string[] {
  const canonicalRoot = getScheduleHistoryRoot(workspaceRoot);
  const legacyRoot = getLegacyScheduleHistoryRoot(workspaceRoot);
  return canonicalRoot === legacyRoot ? [canonicalRoot] : [canonicalRoot, legacyRoot];
}

export function listScheduleHistoryEntries(workspaceRoot: string): ScheduleHistoryEntry[] {
  const entries = new Map<string, ScheduleHistoryEntry>();

  for (const entry of listSqliteHistoryEntries(workspaceRoot)) {
    entries.set(entry.id, entry);
  }

  for (const historyRoot of getScheduleHistoryRoots(workspaceRoot)) {
    for (const entry of listScheduleHistoryEntriesByRoot(historyRoot)) {
      if (!entries.has(entry.id)) {
        entries.set(entry.id, entry);
      }
    }
  }

  return Array.from(entries.values())
    .sort((left, right) => Number(right.id) - Number(left.id));
}

export function createScheduleHistorySnapshot(
  workspaceRoot: string,
  publicConfig: SchedulerConfig,
  privateConfig: SchedulerConfig,
  createdAt = new Date(),
): ScheduleHistoryEntry {
  if (hasHistoryDatabase(workspaceRoot)) {
    const sqliteSnapshot = createSqliteHistorySnapshot(
      workspaceRoot,
      publicConfig,
      privateConfig,
      createdAt,
    );
    if (sqliteSnapshot) {
      return sqliteSnapshot;
    }
  }

  const historyRoot = getScheduleHistoryRoot(workspaceRoot);
  fs.mkdirSync(historyRoot, { recursive: true });

  let fileId = toHistoryFileId(createdAt);
  while (
    fs.existsSync(getPublicSnapshotPath(historyRoot, fileId)) ||
    fs.existsSync(getPrivateSnapshotPath(historyRoot, fileId))
  ) {
    fileId = String(Number(fileId) + 1);
  }

  fs.writeFileSync(
    getPublicSnapshotPath(historyRoot, fileId),
    JSON.stringify(publicConfig, null, 4),
    "utf8",
  );
  fs.writeFileSync(
    getPrivateSnapshotPath(historyRoot, fileId),
    JSON.stringify(privateConfig, null, 4),
    "utf8",
  );

  trimHistoryEntries(historyRoot);

  return {
    id: fileId,
    createdAt: new Date(Number(fileId)).toISOString(),
    hasPrivate: true,
  };
}

export function readScheduleHistorySnapshot(
  workspaceRoot: string,
  snapshotId: string,
): { publicConfig?: SchedulerConfig; privateConfig?: SchedulerConfig } | undefined {
  const historyEntry = listScheduleHistoryEntries(workspaceRoot).find(
    (entry) => entry.id === snapshotId,
  );
  if (!historyEntry) {
    return undefined;
  }

  const sqliteSnapshot = readSqliteHistorySnapshot(workspaceRoot, snapshotId);
  if (sqliteSnapshot) {
    return sqliteSnapshot;
  }

  for (const historyRoot of getScheduleHistoryRoots(workspaceRoot)) {
    const publicConfig = readJsonFile(getPublicSnapshotPath(historyRoot, snapshotId));
    const privateConfig = readJsonFile(getPrivateSnapshotPath(historyRoot, snapshotId));

    if (publicConfig || privateConfig) {
      return { publicConfig, privateConfig };
    }
  }

  return undefined;
}
