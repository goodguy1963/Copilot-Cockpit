import {
  COCKPIT_FINAL_USER_CHECK_FLAG,
  COCKPIT_NEEDS_USER_REVIEW_FLAG,
  COCKPIT_NEW_FLAG,
  COCKPIT_ON_SCHEDULE_LIST_FLAG,
  COCKPIT_READY_FLAG,
  describeCockpitSectionSemanticIssue,
  getActiveCockpitWorkflowFlag,
  normalizeCockpitDisabledSystemFlagKeys,
  replaceCockpitWorkflowFlag,
  DEFAULT_ARCHIVE_COMPLETED_SECTION_ID,
  DEFAULT_ARCHIVE_REJECTED_SECTION_ID,
  DEFAULT_RECURRING_TASKS_SECTION_ID,
  DEFAULT_UNSORTED_SECTION_ID,
  createDefaultCockpitBoard,
  isProtectedCockpitFlagKey,
  isArchiveSectionId,
  isRecurringTasksSectionId,
  normalizeCockpitBoard,
} from "./cockpitBoard";
import {
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./cockpitJsonSanitizer";
import type {
  AddCockpitTodoCommentInput,
  CockpitArchiveOutcome,
  CockpitBoard,
  CockpitLabelDefinition,
  CockpitTaskSnapshot,
  CockpitTodoCard,
  CockpitTodoPriority,
  CreateCockpitTodoInput,
  ScheduledTask,
  UpsertCockpitLabelDefinitionInput,
  UpdateCockpitBoardFiltersInput,
  UpdateCockpitTodoInput,
} from "./types";

type CockpitBoardPersistenceHooks = {
  loadBoard?: (workspaceRoot: string) => CockpitBoard | undefined;
  saveBoard?: (workspaceRoot: string, board: CockpitBoard) => void;
};

let cockpitBoardPersistenceHooks: CockpitBoardPersistenceHooks = {};

export function setCockpitBoardPersistenceHooks(
  hooks?: CockpitBoardPersistenceHooks,
): void {
  cockpitBoardPersistenceHooks = hooks ?? {};
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function cloneBoard(board: CockpitBoard): CockpitBoard {
  return normalizeCockpitBoard(JSON.parse(JSON.stringify(board)));
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeLabelKey(value: string): string {
  return value.trim().toLowerCase();
}

function stripLabelFromTodoCards(
  cards: CockpitTodoCard[],
  key: string,
  timestamp: string,
): void {
  for (const card of cards) {
    const nextLabels = normalizeStringList(card.labels).filter(
      (label) => normalizeLabelKey(label) !== key,
    );
    if (nextLabels.length !== normalizeStringList(card.labels).length) {
      card.labels = nextLabels;
      card.updatedAt = timestamp;
    }
  }
}

function stripFlagFromTodoCards(
  cards: CockpitTodoCard[],
  key: string,
  timestamp: string,
): void {
  for (const card of cards) {
    const nextFlags = normalizeStringList(card.flags).filter(
      (flag) => normalizeLabelKey(flag) !== key,
    );
    if (nextFlags.length !== normalizeStringList(card.flags).length) {
      card.flags = nextFlags;
      card.updatedAt = timestamp;
    }
  }
}

function renameLabelValues(
  values: string[],
  previousKey: string,
  nextName: string,
): string[] {
  const seen = new Set<string>();
  const renamed: string[] = [];

  for (const entry of normalizeStringList(values)) {
    const nextValue = normalizeLabelKey(entry) === previousKey ? nextName : entry;
    const nextKey = normalizeLabelKey(nextValue);
    if (!nextKey || seen.has(nextKey)) {
      continue;
    }
    seen.add(nextKey);
    renamed.push(nextValue);
  }

  return renamed;
}

function renameLabelOnTodoCards(
  cards: CockpitTodoCard[],
  previousKey: string,
  nextName: string,
  timestamp: string,
): void {
  for (const card of cards) {
    const currentLabels = normalizeStringList(card.labels);
    const renamedLabels = renameLabelValues(currentLabels, previousKey, nextName);
    if (!areStringListsEqual(currentLabels, renamedLabels)) {
      card.labels = renamedLabels;
      card.updatedAt = timestamp;
    }
  }
}

function renameFlagOnTodoCards(
  cards: CockpitTodoCard[],
  previousKey: string,
  nextName: string,
  timestamp: string,
): void {
  for (const card of cards) {
    const currentFlags = normalizeStringList(card.flags);
    const renamedFlags = renameLabelValues(currentFlags, previousKey, nextName);
    const nextFlags = renamedFlags;
    if (!areStringListsEqual(currentFlags, nextFlags)) {
      card.flags = nextFlags;
      card.updatedAt = timestamp;
    }
  }
}

const LEGACY_LINKED_SCHEDULED_TASK_FLAG_KEY = normalizeLabelKey("Linked scheduled task");

function ensureCardFlag(card: CockpitTodoCard, flag: string): void {
  const flags = new Set(normalizeStringList(card.flags));
  flags.add(flag);
  card.flags = Array.from(flags);
}

function setWorkflowFlag(card: CockpitTodoCard, flag: string | undefined): void {
  const nextFlags = replaceCockpitWorkflowFlag(
    normalizeStringList(card.flags).filter(
      (entry) => normalizeLabelKey(entry) !== LEGACY_LINKED_SCHEDULED_TASK_FLAG_KEY,
    ),
    flag as Parameters<typeof replaceCockpitWorkflowFlag>[1],
  );
  card.flags = nextFlags;
}

function getWorkflowFlag(card: Pick<CockpitTodoCard, "flags">): string | undefined {
  return getActiveCockpitWorkflowFlag(card.flags);
}

function deriveDefaultWorkflowFlag(
  card: Pick<CockpitTodoCard, "flags" | "taskId">,
  taskIdOverride?: string,
): string {
  const current = getWorkflowFlag(card);
  if (current === COCKPIT_FINAL_USER_CHECK_FLAG) {
    return current;
  }
  if (current === COCKPIT_ON_SCHEDULE_LIST_FLAG && !(taskIdOverride ?? card.taskId)) {
    return COCKPIT_NEEDS_USER_REVIEW_FLAG;
  }
  if (current) {
    return current;
  }
  return (taskIdOverride ?? card.taskId)
    ? COCKPIT_READY_FLAG
    : COCKPIT_NEW_FLAG;
}

function ensureScheduledTaskFlags(card: CockpitTodoCard): void {
  setWorkflowFlag(card, COCKPIT_ON_SCHEDULE_LIST_FLAG);
}

function getArchiveSectionId(outcome: CockpitArchiveOutcome): string {
  return outcome === "completed-successfully"
    ? DEFAULT_ARCHIVE_COMPLETED_SECTION_ID
    : DEFAULT_ARCHIVE_REJECTED_SECTION_ID;
}

function isOneTimeTask(task: Pick<ScheduledTask, "id" | "oneTime">): boolean {
  return task.oneTime === true
    || (typeof task.id === "string" && task.id.startsWith("exec-"));
}

function hashTaskPrompt(prompt: string | undefined): string {
  const text = String(prompt || "");
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}

function buildTaskSnapshot(task: ScheduledTask): CockpitTaskSnapshot {
  return {
    name: task.name,
    description: normalizeOptionalString(task.description),
    cronExpression: task.cronExpression,
    enabled: task.enabled !== false,
    oneTime: isOneTimeTask(task),
    manualSession: task.manualSession === true ? true : undefined,
    agent: normalizeOptionalString(task.agent),
    model: normalizeOptionalString(task.model),
    labels: normalizeStringList(task.labels),
    promptHash: hashTaskPrompt(task.prompt),
  };
}

function areStringListsEqual(left: string[] = [], right: string[] = []): boolean {
  return left.length === right.length
    && left.every((entry, index) => entry === right[index]);
}

function formatSnapshotValue(value: string | undefined): string {
  return value && value.trim() ? value.trim() : "-";
}

function buildRecurringTaskChangeComment(
  previous: CockpitTaskSnapshot | undefined,
  next: CockpitTaskSnapshot,
): string | undefined {
  if (!previous) {
    return undefined;
  }

  const changes: string[] = [];
  if (previous.name !== next.name) {
    changes.push(`renamed from "${previous.name}" to "${next.name}"`);
  }
  if ((previous.description || "") !== (next.description || "")) {
    changes.push("description updated");
  }
  if (previous.cronExpression !== next.cronExpression) {
    changes.push(`schedule changed from "${previous.cronExpression}" to "${next.cronExpression}"`);
  }
  if (previous.promptHash !== next.promptHash) {
    changes.push("prompt updated");
  }
  if (formatSnapshotValue(previous.agent) !== formatSnapshotValue(next.agent)) {
    changes.push(`agent changed from "${formatSnapshotValue(previous.agent)}" to "${formatSnapshotValue(next.agent)}"`);
  }
  if (formatSnapshotValue(previous.model) !== formatSnapshotValue(next.model)) {
    changes.push(`model changed from "${formatSnapshotValue(previous.model)}" to "${formatSnapshotValue(next.model)}"`);
  }
  if (previous.enabled !== next.enabled) {
    changes.push(next.enabled ? "task enabled" : "task disabled");
  }
  if (!areStringListsEqual(previous.labels, next.labels)) {
    changes.push(
      `task labels changed from "${previous.labels.join(", ") || "-"}" to "${next.labels.join(", ") || "-"}"`,
    );
  }

  return changes.length > 0
    ? `Recurring task updated: ${changes.join("; ")}.`
    : undefined;
}

function ensureCardLabel(card: CockpitTodoCard, label: string): void {
  const labels = new Set(normalizeStringList(card.labels));
  labels.add(label);
  card.labels = Array.from(labels);
}

function dropCardLabel(card: CockpitTodoCard, label: string): void {
  const key = normalizeLabelKey(label);
  card.labels = normalizeStringList(card.labels).filter((entry) => normalizeLabelKey(entry) !== key);
}

function normalizeTodoCommentBodyInput(value: unknown): string {
  const trimmed = String(value ?? "").trim();
  const normalizedLineEndings = trimmed.replace(/\r\n?/g, "\n");

  if (normalizedLineEndings.includes("\n")) {
    return normalizedLineEndings;
  }

  return normalizedLineEndings
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n");
}

function appendTodoCommentRecord(
  todo: CockpitTodoCard,
  input: AddCockpitTodoCommentInput,
  timestamp: string,
): void {
  todo.comments.push({
    id: createId("comment"),
    author: input.author === "user" ? "user" : "system",
    body: normalizeTodoCommentBodyInput(input.body),
    labels: normalizeStringList(input.labels),
    source: input.source ?? (input.author === "user" ? "human-form" : "system-event"),
    sequence: todo.comments.length + 1,
    createdAt: timestamp,
  });
}

function addSystemEventComment(
  todo: CockpitTodoCard,
  body: string,
  labels: string[] = [],
  timestamp: string,
): void {
  appendTodoCommentRecord(
    todo,
    {
      body,
      author: "system",
      source: "system-event",
      labels,
    },
    timestamp,
  );
}

function isLifecycleCommentLabeled(
  todo: Pick<CockpitTodoCard, "comments">,
  label: string,
): boolean {
  const key = normalizeLabelKey(label);
  return todo.comments.some((comment) =>
    normalizeStringList(comment.labels).some((entry) => normalizeLabelKey(entry) === key),
  );
}

function resequenceTodoComments(todo: Pick<CockpitTodoCard, "comments">): void {
  todo.comments.forEach((comment, index) => {
    comment.sequence = index + 1;
  });
}

function isStaleDisabledLifecycleComment(
  comment: CockpitTodoCard["comments"][number],
  taskEnabled: boolean,
): boolean {
  const labels = normalizeStringList(comment.labels).map((entry) => normalizeLabelKey(entry));
  return (taskEnabled && labels.includes("task-disabled"))
    || (!taskEnabled && labels.includes("task-enabled"));
}

function normalizeTaskLinkedTodoForTask(
  card: CockpitTodoCard,
  task: ScheduledTask,
  timestamp: string,
): boolean {
  let changed = false;
  const nextSnapshot = buildTaskSnapshot(task);
  const previousFlags = normalizeStringList(card.flags);
  const filteredComments = card.comments.filter((comment) =>
    !isStaleDisabledLifecycleComment(comment, nextSnapshot.enabled),
  );

  if (filteredComments.length !== card.comments.length) {
    card.comments = filteredComments;
    resequenceTodoComments(card);
    changed = true;
  }

  if (card.taskId !== task.id) {
    card.taskId = task.id;
    changed = true;
  }

  if (!card.taskSnapshot || JSON.stringify(card.taskSnapshot) !== JSON.stringify(nextSnapshot)) {
    card.taskSnapshot = nextSnapshot;
    changed = true;
  }

  ensureScheduledTaskFlags(card);
  if (!areStringListsEqual(previousFlags, card.flags)) {
    changed = true;
  }

  if (!nextSnapshot.enabled) {
    if (card.archived || card.archiveOutcome || card.archivedAt) {
      card.archived = false;
      card.archiveOutcome = undefined;
      card.archivedAt = undefined;
      changed = true;
    }
    if (card.status !== "active") {
      card.status = "active";
      changed = true;
    }
    if (card.approvedAt || card.completedAt || card.rejectedAt) {
      card.approvedAt = undefined;
      card.completedAt = undefined;
      card.rejectedAt = undefined;
      changed = true;
    }

    if (!isLifecycleCommentLabeled(card, "task-disabled") && !isRecurringTasksSectionId(card.sectionId)) {
      addSystemEventComment(
        card,
        "Linked task is disabled. Todo reset to active planning state.",
        ["scheduled-task", "task-disabled"],
        timestamp,
      );
      changed = true;
    }
  } else if (!isRecurringTasksSectionId(card.sectionId) && !isLifecycleCommentLabeled(card, "task-enabled")) {
    addSystemEventComment(
      card,
      "Linked task is enabled again.",
      ["scheduled-task", "task-enabled"],
      timestamp,
    );
    changed = true;
  }

  if (changed) {
    card.updatedAt = timestamp;
  }

  return changed;
}

function normalizeOneTimeTaskLinkedTodoForTask(
  card: CockpitTodoCard,
  task: ScheduledTask,
  timestamp: string,
): boolean {
  let changed = false;
  const nextSnapshot = buildTaskSnapshot(task);
  const previousFlags = normalizeStringList(card.flags);
  const previousWorkflowFlag = getWorkflowFlag(card);
  const filteredComments = card.comments.filter((comment) =>
    !isStaleDisabledLifecycleComment(comment, nextSnapshot.enabled),
  );

  if (filteredComments.length !== card.comments.length) {
    card.comments = filteredComments;
    resequenceTodoComments(card);
    changed = true;
  }

  if (card.taskId !== task.id) {
    card.taskId = task.id;
    changed = true;
  }

  if (!card.taskSnapshot || JSON.stringify(card.taskSnapshot) !== JSON.stringify(nextSnapshot)) {
    card.taskSnapshot = nextSnapshot;
    changed = true;
  }

  if (card.archived || card.archiveOutcome || card.archivedAt) {
    card.archived = false;
    card.archiveOutcome = undefined;
    card.archivedAt = undefined;
    changed = true;
  }
  if (card.status !== "active") {
    card.status = "active";
    changed = true;
  }
  if (card.completedAt || card.rejectedAt) {
    card.completedAt = undefined;
    card.rejectedAt = undefined;
    changed = true;
  }

  setWorkflowFlag(card, nextSnapshot.enabled ? COCKPIT_ON_SCHEDULE_LIST_FLAG : COCKPIT_READY_FLAG);
  if (!areStringListsEqual(previousFlags, card.flags)) {
    changed = true;
  }

  if (nextSnapshot.enabled) {
    if (previousWorkflowFlag !== COCKPIT_ON_SCHEDULE_LIST_FLAG && !isLifecycleCommentLabeled(card, "task-enabled")) {
      addSystemEventComment(
        card,
        "Linked task left draft-only mode and is now an active execution artifact.",
        ["scheduled-task", "task-enabled"],
        timestamp,
      );
      changed = true;
    }
  } else if (previousWorkflowFlag === COCKPIT_ON_SCHEDULE_LIST_FLAG && !isLifecycleCommentLabeled(card, "task-disabled")) {
    addSystemEventComment(
      card,
      "Linked task returned to draft-only mode. Todo moved back to ready.",
      ["scheduled-task", "task-disabled"],
      timestamp,
    );
    changed = true;
  }

  if (changed) {
    card.updatedAt = timestamp;
  }

  return changed;
}

function normalizeMissingOneTimeTaskLinkedTodo(
  card: CockpitTodoCard,
  timestamp: string,
): boolean {
  let changed = false;
  const previousFlags = normalizeStringList(card.flags);
  const previousWorkflowFlag = getWorkflowFlag(card);
  const previousSnapshotEnabled = card.taskSnapshot?.enabled === true;

  if (card.taskId) {
    card.taskId = undefined;
    changed = true;
  }

  if (card.taskSnapshot) {
    card.taskSnapshot = {
      ...card.taskSnapshot,
      enabled: false,
    };
    changed = true;
  }

  if (card.archived || card.archiveOutcome || card.archivedAt) {
    card.archived = false;
    card.archiveOutcome = undefined;
    card.archivedAt = undefined;
    changed = true;
  }
  if (card.status !== "active") {
    card.status = "active";
    changed = true;
  }
  if (card.completedAt || card.rejectedAt) {
    card.completedAt = undefined;
    card.rejectedAt = undefined;
    changed = true;
  }

  const nextWorkflowFlag = previousWorkflowFlag === COCKPIT_ON_SCHEDULE_LIST_FLAG || previousSnapshotEnabled
    ? COCKPIT_FINAL_USER_CHECK_FLAG
    : COCKPIT_READY_FLAG;
  setWorkflowFlag(card, nextWorkflowFlag);
  if (!areStringListsEqual(previousFlags, card.flags)) {
    changed = true;
  }

  const commentLabel = nextWorkflowFlag === COCKPIT_FINAL_USER_CHECK_FLAG
    ? "task-complete"
    : "task-link-cleared";
  if (!isLifecycleCommentLabeled(card, commentLabel)) {
    addSystemEventComment(
      card,
      nextWorkflowFlag === COCKPIT_FINAL_USER_CHECK_FLAG
        ? "Linked one-time task is no longer present. Todo moved to FINAL-USER-CHECK for acceptance."
        : "Linked task draft no longer exists. Cleared the stale task link and kept the Todo ready.",
      ["scheduled-task", commentLabel],
      timestamp,
    );
    changed = true;
  }

  if (changed) {
    card.updatedAt = timestamp;
  }

  return changed;
}

function upsertLabelDefinitionInBoard(
  board: CockpitBoard,
  input: UpsertCockpitLabelDefinitionInput,
): { board: CockpitBoard; label: CockpitLabelDefinition | undefined } {
  const name = normalizeOptionalString(input.name);
  if (!name) {
    return {
      board: cloneBoard(board),
      label: undefined,
    };
  }

  const nextBoard = cloneBoard(board);
  const timestamp = nowIso();
  const key = normalizeLabelKey(name);
  const previousName = normalizeOptionalString(input.previousName);
  const previousKey = previousName ? normalizeLabelKey(previousName) : "";
  const nextCatalog = Array.isArray(nextBoard.labelCatalog)
    ? nextBoard.labelCatalog.slice()
    : [];
  const existingIndex = nextCatalog.findIndex((entry) => entry.key === key);
  const previousIndex = previousKey && previousKey !== key
    ? nextCatalog.findIndex((entry) => entry.key === previousKey)
    : -1;
  const sourceEntry = existingIndex >= 0
    ? nextCatalog[existingIndex]
    : (previousIndex >= 0 ? nextCatalog[previousIndex] : undefined);
  const label: CockpitLabelDefinition = sourceEntry
    ? {
      ...sourceEntry,
      name,
      key,
      color: normalizeOptionalString(input.color)
        ?? sourceEntry.color,
      updatedAt: timestamp,
    }
    : {
      name,
      key,
      color: normalizeOptionalString(input.color) ?? "var(--vscode-badge-background)",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

  if (existingIndex >= 0) {
    nextCatalog[existingIndex] = label;
  } else if (previousIndex >= 0) {
    nextCatalog[previousIndex] = label;
  } else {
    nextCatalog.push(label);
  }

  if (previousIndex >= 0 && existingIndex >= 0 && previousIndex !== existingIndex) {
    nextCatalog.splice(previousIndex, 1);
  }

  if (previousKey && previousKey !== key) {
    renameLabelOnTodoCards(nextBoard.cards, previousKey, name, timestamp);
    if (nextBoard.filters) {
      nextBoard.filters.labels = renameLabelValues(
        nextBoard.filters.labels ?? [],
        previousKey,
        name,
      );
    }
  }

  nextBoard.labelCatalog = nextCatalog.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  nextBoard.deletedLabelCatalogKeys = (nextBoard.deletedLabelCatalogKeys ?? [])
    .filter((entry) => entry !== key && entry !== previousKey);
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, label };
}

function upsertFlagDefinitionInBoard(
  board: CockpitBoard,
  input: UpsertCockpitLabelDefinitionInput,
): { board: CockpitBoard; label: CockpitLabelDefinition | undefined } {
  const name = normalizeOptionalString(input.name);
  if (!name) {
    return {
      board: cloneBoard(board),
      label: undefined,
    };
  }

  const nextBoard = cloneBoard(board);
  const timestamp = nowIso();
  const key = normalizeLabelKey(name);
  const previousName = normalizeOptionalString(input.previousName);
  const previousKey = previousName ? normalizeLabelKey(previousName) : "";
  const nextCatalog = Array.isArray(nextBoard.flagCatalog)
    ? nextBoard.flagCatalog.slice()
    : [];
  const existingIndex = nextCatalog.findIndex((entry) => entry.key === key);
  const previousIndex = previousKey && previousKey !== key
    ? nextCatalog.findIndex((entry) => entry.key === previousKey)
    : -1;
  const sourceEntry = existingIndex >= 0
    ? nextCatalog[existingIndex]
    : (previousIndex >= 0 ? nextCatalog[previousIndex] : undefined);
  const label: CockpitLabelDefinition = sourceEntry
    ? {
      ...sourceEntry,
      name,
      key,
      color: normalizeOptionalString(input.color)
        ?? sourceEntry.color,
      updatedAt: timestamp,
    }
    : {
      name,
      key,
      color: normalizeOptionalString(input.color) ?? "var(--vscode-badge-background)",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

  if (existingIndex >= 0) {
    nextCatalog[existingIndex] = label;
  } else if (previousIndex >= 0) {
    nextCatalog[previousIndex] = label;
  } else {
    nextCatalog.push(label);
  }

  if (previousIndex >= 0 && existingIndex >= 0 && previousIndex !== existingIndex) {
    nextCatalog.splice(previousIndex, 1);
  }

  if (previousKey && previousKey !== key) {
    renameFlagOnTodoCards(nextBoard.cards, previousKey, name, timestamp);
    if (nextBoard.filters) {
      const renamedFlags = renameLabelValues(
        nextBoard.filters.flags ?? [],
        previousKey,
        name,
      );
      nextBoard.filters.flags = renamedFlags;
    }
  }

  nextBoard.flagCatalog = nextCatalog.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  nextBoard.deletedFlagCatalogKeys = (nextBoard.deletedFlagCatalogKeys ?? [])
    .filter((entry) => entry !== key && entry !== previousKey);
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, label };
}

function archiveTodoInBoardByOutcome(
  board: CockpitBoard,
  todoId: string,
  outcome: CockpitArchiveOutcome,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todoIndex = nextBoard.cards.findIndex((card) => card.id === todoId);
  if (todoIndex < 0) {
    return { board: nextBoard, todo: undefined };
  }

  const timestamp = nowIso();
  const [todo] = nextBoard.cards.splice(todoIndex, 1);
  todo.archived = true;
  todo.archivedAt = timestamp;
  todo.archiveOutcome = outcome;
  todo.taskId = undefined;
  todo.sectionId = getArchiveSectionId(outcome);
  todo.updatedAt = timestamp;
  setWorkflowFlag(todo, undefined);

  if (outcome === "completed-successfully") {
    todo.status = "completed";
    todo.completedAt = timestamp;
    addSystemEventComment(todo, "Completed and moved to the completed archive.", ["archived", "archive-completed"], timestamp);
  } else {
    todo.status = "rejected";
    todo.rejectedAt = timestamp;
    addSystemEventComment(todo, "Rejected and moved to the rejected archive.", ["archived", "archive-rejected"], timestamp);
  }

  resequenceCards(nextBoard, todo.sectionId);
  nextBoard.cards.unshift(todo);
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, todo };
}

export function restoreArchivedTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo) {
    return { board: nextBoard, todo: undefined };
  }

  if (!todo.archived && !isArchiveSectionId(todo.sectionId)) {
    return { board: nextBoard, todo };
  }

  const timestamp = nowIso();
  const previousSectionId = todo.sectionId;
  const restoredSectionId = getSectionOrFallback(nextBoard, DEFAULT_UNSORTED_SECTION_ID);
  const wasCompleted = todo.archiveOutcome === "completed-successfully"
    || todo.status === "completed";

  todo.archived = false;
  todo.archivedAt = undefined;
  todo.archiveOutcome = undefined;
  todo.sectionId = restoredSectionId;
  todo.order = nextBoard.cards.filter((card) =>
    card.id !== todo.id && card.sectionId === restoredSectionId,
  ).length;
  todo.status = "active";
  todo.completedAt = undefined;
  todo.rejectedAt = undefined;
  todo.updatedAt = timestamp;
  setWorkflowFlag(
    todo,
    wasCompleted ? COCKPIT_READY_FLAG : COCKPIT_NEEDS_USER_REVIEW_FLAG,
  );

  addSystemEventComment(
    todo,
    wasCompleted
      ? "Restored from archive and marked ready again."
      : "Restored from archive and reopened for follow-up.",
    ["restored"],
    timestamp,
  );

  resequenceCards(nextBoard, previousSectionId);
  resequenceCards(nextBoard, restoredSectionId);
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, todo };
}

