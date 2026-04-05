export function createWebviewDebugTools(options) {
  var currentLogLevel = options && typeof options.initialLogLevel === "string"
    ? options.initialLogLevel
    : "info";

  function shouldEmitDetailedLogs() {
    return currentLogLevel === "debug";
  }

  function cloneDebugDetail(detail) {
    if (typeof detail === "undefined") {
      return {};
    }
    try {
      return JSON.parse(JSON.stringify(detail));
    } catch (_error) {
      return { value: String(detail) };
    }
  }

  function emitWebviewDebug(eventName, detail) {
    if (!shouldEmitDetailedLogs()) {
      return;
    }
    var payload = {
      event: eventName,
      detail: cloneDebugDetail(detail),
    };
    try {
      if (options && options.console && typeof options.console.log === "function") {
        options.console.log("[SchedulerWebviewDebug]", payload);
      }
    } catch (_error) {
      // ignore console failures in constrained webviews
    }
    try {
      if (options && options.vscode && typeof options.vscode.postMessage === "function") {
        options.vscode.postMessage({
          type: "debugWebview",
          event: eventName,
          detail: payload.detail,
        });
      }
    } catch (_error) {
      // ignore host logging failures
    }
  }

  function createEmptyTodoDraft() {
    return {
      comment: "",
      title: "",
      description: "",
      dueAt: "",
      flagColor: "#f59e0b",
      flagInput: "",
      priority: "none",
      flag: "",
      labelColor: "#4f8cff",
      labelInput: "",
      sectionId: "",
      taskId: "",
    };
  }

  function resetTodoDraft(reason) {
    var nextDraft = createEmptyTodoDraft();
    emitWebviewDebug("todoDraftReset", { reason: reason || "unknown" });
    return nextDraft;
  }

  function syncTodoDraftFromInputs(params) {
    if (!params || params.selectedTodoId) {
      return params ? params.currentTodoDraft : createEmptyTodoDraft();
    }
    var nextDraft = params.currentTodoDraft || createEmptyTodoDraft();
    nextDraft.comment = params.todoCommentInput ? String(params.todoCommentInput.value || "") : "";
    nextDraft.title = params.todoTitleInput ? String(params.todoTitleInput.value || "") : "";
    nextDraft.description = params.todoDescriptionInput ? String(params.todoDescriptionInput.value || "") : "";
    nextDraft.dueAt = params.todoDueInput ? String(params.todoDueInput.value || "") : "";
    nextDraft.priority = params.todoPriorityInput ? String(params.todoPriorityInput.value || "none") : "none";
    nextDraft.sectionId = params.todoSectionInput ? String(params.todoSectionInput.value || "") : "";
    nextDraft.taskId = params.todoLinkedTaskSelect ? String(params.todoLinkedTaskSelect.value || "") : "";
    if (params.reason) {
      emitWebviewDebug("todoDraftSync", {
        reason: params.reason,
        hasComment: nextDraft.comment.length > 0,
        titleLength: nextDraft.title.length,
        hasDescription: nextDraft.description.length > 0,
        hasDueAt: !!nextDraft.dueAt,
        sectionId: nextDraft.sectionId,
        taskId: nextDraft.taskId,
      });
    }
    return nextDraft;
  }

  function setLogLevel(nextLevel) {
    currentLogLevel = typeof nextLevel === "string" && nextLevel ? nextLevel : "info";
  }

  function getLogLevel() {
    return currentLogLevel;
  }

  return {
    createEmptyTodoDraft: createEmptyTodoDraft,
    emitWebviewDebug: emitWebviewDebug,
    getLogLevel: getLogLevel,
    resetTodoDraft: resetTodoDraft,
    setLogLevel: setLogLevel,
    syncTodoDraftFromInputs: syncTodoDraftFromInputs,
  };
}