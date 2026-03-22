import * as path from "path";
import type { ScheduledTask } from "./types";
import { resolveAllowedPathInBaseDir } from "./promptResolver";

const BACKUP_DIR_PARTS = [".github", "scheduler-prompt-backups"] as const;
const INVALID_BACKUP_FILE_CHARS = /[^a-zA-Z0-9._-]+/g;

function normalizeBackupBaseName(taskId: string): string {
    const normalized = taskId
        .trim()
        .replace(INVALID_BACKUP_FILE_CHARS, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    return normalized || "scheduled-task";
}

function formatIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function normalizePromptBody(prompt: string): string {
    const normalized = prompt.replace(/\r\n/g, "\n");
    return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

export function getPromptBackupRoot(workspaceRoot: string): string {
    return path.join(workspaceRoot, ...BACKUP_DIR_PARTS);
}

export function getDefaultPromptBackupRelativePath(taskId: string): string {
    const fileName = `${normalizeBackupBaseName(taskId)}.prompt.md`;
    return `${BACKUP_DIR_PARTS.join("/")}/${fileName}`;
}

export function resolvePromptBackupPath(
    workspaceRoot: string,
    promptBackupPath: string,
): string | undefined {
    if (!workspaceRoot || !promptBackupPath) return undefined;

    const backupRoot = getPromptBackupRoot(workspaceRoot);
    const normalizedInput = promptBackupPath.replace(/\\/g, "/").trim();

    if (path.isAbsolute(promptBackupPath)) {
        return resolveAllowedPathInBaseDir(backupRoot, promptBackupPath);
    }

    const fromWorkspace = path.resolve(workspaceRoot, promptBackupPath);
    if (resolveAllowedPathInBaseDir(backupRoot, fromWorkspace)) {
        return fromWorkspace;
    }

    if (normalizedInput.startsWith(".github/")) {
        return undefined;
    }

    const fromBackupRoot = path.resolve(backupRoot, promptBackupPath);
    if (resolveAllowedPathInBaseDir(backupRoot, fromBackupRoot)) {
        return fromBackupRoot;
    }

    return undefined;
}

export function toWorkspaceRelativePromptBackupPath(
    workspaceRoot: string,
    absolutePath: string,
): string {
    return path.relative(workspaceRoot, absolutePath).split(path.sep).join("/");
}

export function isRecurringPromptBackupCandidate(task: ScheduledTask): boolean {
    return (
        task.scope === "workspace" &&
        task.oneTime !== true &&
        task.promptSource === "inline" &&
        typeof task.prompt === "string" &&
        task.prompt.trim().length > 0
    );
}

export function renderPromptBackupContent(
    task: Pick<ScheduledTask, "id" | "name" | "cronExpression" | "prompt">,
    backupUpdatedAt: Date,
): string {
    const header = [
        "---",
        "backupOnly: true",
        `taskId: ${JSON.stringify(task.id)}`,
        `taskName: ${JSON.stringify(task.name)}`,
        `cronExpression: ${JSON.stringify(task.cronExpression)}`,
        `authoritativeSource: ${JSON.stringify(".vscode/scheduler.json")}`,
        `authoritativePromptSource: ${JSON.stringify("inline")}`,
        `lastUpdated: ${JSON.stringify(formatIsoDate(backupUpdatedAt))}`,
        "---",
        "",
    ].join("\n");

    return `${header}${normalizePromptBody(task.prompt)}`;
}