function showFormError(formErrorElement, message) {
  if (!formErrorElement) {
    return false;
  }
  formErrorElement.textContent = message;
  formErrorElement.style.display = "block";
  return true;
}

function getTrimmedValue(value) {
  return String(value || "").trim();
}

export function validateTaskSubmission(options) {
  var taskData = options.taskData;
  var promptSourceValue = options.promptSourceValue;
  var formErr = options.formErr;
  var strings = options.strings;
  var editingTaskId = options.editingTaskId;
  var getTaskByIdLocal = options.getTaskByIdLocal;

  var nameValue = getTrimmedValue(taskData.name);
  if (!nameValue) {
    showFormError(formErr, strings.taskNameRequired || "");
    return false;
  }

  var templateValue = getTrimmedValue(taskData.promptPath);
  if (promptSourceValue !== "inline" && !templateValue) {
    showFormError(formErr, strings.templateRequired || "");
    return false;
  }

  var promptValue = getTrimmedValue(taskData.prompt);
  if (promptSourceValue !== "inline" && !promptValue && editingTaskId) {
    var editingTask = getTaskByIdLocal(editingTaskId);
    taskData.prompt =
      editingTask && typeof editingTask.prompt === "string"
        ? editingTask.prompt
        : "";
    promptValue = getTrimmedValue(taskData.prompt);
  }

  if (promptSourceValue === "inline" && !promptValue) {
    showFormError(formErr, strings.promptRequired || "");
    return false;
  }

  var cronValue = getTrimmedValue(taskData.cronExpression);
  if (!cronValue) {
    showFormError(
      formErr,
      strings.cronExpressionRequired || strings.invalidCronExpression || "",
    );
    return false;
  }

  return true;
}

export function postTaskSubmission(vscode, editingTaskId, taskData) {
  var isEditing = Boolean(editingTaskId);
  var message = isEditing
    ? {
        type: "updateTask",
        taskId: String(editingTaskId),
        data: taskData,
      }
    : {
        type: "createTask",
        data: taskData,
      };

  vscode.postMessage(message);
  if (isEditing) {
    return;
  }
}

export function buildTaskSubmissionData(options) {
  var editorState = options.editorState || {};
  var parsedLabels = options.parseLabels
    ? options.parseLabels(editorState.labels || "")
    : [];

  return {
    name: editorState.name || "",
    prompt: editorState.prompt || "",
    cronExpression: editorState.cronExpression || "",
    labels: parsedLabels,
    agent: editorState.agent || "",
    model: editorState.model || "",
    scope: editorState.scope || "workspace",
    promptSource: editorState.promptSource || "inline",
    promptPath: editorState.promptPath || "",
    runFirstInOneMinute: !!options.runFirstInOneMinute,
    oneTime: !!editorState.oneTime,
    manualSession: !!editorState.manualSession,
    jitterSeconds: Number(editorState.jitterSeconds || 0),
    enabled: options.editingTaskId ? options.editingTaskEnabled : true,
    chatSession: editorState.oneTime ? "" : editorState.chatSession || "new",
  };
}
