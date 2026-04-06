import { buildFriendlyCronBuilderMarkup, escapeHtml, escapeHtmlAttr } from "./cockpitWebviewContentUtils";
import { buildSchedulerWebviewStrings } from "./cockpitWebviewStrings";

export function buildSchedulerWorkspaceTabsMarkup(options: {
  strings: ReturnType<typeof buildSchedulerWebviewStrings>;
  allPresets: Array<{ expression: string; name: string }>;
  configuredLanguage: string;
  helpIntroTitleText: string;
}): string {
  const {
    strings,
    allPresets,
    configuredLanguage,
    helpIntroTitleText,
  } = options;
  const jobsCronPresetOptions = allPresets
    .map((preset) => `<option value="${escapeHtmlAttr(preset.expression)}">${escapeHtml(preset.name)}</option>`)
    .join("");

  return `
  <div id="board-tab" class="tab-content">
    <div class="section-title">${escapeHtml(strings.boardTitle)}</div>
    <p class="note">${escapeHtml(strings.boardDescription)}</p>
    <div id="board-filter-sticky" class="board-filter-sticky">
      <div class="board-filter-header">
        <div class="board-filter-title">${escapeHtml(strings.boardFiltersTitle)}</div>
        <button type="button" class="btn-secondary" id="todo-toggle-filters-btn">${escapeHtml(strings.boardHideFilters)}</button>
      </div>
      <div id="board-filter-body" class="board-filter-body">
        <div class="board-filter-grid-shell">
          <div class="board-filter-grid">
            <div class="form-group board-filter-search">
              <label for="todo-search-input">${escapeHtml(strings.boardSearchLabel)}</label>
              <input type="text" id="todo-search-input" placeholder="${escapeHtmlAttr(strings.boardSearchPlaceholder)}">
            </div>
            <div class="form-group">
              <label for="todo-section-filter">${escapeHtml(strings.boardSectionFilterLabel)}</label>
              <select id="todo-section-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-label-filter">${escapeHtml(strings.boardLabelFilterLabel)}</label>
              <select id="todo-label-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-flag-filter">${escapeHtml(strings.boardFlagFilterLabel)}</label>
              <select id="todo-flag-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-priority-filter">${escapeHtml(strings.boardPriorityFilterLabel)}</label>
              <select id="todo-priority-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-status-filter">${escapeHtml(strings.boardStatusFilterLabel)}</label>
              <select id="todo-status-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-archive-outcome-filter">${escapeHtml(strings.boardArchiveOutcomeFilterLabel)}</label>
              <select id="todo-archive-outcome-filter"></select>
            </div>
            <div class="form-group">
              <label for="todo-sort-by">${escapeHtml(strings.boardSortLabel)}</label>
              <select id="todo-sort-by"></select>
            </div>
            <div class="form-group">
              <label for="todo-sort-direction">${escapeHtml(strings.boardSortAsc)}</label>
              <select id="todo-sort-direction"></select>
            </div></div></div>
        <div class="board-filter-footer">
          <div class="board-filter-actions">
            <div class="board-filter-primary-actions">
              <button type="button" class="btn-primary" id="todo-new-btn">${escapeHtml(strings.boardToolbarNew)}</button>
              <button type="button" class="btn-secondary" id="todo-clear-selection-btn">${escapeHtml(strings.boardToolbarClear)}</button>
              <button type="button" class="btn-secondary" id="todo-clear-filters-btn">${escapeHtml(strings.boardToolbarClearFilters)}</button>
            </div>
            <div class="board-filter-view-group">
              <div class="form-group">
                <label for="todo-view-mode">${escapeHtml(strings.boardViewLabel)}</label>
                <select id="todo-view-mode"></select>
              </div>
            </div>
            <div class="board-filter-options">
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
                <input type="checkbox" id="todo-show-recurring-tasks" style="margin:0;">
                ${escapeHtml(strings.boardShowRecurringTasks)}
              </label>
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
                <input type="checkbox" id="todo-show-archived" style="margin:0;">
                ${escapeHtml(strings.boardShowArchived)}
              </label>
              <label style="display:flex;align-items:center;gap:6px;margin:0;cursor:pointer;font-size:var(--vscode-font-size,12px);">
                <input type="checkbox" id="todo-hide-card-details" style="margin:0;">
                ${escapeHtml(strings.boardHideCardDetails)}
              </label>
              <div class="board-col-width-group">
                <label for="cockpit-col-slider">Column width</label>
                <input type="range" id="cockpit-col-slider" min="180" max="520" value="240" step="10">
              </div></div></div></div></div></div>
    <div id="board-summary" class="note"></div>
    <div class="note" style="margin-bottom:12px;">${escapeHtml(strings.boardDropHint)}</div>
    <div class="board-toolbar">
      <button type="button" class="btn-secondary" id="board-add-section-btn">${escapeHtml(strings.boardAddSection)}</button>
      <div id="board-section-inline-form" style="display:none;align-items:center;gap:6px;">
        <input type="text" id="board-section-name-input" placeholder="${escapeHtmlAttr(strings.boardSectionNamePlaceholder)}" style="max-width:180px;">
        <button type="button" class="btn-primary" id="board-section-save-btn">${escapeHtml(strings.commonAdd)}</button>
        <button type="button" class="btn-secondary" id="board-section-cancel-btn">${escapeHtml(strings.commonCancel)}</button>
      </div>
    </div>
    <div class="board-columns-shell">
      <div id="board-columns"></div>
    </div>
    <p class="note">${escapeHtml(strings.boardPrivacyNote)}</p>
  </div>

  <div id="jobs-tab" class="tab-content">
    <div class="jobs-layout" id="jobs-layout">
      <aside class="jobs-sidebar">
        <div class="jobs-sidebar-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div class="section-title" style="margin:0;">${escapeHtml(strings.jobsFoldersTitle)}</div>
            <button type="button" class="btn-secondary" id="jobs-toggle-sidebar-btn" style="padding:2px 8px;font-size:11px;">${escapeHtml(strings.jobsHideSidebar)}</button>
          </div>
          <div class="jobs-toolbar">
            <button type="button" class="btn-secondary" id="jobs-new-folder-btn">${escapeHtml(strings.jobsCreateFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-rename-folder-btn">${escapeHtml(strings.jobsRenameFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-delete-folder-btn">${escapeHtml(strings.jobsDeleteFolder)}</button>
            <button type="button" class="btn-secondary" id="jobs-new-job-btn">${escapeHtml(strings.jobsCreateJob)}</button>
          </div>
          <div id="jobs-current-folder-banner" class="jobs-current-folder-banner"></div>
          <div id="jobs-folder-list" class="jobs-folder-list"></div>
        </div>
        <div class="jobs-sidebar-section">
          <div class="section-title">${escapeHtml(strings.jobsTitle)}</div>
          <div id="jobs-list" class="jobs-list"></div>
        </div>
      </aside>

      <section class="jobs-main">
        <div class="jobs-overview-main">
          <div class="jobs-overview-card">
            <div class="section-title">${escapeHtml(strings.jobsOverviewTitle)}</div>
            <p class="note">${escapeHtml(strings.jobsOverviewNote)}</p>
            <div class="button-group" style="margin:0;">
              <button type="button" class="btn-primary" id="jobs-open-editor-btn">${escapeHtml(strings.jobsOpenEditor)}</button>
            </div>
          </div>
          <div class="jobs-overview-card">
            <div class="section-title">${escapeHtml(strings.jobsCurrentFolderLabel)}</div>
            <p class="note">${escapeHtml(strings.jobsSelectJob)}</p>
          </div>
        </div>
      </section>
    </div>
  </div>

  <div id="jobs-edit-tab" class="tab-content">
    <div id="jobs-empty-state" class="jobs-empty">
      <p>${escapeHtml(strings.jobsSelectJob)}</p>
      <button type="button" class="btn-primary" id="jobs-empty-new-btn">${escapeHtml(strings.jobsCreateJob)}</button>
    </div>
    <div id="jobs-details" style="display:none;">
      <div class="jobs-editor-shell">
        <div class="jobs-editor-header">
          <div class="jobs-editor-intro">
            <div class="section-title">${escapeHtml(strings.jobsTitle)}</div>
            <div class="jobs-editor-subtitle">${escapeHtml(strings.jobsSelectJob)}</div>
          </div>
          <div class="jobs-job-toolbar">
            <button type="button" class="btn-secondary" id="jobs-back-btn">${escapeHtml(strings.jobsBackToJobs)}</button>
            <button type="button" class="btn-primary" id="jobs-save-btn">${escapeHtml(strings.jobsSave)}</button>
            <button type="button" class="btn-secondary" id="jobs-duplicate-btn">${escapeHtml(strings.jobsDuplicate)}</button>
            <button type="button" class="btn-secondary" id="jobs-pause-btn">${escapeHtml(strings.jobsPause)}</button>
            <button type="button" class="btn-secondary" id="jobs-compile-btn">${escapeHtml(strings.jobsCompile)}</button>
            <button type="button" class="btn-danger" id="jobs-delete-btn">${escapeHtml(strings.jobsDelete)}</button>
          </div>
        </div>

        <div class="jobs-editor-grid">
          <section class="jobs-main-section jobs-editor-card">
            <div class="section-title">${escapeHtml(strings.jobsEditorDetailsTitle)}</div>
            <p class="note">${escapeHtml(strings.jobsEditorDetailsNote)}</p>
            <div class="jobs-job-grid jobs-job-grid-overview">
              <div class="form-group">
                <label for="jobs-name-input">${escapeHtml(strings.jobsName)}</label>
                <input type="text" id="jobs-name-input">
              </div>
              <div class="form-group">
                <label for="jobs-folder-select">${escapeHtml(strings.jobsFolder)}</label>
                <select id="jobs-folder-select"></select>
              </div>
              <div class="form-group">
                <label>${escapeHtml(strings.labelStatus)}</label>
                <button type="button" id="jobs-status-pill" class="jobs-pill is-toggle" title="${escapeHtmlAttr(strings.jobsToggleStatus)}">${escapeHtml(strings.jobsRunning)}</button>
              </div>
            </div>
          </section>

          <section class="jobs-main-section jobs-editor-card">
            <div class="section-title">${escapeHtml(strings.taskEditorScheduleTitle)}</div>
            <p class="note">${escapeHtml(strings.jobsEditorScheduleNote)}</p>
            <div class="jobs-schedule-grid">
              <div class="form-group">
                <label for="jobs-cron-preset">${escapeHtml(strings.labelPreset)}</label>
                <div class="preset-select">
                  <select id="jobs-cron-preset">
                    <option value="">${escapeHtml(strings.labelCustom)}</option>
                    ${jobsCronPresetOptions}
                  </select></div></div><div class="form-group">
                <label for="jobs-cron-input">${escapeHtml(strings.jobsCron)}</label>
                <input type="text" id="jobs-cron-input" placeholder="${escapeHtmlAttr(strings.placeholderCron)}">
              </div>
              <div class="form-group wide">
                <div class="cron-preview">
                  <strong>${escapeHtml(strings.labelFriendlyPreview)}:</strong>
                  <span id="jobs-cron-preview-text">${escapeHtml(strings.labelFriendlyFallback)}</span>
                  <button type="button" class="btn-secondary btn-icon" id="jobs-open-guru-btn">${escapeHtml(strings.labelOpenInGuru)}</button>
                </div>
              </div>
              <div class="form-group wide">
                ${buildFriendlyCronBuilderMarkup(strings, "jobs-friendly")}
              </div>
            </div>
          </section>

          <div class="jobs-workflow-builder-layout">
            <section class="jobs-main-section jobs-editor-card jobs-workflow-card">
              <div class="jobs-workflow-hero">
                <div class="jobs-workflow-copy">
                  <div class="jobs-workflow-badge">⛓ ${escapeHtml(strings.jobsWorkflowBadge)}</div>
                  <div class="section-title jobs-workflow-title">${escapeHtml(strings.jobsWorkflowTitle)}</div>
                  <p class="jobs-workflow-note">${escapeHtml(strings.jobsWorkflowNote)}</p>
                  <div class="jobs-workflow-save-row">
                    <button type="button" class="btn-primary" id="jobs-save-deck-btn">${escapeHtml(strings.jobsSave)}</button>
                  </div>
                </div>
                <div id="jobs-workflow-metrics" class="jobs-workflow-metrics"></div>
              </div>
              <div class="jobs-workflow-panel">
                <div class="jobs-workflow-panel-header">
                  <div class="jobs-workflow-panel-copy">
                    <div class="section-title">${escapeHtml(strings.jobsCompactTimeline)}</div>
                    <p class="note">${escapeHtml(strings.jobsWorkflowTimelineNote)}</p>
                  </div>
                </div>
                <div id="jobs-timeline-inline" class="jobs-timeline-inline">${escapeHtml(strings.jobsTimelineEmpty)}</div>
              </div>
              <div class="jobs-workflow-panel">
                <div class="jobs-workflow-panel-header">
                  <div class="jobs-workflow-panel-copy">
                    <div class="section-title">${escapeHtml(strings.jobsSteps)}</div>
                    <p class="note">${escapeHtml(strings.jobsDropHint)}</p>
                  </div>
                </div>
                <div id="jobs-step-list" class="jobs-step-list"></div>
              </div>
            </section>

            <section class="jobs-main-section jobs-editor-card jobs-workflow-actions-card">
              <div class="jobs-workflow-actions-header">
                <div class="jobs-workflow-actions-badge">＋ Workflow Builder</div>
                <div class="section-title">Add to workflow</div>
                <p class="note">Use quick actions to insert pause checkpoints, attach existing tasks, and draft a new step without leaving the workflow canvas.</p>
              </div>
              <div class="jobs-workflow-actions-grid">
                <div class="jobs-workflow-quick-actions">
                  <div class="jobs-action-card">
                    <div class="section-title"><span class="jobs-action-title-with-icon"><span class="jobs-action-title-icon jobs-action-title-icon-pause"><span></span><span></span></span><span>${escapeHtml(strings.jobsPauseTitle)}</span></span></div>
                    <div class="jobs-inline-form">
                      <div class="form-group">
                        <label for="jobs-pause-name-input">${escapeHtml(strings.jobsPauseName)}</label>
                        <input type="text" id="jobs-pause-name-input" placeholder="${escapeHtmlAttr(strings.jobsPauseDefaultTitle)}">
                      </div>
                      <button type="button" class="btn-primary" id="jobs-create-pause-btn">⏸ ${escapeHtml(strings.jobsCreatePause)}</button>
                    </div>
                  </div>

                  <div class="jobs-action-card">
                    <div class="section-title"><span class="jobs-action-title-with-icon"><span class="jobs-action-title-icon">⛓</span><span>${escapeHtml(strings.jobsAddExistingTask)}</span></span></div>
                    <div class="jobs-inline-form">
                      <div class="form-group">
                        <label for="jobs-existing-task-select">${escapeHtml(strings.jobsStandaloneTasks)}</label>
                        <select id="jobs-existing-task-select"></select>
                      </div>
                      <div class="form-group">
                        <label for="jobs-existing-window-input">${escapeHtml(strings.jobsWindowMinutes)}</label>
                        <input type="number" id="jobs-existing-window-input" min="1" max="1440" value="30">
                      </div>
                      <button type="button" class="btn-primary" id="jobs-attach-btn">⛓ ${escapeHtml(strings.jobsAttach)}</button>
                    </div></div></div>

                <div class="jobs-action-card jobs-action-card-wide">
                  <div class="section-title"><span class="jobs-action-title-with-icon"><span class="jobs-action-title-icon">✦</span><span>${escapeHtml(strings.jobsAddNewStep)}</span></span></div>
                  <div class="jobs-inline-form jobs-new-step-form">
                    <div class="form-group">
                      <label for="jobs-step-name-input">${escapeHtml(strings.jobsStepName)}</label>
                      <input type="text" id="jobs-step-name-input">
                    </div>
                    <div class="form-group">
                      <label for="jobs-step-window-input">${escapeHtml(strings.jobsWindowMinutes)}</label>
                      <input type="number" id="jobs-step-window-input" min="1" max="1440" value="30">
                    </div>
                    <div class="form-group wide">
                      <label for="jobs-step-prompt-input">${escapeHtml(strings.jobsStepPrompt)}</label>
                      <textarea id="jobs-step-prompt-input"></textarea>
                    </div>
                    <div class="form-group">
                      <label for="jobs-step-agent-select">${escapeHtml(strings.labelAgent)}</label>
                      <select id="jobs-step-agent-select"></select>
                    </div>
                    <div class="form-group">
                      <label for="jobs-step-model-select">${escapeHtml(strings.labelModel)}</label>
                      <select id="jobs-step-model-select"></select>
                    </div>
                    <div class="form-group wide">
                      <label for="jobs-step-labels-input">${escapeHtml(strings.labelTaskLabels)}</label>
                      <input type="text" id="jobs-step-labels-input" placeholder="${escapeHtmlAttr(strings.placeholderTaskLabels)}">
                    </div>
                    <div class="jobs-new-step-actions">
                      <button type="button" class="btn-primary" id="jobs-create-step-btn">${escapeHtml(strings.jobsCreateStep)}</button>
                    </div></div></div></div></section>
          </div></div></div>
    </div>
  </div>

  <div id="research-tab" class="tab-content">
    <div class="research-layout">
      <aside class="research-sidebar">
        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title">${escapeHtml(strings.researchProfilesTitle)}</div>
            <p class="note">${escapeHtml(strings.researchHelpText)}</p>
          </div>
          <div class="research-toolbar">
            <button type="button" class="btn-secondary" id="research-new-btn">${escapeHtml(strings.researchNewProfile)}</button>
            <button type="button" class="btn-secondary" id="research-load-autoagent-example-btn">${escapeHtml(strings.researchLoadAutoAgentExample)}</button>
          </div>
          <div id="research-profile-list" class="research-profile-list"></div>
        </section>
        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title">${escapeHtml(strings.researchHistoryTitle)}</div>
          </div>
          <div id="research-run-list" class="research-run-list"></div>
        </section>
      </aside>

      <section class="research-main">
        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title">${escapeHtml(strings.researchTitle)}</div>
            <p class="note">${escapeHtml(strings.researchHelpText)}</p>
          </div>
          <div id="research-form-error" class="research-form-error"></div>
          <input type="hidden" id="research-edit-id" value="">
          <div class="research-form-grid">
            <div class="form-group">
              <label for="research-name">${escapeHtml(strings.researchName)}</label>
              <input type="text" id="research-name">
            </div>
            <div class="form-group">
              <label for="research-benchmark-command">${escapeHtml(strings.researchBenchmarkCommand)}</label>
              <input type="text" id="research-benchmark-command" placeholder="${escapeHtmlAttr(strings.researchBenchmarkPlaceholder)}">
            </div>
            <div class="form-group wide">
              <label for="research-instructions">${escapeHtml(strings.researchInstructions)}</label>
              <textarea id="research-instructions" placeholder="${escapeHtmlAttr(strings.researchInstructionsPlaceholder)}"></textarea>
            </div>
            <div class="form-group wide">
              <label for="research-editable-paths">${escapeHtml(strings.researchEditablePaths)}</label>
              <textarea id="research-editable-paths" placeholder="${escapeHtmlAttr(strings.researchEditablePathsPlaceholder)}"></textarea>
            </div>
            <div class="form-group">
              <label for="research-metric-pattern">${escapeHtml(strings.researchMetricPattern)}</label>
              <input type="text" id="research-metric-pattern" placeholder="${escapeHtmlAttr(strings.researchMetricPatternPlaceholder)}">
            </div>
            <div class="form-group">
              <label for="research-metric-direction">${escapeHtml(strings.researchMetricDirection)}</label>
              <select id="research-metric-direction">
                <option value="maximize">${escapeHtml(strings.researchDirectionMaximize)}</option>
                <option value="minimize">${escapeHtml(strings.researchDirectionMinimize)}</option></select></div>
            <div class="form-group">
              <label for="research-max-iterations">${escapeHtml(strings.researchMaxIterations)}</label>
              <input type="number" id="research-max-iterations" min="0" max="25" value="3">
            </div>
            <div class="form-group">
              <label for="research-max-minutes">${escapeHtml(strings.researchMaxMinutes)}</label>
              <input type="number" id="research-max-minutes" min="1" max="240" value="15">
            </div>
            <div class="form-group">
              <label for="research-max-failures">${escapeHtml(strings.researchMaxFailures)}</label>
              <input type="number" id="research-max-failures" min="1" max="10" value="2">
            </div>
            <div class="form-group">
              <label for="research-benchmark-timeout">${escapeHtml(strings.researchBenchmarkTimeout)}</label>
              <input type="number" id="research-benchmark-timeout" min="5" max="3600" value="180">
            </div>
            <div class="form-group">
              <label for="research-edit-wait">${escapeHtml(strings.researchEditWait)}</label>
              <input type="number" id="research-edit-wait" min="5" max="300" value="20">
            </div>
            <div class="form-group">
              <label for="research-agent-select">${escapeHtml(strings.labelAgent)}</label>
              <select id="research-agent-select"></select>
            </div>
            <div class="form-group">
              <label for="research-model-select">${escapeHtml(strings.labelModel)}</label>
              <select id="research-model-select"></select>
            </div>
          </div>
          <div class="research-toolbar">
            <button type="button" class="btn-primary" id="research-save-btn">${escapeHtml(strings.researchSaveProfile)}</button>
            <button type="button" class="btn-secondary" id="research-duplicate-btn">${escapeHtml(strings.researchDuplicateProfile)}</button>
            <button type="button" class="btn-danger" id="research-delete-btn">${escapeHtml(strings.researchDeleteProfile)}</button>
            <button type="button" class="btn-secondary" id="research-start-btn">${escapeHtml(strings.researchStartRun)}</button>
            <button type="button" class="btn-secondary" id="research-stop-btn">${escapeHtml(strings.researchStopRun)}</button>
          </div>
        </section>

        <section class="research-panel">
          <div class="research-panel-header">
            <div class="section-title" id="research-run-title">${escapeHtml(strings.researchActiveRunTitle)}</div>
          </div>
          <div id="research-active-empty" class="jobs-empty">${escapeHtml(strings.researchNoRunSelected)}</div>
          <div id="research-active-details" style="display:none;">
            <div class="research-stat-grid">
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.labelStatus)}</div>
                <div class="research-stat-value" id="research-active-status">${escapeHtml(strings.researchStatusIdle)}</div>
              </div>
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.researchCurrentBest)}</div>
                <div class="research-stat-value" id="research-active-best">${escapeHtml(strings.researchNoScore)}</div>
              </div>
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.researchAttempts)}</div>
                <div class="research-stat-value" id="research-active-attempts">0</div>
              </div>
              <div class="research-stat">
                <div class="research-stat-label">${escapeHtml(strings.researchLastOutcome)}</div>
                <div class="research-stat-value" id="research-active-last-outcome">-</div>
              </div>
            </div>
            <div class="research-run-meta" id="research-active-meta"></div>
            <div class="section-title" style="margin-top:12px;">${escapeHtml(strings.researchAttemptTimeline)}</div>
            <div id="research-attempt-list" class="research-attempt-list"></div>
          </div>
        </section>
      </section>
    </div>
  </div>

  <div id="settings-tab" class="tab-content">
    <div class="telegram-layout">
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsLanguageTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsLanguageBody)}</p>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label for="settings-language-select">${escapeHtml(strings.settingsLanguageLabel)}</label>
          <select id="settings-language-select">
            <option value="auto" ${configuredLanguage === "auto" ? "selected" : ""}>${escapeHtml(strings.helpLanguageAuto)}</option>
            <option value="en" ${configuredLanguage === "en" ? "selected" : ""}>${escapeHtml(strings.helpLanguageEnglish)}</option>
            <option value="ja" ${configuredLanguage === "ja" ? "selected" : ""}>${escapeHtml(strings.helpLanguageJapanese)}</option>
            <option value="de" ${configuredLanguage === "de" ? "selected" : ""}>${escapeHtml(strings.helpLanguageGerman)}</option>
          </select>
        </div>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.executionDefaultsTitle)}</div>
          <p class="note">${escapeHtml(strings.executionDefaultsDescription)}</p>
        </div>

        <div class="form-group" style="margin-top:8px;">
          <label for="default-agent-select">${escapeHtml(strings.executionDefaultsAgent)}</label>
          <select id="default-agent-select"></select>
        </div>

        <div class="form-group">
          <label for="default-model-select">${escapeHtml(strings.executionDefaultsModel)}</label>
          <select id="default-model-select"></select>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="execution-defaults-save-btn">${escapeHtml(strings.executionDefaultsSave)}</button>
        </div>
        <p class="note" id="execution-defaults-note">${escapeHtml(strings.executionDefaultsSaved)}</p>
      </section>
      <section class="telegram-card" style="grid-column:span 2;">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsSupportTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsSupportBody)}</p>
        </div>
        <div class="button-group" style="margin-top:8px;">
          <button type="button" class="btn-primary" id="setup-mcp-btn">${escapeHtml(strings.actionSetupMcp)}</button>
          <button type="button" class="btn-secondary" id="sync-bundled-skills-btn">${escapeHtml(strings.actionSyncBundledSkills)}</button>
          <button type="button" class="btn-secondary" id="setup-codex-btn">${escapeHtml(strings.actionSetupCodex)}</button>
          <button type="button" class="btn-secondary" id="setup-codex-skills-btn">${escapeHtml(strings.actionSetupCodexSkills)}</button>
        </div>
        <div class="note" style="display:grid;gap:6px;margin-top:10px;">
          <div><strong>${escapeHtml(strings.settingsStorageVersionLabel)}</strong> <span id="settings-version-value">-</span></div>
          <div><strong>${escapeHtml(strings.settingsStorageMcpStatusLabel)}</strong> <span id="settings-mcp-status-value">-</span></div>
          <div><strong>${escapeHtml(strings.settingsStorageLastMcpUpdateLabel)}</strong> <span id="settings-mcp-updated-value">-</span></div>
          <div><strong>${escapeHtml(strings.settingsStorageLastSkillsUpdateLabel)}</strong> <span id="settings-skills-updated-value">-</span></div>
        </div>
      </section>
      <section class="telegram-card" style="grid-column:span 2;">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.reviewDefaultsTitle)}</div>
          <p class="note">${escapeHtml(strings.reviewDefaultsDescription)}</p>
        </div>

        <div class="form-group" style="margin-top:8px;">
          <label for="needs-bot-review-comment-template-input">${escapeHtml(strings.reviewDefaultsSpotReviewLabel)}</label>
          <textarea id="needs-bot-review-comment-template-input" rows="5" placeholder="${escapeHtmlAttr(strings.reviewDefaultsSpotReviewPlaceholder)}"></textarea>
        </div>

        <div class="form-group">
          <label for="needs-bot-review-prompt-template-input">${escapeHtml(strings.reviewDefaultsBotPromptLabel)}</label>
          <textarea id="needs-bot-review-prompt-template-input" rows="8" placeholder="${escapeHtmlAttr(strings.reviewDefaultsBotPromptPlaceholder)}"></textarea>
        </div>

        <div class="form-group">
          <label for="ready-prompt-template-input">${escapeHtml(strings.reviewDefaultsReadyPromptLabel)}</label>
          <textarea id="ready-prompt-template-input" rows="8" placeholder="${escapeHtmlAttr(strings.reviewDefaultsReadyPromptPlaceholder)}"></textarea>
        </div>

        <div class="form-group">
          <label for="needs-bot-review-agent-select">${escapeHtml(strings.reviewDefaultsBotAgentLabel)}</label>
          <select id="needs-bot-review-agent-select"></select>
        </div>

        <div class="form-group">
          <label for="needs-bot-review-model-select">${escapeHtml(strings.reviewDefaultsBotModelLabel)}</label>
          <select id="needs-bot-review-model-select"></select>
        </div>

        <div class="form-group">
          <label for="needs-bot-review-chat-session-select">${escapeHtml(strings.reviewDefaultsBotChatSessionLabel)}</label>
          <select id="needs-bot-review-chat-session-select">
            <option value="new">${escapeHtml(strings.labelChatSessionNew)}</option>
            <option value="continue">${escapeHtml(strings.labelChatSessionContinue)}</option>
          </select>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="review-defaults-save-btn">${escapeHtml(strings.reviewDefaultsSave)}</button>
        </div>
        <p class="note" id="review-defaults-note">${escapeHtml(strings.reviewDefaultsSaved)}</p>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsStorageTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsStorageBody)}</p>
        </div>

        <div class="form-group" style="margin-top:8px;">
          <label for="settings-storage-mode-select">${escapeHtml(strings.settingsStorageModeLabel)}</label>
          <select id="settings-storage-mode-select">
            <option value="json">${escapeHtml(strings.settingsStorageModeJson)}</option>
            <option value="sqlite">${escapeHtml(strings.settingsStorageModeSqlite)}</option></select></div>

        <div class="form-group">
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="settings-storage-mirror-input">
            <span>${escapeHtml(strings.settingsStorageMirrorLabel)}</span>
          </label>
        </div>

        <div class="form-group">
          <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(strings.settingsDefaultFlagsTitle)}</div>
          <p class="note" style="margin-bottom:8px;">${escapeHtml(strings.settingsDefaultFlagsBody)}</p>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-ready-input">
            <span>${escapeHtml(strings.boardFlagPresetReady)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-needs-bot-review-input">
            <span>${escapeHtml(strings.boardFlagPresetNeedsBotReview)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-needs-user-review-input">
            <span>${escapeHtml(strings.boardFlagPresetNeedsUserReview)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-new-input">
            <span>${escapeHtml(strings.boardFlagPresetNew)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:4px;">
            <input type="checkbox" id="settings-flag-on-schedule-list-input">
            <span>${escapeHtml(strings.boardFlagPresetOnScheduleList)}</span>
          </label>
          <label class="checkbox-label" style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" id="settings-flag-final-user-check-input">
            <span>${escapeHtml(strings.boardFlagPresetFinalUserCheck)}</span>
          </label>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="settings-storage-save-btn">${escapeHtml(strings.settingsStorageSave)}</button>
        </div>
        <p class="note" id="settings-storage-note">${escapeHtml(strings.settingsStorageSaved)}</p>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsLoggingTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsLoggingBody)}</p>
        </div>
        <div class="form-group" style="margin-top:8px;">
          <label for="settings-log-level-select">${escapeHtml(strings.settingsLoggingLevelLabel)}</label>
          <select id="settings-log-level-select">
            <option value="none">${escapeHtml(strings.settingsLoggingLevelNone)}</option>
            <option value="error">${escapeHtml(strings.settingsLoggingLevelError)}</option>
            <option value="info">${escapeHtml(strings.settingsLoggingLevelInfo)}</option>
            <option value="debug">${escapeHtml(strings.settingsLoggingLevelDebug)}</option>
          </select></div><div class="form-group">
          <label for="settings-log-directory">${escapeHtml(strings.settingsLoggingDirectoryLabel)}</label>
          <input type="text" id="settings-log-directory" readonly>
          <p class="note">${escapeHtml(strings.settingsLoggingDirectoryHint)}</p>
        </div>
        <div class="button-group">
          <button type="button" class="btn-secondary" id="settings-open-log-folder-btn">${escapeHtml(strings.settingsLoggingOpenFolder)}</button>
        </div>
      </section>
      <section class="telegram-card" style="grid-column:span 2;">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.telegramTitle)}</div>
          <p class="note">${escapeHtml(strings.telegramDescription)}</p>
          <p class="note" style="margin-top:4px;font-style:italic;opacity:0.8;">⚠️ ${escapeHtml(strings.telegramExperimentalNotice)}</p>
        </div>
        <div id="telegram-feedback" class="telegram-feedback"></div>

        <div class="form-group" style="margin-top:8px;">
          <label class="checkbox-group">
            <input type="checkbox" id="telegram-enabled">
            <span>${escapeHtml(strings.telegramEnable)}</span>
          </label>
        </div>

        <div class="form-group">
          <label for="telegram-bot-token">${escapeHtml(strings.telegramBotToken)}</label>
          <input type="password" id="telegram-bot-token" placeholder="${escapeHtmlAttr(strings.telegramBotTokenPlaceholder)}" autocomplete="off">
          <p class="note">${escapeHtml(strings.telegramBotTokenHelp)}</p>
        </div>

        <div class="form-group">
          <label for="telegram-chat-id">${escapeHtml(strings.telegramChatId)}</label>
          <input type="text" id="telegram-chat-id" placeholder="${escapeHtmlAttr(strings.telegramChatIdPlaceholder)}">
        </div>

        <div class="form-group">
          <label for="telegram-message-prefix">${escapeHtml(strings.telegramMessagePrefix)}</label>
          <textarea id="telegram-message-prefix" placeholder="${escapeHtmlAttr(strings.telegramMessagePrefixPlaceholder)}"></textarea>
        </div>

        <div class="button-group">
          <button type="button" class="btn-primary" id="telegram-save-btn">${escapeHtml(strings.telegramSave)}</button>
          <button type="button" class="btn-secondary" id="telegram-test-btn">${escapeHtml(strings.telegramTest)}</button>
        </div>
        <div class="telegram-status-grid" style="margin-top:12px;">
          <div class="telegram-status-item">
            <div class="telegram-status-label">${escapeHtml(strings.telegramBotToken)}</div>
            <div class="telegram-status-value" id="telegram-token-status"></div>
          </div>
          <div class="telegram-status-item">
            <div class="telegram-status-label">${escapeHtml(strings.telegramChatId)}</div>
            <div class="telegram-status-value" id="telegram-chat-status"></div>
          </div>
          <div class="telegram-status-item">
            <div class="telegram-status-label">Hook</div>
            <div class="telegram-status-value" id="telegram-hook-status"></div>
          </div>
          <div class="telegram-status-item">
            <div class="telegram-status-label">${escapeHtml(strings.telegramUpdatedAt)}</div>
            <div class="telegram-status-value" id="telegram-updated-at"></div>
          </div>
        </div>
        <p class="note" id="telegram-status-note">${escapeHtml(strings.telegramStatusSaved)}</p>
      </section>
      <section class="telegram-card">
        <div class="settings-card-header">
          <div class="section-title">${escapeHtml(strings.settingsMaintenanceTitle)}</div>
          <p class="note">${escapeHtml(strings.settingsMaintenanceBody)}</p>
        </div>
        <div class="button-group">
          <button type="button" class="btn-secondary" id="import-storage-from-json-btn">${escapeHtml(strings.settingsStorageImportJsonToDb)}</button>
          <button type="button" class="btn-secondary" id="export-storage-to-json-btn">${escapeHtml(strings.settingsStorageExportDbToJson)}</button>
        </div>
        <p class="note">${escapeHtml(strings.settingsMaintenanceNote)}</p>
      </section>
    </div>
  </div>

  <div id="help-tab" class="tab-content active">
    <div class="help-panel">
      <div class="help-warp-layer" id="help-warp-layer" aria-hidden="true"></div>
      <div class="help-intro">
        <h2 class="help-intro-title">
          <button type="button" class="help-intro-rocket" id="help-intro-rocket" title="${escapeHtmlAttr(strings.helpIntroTitle)}" aria-label="${escapeHtmlAttr(strings.helpIntroTitle)}">
            <span class="help-intro-rocket-icon">🚀</span>
          </button>
          <span class="help-intro-title-text">${escapeHtml(helpIntroTitleText)}</span>
        </h2>
        <p class="help-intro-body">${escapeHtml(strings.helpIntroBody)}</p>
      </div>
      <section class="help-section">
        <h3>${escapeHtml(strings.helpLanguageTitle)}</h3>
        <p>${escapeHtml(strings.helpLanguageBody)}</p>
        <div class="form-group" style="margin:0;max-width:320px;">
          <label for="help-language-select">${escapeHtml(strings.helpLanguageLabel)}</label>
          <select id="help-language-select">
            <option value="auto" ${configuredLanguage === "auto" ? "selected" : ""}>${escapeHtml(strings.helpLanguageAuto)}</option>
            <option value="en" ${configuredLanguage === "en" ? "selected" : ""}>${escapeHtml(strings.helpLanguageEnglish)}</option>
            <option value="ja" ${configuredLanguage === "ja" ? "selected" : ""}>${escapeHtml(strings.helpLanguageJapanese)}</option>
            <option value="de" ${configuredLanguage === "de" ? "selected" : ""}>${escapeHtml(strings.helpLanguageGerman)}</option>
          </select>
        </div>
        <div class="form-actions" style="margin-top:0.5rem">
          <button class="btn secondary" id="btn-help-switch-settings">${escapeHtml(strings.helpSwitchTabSettingsBtn)}</button>
        </div>
      </section>
      <div class="help-grid">
        <section class="help-section">
          <h3>${escapeHtml(strings.helpTodoTitle)}</h3>
          <p>${escapeHtml(strings.helpTodoBody)}</p>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn primary" id="btn-help-switch-board">${escapeHtml(strings.helpSwitchTabTodoBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpCreateTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpCreateItemName)}</li>
            <li>${escapeHtml(strings.helpCreateItemTemplates)}</li>
            <li>${escapeHtml(strings.helpCreateItemSkills)}</li>
            <li>${escapeHtml(strings.helpCreateItemAgentModel)}</li>
            <li>${escapeHtml(strings.helpCreateItemRunFirst)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-create">${escapeHtml(strings.helpSwitchTabCreateBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpListTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpListItemSections)}</li>
            <li>${escapeHtml(strings.helpListItemActions)}</li>
            <li>${escapeHtml(strings.helpListItemStartup)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-list">${escapeHtml(strings.helpSwitchTabListBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpJobsTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpJobsItemBoard)}</li>
            <li>${escapeHtml(strings.helpJobsItemPause)}</li>
            <li>${escapeHtml(strings.helpJobsItemCompile)}</li>
            <li>${escapeHtml(strings.helpJobsItemLabels)}</li>
            <li>${escapeHtml(strings.helpJobsItemFolders)}</li>
            <li>${escapeHtml(strings.helpJobsItemDelete)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-jobs">${escapeHtml(strings.helpSwitchTabJobsBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpResearchTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpResearchItemProfiles)}</li>
            <li>${escapeHtml(strings.helpResearchItemBounds)}</li>
            <li>${escapeHtml(strings.helpResearchItemHistory)}</li>
          </ul>
          <div class="form-actions" style="margin-top:0.5rem">
            <button class="btn secondary" id="btn-help-switch-research">${escapeHtml(strings.helpSwitchTabResearchBtn)}</button>
          </div>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpStorageTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpStorageItemRepo)}</li>
            <li>${escapeHtml(strings.helpStorageItemBackups)}</li>
            <li>${escapeHtml(strings.helpStorageItemIsolation)}</li>
            <li>${escapeHtml(strings.helpStorageItemGlobal)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpOverdueTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpOverdueItemReview)}</li>
            <li>${escapeHtml(strings.helpOverdueItemRecurring)}</li>
            <li>${escapeHtml(strings.helpOverdueItemOneTime)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpSessionTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpSessionItemPerTask)}</li>
            <li>${escapeHtml(strings.helpSessionItemNewChat)}</li>
            <li>${escapeHtml(strings.helpSessionItemCareful)}</li>
            <li>${escapeHtml(strings.helpSessionItemSeparate)}</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>${escapeHtml(strings.helpTipsTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpTipsItem1)}</li>
            <li>${escapeHtml(strings.helpTipsItem2)}</li>
            <li>${escapeHtml(strings.helpTipsItem3)}</li>
          </ul>
        </section>
        <section class="help-section is-featured">
          <h3>${escapeHtml(strings.helpMcpTitle)}</h3>
          <ul>
            <li>${escapeHtml(strings.helpMcpItemEmbedded)}</li>
            <li>${escapeHtml(strings.helpMcpItemConfig)}</li>
            <li>${escapeHtml(strings.helpMcpItemAutoConfig)}</li>
            <li>${escapeHtml(strings.helpMcpItemDanger)}</li>
            <li>${escapeHtml(strings.helpMcpItemInspect)}</li>
            <li>${escapeHtml(strings.helpMcpItemWrite)}</li>
            <li>${escapeHtml(strings.helpMcpItemTools)}</li>
          </ul>
        </section>
        <section class="help-section is-featured">
          <h3>${escapeHtml(strings.helpAgentEcosystemTitle)}</h3>
          <p>${escapeHtml(strings.helpAgentEcosystemBody)}</p>
          <div class="button-group" style="margin-top:8px;">
            <button type="button" class="btn-secondary" id="btn-intro-tutorial">${escapeHtml(strings.helpIntroTutorialBtn)}</button>
            <button type="button" class="btn-primary" id="btn-plan-integration">${escapeHtml(strings.helpPlanIntegrationBtn)}</button>
          </div></section></div></div></div>
  
`;
}
