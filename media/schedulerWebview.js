(function () {
  var vscode = null;
  var strings = {};

  // Initial data (JSON from inline script tag)
  var initialData = {};
  try {
    var initialScript = document.getElementById("initial-data");
    if (initialScript && initialScript.textContent) {
      initialData = JSON.parse(initialScript.textContent) || {};
    }
  } catch (e) {
    initialData = {};
  }

  strings = initialData.strings || {};

  function basenameAny(p) {
    if (!p) return "";
    var s = String(p);
    var i1 = s.lastIndexOf("\\");
    var i2 = s.lastIndexOf("/");
    var i = i1 > i2 ? i1 : i2;
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function basenameFromPathLike(p) {
    if (!p) return "";
    var s = String(p);
    if (/^file:\/\/\/?/i.test(s)) {
      try {
        var u = new URL(s);
        if (u.protocol === "file:") {
          s = decodeURIComponent(u.pathname || "");
          s = s.replace(/^\/([A-Za-z]:[\\/])/, "$1");
        } else {
          s = s.replace(/^file:\/\/\/?/i, "");
        }
      } catch (_e) {
        s = s.replace(/^file:\/\/\/?/i, "");
      }
    }
    return basenameAny(s);
  }

  function getModelSourceLabel(model) {
    var id = model && model.id ? String(model.id).trim() : "";
    var name = model && model.name ? String(model.name).trim() : "";
    var vendor = model && model.vendor ? String(model.vendor).trim() : "";
    var description = model && model.description ? String(model.description).trim() : "";
    var normalized = (id + " " + name + " " + vendor + " " + description).toLowerCase();

    if (normalized.indexOf("openrouter") >= 0) {
      return "OpenRouter";
    }

    if (
      normalized.indexOf("copilot") >= 0 ||
      normalized.indexOf("codex") >= 0 ||
      normalized.indexOf("github") >= 0 ||
      normalized.indexOf("microsoft") >= 0
    ) {
      return "Copilot";
    }

    return vendor;
  }

  function formatModelLabel(model) {
    var name = model && (model.name || model.id) ? String(model.name || model.id).trim() : "";
    var source = getModelSourceLabel(model);
    if (!source || source.toLowerCase() === name.toLowerCase()) {
      return name;
    }
    return name + " • " + source;
  }

  function formatCountdown(totalSec) {
    var remaining = Math.max(0, Math.floor(totalSec));
    var units = [
      { label: "y", seconds: 365 * 24 * 60 * 60 },
      { label: "mo", seconds: 30 * 24 * 60 * 60 },
      { label: "w", seconds: 7 * 24 * 60 * 60 },
      { label: "d", seconds: 24 * 60 * 60 },
      { label: "h", seconds: 60 * 60 },
      { label: "m", seconds: 60 },
      { label: "s", seconds: 1 },
    ];
    var parts = [];

    for (var i = 0; i < units.length; i += 1) {
      var unit = units[i];
      var value = Math.floor(remaining / unit.seconds);
      if (value <= 0) {
        continue;
      }
      parts.push(String(value) + unit.label);
      remaining -= value * unit.seconds;
    }

    if (parts.length === 0) {
      return "0s";
    }

    return parts.join(" ");
  }

  function sanitizeAbsolutePaths(text) {
    if (!text) return "";
    var s = String(text);
    return (
      s
        // Quoted file URIs (may include spaces)
        .replace(/'(file:\/\/[^']+)'/gi, function (_m, p1) {
          return "'" + basenameFromPathLike(p1) + "'";
        })
        .replace(/"(file:\/\/[^"]+)"/gi, function (_m, p1) {
          return '"' + basenameFromPathLike(p1) + '"';
        })
        // Unquoted file URIs (no spaces)
        .replace(/file:\/\/[^\s"'`]+/gi, function (m) {
          return basenameFromPathLike(m);
        })
        // Quoted Windows absolute paths / UNC (may include spaces)
        .replace(/'((?:[A-Za-z]:(?:\\|\/)|\\\\)[^']+)'/g, function (_m, p1) {
          return "'" + basenameFromPathLike(p1) + "'";
        })
        .replace(/"((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"]+)"/g, function (_m, p1) {
          return '"' + basenameFromPathLike(p1) + '"';
        })
        // Unquoted Windows absolute paths / UNC (no spaces)
        .replace(
          /(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g,
          function (_m, prefix, p1) {
            return String(prefix) + basenameFromPathLike(p1);
          },
        )
        // Quoted POSIX absolute paths (may include spaces)
        .replace(/'(\/[^']+)'/g, function (_m, p1) {
          return "'" + basenameFromPathLike(p1) + "'";
        })
        .replace(/"(\/[^\"]+)"/g, function (_m, p1) {
          return '"' + basenameFromPathLike(p1) + '"';
        })
        // Unquoted POSIX absolute paths (no spaces) — only when preceded by start/whitespace/(
        .replace(/(^|[\s(])(\/[^\s"'`]+)/g, function (_m, prefix, p1) {
          return String(prefix) + basenameFromPathLike(p1);
        })
    );
  }

  // Global error handler for debugging (kept minimal to avoid breaking the UI)
  window.onerror = function (msg, url, line, col, error) {
    var errDiv = document.getElementById("form-error");
    if (!errDiv) return;
    var prefix = strings.webviewScriptErrorPrefix || "";
    var linePrefix = strings.webviewLinePrefix || "";
    var lineSuffix = strings.webviewLineSuffix || "";
    errDiv.textContent =
      prefix +
      sanitizeAbsolutePaths(String(msg)) +
      linePrefix +
      String(line) +
      lineSuffix;
    errDiv.style.display = "block";
  };

  window.onunhandledrejection = function (ev) {
    var errDiv = document.getElementById("form-error");
    if (!errDiv) return;
    var prefix = strings.webviewUnhandledErrorPrefix || "";
    var unknown = strings.webviewUnknown || "";
    var reason = ev && ev.reason ? ev.reason : null;
    var raw = unknown;
    if (reason) {
      if (typeof reason === "string") {
        raw = reason;
      } else if (typeof reason === "object" && reason.message) {
        raw = String(reason.message);
      } else {
        raw = String(reason);
      }
    }
    // Avoid showing multi-line stack traces in UI; keep only the first line.
    raw = String(raw).split(/\r?\n/)[0];
    errDiv.textContent = prefix + sanitizeAbsolutePaths(raw);
    errDiv.style.display = "block";
  };

  if (typeof acquireVsCodeApi === "function") {
    vscode = acquireVsCodeApi();
  } else {
    // Keep UI usable even if VS Code API is unavailable
    vscode = { postMessage: function () { } };
    var errDiv = document.getElementById("form-error");
    if (errDiv) {
      errDiv.textContent = strings.webviewApiUnavailable || "";
      errDiv.style.display = "block";
    }
  }

  var tasks = Array.isArray(initialData.tasks) ? initialData.tasks : [];
  var jobs = Array.isArray(initialData.jobs) ? initialData.jobs : [];
  var jobFolders = Array.isArray(initialData.jobFolders)
    ? initialData.jobFolders
    : [];
  var cockpitBoard = initialData.cockpitBoard || {
    version: 2,
    sections: [],
    cards: [],
    labelCatalog: [],
    archives: { completedSuccessfully: [], rejected: [] },
    filters: {
      labels: [],
      priorities: [],
      statuses: [],
      archiveOutcomes: [],
      flags: [],
      sortBy: "manual",
      sortDirection: "asc",
      showArchived: false,
    },
    updatedAt: "",
  };
  var telegramNotification = initialData.telegramNotification || {
    enabled: false,
    hasBotToken: false,
    hookConfigured: false,
  };
  var executionDefaults = initialData.executionDefaults || {
    agent: "agent",
    model: "",
  };
  var researchProfiles = Array.isArray(initialData.researchProfiles)
    ? initialData.researchProfiles
    : [];
  var activeResearchRun = initialData.activeResearchRun || null;
  var recentResearchRuns = Array.isArray(initialData.recentResearchRuns)
    ? initialData.recentResearchRuns
    : [];
  var agents = Array.isArray(initialData.agents) ? initialData.agents : [];
  var models = Array.isArray(initialData.models) ? initialData.models : [];
  var promptTemplates = Array.isArray(initialData.promptTemplates)
    ? initialData.promptTemplates
    : [];
  var skills = Array.isArray(initialData.skills) ? initialData.skills : [];
  var scheduleHistory = Array.isArray(initialData.scheduleHistory)
    ? initialData.scheduleHistory
    : [];
  var defaultChatSession =
    initialData.defaultChatSession === "continue" ? "continue" : "new";
  var autoShowOnStartup = !!initialData.autoShowOnStartup;
  var workspacePaths = Array.isArray(initialData.workspacePaths)
    ? initialData.workspacePaths
    : [];
  var caseInsensitivePaths = !!initialData.caseInsensitivePaths;
  var editingTaskId = null;
  var selectedTodoId = null;
  var draggingTodoId = null;
  var currentTodoLabels = [];
  var selectedTodoLabelName = "";
  var pendingAgentValue = "";
  var pendingModelValue = "";
  var pendingTemplatePath = "";
  var editingTaskEnabled = true;
  var pendingSubmit = false;

  var defaultJitterSeconds = (function () {
    var raw = initialData.defaultJitterSeconds;
    var n = typeof raw === "number" ? raw : Number(raw);
    if (!isFinite(n)) return 600;
    var i = Math.floor(n);
    if (i < 0) return 0;
    if (i > 1800) return 1800;
    return i;
  })();
  var locale =
    typeof initialData.locale === "string" && initialData.locale
      ? initialData.locale
      : undefined;
  var lastRenderedTasksHtml = "";

  // DOM elements - with null safety
  var taskForm = document.getElementById("task-form");
  var taskList = document.getElementById("task-list");
  var editTaskIdInput = document.getElementById("edit-task-id");
  var submitBtn = document.getElementById("submit-btn");
  var testBtn = document.getElementById("test-btn");
  var refreshBtn = document.getElementById("refresh-btn");
  var autoShowStartupBtn = document.getElementById("auto-show-startup-btn");
  var scheduleHistorySelect = document.getElementById("schedule-history-select");
  var restoreHistoryBtn = document.getElementById("restore-history-btn");
  var autoShowStartupNote = document.getElementById("auto-show-startup-note");
  var friendlyBuilder = document.getElementById("friendly-builder");
  var cronPreset = document.getElementById("cron-preset");
  var cronExpression = document.getElementById("cron-expression");
  var agentSelect = document.getElementById("agent-select");
  var modelSelect = document.getElementById("model-select");
  var chatSessionGroup = document.getElementById("chat-session-group");
  var chatSessionSelect = document.getElementById("chat-session");
  var templateSelect = document.getElementById("template-select");
  var templateSelectGroup = document.getElementById("template-select-group");
  var templateRefreshBtn = document.getElementById("template-refresh-btn");
  var skillSelect = document.getElementById("skill-select");
  var insertSkillBtn = document.getElementById("insert-skill-btn");
  var setupMcpBtn = document.getElementById("setup-mcp-btn");
  var promptGroup = document.getElementById("prompt-group");
  var jitterSecondsInput = document.getElementById("jitter-seconds");
  var friendlyFrequency = document.getElementById("friendly-frequency");
  var friendlyInterval = document.getElementById("friendly-interval");
  var friendlyMinute = document.getElementById("friendly-minute");
  var friendlyHour = document.getElementById("friendly-hour");
  var friendlyDow = document.getElementById("friendly-dow");
  var friendlyDom = document.getElementById("friendly-dom");
  var friendlyGenerate = document.getElementById("friendly-generate");
  var openGuruBtn = document.getElementById("open-guru-btn");
  var cronPreviewText = document.getElementById("cron-preview-text");
  var newTaskBtn = document.getElementById("new-task-btn");
  var taskFilterBar = document.getElementById("task-filter-bar");
  var taskLabelFilter = document.getElementById("task-label-filter");
  var taskLabelsInput = document.getElementById("task-labels");
  var jobsFolderList = document.getElementById("jobs-folder-list");
  var jobsCurrentFolderBanner = document.getElementById("jobs-current-folder-banner");
  var jobsList = document.getElementById("jobs-list");
  var jobsEmptyState = document.getElementById("jobs-empty-state");
  var jobsDetails = document.getElementById("jobs-details");
  var jobsLayout = document.getElementById("jobs-layout");
  var jobsToggleSidebarBtn = document.getElementById("jobs-toggle-sidebar-btn");
  var jobsNewFolderBtn = document.getElementById("jobs-new-folder-btn");
  var jobsRenameFolderBtn = document.getElementById("jobs-rename-folder-btn");
  var jobsDeleteFolderBtn = document.getElementById("jobs-delete-folder-btn");
  var jobsNewJobBtn = document.getElementById("jobs-new-job-btn");
  var jobsSaveBtn = document.getElementById("jobs-save-btn");
  var jobsDuplicateBtn = document.getElementById("jobs-duplicate-btn");
  var jobsPauseBtn = document.getElementById("jobs-pause-btn");
  var jobsCompileBtn = document.getElementById("jobs-compile-btn");
  var jobsDeleteBtn = document.getElementById("jobs-delete-btn");
  var jobsBackBtn = document.getElementById("jobs-back-btn");
  var jobsOpenEditorBtn = document.getElementById("jobs-open-editor-btn");
  var boardSummary = document.getElementById("board-summary");
  var boardColumns = document.getElementById("board-columns");
  var todoSearchInput = document.getElementById("todo-search-input");
  var todoSectionFilter = document.getElementById("todo-section-filter");
  var todoLabelFilter = document.getElementById("todo-label-filter");
  var todoPriorityFilter = document.getElementById("todo-priority-filter");
  var todoStatusFilter = document.getElementById("todo-status-filter");
  var todoArchiveOutcomeFilter = document.getElementById("todo-archive-outcome-filter");
  var todoSortBy = document.getElementById("todo-sort-by");
  var todoSortDirection = document.getElementById("todo-sort-direction");
  var todoShowArchived = document.getElementById("todo-show-archived");
  var todoNewBtn = document.getElementById("todo-new-btn");
  var todoClearSelectionBtn = document.getElementById("todo-clear-selection-btn");
  var todoBackBtn = document.getElementById("todo-back-btn");
  var todoDetailTitle = document.getElementById("todo-detail-title");
  var todoDetailModeNote = document.getElementById("todo-detail-mode-note");
  var todoDetailForm = document.getElementById("todo-detail-form");
  var todoDetailId = document.getElementById("todo-detail-id");
  var todoTitleInput = document.getElementById("todo-title-input");
  var todoDescriptionInput = document.getElementById("todo-description-input");
  var todoDueInput = document.getElementById("todo-due-input");
  var todoPriorityInput = document.getElementById("todo-priority-input");
  var todoSectionInput = document.getElementById("todo-section-input");
  var todoLinkedTaskSelect = document.getElementById("todo-linked-task-select");
  var todoDetailStatus = document.getElementById("todo-detail-status");
  var todoLabelChipList = document.getElementById("todo-label-chip-list");
  var todoLabelsInput = document.getElementById("todo-labels-input");
  var todoLabelSuggestions = document.getElementById("todo-label-suggestions");
  var todoLabelColorInput = document.getElementById("todo-label-color-input");
  var todoLabelAddBtn = document.getElementById("todo-label-add-btn");
  var todoLabelColorSaveBtn = document.getElementById("todo-label-color-save-btn");
  var todoFlagsInput = document.getElementById("todo-flags-input");
  var todoLinkedTaskNote = document.getElementById("todo-linked-task-note");
  var todoSaveBtn = document.getElementById("todo-save-btn");
  var todoCreateTaskBtn = document.getElementById("todo-create-task-btn");
  var todoApproveBtn = document.getElementById("todo-approve-btn");
  var todoFinalizeBtn = document.getElementById("todo-finalize-btn");
  var todoDeleteBtn = document.getElementById("todo-delete-btn");
  var todoCommentList = document.getElementById("todo-comment-list");
  var todoCommentInput = document.getElementById("todo-comment-input");
  var todoAddCommentBtn = document.getElementById("todo-add-comment-btn");
  var jobsNameInput = document.getElementById("jobs-name-input");
  var jobsCronPreset = document.getElementById("jobs-cron-preset");
  var jobsCronInput = document.getElementById("jobs-cron-input");
  var jobsCronPreviewText = document.getElementById("jobs-cron-preview-text");
  var jobsOpenGuruBtn = document.getElementById("jobs-open-guru-btn");
  var jobsFriendlyBuilder = document.getElementById("jobs-friendly-builder");
  var jobsFriendlyFrequency = document.getElementById("jobs-friendly-frequency");
  var jobsFriendlyInterval = document.getElementById("jobs-friendly-interval");
  var jobsFriendlyMinute = document.getElementById("jobs-friendly-minute");
  var jobsFriendlyHour = document.getElementById("jobs-friendly-hour");
  var jobsFriendlyDow = document.getElementById("jobs-friendly-dow");
  var jobsFriendlyDom = document.getElementById("jobs-friendly-dom");
  var jobsFriendlyGenerate = document.getElementById("jobs-friendly-generate");
  var jobsFolderSelect = document.getElementById("jobs-folder-select");
  var jobsStatusPill = document.getElementById("jobs-status-pill");
  var jobsTimelineInline = document.getElementById("jobs-timeline-inline");
  var jobsStepList = document.getElementById("jobs-step-list");
  var jobsPauseNameInput = document.getElementById("jobs-pause-name-input");
  var jobsCreatePauseBtn = document.getElementById("jobs-create-pause-btn");
  var jobsExistingTaskSelect = document.getElementById("jobs-existing-task-select");
  var jobsExistingWindowInput = document.getElementById("jobs-existing-window-input");
  var jobsAttachBtn = document.getElementById("jobs-attach-btn");
  var jobsStepNameInput = document.getElementById("jobs-step-name-input");
  var jobsStepWindowInput = document.getElementById("jobs-step-window-input");
  var jobsStepPromptInput = document.getElementById("jobs-step-prompt-input");
  var jobsStepAgentSelect = document.getElementById("jobs-step-agent-select");
  var jobsStepModelSelect = document.getElementById("jobs-step-model-select");
  var jobsStepLabelsInput = document.getElementById("jobs-step-labels-input");
  var jobsCreateStepBtn = document.getElementById("jobs-create-step-btn");
  var researchNewBtn = document.getElementById("research-new-btn");
  var researchSaveBtn = document.getElementById("research-save-btn");
  var researchDuplicateBtn = document.getElementById("research-duplicate-btn");
  var researchDeleteBtn = document.getElementById("research-delete-btn");
  var researchStartBtn = document.getElementById("research-start-btn");
  var researchStopBtn = document.getElementById("research-stop-btn");
  var researchEditIdInput = document.getElementById("research-edit-id");
  var researchNameInput = document.getElementById("research-name");
  var researchInstructionsInput = document.getElementById("research-instructions");
  var researchEditablePathsInput = document.getElementById("research-editable-paths");
  var researchBenchmarkInput = document.getElementById("research-benchmark-command");
  var researchMetricPatternInput = document.getElementById("research-metric-pattern");
  var researchMetricDirectionSelect = document.getElementById("research-metric-direction");
  var researchMaxIterationsInput = document.getElementById("research-max-iterations");
  var researchMaxMinutesInput = document.getElementById("research-max-minutes");
  var researchMaxFailuresInput = document.getElementById("research-max-failures");
  var researchBenchmarkTimeoutInput = document.getElementById("research-benchmark-timeout");
  var researchEditWaitInput = document.getElementById("research-edit-wait");
  var researchAgentSelect = document.getElementById("research-agent-select");
  var researchModelSelect = document.getElementById("research-model-select");
  var researchProfileList = document.getElementById("research-profile-list");
  var researchRunList = document.getElementById("research-run-list");
  var researchRunTitle = document.getElementById("research-run-title");
  var researchFormError = document.getElementById("research-form-error");
  var researchActiveEmpty = document.getElementById("research-active-empty");
  var researchActiveDetails = document.getElementById("research-active-details");
  var researchActiveStatus = document.getElementById("research-active-status");
  var researchActiveBest = document.getElementById("research-active-best");
  var researchActiveAttempts = document.getElementById("research-active-attempts");
  var researchActiveLastOutcome = document.getElementById("research-active-last-outcome");
  var researchActiveMeta = document.getElementById("research-active-meta");
  var researchAttemptList = document.getElementById("research-attempt-list");
  var telegramEnabledInput = document.getElementById("telegram-enabled");
  var telegramBotTokenInput = document.getElementById("telegram-bot-token");
  var telegramChatIdInput = document.getElementById("telegram-chat-id");
  var telegramMessagePrefixInput = document.getElementById("telegram-message-prefix");
  var telegramSaveBtn = document.getElementById("telegram-save-btn");
  var telegramTestBtn = document.getElementById("telegram-test-btn");
  var telegramFeedback = document.getElementById("telegram-feedback");
  var telegramTokenStatus = document.getElementById("telegram-token-status");
  var telegramChatStatus = document.getElementById("telegram-chat-status");
  var telegramHookStatus = document.getElementById("telegram-hook-status");
  var telegramUpdatedAt = document.getElementById("telegram-updated-at");
  var telegramStatusNote = document.getElementById("telegram-status-note");
  var defaultAgentSelect = document.getElementById("default-agent-select");
  var defaultModelSelect = document.getElementById("default-model-select");
  var executionDefaultsSaveBtn = document.getElementById("execution-defaults-save-btn");
  var executionDefaultsNote = document.getElementById("execution-defaults-note");
  var boardAddSectionBtn = document.getElementById("board-add-section-btn");
  var cockpitColSlider = document.getElementById("cockpit-col-slider");

  // Restore persisted column width
  (function () {
    var savedWidth = localStorage.getItem("cockpit-col-width");
    if (savedWidth) {
      document.documentElement.style.setProperty("--cockpit-col-width", savedWidth + "px");
      if (cockpitColSlider) cockpitColSlider.value = savedWidth;
    }
  })();

  var activeTaskFilter = "all";
  var activeLabelFilter = "";
  var selectedJobFolderId = "";
  var selectedJobId = "";
  var selectedResearchId = "";
  var selectedResearchRunId = "";
  var draggedJobNodeId = "";
  var draggedJobId = "";
  var jobsSidebarHidden = false;
  var isCreatingResearchProfile = false;
  var researchFormDirty = false;
  var loadedResearchProfileId = "";

  function isValidTaskFilter(value) {
    return value === "all" || value === "recurring" || value === "one-time";
  }

  function restoreTaskFilter() {
    if (!vscode || typeof vscode.getState !== "function") return;
    try {
      var state = vscode.getState() || {};
      var saved = state && state.taskFilter;
      if (isValidTaskFilter(saved)) {
        activeTaskFilter = saved;
      }
      if (state && typeof state.labelFilter === "string") {
        activeLabelFilter = state.labelFilter;
      }
      if (state && typeof state.selectedJobFolderId === "string") {
        selectedJobFolderId = state.selectedJobFolderId;
      }
      if (state && typeof state.selectedJobId === "string") {
        selectedJobId = state.selectedJobId;
      }
      if (state && typeof state.jobsSidebarHidden === "boolean") {
        jobsSidebarHidden = state.jobsSidebarHidden;
      }
      if (state && typeof state.selectedResearchId === "string") {
        selectedResearchId = state.selectedResearchId;
      }
      if (state && typeof state.selectedResearchRunId === "string") {
        selectedResearchRunId = state.selectedResearchRunId;
      }
    } catch (_e) {
      // ignore state restore failures
    }
  }

  function persistTaskFilter() {
    if (!vscode || typeof vscode.setState !== "function") return;
    try {
      var prev =
        typeof vscode.getState === "function" ? vscode.getState() || {} : {};
      var next = {};
      if (prev && typeof prev === "object") {
        for (var key in prev) {
          if (Object.prototype.hasOwnProperty.call(prev, key)) {
            next[key] = prev[key];
          }
        }
      }
      next.taskFilter = activeTaskFilter;
      next.labelFilter = activeLabelFilter;
      next.selectedJobFolderId = selectedJobFolderId;
      next.selectedJobId = selectedJobId;
      next.jobsSidebarHidden = jobsSidebarHidden;
      next.selectedResearchId = selectedResearchId;
      next.selectedResearchRunId = selectedResearchRunId;
      vscode.setState(next);
    } catch (_e) {
      // ignore state persist failures
    }
  }

  function clearTelegramFeedback() {
    if (!telegramFeedback) return;
    telegramFeedback.textContent = "";
    telegramFeedback.style.display = "none";
    telegramFeedback.classList.remove("error");
  }

  function showTelegramFeedback(message, isError) {
    if (!telegramFeedback) return;
    telegramFeedback.textContent = String(message || "");
    telegramFeedback.style.display = message ? "block" : "none";
    telegramFeedback.classList.toggle("error", !!isError);
  }

  function formatTelegramUpdatedAt(value) {
    if (!value) return "-";
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(locale);
  }

  function collectTelegramFormData() {
    return {
      enabled: !!(telegramEnabledInput && telegramEnabledInput.checked),
      botToken: telegramBotTokenInput ? String(telegramBotTokenInput.value || "") : "",
      chatId: telegramChatIdInput ? String(telegramChatIdInput.value || "") : "",
      messagePrefix: telegramMessagePrefixInput
        ? String(telegramMessagePrefixInput.value || "")
        : "",
    };
  }

  function validateTelegramFormData(data) {
    var needsConfig = data.enabled
      || !!String(data.chatId || "").trim()
      || !!String(data.messagePrefix || "").trim();
    if (needsConfig && !String(data.chatId || "").trim()) {
      return strings.telegramValidationChatId || "Telegram chat ID is required.";
    }
    if (
      needsConfig
      && !String(data.botToken || "").trim()
      && !(telegramNotification && telegramNotification.hasBotToken)
    ) {
      return strings.telegramValidationBotToken || "Telegram bot token is required.";
    }
    return "";
  }

  function renderTelegramTab() {
    if (telegramEnabledInput) {
      telegramEnabledInput.checked = !!telegramNotification.enabled;
    }
    if (telegramChatIdInput) {
      telegramChatIdInput.value = telegramNotification.chatId || "";
    }
    if (telegramMessagePrefixInput) {
      telegramMessagePrefixInput.value = telegramNotification.messagePrefix || "";
    }
    if (telegramBotTokenInput) {
      telegramBotTokenInput.value = "";
      telegramBotTokenInput.placeholder = telegramNotification.hasBotToken
        ? (strings.telegramSavedToken || "Bot token stored privately")
        : (strings.telegramBotTokenPlaceholder || "123456:ABCDEF...");
    }
    if (telegramTokenStatus) {
      telegramTokenStatus.textContent = telegramNotification.hasBotToken
        ? (strings.telegramSavedToken || "Bot token stored privately")
        : (strings.telegramMissingToken || "No bot token saved yet");
    }
    if (telegramChatStatus) {
      telegramChatStatus.textContent = telegramNotification.chatId || "-";
    }
    if (telegramHookStatus) {
      telegramHookStatus.textContent = telegramNotification.hookConfigured
        ? (strings.telegramHookReady || "Stop hook configured")
        : (strings.telegramHookMissing || "Stop hook files not configured");
    }
    if (telegramUpdatedAt) {
      telegramUpdatedAt.textContent = formatTelegramUpdatedAt(telegramNotification.updatedAt);
    }
    if (telegramStatusNote) {
      telegramStatusNote.textContent = strings.telegramWorkspaceNote
        || "The hook files are generated under .github/hooks and read secrets from .vscode/scheduler.private.json.";
    }
    clearTelegramFeedback();
  }

  function collectExecutionDefaultsFormData() {
    return {
      agent: defaultAgentSelect ? String(defaultAgentSelect.value || "") : "",
      model: defaultModelSelect ? String(defaultModelSelect.value || "") : "",
    };
  }

  function renderExecutionDefaultsControls() {
    updateSimpleSelect(
      defaultAgentSelect,
      agents,
      strings.placeholderSelectAgent || "Select agent",
      executionDefaults && typeof executionDefaults.agent === "string"
        ? executionDefaults.agent
        : "agent",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return item && item.name ? item.name : "";
      },
    );

    updateSimpleSelect(
      defaultModelSelect,
      models,
      strings.placeholderSelectModel || "Select model",
      executionDefaults && typeof executionDefaults.model === "string"
        ? executionDefaults.model
        : "",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return formatModelLabel(item);
      },
    );

    if (executionDefaultsNote) {
      executionDefaultsNote.textContent = strings.executionDefaultsSaved
        || "Workspace default agent and model settings.";
    }
  }

  function applyJobsSidebarState() {
    if (jobsLayout && jobsLayout.classList) {
      jobsLayout.classList.toggle("sidebar-collapsed", !!jobsSidebarHidden);
    }
    if (jobsToggleSidebarBtn) {
      jobsToggleSidebarBtn.textContent = jobsSidebarHidden
        ? (strings.jobsShowSidebar || "Show Sidebar")
        : (strings.jobsHideSidebar || "Hide Sidebar");
    }
  }

  function getJobStatusText(job) {
    if (job && job.runtime && job.runtime.waitingPause) {
      return strings.jobsPauseWaiting || "Waiting for approval";
    }
    if (job && job.archived) {
      return strings.jobsArchivedBadge || "Archived";
    }
    return job && job.paused
      ? (strings.jobsPaused || "Inactive")
      : (strings.jobsRunning || "Active");
  }

  function syncTaskFilterButtons() {
    if (!taskFilterBar) return;
    var buttons = taskFilterBar.querySelectorAll(".task-filter-btn");
    for (var i = 0; i < buttons.length; i++) {
      var btn = buttons[i];
      if (!btn || !btn.classList) continue;
      if (btn.getAttribute("data-filter") === activeTaskFilter) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    }
  }

  function syncAutoShowOnStartupUi() {
    if (autoShowStartupBtn) {
      autoShowStartupBtn.textContent = autoShowOnStartup
        ? strings.autoShowOnStartupToggleEnabled || "Disable Auto Open"
        : strings.autoShowOnStartupToggleDisabled || "Enable Auto Open";
    }
    if (autoShowStartupNote) {
      autoShowStartupNote.textContent = autoShowOnStartup
        ? strings.autoShowOnStartupEnabled || "Auto-open on startup: On"
        : strings.autoShowOnStartupDisabled || "Auto-open on startup: Off";
    }
  }

  function syncRecurringChatSessionUi() {
    var oneTimeEl = document.getElementById("one-time");
    var isOneTime = !!(oneTimeEl && oneTimeEl.checked);

    if (chatSessionGroup) {
      chatSessionGroup.style.display = isOneTime ? "none" : "block";
    }

    if (chatSessionSelect && !chatSessionSelect.value) {
      chatSessionSelect.value = defaultChatSession;
    }

    if (isOneTime && chatSessionSelect) {
      chatSessionSelect.value = defaultChatSession;
    }
  }

  function formatHistoryLabel(entry) {
    if (!entry || !entry.createdAt) {
      return strings.scheduleHistoryPlaceholder || "Select a backup version";
    }
    var date = new Date(entry.createdAt);
    if (isNaN(date.getTime())) {
      return String(entry.createdAt);
    }
    return date.toLocaleString(locale);
  }

  function syncScheduleHistoryOptions() {
    if (!scheduleHistorySelect) return;

    var previousValue = scheduleHistorySelect.value || "";
    var entries = Array.isArray(scheduleHistory) ? scheduleHistory : [];
    entries = entries.slice().sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    if (entries.length === 0) {
      scheduleHistorySelect.innerHTML =
        '<option value="">' +
        escapeHtml(strings.scheduleHistoryEmpty || "No backup versions yet") +
        "</option>";
      scheduleHistorySelect.disabled = true;
      if (restoreHistoryBtn) restoreHistoryBtn.disabled = true;
      return;
    }

    scheduleHistorySelect.innerHTML =
      '<option value="">' +
      escapeHtml(strings.scheduleHistoryPlaceholder || "Select a backup version") +
      "</option>" +
      entries
        .map(function (entry) {
          return (
            '<option value="' +
            escapeAttr(entry.id || "") +
            '">' +
            escapeHtml(formatHistoryLabel(entry)) +
            "</option>"
          );
        })
        .join("");

    scheduleHistorySelect.disabled = false;
    if (restoreHistoryBtn) restoreHistoryBtn.disabled = false;

    if (previousValue) {
      scheduleHistorySelect.value = previousValue;
    }
    if (scheduleHistorySelect.value !== previousValue) {
      scheduleHistorySelect.value = "";
    }
  }

  function parseLabels(value) {
    if (!value) return [];
    return String(value)
      .split(",")
      .map(function (item) {
        return String(item || "").trim();
      })
      .filter(function (item, index, list) {
        return item && list.indexOf(item) === index;
      });
  }

  function toLabelString(labels) {
    return Array.isArray(labels) ? labels.join(", ") : "";
  }

  function getJobById(id) {
    return (Array.isArray(jobs) ? jobs : []).find(function (job) {
      return job && job.id === id;
    }) || null;
  }

  function isPauseNode(node) {
    return !!node && node.type === "pause";
  }

  function isTaskNode(node) {
    return !!node && node.type !== "pause" && !!node.taskId;
  }

  function getApprovedPauseIds(job) {
    var approved = job && job.runtime && Array.isArray(job.runtime.approvedPauseNodeIds)
      ? job.runtime.approvedPauseNodeIds
      : [];
    return approved.filter(function (value) {
      return typeof value === "string" && value;
    });
  }

  function getWaitingPauseState(job) {
    return job && job.runtime && job.runtime.waitingPause
      ? job.runtime.waitingPause
      : null;
  }

  function getFolderById(id) {
    return (Array.isArray(jobFolders) ? jobFolders : []).find(function (folder) {
      return folder && folder.id === id;
    }) || null;
  }

  function getTaskById(id) {
    return (Array.isArray(tasks) ? tasks : []).find(function (task) {
      return task && task.id === id;
    }) || null;
  }

  function getVisibleJobs() {
    return (Array.isArray(jobs) ? jobs : [])
      .filter(function (job) {
        return job && (job.folderId || "") === selectedJobFolderId;
      })
      .sort(function (a, b) {
        var updatedDiff = getComparableTime(b && b.updatedAt) - getComparableTime(a && a.updatedAt);
        if (updatedDiff !== 0) {
          return updatedDiff;
        }
        var aName = a && a.name ? String(a.name) : "";
        var bName = b && b.name ? String(b.name) : "";
        return aName.localeCompare(bName);
      });
  }

  function getFolderDepth(folder) {
    var depth = 0;
    var current = folder;
    while (current && current.parentId) {
      depth += 1;
      current = getFolderById(current.parentId);
      if (depth > 20) break;
    }
    return depth;
  }

  function getFolderPath(folderId) {
    if (!folderId) {
      return strings.jobsRootFolder || "All jobs";
    }
    var parts = [];
    var current = getFolderById(folderId);
    var guard = 0;
    while (current && guard < 20) {
      parts.unshift(current.name || "");
      current = current.parentId ? getFolderById(current.parentId) : null;
      guard += 1;
    }
    parts.unshift(strings.jobsRootFolder || "All jobs");
    return parts.filter(Boolean).join(" / ");
  }

  function isArchiveFolder(folder) {
    return !!folder && String(folder.name || "").toLowerCase() === String(strings.jobsArchiveFolder || "Archive").toLowerCase();
  }

  function getEffectiveLabels(task) {
    var labels = [];
    if (task && Array.isArray(task.labels)) {
      labels = labels.concat(task.labels);
    }
    if (task && task.jobId) {
      var job = getJobById(task.jobId);
      if (job && job.name) {
        labels.push(job.name);
      }
    }
    return labels.filter(function (label, index, list) {
      return label && list.indexOf(label) === index;
    });
  }

  function getComparableTime(value) {
    if (!value) return Number.MAX_SAFE_INTEGER;
    var d = new Date(value);
    var t = d.getTime();
    return isNaN(t) ? Number.MAX_SAFE_INTEGER : t;
  }

  function sortTasksByNextRun(list) {
    return (Array.isArray(list) ? list.slice() : []).sort(function (a, b) {
      var diff = getComparableTime(a && a.nextRun) - getComparableTime(b && b.nextRun);
      if (diff !== 0) return diff;
      var aName = a && a.name ? String(a.name) : "";
      var bName = b && b.name ? String(b.name) : "";
      return aName.localeCompare(bName);
    });
  }

  function getStandaloneTasks() {
    return sortTasksByNextRun(
      (Array.isArray(tasks) ? tasks : []).filter(function (task) {
        return task && !task.jobId && task.oneTime !== true;
      }),
    );
  }

  function syncTaskLabelFilterOptions() {
    if (!taskLabelFilter) return;
    var values = [];
    (Array.isArray(tasks) ? tasks : []).forEach(function (task) {
      getEffectiveLabels(task).forEach(function (label) {
        if (values.indexOf(label) === -1) {
          values.push(label);
        }
      });
    });
    values.sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });

    var currentValue = activeLabelFilter || "";
    taskLabelFilter.innerHTML =
      '<option value="">' +
      escapeHtml(strings.labelAllLabels || "All labels") +
      "</option>" +
      values
        .map(function (label) {
          return (
            '<option value="' +
            escapeAttr(label) +
            '">' +
            escapeHtml(label) +
            "</option>"
          );
        })
        .join("");

    taskLabelFilter.value = currentValue;
    if (taskLabelFilter.value !== currentValue) {
      activeLabelFilter = "";
      taskLabelFilter.value = "";
    }
  }

  function ensureValidJobSelection() {
    if (selectedJobFolderId && !getFolderById(selectedJobFolderId)) {
      selectedJobFolderId = "";
    }
    var selectedJob = selectedJobId ? getJobById(selectedJobId) : null;
    if (selectedJob && (selectedJob.folderId || "") !== selectedJobFolderId) {
      selectedJobId = "";
      selectedJob = null;
    }
    if (selectedJobId && !selectedJob) {
      selectedJobId = "";
    }
    if (!selectedJobId) {
      var visibleJobs = getVisibleJobs();
      if (visibleJobs.length > 0) {
        selectedJobId = visibleJobs[0].id;
      }
    }
  }

  function getSelectedJobFolder() {
    return selectedJobFolderId ? getFolderById(selectedJobFolderId) : null;
  }

  restoreTaskFilter();
  syncAutoShowOnStartupUi();
  syncScheduleHistoryOptions();
  updateJobsCronPreview();
  updateJobsFriendlyVisibility();
  syncResearchSelectors();
  hookResearchFormDirtyTracking();
  renderResearchTab();
  renderTelegramTab();
  renderCockpitBoard();
  renderExecutionDefaultsControls();

  function parseTagList(text) {
    if (!text) return [];
    return String(text)
      .split(",")
      .map(function (entry) { return entry.trim(); })
      .filter(function (entry) { return entry.length > 0; });
  }

  function normalizeTodoLabel(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function normalizeTodoLabelKey(value) {
    return normalizeTodoLabel(value).toLowerCase();
  }

  function dedupeStringList(values) {
    var seen = {};
    return (Array.isArray(values) ? values : [])
      .map(normalizeTodoLabel)
      .filter(function (value) {
        var key = normalizeTodoLabelKey(value);
        if (!key || seen[key]) {
          return false;
        }
        seen[key] = true;
        return true;
      });
  }

  function getTodoArchiveCollections() {
    var archives = cockpitBoard && cockpitBoard.archives ? cockpitBoard.archives : {};
    return {
      completedSuccessfully: Array.isArray(archives.completedSuccessfully)
        ? archives.completedSuccessfully
        : [],
      rejected: Array.isArray(archives.rejected) ? archives.rejected : [],
    };
  }

  function getAllTodoCards() {
    var activeCards = cockpitBoard && Array.isArray(cockpitBoard.cards)
      ? cockpitBoard.cards.slice()
      : [];
    var archives = getTodoArchiveCollections();
    return activeCards
      .concat(archives.completedSuccessfully)
      .concat(archives.rejected);
  }

  function getVisibleTodoCards(filters) {
    var activeCards = cockpitBoard && Array.isArray(cockpitBoard.cards)
      ? cockpitBoard.cards.slice()
      : [];
    if (!filters || filters.showArchived !== true) {
      return activeCards;
    }
    var archives = getTodoArchiveCollections();
    return activeCards
      .concat(archives.completedSuccessfully)
      .concat(archives.rejected);
  }

  function getLabelCatalog() {
    return cockpitBoard && Array.isArray(cockpitBoard.labelCatalog)
      ? cockpitBoard.labelCatalog.slice()
      : [];
  }

  function getLabelDefinition(label) {
    var key = normalizeTodoLabelKey(label);
    var catalog = getLabelCatalog();
    for (var index = 0; index < catalog.length; index += 1) {
      if (normalizeTodoLabelKey(catalog[index].key || catalog[index].name) === key) {
        return catalog[index];
      }
    }
    return null;
  }

  function getLabelColor(label) {
    var definition = getLabelDefinition(label);
    return definition && definition.color
      ? definition.color
      : "var(--vscode-badge-background)";
  }

  function getReadableTextColor(background) {
    var value = String(background || "").trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      var hex = value.slice(1);
      if (hex.length === 3) {
        hex = hex.split("").map(function (part) { return part + part; }).join("");
      }
      var red = parseInt(hex.slice(0, 2), 16);
      var green = parseInt(hex.slice(2, 4), 16);
      var blue = parseInt(hex.slice(4, 6), 16);
      var luminance = (red * 299 + green * 587 + blue * 114) / 1000;
      return luminance >= 150 ? "#111111" : "#ffffff";
    }
    return "var(--vscode-badge-foreground)";
  }

  function renderLabelChip(label, removable, selected) {
    var color = getLabelColor(label);
    var textColor = getReadableTextColor(color);
    var borderColor = selected
      ? "var(--vscode-focusBorder)"
      : "var(--vscode-panel-border)";
    return (
      '<span data-label-chip="' + escapeAttr(label) + '" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:' + escapeAttr(color) + ';color:' + escapeAttr(textColor) + ';border:1px solid ' + escapeAttr(borderColor) + ';font-size:11px;line-height:1.4;">' +
      '<button type="button" data-label-chip-select="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;color:inherit;">' + escapeHtml(label) + '</button>' +
      (removable
        ? '<button type="button" data-label-chip-remove="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;">×</button>'
        : "") +
      '</span>'
    );
  }

  function setTodoEditorLabels(labels, preserveSelection) {
    currentTodoLabels = dedupeStringList(labels);
    if (!preserveSelection) {
      selectedTodoLabelName = currentTodoLabels[0] || "";
    } else if (
      selectedTodoLabelName &&
      currentTodoLabels.map(normalizeTodoLabelKey).indexOf(normalizeTodoLabelKey(selectedTodoLabelName)) < 0
    ) {
      selectedTodoLabelName = currentTodoLabels[0] || "";
    }
  }

  function syncTodoLabelSuggestions() {
    if (!todoLabelSuggestions) {
      return;
    }
    var inputValue = todoLabelsInput ? normalizeTodoLabelKey(todoLabelsInput.value) : "";
    var addedKeys = currentTodoLabels.map(normalizeTodoLabelKey);
    var labels = dedupeStringList(
      getLabelCatalog().map(function (entry) {
        return entry.name;
      }).concat(currentTodoLabels),
    ).filter(function (label) {
      // Exclude already-added labels
      return addedKeys.indexOf(normalizeTodoLabelKey(label)) < 0;
    }).sort(function (left, right) {
      return left.localeCompare(right);
    });
    if (inputValue) {
      labels = labels.filter(function (label) {
        return normalizeTodoLabelKey(label).indexOf(inputValue) >= 0;
      });
    }
    if (labels.length === 0) {
      todoLabelSuggestions.style.display = "none";
      todoLabelSuggestions.innerHTML = "";
      return;
    }
    todoLabelSuggestions.style.display = "flex";
    todoLabelSuggestions.innerHTML = labels.map(function (label) {
      var bg = getLabelColor(label);
      var fg = getReadableTextColor(bg);
      return '<button type="button" data-label-suggestion="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;padding:5px 14px;border-radius:999px;background:' + escapeAttr(bg) + ';color:' + escapeAttr(fg) + ';border:1px solid color-mix(in srgb,' + escapeAttr(bg) + ' 60%,var(--vscode-panel-border));font-size:12.5px;line-height:1.5;">' + escapeHtml(label) + '</button>';
    }).join("");
  }

  function syncTodoLabelEditor() {
    if (todoLabelChipList) {
      todoLabelChipList.innerHTML = currentTodoLabels.length > 0
        ? currentTodoLabels.map(function (label) {
          return renderLabelChip(
            label,
            true,
            normalizeTodoLabelKey(label) === normalizeTodoLabelKey(selectedTodoLabelName),
          );
        }).join("")
        : '<div class="note">No labels yet.</div>';
    }

    var selectedDefinition = selectedTodoLabelName
      ? getLabelDefinition(selectedTodoLabelName)
      : null;
    if (todoLabelColorInput) {
      // Only update the color picker when a chip is selected — don't overwrite
      // the user's current choice while they're typing a new label name.
      var isTypingNew = todoLabelsInput && todoLabelsInput.value.trim();
      if (selectedTodoLabelName) {
        todoLabelColorInput.value = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(
          selectedDefinition && selectedDefinition.color ? selectedDefinition.color : ""
        ) ? selectedDefinition.color : "#4f8cff";
      } else if (!isTypingNew) {
        todoLabelColorInput.value = "#4f8cff";
      }
      // Always enabled — user can pick a color before clicking Add
      todoLabelColorInput.disabled = false;
    }
    if (todoLabelColorSaveBtn) {
      todoLabelColorSaveBtn.disabled = !selectedTodoLabelName;
    }
    syncTodoLabelSuggestions();
  }

  function addEditorLabelFromInput() {
    if (!todoLabelsInput) {
      return;
    }
    var label = normalizeTodoLabel(todoLabelsInput.value);
    if (!label) {
      return;
    }
    // Capture the currently-chosen color before resetting the editor
    var pendingColor = todoLabelColorInput ? todoLabelColorInput.value : "";
    setTodoEditorLabels(currentTodoLabels.concat([label]), true);
    selectedTodoLabelName = label;
    todoLabelsInput.value = "";
    if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
    syncTodoLabelEditor();
    // Persist the chosen color for this label immediately
    if (pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
      vscode.postMessage({
        type: "saveTodoLabelDefinition",
        data: { name: label, color: pendingColor },
      });
    }
  }

  function removeEditorLabel(label) {
    setTodoEditorLabels(
      currentTodoLabels.filter(function (entry) {
        return normalizeTodoLabelKey(entry) !== normalizeTodoLabelKey(label);
      }),
      true,
    );
    syncTodoLabelEditor();
  }

  function toLocalDateTimeInput(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    var year = date.getFullYear();
    var month = padNumber(date.getMonth() + 1);
    var day = padNumber(date.getDate());
    var hour = padNumber(date.getHours());
    var minute = padNumber(date.getMinutes());
    return year + "-" + month + "-" + day + "T" + hour + ":" + minute;
  }

  function fromLocalDateTimeInput(value) {
    if (!value) return undefined;
    var date = new Date(value);
    if (isNaN(date.getTime())) return undefined;
    return date.toISOString();
  }

  function formatTodoDate(value) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return date.toLocaleString(locale || undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  function getTodoPriorityLabel(priority) {
    switch (priority) {
      case "low": return strings.boardPriorityLow || "Low";
      case "medium": return strings.boardPriorityMedium || "Medium";
      case "high": return strings.boardPriorityHigh || "High";
      case "urgent": return strings.boardPriorityUrgent || "Urgent";
      default: return strings.boardPriorityNone || "None";
    }
  }

  function getTodoPriorityRank(priority) {
    switch (priority) {
      case "urgent": return 4;
      case "high": return 3;
      case "medium": return 2;
      case "low": return 1;
      default: return 0;
    }
  }

  function getTodoStatusLabel(status) {
    switch (status) {
      case "ready": return strings.boardStatusReady || "Ready";
      case "completed": return strings.boardStatusCompleted || "Completed";
      case "rejected": return strings.boardStatusRejected || "Rejected";
      default: return strings.boardStatusActive || "Active";
    }
  }

  function getTodoArchiveOutcomeLabel(outcome) {
    switch (outcome) {
      case "completed-successfully":
        return strings.boardArchiveCompletedSuccessfully || "Completed successfully";
      case "rejected":
        return strings.boardArchiveRejected || "Rejected";
      default:
        return strings.boardAllArchiveOutcomes || "All outcomes";
    }
  }

  function getTodoCommentSourceLabel(source) {
    switch (source) {
      case "bot-mcp": return strings.boardCommentSourceBotMcp || "Bot MCP";
      case "bot-manual": return strings.boardCommentSourceBotManual || "Bot manual";
      case "system-event": return strings.boardCommentSourceSystemEvent || "System event";
      default: return strings.boardCommentSourceHumanForm || "Human form";
    }
  }

  function getTodoDescriptionPreview(description) {
    var text = String(description || "").trim().replace(/\s+/g, " ");
    if (!text) {
      return strings.boardDescriptionPreviewEmpty || "No description yet.";
    }
    return text.length > 140 ? text.slice(0, 137) + "..." : text;
  }

  function getTodoFilters() {
    var filters = cockpitBoard && cockpitBoard.filters ? cockpitBoard.filters : {};
    return {
      searchText: filters.searchText || "",
      labels: Array.isArray(filters.labels) ? filters.labels : [],
      priorities: Array.isArray(filters.priorities) ? filters.priorities : [],
      statuses: Array.isArray(filters.statuses) ? filters.statuses : [],
      archiveOutcomes: Array.isArray(filters.archiveOutcomes) ? filters.archiveOutcomes : [],
      flags: Array.isArray(filters.flags) ? filters.flags : [],
      sectionId: filters.sectionId || "",
      sortBy: filters.sortBy || "manual",
      sortDirection: filters.sortDirection || "asc",
      showArchived: filters.showArchived === true,
    };
  }

  function updateTodoFilters(partial) {
    var next = Object.assign({}, getTodoFilters(), partial || {});
    if (!cockpitBoard) {
      cockpitBoard = {
        sections: [],
        cards: [],
        labelCatalog: [],
        archives: { completedSuccessfully: [], rejected: [] },
        filters: {},
        updatedAt: "",
      };
    }
    cockpitBoard.filters = next;
    renderCockpitBoard();
    vscode.postMessage({ type: "setTodoFilters", data: next });
  }

  function getTodoSections() {
    var sections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice() : [];
    sections.sort(function (left, right) {
      return (left.order || 0) - (right.order || 0);
    });
    return sections;
  }

  function getLinkedTask(taskId) {
    if (!taskId) return null;
    for (var i = 0; i < tasks.length; i += 1) {
      if (tasks[i] && tasks[i].id === taskId) {
        return tasks[i];
      }
    }
    return null;
  }

  function cardMatchesTodoFilters(card, filters) {
    if (!filters.showArchived && card.archived) {
      return false;
    }
    if (filters.sectionId && card.sectionId !== filters.sectionId) {
      return false;
    }
    if (filters.labels.length > 0) {
      var hasLabel = (card.labels || []).some(function (label) {
        return filters.labels.indexOf(label) >= 0;
      });
      if (!hasLabel) return false;
    }
    if (filters.priorities.length > 0 && filters.priorities.indexOf(card.priority || "none") < 0) {
      return false;
    }
    if (filters.statuses.length > 0 && filters.statuses.indexOf(card.status || "active") < 0) {
      return false;
    }
    if (filters.archiveOutcomes.length > 0) {
      if (!card.archived || filters.archiveOutcomes.indexOf(card.archiveOutcome || "") < 0) {
        return false;
      }
    }
    if (filters.flags.length > 0) {
      var hasFlag = (card.flags || []).some(function (flag) {
        return filters.flags.indexOf(flag) >= 0;
      });
      if (!hasFlag) return false;
    }
    if (filters.searchText) {
      var needle = String(filters.searchText).toLowerCase();
      var commentsText = (card.comments || []).map(function (comment) {
        return (comment.author || "") + " " + (comment.body || "");
      }).join(" ");
      var haystack = [
        card.title || "",
        card.description || "",
        (card.labels || []).join(" "),
        (card.flags || []).join(" "),
        commentsText,
      ].join(" ").toLowerCase();
      if (haystack.indexOf(needle) < 0) {
        return false;
      }
    }
    return true;
  }

  function sortTodoCards(cards, filters) {
    var direction = filters.sortDirection === "desc" ? -1 : 1;
    return cards.slice().sort(function (left, right) {
      var result = 0;
      switch (filters.sortBy) {
        case "dueAt": {
          var leftDue = left.dueAt ? new Date(left.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          var rightDue = right.dueAt ? new Date(right.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
          result = leftDue - rightDue;
          break;
        }
        case "priority":
          result = getTodoPriorityRank(left.priority) - getTodoPriorityRank(right.priority);
          break;
        case "updatedAt":
          result = new Date(left.updatedAt || 0).getTime() - new Date(right.updatedAt || 0).getTime();
          break;
        case "createdAt":
          result = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
          break;
        default:
          result = (left.order || 0) - (right.order || 0);
          break;
      }
      if (result === 0) {
        result = String(left.title || "").localeCompare(String(right.title || ""));
      }
      return result * direction;
    });
  }

  function renderTodoFilterControls(filters, sections, cards) {
    var labels = dedupeStringList(
      getLabelCatalog().map(function (entry) {
        return entry.name;
      }).concat((Array.isArray(cards) ? cards : []).reduce(function (all, card) {
        return all.concat(card.labels || []);
      }, [])),
    ).sort();

    if (todoSearchInput) todoSearchInput.value = filters.searchText || "";
    if (todoSectionFilter) {
      todoSectionFilter.innerHTML =
        '<option value="">' + escapeHtml(strings.boardAllSections || "All sections") + '</option>' +
        sections.map(function (section) {
          return '<option value="' + escapeAttr(section.id) + '">' + escapeHtml(section.title) + '</option>';
        }).join("");
      todoSectionFilter.value = filters.sectionId || "";
    }
    if (todoLabelFilter) {
      todoLabelFilter.innerHTML =
        '<option value="">' + escapeHtml(strings.boardAllLabels || "All labels") + '</option>' +
        labels.map(function (label) {
          return '<option value="' + escapeAttr(label) + '">' + escapeHtml(label) + '</option>';
        }).join("");
      todoLabelFilter.value = filters.labels[0] || "";
    }
    if (todoPriorityFilter) {
      todoPriorityFilter.innerHTML = [
        { value: "", label: strings.boardAllPriorities || "All priorities" },
        { value: "none", label: getTodoPriorityLabel("none") },
        { value: "low", label: getTodoPriorityLabel("low") },
        { value: "medium", label: getTodoPriorityLabel("medium") },
        { value: "high", label: getTodoPriorityLabel("high") },
        { value: "urgent", label: getTodoPriorityLabel("urgent") },
      ].map(function (option) {
        return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>';
      }).join("");
      todoPriorityFilter.value = filters.priorities[0] || "";
    }
    if (todoStatusFilter) {
      todoStatusFilter.innerHTML = [
        { value: "", label: strings.boardAllStatuses || "All statuses" },
        { value: "active", label: getTodoStatusLabel("active") },
        { value: "ready", label: getTodoStatusLabel("ready") },
        { value: "completed", label: getTodoStatusLabel("completed") },
        { value: "rejected", label: getTodoStatusLabel("rejected") },
      ].map(function (option) {
        return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>';
      }).join("");
      todoStatusFilter.value = filters.statuses[0] || "";
    }
    if (todoArchiveOutcomeFilter) {
      todoArchiveOutcomeFilter.innerHTML = [
        { value: "", label: strings.boardAllArchiveOutcomes || "All outcomes" },
        { value: "completed-successfully", label: getTodoArchiveOutcomeLabel("completed-successfully") },
        { value: "rejected", label: getTodoArchiveOutcomeLabel("rejected") },
      ].map(function (option) {
        return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>';
      }).join("");
      todoArchiveOutcomeFilter.value = filters.archiveOutcomes[0] || "";
    }
    if (todoSortBy) {
      todoSortBy.innerHTML = [
        { value: "manual", label: strings.boardSortManual || "Manual order" },
        { value: "dueAt", label: strings.boardSortDueAt || "Due date" },
        { value: "priority", label: strings.boardSortPriority || "Priority" },
        { value: "updatedAt", label: strings.boardSortUpdatedAt || "Last updated" },
        { value: "createdAt", label: strings.boardSortCreatedAt || "Created date" },
      ].map(function (option) {
        return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>';
      }).join("");
      todoSortBy.value = filters.sortBy || "manual";
    }
    if (todoSortDirection) {
      todoSortDirection.innerHTML = [
        { value: "asc", label: strings.boardSortAsc || "Ascending" },
        { value: "desc", label: strings.boardSortDesc || "Descending" },
      ].map(function (option) {
        return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>';
      }).join("");
      todoSortDirection.value = filters.sortDirection || "asc";
    }
    if (todoShowArchived) {
      todoShowArchived.checked = filters.showArchived === true;
    }
  }

  function renderTodoDetailPanel(selectedTodo, sections) {
    var isEditingTodo = !!selectedTodo;
    var isArchivedTodo = !!(selectedTodo && selectedTodo.archived);
    if (isEditingTodo) {
      setTodoEditorLabels(selectedTodo.labels || [], false);
    } else {
      setTodoEditorLabels(currentTodoLabels, true);
    }
    if (todoDetailTitle) {
      todoDetailTitle.textContent = isEditingTodo
        ? (strings.boardDetailTitleEdit || "Edit Todo")
        : (strings.boardDetailTitleCreate || "Create Todo");
    }
    if (todoDetailModeNote) {
      todoDetailModeNote.textContent = isEditingTodo
        ? (strings.boardDetailModeEdit || "Update this todo.")
        : (strings.boardDetailModeCreate || "Fill the form to create a new todo.");
    }
    if (todoDetailId) todoDetailId.value = isEditingTodo ? selectedTodo.id : "";
    if (todoTitleInput) todoTitleInput.value = isEditingTodo ? (selectedTodo.title || "") : "";
    if (todoDescriptionInput) todoDescriptionInput.value = isEditingTodo ? (selectedTodo.description || "") : "";
    if (todoDueInput) todoDueInput.value = isEditingTodo ? toLocalDateTimeInput(selectedTodo.dueAt) : "";
    if (todoLabelsInput) todoLabelsInput.value = "";
    if (todoFlagsInput) todoFlagsInput.value = isEditingTodo ? (selectedTodo.flags || []).join(", ") : "";
    syncTodoLabelEditor();

    if (todoDetailStatus) {
      if (!isEditingTodo) {
        todoDetailStatus.textContent = strings.boardStatusLabel
          ? strings.boardStatusLabel + ": " + (strings.boardStatusActive || "Active")
          : "Status: Active";
      } else if (selectedTodo.archived) {
        todoDetailStatus.textContent =
          (strings.boardStatusLabel || "Status") + ": " +
          getTodoStatusLabel(selectedTodo.status || "active") +
          " • " +
          getTodoArchiveOutcomeLabel(selectedTodo.archiveOutcome || "rejected");
      } else {
        todoDetailStatus.textContent =
          (strings.boardStatusLabel || "Status") + ": " +
          getTodoStatusLabel(selectedTodo.status || "active");
      }
    }

    if (todoPriorityInput) {
      todoPriorityInput.innerHTML = ["none", "low", "medium", "high", "urgent"].map(function (priority) {
        return '<option value="' + escapeAttr(priority) + '">' + escapeHtml(getTodoPriorityLabel(priority)) + '</option>';
      }).join("");
      todoPriorityInput.value = isEditingTodo ? (selectedTodo.priority || "none") : "none";
    }

    if (todoSectionInput) {
      todoSectionInput.innerHTML = sections.map(function (section) {
        return '<option value="' + escapeAttr(section.id) + '">' + escapeHtml(section.title) + '</option>';
      }).join("");
      todoSectionInput.value = isEditingTodo ? selectedTodo.sectionId : (sections[0] ? sections[0].id : "");
    }

    if (todoLinkedTaskSelect) {
      todoLinkedTaskSelect.innerHTML =
        '<option value="">' + escapeHtml(strings.boardLinkedTaskNone || "No linked task") + '</option>' +
        tasks.map(function (task) {
          return '<option value="' + escapeAttr(task.id) + '">' + escapeHtml(task.name || task.id) + '</option>';
        }).join("");
      todoLinkedTaskSelect.value = isEditingTodo && selectedTodo.taskId ? selectedTodo.taskId : "";
    }

    if (todoSaveBtn) {
      todoSaveBtn.textContent = isEditingTodo
        ? (strings.boardSaveUpdate || "Save Todo")
        : (strings.boardSaveCreate || "Create Todo");
      todoSaveBtn.disabled = isArchivedTodo;
    }
    if (todoCreateTaskBtn) {
      todoCreateTaskBtn.disabled = !isEditingTodo || isArchivedTodo || (selectedTodo.status || "active") !== "ready";
    }
    if (todoApproveBtn) {
      todoApproveBtn.disabled = !isEditingTodo || isArchivedTodo || (selectedTodo.status || "active") === "ready";
    }
    if (todoFinalizeBtn) {
      todoFinalizeBtn.disabled = !isEditingTodo || isArchivedTodo || (selectedTodo.status || "active") !== "ready";
    }
    if (todoDeleteBtn) todoDeleteBtn.disabled = !isEditingTodo || isArchivedTodo;
    if (todoAddCommentBtn) todoAddCommentBtn.disabled = !isEditingTodo || isArchivedTodo;
    if (todoCommentInput) {
      todoCommentInput.disabled = !isEditingTodo || isArchivedTodo;
      if (!isEditingTodo) {
        todoCommentInput.value = "";
      }
    }

    var linkedTask = isEditingTodo ? getLinkedTask(selectedTodo.taskId) : null;
    if (todoLinkedTaskNote) {
      if (!isEditingTodo) {
        todoLinkedTaskNote.textContent = strings.boardTaskDraftNote || "Scheduled tasks remain separate from planning todos.";
      } else if (selectedTodo.archived) {
        todoLinkedTaskNote.textContent = strings.boardReadOnlyArchived || "Archived items are read-only.";
      } else if (selectedTodo.taskId && !linkedTask) {
        todoLinkedTaskNote.textContent = strings.boardTaskMissing || "Linked task not found in Task List.";
      } else if (linkedTask) {
        todoLinkedTaskNote.textContent = (strings.boardTaskLinked || "Linked task") + ": " + (linkedTask.name || linkedTask.id);
      } else if ((selectedTodo.status || "active") === "ready") {
        todoLinkedTaskNote.textContent = strings.boardReadyForTask || "Approved items can become scheduled task drafts or be final accepted.";
      } else {
        todoLinkedTaskNote.textContent = strings.boardTaskDraftNote || "Scheduled tasks remain separate from planning todos.";
      }
    }

    if (todoCommentList) {
      var comments = isEditingTodo && Array.isArray(selectedTodo.comments) ? selectedTodo.comments : [];
      todoCommentList.innerHTML = comments.length > 0
        ? comments.map(function (comment) {
          var sourceLabel = getTodoCommentSourceLabel(comment.source || "human-form");
          var sequence = typeof comment.sequence === "number" ? comment.sequence : 1;
          var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
          return '<article style="padding:10px;border-radius:8px;border:1px solid var(--vscode-panel-border);background:var(--vscode-sideBar-background);">' +
            '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:6px;">' +
            '<strong>#' + escapeHtml(String(sequence)) + ' • ' + escapeHtml(sourceLabel) + '</strong>' +
            '<span class="note">' + escapeHtml(formatTodoDate(displayDate)) + '</span>' +
            '</div>' +
            '<div class="note" style="margin-bottom:6px;">' + escapeHtml(comment.author || "system") + '</div>' +
            '<div class="note" style="white-space:pre-wrap;">' + escapeHtml(comment.body || "") + '</div>' +
            '</article>';
        }).join("")
        : '<div class="note">' + escapeHtml(strings.boardCommentsEmpty || "No comments yet.") + '</div>';
    }
  }

  function renderCockpitBoard() {
    var sections = getTodoSections();
    var filters = getTodoFilters();
    var allCards = getAllTodoCards();
    var cards = getVisibleTodoCards(filters);

    if (selectedTodoId) {
      var selectedTodo = allCards.find(function (card) {
        return card && card.id === selectedTodoId;
      });
      if (selectedTodo && selectedTodo.archived && filters.showArchived !== true) {
        selectedTodoId = null;
      }
      var hasSelectedTodo = allCards.some(function (card) {
        return card && card.id === selectedTodoId;
      });
      if (!hasSelectedTodo) {
        selectedTodoId = null;
      }
    }

    renderTodoFilterControls(filters, sections, cards);

    if (boardSummary) {
      var activeCount = cockpitBoard && Array.isArray(cockpitBoard.cards)
        ? cockpitBoard.cards.length
        : 0;
      boardSummary.textContent =
        (strings.boardSections || "Sections") + ": " + sections.length +
        " • " +
        (strings.boardCards || "Cards") + ": " + activeCount +
        " • Archived: " + String(Math.max(0, allCards.length - activeCount)) +
        " • " +
        (strings.boardComments || "Comments") + ": " + allCards.reduce(function (count, card) {
          return count + (Array.isArray(card.comments) ? card.comments.length : 0);
        }, 0);
    }

    if (!boardColumns) {
      return;
    }

    var visibleSections = sections.filter(function (section) {
      return !filters.sectionId || section.id === filters.sectionId;
    });

    if (visibleSections.length === 0) {
      boardColumns.innerHTML = '<div class="note">' + escapeHtml(strings.boardEmpty || "No cards yet.") + '</div>';
      renderTodoDetailPanel(null, sections);
      return;
    }

    boardColumns.innerHTML =
      '<div style="display:flex;gap:16px;align-items:flex-start;min-width:max-content;">' +
      visibleSections.map(function (section) {
        var sectionCards = sortTodoCards(cards.filter(function (card) {
          return card.sectionId === section.id && cardMatchesTodoFilters(card, filters);
        }), filters);
        return (
          '<section data-section-id="' + escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '" style="display:flex;flex-direction:column;gap:12px;padding:14px;border-radius:10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);width:var(--cockpit-col-width,300px);min-width:var(--cockpit-col-width,300px);max-height:72vh;overflow:hidden;">' +
          '<div class="cockpit-section-header">' +
          '<strong>' + escapeHtml(section.title || "Section") + '</strong>' +
          '<div class="cockpit-section-actions">' +
          '<span class="note">' + String(sectionCards.length) + '</span>' +
          '<button type="button" class="btn-icon" data-section-move="' + escapeAttr(section.id) + '" data-direction="left" title="Move left">&#8592;</button>' +
          '<button type="button" class="btn-icon" data-section-move="' + escapeAttr(section.id) + '" data-direction="right" title="Move right">&#8594;</button>' +
          '<button type="button" class="btn-icon" data-section-rename="' + escapeAttr(section.id) + '" title="Rename section">&#9998;</button>' +
          '<button type="button" class="btn-icon" data-section-delete="' + escapeAttr(section.id) + '" title="Delete section">&#215;</button>' +
          '</div>' +
          '</div>' +
          '<div style="display:flex;flex-direction:column;gap:10px;overflow-y:auto;padding-right:4px;min-height:120px;">' +
          (sectionCards.length
            ? sectionCards.map(function (card) {
              var isSelected = card.id === selectedTodoId;
              var labelMarkup = Array.isArray(card.labels) && card.labels.length
                ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + card.labels.map(function (label) {
                  return renderLabelChip(label, false, false);
                }).join("") + '</div>'
                : "";
              var latestComment = Array.isArray(card.comments) && card.comments.length
                ? card.comments[card.comments.length - 1]
                : null;
              var linkedTaskText = card.taskId
                ? (strings.boardLinkedTaskShort || "Linked")
                : (strings.boardNoLinkedTask || "No linked task yet");
              var dueMarkup = card.dueAt
                ? '<span style="font-size:11px;white-space:nowrap;color:var(--vscode-descriptionForeground);">' + escapeHtml((strings.boardDueLabel || "Due") + ': ' + formatTodoDate(card.dueAt)) + '</span>'
                : '';
              var statusMarkup = '<span style="font-size:11px;white-space:nowrap;color:var(--vscode-descriptionForeground);">' + escapeHtml(getTodoStatusLabel(card.status || "active")) + '</span>';
              var archiveMarkup = card.archived && card.archiveOutcome
                ? '<span style="font-size:11px;white-space:nowrap;color:var(--vscode-descriptionForeground);">' + escapeHtml(getTodoArchiveOutcomeLabel(card.archiveOutcome)) + '</span>'
                : '';
              var latestCommentMarkup = latestComment && latestComment.body
                ? '<div class="note" style="display:flex;gap:6px;align-items:flex-start;">' +
                  '<strong style="font-size:11px;">' + escapeHtml(strings.boardLatestComment || "Latest comment") + ':</strong>' +
                  '<span style="font-size:11px;">#' + escapeHtml(String(latestComment.sequence || 1)) + ' • ' + escapeHtml(getTodoCommentSourceLabel(latestComment.source || "human-form")) + ' • ' + escapeHtml(getTodoDescriptionPreview(latestComment.body || "")) + '</span>' +
                  '</div>'
                : '';
              var canApprove = !card.archived && (card.status || "active") !== "ready";
              var canFinalize = !card.archived && (card.status || "active") === "ready";
              var canDelete = !card.archived;
              return (
                '<article draggable="' + (card.archived ? 'false' : 'true') + '" data-todo-id="' + escapeAttr(card.id) + '" data-section-id="' + escapeAttr(section.id) + '" data-order="' + String(card.order || 0) + '" style="display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:8px;background:' + (isSelected ? 'var(--vscode-list-activeSelectionBackground)' : 'var(--vscode-sideBar-background)') + ';border:1px solid ' + (isSelected ? 'var(--vscode-focusBorder)' : 'var(--vscode-widget-border)') + ';cursor:pointer;">' +
                '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">' +
                '<strong style="line-height:1.35;">' + escapeHtml(card.title || "Untitled") + '</strong>' +
                '<span style="font-size:11px;white-space:nowrap;color:var(--vscode-descriptionForeground);">' + escapeHtml(getTodoPriorityLabel(card.priority || "none")) + '</span>' +
                '</div>' +
                '<div style="display:flex;flex-wrap:wrap;gap:8px;">' + dueMarkup + statusMarkup + archiveMarkup + '<span style="font-size:11px;white-space:nowrap;color:var(--vscode-descriptionForeground);">' + escapeHtml(linkedTaskText) + '</span></div>' +
                '<div class="note" style="white-space:pre-wrap;">' + escapeHtml(getTodoDescriptionPreview(card.description || "")) + '</div>' +
                labelMarkup +
                latestCommentMarkup +
                (Array.isArray(card.flags) && card.flags.length
                  ? '<div class="note" style="font-size:11px;">' + escapeHtml(card.flags.join(" • ")) + '</div>'
                  : '') +
                '<div style="display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">' +
                '<button type="button" class="btn-secondary todo-card-edit" data-todo-edit="' + escapeAttr(card.id) + '">' + escapeHtml(strings.boardEditTodo || 'Edit') + '</button>' +
                (canApprove
                  ? '<button type="button" class="btn-secondary todo-card-approve" data-todo-approve="' + escapeAttr(card.id) + '">' + escapeHtml(strings.boardApproveTodo || 'Approve') + '</button>'
                  : '') +
                (canFinalize
                  ? '<button type="button" class="btn-secondary todo-card-finalize" data-todo-finalize="' + escapeAttr(card.id) + '">' + escapeHtml(strings.boardFinalizeTodo || 'Final Accept') + '</button>'
                  : '') +
                (canDelete
                  ? '<button type="button" class="btn-secondary todo-card-delete" data-todo-delete="' + escapeAttr(card.id) + '">' + escapeHtml(strings.boardDeleteTodo || 'Delete') + '</button>'
                  : '') +
                '</div>' +
                '</article>'
              );
            }).join("")
            : '<div class="note">' + escapeHtml(strings.boardEmpty || "No cards yet.") + '</div>') +
          '</div>' +
          '</section>'
        );
      }).join("") +
      '</div>';

    renderTodoDetailPanel(selectedTodoId
      ? allCards.find(function (card) { return card.id === selectedTodoId; }) || null
      : null,
    sections);

    if (boardColumns) {
      boardColumns.onclick = function (event) {
        var editButton = event.target && event.target.closest ? event.target.closest("[data-todo-edit]") : null;
        var approveButton = event.target && event.target.closest ? event.target.closest("[data-todo-approve]") : null;
        var finalizeButton = event.target && event.target.closest ? event.target.closest("[data-todo-finalize]") : null;
        var deleteButton = event.target && event.target.closest ? event.target.closest("[data-todo-delete]") : null;
        var sectionMoveBtn = event.target && event.target.closest ? event.target.closest("[data-section-move]") : null;
        var sectionRenameBtn = event.target && event.target.closest ? event.target.closest("[data-section-rename]") : null;
        var sectionDeleteBtn = event.target && event.target.closest ? event.target.closest("[data-section-delete]") : null;
        var card = event.target && event.target.closest ? event.target.closest("[data-todo-id]") : null;

        if (sectionMoveBtn) {
          vscode.postMessage({ type: "moveCockpitSection", sectionId: sectionMoveBtn.getAttribute("data-section-move"), direction: sectionMoveBtn.getAttribute("data-direction") });
          return;
        }
        if (sectionRenameBtn) {
          var sectionId = sectionRenameBtn.getAttribute("data-section-rename");
          var currentSection = getTodoSections().find(function (s) { return s.id === sectionId; });
          var newTitle = window.prompt("Rename section:", currentSection ? currentSection.title : "");
          if (newTitle && newTitle.trim()) {
            vscode.postMessage({ type: "renameCockpitSection", sectionId: sectionId, title: newTitle.trim() });
          }
          return;
        }
        if (sectionDeleteBtn) {
          var sectionId = sectionDeleteBtn.getAttribute("data-section-delete");
          var currentSection = getTodoSections().find(function (s) { return s.id === sectionId; });
          if (currentSection && window.confirm("Delete section \u201c" + (currentSection.title || "Section") + "\u201d?\nCards will be moved to the default section.")) {
            vscode.postMessage({ type: "deleteCockpitSection", sectionId: sectionId });
          }
          return;
        }

        if (editButton) {
          openTodoEditor(editButton.getAttribute("data-todo-edit") || "");
          return;
        }
        if (approveButton) {
          vscode.postMessage({ type: "approveTodo", todoId: approveButton.getAttribute("data-todo-approve") });
          return;
        }
        if (finalizeButton) {
          vscode.postMessage({ type: "finalizeTodo", todoId: finalizeButton.getAttribute("data-todo-finalize") });
          return;
        }
        if (deleteButton) {
          vscode.postMessage({ type: "deleteTodo", todoId: deleteButton.getAttribute("data-todo-delete") });
          return;
        }
        if (card) {
          selectedTodoId = card.getAttribute("data-todo-id");
          renderCockpitBoard();
        }
      };
      boardColumns.ondragstart = function (event) {
        var card = event.target && event.target.closest ? event.target.closest("[data-todo-id]") : null;
        if (!card) return;
        if (card.getAttribute("draggable") === "false") {
          return;
        }
        draggingTodoId = card.getAttribute("data-todo-id");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", draggingTodoId || "");
        }
      };
      boardColumns.ondragover = function (event) {
        var section = event.target && event.target.closest ? event.target.closest("[data-section-id]") : null;
        if (section && draggingTodoId) {
          event.preventDefault();
        }
      };
      boardColumns.ondrop = function (event) {
        var section = event.target && event.target.closest ? event.target.closest("[data-section-id]") : null;
        var targetCard = event.target && event.target.closest ? event.target.closest("[data-todo-id]") : null;
        if (!section || !draggingTodoId) {
          return;
        }
        event.preventDefault();
        var targetIndex = targetCard ? Number(targetCard.getAttribute("data-order") || 0) : Number(section.getAttribute("data-card-count") || 0);
        vscode.postMessage({
          type: "moveTodo",
          todoId: draggingTodoId,
          sectionId: section.getAttribute("data-section-id"),
          targetIndex: targetIndex,
        });
        draggingTodoId = null;
      };
      boardColumns.ondragend = function () {
        draggingTodoId = null;
      };
    }

    if (todoNewBtn) {
      todoNewBtn.onclick = function () {
        openTodoEditor("");
      };
    }
    if (todoClearSelectionBtn) {
      todoClearSelectionBtn.onclick = function () {
        selectedTodoId = null;
        currentTodoLabels = [];
        selectedTodoLabelName = "";
        renderCockpitBoard();
        switchTab("board");
      };
    }
    if (boardAddSectionBtn) {
      boardAddSectionBtn.onclick = function () {
        var title = window.prompt("New section name:");
        if (title && title.trim()) {
          vscode.postMessage({ type: "addCockpitSection", title: title.trim() });
        }
      };
    }
    if (cockpitColSlider) {
      cockpitColSlider.oninput = function () {
        var w = cockpitColSlider.value;
        document.documentElement.style.setProperty("--cockpit-col-width", w + "px");
        try { localStorage.setItem("cockpit-col-width", w); } catch (e) {}
      };
    }
    if (todoBackBtn) {
      todoBackBtn.onclick = function () {
        switchTab("board");
      };
    }
    if (todoSearchInput) {
      todoSearchInput.oninput = function () {
        updateTodoFilters({ searchText: todoSearchInput.value || "" });
      };
    }
    if (todoSectionFilter) {
      todoSectionFilter.onchange = function () {
        updateTodoFilters({ sectionId: todoSectionFilter.value || "" });
      };
    }
    if (todoLabelFilter) {
      todoLabelFilter.onchange = function () {
        updateTodoFilters({ labels: todoLabelFilter.value ? [todoLabelFilter.value] : [] });
      };
    }
    if (todoPriorityFilter) {
      todoPriorityFilter.onchange = function () {
        updateTodoFilters({ priorities: todoPriorityFilter.value ? [todoPriorityFilter.value] : [] });
      };
    }
    if (todoStatusFilter) {
      todoStatusFilter.onchange = function () {
        updateTodoFilters({ statuses: todoStatusFilter.value ? [todoStatusFilter.value] : [] });
      };
    }
    if (todoArchiveOutcomeFilter) {
      todoArchiveOutcomeFilter.onchange = function () {
        updateTodoFilters({ archiveOutcomes: todoArchiveOutcomeFilter.value ? [todoArchiveOutcomeFilter.value] : [] });
      };
    }
    if (todoSortBy) {
      todoSortBy.onchange = function () {
        updateTodoFilters({ sortBy: todoSortBy.value || "manual" });
      };
    }
    if (todoSortDirection) {
      todoSortDirection.onchange = function () {
        updateTodoFilters({ sortDirection: todoSortDirection.value || "asc" });
      };
    }
    if (todoShowArchived) {
      todoShowArchived.onchange = function () {
        updateTodoFilters({ showArchived: todoShowArchived.checked === true });
      };
    }
    if (todoDetailForm) {
      todoDetailForm.onsubmit = function (event) {
        event.preventDefault();
        if (!todoTitleInput || !todoSectionInput || !todoPriorityInput) {
          return;
        }
        var payload = {
          title: todoTitleInput.value || "",
          description: todoDescriptionInput ? todoDescriptionInput.value : "",
          dueAt: fromLocalDateTimeInput(todoDueInput ? todoDueInput.value : "") || null,
          sectionId: todoSectionInput.value || "",
          priority: todoPriorityInput.value || "none",
          labels: currentTodoLabels.slice(),
          flags: parseTagList(todoFlagsInput ? todoFlagsInput.value : ""),
          taskId: todoLinkedTaskSelect && todoLinkedTaskSelect.value ? todoLinkedTaskSelect.value : null,
        };
        if (selectedTodoId) {
          vscode.postMessage({ type: "updateTodo", todoId: selectedTodoId, data: payload });
        } else {
          vscode.postMessage({ type: "createTodo", data: payload });
        }
      };
    }
    if (todoAddCommentBtn) {
      todoAddCommentBtn.onclick = function () {
        if (!selectedTodoId || !todoCommentInput || !todoCommentInput.value.trim()) {
          return;
        }
        vscode.postMessage({
          type: "addTodoComment",
          todoId: selectedTodoId,
          data: { body: todoCommentInput.value.trim(), author: "user", source: "human-form" },
        });
        todoCommentInput.value = "";
      };
    }
    if (todoCreateTaskBtn) {
      todoCreateTaskBtn.onclick = function () {
        if (!selectedTodoId) return;
        vscode.postMessage({ type: "createTaskFromTodo", todoId: selectedTodoId });
      };
    }
    if (todoApproveBtn) {
      todoApproveBtn.onclick = function () {
        if (!selectedTodoId) return;
        vscode.postMessage({ type: "approveTodo", todoId: selectedTodoId });
      };
    }
    if (todoFinalizeBtn) {
      todoFinalizeBtn.onclick = function () {
        if (!selectedTodoId) return;
        vscode.postMessage({ type: "finalizeTodo", todoId: selectedTodoId });
      };
    }
    if (todoDeleteBtn) {
      todoDeleteBtn.onclick = function () {
        if (!selectedTodoId) return;
        vscode.postMessage({ type: "deleteTodo", todoId: selectedTodoId });
        selectedTodoId = null;
      };
    }
    if (todoLabelAddBtn) {
      todoLabelAddBtn.onclick = function () {
        addEditorLabelFromInput();
      };
    }
    if (todoLabelsInput) {
      todoLabelsInput.oninput = function () {
        var label = normalizeTodoLabel(todoLabelsInput.value);
        if (label) {
          // Preview the existing definition color for this label name
          var def = getLabelDefinition(label);
          if (def && def.color && todoLabelColorInput) {
            todoLabelColorInput.value = def.color;
          }
          if (todoLabelColorInput) todoLabelColorInput.disabled = false;
        } else {
          selectedTodoLabelName = "";
          syncTodoLabelEditor();
        }
        syncTodoLabelSuggestions();
      };
      todoLabelsInput.onfocus = function () {
        syncTodoLabelSuggestions();
      };
      todoLabelsInput.onblur = function () {
        setTimeout(function () {
          if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
        }, 200);
      };
      todoLabelsInput.onkeydown = function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          addEditorLabelFromInput();
        } else if (event.key === "Escape") {
          if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
        }
      };
    }
    if (todoLabelChipList) {
      todoLabelChipList.onclick = function (event) {
        var removeButton = event.target && event.target.closest ? event.target.closest("[data-label-chip-remove]") : null;
        var selectButton = event.target && event.target.closest ? event.target.closest("[data-label-chip-select]") : null;
        if (removeButton) {
          removeEditorLabel(removeButton.getAttribute("data-label-chip-remove") || "");
          return;
        }
        if (selectButton) {
          selectedTodoLabelName = selectButton.getAttribute("data-label-chip-select") || "";
          syncTodoLabelEditor();
        }
      };
    }
    if (todoLabelColorSaveBtn) {
      todoLabelColorSaveBtn.onclick = function () {
        if (!selectedTodoLabelName || !todoLabelColorInput) {
          return;
        }
        vscode.postMessage({
          type: "saveTodoLabelDefinition",
          data: {
            name: selectedTodoLabelName,
            color: todoLabelColorInput.value,
          },
        });
      };
    }
    if (todoLabelSuggestions) {
      todoLabelSuggestions.onclick = function (event) {
        var btn = event.target && event.target.closest
          ? event.target.closest("[data-label-suggestion]")
          : null;
        if (btn) {
          var pickedLabel = btn.getAttribute("data-label-suggestion") || "";
          var def = getLabelDefinition(pickedLabel);
          if (def && def.color && todoLabelColorInput) {
            todoLabelColorInput.value = def.color;
          }
          if (todoLabelsInput) todoLabelsInput.value = pickedLabel;
          addEditorLabelFromInput();
        }
      };
    }
  }

  function getCreateTabButton() {
    return document.querySelector('.tab-button[data-tab="create"]');
  }

  function setCreateTabLabel(isEditing) {
    var btn = getCreateTabButton();
    if (!btn) return;
    var label = isEditing
      ? strings.tabEdit || strings.tabCreate
      : strings.tabCreate;
    if (label) btn.textContent = label;
  }

  function setEditingMode(taskId) {
    editingTaskId = taskId || null;
    if (editTaskIdInput) editTaskIdInput.value = editingTaskId || "";
    setCreateTabLabel(!!editingTaskId);

    if (submitBtn) {
      var label = editingTaskId ? strings.actionSave : strings.actionCreate;
      if (label) submitBtn.textContent = label;
    }
    if (newTaskBtn) {
      newTaskBtn.style.display = editingTaskId ? "inline-flex" : "none";
    }
  }

  function openTodoEditor(todoId) {
    selectedTodoId = todoId || null;
    if (!selectedTodoId) {
      currentTodoLabels = [];
      selectedTodoLabelName = "";
    }
    renderCockpitBoard();
    switchTab("todo-edit");
  }

  function openJobEditor(jobId) {
    if (typeof jobId === "string") {
      selectedJobId = jobId;
    } else if (!selectedJobId) {
      var visibleJobs = getVisibleJobs();
      selectedJobId = visibleJobs.length ? String(visibleJobs[0].id || "") : "";
    }
    persistTaskFilter();
    renderJobsTab();
    switchTab("jobs-edit");
  }

  // Tab switching function
  function switchTab(tabName) {
    document.querySelectorAll(".tab-button").forEach(function (b) {
      b.classList.remove("active");
    });
    document.querySelectorAll(".tab-content").forEach(function (c) {
      c.classList.remove("active");
    });
    var targetBtn = document.querySelector(
      '.tab-button[data-tab="' + tabName + '"]',
    );
    var targetContent = document.getElementById(tabName + "-tab");
    if (targetBtn) targetBtn.classList.add("active");
    if (targetContent) targetContent.classList.add("active");
    if (jobsToggleSidebarBtn) {
      jobsToggleSidebarBtn.style.display = tabName === "jobs" ? "inline-flex" : "none";
    }
  }

  // Keep pending values in sync when the user explicitly changes selection
  if (agentSelect) {
    agentSelect.addEventListener("change", function () {
      pendingAgentValue = "";
    });
  }
  if (modelSelect) {
    modelSelect.addEventListener("change", function () {
      pendingModelValue = "";
    });
  }
  if (templateSelect) {
    templateSelect.addEventListener("change", function () {
      pendingTemplatePath = templateSelect ? templateSelect.value : "";
    });
  }

  var oneTimeToggle = document.getElementById("one-time");
  if (oneTimeToggle) {
    oneTimeToggle.addEventListener("change", function () {
      syncRecurringChatSessionUi();
    });
  }

  // Use event delegation for tab buttons (works even when clicking text/child nodes)
  function resolveTabButton(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (el.classList && el.classList.contains("tab-button")) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener("click", function (e) {
    var button = resolveTabButton(e.target);
    if (!button) return;
    e.preventDefault();
    e.stopPropagation();
    var tabName = button.getAttribute("data-tab");
    if (tabName) {
      switchTab(tabName);
    }
  });

  if (taskFilterBar) {
    syncTaskFilterButtons();
    taskFilterBar.addEventListener("click", function (e) {
      var target = e && e.target;
      var filterButton = target;
      while (filterButton && filterButton !== taskFilterBar) {
        if (
          filterButton.getAttribute &&
          filterButton.getAttribute("data-filter")
        ) {
          break;
        }
        filterButton = filterButton.parentElement;
      }
      if (!filterButton || filterButton === taskFilterBar) return;
      var filterValue = filterButton.getAttribute("data-filter");
      if (!isValidTaskFilter(filterValue)) return;
      activeTaskFilter = filterValue;
      syncTaskFilterButtons();
      persistTaskFilter();
      renderTaskList(tasks);
    });
  }

  if (taskLabelFilter) {
    taskLabelFilter.addEventListener("change", function () {
      activeLabelFilter = taskLabelFilter.value || "";
      persistTaskFilter();
      renderTaskList(tasks);
    });
  }

  // Use event delegation for prompt source radio buttons
  document.addEventListener("change", function (e) {
    var target = e.target;
    if (target && target.name === "prompt-source" && target.checked) {
      applyPromptSource(target.value);
    }
  });

  // Cron preset handling with null check
  if (cronPreset && cronExpression) {
    cronPreset.addEventListener("change", function () {
      if (cronPreset.value) {
        cronExpression.value = cronPreset.value;
      }
      updateCronPreview();
    });

    cronExpression.addEventListener("input", function () {
      cronPreset.value = "";
      updateCronPreview();
    });
  }

  if (jobsCronPreset && jobsCronInput) {
    jobsCronPreset.addEventListener("change", function () {
      if (jobsCronPreset.value) {
        jobsCronInput.value = jobsCronPreset.value;
      }
      updateJobsCronPreview();
    });

    jobsCronInput.addEventListener("input", function () {
      jobsCronPreset.value = "";
      updateJobsCronPreview();
    });
  }

  if (friendlyFrequency) {
    friendlyFrequency.addEventListener("change", function () {
      updateFriendlyVisibility();
    });
  }

  if (jobsFriendlyFrequency) {
    jobsFriendlyFrequency.addEventListener("change", function () {
      updateJobsFriendlyVisibility();
    });
  }

  [telegramEnabledInput, telegramBotTokenInput, telegramChatIdInput, telegramMessagePrefixInput].forEach(function (element) {
    if (!element || typeof element.addEventListener !== "function") {
      return;
    }
    element.addEventListener("input", clearTelegramFeedback);
    element.addEventListener("change", clearTelegramFeedback);
  });

  if (telegramSaveBtn) {
    telegramSaveBtn.addEventListener("click", function () {
      submitTelegramForm("saveTelegramNotification");
    });
  }

  if (telegramTestBtn) {
    telegramTestBtn.addEventListener("click", function () {
      submitTelegramForm("testTelegramNotification");
    });
  }

  if (executionDefaultsSaveBtn) {
    executionDefaultsSaveBtn.addEventListener("click", function () {
      vscode.postMessage({
        type: "saveExecutionDefaults",
        data: collectExecutionDefaultsFormData(),
      });
    });
  }

  // Some environments may miss direct events on the select; keep it in sync via delegation.
  document.addEventListener("change", function (e) {
    var target = e && e.target;
    if (target && target.id === "friendly-frequency") {
      updateFriendlyVisibility();
    }
    if (target && target.id === "jobs-friendly-frequency") {
      updateJobsFriendlyVisibility();
    }
  });

  document.addEventListener("input", function (e) {
    var target = e && e.target;
    if (target && target.id === "friendly-frequency") {
      updateFriendlyVisibility();
    }
    if (target && target.id === "jobs-friendly-frequency") {
      updateJobsFriendlyVisibility();
    }
  });

  if (friendlyGenerate) {
    friendlyGenerate.addEventListener("click", function () {
      generateCronFromFriendly();
    });
  }

  if (jobsFriendlyGenerate) {
    jobsFriendlyGenerate.addEventListener("click", function () {
      generateJobsCronFromFriendly();
    });
  }

  if (openGuruBtn) {
    openGuruBtn.addEventListener("click", function () {
      var expression = cronExpression ? cronExpression.value.trim() : "";
      if (!expression) {
        expression = "* * * * *";
      }
      var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
      window.open(targetUrl, "_blank");
    });
  }

  if (jobsOpenGuruBtn) {
    jobsOpenGuruBtn.addEventListener("click", function () {
      var expression = jobsCronInput ? jobsCronInput.value.trim() : "";
      if (!expression) {
        expression = "* * * * *";
      }
      var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
      window.open(targetUrl, "_blank");
    });
  }

  // Handle inline Agent and Model selection changes
  document.addEventListener("change", function (e) {
    var target = e.target;
    if (!target) return;

    if (target.classList.contains("task-agent-select")) {
      var taskId = target.getAttribute("data-id");
      var value = target.value;
      vscode.postMessage({
        type: "updateTask",
        taskId: taskId,
        data: { agent: value }
      });
    } else if (target.classList.contains("task-model-select")) {
      var taskId = target.getAttribute("data-id");
      var value = target.value;
      vscode.postMessage({
        type: "updateTask",
        taskId: taskId,
        data: { model: value }
      });
    }
  });

  // Template selection with null check
  if (templateSelect) {
    templateSelect.addEventListener("change", function () {
      var selectedPath = templateSelect.value;
      if (selectedPath) {
        var sourceEl = document.querySelector(
          'input[name="prompt-source"]:checked',
        );
        var source = sourceEl ? sourceEl.value : "inline";
        vscode.postMessage({
          type: "loadPromptTemplate",
          path: selectedPath,
          source: source,
        });
      }
    });
  }

  // Form submission with null checks
  if (taskForm) {
    taskForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var formErr = document.getElementById("form-error");
      if (formErr) {
        formErr.style.display = "none";
      }

      var taskNameEl = document.getElementById("task-name");
      var promptTextEl = document.getElementById("prompt-text");
      var scopeEl = document.querySelector('input[name="scope"]:checked');
      var promptSourceEl = document.querySelector(
        'input[name="prompt-source"]:checked',
      );
      var runFirstEl = document.getElementById("run-first");
      var oneTimeEl = document.getElementById("one-time");

      var promptSourceValue = promptSourceEl ? promptSourceEl.value : "inline";

      // Preserve values if dropdown options are not loaded yet
      var agentValue = agentSelect ? agentSelect.value : "";
      if (editingTaskId && !agentValue && pendingAgentValue) {
        agentValue = pendingAgentValue;
      }
      var modelValue = modelSelect ? modelSelect.value : "";
      if (editingTaskId && !modelValue && pendingModelValue) {
        modelValue = pendingModelValue;
      }
      var promptPathValue = templateSelect ? templateSelect.value : "";
      if (
        promptSourceValue !== "inline" &&
        editingTaskId &&
        !promptPathValue &&
        pendingTemplatePath
      ) {
        promptPathValue = pendingTemplatePath;
      }

      var taskData = {
        name: taskNameEl ? taskNameEl.value : "",
        prompt: promptTextEl ? promptTextEl.value : "",
        cronExpression: cronExpression ? cronExpression.value : "",
        labels: parseLabels(taskLabelsInput ? taskLabelsInput.value : ""),
        agent: agentValue,
        model: modelValue,
        scope: scopeEl ? scopeEl.value : "workspace",
        promptSource: promptSourceValue,
        promptPath: promptPathValue,
        runFirstInOneMinute: runFirstEl ? runFirstEl.checked : false,
        oneTime: oneTimeEl ? oneTimeEl.checked : false,
        jitterSeconds: jitterSecondsInput
          ? Number(jitterSecondsInput.value || 0)
          : 0,
        enabled: editingTaskId ? editingTaskEnabled : true,
      };

      if (!taskData.oneTime) {
        taskData.chatSession =
          chatSessionSelect && chatSessionSelect.value === "continue"
            ? "continue"
            : "new";
      }

      var nameValue = (taskData.name || "").trim();
      if (!nameValue) {
        if (formErr) {
          formErr.textContent = strings.taskNameRequired || "";
          formErr.style.display = "block";
        }
        return;
      }

      var templateValue = (taskData.promptPath || "").trim();
      if (promptSourceValue !== "inline" && !templateValue) {
        if (formErr) {
          formErr.textContent = strings.templateRequired || "";
          formErr.style.display = "block";
        }
        return;
      }

      var promptValue = (taskData.prompt || "").trim();
      if (!promptValue) {
        if (formErr) {
          formErr.textContent = strings.promptRequired || "";
          formErr.style.display = "block";
        }
        return;
      }

      var cronValue = (taskData.cronExpression || "").trim();
      if (!cronValue) {
        if (formErr) {
          formErr.textContent =
            strings.cronExpressionRequired ||
            strings.invalidCronExpression ||
            "";
          formErr.style.display = "block";
        }
        return;
      }

      pendingSubmit = true;
      if (submitBtn) submitBtn.disabled = true;

      if (editingTaskId) {
        vscode.postMessage({
          type: "updateTask",
          taskId: editingTaskId,
          data: taskData,
        });
      } else {
        vscode.postMessage({
          type: "createTask",
          data: taskData,
        });
      }
    });
  }

  // Test button with null check
  if (testBtn) {
    testBtn.addEventListener("click", function () {
      var promptTextEl = document.getElementById("prompt-text");
      var prompt = promptTextEl ? promptTextEl.value : "";
      var agent = agentSelect ? agentSelect.value : "";
      var model = modelSelect ? modelSelect.value : "";

      if (prompt) {
        vscode.postMessage({
          type: "testPrompt",
          prompt: prompt,
          agent: agent,
          model: model,
        });
      }
    });
  }

  // Refresh button with null check
  if (refreshBtn) {
    refreshBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "refreshTasks" });
      vscode.postMessage({ type: "refreshAgents" });
      vscode.postMessage({ type: "refreshPrompts" });
    });
  }

  if (autoShowStartupBtn) {
    autoShowStartupBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "toggleAutoShowOnStartup" });
    });
  }

  if (restoreHistoryBtn) {
    restoreHistoryBtn.addEventListener("click", function () {
      var snapshotId = scheduleHistorySelect ? scheduleHistorySelect.value : "";
      if (!snapshotId) {
        window.alert(
          strings.scheduleHistoryRestoreSelectRequired ||
            "Select a backup version first",
        );
        return;
      }

      var selectedEntry = (Array.isArray(scheduleHistory) ? scheduleHistory : []).find(
        function (entry) {
          return entry && entry.id === snapshotId;
        },
      );
      var selectedLabel = formatHistoryLabel(selectedEntry);
      var confirmText =
        (strings.scheduleHistoryRestoreConfirm ||
          "Restore the repo schedule from {createdAt}? The current state will be backed up first.")
          .replace("{createdAt}", selectedLabel)
          .replace("{timestamp}", selectedLabel);

      if (!window.confirm(confirmText)) {
        return;
      }

      vscode.postMessage({
        type: "restoreScheduleHistory",
        snapshotId: snapshotId,
      });
    });
  }

  if (researchNewBtn) {
    researchNewBtn.addEventListener("click", function () {
      isCreatingResearchProfile = true;
      selectedResearchId = "";
      resetResearchForm(null);
      renderResearchTab();
    });
  }

  if (researchSaveBtn) {
    researchSaveBtn.addEventListener("click", function () {
      var data = collectResearchFormData();
      var errorMessage = validateResearchFormData(data);
      if (errorMessage) {
        showResearchFormError(errorMessage);
        return;
      }
      clearResearchFormError();
      if (selectedResearchId) {
        vscode.postMessage({
          type: "updateResearchProfile",
          researchId: selectedResearchId,
          data: data,
        });
      } else {
        vscode.postMessage({
          type: "createResearchProfile",
          data: data,
        });
      }
    });
  }

  if (researchDuplicateBtn) {
    researchDuplicateBtn.addEventListener("click", function () {
      if (!selectedResearchId) return;
      vscode.postMessage({
        type: "duplicateResearchProfile",
        researchId: selectedResearchId,
      });
    });
  }

  if (researchDeleteBtn) {
    researchDeleteBtn.addEventListener("click", function () {
      if (!selectedResearchId) return;
      vscode.postMessage({
        type: "deleteResearchProfile",
        researchId: selectedResearchId,
      });
    });
  }

  if (researchStartBtn) {
    researchStartBtn.addEventListener("click", function () {
      if (!selectedResearchId) return;
      vscode.postMessage({
        type: "startResearchRun",
        researchId: selectedResearchId,
      });
    });
  }

  if (researchStopBtn) {
    researchStopBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "stopResearchRun" });
    });
  }

  if (researchProfileList) {
    researchProfileList.addEventListener("click", function (e) {
      var target = e && e.target;
      while (target && target !== researchProfileList) {
        if (target.getAttribute && target.getAttribute("data-research-id")) {
          break;
        }
        target = target.parentElement;
      }
      if (!target || target === researchProfileList) return;
      isCreatingResearchProfile = false;
      selectedResearchId = target.getAttribute("data-research-id") || "";
      var profile = getSelectedResearchProfile();
      resetResearchForm(profile || null);
      renderResearchTab();
    });
  }

  if (researchRunList) {
    researchRunList.addEventListener("click", function (e) {
      var target = e && e.target;
      while (target && target !== researchRunList) {
        if (target.getAttribute && target.getAttribute("data-run-id")) {
          break;
        }
        target = target.parentElement;
      }
      if (!target || target === researchRunList) return;
      selectedResearchRunId = target.getAttribute("data-run-id") || "";
      persistTaskFilter();
      renderResearchTab();
    });
  }

  if (jobsNewFolderBtn) {
    jobsNewFolderBtn.addEventListener("click", function () {
      vscode.postMessage({
        type: "requestCreateJobFolder",
        parentFolderId: selectedJobFolderId || undefined,
      });
    });
  }

  if (jobsRenameFolderBtn) {
    jobsRenameFolderBtn.addEventListener("click", function () {
      if (!selectedJobFolderId) return;
      vscode.postMessage({
        type: "requestRenameJobFolder",
        folderId: selectedJobFolderId,
      });
    });
  }

  if (jobsDeleteFolderBtn) {
    jobsDeleteFolderBtn.addEventListener("click", function () {
      if (!selectedJobFolderId) return;
      vscode.postMessage({ type: "requestDeleteJobFolder", folderId: selectedJobFolderId });
    });
  }

  if (jobsNewJobBtn) {
    jobsNewJobBtn.addEventListener("click", function () {
      vscode.postMessage({
        type: "requestCreateJob",
        folderId: selectedJobFolderId || undefined,
      });
      switchTab("jobs-edit");
    });
  }

  if (jobsBackBtn) {
    jobsBackBtn.addEventListener("click", function () {
      switchTab("jobs");
    });
  }

  if (jobsOpenEditorBtn) {
    jobsOpenEditorBtn.addEventListener("click", function () {
      openJobEditor(selectedJobId || "");
    });
  }

  if (jobsSaveBtn) {
    jobsSaveBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      vscode.postMessage({
        type: "updateJob",
        jobId: selectedJobId,
        data: {
          name: jobsNameInput ? jobsNameInput.value : "",
          cronExpression: jobsCronInput ? jobsCronInput.value : "",
          folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : undefined,
        },
      });
    });
  }

  if (jobsDuplicateBtn) {
    jobsDuplicateBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      vscode.postMessage({ type: "duplicateJob", jobId: selectedJobId });
    });
  }

  if (jobsPauseBtn) {
    jobsPauseBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      vscode.postMessage({ type: "toggleJobPaused", jobId: selectedJobId });
    });
  }

  if (jobsCompileBtn) {
    jobsCompileBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      vscode.postMessage({ type: "compileJob", jobId: selectedJobId });
    });
  }

  if (jobsStatusPill) {
    jobsStatusPill.addEventListener("click", function () {
      if (!selectedJobId) return;
      vscode.postMessage({ type: "toggleJobPaused", jobId: selectedJobId });
    });
  }

  if (jobsToggleSidebarBtn) {
    jobsToggleSidebarBtn.addEventListener("click", function () {
      jobsSidebarHidden = !jobsSidebarHidden;
      applyJobsSidebarState();
      persistTaskFilter();
    });
  }

  if (jobsDeleteBtn) {
    jobsDeleteBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      vscode.postMessage({ type: "deleteJob", jobId: selectedJobId });
    });
  }

  if (jobsAttachBtn) {
    jobsAttachBtn.addEventListener("click", function () {
      if (!selectedJobId || !jobsExistingTaskSelect || !jobsExistingTaskSelect.value) return;
      vscode.postMessage({
        type: "attachTaskToJob",
        jobId: selectedJobId,
        taskId: jobsExistingTaskSelect.value,
        windowMinutes: jobsExistingWindowInput ? Number(jobsExistingWindowInput.value || 30) : 30,
      });
    });
  }

  if (jobsCreateStepBtn) {
    jobsCreateStepBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      var name = jobsStepNameInput ? jobsStepNameInput.value.trim() : "";
      var prompt = jobsStepPromptInput ? jobsStepPromptInput.value.trim() : "";
      if (!name || !prompt) return;
      var selectedJob = getJobById(selectedJobId);
      vscode.postMessage({
        type: "createJobTask",
        jobId: selectedJobId,
        windowMinutes: jobsStepWindowInput ? Number(jobsStepWindowInput.value || 30) : 30,
        data: {
          name: name,
          prompt: prompt,
          cronExpression: selectedJob && selectedJob.cronExpression ? selectedJob.cronExpression : "0 9 * * 1-5",
          agent: jobsStepAgentSelect ? jobsStepAgentSelect.value : "",
          model: jobsStepModelSelect ? jobsStepModelSelect.value : "",
          labels: parseLabels(jobsStepLabelsInput ? jobsStepLabelsInput.value : ""),
          scope: "workspace",
          promptSource: "inline",
          oneTime: false,
        },
      });
      if (jobsStepNameInput) jobsStepNameInput.value = "";
      if (jobsStepPromptInput) jobsStepPromptInput.value = "";
      if (jobsStepLabelsInput) jobsStepLabelsInput.value = "";
      if (jobsStepWindowInput) jobsStepWindowInput.value = "30";
    });
  }

  if (jobsCreatePauseBtn) {
    jobsCreatePauseBtn.addEventListener("click", function () {
      if (!selectedJobId) return;
      var title = jobsPauseNameInput ? jobsPauseNameInput.value.trim() : "";
      vscode.postMessage({
        type: "createJobPause",
        jobId: selectedJobId,
        data: {
          title: title || strings.jobsPauseDefaultTitle || "Manual review",
        },
      });
      if (jobsPauseNameInput) {
        jobsPauseNameInput.value = "";
      }
    });
  }

  document.addEventListener("click", function (e) {
    var target = e && e.target;
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && jobsFolderList && jobsFolderList.contains(folderItem)) {
      selectedJobFolderId = folderItem.getAttribute("data-job-folder") || "";
      selectedJobId = "";
      persistTaskFilter();
      renderJobsTab();
      return;
    }

    var openJobEditorButton = target && target.closest ? target.closest("[data-job-open-editor]") : null;
    if (openJobEditorButton && jobsList && jobsList.contains(openJobEditorButton)) {
      openJobEditor(openJobEditorButton.getAttribute("data-job-open-editor") || "");
      return;
    }

    var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
    if (jobItem && jobsList && jobsList.contains(jobItem)) {
      selectedJobId = jobItem.getAttribute("data-job-id") || "";
      persistTaskFilter();
      renderJobsTab();
      return;
    }

    var jobAction = target && target.getAttribute ? target.getAttribute("data-job-action") : "";
    if (!jobAction) return;

    if (jobAction === "detach-node") {
      var detachNodeId = target.getAttribute("data-job-node-id") || "";
      if (selectedJobId && detachNodeId) {
        vscode.postMessage({ type: "requestDeleteJobTask", jobId: selectedJobId, nodeId: detachNodeId });
      }
      return;
    }

    if (jobAction === "edit-task") {
      var editTaskId = target.getAttribute("data-job-task-id") || "";
      if (editTaskId && typeof window.editTask === "function") {
        window.editTask(editTaskId);
      }
      return;
    }

    if (jobAction === "edit-pause") {
      var editPauseNodeId = target.getAttribute("data-job-node-id") || "";
      if (selectedJobId && editPauseNodeId) {
        vscode.postMessage({ type: "requestRenameJobPause", jobId: selectedJobId, nodeId: editPauseNodeId });
      }
      return;
    }

    if (jobAction === "delete-pause") {
      var deletePauseNodeId = target.getAttribute("data-job-node-id") || "";
      if (selectedJobId && deletePauseNodeId) {
        vscode.postMessage({ type: "requestDeleteJobPause", jobId: selectedJobId, nodeId: deletePauseNodeId });
      }
      return;
    }

    if (jobAction === "approve-pause") {
      var approveNodeId = target.getAttribute("data-job-node-id") || "";
      if (selectedJobId && approveNodeId) {
        vscode.postMessage({ type: "approveJobPause", jobId: selectedJobId, nodeId: approveNodeId });
      }
      return;
    }

    if (jobAction === "reject-pause") {
      var rejectNodeId = target.getAttribute("data-job-node-id") || "";
      if (selectedJobId && rejectNodeId) {
        vscode.postMessage({ type: "rejectJobPause", jobId: selectedJobId, nodeId: rejectNodeId });
      }
      return;
    }

    if (jobAction === "run-task") {
      var runTaskId = target.getAttribute("data-job-task-id") || "";
      if (runTaskId && typeof window.runTask === "function") {
        window.runTask(runTaskId);
      }
    }
  });

  document.addEventListener("change", function (e) {
    var target = e && e.target;
    if (!target) return;
    if (target.classList && target.classList.contains("job-node-window-input")) {
      if (!selectedJobId) return;
      var nodeId = target.getAttribute("data-job-node-window-id") || "";
      if (!nodeId) return;
      vscode.postMessage({
        type: "updateJobNodeWindow",
        jobId: selectedJobId,
        nodeId: nodeId,
        windowMinutes: Number(target.value || 30),
      });
    }
  });

  document.addEventListener("dragstart", function (e) {
    var target = e && e.target;
    var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
    if (jobItem && jobsList && jobsList.contains(jobItem)) {
      draggedJobId = jobItem.getAttribute("data-job-id") || "";
      if (jobItem.classList) jobItem.classList.add("dragging");
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
      return;
    }
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (!card) return;
    draggedJobNodeId = card.getAttribute("data-job-node-id") || "";
    if (card.classList) card.classList.add("dragging");
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  });

  document.addEventListener("dragend", function (e) {
    var target = e && e.target;
    var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
    if (jobItem && jobItem.classList) jobItem.classList.remove("dragging");
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (card && card.classList) card.classList.remove("dragging");
    draggedJobId = "";
    draggedJobNodeId = "";
    Array.prototype.forEach.call(document.querySelectorAll(".jobs-step-card.drag-over"), function (item) {
      if (item && item.classList) item.classList.remove("drag-over");
    });
    Array.prototype.forEach.call(document.querySelectorAll(".jobs-folder-item.drag-over"), function (item) {
      if (item && item.classList) item.classList.remove("drag-over");
    });
  });

  document.addEventListener("dragover", function (e) {
    var target = e && e.target;
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && draggedJobId) {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      if (folderItem.classList) folderItem.classList.add("drag-over");
      return;
    }
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (!card || !draggedJobNodeId) return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
    if (card.classList) card.classList.add("drag-over");
  });

  document.addEventListener("dragleave", function (e) {
    var target = e && e.target;
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && folderItem.classList) folderItem.classList.remove("drag-over");
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (card && card.classList) card.classList.remove("drag-over");
  });

  document.addEventListener("drop", function (e) {
    var target = e && e.target;
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && draggedJobId) {
      e.preventDefault();
      if (folderItem.classList) folderItem.classList.remove("drag-over");
      var droppedFolderId = folderItem.getAttribute("data-job-folder") || "";
      var draggedJob = getJobById(draggedJobId);
      if (!draggedJob) return;
      if ((draggedJob.folderId || "") === droppedFolderId) return;
      vscode.postMessage({
        type: "updateJob",
        jobId: draggedJobId,
        data: {
          folderId: droppedFolderId || undefined,
        },
      });
      return;
    }
    var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
    if (!card || !draggedJobNodeId || !selectedJobId) return;
    e.preventDefault();
    if (card.classList) card.classList.remove("drag-over");
    var targetNodeId = card.getAttribute("data-job-node-id") || "";
    var selectedJob = getJobById(selectedJobId);
    if (!selectedJob || !Array.isArray(selectedJob.nodes)) return;
    var targetIndex = selectedJob.nodes.findIndex(function (node) {
      return node && node.id === targetNodeId;
    });
    if (targetIndex < 0 || draggedJobNodeId === targetNodeId) return;
    vscode.postMessage({
      type: "reorderJobNode",
      jobId: selectedJobId,
      nodeId: draggedJobNodeId,
      targetIndex: targetIndex,
    });
  });

  // Template refresh button (Create tab)
  if (templateRefreshBtn) {
    templateRefreshBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "refreshPrompts" });

      // If a template is currently selected, re-load its content as well.
      var selectedPath = templateSelect ? templateSelect.value : "";
      var sourceEl = document.querySelector(
        'input[name="prompt-source"]:checked',
      );
      var source = sourceEl ? sourceEl.value : "inline";
      if (selectedPath && (source === "local" || source === "global")) {
        vscode.postMessage({
          type: "loadPromptTemplate",
          path: selectedPath,
          source: source,
        });
      }
    });
  }

  if (insertSkillBtn) {
    insertSkillBtn.addEventListener("click", function () {
      insertSelectedSkillReference();
    });
  }

  if (setupMcpBtn) {
    setupMcpBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "setupMcp" });
    });
  }

  // Task action delegation (single listener)
  function resolveActionTarget(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (
        el.hasAttribute &&
        el.hasAttribute("data-action") &&
        el.hasAttribute("data-id")
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener("click", function (e) {
    var actionTarget = resolveActionTarget(e.target);
    if (!actionTarget) {
      return;
    }

    if (!taskList || !taskList.isConnected) {
      taskList = document.getElementById("task-list");
    }
    if (taskList && !taskList.contains(actionTarget)) {
      return;
    }

    var action = actionTarget.getAttribute("data-action");
    var taskId = actionTarget.getAttribute("data-id");
    if (!action || !taskId) {
      return;
    }

    var actionHandlers = {
      toggle: window.toggleTask,
      run: window.runTask,
      edit: window.editTask,
      copy: window.copyPrompt,
      duplicate: window.duplicateTask,
      move: window.moveTaskToCurrentWorkspace,
      delete: window.deleteTask,
    };

    var handler = actionHandlers[action];
    if (typeof handler === "function") {
      e.preventDefault();
      handler(taskId);
    }
  });

  // Render task list
  function renderTaskList(nextTasks) {
    if (Array.isArray(nextTasks)) {
      tasks = nextTasks.filter(Boolean);
    }

    if (!taskList || !taskList.isConnected) {
      taskList = document.getElementById("task-list");
    }
    if (!taskList) return;

    var taskItems = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
    taskItems = sortTasksByNextRun(taskItems);
    if (activeLabelFilter) {
      taskItems = taskItems.filter(function (task) {
        return getEffectiveLabels(task).indexOf(activeLabelFilter) !== -1;
      });
    }
    var renderedTasks = "";

    function normalizePath(p) {
      if (!p) return "";
      var s = String(p).replace(/\\/g, "/");
      // Preserve POSIX root path ("/") and avoid collapsing it to empty.
      if (s === "/") return "/";
      s = s.replace(/\/+$/, "");
      if (s === "") return "/";
      return caseInsensitivePaths ? s.toLowerCase() : s;
    }

    function basename(p) {
      if (!p) return "";
      var s = String(p).replace(/[/\\]+$/, "");
      var parts = s.split(/[/\\]+/);
      return parts.length ? parts[parts.length - 1] || "" : s;
    }

    function renderTaskCard(task) {
      if (!task || !task.id) {
        return "";
      }

      var enabled = task.enabled || false;
      var statusClass = enabled ? "enabled" : "disabled";
      var statusText = enabled
        ? strings.labelEnabled
        : strings.labelDisabled;
      var toggleIcon = enabled ? "⏸️" : "▶️";
      var toggleTitle = enabled
        ? strings.actionDisable
        : strings.actionEnable;
      var nextRunDate = task.nextRun ? new Date(task.nextRun) : null;
      var nextRun =
        nextRunDate && !isNaN(nextRunDate.getTime())
          ? nextRunDate.toLocaleString(locale)
          : strings.labelNever;
      var nextRunCountdown = "";
      if (enabled && nextRunDate && !isNaN(nextRunDate.getTime())) {
        var diffMs = nextRunDate.getTime() - Date.now();
        if (diffMs > 0) {
          var totalSec = Math.floor(diffMs / 1000);
          nextRunCountdown = " (in " + formatCountdown(totalSec) + ")";
        } else {
          nextRunCountdown = " (due now)";
        }
      }
      var promptText = typeof task.prompt === "string" ? task.prompt : "";
      var promptPreview =
        promptText.length > 100
          ? promptText.substring(0, 100) + "..."
          : promptText;
      var lastErrorText = typeof task.lastError === "string" ? task.lastError : "";
      var lastErrorAtDate = task.lastErrorAt ? new Date(task.lastErrorAt) : null;
      var lastErrorAt =
        lastErrorAtDate && !isNaN(lastErrorAtDate.getTime())
          ? lastErrorAtDate.toLocaleString(locale)
          : "";
      var cronText = escapeHtml(task.cronExpression || "");
      var cronSummary = getCronSummary(task.cronExpression || "");
      var taskName = escapeHtml(task.name || "");

      var scopeValue = task.scope || "workspace";
      var scopeLabel =
        scopeValue === "global"
          ? strings.labelScopeGlobal || ""
          : strings.labelScopeWorkspace || "";
      var wsPath =
        scopeValue === "workspace" ? task.workspacePath || "" : "";
      var wsName = wsPath ? basename(wsPath) : "";
      var inThisWorkspace =
        scopeValue === "global"
          ? true
          : !!wsPath &&
          (workspacePaths || []).some(function (p) {
            return normalizePath(p) === normalizePath(wsPath);
          });
      var otherWsLabel = strings.labelOtherWorkspaceShort || "";
      var thisWsLabel = strings.labelThisWorkspaceShort || "";
      var scopeInfo =
        scopeValue === "global"
          ? "🌐 " + escapeHtml(scopeLabel)
          : "📁 " +
          escapeHtml(scopeLabel) +
          (wsName ? " • " + escapeHtml(wsName) : "");
      if (scopeValue === "workspace") {
        scopeInfo +=
          " • " + escapeHtml(inThisWorkspace ? thisWsLabel : otherWsLabel);
      }
      var oneTimeBadgeHtml =
        task.oneTime === true
          ? '<span class="task-badge clickable" data-action="toggle" data-id="' +
          escapeAttr(task.id || "") +
          '">' +
          escapeHtml(strings.labelOneTime || "One-time") +
          "</span>"
          : "";
      var chatSessionBadgeHtml =
        task.oneTime === true
          ? ""
          : '<span class="task-badge" title="' +
            escapeAttr(strings.labelChatSession || "Recurring chat session") +
            '">' +
            escapeHtml(
              task.chatSession === "continue"
                ? strings.labelChatSessionBadgeContinue || "Chat: Continue"
                : strings.labelChatSessionBadgeNew || "Chat: New",
            ) +
            "</span>";
      var labelBadgesHtml = getEffectiveLabels(task)
        .map(function (label) {
          return (
            '<span class="task-badge label">' +
            escapeHtml(label) +
            "</span>"
          );
        })
        .join("");

      // Escape for HTML attributes to avoid broken inline handlers
      var taskIdEscaped = escapeAttr(task.id || "");

      // --- Model & Agent Selection Logic ---
      function createSelect(items, selectedId, cls, placeholder) {
        var options = '<option value="">' + escapeHtml(placeholder) + '</option>';
        if (Array.isArray(items)) {
          items.forEach(function (item) {
            var id = item.id || item.slug;
            var label = cls && cls.indexOf("model") >= 0 ? formatModelLabel(item) : (item.name || id);
            var sel = (id === selectedId) ? ' selected' : '';
            options += '<option value="' + escapeAttr(id) + '"' + sel + '>' + escapeHtml(label) + '</option>';
          });
        }
        return '<select class="' + cls + '" data-id="' + taskIdEscaped + '" style="width: auto; max-width: 140px; display: inline-block; padding: 2px 4px; margin-right: 8px; height: 26px; font-size: 11px;">' + options + '</select>';
      }

      var agentSelect = createSelect(agents, task.agent, "task-agent-select", strings.placeholderSelectAgent || "Agent");
      var modelSelect = createSelect(models, task.model, "task-model-select", strings.placeholderSelectModel || "Model");

      var configRow = '<div class="task-config" style="margin: 4px 0 8px 0; display: flex; align-items: center;">' +
        agentSelect + modelSelect +
        '</div>';
      // -------------------------------------

      var actionsHtml =
        '<button class="btn-secondary btn-icon" data-action="toggle" data-id="' +
        taskIdEscaped +
        '" title="' +
        escapeAttr(toggleTitle) +
        '">' +
        toggleIcon +
        "</button>" +
        '<button class="btn-secondary btn-icon" data-action="run" data-id="' +
        taskIdEscaped +
        '" title="' +
        escapeAttr(strings.actionRun) +
        '">🚀</button>' +
        '<button class="btn-secondary btn-icon" data-action="edit" data-id="' +
        taskIdEscaped +
        '" title="' +
        escapeAttr(strings.actionEdit) +
        '">✏️</button>' +
        '<button class="btn-secondary btn-icon" data-action="copy" data-id="' +
        taskIdEscaped +
        '" title="' +
        escapeAttr(strings.actionCopyPrompt) +
        '">📋</button>' +
        '<button class="btn-secondary btn-icon" data-action="duplicate" data-id="' +
        taskIdEscaped +
        '" title="' +
        escapeAttr(strings.actionDuplicate) +
        '">📄</button>';

      if (scopeValue === "workspace" && !inThisWorkspace) {
        actionsHtml +=
          '<button class="btn-secondary btn-icon" data-action="move" data-id="' +
          taskIdEscaped +
          '" title="' +
          escapeAttr(strings.actionMoveToCurrentWorkspace || "") +
          '">📌</button>';
      }

      if (scopeValue === "global" || inThisWorkspace) {
        actionsHtml +=
          '<button class="btn-danger btn-icon" data-action="delete" data-id="' +
          taskIdEscaped +
          '" title="' +
          escapeAttr(strings.actionDelete) +
          '">🗑️</button>';
      }

      return (
        '<div class="task-card ' +
        (enabled ? "" : "disabled") +
        (scopeValue === "workspace" && !inThisWorkspace
          ? " other-workspace"
          : "") +
        '" data-id="' +
        taskIdEscaped +
        '">' +
        '<div class="task-header">' +
        '<div class="task-header-main">' +
        '<span class="task-name clickable" data-action="toggle" data-id="' +
        taskIdEscaped +
        '">' +
        taskName +
        "</span>" +
        chatSessionBadgeHtml +
        oneTimeBadgeHtml +
        "</div>" +
        '<span class="task-status ' +
        statusClass +
        '" data-action="toggle" data-id="' +
        taskIdEscaped +
        '">' +
        escapeHtml(statusText) +
        "</span>" +
        "</div>" +
        '<div class="task-info">' +
        "<span>⏰ " +
        escapeHtml(cronSummary) +
        "</span>" +
        "<span>" +
        escapeHtml(strings.labelNextRun) +
        ": " +
        escapeHtml(nextRun + nextRunCountdown) +
        "</span>" +
        "<span>" +
        scopeInfo +
        "</span>" +
        "</div>" +
        '<div class="task-info"><span>Cron: ' + cronText + '</span></div>' +
        (labelBadgesHtml
          ? '<div class="task-badges">' + labelBadgesHtml + "</div>"
          : "") +
        configRow +
        '<div class="task-prompt">' +
        escapeHtml(promptPreview) +
        "</div>" +
        (lastErrorText
          ? '<div class="task-prompt" style="color: var(--vscode-errorForeground);">' +
          "Last error" +
          (lastErrorAt ? " (" + escapeHtml(lastErrorAt) + ")" : "") +
          ": " +
          escapeHtml(lastErrorText) +
          "</div>"
          : "") +
        '<div class="task-actions">' +
        actionsHtml +
        "</div>" +
        "</div>"
      );
    }

    function renderTaskSection(title, items) {
      var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
      if (!listHtml) {
        listHtml =
          '<div class="empty-state">' +
          escapeHtml(strings.noTasksFound) +
          "</div>";
      }
      return (
        '<div class="task-section">' +
        '<div class="task-section-title">' +
        '<span>' +
        escapeHtml(title) +
        "</span>" +
        "<span>" +
        String(items.length) +
        "</span>" +
        "</div>" +
        listHtml +
        "</div>"
      );
    }

    var recurringTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return !isOneTime;
    });
    var oneTimeTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return isOneTime;
    });

    var sectionHtml = "";
    if (activeTaskFilter === "all" || activeTaskFilter === "recurring") {
      sectionHtml += renderTaskSection(
        strings.labelRecurringTasks || "Recurring Tasks",
        recurringTasks,
      );
    }
    if (activeTaskFilter === "all" || activeTaskFilter === "one-time") {
      sectionHtml += renderTaskSection(
        strings.labelOneTimeTasks || "One-time Tasks",
        oneTimeTasks,
      );
    }

    var containerClass = "task-sections";
    var containerStyle = "";
    if (activeTaskFilter !== "all") {
      containerClass += " filtered";
      // Inline fallback ensures filtered mode stays single-column even with stale cached CSS.
      containerStyle = ' style="display:grid;grid-template-columns:1fr;"';
    }

    renderedTasks =
      '<div class="' + containerClass + '"' + containerStyle + ">" +
      sectionHtml +
      "</div>";

    if (renderedTasks === lastRenderedTasksHtml) {
      return;
    }

    // The list refreshes every second for countdowns. Avoid replacing an open
    // inline select while the user is choosing an agent or model.
    if (isInlineTaskSelectActive()) {
      return;
    }

    lastRenderedTasksHtml = renderedTasks;
    taskList.innerHTML = renderedTasks;
  }

  // Helper functions
  function escapeHtml(text) {
    if (text == null) return "";
    var div = document.createElement("div");
    div.textContent = String(text);
    return div.innerHTML;
  }

  function escapeAttr(text) {
    if (typeof text !== "string") text = String(text || "");
    return text
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function isInlineTaskSelectActive() {
    var active = document.activeElement;
    if (!active || !active.classList) return false;
    return active.classList.contains("task-agent-select") || active.classList.contains("task-model-select");
  }

  var dayNames = [
    strings.daySun || "",
    strings.dayMon || "",
    strings.dayTue || "",
    strings.dayWed || "",
    strings.dayThu || "",
    strings.dayFri || "",
    strings.daySat || "",
  ];

  function padNumber(value) {
    var num = parseInt(String(value), 10);
    if (isNaN(num)) num = 0;
    return num < 10 ? "0" + num : String(num);
  }

  function boundedNumber(value, min, max, fallback) {
    var num = parseInt(String(value), 10);
    if (isNaN(num)) {
      num = fallback;
    }
    num = Math.max(min, Math.min(max, num));
    return num;
  }

  function normalizeDow(value) {
    var normalized = String(value || "")
      .trim()
      .toLowerCase();
    if (/^\d+$/.test(normalized)) {
      var asNumber = parseInt(normalized, 10);
      if (asNumber === 7) asNumber = 0;
      if (asNumber >= 0 && asNumber <= 6) return asNumber;
    }

    var map = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6,
    };

    if (map.hasOwnProperty(normalized)) {
      return map[normalized];
    }

    return null;
  }

  function formatTime(hour, minute) {
    return padNumber(hour) + ":" + padNumber(minute);
  }

  function getCronSummary(expression) {
    var fallback = strings.labelFriendlyFallback || "";
    var expr = (expression || "").trim();
    if (!expr) return fallback;

    var parts = expr.split(/\s+/);
    if (parts.length !== 5) {
      return fallback;
    }

    var minute = parts[0];
    var hour = parts[1];
    var dom = parts[2];
    var mon = parts[3];
    var dow = parts[4];

    var isNumber = function (value) {
      return /^\d+$/.test(String(value));
    };
    var dowLower = String(dow || "").toLowerCase();
    var isWeekdays = dowLower === "1-5" || dowLower === "mon-fri";
    var everyN = /^\*\/(\d+)$/.exec(minute);

    if (everyN && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
      var tplEveryN = strings.cronPreviewEveryNMinutes || "";
      return tplEveryN ? tplEveryN.replace("{n}", String(everyN[1])) : fallback;
    }

    if (
      isNumber(minute) &&
      hour === "*" &&
      dom === "*" &&
      mon === "*" &&
      dow === "*"
    ) {
      var tplHourly = strings.cronPreviewHourlyAtMinute || "";
      return tplHourly ? tplHourly.replace("{m}", String(minute)) : fallback;
    }

    if (
      isNumber(minute) &&
      isNumber(hour) &&
      dom === "*" &&
      mon === "*" &&
      dow === "*"
    ) {
      var tplDaily = strings.cronPreviewDailyAt || "";
      var t = formatTime(hour, minute);
      return tplDaily ? tplDaily.replace("{t}", String(t)) : fallback;
    }

    if (
      isNumber(minute) &&
      isNumber(hour) &&
      dom === "*" &&
      mon === "*" &&
      isWeekdays
    ) {
      var tplWeekdays = strings.cronPreviewWeekdaysAt || "";
      var t = formatTime(hour, minute);
      return tplWeekdays ? tplWeekdays.replace("{t}", String(t)) : fallback;
    }

    var dowValue = normalizeDow(dow);
    if (
      isNumber(minute) &&
      isNumber(hour) &&
      dom === "*" &&
      mon === "*" &&
      dowValue !== null
    ) {
      var dayLabel = dayNames[dowValue] || String(dowValue);
      var tplWeekly = strings.cronPreviewWeeklyOnAt || "";
      var t = formatTime(hour, minute);
      return tplWeekly
        ? tplWeekly.replace("{d}", String(dayLabel)).replace("{t}", String(t))
        : fallback;
    }

    if (
      isNumber(minute) &&
      isNumber(hour) &&
      isNumber(dom) &&
      mon === "*" &&
      dow === "*"
    ) {
      var tplMonthly = strings.cronPreviewMonthlyOnAt || "";
      var t = formatTime(hour, minute);
      return tplMonthly
        ? tplMonthly.replace("{dom}", String(dom)).replace("{t}", String(t))
        : fallback;
    }

    return fallback;
  }

  function updateCronPreview() {
    if (!cronPreviewText || !cronExpression) return;
    cronPreviewText.textContent = getCronSummary(cronExpression.value || "");
  }

  function updateJobsCronPreview() {
    if (!jobsCronPreviewText || !jobsCronInput) return;
    jobsCronPreviewText.textContent = getCronSummary(jobsCronInput.value || "");
  }

  function updateFriendlyVisibility() {
    var selection = friendlyFrequency ? friendlyFrequency.value : "";
    var fields = [];
    switch (selection) {
      case "every-n":
        fields = ["interval"];
        break;
      case "hourly":
        fields = ["minute"];
        break;
      case "daily":
        fields = ["hour", "minute"];
        break;
      case "weekly":
        fields = ["dow", "hour", "minute"];
        break;
      case "monthly":
        fields = ["dom", "hour", "minute"];
        break;
      default:
        fields = [];
    }

    var friendlyFields = friendlyBuilder
      ? friendlyBuilder.querySelectorAll(".friendly-field")
      : [];
    for (var i = 0; i < friendlyFields.length; i++) {
      var el = friendlyFields[i];
      if (!el || !el.getAttribute) continue;
      var fieldName = el.getAttribute("data-field");
      if (fields.indexOf(fieldName) !== -1) {
        if (el.classList) el.classList.add("visible");
        if (el.style) el.style.display = "block";
      } else {
        if (el.classList) el.classList.remove("visible");
        if (el.style) el.style.display = "none";
      }
    }
  }

  function updateJobsFriendlyVisibility() {
    var selection = jobsFriendlyFrequency ? jobsFriendlyFrequency.value : "";
    var fields = [];
    switch (selection) {
      case "every-n":
        fields = ["interval"];
        break;
      case "hourly":
        fields = ["minute"];
        break;
      case "daily":
        fields = ["hour", "minute"];
        break;
      case "weekly":
        fields = ["dow", "hour", "minute"];
        break;
      case "monthly":
        fields = ["dom", "hour", "minute"];
        break;
      default:
        fields = [];
    }

    var friendlyFields = jobsFriendlyBuilder
      ? jobsFriendlyBuilder.querySelectorAll(".friendly-field")
      : [];
    for (var i = 0; i < friendlyFields.length; i++) {
      var el = friendlyFields[i];
      if (!el || !el.getAttribute) continue;
      var fieldName = el.getAttribute("data-field");
      if (fields.indexOf(fieldName) !== -1) {
        if (el.classList) el.classList.add("visible");
        if (el.style) el.style.display = "block";
      } else {
        if (el.classList) el.classList.remove("visible");
        if (el.style) el.style.display = "none";
      }
    }
  }

  function generateCronFromFriendly() {
    if (!friendlyFrequency || !cronExpression) return;
    var selection = friendlyFrequency.value;
    var expr = "";

    switch (selection) {
      case "every-n": {
        var interval = boundedNumber(
          friendlyInterval ? friendlyInterval.value : "",
          1,
          59,
          5,
        );
        expr = "*/" + interval + " * * * *";
        break;
      }
      case "hourly": {
        var minuteValue = boundedNumber(
          friendlyMinute ? friendlyMinute.value : "",
          0,
          59,
          0,
        );
        expr = minuteValue + " * * * *";
        break;
      }
      case "daily": {
        var dailyMinute = boundedNumber(
          friendlyMinute ? friendlyMinute.value : "",
          0,
          59,
          0,
        );
        var dailyHour = boundedNumber(
          friendlyHour ? friendlyHour.value : "",
          0,
          23,
          9,
        );
        expr = dailyMinute + " " + dailyHour + " * * *";
        break;
      }
      case "weekly": {
        var weeklyMinute = boundedNumber(
          friendlyMinute ? friendlyMinute.value : "",
          0,
          59,
          0,
        );
        var weeklyHour = boundedNumber(
          friendlyHour ? friendlyHour.value : "",
          0,
          23,
          9,
        );
        var dowValue = boundedNumber(
          friendlyDow ? friendlyDow.value : "",
          0,
          6,
          1,
        );
        expr = weeklyMinute + " " + weeklyHour + " * * " + dowValue;
        break;
      }
      case "monthly": {
        var monthlyMinute = boundedNumber(
          friendlyMinute ? friendlyMinute.value : "",
          0,
          59,
          0,
        );
        var monthlyHour = boundedNumber(
          friendlyHour ? friendlyHour.value : "",
          0,
          23,
          9,
        );
        var domValue = boundedNumber(
          friendlyDom ? friendlyDom.value : "",
          1,
          31,
          1,
        );
        expr = monthlyMinute + " " + monthlyHour + " " + domValue + " * *";
        break;
      }
      default:
        expr = "";
    }

    if (expr) {
      cronExpression.value = expr;
      if (cronPreset) cronPreset.value = "";
      updateCronPreview();
    }
  }

  function generateJobsCronFromFriendly() {
    if (!jobsFriendlyFrequency || !jobsCronInput) return;
    var selection = jobsFriendlyFrequency.value;
    var expr = "";

    switch (selection) {
      case "every-n": {
        var interval = boundedNumber(
          jobsFriendlyInterval ? jobsFriendlyInterval.value : "",
          1,
          59,
          5,
        );
        expr = "*/" + interval + " * * * *";
        break;
      }
      case "hourly": {
        var minuteValue = boundedNumber(
          jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
          0,
          59,
          0,
        );
        expr = minuteValue + " * * * *";
        break;
      }
      case "daily": {
        var dailyMinute = boundedNumber(
          jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
          0,
          59,
          0,
        );
        var dailyHour = boundedNumber(
          jobsFriendlyHour ? jobsFriendlyHour.value : "",
          0,
          23,
          9,
        );
        expr = dailyMinute + " " + dailyHour + " * * *";
        break;
      }
      case "weekly": {
        var weeklyMinute = boundedNumber(
          jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
          0,
          59,
          0,
        );
        var weeklyHour = boundedNumber(
          jobsFriendlyHour ? jobsFriendlyHour.value : "",
          0,
          23,
          9,
        );
        var dowValue = boundedNumber(
          jobsFriendlyDow ? jobsFriendlyDow.value : "",
          0,
          6,
          1,
        );
        expr = weeklyMinute + " " + weeklyHour + " * * " + dowValue;
        break;
      }
      case "monthly": {
        var monthlyMinute = boundedNumber(
          jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
          0,
          59,
          0,
        );
        var monthlyHour = boundedNumber(
          jobsFriendlyHour ? jobsFriendlyHour.value : "",
          0,
          23,
          9,
        );
        var domValue = boundedNumber(
          jobsFriendlyDom ? jobsFriendlyDom.value : "",
          1,
          31,
          1,
        );
        expr = monthlyMinute + " " + monthlyHour + " " + domValue + " * *";
        break;
      }
      default:
        expr = "";
    }

    if (expr) {
      jobsCronInput.value = expr;
      if (jobsCronPreset) jobsCronPreset.value = "";
      updateJobsCronPreview();
    }
  }

  function resetForm() {
    if (taskForm) taskForm.reset();
    setEditingMode(null);
    pendingAgentValue = "";
    pendingModelValue = "";
    pendingTemplatePath = "";
    editingTaskEnabled = true;
    applyPromptSource("inline");
    if (friendlyFrequency) friendlyFrequency.value = "";
    if (jitterSecondsInput)
      jitterSecondsInput.value = String(defaultJitterSeconds);
    if (taskLabelsInput) taskLabelsInput.value = "";
    var runFirstEl = document.getElementById("run-first");
    if (runFirstEl) runFirstEl.checked = false;
    var oneTimeEl = document.getElementById("one-time");
    if (oneTimeEl) oneTimeEl.checked = false;
    if (chatSessionSelect) chatSessionSelect.value = defaultChatSession;
    if (agentSelect) agentSelect.value = executionDefaults.agent || "";
    if (modelSelect) modelSelect.value = executionDefaults.model || "";
    syncRecurringChatSessionUi();
    updateFriendlyVisibility();
    updateCronPreview();
  }

  function updateAgentOptions() {
    if (!agentSelect) return;
    var items = Array.isArray(agents) ? agents : [];
    if (items.length === 0) {
      var noText = strings.placeholderNoAgents || "";
      agentSelect.innerHTML =
        '<option value="">' + escapeHtml(noText) + "</option>";
    } else {
      var selectText = strings.placeholderSelectAgent || "";
      var placeholder =
        '<option value="">' + escapeHtml(selectText) + "</option>";
      agentSelect.innerHTML =
        placeholder +
        items
          .map(function (a) {
            return (
              '<option value="' +
              escapeAttr(a.id) +
              '">' +
              escapeHtml(a.name) +
              "</option>"
            );
          })
          .join("");

      // Apply configured default agent if available and no selection made
      if (!agentSelect.value) {
        var defaultAgentId = executionDefaults && typeof executionDefaults.agent === "string"
          ? executionDefaults.agent
          : "agent";
        var hasDefaultAgent = items.find(function (a) { return a.id === defaultAgentId; });
        if (hasDefaultAgent) {
          agentSelect.value = defaultAgentId;
        }
      }
    }
  }

  function updateModelOptions() {
    if (!modelSelect) return;
    var items = Array.isArray(models) ? models : [];
    if (items.length === 0) {
      var noText = strings.placeholderNoModels || "";
      modelSelect.innerHTML =
        '<option value="">' + escapeHtml(noText) + "</option>";
    } else {
      var selectText = strings.placeholderSelectModel || "";
      var placeholder =
        '<option value="">' + escapeHtml(selectText) + "</option>";
      modelSelect.innerHTML =
        placeholder +
        items
          .map(function (m) {
            return (
              '<option value="' +
              escapeAttr(m.id) +
              '">' +
              escapeHtml(formatModelLabel(m)) +
              "</option>"
            );
          })
          .join("");

      // Apply configured default model if available and no selection made
      if (!modelSelect.value) {
        var defaultModelId = executionDefaults && typeof executionDefaults.model === "string"
          ? executionDefaults.model
          : "";
        var hasDefault = items.find(function (m) { return m.id === defaultModelId; });
        if (hasDefault) {
          modelSelect.value = defaultModelId;
        }
      }
    }
  }

  function updateTemplateOptions(source, selectedPath) {
    if (!templateSelect) return;
    selectedPath = selectedPath || "";
    var templates = Array.isArray(promptTemplates) ? promptTemplates : [];
    var filtered = templates.filter(function (t) {
      return t.source === source;
    });
    var selectText = strings.placeholderSelectTemplate || "";
    var placeholder =
      '<option value="">' + escapeHtml(selectText) + "</option>";
    templateSelect.innerHTML =
      placeholder +
      filtered
        .map(function (t) {
          return (
            '<option value="' +
            escapeAttr(t.path) +
            '">' +
            escapeHtml(t.name) +
            "</option>"
          );
        })
        .join("");

    if (!selectedPath) {
      templateSelect.value = "";
      return;
    }

    templateSelect.value = selectedPath;
    if (templateSelect.value !== selectedPath) {
      templateSelect.value = "";
    }
  }

  function applyPromptSource(source, keepSelection) {
    var effectiveSource = source || "inline";
    var selectedPath =
      keepSelection && templateSelect ? templateSelect.value : "";

    if (effectiveSource === "inline") {
      if (templateSelectGroup) templateSelectGroup.style.display = "none";
      if (promptGroup) promptGroup.style.display = "block";
      if (!keepSelection && templateSelect) {
        templateSelect.value = "";
      }
      return;
    }

    if (templateSelectGroup) {
      templateSelectGroup.style.display = "block";
    } else {
      console.warn(
        "[CopilotScheduler] Template select group missing; template selection is disabled.",
      );
    }
    if (promptGroup) promptGroup.style.display = "block";
    updateTemplateOptions(effectiveSource, selectedPath);
  }

  function updateSkillOptions() {
    if (!skillSelect) return;
    var items = Array.isArray(skills) ? skills : [];
    var placeholder = strings.placeholderSelectSkill || "Select a skill";
    skillSelect.innerHTML =
      '<option value="">' +
      escapeHtml(placeholder) +
      "</option>" +
      items
        .map(function (skill) {
          return (
            '<option value="' +
            escapeAttr(skill.path || "") +
            '">' +
            escapeHtml(skill.reference || skill.name || "") +
            "</option>"
          );
        })
        .join("");
  }

  function insertSelectedSkillReference() {
    if (!skillSelect || !promptGroup) return;
    var selectedPath = skillSelect.value || "";
    if (!selectedPath) return;
    var selectedSkill = (Array.isArray(skills) ? skills : []).find(function (skill) {
      return skill && skill.path === selectedPath;
    });
    if (!selectedSkill) return;

    var sourceRadio = document.querySelector('input[name="prompt-source"][value="inline"]');
    if (sourceRadio) {
      sourceRadio.checked = true;
    }
    applyPromptSource("inline", false);

    var promptTextEl = document.getElementById("prompt-text");
    if (!promptTextEl) return;
    var template = strings.skillSentenceTemplate || "Use {skill} to know how things must be done.";
    var sentence = template.replace("{skill}", selectedSkill.reference || selectedSkill.name || "skill");
    var current = promptTextEl.value || "";
    promptTextEl.value = current.trim()
      ? current.replace(/\s*$/, "\n\n") + sentence
      : sentence;
    if (typeof promptTextEl.focus === "function") {
      promptTextEl.focus();
    }
  }

  function updateSimpleSelect(selectEl, items, placeholder, selectedValue, getValue, getLabel) {
    if (!selectEl) return;
    var optionItems = Array.isArray(items) ? items : [];
    var html =
      '<option value="">' +
      escapeHtml(placeholder || "") +
      "</option>" +
      optionItems
        .map(function (item) {
          var value = getValue(item);
          var label = getLabel(item);
          return (
            '<option value="' +
            escapeAttr(value) +
            '">' +
            escapeHtml(label) +
            "</option>"
          );
        })
        .join("");
    selectEl.innerHTML = html;
    selectEl.value = selectedValue || "";
    if (selectEl.value !== (selectedValue || "")) {
      selectEl.value = "";
    }
  }

  function syncJobsFolderSelect(selectedValue) {
    updateSimpleSelect(
      jobsFolderSelect,
      Array.isArray(jobFolders) ? jobFolders.slice().sort(function (a, b) {
        return String(a && a.name || "").localeCompare(String(b && b.name || ""));
      }) : [],
      strings.jobsRootFolder || "All jobs",
      selectedValue || "",
      function (folder) {
        return folder && folder.id ? folder.id : "";
      },
      function (folder) {
        var depth = getFolderDepth(folder);
        var prefix = new Array(depth + 1).join("  ");
        return prefix + (folder && folder.name ? folder.name : "");
      },
    );
  }

  function syncJobsStepSelectors() {
    updateSimpleSelect(
      jobsStepAgentSelect,
      agents,
      strings.placeholderSelectAgent || "Select agent",
      jobsStepAgentSelect ? jobsStepAgentSelect.value : "",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return item && item.name ? item.name : "";
      },
    );
    updateSimpleSelect(
      jobsStepModelSelect,
      models,
      strings.placeholderSelectModel || "Select model",
      jobsStepModelSelect ? jobsStepModelSelect.value : "",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return item && item.name ? item.name : "";
      },
    );
  }

  function syncJobsExistingTaskSelect() {
    var standaloneTasks = getStandaloneTasks();
    updateSimpleSelect(
      jobsExistingTaskSelect,
      standaloneTasks,
      strings.jobsNoStandaloneTasks || "No standalone tasks available",
      jobsExistingTaskSelect ? jobsExistingTaskSelect.value : "",
      function (task) {
        return task && task.id ? task.id : "";
      },
      function (task) {
        return task && task.name ? task.name : "";
      },
    );
    if (jobsAttachBtn) {
      jobsAttachBtn.disabled = standaloneTasks.length === 0;
    }
  }

  function ensureValidResearchSelection() {
    var profiles = Array.isArray(researchProfiles) ? researchProfiles : [];
    if (isCreatingResearchProfile) {
      if (researchEditIdInput) {
        researchEditIdInput.value = "";
      }
      return;
    }
    var hasSelected = profiles.some(function (profile) {
      return profile && profile.id === selectedResearchId;
    });
    if (!hasSelected) {
      selectedResearchId = profiles.length > 0 && profiles[0] ? profiles[0].id : "";
    }
    if (researchEditIdInput) {
      researchEditIdInput.value = selectedResearchId || "";
    }
  }

  function clearResearchFormError() {
    if (!researchFormError) {
      return;
    }
    researchFormError.textContent = "";
    researchFormError.style.display = "none";
  }

  function showResearchFormError(message) {
    if (!researchFormError) {
      return;
    }
    researchFormError.textContent = String(message || "");
    researchFormError.style.display = message ? "block" : "none";
  }

  function formatResearchDate(value) {
    if (!value) {
      return "-";
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(locale);
  }

  function formatResearchDuration(startedAt, finishedAt) {
    if (!startedAt) {
      return "-";
    }
    var start = new Date(startedAt).getTime();
    if (!isFinite(start)) {
      return "-";
    }
    var end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
    if (!isFinite(end) || end < start) {
      return "-";
    }
    var totalSeconds = Math.max(0, Math.floor((end - start) / 1000));
    return formatCountdown(totalSeconds);
  }

  function formatOutcomeLabel(outcome) {
    return String(outcome || "").replace(/-/g, " ");
  }

  function getResearchRunById(runId) {
    return (Array.isArray(recentResearchRuns) ? recentResearchRuns : []).find(function (run) {
      return run && run.id === runId;
    });
  }

  function ensureValidResearchRunSelection() {
    var runs = Array.isArray(recentResearchRuns) ? recentResearchRuns : [];
    var activeId = activeResearchRun && activeResearchRun.id ? activeResearchRun.id : "";
    var hasSelected = runs.some(function (run) {
      return run && run.id === selectedResearchRunId;
    });
    if (hasSelected) {
      return;
    }
    if (activeId) {
      selectedResearchRunId = activeId;
      return;
    }
    selectedResearchRunId = runs.length > 0 && runs[0] ? runs[0].id : "";
  }

  function getDisplayedResearchRun() {
    ensureValidResearchRunSelection();
    return getResearchRunById(selectedResearchRunId) || null;
  }

  function parseResearchEditablePaths(raw) {
    return String(raw || "")
      .split(/\r?\n/)
      .map(function (line) {
        return String(line || "").trim();
      })
      .filter(function (line) {
        return line.length > 0;
      });
  }

  function getSelectedResearchProfile() {
    return (Array.isArray(researchProfiles) ? researchProfiles : []).find(function (profile) {
      return profile && profile.id === selectedResearchId;
    });
  }

  function formatResearchStatus(status) {
    if (status === "running") return strings.researchStatusRunning || "Running";
    if (status === "stopping") return strings.researchStatusStopping || "Stopping";
    if (status === "completed") return strings.researchStatusCompleted || "Completed";
    if (status === "failed") return strings.researchStatusFailed || "Failed";
    if (status === "stopped") return strings.researchStatusStopped || "Stopped";
    return strings.researchStatusIdle || "Idle";
  }

  function resetResearchForm(profile) {
    var value = profile || null;
    selectedResearchId = value && value.id ? value.id : "";
    loadedResearchProfileId = selectedResearchId || "";
    researchFormDirty = false;
    isCreatingResearchProfile = !selectedResearchId;
    clearResearchFormError();
    if (researchEditIdInput) {
      researchEditIdInput.value = selectedResearchId || "";
    }
    if (researchNameInput) {
      researchNameInput.value = value && value.name ? value.name : "";
    }
    if (researchInstructionsInput) {
      researchInstructionsInput.value = value && value.instructions ? value.instructions : "";
    }
    if (researchEditablePathsInput) {
      researchEditablePathsInput.value = value && Array.isArray(value.editablePaths)
        ? value.editablePaths.join("\n")
        : "";
    }
    if (researchBenchmarkInput) {
      researchBenchmarkInput.value = value && value.benchmarkCommand ? value.benchmarkCommand : "";
    }
    if (researchMetricPatternInput) {
      researchMetricPatternInput.value = value && value.metricPattern ? value.metricPattern : "";
    }
    if (researchMetricDirectionSelect) {
      researchMetricDirectionSelect.value = value && value.metricDirection === "minimize"
        ? "minimize"
        : "maximize";
    }
    if (researchMaxIterationsInput) {
      researchMaxIterationsInput.value = String(value && value.maxIterations !== undefined ? value.maxIterations : 3);
    }
    if (researchMaxMinutesInput) {
      researchMaxMinutesInput.value = String(value && value.maxMinutes !== undefined ? value.maxMinutes : 15);
    }
    if (researchMaxFailuresInput) {
      researchMaxFailuresInput.value = String(value && value.maxConsecutiveFailures !== undefined ? value.maxConsecutiveFailures : 2);
    }
    if (researchBenchmarkTimeoutInput) {
      researchBenchmarkTimeoutInput.value = String(value && value.benchmarkTimeoutSeconds !== undefined ? value.benchmarkTimeoutSeconds : 180);
    }
    if (researchEditWaitInput) {
      researchEditWaitInput.value = String(value && value.editWaitSeconds !== undefined ? value.editWaitSeconds : 20);
    }
    if (researchAgentSelect) {
      researchAgentSelect.value = value && value.agent ? value.agent : "";
    }
    if (researchModelSelect) {
      researchModelSelect.value = value && value.model ? value.model : "";
    }
    persistTaskFilter();
  }

  function collectResearchFormData() {
    return {
      name: researchNameInput ? researchNameInput.value : "",
      instructions: researchInstructionsInput ? researchInstructionsInput.value : "",
      editablePaths: parseResearchEditablePaths(
        researchEditablePathsInput ? researchEditablePathsInput.value : "",
      ),
      benchmarkCommand: researchBenchmarkInput ? researchBenchmarkInput.value : "",
      metricPattern: researchMetricPatternInput ? researchMetricPatternInput.value : "",
      metricDirection:
        researchMetricDirectionSelect && researchMetricDirectionSelect.value === "minimize"
          ? "minimize"
          : "maximize",
      maxIterations: researchMaxIterationsInput ? Number(researchMaxIterationsInput.value || 0) : 0,
      maxMinutes: researchMaxMinutesInput ? Number(researchMaxMinutesInput.value || 0) : 0,
      maxConsecutiveFailures: researchMaxFailuresInput ? Number(researchMaxFailuresInput.value || 0) : 0,
      benchmarkTimeoutSeconds: researchBenchmarkTimeoutInput ? Number(researchBenchmarkTimeoutInput.value || 0) : 0,
      editWaitSeconds: researchEditWaitInput ? Number(researchEditWaitInput.value || 0) : 0,
      agent: researchAgentSelect ? researchAgentSelect.value : "",
      model: researchModelSelect ? researchModelSelect.value : "",
    };
  }

  function validateResearchFormData(data) {
    if (!String(data.name || "").trim()) {
      return strings.researchProfileNameRequired || "Research profile name is required.";
    }
    if (!String(data.benchmarkCommand || "").trim()) {
      return strings.researchBenchmarkRequired || "Benchmark command is required.";
    }
    if (!String(data.metricPattern || "").trim()) {
      return strings.researchMetricRequired || "Metric regex is required.";
    }
    if (!Array.isArray(data.editablePaths) || data.editablePaths.length === 0) {
      return strings.researchEditableRequired || "Add at least one editable file path.";
    }
    return "";
  }

  function syncResearchSelectors() {
    updateSimpleSelect(
      researchAgentSelect,
      agents,
      strings.placeholderSelectAgent || "Select agent",
      researchAgentSelect ? researchAgentSelect.value : "",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return item && item.name ? item.name : "";
      },
    );
    updateSimpleSelect(
      researchModelSelect,
      models,
      strings.placeholderSelectModel || "Select model",
      researchModelSelect ? researchModelSelect.value : "",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return item && item.name ? item.name : "";
      },
    );
  }

  function renderResearchProfiles() {
    ensureValidResearchSelection();
    if (!researchProfileList) {
      return;
    }
    var profiles = Array.isArray(researchProfiles) ? researchProfiles.slice() : [];
    profiles.sort(function (a, b) {
      return String(a && a.name || "").localeCompare(String(b && b.name || ""));
    });
    if (profiles.length === 0) {
      researchProfileList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.researchEmptyProfiles || "No research profiles yet.") + "</div>";
      resetResearchForm(null);
      return;
    }

    researchProfileList.innerHTML = profiles.map(function (profile) {
      var isActive = profile && profile.id === selectedResearchId;
      return (
        '<div class="research-card' + (isActive ? ' active' : '') + '" data-research-id="' +
        escapeAttr(profile.id || "") + '">' +
        '<div class="research-card-header">' +
        '<strong>' + escapeHtml(profile.name || "") + '</strong>' +
        '<span class="jobs-pill">' + escapeHtml(profile.metricDirection === "minimize"
          ? (strings.researchDirectionMinimize || "Minimize")
          : (strings.researchDirectionMaximize || "Maximize")) + '</span>' +
        '</div>' +
        '<div class="research-meta">' +
        escapeHtml(profile.benchmarkCommand || "") +
        '</div>' +
        '<div class="research-chip-row">' +
        '<span class="research-chip">' + escapeHtml((strings.researchEditableCount || 'Editable files') + ': ' + String((profile.editablePaths || []).length)) + '</span>' +
        '<span class="research-chip">' + escapeHtml((strings.researchBudgetShort || 'Budget') + ': ' + String(profile.maxIterations || 0) + ' / ' + String(profile.maxMinutes || 0) + 'm') + '</span>' +
        '<span class="research-chip">' + escapeHtml((strings.researchMetricPatternShort || 'Metric') + ': ' + String(profile.metricPattern || '')) + '</span>' +
        '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderResearchRuns() {
    if (!researchRunList) {
      return;
    }
    var runs = Array.isArray(recentResearchRuns) ? recentResearchRuns : [];
    if (runs.length === 0) {
      researchRunList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.researchEmptyRuns || "No research runs yet.") + "</div>";
      return;
    }
    researchRunList.innerHTML = runs.map(function (run) {
      var lastAttempt = Array.isArray(run.attempts) && run.attempts.length > 0
        ? run.attempts[run.attempts.length - 1]
        : null;
      var isActive = run && run.id === selectedResearchRunId;
      return (
        '<div class="research-run-card' + (isActive ? ' active' : '') + '" data-run-id="' + escapeAttr(run.id || '') + '">' +
        '<div class="research-run-card-header">' +
        '<strong>' + escapeHtml(run.profileName || "") + '</strong>' +
        '<span class="jobs-pill">' + escapeHtml(formatResearchStatus(run.status)) + '</span>' +
        '</div>' +
        '<div class="research-run-meta">' +
        escapeHtml('Best: ' + (run.bestScore !== undefined ? String(run.bestScore) : (strings.researchNoScore || 'No score yet'))) + '\n' +
        escapeHtml('Duration: ' + formatResearchDuration(run.startedAt, run.finishedAt)) + '\n' +
        escapeHtml('Attempts: ' + String(Array.isArray(run.attempts) ? run.attempts.length : 0)) +
        (lastAttempt ? '\n' + escapeHtml('Last: ' + (lastAttempt.summary || lastAttempt.outcome || '')) : '') +
        '</div>' +
        '</div>'
      );
    }).join("");
  }

  function renderResearchActiveRun() {
    if (!researchActiveEmpty || !researchActiveDetails) {
      return;
    }
    var run = getDisplayedResearchRun();
    if (researchRunTitle) {
      researchRunTitle.textContent = strings.researchActiveRunTitle || "Run details";
    }
    if (!run) {
      researchActiveEmpty.style.display = "block";
      researchActiveDetails.style.display = "none";
      researchActiveEmpty.textContent = strings.researchNoRunSelected || "Select a recent run to inspect its attempts.";
      if (researchAttemptList) {
        researchAttemptList.innerHTML = "";
      }
      return;
    }

    researchActiveEmpty.style.display = "none";
    researchActiveDetails.style.display = "block";
    var attempts = Array.isArray(run.attempts) ? run.attempts : [];
    var lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
    if (researchActiveStatus) {
      researchActiveStatus.textContent = formatResearchStatus(run.status);
    }
    if (researchActiveBest) {
      researchActiveBest.textContent = run.bestScore !== undefined
        ? String(run.bestScore)
        : (strings.researchNoScore || "No score yet");
    }
    if (researchActiveAttempts) {
      researchActiveAttempts.textContent = String(attempts.length);
    }
    if (researchActiveLastOutcome) {
      researchActiveLastOutcome.textContent = lastAttempt
        ? String(lastAttempt.outcome || "-")
        : "-";
    }
    if (researchActiveMeta) {
      researchActiveMeta.textContent = [
        run.profileName || "",
        (strings.researchStartedAt || "Started") + ": " + formatResearchDate(run.startedAt),
        (strings.researchFinishedAt || "Finished") + ": " + formatResearchDate(run.finishedAt),
        (strings.researchDuration || "Duration") + ": " + formatResearchDuration(run.startedAt, run.finishedAt),
        (strings.researchBaselineScore || "Baseline score") + ": " + (run.baselineScore !== undefined ? String(run.baselineScore) : (strings.researchNoScore || "No score yet")),
        (strings.researchBestScore || "Best score") + ": " + (run.bestScore !== undefined ? String(run.bestScore) : (strings.researchNoScore || "No score yet")),
        (strings.researchCompletedIterations || "Completed iterations") + ": " + String(run.completedIterations || 0),
        run.stopReason ? (strings.researchStopReason || "Stop reason") + ": " + run.stopReason : "",
      ].filter(Boolean).join("\n");
    }
    if (researchAttemptList) {
      researchAttemptList.innerHTML = attempts.map(function (attempt) {
        var title = attempt.iteration === 0
          ? (strings.researchBaselineLabel || "Baseline")
          : (strings.researchIterationLabel || "Iteration") + ' ' + attempt.iteration;
        var metaLines = [
          attempt.summary || "",
          (strings.researchStartedAt || "Started") + ": " + formatResearchDate(attempt.startedAt),
          attempt.finishedAt
            ? (strings.researchFinishedAt || "Finished") + ": " + formatResearchDate(attempt.finishedAt)
            : "",
          attempt.score !== undefined ? "Score: " + String(attempt.score) : "",
          attempt.bestScoreAfter !== undefined
            ? (strings.researchBestScore || "Best score") + ": " + String(attempt.bestScoreAfter)
            : "",
          attempt.exitCode !== undefined
            ? (strings.researchExitCode || "Exit code") + ": " + String(attempt.exitCode)
            : "",
        ].filter(Boolean);
        var pathLines = [];
        if (Array.isArray(attempt.changedPaths) && attempt.changedPaths.length > 0) {
          pathLines.push(
            (strings.researchChangedFiles || "Changed files") + ": " + attempt.changedPaths.join(", "),
          );
        }
        if (
          Array.isArray(attempt.policyViolationPaths) &&
          attempt.policyViolationPaths.length > 0
        ) {
          pathLines.push(
            (strings.researchViolationFiles || "Policy violation files") + ": " + attempt.policyViolationPaths.join(", "),
          );
        }
        if (attempt.snapshot && attempt.snapshot.label) {
          pathLines.push(
            (strings.researchSnapshot || "Snapshot") + ": " + attempt.snapshot.label,
          );
        }
        return (
          '<div class="research-attempt-card">' +
          '<div class="research-attempt-card-header">' +
          '<strong>' + escapeHtml(title) + '</strong>' +
          '<span class="jobs-pill">' + escapeHtml(formatOutcomeLabel(attempt.outcome || "")) + '</span>' +
          '</div>' +
          '<div class="research-attempt-meta">' +
          escapeHtml(metaLines.join('\n')) +
          '</div>' +
          (pathLines.length > 0
            ? '<div class="research-attempt-paths">' + escapeHtml(pathLines.join('\n')) + '</div>'
            : '') +
            (attempt.output
              ? '<div class="research-output"><details><summary>' + escapeHtml(strings.researchBenchmarkOutput || 'Benchmark output') + '</summary><pre>' + escapeHtml(attempt.output) + '</pre></details></div>'
              : '') +
          '</div>'
        );
      }).join("");
    }
  }

  function renderResearchTab() {
    renderResearchProfiles();
    renderResearchRuns();
    renderResearchActiveRun();
    var selected = getSelectedResearchProfile();
    if (!researchFormDirty) {
      resetResearchForm(selected || null);
    } else if (researchEditIdInput) {
      researchEditIdInput.value = selectedResearchId || "";
    }
    if (researchSaveBtn) {
      researchSaveBtn.textContent = isCreatingResearchProfile
        ? (strings.researchCreateProfile || strings.researchSaveProfile || "Create Profile")
        : (strings.researchSaveProfile || "Save Profile");
    }
    if (researchDuplicateBtn) {
      researchDuplicateBtn.disabled = !selectedResearchId;
    }
    if (researchDeleteBtn) {
      researchDeleteBtn.disabled = !selectedResearchId;
    }
    if (researchStartBtn) {
      researchStartBtn.disabled = !selectedResearchId || (activeResearchRun && activeResearchRun.status === "running");
    }
    if (researchStopBtn) {
      researchStopBtn.disabled = !(activeResearchRun && (activeResearchRun.status === "running" || activeResearchRun.status === "stopping"));
    }
    persistTaskFilter();
  }

  function submitTelegramForm(messageType) {
    clearTelegramFeedback();
    var data = collectTelegramFormData();
    var validationError = validateTelegramFormData(data);
    if (validationError) {
      showTelegramFeedback(validationError, true);
      return;
    }
    vscode.postMessage({ type: messageType, data: data });
    showTelegramFeedback(
      messageType === "saveTelegramNotification"
        ? (strings.telegramStatusSaved || "Saving Telegram settings...")
        : (strings.telegramTest || "Sending test message..."),
      false,
    );
  }

  function markResearchFormDirty() {
    researchFormDirty = true;
    clearResearchFormError();
  }

  function hookResearchFormDirtyTracking() {
    [
      researchNameInput,
      researchInstructionsInput,
      researchEditablePathsInput,
      researchBenchmarkInput,
      researchMetricPatternInput,
      researchMetricDirectionSelect,
      researchMaxIterationsInput,
      researchMaxMinutesInput,
      researchMaxFailuresInput,
      researchBenchmarkTimeoutInput,
      researchEditWaitInput,
      researchAgentSelect,
      researchModelSelect,
    ].forEach(function (element) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("input", markResearchFormDirty);
      element.addEventListener("change", markResearchFormDirty);
    });
  }

  function renderJobsTab() {
    ensureValidJobSelection();
    persistTaskFilter();

    if (jobsCurrentFolderBanner) {
      var selectedFolder = getSelectedJobFolder();
      var isArchive = isArchiveFolder(selectedFolder);
      var currentFolderName = selectedJobFolderId
        ? ((selectedFolder || {}).name || (strings.jobsRootFolder || "All jobs"))
        : (strings.jobsRootFolder || "All jobs");
      jobsCurrentFolderBanner.innerHTML =
        '<div>' +
        '<span class="jobs-current-folder-label">' + escapeHtml(strings.jobsCurrentFolderLabel || "Current folder") + '</span>' +
        '<strong class="jobs-current-folder-name">' + escapeHtml(isArchive ? (strings.jobsArchiveFolderBadge || currentFolderName) : currentFolderName) + '</strong>' +
        '<div class="jobs-folder-path">' + escapeHtml(getFolderPath(selectedJobFolderId)) + '</div>' +
        '</div>' +
        '<span class="jobs-pill' + (isArchive ? ' is-inactive' : '') + '">' + escapeHtml(strings.jobsCurrentFolderBadge || "Current") + '</span>';
    }

    if (jobsRenameFolderBtn) jobsRenameFolderBtn.disabled = !selectedJobFolderId;
    if (jobsDeleteFolderBtn) jobsDeleteFolderBtn.disabled = !selectedJobFolderId;

    if (jobsFolderList) {
      var folderItems = (Array.isArray(jobFolders) ? jobFolders.slice() : []).sort(function (a, b) {
        var archiveDiff = (isArchiveFolder(a) ? 1 : 0) - (isArchiveFolder(b) ? 1 : 0);
        if (archiveDiff !== 0) return archiveDiff;
        var depthDiff = getFolderDepth(a) - getFolderDepth(b);
        if (depthDiff !== 0) return depthDiff;
        return String(a && a.name || "").localeCompare(String(b && b.name || ""));
      });

      var rootClass = selectedJobFolderId ? "jobs-folder-item" : "jobs-folder-item active";
      var folderHtml =
        '<div class="' + rootClass + '" data-job-folder="">' +
        '<div class="jobs-folder-item-header"><span>' +
        escapeHtml(strings.jobsRootFolder || "All jobs") +
        '</span><span class="jobs-pill">' +
        String((Array.isArray(jobs) ? jobs : []).filter(function (job) {
          return job && !(job.folderId || "");
        }).length) +
        '</span></div></div>';

      folderHtml += folderItems
        .map(function (folder) {
          var depth = getFolderDepth(folder);
          var isActive = folder && folder.id === selectedJobFolderId;
          var archiveClass = isArchiveFolder(folder) ? " is-archive" : "";
          var count = (Array.isArray(jobs) ? jobs : []).filter(function (job) {
            return job && job.folderId === folder.id;
          }).length;
          var indent = new Array(depth + 1)
            .join('<span class="jobs-folder-indent"></span>');
          var folderPath = getFolderPath(folder.id);
          return (
            '<div class="jobs-folder-item' +
            (isActive ? ' active' : '') +
            archiveClass +
            '" data-job-folder="' +
            escapeAttr(folder.id || "") +
            '">' +
            '<div class="jobs-folder-item-header">' +
            '<span>' + indent + escapeHtml(folder.name || "") + '</span>' +
            '<span class="jobs-pill">' + String(count) + '</span>' +
            '</div>' +
            (isArchiveFolder(folder)
              ? '<div class="jobs-folder-path"><span class="jobs-pill is-inactive">' + escapeHtml(strings.jobsArchiveFolderBadge || "Archived jobs") + '</span></div>'
              : '<div class="jobs-folder-path">' + escapeHtml(folderPath) + '</div>') +
            '</div>'
          );
        })
        .join("");
      jobsFolderList.innerHTML = folderHtml || ('<div class="jobs-empty">' + escapeHtml(strings.jobsNoFolders || "No folders yet.") + '</div>');
    }

    if (jobsList) {
      var visibleJobs = getVisibleJobs();
      if (visibleJobs.length === 0) {
        jobsList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.jobsNoJobs || "No jobs in this folder yet.") + '</div>';
      } else {
        jobsList.innerHTML = visibleJobs
          .map(function (job) {
                var scheduleSummary = getCronSummary(job.cronExpression || "");
                var scheduleLabel =
                  scheduleSummary !== (strings.labelFriendlyFallback || "")
                    ? scheduleSummary
                    : (job.cronExpression || "");
              var statusClass = "";
              if (job && job.runtime && job.runtime.waitingPause) {
                statusClass = " is-waiting";
              } else if (job && (job.paused || job.archived)) {
                statusClass = " is-inactive";
              }
            return (
              '<div class="jobs-list-item' +
              (job.id === selectedJobId ? ' active' : '') +
              '" data-job-id="' + escapeAttr(job.id || "") + '" draggable="true">' +
              '<div class="jobs-list-item-header">' +
              '<strong>' + escapeHtml(job.name || "") + '</strong>' +
                '<span class="jobs-pill' + statusClass + '">' + escapeHtml(getJobStatusText(job)) + '</span>' +
              '</div>' +
                  '<div class="jobs-list-item-meta-row" title="' + escapeAttr(job.cronExpression || "") + '">' +
                  '<div class="jobs-list-item-meta">' + escapeHtml(scheduleLabel) + ' • ' + String(Array.isArray(job.nodes) ? job.nodes.length : 0) + ' items</div>' +
                  '<div style="display:flex;align-items:center;gap:8px;">' +
                  (job.archived
                    ? '<span class="jobs-pill is-inactive">' + escapeHtml(strings.jobsArchivedBadge || 'Archived') + '</span>'
                    : '') +
                  '<button type="button" class="btn-secondary" data-job-open-editor="' + escapeAttr(job.id || '') + '">' + escapeHtml(strings.jobsOpenEditor || 'Open editor') + '</button>' +
                  '</div>' +
              '</div>' +
              '</div>'
            );
          })
          .join("");
      }
    }

    var selectedJob = getJobById(selectedJobId);
    applyJobsSidebarState();
    if (!selectedJob) {
      if (jobsEmptyState) jobsEmptyState.style.display = "block";
      if (jobsDetails) jobsDetails.style.display = "none";
      return;
    }

    if (jobsEmptyState) jobsEmptyState.style.display = "none";
    if (jobsDetails) jobsDetails.style.display = "block";
    var selectedNodes = Array.isArray(selectedJob.nodes) ? selectedJob.nodes : [];
    var selectedWaitingPause = getWaitingPauseState(selectedJob);
    var approvedPauseIds = getApprovedPauseIds(selectedJob);

    if (jobsNameInput) jobsNameInput.value = selectedJob.name || "";
    if (jobsCronInput) jobsCronInput.value = selectedJob.cronExpression || "";
    if (jobsCronPreset) jobsCronPreset.value = "";
    syncJobsFolderSelect(selectedJob.folderId || "");
    if (jobsStatusPill) {
      jobsStatusPill.textContent = getJobStatusText(selectedJob);
      if (jobsStatusPill.classList) {
        jobsStatusPill.classList.toggle("is-inactive", !!selectedJob.paused || !!selectedJob.archived);
        jobsStatusPill.classList.toggle("is-waiting", !!selectedWaitingPause);
      }
    }
    if (jobsPauseBtn) {
      jobsPauseBtn.textContent = selectedJob.paused
        ? strings.jobsResume || "Resume Job"
        : strings.jobsPause || "Pause Job";
    }
    if (jobsCompileBtn) {
      jobsCompileBtn.disabled = selectedNodes.length === 0;
    }

    if (jobsTimelineInline) {
      var timelineHtml = selectedNodes
        .map(function (node, index) {
          var taskName = "";
          if (isPauseNode(node)) {
            taskName = "Pause: " + (node.title || (strings.jobsPauseDefaultTitle || "Manual review"));
          } else {
            var task = getTaskById(node.taskId);
            taskName = task && task.name ? task.name : ("Step " + String(index + 1));
          }
          return (
            '<span class="jobs-timeline-node" title="' + escapeAttr(taskName) + '">' +
            escapeHtml(taskName) +
            '</span>' +
            (index < selectedNodes.length - 1
              ? '<span class="jobs-timeline-arrow">→</span>'
              : '')
          );
        })
        .join("");
      jobsTimelineInline.innerHTML = timelineHtml || escapeHtml(strings.jobsTimelineEmpty || "No steps yet");
    }

    syncJobsExistingTaskSelect();
    syncJobsStepSelectors();
    updateJobsCronPreview();
    updateJobsFriendlyVisibility();

    if (jobsStepList) {
      var stepCards = selectedNodes
        .map(function (node, index) {
          if (isPauseNode(node)) {
            var isWaiting = !!selectedWaitingPause && selectedWaitingPause.nodeId === node.id;
            var isApproved = approvedPauseIds.indexOf(node.id) >= 0;
            var pauseStatusText = isWaiting
              ? (strings.jobsPauseWaiting || "Waiting for approval")
              : isApproved
                ? (strings.jobsPauseApproved || "Approved")
                : (strings.jobsPauseDefaultTitle || "Manual review");
            return (
              '<div class="jobs-step-card jobs-pause-card' + (isWaiting ? ' is-waiting' : '') + '" draggable="true" data-job-node-id="' +
              escapeAttr(node.id || "") +
              '">' +
              '<div class="jobs-step-header">' +
              '<strong title="' + escapeAttr(node.title || "") + '">' + String(index + 1) + '. ' + escapeHtml(node.title || (strings.jobsPauseDefaultTitle || "Manual review")) + '</strong>' +
              '<span class="jobs-pill' + (isWaiting ? ' is-waiting' : '') + '">' + escapeHtml(pauseStatusText) + '</span>' +
              '</div>' +
              '<div class="jobs-pause-copy">' + escapeHtml(strings.jobsPauseHelpText || 'This checkpoint blocks downstream steps until you approve the previous result.') + '</div>' +
              '<div class="jobs-step-toolbar">' +
              '<button type="button" class="btn-secondary" data-job-action="edit-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseEdit || 'Edit') + '</button>' +
              '<button type="button" class="btn-danger" data-job-action="delete-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseDelete || 'Delete') + '</button>' +
              (isWaiting
                ? '<button type="button" class="btn-primary" data-job-action="approve-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseApprove || 'Approve') + '</button>' +
                  '<button type="button" class="btn-secondary" data-job-action="reject-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseReject || 'Reject and edit previous step') + '</button>'
                : '') +
              '</div>' +
              '</div>'
            );
          }

          var task = getTaskById(node.taskId);
          var taskName = task && task.name ? task.name : "Missing task";
          var taskPrompt = task && task.prompt ? String(task.prompt) : "";
          var preview = taskPrompt.length > 120 ? taskPrompt.slice(0, 120) + "..." : taskPrompt;
          var nextRunText = task && task.nextRun
            ? new Date(task.nextRun).toLocaleString(locale)
            : (strings.labelNever || "Never");
          return (
            '<div class="jobs-step-card" draggable="true" data-job-node-id="' +
            escapeAttr(node.id || "") +
            '">' +
            '<div class="jobs-step-header">' +
            '<strong title="' + escapeAttr(taskName) + '">' + String(index + 1) + '. ' + escapeHtml(taskName) + '</strong>' +
            '<span class="jobs-pill">' + escapeHtml(String(node.windowMinutes || 30) + 'm') + '</span>' +
            '</div>' +
            '<div class="jobs-step-meta">' + escapeHtml(strings.labelNextRun || "Next run") + ': ' + escapeHtml(nextRunText) + '</div>' +
            '<div class="jobs-step-summary" title="' + escapeAttr(taskPrompt || preview) + '">' + escapeHtml(preview || "-") + '</div>' +
            '<div class="jobs-inline-form">' +
            '<div class="form-group">' +
            '<input type="number" class="job-node-window-input" data-job-node-window-id="' + escapeAttr(node.id || "") + '" min="1" max="1440" value="' + escapeAttr(String(node.windowMinutes || 30)) + '">' +
            '</div>' +
            '</div>' +
            '<div class="jobs-step-toolbar">' +
            '<button type="button" class="btn-secondary" data-job-action="edit-task" data-job-task-id="' + escapeAttr(node.taskId || "") + '">' + escapeHtml(strings.actionEdit || "Edit") + '</button>' +
            '<button type="button" class="btn-secondary" data-job-action="run-task" data-job-task-id="' + escapeAttr(node.taskId || "") + '">' + escapeHtml(strings.actionRun || "Run") + '</button>' +
            '<button type="button" class="btn-danger" data-job-action="detach-node" data-job-node-id="' + escapeAttr(node.id || "") + '">Delete</button>' +
            '</div>' +
            '</div>'
          );
        })
        .join("");
      jobsStepList.innerHTML = stepCards || ('<div class="jobs-empty">' + escapeHtml(strings.jobsEmptySteps || "This job has no steps yet.") + '</div>');
    }
  }

  // Initialize dropdowns with cached data
  updateAgentOptions();
  updateModelOptions();
  var initialPromptSource = document.querySelector(
    'input[name="prompt-source"]:checked',
  );
  if (initialPromptSource) {
    applyPromptSource(initialPromptSource.value);
  }
  if (chatSessionSelect && !chatSessionSelect.value) {
    chatSessionSelect.value = defaultChatSession;
  }
  syncRecurringChatSessionUi();
  updateFriendlyVisibility();
  updateCronPreview();
  updateSkillOptions();
  syncTaskLabelFilterOptions();
  syncJobsStepSelectors();
  syncJobsFolderSelect("");
  syncJobsExistingTaskSelect();
  renderJobsTab();

  // Global functions for onclick handlers
  window.runTask = function (id) {
    vscode.postMessage({ type: "runTask", taskId: id });
  };

  function selectHasOptionValue(selectEl, value) {
    if (!selectEl || !value) return false;
    var opts = selectEl.options;
    if (!opts || typeof opts.length !== "number") return false;
    for (var i = 0; i < opts.length; i++) {
      var opt = opts[i];
      if (opt && opt.value === value) return true;
    }
    return false;
  }

  window.editTask = function (id) {
    var taskListArray = Array.isArray(tasks) ? tasks : [];
    var task = taskListArray.find(function (t) {
      return t && t.id === id;
    });
    if (!task) return;

    setEditingMode(id);
    var taskNameEl = document.getElementById("task-name");
    var promptTextEl = document.getElementById("prompt-text");
    if (taskNameEl) taskNameEl.value = task.name || "";
    if (taskLabelsInput) taskLabelsInput.value = toLabelString(task.labels);
    if (promptTextEl)
      promptTextEl.value = typeof task.prompt === "string" ? task.prompt : "";
    if (cronExpression) cronExpression.value = task.cronExpression || "";
    if (cronPreset) cronPreset.value = "";
    updateCronPreview();

    // Restore agent/model — if options not loaded yet, store as pending
    pendingAgentValue = task.agent || "";
    pendingModelValue = task.model || "";
    if (agentSelect) {
      if (
        pendingAgentValue &&
        selectHasOptionValue(agentSelect, pendingAgentValue)
      ) {
        agentSelect.value = pendingAgentValue;
        pendingAgentValue = "";
      } else if (pendingAgentValue) {
        // Option not yet loaded — will be applied when updateAgents arrives
        agentSelect.value = "";
      }
    }
    if (modelSelect) {
      if (
        pendingModelValue &&
        selectHasOptionValue(modelSelect, pendingModelValue)
      ) {
        modelSelect.value = pendingModelValue;
        pendingModelValue = "";
      } else if (pendingModelValue) {
        modelSelect.value = "";
      }
    }
    editingTaskEnabled = task.enabled !== false;
    var scopeValue = task.scope || "workspace";
    var scopeRadio = document.querySelector(
      'input[name="scope"][value="' + scopeValue + '"]',
    );
    if (scopeRadio) {
      scopeRadio.checked = true;
    }
    var sourceValue = task.promptSource || "inline";
    var sourceRadio = document.querySelector(
      'input[name="prompt-source"][value="' + sourceValue + '"]',
    );
    if (sourceRadio) {
      sourceRadio.checked = true;
    }

    applyPromptSource(sourceValue, true);
    pendingTemplatePath = task.promptPath || "";
    if (templateSelect) {
      if (
        pendingTemplatePath &&
        selectHasOptionValue(templateSelect, pendingTemplatePath)
      ) {
        templateSelect.value = pendingTemplatePath;
        pendingTemplatePath = "";
      } else if (pendingTemplatePath) {
        templateSelect.value = "";
      }
    }

    if (jitterSecondsInput) {
      jitterSecondsInput.value = String(
        task.jitterSeconds ?? defaultJitterSeconds,
      );
    }

    // Clear "run first" checkbox in edit mode (not applicable for existing tasks)
    var runFirstEl = document.getElementById("run-first");
    if (runFirstEl) runFirstEl.checked = false;

    var oneTimeEl = document.getElementById("one-time");
    if (oneTimeEl) oneTimeEl.checked = task.oneTime === true;
    if (chatSessionSelect) {
      chatSessionSelect.value = task.chatSession === "continue"
        ? "continue"
        : task.chatSession === "new"
          ? "new"
          : defaultChatSession;
    }
    syncRecurringChatSessionUi();

    // Switch to edit tab (same form)
    switchTab("create");
  };

  if (newTaskBtn) {
    newTaskBtn.addEventListener("click", function () {
      resetForm();
      switchTab("create");
      try {
        var taskNameEl = document.getElementById("task-name");
        if (taskNameEl && typeof taskNameEl.focus === "function") {
          taskNameEl.focus();
        }
      } catch (e) {
        // ignore
      }
    });
  }

  window.copyPrompt = function (id) {
    // Route through the action callback so that template-based prompts
    // are resolved from the file (consistent with tree view copy).
    vscode.postMessage({ type: "copyTask", taskId: id });
  };

  window.duplicateTask = function (id) {
    vscode.postMessage({ type: "duplicateTask", taskId: id });
  };

  window.moveTaskToCurrentWorkspace = function (id) {
    vscode.postMessage({ type: "moveTaskToCurrentWorkspace", taskId: id });
  };

  window.toggleTask = function (id) {
    vscode.postMessage({ type: "toggleTask", taskId: id });
  };

  window.deleteTask = function (id) {
    var task = tasks.find(function (t) {
      return t && t.id === id;
    });
    if (!task) {
      return;
    }

    // Send delete request to extension (confirmation will be handled there)
    vscode.postMessage({ type: "deleteTask", taskId: id });
  };

  // Handle messages from extension
  window.addEventListener("message", function (event) {
    var message = event.data;

    try {
      switch (message.type) {
        case "updateTasks":
          tasks = Array.isArray(message.tasks) ? message.tasks : [];
          syncTaskLabelFilterOptions();
          syncJobsExistingTaskSelect();
          renderTaskList(message.tasks);
          renderJobsTab();
          renderCockpitBoard();
          break;
        case "updateJobs":
          jobs = Array.isArray(message.jobs) ? message.jobs : [];
          syncTaskLabelFilterOptions();
          renderTaskList(tasks);
          renderJobsTab();
          break;
        case "updateJobFolders":
          jobFolders = Array.isArray(message.jobFolders)
            ? message.jobFolders
            : [];
          renderJobsTab();
          break;
        case "updateCockpitBoard":
          cockpitBoard = message.cockpitBoard || {
            version: 1,
            sections: [],
            cards: [],
            filters: { labels: [], priorities: [], flags: [], sortBy: "manual", sortDirection: "asc", showArchived: false },
            updatedAt: "",
          };
          renderCockpitBoard();
          break;
        case "updateResearchState":
          researchProfiles = Array.isArray(message.profiles)
            ? message.profiles
            : [];
          activeResearchRun = message.activeRun || null;
          recentResearchRuns = Array.isArray(message.recentRuns)
            ? message.recentRuns
            : [];
          if (
            activeResearchRun &&
            (!selectedResearchRunId || selectedResearchRunId === activeResearchRun.id)
          ) {
            selectedResearchRunId = activeResearchRun.id;
          } else {
            ensureValidResearchRunSelection();
          }
          if (!selectedResearchId && !isCreatingResearchProfile) {
            ensureValidResearchSelection();
          }
          renderResearchTab();
          break;
        case "updateTelegramNotification":
          telegramNotification = message.telegramNotification || {
            enabled: false,
            hasBotToken: false,
            hookConfigured: false,
          };
          renderTelegramTab();
          break;
        case "updateExecutionDefaults":
          executionDefaults = message.executionDefaults || {
            agent: "agent",
            model: "",
          };
          renderExecutionDefaultsControls();
          if (!editingTaskId) {
            if (agentSelect) agentSelect.value = executionDefaults.agent || "";
            if (modelSelect) modelSelect.value = executionDefaults.model || "";
          }
          break;
        case "updateAgents":
          {
            var currentAgentValue =
              pendingAgentValue || (agentSelect ? agentSelect.value : "");
            agents = Array.isArray(message.agents) ? message.agents : [];
            updateAgentOptions();
            renderExecutionDefaultsControls();
            syncJobsStepSelectors();
            syncResearchSelectors();
            if (agentSelect && currentAgentValue) {
              agentSelect.value = currentAgentValue;
              if (agentSelect.value === currentAgentValue) {
                pendingAgentValue = "";
              } else {
                pendingAgentValue = currentAgentValue;
              }
            }
          }
          break;
        case "updateModels":
          {
            var currentModelValue =
              pendingModelValue || (modelSelect ? modelSelect.value : "");
            models = Array.isArray(message.models) ? message.models : [];
            updateModelOptions();
            renderExecutionDefaultsControls();
            syncJobsStepSelectors();
            syncResearchSelectors();
            if (modelSelect && currentModelValue) {
              modelSelect.value = currentModelValue;
              if (modelSelect.value === currentModelValue) {
                pendingModelValue = "";
              } else {
                pendingModelValue = currentModelValue;
              }
            }
          }
          break;
        case "updatePromptTemplates":
          promptTemplates = Array.isArray(message.templates)
            ? message.templates
            : [];
          {
            var sourceElement = document.querySelector(
              'input[name="prompt-source"]:checked',
            );
            var currentSource = sourceElement ? sourceElement.value : "inline";
            var currentTemplateValue =
              pendingTemplatePath ||
              (templateSelect ? templateSelect.value : "");
            updateTemplateOptions(currentSource, currentTemplateValue);
            if (templateSelect && currentTemplateValue) {
              if (templateSelect.value === currentTemplateValue) {
                pendingTemplatePath = "";
              } else {
                pendingTemplatePath = currentTemplateValue;
              }
            }
            if (currentSource === "local" || currentSource === "global") {
              if (templateSelectGroup)
                templateSelectGroup.style.display = "block";
            } else {
              if (templateSelectGroup)
                templateSelectGroup.style.display = "none";
            }
          }
          break;
        case "updateSkills":
          skills = Array.isArray(message.skills) ? message.skills : [];
          updateSkillOptions();
          break;
        case "updateAutoShowOnStartup":
          autoShowOnStartup = !!message.enabled;
          syncAutoShowOnStartupUi();
          break;
        case "updateScheduleHistory":
          scheduleHistory = Array.isArray(message.entries)
            ? message.entries
            : [];
          syncScheduleHistoryOptions();
          break;
        case "promptTemplateLoaded":
          var promptTextEl = document.getElementById("prompt-text");
          if (promptTextEl) promptTextEl.value = message.content;
          break;
        case "switchToList":
          pendingSubmit = false;
          if (submitBtn) submitBtn.disabled = false;
          resetForm();
          switchTab("list");
          if (message.successMessage) {
            var toast = document.getElementById("success-toast");
            if (toast) {
              var prefix = strings.webviewSuccessPrefix || "\u2714 ";
              toast.textContent = prefix + message.successMessage;
              toast.style.display = "block";
              toast.style.opacity = "1";
              setTimeout(function () {
                toast.style.opacity = "0";
              }, 3000);
              setTimeout(function () {
                toast.style.display = "none";
                toast.style.opacity = "1";
              }, 3500);
            }
          }
          break;
        case "switchToTab":
          if (message.tab) {
            switchTab(message.tab);
          }
          break;
        case "focusTask":
          switchTab("list");
          setTimeout(function () {
            var list = document.querySelectorAll(".task-card");
            var card = null;
            for (var i = 0; i < list.length; i++) {
              var el = list[i];
              if (
                el &&
                el.getAttribute &&
                el.getAttribute("data-id") === message.taskId
              ) {
                card = el;
                break;
              }
            }
            if (card) card.scrollIntoView({ behavior: "smooth" });
          }, 100);
          break;
        case "focusJob":
          selectedJobFolderId = typeof message.folderId === "string"
            ? message.folderId
            : "";
          selectedJobId = message.jobId || "";
          persistTaskFilter();
          openJobEditor(selectedJobId);
          setTimeout(function () {
            var jobCard = selectedJobId
              ? document.querySelector('[data-job-id="' + selectedJobId + '"]')
              : null;
            if (jobCard && typeof jobCard.scrollIntoView === "function") {
              jobCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          }, 50);
          break;
        case "editTask":
          if (message.taskId && typeof window.editTask === "function") {
            window.editTask(message.taskId);
          }
          break;
        case "startCreateTask":
          pendingSubmit = false;
          if (submitBtn) submitBtn.disabled = false;
          resetForm();
          switchTab("create");
          setTimeout(function () {
            try {
              var taskNameEl = document.getElementById("task-name");
              if (taskNameEl && typeof taskNameEl.focus === "function") {
                taskNameEl.focus();
              }
            } catch (e) {
              // ignore
            }
          }, 0);
          break;
        case "showError":
          if (message.text) {
            var errDiv = document.getElementById("form-error");
            if (errDiv) {
              errDiv.textContent = message.text;
              errDiv.style.display = "block";
              pendingSubmit = false;
              if (submitBtn) submitBtn.disabled = false;
              switchTab("create");
              setTimeout(function () {
                errDiv.style.display = "none";
              }, 8000);
            }
          }
          break;
      }
    } catch (e) {
      var errDiv = document.getElementById("form-error");
      if (errDiv) {
        var prefix = strings.webviewClientErrorPrefix || "";
        var rawError = e && e.message ? e.message : e;
        rawError = String(rawError).split(/\r?\n/)[0];
        errDiv.textContent = prefix + sanitizeAbsolutePaths(rawError);
        errDiv.style.display = "block";
      }
      pendingSubmit = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Initial render
  renderTaskList(tasks);

  // Keep next-run countdown live in the list view.
  setInterval(function () {
    renderTaskList(tasks);
  }, 1000);

  // Notify extension that webview is ready
  vscode.postMessage({ type: "webviewReady" });
})();
