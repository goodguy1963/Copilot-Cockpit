import * as path from "path";
import { normalizeCockpitBoard } from "./cockpitBoard";
import { createScheduleHistorySnapshot } from "./scheduleHistory";
import { ensurePrivateConfigIgnoredForWorkspaceRoot } from "./privateConfigIgnore";
import type { SchedulerWorkspaceConfig } from "./types";

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

const RECENT_SCHEDULER_CONFIG_WRITE_WINDOW_MS = 1500;
const recentSchedulerConfigWrites = new Map<string, number>();

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

import * as fs from "fs";

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

export function getActiveSchedulerReadPath(workspaceRoot: string): string {
    const configPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
    const privateConfigPath = getPrivateSchedulerConfigPath(configPath);
    let readPath = configPath;

    const configExists = fs.existsSync(configPath);
    const privateExists = fs.existsSync(privateConfigPath);

    if (configExists && privateExists) {
        let configValid = false;
        let privateValid = false;
        try {
            const data = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
            configValid = (!!data && Array.isArray(data.tasks)) || Array.isArray(data);
        } catch { /* empty */ }
        try {
            const data = JSON.parse(fs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, ""));
            privateValid = (!!data && Array.isArray(data.tasks)) || Array.isArray(data);
        } catch { /* empty */ }

        const configStat = fs.statSync(configPath);
        const privateStat = fs.statSync(privateConfigPath);

        if (configValid && privateValid) {
            readPath = privateStat.mtimeMs > configStat.mtimeMs ? privateConfigPath : configPath;
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
    const readPath = getActiveSchedulerReadPath(workspaceRoot);
    const privateConfigPath = getPrivateSchedulerConfigPath(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
    );
    if (!fs.existsSync(readPath)) {
        return { tasks: [] };
    }
    try {
        let content = fs.readFileSync(readPath, "utf-8");
        content = content.replace(/^\uFEFF/, "");
        const parsed = JSON.parse(content);
        const privateParsed = fs.existsSync(privateConfigPath)
            ? JSON.parse(fs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, ""))
            : undefined;
        if (Array.isArray(parsed)) {
            return {
                tasks: parsed,
                cockpitBoard: privateParsed?.cockpitBoard
                    ? normalizeCockpitBoard(privateParsed.cockpitBoard)
                    : undefined,
                telegramNotification: privateParsed?.telegramNotification && typeof privateParsed.telegramNotification === "object"
                    ? privateParsed.telegramNotification
                    : undefined,
            };
        }
        if (parsed && Array.isArray(parsed.tasks)) {
            return {
                ...parsed,
                jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
                jobFolders: Array.isArray(parsed.jobFolders) ? parsed.jobFolders : [],
                cockpitBoard: privateParsed?.cockpitBoard
                    ? normalizeCockpitBoard(privateParsed.cockpitBoard)
                    : undefined,
                telegramNotification: parsed.telegramNotification && typeof parsed.telegramNotification === "object"
                    ? privateParsed?.telegramNotification && typeof privateParsed.telegramNotification === "object"
                        ? privateParsed.telegramNotification
                        : parsed.telegramNotification
                    : undefined,
            };
        }
        return { tasks: [] };
    } catch (e) {
        console.error(`[SchedulerStore] Failed to read config from ${readPath}: ${e}`);
        return { tasks: [] };
    }
}

export function writeSchedulerConfig(
    workspaceRoot: string,
    config: SchedulerWorkspaceConfig,
): SchedulerConfigWriteResult {
    const configPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
    const privateConfigPath = getPrivateSchedulerConfigPath(configPath);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    ensurePrivateConfigIgnoredForWorkspaceRoot(workspaceRoot);

    if (!config || !Array.isArray(config.tasks)) {
        throw new Error("Invalid config format: 'tasks' array is missing.");
    }

    const normalizedConfig: SchedulerWorkspaceConfig = {
        tasks: config.tasks,
        jobs: Array.isArray(config.jobs) ? config.jobs : [],
        jobFolders: Array.isArray(config.jobFolders) ? config.jobFolders : [],
        cockpitBoard: config.cockpitBoard
            ? normalizeCockpitBoard(config.cockpitBoard)
            : undefined,
        telegramNotification: config.telegramNotification
            && typeof config.telegramNotification === "object"
            ? { ...config.telegramNotification }
            : undefined,
    };

    const publicConfig: SchedulerWorkspaceConfig = {
        tasks: sanitizeSchedulerJsonValue(normalizedConfig.tasks),
        jobs: sanitizeSchedulerJsonValue(normalizedConfig.jobs ?? []),
        jobFolders: sanitizeSchedulerJsonValue(normalizedConfig.jobFolders ?? []),
        telegramNotification: sanitizeSchedulerJsonValue(
            normalizedConfig.telegramNotification,
        ),
    };

    const nextPublicContent = JSON.stringify(publicConfig, null, 4);
    const nextPrivateContent = JSON.stringify(normalizedConfig, null, 4);
    const currentPublicContent = fs.existsSync(configPath)
        ? fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")
        : undefined;
    const currentPrivateContent = fs.existsSync(privateConfigPath)
        ? fs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, "")
        : undefined;
    const publicChanged = currentPublicContent !== nextPublicContent;
    const privateChanged = currentPrivateContent !== nextPrivateContent;

    if (publicChanged) {
        fs.writeFileSync(configPath, nextPublicContent);
    }
    if (privateChanged) {
        fs.writeFileSync(privateConfigPath, nextPrivateContent);
    }

    const writeRecordedAt = Date.now();
    if (publicChanged) {
        recordRecentSchedulerConfigWrite(configPath, writeRecordedAt);
    }
    if (privateChanged) {
        recordRecentSchedulerConfigWrite(privateConfigPath, writeRecordedAt);
    }

    const readBack = readSchedulerConfig(workspaceRoot);
    if (!readBack || !Array.isArray(readBack.tasks) || readBack.tasks.length !== normalizedConfig.tasks.length) {
        throw new Error("Persistence verification failed: read-back config length mismatch.");
    }

    // Deeper verification: match a serialized fingerprint to ensure data was exactly persisted
    const expected = JSON.stringify(sanitizeSchedulerJsonValue(normalizedConfig.tasks));
    const actual = JSON.stringify(sanitizeSchedulerJsonValue(readBack.tasks));
    if (expected !== actual) {
        throw new Error("Persistence verification failed: read-back data did not match written data.");
    }

    if (publicChanged || privateChanged) {
        createScheduleHistorySnapshot(workspaceRoot, publicConfig, normalizedConfig);
    }

    return {
        publicChanged,
        privateChanged,
        publicPath: configPath,
        privatePath: privateConfigPath,
    };
}