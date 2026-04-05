export function bindInputFeedbackClear(elements, clearFeedback) {
  elements.forEach(function (element) {
    if (!element || typeof element.addEventListener !== "function") {
      return;
    }
    element.addEventListener("input", clearFeedback);
    element.addEventListener("change", clearFeedback);
  });
}

export function bindClickAction(button, action) {
  if (!button) {
    return;
  }
  button.addEventListener("click", action);
}

export function bindSelectChange(select, onChange) {
  if (!select) {
    return;
  }
  select.addEventListener("change", function () {
    onChange(select);
  });
}

export function bindDocumentValueDelegates(
  document,
  eventName,
  handlersById,
) {
  document.addEventListener(eventName, function (event) {
    var target = event && event.target;
    if (!target || typeof target.id !== "string") {
      return;
    }
    var handler = handlersById[target.id];
    if (typeof handler === "function") {
      handler(target);
    }
  });
}

export function bindOpenCronGuruButton(button, getExpression, windowObject) {
  bindClickAction(button, function () {
    var expression = getExpression().trim();
    if (!expression) {
      expression = "* * * * *";
    }
    var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
    windowObject.open(targetUrl, "_blank");
  });
}

export function bindInlineTaskQuickUpdate(document, vscode) {
  document.addEventListener("change", function (event) {
    var target = event && event.target;
    if (!target) return;

    if (target.classList.contains("task-agent-select")) {
      vscode.postMessage({
        type: "updateTask",
        taskId: target.getAttribute("data-id"),
        data: { agent: target.value },
      });
      return;
    }

    if (target.classList.contains("task-model-select")) {
      vscode.postMessage({
        type: "updateTask",
        taskId: target.getAttribute("data-id"),
        data: { model: target.value },
      });
    }
  });
}
