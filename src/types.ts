/** Shared Cockpit scheduler types. */
export type TaskScope =
  | "global"
  | "workspace";

export type PromptSource = "inline" | "local" | "global";

export type LogLevel = "none" | "error" | "info" | "debug";

export type CockpitDeterministicStateMode =
  | "off"
  | "shadow"
  | "dual-write"
  | "canonical-primary";

/**
 * Conversation session strategy
 */
export type ChatSessionBehavior = "new" | "continue";

export type ApprovalMode =
  | "default"
  | "auto-approve"
  | "autopilot"
  | "yolo";

export type SearchProvider =
  | "built-in"
  | "tavily";

export type ResearchProvider =
  | "none"
  | "perplexity"
  | "tavily"
  | "google-grounded";

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

  /** Most recent modification time */
  updatedAt: string;
}

/**
 * Multi-step job workflow.
 */
export interface JobDefinition {
  /** Unique job identifier */
  id: string;

  /** Job-level cron expression */
  cronExpression: string;

  /** Job name */
  name: string;

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

  /** Most recent modification time */
  updatedAt: string;
}

/**
 * Repo-local scheduler config persisted in .vscode.
 */
export interface SchedulerWorkspaceConfig {
  /** Workspace tasks */
  tasks: any[];

  /** Tombstones for deleted task ids so stale writes cannot resurrect them */
  deletedTaskIds?: string[];

  /** Job workflows */
  jobs?: JobDefinition[];

  /** Tombstones for deleted job ids so stale writes cannot resurrect them */
  deletedJobIds?: string[];

  /** Job folders */
  jobFolders?: JobFolder[];

  /** Tombstones for deleted job folder ids so stale writes cannot resurrect them */
  deletedJobFolderIds?: string[];

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
  | "completed"
  | "rejected";

export type CockpitWorkflowFlag =
  | "new"
  | "needs-bot-review"
  | "needs-user-review"
  | "ready"
  | "ON-SCHEDULE-LIST"
  | "FINAL-USER-CHECK";

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

  /** Most recent modification time */
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

  /** Whether the task is grouped under manual sessions. */
  manualSession?: boolean;

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

  /** Most recent modification time */
  updatedAt: string;

  /** Built-in palette entry that should stay protected from user deletion */
  system?: boolean;
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

  /** Structural lifecycle metadata; active cards route by workflow flags instead. */
  status: CockpitTodoStatus;

  /** Free-form user-facing categorization labels */
  labels: string[];

  /** Agent-state flags; one canonical workflow flag drives active routing while other flags remain auxiliary metadata. */
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

  /** Approval timestamp when the card entered the ready workflow state */
  approvedAt?: string;

  /** Completion timestamp when finalized */
  completedAt?: string;

  /** Rejection timestamp when archived as rejected */
  rejectedAt?: string;

  /** Archive timestamp for completed or rejected records */
  archivedAt?: string;

  /** Creation timestamp */
  createdAt: string;

  /** Most recent modification time */
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

  /** Whether card descriptions and latest comments should remain hidden */
  hideCardDetails: boolean;
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

  /** Built-in system flag keys that should not be auto-seeded into the palette */
  disabledSystemFlagKeys?: string[];

  /** Tombstones for purged cards so stale board writes cannot resurrect them */
  deletedCardIds?: string[];

  /** Legacy archive buckets preserved only for migration from older board data */
  archives?: {
    completedSuccessfully: CockpitTodoCard[];
    rejected: CockpitTodoCard[];
  };

  /** Persisted board filters */
  filters?: CockpitBoardFilters;

  /** Most recent modification time */
  updatedAt: string;
}

export interface CockpitRoutingComment {
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

export interface CockpitRoutingCard {
  /** Unique card identifier */
  id: string;

  /** Short card title */
  title: string;

  /** Section containing this card */
  sectionId: string;

  /** Human-readable section title */
  sectionTitle?: string;

  /** Explicit per-section ordering */
  order: number;

  /** Current planning workflow state */
  status: CockpitTodoStatus;

  /** Whether the card is archived */
  archived: boolean;

  /** Archive bucket outcome when archived */
  archiveOutcome?: CockpitArchiveOutcome;

  /** Optional linked scheduler task */
  taskId?: string;

  /** Free-form user-facing categorization labels */
  labels: string[];

  /** Single-value agent-state flags used for routing and board filtering */
  flags: string[];

  /** Comments sorted newest-first for routing inspection */
  comments: CockpitRoutingComment[];

