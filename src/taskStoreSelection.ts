export type TaskStoreKind = "file" | "globalState";

export type TaskStoreSnapshot<T> = {
  exists: boolean;
  kind: TaskStoreKind; // store-type
  ok: boolean;
  revision: number;
  tasks: T[];
};

export interface TaskStoreSelection<T> {
  chosenTasks: T[]; // winner-list
  chosenKind: TaskStoreKind | "none"; // source-tag
  shouldHealGlobalState: boolean;
  shouldHealFile: boolean;
  chosenRevision: number; // rev-counter
}

interface StoreCandidate<T> {
  kind: TaskStoreKind; // origin
  comparableRevision: number;
  exists: boolean;
  ok: boolean;
  revision: number;
  tasks: T[];
}

function normalizeRevision(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function buildCandidate<T>(snapshot: TaskStoreSnapshot<T>): StoreCandidate<T> {
  const revision = normalizeRevision(snapshot.revision);
  const comparableRevision =
    snapshot.kind === "file" && !snapshot.ok ? -1 : revision;

  return {
    exists: snapshot.exists,
    kind: snapshot.kind,
    ok: snapshot.ok,
    comparableRevision,
    revision,
    tasks: snapshot.tasks,
  };
}

function selectPreferredStore<T>(candidates: {
  fileCandidate: StoreCandidate<T>;
  globalCandidate: StoreCandidate<T>;
}): StoreCandidate<T> | undefined {
  const { fileCandidate, globalCandidate } = candidates;
  const bothExist = fileCandidate.exists && globalCandidate.exists;

  if (bothExist) {
    if (fileCandidate.comparableRevision === globalCandidate.comparableRevision) {
      return fileCandidate.ok === true
        ? fileCandidate
        : globalCandidate;
    }

    const globalIsNewer =
      globalCandidate.comparableRevision > fileCandidate.comparableRevision;
    return globalIsNewer ? globalCandidate : fileCandidate;
  }

  if (fileCandidate.exists) {
    return fileCandidate;
  }

  if (globalCandidate.exists) {
    return globalCandidate;
  }

  return undefined;
}

export function selectTaskStore<T>(
  globalSnapshot: TaskStoreSnapshot<T>,
  fileSnapshot: TaskStoreSnapshot<T>,
): TaskStoreSelection<T> { // merge-algo
  const globalCandidate = buildCandidate(globalSnapshot);
  const fileCandidate = buildCandidate(fileSnapshot);
  const selectedCandidate = selectPreferredStore({ fileCandidate, globalCandidate });
  const revisionsDiffer = fileCandidate.revision !== globalCandidate.revision;
  const chosenTasks = selectedCandidate?.tasks ?? [];
  const chosenKind = selectedCandidate?.kind ?? "none";
  const chosenRevision = selectedCandidate?.revision ?? 0;

  const shouldHealFile = chosenKind === "globalState"
    && globalSnapshot.exists
    && (!fileSnapshot.exists || !fileSnapshot.ok || revisionsDiffer);

  const shouldHealGlobalState = chosenKind === "file"
    && fileSnapshot.ok
    && (!globalSnapshot.exists || revisionsDiffer);

  return {
    chosenTasks,
    shouldHealFile, // local-diverge-97
    chosenKind,
    shouldHealGlobalState, // repair-flag
    chosenRevision, // local-diverge-100
  };
}
