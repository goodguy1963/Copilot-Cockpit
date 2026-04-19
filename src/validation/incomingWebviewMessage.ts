import { z } from "zod";
import type {
  CreateCockpitTodoInput,
  CreateJobFolderInput,
  CreateJobInput,
  CreateJobPauseInput,
  CreateResearchProfileInput,
  CreateTaskInput,
  ExecutionDefaultsView,
  LogLevel,
  ReviewDefaultsView,
  SaveTelegramNotificationInput,
  StorageSettingsView,
  UpdateCockpitBoardFiltersInput,
  UpdateCockpitTodoInput,
  UpsertCockpitLabelDefinitionInput,
  WebviewToExtensionMessage,
} from "../types";

const nonEmptyStringSchema = z.string().trim().min(1);
const optionalStringSchema = z.preprocess(
  (value) => value === null ? undefined : value,
  z.string().optional(),
);
const numberSchema = z.number().finite();
const booleanSchema = z.boolean();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createObjectPayloadSchema<T>(label: string): z.ZodType<T> {
  return z.custom<T>(isObjectRecord, {
    message: `${label} must be an object`,
  });
}

const createTaskInputSchema = createObjectPayloadSchema<CreateTaskInput>("task data");
const updateTaskInputSchema = createObjectPayloadSchema<Partial<CreateTaskInput>>("task data");
const createJobInputSchema = createObjectPayloadSchema<CreateJobInput>("job data");
const updateJobInputSchema = createObjectPayloadSchema<Partial<CreateJobInput>>("job data");
const createJobFolderInputSchema = createObjectPayloadSchema<CreateJobFolderInput>("job folder data");
const renameJobFolderInputSchema = createObjectPayloadSchema<Partial<CreateJobFolderInput>>("job folder data");
const createJobPauseInputSchema = createObjectPayloadSchema<CreateJobPauseInput>("job pause data");
const createResearchProfileInputSchema = createObjectPayloadSchema<CreateResearchProfileInput>("research profile data");
const updateResearchProfileInputSchema = createObjectPayloadSchema<Partial<CreateResearchProfileInput>>("research profile data");
const telegramNotificationInputSchema = createObjectPayloadSchema<SaveTelegramNotificationInput>("telegram notification data");
const executionDefaultsInputSchema = createObjectPayloadSchema<ExecutionDefaultsView>("execution defaults");
const reviewDefaultsInputSchema = createObjectPayloadSchema<ReviewDefaultsView>("review defaults");
const storageSettingsInputSchema = createObjectPayloadSchema<StorageSettingsView>("storage settings");
const createTodoInputSchema = createObjectPayloadSchema<CreateCockpitTodoInput>("todo data");
const updateTodoInputSchema = createObjectPayloadSchema<UpdateCockpitTodoInput>("todo data");
const addTodoCommentInputSchema = createObjectPayloadSchema<{ body: string }>("todo comment data");
const todoFiltersInputSchema = createObjectPayloadSchema<UpdateCockpitBoardFiltersInput>("todo filter data");
const labelDefinitionInputSchema = createObjectPayloadSchema<UpsertCockpitLabelDefinitionInput>("label definition data");

const sectionDirectionSchema = z.enum(["left", "right"]);
const languageSchema = z.enum(["auto", "en", "ja", "de"]);
const logLevelSchema: z.ZodType<LogLevel> = z.enum(["none", "error", "info", "debug"]);
const templateSourceSchema = z.enum(["local", "global"]);

const webviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("duplicateTask"), taskId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("updateTask"), taskId: nonEmptyStringSchema, data: updateTaskInputSchema }).passthrough(),
  z.object({ type: z.literal("testPrompt"), prompt: z.string(), agent: optionalStringSchema, model: optionalStringSchema }).passthrough(),
  z.object({ type: z.literal("createTask"), data: createTaskInputSchema }).passthrough(),

  z.object({ type: z.literal("requestCreateJob"), folderId: optionalStringSchema }).passthrough(),
  z.object({ type: z.literal("requestCreateJobFolder"), parentFolderId: optionalStringSchema }).passthrough(),
  z.object({ type: z.literal("requestRenameJobFolder"), folderId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("requestDeleteJobFolder"), folderId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("createJob"), data: createJobInputSchema }).passthrough(),
  z.object({ type: z.literal("updateJob"), jobId: nonEmptyStringSchema, data: updateJobInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteJob"), jobId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("duplicateJob"), jobId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("toggleJobPaused"), jobId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("createJobFolder"), data: createJobFolderInputSchema }).passthrough(),
  z.object({ type: z.literal("renameJobFolder"), folderId: nonEmptyStringSchema, data: renameJobFolderInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteJobFolder"), folderId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("requestDeleteJobTask"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("requestRenameJobPause"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("requestDeleteJobPause"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("createJobPause"), jobId: nonEmptyStringSchema, data: createJobPauseInputSchema }).passthrough(),
  z.object({ type: z.literal("createJobTask"), jobId: nonEmptyStringSchema, data: createTaskInputSchema, windowMinutes: numberSchema.optional() }).passthrough(),
  z.object({ type: z.literal("attachTaskToJob"), jobId: nonEmptyStringSchema, taskId: nonEmptyStringSchema, windowMinutes: numberSchema.optional() }).passthrough(),
  z.object({ type: z.literal("detachTaskFromJob"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("deleteJobTask"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("updateJobPause"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema, data: createJobPauseInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteJobPause"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("approveJobPause"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("rejectJobPause"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("reorderJobNode"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema, targetIndex: numberSchema }).passthrough(),
  z.object({ type: z.literal("updateJobNodeWindow"), jobId: nonEmptyStringSchema, nodeId: nonEmptyStringSchema, windowMinutes: numberSchema }).passthrough(),
  z.object({ type: z.literal("compileJob"), jobId: nonEmptyStringSchema }).passthrough(),

  z.object({ type: z.literal("refreshTasks") }).passthrough(),
  z.object({ type: z.literal("restoreScheduleHistory"), snapshotId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("toggleAutoShowOnStartup") }).passthrough(),
  z.object({ type: z.literal("refreshAgents") }).passthrough(),
  z.object({ type: z.literal("refreshPrompts") }).passthrough(),
  z.object({ type: z.literal("setupMcp") }).passthrough(),
  z.object({ type: z.literal("setupCodex") }).passthrough(),
  z.object({ type: z.literal("setupCodexSkills") }).passthrough(),
  z.object({ type: z.literal("syncBundledSkills") }).passthrough(),
  z.object({ type: z.literal("syncBundledAgents") }).passthrough(),
  z.object({ type: z.literal("importStorageFromJson") }).passthrough(),
  z.object({ type: z.literal("exportStorageToJson") }).passthrough(),

  z.object({ type: z.literal("createResearchProfile"), data: createResearchProfileInputSchema }).passthrough(),
  z.object({ type: z.literal("updateResearchProfile"), researchId: nonEmptyStringSchema, data: updateResearchProfileInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteResearchProfile"), researchId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("duplicateResearchProfile"), researchId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("startResearchRun"), researchId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("stopResearchRun") }).passthrough(),

  z.object({ type: z.literal("saveTelegramNotification"), data: telegramNotificationInputSchema }).passthrough(),
  z.object({ type: z.literal("testTelegramNotification"), data: telegramNotificationInputSchema }).passthrough(),
  z.object({ type: z.literal("saveExecutionDefaults"), data: executionDefaultsInputSchema }).passthrough(),
  z.object({ type: z.literal("saveReviewDefaults"), data: reviewDefaultsInputSchema }).passthrough(),
  z.object({ type: z.literal("setStorageSettings"), data: storageSettingsInputSchema }).passthrough(),

  z.object({ type: z.literal("createTodo"), data: createTodoInputSchema }).passthrough(),
  z.object({ type: z.literal("updateTodo"), todoId: nonEmptyStringSchema, data: updateTodoInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("purgeTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("requestApproveTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("approveTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("rejectTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("requestFinalizeTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("finalizeTodo"), todoId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("archiveTodo"), todoId: nonEmptyStringSchema, archived: booleanSchema.optional() }).passthrough(),
  z.object({ type: z.literal("moveTodo"), todoId: nonEmptyStringSchema, sectionId: optionalStringSchema, targetIndex: numberSchema }).passthrough(),
  z.object({ type: z.literal("addTodoComment"), todoId: nonEmptyStringSchema, data: addTodoCommentInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteTodoComment"), todoId: nonEmptyStringSchema, commentIndex: numberSchema }).passthrough(),
  z.object({ type: z.literal("setTodoFilters"), data: todoFiltersInputSchema }).passthrough(),
  z.object({ type: z.literal("saveTodoLabelDefinition"), data: labelDefinitionInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteTodoLabelDefinition"), data: z.object({ name: nonEmptyStringSchema }).passthrough() }).passthrough(),
  z.object({ type: z.literal("saveTodoFlagDefinition"), data: labelDefinitionInputSchema }).passthrough(),
  z.object({ type: z.literal("deleteTodoFlagDefinition"), data: z.object({ name: nonEmptyStringSchema }).passthrough() }).passthrough(),
  z.object({ type: z.literal("requestTodoFileUpload"), todoId: optionalStringSchema }).passthrough(),
  z.object({ type: z.literal("linkTodoTask"), todoId: nonEmptyStringSchema, taskId: optionalStringSchema }).passthrough(),
  z.object({ type: z.literal("createTaskFromTodo"), todoId: nonEmptyStringSchema }).passthrough(),

  z.object({ type: z.literal("deleteTask"), taskId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("toggleTask"), taskId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("runTask"), taskId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("addCockpitSection"), title: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("renameCockpitSection"), sectionId: nonEmptyStringSchema, title: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("deleteCockpitSection"), sectionId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("moveCockpitSection"), sectionId: nonEmptyStringSchema, direction: sectionDirectionSchema }).passthrough(),
  z.object({ type: z.literal("reorderCockpitSection"), sectionId: nonEmptyStringSchema, targetIndex: numberSchema }).passthrough(),
  z.object({ type: z.literal("setLanguage"), language: languageSchema }).passthrough(),
  z.object({ type: z.literal("setLogLevel"), logLevel: logLevelSchema }).passthrough(),
  z.object({ type: z.literal("openLogFolder") }).passthrough(),
  z.object({ type: z.literal("copyTask"), taskId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("moveTaskToCurrentWorkspace"), taskId: nonEmptyStringSchema }).passthrough(),
  z.object({ type: z.literal("loadPromptTemplate"), path: nonEmptyStringSchema, source: templateSourceSchema }).passthrough(),
  z.object({ type: z.literal("debugWebview"), event: nonEmptyStringSchema, detail: z.unknown().optional() }).passthrough(),
  z.object({ type: z.literal("webviewReady") }).passthrough(),
  z.object({ type: z.literal("introTutorial") }).passthrough(),
  z.object({ type: z.literal("planIntegration") }).passthrough(),
  z.object({ type: z.literal("openExtensionSettings") }).passthrough(),
  z.object({ type: z.literal("openCopilotSettings") }).passthrough(),
  z.object({ type: z.literal("restoreBackup") }).passthrough(),
]);

function formatIssuePath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "message";
  }

  return path
    .map((segment) => {
      if (typeof segment === "number") {
        return `[${segment}]`;
      }

      return typeof segment === "symbol" ? `[${String(segment)}]` : segment;
    })
    .join(".");
}

function formatValidationIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${formatIssuePath(issue.path)}: ${issue.message}`)
    .join("; ");
}

export type ParsedIncomingWebviewMessageResult =
  | { success: true; message: WebviewToExtensionMessage }
  | { success: false; attemptedType?: string; error: string };

export function getIncomingWebviewMessageType(value: unknown): string | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  return typeof value.type === "string" ? value.type : undefined;
}

export function parseIncomingWebviewMessage(
  value: unknown,
): ParsedIncomingWebviewMessageResult {
  const attemptedType = getIncomingWebviewMessageType(value);
  const result = webviewToExtensionMessageSchema.safeParse(value);

  if (result.success) {
    return {
      success: true,
      message: result.data as WebviewToExtensionMessage,
    };
  }

  return {
    success: false,
    attemptedType,
    error: formatValidationIssues(result.error),
  };
}