  /** Newest comment, regardless of whether it is actionable */
  latestComment?: CockpitRoutingComment;

  /** Latest actionable user comment after filtering out status/system noise */
  latestActionableUserComment?: CockpitRoutingComment;

  /** Routing signals that matched this card */
  matchedSignals: string[];

  /** Stable comment count for quick inspection */
  commentCount: number;
}

export interface CockpitRoutingQuery {
  /** Routing signals to match; defaults to the standard dispatcher set */
  signals?: string[];

  /** Whether archived cards should remain visible */
  includeArchived?: boolean;

  /** Temporary rollout control for deterministic routing semantics. */
  deterministicStateMode?: CockpitDeterministicStateMode;
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

  /** Whether card descriptions and latest comments should stay hidden */
  hideCardDetails?: boolean;

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

  /** Most recent modification time */
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

  /** Most recent modification time */
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
 * Workspace-level Todo handoff settings used by review and ready workflows.
 */
export interface ReviewDefaultsView {
  /** Default reusable text inserted when a todo enters needs-bot-review */
  needsBotReviewCommentTemplate: string;

  /** Prompt template used for automatic needs-bot-review planning runs */
  needsBotReviewPromptTemplate: string;

  /** Agent used for automatic needs-bot-review planning runs */
  needsBotReviewAgent: string;

  /** Model used for automatic needs-bot-review planning runs */
  needsBotReviewModel: string;

  /** Conversation session strategy used for automatic needs-bot-review planning runs */
  needsBotReviewChatSession: ChatSessionBehavior;

  /** Prompt template used when creating a ready task draft from a Todo */
  readyPromptTemplate: string;
}

/**
 * Workspace storage backend settings exposed in the Settings tab.
 */
export interface StorageSettingsView {
  /** Authoritative workspace persistence backend */
  mode: "json" | "sqlite";

  /** Preferred lightweight external search provider */
  searchProvider: SearchProvider;

  /** Preferred deeper research provider */
  researchProvider: ResearchProvider;

  /** Whether JSON compatibility mirrors stay enabled in sqlite mode */
  sqliteJsonMirror: boolean;

  /** Built-in system flag keys that should stay hidden from the default palette */
  disabledSystemFlagKeys: string[];

  /** Installed extension version shown in Settings */
  appVersion: string;

  /** Current MCP support status for the active workspace */
  mcpSetupStatus:
    | "configured"
    | "missing"
    | "stale"
    | "invalid"
    | "workspace-required";

  /** Last time the extension updated MCP support files for this workspace */
  lastMcpSupportUpdateAt: string;

  /** Last time bundled skills were updated for this workspace */
  lastBundledSkillsSyncAt: string;

  /** Last time bundled starter agents were synced for this workspace */
  lastBundledAgentsSyncAt: string;
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

  /** Most recent modification time */
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

interface TaskCopilotSelection {
  /** LLM model identifier (e.g. gpt-4o, claude-sonnet-4) */
  model?: string;

  /** Copilot mode or agent identifier (@workspace, agent, ask, edit, etc.). */
  agent?: string;
}

interface TaskPromptConfiguration {
  /** Inline prompt body forwarded to Copilot (used when promptSource is "inline") */
  prompt: string;

  /** File-based prompt path (used when promptSource is not "inline") */
  promptPath?: string;

  /** Prompt source discriminator. */
  promptSource: PromptSource; // origin

  /** Workspace-relative path to backup-only prompt export for recurring inline tasks. */
  promptBackupPath?: string;

  /** Timestamp of the last successful backup sync. */
  promptBackupUpdatedAt?: Date;
}

interface TaskExecutionSettings extends TaskCopilotSelection {
  /** Active state of the task */
  enabled: boolean;

  /** Upper-bound random jitter in seconds before execution starts (0 disables). */
  jitterSeconds?: number;

  /** Whether task should execute once and then be removed. */
  oneTime?: boolean;

  /** Relative delay in seconds used when scheduling a one-time task from now. */
  oneTimeDelaySeconds?: number;

  /** Whether the task is grouped under manual sessions. */
  manualSession?: boolean;

  /** Per-task chat session behavior for recurring tasks. */
  chatSession?: ChatSessionBehavior;

  /** Optional manual labels for filtering and organization. */
  labels?: string[];
}

interface TaskExecutionAudit {
  /** Most recent modification time */
  updatedAt: Date; // last-modified

