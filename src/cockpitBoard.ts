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
  };
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

const DEFAULT_FLAG_SEEDS: { name: string; color: string }[] = [
  { name: "GO", color: "#22c55e" },
  { name: "needs-bot-review", color: "#f59e0b" },
  { name: "needs-user-review", color: "#3b82f6" },
  { name: "NEW", color: "#a78bfa" },
];

function buildFlagCatalog(
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
    const flag = card.flags[0];
    if (!flag) {
      continue;
    }
    const key = normalizeLabelKey(flag);
    if (!key || catalog.has(key) || deletedKeySet.has(key)) {
      continue;
    }
    catalog.set(key, {
      name: flag,
      key,
      color: "var(--vscode-badge-background)",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  for (const seed of DEFAULT_FLAG_SEEDS) {
    const key = normalizeLabelKey(seed.name);
    if (key && !catalog.has(key) && !deletedKeySet.has(key)) {
      catalog.set(key, {
        name: seed.name,
        key,
        color: seed.color,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  }

  return Array.from(catalog.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function normalizeArchivedCards(cards: unknown): CockpitTodoCard[] {
  return Array.isArray(cards)
    ? cards.map((entry, index) => normalizeCard(entry, index))
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
    flags: normalizeLabels(record.flags),
    comments,
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
  const title = typeof record.title === "string" && record.title.trim()
    ? record.title.trim()
    : DEFAULT_SECTIONS[index]?.title ?? `Section ${index + 1}`;

  return {
    id: typeof record.id === "string" && record.id.trim()
      ? record.id.trim()
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
    flags: normalizeLabels(record.flags),
    sectionId: normalizeOptionalIsoString(record.sectionId),
    sortBy: normalizeSortBy(record.sortBy),
    sortDirection: normalizeSortDirection(record.sortDirection),
    viewMode: normalizeViewMode(record.viewMode),
    showArchived: record.showArchived === true,
  };
}

export function createDefaultCockpitBoard(timestamp = nowIso()): CockpitBoard {
  return {
    version: 2,
    sections: buildDefaultSections(timestamp),
    cards: [],
    labelCatalog: [],
    deletedLabelCatalogKeys: [],
    flagCatalog: [],
    deletedFlagCatalogKeys: [],
    archives: {
      completedSuccessfully: [],
      rejected: [],
    },
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
  const cards = Array.isArray(record.cards)
    ? record.cards.map((entry, index) => normalizeCard(entry, index))
    : [];
  const archivesRecord = record.archives && typeof record.archives === "object"
    ? record.archives as NonNullable<CockpitBoard["archives"]>
    : undefined;
  const archivedCompleted = normalizeArchivedCards(
    archivesRecord?.completedSuccessfully,
  );
  const archivedRejected = normalizeArchivedCards(archivesRecord?.rejected);
  const allCards = [...cards, ...archivedCompleted, ...archivedRejected];
  const deletedLabelCatalogKeys = normalizeCatalogKeyList(record.deletedLabelCatalogKeys);
  const deletedFlagCatalogKeys = normalizeCatalogKeyList(record.deletedFlagCatalogKeys);

  return {
    version: Number.isFinite(Number(record.version)) ? Math.max(2, Math.floor(Number(record.version))) : 2,
    sections: ensureUnsortedSection(sections, timestamp),
    cards,
    labelCatalog: buildLabelCatalog(allCards, record.labelCatalog, deletedLabelCatalogKeys),
    deletedLabelCatalogKeys,
    flagCatalog: buildFlagCatalog(allCards, record.flagCatalog, deletedFlagCatalogKeys),
    deletedFlagCatalogKeys,
    archives: {
      completedSuccessfully: archivedCompleted,
      rejected: archivedRejected,
    },
    filters: normalizeFilters(record.filters),
    updatedAt: typeof record.updatedAt === "string" && record.updatedAt.trim()
      ? record.updatedAt
      : timestamp,
  };
}