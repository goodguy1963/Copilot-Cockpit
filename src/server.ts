// @ts-nocheck
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import {
    findWorkspaceRoot,
    getPrivateSchedulerConfigPath,
    readSchedulerConfig,
    sanitizeSchedulerJsonValue,
    writeSchedulerConfig,
} from "./schedulerJsonSanitizer.js";
import {
    createScheduleHistorySnapshot,
    getScheduleHistoryRoot,
    listScheduleHistoryEntries,
    readScheduleHistorySnapshot,
} from "./scheduleHistory.js";

const WORKSPACE_ROOT = findWorkspaceRoot(process.cwd());

interface SchedulerTask {
    id: string;
    name?: string;
    description?: string;
    cron: string;
    prompt: string;
    enabled?: boolean;
    oneTime?: boolean;
    chatSession?: "new" | "continue";
    agent?: string;
    model?: string;
    promptSource?: "inline" | "local" | "global";
    promptPath?: string;
    promptBackupPath?: string;
    promptBackupUpdatedAt?: string;
    jitterSeconds?: number;
    workspacePath?: string;
    lastRun?: string;
    lastError?: string;
    lastErrorAt?: string;
    nextRun?: string;
    createdAt?: string;
    updatedAt?: string;
}

interface SchedulerConfig {
    tasks: SchedulerTask[];
}

type SchedulerServerContext = {
    workspaceRoot: string;
    historyRoot: string;
    readConfig: () => SchedulerConfig;
    writeConfig: (config: SchedulerConfig) => void;
    listHistory: () => Array<{ id: string; createdAt: string; hasPrivate: boolean }>;
    readHistorySnapshot: (snapshotId: string) => { publicConfig?: SchedulerConfig; privateConfig?: SchedulerConfig } | undefined;
    createHistorySnapshot: (publicConfig: SchedulerConfig, privateConfig: SchedulerConfig) => void;
    readCurrentConfigs: () => { publicConfig: SchedulerConfig; privateConfig: SchedulerConfig };
};

function ensureConfig(raw: unknown): SchedulerConfig {
    if (raw && typeof raw === "object" && Array.isArray((raw as SchedulerConfig).tasks)) {
        return raw as SchedulerConfig;
    }
    return { tasks: [] };
}

function nowIso(): string {
    return new Date().toISOString();
}