  /** Creation timestamp */
  createdAt: Date; // birth-stamp

  /** Upcoming scheduled run instant */
  nextRun?: Date;

  /** Timestamp of last execution error */
  lastErrorAt?: Date;

  /** Last execution error message */
  lastError?: string;

  /** Last execution time */
  lastRun?: Date;
}

/** Scheduled task definition. */
export interface ScheduledTask
  extends TaskPromptConfiguration,
    TaskExecutionSettings,
    TaskExecutionAudit
{
  /** Task name */
  name: string;

  /** Optional task description */
  description?: string;

  /** Task identifier string (e.g. "task_1700000000000_abc123") */
  id: string;

  /** Cron schedule string (e.g. "0 9 * * 1-5") */
  cronExpression: string;

  /** Parent job when this task is job-managed. */
  jobId?: string;

  /** Owning job node when this task is job-managed. */
  jobNodeId?: string;

  /** Workspace path when the task is workspace-scoped. */
  workspacePath?: string;

  /** Task scope */
  scope: TaskScope; // visibility
}

interface CreateTaskExecutionInput extends TaskCopilotSelection {
  /** Active state of the task (default: true) */
  enabled?: boolean;

  /** Whether task should execute once and then be removed. */
  oneTime?: boolean;

  /** Relative delay in seconds used when scheduling a one-time task from now. */
  oneTimeDelaySeconds?: number;

  /** Whether the task is grouped under manual sessions. */
  manualSession?: boolean;

  /** Per-task chat session behavior for recurring tasks. */
  chatSession?: ChatSessionBehavior;

  /** Optional manual labels for filtering and organization. */
  labels?: string[];

  /** Visibility scope (defaults to "workspace") */
  scope?: TaskScope; // optional-scope

  /** Upper-bound random jitter in seconds before execution (0 disables; undefined falls back to the global default). */
  jitterSeconds?: number;
}

interface CreateTaskPromptInput {
  /** Path to prompt file */
  promptPath?: string;

  /** Origin of the prompt content (defaults to "inline") */
  promptSource?: PromptSource; // optional-origin

  /** Prompt text */
  prompt: string;
}

/** Input for creating a new task. */
export interface CreateTaskInput
  extends CreateTaskExecutionInput,
    CreateTaskPromptInput
{
  /** Task name */
  name: string;

  /** Optional task description */
  description?: string;

  /** Cron expression */
  cronExpression: string;

  /**
   * Whether to schedule the first execution soon after creation.
   * Despite the legacy name, the actual delay is INITIAL_TICK_DELAY_MIN (3 min).
   * Kept as-is to avoid breaking the Webview ↔ Extension message contract. // local-diverge-1257
   */
  runFirstInOneMinute?: boolean;
}

/** Agent definition. */
export interface AgentInfo {
  /** Disk path pointing to a custom agent definition */
  filePath?: string; // local-diverge-1265

  /** Agent identifier string (e.g. "@workspace", "agent") */
  id: string;

  /** True when the agent is user-defined */
  isCustom: boolean; // user-defined

  /** Description */
  description: string;

  /** Display name */
  name: string;
}

/** Model definition. */
export interface ModelInfo {
  /** Vendor name */
  vendor: string; // local-diverge-1283

  /** Model identifier string (e.g. "gpt-4o") */
  id: string;

  /** Description */
  description: string;

  /** Display name */
  name: string;
}

/** Prompt template definition. */
export interface PromptTemplate {
  /** Body text loaded lazily from disk */
  content?: string; // local-diverge-1298

  /** Template file path */
  path: string;

  /** Source type */
  source: "local" | "global"; // store-origin

  /** Display name inferred from the file name */
  name: string;
}

/**
 * Discoverable skill reference for prompt insertion.
 */
export interface SkillReference {
  /** Display name */
  name: string;

  /** Displayable relative/reference path */
  reference: string;

  /** Source bucket */
  source: "workspace" | "global";

  /** Absolute file path */
  path: string;

  /** Optional skill category from SKILL.md frontmatter */
  skillType?: "operational" | "support";

  /** MCP tool namespaces associated with the skill */
  toolNamespaces?: string[];

  /** Workflow intents the skill is designed to support */
  workflowIntents?: string[];

  /** Whether the skill participates in approval-sensitive flows */
  approvalSensitive?: boolean;

  /** Short prompt-ready summary extracted from skill metadata */
  promptSummary?: string;

