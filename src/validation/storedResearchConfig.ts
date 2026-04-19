import { z } from "zod";
import type {
    ResearchAttempt,
    ResearchAttemptOutcome,
    ResearchMetricDirection,
    ResearchProfile,
    ResearchRun,
    ResearchRunStatus,
    ResearchSnapshotInfo,
    ResearchWorkspaceConfig,
} from "../types";

const RESEARCH_CONFIG_VERSION = 1;
const DEFAULT_PROFILE_NAME = "Untitled Research Profile";
const DEFAULT_PROFILE_DIRECTION: ResearchMetricDirection = "maximize";
const DEFAULT_RUN_STATUS: ResearchRunStatus = "stopped";
const DEFAULT_ATTEMPT_OUTCOME: ResearchAttemptOutcome = "parse-error";

const arrayFieldSchema = z.preprocess(
    (value) => Array.isArray(value) ? value : undefined,
    z.array(z.unknown()).optional().default([]),
);

const storedResearchConfigSchema = z.object({
    version: z.number().int().optional().catch(RESEARCH_CONFIG_VERSION).default(RESEARCH_CONFIG_VERSION),
    profiles: arrayFieldSchema,
    runs: arrayFieldSchema,
}).catchall(z.unknown());

const storedProfileSchema = z.object({
    id: z.string().trim().min(1),
}).catchall(z.unknown());

const storedRunSchema = z.object({
    id: z.string().trim().min(1),
    profileId: z.string().trim().min(1),
}).catchall(z.unknown());

const storedAttemptSchema = z.object({
    id: z.string().trim().min(1),
}).catchall(z.unknown());

const storedSnapshotSchema = z.object({
    id: z.string().trim().min(1),
}).catchall(z.unknown());

const researchMetricDirectionSchema = z.enum(["maximize", "minimize"]);
const researchRunStatusSchema = z.enum([
    "idle",
    "running",
    "stopping",
    "completed",
    "failed",
    "stopped",
]);
const researchAttemptOutcomeSchema = z.enum([
    "baseline",
    "kept",
    "rejected",
    "crash",
    "parse-error",
    "policy-violation",
    "stopped",
]);

type StoredResearchConfigObject = z.infer<typeof storedResearchConfigSchema>;

function normalizeString(value: unknown, fallback = ""): string {
    return typeof value === "string" ? value : fallback;
}

