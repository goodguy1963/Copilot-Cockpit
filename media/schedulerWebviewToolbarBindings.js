import { bindClickAction } from "./schedulerWebviewBindings.js";

export function bindTaskTestButton(button, options) {
  bindClickAction(button, function () {
    var promptTextEl = options.document.getElementById("prompt-text");
    var prompt = promptTextEl ? promptTextEl.value : "";
    var agent = options.agentSelect ? options.agentSelect.value : "";
    var model = options.modelSelect ? options.modelSelect.value : "";

    if (!prompt) {
      return;
    }

    options.vscode.postMessage({
      type: "testPrompt",
      prompt: prompt,
      agent: agent,
      model: model,
    });
  });
}

export function bindRefreshButton(button, vscode) {
  bindClickAction(button, function () {
    vscode.postMessage({ type: "refreshTasks" });
    vscode.postMessage({ type: "refreshAgents" });
    vscode.postMessage({ type: "refreshPrompts" });
  });
}

export function bindAutoShowStartupButton(button, vscode) {
  bindClickAction(button, function () {
    vscode.postMessage({ type: "toggleAutoShowOnStartup" });
  });
}

export function bindRestoreHistoryButton(button, options) {
  bindClickAction(button, function () {
    var snapshotId = options.scheduleHistorySelect
      ? options.scheduleHistorySelect.value
      : "";
    if (!snapshotId) {
      options.window.alert(
        options.strings.scheduleHistoryRestoreSelectRequired ||
          "Select a backup version first",
      );
      return;
    }

    var selectedEntry = (Array.isArray(options.scheduleHistory)
      ? options.scheduleHistory
      : []).find(function (entry) {
      return entry && entry.id === snapshotId;
    });
    var selectedLabel = options.formatHistoryLabel(selectedEntry);
    var confirmText = (
      options.strings.scheduleHistoryRestoreConfirm ||
      "Restore the repo schedule from {createdAt}? The current state will be backed up first."
    )
      .replace("{createdAt}", selectedLabel)
      .replace("{timestamp}", selectedLabel);

    if (!options.window.confirm(confirmText)) {
      return;
    }

    options.vscode.postMessage({
      type: "restoreScheduleHistory",
      snapshotId: snapshotId,
    });
  });
}
