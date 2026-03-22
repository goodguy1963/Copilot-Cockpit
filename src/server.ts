// @ts-nocheck
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as fs from "fs";
import * as path from "path";
import { findWorkspaceRoot, readSchedulerConfig, writeSchedulerConfig } from "./schedulerJsonSanitizer.js";

// Determine absolute workspace root efficiently instead of guessing
const WORKSPACE_ROOT = findWorkspaceRoot(process.cwd());

// Interface for tasks in JSON file
interface SchedulerConfig {
    tasks: {
        id: string;
        cron: string;
        prompt: string;
        enabled?: boolean;
        runNow?: boolean;
        oneTime?: boolean;
    }[];
}

// Create server instance
const server = new Server(
    {
        name: "scheduler-mcp",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// Helper to read config
function readConfig(): SchedulerConfig {
    return readSchedulerConfig(WORKSPACE_ROOT) as SchedulerConfig;
}

// Helper to write config
function writeConfig(config: SchedulerConfig) {
    writeSchedulerConfig(WORKSPACE_ROOT, config);
}

// Tool Definitions
const LIST_TASKS_TOOL = {
    name: "scheduler_list_tasks",
    description: "List all scheduled tasks and their status",
    inputSchema: {
        type: "object",
        properties: {},
    },
};

const ADD_TASK_TOOL = {
    name: "scheduler_add_task",
    description: "Add a new scheduled task or update an existing one",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", description: "Unique identifier for the task" },
            cron: { type: "string", description: "Cron expression for the schedule" },
            prompt: { type: "string", description: "The prompt instructions to execute" },
            enabled: { type: "boolean", description: "Whether the task is enabled (default: true)" },
            oneTime: { type: "boolean", description: "Whether to run this task once and then remove it" },
        },
        required: ["id", "cron", "prompt"],
    },
};

const REMOVE_TASK_TOOL = {
    name: "scheduler_remove_task",
    description: "Remove a scheduled task by ID",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", description: "ID of the task to remove" },
        },
        required: ["id"],
    },
};

const RUN_TASK_TOOL = {
    name: "scheduler_run_task",
    description: "Trigger a scheduled task to run immediately",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", description: "ID of the task to run" },
        },
        required: ["id"],
    },
};

const TOGGLE_TASK_TOOL = {
    name: "scheduler_toggle_task",
    description: "Enable or disable a scheduled task",
    inputSchema: {
        type: "object",
        properties: {
            id: { type: "string", description: "ID of the task to toggle" },
            enabled: { type: "boolean", description: "Set to true to enable, false to disable" },
        },
        required: ["id", "enabled"],
    },
};

// Set up Request Handlers
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            LIST_TASKS_TOOL,
            ADD_TASK_TOOL,
            REMOVE_TASK_TOOL,
            RUN_TASK_TOOL,
            TOGGLE_TASK_TOOL
        ],
    };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "scheduler_list_tasks": {
            const config = readConfig();
            if (config.tasks.length === 0) {
                return {
                    content: [{ type: "text", text: "No scheduled tasks found." }],
                };
            }

            const taskList = config.tasks.map(t =>
                `- [${t.id}] ${t.enabled !== false ? '(Active)' : '(Disabled)'} Cron: "${t.cron}" Prompt: "${t.prompt}"`
            ).join('\n');

            return {
                content: [{ type: "text", text: `Current Schedule:\n${taskList}` }],
            };
        }

        case "scheduler_add_task": {
            const { id, cron, prompt, enabled, oneTime } = request.params.arguments as any;
            const config = readConfig();
            const index = config.tasks.findIndex(t => t.id === id);

            const newTask = {
                id,
                cron,
                prompt,
                enabled: enabled !== false,
                oneTime: oneTime === true
            };

            if (index >= 0) {
                config.tasks[index] = newTask;
            } else {
                config.tasks.push(newTask);
            }

            try {
                writeConfig(config);
            } catch (e: any) {
                return {
                    content: [{ type: "text", text: `Failed to save task: ${e.message}` }],
                    isError: true
                };
            }

            return {
                content: [{ type: "text", text: `Task '${id}' saved successfully.` }],
            };
        }

        case "scheduler_remove_task": {
            const { id } = request.params.arguments as any;
            const config = readConfig();
            const initialLength = config.tasks.length;
            config.tasks = config.tasks.filter(t => t.id !== id);

            if (config.tasks.length === initialLength) {
                return {
                    content: [{ type: "text", text: `Task '${id}' not found.` }],
                    isError: true
                };
            }

            try {
                writeConfig(config);
            } catch (e: any) {
                return {
                    content: [{ type: "text", text: `Failed to remove task: ${e.message}` }],
                    isError: true
                };
            }

            return {
                content: [{ type: "text", text: `Task '${id}' removed.` }],
            };
        }

        case "scheduler_run_task": {
            const { id } = request.params.arguments as any;
            const config = readConfig();
            const task = config.tasks.find(t => t.id === id);

            if (!task) {
                return {
                    content: [{ type: "text", text: `Task '${id}' not found.` }],
                    isError: true,
                };
            }

            task.runNow = true;
            try {
                writeConfig(config);
            } catch (e: any) {
                return {
                    content: [{ type: "text", text: `Failed to trigger task: ${e.message}` }],
                    isError: true
                };
            }

            return {
                content: [{ type: "text", text: `Task '${id}' triggered for immediate execution.` }],
            };
        }

        case "scheduler_toggle_task": {
            const { id, enabled } = request.params.arguments as any;
            const config = readConfig();
            const task = config.tasks.find(t => t.id === id);

            if (!task) {
                return {
                    content: [{ type: "text", text: `Task '${id}' not found.` }],
                    isError: true,
                };
            }

            task.enabled = enabled;
            try {
                writeConfig(config);
            } catch (e: any) {
                return {
                    content: [{ type: "text", text: `Failed to toggle task: ${e.message}` }],
                    isError: true
                };
            }

            return {
                content: [{ type: "text", text: `Task '${id}' ${enabled ? 'enabled' : 'disabled'}.` }],
            };
        }

        default:
            throw new Error(`Unknown tool: ${request.params.name}`);
    }
});

// Start server
async function run() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Scheduler MCP Server running on stdio");
}

run().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
