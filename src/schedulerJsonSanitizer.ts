import * as path from "path";

const DISCORD_WEBHOOK_URL_PATTERN =
    /https:\/\/(?:(?:canary|ptb)\.)?discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9._-]+/gi;

export const REDACTED_DISCORD_WEBHOOK_URL =
    "[REDACTED_DISCORD_WEBHOOK_URL]";

export function redactDiscordWebhookUrls(value: string): string {
    return value.replace(
        DISCORD_WEBHOOK_URL_PATTERN,
        REDACTED_DISCORD_WEBHOOK_URL,
    );
}

export function sanitizeSchedulerJsonValue<T>(value: T): T {
    if (typeof value === "string") {
        return redactDiscordWebhookUrls(value) as T;
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

function hasSchedulerConfig(rootPath: string): boolean {
    return (
        fs.existsSync(path.join(rootPath, ".vscode", "scheduler.json")) ||
        fs.existsSync(path.join(rootPath, ".vscode", "scheduler.private.json"))
    );
}

export function findWorkspaceRoot(startPath: string): string {
    let currentPath = path.resolve(startPath);
    const rootPath = path.parse(currentPath).root;

    while (true) {
        if (hasSchedulerConfig(currentPath)) {
            return currentPath;
        }

        if (currentPath === rootPath) {
            break;
        }

        currentPath = path.dirname(currentPath);
    }

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

export function readSchedulerConfig(workspaceRoot: string): { tasks: any[] } {
    const readPath = getActiveSchedulerReadPath(workspaceRoot);
    if (!fs.existsSync(readPath)) {
        return { tasks: [] };
    }
    try {
        let content = fs.readFileSync(readPath, "utf-8");
        content = content.replace(/^\uFEFF/, "");
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
            return { tasks: parsed };
        }
        return parsed;
    } catch (e) {
        console.error(`[SchedulerStore] Failed to read config from ${readPath}: ${e}`);
        return { tasks: [] };
    }
}

export function writeSchedulerConfig(workspaceRoot: string, config: { tasks: any[] }): void {
    const configPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
    const privateConfigPath = getPrivateSchedulerConfigPath(configPath);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    if (!config || !Array.isArray(config.tasks)) {
        throw new Error("Invalid config format: 'tasks' array is missing.");
    }

    const publicConfig = { ...config, tasks: sanitizeSchedulerJsonValue(config.tasks) };

    fs.writeFileSync(configPath, JSON.stringify(publicConfig, null, 4));
    fs.writeFileSync(privateConfigPath, JSON.stringify(config, null, 4));

    const readBack = readSchedulerConfig(workspaceRoot);
    if (!readBack || !Array.isArray(readBack.tasks) || readBack.tasks.length !== config.tasks.length) {
        throw new Error("Persistence verification failed: read-back config length mismatch.");
    }

    // Deeper verification: match a serialized fingerprint to ensure data was exactly persisted
    const expected = JSON.stringify(sanitizeSchedulerJsonValue(config.tasks));
    const actual = JSON.stringify(sanitizeSchedulerJsonValue(readBack.tasks));
    if (expected !== actual) {
        throw new Error("Persistence verification failed: read-back data did not match written data.");
    }
}