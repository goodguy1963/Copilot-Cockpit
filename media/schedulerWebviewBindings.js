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
  if (!button || typeof button.addEventListener !== "function") {
    return;
  }
  button.addEventListener("click", action);
}

export function bindSelectChange(select, onChange) {
  if (!select) {
    return;
  }
  var handleChange = function () {
    onChange(select);
  };
  select.addEventListener("change", handleChange);
}

export function bindDocumentValueDelegates(
  document,
  eventName,
  handlersById,
) {
  var handleDelegateEvent = function (event) {
    var target = event && event.target;
    if (!target || typeof target.id !== "string") {
      return;
    }
    var handler = handlersById[target.id];
    if (typeof handler === "function") {
      handler(target);
    }
  };
  document.addEventListener(eventName, handleDelegateEvent);
}

export function bindOpenCronGuruButton(button, getExpression, windowObject) {
  var fallbackExpression = "* * * * *";
  bindClickAction(button, function () {
    var expression = getExpression().trim();
    if (!expression) {
      expression = fallbackExpression;
    }
    var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
    windowObject.open(targetUrl, "_blank");
  });
}

export function bindInlineTaskQuickUpdate(document, vscode) {
  function postInlineTaskUpdate(target, data) {
    vscode.postMessage({
      type: "updateTask",
      taskId: target.getAttribute("data-id"),
      data: data,
    });
  }

  document.addEventListener("change", function (event) {
    var target = event && event.target;
    if (!target) {
      return;
    }

    if (target.classList.contains("task-agent-select")) {
      postInlineTaskUpdate(target, { agent: target.value });
      return;
    }

    if (target.classList.contains("task-model-select")) {
      postInlineTaskUpdate(target, { model: target.value });
    }
  });
}