function getSectionOrFallback(board: CockpitBoard, sectionId?: string): string {
  const sections = Array.isArray(board.sections) ? board.sections : [];
  const requested = normalizeOptionalString(sectionId);
  if (requested && sections.some((section) => section.id === requested)) {
    return requested;
  }

  return sections.find((section) => section.id === DEFAULT_UNSORTED_SECTION_ID)?.id
    ?? sections[0]?.id
    ?? DEFAULT_UNSORTED_SECTION_ID;
}

function resequenceCards(board: CockpitBoard, sectionId?: string): void {
  const targetSectionIds = sectionId
    ? [sectionId]
    : Array.from(new Set((board.cards ?? []).map((card) => card.sectionId)));

  for (const currentSectionId of targetSectionIds) {
    const sectionCards = (board.cards ?? [])
      .filter((card) => card.sectionId === currentSectionId)
      .sort((left, right) => (left.order || 0) - (right.order || 0));
    sectionCards.forEach((card, index) => {
      card.order = index;
    });
  }
}

function touchBoard(board: CockpitBoard, timestamp = nowIso()): void {
  board.updatedAt = timestamp;
}

function persistBoard(workspaceRoot: string, board: CockpitBoard): CockpitBoard {
  const config = readSchedulerConfig(workspaceRoot);
  const nextBoard = normalizeCockpitBoard(board);
  writeSchedulerConfig(workspaceRoot, {
    ...config,
    cockpitBoard: nextBoard,
  }, {
    baseConfig: config,
  });
  cockpitBoardPersistenceHooks.saveBoard?.(workspaceRoot, nextBoard);
  return nextBoard;
}

