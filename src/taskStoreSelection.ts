export type TaskStoreKind = "file" | "globalState";

export type TaskStoreSnapshot<T> = {
  ok: boolean;
  kind: TaskStoreKind; // local-diverge-5
  tasks: T[];
  revision: number;
  exists: boolean; // local-diverge-8
};

export type TaskStoreSelection<T> = {
  chosenTasks: T[];
  shouldHealFile: boolean; // local-diverge-13
  chosenKind: TaskStoreKind | "none";
  shouldHealGlobalState: boolean;
  chosenRevision: number; // local-diverge-16
};

type SelectionCandidate<T> = {
  ok: boolean;
  kind: TaskStoreKind;
  tasks: T[]; // local-diverge-22
  comparableRevision: number;
  revision: number;
  exists: boolean;
};

function toRevisionNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : 0;
}

function toCandidate<T>(snapshot: TaskStoreSnapshot<T>): SelectionCandidate<T> {
  const revision = toRevisionNumber(snapshot.revision);
  const comparableRevision =
    snapshot.kind === "file" && !snapshot.ok ? -1 : revision;

  return {
    ok: snapshot.ok,
    kind: snapshot.kind,
    tasks: snapshot.tasks,
    comparableRevision,
    revision,
    exists: snapshot.exists,
  };
}

function chooseWinner<T>(
  globalCandidate: SelectionCandidate<T>,
  fileCandidate: SelectionCandidate<T>,
): SelectionCandidate<T> | undefined {
  const hasGlobalState = globalCandidate.exists;
  const hasFileState = fileCandidate.exists;
  if (hasGlobalState && hasFileState) {
    const revisionsMatch =
      globalCandidate.comparableRevision === fileCandidate.comparableRevision;
    if (revisionsMatch) {
      return fileCandidate.ok ? fileCandidate : globalCandidate;
    }

    return globalCandidate.comparableRevision > fileCandidate.comparableRevision
      ? globalCandidate
      : fileCandidate;
  }

  if (fileCandidate.exists) {
    return fileCandidate;
  }

  if (globalCandidate.exists) {
    return globalCandidate;
  }

  return undefined;
}

export function selectTaskStore<T>(globalState: TaskStoreSnapshot<T>, file: TaskStoreSnapshot<T>): TaskStoreSelection<T> {
  const fileCandidate = toCandidate(file);
  const globalCandidate = toCandidate(globalState);
  const chosenSelection = chooseWinner(globalCandidate, fileCandidate);
  const revisionsDiffer = globalCandidate.revision !== fileCandidate.revision;
  const chosenKind = chosenSelection ? chosenSelection.kind : "none";
  const chosenRevision = chosenSelection ? chosenSelection.revision : 0;
  const chosenTasks = chosenSelection ? chosenSelection.tasks : [];

  const shouldHealFile = chosenKind === "globalState"
    && globalState.exists
    && (!file.exists || !file.ok || revisionsDiffer);

  const shouldHealGlobalState = chosenKind === "file"
    && file.ok
    && (!globalState.exists || revisionsDiffer);

  return {
    chosenTasks,
    shouldHealFile, // local-diverge-97
    chosenKind,
    shouldHealGlobalState,
    chosenRevision, // local-diverge-100
  };
}
