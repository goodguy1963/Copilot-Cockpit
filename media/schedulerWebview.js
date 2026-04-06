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
  buildFriendlyCronExpression,
  summarizeCronExpression,
  syncFriendlyFieldVisibility,
} from "./schedulerWebviewCronUtils.js";
import {
  applyPromptSourceUi,
  restorePendingSelectValue,
  syncPromptTemplatesFromMessage,
  updatePromptTemplateOptions,
} from "./schedulerWebviewPromptState.js";
import {
  buildBaseTaskActionsMarkup,
  buildTaskConfigRowMarkup,
} from "./schedulerWebviewTaskCards.js";
import { handleTaskListClick } from "./schedulerWebviewTaskActions.js";
import {
  selectHasOptionValue,
  populateAgentDropdown as updateTaskAgentOptions,
  populateModelDropdown as updateTaskModelOptions,
} from "./schedulerWebviewTaskSelectState.js";
import {
  formatCountdown,
  formatModelLabel,
  getNextRunCountdownText,
  normalizeDefaultJitterSeconds,
  sanitizeAbsolutePaths,
} from "./schedulerWebviewDisplayUtils.js";
import {
  installGlobalErrorHandlers,
  readInitialWebviewBootstrap,
} from "./schedulerWebviewBootstrap.js";
import { createInitialSchedulerWebviewState } from "./schedulerWebviewInitialState.js";
import { createSchedulerWebviewDomRefs } from "./schedulerWebviewDomRefs.js";
import {
  createBoardRenderState,
  finishBoardDrag,
  requestBoardRender,
} from "./schedulerWebviewBoardState.js";
import {
  createStorageSettingsNormalizer,
  resolveInitialSchedulerCollections,
} from "./schedulerWebviewDefaults.js";
import {
  activateSchedulerTab,
  bindGenericChange,
  bindTabButtons,
  bindTaskFilterBar,
  bindSelectValueChange,
} from "./schedulerWebviewTabState.js";
import {
  bindClickAction,
  bindDocumentValueDelegates,
  bindInlineTaskQuickUpdate,
  bindInputFeedbackClear,
  bindOpenCronGuruButton,
  bindSelectChange,
} from "./schedulerWebviewBindings.js";
import {
  bindCronPresetPair,
  bindPromptSourceDelegation,
  bindTemplateSelectionLoader,
} from "./schedulerWebviewFormBindings.js";
import {
  buildTaskSubmissionData,
  postTaskSubmission,
  validateTaskSubmission,
} from "./schedulerWebviewTaskSubmit.js";
import {
  bindAutoShowStartupButton,
  bindRefreshButton,
  bindRestoreHistoryButton,
  bindTaskTestButton,
} from "./schedulerWebviewToolbarBindings.js";
import { bindJobToolbarButtons } from "./schedulerWebviewJobBindings.js";
import {
  bindLanguageSelectors,
  bindTemplateRefreshButton,
  bindUtilityActionButtons,
} from "./schedulerWebviewUtilityBindings.js";
import {
  bindJobDragAndDrop,
  bindJobNodeWindowChange,
  handleSchedulerDetailClick,
} from "./schedulerWebviewJobInteractions.js";
import { createSchedulerWebviewTransientState } from "./schedulerWebviewTransientState.js";

