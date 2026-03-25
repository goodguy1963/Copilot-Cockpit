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
 * Job node within a multi-step workflow.
 */
export interface JobNode {
  /** Unique node identifier */
  id: string;

  /** Task executed by this node */
  taskId: string;

  /** Time window allocated to this node in minutes */
  windowMinutes: number;
}

/**
 * Folder for organizing jobs in the Jobs tab.
 */
export interface JobFolder {
  /** Unique folder identifier */
  id: string;

  /** Folder name */
  name: string;

  /** Optional parent folder for nesting */
  parentId?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Multi-step job workflow.
 */
export interface JobDefinition {
  /** Unique job identifier */
  id: string;

  /** Job name */
  name: string;

  /** Job-level cron expression */
  cronExpression: string;

  /** Optional folder containing the job */
  folderId?: string;

  /** Whether execution is paused for all nodes in this job */
  paused?: boolean;

  /** Ordered workflow nodes */
  nodes: JobNode[];

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Repo-local scheduler config persisted in .vscode.
 */
export interface SchedulerWorkspaceConfig {
  /** Workspace tasks */
  tasks: any[];

  /** Job workflows */
  jobs?: JobDefinition[];

  /** Job folders */
  jobFolders?: JobFolder[];
}

/**
 * Optimization direction for a research metric.
 */
export type ResearchMetricDirection = "maximize" | "minimize";

/**
 * Active run status for the Research tab.
 */
export type ResearchRunStatus =
  | "idle"
  | "running"
  | "stopping"
  | "completed"
  | "failed"
  | "stopped";

/**
 * Result category for a single research attempt.
 */
export type ResearchAttemptOutcome =
  | "baseline"
  | "kept"
  | "rejected"
  | "crash"
  | "parse-error"
  | "policy-violation"
  | "stopped";

/**
 * Repo-local research profile persisted under .vscode.
 */
export interface ResearchProfile {
  /** Unique profile identifier */
  id: string;

  /** Human-readable profile name */
  name: string;

  /** Goal and mutation instructions for Copilot */
  instructions: string;

  /** Workspace-relative file allowlist */
  editablePaths: string[];

  /** Benchmark command to execute */
  benchmarkCommand: string;

  /** Regex used to extract the numeric score */
  metricPattern: string;

  /** Whether bigger or smaller is better */
  metricDirection: ResearchMetricDirection;

  /** Maximum bounded iterations after the baseline */
  maxIterations: number;

  /** Maximum wall-clock runtime in minutes */
  maxMinutes: number;

  /** Stop after this many consecutive failed attempts */
  maxConsecutiveFailures: number;

  /** Timeout for each benchmark invocation in seconds */
  benchmarkTimeoutSeconds: number;

  /** Maximum time to wait for Copilot-applied edits in seconds */
  editWaitSeconds: number;

  /** Optional task-specific agent */
  agent?: string;

  /** Optional task-specific model */
  model?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

/**
 * Input for creating a research profile.
 */
export interface CreateResearchProfileInput {
  /** Profile name */
  name: string;

  /** Goal and mutation instructions */
  instructions: string;

  /** Workspace-relative file allowlist */
  editablePaths: string[];

  /** Benchmark command to execute */
  benchmarkCommand: string;

  /** Regex used to extract the numeric score */
  metricPattern: string;

  /** Whether bigger or smaller is better */
  metricDirection: ResearchMetricDirection;

  /** Maximum bounded iterations after the baseline */
  maxIterations?: number;

  /** Maximum wall-clock runtime in minutes */
  maxMinutes?: number;

  /** Stop after this many consecutive failed attempts */
  maxConsecutiveFailures?: number;

  /** Timeout for each benchmark invocation in seconds */
  benchmarkTimeoutSeconds?: number;

  /** Maximum time to wait for Copilot-applied edits in seconds */
  editWaitSeconds?: number;

  /** Optional task-specific agent */
  agent?: string;

  /** Optional task-specific model */
  model?: string;
}

/**
 * Stored snapshot metadata for a research run.
 */
export interface ResearchSnapshotInfo {
  /** Snapshot directory name */
  id: string;

  /** Snapshot creation time */
  createdAt: string;

  /** Snapshot label */
  label: string;
}

/**
 * Single attempt in a bounded research run.
 */
export interface ResearchAttempt {
  /** Attempt identifier */
  id: string;

  /** Baseline or iteration number */
  iteration: number;

  /** Attempt start time */
  startedAt: string;

  /** Attempt end time */
  finishedAt?: string;

  /** Attempt outcome */
  outcome: ResearchAttemptOutcome;

  /** Parsed score, if available */
  score?: number;

  /** Best score after this attempt */
  bestScoreAfter?: number;

  /** Human-readable summary */
  summary?: string;

  /** Benchmark exit code */
  exitCode?: number | null;

  /** Changed allowlisted files */
  changedPaths?: string[];

  /** Newly detected external changed files */
  policyViolationPaths?: string[];

  /** Truncated benchmark output for debugging */
  output?: string;

  /** Error details */
  error?: string;

  /** Snapshot retained after this attempt */
  snapshot?: ResearchSnapshotInfo;
}

/**
 * Persisted run record for a research profile.
 */
export interface ResearchRun {
  /** Unique run identifier */
  id: string;

  /** Owning profile */
  profileId: string;

  /** Cached profile name for history rendering */
  profileName: string;

  /** Current run status */
  status: ResearchRunStatus;

  /** Run start time */
  startedAt: string;

  /** Run end time */
  finishedAt?: string;