function deriveTaskPriority(task: ScheduledTask): CockpitTodoCard["priority"] {
  if (!(task.nextRun instanceof Date)) {
    return "none";
  }

  const deltaMs = task.nextRun.getTime() - Date.now();
  if (deltaMs <= 60 * 60 * 1000) {
    return "urgent";
  }
  if (deltaMs <= 6 * 60 * 60 * 1000) {
    return "high";
  }
  if (deltaMs <= 24 * 60 * 60 * 1000) {
    return "medium";
  }
  return "low";
}

function createRecurringTaskTodoCard(
  board: CockpitBoard,
  task: ScheduledTask,
  timestamp: string,
): CockpitTodoCard {
  const recurringSectionId = getSectionOrFallback(board, DEFAULT_RECURRING_TASKS_SECTION_ID);
  const todo: CockpitTodoCard = {
    id: createId("todo"),
    title: task.name || "Unnamed recurring task",
    description: normalizeOptionalString(task.description),
    sectionId: recurringSectionId,
    order: board.cards.filter((card) => card.sectionId === recurringSectionId).length,
    priority: deriveTaskPriority(task),
    dueAt: undefined,
    status: "active",
    labels: ["scheduled-task", "recurring-task"],
    flags: [COCKPIT_ON_SCHEDULE_LIST_FLAG],
    comments: [],
    taskSnapshot: buildTaskSnapshot(task),
    taskId: task.id,
    sessionId: undefined,
    archived: false,
    createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : timestamp,
    updatedAt: timestamp,
  };

  addSystemEventComment(
    todo,
    "Recurring task linked. Future schedule, prompt, model, and label changes will be recorded here.",
    ["recurring-task"],
    timestamp,
  );

  if (task.lastError) {
    appendTodoCommentRecord(todo, {
      body: `Existing scheduled task error: ${task.lastError}`,
      author: "system",
      source: "system-event",
      labels: ["task-error"],
    }, task.lastErrorAt instanceof Date ? task.lastErrorAt.toISOString() : timestamp);
  }

  return todo;
}

