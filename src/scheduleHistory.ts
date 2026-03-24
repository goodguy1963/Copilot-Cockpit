import * as fs from "fs";
import * as path from "path";
import type { ScheduleHistoryEntry } from "./types";

const HISTORY_DIR_PARTS = [".vscode", "scheduler-history"] as const;
const HISTORY_PREFIX = "scheduler-";
const PUBLIC_SUFFIX = ".json";
const PRIVATE_SUFFIX = ".private.json";
const MAX_HISTORY_ENTRIES = 100;

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

function readJsonFile(filePath: string): SchedulerConfig | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.tasks)) {
      return {
        ...parsed,
        jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
        jobFolders: Array.isArray(parsed.jobFolders) ? parsed.jobFolders : [],
      } as SchedulerConfig;
    }
  } catch {
    // ignore invalid snapshot files and let listing continue
  }

  return undefined;
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
  return path.join(workspaceRoot, ...HISTORY_DIR_PARTS);
}

export function listScheduleHistoryEntries(workspaceRoot: string): ScheduleHistoryEntry[] {
  return listScheduleHistoryEntriesByRoot(getScheduleHistoryRoot(workspaceRoot));
}

export function createScheduleHistorySnapshot(
  workspaceRoot: string,
  publicConfig: SchedulerConfig,
  privateConfig: SchedulerConfig,
  createdAt = new Date(),
): ScheduleHistoryEntry {
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

  const historyRoot = getScheduleHistoryRoot(workspaceRoot);
  const publicConfig = readJsonFile(getPublicSnapshotPath(historyRoot, snapshotId));
  const privateConfig = readJsonFile(getPrivateSnapshotPath(historyRoot, snapshotId));

  if (!publicConfig && !privateConfig) {
    return undefined;
  }

  return { publicConfig, privateConfig };
}