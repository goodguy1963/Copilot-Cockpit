import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import * as assert from "assert";
import * as vscode from "vscode";
import { messages } from "../../i18n";
import { SchedulerWebview } from "../../schedulerWebview";
import { getResourceScopedSettingsTarget } from "../../schedulerWebviewSettingsHandler";
import { overrideWorkspaceFolders } from "./helpers/vscodeTestHarness";

type WebviewPanelLike = {
  webview: {
    postMessage(message: unknown): Thenable<boolean>;
  };
};

type SchedulerWebviewInternals = {
  panel?: WebviewPanelLike;
  webviewReady?: boolean;
  pendingMessageFlushTimer?: ReturnType<typeof setTimeout>;
  pendingMessages?: unknown[];
  lastBatchedMessageSignatures?: Map<string, string>;
  [key: string]: unknown;
};

type RefreshableSchedulerWebviewInternals = SchedulerWebviewInternals & {
  cachedAgents?: unknown[];
  cachedModels?: unknown[];
  cachedPromptTemplates?: unknown[];
  cachedSkillReferences?: unknown[];
  flushPendingMessages?: () => void;
  handleMessage?: (message: unknown) => Promise<void>;
  refreshAgentsAndModelsCache?: (force?: boolean) => Promise<void>;
  refreshPromptTemplatesCache?: (force?: boolean) => Promise<void>;
  refreshSkillReferencesCache?: (force?: boolean) => Promise<void>;
  sanitizeErrorDetailsForUser?: (message: string) => string;
};

function resolveWorkspacePath(...segments: string[]): string {
  return path.resolve(__dirname, ...segments);
}

function readWorkspaceFile(...segments: string[]): string {
  return fs.readFileSync(resolveWorkspacePath(...segments), "utf8");
}

function readSourceFilesFromDirectory(
  dirSegments: string[],
  includeFile: (fileName: string) => boolean,
): string {
  const dirPath = resolveWorkspacePath(...dirSegments);
  const fileNames = fs
    .readdirSync(dirPath)
    .filter(includeFile)
    .sort((left, right) => left.localeCompare(right));

  return fileNames
    .map((fileName) => fs.readFileSync(path.join(dirPath, fileName), "utf8"))
    .join("\n\n");
}

function readSchedulerWebviewScriptSource(): string {
  // The runtime is split across many media modules; merge them for resilient assertions.
  return readSourceFilesFromDirectory(
    ["../../../media"],
    (fileName) => fileName.endsWith(".js") && fileName !== "schedulerWebview.entry.js",
  );
}

function readGeneratedSchedulerWebviewScriptSource(): string {
  return readWorkspaceFile("../../../media/generated/schedulerWebview.js");
}

function readSchedulerWebviewTemplateSource(): string {
  // Template/CSS markup is composed from schedulerWebview* source modules.
  return readSourceFilesFromDirectory(
    ["../../../src"],
    (fileName) => fileName.startsWith("schedulerWebview") && fileName.endsWith(".ts"),
  );
}

function readSchedulerWebviewStringsSource(): string {
  return readWorkspaceFile("../../../src/schedulerWebviewStrings.ts");
}

function readSchedulerWebviewDebugSource(): string {
  return readWorkspaceFile("../../../media/schedulerWebviewDebug.js");
}

function readBoardRenderingSource(): string {
  return readWorkspaceFile("../../../media/schedulerWebviewBoardRendering.js");
}

function expectSourceToIncludeSnippets(
  source: string,
  snippets: readonly string[],
  contextLabel: string,
): void {
  const normalize = (value: string) => value.replace(/\s+/g, "").replace(/;/g, "");
  const normalizedSource = normalize(source);
  for (const snippet of snippets) {
    const found = source.includes(snippet)
      || normalizedSource.includes(normalize(snippet));
    assert.ok(
      found,
      `expected ${contextLabel} snippet ${snippet}`,
    );
  }
}

function expectSourceToExcludeSnippets(
  source: string,
  snippets: readonly string[],
  contextLabel: string,
): void {
  for (const snippet of snippets) {
    assert.strictEqual(
      source.includes(snippet),
      false,
      `unexpected ${contextLabel} snippet ${snippet}`,
    );
  }
}

function createPostedMessagePanel(sent: unknown[]): WebviewPanelLike {
  const postMessage = (message: unknown) => {
    sent.push(message);
    return Promise.resolve(true);
  };
  return { webview: { postMessage } };
}

