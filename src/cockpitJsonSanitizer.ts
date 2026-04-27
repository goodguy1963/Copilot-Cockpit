import * as fs from "fs";
import * as path from "path";
import { normalizeCockpitBoard } from "./cockpitBoard";
import { createScheduleHistorySnapshot } from "./cockpitHistory";
import { ensurePrivateConfigIgnoredForWorkspaceRoot } from "./privateConfigIgnore";
import { getWorkspaceSchedulerMirrorPaths } from "./sqliteStorage";
import type {
    CockpitBoardFilters,
    GitHubInboxItem,
    GitHubInboxLane,
    GitHubInboxSnapshot,
    SchedulerWorkspaceConfig,
} from "./types";
import {
    filterStoredSchedulerTaskEntries,
    safeParseStoredSchedulerConfigInput,
} from "./validation/storedSchedulerConfig";

const DISCORD_WEBHOOK_URL_PATTERN =
    /https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+/gi;
const TELEGRAM_BOT_URL_PATTERN =
    /https:\/\/api\.telegram\.org\/bot[0-9]{5,}:[A-Za-z0-9_-]{20,}\/[^\s"']*/gi;
const TELEGRAM_BOT_TOKEN_PATTERN =
    /\b[0-9]{5,}:[A-Za-z0-9_-]{20,}\b/g;

export const REDACTED_DISCORD_WEBHOOK_URL =
    "[REDACTED_DISCORD_WEBHOOK_URL]";
export const REDACTED_TELEGRAM_BOT_URL =
    "[REDACTED_TELEGRAM_BOT_URL]";
export const REDACTED_TELEGRAM_BOT_TOKEN =
    "[REDACTED_TELEGRAM_BOT_TOKEN]";
export const REDACTED_GITHUB_TOKEN =
    "[REDACTED_GITHUB_TOKEN]";

const GITHUB_SYNC_STATUSES = new Set([
    "disabled",
    "ready",
    "syncing",
    "stale",
    "partial",
    "rate-limited",
    "error",
]);
const GITHUB_INBOX_ITEM_KINDS = new Set([
    "issue",
    "pullRequest",
    "securityAlert",
]);
const GITHUB_INBOX_LANES = [
    "issues",
    "pullRequests",
    "securityAlerts",
] as const;
const GITHUB_SECURITY_ALERT_SUBTYPES = new Set([
    "code-scanning",
    "dependabot",
]);

const RECENT_SCHEDULER_CONFIG_WRITE_WINDOW_MS = 1500;
const recentSchedulerConfigWrites = new Map<string, number>();
const DEFAULT_SCHEDULER_LOCK_STALE_MS = 30_000;
const DEFAULT_SCHEDULER_LOCK_MAX_WAIT_MS = 2_000;
const DEFAULT_SCHEDULER_LOCK_RETRY_MS = 50;
const schedulerLockOptions = {
    staleMs: DEFAULT_SCHEDULER_LOCK_STALE_MS,
    maxWaitMs: DEFAULT_SCHEDULER_LOCK_MAX_WAIT_MS,
    retryMs: DEFAULT_SCHEDULER_LOCK_RETRY_MS,
};
const schedulerFs = {
    writeFileSync: fs.writeFileSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    copyFileSync: fs.copyFileSync.bind(fs),
    existsSync: fs.existsSync.bind(fs),
    unlinkSync: fs.unlinkSync.bind(fs),
    mkdirSync: fs.mkdirSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    statSync: fs.statSync.bind(fs),
    readFileSync: fs.readFileSync.bind(fs),
};

type SchedulerTransactionRecord = {
    version: 1;
    createdAt: string;
    publicPath: string;
    privatePath: string;
    publicChanged: boolean;
    privateChanged: boolean;
    publicContent?: string;
    privateContent?: string;
};

export function setSchedulerFileOpsForTests(
    overrides?: Partial<typeof schedulerFs>,
): void {
    schedulerFs.writeFileSync = overrides?.writeFileSync ?? fs.writeFileSync.bind(fs);
    schedulerFs.renameSync = overrides?.renameSync ?? fs.renameSync.bind(fs);
    schedulerFs.copyFileSync = overrides?.copyFileSync ?? fs.copyFileSync.bind(fs);
    schedulerFs.existsSync = overrides?.existsSync ?? fs.existsSync.bind(fs);
    schedulerFs.unlinkSync = overrides?.unlinkSync ?? fs.unlinkSync.bind(fs);
    schedulerFs.mkdirSync = overrides?.mkdirSync ?? fs.mkdirSync.bind(fs);
    schedulerFs.rmSync = overrides?.rmSync ?? fs.rmSync.bind(fs);
    schedulerFs.statSync = overrides?.statSync ?? fs.statSync.bind(fs);
    schedulerFs.readFileSync = overrides?.readFileSync ?? fs.readFileSync.bind(fs);
}

export function setSchedulerLockOptionsForTests(
    overrides?: Partial<typeof schedulerLockOptions>,
): void {
    schedulerLockOptions.staleMs = overrides?.staleMs ?? DEFAULT_SCHEDULER_LOCK_STALE_MS;
    schedulerLockOptions.maxWaitMs = overrides?.maxWaitMs ?? DEFAULT_SCHEDULER_LOCK_MAX_WAIT_MS;
    schedulerLockOptions.retryMs = overrides?.retryMs ?? DEFAULT_SCHEDULER_LOCK_RETRY_MS;
}

const schedulerSleepBuffer = typeof SharedArrayBuffer !== "undefined"
    ? new Int32Array(new SharedArrayBuffer(4))
    : undefined;

function logSchedulerSanitizerInfo(...args: unknown[]): void {
    console.info(...args);
}

function normalizeSchedulerConfigPath(filePath: string): string {
    const normalized = path.normalize(String(filePath || ""));
    return process.platform === "win32"
        ? normalized.toLowerCase()
        : normalized;
}

function recordRecentSchedulerConfigWrite(filePath: string, writtenAt: number): void {
    if (!filePath) {
        return;
    }

    recentSchedulerConfigWrites.set(
        normalizeSchedulerConfigPath(filePath),
        writtenAt,
    );

    for (const [trackedPath, trackedAt] of recentSchedulerConfigWrites.entries()) {
        if (writtenAt - trackedAt > RECENT_SCHEDULER_CONFIG_WRITE_WINDOW_MS) {
            recentSchedulerConfigWrites.delete(trackedPath);
        }
    }
}

export function wasSchedulerConfigWrittenRecently(
    filePath: string,
    withinMs = RECENT_SCHEDULER_CONFIG_WRITE_WINDOW_MS,
): boolean {
    if (!filePath) {
        return false;
    }

    const normalizedPath = normalizeSchedulerConfigPath(filePath);
    const writtenAt = recentSchedulerConfigWrites.get(normalizedPath);
    if (typeof writtenAt !== "number") {
        return false;
    }

    const isRecent = Date.now() - writtenAt <= withinMs;
    if (!isRecent) {
        recentSchedulerConfigWrites.delete(normalizedPath);
    }

    return isRecent;
}

export type SchedulerConfigWriteResult = {
    publicChanged: boolean;
    privateChanged: boolean;
    publicPath: string;
    privatePath: string;
};

export type SchedulerConfigWriteOptions = {
    baseConfig?: SchedulerWorkspaceConfig;
    mode?: "merge" | "replace";
};

let schedulerConflictNotifier: ((message: string) => void) | undefined;
let lastConflictNotificationAt = 0;
let lastConflictNotificationMessage = "";
const CONFLICT_NOTIFICATION_WINDOW_MS = 10_000;

export function setSchedulerConflictNotifier(
    notifier: ((message: string) => void) | undefined,
): void {
    schedulerConflictNotifier = notifier;
}

function emitSchedulerConflictNotification(message: string): void {
    if (!schedulerConflictNotifier) {
        return;
    }

    const now = Date.now();
    if (
        lastConflictNotificationMessage === message
        && now - lastConflictNotificationAt < CONFLICT_NOTIFICATION_WINDOW_MS
    ) {
        return;
    }

    lastConflictNotificationAt = now;
    lastConflictNotificationMessage = message;

    try {
        schedulerConflictNotifier(message);
    } catch {
        // best effort only
    }
}

function normalizeIdList(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
}

function getStoredSchedulerRecord(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    return value as Record<string, unknown>;
}

function normalizeStoredCockpitBoard(value: unknown): SchedulerWorkspaceConfig["cockpitBoard"] {
    const board = getStoredSchedulerRecord(value);
    if (!board) {
        return undefined;
    }

    try {
        return normalizeCockpitBoard(board);
    } catch {
        return undefined;
    }
}

function normalizeStoredTelegramNotification(
    value: unknown,
): SchedulerWorkspaceConfig["telegramNotification"] {
    const telegramNotification = getStoredSchedulerRecord(value);
    if (!telegramNotification || typeof telegramNotification.enabled !== "boolean") {
        return undefined;
    }

    const updatedAt = typeof telegramNotification.updatedAt === "string"
        && telegramNotification.updatedAt.trim().length > 0
        ? telegramNotification.updatedAt
        : "1970-01-01T00:00:00.000Z";

    const normalized: NonNullable<SchedulerWorkspaceConfig["telegramNotification"]> = {
        enabled: telegramNotification.enabled,
        updatedAt,
    };

    if (typeof telegramNotification.botToken === "string") {
        normalized.botToken = telegramNotification.botToken;
    }

    if (typeof telegramNotification.chatId === "string") {
        normalized.chatId = telegramNotification.chatId;
    }

    if (typeof telegramNotification.messagePrefix === "string") {
        normalized.messagePrefix = telegramNotification.messagePrefix;
    }

    return normalized;
}

function normalizeStoredGitHubIntegration(
    value: unknown,
): SchedulerWorkspaceConfig["githubIntegration"] {
    const githubIntegration = getStoredSchedulerRecord(value);
    if (!githubIntegration || typeof githubIntegration.enabled !== "boolean") {
        return undefined;
    }

    const updatedAt = typeof githubIntegration.updatedAt === "string"
        && githubIntegration.updatedAt.trim().length > 0
        ? githubIntegration.updatedAt
        : "1970-01-01T00:00:00.000Z";
    const syncStatus = typeof githubIntegration.syncStatus === "string"
        && GITHUB_SYNC_STATUSES.has(githubIntegration.syncStatus)
        ? githubIntegration.syncStatus as NonNullable<SchedulerWorkspaceConfig["githubIntegration"]>["syncStatus"]
        : githubIntegration.enabled
            ? "partial"
            : "disabled";

    const normalized: NonNullable<SchedulerWorkspaceConfig["githubIntegration"]> = {
        enabled: githubIntegration.enabled,
        syncStatus,
        updatedAt,
    };

    if (typeof githubIntegration.owner === "string") {
        normalized.owner = githubIntegration.owner;
    }

    if (typeof githubIntegration.repo === "string") {
        normalized.repo = githubIntegration.repo;
    }

    if (typeof githubIntegration.apiBaseUrl === "string") {
        normalized.apiBaseUrl = githubIntegration.apiBaseUrl;
    }

    if (typeof githubIntegration.token === "string") {
        normalized.token = githubIntegration.token;
    }

    if (typeof githubIntegration.automationPromptTemplate === "string") {
        normalized.automationPromptTemplate = githubIntegration.automationPromptTemplate;
    }

    if (typeof githubIntegration.statusMessage === "string") {
        normalized.statusMessage = githubIntegration.statusMessage;
    }

    if (typeof githubIntegration.lastSyncAt === "string"
        && githubIntegration.lastSyncAt.trim().length > 0) {
        normalized.lastSyncAt = githubIntegration.lastSyncAt;
    }

    const inbox = normalizeStoredGitHubInbox(githubIntegration.inbox);
    if (inbox) {
        normalized.inbox = inbox;
    }

    return normalized;
}

function normalizeStoredGitHubInboxItem(
    value: unknown,
): GitHubInboxItem | undefined {
    const item = getStoredSchedulerRecord(value);
    if (!item || typeof item.id !== "string" || typeof item.title !== "string" || typeof item.url !== "string") {
        return undefined;
    }

    if (typeof item.lane !== "string" || !GITHUB_INBOX_LANES.includes(item.lane as typeof GITHUB_INBOX_LANES[number])) {
        return undefined;
    }

    if (typeof item.kind !== "string" || !GITHUB_INBOX_ITEM_KINDS.has(item.kind)) {
        return undefined;
    }

    const lane = item.lane as GitHubInboxItem["lane"];
    const kind = item.kind as GitHubInboxItem["kind"];

    const normalized: GitHubInboxItem = {
        id: item.id,
        lane,
        kind,
        title: item.title,
        url: item.url,
    };

    if (typeof item.subtype === "string" && GITHUB_SECURITY_ALERT_SUBTYPES.has(item.subtype)) {
        normalized.subtype = item.subtype as NonNullable<GitHubInboxItem["subtype"]>;
    }

    if (typeof item.number === "number" && Number.isFinite(item.number)) {
        normalized.number = item.number;
    }

    if (typeof item.summary === "string") {
        normalized.summary = item.summary;
    }

    if (typeof item.state === "string") {
        normalized.state = item.state;
    }

    if (typeof item.severity === "string") {
        normalized.severity = item.severity;
    }

    if (typeof item.updatedAt === "string" && item.updatedAt.trim().length > 0) {
        normalized.updatedAt = item.updatedAt;
    }

    if (typeof item.baseRef === "string") {
        normalized.baseRef = item.baseRef;
    }

    if (typeof item.headRef === "string") {
        normalized.headRef = item.headRef;
    }

    return normalized;
}

function normalizeStoredGitHubInboxLane(
    value: unknown,
): GitHubInboxLane | undefined {
    const lane = getStoredSchedulerRecord(value);
    if (!lane) {
        return undefined;
    }

    const items = Array.isArray(lane.items)
        ? lane.items
            .map((entry) => normalizeStoredGitHubInboxItem(entry))
            .filter((entry): entry is GitHubInboxItem => !!entry)
        : [];

    const normalized: GitHubInboxLane = {
        items,
        itemCount: typeof lane.itemCount === "number" && Number.isFinite(lane.itemCount)
            ? Math.max(0, lane.itemCount)
            : items.length,
    };

    if (typeof lane.syncedAt === "string" && lane.syncedAt.trim().length > 0) {
        normalized.syncedAt = lane.syncedAt;
    }

    if (typeof lane.error === "string" && lane.error.trim().length > 0) {
        normalized.error = lane.error;
    }

    if (lane.rateLimited === true) {
        normalized.rateLimited = true;
    }

    return normalized;
}

function normalizeStoredGitHubInbox(
    value: unknown,
): GitHubInboxSnapshot | undefined {
    const inbox = getStoredSchedulerRecord(value);
    if (!inbox) {
        return undefined;
    }

    const issues = normalizeStoredGitHubInboxLane(inbox.issues);
    const pullRequests = normalizeStoredGitHubInboxLane(inbox.pullRequests);
    const securityAlerts = normalizeStoredGitHubInboxLane(inbox.securityAlerts);
    if (!issues && !pullRequests && !securityAlerts) {
        return undefined;
    }

    return {
        issues: issues ?? { items: [], itemCount: 0 },
        pullRequests: pullRequests ?? { items: [], itemCount: 0 },
        securityAlerts: securityAlerts ?? { items: [], itemCount: 0 },
    };
}

function sanitizeGitHubIntegrationConfig(
    value: SchedulerWorkspaceConfig["githubIntegration"],
): SchedulerWorkspaceConfig["githubIntegration"] {
    if (!value || typeof value !== "object") {
        return undefined;
    }

    const sanitized = sanitizeSchedulerJsonValue({ ...value });
    if (typeof sanitized.token === "string" && sanitized.token.trim().length > 0) {
        sanitized.token = REDACTED_GITHUB_TOKEN;
    }

    return sanitized;
}

function stableSerialize(value: unknown): string {
    return JSON.stringify(value ?? null);
}

function isSameValue(left: unknown, right: unknown): boolean {
    return stableSerialize(left) === stableSerialize(right);
}

function toTimestampMs(value: unknown): number {
    if (value instanceof Date) {
        const timestamp = value.getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    if (typeof value === "string" && value.trim()) {
        const timestamp = Date.parse(value);
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    return 0;
}

function getRecordTimestampMs(value: unknown): number {
    if (!value || typeof value !== "object") {
        return 0;
    }

    const record = value as Record<string, unknown>;
    for (const key of ["updatedAt", "archivedAt", "completedAt", "rejectedAt", "approvedAt", "createdAt"]) {
        const timestamp = toTimestampMs(record[key]);
        if (timestamp > 0) {
            return timestamp;
        }
    }

    return 0;
}

function resolveThreeWayValue<T>(
    baseValue: T | undefined,
    currentValue: T | undefined,
    nextValue: T | undefined,
    getTimestampMs?: (value: T) => number,
): T | undefined {
    if (isSameValue(currentValue, nextValue)) {
        return nextValue;
    }

    if (isSameValue(nextValue, baseValue)) {
        return currentValue;
    }

    if (isSameValue(currentValue, baseValue)) {
        return nextValue;
    }

    if (typeof nextValue === "undefined") {
        return currentValue;
    }

    if (typeof currentValue === "undefined") {
        return nextValue;
    }

    if (!getTimestampMs) {
        return nextValue;
    }

    const currentTimestamp = getTimestampMs(currentValue);
    const nextTimestamp = getTimestampMs(nextValue);
    return currentTimestamp > nextTimestamp ? currentValue : nextValue;
}

function mergeKeyedRecords<T>(
    baseRecords: T[] | undefined,
    currentRecords: T[] | undefined,
    nextRecords: T[] | undefined,
    getKey: (value: T) => string,
    getTimestampMs: (value: T) => number,
): T[] {
    const baseList = Array.isArray(baseRecords) ? baseRecords : [];
    const currentList = Array.isArray(currentRecords) ? currentRecords : [];
    const nextList = Array.isArray(nextRecords) ? nextRecords : [];
    const orderedKeys: string[] = [];
    const seenKeys = new Set<string>();

    for (const source of [currentList, nextList, baseList]) {
        for (const entry of source) {
            const key = getKey(entry);
            if (!key || seenKeys.has(key)) {
                continue;
            }
            seenKeys.add(key);
            orderedKeys.push(key);
        }
    }

    const baseByKey = new Map(baseList.map((entry) => [getKey(entry), entry]));
    const currentByKey = new Map(currentList.map((entry) => [getKey(entry), entry]));
    const nextByKey = new Map(nextList.map((entry) => [getKey(entry), entry]));

    const merged: T[] = [];
    for (const key of orderedKeys) {
        const resolved = resolveThreeWayValue(
            baseByKey.get(key),
            currentByKey.get(key),
            nextByKey.get(key),
            getTimestampMs,
        );
        if (typeof resolved !== "undefined") {
            merged.push(resolved);
        }
    }

    return merged;
}

function mergeCatalogKeyLists(
    baseKeys: string[] | undefined,
    currentKeys: string[] | undefined,
    nextKeys: string[] | undefined,
): string[] {
    const baseList = Array.isArray(baseKeys) ? baseKeys : [];
    const currentList = Array.isArray(currentKeys) ? currentKeys : [];
    const nextList = Array.isArray(nextKeys) ? nextKeys : [];

    if (isSameValue(currentList, nextList)) {
        return nextList;
    }
    if (isSameValue(nextList, baseList)) {
        return currentList;
    }
    if (isSameValue(currentList, baseList)) {
        return nextList;
    }

    const merged: string[] = [];
    const seen = new Set<string>();
    for (const source of [currentList, nextList]) {
        for (const key of source) {
            if (typeof key !== "string" || !key.trim() || seen.has(key)) {
                continue;
            }
            seen.add(key);
            merged.push(key);
        }
    }
    return merged;
}

function filterTombstonedRecords<T>(
    records: T[],
    deletedIds: string[],
    getKey: (value: T) => string,
    recordType?: string,
): T[] {
    if (deletedIds.length === 0) {
        return records;
    }

    const deletedIdSet = new Set(deletedIds);
    const suppressedIds = records
        .map((record) => getKey(record))
        .filter((id) => deletedIdSet.has(id));

    if (suppressedIds.length > 0) {
        logSchedulerSanitizerInfo(
            "[CopilotScheduler] Suppressed tombstoned records during merge",
            {
                recordType: recordType ?? "record",
                suppressedIds,
            },
        );
    }

    return records.filter((record) => !deletedIdSet.has(getKey(record)));
}

function mergeDeletedIds(
    baseIds: string[] | undefined,
    currentIds: string[] | undefined,
    nextIds: string[] | undefined,
): string[] {
    return mergeCatalogKeyLists(
        normalizeIdList(baseIds),
        normalizeIdList(currentIds),
        normalizeIdList(nextIds),
    );
}

const TASK_FIELD_KEYS = [
    "id",
    "name",
    "cron",
    "prompt",
    "enabled",
    "description",
    "agent",
    "model",
    "manualSession",
    "chatSession",
    "promptSource",
    "promptPath",
    "promptBackupPath",
    "promptBackupUpdatedAt",
    "jitterSeconds",
    "oneTime",
    "labels",
    "jobId",
    "jobNodeId",
    "workspacePath",
    "scope",
    "lastRun",
    "lastError",
    "lastErrorAt",
    "nextRun",
    "createdAt",
    "updatedAt",
] as const;

const JOB_FIELD_KEYS = [
    "id",
    "name",
    "cronExpression",
    "folderId",
    "paused",
    "archived",
    "archivedAt",
    "nodes",
    "runtime",
    "createdAt",
    "updatedAt",
] as const;

const JOB_FOLDER_FIELD_KEYS = [
    "id",
    "name",
    "parentId",
    "createdAt",
    "updatedAt",
] as const;

function mergeFieldwiseRecord(
    baseRecord: Record<string, unknown> | undefined,
    currentRecord: Record<string, unknown> | undefined,
    nextRecord: Record<string, unknown> | undefined,
    fieldKeys: readonly string[],
    recordType: string,
): Record<string, unknown> | undefined {
    const recordId = String(
        nextRecord?.id
        ?? currentRecord?.id
        ?? baseRecord?.id
        ?? "",
    );
    if (!recordId) {
        return undefined;
    }

    if (!baseRecord) {
        return nextRecord ?? currentRecord;
    }
    if (!currentRecord) {
        return nextRecord;
    }
    if (!nextRecord) {
        return currentRecord;
    }

    const recordTimestamp = (value: Record<string, unknown>) => getRecordTimestampMs(value);
    const merged: Record<string, unknown> = { id: recordId };
    const conflictedFields: string[] = [];

    for (const key of fieldKeys) {
        if (key === "id") {
            continue;
        }

        const baseValue = baseRecord[key];
        const currentValue = currentRecord[key];
        const nextValue = nextRecord[key];
        const isConflict = !isSameValue(currentValue, nextValue)
            && !isSameValue(currentValue, baseValue)
            && !isSameValue(nextValue, baseValue);
        if (isConflict) {
            conflictedFields.push(key);
        }

        const resolved = resolveThreeWayValue(
            baseValue,
            currentValue,
            nextValue,
            () => Math.max(recordTimestamp(currentRecord), recordTimestamp(nextRecord)),
        );

        if (typeof resolved !== "undefined") {
            merged[key] = resolved;
        }
    }

    if (typeof merged.createdAt === "undefined") {
        merged.createdAt = baseRecord.createdAt ?? currentRecord.createdAt ?? nextRecord.createdAt;
    }
    if (typeof merged.updatedAt === "undefined") {
        merged.updatedAt = currentRecord.updatedAt ?? nextRecord.updatedAt ?? baseRecord.updatedAt;
    }

    if (conflictedFields.length > 0) {
        logSchedulerSanitizerInfo(
            `[CopilotScheduler] Resolved concurrent ${recordType} field conflict`,
            {
                recordType,
                recordId,
                conflictedFields,
                currentUpdatedAt: currentRecord.updatedAt,
                nextUpdatedAt: nextRecord.updatedAt,
            },
        );
        emitSchedulerConflictNotification(
            `Copilot Cockpit merged concurrent ${recordType} edits. Review the latest saved values if needed.`,
        );
    }

    return merged;
}

function mergeTaskRecord(
    baseTask: Record<string, unknown> | undefined,
    currentTask: Record<string, unknown> | undefined,
    nextTask: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    return mergeFieldwiseRecord(
        baseTask,
        currentTask,
        nextTask,
        TASK_FIELD_KEYS,
        "task",
    );
}

function mergeFieldwiseRecords(
    baseRecords: Record<string, unknown>[] | undefined,
    currentRecords: Record<string, unknown>[] | undefined,
    nextRecords: Record<string, unknown>[] | undefined,
    fieldKeys: readonly string[],
    recordType: string,
): Record<string, unknown>[] {
    const baseList = Array.isArray(baseRecords) ? baseRecords : [];
    const currentList = Array.isArray(currentRecords) ? currentRecords : [];
    const nextList = Array.isArray(nextRecords) ? nextRecords : [];
    const orderedKeys: string[] = [];
    const seenKeys = new Set<string>();

    for (const source of [currentList, nextList, baseList]) {
        for (const entry of source) {
            const key = String(entry?.id ?? "");
            if (!key || seenKeys.has(key)) {
                continue;
            }
            seenKeys.add(key);
            orderedKeys.push(key);
        }
    }

    const baseByKey = new Map(baseList.map((entry) => [String(entry.id ?? ""), entry]));
    const currentByKey = new Map(currentList.map((entry) => [String(entry.id ?? ""), entry]));
    const nextByKey = new Map(nextList.map((entry) => [String(entry.id ?? ""), entry]));

    const merged: Record<string, unknown>[] = [];
    for (const key of orderedKeys) {
        const resolved = mergeFieldwiseRecord(
            baseByKey.get(key),
            currentByKey.get(key),
            nextByKey.get(key),
            fieldKeys,
            recordType,
        );
        if (resolved) {
            merged.push(resolved);
        }
    }

    return merged;
}

function mergeTaskRecords(
    baseRecords: Record<string, unknown>[] | undefined,
    currentRecords: Record<string, unknown>[] | undefined,
    nextRecords: Record<string, unknown>[] | undefined,
): Record<string, unknown>[] {
    const baseList = Array.isArray(baseRecords) ? baseRecords : [];
    const currentList = Array.isArray(currentRecords) ? currentRecords : [];
    const nextList = Array.isArray(nextRecords) ? nextRecords : [];
    const orderedKeys: string[] = [];
    const seenKeys = new Set<string>();

    for (const source of [currentList, nextList, baseList]) {
        for (const entry of source) {
            const key = String(entry?.id ?? "");
            if (!key || seenKeys.has(key)) {
                continue;
            }
            seenKeys.add(key);
            orderedKeys.push(key);
        }
    }

    const baseByKey = new Map(baseList.map((entry) => [String(entry.id ?? ""), entry]));
    const currentByKey = new Map(currentList.map((entry) => [String(entry.id ?? ""), entry]));
    const nextByKey = new Map(nextList.map((entry) => [String(entry.id ?? ""), entry]));

    const merged: Record<string, unknown>[] = [];
    for (const key of orderedKeys) {
        const resolved = mergeTaskRecord(
            baseByKey.get(key),
            currentByKey.get(key),
            nextByKey.get(key),
        );
        if (resolved) {
            merged.push(resolved);
        }
    }

    return merged;
}

function writeFileAtomic(filePath: string, content: string): void {
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
        schedulerFs.writeFileSync(tempPath, content, "utf8");
        try {
            schedulerFs.renameSync(tempPath, filePath);
            return;
        } catch (error) {
            let commitError: unknown = error;

            if (process.platform === "win32"
                && isWindowsAtomicRenameFallbackError(error)) {
                try {
                    schedulerFs.copyFileSync(tempPath, filePath);
                    schedulerFs.unlinkSync(tempPath);
                    return;
                } catch (fallbackError) {
                    commitError = fallbackError;
                }
            }

            throw commitError;
        }
    } catch (error) {
        try {
            if (schedulerFs.existsSync(tempPath)) {
                schedulerFs.unlinkSync(tempPath);
            }
        } catch {
            // ignore cleanup failure
        }
        throw error;
    }
}

function isWindowsAtomicRenameFallbackError(error: unknown): boolean {
    const code = typeof error === "object" && error !== null && "code" in error
        ? String((error as NodeJS.ErrnoException).code ?? "")
        : "";

    return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function mergeCockpitFilters(
    baseFilters: CockpitBoardFilters | undefined,
    currentFilters: CockpitBoardFilters | undefined,
    nextFilters: CockpitBoardFilters | undefined,
): Record<string, unknown> | undefined {
    const base = baseFilters ?? undefined;
    const current = currentFilters ?? undefined;
    const next = nextFilters ?? undefined;

    if (!base && !current && !next) {
        return undefined;
    }

    const keys = new Set<string>([
        ...Object.keys(base ?? {}),
        ...Object.keys(current ?? {}),
        ...Object.keys(next ?? {}),
    ]);
    const merged: Record<string, unknown> = {};
    for (const key of keys) {
        const resolved = resolveThreeWayValue(
            base?.[key as keyof typeof base],
            current?.[key as keyof typeof current],
            next?.[key as keyof typeof next],
        );
        if (typeof resolved !== "undefined") {
            merged[key] = resolved;
        }
    }

    return merged;
}

function mergeCockpitBoard(
    baseBoard: SchedulerWorkspaceConfig["cockpitBoard"],
    currentBoard: SchedulerWorkspaceConfig["cockpitBoard"],
    nextBoard: SchedulerWorkspaceConfig["cockpitBoard"],
): SchedulerWorkspaceConfig["cockpitBoard"] {
    if (!baseBoard && !currentBoard && !nextBoard) {
        return undefined;
    }

    const base = baseBoard ? normalizeCockpitBoard(baseBoard) : undefined;
    const current = currentBoard ? normalizeCockpitBoard(currentBoard) : undefined;
    const next = nextBoard ? normalizeCockpitBoard(nextBoard) : undefined;
    const deletedCardIds = mergeDeletedIds(
        base?.deletedCardIds,
        current?.deletedCardIds,
        next?.deletedCardIds,
    );

    const mergedBoard = normalizeCockpitBoard({
        version: Math.max(base?.version ?? 4, current?.version ?? 4, next?.version ?? 4),
        sections: mergeKeyedRecords(
            base?.sections,
            current?.sections,
            next?.sections,
            (section) => section.id,
            (section) => getRecordTimestampMs(section),
        ),
        cards: filterTombstonedRecords(
            mergeKeyedRecords(
                base?.cards,
                current?.cards,
                next?.cards,
                (card) => card.id,
                (card) => getRecordTimestampMs(card),
            ),
            deletedCardIds,
            (card) => card.id,
            "todoCard",
        ),
        labelCatalog: mergeKeyedRecords(
            base?.labelCatalog,
            current?.labelCatalog,
            next?.labelCatalog,
            (label) => label.key,
            (label) => getRecordTimestampMs(label),
        ),
        deletedLabelCatalogKeys: mergeCatalogKeyLists(
            base?.deletedLabelCatalogKeys,
            current?.deletedLabelCatalogKeys,
            next?.deletedLabelCatalogKeys,
        ),
        flagCatalog: mergeKeyedRecords(
            base?.flagCatalog,
            current?.flagCatalog,
            next?.flagCatalog,
            (label) => label.key,
            (label) => getRecordTimestampMs(label),
        ),
        deletedFlagCatalogKeys: mergeCatalogKeyLists(
            base?.deletedFlagCatalogKeys,
            current?.deletedFlagCatalogKeys,
            next?.deletedFlagCatalogKeys,
        ),
        deletedCardIds,
        filters: mergeCockpitFilters(base?.filters, current?.filters, next?.filters),
        updatedAt: resolveThreeWayValue(
            base?.updatedAt,
            current?.updatedAt,
            next?.updatedAt,
            (value) => toTimestampMs(value),
        ),
    });

    return mergedBoard;
}

function mergeSchedulerConfig(
    baseConfig: SchedulerWorkspaceConfig | undefined,
    currentConfig: SchedulerWorkspaceConfig,
    nextConfig: SchedulerWorkspaceConfig,
): SchedulerWorkspaceConfig {
    const base = baseConfig ?? { tasks: [] };
    const deletedTaskIds = mergeDeletedIds(
        base.deletedTaskIds,
        currentConfig.deletedTaskIds,
        nextConfig.deletedTaskIds,
    );
    const deletedJobIds = mergeDeletedIds(
        base.deletedJobIds,
        currentConfig.deletedJobIds,
        nextConfig.deletedJobIds,
    );
    const deletedJobFolderIds = mergeDeletedIds(
        base.deletedJobFolderIds,
        currentConfig.deletedJobFolderIds,
        nextConfig.deletedJobFolderIds,
    );

    return {
        tasks: filterTombstonedRecords(
            mergeTaskRecords(
                base.tasks as Record<string, unknown>[] | undefined,
                currentConfig.tasks as Record<string, unknown>[] | undefined,
                nextConfig.tasks as Record<string, unknown>[] | undefined,
            ),
            deletedTaskIds,
            (task) => String((task as { id?: unknown }).id ?? ""),
            "task",
        ),
        deletedTaskIds,
        jobs: filterTombstonedRecords(
            mergeFieldwiseRecords(
                base.jobs as Record<string, unknown>[] | undefined,
                currentConfig.jobs as Record<string, unknown>[] | undefined,
                nextConfig.jobs as Record<string, unknown>[] | undefined,
                JOB_FIELD_KEYS,
                "job",
            ) as any[],
            deletedJobIds,
            (job) => String(job.id ?? ""),
            "job",
        ),
        deletedJobIds,
        jobFolders: filterTombstonedRecords(
            mergeFieldwiseRecords(
                base.jobFolders as Record<string, unknown>[] | undefined,
                currentConfig.jobFolders as Record<string, unknown>[] | undefined,
                nextConfig.jobFolders as Record<string, unknown>[] | undefined,
                JOB_FOLDER_FIELD_KEYS,
                "job folder",
            ) as any[],
            deletedJobFolderIds,
            (folder) => String(folder.id ?? ""),
            "jobFolder",
        ),
        deletedJobFolderIds,
        cockpitBoard: mergeCockpitBoard(
            base.cockpitBoard,
            currentConfig.cockpitBoard,
            nextConfig.cockpitBoard,
        ),
        githubIntegration: resolveThreeWayValue(
            base.githubIntegration,
            currentConfig.githubIntegration,
            nextConfig.githubIntegration,
            (value) => getRecordTimestampMs(value),
        ),
        telegramNotification: resolveThreeWayValue(
            base.telegramNotification,
            currentConfig.telegramNotification,
            nextConfig.telegramNotification,
            (value) => getRecordTimestampMs(value),
        ),
    };
}

export function redactDiscordWebhookUrls(value: string): string {
    return value.replace(
        DISCORD_WEBHOOK_URL_PATTERN,
        REDACTED_DISCORD_WEBHOOK_URL,
    );
}

export function redactTelegramBotSecrets(value: string): string {
    return value
        .replace(TELEGRAM_BOT_URL_PATTERN, REDACTED_TELEGRAM_BOT_URL)
        .replace(TELEGRAM_BOT_TOKEN_PATTERN, REDACTED_TELEGRAM_BOT_TOKEN);
}

export function sanitizeSchedulerJsonValue<T>(value: T): T {
    if (typeof value === "string") {
        return redactTelegramBotSecrets(redactDiscordWebhookUrls(value)) as T;
    }

    if (Array.isArray(value)) {
        return value.map((item) => sanitizeSchedulerJsonValue(item)) as T;
    }

    if (value && typeof value === "object") {
        if (value instanceof Date) {
            return value;
        }

        return Object.fromEntries(
            Object.entries(value).map(([key, entryValue]) => [
                key,
                sanitizeSchedulerJsonValue(entryValue),
            ]),
        ) as T;
    }

    return value;
}

export function getPrivateSchedulerConfigPath(configPath: string): string {
    const parsed = path.parse(configPath);
    return path.join(parsed.dir, `${parsed.name}.private${parsed.ext}`);
}

export function findWorkspaceRoot(startPath: string): string {
    return path.resolve(startPath);
}

export function getResolvedWorkspaceRoots(startPaths: string[]): string[] {
    const seen = new Set<string>();
    const roots: string[] = [];

    for (const startPath of startPaths) {
        if (!startPath) {
            continue;
        }

        const resolvedRoot = findWorkspaceRoot(startPath);
        const dedupeKey = process.platform === "win32"
            ? resolvedRoot.toLowerCase()
            : resolvedRoot;

        if (seen.has(dedupeKey)) {
            continue;
        }

        seen.add(dedupeKey);
        roots.push(resolvedRoot);
    }

    return roots;
}

function parseStoredSchedulerConfig(value: unknown, privateValue?: unknown): SchedulerWorkspaceConfig {
    const parsed = safeParseStoredSchedulerConfigInput(value);
    const privateParsed = safeParseStoredSchedulerConfigInput(privateValue);
    const resolvedConfig = parsed ?? privateParsed;
    const cockpitBoard = normalizeStoredCockpitBoard(
        privateParsed?.cockpitBoard ?? parsed?.cockpitBoard,
    );
    const githubIntegration = normalizeStoredGitHubIntegration(
        privateParsed?.githubIntegration ?? parsed?.githubIntegration,
    );
    const telegramNotification = normalizeStoredTelegramNotification(
        privateParsed?.telegramNotification ?? parsed?.telegramNotification,
    );

    if (!resolvedConfig) {
        return { tasks: [] };
    }

    if (resolvedConfig.kind === "array") {
        return {
            tasks: resolvedConfig.tasks,
            cockpitBoard,
            githubIntegration,
            telegramNotification,
        };
    }

    return {
        ...resolvedConfig.rootObject,
        tasks: resolvedConfig.tasks,
        deletedTaskIds: resolvedConfig.deletedTaskIds,
        jobs: resolvedConfig.jobs as SchedulerWorkspaceConfig["jobs"],
        deletedJobIds: resolvedConfig.deletedJobIds,
        jobFolders: resolvedConfig.jobFolders as SchedulerWorkspaceConfig["jobFolders"],
        deletedJobFolderIds: resolvedConfig.deletedJobFolderIds,
        cockpitBoard,
        githubIntegration,
        telegramNotification,
    };
}

function tryReadStoredSchedulerConfig(filePath: string) {
    try {
        const data = JSON.parse(schedulerFs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
        return safeParseStoredSchedulerConfigInput(data);
    } catch {
        return undefined;
    }
}

function readSchedulerTransaction(workspaceRoot: string): SchedulerTransactionRecord | undefined {
    const transactionPath = getSchedulerTransactionPath(workspaceRoot);
    if (!schedulerFs.existsSync(transactionPath)) {
        return undefined;
    }

    try {
        const parsed = readJsonFile(transactionPath) as Partial<SchedulerTransactionRecord>;
        if (parsed?.version !== 1) {
            return undefined;
        }
        return parsed as SchedulerTransactionRecord;
    } catch {
        return undefined;
    }
}

function tryReadSchedulerTransactionSnapshot(workspaceRoot: string): SchedulerWorkspaceConfig | undefined {
    const transaction = readSchedulerTransaction(workspaceRoot);
    if (!transaction || !schedulerFs.existsSync(getSchedulerLockPath(workspaceRoot))) {
        return undefined;
    }

    try {
        const publicParsed = transaction.publicChanged && typeof transaction.publicContent === "string"
            ? JSON.parse(transaction.publicContent)
            : schedulerFs.existsSync(transaction.publicPath)
                ? readJsonFile(transaction.publicPath)
                : { tasks: [] };
        const privateParsed = transaction.privateChanged && typeof transaction.privateContent === "string"
            ? JSON.parse(transaction.privateContent)
            : schedulerFs.existsSync(transaction.privatePath)
                ? readJsonFile(transaction.privatePath)
                : publicParsed;
        return parseStoredSchedulerConfig(publicParsed, privateParsed);
    } catch {
        return undefined;
    }
}

function recoverPendingSchedulerTransaction(workspaceRoot: string, throwOnFailure: boolean): void {
    const transaction = readSchedulerTransaction(workspaceRoot);
    if (!transaction) {
        return;
    }

    if (schedulerFs.existsSync(getSchedulerLockPath(workspaceRoot))) {
        return;
    }

    try {
        if (transaction.publicChanged && typeof transaction.publicContent === "string") {
            writeFileAtomic(transaction.publicPath, transaction.publicContent);
        }
        if (transaction.privateChanged && typeof transaction.privateContent === "string") {
            writeFileAtomic(transaction.privatePath, transaction.privateContent);
        }
        schedulerFs.unlinkSync(getSchedulerTransactionPath(workspaceRoot));
        logSchedulerSanitizerInfo("[CopilotScheduler] Recovered pending scheduler config transaction", {
            workspaceRoot,
        });
    } catch (error) {
        logSchedulerSanitizerInfo("[CopilotScheduler] Failed to recover pending scheduler config transaction", {
            workspaceRoot,
            error: error instanceof Error ? error.message : String(error ?? ""),
        });
        if (throwOnFailure) {
            throw error;
        }
    }
}

function acquireSchedulerWriteLock(workspaceRoot: string): () => void {
    const lockPath = getSchedulerLockPath(workspaceRoot);
    const deadline = Date.now() + schedulerLockOptions.maxWaitMs;

    while (true) {
        try {
            schedulerFs.mkdirSync(lockPath);
            schedulerFs.writeFileSync(
                path.join(lockPath, "owner.json"),
                JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }, null, 2),
                "utf8",
            );
            return () => {
                try {
                    schedulerFs.rmSync(lockPath, { recursive: true, force: true });
                } catch {
                    // best effort only
                }
            };
        } catch (error) {
            const code = (error as NodeJS.ErrnoException | undefined)?.code;
            if (code !== "EEXIST") {
                throw error;
            }

            let stale = false;
            try {
                const stat = schedulerFs.statSync(lockPath);
                stale = Date.now() - stat.mtimeMs > schedulerLockOptions.staleMs;
            } catch {
                stale = true;
            }

            if (stale) {
                try {
                    schedulerFs.rmSync(lockPath, { recursive: true, force: true });
                    continue;
                } catch {
                    // another writer may still own it
                }
            }

            if (Date.now() >= deadline) {
                throw new Error("Scheduler config is locked by another writer.");
            }

            sleepSync(schedulerLockOptions.retryMs);
        }
    }
}

export function getActiveSchedulerReadPath(workspaceRoot: string): string {
    recoverPendingSchedulerTransaction(workspaceRoot, false);
    const {
        publicSchedulerMirrorPath: configPath,
        privateSchedulerMirrorPath: privateConfigPath,
    } = getWorkspaceSchedulerMirrorPaths(workspaceRoot);
    let readPath = configPath;

    const configExists = schedulerFs.existsSync(configPath);
    const privateExists = schedulerFs.existsSync(privateConfigPath);

    if (configExists && privateExists) {
        const configValid = tryReadStoredSchedulerConfig(configPath);
        const privateValid = tryReadStoredSchedulerConfig(privateConfigPath);

        const configStat = schedulerFs.statSync(configPath);
        const privateStat = schedulerFs.statSync(privateConfigPath);

        if (configValid && privateValid) {
            if (configValid.carriesSchedulerState && privateValid.carriesSchedulerState) {
                readPath = privateStat.mtimeMs > configStat.mtimeMs ? privateConfigPath : configPath;
            } else if (configValid.carriesSchedulerState) {
                readPath = configPath;
            } else if (privateValid.carriesSchedulerState) {
                readPath = privateConfigPath;
            } else {
                readPath = privateStat.mtimeMs > configStat.mtimeMs ? privateConfigPath : configPath;
            }
        } else if (configValid && !privateValid) {
            readPath = configPath;
        } else if (!configValid && privateValid) {
            readPath = privateConfigPath;
        }
    } else if (privateExists) {
        readPath = privateConfigPath;
    }

    return readPath;
}

export function readSchedulerConfig(workspaceRoot: string): SchedulerWorkspaceConfig {
    const transactionSnapshot = tryReadSchedulerTransactionSnapshot(workspaceRoot);
    if (transactionSnapshot) {
        return transactionSnapshot;
    }

    const readPath = getActiveSchedulerReadPath(workspaceRoot);
    const { privateSchedulerMirrorPath: privateConfigPath } = getWorkspaceSchedulerMirrorPaths(workspaceRoot);
    if (!schedulerFs.existsSync(readPath)) {
        return { tasks: [] };
    }
    try {
        let content = schedulerFs.readFileSync(readPath, "utf-8");
        content = content.replace(/^\uFEFF/, "");
        const parsed = JSON.parse(content);
        let privateParsed = readPath === privateConfigPath ? parsed : undefined;
        if (typeof privateParsed === "undefined" && schedulerFs.existsSync(privateConfigPath)) {
            try {
                privateParsed = JSON.parse(
                    schedulerFs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, ""),
                );
            } catch {
                privateParsed = undefined;
            }
        }
        return parseStoredSchedulerConfig(parsed, privateParsed);
    } catch (e) {
        console.error(`[SchedulerStore] Failed to read config from ${readPath}: ${e}`);
        return { tasks: [] };
    }
}

export function writeSchedulerConfig(
    workspaceRoot: string,
    config: SchedulerWorkspaceConfig,
    options?: SchedulerConfigWriteOptions,
): SchedulerConfigWriteResult {
    const {
        publicSchedulerMirrorPath: configPath,
        privateSchedulerMirrorPath: privateConfigPath,
    } = getWorkspaceSchedulerMirrorPaths(workspaceRoot);
    const transactionPath = getSchedulerTransactionPath(workspaceRoot);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);
    const releaseLock = acquireSchedulerWriteLock(workspaceRoot);

    try {
        recoverPendingSchedulerTransaction(workspaceRoot, true);

        if (!config || !Array.isArray(config.tasks)) {
            throw new Error("Invalid config format: 'tasks' array is missing.");
        }

        const normalizedConfig: SchedulerWorkspaceConfig = {
            tasks: filterStoredSchedulerTaskEntries(config.tasks),
            deletedTaskIds: normalizeIdList(config.deletedTaskIds),
            jobs: Array.isArray(config.jobs) ? config.jobs : [],
            deletedJobIds: normalizeIdList(config.deletedJobIds),
            jobFolders: Array.isArray(config.jobFolders) ? config.jobFolders : [],
            deletedJobFolderIds: normalizeIdList(config.deletedJobFolderIds),
            cockpitBoard: config.cockpitBoard
                ? normalizeCockpitBoard(config.cockpitBoard)
                : undefined,
            githubIntegration: config.githubIntegration
                && typeof config.githubIntegration === "object"
                ? { ...config.githubIntegration }
                : undefined,
            telegramNotification: config.telegramNotification
                && typeof config.telegramNotification === "object"
                ? { ...config.telegramNotification }
                : undefined,
        };

        const mergedConfig = options?.mode === "replace"
            ? normalizedConfig
            : mergeSchedulerConfig(
                options?.baseConfig,
                readSchedulerConfig(workspaceRoot),
                normalizedConfig,
            );

        const persistedConfig: SchedulerWorkspaceConfig = {
            tasks: filterStoredSchedulerTaskEntries(mergedConfig.tasks),
            deletedTaskIds: normalizeIdList(mergedConfig.deletedTaskIds),
            jobs: Array.isArray(mergedConfig.jobs) ? mergedConfig.jobs : [],
            deletedJobIds: normalizeIdList(mergedConfig.deletedJobIds),
            jobFolders: Array.isArray(mergedConfig.jobFolders) ? mergedConfig.jobFolders : [],
            deletedJobFolderIds: normalizeIdList(mergedConfig.deletedJobFolderIds),
            cockpitBoard: mergedConfig.cockpitBoard
                ? normalizeCockpitBoard(mergedConfig.cockpitBoard)
                : undefined,
            githubIntegration: mergedConfig.githubIntegration
                && typeof mergedConfig.githubIntegration === "object"
                ? { ...mergedConfig.githubIntegration }
                : undefined,
            telegramNotification: mergedConfig.telegramNotification
                && typeof mergedConfig.telegramNotification === "object"
                ? { ...mergedConfig.telegramNotification }
                : undefined,
        };

        const publicConfig: SchedulerWorkspaceConfig = {
            tasks: sanitizeSchedulerJsonValue(persistedConfig.tasks),
            deletedTaskIds: sanitizeSchedulerJsonValue(persistedConfig.deletedTaskIds),
            jobs: sanitizeSchedulerJsonValue(persistedConfig.jobs ?? []),
            deletedJobIds: sanitizeSchedulerJsonValue(persistedConfig.deletedJobIds),
            jobFolders: sanitizeSchedulerJsonValue(persistedConfig.jobFolders ?? []),
            deletedJobFolderIds: sanitizeSchedulerJsonValue(persistedConfig.deletedJobFolderIds),
            githubIntegration: sanitizeGitHubIntegrationConfig(
                persistedConfig.githubIntegration,
            ),
            telegramNotification: sanitizeSchedulerJsonValue(
                persistedConfig.telegramNotification,
            ),
        };

        const nextPublicContent = JSON.stringify(publicConfig, null, 4);
        const nextPrivateContent = JSON.stringify(persistedConfig, null, 4);
        const currentPublicContent = schedulerFs.existsSync(configPath)
            ? schedulerFs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")
            : undefined;
        const currentPrivateContent = schedulerFs.existsSync(privateConfigPath)
            ? schedulerFs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, "")
            : undefined;
        const publicChanged = currentPublicContent !== nextPublicContent;
        const privateChanged = currentPrivateContent !== nextPrivateContent;

        const transactionRecord: SchedulerTransactionRecord = {
            version: 1,
            createdAt: new Date().toISOString(),
            publicPath: configPath,
            privatePath: privateConfigPath,
            publicChanged,
            privateChanged,
            publicContent: publicChanged ? nextPublicContent : undefined,
            privateContent: privateChanged ? nextPrivateContent : undefined,
        };

        if (publicChanged || privateChanged) {
            schedulerFs.writeFileSync(transactionPath, JSON.stringify(transactionRecord, null, 2), "utf8");
        }

        if (publicChanged) {
            writeFileAtomic(configPath, nextPublicContent);
        }
        if (privateChanged) {
            writeFileAtomic(privateConfigPath, nextPrivateContent);
        }
        if ((publicChanged || privateChanged) && schedulerFs.existsSync(transactionPath)) {
            schedulerFs.unlinkSync(transactionPath);
        }

        const writeRecordedAt = Date.now();
        if (publicChanged) {
            recordRecentSchedulerConfigWrite(configPath, writeRecordedAt);
        }
        if (privateChanged) {
            recordRecentSchedulerConfigWrite(privateConfigPath, writeRecordedAt);
        }

        const readBack = readSchedulerConfig(workspaceRoot);
        if (!readBack || !Array.isArray(readBack.tasks) || readBack.tasks.length !== persistedConfig.tasks.length) {
            throw new Error("Persistence verification failed: read-back config length mismatch.");
        }

        const expected = JSON.stringify(sanitizeSchedulerJsonValue(persistedConfig.tasks));
        const actual = JSON.stringify(sanitizeSchedulerJsonValue(readBack.tasks));
        if (expected !== actual) {
            throw new Error("Persistence verification failed: read-back data did not match written data.");
        }

        if (publicChanged || privateChanged) {
            createScheduleHistorySnapshot(workspaceRoot, publicConfig, persistedConfig);
        }

        return {
            publicChanged,
            privateChanged,
            publicPath: configPath,
            privatePath: privateConfigPath,
        };
    } finally {
        releaseLock();
    }
}

function sleepSync(ms: number): void {
    if (ms <= 0) {
        return;
    }

    if (schedulerSleepBuffer && typeof Atomics !== "undefined" && typeof Atomics.wait === "function") {
        Atomics.wait(schedulerSleepBuffer, 0, 0, ms);
        return;
    }

    const endAt = Date.now() + ms;
    while (Date.now() < endAt) {
        // busy wait fallback for runtimes without Atomics.wait
    }
}

function getSchedulerLockPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".vscode", "scheduler-config.lock");
}

function getSchedulerTransactionPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".vscode", "scheduler-config.transaction.json");
}

function readJsonFile(filePath: string): unknown {
    return JSON.parse(schedulerFs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
}