(function () {
  var vscode = null;
  var bootstrapData = readInitialWebviewBootstrap(document);
  var initialData = bootstrapData.initialData;
  var strings = bootstrapData.strings;
  var currentLogLevel = bootstrapData.currentLogLevel;
  var currentLogDirectory = bootstrapData.currentLogDirectory;

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

  installGlobalErrorHandlers({
    window: window,
    strings: strings,
    showGlobalError: showGlobalError,
    sanitizeAbsolutePaths: sanitizeAbsolutePaths,
  });

  function createFallbackVsCodeApi() {
    return { postMessage: function () { } };
  }

  var hasVsCodeApi = typeof acquireVsCodeApi === "function";
  vscode = hasVsCodeApi ? acquireVsCodeApi() : createFallbackVsCodeApi();
  if (!hasVsCodeApi) {
    vscode = createFallbackVsCodeApi();
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

  var initialCollections = resolveInitialSchedulerCollections(initialData);
  var tasks = initialCollections.tasks;
  var jobs = initialCollections.jobs;
  var jobFolders = initialCollections.jobFolders;
  var cockpitBoard = initialCollections.cockpitBoard;
  var telegramNotification = initialCollections.telegramNotification;
  var executionDefaults = initialCollections.executionDefaults;
  var reviewDefaults = initialCollections.reviewDefaults;
  var normalizeStorageSettings = createStorageSettingsNormalizer(normalizeTodoLabelKey);

  var initialState = createInitialSchedulerWebviewState(
    initialData,
    normalizeStorageSettings,
  );
  var storageSettings = initialState.storageSettings;
  var researchProfiles = initialState.researchProfiles;
  var activeResearchRun = initialState.activeResearchRun;
  var recentResearchRuns = initialState.recentResearchRuns;
  var agents = initialState.agents;
  var models = initialState.models;
  var promptTemplates = initialState.promptTemplates;
  var skills = initialState.skills;
  var scheduleHistory = initialState.scheduleHistory;
  var defaultChatSession = initialState.defaultChatSession;
  var autoShowOnStartup = initialState.autoShowOnStartup;
  var workspacePaths = initialState.workspacePaths;
  var caseInsensitivePaths = initialState.caseInsensitivePaths;
  var editingTaskId = null;
  var selectedTodoId = null;
  var EDITOR_CREATE_SYMBOL = "+";
  var EDITOR_EDIT_SYMBOL = "⚙";
  var boardRenderState = createBoardRenderState();
  var draggingTodoId = null;
  var isBoardDragging = false;
  function requestCockpitBoardRender() {
    boardRenderState.draggingTodoId = draggingTodoId;
    boardRenderState.isBoardDragging = isBoardDragging;
    requestBoardRender(boardRenderState, requestAnimationFrame, function () {
      renderCockpitBoard();
    });
    draggingTodoId = boardRenderState.draggingTodoId;
    isBoardDragging = boardRenderState.isBoardDragging;
  }
  function finishBoardDragState() {
    boardRenderState.draggingTodoId = draggingTodoId;
    boardRenderState.isBoardDragging = isBoardDragging;
    finishBoardDrag(
      boardRenderState,
      function () {
        draggingSectionId = null;
        lastDragOverSectionId = null;
      },
      function () {
        draggingTodoId = boardRenderState.draggingTodoId;
        isBoardDragging = boardRenderState.isBoardDragging;
        requestCockpitBoardRender();
      },
    );
    draggingTodoId = boardRenderState.draggingTodoId;
    isBoardDragging = boardRenderState.isBoardDragging;
  }
  var HELP_WARP_SEEN_KEY = "copilot-scheduler-help-warp-seen-v1";
  var transientState = createSchedulerWebviewTransientState(
    createEmptyTodoDraft,
    localStorage,
    HELP_WARP_SEEN_KEY,
  );
  var currentTodoLabels = transientState.currentTodoLabels;
  var currentTodoDraft = transientState.currentTodoDraft;
  var selectedTodoLabelName = transientState.selectedTodoLabelName;
  var currentTodoFlag = transientState.currentTodoFlag;
  var pendingTodoFilters = transientState.pendingTodoFilters;
  var pendingDeleteLabelName = transientState.pendingDeleteLabelName;
  var pendingDeleteFlagName = transientState.pendingDeleteFlagName;
  var pendingTodoDeleteId = transientState.pendingTodoDeleteId;
  var pendingBoardDeleteTodoId = transientState.pendingBoardDeleteTodoId;
  var pendingBoardDeletePermanentOnly = transientState.pendingBoardDeletePermanentOnly;
  var todoDeleteModalRoot = transientState.todoDeleteModalRoot;
  var todoCommentModalRoot = transientState.todoCommentModalRoot;
  var pendingAgentValue = transientState.pendingAgentValue;
  var pendingModelValue = transientState.pendingModelValue;
  var pendingTemplatePath = transientState.pendingTemplatePath;
  var editingTaskEnabled = transientState.editingTaskEnabled;
  var pendingSubmit = transientState.pendingSubmit;
  var helpWarpIntroPending = transientState.helpWarpIntroPending;
  var helpWarpFadeTimeout = transientState.helpWarpFadeTimeout;
  var helpWarpCleanupTimeout = transientState.helpWarpCleanupTimeout;
  var isCreatingJob = transientState.isCreatingJob;
  var todoEditorListenersBound = transientState.todoEditorListenersBound;

  function resetTodoDraft(reason) {
    currentTodoDraft = debugTools.resetTodoDraft(reason);
  }

  function syncTodoDraftFromInputs(reason) {
    currentTodoDraft = debugTools.syncTodoDraftFromInputs({
      currentTodoDraft: currentTodoDraft,
      reason: reason,
      selectedTodoId: selectedTodoId,
      todoCommentInput: todoCommentInput,
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

  var defaultJitterSeconds = normalizeDefaultJitterSeconds(
    initialData.defaultJitterSeconds,
  );
  var locale = (typeof initialData.locale === "string" && initialData.locale) || undefined;
  var lastRenderedTasksHtml = "";
  var pendingTaskListRender = false;

  // Cached DOM references (guarded against null)
  var {
    taskForm,
    taskList,
    editTaskIdInput,
    submitBtn,
    testBtn,
    refreshBtn,
    autoShowStartupBtn,
    scheduleHistorySelect,
    restoreHistoryBtn,
    autoShowStartupNote,
    friendlyBuilder,
    cronPreset,
    cronExpression,
    agentSelect,
    modelSelect,
    chatSessionGroup,
    chatSessionSelect,
    templateSelect,
    templateSelectGroup,
    templateRefreshBtn,
    skillSelect,
    insertSkillBtn,
    setupMcpBtn,
    syncBundledSkillsBtn,
    importStorageFromJsonBtn,
    exportStorageToJsonBtn,
    helpLanguageSelect,
    settingsLanguageSelect,
    helpWarpLayer,
    helpIntroRocket,
    promptGroup,
    promptTextEl,
    jitterSecondsInput,
    friendlyFrequency,
    friendlyInterval,
    friendlyMinute,
    friendlyHour,
    friendlyDow,
    friendlyDom,
    friendlyGenerate,
    openGuruBtn,
    cronPreviewText,
    newTaskBtn,
    taskFilterBar,
    taskLabelFilter,
    taskLabelsInput,
    jobsFolderList,
    jobsCurrentFolderBanner,
    jobsList,
    jobsEmptyState,
    jobsDetails,
    jobsLayout,
    jobsToggleSidebarBtn,
    jobsShowSidebarBtn,
    jobsNewFolderBtn,
    jobsRenameFolderBtn,
    jobsDeleteFolderBtn,
    jobsNewJobBtn,
    jobsSaveBtn,
    jobsSaveDeckBtn,
    jobsDuplicateBtn,
    jobsPauseBtn,
    jobsCompileBtn,
    jobsDeleteBtn,
    jobsBackBtn,
    jobsOpenEditorBtn,
    tabBar,
    boardFilterSticky,
    boardSummary,
    boardColumns,
    todoToggleFiltersBtn,
    todoSearchInput,
    todoSectionFilter,
    todoLabelFilter,
    todoFlagFilter,
    todoPriorityFilter,
    todoStatusFilter,
    todoArchiveOutcomeFilter,
    todoSortBy,
    todoSortDirection,
    todoViewMode,
    todoShowRecurringTasks,
    todoShowArchived,
    todoHideCardDetails,
    todoNewBtn,
    todoClearSelectionBtn,
    todoClearFiltersBtn,
    todoBackBtn,
    todoDetailTitle,
    todoDetailModeNote,
    todoDetailForm,
    todoDetailId,
    todoTitleInput,
    todoDescriptionInput,
    todoDueInput,
    todoPriorityInput,
    todoSectionInput,
    todoLinkedTaskSelect,
    todoDetailStatus,
    todoLabelChipList,
    todoLabelsInput,
    todoLabelSuggestions,
    todoLabelColorInput,
    todoLabelAddBtn,
    todoLabelColorSaveBtn,
    todoLabelCatalog,
    todoFlagNameInput,
    todoFlagColorInput,
    todoFlagAddBtn,
    todoFlagColorSaveBtn,
    todoLinkedTaskNote,
    todoSaveBtn,
    todoCreateTaskBtn,
    todoCompleteBtn,
    todoDeleteBtn,
    todoUploadFilesBtn,
    todoUploadFilesNote,
    todoCommentList,
    todoCommentInput,
    todoAddCommentBtn,
    todoCommentCountBadge,
    todoCommentModePill,
    todoCommentContextNote,
    todoCommentComposerTitle,
    todoCommentComposerNote,
    todoCommentDraftStatus,
    todoCommentThreadNote,
    jobsNameInput,
    jobsCronPreset,
    jobsCronInput,
    jobsCronPreviewText,
    jobsOpenGuruBtn,
    jobsFriendlyBuilder,
    jobsFriendlyFrequency,
    jobsFriendlyInterval,
    jobsFriendlyMinute,
    jobsFriendlyHour,
    jobsFriendlyDow,
    jobsFriendlyDom,
    jobsFriendlyGenerate,
    jobsFolderSelect,
    jobsStatusPill,
    jobsTimelineInline,
    jobsWorkflowMetrics,
    jobsStepList,
    jobsPauseNameInput,
    jobsCreatePauseBtn,
    jobsExistingTaskSelect,
    jobsExistingWindowInput,
    jobsAttachBtn,
    jobsStepNameInput,
    jobsStepWindowInput,
    jobsStepPromptInput,
    jobsStepAgentSelect,
    jobsStepModelSelect,
    jobsStepLabelsInput,
    jobsCreateStepBtn,
    researchNewBtn,
    researchLoadAutoAgentExampleBtn,
    researchSaveBtn,
    researchDuplicateBtn,
    researchDeleteBtn,
    researchStartBtn,
    researchStopBtn,
    researchEditIdInput,
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
    researchProfileList,
    researchRunList,
    researchRunTitle,
    researchFormError,
    researchActiveEmpty,
    researchActiveDetails,
    researchActiveStatus,
    researchActiveBest,
    researchActiveAttempts,
    researchActiveLastOutcome,
    researchActiveMeta,
    researchAttemptList,
    telegramEnabledInput,
    telegramBotTokenInput,
    telegramChatIdInput,
    telegramMessagePrefixInput,
    telegramSaveBtn,
    telegramTestBtn,
    telegramFeedback,
    telegramTokenStatus,
    telegramChatStatus,
    telegramHookStatus,
    telegramUpdatedAt,
    telegramStatusNote,
    defaultAgentSelect,
    defaultModelSelect,
    executionDefaultsSaveBtn,
    executionDefaultsNote,
    needsBotReviewCommentTemplateInput,
    needsBotReviewPromptTemplateInput,
    needsBotReviewAgentSelect,
    needsBotReviewModelSelect,
    needsBotReviewChatSessionSelect,
    readyPromptTemplateInput,
    reviewDefaultsSaveBtn,
    reviewDefaultsNote,
    settingsStorageModeSelect,
    settingsStorageMirrorInput,
    settingsFlagReadyInput,
    settingsFlagNeedsBotReviewInput,
    settingsFlagNeedsUserReviewInput,
    settingsFlagNewInput,
    settingsFlagOnScheduleListInput,
    settingsFlagFinalUserCheckInput,
    settingsStorageSaveBtn,
    settingsStorageNote,
    settingsVersionValue,
    settingsMcpStatusValue,
    settingsMcpUpdatedValue,
    settingsSkillsUpdatedValue,
    settingsLogLevelSelect,
    settingsLogDirectoryInput,
    settingsOpenLogFolderBtn,
    boardAddSectionBtn,
    boardSectionInlineForm,
    boardSectionNameInput,
    boardSectionSaveBtn,
    boardSectionCancelBtn,
    cockpitColSlider,
  } = createSchedulerWebviewDomRefs(document);

  // Restore persisted column width\n  (function () {\n    var savedWidth = localStorage.getItem(\"cockpit-col-width\");\n    if (savedWidth) {\n      var w = Number(savedWidth);\n      document.documentElement.style.setProperty(\"--cockpit-col-width\", w + \"px\");\n      var font = Math.round(10 + (w - 180) * 3 / 340);\n      document.documentElement.style.setProperty(\"--cockpit-col-font\", font + \"px\");\n      var pad = Math.round(8 + (w - 180) * 6 / 340);\n      document.documentElement.style.setProperty(\"--cockpit-card-pad\", pad + \"px\");\n      if (cockpitColSlider) cockpitColSlider.value = savedWidth;\n    }\n  })();

  var activeTaskFilter = "all";
  var restoredTaskFilterWasExplicit = false;
  var activeLabelFilter = "";
  var restoredLabelFilterWasExplicit = false;
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
  var activeTabName = "";
  var tabScrollPositions = Object.create(null);
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

  function isPersistedTabName(value) {
    return value === "help"
      || value === "settings"
      || value === "research"
      || value === "jobs"
      || value === "jobs-edit"
      || value === "list"
      || value === "create"
      || value === "board"
      || value === "todo-edit";
  }

  function getWindowScrollY() {
    if (typeof window.scrollY === "number") {
      return Math.max(0, Math.round(window.scrollY));
    }
    var scrollingElement = document.scrollingElement || document.documentElement || document.body;
    return scrollingElement && typeof scrollingElement.scrollTop === "number"
      ? Math.max(0, Math.round(scrollingElement.scrollTop))
      : 0;
  }

  function setWindowScrollY(value) {
    var next = Number(value);
    if (!isFinite(next) || next < 0) {
      next = 0;
    }
    window.scrollTo(0, Math.round(next));
  }

  function captureTabScrollPosition(tabName) {
    if (!isPersistedTabName(tabName)) {
      return;
    }
    tabScrollPositions[tabName] = getWindowScrollY();
  }

  function restoreTabScrollPosition(tabName) {
    var nextScroll = 0;
    if (isPersistedTabName(tabName) && typeof tabScrollPositions[tabName] === "number") {
      nextScroll = tabScrollPositions[tabName];
    }
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () {
        setWindowScrollY(nextScroll);
      });
      return;
    }
    setWindowScrollY(nextScroll);
  }

  function restoreTaskFilter() {
    if (!vscode || typeof vscode.getState !== "function") return;
    try {
      var state = vscode.getState() || {};
      var saved = state && state.taskFilter;
      if (isValidTaskFilter(saved)) {
        activeTaskFilter = saved;
        restoredTaskFilterWasExplicit = saved !== "all";
      }
      if (state && typeof state.labelFilter === "string") {
        activeLabelFilter = state.labelFilter;
        restoredLabelFilterWasExplicit = state.labelFilter.length > 0;
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
      if (state && isPersistedTabName(state.activeTab)) {
        activeTabName = state.activeTab;
      }
      if (state && state.tabScrollPositions && typeof state.tabScrollPositions === "object") {
        Object.keys(state.tabScrollPositions).forEach(function (key) {
          var value = state.tabScrollPositions[key];
          if (isPersistedTabName(key) && typeof value === "number" && isFinite(value) && value >= 0) {
            tabScrollPositions[key] = Math.round(value);
          }
        });
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
      next.activeTab = activeTabName;
      next.tabScrollPositions = tabScrollPositions;
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

  function appendTextToTodoComment(insertedText) {
    if (!todoCommentInput || !insertedText || todoCommentInput.disabled) {
      return;
    }
    var currentValue = String(todoCommentInput.value || "");
    if (currentValue.indexOf(insertedText) >= 0) {
      todoCommentInput.focus();
      return;
    }
    var separator = currentValue ? (/\n\s*$/.test(currentValue) ? "\n" : "\n\n") : "";
    todoCommentInput.value = currentValue + separator + insertedText;
    syncTodoDraftFromInputs("comment-template");
    renderTodoCommentSectionState(selectedTodoId ? findTodoById(selectedTodoId) : null);
    todoCommentInput.focus();
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

  function formatSettingsTimestamp(value) {
    if (!value) {
      return strings.settingsStorageNeverUpdated || "Never";
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(locale);
  }

  function getMcpSetupStatusLabel(status) {
    switch (status) {
      case "configured":
        return strings.settingsStorageMcpStatusConfigured || "Configured";
      case "missing":
        return strings.settingsStorageMcpStatusMissing || "Missing";
      case "stale":
        return strings.settingsStorageMcpStatusStale || "Needs refresh";
      case "invalid":
        return strings.settingsStorageMcpStatusInvalid || "Invalid";
      default:
        return strings.settingsStorageMcpStatusWorkspaceRequired || "Open a workspace to inspect";
    }
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

  function collectReviewDefaultsFormData() {
    return {
      needsBotReviewCommentTemplate: needsBotReviewCommentTemplateInput
        ? String(needsBotReviewCommentTemplateInput.value || "")
        : "",
      needsBotReviewPromptTemplate: needsBotReviewPromptTemplateInput
        ? String(needsBotReviewPromptTemplateInput.value || "")
        : "",
      needsBotReviewAgent: needsBotReviewAgentSelect
        ? String(needsBotReviewAgentSelect.value || "")
        : "",
      needsBotReviewModel: needsBotReviewModelSelect
        ? String(needsBotReviewModelSelect.value || "")
        : "",
      needsBotReviewChatSession: needsBotReviewChatSessionSelect
        && needsBotReviewChatSessionSelect.value === "continue"
        ? "continue"
        : "new",
      readyPromptTemplate: readyPromptTemplateInput
        ? String(readyPromptTemplateInput.value || "")
        : "",
    };
  }

  function collectStorageSettingsFormData() {
    var disabledSystemFlagKeys = [];
    if (settingsFlagReadyInput && settingsFlagReadyInput.checked === false) {
      disabledSystemFlagKeys.push("ready");
    }
    if (settingsFlagNeedsBotReviewInput && settingsFlagNeedsBotReviewInput.checked === false) {
      disabledSystemFlagKeys.push("needs-bot-review");
    }
    if (settingsFlagNeedsUserReviewInput && settingsFlagNeedsUserReviewInput.checked === false) {
      disabledSystemFlagKeys.push("needs-user-review");
    }
    if (settingsFlagNewInput && settingsFlagNewInput.checked === false) {
      disabledSystemFlagKeys.push("new");
    }
    if (settingsFlagOnScheduleListInput && settingsFlagOnScheduleListInput.checked === false) {
      disabledSystemFlagKeys.push("on-schedule-list");
    }
    if (settingsFlagFinalUserCheckInput && settingsFlagFinalUserCheckInput.checked === false) {
      disabledSystemFlagKeys.push("final-user-check");
    }
    return {
      mode:
        settingsStorageModeSelect && settingsStorageModeSelect.value === "sqlite"
          ? "sqlite"
          : "json",
      sqliteJsonMirror: !settingsStorageMirrorInput || settingsStorageMirrorInput.checked !== false,
      disabledSystemFlagKeys: disabledSystemFlagKeys,
    };
  }

  function renderExecutionDefaultsControls() {
    var agentSelectEl = defaultAgentSelect || document.getElementById("default-agent-select");
    var modelSelectEl = defaultModelSelect || document.getElementById("default-model-select");
    var executionDefaultsNoteEl = executionDefaultsNote || document.getElementById("execution-defaults-note");

    updateSimpleSelect(
      agentSelectEl,
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
      modelSelectEl,
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

    if (executionDefaultsNoteEl) {
      executionDefaultsNoteEl.textContent = strings.executionDefaultsSaved
        || "Workspace default agent and model settings.";
    }
  }

  function renderReviewDefaultsControls() {
    if (needsBotReviewCommentTemplateInput) {
      needsBotReviewCommentTemplateInput.value = reviewDefaults
        && typeof reviewDefaults.needsBotReviewCommentTemplate === "string"
        ? reviewDefaults.needsBotReviewCommentTemplate
        : "";
    }

    if (needsBotReviewPromptTemplateInput) {
      needsBotReviewPromptTemplateInput.value = reviewDefaults
        && typeof reviewDefaults.needsBotReviewPromptTemplate === "string"
        ? reviewDefaults.needsBotReviewPromptTemplate
        : "";
    }

    if (readyPromptTemplateInput) {
      readyPromptTemplateInput.value = reviewDefaults
        && typeof reviewDefaults.readyPromptTemplate === "string"
        ? reviewDefaults.readyPromptTemplate
        : "";
    }

    updateSimpleSelect(
      needsBotReviewAgentSelect,
      agents,
      strings.placeholderSelectAgent || "Select agent",
      reviewDefaults && typeof reviewDefaults.needsBotReviewAgent === "string"
        ? reviewDefaults.needsBotReviewAgent
        : "agent",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return item && item.name ? item.name : "";
      },
    );

    updateSimpleSelect(
      needsBotReviewModelSelect,
      models,
      strings.placeholderSelectModel || "Select model",
      reviewDefaults && typeof reviewDefaults.needsBotReviewModel === "string"
        ? reviewDefaults.needsBotReviewModel
        : "",
      function (item) {
        return item && item.id ? item.id : "";
      },
      function (item) {
        return formatModelLabel(item);
      },
    );

    if (needsBotReviewChatSessionSelect) {
      needsBotReviewChatSessionSelect.value = reviewDefaults
        && reviewDefaults.needsBotReviewChatSession === "continue"
        ? "continue"
        : "new";
    }

    if (reviewDefaultsNote) {
      reviewDefaultsNote.textContent = strings.reviewDefaultsSaved
        || "The review comment text is inserted on review-state changes, and needs-bot-review launches the planning prompt immediately after save.";
    }
  }

  function renderStorageSettingsControls() {
    var disabledSystemFlagKeySet = Object.create(null);
    (storageSettings.disabledSystemFlagKeys || []).forEach(function (key) {
      disabledSystemFlagKeySet[normalizeTodoLabelKey(key)] = true;
    });
    if (settingsStorageModeSelect) {
      settingsStorageModeSelect.value = storageSettings.mode === "json" ? "json" : "sqlite";
    }
    if (settingsStorageMirrorInput) {
      settingsStorageMirrorInput.checked = storageSettings.sqliteJsonMirror !== false;
    }
    if (settingsFlagReadyInput) {
      settingsFlagReadyInput.checked = !disabledSystemFlagKeySet.ready;
    }
    if (settingsFlagNeedsBotReviewInput) {
      settingsFlagNeedsBotReviewInput.checked = !disabledSystemFlagKeySet["needs-bot-review"];
    }
    if (settingsFlagNeedsUserReviewInput) {
      settingsFlagNeedsUserReviewInput.checked = !disabledSystemFlagKeySet["needs-user-review"];
    }
    if (settingsFlagNewInput) {
      settingsFlagNewInput.checked = !disabledSystemFlagKeySet.new;
    }
    if (settingsFlagOnScheduleListInput) {
      settingsFlagOnScheduleListInput.checked = !disabledSystemFlagKeySet["on-schedule-list"];
    }
    if (settingsFlagFinalUserCheckInput) {
      settingsFlagFinalUserCheckInput.checked = !disabledSystemFlagKeySet["final-user-check"];
    }
    if (settingsStorageNote) {
      settingsStorageNote.textContent = strings.settingsStorageSaved
        || "Storage settings are repo-local. Reload after changing the backend mode.";
    }
    if (settingsVersionValue) {
      settingsVersionValue.textContent = storageSettings.appVersion || "-";
    }
    if (settingsMcpStatusValue) {
      settingsMcpStatusValue.textContent = getMcpSetupStatusLabel(storageSettings.mcpSetupStatus);
    }
    if (settingsMcpUpdatedValue) {
      settingsMcpUpdatedValue.textContent = formatSettingsTimestamp(storageSettings.lastMcpSupportUpdateAt);
    }
    if (settingsSkillsUpdatedValue) {
      settingsSkillsUpdatedValue.textContent = formatSettingsTimestamp(storageSettings.lastBundledSkillsSyncAt);
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

  function isTodoTaskDraft(task) {
    return !!(
      task &&
      Array.isArray(task.labels) &&
      task.labels.some(function (label) {
        return normalizeTodoLabelKey(label) === "from-todo-cockpit";
      })
    );
  }

  function getReadyTodoDraftCandidates() {
    var effectiveLabelFilter = activeLabelFilter;
    if (arguments.length > 0 && typeof arguments[0] === "string") {
      effectiveLabelFilter = arguments[0];
    }
    return getAllTodoCards().filter(function (todo) {
      if (!todo || todo.archived || isRecurringTodoSectionId(todo.sectionId)) {
        return false;
      }
      if (getTodoWorkflowFlag(todo) !== "ready") {
        return false;
      }
      var linkedTask = todo.taskId ? getTaskById(todo.taskId) : null;
      if (linkedTask && isTodoTaskDraft(linkedTask)) {
        return false;
      }
      if (effectiveLabelFilter) {
        return Array.isArray(todo.labels) && todo.labels.indexOf(effectiveLabelFilter) >= 0;
      }
      return true;
    });
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
      restoredLabelFilterWasExplicit = false;
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
  bindTabButtons(document, switchTab);
  runStartupRenderStep("applyBoardFilterCollapseState", applyBoardFilterCollapseState);
  runStartupRenderStep("syncAutoShowOnStartupUi", syncAutoShowOnStartupUi);
  runStartupRenderStep("syncScheduleHistoryOptions", syncScheduleHistoryOptions);
  runStartupRenderStep("updateJobsCronPreview", updateJobsCronPreview);
  runStartupRenderStep("updateJobsFriendlyVisibility", updateJobsFriendlyVisibility);
  runStartupRenderStep("syncResearchSelectors", syncResearchSelectors);
  runStartupRenderStep("hookResearchFormDirtyTracking", hookResearchFormDirtyTracking);
  runStartupRenderStep("hookEditorTabDirtyTracking", hookEditorTabDirtyTracking);
  runStartupRenderStep("renderResearchTab", renderResearchTab);
  runStartupRenderStep("renderTelegramTab", renderTelegramTab);
  runStartupRenderStep("renderCockpitBoard", renderCockpitBoard);
  runStartupRenderStep("renderExecutionDefaultsControls", renderExecutionDefaultsControls);
  runStartupRenderStep("renderReviewDefaultsControls", renderReviewDefaultsControls);
  runStartupRenderStep("renderStorageSettingsControls", renderStorageSettingsControls);
  runStartupRenderStep("renderLoggingControls", renderLoggingControls);

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


  function runStartupRenderStep(stepName, runStep) {
    try {
      runStep();
    } catch (error) {
      emitWebviewDebug("startupRenderStepFailed", {
        step: stepName,
        error: error && error.message ? String(error.message) : String(error),
      });
      var prefix = strings.webviewClientErrorPrefix || "Webview error: ";
      var detail = error && error.message ? error.message : error;
      var firstLine = String(detail || "").split(/\r?\n/)[0];
      showGlobalError(prefix + sanitizeAbsolutePaths(stepName + ": " + firstLine), {
        durationMs: 0,
      });
    }
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
    if (key === "ready" || key === "go") {
      return strings.boardFlagPresetReady || "Ready";
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
    if (key === "on-schedule-list") {
      return strings.boardFlagPresetOnScheduleList || "On Schedule List";
    }
    if (key === "final-user-check") {
      return strings.boardFlagPresetFinalUserCheck || "Final User Check";
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
    return key === "ready"
      || key === "needs-bot-review"
      || key === "needs-user-review"
      || key === "new"
      || key === "on-schedule-list"
      || key === "final-user-check";
  }

  function getTodoWorkflowFlag(card) {
    if (!card || !Array.isArray(card.flags)) {
      return "";
    }
    var workflowKeys = ["new", "needs-bot-review", "needs-user-review", "ready", "on-schedule-list", "final-user-check"];
    var seen = Object.create(null);
    var matched = [];
    card.flags.forEach(function (flag) {
      var key = normalizeTodoLabelKey(flag);
      if (key === "go") {
        key = "ready";
      }
      if (workflowKeys.indexOf(key) >= 0 && !seen[key]) {
        seen[key] = true;
        matched.push(key);
      }
    });
    return matched.length ? matched[matched.length - 1] : "";
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

  function getValidLabelColorValue(color, fallbackColor) {
    var value = String(color || "");
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
      return value;
    }
    return fallbackColor || "#4f8cff";
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
    var existingDefinition = getLabelDefinition(label);
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
    if (!existingDefinition && pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
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

    [todoTitleInput, todoDescriptionInput, todoCommentInput, todoDueInput].forEach(function (element) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("input", function () {
        syncTodoDraftFromInputs("input");
        if (element === todoCommentInput) {
          renderTodoCommentSectionState(selectedTodoId ? findTodoById(selectedTodoId) : null);
        }
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

    if (todoDetailForm) {
      todoDetailForm.addEventListener("click", function (event) {
        var templateBtn = getClosestEventTarget(event, "[data-comment-template]");
        if (!templateBtn) {
          return;
        }
        appendTextToTodoComment(String(templateBtn.getAttribute("data-comment-template") || ""));
      });
    }

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

  function padNumber(value) {
    return value < 10 ? "0" + value : String(value);
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
      case "completed": return strings.boardStatusCompleted || "Completed";
      case "rejected": return strings.boardArchiveRejected || "Rejected";
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

  function renderTodoCommentEmptyMarkup(title, body) {
    return '<div class="todo-comment-empty-state">' +
      '<div class="todo-comment-empty-title">' + escapeHtml(title) + '</div>' +
      '<div class="note">' + escapeHtml(body) + '</div>' +
      '</div>';
  }

  function renderTodoCommentDraftPreviewMarkup(commentBody) {
    return '<article class="todo-comment-card is-human-form is-user-form is-preview">' +
      '<div class="todo-comment-header">' +
      '<div class="todo-comment-heading">' +
      '<span class="todo-comment-sequence">' + escapeHtml(strings.boardCommentModeCreate || "Kickoff note") + '</span>' +
      '<span class="todo-comment-source-chip">' + escapeHtml(strings.boardCommentSourceHumanForm || "Human form") + '</span>' +
      '</div>' +
      '<div class="todo-comment-meta">' +
      '<span class="note">' + escapeHtml(strings.boardCommentPreviewPending || "Saved on create") + '</span>' +
      '</div>' +
      '</div>' +
      '<div class="note todo-comment-author">user</div>' +
      '<div class="todo-comment-body">' + escapeHtml(commentBody || "") + '</div>' +
      '<div class="todo-comment-expand-hint">' + escapeHtml(strings.boardCommentThreadCreateNote || "Preview of the kickoff note that will be saved on create.") + '</div>' +
      '</article>';
  }

  function renderTodoCommentListMarkup(comments) {
    if (!comments.length) {
      return renderTodoCommentEmptyMarkup(
        strings.boardCommentsEmpty || "No comments yet.",
        strings.boardCommentEditHint || "Add a focused update without rewriting the full description."
      );
    }
    return comments.map(function (comment, commentIndex) {
      var sourceLabel = getTodoCommentSourceLabel(comment.source || "human-form");
      var sequence = typeof comment.sequence === "number" ? comment.sequence : 1;
      var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
      var toneClass = getTodoCommentToneClass(comment);
      var userFormClass = comment.source === "human-form" && String(comment.author || "").toLowerCase() === "user"
        ? " is-user-form"
        : "";
      return '<article class="todo-comment-card' + toneClass + userFormClass + '" data-comment-index="' + escapeAttr(String(commentIndex)) + '" tabindex="0" role="button" aria-label="' + escapeAttr(strings.boardCommentOpenFull || "Open full comment") + '">' +
        '<div class="todo-comment-header">' +
        '<div class="todo-comment-heading">' +
        '<span class="todo-comment-sequence">#' + escapeHtml(String(sequence)) + '</span>' +
        '<span class="todo-comment-source-chip">' + escapeHtml(sourceLabel) + '</span>' +
        '</div>' +
        '<div class="todo-comment-meta">' +
        '<span class="note">' + escapeHtml(formatTodoDate(displayDate)) + '</span>' +
        '<button type="button" class="btn-icon todo-comment-delete-btn" data-delete-comment-index="' + escapeAttr(String(commentIndex)) + '" title="' + escapeAttr(strings.boardCommentDelete || "Delete comment") + '">&#128465;</button>' +
        '</div>' +
        '</div>' +
        '<div class="note todo-comment-author">' + escapeHtml(comment.author || "system") + '</div>' +
        '<div class="todo-comment-body">' + escapeHtml(comment.body || "") + '</div>' +
        '<div class="todo-comment-expand-hint">' + escapeHtml(strings.boardCommentOpenFull || "Open full comment") + '</div>' +
        '</article>';
    }).join("");
  }

  function renderTodoCommentSectionState(selectedTodo) {
    var isEditingTodo = !!selectedTodo;
    var isArchivedTodo = !!(selectedTodo && selectedTodo.archived);
    var todoDraft = isEditingTodo ? null : currentTodoDraft;
    var comments = isEditingTodo && Array.isArray(selectedTodo.comments) ? selectedTodo.comments : [];
    var commentDraftValue = todoCommentInput
      ? String(todoCommentInput.value || "").trim()
      : (!isEditingTodo && todoDraft ? String(todoDraft.comment || "").trim() : "");

    if (todoCommentCountBadge) {
      todoCommentCountBadge.textContent = isEditingTodo
        ? String(comments.length)
        : (commentDraftValue ? (strings.boardCommentBadgePreview || "Preview") : (strings.boardCommentBadgeDraft || "Draft"));
    }
    if (todoCommentModePill) {
      todoCommentModePill.textContent = isEditingTodo
        ? (strings.boardCommentModeEdit || "Live thread")
        : (strings.boardCommentModeCreate || "Kickoff note");
    }
    if (todoCommentContextNote) {
      todoCommentContextNote.textContent = isEditingTodo
        ? (strings.boardCommentsEditIntro || "Keep approvals, decisions, and handoff context in the thread while the main description stays stable.")
        : (strings.boardCommentsCreateIntro || "Start the thread early so context, approvals, and decisions do not get buried in the description.");
    }
    if (todoCommentComposerTitle) {
      todoCommentComposerTitle.textContent = isEditingTodo
        ? (strings.boardCommentComposerEditTitle || "Add to the thread")
        : (strings.boardCommentComposerCreateTitle || "Write the kickoff comment");
    }
    if (todoCommentComposerNote) {
      todoCommentComposerNote.textContent = isEditingTodo
        ? (strings.boardCommentEditHint || "Add a focused update without rewriting the full description.")
        : (strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.");
    }
    if (todoCommentDraftStatus) {
      if (isArchivedTodo) {
        todoCommentDraftStatus.textContent = strings.boardReadOnlyArchived || "Archived items are read-only in the editor. Use Restore on the board to reopen them.";
      } else if (isEditingTodo) {
        todoCommentDraftStatus.textContent = commentDraftValue
          ? (strings.boardCommentReadyToAdd || "Ready to append to the live thread.")
          : (strings.boardCommentEditHint || "Add a focused update without rewriting the full description.");
      } else {
        todoCommentDraftStatus.textContent = commentDraftValue
          ? (strings.boardCommentCreateReady || "This draft will be saved as the first human comment when you create the todo.")
          : (strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.");
      }
    }
    if (todoCommentThreadNote) {
      if (isEditingTodo) {
        todoCommentThreadNote.textContent = comments.length > 0
          ? (strings.boardCommentThreadEditNote || "Open any card to read the full comment or remove a thread entry.")
          : (strings.boardCommentEditHint || "Add a focused update without rewriting the full description.");
      } else {
        todoCommentThreadNote.textContent = commentDraftValue
          ? (strings.boardCommentThreadCreateNote || "Preview of the kickoff note that will be saved on create.")
          : (strings.boardCommentThreadCreateEmpty || "Start typing to preview the kickoff comment.");
      }
    }
    if (todoCommentInput) {
      todoCommentInput.placeholder = isEditingTodo
        ? (strings.boardCommentPlaceholder || "Add a comment with context, provenance, or approval notes...")
        : (strings.boardCommentCreatePlaceholder || "Capture the first decision, approval note, or handoff context for this todo...");
    }
    if (todoAddCommentBtn) {
      todoAddCommentBtn.textContent = strings.boardAddComment || "Add Comment";
      todoAddCommentBtn.hidden = !isEditingTodo;
      todoAddCommentBtn.disabled = !isEditingTodo || isArchivedTodo || !commentDraftValue;
    }
    if (!todoCommentList) {
      return;
    }
    if (isEditingTodo) {
      todoCommentList.innerHTML = renderTodoCommentListMarkup(comments);
      return;
    }
    todoCommentList.innerHTML = commentDraftValue
      ? renderTodoCommentDraftPreviewMarkup(commentDraftValue)
      : renderTodoCommentEmptyMarkup(
        strings.boardCommentBadgeDraft || "Draft",
        strings.boardCommentThreadCreateEmpty || "Start typing to preview the kickoff comment."
      );
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
    return !!(card && !card.archived && getTodoWorkflowFlag(card) === "final-user-check");
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
      if (todoCommentInput) todoCommentInput.value = isEditingTodo ? "" : (todoDraft.comment || "");
      if (todoDueInput) todoDueInput.value = isEditingTodo ? toLocalDateTimeInput(selectedTodo.dueAt) : (todoDraft.dueAt || "");
      if (todoLabelsInput) todoLabelsInput.value = isEditingTodo ? "" : (todoDraft.labelInput || "");
      if (todoLabelColorInput && !isEditingTodo && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(todoDraft.labelColor || "")) {
        todoLabelColorInput.value = todoDraft.labelColor;
      }
      currentTodoFlag = isEditingTodo
        ? (getTodoWorkflowFlag(selectedTodo) || ((selectedTodo.flags || [])[0] || ""))
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
        var workflowFlag = getTodoWorkflowFlag(selectedTodo);
        todoDetailStatus.textContent =
          (strings.boardStatusLabel || "Status") + ": " +
          getTodoStatusLabel(selectedTodo.status || "active") +
          " • " +
          (strings.boardWorkflowLabel || "Workflow") + ": " +
          getFlagDisplayName(workflowFlag || "new");
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
      todoCreateTaskBtn.disabled = !isEditingTodo || isArchivedTodo || getTodoWorkflowFlag(selectedTodo) !== "ready";
    }
    if (todoCompleteBtn) {
      todoCompleteBtn.textContent = isEditingTodo
        ? getTodoCompletionActionLabel(selectedTodo)
        : (strings.boardApproveTodo || "Approve");
      todoCompleteBtn.disabled = !isEditingTodo || isArchivedTodo;
    }
    if (todoDeleteBtn) todoDeleteBtn.disabled = !isEditingTodo || isArchivedTodo;
    if (todoUploadFilesBtn) todoUploadFilesBtn.disabled = !!isArchivedTodo;
    if (todoCommentInput) {
      todoCommentInput.disabled = !!isArchivedTodo;
    }

    var linkedTask = isEditingTodo ? getLinkedTask(selectedTodo.taskId) : null;
    if (todoLinkedTaskNote) {
      if (!isEditingTodo) {
        todoLinkedTaskNote.textContent = strings.boardTaskDraftNote || "Scheduled tasks remain separate from planning todos.";
      } else if (selectedTodo.archived) {
        todoLinkedTaskNote.textContent = strings.boardReadOnlyArchived || "Archived items are read-only.";
      } else if (getTodoWorkflowFlag(selectedTodo) === "ready") {
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
    renderTodoCommentSectionState(selectedTodo);
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
        var commentBody = todoCommentInput ? String(todoCommentInput.value || "").trim() : "";
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
          if (commentBody) {
            payload.comment = commentBody;
          }
          emitWebviewDebug("todoCreateSubmit", {
            hasComment: !!commentBody,
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
        renderTodoCommentSectionState(findTodoById(selectedTodoId));
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
        var actionType = getTodoCompletionActionType(selectedTodo);
        if (actionType === "finalizeTodo") {
          var finalizeConfirmed = typeof window.confirm === "function"
            ? window.confirm(strings.boardFinalizePrompt || "Archive this todo as completed successfully?")
            : true;
          if (!finalizeConfirmed) {
            return;
          }
        }
        vscode.postMessage({
          type: actionType,
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
          if (todoLabelColorInput) {
            todoLabelColorInput.value = getValidLabelColorValue(eEntry && eEntry.color, "#4f8cff");
          }
          selectedTodoLabelName = eEntry ? eEntry.name : eName;
          editingLabelOriginalName = eEntry ? eEntry.name : eName;
          syncTodoEditorTransientDraft();
          syncTodoLabelEditor();
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
          var definition = getLabelDefinition(name);
          editingLabelOriginalName = "";
          if (todoLabelsInput) todoLabelsInput.value = name;
          if (todoLabelColorInput) {
            todoLabelColorInput.value = getValidLabelColorValue(definition && definition.color, todoLabelColorInput.value || "#4f8cff");
          }
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
    var checkedInputs = getCheckedTaskEditorInputs();
    var oneTimeEl = document.getElementById("one-time");
    var manualSessionEl = document.getElementById("manual-session");
    var promptSourceValue = checkedInputs.promptSource
      ? String(checkedInputs.promptSource.value || "inline")
      : "inline"; // default-source
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
      scope: checkedInputs.scope ? String(checkedInputs.scope.value || "workspace") : "workspace",
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
    var isEditingTask = !!editingTaskId;
    setTaskSubmitButtonText(isEditingTask);
    setNewTaskButtonVisibility(isEditingTask);
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

  function submitWebviewForm(form) {
    if (!form) {
      return false;
    }
    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return true;
    }
    return form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  }

  function isSaveShortcutEvent(event) {
    return !!event
      && (event.ctrlKey || event.metaKey)
      && !event.altKey
      && !event.shiftKey
      && String(event.key || "").toLowerCase() === "s";
  }

  function handleGlobalSaveShortcut(event) {
    if (!isSaveShortcutEvent(event)) {
      return;
    }
    if (isTabActive("create")) {
      event.preventDefault();
      if (!pendingSubmit) {
        submitWebviewForm(taskForm);
      }
      return;
    }
    if (isTabActive("todo-edit")) {
      event.preventDefault();
      if (!todoSaveBtn || !todoSaveBtn.disabled) {
        submitWebviewForm(todoDetailForm);
      }
    }
  }

  function isTabActive(tabName) {
    var targetContent = document.getElementById(tabName + "-tab");
    return !!(targetContent && targetContent.classList.contains("active"));
  }

  // Handler for tab navigation
  function switchTab(tabName) {
    if (!isPersistedTabName(tabName)) {
      tabName = "help";
    }
    if (activeTabName) {
      captureTabScrollPosition(activeTabName);
    }
    activateSchedulerTab(document, tabName);
    activeTabName = tabName;
    if (jobsToggleSidebarBtn) {
      jobsToggleSidebarBtn.style.display = "";
    }
    if (jobsShowSidebarBtn) {
      jobsShowSidebarBtn.style.display = (tabName === "jobs" && jobsSidebarHidden) ? "inline-flex" : "none";
    }
    if (tabName === "list") {
      refreshTaskCountdowns();
    }
    persistTaskFilter();
    restoreTabScrollPosition(tabName);
    updateBoardAutoCollapseFromScroll(true);
    scheduleBoardStickyMetrics();
    maybePlayInitialHelpWarp(tabName);
  }

  function getInitialTabName() {
    if (isPersistedTabName(activeTabName)) {
      return activeTabName;
    }
    var tabName = typeof initialData.initialTab === "string"
      ? initialData.initialTab
      : "help";
    return isPersistedTabName(tabName) ? tabName : "help";
  }

  // Mirror explicit user selections into the pending-state store
  bindSelectValueChange(agentSelect, function (control) {
    pendingAgentValue = control ? String(control.value || "") : "";
    emitWebviewDebug("taskAgentChanged", { value: pendingAgentValue });
  });
  bindSelectValueChange(modelSelect, function (control) {
    pendingModelValue = control ? String(control.value || "") : "";
    emitWebviewDebug("taskModelChanged", { value: pendingModelValue });
  });
  bindSelectValueChange(templateSelect, function (control) {
    pendingTemplatePath = control ? control.value : "";
  });

  var oneTimeToggle = document.getElementById("one-time");
  bindGenericChange(oneTimeToggle, function () {
    syncRecurringChatSessionUi();
  });
  var manualSessionToggle = document.getElementById("manual-session");
  bindGenericChange(manualSessionToggle, function () {
    syncRecurringChatSessionUi();
  });

  bindTaskFilterBar(taskFilterBar, {
    syncTaskFilterButtons: syncTaskFilterButtons,
    isValidTaskFilter: isValidTaskFilter,
    setActiveTaskFilter: function (value) {
      activeTaskFilter = value;
    },
    persistTaskFilter: persistTaskFilter,
    renderTaskList: function () {
      renderTaskList(tasks);
    },
  });

  bindSelectValueChange(taskLabelFilter, function (control) {
    activeLabelFilter = control.value || "";
    restoredLabelFilterWasExplicit = false;
    persistTaskFilter();
    renderTaskList(tasks);
  });

  // Delegate click events for the prompt-source radio group
  bindPromptSourceDelegation(document, applyPromptSource);

  // Apply a cron preset (with null guard)
  bindCronPresetPair(cronPreset, cronExpression, function () {
    updateCronPreview();
  });
  bindCronPresetPair(jobsCronPreset, jobsCronInput, function () {
    updateJobsCronPreview();
    syncEditorTabLabels();
  });

  bindSelectValueChange(friendlyFrequency, function () {
    updateFriendlyVisibility();
  });

  bindSelectValueChange(jobsFriendlyFrequency, function () {
    updateJobsFriendlyVisibility();
    syncEditorTabLabels();
  });

  bindInputFeedbackClear(
    [
      telegramEnabledInput,
      telegramBotTokenInput,
      telegramChatIdInput,
      telegramMessagePrefixInput,
    ],
    clearTelegramFeedback,
  );

  bindClickAction(telegramSaveBtn, function () {
    submitTelegramForm("saveTelegramNotification");
  });
  bindClickAction(telegramTestBtn, function () {
    submitTelegramForm("testTelegramNotification");
  });
  bindClickAction(executionDefaultsSaveBtn, function () {
    vscode.postMessage({
      type: "saveExecutionDefaults",
      data: collectExecutionDefaultsFormData(),
    });
  });
  bindClickAction(reviewDefaultsSaveBtn, function () {
    vscode.postMessage({
      type: "saveReviewDefaults",
      data: collectReviewDefaultsFormData(),
    });
  });
  bindClickAction(settingsStorageSaveBtn, function () {
    vscode.postMessage({
      type: "setStorageSettings",
      data: collectStorageSettingsFormData(),
    });
  });
  bindSelectChange(settingsLogLevelSelect, function (control) {
    currentLogLevel = control.value || "info";
    debugTools.setLogLevel(currentLogLevel);
    renderLoggingControls();
    vscode.postMessage({
      type: "setLogLevel",
      logLevel: currentLogLevel,
    });
  });
  bindClickAction(settingsOpenLogFolderBtn, function () {
    vscode.postMessage({ type: "openLogFolder" });
  });

  // Certain environments skip native select events; a delegated listener keeps state consistent.
  bindDocumentValueDelegates(document, "change", {
    "friendly-frequency": function () {
      updateFriendlyVisibility();
    },
    "jobs-friendly-frequency": function () {
      updateJobsFriendlyVisibility();
    },
  });
  bindDocumentValueDelegates(document, "input", {
    "friendly-frequency": function () {
      updateFriendlyVisibility();
    },
    "jobs-friendly-frequency": function () {
      updateJobsFriendlyVisibility();
    },
  });

  bindClickAction(friendlyGenerate, function () {
    generateCronFromFriendly();
  });
  bindClickAction(jobsFriendlyGenerate, function () {
    generateJobsCronFromFriendly();
    syncEditorTabLabels();
  });

  bindOpenCronGuruButton(openGuruBtn, function () {
    return cronExpression ? cronExpression.value : "";
  }, window);
  bindOpenCronGuruButton(jobsOpenGuruBtn, function () {
    return jobsCronInput ? jobsCronInput.value : "";
  }, window);

  // Handle inline Agent and Model selection changes
  bindInlineTaskQuickUpdate(document, vscode);

  // Template picker handler (guarded against null)
  bindTemplateSelectionLoader(templateSelect, document, vscode);

  function handleTaskFormSubmit(e) {
    e.preventDefault();
    hideGlobalError();

    var formErr = clearTaskFormError();
    var runFirstEl = document.getElementById("run-first");
    var editorState = getCurrentTaskEditorState();
    var taskData = buildTaskSubmissionData({
      editorState: editorState,
      parseLabels: parseLabels,
      editingTaskId: editingTaskId,
      editingTaskEnabled: editingTaskEnabled,
      runFirstInOneMinute: runFirstEl?.checked ?? false,
    });

    if (!validateTaskSubmission({
      taskData: taskData,
      promptSourceValue: editorState.promptSource,
      formErr: formErr,
      strings: strings,
      editingTaskId: editingTaskId,
      getTaskByIdLocal: getTaskByIdLocal,
    })) {
      return;
    }

    startPendingTaskSubmit();
    postTaskSubmission(vscode, editingTaskId, taskData);
  }

  // Submit handler for the task form (with null guards)
  if (taskForm) {
    taskForm.addEventListener("submit", handleTaskFormSubmit);
  }

  // Wire up the test-run button (guarded against null)
  bindTaskTestButton(testBtn, {
    document: document,
    agentSelect: agentSelect,
    modelSelect: modelSelect,
    vscode: vscode,
  });

  // Wire up the refresh button (guarded against null)
  bindRefreshButton(refreshBtn, vscode);

  bindAutoShowStartupButton(autoShowStartupBtn, vscode);

  bindRestoreHistoryButton(restoreHistoryBtn, {
    scheduleHistorySelect: scheduleHistorySelect,
    scheduleHistory: scheduleHistory,
    strings: strings,
    formatHistoryLabel: formatHistoryLabel,
    window: window,
    vscode: vscode,
  });

  function handleResearchToolbarAction(actionId) {
    if (actionId === "research-new-btn") {
      isCreatingResearchProfile = true;
      selectedResearchId = "";
      selectedResearchRunId = activeResearchRun && activeResearchRun.id
        ? activeResearchRun.id
        : selectedResearchRunId;
      resetResearchForm(null);
      renderResearchTab();
      if (researchNameInput && typeof researchNameInput.focus === "function") {
        researchNameInput.focus();
      }
      return true;
    }

    if (actionId === "research-load-autoagent-example-btn") {
      resetResearchForm(getAutoAgentResearchExampleProfile());
      researchFormDirty = true;
      renderResearchTab();
      if (researchNameInput && typeof researchNameInput.focus === "function") {
        researchNameInput.focus();
      }
      return true;
    }

    return false;
  }

  function handleResearchAction(actionId) {
    if (handleResearchToolbarAction(actionId)) {
      return true;
    }

    if (actionId === "research-save-btn") {
      var data = collectResearchFormData();
      var errorMessage = validateResearchFormData(data);
      if (errorMessage) {
        showResearchFormError(errorMessage);
        return true;
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
      return true;
    }

    if (actionId === "research-duplicate-btn") {
      if (!selectedResearchId) return true;
      vscode.postMessage({
        type: "duplicateResearchProfile",
        researchId: selectedResearchId,
      });
      return true;
    }

    if (actionId === "research-delete-btn") {
      if (!selectedResearchId) return true;
      vscode.postMessage({
        type: "deleteResearchProfile",
        researchId: selectedResearchId,
      });
      return true;
    }

    if (actionId === "research-start-btn") {
      if (!selectedResearchId) return true;
      vscode.postMessage({
        type: "startResearchRun",
        researchId: selectedResearchId,
      });
      return true;
    }

    if (actionId === "research-stop-btn") {
      vscode.postMessage({ type: "stopResearchRun" });
      return true;
    }

    return false;
  }

  function selectResearchProfile(researchId) {
    selectedResearchId = researchId || "";
    isCreatingResearchProfile = !selectedResearchId;
    var profile = getSelectedResearchProfile();
    resetResearchForm(profile || null);
    renderResearchTab();
    return !!profile;
  }

  function selectResearchRun(runId) {
    selectedResearchRunId = runId || "";
    persistTaskFilter();
    renderResearchTab();
  }

  var jobsEmptyNewBtn = document.getElementById("jobs-empty-new-btn");
  bindJobToolbarButtons({
    jobsNewFolderBtn: jobsNewFolderBtn,
    jobsRenameFolderBtn: jobsRenameFolderBtn,
    jobsDeleteFolderBtn: jobsDeleteFolderBtn,
    jobsNewJobBtn: jobsNewJobBtn,
    jobsEmptyNewBtn: jobsEmptyNewBtn,
    jobsBackBtn: jobsBackBtn,
    jobsOpenEditorBtn: jobsOpenEditorBtn,
    jobsSaveBtn: jobsSaveBtn,
    jobsSaveDeckBtn: jobsSaveDeckBtn,
    jobsDuplicateBtn: jobsDuplicateBtn,
    jobsPauseBtn: jobsPauseBtn,
    jobsCompileBtn: jobsCompileBtn,
    jobsStatusPill: jobsStatusPill,
    jobsToggleSidebarBtn: jobsToggleSidebarBtn,
    jobsShowSidebarBtn: jobsShowSidebarBtn,
    jobsDeleteBtn: jobsDeleteBtn,
    jobsAttachBtn: jobsAttachBtn,
    jobsExistingTaskSelect: jobsExistingTaskSelect,
    jobsExistingWindowInput: jobsExistingWindowInput,
    jobsCreateStepBtn: jobsCreateStepBtn,
    jobsStepNameInput: jobsStepNameInput,
    jobsStepPromptInput: jobsStepPromptInput,
    jobsStepWindowInput: jobsStepWindowInput,
    jobsStepAgentSelect: jobsStepAgentSelect,
    jobsStepModelSelect: jobsStepModelSelect,
    jobsStepLabelsInput: jobsStepLabelsInput,
    jobsCreatePauseBtn: jobsCreatePauseBtn,
    jobsPauseNameInput: jobsPauseNameInput,
    defaultPauseTitle: strings.jobsPauseDefaultTitle || "Manual review",
    getSelectedJobFolderId: function () {
      return selectedJobFolderId;
    },
    getSelectedJobId: function () {
      return selectedJobId;
    },
    setCreatingJob: function (value) {
      isCreatingJob = value;
    },
    syncEditorTabLabels: syncEditorTabLabels,
    switchTab: switchTab,
    openJobEditor: openJobEditor,
    submitJobEditor: submitJobEditor,
    toggleJobsSidebar: function () {
      jobsSidebarHidden = !jobsSidebarHidden;
      applyJobsSidebarState();
      persistTaskFilter();
    },
    showJobsSidebar: function () {
      jobsSidebarHidden = false;
      applyJobsSidebarState();
      persistTaskFilter();
    },
    getJobById: getJobById,
    parseLabels: parseLabels,
    vscode: vscode,
  });

  document.addEventListener("click", function handleBoardClick(e) {
    var target = e && e.target;
    var researchActionButton = getClosestEventTarget(
      e,
      "#research-new-btn, #research-load-autoagent-example-btn, #research-save-btn, #research-duplicate-btn, #research-delete-btn, #research-start-btn, #research-stop-btn",
    );
    if (researchActionButton) {
      e.preventDefault();
      e.stopPropagation();
      if (handleResearchAction(researchActionButton.id || "")) {
        return;
      }
    }
    if (handleSchedulerDetailClick(e, {
      getClosestEventTarget: getClosestEventTarget,
      researchProfileList: researchProfileList,
      researchRunList: researchRunList,
      selectResearchProfile: selectResearchProfile,
      selectResearchRun: selectResearchRun,
      jobsFolderList: jobsFolderList,
      jobsList: jobsList,
      setSelectedJobFolderId: function (value) {
        selectedJobFolderId = value;
      },
      setSelectedJobId: function (value) {
        selectedJobId = value;
      },
      getSelectedJobId: function () {
        return selectedJobId;
      },
      persistTaskFilter: persistTaskFilter,
      renderJobsTab: renderJobsTab,
      openJobEditor: openJobEditor,
      editTask: typeof window.editTask === "function" ? window.editTask : undefined,
      runTask: typeof window.runTask === "function" ? window.runTask : undefined,
      getJobById: getJobById,
      vscode: vscode,
    })) {
      return;
    }
  });

  bindJobNodeWindowChange(document, {
    getSelectedJobId: function () {
      return selectedJobId;
    },
    vscode: vscode,
  });

  bindJobDragAndDrop(document, {
    jobsList: jobsList,
    getDraggedJobId: function () {
      return draggedJobId;
    },
    setDraggedJobId: function (value) {
      draggedJobId = value;
    },
    getDraggedJobNodeId: function () {
      return draggedJobNodeId;
    },
    setDraggedJobNodeId: function (value) {
      draggedJobNodeId = value;
    },
    getSelectedJobId: function () {
      return selectedJobId;
    },
    getJobById: getJobById,
    vscode: vscode,
  });

  // Re-fetch templates from the Create tab
  bindTemplateRefreshButton(templateRefreshBtn, {
    templateSelect: templateSelect,
    document: document,
    vscode: vscode,
  });

  bindClickAction(insertSkillBtn, function () {
    insertSelectedSkillReference();
  });

  bindUtilityActionButtons(vscode, {
    setupMcp: setupMcpBtn,
    syncBundledSkills: syncBundledSkillsBtn,
    importStorageFromJson: importStorageFromJsonBtn,
    exportStorageToJson: exportStorageToJsonBtn,
  });

  bindLanguageSelectors(
    helpLanguageSelect,
    settingsLanguageSelect,
    vscode,
    typeof initialData.languageSetting === "string" && initialData.languageSetting
      ? initialData.languageSetting
      : "auto",
  );

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

  // Single delegated listener for all task action buttons
  function resolveActionTarget(node) {
    var current = node && node.nodeType === 3 ? node.parentElement : node;
    while (current && current !== document.body) {
      var hasAction = current.hasAttribute && current.hasAttribute("data-action");
      var hasIdentifier = hasAction && (
        current.hasAttribute("data-id") ||
        current.hasAttribute("data-task-id") ||
        current.hasAttribute("data-job-id") ||
        current.hasAttribute("data-profile-id")
      );
      if (hasIdentifier) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function normalizeWorkspacePathValue(rawPath) {
    if (!rawPath) return "";
    var normalized = String(rawPath).replace(/\\/g, "/");
    if (normalized === "/") return "/";
    normalized = normalized.replace(/\/+$/, "");
    if (!normalized) return "/";
    return caseInsensitivePaths ? normalized.toLowerCase() : normalized;
  }

  function getPathLeafName(rawPath) {
    if (!rawPath) return "";
    var normalized = String(rawPath).replace(/[/\\]+$/, "");
    var segments = normalized.split(/[/\\]+/);
    return segments.length ? segments[segments.length - 1] || "" : normalized;
  }

  function getTaskNextRunPresentation(task) {
    var nextRunDate = task && task.nextRun ? new Date(task.nextRun) : null;
    var hasNextRun = nextRunDate && !isNaN(nextRunDate.getTime());
    return {
      millis: hasNextRun ? nextRunDate.getTime() : 0,
      text: hasNextRun ? nextRunDate.toLocaleString(locale) : strings.labelNever,
    };
  }

  function getTaskScopePresentation(task) {
    var scopeValue = task && task.scope ? task.scope : "workspace";
    var workspacePath = scopeValue === "workspace" ? task.workspacePath || "" : "";
    var workspaceName = workspacePath ? getPathLeafName(workspacePath) : "";
    var inCurrentWorkspace = scopeValue !== "workspace"
      ? true
      : !!workspacePath && (workspacePaths || []).some(function (candidatePath) {
        return normalizeWorkspacePathValue(candidatePath) === normalizeWorkspacePathValue(workspacePath);
      });
    var scopeLabel = scopeValue === "global"
      ? (strings.labelScopeGlobal || "")
      : (strings.labelScopeWorkspace || "");
    var scopeText = scopeValue === "global"
      ? ("🌐 " + escapeHtml(scopeLabel))
      : "📁 " + escapeHtml(scopeLabel) + (workspaceName ? " • " + escapeHtml(workspaceName) : "");
    if (scopeValue === "workspace") {
      var workspaceBadgeText = inCurrentWorkspace
        ? strings.labelThisWorkspaceShort || ""
        : strings.labelOtherWorkspaceShort || "";
      scopeText += " • " + escapeHtml(workspaceBadgeText);
    }
    return {
      inThisWorkspace: inCurrentWorkspace,
      scopeInfo: scopeText,
      scopeValue: scopeValue,
    };
  }

  function appendTaskActionIcon(markup, options) {
    return (
      markup +
      '<button class="' + options.className + '" data-action="' + options.action + '" data-id="' +
      options.taskId +
      '" title="' +
      escapeAttr(options.title) +
      '">' +
      options.icon +
      "</button>"
    );
  }

  function renderEmptyTaskState() {
    return '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>";
  }

  function renderTaskSectionShell(sectionKey, title, countMarkup, bodyMarkup) {
    var isCollapsed = taskSectionCollapseState[sectionKey] === true;
    var toggleTitle = isCollapsed
      ? (strings.boardSectionExpand || "Expand section")
      : (strings.boardSectionCollapse || "Collapse section");
    return (
      '<div class="task-section' + (isCollapsed ? " is-collapsed" : "") + '" data-task-section="' + escapeAttr(sectionKey) + '">' +
      '<div class="task-section-title">' +
      '<button type="button" class="task-section-toggle" data-task-section-toggle="' + escapeAttr(sectionKey) + '" aria-expanded="' + (isCollapsed ? "false" : "true") + '" title="' + escapeAttr(toggleTitle) + '">&#9660;</button>' +
      "<span class=\"cell\">" +
      escapeHtml(title) +
      "</span>" +
      countMarkup +
      "</div>" +
      '<div class="task-section-body"><div class="task-section-body-inner">' +
      bodyMarkup +
      "</div></div>" +
      "</div>"
    );
  }

  function getTaskActionHandlers() {
    var actionEntries = [
      ["toggle", window.toggleTask],
      ["run", window.runTask],
      ["edit", window.editTask],
      ["copy", window.copyPrompt],
      ["duplicate", window.duplicateTask],
      ["move", window.moveTaskToCurrentWorkspace],
      ["delete", window.deleteTask],
    ];
    return actionEntries.reduce(function (handlers, entry) {
      handlers[entry[0]] = entry[1];
      return handlers;
    }, {});
  }

  function getTaskStatusPresentation(task) {
    var enabled = task.enabled || false;
    return {
      enabled: enabled,
      statusClass: enabled ? "enabled" : "disabled",
      statusText: enabled ? strings.labelEnabled : strings.labelDisabled,
      toggleIcon: enabled ? "⏸️" : "▶️",
      toggleTitle: enabled ? strings.actionDisable : strings.actionEnable,
    };
  }

  function renderTaskLabelBadges(task) {
    return getEffectiveLabels(task)
      .map(function (label) {
        return '<span class="task-badge label">' + escapeHtml(label) + "</span>";
      })
      .join("");
  }

  function renderTaskErrorMarkup(lastErrorText, lastErrorAt) {
    if (!lastErrorText) {
      return "";
    }
    return (
      '<div class="task-prompt" style="color: var(--vscode-errorForeground);">' +
      "Last error" +
      (lastErrorAt ? " (" + escapeHtml(lastErrorAt) + ")" : "") +
      ": " +
      escapeHtml(lastErrorText) +
      "</div>"
    );
  }

  function showSuccessToast(messageText) {
    var toast = document.getElementById("success-toast");
    if (!toast) {
      return;
    }
    var prefix = strings.webviewSuccessPrefix || "\u2714 ";
    toast.textContent = prefix + messageText;
    updateToastVisibility(toast, "block", "1");
    scheduleToastVisibility(toast, "0", 3000);
    scheduleToastHide(toast, 3500);
  }

  function setSubmitIdleState() {
    pendingSubmit = false;
    if (submitBtn) {
      submitBtn.disabled = false;
    }
  }

  function updateToastVisibility(toast, display, opacity) {
    toast.style.display = display;
    toast.style.opacity = opacity;
  }

  function scheduleToastVisibility(toast, opacity, delayMs) {
    setTimeout(function () {
      toast.style.opacity = opacity;
    }, delayMs);
  }

  function scheduleToastHide(toast, delayMs) {
    setTimeout(function () {
      updateToastVisibility(toast, "none", "1");
    }, delayMs);
  }

  function scrollSelectorIntoView(selector, focusWhenPresent) {
    var element = selector ? document.querySelector(selector) : null;
    if (!element) {
      return;
    }
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (focusWhenPresent && typeof element.focus === "function") {
      element.focus();
    }
  }

  function getPromptTemplateSourceValue() {
    var sourceElement = document.querySelector('input[name="prompt-source"]:checked');
    return sourceElement ? sourceElement.value : "inline";
  }

  function getCheckedTaskEditorInputs() {
    return {
      promptSource: document.querySelector('input[name="prompt-source"]:checked'),
      scope: document.querySelector('input[name="scope"]:checked'),
    };
  }

  function renderOneTimeBadge(task, taskIdEscaped) {
    if (task.oneTime !== true) {
      return "";
    }
    return (
      '<span class="task-badge clickable" data-action="toggle" data-id="' +
      taskIdEscaped +
      '">' +
      escapeHtml(strings.labelOneTime || "One-time") +
      "</span>"
    );
  }

  function renderManualSessionBadge(task) {
    if (task.oneTime === true || task.manualSession !== true) {
      return "";
    }
    var label = strings.labelManualSession || "Manual session";
    return '<span class="task-badge" title="' + escapeAttr(label) + '">' + escapeHtml(label) + "</span>";
  }

  function renderChatSessionBadge(task) {
    if (task.oneTime === true) {
      return "";
    }
    var label = strings.labelChatSession || "Recurring chat session";
    var badgeText = task.chatSession === "continue"
      ? strings.labelChatSessionBadgeContinue || "Chat: Continue"
      : strings.labelChatSessionBadgeNew || "Chat: New";
    return '<span class="task-badge" title="' + escapeAttr(label) + '">' + escapeHtml(badgeText) + "</span>";
  }

  function sortVisibleSectionsForRecurringTasks() {
    if (filters.showRecurringTasks !== true) {
      return;
    }
    visibleSections.sort(function (left, right) {
      var leftRecurring = isRecurringTodoSectionId(left.id);
      var rightRecurring = isRecurringTodoSectionId(right.id);
      if (leftRecurring === rightRecurring) {
        return 0;
      }
      return leftRecurring ? -1 : 1;
    });
  }

  function buildTaskActionMarkup(taskIdEscaped, toggleTitle, toggleIcon, scopeValue, inThisWorkspace) {
    var actionsHtml = buildBaseTaskActionsMarkup({
      taskId: taskIdEscaped,
      toggleTitle: toggleTitle,
      toggleIcon: toggleIcon,
      strings: strings,
      escapeAttr: escapeAttr,
    });
    if (scopeValue === "workspace" && !inThisWorkspace) {
      actionsHtml = appendTaskActionIcon(actionsHtml, {
        className: "btn-secondary btn-icon",
        action: "move",
        taskId: taskIdEscaped,
        title: strings.actionMoveToCurrentWorkspace || "",
        icon: "📌",
      });
      sortVisibleSectionsForRecurringTasks();
    }
    if (scopeValue === "global" || inThisWorkspace) {
      actionsHtml = appendTaskActionIcon(actionsHtml, {
        className: "btn-danger btn-icon",
        action: "delete",
        taskId: taskIdEscaped,
        title: strings.actionDelete,
        icon: "🗑️",
      });
    }
    return actionsHtml;
  }

  function setPromptTextValue(content) {
    var promptTextEl = document.getElementById("prompt-text");
    if (promptTextEl) {
      promptTextEl.value = content;
    }
  }

  function setTaskSubmitButtonText(editing) {
    if (!submitBtn) {
      return;
    }
    var label = editing ? strings.actionSave : strings.actionCreate;
    if (label) {
      submitBtn.textContent = label;
    }
  }

  function setNewTaskButtonVisibility(isVisible) {
    if (newTaskBtn) {
      newTaskBtn.style.display = isVisible ? "inline-flex" : "none";
    }
  }

  function normalizeIncomingTaskList(nextTasks) {
    if (Array.isArray(nextTasks)) {
      tasks = nextTasks.filter(Boolean);
    }
    return Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  }

  function updateConnectedTaskListElement() {
    if (!taskList || !taskList.isConnected) {
      taskList = document.getElementById("task-list");
    }
    return taskList;
  }

  function filterTaskItemsByLabel(taskItems, labelFilter) {
    if (!labelFilter) {
      return taskItems;
    }
    return taskItems.filter(function (task) {
      return getEffectiveLabels(task).indexOf(labelFilter) !== -1;
    });
  }

  function filterTaskItemsByActiveLabel(taskItems) {
    return filterTaskItemsByLabel(taskItems, activeLabelFilter);
  }

  function hasVisibleTasksForFilter(taskItems, filterValue) {
    if (!Array.isArray(taskItems) || taskItems.length === 0) {
      return false;
    }

    return taskItems.some(function (task) {
      if (!task || !task.id) {
        return false;
      }
      if (filterValue === "manual") {
        return task.manualSession === true;
      }
      if (filterValue === "recurring") {
        return task.oneTime !== true && !task.jobId && task.manualSession !== true;
      }
      if (filterValue === "one-time") {
        return task.oneTime === true;
      }
      return true;
    });
  }

  function recoverTaskFilterIfRestoredViewIsEmpty(taskItems) {
    if (!restoredTaskFilterWasExplicit || activeTaskFilter === "all") {
      return taskItems;
    }
    if (!Array.isArray(taskItems) || taskItems.length === 0) {
      return taskItems;
    }
    if (hasVisibleTasksForFilter(taskItems, activeTaskFilter)) {
      return taskItems;
    }

    activeTaskFilter = "all";
    restoredTaskFilterWasExplicit = false;
    syncTaskFilterButtons();
    persistTaskFilter();
    return taskItems;
  }

  function recoverLabelFilterIfRestoredViewIsEmpty(taskItems) {
    var filteredTaskItems;
    if (!activeLabelFilter) {
      return taskItems;
    }

    filteredTaskItems = filterTaskItemsByLabel(taskItems, activeLabelFilter);
    if (!restoredLabelFilterWasExplicit) {
      return filteredTaskItems;
    }

    if (filteredTaskItems.length > 0 || getReadyTodoDraftCandidates(activeLabelFilter).length > 0) {
      return filteredTaskItems;
    }

    if ((!Array.isArray(taskItems) || taskItems.length === 0) && getReadyTodoDraftCandidates("").length === 0) {
      return filteredTaskItems;
    }

    activeLabelFilter = "";
    restoredLabelFilterWasExplicit = false;
    if (taskLabelFilter) {
      taskLabelFilter.value = "";
    }
    persistTaskFilter();
    return taskItems;
  }

  function getTaskPromptPreview(promptText) {
    return promptText.length > 100
      ? `${promptText.substring(0, 100)}…`
      : promptText;
  }

  function getTaskCardClassName(enabled, scopeValue, inThisWorkspace) {
    var classNames = ["task-card"];
    if (!enabled) {
      classNames.push("disabled");
    }
    if (scopeValue === "workspace" && !inThisWorkspace) {
      classNames.push("other-workspace");
    }
    return classNames.join(" ");
  }

  function renderTaskStatusMarkup(taskIdEscaped, statusClass, statusText) {
    var statusParts = [
      '<span class="task-status ',
      statusClass,
      '" data-action="toggle" data-id="',
      taskIdEscaped,
      '">',
      escapeHtml(statusText),
      "</span>",
    ];
    return statusParts.join("");
  }

  function renderTaskHeaderBadgesMarkup(options) {
    var badgesHtml =
      options.manualSessionBadgeHtml +
      options.chatSessionBadgeHtml +
      options.oneTimeBadgeHtml;
    if (!badgesHtml) {
      return "";
    }
    return '<div class="task-badges task-badges-inline">' + badgesHtml + "</div>";
  }

  function renderTaskHeaderMarkup(options) {
    return (
      '<div class="task-header" role="group">' +
      '<div class="task-header-main">' +
      '<div class="task-title-row">' +
      '<span class="task-name clickable" role="button" data-action="toggle" data-id="' +
      options.taskId +
      '">' +
      options.taskName +
      "</span>" +
      renderTaskStatusMarkup(
        options.taskId,
        options.statusClass,
        options.statusText,
      ) +
      '</div>' +
      renderTaskHeaderBadgesMarkup(options) +
      "</div>" +
      "</div>"
    );
  }

  function renderTaskMetaPill(className, contentHtml) {
    return '<span class="task-meta-pill ' + className + '">' + contentHtml + '</span>';
  }

  function renderTaskTimingMarkup(enabled, cronSummary, nextRunPresentation, scopeInfo) {
    var countdownMarkup =
      '<span class="task-next-run-countdown" data-enabled="' +
      (enabled ? "true" : "false") +
      '" data-next-run-ms="' +
      escapeAttr(nextRunPresentation.millis > 0 ? String(nextRunPresentation.millis) : "") +
      '"></span>';
    var nextRunMarkup = renderTaskMetaPill(
      "task-meta-pill-next-run",
      escapeHtml(strings.labelNextRun) + /* next-run label */
      ': <span class="task-next-run-label">' +
      escapeHtml(nextRunPresentation.text) +
      "</span>" +
      countdownMarkup,
    );
    return (
      '<div class="task-meta-strip">' +
      renderTaskMetaPill(
        "task-meta-pill-cron",
        "⏰ " + escapeHtml(cronSummary),
      ) +
      nextRunMarkup +
      renderTaskScopeMarkup(scopeInfo) +
      "</div>"
    );
  }

  function renderTaskScopeMarkup(scopeInfo) {
    return renderTaskMetaPill("task-meta-pill-scope", scopeInfo);
  }

  function renderTaskPromptMarkup(promptPreview) {
    if (!promptPreview) {
      return "";
    }
    return '<div class="task-prompt">' + escapeHtml(promptPreview) + '</div>';
  }

  function renderTaskCardMarkup(options) {
    return (
      '<div class="' +
      getTaskCardClassName(
        options.enabled,
        options.scopeValue,
        options.inThisWorkspace,
      ) +
      '" data-id="' +
      options.taskId +
      '">' +
      '<div class="task-card-top">' +
      renderTaskHeaderMarkup(options) +
      renderTaskTimingMarkup(
        options.enabled,
        options.cronSummary,
        options.nextRunPresentation,
        options.scopeInfo,
      ) +
      '<div class="task-info task-info-compact"><span>Cron: ' + options.cronText + '</span></div>' +
      "</div>" +
      (options.labelBadgesHtml
        ? '<div class="task-badges task-badges-labels">' + options.labelBadgesHtml + "</div>"
        : "") +
      renderTaskPromptMarkup(options.promptPreview) +
      renderTaskErrorMarkup(options.lastErrorText, options.lastErrorAt) +
      '<div class="task-card-footer">' +
      options.configRow +
      '<div class="task-actions" role="toolbar">' +
      options.actionsHtml +
      "</div>" +
      "</div>" +
      "</div>"
    );
  }

  function switchToListView(successMessage) {
    setSubmitIdleState();
    hideGlobalError();
    resetForm();
    switchTab("list");
    if (successMessage) {
      showSuccessToast(successMessage);
    }
  }

  function focusJobView(folderId, jobId) {
    selectedJobFolderId = typeof folderId === "string" ? folderId : "";
    isCreatingJob = true;
    selectedJobId = "";
    persistTaskFilter();
    renderJobsTab();
    switchTab("jobs");
    setTimeout(function () {
      scrollSelectorIntoView(
        jobId ? '[data-job-id="' + jobId + '"]' : "",
        false,
      );
    }, 50);
  }

  function focusResearchProfileView(researchId) {
    switchTab("research");
    if (researchId) {
      selectResearchProfile(researchId);
    } else {
      isCreatingResearchProfile = true;
      selectedResearchId = "";
      resetResearchForm(null);
      renderResearchTab();
    }
    setTimeout(function () {
      scrollSelectorIntoView(
        researchId ? '[data-research-id="' + researchId + '"]' : "#research-name",
        !researchId,
      );
    }, 50);
  }

  function focusTaskView(taskId) {
    switchTab("list");
    setTimeout(function () {
      scrollTaskCardIntoView(taskId);
    }, 100);
  }

  function focusResearchRunView(runId) {
    switchTab("research");
    if (runId) {
      selectResearchRun(runId);
    }
    setTimeout(function () {
      scrollSelectorIntoView(runId ? '[data-run-id="' + runId + '"]' : "", false);
    }, 50);
  }

  function syncPromptTemplateOptions(templates) {
    promptTemplates = Array.isArray(templates) ? templates : [];
    pendingTemplatePath = syncPromptTemplatesFromMessage({
      promptTemplates: promptTemplates,
      pendingTemplatePath: pendingTemplatePath,
      templateSelect: templateSelect,
      templateSelectGroup: templateSelectGroup,
      currentSource: getPromptTemplateSourceValue(),
      strings: strings,
      escapeHtml: escapeHtml,
      escapeAttr: escapeAttr,
    });
  }

  function showWebviewClientError(error) {
    var prefix = strings.webviewClientErrorPrefix || "";
    var rawError = error && error.message ? error.message : error;
    var singleLineError = String(rawError).split(/\r?\n/)[0];
    showGlobalError(prefix + sanitizeAbsolutePaths(singleLineError));
    setSubmitIdleState();
  }

  document.addEventListener("click", function handleListClick(e) {
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

    var readyTodoCreateTarget = getClosestEventTarget(e, "[data-ready-todo-create]");
    if (readyTodoCreateTarget) {
      if (!taskList || !taskList.isConnected) {
        taskList = document.getElementById("task-list");
      }
      if (taskList && taskList.contains(readyTodoCreateTarget)) {
        e.preventDefault();
        var readyTodoId = readyTodoCreateTarget.getAttribute("data-ready-todo-create");
        if (readyTodoId) {
          vscode.postMessage({ type: "createTaskFromTodo", todoId: readyTodoId });
        }
        return;
      }
    }

    if (handleTaskListClick({
      event: e,
      taskList: taskList,
      getTaskList: function () {
        taskList = document.getElementById("task-list");
        return taskList;
      },
      getClosestEventTarget: getClosestEventTarget,
      resolveActionTarget: resolveActionTarget,
      openTodoEditor: openTodoEditor,
      actionHandlers: getTaskActionHandlers(),
    })) {
      return;
    }
  });

  // Render task list
  function renderTaskList(nextTasks) {
    var taskItems = normalizeIncomingTaskList(nextTasks);
    taskList = updateConnectedTaskListElement();
    if (!taskList) return;

    taskItems = sortTasksByNextRun(taskItems);
    taskItems = recoverTaskFilterIfRestoredViewIsEmpty(taskItems);
    taskItems = recoverLabelFilterIfRestoredViewIsEmpty(taskItems);
    var renderedTasks = "";

    function renderTaskCard(task) {
      if (!task || !task.id) {
        return "";
      }

      var statusState = getTaskStatusPresentation(task);
      var enabled = statusState.enabled;
      var statusClass = statusState.statusClass;
      var statusText = statusState.statusText;
      var toggleIcon = statusState.toggleIcon;
      var toggleTitle = statusState.toggleTitle;
      var nextRunPresentation = getTaskNextRunPresentation(task);
      var promptText = typeof task.prompt === "string" ? task.prompt : "";
      var promptPreview = getTaskPromptPreview(promptText);
      var lastErrorText = typeof task.lastError === "string" ? task.lastError : "";
      var lastErrorAtDate = task.lastErrorAt ? new Date(task.lastErrorAt) : null;
      var lastErrorAt =
        lastErrorAtDate && !isNaN(lastErrorAtDate.getTime())
          ? lastErrorAtDate.toLocaleString(locale)
          : "";
      var cronText = escapeHtml(task.cronExpression || "");
      var cronSummary = getCronSummary(task.cronExpression || "");
      var taskName = escapeHtml(task.name || "");

      var scopeState = getTaskScopePresentation(task);
      var scopeValue = scopeState.scopeValue;
      var inThisWorkspace = scopeState.inThisWorkspace;
      var scopeInfo = scopeState.scopeInfo;
      var taskIdEscaped = escapeAttr(task.id || "");
      var oneTimeBadgeHtml = renderOneTimeBadge(task, taskIdEscaped);
      var manualSessionBadgeHtml = renderManualSessionBadge(task);
      var chatSessionBadgeHtml = renderChatSessionBadge(task);
      var labelBadgesHtml = renderTaskLabelBadges(task);
      var configRow = buildTaskConfigRowMarkup({
        task: task,
        taskId: taskIdEscaped,
        agents: agents,
        models: models,
        executionDefaults: executionDefaults,
        strings: strings,
        escapeAttr: escapeAttr,
        escapeHtml: escapeHtml,
        formatModelLabel: formatModelLabel,
      });

      var actionsHtml = buildTaskActionMarkup(
        taskIdEscaped,
        toggleTitle,
        toggleIcon,
        scopeValue,
        inThisWorkspace,
      );

      return renderTaskCardMarkup({
        actionsHtml: actionsHtml,
        chatSessionBadgeHtml: chatSessionBadgeHtml,
        configRow: configRow,
        cronSummary: cronSummary,
        cronText: cronText,
        enabled: enabled,
        inThisWorkspace: inThisWorkspace,
        labelBadgesHtml: labelBadgesHtml,
        lastErrorAt: lastErrorAt,
        lastErrorText: lastErrorText,
        manualSessionBadgeHtml: manualSessionBadgeHtml,
        nextRunPresentation: nextRunPresentation,
        oneTimeBadgeHtml: oneTimeBadgeHtml,
        promptPreview: promptPreview,
        scopeInfo: scopeInfo,
        scopeValue: scopeValue,
        statusClass: statusClass,
        statusText: statusText,
        taskId: taskIdEscaped,
        taskName: taskName,
      });
    }

    function renderTaskSection(sectionKey, title, items) {
      var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
      if (!listHtml) {
        listHtml = renderEmptyTaskState();
      }
      return renderTaskSectionShell(
        sectionKey,
        title,
        "<span>" + String(items.length) + "</span>",
        listHtml,
      );
    }

    function renderTaskSectionContent(sectionKey, title, contentHtml, itemCount) {
      return renderTaskSectionShell(
        sectionKey,
        title,
        '<span class="task-section-count">' + String(itemCount) + "</span>",
        contentHtml,
      );
    }

    function renderTaskSubsection(title, items) {
      var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
      if (!listHtml) {
        listHtml = renderEmptyTaskState();
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

    function isJobTask(task) {
      return !!(task && task.jobId);
    }

    function renderReadyTodoDraftCandidateCard(todo) {
      if (!todo) {
        return "";
      }

      var title = escapeHtml(todo.title || "Untitled Todo");
      var description = getTodoDescriptionPreview(todo.description || "") || (strings.boardDescriptionPreviewEmpty || "No description yet.");
      var priority = escapeHtml(getTodoPriorityLabel(todo.priority || "none"));
      var dueText = todo.dueAt
        ? renderTaskMetaPill(
          "task-meta-pill-due",
          escapeHtml(strings.boardDueLabel || "Due") +
          ': ' +
          escapeHtml(formatTodoDate(todo.dueAt)),
        )
        : "";
      var labelBadgesHtml = Array.isArray(todo.labels)
        ? todo.labels.slice(0, 6).map(function (label) {
          return '<span class="task-badge label">' + escapeHtml(label) + '</span>';
        }).join("")
        : "";

      return (
        '<div class="task-card todo-draft-candidate" data-ready-todo-id="' +
        escapeAttr(todo.id || "") +
        '">' +
        '<div class="task-card-top">' +
        '<div class="task-header" role="banner">' +
        '<div class="task-header-main">' +
        '<div class="task-title-row">' +
        '<span class="task-name">' + title + '</span>' +
        '</div>' +
        '<span class="task-status enabled">' + escapeHtml(strings.boardFlagPresetReady || "Ready") + '</span>' +
        '</div>' +
        '<div class="task-badges task-badges-inline"><span class="task-badge">Ready Todo</span></div>' +
        '</div>' +
        '<div class="task-meta-strip">' +
        renderTaskMetaPill(
          "task-meta-pill-workflow",
          escapeHtml(strings.boardWorkflowLabel || "Workflow") + ': ' + escapeHtml(strings.boardFlagPresetReady || "Ready"),
        ) +
        renderTaskMetaPill("task-meta-pill-priority", 'Priority: ' + priority) +
        dueText +
        '</div>' +
        '</div>' +
        (labelBadgesHtml ? '<div class="task-badges task-badges-labels">' + labelBadgesHtml + '</div>' : '') +
        renderTaskPromptMarkup(description) +
        '<div class="task-card-footer">' +
        '<div class="task-actions" aria-label="actions">' +
        '<button class="btn-secondary" data-ready-todo-open="' + escapeAttr(todo.id || "") + '">Open Todo</button>' +
        '<button class="btn-primary" data-ready-todo-create="' + escapeAttr(todo.id || "") + '">Create Draft</button>' +
        '</div>' +
        '</div>' +
        '</div>'
      );
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
      return isOneTime && !isJobTask(task) && isTodoTaskDraft(task) && task.enabled === false;
    });
    var readyTodoDraftCandidates = getReadyTodoDraftCandidates();
    var oneTimeTasks = taskItems.filter(function (task) {
      if (!task) return false;
      var isOneTime = task.oneTime === true || (task.id && task.id.indexOf("exec-") === 0);
      return isOneTime && !isJobTask(task) && (!isTodoTaskDraft(task) || task.enabled !== false);
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
      var readyTodoNoticeHtml = readyTodoDraftCandidates.length > 0
        ? '<div class="note" style="margin-bottom:8px;">' +
          escapeHtml(String(readyTodoDraftCandidates.length) + " ready todos are waiting for task draft creation.") +
          '</div>'
        : "";
      var readyTodoCardsHtml = readyTodoDraftCandidates
        .map(renderReadyTodoDraftCandidateCard)
        .filter(Boolean)
        .join("");
      var existingTodoDraftsHtml = todoDraftTasks
        .map(function (task) {
          return renderTaskCard(task).replace(
            'class="task-card',
            'class="task-card todo-draft-compact',
          );
        })
        .filter(Boolean)
        .join("");
      var todoDraftGridHtml = (readyTodoCardsHtml || existingTodoDraftsHtml)
        ? '<div class="todo-draft-grid">' + readyTodoCardsHtml + existingTodoDraftsHtml + '</div>'
        : "";
      var todoDraftSectionHtml = readyTodoNoticeHtml + todoDraftGridHtml;
      if (!todoDraftSectionHtml) {
        todoDraftSectionHtml = '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + '</div>';
      }
      rightColumnHtml += renderTaskSectionContent(
        "todo-draft",
        strings.labelTodoTaskDrafts || "Todo Task Drafts",
        todoDraftSectionHtml,
        readyTodoDraftCandidates.length + todoDraftTasks.length,
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

    renderedTasks = [
      '<div class="',
      containerClass,
      '"',
      containerStyle,
      ">",
      sectionHtml,
      "</div>",
    ].join("");

    if (renderedTasks === lastRenderedTasksHtml) {
      return;
    }

    // Avoid replacing an open inline select while the user is choosing an
    // agent or model.
    if (isInlineTaskSelectActive()) {
      pendingTaskListRender = true;
      return;
    }

    pendingTaskListRender = false;
    lastRenderedTasksHtml = renderedTasks;
    taskList.innerHTML = renderedTasks;
    refreshTaskCountdowns();
  }

  function replayPendingTaskListRender() {
    if (!pendingTaskListRender || isInlineTaskSelectActive()) {
      return;
    }
    pendingTaskListRender = false;
    renderTaskList(tasks);
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

    taskList.addEventListener("focusout", function (event) {
      var target = event && event.target;
      if (!target || !target.classList) {
        return;
      }
      if (
        !target.classList.contains("task-agent-select") &&
        !target.classList.contains("task-model-select")
      ) {
        return;
      }
      setTimeout(function () {
        replayPendingTaskListRender();
      }, 0);
    });
  }

  // Helper functions
  var htmlEscapeNode = null;

  function escapeHtml(text) {
    if (text == null) return "";
    if (!htmlEscapeNode) {
      htmlEscapeNode = document.createElement("div");
    }
    htmlEscapeNode.textContent = String(text);
    return htmlEscapeNode.innerHTML;
  }

  function escapeAttr(text) {
    var normalized = typeof text === "string" ? text : String(text || "");
    var replacements = [
      [/&/g, "&amp;"],
      [/"/g, "&quot;"],
      [/'/g, "&#39;"],
      [/</g, "&lt;"],
      [/>/g, "&gt;"],
    ];
    return replacements.reduce(function (value, replacement) {
      return value.replace(replacement[0], replacement[1]);
    }, normalized);
  }

  function isInlineTaskSelectActive() {
    var active = document.activeElement;
    if (!active || !active.classList) return false;
    return active.classList.contains("task-agent-select") || active.classList.contains("task-model-select");
  }

  function getCronSummary(expression) {
    return summarizeCronExpression(expression, strings);
  }

  function setCronPreviewText(previewElement, expressionValue) {
    if (!previewElement) return;
    previewElement.textContent = getCronSummary(expressionValue || "");
  }

  function updateCronPreview() {
    if (!cronExpression) return;
    setCronPreviewText(cronPreviewText, cronExpression.value);
  }

  function updateJobsCronPreview() {
    if (!jobsCronInput) return;
    setCronPreviewText(jobsCronPreviewText, jobsCronInput.value);
    updateJobsCadenceMetric();
  }

  function updateFriendlyVisibility() {
    syncFriendlyFieldVisibility(
      friendlyBuilder,
      friendlyFrequency ? friendlyFrequency.value : "",
    );
  }

  function updateJobsFriendlyVisibility() {
    syncFriendlyFieldVisibility(
      jobsFriendlyBuilder,
      jobsFriendlyFrequency ? jobsFriendlyFrequency.value : "",
    );
  }

  function generateCronFromFriendly() {
    if (!friendlyFrequency || !cronExpression) return;
    applyFriendlyCronResult({
      frequency: friendlyFrequency.value,
      interval: friendlyInterval ? friendlyInterval.value : "",
      minute: friendlyMinute ? friendlyMinute.value : "",
      hour: friendlyHour ? friendlyHour.value : "",
      dow: friendlyDow ? friendlyDow.value : "",
      dom: friendlyDom ? friendlyDom.value : "",
      cronInput: cronExpression,
      cronPresetInput: cronPreset,
      onUpdate: updateCronPreview,
    });
  }

  function generateJobsCronFromFriendly() {
    if (!jobsFriendlyFrequency || !jobsCronInput) return;
    applyFriendlyCronResult({
      frequency: jobsFriendlyFrequency.value,
      interval: jobsFriendlyInterval ? jobsFriendlyInterval.value : "",
      minute: jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
      hour: jobsFriendlyHour ? jobsFriendlyHour.value : "",
      dow: jobsFriendlyDow ? jobsFriendlyDow.value : "",
      dom: jobsFriendlyDom ? jobsFriendlyDom.value : "",
      cronInput: jobsCronInput,
      cronPresetInput: jobsCronPreset,
      onUpdate: updateJobsCronPreview,
    });
  }

  function applyFriendlyCronResult(options) {
    var expr = buildFriendlyCronExpression(options.frequency, {
      interval: options.interval,
      minute: options.minute,
      hour: options.hour,
      dow: options.dow,
      dom: options.dom,
    });
    if (!expr) {
      return;
    }
    options.cronInput.value = expr;
    if (options.cronPresetInput) {
      options.cronPresetInput.value = "";
    }
    options.onUpdate();
  }

  function resetTaskFormSessionState() {
    [pendingAgentValue, pendingModelValue, pendingTemplatePath] = ["", "", ""];
    editingTaskEnabled = true;
  }

  function resetTaskFormToggles() {
    var runFirstEl = document.getElementById("run-first");
    if (runFirstEl) runFirstEl.checked = false;
    var oneTimeEl = document.getElementById("one-time");
    if (oneTimeEl) oneTimeEl.checked = false;
    var manualSessionEl = document.getElementById("manual-session");
    if (manualSessionEl) manualSessionEl.checked = false;
  }

  function focusTaskNameField() {
    focusElementById("task-name");
  }

  function refreshTaskEditorDerivedState() {
    [syncRecurringChatSessionUi, updateFriendlyVisibility, updateCronPreview].forEach(function (refreshFn) {
      refreshFn();
    });
  }

  function resetForm() {
    if (taskForm) taskForm.reset();
    resetTaskFormBaseState();
    resetTaskFormToggles();
    if (chatSessionSelect) chatSessionSelect.value = defaultChatSession;
    if (agentSelect) agentSelect.value = executionDefaults.agent || "";
    if (modelSelect) modelSelect.value = executionDefaults.model || "";
    refreshTaskEditorDerivedState();
  }

  function getTaskExecutionOptionContext() {
    return {
      executionDefaults: executionDefaults,
      escapeAttr: escapeAttr,
      escapeHtml: escapeHtml,
      strings: strings,
    };
  }

  function populateAgentDropdown() {
    updateTaskAgentOptions(Object.assign({
      agentSelect: agentSelect,
      agents: agents,
    }, getTaskExecutionOptionContext()));
  }

  function populateModelDropdown() {
    updateTaskModelOptions(Object.assign({
      formatModelLabel: formatModelLabel,
      modelSelect: modelSelect,
      models: models,
    }, getTaskExecutionOptionContext()));
  }

  function getTaskArrayForEditing() {
    return Array.isArray(tasks) ? tasks : [];
  }

  function findTaskById(taskId) {
    return getTaskArrayForEditing().find(function (task) {
      return task && task.id === taskId;
    });
  }

  function restoreTaskSelectValue(selectElement, pendingValue) {
    if (!selectElement) {
      return pendingValue;
    }
    if (pendingValue && !selectHasOptionValue(selectElement, pendingValue)) {
      selectElement.value = "";
      return pendingValue;
    }
    return restorePendingSelectValue(selectElement, pendingValue);
  }

  function getExecutionSelectCurrentValue(selectElement, pendingValue) {
    return pendingValue || (selectElement ? selectElement.value : "");
  }

  function refreshExecutionSelectTargets(options) {
    var currentValue = getExecutionSelectCurrentValue(
      options.selectElement,
      options.pendingValue,
    );
    return refreshExecutionTargets({
      eventName: options.eventName,
      debugData: options.createDebugData(currentValue),
      assignItems: options.assignItems,
      updateOptions: options.updateOptions,
      selectElement: options.selectElement,
      currentValue: currentValue,
      pendingValue: options.pendingValue,
    });
  }

  function initializeTaskEditorState() {
    populateAgentDropdown();
    populateModelDropdown();
    var selectedPromptSource = document.querySelector('input[name="prompt-source"]:checked');
    if (selectedPromptSource) {
      applyPromptSource(selectedPromptSource.value);
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
  }

  function openCreateTaskTab() {
    resetForm();
    switchTab("create");
    focusTaskNameField();
  }

  function startCreateTaskFlow() {
    hideGlobalError();
    setSubmitIdleState();
    openCreateTaskTab();
    setTimeout(function () {
      focusTaskNameField();
    }, 0);
  }

  function clearTaskFormError() {
    var formErr = document.getElementById("form-error");
    if (formErr) formErr.style.display = "none";
    return formErr;
  }

  function startPendingTaskSubmit() {
    pendingSubmit = true;
    if (submitBtn) {
      submitBtn.disabled = true;
    }
  }

  function setRadioValue(groupName, selectedValue) {
    var radio = document.querySelector(
      'input[name="' + groupName + '"][value="' + selectedValue + '"]',
    );
    if (radio) {
      radio.checked = true;
    }
  }

  function getTaskChatSessionValue(task) {
    if (task.chatSession === "continue") {
      return "continue";
    }
    if (task.chatSession === "new") {
      return "new";
    }
    return defaultChatSession;
  }

  function syncGlobalErrorMessage(text) {
    if (!text) {
      return;
    }
    showGlobalError(text);
    setSubmitIdleState();
  }

  function editTaskFromHost(taskId) {
    if (taskId && typeof window.editTask === "function") {
      window.editTask(taskId);
    }
  }

  function focusElementById(elementId) {
    var element = document.getElementById(elementId);
    if (element && typeof element.focus === "function") {
      element.focus();
    }
  }

  function resetTaskFormFieldValues() {
    applyPromptSource("inline");
    if (friendlyFrequency) friendlyFrequency.value = "";
    if (jitterSecondsInput) {
      jitterSecondsInput.value = String(defaultJitterSeconds);
    }
    if (taskLabelsInput) {
      taskLabelsInput.value = "";
    }
  }

  function resetTaskFormBaseState() {
    setEditingMode(null);
    resetTaskFormSessionState();
    resetTaskFormFieldValues();
  }

  function getHostMessage(event) {
    return event.data;
  }

  function populateTaskEditor(task, taskId) {
    var nameInput = document.getElementById("task-name");
    var promptInput = document.getElementById("prompt-text");
    var promptSourceValue = task.promptSource || "inline";

    setEditingMode(taskId);
    if (nameInput) nameInput.value = task.name || "";
    if (taskLabelsInput) taskLabelsInput.value = toLabelString(task.labels);
    if (promptInput) {
      promptInput.value = typeof task.prompt === "string" ? task.prompt : "";
    }
    if (cronExpression) {
      cronExpression.value = task.cronExpression || "";
    }
    if (cronPreset) {
      cronPreset.value = "";
    }
    updateCronPreview();

    pendingAgentValue = restoreTaskSelectValue(agentSelect, task.agent || "");
    pendingModelValue = restoreTaskSelectValue(modelSelect, task.model || "");
    editingTaskEnabled = task.enabled !== false;
    setRadioValue("scope", task.scope || "workspace");
    setRadioValue("prompt-source", promptSourceValue);

    applyPromptSource(promptSourceValue, true);
    pendingTemplatePath = task.promptPath || "";
    if (templateSelect) {
      pendingTemplatePath = restoreTaskSelectValue(templateSelect, pendingTemplatePath);
    }
    if (jitterSecondsInput) {
      jitterSecondsInput.value = String(task.jitterSeconds ?? defaultJitterSeconds);
    }

    var runFirstEl = document.getElementById("run-first");
    if (runFirstEl) runFirstEl.checked = false;

    var oneTimeEl = document.getElementById("one-time");
    if (oneTimeEl) oneTimeEl.checked = task.oneTime === true;
    var manualSessionEl = document.getElementById("manual-session");
    if (manualSessionEl) {
      manualSessionEl.checked = task.oneTime === true ? false : task.manualSession === true;
    }
    if (chatSessionSelect) {
      chatSessionSelect.value = getTaskChatSessionValue(task);
    }
    refreshTaskEditorDerivedState();
    switchTab("create");
  }

  function postTaskMessage(type, taskId) {
    vscode.postMessage({ type: type, taskId: taskId });
  }

  function restoreUpdatedTaskSelector(selectElement, currentValue, pendingValueRef) {
    if (!selectElement || !currentValue) {
      return pendingValueRef;
    }
    return restorePendingSelectValue(selectElement, currentValue);
  }

  function refreshExecutionTargets(options) {
    emitWebviewDebug(options.eventName, options.debugData);
    options.assignItems();
    options.updateOptions();
    renderExecutionDefaultsControls();
    renderReviewDefaultsControls();
    syncJobsStepSelectors();
    syncResearchSelectors();
    options.pendingValue = restoreUpdatedTaskSelector(
      options.selectElement,
      options.currentValue,
      options.pendingValue,
    );
    renderTaskList(tasks);
    return options.pendingValue;
  }

  function scrollTaskCardIntoView(taskId) {
    var selector = '.task-card[data-id="' + taskId + '"]';
    var card = document.querySelector(selector);
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ behavior: "smooth" });
    }
  }

  function updateTemplateOptions(source, selectedPath) {
    updatePromptTemplateOptions({
      templateSelect: templateSelect,
      promptTemplates: promptTemplates,
      source: source,
      selectedPath: selectedPath,
      strings: strings,
      escapeHtml: escapeHtml,
      escapeAttr: escapeAttr,
    });
  }

  function applyPromptSource(source, keepSelection) {
    applyPromptSourceUi({
      source: source,
      keepSelection: keepSelection,
      templateSelect: templateSelect,
      promptTextEl: promptTextEl,
      templateSelectGroup: templateSelectGroup,
      promptGroup: promptGroup,
      promptTemplates: promptTemplates,
      strings: strings,
      escapeHtml: escapeHtml,
      escapeAttr: escapeAttr,
      warnMissingTemplateGroup: function () {
        console.warn(
          "[CopilotCockpit] Template select container not found; template picking is disabled.",
        );
      },
    });
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

  function getAutoAgentResearchExampleProfile() {
    return {
      name: strings.researchAutoAgentExampleName || "AutoAgent Harbor Example",
      instructions: strings.researchAutoAgentExampleInstructions
        || "Use this preset inside the autoagent repo to improve the Harbor agent harness score by editing agent.py while refining the experiment directive in program.md. Start with one representative task, keep the editable surface small, and make sure the benchmark command prints a final numeric score or reward line that matches the regex before you run the loop.",
      editablePaths: ["agent.py", "program.md"],
      benchmarkCommand: "uv run harbor run -p tasks/ --task-name \"<task-name>\" -l 1 -n 1 --agent-import-path agent:AutoAgent -o jobs --job-name latest",
      metricPattern: "(?:score|reward)\\s*[:=]\\s*([0-9.]+)",
      metricDirection: "maximize",
      maxIterations: 8,
      maxMinutes: 90,
      maxConsecutiveFailures: 3,
      benchmarkTimeoutSeconds: 900,
      editWaitSeconds: 45,
      agent: "",
      model: "",
    };
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
      if (!researchFormDirty && !isCreatingResearchProfile) {
        resetResearchForm(null);
      }
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

  // Populate dropdowns from the local cache
  initializeTaskEditorState();

  // Globally-scoped helpers for inline onclick attributes
  window.runTask = function runTask(id) {
    vscode.postMessage({ type: "runTask", taskId: id });
  };

  window.editTask = function editTask(id) {
    var task = findTaskById(id);
    if (!task) return;
    populateTaskEditor(task, id);
  };

  if (newTaskBtn) {
    newTaskBtn.addEventListener("click", function handleNewTask() {
      openCreateTaskTab();
    });
  }

  window.copyPrompt = function copyPrompt(id) {
    // Dispatch via the action callback so file-backed prompt templates
    // are loaded from disk (matching the tree-view copy behaviour).
    postTaskMessage("copyTask", id);
  };

  window.duplicateTask = function duplicateTask(id) {
    postTaskMessage("duplicateTask", id);
  };

  window.moveTaskToCurrentWorkspace = function moveTask(id) {
    postTaskMessage("moveTaskToCurrentWorkspace", id);
  };

  window.toggleTask = function toggleTask(id) {
    postTaskMessage("toggleTask", id);
  };

  window.deleteTask = function deleteTask(id) {
    var task = findTaskById(id);
    if (!task) {
      return;
    }

    // Send delete request to extension (confirmation will be handled there)
    postTaskMessage("deleteTask", id);
  };

  // Process inbound messages from the host extension
  window.addEventListener("message", function handleMessage(event) {
    var message = getHostMessage(event);
    var messageType = message && message.type;

    try {
      switch (messageType) {
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
          if (!selectedResearchId) {
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
          storageSettings = normalizeStorageSettings(message.storageSettings, storageSettings);
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
        case "updateReviewDefaults":
          reviewDefaults = message.reviewDefaults || {
            needsBotReviewCommentTemplate: "",
            needsBotReviewPromptTemplate: "",
            needsBotReviewAgent: "agent",
            needsBotReviewModel: "",
            needsBotReviewChatSession: "new",
            readyPromptTemplate: "",
          };
          renderReviewDefaultsControls();
          break;
        case "updateAgents":
          pendingAgentValue = refreshExecutionSelectTargets({
            eventName: "updateAgents",
            selectElement: agentSelect,
            pendingValue: pendingAgentValue,
            createDebugData: function (currentValue) {
              return {
                currentAgentValue: currentValue,
                agentCount: Array.isArray(message.agents) ? message.agents.length : 0,
              };
            },
            assignItems: function () {
              agents = Array.isArray(message.agents) ? message.agents : [];
            },
            updateOptions: populateAgentDropdown,
          });
          break;
        case "updateModels":
          pendingModelValue = refreshExecutionSelectTargets({
            eventName: "updateModels",
            selectElement: modelSelect,
            pendingValue: pendingModelValue,
            createDebugData: function (currentValue) {
              return {
                currentModelValue: currentValue,
                modelCount: Array.isArray(message.models) ? message.models.length : 0,
              };
            },
            assignItems: function () {
              models = Array.isArray(message.models) ? message.models : [];
            },
            updateOptions: populateModelDropdown,
          });
          break;
        case "updatePromptTemplates":
          syncPromptTemplateOptions(message.templates);
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
          setPromptTextValue(message.content);
          break;
        case "switchToList":
          switchToListView(message.successMessage);
          break;
        case "switchToTab":
          if (message.tab) {
            switchTab(message.tab);
          }
          break;
        case "focusTask":
          focusTaskView(message.taskId);
          break;
        case "focusJob":
          focusJobView(message.folderId, message.jobId || "");
          break;
        case "focusResearchProfile":
          focusResearchProfileView(message.researchId);
          break;
        case "focusResearchRun":
          focusResearchRunView(message.runId);
          break;
        case "editTask":
          editTaskFromHost(message.taskId);
          break;
        case "startCreateTask":
          startCreateTaskFlow();
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
          syncGlobalErrorMessage(message.text);
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
      showWebviewClientError(e);
    }
  });

  // Initial render
  renderTaskList(tasks);

  switchTab(getInitialTabName());
  window.addEventListener("scroll", function () {
    if (activeTabName) {
      captureTabScrollPosition(activeTabName);
      persistTaskFilter();
    }
    updateBoardAutoCollapseFromScroll(false);
  }, { passive: true });
  window.addEventListener("resize", scheduleBoardStickyMetrics);
  document.addEventListener("keydown", function (event) {
    handleGlobalSaveShortcut(event);
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

  // Signal the host extension that the webview has finished loading
  vscode.postMessage({ type: "webviewReady" });
})();