  /** Workflow flags the skill expects in ready/scheduling flows */
  readyWorkflowFlags?: string[];

  /** Workflow flags the skill expects for closeout/review flows */
  closeoutWorkflowFlags?: string[];
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

/** Cron preset definition. */
export interface CronPreset {
  /** Cron expression */
  expression: string; // local-diverge-1344

  /** Preset ID */
  id: string;

  /** Description */
  description: string;

  /** Display name */
  name: string;
}

type JobActionName =
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
  | "compileJob";

type TodoActionName =
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
  | "deleteTodoComment"
  | "setTodoFilters"
  | "saveTodoLabelDefinition"
  | "deleteTodoLabelDefinition"
  | "saveTodoFlagDefinition"
  | "deleteTodoFlagDefinition"
  | "linkTodoTask"
  | "createTaskFromTodo";

type TaskActionName =
  | "duplicate" // clone-action
  | "copy" // clipboard-action
  | "edit" // local-diverge-1403
  | "run" // execute-action
  | "delete" // remove-action
  | "toggle" // local-diverge-1406
  | "moveToCurrentWorkspace"
  | "restoreHistory"
  | "refresh"
  | "setupMcp"
  | "setupCodex"
  | "setupCodexSkills"
  | "refreshStorageStatus"
  | "syncBundledSkills"
  | "stageBundledAgents"
  | "syncBundledAgents"
  | "importStorageFromJson"
  | "exportStorageToJson"
  | "saveTelegramNotification"
  | "testTelegramNotification"
  | "saveExecutionDefaults"
  | "saveReviewDefaults";

type ResearchActionName =
  | "createResearchProfile"
  | "updateResearchProfile"
  | "deleteResearchProfile"
  | "duplicateResearchProfile"
  | "startResearchRun"
  | "stopResearchRun";

type CockpitSectionActionName =
  | "addCockpitSection"
  | "renameCockpitSection"
  | "deleteCockpitSection"
  | "moveCockpitSection"
  | "reorderCockpitSection";

type SectionDirection = "left" | "right";

/** Task action from Webview. */
export interface TaskAction {
  /** Supplementary payload for the action */
  data?: Partial<CreateTaskInput>; // local-diverge-1439

  /** Task identifier carried by task-centric actions. */
  taskId: string;

  action: TaskActionName | JobActionName | ResearchActionName | TodoActionName | CockpitSectionActionName;

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

  /** Default review settings payload */
  reviewDefaults?: Partial<ReviewDefaultsView>;

  /** Todo identifier */
  todoId?: string;

  /** Todo create/update payload */
  todoData?: Partial<CreateCockpitTodoInput> | UpdateCockpitTodoInput;

  /** Todo comment payload */
  todoCommentData?: Partial<AddCockpitTodoCommentInput>;

  /** Todo comment index for deletion */
  todoCommentIndex?: number;

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
  sectionDirection?: SectionDirection;
}

/**
 * Runtime options forwarded to CopilotExecutor
 */
export interface ExecuteOptions {
  /** Model to use */
  model?: string; // local-diverge-1542

  /** Task-level chat session override. */
  chatSession?: ChatSessionBehavior;

