import {
  bindBoardColumnInteractions,
  getClosestEventTarget,
  handleBoardSectionCollapse,
  handleBoardSectionDelete,
  handleBoardSectionRename,
  handleBoardTodoCompletion,
} from "./schedulerWebviewBoardInteractions.js";
import { createWebviewDebugTools } from "./schedulerWebviewDebug.js";
import { renderTodoBoardMarkup } from "./schedulerWebviewBoardRendering.js";
import {
  selectHasOptionValue,
  updateAgentOptions as updateTaskAgentOptions,
  updateModelOptions as updateTaskModelOptions,
} from "./schedulerWebviewTaskSelectState.js";

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
  var currentLogLevel =
    typeof initialData.logLevel === "string" && initialData.logLevel
      ? initialData.logLevel
      : "info";
  var currentLogDirectory =
    typeof initialData.logDirectory === "string"
      ? initialData.logDirectory
      : "";

  function basenameAny(p) {
    if (!p) return "";
    var s = String(p);
    var i1 = s.lastIndexOf("\\");
    var i2 = s.lastIndexOf("/");
    return s.substring(Math.max(i1, i2) + 1);
  }

  function basenameFromPathLike(p) {
    if (!p) return "";
    var s = String(p);
    if (/^file:\/\/\/?/i.test(s)) {
      try {
        var u = new URL(s);
        if (u.protocol === "file:") {
          s = decodeURIComponent(u.pathname || "");
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

  function getNextRunCountdownText(enabled, nextRunMs) {
    if (!enabled || !isFinite(nextRunMs) || nextRunMs <= 0) {
      return "";
    }
    var diffMs = nextRunMs - Date.now();
    if (diffMs > 0) {
      return " (in " + formatCountdown(Math.floor(diffMs / 1000)) + ")";
    }
    return " (due now)";
  }

  function refreshTaskCountdowns() {
    if (!taskList || !taskList.isConnected) {
      taskList = document.getElementById("task-list");
    }
    if (!taskList) {
      return;
    }
    taskList.querySelectorAll(".task-next-run-countdown").forEach(function (node) {
      var nextRunMs = Number(node.getAttribute("data-next-run-ms") || "");
      var enabled = node.getAttribute("data-enabled") === "true";
      node.textContent = getNextRunCountdownText(enabled, nextRunMs);
    });
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

  var globalErrorHideTimer = 0;

  function hideGlobalError() {
    var errorBanner = document.getElementById("global-error-banner");
    var errorText = document.getElementById("global-error-text");
    if (globalErrorHideTimer) {
      clearTimeout(globalErrorHideTimer);
      globalErrorHideTimer = 0;
    }
    if (errorText) {
      errorText.textContent = "";
    }
    if (errorBanner) {
      errorBanner.classList.remove("is-visible");
    }
  }

  function showGlobalError(message, options) {
    var errorBanner = document.getElementById("global-error-banner");
    var errorText = document.getElementById("global-error-text");
    if (!errorBanner) {
      return;
    }
    var normalized = sanitizeAbsolutePaths(String(message || "")).trim();
    if (!normalized) {
      hideGlobalError();
      return;
    }
    if (globalErrorHideTimer) {
      clearTimeout(globalErrorHideTimer);
      globalErrorHideTimer = 0;
    }
    if (errorText) {
      errorText.textContent = normalized;
    } else {
      errorBanner.textContent = normalized;
    }
    errorBanner.classList.add("is-visible");
    var durationMs =
      options && typeof options.durationMs === "number"
        ? options.durationMs
        : 8000;
    if (durationMs > 0) {
      globalErrorHideTimer = setTimeout(function () {
        hideGlobalError();
      }, durationMs);
    }
  }

  // Global error handler for debugging (kept minimal to avoid breaking the UI)
  window.onerror = function (msg, url, line, col, error) {
    var prefix = strings.webviewScriptErrorPrefix || "";
    var linePrefix = strings.webviewLinePrefix || "";
    var lineSuffix = strings.webviewLineSuffix || "";
    showGlobalError(
      prefix +
      sanitizeAbsolutePaths(String(msg)) +
      linePrefix +
      String(line) +
      lineSuffix,
    );
  };

  window.onunhandledrejection = function (ev) {
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
    showGlobalError(prefix + sanitizeAbsolutePaths(raw));
  };

  if (typeof acquireVsCodeApi === "function") {
    vscode = acquireVsCodeApi();
  } else {
    // Keep UI usable even if VS Code API is unavailable
    vscode = { postMessage: function () { } };
    showGlobalError(strings.webviewApiUnavailable || "", { durationMs: 0 });
  }

  var debugTools = createWebviewDebugTools({
    console: console,
    initialLogLevel: currentLogLevel,
    vscode: vscode,
  });
  var createEmptyTodoDraft = debugTools.createEmptyTodoDraft;
  var emitWebviewDebug = debugTools.emitWebviewDebug;

  function bindDebugClickAttempts(element, config) {
    if (!element || typeof element.addEventListener !== "function") {
      return;
    }
    element.addEventListener("click", function (event) {
      var target = event && event.target && event.target.nodeType === 3
        ? event.target.parentElement
        : event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var actionTarget = target.closest(config.selector);
      if (!actionTarget) {
        return;
      }
      emitWebviewDebug(config.eventName, {
        controlId: actionTarget.id || "",
        tagName: actionTarget.tagName ? String(actionTarget.tagName).toLowerCase() : "",
        disabled: !!actionTarget.disabled,
        selectedTodoId: selectedTodoId || "",
      });
    }, true);
  }

  var tasks = Array.isArray(initialData.tasks) ? initialData.tasks : [];
  var jobs = Array.isArray(initialData.jobs) ? initialData.jobs : [];
  var jobFolders = Array.isArray(initialData.jobFolders)
    ? initialData.jobFolders
    : [];
  var cockpitBoard = initialData.cockpitBoard || {
    version: 4,
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
      viewMode: "board",
      showArchived: false,
      showRecurringTasks: false,
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
  var storageSettings = {
    mode:
      initialData.storageSettings && initialData.storageSettings.mode === "sqlite"
        ? "sqlite"
        : "json",
    sqliteJsonMirror:
      !initialData.storageSettings
      || initialData.storageSettings.sqliteJsonMirror !== false,
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
  var EDITOR_CREATE_SYMBOL = "+";
  var EDITOR_EDIT_SYMBOL = "⚙";
  var draggingTodoId = null;
  var isBoardDragging = false;
  var pendingBoardRender = false;
  var scheduledBoardRenderFrame = 0;
  function requestCockpitBoardRender() {
    if (isBoardDragging) {
      pendingBoardRender = true;
      return;
    }
    if (scheduledBoardRenderFrame) {
      return;
    }
    scheduledBoardRenderFrame = requestAnimationFrame(function () {
      scheduledBoardRenderFrame = 0;
      if (isBoardDragging) {
        pendingBoardRender = true;
        return;
      }
      renderCockpitBoard();
    });
  }
  function finishBoardDragState() {
    draggingTodoId = null;
    draggingSectionId = null;
    lastDragOverSectionId = null;
    isBoardDragging = false;
    if (pendingBoardRender) {
      pendingBoardRender = false;
      requestCockpitBoardRender();
    }
  }
  var currentTodoLabels = [];
  var currentTodoDraft = createEmptyTodoDraft();
  var selectedTodoLabelName = "";
  var currentTodoFlag = "";
  var pendingTodoFilters = null;
  var pendingDeleteLabelName = "";
  var pendingDeleteFlagName = "";
  var pendingTodoDeleteId = "";
  var pendingBoardDeleteTodoId = "";
  var pendingBoardDeletePermanentOnly = false;
  var todoDeleteModalRoot = null;
  var todoCommentModalRoot = null;
  var pendingAgentValue = "";
  var pendingModelValue = "";
  var pendingTemplatePath = "";
  var editingTaskEnabled = true;
  var pendingSubmit = false;
  var HELP_WARP_SEEN_KEY = "copilot-scheduler-help-warp-seen-v1";
  var helpWarpIntroPending = (function () {
    try {
      return localStorage.getItem(HELP_WARP_SEEN_KEY) !== "1";
    } catch (_e) {
      return true;
    }
  })();
  var helpWarpFadeTimeout = 0;
  var helpWarpCleanupTimeout = 0;
  var isCreatingJob = false;
  var todoEditorListenersBound = false;

  function resetTodoDraft(reason) {
    currentTodoDraft = debugTools.resetTodoDraft(reason);
  }

  function syncTodoDraftFromInputs(reason) {
    currentTodoDraft = debugTools.syncTodoDraftFromInputs({
      currentTodoDraft: currentTodoDraft,
      reason: reason,
      selectedTodoId: selectedTodoId,
      todoDescriptionInput: todoDescriptionInput,
      todoDueInput: todoDueInput,
      todoLinkedTaskSelect: todoLinkedTaskSelect,
      todoPriorityInput: todoPriorityInput,
      todoSectionInput: todoSectionInput,
      todoTitleInput: todoTitleInput,
    });
  }

  function syncTodoFlagDraft() {
    if (selectedTodoId || !currentTodoDraft) {
      return;
    }
    currentTodoDraft.flag = currentTodoFlag || "";
  }

  function syncTodoEditorTransientDraft() {
    if (selectedTodoId || !currentTodoDraft) {
      return;
    }
    currentTodoDraft.flag = currentTodoFlag || "";
    currentTodoDraft.labelInput = todoLabelsInput
      ? String(todoLabelsInput.value || "")
      : (currentTodoDraft.labelInput || "");
    currentTodoDraft.labelColor = todoLabelColorInput
      ? String(todoLabelColorInput.value || "")
      : (currentTodoDraft.labelColor || "#4f8cff");
    currentTodoDraft.flagInput = todoFlagNameInput
      ? String(todoFlagNameInput.value || "")
      : (currentTodoDraft.flagInput || "");
    currentTodoDraft.flagColor = todoFlagColorInput
      ? String(todoFlagColorInput.value || "")
      : (currentTodoDraft.flagColor || "#f59e0b");
  }

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
  var syncBundledSkillsBtn = document.getElementById("sync-bundled-skills-btn");
  var importStorageFromJsonBtn = document.getElementById("import-storage-from-json-btn");
  var exportStorageToJsonBtn = document.getElementById("export-storage-to-json-btn");
  var helpLanguageSelect = document.getElementById("help-language-select");
  var settingsLanguageSelect = document.getElementById("settings-language-select");
  var helpWarpLayer = document.getElementById("help-warp-layer");
  var helpIntroRocket = document.getElementById("help-intro-rocket");
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
  var jobsShowSidebarBtn = document.getElementById("jobs-show-sidebar-btn");
  var jobsNewFolderBtn = document.getElementById("jobs-new-folder-btn");
  var jobsRenameFolderBtn = document.getElementById("jobs-rename-folder-btn");
  var jobsDeleteFolderBtn = document.getElementById("jobs-delete-folder-btn");
  var jobsNewJobBtn = document.getElementById("jobs-new-job-btn");
  var jobsSaveBtn = document.getElementById("jobs-save-btn");
  var jobsSaveDeckBtn = document.getElementById("jobs-save-deck-btn");
  var jobsDuplicateBtn = document.getElementById("jobs-duplicate-btn");
  var jobsPauseBtn = document.getElementById("jobs-pause-btn");
  var jobsCompileBtn = document.getElementById("jobs-compile-btn");
  var jobsDeleteBtn = document.getElementById("jobs-delete-btn");
  var jobsBackBtn = document.getElementById("jobs-back-btn");
  var jobsOpenEditorBtn = document.getElementById("jobs-open-editor-btn");
  var tabBar = document.querySelector(".tab-bar");
  var boardFilterSticky = document.getElementById("board-filter-sticky");
  var boardSummary = document.getElementById("board-summary");
  var boardColumns = document.getElementById("board-columns");
  var todoToggleFiltersBtn = document.getElementById("todo-toggle-filters-btn");
  var todoSearchInput = document.getElementById("todo-search-input");
  var todoSectionFilter = document.getElementById("todo-section-filter");
  var todoLabelFilter = document.getElementById("todo-label-filter");
  var todoFlagFilter = document.getElementById("todo-flag-filter");
  var todoPriorityFilter = document.getElementById("todo-priority-filter");
  var todoStatusFilter = document.getElementById("todo-status-filter");
  var todoArchiveOutcomeFilter = document.getElementById("todo-archive-outcome-filter");
  var todoSortBy = document.getElementById("todo-sort-by");
  var todoSortDirection = document.getElementById("todo-sort-direction");
  var todoViewMode = document.getElementById("todo-view-mode");
  var todoShowRecurringTasks = document.getElementById("todo-show-recurring-tasks");
  var todoShowArchived = document.getElementById("todo-show-archived");
  var todoHideCardDetails = document.getElementById("todo-hide-card-details");
  var todoNewBtn = document.getElementById("todo-new-btn");
  var todoClearSelectionBtn = document.getElementById("todo-clear-selection-btn");
  var todoClearFiltersBtn = document.getElementById("todo-clear-filters-btn");
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
  var todoLabelCatalog = document.getElementById("todo-label-catalog");
  var todoFlagNameInput = document.getElementById("todo-flag-name-input");
  var todoFlagColorInput = document.getElementById("todo-flag-color-input");
  var todoFlagAddBtn = document.getElementById("todo-flag-add-btn");
  var todoFlagColorSaveBtn = document.getElementById("todo-flag-color-save-btn");
  var todoLinkedTaskNote = document.getElementById("todo-linked-task-note");
  var todoSaveBtn = document.getElementById("todo-save-btn");
  var todoCreateTaskBtn = document.getElementById("todo-create-task-btn");
  var todoCompleteBtn = document.getElementById("todo-complete-btn");
  var todoDeleteBtn = document.getElementById("todo-delete-btn");
  var todoUploadFilesBtn = document.getElementById("todo-upload-files-btn");
  var todoUploadFilesNote = document.getElementById("todo-upload-files-note");
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
  var jobsWorkflowMetrics = document.getElementById("jobs-workflow-metrics");
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
  var settingsStorageModeSelect = document.getElementById("settings-storage-mode-select");
  var settingsStorageMirrorInput = document.getElementById("settings-storage-mirror-input");
  var settingsStorageSaveBtn = document.getElementById("settings-storage-save-btn");
  var settingsStorageNote = document.getElementById("settings-storage-note");
  var settingsLogLevelSelect = document.getElementById("settings-log-level-select");
  var settingsLogDirectoryInput = document.getElementById("settings-log-directory");
  var settingsOpenLogFolderBtn = document.getElementById("settings-open-log-folder-btn");
  var boardAddSectionBtn = document.getElementById("board-add-section-btn");
  var boardSectionInlineForm = document.getElementById("board-section-inline-form");
  var boardSectionNameInput = document.getElementById("board-section-name-input");
  var boardSectionSaveBtn = document.getElementById("board-section-save-btn");
  var boardSectionCancelBtn = document.getElementById("board-section-cancel-btn");
  var cockpitColSlider = document.getElementById("cockpit-col-slider");

  // Restore persisted column width\n  (function () {\n    var savedWidth = localStorage.getItem(\"cockpit-col-width\");\n    if (savedWidth) {\n      var w = Number(savedWidth);\n      document.documentElement.style.setProperty(\"--cockpit-col-width\", w + \"px\");\n      var font = Math.round(10 + (w - 180) * 3 / 340);\n      document.documentElement.style.setProperty(\"--cockpit-col-font\", font + \"px\");\n      var pad = Math.round(8 + (w - 180) * 6 / 340);\n      document.documentElement.style.setProperty(\"--cockpit-card-pad\", pad + \"px\");\n      if (cockpitColSlider) cockpitColSlider.value = savedWidth;\n    }\n  })();

  var activeTaskFilter = "all";
  var activeLabelFilter = "";
  var taskSectionCollapseState = {
    manual: false,
    jobs: true,
    recurring: false,
    "todo-draft": false,
    "one-time": false,
  };
  var selectedJobFolderId = "";
  var selectedJobId = "";
  var selectedResearchId = "";
  var selectedResearchRunId = "";
  var draggedJobNodeId = "";
  var draggedJobId = "";
  var draggingSectionId = null;
  var lastDragOverSectionId = null;
  var jobsSidebarHidden = false;
  var boardFiltersManualCollapsed = false;
  var boardFiltersAutoCollapsed = false;
  var boardLastScrollY = 0;
  var boardStickyMetricsFrame = 0;
  var boardAutoCollapseSettleY = 0;
  var boardAutoCollapseSettleDistance = 0;
  var boardAutoCollapseSettleUntil = 0;
  var boardCardDetailsHidden = (function () {
    try {
      return localStorage.getItem("cockpit-hide-card-details") === "1";
    } catch (_e) {
      return false;
    }
  })();

  // Edit-mode tracking for flag and label catalog
  var editingFlagOriginalName = "";
  var editingLabelOriginalName = "";

  // Collapsed sections — persisted in localStorage
  var collapsedSections = (function () {
    try { return new Set(JSON.parse(localStorage.getItem("cockpit-collapsed-sections") || "[]")); }
    catch (e) { return new Set(); }
  })();
  function toggleSectionCollapsed(sectionId) {
    if (collapsedSections.has(sectionId)) { collapsedSections.delete(sectionId); }
    else { collapsedSections.add(sectionId); }
    try { localStorage.setItem("cockpit-collapsed-sections", JSON.stringify(Array.from(collapsedSections))); }
    catch (e) {}
  }

  function setLabelSlotsClass(w) {
    var cls = w >= 390 ? 'labels-6' : w >= 300 ? 'labels-3' : 'labels-1';
    document.documentElement.classList.remove('labels-1', 'labels-3', 'labels-6');
    document.documentElement.classList.add(cls);
  }

  function getCockpitCompactDetailsThreshold() {
    var min = cockpitColSlider ? Number(cockpitColSlider.min) : 180;
    var max = cockpitColSlider ? Number(cockpitColSlider.max) : 520;
    var range = max - min;
    if (!(range > 0)) {
      return 214;
    }
    return Math.round(min + range * 0.1);
  }

  function applyCockpitColumnScale(w) {
    var font = Math.round(10 + (w - 180) * 3 / 340);
    var pad = Math.round(8 + (w - 180) * 6 / 340);
    var gap = Math.round(4 + (w - 180) * 4 / 340);
    var chipFont = Math.max(8, Math.round(8 + (w - 180) * 4 / 340));
    var chipGap = Math.max(2, Math.round(2 + (w - 180) * 2 / 340));
    var labelPadY = Math.max(0, Math.round(1 + (w - 180) * 2 / 340));
    var labelPadX = Math.max(4, Math.round(4 + (w - 180) * 4 / 340));
    var flagPadY = Math.max(0, Math.round(1 + (w - 180) * 2 / 340));
    var flagPadX = Math.max(4, Math.round(4 + (w - 180) * 4 / 340));
    document.documentElement.style.setProperty("--cockpit-col-width", w + "px");
    document.documentElement.style.setProperty("--cockpit-col-font", font + "px");
    document.documentElement.style.setProperty("--cockpit-card-pad", pad + "px");
    document.documentElement.style.setProperty("--cockpit-card-gap", gap + "px");
    document.documentElement.style.setProperty("--cockpit-chip-font", chipFont + "px");
    document.documentElement.style.setProperty("--cockpit-chip-gap", chipGap + "px");
    document.documentElement.style.setProperty("--cockpit-label-pad-y", labelPadY + "px");
    document.documentElement.style.setProperty("--cockpit-label-pad-x", labelPadX + "px");
    document.documentElement.style.setProperty("--cockpit-flag-pad-y", flagPadY + "px");
    document.documentElement.style.setProperty("--cockpit-flag-pad-x", flagPadX + "px");
    setLabelSlotsClass(w);
    document.documentElement.classList.toggle(
      "cockpit-board-compact-details",
      w <= getCockpitCompactDetailsThreshold(),
    );
  }

  // Always apply column CSS vars from saved width or slider default
  (function () {
    var saved = localStorage.getItem("cockpit-col-width");
    var w = saved ? Number(saved) : (cockpitColSlider ? Number(cockpitColSlider.value) : 240);
    if (w >= 180 && w <= 520) {
      applyCockpitColumnScale(w);
      if (cockpitColSlider && !saved) cockpitColSlider.value = String(w);
    }
  })();
  var isCreatingResearchProfile = false;
  var researchFormDirty = false;
  var loadedResearchProfileId = "";

  function isValidTaskFilter(value) {
    return value === "all" || value === "manual" || value === "recurring" || value === "one-time";
  }

  function isTaskSectionKey(value) {
    return value === "manual" || value === "jobs" || value === "recurring" || value === "todo-draft" || value === "one-time";
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
      if (state && state.taskSectionCollapseState && typeof state.taskSectionCollapseState === "object") {
        Object.keys(taskSectionCollapseState).forEach(function (key) {
          if (typeof state.taskSectionCollapseState[key] === "boolean") {
            taskSectionCollapseState[key] = state.taskSectionCollapseState[key];
          }
        });
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
      if (state && typeof state.boardFiltersCollapsed === "boolean") {
        boardFiltersManualCollapsed = state.boardFiltersCollapsed;
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
      next.taskSectionCollapseState = taskSectionCollapseState;
      next.selectedJobFolderId = selectedJobFolderId;
      next.selectedJobId = selectedJobId;
      next.jobsSidebarHidden = jobsSidebarHidden;
      next.boardFiltersCollapsed = boardFiltersManualCollapsed;
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

  function isBoardFiltersCollapsed() {
    return !!(boardFiltersManualCollapsed || boardFiltersAutoCollapsed);
  }

  function scheduleBoardStickyMetrics() {
    if (boardStickyMetricsFrame) {
      return;
    }
    boardStickyMetricsFrame = requestAnimationFrame(function () {
      boardStickyMetricsFrame = 0;
      updateBoardStickyMetrics();
    });
  }

  function updateBoardStickyMetrics() {
    var tabBarStickyTop = 0;
    if (tabBar) {
      tabBarStickyTop = Math.max(
        0,
        Math.ceil(tabBar.getBoundingClientRect().height),
      );
    }
    var stickyTop = tabBarStickyTop;
    if (boardFilterSticky && isTabActive("board")) {
      stickyTop = Math.max(
        tabBarStickyTop,
        tabBarStickyTop + Math.ceil(boardFilterSticky.getBoundingClientRect().height + 8),
      );
    }
    document.documentElement.style.setProperty(
      "--cockpit-tab-bar-sticky-top",
      tabBarStickyTop + "px",
    );
    document.documentElement.style.setProperty(
      "--cockpit-board-sticky-top",
      stickyTop + "px",
    );
  }

  function clearBoardAutoCollapseSettle() {
    boardAutoCollapseSettleY = 0;
    boardAutoCollapseSettleDistance = 0;
    boardAutoCollapseSettleUntil = 0;
  }

  function armBoardAutoCollapseSettle(currentY) {
    var stickyHeight = boardFilterSticky
      ? Math.ceil(boardFilterSticky.getBoundingClientRect().height)
      : 0;
    boardAutoCollapseSettleY = currentY;
    boardAutoCollapseSettleDistance = Math.max(56, Math.ceil(stickyHeight + 16));
    boardAutoCollapseSettleUntil = Date.now() + 240;
  }

  function shouldIgnoreBoardAutoCollapseScroll(currentY) {
    if (boardAutoCollapseSettleUntil > Date.now()) {
      return true;
    }
    if (boardAutoCollapseSettleDistance <= 0) {
      return false;
    }
    if (Math.abs(currentY - boardAutoCollapseSettleY) <= boardAutoCollapseSettleDistance) {
      return true;
    }
    clearBoardAutoCollapseSettle();
    return false;
  }

  function updateBoardAutoCollapseFromScroll(forceExpand) {
    var currentY = Math.max(
      window.scrollY || 0,
      document.documentElement ? document.documentElement.scrollTop || 0 : 0,
    );
    if (forceExpand || !isTabActive("board")) {
      boardLastScrollY = currentY;
      clearBoardAutoCollapseSettle();
      if (boardFiltersAutoCollapsed) {
        boardFiltersAutoCollapsed = false;
        applyBoardFilterCollapseState();
      }
      return;
    }

    if (shouldIgnoreBoardAutoCollapseScroll(currentY)) {
      boardLastScrollY = currentY;
      return;
    }

    var nextAutoCollapsed = boardFiltersAutoCollapsed;
    if (currentY > boardLastScrollY + 18 && currentY > 140) {
      nextAutoCollapsed = true;
    } else if (currentY < boardLastScrollY - 14 || currentY < 72) {
      nextAutoCollapsed = false;
    }
    boardLastScrollY = currentY;

    if (nextAutoCollapsed !== boardFiltersAutoCollapsed) {
      boardFiltersAutoCollapsed = nextAutoCollapsed;
      armBoardAutoCollapseSettle(currentY);
      applyBoardFilterCollapseState();
    }
  }

  function applyBoardFilterCollapseState() {
    if (boardFilterSticky && boardFilterSticky.classList) {
      var collapsed = isBoardFiltersCollapsed();
      boardFilterSticky.classList.toggle("is-collapsed", collapsed);
      boardFilterSticky.setAttribute(
        "data-auto-collapsed",
        boardFiltersAutoCollapsed ? "true" : "false",
      );
    }
    if (todoToggleFiltersBtn) {
      var isCollapsed = isBoardFiltersCollapsed();
      todoToggleFiltersBtn.textContent = isCollapsed
        ? (strings.boardShowFilters || "Show Filters")
        : (strings.boardHideFilters || "Hide Filters");
      todoToggleFiltersBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
    }
    scheduleBoardStickyMetrics();
  }

  function findTodoById(todoId) {
    if (!todoId || !cockpitBoard || !Array.isArray(cockpitBoard.cards)) {
      return null;
    }
    for (var i = 0; i < cockpitBoard.cards.length; i += 1) {
      var card = cockpitBoard.cards[i];
      if (card && card.id === todoId) {
        return card;
      }
    }
    return null;
  }

  function setTodoUploadNote(text, state) {
    if (!todoUploadFilesNote) {
      return;
    }
    todoUploadFilesNote.textContent = text || (strings.boardUploadFilesHint || "");
    todoUploadFilesNote.classList.remove("is-success", "is-error");
    if (state === "success") {
      todoUploadFilesNote.classList.add("is-success");
    } else if (state === "error") {
      todoUploadFilesNote.classList.add("is-error");
    }
  }

  function appendTextToTodoDescription(insertedText) {
    if (!todoDescriptionInput || !insertedText) {
      return;
    }
    var currentValue = String(todoDescriptionInput.value || "");
    var separator = currentValue ? (/\n\s*$/.test(currentValue) ? "\n" : "\n\n") : "";
    todoDescriptionInput.value = currentValue + separator + insertedText;
    syncTodoDraftFromInputs("upload");
  }

  function syncTodoPriorityInputTone() {
    if (!todoPriorityInput) {
      return;
    }
    todoPriorityInput.setAttribute(
      "data-priority",
      String(todoPriorityInput.value || "none"),
    );
  }

  function getTodoCommentToneClass(comment) {
    var source = comment && comment.source ? String(comment.source) : "human-form";
    if (source === "bot-mcp") {
      return " is-bot-mcp";
    }
    if (source === "bot-manual") {
      return " is-bot-manual";
    }
    if (source === "system-event") {
      return " is-system-event";
    }
    return " is-human-form";
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

  function collectStorageSettingsFormData() {
    return {
      mode:
        settingsStorageModeSelect && settingsStorageModeSelect.value === "sqlite"
          ? "sqlite"
          : "json",
      sqliteJsonMirror: !settingsStorageMirrorInput || settingsStorageMirrorInput.checked !== false,
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

  function renderStorageSettingsControls() {
    if (settingsStorageModeSelect) {
      settingsStorageModeSelect.value = storageSettings.mode === "sqlite" ? "sqlite" : "json";
    }
    if (settingsStorageMirrorInput) {
      settingsStorageMirrorInput.checked = storageSettings.sqliteJsonMirror !== false;
    }
    if (settingsStorageNote) {
      settingsStorageNote.textContent = strings.settingsStorageSaved
        || "Storage settings are repo-local. Reload after changing the backend mode.";
    }
  }

  function renderLoggingControls() {
    if (settingsLogLevelSelect) {
      settingsLogLevelSelect.value = currentLogLevel || "info";
    }
    if (settingsLogDirectoryInput) {
      settingsLogDirectoryInput.value = currentLogDirectory || "";
      settingsLogDirectoryInput.title = currentLogDirectory || "";
    }
  }

  function applyJobsSidebarState() {
    if (jobsLayout && jobsLayout.classList) {
      jobsLayout.classList.toggle("sidebar-collapsed", !!jobsSidebarHidden);
    }
    if (jobsShowSidebarBtn) {
      jobsShowSidebarBtn.style.display = jobsSidebarHidden ? "inline-flex" : "none";
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

  function buildHelpWarpStreaks() {
    if (!helpWarpLayer) {
      return;
    }

    helpWarpLayer.textContent = "";

    for (var i = 0; i < 22; i += 1) {
      var streak = document.createElement("span");
      var top = 4 + ((i * 91) / 22) + (Math.random() * 3.5);
      var delay = Math.random() * 0.95;
      var duration = 1.05 + (Math.random() * 1.25);
      var length = 110 + Math.round(Math.random() * 180);
      var thickness = 1 + Math.round(Math.random() * 2);
      var rotation = (-7 + (Math.random() * 14)).toFixed(2);

      streak.className = "help-warp-streak";
      streak.style.setProperty("--warp-top", top.toFixed(2) + "%");
      streak.style.setProperty("--warp-delay", delay.toFixed(2) + "s");
      streak.style.setProperty("--warp-duration", duration.toFixed(2) + "s");
      streak.style.setProperty("--warp-length", String(length) + "px");
      streak.style.setProperty("--warp-thickness", String(thickness) + "px");
      streak.style.setProperty("--warp-rotate", rotation + "deg");
      helpWarpLayer.appendChild(streak);
    }
  }

  function triggerHelpWarpAnimation(options) {
    if (!helpWarpLayer) {
      return;
    }

    var settings = options || {};

    window.clearTimeout(helpWarpFadeTimeout);
    window.clearTimeout(helpWarpCleanupTimeout);
    helpWarpLayer.classList.remove("is-active");
    helpWarpLayer.classList.remove("is-fading");
    buildHelpWarpStreaks();
    void helpWarpLayer.offsetWidth;
    helpWarpLayer.classList.add("is-active");

    if (settings.animateRocket && helpIntroRocket) {
      helpIntroRocket.classList.remove("is-launching");
      void helpIntroRocket.offsetWidth;
      helpIntroRocket.classList.add("is-launching");
      window.setTimeout(function () {
        if (helpIntroRocket) {
          helpIntroRocket.classList.remove("is-launching");
        }
      }, 1250);
    }

    helpWarpFadeTimeout = window.setTimeout(function () {
      if (helpWarpLayer) {
        helpWarpLayer.classList.add("is-fading");
      }
    }, 10000);

    helpWarpCleanupTimeout = window.setTimeout(function () {
      if (helpWarpLayer) {
        helpWarpLayer.classList.remove("is-active");
        helpWarpLayer.classList.remove("is-fading");
        helpWarpLayer.textContent = "";
      }
    }, 13800);
  }

  function maybePlayInitialHelpWarp(tabName) {
    if (tabName !== "help" || !helpWarpIntroPending) {
      return;
    }

    helpWarpIntroPending = false;
    try {
      localStorage.setItem(HELP_WARP_SEEN_KEY, "1");
    } catch (_e) {}
    triggerHelpWarpAnimation({ animateRocket: false });
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
    var manualSessionEl = document.getElementById("manual-session");
    var isOneTime = !!(oneTimeEl && oneTimeEl.checked);
    var isManualSession = !!(manualSessionEl && manualSessionEl.checked);

    if (chatSessionGroup) {
      chatSessionGroup.style.display = isOneTime ? "none" : "block";
    }

    if (chatSessionSelect && !chatSessionSelect.value) {
      chatSessionSelect.value = defaultChatSession;
    }

    if (isOneTime && chatSessionSelect) {
      chatSessionSelect.value = defaultChatSession;
    }

    if (isOneTime && manualSessionEl && manualSessionEl.checked) {
      manualSessionEl.checked = false;
    }

    if (isManualSession && oneTimeEl && oneTimeEl.checked) {
      oneTimeEl.checked = false;
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

  function getLinkedTodoLabels(taskId) {
    if (!taskId) {
      return [];
    }
    var labels = [];
    getAllTodoCards().forEach(function (card) {
      if (!card || card.taskId !== taskId || !Array.isArray(card.labels)) {
        return;
      }
      labels = labels.concat(card.labels);
    });
    return dedupeStringList(labels);
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
    if (task && task.id) {
      labels = labels.concat(getLinkedTodoLabels(task.id));
    }
    return dedupeStringList(labels);
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
        return task && task.oneTime !== true;
      }),
    );
  }

  function getJobsCadenceText(expression) {
    var cadenceText = getCronSummary(expression || "");
    if (!cadenceText || cadenceText === (strings.labelFriendlyFallback || "")) {
      cadenceText = expression || (strings.labelNever || "Never");
    }
    return cadenceText;
  }

  function updateJobsCadenceMetric() {
    if (!jobsWorkflowMetrics) return;
    var cadenceValue = jobsWorkflowMetrics.querySelector("[data-jobs-workflow-cadence]");
    if (!cadenceValue) return;
    var currentExpression = jobsCronInput ? String(jobsCronInput.value || "").trim() : "";
    cadenceValue.textContent = getJobsCadenceText(currentExpression);
    if (cadenceValue.parentElement) {
      cadenceValue.parentElement.setAttribute("title", cadenceValue.textContent || "");
    }
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
    if (isCreatingJob) {
      selectedJobId = "";
      return;
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
  applyBoardFilterCollapseState();
  syncAutoShowOnStartupUi();
  syncScheduleHistoryOptions();
  updateJobsCronPreview();
  updateJobsFriendlyVisibility();
  syncResearchSelectors();
  hookResearchFormDirtyTracking();
  hookEditorTabDirtyTracking();
  renderResearchTab();
  renderTelegramTab();
  renderCockpitBoard();
  renderExecutionDefaultsControls();
  renderStorageSettingsControls();
  renderLoggingControls();

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

  function getActiveTodoLabelEditorName() {
    var typedLabel = todoLabelsInput ? normalizeTodoLabel(todoLabelsInput.value) : "";
    if (typedLabel) {
      return typedLabel;
    }
    if (editingLabelOriginalName) {
      return normalizeTodoLabel(editingLabelOriginalName);
    }
    if (selectedTodoLabelName) {
      return normalizeTodoLabel(selectedTodoLabelName);
    }
    return "";
  }

  function getActiveTodoFlagEditorName() {
    var typedFlag = todoFlagNameInput ? normalizeTodoLabel(todoFlagNameInput.value) : "";
    if (typedFlag) {
      return typedFlag;
    }
    if (editingFlagOriginalName) {
      return normalizeTodoLabel(editingFlagOriginalName);
    }
    if (currentTodoFlag) {
      return normalizeTodoLabel(currentTodoFlag);
    }
    return "";
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

  function isArchiveTodoSectionId(sectionId) {
    return sectionId === "archive-completed" || sectionId === "archive-rejected";
  }

  function isRecurringTodoSectionId(sectionId) {
    return sectionId === "recurring-tasks";
  }

  function isSpecialTodoSectionId(sectionId) {
    return isArchiveTodoSectionId(sectionId) || isRecurringTodoSectionId(sectionId);
  }

  function getAllTodoCards() {
    return cockpitBoard && Array.isArray(cockpitBoard.cards)
      ? cockpitBoard.cards.slice()
      : [];
  }

  function getVisibleTodoCards(filters) {
    var allCards = getAllTodoCards();
    if (!filters || filters.showArchived !== true) {
      allCards = allCards.filter(function (card) {
        return !card.archived && !isArchiveTodoSectionId(card.sectionId);
      });
    }
    if (!filters || filters.showRecurringTasks !== true) {
      allCards = allCards.filter(function (card) {
        return !isRecurringTodoSectionId(card.sectionId);
      });
    }
    return allCards;
  }

  function getTaskLabelCatalog() {
    var catalog = [];
    var seen = Object.create(null);
    (Array.isArray(tasks) ? tasks : []).forEach(function (task) {
      getEffectiveLabels(task).forEach(function (label) {
        var normalizedName = normalizeTodoLabel(label);
        var key = normalizeTodoLabelKey(normalizedName);
        if (!normalizedName || !key || seen[key]) {
          return;
        }
        seen[key] = true;
        catalog.push({
          key: key,
          name: normalizedName,
          color: "var(--vscode-badge-background)",
          source: "task",
        });
      });
    });
    return catalog.sort(function (left, right) {
      return String(left.name).localeCompare(String(right.name));
    });
  }

  function getLabelCatalog() {
    var merged = [];
    var byKey = Object.create(null);
    var boardCatalog = cockpitBoard && Array.isArray(cockpitBoard.labelCatalog)
      ? cockpitBoard.labelCatalog.slice()
      : [];

    boardCatalog.forEach(function (entry) {
      var normalizedName = normalizeTodoLabel(entry && entry.name);
      var key = normalizeTodoLabelKey(entry && (entry.key || entry.name || ""));
      if (!normalizedName || !key) {
        return;
      }
      byKey[key] = {
        key: key,
        name: normalizedName,
        color: entry.color || "var(--vscode-badge-background)",
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        source: "board",
      };
    });

    getTaskLabelCatalog().forEach(function (entry) {
      if (!byKey[entry.key]) {
        byKey[entry.key] = entry;
      }
    });

    Object.keys(byKey).forEach(function (key) {
      merged.push(byKey[key]);
    });

    return merged.sort(function (left, right) {
      return String(left.name).localeCompare(String(right.name));
    });
  }

  function getFlagCatalog() {
    return cockpitBoard && Array.isArray(cockpitBoard.flagCatalog)
      ? cockpitBoard.flagCatalog.slice()
      : [];
  }

  function getFlagDefinition(flagName) {
    var key = normalizeTodoLabelKey(flagName);
    var catalog = getFlagCatalog();
    for (var index = 0; index < catalog.length; index += 1) {
      if (normalizeTodoLabelKey(catalog[index].key || catalog[index].name) === key) {
        return catalog[index];
      }
    }
    return null;
  }

  function getFlagColor(flagName) {
    var definition = getFlagDefinition(flagName);
    return definition && definition.color
      ? definition.color
      : "#f59e0b";
  }

  function getFlagDisplayName(flagName) {
    var key = normalizeTodoLabelKey(flagName);
    if (key === "go") {
      return strings.boardFlagPresetGo || "Ready";
    }
    if (key === "rejected" || key === "abgelehnt") {
      return strings.boardFlagPresetRejected || "Rejected";
    }
    if (key === "needs-bot-review") {
      return strings.boardFlagPresetNeedsBotReview || "Needs bot review";
    }
    if (key === "needs-user-review") {
      return strings.boardFlagPresetNeedsUserReview || "Needs user review";
    }
    if (key === "new") {
      return strings.boardFlagPresetNew || "New";
    }
    var definition = getFlagDefinition(flagName);
    return definition && definition.name ? definition.name : flagName;
  }

  function isProtectedFlagDefinition(entryOrName) {
    var entry = entryOrName && typeof entryOrName === "object"
      ? entryOrName
      : getFlagDefinition(entryOrName);
    if (entry && entry.system === true) {
      return true;
    }
    var key = normalizeTodoLabelKey(
      entry && (entry.key || entry.name)
        ? (entry.key || entry.name)
        : entryOrName,
    );
    return key === "go"
      || key === "rejected"
      || key === "abgelehnt"
      || key === "needs-bot-review"
      || key === "needs-user-review"
      || key === "new";
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

  function upsertLocalLabelDefinition(name, color, previousName) {
    var normalizedName = normalizeTodoLabel(name);
    var nextColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(color || ""))
      ? String(color)
      : "#4f8cff";
    var nextKey = normalizeTodoLabelKey(normalizedName);
    var previousKey = normalizeTodoLabelKey(previousName || "");
    var existingEntry = null;
    var nextCatalog;

    if (!normalizedName || !nextKey) {
      return;
    }
    if (!cockpitBoard) {
      cockpitBoard = {
        version: 4,
        sections: [],
        cards: [],
        labelCatalog: [],
        filters: { labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false },
        updatedAt: "",
      };
    }

    nextCatalog = Array.isArray(cockpitBoard.labelCatalog)
      ? cockpitBoard.labelCatalog.slice()
      : [];
    nextCatalog = nextCatalog.filter(function (entry) {
      var entryKey = normalizeTodoLabelKey(entry && (entry.key || entry.name || ""));
      if (!entryKey) {
        return false;
      }
      if (entryKey === nextKey || (previousKey && entryKey === previousKey)) {
        if (!existingEntry) {
          existingEntry = entry;
        }
        return false;
      }
      return true;
    });
    nextCatalog.push({
      key: nextKey,
      name: normalizedName,
      color: nextColor,
      createdAt: existingEntry && existingEntry.createdAt ? existingEntry.createdAt : undefined,
      updatedAt: cockpitBoard.updatedAt || (new Date()).toISOString(),
    });
    cockpitBoard = Object.assign({}, cockpitBoard, {
      labelCatalog: nextCatalog.sort(function (left, right) {
        return String(left.name).localeCompare(String(right.name));
      }),
    });
  }

  function clearCatalogDeleteState(kind) {
    if (!kind || kind === "label") {
      pendingDeleteLabelName = "";
    }
    if (!kind || kind === "flag") {
      pendingDeleteFlagName = "";
    }
  }

  function isPendingCatalogDelete(kind, name) {
    var pendingName = kind === "flag" ? pendingDeleteFlagName : pendingDeleteLabelName;
    return !!pendingName && normalizeTodoLabelKey(pendingName) === normalizeTodoLabelKey(name || "");
  }

  function removeLabelFromCurrentTodo(label) {
    setTodoEditorLabels(
      currentTodoLabels.filter(function (entry) {
        return normalizeTodoLabelKey(entry) !== normalizeTodoLabelKey(label);
      }),
      true,
    );
    if (normalizeTodoLabelKey(selectedTodoLabelName) === normalizeTodoLabelKey(label)) {
      selectedTodoLabelName = "";
    }
  }

  function reconcileTodoEditorCatalogState() {
    if (selectedTodoLabelName && !getLabelDefinition(selectedTodoLabelName)) {
      var stillApplied = currentTodoLabels.some(function (label) {
        return normalizeTodoLabelKey(label) === normalizeTodoLabelKey(selectedTodoLabelName);
      });
      if (!stillApplied) {
        selectedTodoLabelName = "";
      }
    }
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
      '<span data-label-chip="' + escapeAttr(label) + '" style="border-radius:999px;background:' + escapeAttr(color) + ';color:' + escapeAttr(textColor) + ';border:1px solid ' + escapeAttr(borderColor) + ';">' +
      '<button type="button" data-label-chip-select="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;color:inherit;">' + escapeHtml(label) + '</button>' +
      (removable
        ? '<button type="button" data-label-chip-remove="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;">×</button>'
        : "") +
      '</span>'
    );
  }

  function renderFlagChip(flagName, removable) {
    var color = getFlagColor(flagName);
    var textColor = getReadableTextColor(color);
    var displayName = getFlagDisplayName(flagName);
    return (
      '<span data-flag-chip="' + escapeAttr(flagName) + '" style="border-radius:4px;background:' + escapeAttr(color) + ';color:' + escapeAttr(textColor) + ';border:1px solid color-mix(in srgb,' + escapeAttr(color) + ' 70%,var(--vscode-panel-border));font-weight:600;">' +
      '<span>' + escapeHtml(displayName) + '</span>' +
      (removable
        ? '<button type="button" data-flag-chip-remove="' + escapeAttr(flagName) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;line-height:1;" title="' + escapeAttr(strings.boardFlagClearTitle || strings.boardFlagClear || "Clear flag") + '">×</button>'
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
    syncEditorTabLabels();
  }

  function syncLabelCatalog() {
    if (!todoLabelCatalog) return;
    var addedKeys = currentTodoLabels.map(normalizeTodoLabelKey);
    var catalog = getLabelCatalog().filter(function (entry) {
      return addedKeys.indexOf(normalizeTodoLabelKey(entry.name)) < 0;
    });
    if (catalog.length === 0) {
      todoLabelCatalog.innerHTML = "";
      return;
    }
    todoLabelCatalog.innerHTML = catalog.map(function (entry) {
      var bg = entry.color || "var(--vscode-badge-background)";
      var fg = getReadableTextColor(bg);
      var borderColor = "color-mix(in srgb," + bg + " 60%,var(--vscode-panel-border))";
      var canDelete = entry.source !== "task";
      var pendingDelete = canDelete && isPendingCatalogDelete("label", entry.name);
      return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 12px;border-radius:999px;background:' + escapeAttr(bg) + ';color:' + escapeAttr(fg) + ';border:1.5px solid ' + escapeAttr(borderColor) + ';font-size:12px;">'
        + '<button type="button" data-label-catalog-select="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="' + escapeAttr(strings.boardLabelCatalogAddTitle || "Add to todo") + '">' + escapeHtml(entry.name) + '</button>'
        + (pendingDelete
          ? '<button type="button" data-label-catalog-confirm-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="' + escapeAttr(strings.boardLabelCatalogDeleteTitle || "Delete label") + '">' + escapeHtml(strings.boardDeleteConfirm || 'Delete?') + '</button>'
          : '<button type="button" data-label-catalog-edit="' + escapeAttr(entry.name) + '" data-label-catalog-edit-color="' + escapeAttr(bg) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="' + escapeAttr(strings.boardLabelCatalogEditTitle || "Edit label") + '">✎</button>'
          + (canDelete
            ? '<button type="button" data-label-catalog-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="' + escapeAttr(strings.boardLabelCatalogDeleteTitle || "Delete label") + '">×</button>'
            : ''))
        + '</span>';
    }).join("");
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
      } else {
        labels = [];
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
      if (todoLabelColorSaveBtn) { todoLabelColorSaveBtn.disabled = !getActiveTodoLabelEditorName(); }
syncTodoLabelSuggestions();
    syncLabelCatalog();
  }

  function addEditorLabelFromInput() {
    if (!todoLabelsInput) {
      emitWebviewDebug("todoLabelAddIgnored", { reason: "missingInput" });
      return;
    }
    clearCatalogDeleteState("label");
    var label = normalizeTodoLabel(todoLabelsInput.value);
    if (!label) {
      emitWebviewDebug("todoLabelAddIgnored", {
        reason: "emptyLabel",
        rawValue: String(todoLabelsInput.value || ""),
      });
      return;
    }
    emitWebviewDebug("todoLabelAddAccepted", {
      label: label,
      editingExisting: !!editingLabelOriginalName,
      color: todoLabelColorInput ? todoLabelColorInput.value : "",
    });
    var prevName = editingLabelOriginalName;
    editingLabelOriginalName = "";
    var pendingColor = todoLabelColorInput ? todoLabelColorInput.value : "";
    todoLabelsInput.value = "";
    if (prevName) {
      var prevKey = normalizeTodoLabelKey(prevName);
      var currentLabelKeys = currentTodoLabels.map(normalizeTodoLabelKey);
      var prevIndex = currentLabelKeys.indexOf(prevKey);
      if (prevIndex >= 0) {
        var renamedLabels = currentTodoLabels.slice();
        renamedLabels.splice(prevIndex, 1, label);
        setTodoEditorLabels(renamedLabels, true);
        selectedTodoLabelName = label;
      }
      if (pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
        upsertLocalLabelDefinition(label, pendingColor, prevName);
        vscode.postMessage({ type: "saveTodoLabelDefinition", data: { name: label, previousName: prevName, color: pendingColor } });
      }
      if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
      syncTodoEditorTransientDraft();
      syncTodoLabelEditor();
      return;
    }
    // Normal add: add to current todo labels
    setTodoEditorLabels(currentTodoLabels.concat([label]), true);
    selectedTodoLabelName = label;
    if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
    if (pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
      upsertLocalLabelDefinition(label, pendingColor);
      vscode.postMessage({
        type: "saveTodoLabelDefinition",
        data: { name: label, color: pendingColor },
      });
    }
    syncTodoEditorTransientDraft();
    syncTodoLabelEditor();
  }

  function removeEditorLabel(label) {
    clearCatalogDeleteState("label");
    setTodoEditorLabels(
      currentTodoLabels.filter(function (entry) {
        return normalizeTodoLabelKey(entry) !== normalizeTodoLabelKey(label);
      }),
      true,
    );
    syncTodoLabelEditor();
  }

  function bindRenderedCockpitBoardInteractions() {
    bindBoardColumnInteractions({
      boardColumns: boardColumns,
      getBoardColumns: function () {
        return boardColumns;
      },
      document: document,
      window: window,
      vscode: vscode,
      renderCockpitBoard: renderCockpitBoard,
      openTodoEditor: openTodoEditor,
      openTodoDeleteModal: openTodoDeleteModal,
      setPendingBoardDelete: function (todoId, permanentOnly) {
        pendingBoardDeleteTodoId = String(todoId || "");
        pendingBoardDeletePermanentOnly = !!permanentOnly;
        requestCockpitBoardRender();
      },
      clearPendingBoardDelete: function () {
        pendingBoardDeleteTodoId = "";
        pendingBoardDeletePermanentOnly = false;
        requestCockpitBoardRender();
      },
      submitBoardDeleteChoice: function (choice) {
        if (!pendingBoardDeleteTodoId) {
          return;
        }
        var todoId = pendingBoardDeleteTodoId;
        pendingBoardDeleteTodoId = "";
        pendingBoardDeletePermanentOnly = false;
        if (selectedTodoId === todoId) {
          selectedTodoId = null;
          currentTodoLabels = [];
          selectedTodoLabelName = "";
          currentTodoFlag = "";
        }
        requestCockpitBoardRender();
        vscode.postMessage({
          type: choice === "permanent" ? "purgeTodo" : "rejectTodo",
          todoId: todoId,
        });
      },
      handleSectionCollapse: function (collapseBtn) {
        handleBoardSectionCollapse(collapseBtn, {
          toggleSectionCollapsed: toggleSectionCollapsed,
          collapsedSections: collapsedSections,
        });
      },
      handleSectionRename: function (sectionRenameBtn) {
        handleBoardSectionRename(sectionRenameBtn, {
          document: document,
          vscode: vscode,
          setTimeout: setTimeout,
        });
      },
      handleSectionDelete: function (sectionDeleteBtn) {
        handleBoardSectionDelete(sectionDeleteBtn, {
          strings: strings,
          vscode: vscode,
          setTimeout: setTimeout,
        });
      },
      handleTodoCompletion: function (completeToggle) {
        handleBoardTodoCompletion(completeToggle, {
          cockpitBoard: cockpitBoard,
          document: document,
          strings: strings,
          setTimeout: setTimeout,
          vscode: vscode,
        });
      },
      handleTodoReject: function (rejectBtn) {
        var todoId = rejectBtn.getAttribute("data-todo-reject") || "";
        if (!todoId) {
          return;
        }
        vscode.postMessage({ type: "rejectTodo", todoId: todoId });
      },
      handleTodoRestore: function (restoreBtn) {
        var todoId = restoreBtn.getAttribute("data-todo-restore") || "";
        if (!todoId) {
          return;
        }
        vscode.postMessage({ type: "archiveTodo", todoId: todoId, archived: false });
      },
      setSelectedTodoId: function (todoId) {
        selectedTodoId = todoId;
      },
      getDraggingSectionId: function () {
        return draggingSectionId;
      },
      setDraggingSectionId: function (value) {
        draggingSectionId = value;
      },
      getLastDragOverSectionId: function () {
        return lastDragOverSectionId;
      },
      setLastDragOverSectionId: function (value) {
        lastDragOverSectionId = value;
      },
      getDraggingTodoId: function () {
        return draggingTodoId;
      },
      setDraggingTodoId: function (value) {
        draggingTodoId = value;
      },
      setIsBoardDragging: function (value) {
        isBoardDragging = value;
      },
      requestAnimationFrame: requestAnimationFrame,
      finishBoardDragState: finishBoardDragState,
      isArchiveTodoSectionId: isArchiveTodoSectionId,
      isSpecialTodoSectionId: isSpecialTodoSectionId,
    });
  }

  function ensureTodoEditorListenersBound() {
    if (todoEditorListenersBound) {
      return;
    }
    todoEditorListenersBound = true;

    [todoTitleInput, todoDescriptionInput, todoDueInput].forEach(function (element) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("input", function () {
        syncTodoDraftFromInputs("input");
      });
    });

    [todoPriorityInput, todoSectionInput, todoLinkedTaskSelect].forEach(function (element) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("change", function () {
        syncTodoDraftFromInputs("change");
        if (element === todoPriorityInput) {
          syncTodoPriorityInputTone();
        }
      });
    });

    bindDebugClickAttempts(todoDetailForm, {
      selector: "#todo-label-add-btn, #todo-label-color-save-btn, #todo-flag-add-btn, #todo-flag-color-save-btn, #todo-label-color-input, #todo-flag-color-input",
      eventName: "todoDetailClickAttempt",
    });

    document.addEventListener("click", function (event) {
      var removeBtn = getClosestEventTarget(event, "[data-flag-chip-remove]");
      if (removeBtn) {
        currentTodoFlag = "";
        syncTodoFlagDraft();
        syncFlagEditor();
        return;
      }
      var catalogSelect = getClosestEventTarget(event, "[data-flag-catalog-select]");
      if (catalogSelect) {
        event.preventDefault();
        event.stopPropagation();
        clearCatalogDeleteState("flag");
        var flagName = catalogSelect.getAttribute("data-flag-catalog-select") || "";
        if (!flagName) return;
        currentTodoFlag = normalizeTodoLabel(flagName) || flagName;
        syncTodoFlagDraft();
        syncFlagEditor();
        return;
      }
      var catalogEdit = getClosestEventTarget(event, "[data-flag-catalog-edit]");
      if (catalogEdit) {
        event.preventDefault();
        event.stopPropagation();
        clearCatalogDeleteState("flag");
        var feName = catalogEdit.getAttribute("data-flag-catalog-edit") || "";
        var feCatalog = getFlagCatalog();
        var feEntry = null;
        for (var fei = 0; fei < feCatalog.length; fei++) {
          if (normalizeTodoLabelKey(feCatalog[fei].name) === normalizeTodoLabelKey(feName)) { feEntry = feCatalog[fei]; break; }
        }
        var todoFlagNameInputEl = document.getElementById("todo-flag-name-input");
        var todoFlagColorInputEl = document.getElementById("todo-flag-color-input");
        if (todoFlagNameInputEl) todoFlagNameInputEl.value = feEntry ? feEntry.name : feName;
        if (todoFlagColorInputEl && feEntry && feEntry.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(feEntry.color)) todoFlagColorInputEl.value = feEntry.color;
        editingFlagOriginalName = feName;
        syncTodoEditorTransientDraft();
        if (todoFlagNameInputEl) todoFlagNameInputEl.focus();
        return;
      }
      var catalogConfirmDelete = getClosestEventTarget(event, "[data-flag-catalog-confirm-delete]");
      if (catalogConfirmDelete) {
        event.preventDefault();
        event.stopPropagation();
        var confirmFlagName = catalogConfirmDelete.getAttribute("data-flag-catalog-confirm-delete") || "";
        if (!confirmFlagName) return;
        clearCatalogDeleteState("flag");
        if (normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(confirmFlagName)) {
          currentTodoFlag = "";
          syncTodoFlagDraft();
        }
        syncFlagEditor();
        vscode.postMessage({ type: "deleteTodoFlagDefinition", data: { name: confirmFlagName } });
        return;
      }
      var catalogDelete = getClosestEventTarget(event, "[data-flag-catalog-delete]");
      if (catalogDelete) {
        event.preventDefault();
        event.stopPropagation();
        var flagName = catalogDelete.getAttribute("data-flag-catalog-delete") || "";
        if (!flagName) return;
        pendingDeleteFlagName = flagName;
        syncFlagEditor();
      }
    });
  }



  function syncFlagEditor() {
    var todoflagCurrentEl = document.getElementById("todo-flag-current");
    var todoFlagPickerEl = document.getElementById("todo-flag-picker");
    if (todoflagCurrentEl) {
      if (currentTodoFlag) {
        todoflagCurrentEl.innerHTML = renderFlagChip(currentTodoFlag, true);
      } else {
        todoflagCurrentEl.innerHTML = '<span class="note">' + escapeHtml(strings.boardFlagNone || "No flag set.") + '</span>';
      }
    }
    if (todoFlagPickerEl) {
      var catalog = getFlagCatalog();
      if (catalog.length === 0) {
        todoFlagPickerEl.innerHTML = "";
      } else {
        todoFlagPickerEl.innerHTML = catalog.map(function (entry) {
          var bg = entry.color || "#f59e0b";
          var fg = getReadableTextColor(bg);
          var isActive = normalizeTodoLabelKey(entry.name) === normalizeTodoLabelKey(currentTodoFlag);
          var borderStyle = isActive ? "2px solid var(--vscode-focusBorder)" : "1px solid color-mix(in srgb," + bg + " 70%,var(--vscode-panel-border))";
          var pendingDelete = isPendingCatalogDelete("flag", entry.name);
          var protectedFlag = isProtectedFlagDefinition(entry);
          var displayName = getFlagDisplayName(entry.name);
          return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:' + escapeAttr(bg) + ';color:' + escapeAttr(fg) + ';border:' + borderStyle + ';font-size:inherit;font-weight:600;line-height:1.4;">'
            + '<button type="button" data-flag-catalog-select="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="' + escapeAttr(strings.boardFlagCatalogSelectTitle || "Set as flag") + '">' + escapeHtml(displayName) + '</button>'
            + (protectedFlag
              ? '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.75;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogLockedTitle || "Built-in flag") + '">🔒</span>'
              : pendingDelete
              ? '<button type="button" data-flag-catalog-confirm-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="' + escapeAttr(strings.boardFlagCatalogDeleteTitle || "Delete flag") + '">' + escapeHtml(strings.boardDeleteConfirm || 'Delete?') + '</button>'
              : '<button type="button" data-flag-catalog-edit="' + escapeAttr(entry.name) + '" data-flag-catalog-edit-color="' + escapeAttr(bg) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogEditTitle || "Edit flag") + '">✎</button>'
              + '<button type="button" data-flag-catalog-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogDeleteTitle || "Delete flag") + '">×</button>')
            + '</span>';
        }).join("");
      }
    }
    syncEditorTabLabels();
  }

  function addFlagFromInput() {
    clearCatalogDeleteState("flag");
    var todoFlagNameInput = document.getElementById("todo-flag-name-input");
    var todoFlagColorInput = document.getElementById("todo-flag-color-input");
    if (!todoFlagNameInput) {
      emitWebviewDebug("todoFlagAddIgnored", { reason: "missingInput" });
      return;
    }
    var name = normalizeTodoLabel(todoFlagNameInput.value);
    if (!name) {
      emitWebviewDebug("todoFlagAddIgnored", {
        reason: "emptyFlag",
        rawValue: String(todoFlagNameInput.value || ""),
      });
      return;
    }
    var color = todoFlagColorInput ? todoFlagColorInput.value : "#f59e0b";
    emitWebviewDebug("todoFlagAddAccepted", {
      flag: name,
      editingExisting: !!editingFlagOriginalName,
      color: color,
    });
    var prevName = editingFlagOriginalName;
    editingFlagOriginalName = "";
    todoFlagNameInput.value = "";
    if (prevName && normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(name)) {
      if (normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(prevName)) {
        currentTodoFlag = name;
      }
    }
    vscode.postMessage({ type: "saveTodoFlagDefinition", data: { name: name, previousName: prevName || undefined, color: color } });
    if (!prevName) { currentTodoFlag = name; }
    syncTodoFlagDraft();
    syncTodoEditorTransientDraft();
    syncFlagEditor();
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

  function getTodoPriorityCardBg(priority, isSelected) {
    if (isSelected) return "var(--vscode-list-activeSelectionBackground)";
    switch (priority) {
      case "urgent": return "color-mix(in srgb, #ef4444 12%, var(--vscode-sideBar-background))";
      case "high":   return "color-mix(in srgb, #f59e0b 12%, var(--vscode-sideBar-background))";
      case "medium": return "color-mix(in srgb, #3b82f6 12%, var(--vscode-sideBar-background))";
      case "low":    return "color-mix(in srgb, #6b7280 12%, var(--vscode-sideBar-background))";
      default:       return "color-mix(in srgb, #9ca3af 6%, var(--vscode-sideBar-background))";
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

  function normalizeTodoFilters(filters) {
    var record = filters && typeof filters === "object" ? filters : {};
    return {
      searchText: record.searchText || "",
      labels: Array.isArray(record.labels) ? record.labels.slice() : [],
      priorities: Array.isArray(record.priorities) ? record.priorities.slice() : [],
      statuses: Array.isArray(record.statuses) ? record.statuses.slice() : [],
      archiveOutcomes: Array.isArray(record.archiveOutcomes) ? record.archiveOutcomes.slice() : [],
      flags: Array.isArray(record.flags) ? record.flags.slice() : [],
      sectionId: record.sectionId || "",
      sortBy: record.sortBy || "manual",
      sortDirection: record.sortDirection || "asc",
      viewMode: record.viewMode === "list" ? "list" : "board",
      showArchived: record.showArchived === true,
      showRecurringTasks: record.showRecurringTasks === true,
      hideCardDetails: record.hideCardDetails === true,
    };
  }

  function areTodoFilterListsEqual(left, right) {
    if (left.length !== right.length) {
      return false;
    }
    for (var index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }

  function areTodoFiltersEqual(left, right) {
    var nextLeft = normalizeTodoFilters(left);
    var nextRight = normalizeTodoFilters(right);
    return nextLeft.searchText === nextRight.searchText
      && areTodoFilterListsEqual(nextLeft.labels, nextRight.labels)
      && areTodoFilterListsEqual(nextLeft.priorities, nextRight.priorities)
      && areTodoFilterListsEqual(nextLeft.statuses, nextRight.statuses)
      && areTodoFilterListsEqual(nextLeft.archiveOutcomes, nextRight.archiveOutcomes)
      && areTodoFilterListsEqual(nextLeft.flags, nextRight.flags)
      && nextLeft.sectionId === nextRight.sectionId
      && nextLeft.sortBy === nextRight.sortBy
      && nextLeft.sortDirection === nextRight.sortDirection
      && nextLeft.viewMode === nextRight.viewMode
      && nextLeft.showArchived === nextRight.showArchived
      && nextLeft.showRecurringTasks === nextRight.showRecurringTasks
      && nextLeft.hideCardDetails === nextRight.hideCardDetails;
  }

  function getTodoFilters() {
    return normalizeTodoFilters(cockpitBoard && cockpitBoard.filters ? cockpitBoard.filters : {});
  }

  function updateTodoFilters(partial) {
    var next = normalizeTodoFilters(Object.assign({}, getTodoFilters(), partial || {}));
    if (partial && typeof partial.hideCardDetails === "boolean") {
      boardCardDetailsHidden = partial.hideCardDetails;
      try {
        localStorage.setItem("cockpit-hide-card-details", boardCardDetailsHidden ? "1" : "0");
      } catch (_e) {}
    }
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
    pendingTodoFilters = next;
    cockpitBoard.filters = next;
    renderCockpitBoard();
    vscode.postMessage({ type: "setTodoFilters", data: next });
  }

  function hasActiveTodoFilters(filters) {
    var current = filters || getTodoFilters();
    return Boolean(
      (current.searchText && String(current.searchText).trim()) ||
      (Array.isArray(current.labels) && current.labels.length > 0) ||
      (Array.isArray(current.priorities) && current.priorities.length > 0) ||
      (Array.isArray(current.statuses) && current.statuses.length > 0) ||
      (Array.isArray(current.archiveOutcomes) && current.archiveOutcomes.length > 0) ||
      (Array.isArray(current.flags) && current.flags.length > 0) ||
      (current.sectionId && String(current.sectionId).trim()) ||
      current.showArchived === true ||
      current.showRecurringTasks === true ||
      current.hideCardDetails === true
    );
  }

  function clearTodoFilters() {
    updateTodoFilters({
      searchText: "",
      labels: [],
      priorities: [],
      statuses: [],
      archiveOutcomes: [],
      flags: [],
      sectionId: "",
      showArchived: false,
      showRecurringTasks: false,
      hideCardDetails: false,
    });
  }

  function getTodoSections(filters) {
    var sections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice() : [];
    sections.sort(function (left, right) {
      return (left.order || 0) - (right.order || 0);
    });
    return sections.filter(function (section) {
      if (!(filters && filters.showArchived === true) && isArchiveTodoSectionId(section.id)) {
        return false;
      }
      if (!(filters && filters.showRecurringTasks === true) && isRecurringTodoSectionId(section.id)) {
        return false;
      }
      return true;
    });
  }

  function getEditableTodoSections() {
    return getTodoSections({ showArchived: true, showRecurringTasks: true }).filter(function (section) {
      return !isSpecialTodoSectionId(section.id);
    });
  }

  function isTodoReadyForFinalize(card) {
    return !!(card && !card.archived && card.status === "ready");
  }

  function getTodoCompletionActionType(card) {
    return isTodoReadyForFinalize(card) ? "finalizeTodo" : "approveTodo";
  }

  function getTodoCompletionActionLabel(card) {
    return isTodoReadyForFinalize(card)
      ? (strings.boardFinalizeTodo || "Final Accept")
      : (strings.boardApproveTodo || "Approve");
  }

  function getTodoFinalizeConfirmLabel() {
    return strings.boardFinalizeTodoYes || "Yes";
  }

  function getTodoFinalizeCancelLabel() {
    return strings.boardFinalizeTodoNo || "No";
  }

  function isTodoCompleted(card) {
    return !!(card && card.archived && card.archiveOutcome === "completed-successfully");
  }

  function renderTodoCompletionButton(card) {
    var isArchivedCard = !!(card && card.archived);
    var title = isArchivedCard
      ? (strings.boardRestoreTodo || "Restore")
      : getTodoCompletionActionLabel(card);
    var icon = isTodoCompleted(card)
      ? "✓"
      : "○";
    var actionAttr = isArchivedCard ? 'data-todo-restore' : 'data-todo-complete';
    var className = 'todo-complete-button';
    if (isTodoReadyForFinalize(card)) {
      className += ' is-ready-to-finalize';
    }
    if (isTodoCompleted(card)) {
      className += ' is-completed';
    }
    return '<button type="button" class="' + className + '" ' + actionAttr + '="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(title) + '" aria-label="' + escapeAttr(title) + '"' + (isTodoReadyForFinalize(card) ? ' data-finalize-state="idle" data-confirm-label="' + escapeAttr(getTodoFinalizeConfirmLabel()) + '" data-cancel-label="' + escapeAttr(getTodoFinalizeCancelLabel()) + '"' : '') + ' ' +
      'style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;border:1px solid var(--vscode-input-border, var(--vscode-panel-border));background:' + (isTodoCompleted(card) ? 'color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 82%, var(--vscode-button-background))' : 'var(--vscode-input-background)') + ';color:' + (isTodoCompleted(card) ? 'var(--vscode-button-foreground)' : 'var(--vscode-foreground)') + ';cursor:pointer;font-size:12px;font-weight:700;line-height:1;flex:0 0 auto;">' +
      '<span aria-hidden="true">' + escapeHtml(icon) + '</span></button>';
  }

  function renderTodoDragHandle(card) {
    if (!card || card.archived) {
      return '';
    }
    return '<span class="cockpit-drag-handle" data-todo-drag-handle="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(strings.boardReorderTodo || 'Drag todo') + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:0 4px;cursor:grab;color:var(--vscode-descriptionForeground);user-select:none;line-height:1;font-weight:700;">::</span>';
  }

  function renderSectionDragHandle(section, isArchiveSection) {
    if (!section || isArchiveSection) {
      return '';
    }
    return '<span class="cockpit-drag-handle" data-section-drag-handle="' + escapeAttr(section.id) + '" data-no-drag="1" title="' + escapeAttr(strings.boardReorderSection || 'Drag section') + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:0 4px;cursor:grab;color:var(--vscode-descriptionForeground);user-select:none;line-height:1;font-weight:700;">::</span>';
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
    if (!filters.showRecurringTasks && isRecurringTodoSectionId(card.sectionId)) {
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
    var flags = dedupeStringList(
      getFlagCatalog().map(function (entry) {
        return entry.name;
      }).concat((Array.isArray(cards) ? cards : []).reduce(function (all, card) {
        return all.concat(card.flags || []);
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
    if (todoFlagFilter) {
      todoFlagFilter.innerHTML =
        '<option value="">' + escapeHtml(strings.boardAllFlags || "All flags") + '</option>' +
        flags.map(function (flag) {
          return '<option value="' + escapeAttr(flag) + '">' + escapeHtml(flag) + '</option>';
        }).join("");
      todoFlagFilter.value = filters.flags[0] || "";
    }
    if (todoPriorityFilter) {
      var PRIORITY_FILTER_STYLES = { "": "", none: "background:#d1d5db;color:#374151;", low: "background:#6b7280;color:#fff;", medium: "background:#3b82f6;color:#fff;", high: "background:#f59e0b;color:#fff;", urgent: "background:#ef4444;color:#fff;" };
      todoPriorityFilter.innerHTML = [
        { value: "", label: strings.boardAllPriorities || "All priorities" },
        { value: "none", label: getTodoPriorityLabel("none") },
        { value: "low", label: getTodoPriorityLabel("low") },
        { value: "medium", label: getTodoPriorityLabel("medium") },
        { value: "high", label: getTodoPriorityLabel("high") },
        { value: "urgent", label: getTodoPriorityLabel("urgent") },
      ].map(function (option) {
        var optStyle = PRIORITY_FILTER_STYLES[option.value] || "";
        var style = optStyle ? ' style="' + optStyle + '"' : "";
        return '<option value="' + escapeAttr(option.value) + '"' + style + '>' + escapeHtml(option.label) + '</option>';
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
    if (todoViewMode) {
      todoViewMode.innerHTML = [
        { value: "board", label: strings.boardViewBoard || "Board" },
        { value: "list", label: strings.boardViewList || "List" },
      ].map(function (option) {
        return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + '</option>';
      }).join("");
      todoViewMode.value = filters.viewMode || "board";
    }
    if (todoShowArchived) {
      todoShowArchived.checked = filters.showArchived === true;
    }
    if (todoShowRecurringTasks) {
      todoShowRecurringTasks.checked = filters.showRecurringTasks === true;
    }
    if (todoHideCardDetails) {
      var hideCardDetails = filters.hideCardDetails === true || boardCardDetailsHidden === true;
      todoHideCardDetails.checked = hideCardDetails;
    }
    document.documentElement.classList.toggle(
      "cockpit-board-hide-card-details",
      filters.hideCardDetails === true || boardCardDetailsHidden === true,
    );
    if (todoClearFiltersBtn) {
      todoClearFiltersBtn.disabled = !hasActiveTodoFilters(filters);
    }
    if (cockpitColSlider) {
      var widthGroup = cockpitColSlider.closest ? cockpitColSlider.closest(".board-col-width-group") : null;
      if (widthGroup) {
        widthGroup.style.display = filters.viewMode === "list" ? "none" : "flex";
      }
    }
  }

  function renderTodoDetailPanel(selectedTodo, sections) {
    var isEditingTodo = !!selectedTodo;
    var isArchivedTodo = !!(selectedTodo && selectedTodo.archived);
    var todoDraft = isEditingTodo ? null : currentTodoDraft;
    // Detect passive re-render of the same todo already being edited.
    // When true, preserve unsaved form state (labels, flag, inputs) so that
    // catalog saves or unrelated board updates don't wipe user edits.
    var isRefreshingSameTodo = isEditingTodo && todoDetailId && todoDetailId.value === selectedTodo.id;
    var sectionOptions = getEditableTodoSections();
    if (isEditingTodo && selectedTodo && selectedTodo.sectionId) {
      var hasCurrentSection = sectionOptions.some(function (section) {
        return section.id === selectedTodo.sectionId;
      });
      if (!hasCurrentSection) {
        var currentSection = (Array.isArray(sections) ? sections : []).find(function (section) {
          return section.id === selectedTodo.sectionId;
        });
        if (currentSection) {
          sectionOptions = sectionOptions.concat([currentSection]);
        }
      }
    }
    syncEditorTabLabels();
    if (!isRefreshingSameTodo) {
      if (isEditingTodo) {
        setTodoEditorLabels(selectedTodo.labels || [], false);
      } else {
        setTodoEditorLabels(currentTodoLabels, true);
      }
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
    if (!isRefreshingSameTodo) {
      if (todoTitleInput) todoTitleInput.value = isEditingTodo ? (selectedTodo.title || "") : (todoDraft.title || "");
      if (todoDescriptionInput) todoDescriptionInput.value = isEditingTodo ? (selectedTodo.description || "") : (todoDraft.description || "");
      if (todoDueInput) todoDueInput.value = isEditingTodo ? toLocalDateTimeInput(selectedTodo.dueAt) : (todoDraft.dueAt || "");
      if (todoLabelsInput) todoLabelsInput.value = isEditingTodo ? "" : (todoDraft.labelInput || "");
      if (todoLabelColorInput && !isEditingTodo && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(todoDraft.labelColor || "")) {
        todoLabelColorInput.value = todoDraft.labelColor;
      }
      currentTodoFlag = isEditingTodo
        ? ((selectedTodo.flags || [])[0] || "")
        : (todoDraft.flag || "");
      if (todoFlagNameInput) todoFlagNameInput.value = isEditingTodo ? "" : (todoDraft.flagInput || "");
      if (todoFlagColorInput && !isEditingTodo && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(todoDraft.flagColor || "")) {
        todoFlagColorInput.value = todoDraft.flagColor;
      }
    }
    setTodoUploadNote(strings.boardUploadFilesHint || "", "neutral");
    syncTodoFlagDraft();
    syncFlagEditor();
    syncTodoLabelEditor();
    if (todoFlagColorSaveBtn) {
      todoFlagColorSaveBtn.disabled = !todoFlagNameInput || !todoFlagNameInput.value.trim();
    }

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
      var prevPriority = isRefreshingSameTodo ? todoPriorityInput.value : "";
      todoPriorityInput.innerHTML = ["none", "low", "medium", "high", "urgent"].map(function (priority) {
        return '<option value="' + escapeAttr(priority) + '">' + escapeHtml(getTodoPriorityLabel(priority)) + '</option>';
      }).join("");
      todoPriorityInput.value = isRefreshingSameTodo ? prevPriority : (isEditingTodo ? (selectedTodo.priority || "none") : (todoDraft.priority || "none"));
      syncTodoPriorityInputTone();
    }

    if (todoSectionInput) {
      var prevSection = isRefreshingSameTodo ? todoSectionInput.value : "";
      todoSectionInput.innerHTML = sectionOptions.map(function (section) {
        return '<option value="' + escapeAttr(section.id) + '">' + escapeHtml(section.title) + '</option>';
      }).join("");
      if (isRefreshingSameTodo && selectHasOptionValue(todoSectionInput, prevSection)) {
        todoSectionInput.value = prevSection;
      } else {
        todoSectionInput.value = isEditingTodo
          ? selectedTodo.sectionId
          : ((todoDraft.sectionId && selectHasOptionValue(todoSectionInput, todoDraft.sectionId))
            ? todoDraft.sectionId
            : (sectionOptions[0] ? sectionOptions[0].id : ""));
      }
    }

    if (!isRefreshingSameTodo) {
      syncTodoLinkedTaskOptions(isEditingTodo && selectedTodo ? (selectedTodo.taskId || "") : (todoDraft.taskId || ""));
    }
    if (!isEditingTodo) {
      currentTodoDraft.priority = todoPriorityInput ? (todoPriorityInput.value || "none") : "none";
      currentTodoDraft.sectionId = todoSectionInput ? (todoSectionInput.value || "") : "";
      currentTodoDraft.dueAt = todoDueInput ? (todoDueInput.value || "") : "";
    }

    if (todoSaveBtn) {
      todoSaveBtn.textContent = isEditingTodo
        ? (strings.boardSaveUpdate || "Save Todo")
        : (strings.boardSaveCreate || "Create Todo");
      todoSaveBtn.disabled = isArchivedTodo;
    }
    if (todoCreateTaskBtn) {
      todoCreateTaskBtn.disabled = !isEditingTodo || isArchivedTodo;
    }
    if (todoCompleteBtn) {
      todoCompleteBtn.textContent = isEditingTodo
        ? getTodoCompletionActionLabel(selectedTodo)
        : (strings.boardApproveTodo || "Approve");
      todoCompleteBtn.disabled = !isEditingTodo || isArchivedTodo;
    }
    if (todoDeleteBtn) todoDeleteBtn.disabled = !isEditingTodo || isArchivedTodo;
    if (todoUploadFilesBtn) todoUploadFilesBtn.disabled = !!isArchivedTodo;
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
      } else if (selectedTodo.status === "ready") {
        todoLinkedTaskNote.textContent = strings.boardReadyForTask || "Approved items can become scheduled task drafts or be final accepted.";
      } else if (selectedTodo.taskId && !linkedTask) {
        todoLinkedTaskNote.textContent = strings.boardTaskMissing || "Linked task not found in Task List.";
      } else if (linkedTask) {
        todoLinkedTaskNote.textContent = (strings.boardTaskLinked || "Linked task") + ": " + (linkedTask.name || linkedTask.id);
      } else {
        todoLinkedTaskNote.textContent = strings.boardTaskDraftNote || "Scheduled tasks remain separate from planning todos.";
      }
    }
    syncEditorTabLabels();

    if (todoCommentList) {
      var comments = isEditingTodo && Array.isArray(selectedTodo.comments) ? selectedTodo.comments : [];
      todoCommentList.innerHTML = comments.length > 0
        ? comments.map(function (comment, commentIndex) {
          var sourceLabel = getTodoCommentSourceLabel(comment.source || "human-form");
          var sequence = typeof comment.sequence === "number" ? comment.sequence : 1;
          var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
          var toneClass = getTodoCommentToneClass(comment);
          var userFormClass = comment.source === "human-form" && String(comment.author || "").toLowerCase() === "user"
            ? " is-user-form"
            : "";
          return '<article class="todo-comment-card' + toneClass + userFormClass + '" data-comment-index="' + escapeAttr(String(commentIndex)) + '" tabindex="0" role="button" aria-label="' + escapeAttr(strings.boardCommentOpenFull || "Open full comment") + '">' +
            '<div class="todo-comment-header">' +
            '<strong>#' + escapeHtml(String(sequence)) + ' • ' + escapeHtml(sourceLabel) + '</strong>' +
            '<div style="display:flex;align-items:center;gap:6px;">' +
            '<span class="note">' + escapeHtml(formatTodoDate(displayDate)) + '</span>' +
            '<button type="button" class="btn-icon todo-comment-delete-btn" data-delete-comment-index="' + escapeAttr(String(commentIndex)) + '" title="' + escapeAttr(strings.boardCommentDelete || "Delete comment") + '">&#128465;</button>' +
            '</div>' +
            '</div>' +
            '<div class="note todo-comment-author">' + escapeHtml(comment.author || "system") + '</div>' +
            '<div class="note todo-comment-body">' + escapeHtml(comment.body || "") + '</div>' +
            '<div class="todo-comment-expand-hint">' + escapeHtml(strings.boardCommentOpenFull || "Open full comment") + '</div>' +
            '</article>';
        }).join("")
        : '<div class="note">' + escapeHtml(strings.boardCommentsEmpty || "No comments yet.") + '</div>';
    }
  }

  function syncTodoLinkedTaskOptions(preferredTaskId) {
    if (!todoLinkedTaskSelect) {
      return;
    }
    var currentValue = todoLinkedTaskSelect.value || "";
    var nextValue = preferredTaskId || currentValue;
    todoLinkedTaskSelect.innerHTML =
      '<option value="">' + escapeHtml(strings.boardLinkedTaskNone || "No linked task") + '</option>' +
      tasks.map(function (task) {
        return '<option value="' + escapeAttr(task.id) + '">' + escapeHtml(task.name || task.id) + '</option>';
      }).join("");

    if (!nextValue) {
      todoLinkedTaskSelect.value = "";
      if (!selectedTodoId) {
        currentTodoDraft.taskId = "";
      }
      return;
    }

    var hasTaskOption = tasks.some(function (task) {
      return task && task.id === nextValue;
    });
    todoLinkedTaskSelect.value = hasTaskOption ? nextValue : "";
    if (!selectedTodoId) {
      currentTodoDraft.taskId = todoLinkedTaskSelect.value || "";
    }
  }

  function renderCockpitBoard() {
    ensureTodoEditorListenersBound();

    var filters = getTodoFilters();
    var sections = getTodoSections(filters);
    var allSections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice().sort(function (left, right) {
      return (left.order || 0) - (right.order || 0);
    }) : [];
    var allCards = getAllTodoCards();
    var cards = getVisibleTodoCards(filters);

    if (selectedTodoId) {
      var selectedTodo = allCards.find(function (card) {
        return card && card.id === selectedTodoId;
      });
      if (selectedTodo && selectedTodo.archived && filters.showArchived !== true) {
        selectedTodoId = null;
      }
      if (selectedTodo && isRecurringTodoSectionId(selectedTodo.sectionId) && filters.showRecurringTasks !== true) {
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
      var activeCount = allCards.filter(function (card) { return !card.archived; }).length;
      var archivedCount = allCards.filter(function (card) { return card.archived; }).length;
      boardSummary.textContent =
        (strings.boardSections || "Sections") + ": " + sections.length +
        " • " +
        (strings.boardCards || "Cards") + ": " + activeCount +
        " • Archived: " + String(archivedCount) +
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

    boardColumns.innerHTML = renderTodoBoardMarkup({
      visibleSections: visibleSections,
      cards: cards,
      filters: filters,
      strings: strings,
      selectedTodoId: selectedTodoId,
      pendingBoardDeleteTodoId: pendingBoardDeleteTodoId,
      pendingBoardDeletePermanentOnly: pendingBoardDeletePermanentOnly,
      collapsedSections: collapsedSections,
      helpers: {
        escapeAttr: escapeAttr,
        escapeHtml: escapeHtml,
        sortTodoCards: sortTodoCards,
        cardMatchesTodoFilters: cardMatchesTodoFilters,
        isArchiveTodoSectionId: isArchiveTodoSectionId,
        isSpecialTodoSectionId: isSpecialTodoSectionId,
        renderSectionDragHandle: renderSectionDragHandle,
        renderTodoCompletionCheckbox: renderTodoCompletionButton,
        renderTodoDragHandle: renderTodoDragHandle,
        renderFlagChip: renderFlagChip,
        renderLabelChip: renderLabelChip,
        getTodoPriorityLabel: getTodoPriorityLabel,
        getTodoStatusLabel: getTodoStatusLabel,
        getTodoDescriptionPreview: getTodoDescriptionPreview,
        getTodoCommentSourceLabel: getTodoCommentSourceLabel,
        getTodoArchiveOutcomeLabel: getTodoArchiveOutcomeLabel,
        getTodoPriorityCardBg: getTodoPriorityCardBg,
        formatTodoDate: formatTodoDate,
      },
    });

    renderTodoDetailPanel(selectedTodoId
      ? allCards.find(function (card) { return card.id === selectedTodoId; }) || null
      : null,
    allSections);

    if (boardColumns) {
      bindRenderedCockpitBoardInteractions();
    }
    scheduleBoardStickyMetrics();

    if (todoNewBtn) {
      todoNewBtn.onclick = function () {
        clearCatalogDeleteState();
        openTodoEditor("");
      };
    }
    if (todoClearSelectionBtn) {
      todoClearSelectionBtn.onclick = function () {
        clearCatalogDeleteState();
        selectedTodoId = null;
        currentTodoLabels = [];
        selectedTodoLabelName = "";
        currentTodoFlag = "";
        syncTodoFlagDraft();
        renderCockpitBoard();
        switchTab("board");
      };
    }
    if (boardAddSectionBtn) {
      boardAddSectionBtn.onclick = function () {
        boardAddSectionBtn.style.display = "none";
        if (boardSectionInlineForm) {
          boardSectionInlineForm.style.display = "flex";
          if (boardSectionNameInput) { boardSectionNameInput.value = ""; boardSectionNameInput.focus(); }
        }
      };
    }
    function hideSectionForm() {
      if (boardSectionInlineForm) boardSectionInlineForm.style.display = "none";
      if (boardAddSectionBtn) boardAddSectionBtn.style.display = "";
    }
    function doAddSection() {
      var title = boardSectionNameInput ? boardSectionNameInput.value.trim() : "";
      if (title) { vscode.postMessage({ type: "addCockpitSection", title: title }); }
      hideSectionForm();
    }
    if (boardSectionSaveBtn) { boardSectionSaveBtn.onclick = doAddSection; }
    if (boardSectionCancelBtn) { boardSectionCancelBtn.onclick = hideSectionForm; }
    if (boardSectionNameInput) {
      boardSectionNameInput.onkeydown = function (e) {
        if (e.key === "Enter") { e.preventDefault(); doAddSection(); }
        if (e.key === "Escape") { hideSectionForm(); }
      };
    }
    if (cockpitColSlider) {
      cockpitColSlider.oninput = function () {
        var w = Number(cockpitColSlider.value);
        applyCockpitColumnScale(w);
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
    if (todoFlagFilter) {
      todoFlagFilter.onchange = function () {
        updateTodoFilters({ flags: todoFlagFilter.value ? [todoFlagFilter.value] : [] });
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
    if (todoViewMode) {
      todoViewMode.onchange = function () {
        updateTodoFilters({ viewMode: todoViewMode.value === "list" ? "list" : "board" });
      };
    }
    if (todoShowArchived) {
      todoShowArchived.onchange = function () {
        updateTodoFilters({ showArchived: todoShowArchived.checked === true });
      };
    }
    if (todoShowRecurringTasks) {
      todoShowRecurringTasks.onchange = function () {
        updateTodoFilters({ showRecurringTasks: todoShowRecurringTasks.checked === true });
      };
    }
    if (todoHideCardDetails) {
      todoHideCardDetails.onchange = function () {
        updateTodoFilters({ hideCardDetails: todoHideCardDetails.checked === true });
      };
    }
    if (todoToggleFiltersBtn) {
      todoToggleFiltersBtn.onclick = function () {
        if (isBoardFiltersCollapsed()) {
          boardFiltersManualCollapsed = false;
          boardFiltersAutoCollapsed = false;
        } else {
          boardFiltersManualCollapsed = true;
        }
        applyBoardFilterCollapseState();
        persistTaskFilter();
      };
    }
    if (todoClearFiltersBtn) {
      todoClearFiltersBtn.onclick = function () {
        clearTodoFilters();
      };
    }
    if (todoDetailForm) {
      todoDetailForm.onsubmit = function (event) {
        event.preventDefault();
        if (!todoTitleInput || !todoSectionInput || !todoPriorityInput) {
          return;
        }
        syncTodoDraftFromInputs("submit");
        var payload = {
          title: todoTitleInput.value || "",
          description: todoDescriptionInput ? todoDescriptionInput.value : "",
          dueAt: fromLocalDateTimeInput(todoDueInput ? todoDueInput.value : "") || null,
          sectionId: todoSectionInput.value || "",
          priority: todoPriorityInput.value || "none",
          labels: currentTodoLabels.slice(),
          flags: currentTodoFlag ? [currentTodoFlag] : [],
          taskId: todoLinkedTaskSelect && todoLinkedTaskSelect.value ? todoLinkedTaskSelect.value : null,
        };
        if (selectedTodoId) {
          vscode.postMessage({ type: "updateTodo", todoId: selectedTodoId, data: payload });
        } else {
          emitWebviewDebug("todoCreateSubmit", {
            titleLength: payload.title.length,
            sectionId: payload.sectionId,
            taskId: payload.taskId || "",
          });
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
    if (todoCommentList) {
      todoCommentList.onclick = function (event) {
        var deleteBtn = getClosestEventTarget(event, "[data-delete-comment-index]");
        if (deleteBtn && selectedTodoId) {
          event.stopPropagation();
          var commentIndex = Number(deleteBtn.getAttribute("data-delete-comment-index"));
          if (!isNaN(commentIndex)) {
            vscode.postMessage({
              type: "deleteTodoComment",
              todoId: selectedTodoId,
              commentIndex: commentIndex
            });
          }
          return;
        }

        var commentCard = getClosestEventTarget(event, "[data-comment-index]");
        if (!commentCard || !selectedTodoId) {
          return;
        }
        var commentIndex = Number(commentCard.getAttribute("data-comment-index"));
        var selectedTodo = findTodoById(selectedTodoId);
        var comments = selectedTodo && Array.isArray(selectedTodo.comments) ? selectedTodo.comments : [];
        if (commentIndex < 0 || commentIndex >= comments.length) {
          return;
        }
        openTodoCommentModal(comments[commentIndex]);
      };
      todoCommentList.onkeydown = function (event) {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }
        var commentCard = getClosestEventTarget(event, "[data-comment-index]");
        if (!commentCard) {
          return;
        }
        event.preventDefault();
        commentCard.click();
      };
    }
    if (todoUploadFilesBtn) {
      todoUploadFilesBtn.onclick = function () {
        vscode.postMessage({
          type: "requestTodoFileUpload",
          todoId: selectedTodoId || undefined,
        });
      };
    }
    if (todoCreateTaskBtn) {
      todoCreateTaskBtn.onclick = function () {
        if (!selectedTodoId) return;
        vscode.postMessage({ type: "createTaskFromTodo", todoId: selectedTodoId });
      };
    }
    if (todoCompleteBtn) {
      todoCompleteBtn.onclick = function () {
        if (!selectedTodoId) return;
        var selectedTodo = cockpitBoard && Array.isArray(cockpitBoard.cards)
          ? cockpitBoard.cards.find(function (card) { return card && card.id === selectedTodoId; })
          : null;
        vscode.postMessage({
          type: getTodoCompletionActionType(selectedTodo),
          todoId: selectedTodoId,
        });
      };
    }
    if (todoDeleteBtn) {
      todoDeleteBtn.onclick = function () {
        if (!selectedTodoId) return;
        openTodoDeleteModal(selectedTodoId);
      };
    }
    if (todoLabelAddBtn) {
      todoLabelAddBtn.onclick = function () {
        emitWebviewDebug("todoLabelAddButtonClick", {
          disabled: !!todoLabelAddBtn.disabled,
          inputValue: todoLabelsInput ? String(todoLabelsInput.value || "") : "",
        });
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
            selectedTodoLabelName = def.name;
          } else {
            selectedTodoLabelName = "";
          }
          if (todoLabelColorInput) todoLabelColorInput.disabled = false;
          syncTodoLabelEditor();
          } else {
            selectedTodoLabelName = "";
            syncTodoLabelEditor();
          }
          if (todoLabelColorSaveBtn) todoLabelColorSaveBtn.disabled = !getActiveTodoLabelEditorName();
          syncTodoEditorTransientDraft();
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
    if (todoLabelColorInput) {
      todoLabelColorInput.oninput = function () {
        syncTodoEditorTransientDraft();
      };
      todoLabelColorInput.onchange = function () {
        syncTodoEditorTransientDraft();
      };
    }
    if (todoLabelChipList) {
      todoLabelChipList.onclick = function (event) {
        var removeButton = getClosestEventTarget(event, "[data-label-chip-remove]");
        var selectButton = getClosestEventTarget(event, "[data-label-chip-select]");
        if (removeButton) {
          removeEditorLabel(removeButton.getAttribute("data-label-chip-remove") || "");
          return;
        }
        if (selectButton) {
            clearCatalogDeleteState("label");
            var lname = selectButton.getAttribute("data-label-chip-select") || "";
            selectedTodoLabelName = lname;
            if (todoLabelsInput) {
              todoLabelsInput.value = lname;
              todoLabelsInput.focus();
            }
            syncTodoEditorTransientDraft();
            syncTodoLabelEditor();
          }
      };
    }
    if (todoLabelColorSaveBtn) {
        todoLabelColorSaveBtn.onclick = function () {
          var name = getActiveTodoLabelEditorName();
          emitWebviewDebug("todoLabelSaveButtonClick", {
            disabled: !!todoLabelColorSaveBtn.disabled,
            inputValue: name,
            hasColorInput: !!todoLabelColorInput,
          });
          if (!name || !todoLabelColorInput) {
            emitWebviewDebug("todoLabelSaveIgnored", {
              reason: !name ? "emptyLabel" : "missingColorInput",
            });
            return;
          }
          var normalized = normalizeTodoLabel ? normalizeTodoLabel(name) : name;
          var previousName = editingLabelOriginalName || (selectedTodoLabelName && normalizeTodoLabelKey(selectedTodoLabelName) !== normalizeTodoLabelKey(normalized)
            ? selectedTodoLabelName
            : undefined);
          emitWebviewDebug("todoLabelSaveAccepted", {
            label: normalized,
            color: todoLabelColorInput.value,
            editingExisting: !!previousName,
          });
          upsertLocalLabelDefinition(normalized, todoLabelColorInput.value, previousName);
          vscode.postMessage({ type: "saveTodoLabelDefinition", data: { name: normalized, previousName: previousName, color: todoLabelColorInput.value } });
          var prevName = previousName;
          if (prevName && normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(normalized)) {
            var prevIdx = currentTodoLabels.map(normalizeTodoLabelKey).indexOf(normalizeTodoLabelKey(prevName));
            if (prevIdx >= 0) {
              var newLabels = currentTodoLabels.slice();
              newLabels.splice(prevIdx, 1, normalized);
              setTodoEditorLabels(newLabels, true);
            }
          }
          selectedTodoLabelName = normalized;
          editingLabelOriginalName = "";
          if (todoLabelsInput) {
            todoLabelsInput.value = normalized;
          }
          syncTodoEditorTransientDraft();
          syncTodoLabelEditor();
        };
      }
    if (todoLabelSuggestions) {
      todoLabelSuggestions.onclick = function (event) {
          var btn = getClosestEventTarget(event, "[data-label-suggestion]");
        if (btn) {
          var pickedLabel = btn.getAttribute("data-label-suggestion") || "";
          var def = getLabelDefinition(pickedLabel);
          editingLabelOriginalName = "";
          if (def && def.color && todoLabelColorInput) {
            todoLabelColorInput.value = def.color;
          }
          if (todoLabelsInput) todoLabelsInput.value = pickedLabel;
          syncTodoEditorTransientDraft();
          addEditorLabelFromInput();
        }
      };
    }
    if (todoLabelCatalog) {
      todoLabelCatalog.onclick = function (event) {
        var editBtn = getClosestEventTarget(event, "[data-label-catalog-edit]");
        var deleteBtn = getClosestEventTarget(event, "[data-label-catalog-delete]");
        var confirmDeleteBtn = getClosestEventTarget(event, "[data-label-catalog-confirm-delete]");
        var selectBtn = getClosestEventTarget(event, "[data-label-catalog-select]");
        if (editBtn) {
          event.preventDefault();
          event.stopPropagation();
          clearCatalogDeleteState("label");
          var eName = editBtn.getAttribute("data-label-catalog-edit") || "";
          var eCatalog = getLabelCatalog();
          var eEntry = null;
          for (var ei = 0; ei < eCatalog.length; ei++) {
            if (normalizeTodoLabelKey(eCatalog[ei].name) === normalizeTodoLabelKey(eName)) { eEntry = eCatalog[ei]; break; }
          }
          if (todoLabelsInput) todoLabelsInput.value = eEntry ? eEntry.name : eName;
          if (todoLabelColorInput && eEntry && eEntry.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(eEntry.color)) todoLabelColorInput.value = eEntry.color;
          editingLabelOriginalName = eName;
          syncTodoEditorTransientDraft();
          if (todoLabelsInput) todoLabelsInput.focus();
          return;
        }
        if (confirmDeleteBtn) {
          event.preventDefault();
          event.stopPropagation();
          var confirmName = confirmDeleteBtn.getAttribute("data-label-catalog-confirm-delete") || "";
          if (!confirmName) return;
          clearCatalogDeleteState("label");
          removeLabelFromCurrentTodo(confirmName);
          syncTodoLabelEditor();
          vscode.postMessage({ type: "deleteTodoLabelDefinition", data: { name: confirmName } });
          return;
        }
        if (deleteBtn) {
          event.preventDefault();
          event.stopPropagation();
          var name = deleteBtn.getAttribute("data-label-catalog-delete") || "";
          if (!name) return;
          pendingDeleteLabelName = name;
          syncTodoLabelEditor();
          return;
        }
        if (selectBtn) {
          event.preventDefault();
          event.stopPropagation();
          clearCatalogDeleteState("label");
          var name = selectBtn.getAttribute("data-label-catalog-select") || "";
          if (!name) return;
          // Add the label to the current todo directly (catalog only shows un-applied labels)
          editingLabelOriginalName = "";
          if (todoLabelsInput) todoLabelsInput.value = name;
          syncTodoEditorTransientDraft();
          addEditorLabelFromInput();
        }
      };
    }
    if (todoFlagColorSaveBtn) {
      todoFlagColorSaveBtn.onclick = function () {
        var todoFlagNameInputEl = document.getElementById("todo-flag-name-input");
        var todoFlagColorInputEl = document.getElementById("todo-flag-color-input");
        var activeFlagName = getActiveTodoFlagEditorName();
        emitWebviewDebug("todoFlagSaveButtonClick", {
          disabled: !!todoFlagColorSaveBtn.disabled,
          inputValue: activeFlagName,
          hasNameInput: !!todoFlagNameInputEl,
          hasColorInput: !!todoFlagColorInputEl,
        });
        if (!todoFlagNameInputEl || !todoFlagColorInputEl) {
          emitWebviewDebug("todoFlagSaveIgnored", { reason: "missingInputs" });
          return;
        }
        var name = activeFlagName;
        if (!name) {
          emitWebviewDebug("todoFlagSaveIgnored", { reason: "emptyFlag" });
          return;
        }
        var normalized = normalizeTodoLabel ? normalizeTodoLabel(name) : name;
        var previousName = editingFlagOriginalName || (currentTodoFlag && normalizeTodoLabelKey(currentTodoFlag) !== normalizeTodoLabelKey(normalized)
          ? currentTodoFlag
          : undefined);
        emitWebviewDebug("todoFlagSaveAccepted", {
          flag: normalized,
          color: todoFlagColorInputEl.value,
          editingExisting: !!previousName,
        });
        vscode.postMessage({
          type: "saveTodoFlagDefinition",
          data: {
            name: normalized,
            previousName: previousName,
            color: todoFlagColorInputEl.value,
          },
        });
        
        // Also update editor UI in case the flag was currently active
        // But do not assign it if they aren't adding it. But wait, if they renamed it, and it was active:
        var prevName = previousName;
        if (prevName && normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(normalized)) {
          if (normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(prevName)) {
            currentTodoFlag = normalized;
            syncTodoFlagDraft();
            syncFlagEditor();
          }
        }
        if (!prevName || normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(prevName)) {
          currentTodoFlag = normalized;
          syncTodoFlagDraft();
        }
        editingFlagOriginalName = "";
        todoFlagNameInputEl.value = normalized;
        syncTodoEditorTransientDraft();
        syncFlagEditor();
      };
    }
    if (todoFlagAddBtn) {
      todoFlagAddBtn.onclick = function () {
        emitWebviewDebug("todoFlagAddButtonClick", {
          disabled: !!todoFlagAddBtn.disabled,
          inputValue: todoFlagNameInput ? String(todoFlagNameInput.value || "") : "",
        });
        addFlagFromInput();
      };
    }
    if (todoFlagNameInput) {
      todoFlagNameInput.oninput = function () {
        if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();
        syncTodoEditorTransientDraft();
      };
      todoFlagNameInput.onkeydown = function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          addFlagFromInput();
        }
      };
    }
    if (todoFlagColorInput) {
      todoFlagColorInput.oninput = function () {
        if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();
        syncTodoEditorTransientDraft();
      };
      todoFlagColorInput.onchange = function () {
        if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();
        syncTodoEditorTransientDraft();
      };
    }
  }

  function getEditorTabLabelNode(tabName) {
    return document.querySelector('[data-tab-label="' + tabName + '"]');
  }

  function getEditorTabSymbolNode(tabName) {
    return document.querySelector('[data-tab-symbol="' + tabName + '"]');
  }

  function getEditorTabButton(tabName) {
    return document.querySelector('.tab-button[data-tab="' + tabName + '"]');
  }

  function getTaskByIdLocal(taskId) {
    if (!taskId) {
      return null;
    }
    var taskListArray = Array.isArray(tasks) ? tasks : [];
    for (var i = 0; i < taskListArray.length; i += 1) {
      if (taskListArray[i] && taskListArray[i].id === taskId) {
        return taskListArray[i];
      }
    }
    return null;
  }

  function normalizeTaskLabelsValue(raw) {
    return parseLabels(raw || "").join(",");
  }

  function getCurrentTaskEditorState() {
    var taskNameEl = document.getElementById("task-name");
    var promptTextEl = document.getElementById("prompt-text");
    var scopeEl = document.querySelector('input[name="scope"]:checked');
    var promptSourceEl = document.querySelector('input[name="prompt-source"]:checked');
    var oneTimeEl = document.getElementById("one-time");
    var manualSessionEl = document.getElementById("manual-session");
    var promptSourceValue = promptSourceEl ? String(promptSourceEl.value || "inline") : "inline";
    var promptPathValue = templateSelect ? String(templateSelect.value || "") : "";
    if (promptSourceValue !== "inline" && !promptPathValue && pendingTemplatePath) {
      promptPathValue = pendingTemplatePath;
    }
    var agentValue = agentSelect ? String(agentSelect.value || "") : "";
    if (!agentValue && pendingAgentValue) {
      agentValue = pendingAgentValue;
    }
    var modelValue = modelSelect ? String(modelSelect.value || "") : "";
    if (!modelValue && pendingModelValue) {
      modelValue = pendingModelValue;
    }
    var oneTime = !!(oneTimeEl && oneTimeEl.checked);
    var manualSession = !oneTime && !!(manualSessionEl && manualSessionEl.checked);
    return {
      name: taskNameEl ? String(taskNameEl.value || "") : "",
      prompt: promptTextEl ? String(promptTextEl.value || "") : "",
      cronExpression: cronExpression ? String(cronExpression.value || "") : "",
      labels: normalizeTaskLabelsValue(taskLabelsInput ? taskLabelsInput.value : ""),
      agent: agentValue,
      model: modelValue,
      scope: scopeEl ? String(scopeEl.value || "workspace") : "workspace",
      promptSource: promptSourceValue,
      promptPath: promptPathValue,
      oneTime: oneTime,
      manualSession: manualSession,
      chatSession: oneTime ? "" : (chatSessionSelect ? String(chatSessionSelect.value || "") : ""),
      jitterSeconds: jitterSecondsInput ? Number(jitterSecondsInput.value || 0) : 0,
    };
  }

  function getSavedTaskEditorState(task) {
    if (!task) {
      return null;
    }
    return {
      name: String(task.name || ""),
      prompt: typeof task.prompt === "string" ? task.prompt : "",
      cronExpression: String(task.cronExpression || ""),
      labels: normalizeTaskLabelsValue(toLabelString(task.labels)),
      agent: String(task.agent || ""),
      model: String(task.model || ""),
      scope: String(task.scope || "workspace"),
      promptSource: String(task.promptSource || "inline"),
      promptPath: String(task.promptPath || ""),
      oneTime: task.oneTime === true,
      manualSession: task.oneTime === true ? false : task.manualSession === true,
      chatSession: task.oneTime === true ? "" : String(task.chatSession || defaultChatSession || "new"),
      jitterSeconds: Number(task.jitterSeconds != null ? task.jitterSeconds : defaultJitterSeconds),
    };
  }

  function getCurrentTodoEditorState() {
    return {
      title: todoTitleInput ? String(todoTitleInput.value || "") : "",
      description: todoDescriptionInput ? String(todoDescriptionInput.value || "") : "",
      dueAt: todoDueInput ? String(todoDueInput.value || "") : "",
      priority: todoPriorityInput ? String(todoPriorityInput.value || "none") : "none",
      sectionId: todoSectionInput ? String(todoSectionInput.value || "") : "",
      taskId: todoLinkedTaskSelect ? String(todoLinkedTaskSelect.value || "") : "",
      labels: dedupeStringList(currentTodoLabels).map(normalizeTodoLabelKey).join(","),
      flag: normalizeTodoLabelKey(currentTodoFlag || ""),
    };
  }

  function getSavedTodoEditorState(card) {
    if (!card) {
      return null;
    }
    return {
      title: String(card.title || ""),
      description: String(card.description || ""),
      dueAt: toLocalDateTimeInput(card.dueAt),
      priority: String(card.priority || "none"),
      sectionId: String(card.sectionId || ""),
      taskId: String(card.taskId || ""),
      labels: dedupeStringList(card.labels || []).map(normalizeTodoLabelKey).join(","),
      flag: normalizeTodoLabelKey(((card.flags || [])[0] || "")),
    };
  }

  function getCurrentJobEditorState() {
    return {
      name: jobsNameInput ? String(jobsNameInput.value || "") : "",
      cronExpression: jobsCronInput ? String(jobsCronInput.value || "") : "",
      folderId: jobsFolderSelect ? String(jobsFolderSelect.value || "") : "",
    };
  }

  function getSavedJobEditorState(job) {
    if (!job) {
      return null;
    }
    return {
      name: String(job.name || ""),
      cronExpression: String(job.cronExpression || ""),
      folderId: String(job.folderId || ""),
    };
  }

  function areEditorStatesEqual(left, right) {
    if (!left || !right) {
      return left === right;
    }
    var leftKeys = Object.keys(left);
    var rightKeys = Object.keys(right);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }
    for (var i = 0; i < leftKeys.length; i += 1) {
      var key = leftKeys[i];
      if (left[key] !== right[key]) {
        return false;
      }
    }
    return true;
  }

  function isTaskEditorDirty() {
    if (!editingTaskId) {
      return false;
    }
    return !areEditorStatesEqual(
      getCurrentTaskEditorState(),
      getSavedTaskEditorState(getTaskByIdLocal(editingTaskId))
    );
  }

  function isTodoEditorDirty() {
    if (!selectedTodoId) {
      return false;
    }
    var selectedTodo = cockpitBoard && Array.isArray(cockpitBoard.cards)
      ? cockpitBoard.cards.find(function (card) {
        return card && card.id === selectedTodoId;
      })
      : null;
    return !areEditorStatesEqual(
      getCurrentTodoEditorState(),
      getSavedTodoEditorState(selectedTodo)
    );
  }

  function isJobsEditorDirty() {
    if (isCreatingJob || !selectedJobId) {
      return false;
    }
    return !areEditorStatesEqual(
      getCurrentJobEditorState(),
      getSavedJobEditorState(getJobById(selectedJobId))
    );
  }

  function setEditorTabState(tabName, options) {
    var button = getEditorTabButton(tabName);
    var symbolNode = getEditorTabSymbolNode(tabName);
    var labelNode = getEditorTabLabelNode(tabName);
    if (symbolNode) {
      symbolNode.textContent = options.symbol || EDITOR_CREATE_SYMBOL;
    }
    if (labelNode) {
      labelNode.textContent = "";
      if (labelNode.classList) {
        labelNode.classList.toggle("is-dirty", options.dirty === true);
      }
    }
    if (button) {
      var title = options.title || "";
      if (options.dirty) {
        title = title + " • " + (strings.tabUnsavedChanges || strings.researchUnsavedChanges || "Unsaved changes");
      }
      button.title = title;
      button.setAttribute("aria-label", title || tabName);
    }
  }

  function syncEditorTabLabels() {
    setEditorTabState("create", {
      symbol: editingTaskId ? EDITOR_EDIT_SYMBOL : EDITOR_CREATE_SYMBOL,
      dirty: isTaskEditorDirty(),
      title: editingTaskId
        ? (strings.tabTaskEditorEdit || strings.tabEdit || "Edit Task")
        : (strings.tabTaskEditorCreate || strings.tabTaskEditor || "Create Task")
    });
    setEditorTabState("todo-edit", {
      symbol: selectedTodoId ? EDITOR_EDIT_SYMBOL : EDITOR_CREATE_SYMBOL,
      dirty: isTodoEditorDirty(),
      title: selectedTodoId
        ? (strings.tabTodoEditorEdit || strings.boardDetailTitleEdit || "Edit Todo")
        : (strings.tabTodoEditorCreate || strings.tabTodoEditor || "Create Todo")
    });
    setEditorTabState("jobs-edit", {
      symbol: (isCreatingJob || !selectedJobId) ? EDITOR_CREATE_SYMBOL : EDITOR_EDIT_SYMBOL,
      dirty: isJobsEditorDirty(),
      title: (isCreatingJob || !selectedJobId)
        ? (strings.tabJobsEditorCreate || strings.tabJobsEditor || "Create Job")
        : (strings.tabJobsEditorEdit || "Edit Job")
    });
  }

  function setEditingMode(taskId) {
    editingTaskId = taskId || null;
    if (editTaskIdInput) editTaskIdInput.value = editingTaskId || "";
    syncEditorTabLabels();

    if (submitBtn) {
      var label = editingTaskId ? strings.actionSave : strings.actionCreate;
      if (label) submitBtn.textContent = label;
    }
    if (newTaskBtn) {
      newTaskBtn.style.display = editingTaskId ? "inline-flex" : "none";
    }
  }

  function openTodoEditor(todoId) {
    clearCatalogDeleteState();
    closeTodoDeleteModal();
    selectedTodoId = todoId || null;
    if (!selectedTodoId) {
      resetTodoDraft("open-create");
      currentTodoLabels = [];
      selectedTodoLabelName = "";
      currentTodoFlag = "";
      emitWebviewDebug("openTodoEditor", { mode: "create" });
    } else {
      emitWebviewDebug("openTodoEditor", { mode: "edit", todoId: selectedTodoId });
    }
    renderCockpitBoard();
    switchTab("todo-edit");
  }

  function resetTodoEditor() {
    clearCatalogDeleteState();
    closeTodoDeleteModal();
    selectedTodoId = null;
    resetTodoDraft("reset-editor");
    currentTodoLabels = [];
    selectedTodoLabelName = "";
    currentTodoFlag = "";
    renderCockpitBoard();
  }

  function ensureTodoDeleteModal() {
    if (todoDeleteModalRoot && document.body.contains(todoDeleteModalRoot)) {
      return todoDeleteModalRoot;
    }
    todoDeleteModalRoot = document.createElement("div");
    todoDeleteModalRoot.className = "cockpit-inline-modal";
    todoDeleteModalRoot.setAttribute("hidden", "hidden");
    todoDeleteModalRoot.innerHTML =
      '<div class="cockpit-inline-modal-card" role="dialog" aria-modal="true" aria-labelledby="todo-delete-modal-title">' +
      '<div class="cockpit-inline-modal-title" id="todo-delete-modal-title"></div>' +
      '<div class="note" data-todo-delete-modal-message></div>' +
      '<div class="cockpit-inline-modal-actions">' +
      '<button type="button" class="btn-secondary" data-todo-delete-cancel>' + escapeHtml(strings.boardDeleteTodoCancel || "Cancel") + '</button>' +
      '<button type="button" class="btn-secondary" data-todo-delete-reject>' + escapeHtml(strings.boardDeleteTodoReject || "Archive as Rejected") + '</button>' +
      '<button type="button" class="btn-danger" data-todo-delete-permanent>' + escapeHtml(strings.boardDeleteTodoPermanent || "Delete Permanently") + '</button>' +
      '</div>' +
      '</div>';
    todoDeleteModalRoot.onclick = function (event) {
      if (event.target === todoDeleteModalRoot) {
        closeTodoDeleteModal();
        return;
      }
      var cancelBtn = getClosestEventTarget(event, "[data-todo-delete-cancel]");
      if (cancelBtn) {
        closeTodoDeleteModal();
        return;
      }
      var rejectBtn = getClosestEventTarget(event, "[data-todo-delete-reject]");
      if (rejectBtn) {
        submitTodoDeleteChoice("reject");
        return;
      }
      var permanentBtn = getClosestEventTarget(event, "[data-todo-delete-permanent]");
      if (permanentBtn) {
        submitTodoDeleteChoice("permanent");
      }
    };
    document.body.appendChild(todoDeleteModalRoot);
    return todoDeleteModalRoot;
  }

  function closeTodoDeleteModal() {
    pendingTodoDeleteId = "";
    if (!todoDeleteModalRoot) {
      return;
    }
    todoDeleteModalRoot.classList.remove("is-open");
    todoDeleteModalRoot.setAttribute("hidden", "hidden");
  }

  function ensureTodoCommentModal() {
    if (todoCommentModalRoot && document.body.contains(todoCommentModalRoot)) {
      return todoCommentModalRoot;
    }
    todoCommentModalRoot = document.createElement("div");
    todoCommentModalRoot.className = "cockpit-inline-modal";
    todoCommentModalRoot.setAttribute("hidden", "hidden");
    todoCommentModalRoot.innerHTML =
      '<div class="cockpit-inline-modal-card comment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="todo-comment-modal-title">' +
      '<div class="cockpit-inline-modal-title" id="todo-comment-modal-title"></div>' +
      '<div class="todo-comment-modal-meta" id="todo-comment-modal-meta"></div>' +
      '<div class="todo-comment-modal-body" id="todo-comment-modal-body"></div>' +
      '<div class="cockpit-inline-modal-actions">' +
      '<button type="button" class="btn-secondary" data-comment-modal-close="1">' + escapeHtml(strings.boardCancelAction || "Cancel") + '</button>' +
      '</div>' +
      '</div>';
    todoCommentModalRoot.onclick = function (event) {
      if (event.target === todoCommentModalRoot) {
        closeTodoCommentModal();
        return;
      }
      var closeBtn = getClosestEventTarget(event, "[data-comment-modal-close]");
      if (closeBtn) {
        closeTodoCommentModal();
      }
    };
    document.body.appendChild(todoCommentModalRoot);
    return todoCommentModalRoot;
  }

  function closeTodoCommentModal() {
    if (!todoCommentModalRoot) {
      return;
    }
    todoCommentModalRoot.classList.remove("is-open");
    todoCommentModalRoot.setAttribute("hidden", "hidden");
  }

  function openTodoCommentModal(comment) {
    if (!comment) {
      return;
    }
    var modal = ensureTodoCommentModal();
    var titleEl = modal.querySelector("#todo-comment-modal-title");
    var metaEl = modal.querySelector("#todo-comment-modal-meta");
    var bodyEl = modal.querySelector("#todo-comment-modal-body");
    var sourceLabel = getTodoCommentSourceLabel(comment.source || "human-form");
    var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
    if (titleEl) {
      titleEl.textContent = strings.boardCommentModalTitle || "Comment Detail";
    }
    if (metaEl) {
      metaEl.innerHTML =
        '<span><strong>' + escapeHtml(sourceLabel) + '</strong></span>' +
        '<span>' + escapeHtml(comment.author || "system") + '</span>' +
        '<span>' + escapeHtml(formatTodoDate(displayDate)) + '</span>';
    }
    if (bodyEl) {
      bodyEl.textContent = comment.body || "";
    }
    modal.removeAttribute("hidden");
    modal.classList.add("is-open");
  }

  function openTodoDeleteModal(todoId, options) {
    if (!todoId) {
      return;
    }
    var permanentOnly = !!(options && options.permanentOnly);
    var todo = cockpitBoard && Array.isArray(cockpitBoard.cards)
      ? cockpitBoard.cards.find(function (card) { return card && card.id === todoId; })
      : null;
    var modal = ensureTodoDeleteModal();
    pendingTodoDeleteId = todoId;
    var titleEl = modal.querySelector("#todo-delete-modal-title");
    var messageEl = modal.querySelector("[data-todo-delete-modal-message]");
    var rejectBtn = modal.querySelector("[data-todo-delete-reject]");
    if (titleEl) {
      titleEl.textContent = permanentOnly
        ? (strings.boardDeleteTodoPermanent || "Delete Permanently")
        : (strings.boardDeleteTodoTitle || "Delete Todo");
    }
    if (messageEl) {
      var promptText = permanentOnly
        ? (strings.boardDeleteTodoPermanentPrompt || "Delete this archived todo permanently? This cannot be undone.")
        : (strings.boardDeleteTodoPrompt || "Choose whether this todo should be rejected into the archive or removed permanently.");
      messageEl.textContent = todo && todo.title
        ? '"' + String(todo.title || "") + '". ' + promptText
        : promptText;
    }
    if (rejectBtn) {
      rejectBtn.hidden = permanentOnly;
    }
    modal.removeAttribute("hidden");
    modal.classList.add("is-open");
    setTimeout(function () {
      var defaultButton = modal.querySelector(permanentOnly ? "[data-todo-delete-permanent]" : "[data-todo-delete-reject]");
      if (defaultButton && typeof defaultButton.focus === "function") {
        defaultButton.focus();
      }
    }, 0);
  }

  function submitTodoDeleteChoice(choice) {
    if (!pendingTodoDeleteId) {
      closeTodoDeleteModal();
      return;
    }
    var todoId = pendingTodoDeleteId;
    closeTodoDeleteModal();
    if (selectedTodoId === todoId) {
      selectedTodoId = null;
      currentTodoLabels = [];
      selectedTodoLabelName = "";
      currentTodoFlag = "";
      renderCockpitBoard();
    }
    vscode.postMessage({
      type: choice === "permanent" ? "purgeTodo" : "rejectTodo",
      todoId: todoId,
    });
  }

  function openJobEditor(jobId) {
    isCreatingJob = false;
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

  function resetJobEditor() {
    isCreatingJob = true;
    selectedJobId = "";
    persistTaskFilter();
    renderJobsTab();
    switchTab("jobs-edit");
  }

  function submitJobEditor() {
    var jobName = jobsNameInput ? String(jobsNameInput.value || "").trim() : "";
    var cronExpressionValue = jobsCronInput ? String(jobsCronInput.value || "").trim() : "";
    if (!jobName || !cronExpressionValue) {
      emitWebviewDebug("jobSaveBlocked", {
        isCreatingJob: isCreatingJob,
        hasName: !!jobName,
        hasCron: !!cronExpressionValue,
      });
      return;
    }
    if (isCreatingJob || !selectedJobId) {
      emitWebviewDebug("jobCreateSubmit", {
        name: jobName,
        folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : "",
      });
      vscode.postMessage({
        type: "createJob",
        data: {
          name: jobName,
          cronExpression: cronExpressionValue,
          folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : undefined,
        },
      });
      return;
    }
    vscode.postMessage({
      type: "updateJob",
      jobId: selectedJobId,
      data: {
        name: jobsNameInput ? jobsNameInput.value : "",
        cronExpression: jobsCronInput ? jobsCronInput.value : "",
        folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : undefined,
      },
    });
  }

  function isTabActive(tabName) {
    var targetContent = document.getElementById(tabName + "-tab");
    return !!(targetContent && targetContent.classList.contains("active"));
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
      jobsToggleSidebarBtn.style.display = "";
    }
    if (jobsShowSidebarBtn) {
      jobsShowSidebarBtn.style.display = (tabName === "jobs" && jobsSidebarHidden) ? "inline-flex" : "none";
    }
    if (tabName === "list") {
      refreshTaskCountdowns();
    }
    updateBoardAutoCollapseFromScroll(true);
    scheduleBoardStickyMetrics();
    maybePlayInitialHelpWarp(tabName);
  }

  function getInitialTabName() {
    var tabName = typeof initialData.initialTab === "string"
      ? initialData.initialTab
      : "help";
    switch (tabName) {
      case "help":
      case "settings":
      case "research":
      case "jobs":
      case "jobs-edit":
      case "list":
      case "create":
      case "board":
      case "todo-edit":
        return tabName;
      default:
        return "help";
    }
  }

  // Keep pending values in sync when the user explicitly changes selection
  if (agentSelect) {
    agentSelect.addEventListener("change", function () {
      pendingAgentValue = agentSelect ? String(agentSelect.value || "") : "";
      emitWebviewDebug("taskAgentChanged", { value: pendingAgentValue });
    });
  }
  if (modelSelect) {
    modelSelect.addEventListener("change", function () {
      pendingModelValue = modelSelect ? String(modelSelect.value || "") : "";
      emitWebviewDebug("taskModelChanged", { value: pendingModelValue });
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
  var manualSessionToggle = document.getElementById("manual-session");
  if (manualSessionToggle) {
    manualSessionToggle.addEventListener("change", function () {
      syncRecurringChatSessionUi();
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll(".tab-button[data-tab]"), function (button) {
    button.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var tabName = button.getAttribute("data-tab");
      if (tabName) {
        switchTab(tabName);
      }
    });
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
      syncEditorTabLabels();
    });

    jobsCronInput.addEventListener("input", function () {
      jobsCronPreset.value = "";
      updateJobsCronPreview();
      syncEditorTabLabels();
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
      syncEditorTabLabels();
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

  if (settingsStorageSaveBtn) {
    settingsStorageSaveBtn.addEventListener("click", function () {
      vscode.postMessage({
        type: "setStorageSettings",
        data: collectStorageSettingsFormData(),
      });
    });
  }

  if (settingsLogLevelSelect) {
    settingsLogLevelSelect.addEventListener("change", function () {
      currentLogLevel = settingsLogLevelSelect.value || "info";
      debugTools.setLogLevel(currentLogLevel);
      renderLoggingControls();
      vscode.postMessage({
        type: "setLogLevel",
        logLevel: currentLogLevel,
      });
    });
  }

  if (settingsOpenLogFolderBtn) {
    settingsOpenLogFolderBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "openLogFolder" });
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
      syncEditorTabLabels();
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
      hideGlobalError();

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
      var manualSessionEl = document.getElementById("manual-session");

      var promptSourceValue = promptSourceEl ? promptSourceEl.value : "inline";

      // Preserve values if dropdown options are not loaded yet
      var agentValue = agentSelect ? agentSelect.value : "";
      if (!agentValue && pendingAgentValue) {
        agentValue = pendingAgentValue;
      }
      var modelValue = modelSelect ? modelSelect.value : "";
      if (!modelValue && pendingModelValue) {
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
        manualSession:
          oneTimeEl && oneTimeEl.checked
            ? false
            : !!(manualSessionEl && manualSessionEl.checked),
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
      isCreatingJob = true;
      syncEditorTabLabels();
      vscode.postMessage({
        type: "requestCreateJob",
        folderId: selectedJobFolderId || undefined,
      });
      switchTab("jobs-edit");
    });
  }

  var jobsEmptyNewBtn = document.getElementById("jobs-empty-new-btn");
  if (jobsEmptyNewBtn) {
    jobsEmptyNewBtn.addEventListener("click", function () {
      isCreatingJob = true;
      syncEditorTabLabels();
      vscode.postMessage({
        type: "requestCreateJob",
        folderId: selectedJobFolderId || undefined,
      });
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
    jobsSaveBtn.addEventListener("click", submitJobEditor);
  }

  if (jobsSaveDeckBtn) {
    jobsSaveDeckBtn.addEventListener("click", submitJobEditor);
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

  if (jobsShowSidebarBtn) {
    jobsShowSidebarBtn.addEventListener("click", function () {
      jobsSidebarHidden = false;
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

  if (syncBundledSkillsBtn) {
    syncBundledSkillsBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "syncBundledSkills" });
    });
  }

  if (importStorageFromJsonBtn) {
    importStorageFromJsonBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "importStorageFromJson" });
    });
  }

  if (exportStorageToJsonBtn) {
    exportStorageToJsonBtn.addEventListener("click", function () {
      vscode.postMessage({ type: "exportStorageToJson" });
    });
  }

  function syncLanguageSelectors(value) {
    var nextValue = value || "auto";
    if (helpLanguageSelect) {
      helpLanguageSelect.value = nextValue;
    }
    if (settingsLanguageSelect) {
      settingsLanguageSelect.value = nextValue;
    }
  }

  function saveLanguageSelection(value) {
    var nextValue = value || "auto";
    syncLanguageSelectors(nextValue);
    vscode.postMessage({
      type: "setLanguage",
      language: nextValue,
    });
  }

  syncLanguageSelectors(
    typeof initialData.languageSetting === "string" && initialData.languageSetting
      ? initialData.languageSetting
      : "auto"
  );

  if (helpLanguageSelect) {
    helpLanguageSelect.addEventListener("change", function () {
      saveLanguageSelection(helpLanguageSelect.value);
    });
  }

  if (settingsLanguageSelect) {
    settingsLanguageSelect.addEventListener("change", function () {
      saveLanguageSelection(settingsLanguageSelect.value);
    });
  }

  var btnIntroTutorial = document.getElementById("btn-intro-tutorial");
  if (btnIntroTutorial) {
    btnIntroTutorial.addEventListener("click", function () {
      vscode.postMessage({ type: "introTutorial" });
    });
  }

  var btnPlanIntegration = document.getElementById("btn-plan-integration");
  if (btnPlanIntegration) {
    btnPlanIntegration.addEventListener("click", function () {
      vscode.postMessage({ type: "planIntegration" });
    });
  }

  if (helpIntroRocket) {
    helpIntroRocket.addEventListener("click", function () {
      triggerHelpWarpAnimation({ animateRocket: true });
    });
  }

  [
    "btn-help-switch-settings",
    "btn-help-switch-board",
    "btn-help-switch-create",
    "btn-help-switch-list",
    "btn-help-switch-jobs",
    "btn-help-switch-research"
  ].forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) {
      btn.addEventListener("click", function () {
        var targetTabMap = {
          "btn-help-switch-settings": "settings",
          "btn-help-switch-board": "board",
          "btn-help-switch-create": "create",
          "btn-help-switch-list": "list",
          "btn-help-switch-jobs": "jobs",
          "btn-help-switch-research": "research"
        };
        switchTab(targetTabMap[id]);
      });
    }
  });

  if (document.getElementById("help-tab") && document.getElementById("help-tab").classList.contains("active")) {
    window.requestAnimationFrame(function () {
      maybePlayInitialHelpWarp("help");
    });
  }

  // Task action delegation (single listener)
  function resolveActionTarget(node) {
    var el = node && node.nodeType === 3 ? node.parentElement : node;
    while (el && el !== document.body) {
      if (
        el.hasAttribute &&
        el.hasAttribute("data-action") &&
        (el.hasAttribute("data-id") || el.hasAttribute("data-task-id") || el.hasAttribute("data-job-id") || el.hasAttribute("data-profile-id"))
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  document.addEventListener("click", function (e) {
    var collapseTarget = e && e.target && e.target.nodeType === 3 ? e.target.parentElement : e.target;
    while (collapseTarget && collapseTarget !== document.body) {
      if (collapseTarget.getAttribute && collapseTarget.getAttribute("data-task-section-toggle")) {
        break;
      }
      collapseTarget = collapseTarget.parentElement;
    }

    if (collapseTarget && collapseTarget !== document.body) {
      if (!taskList || !taskList.isConnected) {
        taskList = document.getElementById("task-list");
      }
      if (taskList && taskList.contains(collapseTarget)) {
        var sectionKey = collapseTarget.getAttribute("data-task-section-toggle");
        if (isTaskSectionKey(sectionKey)) {
          e.preventDefault();
          taskSectionCollapseState[sectionKey] = !(taskSectionCollapseState[sectionKey] === true);
          persistTaskFilter();
          renderTaskList(tasks);
          return;
        }
      }
    }

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
      var nextRunMs =
        nextRunDate && !isNaN(nextRunDate.getTime())
          ? nextRunDate.getTime()
          : 0;
      var nextRun =
        nextRunDate && !isNaN(nextRunDate.getTime())
          ? nextRunDate.toLocaleString(locale)
          : strings.labelNever;
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
      var manualSessionBadgeHtml =
        task.oneTime === true || task.manualSession !== true
          ? ""
          : '<span class="task-badge" title="' +
            escapeAttr(strings.labelManualSession || "Manual session") +
            '">' +
            escapeHtml(strings.labelManualSession || "Manual session") +
            "</span>";
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
      function createSelect(items, selectedId, cls, placeholder, fallbackSelectedId) {
        var effectiveSelectedId = selectedId || fallbackSelectedId || "";
        var preservedSelectedId = selectedId || "";
        var hasSelectedOption = !preservedSelectedId;
        var options = '<option value="">' + escapeHtml(placeholder) + '</option>';
        if (Array.isArray(items)) {
          items.forEach(function (item) {
            var id = item.id || item.slug;
            if (!id) {
              return;
            }
            var label = cls && cls.indexOf("model") >= 0 ? formatModelLabel(item) : (item.name || id);
            if (id === preservedSelectedId) {
              hasSelectedOption = true;
            }
            var sel = (id === effectiveSelectedId) ? ' selected' : '';
            options += '<option value="' + escapeAttr(id) + '"' + sel + '>' + escapeHtml(label) + '</option>';
          });
        }
        if (preservedSelectedId && !hasSelectedOption) {
          options += '<option value="' + escapeAttr(preservedSelectedId) + '" selected>' + escapeHtml(preservedSelectedId) + '</option>';
        }
        return '<select class="' + cls + '" data-id="' + taskIdEscaped + '" style="width: auto; max-width: 140px; display: inline-block; padding: 2px 4px; margin-right: 8px; height: 26px; font-size: 11px;">' + options + '</select>';
      }

      var agentSelect = createSelect(
        agents,
        task.agent,
        "task-agent-select",
        strings.placeholderSelectAgent || "Agent",
        executionDefaults && executionDefaults.agent
      );
      var modelSelect = createSelect(
        models,
        task.model,
        "task-model-select",
        strings.placeholderSelectModel || "Model",
        executionDefaults && executionDefaults.model
      );

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
          if (filters.showRecurringTasks === true) {
            visibleSections.sort(function (left, right) {
              var leftRecurring = isRecurringTodoSectionId(left.id);
              var rightRecurring = isRecurringTodoSectionId(right.id);
              if (leftRecurring === rightRecurring) {
                return 0;
              }
              return leftRecurring ? -1 : 1;
            });
          }
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
        manualSessionBadgeHtml +
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
        ': <span class="task-next-run-label">' +
        escapeHtml(nextRun) +
        '</span><span class="task-next-run-countdown" data-enabled="' +
        (enabled ? "true" : "false") +
        '" data-next-run-ms="' +
        escapeAttr(nextRunMs > 0 ? String(nextRunMs) : "") +
        '"></span>' +
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

    function renderTaskSection(sectionKey, title, items) {
      var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
      if (!listHtml) {
        listHtml =
          '<div class="empty-state">' +
          escapeHtml(strings.noTasksFound) +
          "</div>";
      }
      var isCollapsed = taskSectionCollapseState[sectionKey] === true;
      return (
        '<div class="task-section' + (isCollapsed ? ' is-collapsed' : '') + '" data-task-section="' + escapeAttr(sectionKey) + '">' +
        '<div class="task-section-title">' +
        '<button type="button" class="task-section-toggle" data-task-section-toggle="' + escapeAttr(sectionKey) + '" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '" title="' + escapeAttr(isCollapsed ? (strings.boardSectionExpand || 'Expand section') : (strings.boardSectionCollapse || 'Collapse section')) + '">&#9660;</button>' +
        '<span>' +
        escapeHtml(title) +
        "</span>" +
        "<span>" +
        String(items.length) +
        "</span>" +
        "</div>" +
        '<div class="task-section-body"><div class="task-section-body-inner">' +
        listHtml +
        '</div></div>' +
        "</div>"
      );
    }

    function renderTaskSectionContent(sectionKey, title, contentHtml, itemCount) {
      var isCollapsed = taskSectionCollapseState[sectionKey] === true;
      return (
        '<div class="task-section' + (isCollapsed ? ' is-collapsed' : '') + '" data-task-section="' + escapeAttr(sectionKey) + '">' +
        '<div class="task-section-title">' +
        '<button type="button" class="task-section-toggle" data-task-section-toggle="' + escapeAttr(sectionKey) + '" aria-expanded="' + (isCollapsed ? 'false' : 'true') + '" title="' + escapeAttr(isCollapsed ? (strings.boardSectionExpand || 'Expand section') : (strings.boardSectionCollapse || 'Collapse section')) + '">&#9660;</button>' +
        '<span>' +
        escapeHtml(title) +
        "</span>" +
        '<span class="task-section-count">' +
        String(itemCount) +
        "</span>" +
        "</div>" +
        '<div class="task-section-body"><div class="task-section-body-inner">' +
        contentHtml +
        '</div></div>' +
        "</div>"
      );
    }

    function renderTaskSubsection(title, items) {
      var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
      if (!listHtml) {
        listHtml =
          '<div class="empty-state">' +
          escapeHtml(strings.noTasksFound) +
          "</div>";
      }
      return (
        '<div class="task-subsection">' +
        '<div class="task-subsection-title">' +
        '<span class="task-subsection-name">' + escapeHtml(title) + '</span>' +
        '<span class="task-subsection-count">' + String(items.length) + '</span>' +
        '</div>' +
        '<div class="task-subsection-body">' + listHtml + '</div>' +
        '</div>'
      );
    }

    function isTodoTaskDraft(task) {
      return !!(
        task &&
        Array.isArray(task.labels) &&
        task.labels.some(function (label) {
          return normalizeTodoLabelKey(label) === "from-todo-cockpit";
        })
      );
    }

    function isJobTask(task) {
      return !!(task && task.jobId);
    }

    var manualSessionTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return !isOneTime && !isJobTask(task) && task.manualSession === true;
    });
    var jobTasks = taskItems.filter(function (task) {
      return !!task && isJobTask(task);
    });
    var recurringTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return !isOneTime && !isJobTask(task) && task.manualSession !== true;
    });
    var todoDraftTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return isOneTime && !isJobTask(task) && isTodoTaskDraft(task);
    });
    var oneTimeTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return isOneTime && !isJobTask(task) && !isTodoTaskDraft(task);
    });

    var jobSectionHtml = "";
    if (jobTasks.length > 0) {
      var jobGroupsById = Object.create(null);
      jobTasks.forEach(function (task) {
        var jobId = String(task.jobId || "");
        if (!jobId) {
          return;
        }
        if (!jobGroupsById[jobId]) {
          var job = getJobById(jobId);
          jobGroupsById[jobId] = {
            title: job && job.name ? String(job.name) : jobId,
            items: [],
          };
        }
        jobGroupsById[jobId].items.push(task);
      });

      var jobGroupEntries = Object.keys(jobGroupsById)
        .map(function (jobId) {
          return {
            id: jobId,
            title: jobGroupsById[jobId].title,
            items: jobGroupsById[jobId].items,
          };
        })
        .sort(function (left, right) {
          return left.title.localeCompare(right.title);
        });

      jobSectionHtml = renderTaskSectionContent(
        "jobs",
        strings.labelJobTasks || "Jobs",
        jobGroupEntries.map(function (entry) {
          return renderTaskSubsection(entry.title, entry.items);
        }).join(""),
        jobTasks.length,
      );
    } else {
      jobSectionHtml = renderTaskSectionContent(
        "jobs",
        strings.labelJobTasks || "Jobs",
        '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + '</div>',
        0,
      );
    }

    var leftColumnHtml = "";
    var rightColumnHtml = "";
    if (activeTaskFilter === "all" || activeTaskFilter === "manual") {
      leftColumnHtml += renderTaskSection(
        "manual",
        strings.labelManualSessions || "Manual Sessions",
        manualSessionTasks,
      );
    }
    if (activeTaskFilter === "all") {
      leftColumnHtml += jobSectionHtml;
    }
    if (activeTaskFilter === "all" || activeTaskFilter === "recurring") {
      leftColumnHtml += renderTaskSection(
        "recurring",
        strings.labelRecurringTasks || "Recurring Tasks",
        recurringTasks,
      );
    }
    if (activeTaskFilter === "all" || activeTaskFilter === "one-time") {
      rightColumnHtml += renderTaskSection(
        "todo-draft",
        strings.labelTodoTaskDrafts || "Todo Task Drafts",
        todoDraftTasks,
      );
    }
    if (activeTaskFilter === "all" || activeTaskFilter === "one-time") {
      rightColumnHtml += renderTaskSection(
        "one-time",
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

    var sectionHtml = activeTaskFilter === "all"
      ? '<div class="task-sections-column task-sections-column-primary">' + leftColumnHtml + '</div>' +
        '<div class="task-sections-column task-sections-column-secondary">' + rightColumnHtml + '</div>'
      : leftColumnHtml + rightColumnHtml;

    renderedTasks =
      '<div class="' + containerClass + '"' + containerStyle + ">" +
      sectionHtml +
      "</div>";

    if (renderedTasks === lastRenderedTasksHtml) {
      return;
    }

    // Avoid replacing an open inline select while the user is choosing an
    // agent or model.
    if (isInlineTaskSelectActive()) {
      return;
    }

    lastRenderedTasksHtml = renderedTasks;
    taskList.innerHTML = renderedTasks;
    refreshTaskCountdowns();
  }

  function postTaskInlineChange(taskId, field, value) {
    if (!taskId) {
      return;
    }
    var data = {};
    data[field] = value;
    vscode.postMessage({
      type: "updateTask",
      taskId: taskId,
      data: data,
    });
  }

  if (taskList) {
    taskList.addEventListener("change", function (event) {
      var target = event && event.target;
      if (!target || !target.classList) {
        return;
      }

      if (target.classList.contains("task-agent-select")) {
        postTaskInlineChange(
          target.getAttribute("data-id") || "",
          "agent",
          target.value || "",
        );
        return;
      }

      if (target.classList.contains("task-model-select")) {
        postTaskInlineChange(
          target.getAttribute("data-id") || "",
          "model",
          target.value || "",
        );
      }
    });
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
    updateJobsCadenceMetric();
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
    var manualSessionEl = document.getElementById("manual-session");
    if (manualSessionEl) manualSessionEl.checked = false;
    if (chatSessionSelect) chatSessionSelect.value = defaultChatSession;
    if (agentSelect) agentSelect.value = executionDefaults.agent || "";
    if (modelSelect) modelSelect.value = executionDefaults.model || "";
    syncRecurringChatSessionUi();
    updateFriendlyVisibility();
    updateCronPreview();
  }

  function updateAgentOptions() {
    updateTaskAgentOptions({
      agentSelect: agentSelect,
      agents: agents,
      escapeAttr: escapeAttr,
      escapeHtml: escapeHtml,
      executionDefaults: executionDefaults,
      strings: strings,
    });
  }

  function updateModelOptions() {
    updateTaskModelOptions({
      escapeAttr: escapeAttr,
      escapeHtml: escapeHtml,
      executionDefaults: executionDefaults,
      formatModelLabel: formatModelLabel,
      modelSelect: modelSelect,
      models: models,
      strings: strings,
    });
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
    var normalizedSelectedValue = selectedValue || "";
    var hasSelectedOption = !normalizedSelectedValue;
    var html =
      '<option value="">' +
      escapeHtml(placeholder || "") +
      "</option>" +
      optionItems
        .map(function (item) {
          var value = getValue(item);
          var label = getLabel(item);
          if (value === normalizedSelectedValue) {
            hasSelectedOption = true;
          }
          return (
            '<option value="' +
            escapeAttr(value) +
            '">' +
            escapeHtml(label) +
            "</option>"
          );
        })
        .join("");
    if (normalizedSelectedValue && !hasSelectedOption) {
      html += '<option value="' + escapeAttr(normalizedSelectedValue) + '" selected>' + escapeHtml(normalizedSelectedValue) + '</option>';
    }
    selectEl.innerHTML = html;
    selectEl.value = normalizedSelectedValue;
    if (selectEl.value !== normalizedSelectedValue) {
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
        if (!task || !task.name) {
          return "";
        }
        if (!task.jobId) {
          return task.name;
        }
        var job = getJobById(task.jobId);
        return job && job.name
          ? task.name + " · " + job.name
          : task.name;
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

  function hookEditorTabDirtyTracking() {
    var selector = [
      "#task-name",
      "#prompt-text",
      "#cron-expression",
      "#task-labels",
      "#agent-select",
      "#model-select",
      "#template-select",
      "#jitter-seconds",
      "#chat-session",
      "#run-first",
      "#one-time",
      'input[name="scope"]',
      'input[name="prompt-source"]',
      "#todo-title-input",
      "#todo-description-input",
      "#todo-due-input",
      "#todo-priority-input",
      "#todo-section-input",
      "#todo-linked-task-select",
      "#todo-labels-input",
      "#todo-label-color-input",
      "#todo-flag-name-input",
      "#todo-flag-color-input",
      "#jobs-name-input",
      "#jobs-cron-input",
      "#jobs-folder-select"
    ].join(", ");

    ["input", "change"].forEach(function (eventName) {
      document.addEventListener(eventName, function (event) {
        var target = event && event.target;
        if (!target || typeof target.matches !== "function") {
          return;
        }
        if (target.matches(selector)) {
          syncEditorTabLabels();
        }
      });
    });
  }

  function renderJobsTab() {
    ensureValidJobSelection();
    persistTaskFilter();
    syncEditorTabLabels();

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
    var isJobCreateMode = !selectedJob && isCreatingJob;
    applyJobsSidebarState();
    if (!selectedJob && !isJobCreateMode) {
      if (jobsWorkflowMetrics) jobsWorkflowMetrics.innerHTML = "";
      if (jobsEmptyState) jobsEmptyState.style.display = "block";
      if (jobsDetails) jobsDetails.style.display = "none";
      return;
    }

    if (selectedJob) {
      isCreatingJob = false;
    }
    syncEditorTabLabels();

    if (jobsEmptyState) jobsEmptyState.style.display = "none";
    if (jobsDetails) jobsDetails.style.display = "block";
    var selectedNodes = selectedJob && Array.isArray(selectedJob.nodes) ? selectedJob.nodes : [];
    var selectedWaitingPause = getWaitingPauseState(selectedJob);
    var approvedPauseIds = getApprovedPauseIds(selectedJob);
    var pauseCount = selectedNodes.filter(function (node) {
      return isPauseNode(node);
    }).length;
    var taskCount = Math.max(0, selectedNodes.length - pauseCount);
    var cadenceText = getJobsCadenceText(selectedJob ? (selectedJob.cronExpression || "") : "");

    if (jobsWorkflowMetrics) {
      jobsWorkflowMetrics.innerHTML = [
        {
          label: strings.jobsWorkflowStatus || "Status",
          value: selectedJob ? getJobStatusText(selectedJob) : (strings.jobsCreateJob || "New Job"),
          tone: selectedWaitingPause ? "is-waiting" : ((selectedJob && (selectedJob.paused || selectedJob.archived)) ? "is-muted" : "is-accent")
        },
        {
          label: strings.jobsWorkflowCadence || "Cadence",
          value: selectedJob ? cadenceText : (strings.jobsEditorScheduleNote || "Define a schedule before saving."),
          tone: "is-accent",
          valueAttr: selectedJob ? ' data-jobs-workflow-cadence="1"' : ""
        },
        {
          label: strings.jobsWorkflowTaskCount || "Task steps",
          value: String(taskCount),
          tone: ""
        },
        {
          label: strings.jobsWorkflowPauseCount || "Pause checkpoints",
          value: String(pauseCount),
          tone: pauseCount > 0 ? "is-accent" : ""
        }
      ].map(function (metric) {
        return (
          '<div class="jobs-workflow-metric' +
          (String(metric.value || "").length > 18 ? ' is-compact' : '') +
          (metric.tone ? ' ' + metric.tone : '') +
          '" title="' + escapeAttr(metric.value) + '">' +
          '<div class="jobs-workflow-metric-label">' + escapeHtml(metric.label) + '</div>' +
          '<div class="jobs-workflow-metric-value"' + (metric.valueAttr || '') + '>' + escapeHtml(metric.value) + '</div>' +
          '</div>'
        );
      }).join("");
    }

    if (jobsNameInput) jobsNameInput.value = selectedJob ? (selectedJob.name || "") : "";
    if (jobsCronInput) jobsCronInput.value = selectedJob ? (selectedJob.cronExpression || "") : "0 9 * * 1-5";
    if (jobsCronPreset) jobsCronPreset.value = "";
    syncJobsFolderSelect(selectedJob ? (selectedJob.folderId || "") : (selectedJobFolderId || ""));
    if (jobsStatusPill) {
      jobsStatusPill.textContent = selectedJob
        ? getJobStatusText(selectedJob)
        : (strings.jobsRunning || "Running");
      if (jobsStatusPill.classList) {
        jobsStatusPill.classList.toggle("is-inactive", !!(selectedJob && (selectedJob.paused || selectedJob.archived)));
        jobsStatusPill.classList.toggle("is-waiting", !!selectedWaitingPause);
      }
      jobsStatusPill.disabled = !selectedJob;
    }
    if (jobsPauseBtn) {
      jobsPauseBtn.textContent = selectedJob && selectedJob.paused
        ? strings.jobsResume || "Resume Job"
        : strings.jobsPause || "Pause Job";
      jobsPauseBtn.disabled = !selectedJob;
    }
    if (jobsCompileBtn) {
      jobsCompileBtn.disabled = !selectedJob || selectedNodes.length === 0;
    }
    if (jobsDuplicateBtn) {
      jobsDuplicateBtn.disabled = !selectedJob;
    }
    if (jobsDeleteBtn) {
      jobsDeleteBtn.disabled = !selectedJob;
    }
    if (jobsSaveBtn) {
      jobsSaveBtn.textContent = selectedJob
        ? (strings.jobsSave || "Save Job")
        : (strings.jobsCreateJob || "New Job");
    }

    if (jobsTimelineInline) {
      var timelineHtml = selectedNodes
        .map(function (node, index) {
          var taskName = "";
          if (isPauseNode(node)) {
            taskName = (strings.jobsPausePrefix || "Pause") + ": " + (node.title || (strings.jobsPauseDefaultTitle || "Manual review"));
          } else {
            var task = getTaskById(node.taskId);
            taskName = task && task.name ? task.name : ((strings.jobsStepPrefix || "Step") + " " + String(index + 1));
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
      jobsTimelineInline.innerHTML = selectedJob
        ? (timelineHtml || escapeHtml(strings.jobsTimelineEmpty || "No steps yet"))
        : escapeHtml(strings.jobsTimelineEmpty || "No steps yet");
    }

    syncJobsExistingTaskSelect();
    syncJobsStepSelectors();
    updateJobsCronPreview();
    updateJobsFriendlyVisibility();

    if (jobsStepList) {
      if (!selectedJob) {
        jobsStepList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.jobsCreateJob || 'Create Job') + ': ' + escapeHtml(strings.jobsSave || 'Save Job') + '</div>';
        return;
      }
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
  syncEditorTabLabels();

  // Global functions for onclick handlers
  window.runTask = function (id) {
    vscode.postMessage({ type: "runTask", taskId: id });
  };

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
    var manualSessionEl = document.getElementById("manual-session");
    if (manualSessionEl) manualSessionEl.checked = task.oneTime === true ? false : task.manualSession === true;
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
          emitWebviewDebug("updateTasks", {
            taskCount: tasks.length,
            selectedTodoId: selectedTodoId || "",
            isCreatingJob: isCreatingJob,
          });
          syncTaskLabelFilterOptions();
          syncJobsExistingTaskSelect();
          renderTaskList(message.tasks);
          renderJobsTab();
          syncTodoLinkedTaskOptions(selectedTodoId ? "" : (todoLinkedTaskSelect ? todoLinkedTaskSelect.value : ""));
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
            version: 4,
            sections: [],
            cards: [],
            filters: { labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false },
            updatedAt: "",
          };
          if (pendingTodoFilters) {
            var incomingFilters = normalizeTodoFilters(cockpitBoard.filters);
            if (areTodoFiltersEqual(incomingFilters, pendingTodoFilters)) {
              pendingTodoFilters = null;
            } else {
              cockpitBoard = Object.assign({}, cockpitBoard, {
                filters: normalizeTodoFilters(Object.assign({}, incomingFilters, pendingTodoFilters)),
              });
            }
          }
          emitWebviewDebug("updateCockpitBoard", {
            sectionCount: Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.length : 0,
            cardCount: Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.length : 0,
            selectedTodoId: selectedTodoId || "",
            draftTitleLength: currentTodoDraft.title.length,
          });
          if (
            pendingTodoDeleteId &&
            !cockpitBoard.cards.some(function (card) {
              return card && card.id === pendingTodoDeleteId;
            })
          ) {
            closeTodoDeleteModal();
          }
          if (
            pendingBoardDeleteTodoId &&
            !cockpitBoard.cards.some(function (card) {
              return card && card.id === pendingBoardDeleteTodoId;
            })
          ) {
            pendingBoardDeleteTodoId = "";
            pendingBoardDeletePermanentOnly = false;
          }
          clearCatalogDeleteState();
          syncTaskLabelFilterOptions();
          renderTaskList(tasks);
          requestCockpitBoardRender();
          reconcileTodoEditorCatalogState();
          syncFlagEditor();
          syncTodoLabelEditor();
          scheduleBoardStickyMetrics();
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
        case "updateLogLevel":
          currentLogLevel =
            typeof message.logLevel === "string" && message.logLevel
              ? message.logLevel
              : "info";
          debugTools.setLogLevel(currentLogLevel);
          renderLoggingControls();
          break;
        case "updateStorageSettings":
          storageSettings = {
            mode:
              message.storageSettings && message.storageSettings.mode === "sqlite"
                ? "sqlite"
                : "json",
            sqliteJsonMirror:
              !message.storageSettings
              || message.storageSettings.sqliteJsonMirror !== false,
          };
          renderStorageSettingsControls();
          break;
        case "updateExecutionDefaults":
          executionDefaults = message.executionDefaults || {
            agent: "agent",
            model: "",
          };
          emitWebviewDebug("updateExecutionDefaults", {
            agent: executionDefaults.agent || "",
            model: executionDefaults.model || "",
            editingTaskId: editingTaskId || "",
            pendingAgentValue: pendingAgentValue,
            pendingModelValue: pendingModelValue,
          });
          renderExecutionDefaultsControls();
          if (!editingTaskId) {
            if (agentSelect && !pendingAgentValue && !agentSelect.value) {
              agentSelect.value = executionDefaults.agent || "";
            }
            if (modelSelect && !pendingModelValue && !modelSelect.value) {
              modelSelect.value = executionDefaults.model || "";
            }
          }
          renderTaskList(tasks);
          break;
        case "updateAgents":
          {
            var currentAgentValue =
              pendingAgentValue || (agentSelect ? agentSelect.value : "");
            emitWebviewDebug("updateAgents", {
              currentAgentValue: currentAgentValue,
              agentCount: Array.isArray(message.agents) ? message.agents.length : 0,
            });
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
            renderTaskList(tasks);
          }
          break;
        case "updateModels":
          {
            var currentModelValue =
              pendingModelValue || (modelSelect ? modelSelect.value : "");
            emitWebviewDebug("updateModels", {
              currentModelValue: currentModelValue,
              modelCount: Array.isArray(message.models) ? message.models.length : 0,
            });
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
            renderTaskList(tasks);
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
          hideGlobalError();
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
          var focusedJobId = message.jobId || "";
          isCreatingJob = true;
          selectedJobId = "";
          persistTaskFilter();
          renderJobsTab();
          switchTab("jobs");
          setTimeout(function () {
            var jobCard = focusedJobId
              ? document.querySelector('[data-job-id="' + focusedJobId + '"]')
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
          hideGlobalError();
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
        case "startCreateTodo":
          emitWebviewDebug("startCreateTodo", { reason: "host" });
          resetTodoEditor();
          break;
        case "startCreateJob":
          emitWebviewDebug("startCreateJob", { reason: "host" });
          resetJobEditor();
          break;
        case "showError":
          if (message.text) {
            showGlobalError(message.text);
            pendingSubmit = false;
            if (submitBtn) submitBtn.disabled = false;
          }
          break;
        case "todoFileUploadResult":
          if (message.ok && message.insertedText) {
            appendTextToTodoDescription(String(message.insertedText || ""));
            setTodoUploadNote(
              String(message.message || strings.boardUploadFilesSuccess || ""),
              "success",
            );
          } else if (!message.cancelled) {
            setTodoUploadNote(
              String(message.message || strings.boardUploadFilesError || ""),
              "error",
            );
          } else {
            setTodoUploadNote(
              String(message.message || strings.boardUploadFilesHint || ""),
              "neutral",
            );
          }
          break;
      }
    } catch (e) {
      var prefix = strings.webviewClientErrorPrefix || "";
      var rawError = e && e.message ? e.message : e;
      rawError = String(rawError).split(/\r?\n/)[0];
      showGlobalError(prefix + sanitizeAbsolutePaths(rawError));
      pendingSubmit = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Initial render
  renderTaskList(tasks);

  switchTab(getInitialTabName());
  window.addEventListener("scroll", function () {
    updateBoardAutoCollapseFromScroll(false);
  }, { passive: true });
  window.addEventListener("resize", scheduleBoardStickyMetrics);
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeTodoDeleteModal();
      closeTodoCommentModal();
    }
  });
  scheduleBoardStickyMetrics();

  // Keep next-run countdown live in the list view without rebuilding the list.
  setInterval(function () {
    if (isTabActive("list")) {
      refreshTaskCountdowns();
    }
  }, 1000);

  // Notify extension that webview is ready
  vscode.postMessage({ type: "webviewReady" });
})();