function syncRecurringTaskTodoCard(
  board: CockpitBoard,
  card: CockpitTodoCard,
  task: ScheduledTask,
  timestamp: string,
): void {
  const previousSnapshot = card.taskSnapshot;
  const nextSnapshot = buildTaskSnapshot(task);
  const previousSectionId = card.sectionId;
  const previousLabels = normalizeStringList(card.labels);
  const nextTitle = task.name || card.title;
  const nextDescription = normalizeOptionalString(task.description);
  const nextPriority = deriveTaskPriority(task);
  const nextSectionId = getSectionOrFallback(board, DEFAULT_RECURRING_TASKS_SECTION_ID);
  let changed = false;

  if (card.title !== nextTitle) {
    card.title = nextTitle;
    changed = true;
  }
  if ((card.description || "") !== (nextDescription || "")) {
    card.description = nextDescription;
    changed = true;
  }
  if (card.priority !== nextPriority) {
    card.priority = nextPriority;
    changed = true;
  }
  if (card.taskId !== task.id) {
    card.taskId = task.id;
    changed = true;
  }
  if (card.sectionId !== nextSectionId) {
    card.sectionId = nextSectionId;
    changed = true;
  }
  if (card.archived || card.archiveOutcome || card.archivedAt) {
    card.archived = false;
    card.archiveOutcome = undefined;
    card.archivedAt = undefined;
    changed = true;
  }
  if (card.status === "completed" || card.status === "rejected") {
    card.status = "active";
    card.completedAt = undefined;
    card.rejectedAt = undefined;
    changed = true;
  }
  if (!previousSnapshot || JSON.stringify(previousSnapshot) !== JSON.stringify(nextSnapshot)) {
    card.taskSnapshot = nextSnapshot;
    changed = true;
  }
  ensureCardLabel(card, "scheduled-task");
  ensureCardLabel(card, "recurring-task");
  if (!areStringListsEqual(previousLabels, card.labels)) {
    changed = true;
  }

  const changeComment = buildRecurringTaskChangeComment(previousSnapshot, nextSnapshot);
  if (changeComment) {
    addSystemEventComment(card, changeComment, ["recurring-task"], timestamp);
    changed = true;
  }

  if (changed) {
    card.updatedAt = timestamp;
    resequenceCards(board, previousSectionId);
    resequenceCards(board, card.sectionId);
  }
}

