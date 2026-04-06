import { bindClickAction } from "./copilotWebviewBindings.js";

function postRefreshMessages(vscode) {
  ["refreshTasks", "refreshAgents", "refreshPrompts"].forEach(function (type) {
    vscode.postMessage({ type: type });
  });
}

function findHistoryEntry(entries, snapshotId) {
  return (Array.isArray(entries) ? entries : []).find(function (entry) {
    return entry && entry.id === snapshotId;
  });
}

export function bindTaskTestButton(button, options) {
  bindClickAction(button, function () {
    var promptTextEl = options.document.getElementById("prompt-text");
    var prompt = promptTextEl ? promptTextEl.value : "";
    var agent = options.agentSelect ? options.agentSelect.value : "";
    var model = options.modelSelect ? options.modelSelect.value : "";

    if (!prompt) {
      return;
    }

    var promptMessage = Object.assign(
      { type: "testPrompt" },
      { prompt: prompt, agent: agent, model: model },
    );
    options.vscode.postMessage(promptMessage);
  });
}

export function bindRefreshButton(button, vscode) {
  bindClickAction(button, function () {
    postRefreshMessages(vscode);
  });
}

export function bindAutoShowStartupButton(button, vscode) {
  bindClickAction(button, function () {
    vscode.postMessage({ type: "toggleAutoShowOnStartup" });
  });
}

export function bindRestoreHistoryButton(button, options) {
  bindClickAction(button, function () {
    var snapshotId = options.copilotHistorySelect
      ? options.copilotHistorySelect.value
      : "";
    if (!snapshotId) {
      options.window.alert(
        options.strings.copilotHistoryRestoreSelectRequired ||
          "Select a backup version first",
      );
      return;
    }

    var selectedEntry = findHistoryEntry(options.copilotHistory, snapshotId);
    var selectedLabel = options.formatHistoryLabel(selectedEntry);
    var confirmText = (
      options.strings.copilotHistoryRestoreConfirm ||
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
