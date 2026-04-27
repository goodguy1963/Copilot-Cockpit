import {
  COCKPIT_NEEDS_BOT_REVIEW_FLAG,
  COCKPIT_NEEDS_USER_REVIEW_FLAG,
  COCKPIT_FINAL_USER_CHECK_FLAG,
  COCKPIT_ON_SCHEDULE_LIST_FLAG,
  COCKPIT_READY_FLAG,
  DEFAULT_UNSORTED_SECTION_ID,
  getActiveCockpitWorkflowFlag,
  isArchiveSectionId,
  isProtectedCockpitFlagKey,
  replaceCockpitWorkflowFlag,
} from "./cockpitBoard";
import {
  addCockpitTodoComment,
  deleteCockpitTodoComment,
  addCockpitSection,
  approveCockpitTodo,
  createCockpitTodo,
  deleteCockpitFlagDefinition,
  deleteCockpitSection,
  deleteCockpitTodoLabelDefinition,
  finalizeCockpitTodo,
  getCockpitBoard,
  moveCockpitSection,
  moveCockpitTodo,
  purgeCockpitTodo,
  rejectCockpitTodo,
  renameCockpitSection,
  reorderCockpitSection,
  restoreCockpitTodo,
  saveCockpitFlagDefinition,
  saveCockpitTodoLabelDefinition,
  setCockpitBoardFilters,
  setCockpitBoardFiltersInBoard,
  updateCockpitTodo,
} from "./cockpitBoardManager";
import { SchedulerWebview } from "./cockpitWebview";
import { findTodoDraftTaskForTodo, isTodoDraftTask } from "./todoDraftTasks";
import type {
  AddCockpitTodoCommentInput,
  CockpitBoard,
  CockpitBoardFilters,
  CockpitTodoCard,
  CockpitTodoPriority,
  CreateCockpitTodoInput,
  CreateTaskInput,
  ExecuteOptions,
  GitHubIntegrationView,
  GitHubTodoSource,
  ReviewDefaultsView,
  ScheduledTask,
  TaskAction,
  UpdateCockpitBoardFiltersInput,
  UpdateCockpitTodoInput,
} from "./types";
import { listWorkspaceSkillMetadata, type ParsedSkillMetadata } from "./skillMetadata";

function normalizeTodoFilterValue(value: string | undefined): string {
  return String(value || "").trim().toLowerCase();
}

function matchesTodoSearchFilter(
  todo: Pick<CockpitTodoCard, "title" | "description" | "labels" | "flags">,
  searchText: string | undefined,
): boolean {
  const needle = String(searchText || "").trim().toLowerCase();
  if (!needle) {
    return true;
  }

  const haystack = [
    todo.title || "",
    todo.description || "",
    ...(todo.labels || []),
    ...(todo.flags || []),
  ]
    .join(" ")
    .toLowerCase();

  return haystack.includes(needle);
}

function getRevealFiltersForCreatedTodo(
  filters: CockpitBoardFilters | undefined,
  todo: CockpitTodoCard,
): UpdateCockpitBoardFiltersInput | undefined {
  if (!filters) {
    return undefined;
  }

  const updates: UpdateCockpitBoardFiltersInput = {};
  let changed = false;

  if (!matchesTodoSearchFilter(todo, filters.searchText)) {
    updates.searchText = "";
    changed = true;
  }

  if (filters.sectionId && filters.sectionId !== todo.sectionId) {
    updates.sectionId = "";
    changed = true;
  }

  if (
    filters.labels.length > 0
    && !filters.labels.some((label) =>
      todo.labels.some(
        (todoLabel) =>
          normalizeTodoFilterValue(todoLabel) === normalizeTodoFilterValue(label),
      ),
    )
  ) {
    updates.labels = [];
    changed = true;
  }

  if (
    filters.priorities.length > 0
    && !filters.priorities.includes(todo.priority)
  ) {
    updates.priorities = [];
    changed = true;
  }

  if (
    filters.statuses.length > 0
    && !filters.statuses.includes(todo.status)
  ) {
    updates.statuses = [];
    changed = true;
  }

  if (filters.archiveOutcomes.length > 0) {
    updates.archiveOutcomes = [];
    changed = true;
  }

  if (
    filters.flags.length > 0
    && !filters.flags.some((flag) =>
      todo.flags.some(
        (todoFlag) =>
          normalizeTodoFilterValue(todoFlag) === normalizeTodoFilterValue(flag),
      ),
    )
  ) {
    updates.flags = [];
    changed = true;
  }

  return changed ? updates : undefined;
}

function areStringListsEqual(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function areCockpitBoardFiltersEqual(
  left: CockpitBoardFilters | undefined,
  right: CockpitBoardFilters | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (left.searchText ?? "") === (right.searchText ?? "")
    && areStringListsEqual(left.labels, right.labels)
    && areStringListsEqual(left.priorities, right.priorities)
    && areStringListsEqual(left.statuses, right.statuses)
    && areStringListsEqual(left.archiveOutcomes, right.archiveOutcomes)
    && areStringListsEqual(left.flags, right.flags)
    && (left.sectionId ?? "") === (right.sectionId ?? "")
    && left.sortBy === right.sortBy
    && left.sortDirection === right.sortDirection
    && left.viewMode === right.viewMode
    && left.showArchived === right.showArchived
    && left.showRecurringTasks === right.showRecurringTasks
    && left.hideCardDetails === right.hideCardDetails;
}

function normalizeOptionalPromptText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : undefined;
}

function mergeDistinctStringsCaseInsensitive(
  existing: string[] | undefined,
  incoming: string[] | undefined,
): string[] {
  const merged = new Map<string, string>();
  for (const entry of [...(existing ?? []), ...(incoming ?? [])]) {
    const trimmed = String(entry || "").trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!merged.has(key)) {
      merged.set(key, trimmed);
    }
  }
  return Array.from(merged.values());
}