function moveRecurringCardOutOfRecurringSection(
  board: CockpitBoard,
  card: CockpitTodoCard,
  task: ScheduledTask,
  timestamp: string,
): void {
  if (!isRecurringTasksSectionId(card.sectionId)) {
    return;
  }

  const previousSectionId = card.sectionId;
  const unsortedSectionId = getSectionOrFallback(board, DEFAULT_UNSORTED_SECTION_ID);
  card.sectionId = unsortedSectionId;
  card.order = board.cards.filter((entry) => entry.id !== card.id && entry.sectionId === unsortedSectionId).length;
  card.taskSnapshot = buildTaskSnapshot(task);
  card.updatedAt = timestamp;
  dropCardLabel(card, "recurring-task");
  ensureScheduledTaskFlags(card);
  addSystemEventComment(
    card,
    "Scheduled task changed to one-time. This card was moved out of Recurring Tasks and kept as the linked planning record.",
    ["scheduled-task"],
    timestamp,
  );
  resequenceCards(board, previousSectionId);
  resequenceCards(board, unsortedSectionId);
}

export function getCockpitBoard(workspaceRoot: string): CockpitBoard {
  const hookedBoard = cockpitBoardPersistenceHooks.loadBoard?.(workspaceRoot);
  if (hookedBoard) {
    return normalizeCockpitBoard(hookedBoard);
  }

  const config = readSchedulerConfig(workspaceRoot);
  if (config.cockpitBoard) {
    const nextBoard = normalizeCockpitBoard(config.cockpitBoard);
    writeSchedulerConfig(workspaceRoot, {
      ...config,
      cockpitBoard: nextBoard,
    }, {
      baseConfig: config,
    });
    return nextBoard;
  }

  const seededBoard = createDefaultCockpitBoard();
  writeSchedulerConfig(workspaceRoot, {
    ...config,
    cockpitBoard: seededBoard,
  }, {
    baseConfig: config,
  });
  return seededBoard;
}

export function saveCockpitBoard(
  workspaceRoot: string,
  board: CockpitBoard,
): CockpitBoard {
  return persistBoard(workspaceRoot, board);
}

export function createTodoInBoard(
  board: CockpitBoard,
  input: CreateCockpitTodoInput,
): { board: CockpitBoard; todo: CockpitTodoCard } {
  const nextBoard = cloneBoard(board);
  const timestamp = nowIso();
  const sectionId = getSectionOrFallback(nextBoard, input.sectionId);
  const requestedTaskId = normalizeOptionalString(input.taskId);
  const requestedStatus = input.status;
  const requestedStatusKey = typeof requestedStatus === "string"
    ? requestedStatus.toLowerCase()
    : undefined;
  const requestedArchiveOutcome: CockpitArchiveOutcome | undefined = requestedStatus === "completed"
    ? "completed-successfully"
    : (requestedStatus === "rejected" ? "rejected" : undefined);
  const workflowFlag = requestedArchiveOutcome
    ? undefined
    : (requestedStatusKey === "ready"
      ? COCKPIT_READY_FLAG
      : (getActiveCockpitWorkflowFlag(normalizeStringList(input.flags))
        ?? (requestedTaskId ? COCKPIT_READY_FLAG : COCKPIT_NEW_FLAG)));
  const todo: CockpitTodoCard = {
    id: normalizeOptionalString(input.id) ?? createId("todo"),
    title: String(input.title || "").trim() || "Untitled todo",
    description: normalizeOptionalString(input.description),
    sectionId: requestedArchiveOutcome ? getArchiveSectionId(requestedArchiveOutcome) : sectionId,
    order: nextBoard.cards.filter((card) => card.sectionId === (requestedArchiveOutcome ? getArchiveSectionId(requestedArchiveOutcome) : sectionId)).length,
    priority: input.priority ?? "none",
    dueAt: normalizeOptionalString(input.dueAt),
    status: requestedArchiveOutcome
      ? (requestedArchiveOutcome === "completed-successfully" ? "completed" : "rejected")
      : "active",
    labels: normalizeStringList(input.labels),
    flags: replaceCockpitWorkflowFlag(input.flags, workflowFlag as Parameters<typeof replaceCockpitWorkflowFlag>[1]),
    comments: [],
    taskId: requestedTaskId,
    sessionId: normalizeOptionalString(input.sessionId),
    archived: Boolean(requestedArchiveOutcome),
    archiveOutcome: requestedArchiveOutcome,
    approvedAt: workflowFlag === COCKPIT_READY_FLAG ? timestamp : undefined,
    completedAt: requestedArchiveOutcome === "completed-successfully" ? timestamp : undefined,
    rejectedAt: requestedArchiveOutcome === "rejected" ? timestamp : undefined,
    archivedAt: requestedArchiveOutcome ? timestamp : undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  addSystemEventComment(
    todo,
    `Todo created on ${todo.createdAt}.`,
    ["created"],
    timestamp,
  );

  if (normalizeOptionalString(input.comment)) {
    appendTodoCommentRecord(todo, {
      body: input.comment!,
      author: input.author,
      source: input.commentSource,
      labels: [],
    }, timestamp);
  }

  nextBoard.deletedCardIds = (nextBoard.deletedCardIds ?? []).filter(
    (cardId) => cardId !== todo.id,
  );
  nextBoard.cards.push(todo);
  resequenceCards(nextBoard, sectionId);
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, todo };
}