  /** Agent to use */
  agent?: string;
}

type TaskEditorMessage =
  | { type: "duplicateTask"; taskId: string } // clone-msg
  | { type: "updateTask"; taskId: string; data: Partial<CreateTaskInput> } // patch-msg
  | { type: "testPrompt"; prompt: string; agent?: string; model?: string } // local-diverge-1554
  | { type: "createTask"; data: CreateTaskInput };

type JobWorkflowMessage =
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
  | { type: "compileJob"; jobId: string };

type SchedulerControlMessage =
  | { type: "refreshTasks" }
  | { type: "restoreScheduleHistory"; snapshotId: string }
  | { type: "toggleAutoShowOnStartup" }
  | { type: "refreshAgents" } // reload-agents
  | { type: "refreshPrompts" } // reload-templates
  | { type: "setupMcp" }
  | { type: "setupCodex" }
  | { type: "setupCodexSkills" }
  | { type: "refreshStorageStatus" }
  | { type: "syncBundledSkills" }
  | { type: "stageBundledAgents" }
  | { type: "syncBundledAgents" }
  | { type: "importStorageFromJson" }
  | { type: "exportStorageToJson" };

type ResearchMessage =
  | { type: "createResearchProfile"; data: CreateResearchProfileInput }
  | {
    type: "updateResearchProfile";
    researchId: string;
    data: Partial<CreateResearchProfileInput>;
  }
  | { type: "deleteResearchProfile"; researchId: string }
  | { type: "duplicateResearchProfile"; researchId: string }
  | { type: "startResearchRun"; researchId: string }
  | { type: "stopResearchRun" };

type NotificationAndSettingsMessage =
  | { type: "saveTelegramNotification"; data: SaveTelegramNotificationInput }
  | { type: "testTelegramNotification"; data: SaveTelegramNotificationInput }
  | { type: "saveExecutionDefaults"; data: ExecutionDefaultsView }
  | { type: "saveReviewDefaults"; data: ReviewDefaultsView }
  | { type: "setStorageSettings"; data: StorageSettingsView }
  | { type: "setApprovalMode"; approvalMode: ApprovalMode };

type TodoBoardMessage =
  | { type: "createTodo"; data: CreateCockpitTodoInput }
  | { type: "updateTodo"; todoId: string; data: UpdateCockpitTodoInput }
  | { type: "deleteTodo"; todoId: string }
  | { type: "purgeTodo"; todoId: string }
  | { type: "requestApproveTodo"; todoId: string }
  | { type: "approveTodo"; todoId: string }
  | { type: "rejectTodo"; todoId: string }
  | { type: "requestFinalizeTodo"; todoId: string }
  | { type: "finalizeTodo"; todoId: string }
  | { type: "archiveTodo"; todoId: string; archived?: boolean }
  | { type: "moveTodo"; todoId: string; sectionId?: string; targetIndex: number }
  | { type: "addTodoComment"; todoId: string; data: AddCockpitTodoCommentInput }
  | { type: "deleteTodoComment"; todoId: string; commentIndex: number }
  | { type: "setTodoFilters"; data: UpdateCockpitBoardFiltersInput }
  | { type: "saveTodoLabelDefinition"; data: UpsertCockpitLabelDefinitionInput }
  | { type: "deleteTodoLabelDefinition"; data: { name: string } }
  | { type: "saveTodoFlagDefinition"; data: UpsertCockpitLabelDefinitionInput }
  | { type: "deleteTodoFlagDefinition"; data: { name: string } }
  | { type: "requestTodoFileUpload"; todoId?: string }
  | { type: "linkTodoTask"; todoId: string; taskId?: string }
  | { type: "createTaskFromTodo"; todoId: string };

type CockpitSectionMessage =
  | { type: "deleteTask"; taskId: string } // outgoing-msg
  | { type: "toggleTask"; taskId: string } // outgoing-msg
  | { type: "runTask"; taskId: string } // local-diverge-1668
  | { type: "addCockpitSection"; title: string }
  | { type: "renameCockpitSection"; sectionId: string; title: string }
  | { type: "deleteCockpitSection"; sectionId: string }
  | { type: "moveCockpitSection"; sectionId: string; direction: SectionDirection }
  | { type: "reorderCockpitSection"; sectionId: string; targetIndex: number }
  | { type: "setLanguage"; language: "auto" | "en" | "ja" | "de" }
  | { type: "setLogLevel"; logLevel: LogLevel }
  | { type: "openLogFolder" }
  | { type: "copyTask"; taskId: string } // outgoing-msg
  | { type: "moveTaskToCurrentWorkspace"; taskId: string } // outgoing-msg
  | { type: "loadPromptTemplate"; path: string; source: "local" | "global" } // local-diverge-1679
  | { type: "debugWebview"; event: string; detail?: unknown }
  | { type: "webviewReady" }
  | { type: "introTutorial" }
  | { type: "planIntegration" }
  | { type: "openExtensionSettings" }
  | { type: "openCopilotSettings" }
  | { type: "restoreBackup" };

/** Webview message types (Webview → Extension). */
export type WebviewToExtensionMessage =
  | TaskEditorMessage
  | JobWorkflowMessage
  | SchedulerControlMessage
  | ResearchMessage
  | NotificationAndSettingsMessage
  | TodoBoardMessage
  | CockpitSectionMessage;

/** TreeView context values. */
export type TreeContextValue =
  | "enabledTask" // context-key
  | "disabledTask" // local-diverge-1699
  | "workspaceGroup" // context-key
  | "scopeGroup" // context-key
  | "enabledOtherWorkspaceTask" // local-diverge-1702
  | "disabledOtherWorkspaceTask"
  | "enabledWorkspaceTask" // context-key
  | "disabledWorkspaceTask";


