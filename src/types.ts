/**
 * Copilot Cockpit - Type Definitions
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

export type JobNodeType = "task" | "pause";

/**
 * Executable task node within a job workflow.
 */
export interface JobTaskNode {
  /** Unique node identifier */
  id: string;

  /** Node kind. Omitted on legacy data and treated as "task". */
  type?: "task";

  /** Task executed by this node */
  taskId: string;

  /** Time window allocated to this node in minutes */
  windowMinutes: number;
}

/**
 * Manual review checkpoint within a job workflow.
 */
export interface JobPauseNode {
  /** Unique node identifier */
  id: string;

  /** Node kind */
  type: "pause";

  /** Human-readable checkpoint title */
  title: string;
}

/**
 * Job node within a multi-step workflow.
 */
export type JobNode = JobTaskNode | JobPauseNode;

/**
 * Active manual checkpoint waiting for user approval.
 */
export interface JobPauseGateState {
  /** Pause node currently blocking the workflow */
  nodeId: string;

  /** Task completed immediately before the pause */
  previousTaskId?: string;

  /** When the checkpoint became active */
  activatedAt: string;
}

/**
 * Runtime progress for a multi-step job with manual checkpoints.
 */
export interface JobRuntimeState {
  /** Current cycle anchor for the running workflow */
  cycleStartedAt?: string;

  /** Segment start used for currently schedulable steps */
  currentSegmentStartedAt?: string;

  /** Pauses already approved within the active cycle */
  approvedPauseNodeIds?: string[];

  /** Current blocking pause, if any */
  waitingPause?: JobPauseGateState;
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

  /** Whether the job was archived after being compiled to a standalone task */
  archived?: boolean;

  /** When the job was archived */
  archivedAt?: string;

  /** Most recent compiled standalone task created from this job */
  lastCompiledTaskId?: string;

  /** Active runtime checkpoint state for this job */
  runtime?: JobRuntimeState;

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

  /** Local-only cockpit board state kept in scheduler.private.json */
  cockpitBoard?: CockpitBoard;

  /** Telegram stop-notification config */
  telegramNotification?: TelegramNotificationConfig;
}

export type CockpitCommentAuthor = "user" | "system";

export type CockpitCommentSource =
  | "human-form"
  | "bot-mcp"
  | "bot-manual"
  | "system-event";

export type CockpitTodoPriority =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "urgent";

export type CockpitTodoSortBy =
  | "manual"
  | "dueAt"
  | "priority"
  | "updatedAt"
  | "createdAt";

export type CockpitTodoSortDirection = "asc" | "desc";

export type CockpitTodoViewMode = "board" | "list";

export type CockpitTodoStatus =
  | "active"
  | "ready"
  | "completed"
  | "rejected";

export type CockpitArchiveOutcome =
  | "completed-successfully"
  | "rejected";

export interface CockpitBoardSection {
  /** Unique section identifier */
  id: string;

  /** Section title shown in the board column */
  title: string;

  /** Explicit sort order for drag/drop persistence */
  order: number;

  /** Optional accent color token */
  color?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

export interface CockpitTodoComment {
  /** Unique comment identifier */
  id: string;

  /** User or system author */
  author: CockpitCommentAuthor;

  /** Comment body */
  body: string;

  /** Optional labels implied by the comment */
  labels?: string[];

  /** Whether the comment was added by a human form, MCP, bot edit, or system event */
  source: CockpitCommentSource;

  /** Stable chronological number inside a todo thread */
  sequence: number;

  /** Creation timestamp */
  createdAt: string;

  /** Optional last edit timestamp */
  updatedAt?: string;

  /** Optional edit timestamp if the text changed after creation */
  editedAt?: string;
}

export interface CockpitTaskSnapshot {
  /** Last synced task name */
  name: string;

  /** Last synced task description */
  description?: string;

  /** Last synced cron expression */
  cronExpression: string;

