function showFormError(formErrorElement, message) {
  if (!formErrorElement) {
    return false;
  }
  formErrorElement.textContent = message;
  formErrorElement.style.display = "block";
  return true;
}

export function validateTaskSubmission(options) {
  var taskData = options.taskData;
  var promptSourceValue = options.promptSourceValue;
  var formErr = options.formErr;
  var strings = options.strings;
  var editingTaskId = options.editingTaskId;
  var getTaskByIdLocal = options.getTaskByIdLocal;

  var nameValue = (taskData.name || "").trim();
  if (!nameValue) {
    showFormError(formErr, strings.taskNameRequired || "");
    return false;
  }

  var templateValue = (taskData.promptPath || "").trim();
  if (promptSourceValue !== "inline" && !templateValue) {
    showFormError(formErr, strings.templateRequired || "");
    return false;
  }

  var promptValue = (taskData.prompt || "").trim();
  if (promptSourceValue !== "inline" && !promptValue && editingTaskId) {
    var editingTask = getTaskByIdLocal(editingTaskId);
    taskData.prompt =
      editingTask && typeof editingTask.prompt === "string"
        ? editingTask.prompt
        : "";
    promptValue = (taskData.prompt || "").trim();
  }

  if (promptSourceValue === "inline" && !promptValue) {
    showFormError(formErr, strings.promptRequired || "");
    return false;
  }

  var cronValue = (taskData.cronExpression || "").trim();
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
  if (editingTaskId) {
    vscode.postMessage({
      type: "updateTask",
      taskId: editingTaskId,
      data: taskData,
    });
    return;
  }

  vscode.postMessage({
    type: "createTask",
    data: taskData,
  });
}

export function buildTaskSubmissionData(options) {
  var editorState = options.editorState || {};
  var labels = options.parseLabels
    ? options.parseLabels(editorState.labels || "")
    : [];

  return {
    name: editorState.name || "",
    prompt: editorState.prompt || "",
    cronExpression: editorState.cronExpression || "",
    labels: labels,
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