function withPostedWebviewMessages<T>(
  options: {
    ready?: boolean;
    resetBatchState?: boolean;
  },
  run: (ctx: { wv: SchedulerWebviewInternals; sent: unknown[] }) => T,
): T {
  const wv = SchedulerWebview as unknown as SchedulerWebviewInternals;
  const sent: unknown[] = [];
  const originalState = {
    lastBatchedMessageSignatures: wv.lastBatchedMessageSignatures,
    panel: wv.panel,
    pendingMessageFlushTimer: wv.pendingMessageFlushTimer,
    pendingMessages: wv.pendingMessages,
    webviewReady: wv.webviewReady,
  };

  const restore = () => {
    if (wv.pendingMessageFlushTimer) {
      clearTimeout(wv.pendingMessageFlushTimer);
    }
    Object.assign(wv, originalState);
  };

  try {
    wv.panel = createPostedMessagePanel(sent);
    wv.pendingMessages = [];
    wv.webviewReady = options.ready ?? false;

    if (options.resetBatchState) {
      wv.lastBatchedMessageSignatures = new Map();
      wv.pendingMessageFlushTimer = undefined;
    }

    const result = run({ wv, sent });
    if (
      result &&
      typeof (result as { then?: unknown }).then === "function"
    ) {
      return ((result as unknown as Promise<unknown>).finally(() => restore()) as unknown) as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

async function withRefreshCacheHarness(
  run: (ctx: { sent: unknown[]; wv: RefreshableSchedulerWebviewInternals }) => Promise<void>,
): Promise<void> {
  const wv = SchedulerWebview as unknown as RefreshableSchedulerWebviewInternals;
  const restoreState = {
    cachedAgents: wv.cachedAgents,
    cachedModels: wv.cachedModels,
    cachedPromptTemplates: wv.cachedPromptTemplates,
    cachedSkillReferences: wv.cachedSkillReferences,
    refreshAgentsAndModelsCache: wv.refreshAgentsAndModelsCache,
    refreshPromptTemplatesCache: wv.refreshPromptTemplatesCache,
    refreshSkillReferencesCache: wv.refreshSkillReferencesCache,
  };

  await withPostedWebviewMessages({ ready: true }, async ({ sent }) => {
    wv.cachedAgents = [];
    wv.cachedModels = [];
    wv.cachedPromptTemplates = [];
    wv.cachedSkillReferences = [];
    wv.refreshAgentsAndModelsCache = async () => {
      wv.cachedAgents = [{ id: "agent" }];
      wv.cachedModels = [{ id: "gpt-4o" }];
    };
    wv.refreshPromptTemplatesCache = async () => {
      wv.cachedPromptTemplates = [{ path: "prompt.md" }];
    };
    wv.refreshSkillReferencesCache = async () => {
      wv.cachedSkillReferences = [{ path: "SKILL.md" }];
    };

    try {
      await run({ sent, wv });
    } finally {
      Object.assign(wv, restoreState);
    }
  });
}

function getSinglePostedMessage<T>(sent: unknown[]): T {
  assert.strictEqual(sent.length, 1);
  return sent[0] as T;
}

function expectSanitizedPathResult(
  sanitize: (message: string) => string,
  input: string,
  removedSnippet: string,
  keptSnippet: string,
): void {
  const output = sanitize(input);
  assert.ok(!output.includes(removedSnippet));
  assert.ok(output.includes(keptSnippet));
}

function expectSanitizerPassthrough(
  sanitize: (message: string) => string,
  input: string,
): void {
  assert.strictEqual(sanitize(input), input);
}

function expectPostedErrorMessageText(
  message: { type?: unknown; text?: unknown },
  removedSnippet: string,
  keptSnippet: string,
): void {
  assert.strictEqual(message.type, "showError");
  assert.ok(typeof message.text === "string");
  const text = message.text as string;
  assert.ok(!text.includes(removedSnippet));
  assert.ok(text.includes(keptSnippet));
}

type QueuedUpdateCase = {
  name: string;
  method: string;
  args: unknown[];
  messageType: string;
  verify: (message: Record<string, unknown>) => void;
};

suite("SchedulerWebview Message Queue Tests", () => {
  function loadBoardInteractionModule() {
    const scriptPath = resolveWorkspacePath(
      "../../../media/schedulerWebviewBoardInteractions.js",
    );
    const scriptSource = fs
      .readFileSync(scriptPath, "utf8")
      .replace(/^export\s+/gm, "");
    const context = vm.createContext({ result: undefined });
    const moduleScript = new vm.Script(
      `${scriptSource}\nresult = { getEventTargetElement, getClosestEventTarget, isBoardDragHandleTarget, isTodoInteractiveTarget, handleBoardTodoCompletion, bindBoardColumnInteractions };`,
      { filename: scriptPath },
    );
    moduleScript.runInContext(context);
    return context.result as {
      getEventTargetElement: (eventOrTarget: unknown) => unknown;
      getClosestEventTarget: (eventOrTarget: unknown, selector: string) => unknown;
      isBoardDragHandleTarget: (target: unknown) => boolean;
      isTodoInteractiveTarget: (target: unknown) => boolean;
      handleBoardTodoCompletion: (completeToggle: Record<string, unknown>, options: Record<string, unknown>) => void;
      bindBoardColumnInteractions: (options: Record<string, unknown>) => void;
    };
  }

  function createListenerTarget<T extends Record<string, unknown>>(base: T): T & {
    addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => void;
    listeners: Record<string, (event: Record<string, unknown>) => void>;
  } {
    const listeners: Record<string, (event: Record<string, unknown>) => void> = {};
    return Object.assign(base, {
      addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
        listeners[name] = handler;
      },
      listeners,
    });
  }

  test("webview client script parses", () => {
    const scriptPath = resolveWorkspacePath(
      "../../../media/generated/schedulerWebview.js",
    );
    const scriptSource = readGeneratedSchedulerWebviewScriptSource();

    assert.doesNotThrow(() => {
      new vm.Script(scriptSource, { filename: scriptPath });
    });
  });

  test("todo editor click handlers use normalized event target lookups", () => {
    const scriptSource = readSchedulerWebviewScriptSource();
    const selectors = [
      "[data-flag-chip-remove]",
      "[data-flag-catalog-select]",
      "[data-flag-catalog-edit]",
      "[data-flag-catalog-confirm-delete]",
      "[data-flag-catalog-delete]",
      "[data-label-chip-remove]",
      "[data-label-chip-select]",
      "[data-label-suggestion]",
      "[data-label-catalog-edit]",
      "[data-label-catalog-delete]",
      "[data-label-catalog-confirm-delete]",
      "[data-label-catalog-select]",
      "[data-todo-delete-cancel]",
      "[data-todo-delete-reject]",
      "[data-todo-delete-permanent]",
    ];

    selectors.forEach((selector) => {
      assert.ok(
        scriptSource.includes(`getClosestEventTarget(event, "${selector}")`),
        `expected normalized event targeting for ${selector}`,
      );
      assert.strictEqual(
        scriptSource.includes(`event.target.closest("${selector}")`),
        false,
        `unexpected raw event.target.closest usage for ${selector}`,
      );
    });
  });

  test("todo create draft keeps transient label and flag editor fields", () => {
    const debugScriptSource = readWorkspaceFile(
      "../../../media/schedulerWebviewDebug.js",
    );

    ["labelInput", "labelColor", "flagInput", "flagColor"].forEach((field) => {
      assert.ok(
        debugScriptSource.includes(`${field}:`),
        `expected createEmptyTodoDraft to include ${field}`,
      );
    });

    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      "todoDraft.labelInput || \"\"",
      "todoDraft.labelColor",
      "todoDraft.flagInput || \"\"",
      "todoDraft.flagColor",
      "syncTodoEditorTransientDraft();",
    ], "transient draft restoration");
  });

  test("settings tab includes editable spot-review defaults plumbing", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(
      scriptSource,
      [
      'needsBotReviewCommentTemplateInput: document.getElementById("needs-bot-review-comment-template-input")',
      'needsBotReviewPromptTemplateInput: document.getElementById("needs-bot-review-prompt-template-input")',
      'needsBotReviewAgentSelect: document.getElementById("needs-bot-review-agent-select")',
      'needsBotReviewModelSelect: document.getElementById("needs-bot-review-model-select")',
      'needsBotReviewChatSessionSelect: document.getElementById("needs-bot-review-chat-session-select")',
      'readyPromptTemplateInput: document.getElementById("ready-prompt-template-input")',
      'type: "saveReviewDefaults"',
      'case "updateReviewDefaults":',
      'function renderReviewDefaultsControls() {',
      ],
      "review defaults",
    );
  });

  test("todo label and flag saves use rename-aware updates instead of delete-and-readd", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    assert.ok(
      scriptSource.includes("previousName: prevName || undefined")
      || scriptSource.includes("previousName: editingLabelOriginalName || undefined"),
      "expected rename-aware previousName payloads for todo label and flag saves",
    );
    expectSourceToExcludeSnippets(
      scriptSource,
      [
        'vscode.postMessage({ type: "deleteTodoLabelDefinition", data: { name: prevName } });',
        'vscode.postMessage({ type: "deleteTodoFlagDefinition", data: { name: prevName } });',
      ],
      "delete-on-rename flow",
    );
    expectSourceToIncludeSnippets(
      scriptSource,
      [
        "function upsertLocalLabelDefinition(name, color, previousName)",
        "var existingDefinition = getLabelDefinition(label);",
        "if (!existingDefinition && pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {",
        'todoLabelColorInput.value = "#4f8cff";',
      ],
      "rename-aware todo label flow",
    );
  });

  test("todo label catalog edit and add flows preserve shared definition colors", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      "function getValidLabelColorValue(color, fallbackColor)",
      'todoLabelColorInput.value = getValidLabelColorValue(eEntry && eEntry.color, "#4f8cff");',
      'selectedTodoLabelName = eEntry ? eEntry.name : eName;',
      'editingLabelOriginalName = eEntry ? eEntry.name : eName;',
      "syncTodoLabelEditor();",
      'todoLabelColorInput.value = getValidLabelColorValue(definition && definition.color, todoLabelColorInput.value || "#4f8cff");',
    ], "shared label color preservation");
  });

  test("todo flag picker localizes protected flags and hides destructive controls", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      "function getFlagDisplayName(flagName)",
      'strings.boardFlagPresetReady || "Ready"',
      'strings.boardFlagPresetFinalUserCheck || "Final User Check"',
      "function isProtectedFlagDefinition(entryOrName)",
      "entry.system === true",
      'strings.boardFlagCatalogLockedTitle || "Built-in flag"',
    ], "protected/localized flag handling");
  });

  test("todo editor keeps upload wiring and sticky filter footer anchors", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(
      templateSource,
      [
      'id="todo-upload-files-btn"',
      'id="todo-upload-files-note"',
      'id="todo-hide-card-details"',
      'class="board-filter-grid-shell"',
      'class="board-filter-footer"',
      ],
      "upload/sticky template",
    );

    expectSourceToIncludeSnippets(scriptSource, [
      'type: "requestTodoFileUpload"',
      'case "todoFileUploadResult":',
      'function openTodoCommentModal(comment)',
      'function updateBoardAutoCollapseFromScroll(forceExpand)',
      'function shouldIgnoreBoardAutoCollapseScroll(currentY)',
    ], "upload/sticky runtime");
  });

  test("research tab exposes the AutoAgent example loader without host-side profile creation", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const stringsSource = readSchedulerWebviewStringsSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(templateSource, [
      'id="research-load-autoagent-example-btn"',
      'strings.researchLoadAutoAgentExample',
    ], "AutoAgent example template");

    expectSourceToIncludeSnippets(stringsSource, [
      "researchLoadAutoAgentExample: localize(",
      "researchAutoAgentExampleName: localize(",
      "researchAutoAgentExampleInstructions: localize(",
    ], "AutoAgent example string");

    expectSourceToIncludeSnippets(scriptSource, [
      'researchLoadAutoAgentExampleBtn: document.getElementById("research-load-autoagent-example-btn")',
      'researchNewBtn: document.getElementById("research-new-btn")',
      'function handleResearchToolbarAction(actionId) {',
      'function handleResearchAction(actionId) {',
      'function selectResearchProfile(researchId) {',
      'function selectResearchRun(runId) {',
      'if (actionId === "research-new-btn") {',
      "function getAutoAgentResearchExampleProfile()",
      'editablePaths: ["agent.py", "program.md"]',
      'metricPattern: "(?:score|reward)\\\\s*[:=]\\\\s*([0-9.]+)"',
      '#research-new-btn, #research-load-autoagent-example-btn, #research-save-btn, #research-duplicate-btn, #research-delete-btn, #research-start-btn, #research-stop-btn',
      'handleResearchAction(researchActionButton.id || "")',
      'resetResearchForm(getAutoAgentResearchExampleProfile());',
      'researchFormDirty = true;',
      'if (!researchFormDirty && !isCreatingResearchProfile) {',
      'options.selectResearchProfile(',
      'researchProfileCard.getAttribute("data-research-id") || "",',
      'options.selectResearchRun(',
      'researchRunCard.getAttribute("data-run-id") || "")',
      'case "focusResearchProfile":',
      'case "focusResearchRun":',
    ], "AutoAgent example runtime");

    assert.strictEqual(
      scriptSource.includes('type: "createResearchProfile"'),
      true,
      "expected normal explicit save flow to remain in place",
    );
  });

  test("webview runtime persists the active tab and per-tab scroll positions", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      "var activeTabName = \"\";",
      "var tabScrollPositions = Object.create(null);",
      "function isPersistedTabName(value)",
      "function captureTabScrollPosition(tabName)",
      "function restoreTabScrollPosition(tabName)",
      "if (state && isPersistedTabName(state.activeTab)) {",
      "next.activeTab = activeTabName;",
      "next.tabScrollPositions = tabScrollPositions;",
      "captureTabScrollPosition(activeTabName);",
      "persistTaskFilter();",
      "restoreTabScrollPosition(tabName);",
      "if (isPersistedTabName(activeTabName)) {",
    ], "active-tab scroll persistence");
  });

  test("webview runtime keeps pending recurring filter state across stale board refreshes", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      "pendingTodoFilters: null,",
      "var pendingTodoFilters = transientState.pendingTodoFilters;",
      "pendingTodoFilters = next;",
      "if (pendingTodoFilters) {",
      "if (areTodoFiltersEqual(incomingFilters, pendingTodoFilters)) {",
      "filters: normalizeTodoFilters(Object.assign({}, incomingFilters, pendingTodoFilters)),",
    ], "pending filter reconciliation");
  });

  test("webview runtime orders visible recurring sections first and resolves task-list selects through execution defaults", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      "if (!(filters && filters.showRecurringTasks === true) && isRecurringTodoSectionId(section.id)) {",
      "if (filters.showRecurringTasks !== true) {",
      "var effectiveSelectedId = selectedId || fallbackSelectedId;",
      "params.executionDefaults && params.executionDefaults.agent",
      "params.executionDefaults && params.executionDefaults.model",
      "var pendingTaskListRender = false;",
      "pendingTaskListRender = true;",
      "function replayPendingTaskListRender() {",
      "taskList.addEventListener(\"focusout\"",
      "renderTaskList(tasks);",
    ], "recurring/default task-list");
  });

  test("task list adds manual sessions filter and collapsible manual recurring one-time sections", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(templateSource, [
      'data-filter="manual"',
      'id="manual-session"',
      'strings.labelManualSessions',
      'strings.labelManualSessionNote',
      '.task-subsection{',
      '.task-subsection-title{',
      '.task-sections-column{',
      '.task-section-toggle{',
      '.task-section.is-collapsed .task-section-body{',
    ], "manual-session template");

    expectSourceToIncludeSnippets(scriptSource, [
      'var taskSectionCollapseState = {',
      'function getActiveTodoLabelEditorName() {',
      'function getActiveTodoFlagEditorName() {',
      'todoLabelColorSaveBtn.disabled = !getActiveTodoLabelEditorName();',
      'todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();',
      'jobs: true,',
      'value === "jobs"',
      'function renderTaskSectionContent(sectionKey, title, contentHtml, itemCount) {',
      'function renderTaskSubsection(title, items) {',
      'function isJobTask(task) {',
      'strings.labelJobTasks || "Jobs"',
      'leftColumnHtml += jobSectionHtml;',
      '"todo-draft": false,',
      'value === "todo-draft"',
      'function isTodoTaskDraft(task) {',
      'normalizeTodoLabelKey(label) === "from-todo-cockpit"',
      'function getReadyTodoDraftCandidates() {',
      'data-ready-todo-create',
      'ready todos are waiting for task draft creation.',
      'strings.labelTodoTaskDrafts || "Todo Task Drafts"',
      'value === "manual"',
      'data-task-section-toggle',
      'task.manualSession === true',
      'task-sections-column task-sections-column-primary',
      'task-sections-column task-sections-column-secondary',
      'strings.labelManualSessions || "Manual Sessions"',
      'manualSession: manualSession,',
    ], "manual-session runtime");
  });

  test("task editor disables native submit blocking and syncs prompt-source required fields", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    assert.ok(
      templateSource.includes('<form id="task-form" novalidate>'),
      "expected task form to disable native browser validation so the webview submit handler always runs",
    );

    expectSourceToIncludeSnippets(scriptSource, [
      'var promptTextEl = document.getElementById("prompt-text");',
      'var usesInlinePrompt = effectiveSource === "inline";',
      "promptTextEl.required = usesInlinePrompt;",
      "templateSelect.required = !usesInlinePrompt;",
    ], "prompt-source validation sync");
  });

  test("webview supports cross-platform save shortcuts for task and todo editors", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(scriptSource, [
      'function submitWebviewForm(form) {',
      'if (typeof form.requestSubmit === "function") {',
      'return form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));',
      'function isSaveShortcutEvent(event) {',
      '&& (event.ctrlKey || event.metaKey)',
      '&& String(event.key || "").toLowerCase() === "s";',
      'function handleGlobalSaveShortcut(event) {',
      'if (isTabActive("create")) {',
      'submitWebviewForm(taskForm);',
      'if (isTabActive("todo-edit")) {',
      'submitWebviewForm(todoDetailForm);',
      'handleGlobalSaveShortcut(event);',
    ], "save shortcut runtime");
  });

  test("board filter footer compacts on narrow screens and chip scaling uses dedicated slider vars", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(templateSource, [
      "font-size:var(--cockpit-chip-font,inherit);",
      "@media (max-width: 1180px)",
      "grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;",
      "@media (max-width: 640px)",
      "grid-template-columns: 1fr;",
    ], "responsive footer/chip CSS");

    expectSourceToIncludeSnippets(scriptSource, [
      'document.documentElement.style.setProperty("--cockpit-chip-font", chipFont + "px");',
      "var chipFont = Math.max(8, Math.round(8 + (w - 180) * 4 / 340));",
      "var chipGap = Math.max(2, Math.round(2 + (w - 180) * 2 / 340));",
      "return Math.round(min + range * 0.1);",
      'w <= getCockpitCompactDetailsThreshold(),',
      "boardAutoCollapseSettleUntil = Date.now() + 240;",
      "boardAutoCollapseSettleDistance = Math.max(56, Math.ceil(stickyHeight + 16));",
    ], "slider chip-scale runtime");
  });

  test("todo board cards use icon-only compact actions and keep board rows on one line", () => {
    const renderPath = path.resolve(
      __dirname,
      "../../../media/schedulerWebviewBoardRendering.js",
    );
    const renderSource = fs.readFileSync(renderPath, "utf8");
    const templateSource = readSchedulerWebviewTemplateSource();

    expectSourceToIncludeSnippets(renderSource, [
      "function renderActionButton(cls, dataAttr, label, iconHtml)",
      "function renderConfirmButton(cls, dataAttr, label)",
      'class="cockpit-section-title-group"',
      'class="cockpit-section-title"',
      'class="note cockpit-section-count"',
      "todo-card-icon-btn",
      "title=\"' + helpers.escapeAttr(label) + '\" aria-label=\"' + helpers.escapeAttr(label) + '\"",
      "data-todo-delete-reject",
      "data-todo-delete-permanent",
    ], "compact icon action");

    expectSourceToIncludeSnippets(templateSource, [
      ".cockpit-section-title-group{",
      ".cockpit-section-title{",
      ".cockpit-section-count{",
      ".todo-card-action-row{",
      "grid-auto-flow: column;",
      "grid-auto-columns: minmax(0, 1fr);",
      ".todo-card-icon-btn{",
      "min-height: 24px !important;",
      "filter: saturate(1.08) brightness(1.05);",
      ".todo-card-delete-reject{",
      ".todo-card-delete-permanent{",
    ], "compact action row CSS");
  });

  test("list view rows reuse board chips and switch between compact and detailed lines", () => {
    const renderPath = path.resolve(
      __dirname,
      "../../../media/schedulerWebviewBoardRendering.js",
    );
    const renderSource = fs.readFileSync(renderPath, "utf8");
    const templateSource = readSchedulerWebviewTemplateSource();

    expectSourceToIncludeSnippets(renderSource, [
      'var chipMarkup = (visibleFlags.length || visibleLabels.length)',
      'class="todo-list-chip-row"',
      'class="card-flags"',
      'class="cockpit-card-details todo-list-card-details"',
      'class="note todo-list-detail-line todo-list-detail-line-description"',
      'class="note todo-list-detail-line todo-list-detail-line-comment"',
      "aria-expanded=\"' + (isCollapsed ? 'false' : 'true') + '\"",
      'helpers.renderLabelChip(label, false, false)',
      'strings.boardDescriptionLabel || "Description"',
      'strings.boardLatestComment || "Latest comment"',
      'strings.boardCommentsEmpty || "No comments yet."',
    ], "list-view chip/detail");

    expectSourceToIncludeSnippets(templateSource, [
      '.todo-list-row{',
      'grid-template-columns: minmax(0, 1fr) auto;',
      '.todo-list-section .cockpit-section-header {',
      'align-items: flex-start;',
      '.section-body-wrapper.collapsed{',
      'grid-template-rows: 0fr;',
      '.todo-list-card-details{',
      '.todo-list-chip-row{',
      '.todo-list-detail-line{',
      'grid-template-columns: auto minmax(0, 1fr);',
      '.cockpit-board-hide-card-details .todo-list-card-details,',
      'grid-auto-flow: column;',
      '@media (max-width: 760px) {',
      'grid-template-columns: 1fr;',
    ], "list-view layout CSS");
  });

  test("editor tabs use symbol states and dirty badges", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    ["todo-edit", "create", "jobs-edit"].forEach((tabName) => {
      assert.ok(
        templateSource.includes(`data-tab-symbol="${tabName}"`),
        `expected tab symbol anchor for ${tabName}`,
      );
    });

    expectSourceToIncludeSnippets(
      scriptSource,
      [
      'var EDITOR_CREATE_SYMBOL = "+";',
      'var EDITOR_EDIT_SYMBOL = "⚙";',
      'labelNode.classList.toggle("is-dirty", options.dirty === true);',
      'function isTaskEditorDirty()',
      'function isTodoEditorDirty()',
      'function isJobsEditorDirty()',
      'hookEditorTabDirtyTracking();',
      ],
      "editor tab state",
    );
  });

  test("job focus resets jobs editor state and keeps editor tabs compact", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(templateSource, [
      '.tab-button[data-tab="todo-edit"]',
      '.tab-button[data-tab="create"]',
      '.tab-button[data-tab="jobs-edit"]',
      'flex: 0 0 auto;',
      'id="jobs-save-deck-btn"',
      '.jobs-workflow-metric.is-compact .jobs-workflow-metric-value',
    ], "compact editor tab styling");

    const focusJobCaseStart = scriptSource.indexOf('function focusJobView(folderId, jobId) {');
    const editTaskCaseStart = scriptSource.indexOf('function focusTaskView(taskId) {');
    assert.ok(focusJobCaseStart >= 0, "expected focusJob view helper");
    assert.ok(editTaskCaseStart > focusJobCaseStart, "expected focusTask helper after focusJob helper");

    const focusJobCase = scriptSource.slice(focusJobCaseStart, editTaskCaseStart);
    assert.ok(
      focusJobCase.includes('renderJobsTab();'),
      "expected focusJob to rerender the jobs list",
    );
    assert.ok(
      focusJobCase.includes('switchTab("jobs");'),
      "expected focusJob to switch back to the jobs tab",
    );
    assert.ok(
      focusJobCase.includes('isCreatingJob = true;'),
      "expected focusJob to reset the jobs editor into create mode",
    );
    assert.ok(
      focusJobCase.includes('selectedJobId = "";'),
      "expected focusJob to clear the current editor job selection",
    );
    assert.strictEqual(
      focusJobCase.includes('openJobEditor('),
      false,
      "did not expect focusJob to reopen the jobs editor",
    );

    assert.ok(
      scriptSource.includes('function submitJobEditor()'),
      "expected shared job submit handler",
    );
    assert.ok(
      scriptSource.includes('bindClickAction(options.jobsSaveDeckBtn, options.submitJobEditor);'),
      "expected control deck save button to use the shared job submit handler",
    );
    assert.ok(
      scriptSource.includes('(String(metric.value || "").length > 18 ? \' is-compact\' : \'\')'),
      "expected long workflow metric values to opt into compact text styling",
    );
  });

  test("todo comments style human form input separately and todo saves reset to create mode", () => {
    const templateSource = readSchedulerWebviewTemplateSource();
    const actionHandlerPath = path.resolve(
      __dirname,
      "../../../src/todoCockpitActionHandler.ts",
    );
    const actionHandlerSource = fs.readFileSync(actionHandlerPath, "utf8");
    const scriptSource = readSchedulerWebviewScriptSource();
    const debugHelperSource = readSchedulerWebviewDebugSource();

    expectSourceToIncludeSnippets(templateSource, [
      '.todo-comments-spotlight{',
      '.todo-comments-layout{',
      'grid-template-columns: 1fr;',
      'id="todo-comment-count-badge"',
      'id="todo-comment-mode-pill"',
      'id="todo-comment-composer-title"',
      'id="todo-comment-thread-note"',
      '.todo-comment-card.is-user-form .todo-comment-author,',
      '.todo-comment-card.is-user-form .todo-comment-body{',
    ], "user comment styling");

    const composerMarkupIndex = templateSource.indexOf('class="todo-comment-composer-shell"');
    const threadMarkupIndex = templateSource.indexOf('class="todo-comment-thread-shell"');
    assert.ok(threadMarkupIndex >= 0, "expected thread preview shell in todo comments layout");
    assert.ok(composerMarkupIndex > threadMarkupIndex, "expected thread preview to appear before the composer in the template");

    expectSourceToIncludeSnippets(scriptSource, [
      'function renderTodoCommentSectionState(selectedTodo) {',
      'renderTodoCommentDraftPreviewMarkup(commentDraftValue)',
      'todoAddCommentBtn.hidden = !isEditingTodo;',
      'payload.comment = commentBody;',
      'var userFormClass = comment.source === "human-form" && String(comment.author || "").toLowerCase() === "user"',
      'var toneClass = getTodoCommentToneClass(comment);',
      `'<article class="todo-comment-card' + toneClass + userFormClass + '"`,
    ], "todo comment rendering");

    expectSourceToIncludeSnippets(debugHelperSource, [
      'comment: "",',
      'nextDraft.comment = params.todoCommentInput ? String(params.todoCommentInput.value || "") : "";',
      'hasComment: nextDraft.comment.length > 0,',
    ], "todo comment draft helper");

    const updateTodoCaseStart = actionHandlerSource.indexOf('case "updateTodo": {');
    const deleteTodoCaseStart = actionHandlerSource.indexOf('case "deleteTodo": {');
    assert.ok(updateTodoCaseStart >= 0, "expected updateTodo action handler");
    assert.ok(deleteTodoCaseStart > updateTodoCaseStart, "expected deleteTodo after updateTodo");

    const updateTodoCase = actionHandlerSource.slice(updateTodoCaseStart, deleteTodoCaseStart);
    assert.ok(
      updateTodoCase.includes('SchedulerWebview.startCreateTodo();'),
      "expected updated todo saves to reset the todo editor",
    );
    assert.ok(
      updateTodoCase.includes('SchedulerWebview.switchToTab("board");'),
      "expected updated todo saves to return to the board",
    );
  });

  test("Queues messages until ready and flushes (dedup by type)", () => {
    withPostedWebviewMessages({}, ({ sent, wv }) => {
      assert.ok(typeof wv.postMessage === "function");
      assert.ok(typeof wv.flushPendingMessages === "function");

      (wv.postMessage as (message: unknown) => void)({ type: "updateTasks", tasks: [1] });
      (wv.postMessage as (message: unknown) => void)({ type: "updateTasks", tasks: [2] });
      (wv.postMessage as (message: unknown) => void)({ type: "updateAgents", agents: ["a"] });

      const queued = (wv.pendingMessages ?? []) as Array<{
        type?: unknown;
        [key: string]: unknown;
      }>;
      assert.strictEqual(queued.length, 2);

      const queuedTasks = queued.find((message) => message.type === "updateTasks");
      assert.deepStrictEqual(queuedTasks?.tasks, [2]);

      wv.webviewReady = true;
      (wv.flushPendingMessages as () => void)();

      assert.strictEqual(sent.length, 2);
      const sentMessages = sent as Array<{ type?: unknown; [key: string]: unknown }>;
      assert.deepStrictEqual(
        sentMessages.find((message) => message.type === "updateTasks")?.tasks,
        [2],
      );
      assert.deepStrictEqual(
        sentMessages.find((message) => message.type === "updateAgents")?.agents,
        ["a"],
      );
      assert.strictEqual((wv.pendingMessages ?? []).length, 0);
    });
  });

  test("Batches repeated update messages while ready", () => {
    withPostedWebviewMessages(
      { ready: true, resetBatchState: true },
      ({ sent, wv }) => {
        assert.ok(typeof wv.postMessage === "function");
        assert.ok(typeof wv.flushPendingMessages === "function");

        (wv.postMessage as (message: unknown) => void)({ type: "updateTasks", tasks: [1] });
        (wv.postMessage as (message: unknown) => void)({ type: "updateTasks", tasks: [2] });
        (wv.postMessage as (message: unknown) => void)({
          type: "updateExecutionDefaults",
          executionDefaults: { agent: "agent", model: "gpt" },
        });

        const queued = (wv.pendingMessages ?? []) as Array<{
          type?: unknown;
          [key: string]: unknown;
        }>;
        assert.strictEqual(sent.length, 0);
        assert.strictEqual(queued.length, 2);
        assert.deepStrictEqual(
          queued.find((message) => message.type === "updateTasks")?.tasks,
          [2],
        );

        (wv.flushPendingMessages as () => void)();

        assert.strictEqual(sent.length, 2);
        assert.deepStrictEqual(
          (sent as Array<{ type?: unknown; [key: string]: unknown }>).find(
            (message) => message.type === "updateTasks",
          )?.tasks,
          [2],
        );
        assert.strictEqual((wv.pendingMessages ?? []).length, 0);
        assert.strictEqual(wv.pendingMessageFlushTimer, undefined);
      },
    );
  });

  test("Skips identical batched update payloads after they were already sent", () => {
    withPostedWebviewMessages(
      { ready: true, resetBatchState: true },
      ({ sent, wv }) => {
        assert.ok(typeof wv.postMessage === "function");
        assert.ok(typeof wv.flushPendingMessages === "function");

        (wv.postMessage as (message: unknown) => void)({
          type: "updateTasks",
          tasks: [{ id: "task-1" }],
        });
        (wv.flushPendingMessages as () => void)();
        assert.strictEqual(sent.length, 1);

        (wv.postMessage as (message: unknown) => void)({
          type: "updateTasks",
          tasks: [{ id: "task-1" }],
        });
        (wv.flushPendingMessages as () => void)();

        assert.strictEqual(sent.length, 1);
        assert.strictEqual((wv.pendingMessages ?? []).length, 0);
      },
    );
  });

  const queuedUpdateCases: QueuedUpdateCase[] = [
    {
      name: "Queues schedule history updates until ready",
      method: "updateScheduleHistory",
      args: [[{ id: "1", createdAt: "2026-03-23T00:00:00.000Z", hasPrivate: true }]],
      messageType: "updateScheduleHistory",
      verify: (message) => {
        assert.strictEqual(Array.isArray(message.entries), true);
      },
    },
    {
      name: "Queues research state updates until ready",
      method: "updateResearchState",
      args: [
        [{ id: "profile-1", name: "Research" }],
        { id: "run-1", status: "running" },
        [{ id: "run-1", status: "running" }],
      ],
      messageType: "updateResearchState",
      verify: (message) => {
        assert.strictEqual(Array.isArray(message.profiles), true);
        assert.strictEqual(Array.isArray(message.recentRuns), true);
        assert.strictEqual(
          (message.activeRun as { id?: string } | undefined)?.id,
          "run-1",
        );
      },
    },
    {
      name: "Queues Telegram notification updates until ready",
      method: "updateTelegramNotification",
      args: [{ enabled: true, chatId: "123456789", hasBotToken: true, hookConfigured: true }],
      messageType: "updateTelegramNotification",
      verify: (message) => {
        const telegramNotification = message.telegramNotification as
          | { enabled?: boolean; hasBotToken?: boolean }
          | undefined;
        assert.strictEqual(telegramNotification?.enabled, true);
        assert.strictEqual(telegramNotification?.hasBotToken, true);
      },
    },
    {
      name: "Queues execution default updates until ready",
      method: "updateExecutionDefaults",
      args: [{ agent: "agent", model: "gpt-test" }],
      messageType: "updateExecutionDefaults",
      verify: (message) => {
        const executionDefaults = message.executionDefaults as
          | { agent?: string; model?: string }
          | undefined;
        assert.strictEqual(executionDefaults?.agent, "agent");
        assert.strictEqual(executionDefaults?.model, "gpt-test");
      },
    },
    {
      name: "Queues storage settings updates until ready",
      method: "updateStorageSettings",
      args: [{
        mode: "sqlite",
        sqliteJsonMirror: false,
        disabledSystemFlagKeys: ["ready"],
        appVersion: "99.0.78",
        mcpSetupStatus: "configured",
        lastMcpSupportUpdateAt: "2026-04-04T10:00:00.000Z",
        lastBundledSkillsSyncAt: "2026-04-04T10:01:00.000Z",
      }],
      messageType: "updateStorageSettings",
      verify: (message) => {
        const storageSettings = message.storageSettings as
          | {
              mode?: string;
              sqliteJsonMirror?: boolean;
              disabledSystemFlagKeys?: string[];
            }
          | undefined;
        assert.strictEqual(storageSettings?.mode, "sqlite");
        assert.strictEqual(storageSettings?.sqliteJsonMirror, false);
        assert.deepStrictEqual(storageSettings?.disabledSystemFlagKeys, ["ready"]);
      },
    },
    {
      name: "Queues cockpit board updates until ready",
      method: "updateCockpitBoard",
      args: [{
        version: 1,
        sections: [{ id: "section_0", title: "Bugs", order: 0 }],
        cards: [{ id: "card_1", title: "Fix config leak", sectionId: "section_0", order: 0 }],
      }],
      messageType: "updateCockpitBoard",
      verify: (message) => {
        const cockpitBoard = message.cockpitBoard as
          | { sections?: unknown[]; cards?: unknown[] }
          | undefined;
        assert.strictEqual(cockpitBoard?.sections?.length, 1);
        assert.strictEqual(cockpitBoard?.cards?.length, 1);
      },
    },
  ];

  queuedUpdateCases.forEach(({ args, messageType, method, name, verify }) => {
    test(name, () => {
      withPostedWebviewMessages({}, ({ sent, wv }) => {
        const updater = wv[method];
        assert.ok(typeof updater === "function");

        (updater as (...values: unknown[]) => void).call(wv, ...args);

        const queued = (wv.pendingMessages ?? []) as Array<{ type?: unknown }>;
        assert.strictEqual(queued.length, 1);
        assert.strictEqual(queued[0]?.type, messageType);

        wv.webviewReady = true;
        (wv.flushPendingMessages as () => void)();

        assert.strictEqual(sent.length, 1);
        const message = sent[0] as { type?: unknown } & Record<string, unknown>;
        assert.strictEqual(message.type, messageType);
        verify(message);
      });
    });
  });

  test("board target helpers resolve text-node button clicks", () => {
    const helpers = loadBoardInteractionModule();
    const button = {
      id: "edit-button",
      closest: (selector: string) => (selector === "[data-todo-edit]" ? button : null),
    };
    const textNode = {
      nodeType: 3,
      parentElement: button,
    };

    assert.strictEqual(
      helpers.getEventTargetElement({ target: textNode }),
      button,
    );
    assert.strictEqual(
      helpers.getClosestEventTarget({ target: textNode }, "[data-todo-edit]"),
      button,
    );
  });

  test("board drag-handle helper keeps drag handles draggable", () => {
    const helpers = loadBoardInteractionModule();
    const dragHandle = {
      closest: (selector: string) => {
        if (selector === "[data-todo-drag-handle], [data-section-drag-handle]") {
          return dragHandle;
        }
        if (selector.includes("[data-no-drag]")) {
          return dragHandle;
        }
        return null;
      },
    };
    const textNode = {
      nodeType: 3,
      parentElement: dragHandle,
    };

    assert.strictEqual(helpers.isBoardDragHandleTarget(textNode), true);
    assert.strictEqual(helpers.isTodoInteractiveTarget(textNode), true);
  });

  test("board target helpers treat custom todo action controls as interactive", () => {
    const helpers = loadBoardInteractionModule();
    const actionControl = {
      closest: (selector: string) => {
        if (selector.includes("[data-todo-delete]")) {
          return actionControl;
        }
        return null;
      },
    };

    assert.strictEqual(helpers.isTodoInteractiveTarget(actionControl), true);
  });

  test("board target helpers ignore plain non-interactive text nodes", () => {
    const helpers = loadBoardInteractionModule();
    const cardBody = {
      closest: () => null,
    };
    const textNode = {
      nodeType: 3,
      parentElement: cardBody,
    };

    assert.strictEqual(helpers.isTodoInteractiveTarget(textNode), false);
    assert.strictEqual(
      helpers.getClosestEventTarget({ target: textNode }, "[data-todo-delete]"),
      null,
    );
  });

  test("board interaction binding installs direct listeners and routes text-node edit clicks", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    const editButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-edit" ? "todo-1" : ""),
      closest: (selector: string) => (selector === "[data-todo-edit]" ? editButton : selector === "[data-todo-id]" ? null : null),
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === editButton || value === textNode,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-todo-edit]") return [editButton];
        return [];
      },
    });
    const textNode = {
      nodeType: 3,
      parentElement: editButton,
    };

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: (todoId: string) => calls.push(`edit:${todoId}`),
      openTodoDeleteModal: () => calls.push("delete"),
      handleSectionCollapse: () => calls.push("collapse"),
      handleSectionRename: () => calls.push("rename"),
      handleSectionDelete: () => calls.push("section-delete"),
      handleTodoCompletion: () => calls.push("complete"),
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: () => undefined,
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => undefined,
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof boardColumns.listeners.click === "function");
    assert.ok(typeof windowListeners.pointermove === "function");
    assert.ok(typeof windowListeners.pointerup === "function");

    boardColumns.listeners.click({
      target: textNode,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.deepStrictEqual(calls, ["edit:todo-1"]);
  });

  test("board interaction binding handles todo completion on click", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const checkbox = createListenerTarget({
      checked: true,
      getAttribute: (name: string) => (name === "data-todo-complete" ? "todo-1" : ""),
      closest: (selector: string) => (selector === "[data-todo-complete]" ? checkbox : null),
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === checkbox,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-todo-complete]") return [checkbox];
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: () => undefined,
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: () => calls.push("edit"),
      openTodoDeleteModal: () => calls.push("delete"),
      handleSectionCollapse: () => calls.push("collapse"),
      handleSectionRename: () => calls.push("rename"),
      handleSectionDelete: () => calls.push("section-delete"),
      handleTodoCompletion: () => calls.push("complete"),
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: () => undefined,
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => undefined,
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof boardColumns.listeners.click === "function");
    boardColumns.listeners.click({
      target: checkbox,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    assert.deepStrictEqual(calls, ["complete"]);
  });

  test("board interaction binding routes inline delete confirmation, restore, and purge clicks", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const deleteButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-delete" ? "todo-ready" : ""),
      closest: (selector: string) => (selector === "[data-todo-delete]" ? deleteButton : null),
    });
    const rejectChoiceButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-delete-reject" ? "todo-ready" : ""),
      closest: (selector: string) => (selector === "[data-todo-delete-reject]" ? rejectChoiceButton : null),
    });
    const restoreButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-restore" ? "todo-archived" : ""),
      closest: (selector: string) => (selector === "[data-todo-restore]" ? restoreButton : null),
    });
    const purgeButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-purge" ? "todo-purge" : ""),
      closest: (selector: string) => (selector === "[data-todo-purge]" ? purgeButton : null),
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === deleteButton || value === rejectChoiceButton || value === restoreButton || value === purgeButton,
      querySelectorAll: () => [],
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: () => undefined,
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: () => calls.push("edit"),
      openTodoDeleteModal: () => calls.push("delete"),
      setPendingBoardDelete: (_todoId: string, permanentOnly: boolean) => calls.push(permanentOnly ? "purge-confirm" : "delete-confirm"),
      clearPendingBoardDelete: () => calls.push("delete-cancel"),
      submitBoardDeleteChoice: (choice: string) => calls.push("delete-" + choice),
      handleSectionCollapse: () => calls.push("collapse"),
      handleSectionRename: () => calls.push("rename"),
      handleSectionDelete: () => calls.push("section-delete"),
      handleTodoCompletion: () => calls.push("complete"),
      handleTodoRestore: () => calls.push("restore"),
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: () => undefined,
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => undefined,
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof boardColumns.listeners.click === "function");

    boardColumns.listeners.click({
      target: deleteButton,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    boardColumns.listeners.click({
      target: rejectChoiceButton,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    boardColumns.listeners.click({
      target: restoreButton,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    boardColumns.listeners.click({
      target: purgeButton,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.deepStrictEqual(calls, ["delete-confirm", "delete-reject", "restore", "purge-confirm"]);
  });

  test("board interaction binding collapses sections when clicking the section header", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const collapseButton = createListenerTarget({
      getAttribute: (name: string) => (name === "data-section-collapse" ? "section-a" : ""),
      closest: (selector: string) => (selector === "[data-section-collapse]" ? collapseButton : null),
    });
    const sectionHeader = createListenerTarget({
      querySelector: (selector: string) => (selector === "[data-section-collapse]" ? collapseButton : null),
      closest: (selector: string) => (selector === ".cockpit-section-header" ? sectionHeader : null),
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === sectionHeader || value === collapseButton,
      querySelectorAll: () => [],
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: () => undefined,
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: () => calls.push("edit"),
      openTodoDeleteModal: () => calls.push("delete"),
      setPendingBoardDelete: () => calls.push("delete-confirm"),
      clearPendingBoardDelete: () => calls.push("delete-cancel"),
      submitBoardDeleteChoice: () => calls.push("delete-submit"),
      handleSectionCollapse: () => calls.push("collapse"),
      handleSectionRename: () => calls.push("rename"),
      handleSectionDelete: () => calls.push("section-delete"),
      handleTodoCompletion: () => calls.push("complete"),
      handleTodoRestore: () => calls.push("restore"),
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: () => undefined,
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => undefined,
      isArchiveTodoSectionId: () => false,
      isSpecialTodoSectionId: () => false,
    });

    assert.ok(typeof boardColumns.listeners.click === "function");
    boardColumns.listeners.click({
      target: sectionHeader,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.deepStrictEqual(calls, ["collapse"]);
  });

  test("board todo completion approves active cards and uses yes no finalize controls for ready cards", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const insertedButtons: any[] = [];
    const createMockButton = (todoId: string, cardEl: any = null) => {
      const attrs: Record<string, string> = {
        "data-todo-complete": todoId,
        title: "Approve",
        "aria-label": "Approve",
      };
      const classes = new Set<string>();
      return {
        disabled: false,
        innerHTML: "<span>○</span>",
        parentNode: {
          insertBefore: (node: unknown) => {
            insertedButtons.push(node);
          },
        },
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
        },
        getAttribute: (name: string) => attrs[name] || "",
        setAttribute: (name: string, value: string) => {
          attrs[name] = String(value);
        },
        removeAttribute: (name: string) => {
          delete attrs[name];
        },
        hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attrs, name),
        closest: (selector: string) => (selector === "[data-todo-id]" ? cardEl : null),
      };
    };
    const createMockDocument = () => ({
      createElement: () => {
        const attrs: Record<string, string> = {};
        const element = {
          type: "button",
          className: "",
          textContent: "",
          style: {},
          removed: false,
          parentNode: {
            removeChild: () => {
              element.removed = true;
            },
          },
          setAttribute: (name: string, value: string) => {
            attrs[name] = String(value);
          },
          getAttribute: (name: string) => attrs[name] || "",
          onclick: undefined as undefined | ((event: unknown) => void),
        };
        return element;
      },
    });
    const activeToggle = createMockButton("todo-active");
    let readyCancelButton: any = null;
    const readyCardElement = {
      style: {
        opacity: "",
        pointerEvents: "",
      },
      querySelector: (selector: string) => {
        if (selector === '[data-todo-finalize-cancel="todo-ready"]') {
          return readyCancelButton;
        }
        return null;
      },
    };
    const readyToggle = createMockButton("todo-ready", readyCardElement);

    const interactionOptions = {
      document: createMockDocument(),
      setTimeout: () => 1,
      strings: {
        boardFinalizeTodoYes: "Yes",
        boardFinalizeTodoNo: "No",
        boardFinalizePrompt: "Archive this todo as completed successfully?",
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
    };

    helpers.handleBoardTodoCompletion(activeToggle, {
      cockpitBoard: {
        cards: [
          { id: "todo-active", status: "active" },
        ],
      },
      ...interactionOptions,
    });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [
      { type: "approveTodo", todoId: "todo-active" },
    ]);

    helpers.handleBoardTodoCompletion(readyToggle, {
      cockpitBoard: {
        cards: [
          { id: "todo-ready", status: "active", flags: ["FINAL-USER-CHECK"] },
        ],
      },
      ...interactionOptions,
    });
    assert.strictEqual(postedMessages.length, 1);
    assert.strictEqual(readyToggle.getAttribute("data-confirming"), "1");
    assert.strictEqual(readyToggle.getAttribute("data-finalize-state"), "confirming");
    assert.strictEqual(readyToggle.innerHTML, "<span aria-hidden=\"true\">Yes</span>");
    assert.strictEqual(insertedButtons.length, 1);
    readyCancelButton = insertedButtons[0];
    assert.strictEqual(readyCancelButton.textContent, "No");
    assert.strictEqual(readyCancelButton.className, "todo-complete-button is-cancel");

    readyCancelButton.onclick?.({
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });
    assert.strictEqual(readyToggle.getAttribute("data-confirming"), "");
    assert.strictEqual(readyToggle.getAttribute("data-finalize-state"), "idle");
    assert.strictEqual(readyToggle.innerHTML, "<span>○</span>");
    assert.strictEqual(readyCancelButton.removed, true);

    helpers.handleBoardTodoCompletion(readyToggle, {
      cockpitBoard: {
        cards: [
          { id: "todo-ready", status: "active", flags: ["FINAL-USER-CHECK"] },
        ],
      },
      ...interactionOptions,
    });
    readyCancelButton = insertedButtons[1];

    helpers.handleBoardTodoCompletion(readyToggle, {
      cockpitBoard: {
        cards: [
          { id: "todo-ready", status: "active", flags: ["FINAL-USER-CHECK"] },
        ],
      },
      ...interactionOptions,
    });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [
      { type: "approveTodo", todoId: "todo-active" },
      { type: "finalizeTodo", todoId: "todo-ready" },
    ]);
    assert.strictEqual(readyToggle.disabled, true);
    assert.strictEqual(readyCardElement.style.opacity, "0.35");
    assert.strictEqual(readyCardElement.style.pointerEvents, "none");
  });

  test("todo editor completion requires a confirm step before finalizing ready cards", () => {
    const scriptSource = readSchedulerWebviewScriptSource();

    expectSourceToIncludeSnippets(
      scriptSource,
      [
      'var actionType = getTodoCompletionActionType(selectedTodo);',
      'if (actionType === "finalizeTodo") {',
      'window.confirm(strings.boardFinalizePrompt || "Archive this todo as completed successfully?")',
      'type: actionType,',
      ],
      "todo editor finalize confirm",
    );
  });

  test("archived todo completion button restores instead of completing again", () => {
    const scriptSource = readSchedulerWebviewScriptSource();
    const boardRenderingSource = readBoardRenderingSource();

    expectSourceToIncludeSnippets(scriptSource, [
      'var actionAttr = isArchivedCard ? \'data-todo-restore\' : \'data-todo-complete\';',
      "className += ' is-completed';",
      'data-finalize-state="idle"',
      'strings.boardRestoreTodo || "Restore"',
      'strings.boardDeleteTodoPermanentPrompt || "Delete this archived todo permanently? This cannot be undone."',
    ], "archived completion or purge modal");

    expectSourceToIncludeSnippets(boardRenderingSource, [
      'renderActionButton(',
      "'data-todo-purge'",
      "strings.boardDeleteTodoPermanent || 'Delete Permanently'",
    ], "archived board actions");
  });

  test("board interaction binding uses pointer drag for todo moves", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    const classAdds: string[] = [];
    const classRemoves: string[] = [];
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;
    const bodyClassToggles: string[] = [];
    const section = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-b";
        if (name === "data-card-count") return "3";
        return "";
      },
      classList: {
        add: (name: string) => classAdds.push(`section:${name}`),
        remove: (name: string) => classRemoves.push(`section:${name}`),
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? section : null),
    };
    const dropCard = {
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-2";
        if (name === "data-order") return "2";
        return "";
      },
      classList: {
        add: (name: string) => classAdds.push(`drop:${name}`),
        remove: (name: string) => classRemoves.push(`drop:${name}`),
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return dropCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => (name === "data-todo-id" ? "todo-1" : ""),
      classList: {
        add: (name: string) => classAdds.push(`dragged:${name}`),
        remove: (name: string) => classRemoves.push(`dragged:${name}`),
      },
    });
    const dragHandle = {
      getAttribute: (name: string) => (name === "data-todo-drag-handle" ? "todo-1" : ""),
      closest: (selector: string) => {
        if (selector === "[data-todo-drag-handle]") return dragHandle;
        if (selector === "[data-todo-id]") return draggedCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const boardColumns = {
      contains: (value: unknown) => value === dragHandle || value === draggedCard || value === dropCard || value === section,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-section-id]") return [section];
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    };

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
        body: {
          classList: {
            toggle: (name: string, value: boolean) => {
              bodyClassToggles.push(`${name}:${value}`);
            },
          },
          style: {
            userSelect: "",
            webkitUserSelect: "",
            cursor: "",
          },
        },
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof draggedCard.listeners.pointerdown === "function");

    draggedCard.listeners.pointerdown({
      button: 0,
      target: dragHandle,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.strictEqual(draggingTodoId, "todo-1");
    assert.strictEqual(isBoardDragging, true);

    pointTarget = dropCard;
    windowListeners.pointermove({ clientX: 20, clientY: 30 });
    windowListeners.pointerup({ clientX: 20, clientY: 30 });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [{
      type: "moveTodo",
      todoId: "todo-1",
      sectionId: "section-b",
      targetIndex: 2,
    }]);
    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
    assert.ok(classAdds.includes("dragged:todo-dragging"));
    assert.ok(bodyClassToggles.includes("cockpit-board-dragging:true"));
    assert.ok(bodyClassToggles.includes("cockpit-board-dragging:false"));
  });

  test("board interaction binding starts todo drag from card body after movement threshold", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;
    const section = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-b";
        if (name === "data-card-count") return "3";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? section : null),
    };
    const dropCard = {
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-2";
        if (name === "data-order") return "2";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return dropCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-1";
        if (name === "data-section-id") return "section-a";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    });
    const cardBody = {
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    };
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === cardBody || value === draggedCard || value === dropCard || value === section,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-section-id]") return [section];
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    draggedCard.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: cardBody,
    });

    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);

    pointTarget = dropCard;
    windowListeners.pointermove({ clientX: 24, clientY: 24 });

    assert.strictEqual(draggingTodoId, "todo-1");
    assert.strictEqual(isBoardDragging, true);

    windowListeners.pointerup({ clientX: 24, clientY: 24 });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [{
      type: "moveTodo",
      todoId: "todo-1",
      sectionId: "section-b",
      targetIndex: 2,
    }]);
    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
  });

  test("board interaction binding does not start todo drag from todo action buttons", () => {
    const helpers = loadBoardInteractionModule();
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-1";
        if (name === "data-section-id") return "section-a";
        return "";
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    });
    const editButton = {
      closest: (selector: string) => {
        if (selector.includes("button") || selector.includes("[data-todo-edit]")) return editButton;
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    };
    const boardColumns = {
      contains: (value: unknown) => value === editButton || value === draggedCard,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    };

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {},
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: { postMessage: () => undefined },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    draggedCard.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: editButton,
    });

    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);

    if (windowListeners.pointermove) {
      windowListeners.pointermove({ clientX: 24, clientY: 24 });
    }

    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
  });

  test("board interaction binding suppresses follow-up click selection after drag", () => {
    const helpers = loadBoardInteractionModule();
    const calls: string[] = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingTodoId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;
    const section = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-b";
        if (name === "data-card-count") return "3";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? section : null),
    };
    const dropCard = {
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-2";
        if (name === "data-order") return "2";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return dropCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    };
    const draggedCard = createListenerTarget({
      getAttribute: (name: string) => {
        if (name === "data-todo-id") return "todo-1";
        if (name === "data-section-id") return "section-a";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        if (selector === "[data-section-id]") return section;
        return null;
      },
    });
    const cardBody = {
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return draggedCard;
        return null;
      },
    };
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === cardBody || value === draggedCard || value === dropCard || value === section,
      querySelectorAll: (selector: string) => {
        if (selector === "[data-section-id]") return [section];
        if (selector === "[data-todo-id]") return [draggedCard];
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: () => undefined,
      },
      renderCockpitBoard: () => calls.push("render"),
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => calls.push("select"),
      getDraggingSectionId: () => null,
      setDraggingSectionId: () => undefined,
      getLastDragOverSectionId: () => null,
      setLastDragOverSectionId: () => undefined,
      getDraggingTodoId: () => draggingTodoId,
      setDraggingTodoId: (value: string | null) => {
        draggingTodoId = value;
      },
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingTodoId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    draggedCard.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: cardBody,
    });

    pointTarget = dropCard;
    windowListeners.pointermove({ clientX: 24, clientY: 24 });
    windowListeners.pointerup({ clientX: 24, clientY: 24 });

    assert.ok(typeof boardColumns.listeners.click === "function");

    boardColumns.listeners.click({
      target: draggedCard,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.deepStrictEqual(calls, []);
    assert.strictEqual(draggingTodoId, null);
    assert.strictEqual(isBoardDragging, false);
  });

  test("board interaction binding reorders sections using only section elements", () => {
    const helpers = loadBoardInteractionModule();
    const postedMessages: Array<Record<string, unknown>> = [];
    const windowListeners: Record<string, (event: Record<string, unknown>) => void> = {};
    let draggingSectionId: string | null = null;
    let lastDragOverSectionId: string | null = null;
    let isBoardDragging = false;
    let pointTarget: unknown = null;

    const draggedSection = createListenerTarget({
      getAttribute: (name: string) => (name === "data-section-id" ? "section-a" : ""),
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? draggedSection : null),
    });
    const nestedTodoCard = {
      getAttribute: (name: string) => {
        if (name === "data-section-id") return "section-a";
        if (name === "data-todo-id") return "todo-1";
        return "";
      },
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => {
        if (selector === "[data-todo-id]") return nestedTodoCard;
        if (selector === "[data-section-id]") return draggedSection;
        return null;
      },
    };
    const dropSection = {
      getAttribute: (name: string) => (name === "data-section-id" ? "section-b" : ""),
      classList: {
        add: () => undefined,
        remove: () => undefined,
      },
      closest: (selector: string) => (selector === "[data-section-id]" ? dropSection : null),
    };
    const sectionHandle = createListenerTarget({
      getAttribute: (name: string) => (name === "data-section-drag-handle" ? "section-a" : ""),
      closest: (selector: string) => {
        if (selector === "[data-section-drag-handle]") return sectionHandle;
        if (selector === "[data-section-id]") return draggedSection;
        return null;
      },
    });
    const boardColumns = createListenerTarget({
      contains: (value: unknown) => value === sectionHandle || value === draggedSection || value === nestedTodoCard || value === dropSection,
      querySelectorAll: (selector: string) => {
        if (selector === ".board-column[data-section-id], .todo-list-section[data-section-id]") {
          return [draggedSection, dropSection];
        }
        if (selector === "[data-section-id].section-drag-over") return [];
        if (selector === "[data-section-id].section-dragging") return [];
        if (selector === "[data-todo-id].todo-dragging") return [];
        if (selector === "[data-todo-id].todo-drop-target") return [];
        if (selector === "[data-section-drag-handle]") return [sectionHandle];
        if (selector === "[data-todo-id]") return [nestedTodoCard];
        if (selector === "[data-section-id]") {
          return [draggedSection, nestedTodoCard as any, dropSection];
        }
        return [];
      },
    });

    helpers.bindBoardColumnInteractions({
      boardColumns,
      getBoardColumns: () => boardColumns,
      document: {
        elementFromPoint: () => pointTarget,
        body: {
          classList: { toggle: () => undefined },
          style: { userSelect: "", webkitUserSelect: "", cursor: "" },
        },
      },
      window: {
        addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => {
          windowListeners[name] = handler;
        },
      },
      vscode: {
        postMessage: (message: Record<string, unknown>) => {
          postedMessages.push(message);
        },
      },
      renderCockpitBoard: () => undefined,
      openTodoEditor: () => undefined,
      openTodoDeleteModal: () => undefined,
      handleSectionCollapse: () => undefined,
      handleSectionRename: () => undefined,
      handleSectionDelete: () => undefined,
      handleTodoCompletion: () => undefined,
      setSelectedTodoId: () => undefined,
      getDraggingSectionId: () => draggingSectionId,
      setDraggingSectionId: (value: string | null) => {
        draggingSectionId = value;
      },
      getLastDragOverSectionId: () => lastDragOverSectionId,
      setLastDragOverSectionId: (value: string | null) => {
        lastDragOverSectionId = value;
      },
      getDraggingTodoId: () => null,
      setDraggingTodoId: () => undefined,
      setIsBoardDragging: (value: boolean) => {
        isBoardDragging = value;
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      finishBoardDragState: () => {
        draggingSectionId = null;
        lastDragOverSectionId = null;
        isBoardDragging = false;
      },
      isArchiveTodoSectionId: () => false,
    });

    assert.ok(typeof sectionHandle.listeners.pointerdown === "function");

    sectionHandle.listeners.pointerdown({
      button: 0,
      clientX: 10,
      clientY: 10,
      target: sectionHandle,
      stopPropagation: () => undefined,
      preventDefault: () => undefined,
    });

    assert.strictEqual(draggingSectionId, "section-a");
    assert.strictEqual(isBoardDragging, true);

    pointTarget = dropSection;
    windowListeners.pointermove({ clientX: 24, clientY: 24 });
    windowListeners.pointerup({ clientX: 24, clientY: 24 });

    assert.deepStrictEqual(JSON.parse(JSON.stringify(postedMessages)), [{
      type: "reorderCockpitSection",
      sectionId: "section-a",
      targetIndex: 1,
    }]);
    assert.strictEqual(draggingSectionId, null);
    assert.strictEqual(lastDragOverSectionId, null);
    assert.strictEqual(isBoardDragging, false);
  });
});