function asObject(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function parseStoredConfig(filePath: string): SchedulerConfig | undefined {
    if (!fs.existsSync(filePath)) {
        return undefined;
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
        return ensureConfig(JSON.parse(raw));
    } catch {
        return undefined;
    }
}

function createDefaultContext(): SchedulerServerContext {
    const configPath = path.join(WORKSPACE_ROOT, ".vscode", "scheduler.json");
    const privateConfigPath = getPrivateSchedulerConfigPath(configPath);

    return {
        workspaceRoot: WORKSPACE_ROOT,
        historyRoot: getScheduleHistoryRoot(WORKSPACE_ROOT),
        readConfig: () => ensureConfig(readSchedulerConfig(WORKSPACE_ROOT)),
        writeConfig: (config: SchedulerConfig) => {
            writeSchedulerConfig(WORKSPACE_ROOT, ensureConfig(config));
        },
        listHistory: () => listScheduleHistoryEntries(WORKSPACE_ROOT),
        readHistorySnapshot: (snapshotId: string) =>
            readScheduleHistorySnapshot(WORKSPACE_ROOT, snapshotId),
        createHistorySnapshot: (publicConfig: SchedulerConfig, privateConfig: SchedulerConfig) => {
            createScheduleHistorySnapshot(WORKSPACE_ROOT, publicConfig, privateConfig);
        },
        readCurrentConfigs: () => ({
            publicConfig: parseStoredConfig(configPath) ?? { tasks: [] },
            privateConfig: parseStoredConfig(privateConfigPath)
                ?? parseStoredConfig(configPath)
                ?? { tasks: [] },
        }),
    };
}

function textResponse(payload: unknown) {
    const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    return {
        content: [{ type: "text", text }],
    };
}

function errorResponse(message: string) {
    return {
        content: [{ type: "text", text: message }],
        isError: true,
    };
}

function ensureString(value: unknown, fieldName: string): string {
    const result = typeof value === "string" ? value.trim() : "";
    if (!result) {
        throw new Error(`Field '${fieldName}' is required.`);
    }
    return result;
}

function findTask(config: SchedulerConfig, id: string): SchedulerTask | undefined {
    return config.tasks.find((task) => task.id === id);
}

function normalizeTaskForWrite(existing: SchedulerTask | undefined, updates: Record<string, unknown>): SchedulerTask {
    const timestamp = nowIso();
    const id = ensureString(updates.id ?? existing?.id, "id");
    const cron = ensureString(updates.cron ?? existing?.cron, "cron");
    const prompt = ensureString(updates.prompt ?? existing?.prompt, "prompt");
    const oneTime = typeof updates.oneTime === "boolean"
        ? updates.oneTime
        : existing?.oneTime === true;
    const chatSession = !oneTime && (updates.chatSession === "new" || updates.chatSession === "continue")
        ? updates.chatSession
        : !oneTime && (existing?.chatSession === "new" || existing?.chatSession === "continue")
            ? existing.chatSession
            : undefined;

    return {
        ...existing,
        ...updates,
        id,
        name: typeof updates.name === "string"
            ? updates.name.trim() || existing?.name || id
            : existing?.name || id,
        description: typeof updates.description === "string"
            ? updates.description
            : existing?.description,
        cron,
        prompt,
        enabled: typeof updates.enabled === "boolean"
            ? updates.enabled
            : existing?.enabled !== false,
        oneTime,
        chatSession,
        agent: typeof updates.agent === "string" ? updates.agent : existing?.agent,
        model: typeof updates.model === "string" ? updates.model : existing?.model,
        promptSource: typeof updates.promptSource === "string"
            ? updates.promptSource
            : existing?.promptSource || "inline",
        promptPath: typeof updates.promptPath === "string"
            ? updates.promptPath
            : existing?.promptPath,
        promptBackupPath: typeof updates.promptBackupPath === "string"
            ? updates.promptBackupPath
            : existing?.promptBackupPath,
        promptBackupUpdatedAt: typeof updates.promptBackupUpdatedAt === "string"
            ? updates.promptBackupUpdatedAt
            : existing?.promptBackupUpdatedAt,
        jitterSeconds: typeof updates.jitterSeconds === "number"
            ? updates.jitterSeconds
            : existing?.jitterSeconds,
        workspacePath: typeof updates.workspacePath === "string"
            ? updates.workspacePath
            : existing?.workspacePath || WORKSPACE_ROOT,
        lastRun: typeof updates.lastRun === "string" ? updates.lastRun : existing?.lastRun,
        lastError: typeof updates.lastError === "string" ? updates.lastError : existing?.lastError,
        lastErrorAt: typeof updates.lastErrorAt === "string" ? updates.lastErrorAt : existing?.lastErrorAt,
        nextRun: typeof updates.nextRun === "string" ? updates.nextRun : existing?.nextRun,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
    };
}

function duplicateTask(original: SchedulerTask, overrides: Record<string, unknown>): SchedulerTask {
    const timestamp = nowIso();
    const duplicateId = typeof overrides.newId === "string" && overrides.newId.trim()
        ? overrides.newId.trim()
        : `${original.id}-copy-${Date.now()}`;
    const duplicateName = typeof overrides.name === "string" && overrides.name.trim()
        ? overrides.name.trim()
        : `${original.name || original.id} (Copy)`;

    return {
        ...original,
        id: duplicateId,
        name: duplicateName,
        enabled: false,
        chatSession: original.oneTime === true ? undefined : original.chatSession,
        promptBackupPath: undefined,
        promptBackupUpdatedAt: undefined,
        lastRun: undefined,
        lastError: undefined,
        lastErrorAt: undefined,
        nextRun: undefined,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

function getOverdueTasks(tasks: SchedulerTask[], referenceTime?: string): SchedulerTask[] {
    const now = referenceTime ? new Date(referenceTime) : new Date();
    const nowMs = now.getTime();

    return tasks.filter((task) => {
        if (task.enabled === false || typeof task.nextRun !== "string") {
            return false;
        }

        const nextRunMs = new Date(task.nextRun).getTime();
        return Number.isFinite(nextRunMs) && nextRunMs <= nowMs;
    });
}

export const MCP_TOOL_DEFINITIONS = [
    {
        name: "scheduler_list_tasks",
        description: "List all scheduled tasks with their current scheduler fields.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "scheduler_get_task",
        description: "Get one scheduled task by ID.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "ID of the task to fetch." },
            },
            required: ["id"],
        },
    },
    {
        name: "scheduler_add_task",
        description: "Create a task or merge it into an existing task without dropping scheduler metadata.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Unique task identifier." },
                name: { type: "string", description: "Human-readable task name." },
                description: { type: "string", description: "Optional task description." },
                cron: { type: "string", description: "Cron expression for the schedule." },
                prompt: { type: "string", description: "Prompt content or resolved prompt text." },
                enabled: { type: "boolean", description: "Whether the task is enabled." },
                oneTime: { type: "boolean", description: "Whether the task runs once and then removes itself." },
                chatSession: { type: "string", description: "Recurring tasks only: 'new' or 'continue'. One-time tasks ignore this field." },
                agent: { type: "string", description: "Optional agent/mode to use for execution." },
                model: { type: "string", description: "Optional model identifier." },
                promptSource: { type: "string", description: "Prompt source: inline, local, or global." },
                promptPath: { type: "string", description: "Optional prompt template path." },
                jitterSeconds: { type: "number", description: "Optional jitter in seconds." },
                workspacePath: { type: "string", description: "Optional workspace path override." },
            },
            required: ["id", "cron", "prompt"],
        },
    },
    {
        name: "scheduler_update_task",
        description: "Update selected fields on an existing task while preserving the rest of the scheduler metadata.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Task ID to update." },
                name: { type: "string" },
                description: { type: "string" },
                cron: { type: "string" },
                prompt: { type: "string" },
                enabled: { type: "boolean" },
                oneTime: { type: "boolean" },
                chatSession: { type: "string" },
                agent: { type: "string" },
                model: { type: "string" },
                promptSource: { type: "string" },
                promptPath: { type: "string" },
                jitterSeconds: { type: "number" },
                workspacePath: { type: "string" },
                nextRun: { type: "string", description: "Optional ISO timestamp override for next run." },
            },
            required: ["id"],
        },
    },
    {
        name: "scheduler_duplicate_task",
        description: "Duplicate an existing task as a disabled copy.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Source task ID." },
                newId: { type: "string", description: "Optional new task ID." },
                name: { type: "string", description: "Optional name override for the duplicate." },
            },
            required: ["id"],
        },
    },
    {
        name: "scheduler_remove_task",
        description: "Remove a scheduled task by ID.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "ID of the task to remove." },
            },
            required: ["id"],
        },
    },
    {
        name: "scheduler_run_task",
        description: "Mark an enabled task as due now so the scheduler runs it on the next scheduler tick.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "ID of the task to run." },
            },
            required: ["id"],
        },
    },
    {
        name: "scheduler_toggle_task",
        description: "Enable or disable a scheduled task.",
        inputSchema: {
            type: "object",
            properties: {
                id: { type: "string", description: "Task ID to toggle." },
                enabled: { type: "boolean", description: "true to enable, false to disable." },
            },
            required: ["id", "enabled"],
        },
    },
    {
        name: "scheduler_list_history",
        description: "List repo-local scheduler history snapshots stored under .vscode/scheduler-history.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "scheduler_restore_snapshot",
        description: "Restore the repo-local workspace schedule from a snapshot ID. The current state is snapshotted first.",
        inputSchema: {
            type: "object",
            properties: {
                snapshotId: { type: "string", description: "History snapshot ID returned by scheduler_list_history." },
            },
            required: ["snapshotId"],
        },
    },
    {
        name: "scheduler_get_overdue_tasks",
        description: "List enabled tasks whose nextRun is due or overdue.",
        inputSchema: {
            type: "object",
            properties: {
                referenceTime: { type: "string", description: "Optional ISO timestamp used as the comparison point." },
            },
        },
    },
];

