import { bindClickAction } from "./schedulerWebviewBindings.js";

export function bindTemplateRefreshButton(button, options) {
  bindClickAction(button, function () {
    options.vscode.postMessage({ type: "refreshPrompts" });

    var selectedPath = options.templateSelect ? options.templateSelect.value : "";
    var sourceEl = options.document.querySelector(
      'input[name="prompt-source"]:checked',
    );
    var source = sourceEl ? sourceEl.value : "inline";

    if (selectedPath && (source === "local" || source === "global")) {
      options.vscode.postMessage({
        type: "loadPromptTemplate",
        path: selectedPath,
        source: source,
      });
    }
  });
}

export function bindUtilityActionButtons(vscode, buttonMap) {
  Object.keys(buttonMap).forEach(function (action) {
    bindClickAction(buttonMap[action], function () {
      vscode.postMessage({ type: action });
    });
  });
}

export function syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, value) {
  var nextValue = value || "auto";
  if (helpLanguageSelect) {
    helpLanguageSelect.value = nextValue;
  }
  if (settingsLanguageSelect) {
    settingsLanguageSelect.value = nextValue;
  }
}

export function saveLanguageSelection(
  helpLanguageSelect,
  settingsLanguageSelect,
  vscode,
  value,
) {
  var nextValue = value || "auto";
  syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, nextValue);
  vscode.postMessage({
    type: "setLanguage",
    language: nextValue,
  });
}

export function bindLanguageSelectors(
  helpLanguageSelect,
  settingsLanguageSelect,
  vscode,
  initialValue,
) {
  syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, initialValue);

  if (helpLanguageSelect) {
    helpLanguageSelect.addEventListener("change", function () {
      saveLanguageSelection(
        helpLanguageSelect,
        settingsLanguageSelect,
        vscode,
        helpLanguageSelect.value,
      );
    });
  }

  if (settingsLanguageSelect) {
    settingsLanguageSelect.addEventListener("change", function () {
      saveLanguageSelection(
        helpLanguageSelect,
        settingsLanguageSelect,
        vscode,
        settingsLanguageSelect.value,
      );
    });
  }
}
