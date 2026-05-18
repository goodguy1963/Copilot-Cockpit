/**
 * Lightweight runtime shape assertions for extension-host -> webview messages.
 *
 * Validates that known factory messages carry the expected payload fields
 * with correct types.  Asserts warn on mismatch (fail-soft) and do not throw
 * unless the caller opts in with `{ throwOnError: true }`.
 *
 * Keep this file in sync with cockpitWebviewMessageFactory.ts exports.
 */

type ValidationResult = { valid: boolean; warnings: string[] };
type Logger = (msg: string) => void;

let _globalLogger: Logger = () => {};

export function setSchemaLogger(logger: Logger): void {
  _globalLogger = logger;
}

function warn(text: string): void {
  _globalLogger(`[MessageSchema] ${text}`);
}

function isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isBoolean(v: unknown): v is boolean {
  return typeof v === "boolean";
}

function isUndefined(v: unknown): v is undefined {
  return typeof v === "undefined";
}

// --- Field-level checks ---

function checkArrayField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (!(field in payload)) {
    warnings.push(`message missing "${field}" (array expected)`);
  } else if (!isArray(payload[field])) {
    warnings.push(`"${field}" must be an array, got ${typeof payload[field]}`);
  }
}

function checkOptionalArrayField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (field in payload && !isArray(payload[field]) && !isUndefined(payload[field])) {
    warnings.push(`"${field}" must be an array or undefined, got ${typeof payload[field]}`);
  }
}

function checkStringField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (!(field in payload)) {
    warnings.push(`message missing "${field}" (string expected)`);
  } else if (!isString(payload[field])) {
    warnings.push(`"${field}" must be a string, got ${typeof payload[field]}`);
  }
}

function checkOptionalStringField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (field in payload && !isString(payload[field]) && !isUndefined(payload[field])) {
    warnings.push(`"${field}" must be a string or undefined, got ${typeof payload[field]}`);
  }
}

function checkBooleanField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (!(field in payload)) {
    warnings.push(`message missing "${field}" (boolean expected)`);
  } else if (!isBoolean(payload[field])) {
    warnings.push(`"${field}" must be a boolean, got ${typeof payload[field]}`);
  }
}

function checkOptionalBooleanField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (field in payload && !isBoolean(payload[field]) && !isUndefined(payload[field])) {
    warnings.push(`"${field}" must be a boolean or undefined, got ${typeof payload[field]}`);
  }
}

function checkObjectField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (!(field in payload)) {
    warnings.push(`message missing "${field}" (object expected)`);
  } else if (!isObject(payload[field])) {
    warnings.push(`"${field}" must be an object, got ${typeof payload[field]}`);
  }
}

function checkOptionalObjectField(
  payload: Record<string, unknown>,
  field: string,
  warnings: string[],
): void {
  if (field in payload && !isObject(payload[field]) && !isUndefined(payload[field])) {
    warnings.push(`"${field}" must be an object or undefined, got ${typeof payload[field]}`);
  }
}

// --- Schema definitions ---

interface MessageSchema {
  type: string;
  check: (payload: Record<string, unknown>) => string[];
}