export async function handleSchedulerToolCall(
    toolName: string,
    rawArguments: unknown,
    context: SchedulerServerContext = createDefaultContext(),
) {
    const args = asObject(rawArguments);
    const config = ensureConfig(context.readConfig());

    try {
        switch (toolName) {
            case "scheduler_list_tasks":
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    taskCount: config.tasks.length,
                    tasks: config.tasks,
                });

            case "scheduler_get_task": {
                const id = ensureString(args.id, "id");
                const task = findTask(config, id);
                if (!task) {
                    return errorResponse(`Task '${id}' not found.`);
                }
                return textResponse(task);
            }

            case "scheduler_add_task": {
                const id = ensureString(args.id, "id");
                const existing = findTask(config, id);
                const task = normalizeTaskForWrite(existing, args);

                if (existing) {
                    const index = config.tasks.findIndex((entry) => entry.id === id);
                    config.tasks[index] = task;
                } else {
                    config.tasks.push(task);
                }

                context.writeConfig(config);
                return textResponse({ message: `Task '${id}' saved successfully.`, task });
            }

            case "scheduler_update_task": {
                const id = ensureString(args.id, "id");
                const existing = findTask(config, id);
                if (!existing) {
                    return errorResponse(`Task '${id}' not found.`);
                }

                const task = normalizeTaskForWrite(existing, { ...args, id });
                const index = config.tasks.findIndex((entry) => entry.id === id);
                config.tasks[index] = task;
                context.writeConfig(config);
                return textResponse({ message: `Task '${id}' updated.`, task });
            }

            case "scheduler_duplicate_task": {
                const id = ensureString(args.id, "id");
                const existing = findTask(config, id);
                if (!existing) {
                    return errorResponse(`Task '${id}' not found.`);
                }

                const clone = duplicateTask(existing, args);
                if (findTask(config, clone.id)) {
                    return errorResponse(`Task '${clone.id}' already exists.`);
                }

                config.tasks.push(clone);
                context.writeConfig(config);
                return textResponse({ message: `Task '${id}' duplicated as '${clone.id}'.`, task: clone });
            }

            case "scheduler_remove_task": {
                const id = ensureString(args.id, "id");
                const initialLength = config.tasks.length;
                config.tasks = config.tasks.filter((task) => task.id !== id);
                if (config.tasks.length === initialLength) {
                    return errorResponse(`Task '${id}' not found.`);
                }

                context.writeConfig(config);
                return textResponse({ message: `Task '${id}' removed.`, id });
            }

            case "scheduler_run_task": {
                const id = ensureString(args.id, "id");
                const task = findTask(config, id);
                if (!task) {
                    return errorResponse(`Task '${id}' not found.`);
                }
                if (task.enabled === false) {
                    return errorResponse(`Task '${id}' is disabled. Enable it before requesting an immediate run.`);
                }

                task.nextRun = nowIso();
                task.updatedAt = nowIso();
                task.lastError = undefined;
                task.lastErrorAt = undefined;
                context.writeConfig(config);
                return textResponse({
                    message: `Task '${id}' marked due now. It will run on the next scheduler tick.`,
                    id,
                    nextRun: task.nextRun,
                });
            }

            case "scheduler_toggle_task": {
                const id = ensureString(args.id, "id");
                if (typeof args.enabled !== "boolean") {
                    return errorResponse("Field 'enabled' is required.");
                }

                const task = findTask(config, id);
                if (!task) {
                    return errorResponse(`Task '${id}' not found.`);
                }

                task.enabled = args.enabled;
                task.updatedAt = nowIso();
                if (args.enabled === false) {
                    task.nextRun = undefined;
                }
                context.writeConfig(config);
                return textResponse({ message: `Task '${id}' ${args.enabled ? "enabled" : "disabled"}.`, task });
            }

            case "scheduler_list_history": {
                const snapshots = context.listHistory();
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    historyRoot: context.historyRoot,
                    snapshotCount: snapshots.length,
                    snapshots,
                });
            }

            case "scheduler_restore_snapshot": {
                const snapshotId = ensureString(args.snapshotId, "snapshotId");
                const snapshot = context.readHistorySnapshot(snapshotId);
                if (!snapshot) {
                    return errorResponse(`Snapshot '${snapshotId}' not found.`);
                }

                const currentConfigs = context.readCurrentConfigs();
                context.createHistorySnapshot(
                    currentConfigs.publicConfig,
                    currentConfigs.privateConfig,
                );

                const restoredConfig = ensureConfig(
                    snapshot.privateConfig || snapshot.publicConfig,
                );
                context.writeConfig(restoredConfig);
                return textResponse({
                    message: `Snapshot '${snapshotId}' restored successfully.`,
                    snapshotId,
                    taskCount: restoredConfig.tasks.length,
                });
            }

            case "scheduler_get_overdue_tasks": {
                const overdueTasks = getOverdueTasks(config.tasks, typeof args.referenceTime === "string" ? args.referenceTime : undefined);
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    referenceTime: typeof args.referenceTime === "string" ? args.referenceTime : nowIso(),
                    taskCount: overdueTasks.length,
                    tasks: overdueTasks,
                });
            }

            default:
                throw new Error(`Unknown tool: ${toolName}`);
        }
    } catch (error: any) {
        return errorResponse(error?.message || String(error ?? "Unknown server error"));
    }
}

const server = new Server(
    {
        name: "scheduler-mcp",
        version: "1.1.0",
    },
    {
        capabilities: {
            tools: {},
        },
    },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: MCP_TOOL_DEFINITIONS,
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleSchedulerToolCall(
        request.params.name,
        request.params.arguments,
    );
});

export async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Scheduler MCP Server running on stdio");
}

if (require.main === module) {
    run().catch((error) => {
        console.error("Fatal error running server:", error);
        process.exit(1);
    });
}
