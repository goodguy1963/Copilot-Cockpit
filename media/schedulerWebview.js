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
  var agents = Array.isArray(initialData.agents) ? initialData.agents : [];
  var models = Array.isArray(initialData.models) ? initialData.models : [];
  var promptTemplates = Array.isArray(initialData.promptTemplates)
    ? initialData.promptTemplates
    : [];
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
  var cronPreset = document.getElementById("cron-preset");
  var cronExpression = document.getElementById("cron-expression");
  var agentSelect = document.getElementById("agent-select");
  var modelSelect = document.getElementById("model-select");
  var chatSessionGroup = document.getElementById("chat-session-group");
  var chatSessionSelect = document.getElementById("chat-session");
  var templateSelect = document.getElementById("template-select");
  var templateSelectGroup = document.getElementById("template-select-group");
  var templateRefreshBtn = document.getElementById("template-refresh-btn");
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
  var activeTaskFilter = "all";

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
      vscode.setState(next);
    } catch (_e) {
      // ignore state persist failures
    }
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

  restoreTaskFilter();
  syncAutoShowOnStartupUi();
  syncScheduleHistoryOptions();

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

  if (friendlyFrequency) {
    friendlyFrequency.addEventListener("change", function () {
      updateFriendlyVisibility();
    });
  }

  // Some environments may miss direct events on the select; keep it in sync via delegation.
  document.addEventListener("change", function (e) {
    var target = e && e.target;
    if (target && target.id === "friendly-frequency") {
      updateFriendlyVisibility();
    }
  });

  document.addEventListener("input", function (e) {
    var target = e && e.target;
    if (target && target.id === "friendly-frequency") {
      updateFriendlyVisibility();
    }
  });

  if (friendlyGenerate) {
    friendlyGenerate.addEventListener("click", function () {
      generateCronFromFriendly();
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

      // Escape for HTML attributes to avoid broken inline handlers
      var taskIdEscaped = escapeAttr(task.id || "");

      // --- Model & Agent Selection Logic ---
      function createSelect(items, selectedId, cls, placeholder) {
        var options = '<option value="">' + escapeHtml(placeholder) + '</option>';
        if (Array.isArray(items)) {
          items.forEach(function (item) {
            var id = item.id || item.slug;
            var label = item.name || id;
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
        cronText +
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

    var friendlyFields = document.querySelectorAll(".friendly-field");
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
    var runFirstEl = document.getElementById("run-first");
    if (runFirstEl) runFirstEl.checked = false;
    var oneTimeEl = document.getElementById("one-time");
    if (oneTimeEl) oneTimeEl.checked = false;
    if (chatSessionSelect) chatSessionSelect.value = defaultChatSession;
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

      // Default to @ceo if available and no selection made
      if (!agentSelect.value) {
        var hasCeo = items.find(function (a) { return a.id === '@ceo'; });
        if (hasCeo) {
          agentSelect.value = '@ceo';
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
              escapeHtml(m.name) +
              "</option>"
            );
          })
          .join("");

      // Default to GPT-5.3-Codex if available and no selection made
      if (!modelSelect.value) {
        var defaultModelId = "GPT-5.3-Codex";
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
          renderTaskList(message.tasks);
          break;
        case "updateAgents":
          {
            var currentAgentValue =
              pendingAgentValue || (agentSelect ? agentSelect.value : "");
            agents = Array.isArray(message.agents) ? message.agents : [];
            updateAgentOptions();
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
