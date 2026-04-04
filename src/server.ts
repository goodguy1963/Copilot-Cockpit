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
    createDefaultCockpitBoard,
    normalizeCockpitBoard,
} from "./cockpitBoard.js";
import {
    DEFAULT_ROUTING_SIGNALS,
    listCockpitRoutingCards,
} from "./cockpitRouting.js";
import {
    addTodoCommentInBoard,
    approveTodoInBoard,
    createTodoInBoard,
    deleteCockpitFlagDefinition,
    deleteCockpitTodoLabelDefinition,
    deleteTodoInBoard,
    ensureTaskTodosInBoard,
    finalizeTodoInBoard,
    moveTodoInBoard,
    rejectTodoInBoard,
    saveCockpitFlagDefinition,
    saveCockpitTodoLabelDefinition,
    setCockpitBoardFiltersInBoard,
    updateTodoInBoard,
} from "./cockpitBoardManager.js";
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
    jobs?: any[];
    jobFolders?: any[];
    cockpitBoard?: any;
    telegramNotification?: any;
}

interface ResearchConfig {
    version: number;
    profiles: any[];
    runs: any[];
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
        const config = raw as SchedulerConfig;
        return {
            ...config,
            jobs: Array.isArray(config.jobs) ? config.jobs : [],
            jobFolders: Array.isArray(config.jobFolders) ? config.jobFolders : [],
            cockpitBoard: config.cockpitBoard && typeof config.cockpitBoard === "object"
                ? normalizeCockpitBoard(config.cockpitBoard)
                : undefined,
            telegramNotification: config.telegramNotification && typeof config.telegramNotification === "object"
                ? config.telegramNotification
                : undefined,
        };
    }
    return { tasks: [], jobs: [], jobFolders: [] };
}

function nowIso(): string {
    return new Date().toISOString();
}