suite("SchedulerWebview Jobs Request Tests", () => {
  test("requestCreateJob uses VS Code input boxes and dispatches createJob", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalShowInputBox = (vscode.window as any).showInputBox;
    const actions: unknown[] = [];
    let promptCount = 0;

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      (vscode.window as any).showInputBox = async () => {
        promptCount += 1;
        return "Morning Review";
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestCreateJob",
        folderId: "folder-1",
      });

      assert.strictEqual(promptCount, 1);
      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "createJob",
        taskId: "__job__",
        jobData: {
          name: "Morning Review",
          cronExpression: "0 9 * * 1-5",
          folderId: "folder-1",
        },
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      (vscode.window as any).showInputBox = originalShowInputBox;
    }
  });

  test("requestDeleteJobFolder confirms before dispatching deleteJobFolder", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobFolders?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalFolders = wv.currentJobFolders;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobFolders = [{ id: "folder-1", name: "Ops" }];
      (vscode.window as any).showWarningMessage = async () => "Yes, delete";

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobFolder",
        folderId: "folder-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "deleteJobFolder",
        taskId: "__jobfolder__",
        folderId: "folder-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobFolders = originalFolders;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("requestDeleteJobTask can detach from workflow without deleting the task", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; taskId: string }>;
      }>;
      currentTasks?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalTasks = wv.currentTasks;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{ id: "job-1", nodes: [{ id: "node-1", taskId: "task-1" }] }];
      wv.currentTasks = [{ id: "task-1", name: "Review prompt" }];
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDetachOnly();

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobTask",
        jobId: "job-1",
        nodeId: "node-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "detachTaskFromJob",
        taskId: "__jobtask__",
        jobId: "job-1",
        nodeId: "node-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      wv.currentTasks = originalTasks;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("requestDeleteJobTask can delete the task entirely", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; taskId: string }>;
      }>;
      currentTasks?: Array<{ id: string; name: string }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalTasks = wv.currentTasks;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{ id: "job-1", nodes: [{ id: "node-1", taskId: "task-1" }] }];
      wv.currentTasks = [{ id: "task-1", name: "Review prompt" }];
      (vscode.window as any).showWarningMessage = async () => messages.confirmDeleteJobStepDeleteTask();

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestDeleteJobTask",
        jobId: "job-1",
        nodeId: "node-1",
      });

      assert.strictEqual(actions.length, 1);
      assert.deepStrictEqual(actions[0], {
        action: "deleteJobTask",
        taskId: "__jobtask__",
        jobId: "job-1",
        nodeId: "node-1",
      });
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      wv.currentTasks = originalTasks;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("createJobPause and compileJob forward the expected task actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "createJobPause",
        jobId: "job-1",
        data: { title: "Review checkpoint" },
      });
      await wv.handleMessage!({
        type: "compileJob",
        jobId: "job-1",
      });

      assert.deepStrictEqual(actions, [
        {
          action: "createJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          pauseData: { title: "Review checkpoint" },
        },
        {
          action: "compileJob",
          taskId: "__job__",
          jobId: "job-1",
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("requestRenameJobPause and requestDeleteJobPause prompt before dispatching", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
      currentJobs?: Array<{
        id: string;
        nodes: Array<{ id: string; type?: string; title?: string }>;
      }>;
    };

    const originalAction = wv.onTaskActionCallback;
    const originalJobs = wv.currentJobs;
    const originalShowInputBox = (vscode.window as any).showInputBox;
    const originalShowWarningMessage = (vscode.window as any).showWarningMessage;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };
      wv.currentJobs = [{
        id: "job-1",
        nodes: [{ id: "pause-1", type: "pause", title: "Review" }],
      }];
      (vscode.window as any).showInputBox = async () => "Updated Review";
      (vscode.window as any).showWarningMessage = async () => "Yes, delete";

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "requestRenameJobPause",
        jobId: "job-1",
        nodeId: "pause-1",
      });
      await wv.handleMessage!({
        type: "requestDeleteJobPause",
        jobId: "job-1",
        nodeId: "pause-1",
      });

      assert.deepStrictEqual(actions, [
        {
          action: "updateJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          nodeId: "pause-1",
          pauseUpdateData: { title: "Updated Review" },
        },
        {
          action: "deleteJobPause",
          taskId: "__jobpause__",
          jobId: "job-1",
          nodeId: "pause-1",
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
      wv.currentJobs = originalJobs;
      (vscode.window as any).showInputBox = originalShowInputBox;
      (vscode.window as any).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("createTask and updateTask dispatch edit actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "createTask",
        data: { name: "New task", prompt: "Prompt", cronExpression: "* * * * *" },
      });
      await wv.handleMessage!({
        type: "updateTask",
        taskId: "task-1",
        data: { name: "Updated task" },
      });

      assert.deepStrictEqual(actions, [
        {
          action: "edit",
          taskId: "__create__",
          data: { name: "New task", prompt: "Prompt", cronExpression: "* * * * *" },
        },
        {
          action: "edit",
          taskId: "task-1",
          data: { name: "Updated task" },
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("settings messages dispatch the expected task actions", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTaskActionCallback?: ((action: unknown) => void) | undefined;
    };

    const originalAction = wv.onTaskActionCallback;
    const actions: unknown[] = [];

    try {
      wv.onTaskActionCallback = (action: unknown) => {
        actions.push(action);
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({ type: "restoreScheduleHistory", snapshotId: "snap-1" });
      await wv.handleMessage!({ type: "toggleAutoShowOnStartup" });
      await wv.handleMessage!({ type: "setupMcp" });
      await wv.handleMessage!({ type: "syncBundledSkills" });
      await wv.handleMessage!({ type: "importStorageFromJson" });
      await wv.handleMessage!({ type: "exportStorageToJson" });
      await wv.handleMessage!({
        type: "saveTelegramNotification",
        data: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
      });
      await wv.handleMessage!({
        type: "testTelegramNotification",
        data: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
      });
      await wv.handleMessage!({
        type: "saveExecutionDefaults",
        data: { agent: "agent", model: "gpt-4o" },
      });

      assert.deepStrictEqual(actions, [
        {
          action: "restoreHistory",
          taskId: "__history__",
          historyId: "snap-1",
        },
        {
          action: "refresh",
          taskId: "__toggleAutoShowOnStartup__",
        },
        {
          action: "setupMcp",
          taskId: "__settings__",
        },
        {
          action: "syncBundledSkills",
          taskId: "__settings__",
        },
        {
          action: "importStorageFromJson",
          taskId: "__settings__",
        },
        {
          action: "exportStorageToJson",
          taskId: "__settings__",
        },
        {
          action: "saveTelegramNotification",
          taskId: "__settings__",
          telegramData: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
        },
        {
          action: "testTelegramNotification",
          taskId: "__settings__",
          telegramData: { enabled: true, botToken: "token", chatId: "chat", messagePrefix: "prefix" },
        },
        {
          action: "saveExecutionDefaults",
          taskId: "__settings__",
          executionDefaults: { agent: "agent", model: "gpt-4o" },
        },
      ]);
    } finally {
      wv.onTaskActionCallback = originalAction;
    }
  });

  test("testPrompt invokes the configured callback", async () => {
    const wv = SchedulerWebview as unknown as {
      handleMessage?: (message: unknown) => Promise<void>;
      onTestPromptCallback?: ((prompt: string, agent?: string, model?: string) => void) | undefined;
    };

    const originalCallback = wv.onTestPromptCallback;
    const calls: Array<{ prompt: string; agent?: string; model?: string }> = [];

    try {
      wv.onTestPromptCallback = (prompt: string, agent?: string, model?: string) => {
        calls.push({ prompt, agent, model });
      };

      assert.ok(typeof wv.handleMessage === "function");
      await wv.handleMessage!({
        type: "testPrompt",
        prompt: "Ping",
        agent: "agent",
        model: "gpt-4o",
      });

      assert.deepStrictEqual(calls, [
        { prompt: "Ping", agent: "agent", model: "gpt-4o" },
      ]);
    } finally {
      wv.onTestPromptCallback = originalCallback;
    }
  });

  test("refreshAgents and refreshPrompts post refreshed caches", async () => {
    await withRefreshCacheHarness(async ({ sent, wv }) => {
      assert.ok(typeof wv.handleMessage === "function");
      assert.ok(typeof wv.flushPendingMessages === "function");
      await wv.handleMessage?.({ type: "refreshAgents" });
      await wv.handleMessage?.({ type: "refreshPrompts" });
      wv.flushPendingMessages?.();

      assert.deepStrictEqual(sent, [
        { type: "updateAgents", agents: [{ id: "agent" }] },
        { type: "updateModels", models: [{ id: "gpt-4o" }] },
        { type: "updatePromptTemplates", templates: [{ path: "prompt.md" }] },
        { type: "updateSkills", skills: [{ path: "SKILL.md" }] },
      ]);
    });
  });
});

suite("SchedulerWebview settings target Tests", () => {
  test("uses workspace-folder target for resource-scoped settings when a folder is open", () => {
    const restore = overrideWorkspaceFolders(path.join(process.cwd(), "test-workspace"));

    try {
      assert.strictEqual(
        getResourceScopedSettingsTarget(),
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    } finally {
      restore();
    }
  });

  test("falls back to global target when no workspace folder is open", () => {
    const restore = overrideWorkspaceFolders();

    try {
      assert.strictEqual(
        getResourceScopedSettingsTarget(),
        vscode.ConfigurationTarget.Global,
      );
    } finally {
      restore();
    }
  });
});

suite("SchedulerWebview Error Detail Sanitization Tests", () => {
  test("Sanitizes absolute paths to basenames (Windows and POSIX)", () => {
    const wv = SchedulerWebview as unknown as RefreshableSchedulerWebviewInternals;

    assert.ok(typeof wv.sanitizeErrorDetailsForUser === "function");

    const sanitize = wv.sanitizeErrorDetailsForUser!;

    expectSanitizedPathResult(
      sanitize,
      "ENOENT: no such file or directory, open 'C:\\Users\\me\\secret folder\\a b.md'",
      "C:\\Users\\me",
      "'a b.md'",
    );
    expectSanitizedPathResult(
      sanitize,
      "ENOENT: no such file or directory, open '/Users/me/secret folder/a b.md'",
      "/Users/me/secret folder",
      "'a b.md'",
    );
    expectSanitizedPathResult(
      sanitize,
      "open /Users/me/a.md",
      "/Users/me/",
      "a.md",
    );
    expectSanitizedPathResult(
      sanitize,
      "at foo (/Users/me/a.md:1:2)",
      "/Users/me/",
      "(a.md:1:2)",
    );
    expectSanitizedPathResult(
      sanitize,
      "open C:/Users/me/a.md",
      "C:/Users/me/",
      "a.md",
    );
    expectSanitizedPathResult(
      sanitize,
      "open \\\\server\\share\\secret\\a.md",
      "\\\\server\\share",
      "a.md",
    );
    expectSanitizedPathResult(
      sanitize,
      "open file:///C:/Users/me/secret%20folder/a%20b.md",
      "file:///C:/Users/me",
      "a b.md",
    );
    expectSanitizedPathResult(
      sanitize,
      "open file://server/share/secret/a.md",
      "file://server/share",
      "a.md",
    );

    expectSanitizerPassthrough(sanitize, "see https://example.com/path");
  });
});

suite("SchedulerWebview showError Sanitization Tests", () => {
  test("focusJob posts job selection message", () => {
    withPostedWebviewMessages({ ready: true }, ({ sent }) => {
      SchedulerWebview.focusJob("job-1", "folder-1");

      const message = getSinglePostedMessage<{
        type?: unknown;
        jobId?: unknown;
        folderId?: unknown;
      }>(sent);
      assert.strictEqual(message.type, "focusJob");
      assert.strictEqual(message.jobId, "job-1");
      assert.strictEqual(message.folderId, "folder-1");
    });
  });

  test("focusResearchProfile posts research selection message", () => {
    withPostedWebviewMessages({ ready: true }, ({ sent }) => {
      SchedulerWebview.focusResearchProfile("research-1");

      const message = getSinglePostedMessage<{
        type?: unknown;
        researchId?: unknown;
      }>(sent);
      assert.strictEqual(message.type, "focusResearchProfile");
      assert.strictEqual(message.researchId, "research-1");
    });
  });

  test("showError sanitizes absolute paths before posting", () => {
    withPostedWebviewMessages({ ready: true }, ({ sent }) => {
      SchedulerWebview.showError(
        "ENOENT: no such file or directory, open 'C:\\Users\\me\\secret folder\\a b.md'",
      );

      const m = getSinglePostedMessage<{ type?: unknown; text?: unknown }>(sent);
      expectPostedErrorMessageText(m, "C:\\Users\\me", "a b.md");
    });
  });
});