  /** Baseline score if it could be computed */
  baselineScore?: number;

  /** Current best score */
  bestScore?: number;

  /** Completed bounded iterations excluding the baseline */
  completedIterations: number;

  /** Human-readable stop or failure reason */
  stopReason?: string;

  /** Execution log */
  attempts: ResearchAttempt[];
}

/**
 * Repo-local Research tab state persisted under .vscode.
 */
export interface ResearchWorkspaceConfig {
  /** Version number for future migrations */
  version: number;

  /** Saved research profiles */
  profiles: ResearchProfile[];

  /** Recent run records */
  runs: ResearchRun[];
}

/**
 * Input for creating a new job.
 */
export interface CreateJobInput {
  /** Job name */
  name: string;

  /** Job-level cron expression */
  cronExpression: string;

  /** Optional folder containing the job */
  folderId?: string;

  /** Whether the job starts paused */
  paused?: boolean;
}

/**
 * Input for creating a new job folder.
 */
export interface CreateJobFolderInput {
  /** Folder name */
  name: string;

  /** Optional parent folder for nesting */
  parentId?: string;
}

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

  /** Optional manual labels for filtering and organization. */
  labels?: string[];

  /** Parent job when this task is job-managed. */
  jobId?: string;

  /** Owning job node when this task is job-managed. */
  jobNodeId?: string;

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

  /** Optional manual labels for filtering and organization. */
  labels?: string[];

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
 * Discoverable skill reference for prompt insertion.
 */
export interface SkillReference {
  /** Absolute file path */
  path: string;

  /** Display name */
  name: string;

  /** Displayable relative/reference path */
  reference: string;

  /** Source bucket */
  source: "workspace" | "global";
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
  | "refresh"
  | "createJob"
  | "updateJob"
  | "deleteJob"
  | "duplicateJob"
  | "toggleJobPaused"
  | "createJobFolder"
  | "renameJobFolder"
  | "deleteJobFolder"
  | "createJobTask"
  | "attachTaskToJob"
  | "detachTaskFromJob"
  | "deleteJobTask"
  | "reorderJobNode"
  | "updateJobNodeWindow"
  | "setupMcp"
  | "createResearchProfile"
  | "updateResearchProfile"
  | "deleteResearchProfile"
  | "duplicateResearchProfile"
  | "startResearchRun"
  | "stopResearchRun";

  /** Task ID */
  taskId: string;

  /** Additional data for the action */
  data?: Partial<CreateTaskInput>;

  /** Job identifier for Jobs actions */
  jobId?: string;

  /** Folder identifier for Jobs actions */
  folderId?: string;

  /** Parent folder identifier when creating/updating folders */
  parentFolderId?: string;

  /** Job node identifier */
  nodeId?: string;

  /** Node target index when reordering */
  targetIndex?: number;

  /** Per-node window duration in minutes */
  windowMinutes?: number;

  /** Job create/update payload */
  jobData?: Partial<CreateJobInput>;

  /** Folder create/update payload */
  folderData?: Partial<CreateJobFolderInput>;

  /** Selected history snapshot identifier for restore actions */
  historyId?: string;

  /** Research profile identifier */
  researchId?: string;

  /** Research profile create/update payload */
  researchData?: Partial<CreateResearchProfileInput>;
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
  | { type: "requestCreateJob"; folderId?: string }
  | { type: "requestCreateJobFolder"; parentFolderId?: string }
  | { type: "requestRenameJobFolder"; folderId: string }
  | { type: "requestDeleteJobFolder"; folderId: string }
  | { type: "createJob"; data: CreateJobInput }
  | {
    type: "updateJob";
    jobId: string;
    data: Partial<CreateJobInput>;
  }
  | { type: "deleteJob"; jobId: string }
  | { type: "duplicateJob"; jobId: string }
  | { type: "toggleJobPaused"; jobId: string }
  | { type: "createJobFolder"; data: CreateJobFolderInput }
  | {
    type: "renameJobFolder";
    folderId: string;
    data: Partial<CreateJobFolderInput>;
  }
  | { type: "deleteJobFolder"; folderId: string }
  | { type: "requestDeleteJobTask"; jobId: string; nodeId: string }
  | {
    type: "createJobTask";
    jobId: string;
    data: CreateTaskInput;
    windowMinutes?: number;
  }
  | {
    type: "attachTaskToJob";
    jobId: string;
    taskId: string;
    windowMinutes?: number;
  }
  | { type: "detachTaskFromJob"; jobId: string; nodeId: string }
  | { type: "deleteJobTask"; jobId: string; nodeId: string }
  | {
    type: "reorderJobNode";
    jobId: string;
    nodeId: string;
    targetIndex: number;
  }
  | {
    type: "updateJobNodeWindow";
    jobId: string;
    nodeId: string;
    windowMinutes: number;
  }
  | { type: "refreshTasks" }
  | { type: "restoreScheduleHistory"; snapshotId: string }
  | { type: "toggleAutoShowOnStartup" }
  | { type: "refreshAgents" }
  | { type: "refreshPrompts" }
  | { type: "setupMcp" }
  | { type: "createResearchProfile"; data: CreateResearchProfileInput }
  | {
    type: "updateResearchProfile";
    researchId: string;
    data: Partial<CreateResearchProfileInput>;
  }
  | { type: "deleteResearchProfile"; researchId: string }
  | { type: "duplicateResearchProfile"; researchId: string }
  | { type: "startResearchRun"; researchId: string }
  | { type: "stopResearchRun" }
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