export function updateTodoInBoard(
  board: CockpitBoard,
  todoId: string,
  updates: UpdateCockpitTodoInput,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo) {
    return { board: nextBoard, todo: undefined };
  }

  const previousSectionId = todo.sectionId;
  const nextSectionId = updates.sectionId
    ? getSectionOrFallback(nextBoard, updates.sectionId)
    : previousSectionId;
  const timestamp = nowIso();

  if (typeof updates.title === "string" && updates.title.trim()) {
    todo.title = updates.title.trim();
  }
  if (updates.description !== undefined) {
    todo.description = normalizeOptionalString(updates.description ?? undefined);
  }
  if (updates.dueAt !== undefined) {
    todo.dueAt = normalizeOptionalString(updates.dueAt ?? undefined);
  }
  if (updates.priority) {
    todo.priority = updates.priority;
  }
  if (updates.labels) {
    todo.labels = normalizeStringList(updates.labels);
  }
  if (updates.taskId !== undefined) {
    todo.taskId = normalizeOptionalString(updates.taskId ?? undefined);
  }
  if (updates.sessionId !== undefined) {
    todo.sessionId = normalizeOptionalString(updates.sessionId ?? undefined);
  }
  const requestedArchiveOutcome: CockpitArchiveOutcome | undefined = updates.archiveOutcome === null
    ? undefined
    : (updates.archiveOutcome ?? (updates.status === "completed"
      ? "completed-successfully"
      : (updates.status === "rejected" ? "rejected" : undefined)));
  const shouldArchive = updates.archived === true || Boolean(requestedArchiveOutcome);
  const requestedStatusKey = typeof updates.status === "string"
    ? updates.status.toLowerCase()
    : undefined;
  const workflowFlag = shouldArchive
    ? undefined
    : (requestedStatusKey === "ready"
      ? COCKPIT_READY_FLAG
      : (updates.flags
        ? getActiveCockpitWorkflowFlag(updates.flags)
        : deriveDefaultWorkflowFlag(todo, todo.taskId)));
  todo.flags = replaceCockpitWorkflowFlag(
    updates.flags ?? todo.flags,
    workflowFlag as Parameters<typeof replaceCockpitWorkflowFlag>[1],
  );
  todo.sectionId = shouldArchive
    ? getArchiveSectionId(requestedArchiveOutcome ?? "rejected")
    : nextSectionId;
  if (typeof updates.order === "number" && Number.isFinite(updates.order)) {
    todo.order = Math.max(0, Math.floor(updates.order));
  }
  if (shouldArchive) {
    const archiveOutcome = requestedArchiveOutcome ?? todo.archiveOutcome ?? "rejected";
    todo.archived = true;
    todo.archiveOutcome = archiveOutcome;
    todo.taskId = undefined;
    todo.status = archiveOutcome === "completed-successfully" ? "completed" : "rejected";
    todo.archivedAt = todo.archivedAt ?? timestamp;
    todo.completedAt = archiveOutcome === "completed-successfully"
      ? (todo.completedAt ?? timestamp)
      : undefined;
    todo.rejectedAt = archiveOutcome === "rejected"
      ? (todo.rejectedAt ?? timestamp)
      : undefined;
  } else {
    if (typeof updates.archived === "boolean") {
      todo.archived = updates.archived;
    }
    if (updates.archiveOutcome !== undefined) {
      todo.archiveOutcome = undefined;
    }
    todo.status = "active";
    todo.archived = false;
    todo.archiveOutcome = undefined;
    todo.archivedAt = undefined;
    todo.completedAt = undefined;
    todo.rejectedAt = undefined;
    if (workflowFlag === COCKPIT_READY_FLAG) {
      todo.approvedAt = todo.approvedAt ?? timestamp;
    }
  }
  todo.updatedAt = timestamp;
  resequenceCards(nextBoard, previousSectionId);
  resequenceCards(nextBoard, nextSectionId);
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, todo };
}

export function deleteTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; deleted: boolean } {
  const result = archiveTodoInBoardByOutcome(board, todoId, "rejected");
  return { board: result.board, deleted: Boolean(result.todo) };
}

export function purgeTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; deleted: boolean } {
  const nextBoard = cloneBoard(board);
  const todoIndex = nextBoard.cards.findIndex((card) => card.id === todoId);
  if (todoIndex < 0) {
    return { board: nextBoard, deleted: false };
  }

  const [todo] = nextBoard.cards.splice(todoIndex, 1);
  nextBoard.deletedCardIds = Array.from(new Set([
    ...(nextBoard.deletedCardIds ?? []),
    todo.id,
  ]));
  resequenceCards(nextBoard, todo.sectionId);
  touchBoard(nextBoard, nowIso());
  return { board: nextBoard, deleted: true };
}

export function approveTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo) {
    return { board: nextBoard, todo: undefined };
  }

  if (todo.archived || getWorkflowFlag(todo) === COCKPIT_READY_FLAG) {
    return { board: nextBoard, todo };
  }

  const timestamp = nowIso();
  todo.status = "active";
  setWorkflowFlag(todo, COCKPIT_READY_FLAG);
  todo.approvedAt = timestamp;
  todo.updatedAt = timestamp;
  addSystemEventComment(
    todo,
    "Approved and marked ready for task draft creation.",
    ["approved"],
    timestamp,
  );
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, todo };
}

export function finalizeTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  return archiveTodoInBoardByOutcome(board, todoId, "completed-successfully");
}

export function rejectTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  return archiveTodoInBoardByOutcome(board, todoId, "rejected");
}

export function moveTodoInBoard(
  board: CockpitBoard,
  todoId: string,
  sectionId: string | undefined,
  targetIndex: number,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo) {
    return { board: nextBoard, todo: undefined };
  }

  const previousSectionId = todo.sectionId;
  const nextSectionId = getSectionOrFallback(nextBoard, sectionId);
  const remainingCards = nextBoard.cards
    .filter((card) => card.id !== todoId && card.sectionId === nextSectionId)
    .sort((left, right) => (left.order || 0) - (right.order || 0));
  const clampedIndex = Math.max(0, Math.min(Math.floor(targetIndex), remainingCards.length));

  todo.sectionId = nextSectionId;
  remainingCards.splice(clampedIndex, 0, todo);
  remainingCards.forEach((card, index) => {
    card.order = index;
  });
  resequenceCards(nextBoard, previousSectionId);
  todo.updatedAt = nowIso();
  touchBoard(nextBoard, todo.updatedAt);
  return { board: nextBoard, todo };
}

export function addTodoCommentInBoard(
  board: CockpitBoard,
  todoId: string,
  input: AddCockpitTodoCommentInput,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo) {
    return { board: nextBoard, todo: undefined };
  }

  const timestamp = nowIso();
  appendTodoCommentRecord(todo, input, timestamp);
  todo.updatedAt = timestamp;
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, todo };
}

export function deleteTodoCommentInBoard(
  board: CockpitBoard,
  todoId: string,
  commentIndex: number,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo || !todo.comments) {
    return { board: nextBoard, todo: undefined };
  }

  if (commentIndex >= 0 && commentIndex < todo.comments.length) {
    todo.comments.splice(commentIndex, 1);
    const timestamp = nowIso();
    todo.updatedAt = timestamp;
    touchBoard(nextBoard, timestamp);
  }

  return { board: nextBoard, todo };
}

export function setCockpitBoardFiltersInBoard(
  board: CockpitBoard,
  input: UpdateCockpitBoardFiltersInput,
): CockpitBoard {
  const nextBoard = cloneBoard(board);
  nextBoard.filters = {
    ...nextBoard.filters,
    searchText: input.searchText !== undefined ? normalizeOptionalString(input.searchText) : nextBoard.filters?.searchText,
    labels: input.labels ? normalizeStringList(input.labels) : (nextBoard.filters?.labels ?? []),
    priorities: input.priorities
      ? input.priorities.filter((entry): entry is CockpitTodoPriority => entry !== "none")
      : (nextBoard.filters?.priorities ?? []),
    statuses: input.statuses
      ? input.statuses.filter((entry, index, values) => values.indexOf(entry) === index)
      : (nextBoard.filters?.statuses ?? []),
    archiveOutcomes: input.archiveOutcomes
      ? input.archiveOutcomes.filter((entry, index, values) => values.indexOf(entry) === index)
      : (nextBoard.filters?.archiveOutcomes ?? []),
    flags: input.flags ? normalizeStringList(input.flags) : (nextBoard.filters?.flags ?? []),
    sectionId: input.sectionId !== undefined ? normalizeOptionalString(input.sectionId ?? undefined) : nextBoard.filters?.sectionId,
    sortBy: input.sortBy ?? nextBoard.filters?.sortBy ?? "manual",
    sortDirection: input.sortDirection ?? nextBoard.filters?.sortDirection ?? "asc",
    viewMode: input.viewMode ?? nextBoard.filters?.viewMode ?? "board",
    showArchived: typeof input.showArchived === "boolean"
      ? input.showArchived
      : nextBoard.filters?.showArchived === true,
    showRecurringTasks: typeof input.showRecurringTasks === "boolean"
      ? input.showRecurringTasks
      : nextBoard.filters?.showRecurringTasks === true,
    hideCardDetails: typeof input.hideCardDetails === "boolean"
      ? input.hideCardDetails
      : nextBoard.filters?.hideCardDetails === true,
  };
  touchBoard(nextBoard);
  return nextBoard;
}

