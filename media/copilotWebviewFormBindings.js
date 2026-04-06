export function bindPromptSourceDelegation(document, applyPromptSource) {
  document.addEventListener("change", function (event) {
    var target = event && event.target;
    var isPromptSourceRadio =
      target && target.name === "prompt-source" && target.checked;
    if (isPromptSourceRadio) {
      applyPromptSource(String(target.value || ""));
    }
  });
}

export function bindCronPresetPair(
  presetControl,
  valueControl,
  onSynchronized,
) {
  if (!presetControl || !valueControl) {
    return;
  }

  presetControl.addEventListener("change", function () {
    var nextPresetValue = presetControl.value;
    if (nextPresetValue) {
      valueControl.value = nextPresetValue;
    }
    onSynchronized();
  });

  valueControl.addEventListener("input", function () {
    presetControl.value = "";
    onSynchronized();
  });
}

export function bindTemplateSelectionLoader(templateSelect, document, vscode) {
  if (!templateSelect) {
    return;
  }

  templateSelect.addEventListener("change", function () {
    var selectedPath = templateSelect.value;
    if (!selectedPath) {
      return;
    }

    var promptSourceControl = document.querySelector(
      'input[name="prompt-source"]:checked',
    );
    var templateMessage = {
      type: "loadPromptTemplate",
      path: selectedPath,
      source: promptSourceControl ? promptSourceControl.value : "inline",
    };
    vscode.postMessage(templateMessage);
  });
}
