import type {
  CockpitArchiveOutcome,
  CockpitTodoSortBy,
  CockpitTodoSortDirection,
  CockpitTodoViewMode,
  CockpitBoard,
  CockpitBoardFilters,
  CockpitBoardSection,
  CockpitTodoCard,
  CockpitTodoComment,
  CockpitCommentSource,
  CockpitLabelDefinition,
  CockpitTaskSnapshot,
  CockpitTodoPriority,
  CockpitTodoStatus,
} from "./types";

const DEFAULT_SECTIONS = [
  { id: "unsorted", title: "Unsorted" },
  { id: "bugs", title: "Bugs" },
  { id: "features", title: "Features" },
  { id: "ops-devops", title: "Ops/DevOps" },
  { id: "marketing-growth", title: "Marketing/Growth" },
  { id: "automation", title: "Automation" },
  { id: "future", title: "Future" },
] as const;

export const DEFAULT_UNSORTED_SECTION_ID = DEFAULT_SECTIONS[0].id;

const RECURRING_TASKS_SECTION = {
  id: "recurring-tasks",
  title: "Recurring Tasks",
} as const;

export const DEFAULT_RECURRING_TASKS_SECTION_ID = RECURRING_TASKS_SECTION.id;

const ARCHIVE_SECTIONS = [
  { id: "archive-completed", title: "Archive: Completed" },
  { id: "archive-rejected", title: "Archive: Rejected" },
] as const;

export const DEFAULT_ARCHIVE_COMPLETED_SECTION_ID = ARCHIVE_SECTIONS[0].id;
export const DEFAULT_ARCHIVE_REJECTED_SECTION_ID = ARCHIVE_SECTIONS[1].id;

export function isRecurringTasksSectionId(sectionId: string | undefined): boolean {
  return sectionId === DEFAULT_RECURRING_TASKS_SECTION_ID;
}

export function isArchiveSectionId(sectionId: string | undefined): boolean {
  return sectionId === DEFAULT_ARCHIVE_COMPLETED_SECTION_ID
    || sectionId === DEFAULT_ARCHIVE_REJECTED_SECTION_ID;
}

function getArchiveSectionDefinition(sectionId: string | undefined) {
  return ARCHIVE_SECTIONS.find((section) => section.id === sectionId);
}

function getRecurringTasksSectionDefinition(sectionId: string | undefined) {
  return sectionId === DEFAULT_RECURRING_TASKS_SECTION_ID
    ? RECURRING_TASKS_SECTION
    : undefined;
}

function getArchiveSectionIdForOutcome(
  outcome: CockpitArchiveOutcome,
): string {
  return outcome === "completed-successfully"
    ? DEFAULT_ARCHIVE_COMPLETED_SECTION_ID
    : DEFAULT_ARCHIVE_REJECTED_SECTION_ID;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string, index?: number): string {
  const suffix = index === undefined ? Math.random().toString(36).slice(2, 8) : `${index}`;
  return `${prefix}_${suffix}`;
}

function normalizeLabels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizePriority(value: unknown): CockpitTodoPriority {
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

function normalizeStatus(value: unknown): CockpitTodoStatus {
  switch (value) {
    case "ready":
    case "completed":
    case "rejected":
      return value;
    default:
      return "active";
  }
}

function normalizeArchiveOutcome(value: unknown): CockpitArchiveOutcome | undefined {
  switch (value) {
    case "completed-successfully":
    case "rejected":
      return value;
    default:
      return undefined;
  }
}

function normalizeCommentSource(value: unknown): CockpitCommentSource {
  switch (value) {
    case "human-form":
    case "bot-mcp":
    case "bot-manual":
      return value;
    default:
      return "system-event";
  }
}

function normalizeSortBy(value: unknown): CockpitTodoSortBy {
  switch (value) {
    case "dueAt":
    case "priority":
    case "updatedAt":
    case "createdAt":
      return value;
    default:
      return "manual";
  }
}

function normalizeSortDirection(value: unknown): CockpitTodoSortDirection {
  return value === "desc" ? "desc" : "asc";
}

function normalizeViewMode(value: unknown): CockpitTodoViewMode {
  return value === "list" ? "list" : "board";
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeOptionalIsoString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeLabelKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeLabelColor(value: unknown): string {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : "var(--vscode-badge-background)";
}

function normalizeCatalogKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => normalizeLabelKey(entry))
    .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
}

function normalizeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
}

function normalizeTaskSnapshot(value: unknown): CockpitTaskSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Partial<CockpitTaskSnapshot>;
  const name = normalizeOptionalString(record.name);
  const cronExpression = normalizeOptionalString(record.cronExpression);
  const promptHash = normalizeOptionalString(record.promptHash);
  if (!name || !cronExpression || !promptHash) {
    return undefined;
  }

  return {
    name,
    description: normalizeOptionalString(record.description),
    cronExpression,
    enabled: record.enabled !== false,
    oneTime: record.oneTime === true,
    manualSession: record.manualSession === true ? true : undefined,
    agent: normalizeOptionalString(record.agent),
    model: normalizeOptionalString(record.model),
    labels: normalizeLabels(record.labels),
    promptHash,
  };
}

function buildDefaultSections(timestamp: string): CockpitBoardSection[] {
  return DEFAULT_SECTIONS.map((section, index) => ({
    id: section.id,
    title: section.title,
    order: index,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

function resequenceSections(sections: CockpitBoardSection[]): CockpitBoardSection[] {
  return sections
    .slice()
    .sort((left, right) => (left.order || 0) - (right.order || 0))
    .map((section, index) => ({
      ...section,
      order: index,
    }));
}

function ensureUnsortedSection(
  sections: CockpitBoardSection[],
  timestamp: string,
): CockpitBoardSection[] {
  const hasUnsorted = sections.some((section) => {
    const normalizedTitle = String(section.title || "").trim().toLowerCase();
    return section.id === DEFAULT_UNSORTED_SECTION_ID || normalizedTitle === "unsorted";
  });

  if (hasUnsorted) {
    return resequenceSections(sections);
  }

  return resequenceSections([
    {
      id: DEFAULT_UNSORTED_SECTION_ID,
      title: "Unsorted",
      order: -1,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    ...sections,
  ]);
}

function ensureArchiveSections(
  sections: CockpitBoardSection[],
  timestamp: string,
): CockpitBoardSection[] {
  const byId = new Map(
    sections.map((section) => [section.id, section] as const),
  );
  const nonArchiveSections = sections
    .filter((section) => !isArchiveSectionId(section.id))
    .sort((left, right) => (left.order || 0) - (right.order || 0));

  const archiveSections = ARCHIVE_SECTIONS.map((definition) => {
    const existing = byId.get(definition.id);
    return existing
      ? {
        ...existing,
        title: definition.title,
      }
      : {
        id: definition.id,
        title: definition.title,
        order: nonArchiveSections.length,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  });

  return [...nonArchiveSections, ...archiveSections].map((section, index) => ({
    ...section,
    order: index,
  }));
}

function ensureSpecialSections(
  sections: CockpitBoardSection[],
  timestamp: string,
): CockpitBoardSection[] {
  const byId = new Map(
    sections.map((section) => [section.id, section] as const),
  );
  const editableSections = sections
    .filter((section) => !isRecurringTasksSectionId(section.id) && !isArchiveSectionId(section.id))
    .sort((left, right) => (left.order || 0) - (right.order || 0));
  const recurringSection = byId.get(DEFAULT_RECURRING_TASKS_SECTION_ID)
    ? {
      ...byId.get(DEFAULT_RECURRING_TASKS_SECTION_ID)!,
      title: RECURRING_TASKS_SECTION.title,
    }
    : {
      id: DEFAULT_RECURRING_TASKS_SECTION_ID,
      title: RECURRING_TASKS_SECTION.title,
      order: editableSections.length,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  const archiveSections = ARCHIVE_SECTIONS.map((definition, index) => {
    const existing = byId.get(definition.id);
    return existing
      ? {
        ...existing,
        title: definition.title,
      }
      : {
        id: definition.id,
        title: definition.title,
        order: editableSections.length + 1 + index,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
  });

  return [...editableSections, recurringSection, ...archiveSections].map((section, index) => ({
    ...section,
    order: index,
  }));
}

function normalizeComment(comment: unknown, index: number): CockpitTodoComment {
  const record = comment && typeof comment === "object"
    ? comment as Partial<CockpitTodoComment>
    : {};
  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : createId("comment", index),
    author: record.author === "user" ? "user" : "system",
    body: typeof record.body === "string" ? record.body.trim() : "",
    labels: normalizeLabels(record.labels),
    source: normalizeCommentSource(record.source),
    sequence: Number.isFinite(Number(record.sequence))
      ? Math.max(1, Math.floor(Number(record.sequence)))
      : index + 1,
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt
      : nowIso(),
    updatedAt: normalizeOptionalIsoString(record.updatedAt),
    editedAt: normalizeOptionalIsoString(record.editedAt),
  };
}

function normalizeLabelDefinition(
  label: unknown,
  index: number,
): CockpitLabelDefinition | undefined {
  const record = label && typeof label === "object"
    ? label as Partial<CockpitLabelDefinition>
    : {};
  const name = typeof record.name === "string" && record.name.trim()
    ? record.name.trim()
    : undefined;
  if (!name) {
    return undefined;
  }

  const timestamp = nowIso();
  return {
    name,
    key: typeof record.key === "string" && record.key.trim()
      ? normalizeLabelKey(record.key)
      : normalizeLabelKey(name),
    color: normalizeLabelColor(record.color),
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim()
      ? record.createdAt
      : timestamp,
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt
      : timestamp,
    system: record.system === true,
  };
}

type SystemFlagSeed = {
  key: string;
  name: string;
  color: string;
  aliases?: string[];
};

const SYSTEM_FLAG_SEEDS: SystemFlagSeed[] = [
  { key: "go", name: "go", color: "#22c55e", aliases: ["GO"] },
  {
    key: "linked-scheduled-task",
    name: "Linked scheduled task",
    color: "#0ea5e9",
  },
  { key: "needs-bot-review", name: "needs-bot-review", color: "#f59e0b" },
  { key: "needs-user-review", name: "needs-user-review", color: "#3b82f6" },
  { key: "new", name: "new", color: "#a78bfa", aliases: ["NEW"] },
  {
    key: "on-schedule-list",
    name: "ON-SCHEDULE-LIST",
    color: "#14b8a6",
  },
  { key: "rejected", name: "rejected", color: "#ef4444", aliases: ["abgelehnt"] },
];

export const DEFAULT_SYSTEM_FLAG_KEYS = SYSTEM_FLAG_SEEDS.map((seed) => seed.key);

const SYSTEM_FLAG_SEED_BY_KEY = new Map(
  SYSTEM_FLAG_SEEDS.map((seed) => [seed.key, seed]),
);

const SYSTEM_FLAG_ALIAS_TO_KEY = new Map(
  SYSTEM_FLAG_SEEDS.flatMap((seed) => [
    [normalizeLabelKey(seed.key), seed.key] as const,
    [normalizeLabelKey(seed.name), seed.key] as const,
    ...((seed.aliases ?? []).map((alias) => [normalizeLabelKey(alias), seed.key] as const)),
  ]),
);

function normalizeSystemFlagKey(value: unknown): string | undefined {
  const key = normalizeLabelKey(typeof value === "string" ? value : String(value ?? ""));
  return key ? SYSTEM_FLAG_ALIAS_TO_KEY.get(key) ?? key : undefined;
}

function normalizeFlagName(value: unknown): string | undefined {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return undefined;
  }
  const key = normalizeSystemFlagKey(text);
  return key && SYSTEM_FLAG_SEED_BY_KEY.has(key)
    ? SYSTEM_FLAG_SEED_BY_KEY.get(key)?.name
    : text;
}

function normalizeFlags(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  return values
    .map((value) => normalizeFlagName(value))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const key = normalizeSystemFlagKey(value) ?? normalizeLabelKey(value);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeFlagDefinition(
  label: unknown,
  index: number,
): CockpitLabelDefinition | undefined {
  const normalized = normalizeLabelDefinition(label, index);
  if (!normalized) {
    return undefined;
  }

  const systemKey = normalizeSystemFlagKey(normalized.key || normalized.name);
  if (!systemKey || !SYSTEM_FLAG_SEED_BY_KEY.has(systemKey)) {
    return normalized;
  }

  const seed = SYSTEM_FLAG_SEED_BY_KEY.get(systemKey)!;
  return {
    ...normalized,
    key: seed.key,
    name: seed.name,
    color: seed.color,
    system: true,
  };
}

function normalizeDeletedFlagCatalogKeys(values: unknown): string[] {
  return normalizeCatalogKeyList(values).filter(
    (key) => !SYSTEM_FLAG_SEED_BY_KEY.has(key),
  );
}

export function normalizeCockpitDisabledSystemFlagKeys(values: unknown): string[] {
  return normalizeCatalogKeyList(values).filter((key) => SYSTEM_FLAG_SEED_BY_KEY.has(key));
}

export function isProtectedCockpitFlagKey(value: string): boolean {
  const key = normalizeSystemFlagKey(value);
  return Boolean(key && SYSTEM_FLAG_SEED_BY_KEY.has(key));
}

function buildLabelCatalog(
  cards: CockpitTodoCard[],
  existingCatalog: unknown,
  deletedKeys: string[] = [],
): CockpitLabelDefinition[] {
  const timestamp = nowIso();
  const deletedKeySet = new Set(deletedKeys);
  const normalizedEntries = Array.isArray(existingCatalog)
    ? existingCatalog
        .map((entry, index) => normalizeLabelDefinition(entry, index))
        .filter((entry): entry is CockpitLabelDefinition => Boolean(entry))
    : [];
  const entries = normalizedEntries.filter((entry) => !deletedKeySet.has(entry.key));
  const catalog = new Map(entries.map((entry) => [entry.key, entry]));

  for (const card of cards) {
    for (const label of card.labels) {
      const key = normalizeLabelKey(label);
      if (!key || catalog.has(key) || deletedKeySet.has(key)) {
        continue;
      }
      catalog.set(key, {
        name: label,
        key,
        color: "var(--vscode-badge-background)",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return Array.from(catalog.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function buildFlagCatalog(
  cards: CockpitTodoCard[],
  existingCatalog: unknown,
  deletedKeys: string[] = [],
  disabledSystemFlagKeys: string[] = [],
): CockpitLabelDefinition[] {
  const timestamp = nowIso();
  const deletedKeySet = new Set(
    deletedKeys.filter((key) => !SYSTEM_FLAG_SEED_BY_KEY.has(key)),
  );
  const disabledSystemFlagKeySet = new Set(disabledSystemFlagKeys);
  const normalizedEntries = Array.isArray(existingCatalog)
    ? existingCatalog
        .map((entry, index) => normalizeFlagDefinition(entry, index))
        .filter((entry): entry is CockpitLabelDefinition => Boolean(entry))
    : [];
  const entries = normalizedEntries.filter((entry) => !deletedKeySet.has(entry.key));
  const catalog = new Map(entries.map((entry) => [entry.key, entry]));

  for (const card of cards) {
    for (const flag of normalizeFlags(card.flags)) {
      const key = normalizeLabelKey(flag);
      if (!key || catalog.has(key) || deletedKeySet.has(key)) {
        continue;
      }
      catalog.set(key, {
        name: normalizeFlagName(flag) ?? flag,
        key,
        color: SYSTEM_FLAG_SEED_BY_KEY.get(key)?.color ?? "var(--vscode-badge-background)",
        createdAt: timestamp,
        updatedAt: timestamp,
        system: SYSTEM_FLAG_SEED_BY_KEY.has(key),
      });
    }
  }

  for (const seed of SYSTEM_FLAG_SEEDS) {
    const key = normalizeLabelKey(seed.key);
    if (
      key
      && !catalog.has(key)
      && !deletedKeySet.has(key)
      && !disabledSystemFlagKeySet.has(key)
    ) {
      catalog.set(key, {
        name: seed.name,
        key,
        color: seed.color,
        createdAt: timestamp,
        updatedAt: timestamp,
        system: true,
      });
    }
  }

  return Array.from(catalog.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function normalizeLegacyArchivedCards(
  cards: unknown,
  outcome: CockpitArchiveOutcome,
): CockpitTodoCard[] {
  const timestamp = nowIso();
  const sectionId = getArchiveSectionIdForOutcome(outcome);
  return Array.isArray(cards)
    ? cards.map((entry, index): CockpitTodoCard => {
      const card = normalizeCard(entry, index);
      const archivedAt = card.archivedAt
        ?? card.completedAt
        ?? card.rejectedAt
        ?? timestamp;
      return {
        ...card,
        sectionId,
        archived: true,
        archiveOutcome: outcome,
        status: outcome === "completed-successfully" ? "completed" : "rejected",
        completedAt: outcome === "completed-successfully"
          ? card.completedAt ?? archivedAt
          : undefined,
        rejectedAt: outcome === "rejected"
          ? card.rejectedAt ?? archivedAt
          : undefined,
        archivedAt,
      };
    })
    : [];
}

function normalizeCard(card: unknown, index: number): CockpitTodoCard {
  const record = card && typeof card === "object"
    ? card as Partial<CockpitTodoCard>
    : {};
  const comments = Array.isArray(record.comments)
    ? record.comments.map((entry, commentIndex) => normalizeComment(entry, commentIndex))
    : [];

  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
      : createId("card", index),
    title: typeof record.title === "string" && record.title.trim()
      ? record.title.trim()
      : "Untitled card",
    description: typeof record.description === "string" && record.description.trim()
      ? record.description.trim()
      : undefined,
    sectionId: typeof record.sectionId === "string" && record.sectionId.trim()
      ? record.sectionId.trim()
      : DEFAULT_UNSORTED_SECTION_ID,
    order: Number.isFinite(Number(record.order)) ? Math.max(0, Math.floor(Number(record.order))) : index,
    priority: normalizePriority(record.priority),
    dueAt: normalizeOptionalIsoString(record.dueAt),
    status: normalizeStatus(record.status),
    labels: normalizeLabels(record.labels),
    flags: normalizeFlags(record.flags),
    comments,
    taskSnapshot: normalizeTaskSnapshot(record.taskSnapshot),
    taskId: typeof record.taskId === "string" && record.taskId.trim() ? record.taskId.trim() : undefined,
    sessionId: typeof record.sessionId === "string" && record.sessionId.trim() ? record.sessionId.trim() : undefined,
    archived: record.archived === true,
    archiveOutcome: normalizeArchiveOutcome(record.archiveOutcome),
    approvedAt: normalizeOptionalIsoString(record.approvedAt),
    completedAt: normalizeOptionalIsoString(record.completedAt),
    rejectedAt: normalizeOptionalIsoString(record.rejectedAt),
    archivedAt: normalizeOptionalIsoString(record.archivedAt),
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : nowIso(),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : nowIso(),
  };
}

function normalizeSection(section: unknown, index: number): CockpitBoardSection {
  const record = section && typeof section === "object"
    ? section as Partial<CockpitBoardSection>
    : {};
  const explicitId = typeof record.id === "string" && record.id.trim()
    ? record.id.trim()
    : undefined;
  const archiveSection = getArchiveSectionDefinition(explicitId);
  const recurringSection = getRecurringTasksSectionDefinition(explicitId);
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : recurringSection?.title ?? archiveSection?.title ?? DEFAULT_SECTIONS[index]?.title ?? `Section ${index + 1}`;

  return {
    id: explicitId
      ? explicitId
      : DEFAULT_SECTIONS[index]?.id ?? createId("section", index),
    title,
    order: Number.isFinite(Number(record.order)) ? Math.max(0, Math.floor(Number(record.order))) : index,
    color: typeof record.color === "string" && record.color.trim() ? record.color.trim() : undefined,
    createdAt: typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt : nowIso(),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt : nowIso(),
  };
}

function normalizeFilters(filters: unknown): CockpitBoardFilters {
  const record = filters && typeof filters === "object"
    ? filters as Partial<CockpitBoardFilters>
    : {};
  return {
    searchText: typeof record.searchText === "string" && record.searchText.trim()
      ? record.searchText.trim()
      : undefined,
    labels: normalizeLabels(record.labels),
    priorities: Array.isArray(record.priorities)
      ? record.priorities.map((entry) => normalizePriority(entry)).filter((entry) => entry !== "none")
      : [],
    statuses: Array.isArray(record.statuses)
      ? record.statuses.map((entry) => normalizeStatus(entry)).filter((entry, index, values) => values.indexOf(entry) === index)
      : [],
    archiveOutcomes: Array.isArray(record.archiveOutcomes)
      ? record.archiveOutcomes
          .map((entry) => normalizeArchiveOutcome(entry))
          .filter((entry): entry is CockpitArchiveOutcome => Boolean(entry))
      : [],
    flags: normalizeFlags(record.flags),
    sectionId: normalizeOptionalIsoString(record.sectionId),
    sortBy: normalizeSortBy(record.sortBy),
    sortDirection: normalizeSortDirection(record.sortDirection),
    viewMode: normalizeViewMode(record.viewMode),
    showArchived: record.showArchived === true,
    showRecurringTasks: record.showRecurringTasks === true,
    hideCardDetails: record.hideCardDetails === true,
  };
}

export function createDefaultCockpitBoard(timestamp = nowIso()): CockpitBoard {
  return {
    version: 4,
    sections: ensureSpecialSections(buildDefaultSections(timestamp), timestamp),
    cards: [],
    labelCatalog: [],
    deletedLabelCatalogKeys: [],
    flagCatalog: [],
    deletedFlagCatalogKeys: [],
    disabledSystemFlagKeys: [],
    deletedCardIds: [],
    filters: {
      labels: [],
      priorities: [],
      statuses: [],
      archiveOutcomes: [],
      flags: [],
      sortBy: "manual",
      sortDirection: "asc",
      viewMode: "board",
      showArchived: false,
      showRecurringTasks: false,
      hideCardDetails: false,
    },
    updatedAt: timestamp,
  };
}

export function normalizeCockpitBoard(board: unknown): CockpitBoard {
  if (!board || typeof board !== "object") {
    return createDefaultCockpitBoard();
  }

  const record = board as Partial<CockpitBoard>;
  const timestamp = nowIso();
  const sections = Array.isArray(record.sections)
    ? record.sections.map((entry, index) => normalizeSection(entry, index))
    : buildDefaultSections(timestamp);
  const normalizedCards = Array.isArray(record.cards)
    ? record.cards.map((entry, index) => normalizeCard(entry, index))
    : [];
  const archivesRecord = record.archives && typeof record.archives === "object"
    ? record.archives as NonNullable<CockpitBoard["archives"]>
    : undefined;
  const archivedCompleted = normalizeLegacyArchivedCards(
    archivesRecord?.completedSuccessfully,
    "completed-successfully",
  );
  const archivedRejected = normalizeLegacyArchivedCards(
    archivesRecord?.rejected,
    "rejected",
  );
  const cards: CockpitTodoCard[] = normalizedCards.map((card): CockpitTodoCard => {
    if (!card.archived && !card.archiveOutcome) {
      return card;
    }

    const archiveOutcome = card.archiveOutcome
      ?? (card.status === "completed" ? "completed-successfully" : "rejected");
    const archivedAt = card.archivedAt
      ?? card.completedAt
      ?? card.rejectedAt
      ?? timestamp;
    return {
      ...card,
      sectionId: getArchiveSectionIdForOutcome(archiveOutcome),
      archived: true,
      archiveOutcome,
      status: archiveOutcome === "completed-successfully" ? "completed" : "rejected",
      completedAt: archiveOutcome === "completed-successfully"
        ? card.completedAt ?? archivedAt
        : undefined,
      rejectedAt: archiveOutcome === "rejected"
        ? card.rejectedAt ?? archivedAt
        : undefined,
      archivedAt,
    };
  });
  const mergedCards = cards.slice();
  const seenCardIds = new Set(cards.map((card) => card.id));
  for (const archivedCard of [...archivedCompleted, ...archivedRejected]) {
    if (seenCardIds.has(archivedCard.id)) {
      continue;
    }
    mergedCards.push(archivedCard);
    seenCardIds.add(archivedCard.id);
  }
  const deletedLabelCatalogKeys = normalizeCatalogKeyList(record.deletedLabelCatalogKeys);
  const deletedFlagCatalogKeys = normalizeDeletedFlagCatalogKeys(record.deletedFlagCatalogKeys);
  const disabledSystemFlagKeys = normalizeCockpitDisabledSystemFlagKeys(record.disabledSystemFlagKeys);
  const deletedCardIds = normalizeIdList(record.deletedCardIds);
  const visibleCards = deletedCardIds.length > 0
    ? mergedCards.filter((card) => !deletedCardIds.includes(card.id))
    : mergedCards;

  return {
    version: Number.isFinite(Number(record.version)) ? Math.max(4, Math.floor(Number(record.version))) : 4,
    sections: ensureSpecialSections(ensureUnsortedSection(sections, timestamp), timestamp),
    cards: visibleCards,
    labelCatalog: buildLabelCatalog(visibleCards, record.labelCatalog, deletedLabelCatalogKeys),
    deletedLabelCatalogKeys,
    flagCatalog: buildFlagCatalog(
      visibleCards,
      record.flagCatalog,
      deletedFlagCatalogKeys,
      disabledSystemFlagKeys,
    ),
    deletedFlagCatalogKeys,
    disabledSystemFlagKeys,
    deletedCardIds,
    filters: normalizeFilters(record.filters),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt
      : timestamp,
  };
}