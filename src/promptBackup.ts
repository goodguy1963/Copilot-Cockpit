import * as path from "path";
import { createHash } from "crypto";
import type { ScheduledTask } from "./types";
import {
    isPathInsideBaseDir,
    resolveAllowedPathInBaseDir,
} from "./promptResolver";

const BACKUP_DIR_NAME = "cockpit-prompt-backups";
const BACKUP_DIR_PARTS = [".vscode", BACKUP_DIR_NAME] as const;
const LEGACY_BACKUP_DIRS = [
    [".vscode", "scheduler-prompt-backups"],
    [".github", BACKUP_DIR_NAME],
    [".github", "scheduler-prompt-backups"],
] as const;
const INVALID_BACKUP_FILE_CHARS = /[^a-zA-Z0-9._-]+/g;
const MAX_BACKUP_BASE_NAME_LENGTH = 64;
const BACKUP_HASH_LENGTH = 10;

function normalizeBackupBaseName(taskId: string): string {
    const normalized = taskId
        .trim()
        .replace(INVALID_BACKUP_FILE_CHARS, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

    if (normalized.length <= MAX_BACKUP_BASE_NAME_LENGTH) {
        return normalized || "scheduled-task";
    }

    const hash = createHash("sha1")
        .update(taskId)
        .digest("hex")
        .slice(0, BACKUP_HASH_LENGTH);
    const prefixLength = Math.max(
        1,
        MAX_BACKUP_BASE_NAME_LENGTH - BACKUP_HASH_LENGTH - 1,
    );
    const truncatedPrefix = normalized
        .slice(0, prefixLength)
        .replace(/-+$/g, "") || "scheduled-task";

    return `${truncatedPrefix}-${hash}`;
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

function getLegacyPromptBackupRoot(workspaceRoot: string): string {
    return path.join(workspaceRoot, ...LEGACY_BACKUP_DIRS[1]);
}

function getAllowedPromptBackupRoots(workspaceRoot: string): string[] {
    return [
        getPromptBackupRoot(workspaceRoot),
        ...LEGACY_BACKUP_DIRS.map((parts) => path.join(workspaceRoot, ...parts)),
    ];
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

    const normalizedInput = promptBackupPath.replace(/\\/g, "/").trim();
    const allowedRoots = getAllowedPromptBackupRoots(workspaceRoot);

    if (path.isAbsolute(promptBackupPath)) {
        for (const allowedRoot of allowedRoots) {
            const resolved = resolveAllowedPathInBaseDir(
                allowedRoot,
                promptBackupPath,
            );
            if (resolved) {
                return resolved;
            }
        }
        return undefined;
    }

    const fromWorkspace = path.resolve(workspaceRoot, promptBackupPath);
    for (const allowedRoot of allowedRoots) {
        if (resolveAllowedPathInBaseDir(allowedRoot, fromWorkspace)) {
            return fromWorkspace;
        }
    }

    if (normalizedInput.startsWith(".github/prompts/")) {
        return undefined;
    }

    for (const allowedRoot of allowedRoots) {
        const fromBackupRoot = path.resolve(allowedRoot, promptBackupPath);
        if (resolveAllowedPathInBaseDir(allowedRoot, fromBackupRoot)) {
            return fromBackupRoot;
        }
    }

    return undefined;
}

export function getCanonicalPromptBackupPath(
    workspaceRoot: string,
    promptBackupPath: string,
): string | undefined {
    const resolvedPath = resolvePromptBackupPath(workspaceRoot, promptBackupPath);
    if (!resolvedPath) {
        return undefined;
    }

    for (const allowedRoot of getAllowedPromptBackupRoots(workspaceRoot)) {
        if (isPathInsideBaseDir(allowedRoot, resolvedPath)) {
            return path.join(
                getPromptBackupRoot(workspaceRoot),
                path.relative(allowedRoot, resolvedPath),
            );
        }
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