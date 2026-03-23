/**
 * Copilot Scheduler - Type Definitions
 */

/**
 * Task scope type
 * - "global": Task runs in all workspaces
 * - "workspace": Task runs only in the specified workspace
 */
export type TaskScope = "global" | "workspace";

/**
 * Prompt source type
 * - "inline": Prompt text stored directly in task
 * - "local": Prompt loaded from workspace file
 * - "global": Prompt loaded from global templates
 */
export type PromptSource = "inline" | "local" | "global";

/**
 * Log level type
 */
export type LogLevel = "none" | "error" | "info" | "debug";

/**
 * Chat session behavior
 */
export type ChatSessionBehavior = "new" | "continue";

/**
 * Scheduled task definition
 */
export interface ScheduledTask {
  /** Unique identifier (e.g., "task_1700000000000_abc123") */
  id: string;

  /** Task name */
  name: string;

  /** Optional task description */
  description?: string;

  /** Cron expression (e.g., "0 9 * * 1-5") */
  cronExpression: string;

  /** Prompt text to send to Copilot (when promptSource is "inline") */
  prompt: string;

  /** Whether the task is enabled */
  enabled: boolean;

  /** Agent to use (@workspace, @terminal, agent, ask, edit, etc.) */
  agent?: string;

  /** AI model to use (gpt-4o, claude-sonnet-4, etc.) */
  model?: string;

  /** Task scope */
  scope: TaskScope;

  /** Workspace path (when scope is "workspace") */
  workspacePath?: string;

  /** Prompt source type */
  promptSource: PromptSource;

  /** Path to prompt file (when promptSource is not "inline") */
  promptPath?: string;

  /** Workspace-relative path to backup-only prompt export for recurring inline tasks. */
  promptBackupPath?: string;

  /** Timestamp of the last successful backup sync. */
  promptBackupUpdatedAt?: Date;

  /** Max random delay in seconds applied before execution (0 = off). */
  jitterSeconds?: number;

  /** Whether task should execute once and then be removed. */
  oneTime?: boolean;

  /** Per-task chat session behavior for recurring tasks. */
  chatSession?: ChatSessionBehavior;

  /** Last execution time */
  lastRun?: Date;

  /** Last execution error message */
  lastError?: string;

  /** Timestamp of last execution error */
  lastErrorAt?: Date;

  /** Next scheduled execution time */
  nextRun?: Date;

  /** Creation timestamp */
  createdAt: Date;

  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Input for creating a new task
 */
export interface CreateTaskInput {
  /** Task name */
  name: string;

  /** Optional task description */
  description?: string;

  /** Cron expression */
  cronExpression: string;

  /** Prompt text */
  prompt: string;

  /** Whether the task is enabled (default: true) */
  enabled?: boolean;

  /** Whether task should execute once and then be removed. */
  oneTime?: boolean;

  /** Per-task chat session behavior for recurring tasks. */
  chatSession?: ChatSessionBehavior;

  /** Agent to use */
  agent?: string;

  /** AI model to use */
  model?: string;

  /** Task scope (default: "workspace") */
  scope?: TaskScope;

  /**
   * Whether to schedule the first execution soon after creation.
   * Despite the legacy name, the actual delay is FIRST_RUN_DELAY_MINUTES (3 min).
   * Kept as-is to avoid breaking the Webview ↔ Extension message contract.
   */
  runFirstInOneMinute?: boolean;

  /** Prompt source type (default: "inline") */
  promptSource?: PromptSource;

  /** Path to prompt file */
  promptPath?: string;

  /** Max random delay in seconds applied before execution (0 = off; undefined = use configured default). */
  jitterSeconds?: number;
}

/**
 * Agent definition
 */
export interface AgentInfo {
  /** Agent ID (e.g., "@workspace", "agent") */
  id: string;

  /** Display name */
  name: string;

  /** Description */
  description: string;

  /** Whether this is a custom agent */
  isCustom: boolean;

  /** File path for custom agents */
  filePath?: string;
}

/**
 * Model definition
 */
export interface ModelInfo {
  /** Model ID (e.g., "gpt-4o") */
  id: string;

  /** Display name */
  name: string;

  /** Description */
  description: string;

  /** Vendor name */
  vendor: string;
}

/**
 * Prompt template definition
 */
export interface PromptTemplate {
  /** Template file path */
  path: string;

  /** Template name (derived from filename) */
  name: string;

  /** Source type */
  source: "local" | "global";

  /** File content (loaded on demand) */
  content?: string;
}

/**
 * Repo-local scheduler history snapshot
 */
export interface ScheduleHistoryEntry {
  /** Snapshot identifier */
  id: string;

  /** Creation timestamp */
  createdAt: string;

  /** Whether a private snapshot file exists */
  hasPrivate: boolean;
}

/**
 * Cron preset definition
 */
export interface CronPreset {
  /** Preset ID */
  id: string;

  /** Display name */
  name: string;

  /** Cron expression */
  expression: string;

  /** Description */
  description: string;
}

/**
 * Task action from Webview
 */
export interface TaskAction {
  /** Action type */
  action:
  | "run"
  | "toggle"
  | "delete"
  | "edit"
  | "copy"
  | "duplicate"
  | "moveToCurrentWorkspace"
  | "restoreHistory"
  | "refresh";

  /** Task ID */
  taskId: string;

  /** Additional data for the action */
  data?: Partial<CreateTaskInput>;

  /** Selected history snapshot identifier for restore actions */
  historyId?: string;
}

/**
 * Execute options for CopilotExecutor
 */
export interface ExecuteOptions {
  /** Agent to use */
  agent?: string;

  /** Model to use */
  model?: string;

  /** Task-level chat session override. */
  chatSession?: ChatSessionBehavior;
}

/**
 * Webview message types (Webview → Extension)
 */
export type WebviewToExtensionMessage =
  | { type: "createTask"; data: CreateTaskInput }
  | { type: "updateTask"; taskId: string; data: Partial<CreateTaskInput> }
  | { type: "testPrompt"; prompt: string; agent?: string; model?: string }
  | { type: "duplicateTask"; taskId: string }
  | { type: "refreshTasks" }
  | { type: "restoreScheduleHistory"; snapshotId: string }
  | { type: "toggleAutoShowOnStartup" }
  | { type: "refreshAgents" }
  | { type: "refreshPrompts" }
  | { type: "runTask"; taskId: string }
  | { type: "toggleTask"; taskId: string }
  | { type: "deleteTask"; taskId: string }
  | { type: "moveTaskToCurrentWorkspace"; taskId: string }
  | { type: "copyTask"; taskId: string }
  | { type: "loadPromptTemplate"; path: string; source: "local" | "global" }
  | { type: "webviewReady" };

/**
 * TreeView context values
 */
export type TreeContextValue =
  | "scopeGroup"
  | "workspaceGroup"
  | "enabledTask"
  | "disabledTask"
  | "enabledWorkspaceTask"
  | "disabledWorkspaceTask"
  | "enabledOtherWorkspaceTask"
  | "disabledOtherWorkspaceTask";
