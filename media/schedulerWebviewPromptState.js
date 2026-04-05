export function restorePendingSelectValue(selectEl, desiredValue) {
  var pendingValue = desiredValue || "";
  if (!selectEl || !pendingValue) {
    return pendingValue;
  }

  selectEl.value = pendingValue;
  return selectEl.value === pendingValue ? "" : pendingValue;
}

function buildPromptTemplatePlaceholder(escapeHtml, placeholderText) {
  return '<option value="">' + escapeHtml(placeholderText) + "</option>";
}

function buildPromptTemplateMarkup(templates, escapeAttr, escapeHtml) {
  return templates
    .map(function (template) {
      return (
        '<option value="' +
        escapeAttr(template.path) +
        '">' +
        escapeHtml(template.name) +
        "</option>"
      );
    })
    .join("");
}

export function updatePromptTemplateOptions(params) {
  var templateSelect = params.templateSelect;
  if (!templateSelect) {
    return;
  }

  var selectedPath = params.selectedPath || "";
  var promptTemplates = Array.isArray(params.promptTemplates)
    ? params.promptTemplates
    : [];
  var currentSource = params.source || "inline";
  var placeholderText =
    (params.strings && params.strings.placeholderSelectTemplate) || "";
  var escapeHtml = params.escapeHtml;
  var escapeAttr = params.escapeAttr;
  var placeholder = buildPromptTemplatePlaceholder(escapeHtml, placeholderText);
  var filteredTemplates = promptTemplates.filter(function (template) {
    return template && template.source === currentSource;
  });

  var optionMarkup =
    placeholder +
    buildPromptTemplateMarkup(filteredTemplates, escapeAttr, escapeHtml);
  templateSelect.innerHTML = optionMarkup;

  if (!selectedPath) {
    var emptyValue = "";
    templateSelect.value = emptyValue;
    return;
  }

  var nextTemplateValue = selectedPath;
  templateSelect.value = nextTemplateValue;
  if (templateSelect.value !== nextTemplateValue) {
    templateSelect.value = "";
  }
}

export function applyPromptSourceUi(params) {
  var effectiveSource = params.source || "inline";
  var templateSelect = params.templateSelect;
  var promptTextEl = params.promptTextEl;
  var templateSelectGroup = params.templateSelectGroup;
  var promptGroup = params.promptGroup;
  var keepSelection = params.keepSelection === true;
  var selectedPath =
    keepSelection && templateSelect ? templateSelect.value : "";
  var usesInlinePrompt = effectiveSource === "inline";

  if (promptTextEl) {
    promptTextEl.required = usesInlinePrompt;
  }
  if (templateSelect) {
    templateSelect.required = !usesInlinePrompt;
  }

  if (templateSelectGroup) {
    templateSelectGroup.style.display = usesInlinePrompt ? "none" : "block";
  } else if (
    !usesInlinePrompt &&
    typeof params.warnMissingTemplateGroup === "function"
  ) {
    params.warnMissingTemplateGroup();
  }

  if (promptGroup) {
    promptGroup.style.display = "block";
  }

  if (usesInlinePrompt) {
    var shouldClearSelection = !keepSelection && templateSelect;
    if (shouldClearSelection) {
      templateSelect.value = "";
    }
    return;
  }

  updatePromptTemplateOptions({
    templateSelect: templateSelect,
    promptTemplates: params.promptTemplates,
    source: effectiveSource,
    selectedPath: selectedPath,
    strings: params.strings,
    escapeHtml: params.escapeHtml,
    escapeAttr: params.escapeAttr,
  });
}

export function syncPromptTemplatesFromMessage(params) {
  var templateSelect = params.templateSelect;
  var currentTemplateValue =
    params.pendingTemplatePath || (templateSelect ? templateSelect.value : "");

  updatePromptTemplateOptions({
    templateSelect: templateSelect,
    promptTemplates: params.promptTemplates,
    source: params.currentSource,
    selectedPath: currentTemplateValue,
    strings: params.strings,
    escapeHtml: params.escapeHtml,
    escapeAttr: params.escapeAttr,
  });

  var nextPendingTemplatePath = restorePendingSelectValue(
    templateSelect,
    currentTemplateValue,
  );

  if (params.templateSelectGroup) {
    params.templateSelectGroup.style.display =
      params.currentSource === "local" || params.currentSource === "global"
        ? "block"
        : "none";
  }

  return nextPendingTemplatePath;
}
