import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { sanitizeAbsolutePathDetails } from "./errorSanitizer";

export type TaskStorageMeta = {
  revision: number;
  savedAt: string;
};

export function getSchedulerLocalDateKey(date = new Date()): string {
  const [year, month, day] = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ];

  return `${year}-${month}-${day}`;
}

export function toSafeSchedulerErrorDetails(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return sanitizeAbsolutePathDetails(raw) || raw;
}

export function readTaskStorageMetaFromFile(metaFilePath: string): TaskStorageMeta | undefined {
  try {
    if (!metaFilePath || !fs.existsSync(metaFilePath)) {
      return undefined;
    }

    const raw = fs.readFileSync(metaFilePath, "utf8");
    if (!raw.trim()) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as Partial<TaskStorageMeta>;
    return {
      revision: typeof parsed.revision === "number" ? parsed.revision : 0,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
    };
  } catch {
    return undefined;
  }
}

export function readTaskStorageMetaFromState(
  globalState: vscode.Memento,
  revisionKey: string,
  savedAtKey: string,
): TaskStorageMeta {
  const revision = globalState.get<number>(revisionKey, 0);
  const savedAt = globalState.get<string>(savedAtKey, "");

  return {
    revision: typeof revision === "number" ? revision : 0,
    savedAt,
  };
}

export async function writeTaskStorageMetaToFile(
  metaFilePath: string,
  meta: TaskStorageMeta,
): Promise<void> {
  await fs.promises.mkdir(path.dirname(metaFilePath), { recursive: true });
  await fs.promises.writeFile(metaFilePath, JSON.stringify(meta), "utf8");
}

export async function writeTaskStorageMetaToState(
  globalState: vscode.Memento,
  revisionKey: string,
  savedAtKey: string,
  meta: TaskStorageMeta,
): Promise<void> {
  await globalState.update(revisionKey, meta.revision);
  await globalState.update(savedAtKey, meta.savedAt);
}
