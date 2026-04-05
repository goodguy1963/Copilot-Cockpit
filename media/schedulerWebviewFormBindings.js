export function bindPromptSourceDelegation(document, applyPromptSource) {
  document.addEventListener("change", function (event) {
    var target = event && event.target;
    if (target && target.name === "prompt-source" && target.checked) {
      applyPromptSource(target.value);
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
    if (presetControl.value) {
      valueControl.value = presetControl.value;
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

    var sourceEl = document.querySelector(
      'input[name="prompt-source"]:checked',
    );
    vscode.postMessage({
      type: "loadPromptTemplate",
      path: selectedPath,
      source: sourceEl ? sourceEl.value : "inline",
    });
  });
}
