import * as fs from "fs";
import * as path from "path";
import { sanitizeSchedulerJsonValue } from "./copilotJsonSanitizer";
import { getWorkspaceSchedulerMirrorPaths } from "./sqliteStorage";

export function getPrivateSchedulerConfigPath(configPath: string): string {
    return path.join(path.dirname(configPath), "scheduler.private.json");
}

export function findWorkspaceRoot(startPath: string): string {
    let currentPath = path.resolve(startPath);
    while (currentPath !== path.parse(currentPath).root) {
        if (
            fs.existsSync(path.join(currentPath, ".vscode", "scheduler.json")) ||
            fs.existsSync(path.join(currentPath, ".vscode", "scheduler.private.json"))
        ) {
            return currentPath;
        }
        currentPath = path.dirname(currentPath);
    }
    return process.cwd();
}

export function getActiveSchedulerReadPath(workspaceRoot: string): string {
    const {
        publicSchedulerMirrorPath: configPath,
        privateSchedulerMirrorPath: privateConfigPath,
    } = getWorkspaceSchedulerMirrorPaths(workspaceRoot);
    let readPath = configPath;

    const configExists = fs.existsSync(configPath);
    const privateExists = fs.existsSync(privateConfigPath);

    if (configExists && privateExists) {
        let configValid = false;
        let privateValid = false;
        try {
            const data = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, ""));
            configValid = !!data && Array.isArray(data.tasks);
        } catch { /* empty */ }
        try {
            const data = JSON.parse(fs.readFileSync(privateConfigPath, "utf8").replace(/^\uFEFF/, ""));
            privateValid = !!data && Array.isArray(data.tasks);
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
        return JSON.parse(content);
    } catch (e) {
        console.error(`[SchedulerStore] Failed to read config from ${readPath}: ${e}`);
        return { tasks: [] };
    }
}

export function writeSchedulerConfig(workspaceRoot: string, config: { tasks: any[] }): void {
    const {
        publicSchedulerMirrorPath: configPath,
        privateSchedulerMirrorPath: privateConfigPath,
    } = getWorkspaceSchedulerMirrorPaths(workspaceRoot);

    fs.mkdirSync(path.dirname(configPath), { recursive: true });

    // Validate the config before writing
    if (!config || !Array.isArray(config.tasks)) {
        throw new Error("Invalid config format: 'tasks' array is missing.");
    }

    const publicConfig = { ...config, tasks: sanitizeSchedulerJsonValue(config.tasks) };

    // Write public
    fs.writeFileSync(configPath, JSON.stringify(publicConfig, null, 4));
    // Write private
    fs.writeFileSync(privateConfigPath, JSON.stringify(config, null, 4));

    // Verify persistence (eliminate false success)
    const readBack = readSchedulerConfig(workspaceRoot);
    if (!readBack || !Array.isArray(readBack.tasks) || readBack.tasks.length !== config.tasks.length) {
        throw new Error("Persistence verification failed: read-back config length mismatch.");
    }
}
