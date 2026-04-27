import { z } from "zod";

const publicSchedulerStateKeys = [
    "tasks",
    "deletedTaskIds",
    "jobs",
    "deletedJobIds",
    "jobFolders",
    "deletedJobFolderIds",
] as const;

const arrayFieldSchema = z.preprocess(
    (value) => Array.isArray(value) ? value : undefined,
    z.array(z.unknown()).optional().default([]),
);

const storedSchedulerObjectSchema = z.object({
    tasks: arrayFieldSchema,
    deletedTaskIds: arrayFieldSchema,
    jobs: arrayFieldSchema,
    deletedJobIds: arrayFieldSchema,
    jobFolders: arrayFieldSchema,
    deletedJobFolderIds: arrayFieldSchema,
    cockpitBoard: z.unknown().optional(),
    githubIntegration: z.unknown().optional(),
    telegramNotification: z.unknown().optional(),
}).catchall(z.unknown());

type StoredSchedulerObject = z.infer<typeof storedSchedulerObjectSchema>;

export type ParsedStoredSchedulerConfigInput = {
    kind: "array" | "object";
    carriesSchedulerState: boolean;
    tasks: unknown[];
    deletedTaskIds: string[];
    jobs: unknown[];
    deletedJobIds: string[];
    jobFolders: unknown[];
    deletedJobFolderIds: string[];
    cockpitBoard?: unknown;
    githubIntegration?: unknown;
    telegramNotification?: unknown;
    rootObject?: Record<string, unknown>;
};

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeNonEmptyStringList(value: unknown[]): string[] {
    return value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
}

export function filterStoredSchedulerTaskEntries(tasks: unknown[]): unknown[] {
    return tasks.filter((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
            return false;
        }

        const id = (entry as { id?: unknown }).id;
        return typeof id === "string" && id.trim().length > 0;
    });
}

function toParsedStoredSchedulerConfig(
    root: StoredSchedulerObject,
    rawRoot: Record<string, unknown>,
): ParsedStoredSchedulerConfigInput {
    return {
        kind: "object",
        carriesSchedulerState: publicSchedulerStateKeys.some((key) => hasOwn(rawRoot, key)),
        tasks: filterStoredSchedulerTaskEntries(root.tasks),
        deletedTaskIds: normalizeNonEmptyStringList(root.deletedTaskIds),
        jobs: root.jobs,
        deletedJobIds: normalizeNonEmptyStringList(root.deletedJobIds),
        jobFolders: root.jobFolders,
        deletedJobFolderIds: normalizeNonEmptyStringList(root.deletedJobFolderIds),
        cockpitBoard: root.cockpitBoard,
        githubIntegration: root.githubIntegration,
        telegramNotification: root.telegramNotification,
        rootObject: root as Record<string, unknown>,
    };
}

export function safeParseStoredSchedulerConfigInput(
    value: unknown,
): ParsedStoredSchedulerConfigInput | undefined {
    if (Array.isArray(value)) {
        return {
            kind: "array",
            carriesSchedulerState: true,
            tasks: filterStoredSchedulerTaskEntries(value),
            deletedTaskIds: [],
            jobs: [],
            deletedJobIds: [],
            jobFolders: [],
            deletedJobFolderIds: [],
        };
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }

    const result = storedSchedulerObjectSchema.safeParse(value);
    if (!result.success) {
        return undefined;
    }

    return toParsedStoredSchedulerConfig(
        result.data,
        value as Record<string, unknown>,
    );
}