const TODO_PRIORITY_RANK: Record<CockpitTodoPriority, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 4,
};

function getStrongerPriority(
  current: CockpitTodoPriority,
  incoming: CockpitTodoPriority | undefined,
): CockpitTodoPriority {
  if (!incoming) {
    return current;
  }

  return (TODO_PRIORITY_RANK[incoming] ?? 0) > (TODO_PRIORITY_RANK[current] ?? 0)
    ? incoming
    : current;
}

function getGitHubRepoKey(
  githubSource: Pick<GitHubTodoSource, "owner" | "repo"> | undefined,
): string | undefined {
  const owner = String(githubSource?.owner || "").trim().toLowerCase();
  const repo = String(githubSource?.repo || "").trim().toLowerCase();
  return owner && repo ? `${owner}/${repo}` : undefined;
}

function areGitHubSourcesEquivalent(
  left: GitHubTodoSource | undefined,
  right: GitHubTodoSource | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return left.itemId === right.itemId
    && left.kind === right.kind
    && (left.subtype ?? "") === (right.subtype ?? "")
    && (left.number ?? 0) === (right.number ?? 0)
    && left.title === right.title
    && left.url === right.url
    && (left.state ?? "") === (right.state ?? "")
    && (left.severity ?? "") === (right.severity ?? "")
    && (left.baseRef ?? "") === (right.baseRef ?? "")
    && (left.headRef ?? "") === (right.headRef ?? "")
    && (left.updatedAt ?? "") === (right.updatedAt ?? "")
    && (getGitHubRepoKey(left) ?? "") === (getGitHubRepoKey(right) ?? "");
}

function countPopulatedGitHubSourceFields(
  githubSource: GitHubTodoSource | undefined,
): number {
  if (!githubSource) {
    return 0;
  }

  const values = [
    githubSource.itemId,
    githubSource.kind,
    githubSource.subtype,
    githubSource.number,
    githubSource.title,
    githubSource.url,
    githubSource.owner,
    githubSource.repo,
    githubSource.state,
    githubSource.severity,
    githubSource.baseRef,
    githubSource.headRef,
    githubSource.updatedAt,
  ];

  return values.filter((value) => {
    if (typeof value === "number") {
      return Number.isFinite(value);
    }
    return typeof value === "string" && value.trim().length > 0;
  }).length;
}

function isGitHubSourceNewer(
  existing: GitHubTodoSource | undefined,
  incoming: GitHubTodoSource | undefined,
): boolean {
  const incomingTime = Date.parse(incoming?.updatedAt || "");
  if (!Number.isFinite(incomingTime)) {
    return false;
  }

  const existingTime = Date.parse(existing?.updatedAt || "");
  if (!Number.isFinite(existingTime)) {
    return true;
  }

  return incomingTime > existingTime;
}

function isGitHubSourceMoreComplete(
  existing: GitHubTodoSource | undefined,
  incoming: GitHubTodoSource | undefined,
): boolean {
  return countPopulatedGitHubSourceFields(incoming)
    > countPopulatedGitHubSourceFields(existing);
}

type TodoCockpitTaskAction = Extract<
  TaskAction["action"],
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
  | "createTaskFromTodo"
  | "addCockpitSection"
  | "renameCockpitSection"
  | "deleteCockpitSection"
  | "moveCockpitSection"
  | "reorderCockpitSection"
>;

const TODO_COCKPIT_ACTIONS = new Set<TodoCockpitTaskAction>([
  "createTodo",
  "updateTodo",
  "deleteTodo",
  "purgeTodo",
  "approveTodo",
  "rejectTodo",
  "finalizeTodo",
  "archiveTodo",
  "moveTodo",
  "addTodoComment",
  "deleteTodoComment",
  "setTodoFilters",
  "saveTodoLabelDefinition",
  "deleteTodoLabelDefinition",
  "saveTodoFlagDefinition",
  "deleteTodoFlagDefinition",
  "linkTodoTask",
  "createTaskFromTodo",
  "addCockpitSection",
  "renameCockpitSection",
  "deleteCockpitSection",
  "moveCockpitSection",
  "reorderCockpitSection",
]);

type TodoPromptSource = {
  id: string;
  title: string;
  description?: string;
  labels?: string[];
  githubSource?: GitHubTodoSource;
  taskId?: string | null;
  comments?: Array<{ author?: string; body?: string }>;
};

type TodoCockpitActionHandlerDeps = {
  getPrimaryWorkspaceRootPath: () => string | undefined;
  getCurrentCockpitBoard: () => CockpitBoard;
  getCurrentTasks: () => ScheduledTask[];
  getReviewDefaults: () => ReviewDefaultsView;
  executeBotReviewPrompt: (prompt: string, options: ExecuteOptions) => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<{ id: string; name: string }>;
  deleteTask: (taskId: string) => Promise<boolean>;
  removeLabelFromAllTasks: (labelName: string) => Promise<unknown>;
  refreshSchedulerUiState: (immediate?: boolean) => void;
  notifyError: (message: string) => void;
  notifyInfo: (message: string) => void;
  notifyInfoWithAction?: (
    message: string,
    actionLabel: string,
    onAction: () => void | Promise<void>,
  ) => void;
  showError: (message: string) => void;
  noWorkspaceOpenMessage: string;
  getCurrentGitHubIntegration: () => GitHubIntegrationView | undefined;
  getCurrentGitBranchName: (workspaceRoot: string | undefined) => Promise<string | undefined>;
};

function enrichGitHubSource(
  githubSource: GitHubTodoSource | undefined,
  githubIntegration: GitHubIntegrationView | undefined,
): GitHubTodoSource | undefined {
  if (!githubSource) {
    return undefined;
  }

  return {
    ...githubSource,
    owner: githubSource.owner || githubIntegration?.owner,
    repo: githubSource.repo || githubIntegration?.repo,
  };
}

