export function createSchedulerWebviewTransientState(
  createEmptyTodoDraft,
  localStorage,
  helpWarpSeenKey,
) {
  return {
    currentTodoLabels: [],
    currentTodoDraft: createEmptyTodoDraft(),
    selectedTodoLabelName: "",
    currentTodoFlag: "",
    pendingTodoFilters: null,
    pendingDeleteLabelName: "",
    pendingDeleteFlagName: "",
    pendingTodoDeleteId: "",
    pendingBoardDeleteTodoId: "",
    pendingBoardDeletePermanentOnly: false,
    todoDeleteModalRoot: null,
    todoCommentModalRoot: null,
    pendingAgentValue: "",
    pendingModelValue: "",
    pendingTemplatePath: "",
    editingTaskEnabled: true,
    pendingSubmit: false,
    helpWarpIntroPending: readHelpWarpIntroPending(localStorage, helpWarpSeenKey),
    helpWarpFadeTimeout: 0,
    helpWarpCleanupTimeout: 0,
    isCreatingJob: false,
    todoEditorListenersBound: false,
  };
}

function readHelpWarpIntroPending(localStorage, helpWarpSeenKey) {
  try {
    return localStorage.getItem(helpWarpSeenKey) !== "1";
  } catch (_error) {
    return true;
  }
}