  /** Last synced task enabled state */
  enabled: boolean;

  /** Last synced task mode */
  oneTime: boolean;

  /** Last synced agent */
  agent?: string;

  /** Last synced model */
  model?: string;

  /** Last synced normalized labels */
  labels: string[];

  /** Last synced prompt fingerprint */
  promptHash: string;
}

export interface CockpitLabelDefinition {
  /** Canonical label name shown in the UI */
  name: string;

  /** Normalized lookup key for autocomplete and dedupe */
  key: string;

  /** Accent color stored as a CSS-compatible token */
  color: string;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

export interface CockpitTodoCard {
  /** Unique card identifier */
  id: string;

  /** Short card title */
  title: string;

  /** Optional card detail text */
  description?: string;

  /** Section containing this card */
  sectionId: string;

  /** Explicit per-section ordering */
  order: number;

  /** Priority shown on the card */
  priority: CockpitTodoPriority;

  /** Optional due date for planning and review */
  dueAt?: string;

  /** Current planning workflow state */
  status: CockpitTodoStatus;

  /** Free-form labels used for workflow routing */
  labels: string[];

  /** Additional free-form flags for board filtering */
  flags: string[];

  /** Communication trail between user and system */
  comments: CockpitTodoComment[];

  /** Last synced scheduler task metadata for recurring-task history cards */
  taskSnapshot?: CockpitTaskSnapshot;

  /** Optional linked scheduler task */
  taskId?: string;

  /** Optional linked external or chat session identifier */
  sessionId?: string;

  /** Whether the card is archived */
  archived?: boolean;

  /** Archive bucket outcome when archived */
  archiveOutcome?: CockpitArchiveOutcome;

  /** Approval timestamp when moved into ready state */
  approvedAt?: string;

  /** Completion timestamp when finalized */
  completedAt?: string;

  /** Rejection timestamp when archived as rejected */
  rejectedAt?: string;

  /** Archive timestamp for completed or rejected records */
  archivedAt?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Last update timestamp */
  updatedAt: string;
}

export interface CockpitBoardFilters {
  /** Free-text search term */
  searchText?: string;

  /** Selected label filters */
  labels: string[];

  /** Selected priority filters */
  priorities: CockpitTodoPriority[];

  /** Selected status filters */
  statuses: CockpitTodoStatus[];

  /** Selected archive outcome filters */
  archiveOutcomes: CockpitArchiveOutcome[];

  /** Selected flag filters */
  flags: string[];

  /** Optional focused section */
  sectionId?: string;

  /** Active sort mode */
  sortBy: CockpitTodoSortBy;

  /** Active sort direction */
  sortDirection: CockpitTodoSortDirection;

  /** Active cockpit view mode */
  viewMode: CockpitTodoViewMode;

  /** Whether archived cards should remain visible */
  showArchived: boolean;

  /** Whether recurring-task history cards should remain visible */
  showRecurringTasks: boolean;
}

export interface CockpitBoard {
  /** Schema version for future migrations */
  version: number;

  /** Editable board sections */
  sections: CockpitBoardSection[];

  /** Cards stored across all sections */
  cards: CockpitTodoCard[];

  /** Shared label palette for autocomplete and consistent colors */
  labelCatalog?: CockpitLabelDefinition[];

  /** Deleted label keys that should stay hidden even if older cards still reference them */
  deletedLabelCatalogKeys?: string[];

  /** Flag palette for single-value agent-state chips */
  flagCatalog?: CockpitLabelDefinition[];

  /** Deleted flag keys that should stay hidden even if older cards still reference them */
  deletedFlagCatalogKeys?: string[];

  /** Legacy archive buckets preserved only for migration from older board data */
  archives?: {
    completedSuccessfully: CockpitTodoCard[];
    rejected: CockpitTodoCard[];
  };

  /** Persisted board filters */
  filters?: CockpitBoardFilters;