function findExistingTodoForGitHubSource(
  board: CockpitBoard,
  githubSource: GitHubTodoSource | undefined,
): CockpitTodoCard | undefined {
  if (!githubSource) {
    return undefined;
  }

  return board.cards.find((card) => {
    const existing = card.githubSource;
    if (!existing) {
      return false;
    }

    const existingRepoKey = getGitHubRepoKey(existing);
    const incomingRepoKey = getGitHubRepoKey(githubSource);
    if (existing.itemId === githubSource.itemId) {
      return !existingRepoKey || !incomingRepoKey || existingRepoKey === incomingRepoKey;
    }
    if (existing.url && existing.url === githubSource.url) {
      return true;
    }
    if (
      existing.kind === githubSource.kind
      && typeof existing.number === "number"
      && typeof githubSource.number === "number"
      && existing.number === githubSource.number
    ) {
      return !existingRepoKey || !incomingRepoKey || existingRepoKey === incomingRepoKey;
    }
    return false;
  });
}

function mergeIncomingImportFlags(
  existing: string[],
  incoming: string[] | undefined,
): string[] | undefined {
  if (!incoming || incoming.length === 0) {
    return undefined;
  }

  const merged = mergeDistinctStringsCaseInsensitive(existing, incoming);
  const incomingWorkflowFlag = getActiveCockpitWorkflowFlag(incoming);
  if (!incomingWorkflowFlag) {
    return merged;
  }

  return replaceCockpitWorkflowFlag(
    merged,
    incomingWorkflowFlag as Parameters<typeof replaceCockpitWorkflowFlag>[1],
  );
}

function buildGitHubImportUpdates(
  existingTodo: CockpitTodoCard,
  incoming: CreateCockpitTodoInput,
  githubSource: GitHubTodoSource | undefined,
): UpdateCockpitTodoInput {
  const updates: UpdateCockpitTodoInput = {};
  const incomingTitle = normalizeOptionalPromptText(incoming.title);
  const incomingDescription = normalizeOptionalPromptText(incoming.description);
  const sourceChanged = Boolean(
    githubSource && !areGitHubSourcesEquivalent(existingTodo.githubSource, githubSource),
  );
  const shouldRefreshSource = Boolean(
    githubSource && (
      !existingTodo.githubSource
      || isGitHubSourceNewer(existingTodo.githubSource, githubSource)
      || isGitHubSourceMoreComplete(existingTodo.githubSource, githubSource)
      || (!existingTodo.githubSource?.updatedAt && !githubSource.updatedAt && sourceChanged)
    ),
  );

  const mergedLabels = mergeDistinctStringsCaseInsensitive(
    existingTodo.labels,
    incoming.labels,
  );
  if (!areStringListsEqual(existingTodo.labels, mergedLabels)) {
    updates.labels = mergedLabels;
  }

  const mergedFlags = mergeIncomingImportFlags(existingTodo.flags, incoming.flags);
  if (mergedFlags && !areStringListsEqual(existingTodo.flags, mergedFlags)) {
    updates.flags = mergedFlags;
  }

  const strongerPriority = getStrongerPriority(existingTodo.priority, incoming.priority);
  if (strongerPriority !== existingTodo.priority) {
    updates.priority = strongerPriority;
  }

  if (
    incomingDescription
    && incomingDescription !== existingTodo.description
    && (
      shouldRefreshSource
      || !existingTodo.description
      || incomingDescription.length > existingTodo.description.length
    )
  ) {
    updates.description = incomingDescription;
  }

  if (
    incomingTitle
    && incomingTitle !== existingTodo.title
    && (
      shouldRefreshSource
      || !existingTodo.title
      || existingTodo.title === existingTodo.githubSource?.title
    )
  ) {
    updates.title = incomingTitle;
  }

  if (githubSource && sourceChanged && shouldRefreshSource) {
    updates.githubSource = githubSource;
  }

  const incomingDueAt = normalizeOptionalPromptText(incoming.dueAt);
  if (incomingDueAt && incomingDueAt !== existingTodo.dueAt) {
    updates.dueAt = incomingDueAt;
  }

  const incomingSessionId = normalizeOptionalPromptText(incoming.sessionId);
  if (incomingSessionId && incomingSessionId !== existingTodo.sessionId) {
    updates.sessionId = incomingSessionId;
  }

  const incomingSectionId = normalizeOptionalPromptText(incoming.sectionId);
  if (existingTodo.archived || isArchiveSectionId(existingTodo.sectionId)) {
    updates.sectionId = incomingSectionId ?? DEFAULT_UNSORTED_SECTION_ID;
  } else if (incomingSectionId && incomingSectionId !== existingTodo.sectionId) {
    updates.sectionId = incomingSectionId;
  }

  return updates;
}

function getTodoWorkflowFlag(todo: Pick<CockpitTodoCard, "flags">): string | undefined {
  return getActiveCockpitWorkflowFlag(todo.flags);
}

const NEEDS_BOT_REVIEW_COMMENT_LABEL = "needs-bot-review-template";

