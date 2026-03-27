import {
  DEFAULT_UNSORTED_SECTION_ID,
  createDefaultCockpitBoard,
  normalizeCockpitBoard,
} from "./cockpitBoard";
import {
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./schedulerJsonSanitizer";
import type {
  AddCockpitTodoCommentInput,
  CockpitArchiveOutcome,
  CockpitBoard,
  CockpitLabelDefinition,
  CockpitTodoCard,
  CockpitTodoPriority,
  CreateCockpitTodoInput,
  ScheduledTask,
  UpsertCockpitLabelDefinitionInput,
  UpdateCockpitBoardFiltersInput,
  UpdateCockpitTodoInput,
} from "./types";

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

function ensureArchives(board: CockpitBoard): NonNullable<CockpitBoard["archives"]> {
  if (!board.archives) {
    board.archives = {
      completedSuccessfully: [],
      rejected: [],
    };
  }

  return board.archives;
}

function appendTodoCommentRecord(
  todo: CockpitTodoCard,
  input: AddCockpitTodoCommentInput,
  timestamp: string,
): void {
  todo.comments.push({
    id: createId("comment"),
    author: input.author === "user" ? "user" : "system",
    body: String(input.body || "").trim(),
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
  const nextCatalog = Array.isArray(nextBoard.labelCatalog)
    ? nextBoard.labelCatalog.slice()
    : [];
  const existingIndex = nextCatalog.findIndex((entry) => entry.key === key);
  const label: CockpitLabelDefinition = existingIndex >= 0
    ? {
      ...nextCatalog[existingIndex],
      name,
      color: normalizeOptionalString(input.color)
        ?? nextCatalog[existingIndex].color,
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
  } else {
    nextCatalog.push(label);
  }

  nextBoard.labelCatalog = nextCatalog.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
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
  const nextCatalog = Array.isArray(nextBoard.flagCatalog)
    ? nextBoard.flagCatalog.slice()
    : [];
  const existingIndex = nextCatalog.findIndex((entry) => entry.key === key);
  const label: CockpitLabelDefinition = existingIndex >= 0
    ? {
      ...nextCatalog[existingIndex],
      name,
      color: normalizeOptionalString(input.color)
        ?? nextCatalog[existingIndex].color,
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
  } else {
    nextCatalog.push(label);
  }

  nextBoard.flagCatalog = nextCatalog.sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  touchBoard(nextBoard, timestamp);
  return { board: nextBoard, label };
}

function archiveOutcomeToBucketKey(
  outcome: CockpitArchiveOutcome,
): keyof NonNullable<CockpitBoard["archives"]> {
  return outcome === "completed-successfully"
    ? "completedSuccessfully"
    : "rejected";
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
  todo.updatedAt = timestamp;

  if (outcome === "completed-successfully") {
    todo.status = "completed";
    todo.completedAt = timestamp;
    addSystemEventComment(todo, "Final accepted and archived as completed.", ["completed"], timestamp);
  } else {
    todo.status = "rejected";
    todo.rejectedAt = timestamp;
    addSystemEventComment(todo, "Rejected and archived.", ["rejected"], timestamp);
  }

  ensureArchives(nextBoard)[archiveOutcomeToBucketKey(outcome)].push(todo);
  resequenceCards(nextBoard, todo.sectionId);
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
  });
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

export function getCockpitBoard(workspaceRoot: string): CockpitBoard {
  const config = readSchedulerConfig(workspaceRoot);
  if (config.cockpitBoard) {
    const nextBoard = normalizeCockpitBoard(config.cockpitBoard);
    writeSchedulerConfig(workspaceRoot, {
      ...config,
      cockpitBoard: nextBoard,
    });
    return nextBoard;
  }

  const seededBoard = createDefaultCockpitBoard();
  writeSchedulerConfig(workspaceRoot, {
    ...config,
    cockpitBoard: seededBoard,
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
  const todo: CockpitTodoCard = {
    id: normalizeOptionalString(input.id) ?? createId("todo"),
    title: String(input.title || "").trim() || "Untitled todo",
    description: normalizeOptionalString(input.description),
    sectionId,
    order: nextBoard.cards.filter((card) => card.sectionId === sectionId).length,
    priority: input.priority ?? "none",
    dueAt: normalizeOptionalString(input.dueAt),
    status: input.status ?? "active",
    labels: normalizeStringList(input.labels),
    flags: normalizeStringList(input.flags),
    comments: [],
    taskId: normalizeOptionalString(input.taskId),
    sessionId: normalizeOptionalString(input.sessionId),
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (normalizeOptionalString(input.comment)) {
    appendTodoCommentRecord(todo, {
      body: input.comment!,
      author: input.author,
      source: input.commentSource,
      labels: [],
    }, timestamp);
  }
  if (todo.status === "ready") {
    todo.approvedAt = timestamp;
  }

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
  if (updates.status) {
    todo.status = updates.status;
    if (updates.status === "ready") {
      todo.approvedAt = timestamp;
    }
  }
  if (updates.labels) {
    todo.labels = normalizeStringList(updates.labels);
  }
  if (updates.flags) {
    // Single-value: only keep the first flag
    const firstFlag = normalizeStringList(updates.flags)[0];
    todo.flags = firstFlag ? [firstFlag] : [];
  }
  if (updates.taskId !== undefined) {
    todo.taskId = normalizeOptionalString(updates.taskId ?? undefined);
  }
  if (updates.sessionId !== undefined) {
    todo.sessionId = normalizeOptionalString(updates.sessionId ?? undefined);
  }
  if (typeof updates.archived === "boolean") {
    todo.archived = updates.archived;
  }
  if (updates.archiveOutcome !== undefined) {
    todo.archiveOutcome = updates.archiveOutcome ?? undefined;
  }
  todo.sectionId = nextSectionId;
  if (typeof updates.order === "number" && Number.isFinite(updates.order)) {
    todo.order = Math.max(0, Math.floor(updates.order));
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

export function approveTodoInBoard(
  board: CockpitBoard,
  todoId: string,
): { board: CockpitBoard; todo: CockpitTodoCard | undefined } {
  const nextBoard = cloneBoard(board);
  const todo = nextBoard.cards.find((card) => card.id === todoId);
  if (!todo) {
    return { board: nextBoard, todo: undefined };
  }

  const timestamp = nowIso();
  todo.status = "ready";
  todo.approvedAt = timestamp;
  todo.updatedAt = timestamp;
  addSystemEventComment(todo, "Approved and marked ready for final acceptance.", ["approved"], timestamp);
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
    showArchived: typeof input.showArchived === "boolean"
      ? input.showArchived
      : nextBoard.filters?.showArchived === true,
  };
  touchBoard(nextBoard);
  return nextBoard;
}

export function ensureTaskTodosInBoard(
  board: CockpitBoard,
  tasks: ScheduledTask[],
): { board: CockpitBoard; createdTodoIds: string[] } {
  const nextBoard = cloneBoard(board);
  const unsortedSectionId = getSectionOrFallback(nextBoard, DEFAULT_UNSORTED_SECTION_ID);
  const createdTodoIds: string[] = [];

  for (const task of tasks) {
    if (!task?.id || nextBoard.cards.some((card) => card.taskId === task.id)) {
      continue;
    }

    const timestamp = task.updatedAt instanceof Date
      ? task.updatedAt.toISOString()
      : nowIso();
    const todo: CockpitTodoCard = {
      id: createId("todo"),
      title: task.name || "Unnamed task",
      description: normalizeOptionalString(task.description),
      sectionId: unsortedSectionId,
      order: nextBoard.cards.filter((card) => card.sectionId === unsortedSectionId).length,
      priority: deriveTaskPriority(task),
      dueAt: undefined,
      status: "active",
      labels: normalizeStringList(task.labels ?? []).concat(["scheduled-task"]),
      flags: [],
      comments: task.lastError
        ? [{
          id: createId("comment"),
          author: "system",
          body: `Existing scheduled task error: ${task.lastError}`,
          labels: ["task-error"],
          source: "system-event",
          sequence: 1,
          createdAt: task.lastErrorAt instanceof Date ? task.lastErrorAt.toISOString() : timestamp,
        }]
        : [],
      taskId: task.id,
      sessionId: undefined,
      archived: false,
      createdAt: task.createdAt instanceof Date ? task.createdAt.toISOString() : timestamp,
      updatedAt: timestamp,
    };
    nextBoard.cards.push(todo);
    createdTodoIds.push(todo.id);
  }

  resequenceCards(nextBoard, unsortedSectionId);
  if (createdTodoIds.length > 0) {
    touchBoard(nextBoard);
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
  nextBoard.labelCatalog = (nextBoard.labelCatalog ?? []).filter(
    (entry) => entry.key !== key,
  );
  touchBoard(nextBoard);
  return persistBoard(workspaceRoot, nextBoard);
}

export function saveCockpitFlagDefinition(
  workspaceRoot: string,
  input: UpsertCockpitLabelDefinitionInput,
): { board: CockpitBoard; label: CockpitLabelDefinition | undefined } {
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
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  const key = normalizeLabelKey(name);
  nextBoard.flagCatalog = (nextBoard.flagCatalog ?? []).filter(
    (entry) => entry.key !== key,
  );
  touchBoard(nextBoard);
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

export function addCockpitSection(
  workspaceRoot: string,
  title: string,
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
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
  return persistBoard(workspaceRoot, nextBoard);
}

export function renameCockpitSection(
  workspaceRoot: string,
  sectionId: string,
  title: string,
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
  const section = nextBoard.sections.find((s) => s.id === sectionId);
  if (section && String(title || "").trim()) {
    section.title = String(title).trim();
    section.updatedAt = nowIso();
    touchBoard(nextBoard);
  }
  return persistBoard(workspaceRoot, nextBoard);
}

export function deleteCockpitSection(
  workspaceRoot: string,
  sectionId: string,
): CockpitBoard {
  const nextBoard = cloneBoard(getCockpitBoard(workspaceRoot));
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
  const sorted = nextBoard.sections.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const idx = sorted.findIndex((s) => s.id === sectionId);
  if (idx === -1) return persistBoard(workspaceRoot, nextBoard);
  const swapIdx = direction === "left" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= sorted.length) return persistBoard(workspaceRoot, nextBoard);
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
  const sorted = nextBoard.sections.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const fromIndex = sorted.findIndex((s) => s.id === sectionId);
  if (fromIndex === -1 || fromIndex === targetIndex) return persistBoard(workspaceRoot, nextBoard);
  const [moved] = sorted.splice(fromIndex, 1);
  sorted.splice(targetIndex, 0, moved);
  sorted.forEach((s, i) => {
    const inBoard = nextBoard.sections.find((ns) => ns.id === s.id);
    if (inBoard) inBoard.order = i;
  });
  touchBoard(nextBoard);
  return persistBoard(workspaceRoot, nextBoard);
}