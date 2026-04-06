export function selectHasOptionValue(selectEl, value) {
  if (!selectEl) return false;
  if (!value) return false;
  var optionCollection = selectEl.options;
  if (!optionCollection || typeof optionCollection.length !== "number") return false;
  for (var index = 0; index < optionCollection.length; index++) {
    var currentOption = optionCollection[index];
    if (currentOption && currentOption.value === value) return true;
  }
  return false;
}

export function populateAgentDropdown(params) {
  var agentSelect = params.agentSelect;
  if (!agentSelect) return;
  var items = Array.isArray(params.agents) ? params.agents : [];
  var escapeAttr = params.escapeAttr;
  var escapeHtml = params.escapeHtml;
  var strings = params.strings || {};
  var executionDefaults = params.executionDefaults || {};

  if (items.length === 0) {
    var noText = strings.placeholderNoAgents || "";
    agentSelect.innerHTML = '<option value="">' + escapeHtml(noText) + "</option>";
    return;
  }

  var selectText = strings.placeholderSelectAgent || "";
  var placeholder = '<option value="">' + escapeHtml(selectText) + "</option>";
  agentSelect.innerHTML = placeholder + items.map(function (agent) {
    return '<option value="' + escapeAttr(agent.id) + '">' + escapeHtml(agent.name) + "</option>";
  }).join("");

  if (!agentSelect.value) {
    var defaultAgentId = executionDefaults && typeof executionDefaults.agent === "string"
      ? executionDefaults.agent
      : "agent";
    var hasDefaultAgent = items.find(function (agent) {
      return agent.id === defaultAgentId;
    });
    if (hasDefaultAgent) {
      agentSelect.value = defaultAgentId;
    }
  }
}

export function populateModelDropdown(params) {
  var modelSelect = params.modelSelect;
  if (!modelSelect) return;
  var items = Array.isArray(params.models) ? params.models : [];
  var escapeAttr = params.escapeAttr;
  var escapeHtml = params.escapeHtml;
  var strings = params.strings || {};
  var executionDefaults = params.executionDefaults || {};
  var formatModelLabel = params.formatModelLabel;

  if (items.length === 0) {
    var noText = strings.placeholderNoModels || "";
    modelSelect.innerHTML = '<option value="">' + escapeHtml(noText) + "</option>";
    return;
  }

  var selectText = strings.placeholderSelectModel || "";
  var placeholder = '<option value="">' + escapeHtml(selectText) + "</option>";
  modelSelect.innerHTML = placeholder + items.map(function (model) {
    return '<option value="' + escapeAttr(model.id) + '">' + escapeHtml(formatModelLabel(model)) + "</option>";
  }).join("");

  if (!modelSelect.value) {
    var defaultModelId = executionDefaults && typeof executionDefaults.model === "string"
      ? executionDefaults.model
      : "";
    var hasDefaultModel = items.find(function (model) {
      return model.id === defaultModelId;
    });
    if (hasDefaultModel) {
      modelSelect.value = defaultModelId;
    }
  }
}