function maybeSeedNeedsBotReviewCommentTemplate(
  workspaceRoot: string,
  todo: CockpitTodoCard,
  previousWorkflowFlag: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): void {
  const nextWorkflowFlag = getTodoWorkflowFlag(todo);
  if (
    nextWorkflowFlag !== COCKPIT_NEEDS_BOT_REVIEW_FLAG
    || nextWorkflowFlag === previousWorkflowFlag
  ) {
    return;
  }

  const template = deps.getReviewDefaults().needsBotReviewCommentTemplate.trim();
  if (!template) {
    return;
  }

  const comments = Array.isArray(todo.comments) ? todo.comments : [];
  const lastComment = comments.length > 0 ? comments[comments.length - 1] : undefined;
  const lastCommentLabels = Array.isArray(lastComment?.labels) ? lastComment.labels : [];
  const lastCommentIsTemplate = lastComment?.source === "system-event"
    && lastComment?.body?.trim() === template
    && lastCommentLabels.includes(NEEDS_BOT_REVIEW_COMMENT_LABEL);
  if (lastCommentIsTemplate) {
    return;
  }

  addCockpitTodoComment(workspaceRoot, todo.id, {
    body: template,
    author: "system",
    source: "system-event",
    labels: [NEEDS_BOT_REVIEW_COMMENT_LABEL],
  });
}

function buildTodoRecentCommentsText(todo: TodoPromptSource): string {
  return (todo.comments ?? [])
    .filter((comment) => comment?.body)
    .slice(-5)
    .map((comment) => `- ${comment.author || "system"}: ${comment.body}`)
    .join("\n") || "- none";
}

function buildTodoContextBlock(todo: TodoPromptSource): string {
  const sections: string[] = [
    `Todo ID: ${todo.id || ""}`,
    `Todo title: ${todo.title || ""}`,
    `Todo description:\n${todo.description?.trim() || "(none)"}`,
    `Todo labels: ${(todo.labels ?? []).join(", ") || "none"}`,
    `Linked task: ${todo.taskId || "none"}`,
    `Recent coordination:\n${buildTodoRecentCommentsText(todo)}`,
  ];

  return sections.join("\n\n");
}

function getGitHubKindLabel(githubSource: GitHubTodoSource): string {
  switch (githubSource.kind) {
    case "pullRequest":
      return "pull request";
    case "securityAlert":
      return "security alert";
    default:
      return "issue";
  }
}

function buildGitHubContextBlock(
  githubSource: GitHubTodoSource | undefined,
): string {
  if (!githubSource) {
    return "";
  }

  const lines = [
    "GitHub context:",
    `- Repository: ${getGitHubRepoKey(githubSource) || "unknown"}`,
    `- Source: ${getGitHubKindLabel(githubSource)}${githubSource.subtype ? ` (${githubSource.subtype})` : ""}`,
    `- GitHub item id: ${githubSource.itemId}`,
    typeof githubSource.number === "number"
      ? `- Number: ${githubSource.number}`
      : undefined,
    `- Title: ${githubSource.title}`,
    `- URL: ${githubSource.url}`,
    githubSource.state ? `- State: ${githubSource.state}` : undefined,
    githubSource.severity ? `- Severity: ${githubSource.severity}` : undefined,
    githubSource.baseRef ? `- Base branch: ${githubSource.baseRef}` : undefined,
    githubSource.headRef ? `- Head branch: ${githubSource.headRef}` : undefined,
    githubSource.updatedAt ? `- Updated at: ${githubSource.updatedAt}` : undefined,
  ].filter((value): value is string => Boolean(value));

  return lines.join("\n");
}

async function buildGitHubBranchPreflightBlock(
  githubSource: GitHubTodoSource | undefined,
  workspaceRoot: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): Promise<string> {
  if (!githubSource || githubSource.kind !== "pullRequest") {
    return "";
  }

  const currentBranch = normalizeOptionalPromptText(
    await deps.getCurrentGitBranchName(workspaceRoot),
  );
  const requiredHeadBranch = githubSource.headRef || "unknown";
  const lines = [
    "GitHub PR branch/security preflight:",
    "- Security review comes before implementation work.",
    "- Review the PR for security-sensitive changes before making code edits.",
    `- Required PR head branch: ${requiredHeadBranch}`,
    `- Current local branch: ${currentBranch || "unavailable"}`,
  ];

  if (!githubSource.headRef) {
    lines.push(
      "- Branch status: PR head branch unavailable. Stop before implementation until the required branch is known.",
    );
  } else if (!currentBranch) {
    lines.push(
      "- Branch status: unavailable. Stop before implementation until the current branch can be verified against the PR head branch.",
    );
  } else if (currentBranch !== githubSource.headRef) {
    lines.push(
      "- Branch status: mismatch. Stop before implementation and ask the user to switch to the PR head branch first.",
    );
  } else {
    lines.push("- Branch status: match confirmed.");
  }

  return lines.join("\n");
}

function buildGitHubAutomationPromptBlock(
  automationPromptTemplate: string | undefined,
): string {
  const template = automationPromptTemplate?.trim() || "";
  if (!template) {
    return "";
  }

  return [
    "Saved GitHub automation prompt:",
    template,
  ].join("\n");
}

type TodoGitHubPromptBlocks = {
  githubContext: string;
  githubBranchPreflight: string;
  githubAutomationPrompt: string;
  githubSupplement: string;
};

function buildGitHubPromptSupplement(
  blocks: Omit<TodoGitHubPromptBlocks, "githubSupplement">,
): string {
  return [
    blocks.githubContext,
    blocks.githubBranchPreflight,
    blocks.githubAutomationPrompt,
  ].filter((value) => value.trim()).join("\n\n");
}

async function buildTodoGitHubPromptBlocks(
  todo: TodoPromptSource,
  workspaceRoot: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): Promise<TodoGitHubPromptBlocks> {
  if (!todo.githubSource) {
    return {
      githubContext: "",
      githubBranchPreflight: "",
      githubAutomationPrompt: "",
      githubSupplement: "",
    };
  }

  const githubIntegration = deps.getCurrentGitHubIntegration();
  const blocks = {
    githubContext: buildGitHubContextBlock(todo.githubSource),
    githubBranchPreflight: await buildGitHubBranchPreflightBlock(
      todo.githubSource,
      workspaceRoot,
      deps,
    ),
    githubAutomationPrompt: buildGitHubAutomationPromptBlock(
      githubIntegration?.automationPromptTemplate,
    ),
  };

  return {
    ...blocks,
    githubSupplement: buildGitHubPromptSupplement(blocks),
  };
}