  /** Last update timestamp */
  updatedAt: string;
}

export interface CreateCockpitTodoInput {
  /** Optional todo identifier override */
  id?: string;

  /** Todo title */
  title: string;

  /** Optional detail text */
  description?: string;

  /** Optional target section */
  sectionId?: string;

  /** Optional due date */
  dueAt?: string;

  /** Optional priority */
  priority?: CockpitTodoPriority;

  /** Optional labels */
  labels?: string[];

  /** Optional flags */
  flags?: string[];

  /** Optional initial comment */
  comment?: string;

  /** Optional initial comment author */
  author?: CockpitCommentAuthor;

  /** Optional initial comment source */
  commentSource?: CockpitCommentSource;

  /** Optional initial workflow state */
  status?: CockpitTodoStatus;

  /** Optional linked task identifier */
  taskId?: string;

  /** Optional linked chat/session identifier */
  sessionId?: string;
}

export interface UpdateCockpitTodoInput {
  /** Optional title update */
  title?: string;

  /** Optional description update; null clears the field */
  description?: string | null;

  /** Optional section update */
  sectionId?: string;

  /** Optional due date update; null clears the field */
  dueAt?: string | null;

  /** Optional priority update */
  priority?: CockpitTodoPriority;

  /** Optional status update */
  status?: CockpitTodoStatus;

  /** Optional labels update */
  labels?: string[];

  /** Optional flags update */
  flags?: string[];

  /** Optional order override */
  order?: number;

  /** Optional task link update; null clears the field */
  taskId?: string | null;

  /** Optional session link update; null clears the field */
  sessionId?: string | null;

  /** Optional archive state update */
  archived?: boolean;

  /** Optional archive outcome update */
  archiveOutcome?: CockpitArchiveOutcome | null;
}

export interface AddCockpitTodoCommentInput {
  /** Comment body */
  body: string;

  /** Optional author */
  author?: CockpitCommentAuthor;

  /** Optional comment source */
  source?: CockpitCommentSource;

  /** Optional comment labels */
  labels?: string[];
}

export interface UpdateCockpitBoardFiltersInput {
  /** Free-text search term */
  searchText?: string;

  /** Selected labels */
  labels?: string[];

  /** Selected priorities */
  priorities?: CockpitTodoPriority[];

  /** Selected statuses */
  statuses?: CockpitTodoStatus[];

  /** Selected archive outcomes */
  archiveOutcomes?: CockpitArchiveOutcome[];

  /** Selected flags */
  flags?: string[];

  /** Optional focused section */
  sectionId?: string | null;

  /** Whether archived cards should stay visible */
  showArchived?: boolean;

  /** Whether recurring-task history cards should stay visible */
  showRecurringTasks?: boolean;

  /** Active sort mode */
  sortBy?: CockpitTodoSortBy;

  /** Active sort direction */
  sortDirection?: CockpitTodoSortDirection;

  /** Active cockpit view mode */
  viewMode?: CockpitTodoViewMode;
}

export interface UpsertCockpitLabelDefinitionInput {
  /** Human-readable label name */
  name: string;

  /** Optional previous label or flag name when renaming */
  previousName?: string | null;

  /** Optional shared chip color */
  color?: string | null;
}

/**
 * Repo-local Telegram Stop hook notification config.
 * Stored in scheduler.private.json and sanitized in scheduler.json.
 */
export interface TelegramNotificationConfig {
  /** Whether Stop-hook notifications are enabled */
  enabled: boolean;

  /** Telegram bot token; private file only */
  botToken?: string;

  /** Telegram chat identifier */
  chatId?: string;

  /** Optional prefix prepended above the final assistant reply */
  messagePrefix?: string;

  /** Last update timestamp */
  updatedAt: string;
}

/**
 * UI-safe Telegram notification state sent to the webview.
 */
export interface TelegramNotificationView {
  /** Whether Stop-hook notifications are enabled */
  enabled: boolean;

  /** Saved Telegram chat identifier */
  chatId?: string;

