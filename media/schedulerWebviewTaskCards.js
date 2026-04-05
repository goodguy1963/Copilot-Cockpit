function buildTaskInlineSelect(params) {
  var items = Array.isArray(params.items) ? params.items : [];
  var selectedId = params.selectedId || "";
  var fallbackSelectedId = params.fallbackSelectedId || "";
  var effectiveSelectedId = selectedId || fallbackSelectedId;
  var hasSelectedOption = !selectedId;
  var options =
    '<option value="">' + params.escapeHtml(params.placeholder || "") + "</option>";

  items.forEach(function (item) {
    var id = item && (item.id || item.slug);
    if (!id) {
      return;
    }

    var label = params.getLabel(item, id);
    if (id === selectedId) {
      hasSelectedOption = true;
    }

    options +=
      '<option value="' +
      params.escapeAttr(id) +
      '"' +
      (id === effectiveSelectedId ? " selected" : "") +
      ">" +
      params.escapeHtml(label) +
      "</option>";
  });

  if (selectedId && !hasSelectedOption) {
    options +=
      '<option value="' +
      params.escapeAttr(selectedId) +
      '" selected>' +
      params.escapeHtml(selectedId) +
      "</option>";
  }

  return (
    '<select class="' +
    params.className +
    '" data-id="' +
    params.taskId +
    '" style="width: auto; max-width: 140px; display: inline-block; padding: 2px 4px; margin-right: 8px; height: 26px; font-size: 11px;">' +
    options +
    "</select>"
  );
}

export function buildTaskConfigRowMarkup(params) {
  var agentSelect = buildTaskInlineSelect({
    items: params.agents,
    selectedId: params.task && params.task.agent,
    className: "task-agent-select",
    placeholder: params.strings.placeholderSelectAgent || "Agent",
    fallbackSelectedId: params.executionDefaults && params.executionDefaults.agent,
    taskId: params.taskId,
    escapeAttr: params.escapeAttr,
    escapeHtml: params.escapeHtml,
    getLabel: function (item, id) {
      return (item && item.name) || id;
    },
  });

  var modelSelect = buildTaskInlineSelect({
    items: params.models,
    selectedId: params.task && params.task.model,
    className: "task-model-select",
    placeholder: params.strings.placeholderSelectModel || "Model",
    fallbackSelectedId: params.executionDefaults && params.executionDefaults.model,
    taskId: params.taskId,
    escapeAttr: params.escapeAttr,
    escapeHtml: params.escapeHtml,
    getLabel: function (item, id) {
      return params.formatModelLabel(item || { id: id, name: id });
    },
  });

  return (
    '<div class="task-config" style="margin: 4px 0 8px 0; display: flex; align-items: center;">' +
    agentSelect +
    modelSelect +
    "</div>"
  );
}

export function buildBaseTaskActionsMarkup(params) {
  var createActionButton = function (button) {
    return (
      '<button class="' +
      button.className +
      '" data-action="' +
      button.action +
      '" data-id="' +
      params.taskId +
      '" title="' +
      params.escapeAttr(button.title) +
      '">' +
      button.icon +
      "</button>"
    );
  };

  return [
    {
      className: "btn-secondary btn-icon",
      action: "toggle",
      title: params.toggleTitle,
      icon: params.toggleIcon,
    },
    {
      className: "btn-secondary btn-icon",
      action: "run",
      title: params.strings.actionRun,
      icon: "🚀",
    },
    {
      className: "btn-secondary btn-icon",
      action: "edit",
      title: params.strings.actionEdit,
      icon: "✏️",
    },
    {
      className: "btn-secondary btn-icon",
      action: "copy",
      title: params.strings.actionCopyPrompt,
      icon: "📋",
    },
    {
      className: "btn-secondary btn-icon",
      action: "duplicate",
      title: params.strings.actionDuplicate,
      icon: "📄",
    },
  ]
    .map(createActionButton)
    .join("");
}