function normalizeTrimmedString(value: unknown, fallback = ""): string {
    if (typeof value !== "string") {
        return fallback;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalTrimmedString(value: unknown): string | undefined {
    if (typeof value !== "string") {
        return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
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

function normalizeInteger(value: unknown, fallback: number): number {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.floor(parsed);
}

function normalizeOptionalNumber(value: unknown): number | undefined {
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalNullableInteger(value: unknown): number | null | undefined {
    if (value === null) {
        return null;
    }

    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
}

function normalizeResearchDirection(value: unknown): ResearchMetricDirection {
    const result = researchMetricDirectionSchema.safeParse(value);
    return result.success ? result.data : DEFAULT_PROFILE_DIRECTION;
}

function normalizeResearchRunStatus(value: unknown): ResearchRunStatus {
    const result = researchRunStatusSchema.safeParse(value);
    return result.success ? result.data : DEFAULT_RUN_STATUS;
}

function normalizeResearchAttemptOutcome(value: unknown): ResearchAttemptOutcome {
    const result = researchAttemptOutcomeSchema.safeParse(value);
    return result.success ? result.data : DEFAULT_ATTEMPT_OUTCOME;
}

function normalizeSnapshot(value: unknown): ResearchSnapshotInfo | undefined {
    const result = storedSnapshotSchema.safeParse(value);
    if (!result.success) {
        return undefined;
    }

    const snapshot = result.data as Record<string, unknown>;
    return {
        id: result.data.id,
        createdAt: normalizeString(snapshot.createdAt),
        label: normalizeString(snapshot.label),
    };
}

function normalizeAttempt(value: unknown): ResearchAttempt | undefined {
    const result = storedAttemptSchema.safeParse(value);
    if (!result.success) {
        return undefined;
    }

    const attempt = result.data as Record<string, unknown>;
    return {
        id: result.data.id,
        iteration: normalizeInteger(attempt.iteration, 0),
        startedAt: normalizeString(attempt.startedAt),
        finishedAt: normalizeOptionalTrimmedString(attempt.finishedAt),
        outcome: normalizeResearchAttemptOutcome(attempt.outcome),
        score: normalizeOptionalNumber(attempt.score),
        bestScoreAfter: normalizeOptionalNumber(attempt.bestScoreAfter),
        summary: normalizeOptionalTrimmedString(attempt.summary),
        exitCode: normalizeOptionalNullableInteger(attempt.exitCode),
        changedPaths: normalizeStringList(attempt.changedPaths),
        policyViolationPaths: normalizeStringList(attempt.policyViolationPaths),
        output: normalizeOptionalTrimmedString(attempt.output),
        error: normalizeOptionalTrimmedString(attempt.error),
        snapshot: normalizeSnapshot(attempt.snapshot),
    };
}

function normalizeProfile(value: unknown): ResearchProfile | undefined {
    const result = storedProfileSchema.safeParse(value);
    if (!result.success) {
        return undefined;
    }

    const profile = result.data as Record<string, unknown>;
    return {
        id: result.data.id,
        name: normalizeTrimmedString(profile.name, DEFAULT_PROFILE_NAME),
        instructions: normalizeString(profile.instructions),
        editablePaths: normalizeStringList(profile.editablePaths),
        benchmarkCommand: normalizeTrimmedString(profile.benchmarkCommand),
        metricPattern: normalizeString(profile.metricPattern),
        metricDirection: normalizeResearchDirection(profile.metricDirection),
        maxIterations: normalizeInteger(profile.maxIterations, 3),
        maxMinutes: normalizeInteger(profile.maxMinutes, 15),
        maxConsecutiveFailures: normalizeInteger(profile.maxConsecutiveFailures, 2),
        benchmarkTimeoutSeconds: normalizeInteger(profile.benchmarkTimeoutSeconds, 180),
        editWaitSeconds: normalizeInteger(profile.editWaitSeconds, 20),
        agent: normalizeOptionalTrimmedString(profile.agent),
        model: normalizeOptionalTrimmedString(profile.model),
        createdAt: normalizeString(profile.createdAt),
        updatedAt: normalizeString(profile.updatedAt),
    };
}

function normalizeRun(value: unknown): ResearchRun | undefined {
    const result = storedRunSchema.safeParse(value);
    if (!result.success) {
        return undefined;
    }

    const run = result.data as Record<string, unknown>;
    const attempts = Array.isArray(run.attempts)
        ? run.attempts
            .map((entry) => normalizeAttempt(entry))
            .filter((entry): entry is ResearchAttempt => !!entry)
        : [];

    return {
        id: result.data.id,
        profileId: result.data.profileId,
        profileName: normalizeString(run.profileName),
        status: normalizeResearchRunStatus(run.status),
        startedAt: normalizeString(run.startedAt),
        finishedAt: normalizeOptionalTrimmedString(run.finishedAt),
        baselineScore: normalizeOptionalNumber(run.baselineScore),
        bestScore: normalizeOptionalNumber(run.bestScore),
        completedIterations: normalizeInteger(run.completedIterations, 0),
        stopReason: normalizeOptionalTrimmedString(run.stopReason),
        attempts,
    };
}

function createEmptyConfig(): ResearchWorkspaceConfig {
    return {
        version: RESEARCH_CONFIG_VERSION,
        profiles: [],
        runs: [],
    };
}

function toParsedStoredResearchConfig(
    root: StoredResearchConfigObject,
): ResearchWorkspaceConfig {
    return {
        version: Number.isFinite(root.version) ? root.version : RESEARCH_CONFIG_VERSION,
        profiles: root.profiles
            .map((entry) => normalizeProfile(entry))
            .filter((entry): entry is ResearchProfile => !!entry),
        runs: root.runs
            .map((entry) => normalizeRun(entry))
            .filter((entry): entry is ResearchRun => !!entry),
    };
}

export function parseStoredResearchConfig(value: unknown): ResearchWorkspaceConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return createEmptyConfig();
    }

    const result = storedResearchConfigSchema.safeParse(value);
    if (!result.success) {
        return createEmptyConfig();
    }

    return toParsedStoredResearchConfig(result.data);
}

export function parseStoredResearchConfigText(raw: string): ResearchWorkspaceConfig {
    try {
        return parseStoredResearchConfig(JSON.parse(raw.replace(/^\uFEFF/, "")));
    } catch {
        return createEmptyConfig();
    }
}

export function stringifyStoredResearchConfig(value: unknown): string {
    return JSON.stringify(parseStoredResearchConfig(value), null, 2);
}