const SCHEMAS: MessageSchema[] = [
  // updateTasks(tasks: ScheduledTask[])
  { type: "updateTasks", check(p) { const w: string[] = []; checkArrayField(p, "tasks", w); return w; } },

  // updateJobs(jobs: JobDefinition[])
  { type: "updateJobs", check(p) { const w: string[] = []; checkArrayField(p, "jobs", w); return w; } },

  // updateJobFolders(jobFolders: JobFolder[])
  { type: "updateJobFolders", check(p) { const w: string[] = []; checkArrayField(p, "jobFolders", w); return w; } },

  // updateGitHubIntegration(githubIntegration: GitHubIntegrationView)
  { type: "updateGitHubIntegration", check(p) { const w: string[] = []; checkObjectField(p, "githubIntegration", w); return w; } },

  // updateTelegramNotification(telegramNotification: TelegramNotificationView)
  { type: "updateTelegramNotification", check(p) { const w: string[] = []; checkObjectField(p, "telegramNotification", w); return w; } },

  // updateExecutionDefaults(executionDefaults: ExecutionDefaultsView)
  { type: "updateExecutionDefaults", check(p) { const w: string[] = []; checkObjectField(p, "executionDefaults", w); return w; } },

  // updateReviewDefaults(reviewDefaults: ReviewDefaultsStateView)
  { type: "updateReviewDefaults", check(p) { const w: string[] = []; checkObjectField(p, "reviewDefaults", w); return w; } },

  // updateStorageSettings(storageSettings: StorageSettingsView)
  { type: "updateStorageSettings", check(p) { const w: string[] = []; checkObjectField(p, "storageSettings", w); return w; } },

  // updateResearchState(profiles, activeRun, recentRuns)
  { type: "updateResearchState", check(p) {
      const w: string[] = [];
      checkArrayField(p, "profiles", w);
      checkOptionalObjectField(p, "activeRun", w);
      checkArrayField(p, "recentRuns", w);
      return w;
    }
  },

  // updateScheduleHistory(entries: ScheduleHistoryEntry[])
  { type: "updateScheduleHistory", check(p) { const w: string[] = []; checkArrayField(p, "entries", w); return w; } },

  // switchToList(successMessage?: string, revealTasks?: boolean)
  { type: "switchToList", check(p) {
      const w: string[] = [];
      checkOptionalStringField(p, "successMessage", w);
      checkOptionalBooleanField(p, "revealTasks", w);
      return w;
    }
  },

  // switchToTab(tab: string)
  { type: "switchToTab", check(p) { const w: string[] = []; checkStringField(p, "tab", w); return w; } },

  // updateAutoShowOnStartup(enabled: boolean)
  { type: "updateAutoShowOnStartup", check(p) { const w: string[] = []; checkBooleanField(p, "enabled", w); return w; } },

  // startCreateTask / startCreateJob
  { type: "startCreateTask", check() { return []; } },
  { type: "startCreateJob", check() { return []; } },

  // focusTask(taskId: string)
  { type: "focusTask", check(p) { const w: string[] = []; checkStringField(p, "taskId", w); return w; } },

  // focusReadyTodoDraft(todoId: string)
  { type: "focusReadyTodoDraft", check(p) { const w: string[] = []; checkStringField(p, "todoId", w); return w; } },

  // focusJob(jobId: string, folderId?: string)
  { type: "focusJob", check(p) {
      const w: string[] = [];
      checkStringField(p, "jobId", w);
      checkOptionalStringField(p, "folderId", w);
      return w;
    }
  },

  // focusResearchProfile(researchId?: string)
  { type: "focusResearchProfile", check(p) { const w: string[] = []; checkOptionalStringField(p, "researchId", w); return w; } },

  // focusResearchRun(runId?: string)
  { type: "focusResearchRun", check(p) { const w: string[] = []; checkOptionalStringField(p, "runId", w); return w; } },

  // editTask(taskId: string)
  { type: "editTask", check(p) { const w: string[] = []; checkStringField(p, "taskId", w); return w; } },

  // showError(text: string)
  { type: "showError", check(p) { const w: string[] = []; checkStringField(p, "text", w); return w; } },
];

// --- Public API ---

/**
 * Validate a message's shape against known schemas.
 * Returns a ValidationResult with warnings for any mismatches.
 * Unknown message types silently pass (they may be custom or new).
 */
export function validateMessageShape(
  message: { type: string; [key: string]: unknown },
  options?: { throwOnError?: boolean },
): ValidationResult {
  const schema = SCHEMAS.find((s) => s.type === message.type);
  if (!schema) {
    return { valid: true, warnings: [] };
  }

  const warnings = schema.check(message);
  if (warnings.length > 0) {
    for (const w of warnings) {
      warn(`[${message.type}] ${w}`);
    }
    if (options?.throwOnError) {
      throw new Error(
        `Message schema validation failed for "${message.type}": ${warnings.join("; ")}`,
      );
    }
  }

  return { valid: warnings.length === 0, warnings };
}

/**
 * Validate and log warnings without throwing.
 * A convenience wrapper for use in postMessage paths.
 */
export function validateAndWarn(
  message: { type: string; [key: string]: unknown },
): void {
  const result = validateMessageShape(message);
  if (!result.valid) {
    for (const w of result.warnings) {
      warn(w);
    }
  }
}
