import type {
  CockpitBoard,
  CockpitRoutingCard,
  CockpitRoutingComment,
  CockpitTodoCard,
  CockpitTodoComment,
  CockpitRoutingQuery,
} from "./types";

export const DEFAULT_ROUTING_SIGNALS = [
  "go",
  "abgelehnt",
  "needs-bot-review",
  "on-schedule-list",
];

const NON_ACTIONABLE_COMMENT_PATTERNS = [
  /^\s*scheduled as\b/i,
  /^\s*done(?:[\s.!?,-].*)?$/i,
  /label[- ]maintenance/i,
  /dispatcher status/i,
  /scheduler status/i,
];

function normalizeRoutingSignal(value: string): string {
  return String(value || "").trim().toLowerCase();
}

function normalizeSignalList(signals: string[] | undefined): string[] {
  const list = Array.isArray(signals) && signals.length > 0
    ? signals
    : DEFAULT_ROUTING_SIGNALS;
  return Array.from(new Set(
    list
      .map((signal) => normalizeRoutingSignal(signal))
      .filter((signal) => signal.length > 0),
  ));
}

function normalizeLabelList(values: string[] | undefined): string[] {
  return Array.isArray(values)
    ? values
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0)
    : [];
}

function normalizeComment(comment: CockpitTodoComment): CockpitRoutingComment {
  return {
    ...comment,
    labels: normalizeLabelList(comment.labels),
  };
}

function sortCommentsNewestFirst(comments: CockpitTodoComment[]): CockpitRoutingComment[] {
  return comments
    .slice()
    .sort((left, right) => {
      const sequenceDelta = (right.sequence || 0) - (left.sequence || 0);
      if (sequenceDelta !== 0) {
        return sequenceDelta;
      }
      const createdAtDelta = new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }
      return String(right.id || "").localeCompare(String(left.id || ""));
    })
    .map((comment) => normalizeComment(comment));
}

function isActionableUserComment(comment: CockpitTodoComment): boolean {
  if (!comment || comment.author !== "user") {
    return false;
  }

  const body = String(comment.body || "").trim();
  if (!body) {
    return false;
  }

  return !NON_ACTIONABLE_COMMENT_PATTERNS.some((pattern) => pattern.test(body));
}

function getLatestActionableUserComment(comments: CockpitTodoComment[]): CockpitRoutingComment | undefined {
  return sortCommentsNewestFirst(comments).find((comment) => isActionableUserComment(comment));
}

function matchesAnySignal(values: string[], signalSet: Set<string>): string[] {
  const matches = new Set<string>();
  for (const value of values) {
    const normalized = normalizeRoutingSignal(value);
    if (normalized && signalSet.has(normalized)) {
      matches.add(normalized);
    }
  }
  return Array.from(matches);
}

function getSectionTitle(board: CockpitBoard, sectionId: string): string | undefined {
  return Array.isArray(board.sections)
    ? board.sections.find((section) => section.id === sectionId)?.title
    : undefined;
}

export function buildCockpitRoutingCard(
  board: CockpitBoard,
  card: CockpitTodoCard,
  query: CockpitRoutingQuery = {},
): CockpitRoutingCard | undefined {
  const signalSet = new Set(normalizeSignalList(query.signals));
  const comments = sortCommentsNewestFirst(card.comments ?? []);
  const latestActionableUserComment = getLatestActionableUserComment(card.comments ?? []);

  const matchedSignals = new Set<string>();
  for (const flag of normalizeLabelList(card.flags)) {
    const match = matchesAnySignal([flag], signalSet);
    for (const signal of match) {
      matchedSignals.add(signal);
    }
  }
  if (latestActionableUserComment) {
    const match = matchesAnySignal(latestActionableUserComment.labels ?? [], signalSet);
    for (const signal of match) {
      matchedSignals.add(signal);
    }
  }

  if (matchedSignals.size === 0) {
    return undefined;
  }

  return {
    id: card.id,
    title: card.title,
    sectionId: card.sectionId,
    sectionTitle: getSectionTitle(board, card.sectionId),
    order: card.order,
    status: card.status,
    archived: card.archived === true,
    archiveOutcome: card.archiveOutcome,
    taskId: card.taskId,
    labels: normalizeLabelList(card.labels),
    flags: normalizeLabelList(card.flags),
    comments,
    latestComment: comments[0],
    latestActionableUserComment,
    matchedSignals: Array.from(matchedSignals).sort((left, right) => left.localeCompare(right)),
    commentCount: comments.length,
  };
}

export function listCockpitRoutingCards(
  board: CockpitBoard,
  query: CockpitRoutingQuery = {},
): CockpitRoutingCard[] {
  const cards = Array.isArray(board.cards) ? board.cards : [];
  const includeArchived = query.includeArchived !== false;
  const routingCards = cards
    .map((card) => buildCockpitRoutingCard(board, card, query))
    .filter((card): card is CockpitRoutingCard => Boolean(card));

  return routingCards
    .filter((card) => includeArchived || card.archived !== true)
    .sort((left, right) => {
      const leftSection = Array.isArray(board.sections)
        ? board.sections.find((section) => section.id === left.sectionId)
        : undefined;
      const rightSection = Array.isArray(board.sections)
        ? board.sections.find((section) => section.id === right.sectionId)
        : undefined;
      const leftOrder = typeof leftSection?.order === "number" ? leftSection.order : Number.MAX_SAFE_INTEGER;
      const rightOrder = typeof rightSection?.order === "number" ? rightSection.order : Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }
      if ((left.archived ? 1 : 0) !== (right.archived ? 1 : 0)) {
        return (left.archived ? 1 : 0) - (right.archived ? 1 : 0);
      }
      if (left.order !== right.order) {
        return left.order - right.order;
      }
      if (left.sectionId !== right.sectionId) {
        return left.sectionId.localeCompare(right.sectionId);
      }
      return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    });
}