function createId(prefix: string): string {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
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

function getResearchConfigPath(workspaceRoot: string): string {
    return path.join(workspaceRoot, ".vscode", "research.json");
}

function readResearchConfig(workspaceRoot: string): ResearchConfig {
    const filePath = getResearchConfigPath(workspaceRoot);
    if (!fs.existsSync(filePath)) {
        return { version: 1, profiles: [], runs: [] };
    }

    try {
        const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
        const parsed = JSON.parse(raw) as Partial<ResearchConfig>;
        return {
            version: typeof parsed.version === "number" ? parsed.version : 1,
            profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
            runs: Array.isArray(parsed.runs) ? parsed.runs : [],
        };
    } catch {
        return { version: 1, profiles: [], runs: [] };
    }
}

function writeResearchConfig(workspaceRoot: string, config: ResearchConfig): void {
    const filePath = getResearchConfigPath(workspaceRoot);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const normalized: ResearchConfig = {
        version: typeof config.version === "number" ? config.version : 1,
        profiles: Array.isArray(config.profiles) ? config.profiles : [],
        runs: Array.isArray(config.runs) ? config.runs : [],
    };
    fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
}

function getSchedulerJob(config: SchedulerConfig, jobId: string): any | undefined {
    return Array.isArray(config.jobs) ? config.jobs.find((job) => job && job.id === jobId) : undefined;
}

function getSchedulerFolder(config: SchedulerConfig, folderId: string): any | undefined {
    return Array.isArray(config.jobFolders)
        ? config.jobFolders.find((folder) => folder && folder.id === folderId)
        : undefined;
}

function getSchedulerTask(config: SchedulerConfig, taskId: string): SchedulerTask | undefined {
    return Array.isArray(config.tasks)
        ? config.tasks.find((task) => task && task.id === taskId)
        : undefined;
}

function normalizeJobNode(node: any): any {
    if (!node || typeof node !== "object") {
        return undefined;
    }
    if (node.type === "pause") {
        return {
            id: typeof node.id === "string" && node.id.trim() ? node.id.trim() : createId("jobpause"),
            type: "pause",
            title: typeof node.title === "string" && node.title.trim() ? node.title.trim() : "Manual review",
        };
    }
    return {
        id: typeof node.id === "string" && node.id.trim() ? node.id.trim() : createId("jobnode"),
        type: "task",
        taskId: typeof node.taskId === "string" ? node.taskId.trim() : "",
        windowMinutes: Number.isFinite(Number(node.windowMinutes)) ? Math.max(1, Math.floor(Number(node.windowMinutes))) : 30,
    };
}

function normalizeJob(job: any): any {
    const nodes = Array.isArray(job?.nodes) ? job.nodes.map(normalizeJobNode).filter(Boolean) : [];
    return {
        ...job,
        id: typeof job?.id === "string" && job.id.trim() ? job.id.trim() : createId("job"),
        name: typeof job?.name === "string" && job.name.trim() ? job.name.trim() : "Untitled Job",
        cronExpression: typeof job?.cronExpression === "string" && job.cronExpression.trim() ? job.cronExpression.trim() : "0 9 * * 1-5",
        folderId: typeof job?.folderId === "string" && job.folderId.trim() ? job.folderId.trim() : undefined,
        paused: job?.paused === true,
        archived: job?.archived === true,
        archivedAt: typeof job?.archivedAt === "string" ? job.archivedAt : undefined,
        lastCompiledTaskId: typeof job?.lastCompiledTaskId === "string" ? job.lastCompiledTaskId : undefined,
        runtime: job?.runtime && typeof job.runtime === "object" ? job.runtime : undefined,
        nodes,
        createdAt: typeof job?.createdAt === "string" ? job.createdAt : nowIso(),
        updatedAt: nowIso(),
    };
}

function summarizeJobNode(config: SchedulerConfig, node: any): Record<string, unknown> {
    if (!node) {
        return { type: "unknown" };
    }
    if (node.type === "pause") {
        return { id: node.id, type: "pause", title: node.title };
    }
    const task = getSchedulerTask(config, node.taskId);
    return {
        id: node.id,
        type: "task",
        taskId: node.taskId,
        taskName: task?.name,
        windowMinutes: node.windowMinutes,
    };
}

function summarizeJob(config: SchedulerConfig, job: any): Record<string, unknown> {
    const folder = job?.folderId ? getSchedulerFolder(config, job.folderId) : undefined;
    return {
        ...job,
        folderName: folder?.name,
        nodeCount: Array.isArray(job?.nodes) ? job.nodes.length : 0,
        taskNodeCount: Array.isArray(job?.nodes)
            ? job.nodes.filter((node: any) => node && node.type !== "pause").length
            : 0,
        pauseNodeCount: Array.isArray(job?.nodes)
            ? job.nodes.filter((node: any) => node && node.type === "pause").length
            : 0,
        nodes: Array.isArray(job?.nodes) ? job.nodes.map((node: any) => summarizeJobNode(config, node)) : [],
    };
}

function getCockpitBoard(config: SchedulerConfig): any {
    const board = config.cockpitBoard && typeof config.cockpitBoard === "object"
        ? normalizeCockpitBoard(config.cockpitBoard)
        : createDefaultCockpitBoard();
    config.cockpitBoard = board;
    return board;
}

function getCockpitSection(board: any, sectionId: string): any | undefined {
    return Array.isArray(board?.sections)
        ? board.sections.find((section: any) => section && section.id === sectionId)
        : undefined;
}

function getCockpitTodo(board: any, todoId: string): any | undefined {
    return Array.isArray(board?.cards)
        ? board.cards.find((card: any) => card && card.id === todoId)
        : undefined;
}

function normalizeStringList(value: unknown): string[] {
    return Array.isArray(value)
        ? value
            .filter((entry): entry is string => typeof entry === "string")
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        : [];
}

function normalizeTodoPriority(value: unknown): string {
    switch (value) {
        case "low":
        case "medium":
        case "high":
        case "urgent":
            return value;
        default:
            return "none";
    }
}

function summarizeCockpitTodo(board: any, todo: any): Record<string, unknown> {
    const section = getCockpitSection(board, todo.sectionId);
    const comments = Array.isArray(todo.comments) ? todo.comments : [];
    return {
        ...todo,
        sectionTitle: section?.title,
        commentCount: comments.length,
        latestComment: comments.length > 0 ? comments[comments.length - 1] : undefined,
    };
}

// Prefer this helper for one-time execution closeout instead of hand-assembling
// separate card updates, comment writes, and stale task cleanup. It keeps the
// originating card intact, respects missing sections, and can clear a broken
// task link in the same supported mutation path.
function closeoutCockpitTodo(config: SchedulerConfig, args: Record<string, unknown>) {
    const board = getCockpitBoard(config);
    const todoId = ensureString(args.todoId, "todoId");
    const existingTodo = getCockpitTodo(board, todoId);
    if (!existingTodo) {
        return { error: `Cockpit todo '${todoId}' not found.` };
    }

    const requestedSectionId = typeof args.sectionId === "string" && args.sectionId.trim()
        ? args.sectionId.trim()
        : undefined;
    const requestedSectionFound = requestedSectionId
        ? Boolean(getCockpitSection(board, requestedSectionId))
        : undefined;
    const clearTaskIdIfMissing = args.clearTaskIdIfMissing === true;

    const explicitTaskId = typeof args.taskId === "string" ? args.taskId.trim() : undefined;
    const currentTaskId = typeof existingTodo.taskId === "string" && existingTodo.taskId.trim()
        ? existingTodo.taskId.trim()
        : undefined;
    const checkedTaskId = explicitTaskId !== undefined
        ? explicitTaskId || currentTaskId
        : currentTaskId;
    const linkedTaskExists = checkedTaskId
        ? Boolean(getSchedulerTask(config, checkedTaskId))
        : undefined;

    let nextTaskId: string | undefined;
    let staleTaskIdCleared = false;
    if (explicitTaskId !== undefined) {
        if (!explicitTaskId) {
            nextTaskId = "";
            staleTaskIdCleared = Boolean(currentTaskId);
        } else if (linkedTaskExists) {
            nextTaskId = explicitTaskId;
        } else if (clearTaskIdIfMissing) {
            nextTaskId = "";
            staleTaskIdCleared = true;
        }
    } else if (currentTaskId && linkedTaskExists === false && clearTaskIdIfMissing) {
        nextTaskId = "";
        staleTaskIdCleared = true;
    }

    let result = updateTodoInBoard(board, todoId, {
        sectionId: requestedSectionId,
        priority: normalizeTodoPriority(args.priority),
        status: typeof args.status === "string" ? args.status : undefined,
        labels: normalizeStringList(args.labels),
        flags: normalizeStringList(args.flags),
        taskId: nextTaskId,
        archived: typeof args.archived === "boolean" ? args.archived : undefined,
        archiveOutcome: typeof args.archiveOutcome === "string" ? args.archiveOutcome : undefined,
    });
    if (!result.todo) {
        return { error: `Cockpit todo '${todoId}' not found.` };
    }

    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    let commentAdded = false;
    if (summary) {
        const commentResult = addTodoCommentInBoard(result.board, todoId, {
            body: summary,
            author: args.author === "user" ? "user" : "system",
            source: typeof args.source === "string" && args.source.trim()
                ? args.source.trim()
                : "bot-mcp",
            labels: normalizeStringList(args.commentLabels),
        });
        if (!commentResult.todo) {
            return { error: `Cockpit todo '${todoId}' not found.` };
        }
        result = commentResult;
        commentAdded = true;
    }

    return {
        todoId,
        board: result.board,
        todo: result.todo,
        requestedSectionId,
        requestedSectionFound,
        checkedTaskId,
        linkedTaskExists,
        staleTaskIdCleared,
        commentAdded,
    };
}

function normalizeResearchProfile(profile: any): any {
    return {
        ...profile,
        id: typeof profile?.id === "string" && profile.id.trim() ? profile.id.trim() : createId("research"),
        name: typeof profile?.name === "string" && profile.name.trim() ? profile.name.trim() : "Untitled Research Profile",
        instructions: typeof profile?.instructions === "string" ? profile.instructions.trim() : "",
        editablePaths: Array.isArray(profile?.editablePaths) ? profile.editablePaths : [],
        benchmarkCommand: typeof profile?.benchmarkCommand === "string" ? profile.benchmarkCommand.trim() : "",
        metricPattern: typeof profile?.metricPattern === "string" ? profile.metricPattern.trim() : "",
        metricDirection: profile?.metricDirection === "minimize" ? "minimize" : "maximize",
        maxIterations: Number.isFinite(Number(profile?.maxIterations)) ? Math.floor(Number(profile.maxIterations)) : 3,
        maxMinutes: Number.isFinite(Number(profile?.maxMinutes)) ? Math.floor(Number(profile.maxMinutes)) : 15,
        maxConsecutiveFailures: Number.isFinite(Number(profile?.maxConsecutiveFailures)) ? Math.floor(Number(profile.maxConsecutiveFailures)) : 2,
        benchmarkTimeoutSeconds: Number.isFinite(Number(profile?.benchmarkTimeoutSeconds)) ? Math.floor(Number(profile.benchmarkTimeoutSeconds)) : 180,
        editWaitSeconds: Number.isFinite(Number(profile?.editWaitSeconds)) ? Math.floor(Number(profile.editWaitSeconds)) : 20,
        agent: typeof profile?.agent === "string" ? profile.agent : undefined,
        model: typeof profile?.model === "string" ? profile.model : undefined,
        createdAt: typeof profile?.createdAt === "string" ? profile.createdAt : nowIso(),
        updatedAt: typeof profile?.updatedAt === "string" ? profile.updatedAt : nowIso(),
    };
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
    {
        name: "scheduler_list_jobs",
        description: "List all saved jobs and folders from the workspace scheduler store (.vscode/scheduler.json or the mirrored SQLite bootstrap store when SQLite mode is enabled).",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "scheduler_get_job",
        description: "Get a saved job by ID with resolved folder and node summaries.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID to fetch." },
            },
            required: ["jobId"],
        },
    },
    {
        name: "scheduler_create_job",
        description: "Create a new job definition in the workspace scheduler store and keep compatibility mirrors in sync.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Optional job ID override." },
                name: { type: "string", description: "Job name." },
                cronExpression: { type: "string", description: "Job cron expression." },
                folderId: { type: "string", description: "Optional folder ID." },
                paused: { type: "boolean", description: "Create the job paused." },
            },
            required: ["name", "cronExpression"],
        },
    },
    {
        name: "scheduler_update_job",
        description: "Update an existing job without changing unrelated fields.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID to update." },
                name: { type: "string" },
                cronExpression: { type: "string" },
                folderId: { type: "string" },
                paused: { type: "boolean" },
            },
            required: ["jobId"],
        },
    },
    {
        name: "scheduler_delete_job",
        description: "Delete a job and detach any tasks linked to it.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID to delete." },
            },
            required: ["jobId"],
        },
    },
    {
        name: "scheduler_duplicate_job",
        description: "Duplicate a job and its task/pause structure.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Source job ID." },
                newJobId: { type: "string", description: "Optional new job ID." },
                name: { type: "string", description: "Optional duplicate name override." },
            },
            required: ["jobId"],
        },
    },
    {
        name: "scheduler_list_job_folders",
        description: "List all job folders from the workspace scheduler store.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "scheduler_create_job_folder",
        description: "Create a new job folder.",
        inputSchema: {
            type: "object",
            properties: {
                folderId: { type: "string", description: "Optional folder ID override." },
                name: { type: "string", description: "Folder name." },
                parentId: { type: "string", description: "Optional parent folder ID." },
            },
            required: ["name"],
        },
    },
    {
        name: "scheduler_update_job_folder",
        description: "Rename or reparent an existing job folder.",
        inputSchema: {
            type: "object",
            properties: {
                folderId: { type: "string", description: "Folder ID to update." },
                name: { type: "string" },
                parentId: { type: "string" },
            },
            required: ["folderId"],
        },
    },
    {
        name: "scheduler_delete_job_folder",
        description: "Delete an empty job folder.",
        inputSchema: {
            type: "object",
            properties: {
                folderId: { type: "string", description: "Folder ID to delete." },
            },
            required: ["folderId"],
        },
    },
    {
        name: "scheduler_add_job_task",
        description: "Attach an existing task to a job as a workflow node.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                taskId: { type: "string", description: "Existing task ID to attach." },
                windowMinutes: { type: "number", description: "Optional node window in minutes." },
            },
            required: ["jobId", "taskId"],
        },
    },
    {
        name: "scheduler_remove_job_task",
        description: "Detach a task node from a job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                nodeId: { type: "string", description: "Job node ID to remove." },
            },
            required: ["jobId", "nodeId"],
        },
    },
    {
        name: "scheduler_create_job_pause",
        description: "Insert a manual pause checkpoint into a job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                title: { type: "string", description: "Pause title." },
            },
            required: ["jobId", "title"],
        },
    },
    {
        name: "scheduler_update_job_pause",
        description: "Rename an existing manual pause checkpoint.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                nodeId: { type: "string", description: "Pause node ID." },
                title: { type: "string", description: "New pause title." },
            },
            required: ["jobId", "nodeId", "title"],
        },
    },
    {
        name: "scheduler_delete_job_pause",
        description: "Remove a pause checkpoint from a job.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                nodeId: { type: "string", description: "Pause node ID." },
            },
            required: ["jobId", "nodeId"],
        },
    },
    {
        name: "scheduler_update_job_node_window",
        description: "Change the window length for a job task node.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                nodeId: { type: "string", description: "Node ID." },
                windowMinutes: { type: "number", description: "New window length in minutes." },
            },
            required: ["jobId", "nodeId", "windowMinutes"],
        },
    },
    {
        name: "scheduler_reorder_job_node",
        description: "Move a job node to a new position in the workflow order.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID." },
                nodeId: { type: "string", description: "Node ID." },
                targetIndex: { type: "number", description: "Zero-based target index." },
            },
            required: ["jobId", "nodeId", "targetIndex"],
        },
    },
    {
        name: "scheduler_compile_job_to_task",
        description: "Compile a job workflow into one standalone task and park the source job in Bundled Jobs.",
        inputSchema: {
            type: "object",
            properties: {
                jobId: { type: "string", description: "Job ID to compile." },
            },
            required: ["jobId"],
        },
    },
    {
        name: "cockpit_get_board",
        description: "Get the internal Cockpit board from the workspace Cockpit store (JSON mirrors or SQLite-backed runtime state, depending on storage mode).",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "cockpit_list_todos",
        description: "List Cockpit todo cards from the workspace Cockpit store, optionally filtered by section or label.",
        inputSchema: {
            type: "object",
            properties: {
                sectionId: { type: "string", description: "Optional section ID filter." },
                label: { type: "string", description: "Optional label filter." },
                includeArchived: { type: "boolean", description: "Set true to include archived cards." },
            },
        },
    },
    {
        name: "cockpit_get_todo",
        description: "Get one Cockpit todo card by ID.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to fetch." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_list_routing_cards",
        description: "List Cockpit todo cards that match routing labels, flags, or actionable comment labels.",
        inputSchema: {
            type: "object",
            properties: {
                signals: { type: "array", items: { type: "string" }, description: "Routing signals to match. Defaults to go, abgelehnt, needs-bot-review, and on-schedule-list." },
                includeArchived: { type: "boolean", description: "Set false to exclude archived cards." },
            },
        },
    },
    {
        name: "cockpit_create_todo",
        description: "Create a new Cockpit todo card in the workspace Cockpit store and keep compatibility mirrors in sync.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Optional card ID override." },
                title: { type: "string", description: "Card title." },
                description: { type: "string", description: "Optional card detail text." },
                sectionId: { type: "string", description: "Optional target section ID." },
                priority: { type: "string", description: "none, low, medium, high, or urgent." },
                labels: { type: "array", items: { type: "string" }, description: "Optional labels." },
                flags: { type: "array", items: { type: "string" }, description: "Single agent-state flag (only first value is kept). Use cockpit_save_flag_definition to manage flag colors." },
                comment: { type: "string", description: "Optional initial comment." },
                author: { type: "string", description: "Optional initial comment author: user or system." },
                commentSource: { type: "string", description: "Optional initial comment source: human-form, bot-mcp, bot-manual, or system-event." },
                status: { type: "string", description: "Optional initial workflow state: active, ready, completed, or rejected." },
                taskId: { type: "string", description: "Optional linked task ID." },
                sessionId: { type: "string", description: "Optional linked session ID." },
            },
            required: ["title"],
        },
    },
    {
        name: "cockpit_add_todo_comment",
        description: "Append a user or system comment to an existing Cockpit todo card.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to update." },
                body: { type: "string", description: "Comment body." },
                author: { type: "string", description: "Comment author: user or system." },
                source: { type: "string", description: "Comment source: human-form, bot-mcp, bot-manual, or system-event." },
                labels: { type: "array", items: { type: "string" }, description: "Optional labels implied by the comment." },
            },
            required: ["todoId", "body"],
        },
    },
    {
        name: "cockpit_approve_todo",
        description: "Mark a Cockpit todo card as approved and ready for final acceptance.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to approve." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_finalize_todo",
        description: "Archive a Cockpit todo card as completed successfully.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to finalize." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_reject_todo",
        description: "Archive a Cockpit todo card as rejected.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to reject." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_update_todo",
        description: "Update an existing Cockpit todo card in the workspace Cockpit store, including due date, labels, flags, and section.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to update." },
                title: { type: "string" },
                description: { type: "string" },
                sectionId: { type: "string" },
                dueAt: { type: "string", description: "Optional ISO due date." },
                priority: { type: "string", description: "none, low, medium, high, or urgent." },
                status: { type: "string", description: "active, ready, completed, or rejected." },
                labels: { type: "array", items: { type: "string" } },
                flags: { type: "array", items: { type: "string" }, description: "Single agent-state flag (only first value is kept). Use cockpit_save_flag_definition to manage flag colors." },
                order: { type: "number" },
                taskId: { type: "string" },
                sessionId: { type: "string" },
                archived: { type: "boolean" },
                archiveOutcome: { type: "string", description: "completed-successfully or rejected." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_closeout_todo",
        description: "Apply a deterministic execution closeout update to a Cockpit todo, optionally add one summary comment, and clear a stale linked task when the scheduler task no longer exists.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to close out." },
                summary: { type: "string", description: "Optional compact closeout summary comment." },
                sectionId: { type: "string", description: "Optional preferred section ID. If it does not exist, the card stays in its current section." },
                priority: { type: "string", description: "none, low, medium, high, or urgent." },
                status: { type: "string", description: "active, ready, completed, or rejected." },
                labels: { type: "array", items: { type: "string" }, description: "Optional replacement label list for the card. Use labels for multi-value categorization such as scheduled-task." },
                flags: { type: "array", items: { type: "string" }, description: "Optional replacement flag list for the card. Only the first value is kept, so pass at most one active review-state or routing flag." },
                taskId: { type: "string", description: "Optional linked task ID to set. Pass an empty string to clear the link explicitly." },
                clearTaskIdIfMissing: { type: "boolean", description: "When true, clear the linked taskId if the checked scheduler task does not exist." },
                commentLabels: { type: "array", items: { type: "string" }, description: "Optional labels to attach to the summary comment." },
                author: { type: "string", description: "Summary comment author: user or system. Defaults to system." },
                source: { type: "string", description: "Summary comment source: human-form, bot-mcp, bot-manual, or system-event. Defaults to bot-mcp." },
                archived: { type: "boolean", description: "Optional archived state for the card." },
                archiveOutcome: { type: "string", description: "completed-successfully or rejected." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_delete_todo",
        description: "Delete a Cockpit todo card by ID.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to delete." },
            },
            required: ["todoId"],
        },
    },
    {
        name: "cockpit_move_todo",
        description: "Move a Cockpit todo card to another section and index.",
        inputSchema: {
            type: "object",
            properties: {
                todoId: { type: "string", description: "Card ID to move." },
                sectionId: { type: "string", description: "Optional target section." },
                targetIndex: { type: "number", description: "Zero-based insertion index." },
            },
            required: ["todoId", "targetIndex"],
        },
    },
    {
        name: "cockpit_set_filters",
        description: "Update persisted Todo Cockpit filters and sort options in the workspace Cockpit store.",
        inputSchema: {
            type: "object",
            properties: {
                searchText: { type: "string" },
                labels: { type: "array", items: { type: "string" } },
                priorities: { type: "array", items: { type: "string" } },
                statuses: { type: "array", items: { type: "string" } },
                archiveOutcomes: { type: "array", items: { type: "string" } },
                flags: { type: "array", items: { type: "string" } },
                sectionId: { type: "string" },
                sortBy: { type: "string", description: "manual, dueAt, priority, updatedAt, or createdAt." },
                sortDirection: { type: "string", description: "asc or desc." },
                viewMode: { type: "string", description: "board or list." },
                showArchived: { type: "boolean" },
                showRecurringTasks: { type: "boolean" },
            },
        },
    },
    {
        name: "cockpit_seed_todos_from_tasks",
        description: "Ensure recurring scheduled tasks have linked history cards in Todo Cockpit and migrate older task-linked cards into the current model.",
        inputSchema: {
            type: "object",
            properties: {
                taskIds: { type: "array", items: { type: "string" }, description: "Optional list of task IDs to seed." },
            },
        },
    },
    {
        name: "cockpit_save_label_definition",
        description: "Upsert a label palette entry for the Todo Cockpit board. Labels are multi-value workflow tags displayed as pill-shaped chips (border-radius: 999px). Sets the display name and optional chip color.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Label name." },
                color: { type: "string", description: "Optional hex color, e.g. #4f8cff." },
            },
            required: ["name"],
        },
    },
    {
        name: "cockpit_delete_label_definition",
        description: "Remove a label definition from the Todo Cockpit label palette by name.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Label name to remove." },
            },
            required: ["name"],
        },
    },
    {
        name: "cockpit_save_flag_definition",
        description: "Upsert a flag palette entry for the Todo Cockpit board. Flags are single-value agent-state indicators displayed as squared chips (border-radius: 4px). Only one flag per card is kept at a time.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Flag name." },
                color: { type: "string", description: "Optional hex color, e.g. #f59e0b." },
            },
            required: ["name"],
        },
    },
    {
        name: "cockpit_delete_flag_definition",
        description: "Remove a flag definition from the Todo Cockpit flag palette by name.",
        inputSchema: {
            type: "object",
            properties: {
                name: { type: "string", description: "Flag name to remove." },
            },
            required: ["name"],
        },
    },
    {
        name: "research_list_profiles",
        description: "List research profiles from the workspace research store (.vscode/research.json plus mirrored SQLite state when enabled).",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "research_get_profile",
        description: "Get one research profile by ID.",
        inputSchema: {
            type: "object",
            properties: {
                researchId: { type: "string", description: "Research profile ID." },
            },
            required: ["researchId"],
        },
    },
    {
        name: "research_create_profile",
        description: "Create a research profile in the workspace research store and keep compatibility mirrors in sync.",
        inputSchema: {
            type: "object",
            properties: {
                researchData: { type: "object", description: "Profile fields, matching the Research tab form." },
            },
            required: ["researchData"],
        },
    },
    {
        name: "research_update_profile",
        description: "Update an existing research profile.",
        inputSchema: {
            type: "object",
            properties: {
                researchId: { type: "string", description: "Research profile ID." },
                researchData: { type: "object", description: "Fields to update." },
            },
            required: ["researchId", "researchData"],
        },
    },
    {
        name: "research_delete_profile",
        description: "Delete a research profile.",
        inputSchema: {
            type: "object",
            properties: {
                researchId: { type: "string", description: "Research profile ID." },
            },
            required: ["researchId"],
        },
    },
    {
        name: "research_duplicate_profile",
        description: "Duplicate a research profile.",
        inputSchema: {
            type: "object",
            properties: {
                researchId: { type: "string", description: "Source research profile ID." },
            },
            required: ["researchId"],
        },
    },
    {
        name: "research_list_runs",
        description: "List recent research runs from the workspace research store.",
        inputSchema: { type: "object", properties: {} },
    },
    {
        name: "research_get_run",
        description: "Get a research run by ID.",
        inputSchema: {
            type: "object",
            properties: {
                runId: { type: "string", description: "Research run ID." },
            },
            required: ["runId"],
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

            case "scheduler_list_jobs": {
                const jobs = Array.isArray(config.jobs) ? config.jobs.map((job) => summarizeJob(config, job)) : [];
                const folders = Array.isArray(config.jobFolders) ? config.jobFolders : [];
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    jobCount: jobs.length,
                    folderCount: folders.length,
                    jobs,
                    jobFolders: folders,
                });
            }

            case "scheduler_get_job": {
                const jobId = ensureString(args.jobId, "jobId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                return textResponse(summarizeJob(config, job));
            }

            case "scheduler_create_job": {
                const jobId = typeof args.jobId === "string" && args.jobId.trim() ? args.jobId.trim() : createId("job");
                if (getSchedulerJob(config, jobId)) {
                    return errorResponse(`Job '${jobId}' already exists.`);
                }
                const folderId = typeof args.folderId === "string" && args.folderId.trim() ? args.folderId.trim() : undefined;
                if (folderId && !getSchedulerFolder(config, folderId)) {
                    return errorResponse(`Folder '${folderId}' not found.`);
                }
                const job = normalizeJob({
                    id: jobId,
                    name: ensureString(args.name, "name"),
                    cronExpression: ensureString(args.cronExpression, "cronExpression"),
                    folderId,
                    paused: args.paused === true,
                    nodes: [],
                });
                config.jobs = Array.isArray(config.jobs) ? config.jobs : [];
                config.jobs.push(job);
                context.writeConfig(config);
                return textResponse({ message: `Job '${jobId}' created.`, job: summarizeJob(config, job) });
            }

            case "scheduler_update_job": {
                const jobId = ensureString(args.jobId, "jobId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const folderId = typeof args.folderId === "string"
                    ? args.folderId.trim() || undefined
                    : job.folderId;
                if (folderId && !getSchedulerFolder(config, folderId)) {
                    return errorResponse(`Folder '${folderId}' not found.`);
                }
                const nextJob = normalizeJob({
                    ...job,
                    id: job.id,
                    name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : job.name,
                    cronExpression: typeof args.cronExpression === "string" && args.cronExpression.trim() ? args.cronExpression.trim() : job.cronExpression,
                    folderId,
                    paused: typeof args.paused === "boolean" ? args.paused : job.paused,
                    nodes: Array.isArray(job.nodes) ? job.nodes : [],
                    createdAt: job.createdAt,
                    archived: job.archived,
                    archivedAt: job.archivedAt,
                    lastCompiledTaskId: job.lastCompiledTaskId,
                    runtime: job.runtime,
                });
                const index = config.jobs.findIndex((entry) => entry.id === jobId);
                config.jobs[index] = nextJob;
                context.writeConfig(config);
                return textResponse({ message: `Job '${jobId}' updated.`, job: summarizeJob(config, nextJob) });
            }

            case "scheduler_delete_job": {
                const jobId = ensureString(args.jobId, "jobId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                if (Array.isArray(config.tasks)) {
                    for (const task of config.tasks) {
                        if (task.jobId === jobId) {
                            task.jobId = undefined;
                            task.jobNodeId = undefined;
                        }
                    }
                }
                config.jobs = config.jobs.filter((entry) => entry.id !== jobId);
                context.writeConfig(config);
                return textResponse({ message: `Job '${jobId}' deleted.`, jobId });
            }

            case "scheduler_duplicate_job": {
                const jobId = ensureString(args.jobId, "jobId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const duplicateJobId = typeof args.newJobId === "string" && args.newJobId.trim()
                    ? args.newJobId.trim()
                    : createId("job");
                if (getSchedulerJob(config, duplicateJobId)) {
                    return errorResponse(`Job '${duplicateJobId}' already exists.`);
                }

                const duplicateNodes: any[] = [];
                const duplicatedTasks: SchedulerTask[] = [];
                for (const node of Array.isArray(job.nodes) ? job.nodes : []) {
                    if (node?.type === "pause") {
                        duplicateNodes.push({
                            id: createId("jobpause"),
                            type: "pause",
                            title: node.title || "Manual review",
                        });
                        continue;
                    }

                    const sourceTask = getSchedulerTask(config, node.taskId);
                    if (!sourceTask) {
                        continue;
                    }

                    const duplicatedTaskId = createId("task");
                    const duplicatedTask: SchedulerTask = {
                        ...sourceTask,
                        id: duplicatedTaskId,
                        name: typeof sourceTask.name === "string" && sourceTask.name.trim()
                            ? `${sourceTask.name} (Copy)`
                            : duplicatedTaskId,
                        enabled: false,
                        jobId: duplicateJobId,
                        jobNodeId: undefined,
                        createdAt: nowIso(),
                        updatedAt: nowIso(),
                    };
                    duplicatedTasks.push(duplicatedTask);
                    duplicateNodes.push({
                        id: createId("jobnode"),
                        type: "task",
                        taskId: duplicatedTaskId,
                        windowMinutes: Number.isFinite(Number(node.windowMinutes)) ? Math.max(1, Math.floor(Number(node.windowMinutes))) : 30,
                    });
                }

                const duplicate = normalizeJob({
                    ...job,
                    id: duplicateJobId,
                    name: typeof args.name === "string" && args.name.trim() ? args.name.trim() : `${job.name} (Copy)`,
                    paused: true,
                    nodes: duplicateNodes,
                    createdAt: nowIso(),
                    updatedAt: nowIso(),
                    archived: false,
                    archivedAt: undefined,
                    lastCompiledTaskId: undefined,
                    runtime: undefined,
                });
                config.jobs.push(duplicate);
                if (duplicatedTasks.length > 0) {
                    config.tasks.push(...duplicatedTasks);
                }
                context.writeConfig(config);
                return textResponse({ message: `Job '${jobId}' duplicated as '${duplicateJobId}'.`, job: summarizeJob(config, duplicate) });
            }

            case "scheduler_list_job_folders": {
                const folders = Array.isArray(config.jobFolders) ? config.jobFolders : [];
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    folderCount: folders.length,
                    jobFolders: folders,
                });
            }

            case "scheduler_create_job_folder": {
                const folderId = typeof args.folderId === "string" && args.folderId.trim() ? args.folderId.trim() : createId("jobfolder");
                if (getSchedulerFolder(config, folderId)) {
                    return errorResponse(`Folder '${folderId}' already exists.`);
                }
                const folder = {
                    id: folderId,
                    name: ensureString(args.name, "name"),
                    parentId: typeof args.parentId === "string" && args.parentId.trim() ? args.parentId.trim() : undefined,
                    createdAt: nowIso(),
                    updatedAt: nowIso(),
                };
                if (folder.parentId && !getSchedulerFolder(config, folder.parentId)) {
                    return errorResponse(`Parent folder '${folder.parentId}' not found.`);
                }
                config.jobFolders = Array.isArray(config.jobFolders) ? config.jobFolders : [];
                config.jobFolders.push(folder);
                context.writeConfig(config);
                return textResponse({ message: `Folder '${folderId}' created.`, folder });
            }

            case "scheduler_update_job_folder": {
                const folderId = ensureString(args.folderId, "folderId");
                const folder = getSchedulerFolder(config, folderId);
                if (!folder) {
                    return errorResponse(`Folder '${folderId}' not found.`);
                }
                const parentId = typeof args.parentId === "string"
                    ? args.parentId.trim() || undefined
                    : folder.parentId;
                if (parentId && parentId !== folderId && !getSchedulerFolder(config, parentId)) {
                    return errorResponse(`Parent folder '${parentId}' not found.`);
                }
                folder.name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : folder.name;
                folder.parentId = parentId;
                folder.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Folder '${folderId}' updated.`, folder });
            }

            case "scheduler_delete_job_folder": {
                const folderId = ensureString(args.folderId, "folderId");
                const folder = getSchedulerFolder(config, folderId);
                if (!folder) {
                    return errorResponse(`Folder '${folderId}' not found.`);
                }
                const childFolders = Array.isArray(config.jobFolders)
                    ? config.jobFolders.filter((entry) => entry.parentId === folderId)
                    : [];
                const attachedJobs = Array.isArray(config.jobs)
                    ? config.jobs.filter((job) => job.folderId === folderId)
                    : [];
                if (childFolders.length > 0 || attachedJobs.length > 0) {
                    return errorResponse(`Folder '${folderId}' is not empty.`);
                }
                config.jobFolders = config.jobFolders.filter((entry) => entry.id !== folderId);
                context.writeConfig(config);
                return textResponse({ message: `Folder '${folderId}' deleted.`, folderId });
            }

            case "scheduler_add_job_task": {
                const jobId = ensureString(args.jobId, "jobId");
                const taskId = ensureString(args.taskId, "taskId");
                const job = getSchedulerJob(config, jobId);
                const task = getSchedulerTask(config, taskId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                if (!task) {
                    return errorResponse(`Task '${taskId}' not found.`);
                }
                const windowMinutes = Number.isFinite(Number(args.windowMinutes)) ? Math.max(1, Math.floor(Number(args.windowMinutes))) : 30;
                config.jobs = Array.isArray(config.jobs) ? config.jobs : [];
                config.tasks = Array.isArray(config.tasks) ? config.tasks : [];

                if (typeof task.jobId === "string" && task.jobId && task.jobId !== jobId) {
                    const previousJob = getSchedulerJob(config, task.jobId);
                    if (previousJob && Array.isArray(previousJob.nodes)) {
                        previousJob.nodes = previousJob.nodes.filter((node: any) => node?.taskId !== taskId);
                        previousJob.updatedAt = nowIso();
                    }
                }

                let node = Array.isArray(job.nodes)
                    ? job.nodes.find((entry: any) => entry && entry.type !== "pause" && entry.taskId === taskId)
                    : undefined;
                if (!node) {
                    node = {
                        id: createId("jobnode"),
                        type: "task",
                        taskId,
                        windowMinutes,
                    };
                    job.nodes = Array.isArray(job.nodes) ? job.nodes : [];
                    job.nodes.push(node);
                } else {
                    node.windowMinutes = windowMinutes;
                }

                task.jobId = jobId;
                task.jobNodeId = node.id;
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Task '${taskId}' attached to job '${jobId}'.`, job: summarizeJob(config, job) });
            }

            case "scheduler_remove_job_task": {
                const jobId = ensureString(args.jobId, "jobId");
                const nodeId = ensureString(args.nodeId, "nodeId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const nodeIndex = Array.isArray(job.nodes)
                    ? job.nodes.findIndex((entry: any) => entry && entry.id === nodeId)
                    : -1;
                if (nodeIndex < 0) {
                    return errorResponse(`Node '${nodeId}' not found.`);
                }
                const [removed] = job.nodes.splice(nodeIndex, 1);
                if (removed?.taskId) {
                    const task = getSchedulerTask(config, removed.taskId);
                    if (task) {
                        task.jobId = undefined;
                        task.jobNodeId = undefined;
                    }
                }
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Node '${nodeId}' removed from job '${jobId}'.`, job: summarizeJob(config, job) });
            }

            case "scheduler_create_job_pause": {
                const jobId = ensureString(args.jobId, "jobId");
                const title = ensureString(args.title, "title");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const node = {
                    id: createId("jobpause"),
                    type: "pause",
                    title,
                };
                job.nodes = Array.isArray(job.nodes) ? job.nodes : [];
                job.nodes.push(node);
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Pause checkpoint added to job '${jobId}'.`, job: summarizeJob(config, job) });
            }

            case "scheduler_update_job_pause": {
                const jobId = ensureString(args.jobId, "jobId");
                const nodeId = ensureString(args.nodeId, "nodeId");
                const title = ensureString(args.title, "title");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const node = Array.isArray(job.nodes) ? job.nodes.find((entry: any) => entry && entry.id === nodeId && entry.type === "pause") : undefined;
                if (!node) {
                    return errorResponse(`Pause node '${nodeId}' not found.`);
                }
                node.title = title;
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Pause '${nodeId}' updated.`, job: summarizeJob(config, job) });
            }

            case "scheduler_delete_job_pause": {
                const jobId = ensureString(args.jobId, "jobId");
                const nodeId = ensureString(args.nodeId, "nodeId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const before = Array.isArray(job.nodes) ? job.nodes.length : 0;
                job.nodes = Array.isArray(job.nodes)
                    ? job.nodes.filter((entry: any) => !(entry && entry.id === nodeId && entry.type === "pause"))
                    : [];
                if (job.nodes.length === before) {
                    return errorResponse(`Pause node '${nodeId}' not found.`);
                }
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Pause '${nodeId}' deleted.`, job: summarizeJob(config, job) });
            }

            case "scheduler_update_job_node_window": {
                const jobId = ensureString(args.jobId, "jobId");
                const nodeId = ensureString(args.nodeId, "nodeId");
                const windowMinutes = Number.isFinite(Number(args.windowMinutes)) ? Math.max(1, Math.floor(Number(args.windowMinutes))) : 30;
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const node = Array.isArray(job.nodes)
                    ? job.nodes.find((entry: any) => entry && entry.id === nodeId && entry.type !== "pause")
                    : undefined;
                if (!node) {
                    return errorResponse(`Node '${nodeId}' not found.`);
                }
                node.windowMinutes = windowMinutes;
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Node '${nodeId}' window updated.`, job: summarizeJob(config, job) });
            }

            case "scheduler_reorder_job_node": {
                const jobId = ensureString(args.jobId, "jobId");
                const nodeId = ensureString(args.nodeId, "nodeId");
                const targetIndex = Number.isFinite(Number(args.targetIndex)) ? Math.floor(Number(args.targetIndex)) : 0;
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }
                const nodes = Array.isArray(job.nodes) ? job.nodes : [];
                const currentIndex = nodes.findIndex((entry: any) => entry && entry.id === nodeId);
                if (currentIndex < 0) {
                    return errorResponse(`Node '${nodeId}' not found.`);
                }
                const [node] = nodes.splice(currentIndex, 1);
                const clampedIndex = Math.max(0, Math.min(targetIndex, nodes.length));
                nodes.splice(clampedIndex, 0, node);
                job.nodes = nodes;
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Node '${nodeId}' moved.`, job: summarizeJob(config, job) });
            }

            case "scheduler_compile_job_to_task": {
                const jobId = ensureString(args.jobId, "jobId");
                const job = getSchedulerJob(config, jobId);
                if (!job) {
                    return errorResponse(`Job '${jobId}' not found.`);
                }

                const sections = [
                    `Job: ${job.name}`,
                    "Execute the following workflow as one combined task. Keep the sections in order and preserve explicit checkpoints before continuing.",
                ];
                const labels = new Set<string>([job.name, "bundled-task"]);
                let taskCount = 0;
                let pauseCount = 0;
                let agent: string | undefined;
                let model: string | undefined;

                for (const node of Array.isArray(job.nodes) ? job.nodes : []) {
                    if (node?.type === "pause") {
                        pauseCount += 1;
                        sections.push(
                            `Checkpoint ${pauseCount}: ${node.title}`,
                            "Review the immediately previous section before continuing to the next one.",
                        );
                        continue;
                    }

                    const task = getSchedulerTask(config, node.taskId);
                    if (!task) {
                        continue;
                    }

                    taskCount += 1;
                    if (!agent && task.agent) {
                        agent = task.agent;
                    }
                    if (!model && task.model) {
                        model = task.model;
                    }
                    if (Array.isArray(task.labels)) {
                        for (const label of task.labels) {
                            labels.add(label);
                        }
                    }

                    sections.push(
                        `Step ${taskCount}: ${task.name}`,
                        task.prompt,
                    );
                }

                const taskId = createId("task");
                const bundledTask: SchedulerTask = {
                    id: taskId,
                    name: "Bundled Task",
                    description: `Compiled from job ${job.name}`,
                    cron: job.cronExpression,
                    prompt: sections.join("\n\n"),
                    enabled: job.paused !== true,
                    oneTime: false,
                    chatSession: undefined,
                    agent,
                    model,
                    promptSource: "inline",
                    promptPath: undefined,
                    promptBackupPath: undefined,
                    promptBackupUpdatedAt: undefined,
                    jitterSeconds: 0,
                    workspacePath: context.workspaceRoot,
                    labels: Array.from(labels),
                    createdAt: nowIso(),
                    updatedAt: nowIso(),
                };
                config.tasks.push(bundledTask);
                job.folderId = getSchedulerFolder(config, job.folderId || "")?.id || job.folderId;
                job.paused = true;
                job.archived = true;
                job.archivedAt = nowIso();
                job.lastCompiledTaskId = taskId;
                job.updatedAt = nowIso();
                context.writeConfig(config);
                return textResponse({ message: `Job '${jobId}' compiled into task '${taskId}'.`, job: summarizeJob(config, job), task: bundledTask });
            }

            case "cockpit_get_board": {
                const board = getCockpitBoard(config);
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    sectionCount: Array.isArray(board.sections) ? board.sections.length : 0,
                    cardCount: Array.isArray(board.cards) ? board.cards.length : 0,
                    board: {
                        ...board,
                        cards: Array.isArray(board.cards)
                            ? board.cards.map((card: any) => summarizeCockpitTodo(board, card))
                            : [],
                    },
                });
            }

            case "cockpit_list_todos": {
                const board = getCockpitBoard(config);
                const sectionId = typeof args.sectionId === "string" ? args.sectionId.trim() : "";
                const label = typeof args.label === "string" ? args.label.trim() : "";
                const includeArchived = args.includeArchived === true;
                const cards = Array.isArray(board.cards)
                    ? board.cards.filter((card: any) => {
                        if (!includeArchived && card.archived === true) {
                            return false;
                        }
                        if (sectionId && card.sectionId !== sectionId) {
                            return false;
                        }
                        if (label && !(Array.isArray(card.labels) && card.labels.includes(label))) {
                            return false;
                        }
                        return true;
                    })
                    : [];
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    cardCount: cards.length,
                    cards: cards.map((card: any) => summarizeCockpitTodo(board, card)),
                });
            }

            case "cockpit_get_todo": {
                const board = getCockpitBoard(config);
                const todoId = ensureString(args.todoId, "todoId");
                const todo = getCockpitTodo(board, todoId);
                if (!todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                return textResponse(summarizeCockpitTodo(board, todo));
            }

            case "cockpit_list_routing_cards": {
                const board = getCockpitBoard(config);
                const signals = Array.isArray(args.signals)
                    ? args.signals.filter((entry): entry is string => typeof entry === "string")
                    : DEFAULT_ROUTING_SIGNALS;
                const cards = listCockpitRoutingCards(board, {
                    signals,
                    includeArchived: args.includeArchived !== false,
                });
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    routingSignals: signals,
                    cardCount: cards.length,
                    cards,
                });
            }

            case "cockpit_create_todo": {
                const board = getCockpitBoard(config);
                const result = createTodoInBoard(board, {
                    id: typeof args.todoId === "string" ? args.todoId : undefined,
                    title: ensureString(args.title, "title"),
                    description: typeof args.description === "string" ? args.description : undefined,
                    sectionId: typeof args.sectionId === "string" ? args.sectionId : undefined,
                    dueAt: typeof args.dueAt === "string" ? args.dueAt : undefined,
                    priority: normalizeTodoPriority(args.priority),
                    labels: normalizeStringList(args.labels),
                    flags: normalizeStringList(args.flags),
                    comment: typeof args.comment === "string" ? args.comment : undefined,
                    author: args.author === "user" ? "user" : "system",
                    commentSource: typeof args.commentSource === "string" ? args.commentSource : undefined,
                    status: typeof args.status === "string" ? args.status : undefined,
                    taskId: typeof args.taskId === "string" ? args.taskId : undefined,
                    sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
                });
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${result.todo.id}' created.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_add_todo_comment": {
                const board = getCockpitBoard(config);
                const todoId = ensureString(args.todoId, "todoId");
                const result = addTodoCommentInBoard(board, todoId, {
                    body: ensureString(args.body, "body"),
                    author: args.author === "user" ? "user" : "system",
                    source: typeof args.source === "string" ? args.source : undefined,
                    labels: normalizeStringList(args.labels),
                });
                if (!result.todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Comment added to Cockpit todo '${todoId}'.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_approve_todo": {
                const todoId = ensureString(args.todoId, "todoId");
                const result = approveTodoInBoard(getCockpitBoard(config), todoId);
                if (!result.todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${todoId}' approved.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_finalize_todo": {
                const todoId = ensureString(args.todoId, "todoId");
                const result = finalizeTodoInBoard(getCockpitBoard(config), todoId);
                if (!result.todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${todoId}' finalized as completed.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_reject_todo": {
                const todoId = ensureString(args.todoId, "todoId");
                const result = rejectTodoInBoard(getCockpitBoard(config), todoId);
                if (!result.todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${todoId}' rejected.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_update_todo": {
                const todoId = ensureString(args.todoId, "todoId");
                const result = updateTodoInBoard(getCockpitBoard(config), todoId, {
                    title: typeof args.title === "string" ? args.title : undefined,
                    description: typeof args.description === "string" ? args.description : undefined,
                    sectionId: typeof args.sectionId === "string" ? args.sectionId : undefined,
                    dueAt: typeof args.dueAt === "string" ? args.dueAt : undefined,
                    priority: normalizeTodoPriority(args.priority),
                    status: typeof args.status === "string" ? args.status : undefined,
                    labels: normalizeStringList(args.labels),
                    flags: normalizeStringList(args.flags),
                    order: Number.isFinite(Number(args.order)) ? Number(args.order) : undefined,
                    taskId: typeof args.taskId === "string" ? args.taskId : undefined,
                    sessionId: typeof args.sessionId === "string" ? args.sessionId : undefined,
                    archived: typeof args.archived === "boolean" ? args.archived : undefined,
                    archiveOutcome: typeof args.archiveOutcome === "string" ? args.archiveOutcome : undefined,
                });
                if (!result.todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${todoId}' updated.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_closeout_todo": {
                const result = closeoutCockpitTodo(config, args);
                if (result.error) {
                    return errorResponse(result.error);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${result.todoId}' closeout applied.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                    requestedSectionId: result.requestedSectionId,
                    requestedSectionFound: result.requestedSectionFound,
                    checkedTaskId: result.checkedTaskId,
                    linkedTaskExists: result.linkedTaskExists,
                    staleTaskIdCleared: result.staleTaskIdCleared,
                    commentAdded: result.commentAdded,
                });
            }

            case "cockpit_delete_todo": {
                const todoId = ensureString(args.todoId, "todoId");
                const result = deleteTodoInBoard(getCockpitBoard(config), todoId);
                if (!result.deleted) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${todoId}' deleted.`,
                    todoId,
                });
            }

            case "cockpit_move_todo": {
                const todoId = ensureString(args.todoId, "todoId");
                const result = moveTodoInBoard(
                    getCockpitBoard(config),
                    todoId,
                    typeof args.sectionId === "string" ? args.sectionId : undefined,
                    Number.isFinite(Number(args.targetIndex)) ? Number(args.targetIndex) : 0,
                );
                if (!result.todo) {
                    return errorResponse(`Cockpit todo '${todoId}' not found.`);
                }
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Cockpit todo '${todoId}' moved.`,
                    todo: summarizeCockpitTodo(result.board, result.todo),
                });
            }

            case "cockpit_set_filters": {
                const board = setCockpitBoardFiltersInBoard(getCockpitBoard(config), {
                    searchText: typeof args.searchText === "string" ? args.searchText : undefined,
                    labels: normalizeStringList(args.labels),
                    priorities: Array.isArray(args.priorities)
                        ? args.priorities.map((entry: unknown) => normalizeTodoPriority(entry)).filter((entry: string) => entry !== "none")
                        : undefined,
                    statuses: Array.isArray(args.statuses)
                        ? args.statuses.filter((entry: unknown): entry is string => typeof entry === "string")
                        : undefined,
                    archiveOutcomes: Array.isArray(args.archiveOutcomes)
                        ? args.archiveOutcomes.filter((entry: unknown): entry is string => typeof entry === "string")
                        : undefined,
                    flags: normalizeStringList(args.flags),
                    sectionId: typeof args.sectionId === "string" ? args.sectionId : undefined,
                    sortBy: typeof args.sortBy === "string" ? args.sortBy : undefined,
                    sortDirection: typeof args.sortDirection === "string" ? args.sortDirection : undefined,
                    viewMode: typeof args.viewMode === "string" ? args.viewMode : undefined,
                    showArchived: typeof args.showArchived === "boolean" ? args.showArchived : undefined,
                    showRecurringTasks: typeof args.showRecurringTasks === "boolean" ? args.showRecurringTasks : undefined,
                    hideCardDetails: typeof args.hideCardDetails === "boolean" ? args.hideCardDetails : undefined,
                });
                config.cockpitBoard = board;
                context.writeConfig(config);
                return textResponse({
                    message: "Cockpit Todo filters updated.",
                    filters: board.filters,
                });
            }

            case "cockpit_seed_todos_from_tasks": {
                const selectedTaskIds = Array.isArray(args.taskIds)
                    ? new Set(args.taskIds.filter((entry: unknown): entry is string => typeof entry === "string" && entry.trim()).map((entry: string) => entry.trim()))
                    : undefined;
                const tasks = selectedTaskIds
                    ? config.tasks.filter((task) => selectedTaskIds.has(task.id))
                    : config.tasks;
                const result = ensureTaskTodosInBoard(getCockpitBoard(config), tasks as any);
                config.cockpitBoard = result.board;
                context.writeConfig(config);
                return textResponse({
                    message: `Seeded ${result.createdTodoIds.length} task-linked todo cards.`,
                    createdTodoIds: result.createdTodoIds,
                    board: {
                        ...result.board,
                        cards: result.board.cards.map((card: any) => summarizeCockpitTodo(result.board, card)),
                    },
                });
            }

            case "cockpit_save_label_definition": {
                const name = ensureString(args.name, "name");
                const color = typeof args.color === "string" ? args.color.trim() || undefined : undefined;
                const result = saveCockpitTodoLabelDefinition(context.workspaceRoot, { name, color });
                config.cockpitBoard = result.board;
                return textResponse({ message: `Label definition '${name}' saved.` });
            }

            case "cockpit_delete_label_definition": {
                const name = ensureString(args.name, "name");
                const board = deleteCockpitTodoLabelDefinition(context.workspaceRoot, name);
                config.cockpitBoard = board;
                return textResponse({ message: `Label definition '${name}' removed.` });
            }

            case "cockpit_save_flag_definition": {
                const name = ensureString(args.name, "name");
                const color = typeof args.color === "string" ? args.color.trim() || undefined : undefined;
                const result = saveCockpitFlagDefinition(context.workspaceRoot, { name, color });
                config.cockpitBoard = result.board;
                return textResponse({ message: `Flag definition '${name}' saved.` });
            }

            case "cockpit_delete_flag_definition": {
                const name = ensureString(args.name, "name");
                const board = deleteCockpitFlagDefinition(context.workspaceRoot, name);
                config.cockpitBoard = board;
                return textResponse({ message: `Flag definition '${name}' removed.` });
            }

            case "research_list_profiles": {
                const researchConfig = readResearchConfig(context.workspaceRoot);
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    profileCount: researchConfig.profiles.length,
                    profiles: researchConfig.profiles,
                });
            }

            case "research_get_profile": {
                const researchId = ensureString(args.researchId, "researchId");
                const researchConfig = readResearchConfig(context.workspaceRoot);
                const profile = researchConfig.profiles.find((entry: any) => entry && entry.id === researchId);
                if (!profile) {
                    return errorResponse(`Research profile '${researchId}' not found.`);
                }
                return textResponse(profile);
            }

            case "research_create_profile": {
                const researchConfig = readResearchConfig(context.workspaceRoot);
                const profile = normalizeResearchProfile(args.researchData);
                profile.id = createId("research");
                profile.createdAt = nowIso();
                profile.updatedAt = profile.createdAt;
                researchConfig.profiles.push(profile);
                writeResearchConfig(context.workspaceRoot, researchConfig);
                return textResponse({ message: `Research profile '${profile.id}' created.`, profile });
            }

            case "research_update_profile": {
                const researchId = ensureString(args.researchId, "researchId");
                const researchConfig = readResearchConfig(context.workspaceRoot);
                const index = researchConfig.profiles.findIndex((entry: any) => entry && entry.id === researchId);
                if (index < 0) {
                    return errorResponse(`Research profile '${researchId}' not found.`);
                }
                const profile = normalizeResearchProfile({
                    ...researchConfig.profiles[index],
                    ...asObject(args.researchData),
                    id: researchId,
                    createdAt: researchConfig.profiles[index].createdAt,
                });
                profile.id = researchId;
                profile.createdAt = researchConfig.profiles[index].createdAt;
                profile.updatedAt = nowIso();
                researchConfig.profiles[index] = profile;
                writeResearchConfig(context.workspaceRoot, researchConfig);
                return textResponse({ message: `Research profile '${researchId}' updated.`, profile });
            }

            case "research_delete_profile": {
                const researchId = ensureString(args.researchId, "researchId");
                const researchConfig = readResearchConfig(context.workspaceRoot);
                const before = researchConfig.profiles.length;
                researchConfig.profiles = researchConfig.profiles.filter((entry: any) => entry && entry.id !== researchId);
                if (researchConfig.profiles.length === before) {
                    return errorResponse(`Research profile '${researchId}' not found.`);
                }
                writeResearchConfig(context.workspaceRoot, researchConfig);
                return textResponse({ message: `Research profile '${researchId}' deleted.`, researchId });
            }

            case "research_duplicate_profile": {
                const researchId = ensureString(args.researchId, "researchId");
                const researchConfig = readResearchConfig(context.workspaceRoot);
                const profile = researchConfig.profiles.find((entry: any) => entry && entry.id === researchId);
                if (!profile) {
                    return errorResponse(`Research profile '${researchId}' not found.`);
                }
                const duplicateId = createId("research");
                const duplicate = {
                    ...profile,
                    id: duplicateId,
                    name: typeof profile.name === "string" && profile.name.trim() ? `${profile.name} Copy` : "Research Copy",
                    createdAt: nowIso(),
                    updatedAt: nowIso(),
                };
                researchConfig.profiles.push(duplicate);
                writeResearchConfig(context.workspaceRoot, researchConfig);
                return textResponse({ message: `Research profile '${researchId}' duplicated as '${duplicateId}'.`, profile: duplicate });
            }

            case "research_list_runs": {
                const researchConfig = readResearchConfig(context.workspaceRoot);
                return textResponse({
                    workspaceRoot: context.workspaceRoot,
                    runCount: researchConfig.runs.length,
                    runs: researchConfig.runs,
                    activeRun: researchConfig.runs.find((run: any) => run && (run.status === "running" || run.status === "stopping")),
                });
            }

            case "research_get_run": {
                const runId = ensureString(args.runId, "runId");
                const researchConfig = readResearchConfig(context.workspaceRoot);
                const run = researchConfig.runs.find((entry: any) => entry && entry.id === runId);
                if (!run) {
                    return errorResponse(`Research run '${runId}' not found.`);
                }
                return textResponse(run);
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