export function ensureTaskTodosInBoard(
  board: CockpitBoard,
  tasks: ScheduledTask[],
): { board: CockpitBoard; createdTodoIds: string[] } {
  const nextBoard = cloneBoard(board);
  const createdTodoIds: string[] = [];
  let changed = false;
  const tasksById = new Map(
    tasks
      .filter((task): task is ScheduledTask => Boolean(task?.id))
      .map((task) => [task.id, task] as const),
  );

  for (const task of tasks) {
    if (!task?.id) {
      continue;
    }

    const existingCard = nextBoard.cards.find((card) => card.taskId === task.id);
    const timestamp = task.updatedAt instanceof Date
      ? task.updatedAt.toISOString()
      : nowIso();

    if (isOneTimeTask(task)) {
      if (existingCard) {
        moveRecurringCardOutOfRecurringSection(nextBoard, existingCard, task, timestamp);
        changed = true;
      }
      continue;
    }

    if (existingCard) {
      const beforeCommentCount = existingCard.comments.length;
      const beforeSectionId = existingCard.sectionId;
      const beforeUpdatedAt = existingCard.updatedAt;
      syncRecurringTaskTodoCard(nextBoard, existingCard, task, timestamp);
      changed = changed
        || beforeCommentCount !== existingCard.comments.length
        || beforeSectionId !== existingCard.sectionId
        || beforeUpdatedAt !== existingCard.updatedAt;
      continue;
    }

    const todo = createRecurringTaskTodoCard(nextBoard, task, timestamp);
    nextBoard.cards.push(todo);
    createdTodoIds.push(todo.id);
    changed = true;
  }

  for (const card of nextBoard.cards) {
    if (card.archived || isArchiveSectionId(card.sectionId)) {
      if (card.taskId) {
        card.taskId = undefined;
        card.updatedAt = nowIso();
        changed = true;
      }
      continue;
    }

    if (card.taskId) {
      const linkedTask = tasksById.get(card.taskId);
      if (linkedTask && !isOneTimeTask(linkedTask)) {
        const timestamp = linkedTask.updatedAt instanceof Date
          ? linkedTask.updatedAt.toISOString()
          : nowIso();
        changed = normalizeTaskLinkedTodoForTask(card, linkedTask, timestamp) || changed;
      } else if (linkedTask) {
        const timestamp = linkedTask.updatedAt instanceof Date
          ? linkedTask.updatedAt.toISOString()
          : nowIso();
        changed = normalizeOneTimeTaskLinkedTodoForTask(card, linkedTask, timestamp) || changed;
      } else if (!isRecurringTasksSectionId(card.sectionId)) {
        changed = normalizeMissingOneTimeTaskLinkedTodo(card, nowIso()) || changed;
      }
    }

    if (!card.taskId || !isRecurringTasksSectionId(card.sectionId)) {
      continue;
    }

    const linkedTask = tasksById.get(card.taskId);
    if (!linkedTask || isOneTimeTask(linkedTask)) {
      moveRecurringCardOutOfRecurringSection(
        nextBoard,
        card,
        linkedTask ?? {
          id: card.taskId,
          name: card.title,
          description: card.description,
          cronExpression: card.taskSnapshot?.cronExpression ?? "",
          prompt: "",
          enabled: false,
          oneTime: true,
          scope: "workspace",
          promptSource: "inline",
          createdAt: new Date(card.createdAt),
          updatedAt: new Date(card.updatedAt),
        },
        nowIso(),
      );
      changed = true;
    }
  }

  if (changed) {
    touchBoard(nextBoard);
    return {
      board: normalizeCockpitBoard(nextBoard),
      createdTodoIds,
    };
  }

  return { board: nextBoard, createdTodoIds };
}