type SkillGuidanceIntent = "needs-bot-review" | "ready";

function selectSkillGuidanceMetadata(
  workspaceRoot: string | undefined,
  intent: SkillGuidanceIntent,
): ParsedSkillMetadata[] {
  return listWorkspaceSkillMetadata(workspaceRoot)
    .filter((entry) => entry.type === "operational")
    .filter((entry) => entry.workflowIntents.length === 0 || entry.workflowIntents.includes(intent))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildMcpSkillGuidanceBlock(
  workspaceRoot: string | undefined,
  intent: SkillGuidanceIntent,
): string {
  const metadata = selectSkillGuidanceMetadata(workspaceRoot, intent);
  const preferredSkills = metadata.map((entry) => entry.name);
  const toolNamespaces = Array.from(
    new Set(metadata.flatMap((entry) => entry.toolNamespaces)),
  ).sort((left, right) => left.localeCompare(right));
  const readyWorkflowFlags = Array.from(
    new Set(metadata.flatMap((entry) => entry.readyWorkflowFlags)),
  );
  const closeoutWorkflowFlags = Array.from(
    new Set(metadata.flatMap((entry) => entry.closeoutWorkflowFlags)),
  );

  const baseLines = [
    "MCP and skill usage guidance:",
    preferredSkills.length > 0
      ? `- Prefer the repo-local ${preferredSkills.join(", ")} skills when they apply.`
      : "- Prefer the repo-local cockpit-scheduler-router and cockpit-todo-agent skills when they apply.",
    "- Treat Todo Cockpit cards and scheduled tasks as separate artifacts; do not conflate cockpit_ tools with scheduler_ tools.",
    "- If MCP tools are available, prefer cockpit_ and scheduler_ tools over editing repo-local JSON files by hand.",
    "- Confirm the required MCP tool exists before claiming a mutation or scheduler change succeeded.",
  ];

  if (toolNamespaces.length > 0) {
    baseLines.push(
      `- Relevant MCP namespaces for this handoff: ${toolNamespaces.map((entry) => `${entry}_`).join(", ")}.`,
    );
  }

  for (const entry of metadata) {
    if (entry.promptSummary) {
      baseLines.push(`- ${entry.name}: ${entry.promptSummary}`);
    }
  }

  if (metadata.some((entry) => entry.approvalSensitive)) {
    baseLines.push(
      "- This handoff touches approval-sensitive workflow state; keep labels separate from single-value workflow flags and preserve the intended review checkpoint.",
    );
  }

  if (intent === "ready" && readyWorkflowFlags.length > 0) {
    baseLines.push(
      `- Compatible ready-state flags for scheduling handoff: ${readyWorkflowFlags.join(", ")}.`,
    );
  }

  if (intent === "ready" && closeoutWorkflowFlags.length > 0) {
    baseLines.push(
      `- Preferred closeout/review flags after execution: ${closeoutWorkflowFlags.join(", ")}.`,
    );
  }

  if (intent === "needs-bot-review") {
    baseLines.push(
      "- This is a needs-bot-review handoff: stay in planning/review mode, research what is needed, and avoid pretending implementation or scheduling is complete.",
    );
  } else {
    baseLines.push(
      "- This is a ready handoff: prepare or refine the execution-ready draft, preserve the requested work, and reuse an existing linked task when it is still valid instead of creating duplicates.",
    );
  }

  return baseLines.join("\n");
}

function applyTodoPromptTemplate(
  todo: TodoPromptSource,
  template: string,
  intent: SkillGuidanceIntent,
  workspaceRoot: string | undefined,
  githubBlocks: TodoGitHubPromptBlocks,
): string {
  const labels = (todo.labels ?? []).join(", ") || "none";
  const recentComments = buildTodoRecentCommentsText(todo);
  const linkedTask = todo.taskId || "none";
  const todoContext = buildTodoContextBlock(todo);
  const mcpSkillGuidance = buildMcpSkillGuidanceBlock(workspaceRoot, intent);

  const hasExplicitGitHubPlaceholders = /\{\{github_(?:context|branch_preflight|automation_prompt)\}\}/.test(template);
  const rendered = template
    .replace(/\{\{title\}\}/g, todo.title || "")
    .replace(/\{\{description\}\}/g, todo.description?.trim() || "")
    .replace(/\{\{labels\}\}/g, labels)
    .replace(/\{\{recent_comments\}\}/g, recentComments)
    .replace(/\{\{linked_task\}\}/g, linkedTask)
    .replace(/\{\{todo_context\}\}/g, todoContext)
    .replace(/\{\{mcp_skill_guidance\}\}/g, mcpSkillGuidance)
    .replace(/\{\{github_context\}\}/g, githubBlocks.githubContext)
    .replace(/\{\{github_branch_preflight\}\}/g, githubBlocks.githubBranchPreflight)
    .replace(/\{\{github_automation_prompt\}\}/g, githubBlocks.githubAutomationPrompt)
    .trim();

  return !hasExplicitGitHubPlaceholders && githubBlocks.githubSupplement
    ? [rendered, githubBlocks.githubSupplement].filter(Boolean).join("\n\n")
    : rendered;
}

async function buildTodoPromptFromTemplate(
  todo: TodoPromptSource,
  template: string,
  intent: SkillGuidanceIntent,
  workspaceRoot: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): Promise<string> {
  const githubBlocks = await buildTodoGitHubPromptBlocks(todo, workspaceRoot, deps);
  return applyTodoPromptTemplate(todo, template, intent, workspaceRoot, githubBlocks);
}

async function maybeRunBotReviewPlanning(
  todo: CockpitTodoCard,
  previousWorkflowFlag: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): Promise<"skipped" | "launched" | "failed"> {
  const nextWorkflowFlag = getTodoWorkflowFlag(todo);
  if (
    nextWorkflowFlag !== COCKPIT_NEEDS_BOT_REVIEW_FLAG
    || previousWorkflowFlag === COCKPIT_NEEDS_BOT_REVIEW_FLAG
  ) {
    return "skipped";
  }

  const reviewDefaults = deps.getReviewDefaults();
  const promptTemplate = reviewDefaults.needsBotReviewPromptTemplate.trim();
  if (!promptTemplate) {
    return "skipped";
  }

  const prompt = await buildTodoPromptFromTemplate(
    todo,
    promptTemplate,
    "needs-bot-review",
    deps.getPrimaryWorkspaceRootPath(),
    deps,
  );
  if (!prompt) {
    return "skipped";
  }

  try {
    await deps.executeBotReviewPrompt(prompt, {
      agent: reviewDefaults.needsBotReviewAgent,
      model: reviewDefaults.needsBotReviewModel,
      chatSession: reviewDefaults.needsBotReviewChatSession,
    });
    return "launched";
  } catch (_error) {
    deps.notifyError("Todo saved, but the immediate bot review could not be started.");
    return "failed";
  }
}

async function ensureReadyTodoTaskDraft(
  workspaceRoot: string,
  todo: CockpitTodoCard,
  deps: TodoCockpitActionHandlerDeps,
): Promise<{ taskId: string; taskName: string; created: boolean }> {
  const currentTasks = deps.getCurrentTasks();
  const existingTask = todo.taskId
    ? currentTasks.find((task) => task.id === todo.taskId)
    : findTodoDraftTaskForTodo(currentTasks, todo);
  if (existingTask) {
    updateCockpitTodo(workspaceRoot, todo.id, {
      taskId: existingTask.id,
      flags: existingTask.enabled !== false
        ? [COCKPIT_ON_SCHEDULE_LIST_FLAG]
        : [COCKPIT_READY_FLAG],
    });
    return {
      taskId: existingTask.id,
      taskName: existingTask.name || todo.title,
      created: false,
    };
  }

  const createdTask = await deps.createTask({
    name: todo.title,
    description: todo.description,
    cronExpression: "0 9 * * 1-5",
    prompt: await buildReadyTaskPromptFromTodo(todo, deps.getReviewDefaults(), workspaceRoot, deps),
    enabled: false,
    oneTime: true,
    labels: Array.from(new Set([...(todo.labels ?? []), "from-todo-cockpit"])),
    scope: "workspace",
    promptSource: "inline",
  });
  updateCockpitTodo(workspaceRoot, todo.id, {
    taskId: createdTask.id,
    flags: [COCKPIT_READY_FLAG],
  });
  addCockpitTodoComment(workspaceRoot, todo.id, {
    body: `Linked task draft created: ${createdTask.name}.`,
    author: "system",
    source: "system-event",
    labels: ["task-draft"],
  });
  return {
    taskId: createdTask.id,
    taskName: createdTask.name,
    created: true,
  };
}

export function isTodoCockpitAction(
  action: TaskAction["action"],
): action is TodoCockpitTaskAction {
  return TODO_COCKPIT_ACTIONS.has(action as TodoCockpitTaskAction);
}

export async function handleTodoCockpitAction(
  action: TaskAction,
  deps: TodoCockpitActionHandlerDeps,
): Promise<boolean> {
  if (!isTodoCockpitAction(action.action)) {
    return false;
  }

  switch (action.action) {
    case "createTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoData?.title) {
        deps.notifyError(deps.noWorkspaceOpenMessage);
        deps.showError(deps.noWorkspaceOpenMessage);
        return true;
      }
      const currentBoard = deps.getCurrentCockpitBoard();
      const githubSource = enrichGitHubSource(
        action.todoData.githubSource ?? undefined,
        deps.getCurrentGitHubIntegration(),
      );
      const todoInput: CreateCockpitTodoInput = {
        ...(action.todoData as CreateCockpitTodoInput),
        githubSource,
      };
      const existingTodo = findExistingTodoForGitHubSource(currentBoard, githubSource);
      if (existingTodo) {
        const previousWorkflowFlag = getTodoWorkflowFlag(existingTodo);
        const updates = buildGitHubImportUpdates(existingTodo, todoInput, githubSource);
        const result = Object.keys(updates).length > 0
          ? updateCockpitTodo(workspaceRoot, existingTodo.id, updates)
          : { board: currentBoard, todo: existingTodo };
        const refreshedTodo = result.todo ?? existingTodo;
        maybeSeedNeedsBotReviewCommentTemplate(
          workspaceRoot,
          refreshedTodo,
          previousWorkflowFlag,
          deps,
        );
        const revealFilters = getRevealFiltersForCreatedTodo(
          currentBoard.filters,
          refreshedTodo,
        );
        const botReviewLaunchState = await maybeRunBotReviewPlanning(
          refreshedTodo,
          previousWorkflowFlag,
          deps,
        );
        if (revealFilters) {
          setCockpitBoardFilters(workspaceRoot, revealFilters);
        }
        deps.refreshSchedulerUiState();
        SchedulerWebview.startCreateTodo();
        SchedulerWebview.switchToTab("board");
        deps.notifyInfo(
          botReviewLaunchState === "launched"
            ? "GitHub Todo already existed; refreshed the existing card and started bot review."
            : "GitHub Todo already existed; refreshed the existing card.",
        );
        return true;
      }
      const result = createCockpitTodo(
        workspaceRoot,
        todoInput,
      );
      maybeSeedNeedsBotReviewCommentTemplate(workspaceRoot, result.todo, undefined, deps);
      const revealFilters = getRevealFiltersForCreatedTodo(
        currentBoard.filters,
        result.todo,
      );
      const botReviewLaunchState = await maybeRunBotReviewPlanning(
        result.todo,
        undefined,
        deps,
      );
      if (revealFilters) {
        setCockpitBoardFilters(workspaceRoot, revealFilters);
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.startCreateTodo();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(
        botReviewLaunchState === "launched"
          ? "Todo Cockpit item created and bot review started."
          : "Todo Cockpit item created.",
      );
      return true;
    }

    case "updateTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const previousTodo = deps.getCurrentCockpitBoard().cards.find((entry) => entry.id === action.todoId);
      const previousWorkflowFlag = previousTodo ? getTodoWorkflowFlag(previousTodo) : undefined;
      const result = updateCockpitTodo(
        workspaceRoot,
        action.todoId,
        action.todoData ?? {},
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      maybeSeedNeedsBotReviewCommentTemplate(
        workspaceRoot,
        result.todo,
        previousWorkflowFlag,
        deps,
      );
      const botReviewLaunchState = await maybeRunBotReviewPlanning(
        result.todo,
        previousWorkflowFlag,
        deps,
      );
      const transitionedToReady = previousWorkflowFlag !== COCKPIT_READY_FLAG
        && getTodoWorkflowFlag(result.todo) === COCKPIT_READY_FLAG;
      if (transitionedToReady) {
        const draftTask = await ensureReadyTodoTaskDraft(workspaceRoot, result.todo, deps);
        deps.refreshSchedulerUiState();
        SchedulerWebview.editTask(draftTask.taskId);
        const notificationMessage = draftTask.created
          ? `Updated Todo Cockpit item and created task draft: ${draftTask.taskName}`
          : `Updated Todo Cockpit item and opened task draft: ${draftTask.taskName}`;
        deps.notifyInfoWithAction?.(
          notificationMessage,
          "Open Draft",
          () => {
            SchedulerWebview.editTask(draftTask.taskId);
          },
        );
        deps.notifyInfo(notificationMessage);
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.startCreateTodo();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(
        botReviewLaunchState === "launched"
          ? `Updated Todo Cockpit item and started bot review: ${result.todo.title}`
          : `Updated Todo Cockpit item: ${result.todo.title}`,
      );
      return true;
    }

    case "deleteTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const currentTodo = deps.getCurrentCockpitBoard().cards.find((entry) =>
        entry.id === action.todoId
      );
      if (!currentTodo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      const linkedTask = currentTodo.taskId
        ? deps.getCurrentTasks().find((task) => task.id === currentTodo.taskId)
        : undefined;
      const linkedDraftTask = linkedTask && isTodoDraftTask(linkedTask)
        ? linkedTask
        : findTodoDraftTaskForTodo(deps.getCurrentTasks(), currentTodo);
      if (linkedDraftTask) {
        const deletedLinkedTask = await deps.deleteTask(linkedDraftTask.id);
        if (!deletedLinkedTask) {
          deps.notifyError("Linked task draft could not be deleted.");
          return true;
        }
        addCockpitTodoComment(workspaceRoot, currentTodo.id, {
          body: `Deleted linked task draft: ${linkedDraftTask.name || currentTodo.title}.`,
          author: "system",
          source: "system-event",
          labels: ["task-draft"],
        });
      }
      const result = rejectCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo("Todo Cockpit item rejected and archived.");
      return true;
    }

    case "purgeTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = purgeCockpitTodo(workspaceRoot, action.todoId);
      if (!result.deleted) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo("Todo Cockpit item permanently deleted.");
      return true;
    }

    case "approveTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = approveCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Approved Todo Cockpit item: ${result.todo.title}`);
      return true;
    }

    case "rejectTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = rejectCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Rejected Todo Cockpit item: ${result.todo.title}`);
      return true;
    }

    case "archiveTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const currentTodo = getCockpitBoard(workspaceRoot).cards.find((card) =>
        card.id === action.todoId,
      );
      if (!currentTodo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }

      const restoreRequested = (
        action.todoData as { archived?: boolean } | undefined
      )?.archived === false;
      const currentWorkflowFlag = getTodoWorkflowFlag(currentTodo);
      const result = restoreRequested
        ? restoreCockpitTodo(workspaceRoot, action.todoId)
        : (currentWorkflowFlag === COCKPIT_FINAL_USER_CHECK_FLAG
          ? finalizeCockpitTodo(workspaceRoot, action.todoId)
          : rejectCockpitTodo(workspaceRoot, action.todoId));
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(
        restoreRequested
          ? `Restored Todo Cockpit item: ${result.todo.title}`
          : (currentWorkflowFlag === COCKPIT_FINAL_USER_CHECK_FLAG
            ? `Completed Todo Cockpit item: ${result.todo.title}`
            : `Archived Todo Cockpit item: ${result.todo.title}`),
      );
      return true;
    }

    case "finalizeTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = finalizeCockpitTodo(workspaceRoot, action.todoId);
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      deps.notifyInfo(`Completed Todo Cockpit item: ${result.todo.title}`);
      return true;
    }

    case "moveTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const result = moveCockpitTodo(
        workspaceRoot,
        action.todoId,
        action.targetSectionId,
        action.targetOrder ?? 0,
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "addCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionTitle) {
        return true;
      }
      const result = addCockpitSection(workspaceRoot, action.sectionTitle);
      if (result.validationError) {
        deps.notifyError(result.validationError);
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "renameCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId || !action.sectionTitle) {
        return true;
      }
      const result = renameCockpitSection(workspaceRoot, action.sectionId, action.sectionTitle);
      if (result.validationError) {
        deps.notifyError(result.validationError);
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "deleteCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId) {
        return true;
      }
      deleteCockpitSection(workspaceRoot, action.sectionId);
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "moveCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.sectionId || !action.sectionDirection) {
        return true;
      }
      moveCockpitSection(workspaceRoot, action.sectionId, action.sectionDirection);
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "reorderCockpitSection": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || action.sectionId == null || action.targetIndex == null) {
        return true;
      }
      reorderCockpitSection(workspaceRoot, action.sectionId, action.targetIndex);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "addTodoComment": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId || !action.todoCommentData?.body) {
        return true;
      }
      const result = addCockpitTodoComment(
        workspaceRoot,
        action.todoId,
        action.todoCommentData as AddCockpitTodoCommentInput,
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "deleteTodoComment": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId || action.todoCommentIndex == null) {
        return true;
      }
      const result = deleteCockpitTodoComment(
        workspaceRoot,
        action.todoId,
        action.todoCommentIndex,
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "setTodoFilters": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot) {
        return true;
      }
      const filterUpdates =
        (action.todoFilters ?? {}) as UpdateCockpitBoardFiltersInput;
      const currentBoard = deps.getCurrentCockpitBoard();
      const nextBoard = setCockpitBoardFiltersInBoard(currentBoard, filterUpdates);
      if (areCockpitBoardFiltersEqual(currentBoard.filters, nextBoard.filters)) {
        return true;
      }
      const persistedBoard = setCockpitBoardFilters(
        workspaceRoot,
        filterUpdates,
      );
      void persistedBoard;
      deps.refreshSchedulerUiState(true);
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "saveTodoLabelDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoLabelData?.name) {
        return true;
      }
      const result = saveCockpitTodoLabelDefinition(
        workspaceRoot,
        action.todoLabelData,
      );
      if (!result.label) {
        deps.notifyError("Todo Cockpit label could not be saved.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "deleteTodoLabelDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoLabelData?.name) {
        return true;
      }
      deleteCockpitTodoLabelDefinition(workspaceRoot, action.todoLabelData.name);
      await deps.removeLabelFromAllTasks(action.todoLabelData.name);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "saveTodoFlagDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoFlagData?.name) {
        return true;
      }
      const result = saveCockpitFlagDefinition(
        workspaceRoot,
        action.todoFlagData,
      );
      if (!result.label) {
        deps.notifyError("Todo Cockpit flag could not be saved.");
        return true;
      }
      deps.refreshSchedulerUiState();
      return true;
    }

    case "deleteTodoFlagDefinition": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoFlagData?.name) {
        return true;
      }
      if (isProtectedCockpitFlagKey(action.todoFlagData.name)) {
        deps.notifyError("Built-in Todo Cockpit flags cannot be deleted.");
        return true;
      }
      deleteCockpitFlagDefinition(workspaceRoot, action.todoFlagData.name);
      deps.refreshSchedulerUiState();
      return true;
    }

    case "linkTodoTask": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const currentTodo = deps.getCurrentCockpitBoard().cards.find((entry) => entry.id === action.todoId);
      const linkedTask = deps.getCurrentTasks().find((task) => task.id === action.linkedTaskId);
      const nextFlags = linkedTask?.enabled !== false
        ? [COCKPIT_ON_SCHEDULE_LIST_FLAG]
        : (currentTodo ? [getTodoWorkflowFlag(currentTodo) ?? COCKPIT_READY_FLAG] : undefined);
      const result = updateCockpitTodo(
        workspaceRoot,
        action.todoId,
        {
          taskId: action.linkedTaskId ?? null,
          flags: nextFlags,
        },
      );
      if (!result.todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      deps.refreshSchedulerUiState();
      SchedulerWebview.switchToTab("board");
      return true;
    }

    case "createTaskFromTodo": {
      const workspaceRoot = deps.getPrimaryWorkspaceRootPath();
      if (!workspaceRoot || !action.todoId) {
        return true;
      }
      const board = deps.getCurrentCockpitBoard();
      const todo = board.cards.find((entry) => entry.id === action.todoId);
      if (!todo) {
        deps.notifyError("Todo Cockpit item not found.");
        return true;
      }
      if (getTodoWorkflowFlag(todo) !== COCKPIT_READY_FLAG) {
        deps.notifyError("Task drafts can only be created or refreshed from ready todos.");
        return true;
      }
      const draftTask = await ensureReadyTodoTaskDraft(workspaceRoot, todo, deps);
      deps.refreshSchedulerUiState();
      SchedulerWebview.editTask(draftTask.taskId);
      deps.notifyInfo(
        draftTask.created
          ? `Created scheduled task draft from Todo Cockpit: ${draftTask.taskName}`
          : `Opened linked task draft from Todo Cockpit: ${draftTask.taskName}`,
      );
      return true;
    }
  }
}

async function buildReadyTaskPromptFromTodo(
  taskSource: TodoPromptSource,
  reviewDefaults: ReviewDefaultsView,
  workspaceRoot: string | undefined,
  deps: TodoCockpitActionHandlerDeps,
): Promise<string> {
  const promptTemplate = reviewDefaults.readyPromptTemplate.trim();
  if (promptTemplate) {
    return buildTodoPromptFromTemplate(
      taskSource,
      promptTemplate,
      "ready",
      workspaceRoot,
      deps,
    );
  }

  const githubBlocks = await buildTodoGitHubPromptBlocks(taskSource, workspaceRoot, deps);

  return [
    buildTodoContextBlock(taskSource),
    buildMcpSkillGuidanceBlock(workspaceRoot, "ready"),
    githubBlocks.githubSupplement,
    "Analyze this Todo using the Todo Cockpit skill and implement what the user decided in the last comment or the latest bot recommendation. If there is no recent user comment, proceed with the bot's recommendation and update the Todo to the correct workflow state afterward.",
  ].filter(Boolean).join("\n\n");
}