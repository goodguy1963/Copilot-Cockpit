import { bindClickAction } from "./cockpitWebviewBindings.js";

function resolveLanguageValue(value) {
  return value || "auto";
}

function postUtilityAction(vscode, type) {
  vscode.postMessage({ type: type });
}

export function bindTemplateRefreshButton(button, options) {
  bindClickAction(button, function () {
    postUtilityAction(options.vscode, "refreshPrompts");

    var selectedPath = options.templateSelect ? options.templateSelect.value : "";
    var promptSourceControl = options.document.querySelector(
      'input[name="prompt-source"]:checked',
    );
    var source = promptSourceControl ? promptSourceControl.value : "inline";

    if (selectedPath && (source === "local" || source === "global")) {
      var templateMessage = Object.assign(
        { type: "loadPromptTemplate" },
        { path: selectedPath, source: source },
      );
      options.vscode.postMessage(templateMessage);
    }
  });
}

export function bindUtilityActionButtons(vscode, buttonMap) {
  Object.keys(buttonMap).forEach(function (action) {
    bindClickAction(buttonMap[action], function () {
      postUtilityAction(vscode, action);
    });
  });
}

export function syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, value) {
  var nextValue = resolveLanguageValue(value);
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
  var nextValue = resolveLanguageValue(value);
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