export function createCockpitTodo(
  workspaceRoot: string,
  input: CreateCockpitTodoInput,
): { board: CockpitBoard; todo: CockpitTodoCard } {
  const result = createTodoInBoard(getCockpitBoard(workspaceRoot), input);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function updateCockpitTodo(
  workspaceRoot: string,
  todoId: string,
  updates: UpdateCockpitTodoInput,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = updateTodoInBoard(getCockpitBoard(workspaceRoot), todoId, updates);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function deleteCockpitTodo(
  workspaceRoot: string,
  todoId: string,
): { board: CockpitBoard; deleted: boolean } {
  const result = deleteTodoInBoard(getCockpitBoard(workspaceRoot), todoId);
  return {
    board: persistBoard(workspaceRoot, result.board),
    deleted: result.deleted,
  };
}

export function purgeCockpitTodo(
  workspaceRoot: string,
  todoId: string,
): { board: CockpitBoard; deleted: boolean } {
  const result = purgeTodoInBoard(getCockpitBoard(workspaceRoot), todoId);
  return {
    board: persistBoard(workspaceRoot, result.board),
    deleted: result.deleted,
  };
}

export function moveCockpitTodo(
  workspaceRoot: string,
  todoId: string,
  sectionId: string | undefined,
  targetIndex: number,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = moveTodoInBoard(getCockpitBoard(workspaceRoot), todoId, sectionId, targetIndex);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function addCockpitTodoComment(
  workspaceRoot: string,
  todoId: string,
  input: AddCockpitTodoCommentInput,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = addTodoCommentInBoard(getCockpitBoard(workspaceRoot), todoId, input);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function deleteCockpitTodoComment(
  workspaceRoot: string,
  todoId: string,
  commentIndex: number,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = deleteTodoCommentInBoard(getCockpitBoard(workspaceRoot), todoId, commentIndex);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function setCockpitBoardFilters(
  workspaceRoot: string,
  input: UpdateCockpitBoardFiltersInput,
): CockpitBoard {
  return persistBoard(
    workspaceRoot,
    setCockpitBoardFiltersInBoard(getCockpitBoard(workspaceRoot), input),
  );
}

export function saveCockpitTodoLabelDefinition(
  workspaceRoot: string,
  input: UpsertCockpitLabelDefinitionInput,
): { board: CockpitBoard; label: CockpitLabelDefinition | undefined } {
  const result = upsertLabelDefinitionInBoard(getCockpitBoard(workspaceRoot), input);
  return {
    board: persistBoard(workspaceRoot, result.board),
    label: result.label,
  };
}

export function deleteCockpitTodoLabelDefinition(
  workspaceRoot: string,
  name: string,
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  const key = normalizeLabelKey(name);
  const timestamp = nowIso();
  nextBoard.labelCatalog = (nextBoard.labelCatalog ?? []).filter(
    (entry) => entry.key !== key,
  );
  stripLabelFromTodoCards(nextBoard.cards, key, timestamp);
  if (nextBoard.filters) {
    nextBoard.filters.labels = normalizeStringList(nextBoard.filters.labels).filter(
      (label) => normalizeLabelKey(label) !== key,
    );
  }
  nextBoard.deletedLabelCatalogKeys = Array.from(new Set([
    ...(nextBoard.deletedLabelCatalogKeys ?? []),
    key,
  ]));
  touchBoard(nextBoard, timestamp);
  return persistBoard(workspaceRoot, nextBoard);
}

export function saveCockpitFlagDefinition(
  workspaceRoot: string,
  input: UpsertCockpitLabelDefinitionInput,
): { board: CockpitBoard; label: CockpitLabelDefinition | undefined } {
  if (isProtectedCockpitFlagKey(input.previousName || input.name)) {
    const board = getCockpitBoard(workspaceRoot);
    const key = normalizeLabelKey(input.previousName || input.name);
    return {
      board,
      label: (board.flagCatalog ?? []).find((entry) => entry.key === key),
    };
  }
  const result = upsertFlagDefinitionInBoard(getCockpitBoard(workspaceRoot), input);
  return {
    board: persistBoard(workspaceRoot, result.board),
    label: result.label,
  };
}

export function deleteCockpitFlagDefinition(
  workspaceRoot: string,
  name: string,
): CockpitBoard {
  if (isProtectedCockpitFlagKey(name)) {
    return getCockpitBoard(workspaceRoot);
  }
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  const key = normalizeLabelKey(name);
  const timestamp = nowIso();
  nextBoard.flagCatalog = (nextBoard.flagCatalog ?? []).filter(
    (entry) => entry.key !== key,
  );
  stripFlagFromTodoCards(nextBoard.cards, key, timestamp);
  if (nextBoard.filters) {
    nextBoard.filters.flags = normalizeStringList(nextBoard.filters.flags).filter(
      (flag) => normalizeLabelKey(flag) !== key,
    );
  }
  nextBoard.deletedFlagCatalogKeys = Array.from(new Set([
    ...(nextBoard.deletedFlagCatalogKeys ?? []),
    key,
  ]));
  touchBoard(nextBoard, timestamp);
  return persistBoard(workspaceRoot, nextBoard);
}

export function setCockpitDisabledSystemFlagKeys(
  workspaceRoot: string,
  keys: string[],
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  const disabledKeys = normalizeCockpitDisabledSystemFlagKeys(keys);
  const disabledKeySet = new Set(disabledKeys);
  nextBoard.disabledSystemFlagKeys = disabledKeys;
  nextBoard.flagCatalog = (nextBoard.flagCatalog ?? []).filter(
    (entry) => !disabledKeySet.has(entry.key),
  );
  touchBoard(nextBoard, nowIso());
  return persistBoard(workspaceRoot, nextBoard);
}

export function ensureTaskTodos(
  workspaceRoot: string,
  tasks: ScheduledTask[],
): { board: CockpitBoard; createdTodoIds: string[] } {
  const result = ensureTaskTodosInBoard(getCockpitBoard(workspaceRoot), tasks);
  return {
    board: persistBoard(workspaceRoot, result.board),
    createdTodoIds: result.createdTodoIds,
  };
}

export function approveCockpitTodo(
  workspaceRoot: string,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = approveTodoInBoard(getCockpitBoard(workspaceRoot), todoId);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function finalizeCockpitTodo(
  workspaceRoot: string,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = finalizeTodoInBoard(getCockpitBoard(workspaceRoot), todoId);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function rejectCockpitTodo(
  workspaceRoot: string,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = rejectTodoInBoard(getCockpitBoard(workspaceRoot), todoId);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function restoreCockpitTodo(
  workspaceRoot: string,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const result = restoreArchivedTodoInBoard(getCockpitBoard(workspaceRoot), todoId);
  return {
    board: persistBoard(workspaceRoot, result.board),
    todo: result.todo,
  };
}

export function addCockpitSection(
  workspaceRoot: string,
  title: string,
): { board: CockpitBoard; validationError?: string } {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  const validationError = describeCockpitSectionSemanticIssue(title);
  if (validationError) {
    return {
      board: persistBoard(workspaceRoot, nextBoard),
      validationError,
    };
  }
  const timestamp = nowIso();
  const maxOrder = nextBoard.sections.reduce((m, s) => Math.max(m, s.order ?? 0), -1);
  nextBoard.sections.push({
    id: createId("section"),
    title: String(title || "").trim() || "New Section",
    order: maxOrder + 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  touchBoard(nextBoard, timestamp);
  return { board: persistBoard(workspaceRoot, nextBoard) };
}

export function renameCockpitSection(
  workspaceRoot: string,
  sectionId: string,
  title: string,
): { board: CockpitBoard; validationError?: string } {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  if (isArchiveSectionId(sectionId)) {
    return { board: persistBoard(workspaceRoot, nextBoard) };
  }
  const validationError = describeCockpitSectionSemanticIssue(title);
  if (validationError) {
    return {
      board: persistBoard(workspaceRoot, nextBoard),
      validationError,
    };
  }
  const section = nextBoard.sections.find((s) => s.id === sectionId);
  if (section && String(title || "").trim()) {
    section.title = String(title).trim();
    section.updatedAt = nowIso();
    touchBoard(nextBoard);
  }
  return { board: persistBoard(workspaceRoot, nextBoard) };
}

export function deleteCockpitSection(
  workspaceRoot: string,
  sectionId: string,
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  if (isArchiveSectionId(sectionId)) {
    return persistBoard(workspaceRoot, nextBoard);
  }
  // Never remove the last section
  if (nextBoard.sections.length <= 1) return persistBoard(workspaceRoot, nextBoard);
  // Pick the fallback: prefer the default unsorted section; if that IS the one being deleted, use first other section
  const targetSection = nextBoard.sections.find((s) => s.id === sectionId);
  if (!targetSection) return persistBoard(workspaceRoot, nextBoard);
  const fallbackId =
    sectionId === DEFAULT_UNSORTED_SECTION_ID
      ? nextBoard.sections.find((s) => s.id !== sectionId)!.id
      : getSectionOrFallback(nextBoard, DEFAULT_UNSORTED_SECTION_ID);
  for (const card of nextBoard.cards) {
    if (card.sectionId === sectionId) {
      card.sectionId = fallbackId;
    }
  }
  resequenceCards(nextBoard, fallbackId);
  nextBoard.sections = nextBoard.sections.filter((s) => s.id !== sectionId);
  touchBoard(nextBoard);
  return persistBoard(workspaceRoot, nextBoard);
}

export function moveCockpitSection(
  workspaceRoot: string,
  sectionId: string,
  direction: "left" | "right",
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  if (isArchiveSectionId(sectionId)) {
    return persistBoard(workspaceRoot, nextBoard);
  }
  const sorted = nextBoard.sections.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((s) => s.id === sectionId);
  if (idx === -1) return persistBoard(workspaceRoot, nextBoard);
  const swapIdx = direction === "left" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return persistBoard(workspaceRoot, nextBoard);
  if (isArchiveSectionId(sorted[swapIdx]?.id)) return persistBoard(workspaceRoot, nextBoard);
  const oa = sorted[idx].order;
  const ob = sorted[swapIdx].order;
  // Swap orders using map so both sections in nextBoard update
  const sA = nextBoard.sections.find((s) => s.id === sorted[idx].id);
  const sB = nextBoard.sections.find((s) => s.id === sorted[swapIdx].id);
  if (sA) sA.order = ob;
  if (sB) sB.order = oa;
  touchBoard(nextBoard);
  return persistBoard(workspaceRoot, nextBoard);
}

export function reorderCockpitSection(
  workspaceRoot: string,
  sectionId: string,
  targetIndex: number,
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  if (isArchiveSectionId(sectionId)) {
    return persistBoard(workspaceRoot, nextBoard);
  }
  const sorted = nextBoard.sections.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const fromIndex = sorted.findIndex((s) => s.id === sectionId);
  if (fromIndex === -1 || fromIndex === targetIndex) return persistBoard(workspaceRoot, nextBoard);
  const clampedTargetIndex = Math.max(0, Math.min(targetIndex, sorted.length - 1));
  if (isArchiveSectionId(sorted[clampedTargetIndex]?.id)) {
    return persistBoard(workspaceRoot, nextBoard);
  }
  const [moved] = sorted.splice(fromIndex, 1);
  sorted.splice(clampedTargetIndex, 0, moved);
  sorted.forEach((s, i) => {
    const inBoard = nextBoard.sections.find((ns) => ns.id === s.id);
    if (inBoard) inBoard.order = i;
  });
  touchBoard(nextBoard);
  return persistBoard(workspaceRoot, nextBoard);
}