  /** Optional prefix prepended above the final assistant reply */
  messagePrefix?: string;

  /** Whether a bot token is already stored privately */
  hasBotToken: boolean;

  /** Last update timestamp */
  updatedAt?: string;

  /** Whether the generated Stop hook files currently exist */
  hookConfigured: boolean;
}

/**
 * Input payload from the Settings tab.
 */
export interface SaveTelegramNotificationInput {
  /** Whether Stop-hook notifications should be enabled */
  enabled?: boolean;

  /** Telegram bot token. Optional on update when already stored privately. */
  botToken?: string;

  /** Telegram chat identifier */
  chatId?: string;

  /** Optional message prefix */
  messagePrefix?: string;
}

/**
 * Workspace-level default execution settings used when a task leaves agent/model empty.
 */
export interface ExecutionDefaultsView {
  /** Default agent identifier */
  agent: string;

  /** Default model identifier */
  model: string;
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
 * Input for creating a dedicated pause checkpoint inside a job.
 */
export interface CreateJobPauseInput {
  /** Pause title shown in the Jobs board */
  title: string;
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
  | "requestRenameJobPause"
  | "requestDeleteJobPause"
  | "createJobPause"
  | "updateJobPause"
  | "deleteJobPause"
  | "approveJobPause"
  | "rejectJobPause"
  | "reorderJobNode"
  | "updateJobNodeWindow"
  | "compileJob"
  | "setupMcp"
  | "syncBundledSkills"
  | "createResearchProfile"
  | "updateResearchProfile"
  | "deleteResearchProfile"
  | "duplicateResearchProfile"
  | "startResearchRun"
  | "stopResearchRun"
  | "saveTelegramNotification"
  | "testTelegramNotification"
  | "saveExecutionDefaults"
  | "createTodo"
  | "updateTodo"
  | "deleteTodo"
  | "purgeTodo"
  | "approveTodo"
  | "rejectTodo"
  | "finalizeTodo"
  | "archiveTodo"
  | "moveTodo"
  | "addTodoComment"
  | "setTodoFilters"
  | "saveTodoLabelDefinition"
  | "deleteTodoLabelDefinition"
  | "saveTodoFlagDefinition"
  | "deleteTodoFlagDefinition"
  | "linkTodoTask"
  | "createTaskFromTodo"
  | "addCockpitSection"
  | "renameCockpitSection"
  | "deleteCockpitSection"
  | "moveCockpitSection"
  | "reorderCockpitSection";

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

  /** Pause create payload */
  pauseData?: Partial<CreateJobPauseInput>;

  /** Pause identifier */
  pauseNodeId?: string;

  /** Pause update payload */
  pauseUpdateData?: Partial<CreateJobPauseInput>;

  /** Selected history snapshot identifier for restore actions */
  historyId?: string;

  /** Research profile identifier */
  researchId?: string;

  /** Research profile create/update payload */
  researchData?: Partial<CreateResearchProfileInput>;

  /** Telegram notification create/update payload */
  telegramData?: Partial<SaveTelegramNotificationInput>;

  /** Default execution settings payload */
  executionDefaults?: Partial<ExecutionDefaultsView>;

  /** Todo identifier */
  todoId?: string;

  /** Todo create/update payload */
  todoData?: Partial<CreateCockpitTodoInput> | UpdateCockpitTodoInput;

  /** Todo comment payload */
  todoCommentData?: Partial<AddCockpitTodoCommentInput>;

  /** Todo filter payload */
  todoFilters?: Partial<UpdateCockpitBoardFiltersInput>;

  /** Shared todo label definition payload */
  todoLabelData?: UpsertCockpitLabelDefinitionInput;

  /** Shared todo flag definition payload */
  todoFlagData?: UpsertCockpitLabelDefinitionInput;

  /** Task identifier used for linking */
  linkedTaskId?: string;

  /** Target section for movement */
  targetSectionId?: string;

