import {
  buildFriendlyCronBuilderMarkup,
  buildPromptSourceRadioGroupMarkup,
  buildTaskScopeRadioGroupMarkup,
  escapeHtml,
  escapeHtmlAttr,
  formatModelLabel,
} from "./cockpitWebviewContentUtils";
import type { AgentInfo, ModelInfo, TaskScope } from "./types";
import { buildSchedulerWebviewStrings } from "./cockpitWebviewStrings";

export function buildSchedulerTaskEditorMarkup(options: {
  strings: ReturnType<typeof buildSchedulerWebviewStrings>;
  allPresets: Array<{ expression: string; name: string }>;
  initialAgents: AgentInfo[];
  initialModels: ModelInfo[];
  defaultScope: TaskScope;
  defaultJitterSeconds: number;
}): string {
  const {
    strings,
    allPresets,
    initialAgents,
    initialModels,
    defaultScope,
    defaultJitterSeconds,
  } = options;

  const agentOptions = initialAgents.length > 0
    ? `<option value="">${escapeHtml(strings.placeholderSelectAgent)}</option>${
      initialAgents
        .map(
          (agent) =>
            `<option value="${escapeHtmlAttr(agent.id || "")}">${escapeHtml(agent.name || "")}</option>`,
        )
        .join("")
    }`
    : `<option value="">${escapeHtml(strings.placeholderNoAgents)}</option>`;

  const modelOptions = initialModels.length > 0
    ? `<option value="">${escapeHtml(strings.placeholderSelectModel)}</option>${
      initialModels
        .map(
          (model) =>
            `<option value="${escapeHtmlAttr(model.id || "")}">${escapeHtml(formatModelLabel(model))}</option>`,
        )
        .join("")
    }`
    : `<option value="">${escapeHtml(strings.placeholderNoModels)}</option>`;
  const taskNameFieldMarkup = `<div class="form-group" style="margin:0;"><label for="task-name">${escapeHtml(strings.labelTaskName)}</label><input type="text" id="task-name" placeholder="${escapeHtmlAttr(strings.placeholderTaskName)}" required></div>`;
  const templateSelectMarkup = `<div class="form-group" id="template-select-group" style="display: none; margin:0;"><label for="template-select">${escapeHtml(strings.labelPrompt)}</label><div class="template-row"><select id="template-select"><option value="">${escapeHtml(strings.placeholderSelectTemplate)}</option></select><button type="button" class="btn-secondary" id="template-refresh-btn">${escapeHtml(strings.actionRefresh)}</button></div></div>`;
  const cronPresetOptions = allPresets
    .map((preset) => `<option value="${escapeHtmlAttr(preset.expression)}">${escapeHtml(preset.name)}</option>`)
    .join("");
  const cronPreviewMarkup = `<div class="cron-preview"><strong>${escapeHtml(strings.labelFriendlyPreview)}:</strong><span id="cron-preview-text">${escapeHtml(strings.labelFriendlyFallback)}</span><button type="button" class="btn-secondary btn-icon" id="open-guru-btn">${escapeHtml(strings.labelOpenInGuru)}</button></div>`;
  const scheduleSelectorMarkup = `<div class="form-group" style="margin:0;"><label>${escapeHtml(strings.labelSchedule)}</label><div class="preset-select"><select id="cron-preset"><option value="">${escapeHtml(strings.labelCustom)}</option>${cronPresetOptions}</select></div><input type="text" id="cron-expression" placeholder="${escapeHtmlAttr(strings.placeholderCron)}" required>${cronPreviewMarkup}</div>`;
  const oneTimeDelayMarkup = `<div class="form-group" id="one-time-delay-group" style="display:none; margin:0;"><label>${escapeHtml(strings.labelOneTimeDelay)}</label><div class="one-time-delay-builder"><p class="note" id="one-time-delay-note">${escapeHtml(strings.oneTimeDelayNote)}</p><div class="note"><strong>${escapeHtml(strings.oneTimeDelayQuickPresets)}</strong></div><div class="one-time-delay-presets" role="group" aria-label="${escapeHtmlAttr(strings.oneTimeDelayQuickPresets)}"><button type="button" class="one-time-delay-preset" data-seconds="300">5 min</button><button type="button" class="one-time-delay-preset" data-seconds="900">15 min</button><button type="button" class="one-time-delay-preset" data-seconds="1800">30 min</button><button type="button" class="one-time-delay-preset" data-seconds="3600">1 hour</button><button type="button" class="one-time-delay-preset" data-seconds="7200">2 hours</button></div><div class="inline-group"><div class="form-group" style="margin:0; flex:0 0 88px;"><label for="one-time-delay-hours">${escapeHtml(strings.labelDelayHours)}</label><input type="number" id="one-time-delay-hours" min="0" step="1" value="0" style="max-width:88px; text-align:center;"></div><div class="form-group" style="margin:0; flex:0 0 88px;"><label for="one-time-delay-minutes">${escapeHtml(strings.labelDelayMinutes)}</label><input type="number" id="one-time-delay-minutes" min="0" max="59" step="1" value="0" style="max-width:88px; text-align:center;"></div><div class="form-group" style="margin:0; flex:0 0 88px;"><label for="one-time-delay-seconds">${escapeHtml(strings.labelDelaySeconds)}</label><input type="number" id="one-time-delay-seconds" min="0" max="59" step="1" value="0" style="max-width:88px; text-align:center;"></div></div><div class="one-time-delay-preview" role="status" aria-live="polite"><strong>${escapeHtml(strings.labelNextRun)}:</strong><span id="one-time-delay-preview-text">${escapeHtml(strings.oneTimeDelayPreviewUnset)}</span></div></div></div>`;
  const jitterFieldMarkup = `<div class="form-group" style="margin:0;"><label for="jitter-seconds">${escapeHtml(strings.labelJitterSeconds)}</label><input type="number" id="jitter-seconds" min="0" max="1800" value="${escapeHtmlAttr(String(defaultJitterSeconds))}"><p class="note">${escapeHtml(strings.webviewJitterNote)}</p></div>`;

  return `<form id="task-form" novalidate>
        <div id="form-error" style="display:none; background:var(--vscode-inputValidation-errorBackground); color:var(--vscode-inputValidation-errorForeground); padding:8px 12px; border-radius:4px; margin-bottom:12px; font-size:13px;"></div>
        <input type="hidden" id="edit-task-id" value="">

        <div class="task-editor-grid">
          <section class="task-editor-card">
            <div class="section-title">${escapeHtml(strings.taskEditorPromptTitle)}</div>

            ${taskNameFieldMarkup}

            <div class="form-group" style="margin:0;">
              <label for="task-labels">${escapeHtml(strings.labelTaskLabels)}</label>
              <input type="text" id="task-labels" placeholder="${escapeHtmlAttr(strings.placeholderTaskLabels)}">
            </div>

            ${buildPromptSourceRadioGroupMarkup(strings)}

            ${templateSelectMarkup}

            <div class="form-group" id="prompt-group" style="margin:0;">
              <label for="prompt-text">${escapeHtml(strings.labelPrompt)}</label>
              <textarea id="prompt-text" placeholder="${escapeHtmlAttr(strings.placeholderPrompt)}" required style="min-height:220px;"></textarea>
            </div>

            <div class="form-group" id="skill-select-group" style="margin:0;">
              <label for="skill-select">${escapeHtml(strings.labelSkills)}</label>
              <div class="template-row">
                <select id="skill-select">
                  <option value="">${escapeHtml(strings.placeholderSelectSkill)}</option>
                </select>
                <button type="button" class="btn-secondary" id="insert-skill-btn">${escapeHtml(strings.actionInsertSkill)}</button>
              </div>
              <p class="note">${escapeHtml(strings.skillInsertNote)}</p>
              <p class="note" id="skill-details-note">${escapeHtml(strings.skillMetadataEmptyState)}</p>
            </div>
          </section>

          <section class="task-editor-card">
            <div class="section-title">${escapeHtml(strings.taskEditorScheduleTitle)}</div>

            <div id="recurring-schedule-group">
              ${scheduleSelectorMarkup}

              ${buildFriendlyCronBuilderMarkup(strings, "friendly")}
            </div>

            ${oneTimeDelayMarkup}

            <div class="section-title">${escapeHtml(strings.taskEditorRuntimeTitle)}</div>
            <div class="inline-group">
              <div class="form-group" style="margin:0;">
                <label for="agent-select">${escapeHtml(strings.labelAgent)}</label>
                <select id="agent-select">
                  ${agentOptions}
                </select>
              </div>

              <div class="form-group" style="margin:0;">
                <label for="model-select">${escapeHtml(strings.labelModel)}</label>
                <select id="model-select">
                  ${modelOptions}
                </select><p class="note">${escapeHtml(strings.labelModelNote)}</p></div></div>
          </section>

          <section class="task-editor-card is-wide">
            <div class="section-title">${escapeHtml(strings.taskEditorOptionsTitle)}</div>
            <div class="task-editor-options-grid">
              ${buildTaskScopeRadioGroupMarkup(strings, defaultScope)}

              ${jitterFieldMarkup}

              <div class="form-group" id="run-first-group" style="margin:0;">
                <label class="checkbox-group">
                  <input type="checkbox" id="run-first">
                  <span>${escapeHtml(strings.labelRunFirstInOneMinute)}</span>
                </label>
              </div>

              <div class="form-group" style="margin:0;">
                <label class="checkbox-group">
                  <input type="checkbox" id="one-time">
                  <span>${escapeHtml(strings.labelOneTime)}</span>
                </label>
              </div>

              <div class="form-group" style="margin:0;">
                <label class="checkbox-group">
                  <input type="checkbox" id="manual-session">
                  <span>${escapeHtml(strings.labelManualSession)}</span>
                </label>
                <p class="note">${escapeHtml(strings.labelManualSessionNote)}</p>
              </div>

              <div class="form-group wide" id="chat-session-group" style="margin:0;">
                <label for="chat-session">${escapeHtml(strings.labelChatSession)}</label>
                <select id="chat-session">
                  <option value="new">${escapeHtml(strings.labelChatSessionNew)}</option>
                  <option value="continue">${escapeHtml(strings.labelChatSessionContinue)}</option>
                </select>
                <p class="note">${escapeHtml(strings.labelChatSessionRecurringOnly)}</p>
              </div>
            </div>

            <div class="section-title">${escapeHtml(strings.taskEditorActionsTitle)}</div>
            <div class="button-group" style="margin:0;">
              <button type="submit" class="btn-primary" id="submit-btn">${escapeHtml(strings.actionCreate)}</button>
              <button type="button" class="btn-secondary" id="new-task-btn" style="display:none;">${escapeHtml(strings.actionNewTask)}</button>
              <button type="button" class="btn-secondary" id="test-btn">${escapeHtml(strings.taskEditorTestPrompt)}</button>
            </div>
          </section>
        </div>
      </form>`;
}