  /** Target order/index for movement */
  targetOrder?: number;

  /** Section identifier for cockpit section management */
  sectionId?: string;

  /** Section title for cockpit section management */
  sectionTitle?: string;

  /** Section move direction */
  sectionDirection?: "left" | "right";
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
  | { type: "requestRenameJobPause"; jobId: string; nodeId: string }
  | { type: "requestDeleteJobPause"; jobId: string; nodeId: string }
  | { type: "createJobPause"; jobId: string; data: CreateJobPauseInput }
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
  | { type: "updateJobPause"; jobId: string; nodeId: string; data: CreateJobPauseInput }
  | { type: "deleteJobPause"; jobId: string; nodeId: string }
  | { type: "approveJobPause"; jobId: string; nodeId: string }
  | { type: "rejectJobPause"; jobId: string; nodeId: string }
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
  | { type: "compileJob"; jobId: string }
  | { type: "refreshTasks" }
  | { type: "restoreScheduleHistory"; snapshotId: string }
  | { type: "toggleAutoShowOnStartup" }
  | { type: "refreshAgents" }
  | { type: "refreshPrompts" }
  | { type: "setupMcp" }
  | { type: "syncBundledSkills" }
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
  | { type: "saveTelegramNotification"; data: SaveTelegramNotificationInput }
  | { type: "testTelegramNotification"; data: SaveTelegramNotificationInput }
  | { type: "saveExecutionDefaults"; data: ExecutionDefaultsView }
  | { type: "createTodo"; data: CreateCockpitTodoInput }
  | { type: "updateTodo"; todoId: string; data: UpdateCockpitTodoInput }
  | { type: "deleteTodo"; todoId: string }
  | { type: "purgeTodo"; todoId: string }
  | { type: "approveTodo"; todoId: string }
  | { type: "rejectTodo"; todoId: string }
  | { type: "finalizeTodo"; todoId: string }
  | { type: "archiveTodo"; todoId: string; archived?: boolean }
  | { type: "moveTodo"; todoId: string; sectionId?: string; targetIndex: number }
  | { type: "addTodoComment"; todoId: string; data: AddCockpitTodoCommentInput }
  | { type: "setTodoFilters"; data: UpdateCockpitBoardFiltersInput }
  | { type: "saveTodoLabelDefinition"; data: UpsertCockpitLabelDefinitionInput }
  | { type: "deleteTodoLabelDefinition"; data: { name: string } }
  | { type: "saveTodoFlagDefinition"; data: UpsertCockpitLabelDefinitionInput }
  | { type: "deleteTodoFlagDefinition"; data: { name: string } }
  | { type: "requestTodoFileUpload"; todoId?: string }
  | { type: "linkTodoTask"; todoId: string; taskId?: string }
  | { type: "createTaskFromTodo"; todoId: string }
  | { type: "runTask"; taskId: string }
  | { type: "toggleTask"; taskId: string }
  | { type: "deleteTask"; taskId: string }
  | { type: "addCockpitSection"; title: string }
  | { type: "renameCockpitSection"; sectionId: string; title: string }
  | { type: "deleteCockpitSection"; sectionId: string }
  | { type: "moveCockpitSection"; sectionId: string; direction: "left" | "right" }
  | { type: "reorderCockpitSection"; sectionId: string; targetIndex: number }
  | { type: "setLanguage"; language: "auto" | "en" | "ja" | "de" }
  | { type: "setLogLevel"; logLevel: LogLevel }
  | { type: "openLogFolder" }
  | { type: "moveTaskToCurrentWorkspace"; taskId: string }
  | { type: "copyTask"; taskId: string }
  | { type: "loadPromptTemplate"; path: string; source: "local" | "global" }
  | { type: "debugWebview"; event: string; detail?: unknown }
  | { type: "webviewReady" }
  | { type: "introTutorial" }
  | { type: "planIntegration" }
  | { type: "restoreBackup" };

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


