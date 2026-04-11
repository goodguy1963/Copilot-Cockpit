import { escapeHtml, escapeHtmlAttr } from "./cockpitWebviewContentUtils";
import { buildSchedulerWebviewStrings } from "./cockpitWebviewStrings";

const TODO_EDITOR_DESCRIPTION_LAYOUT_STYLES = `<style>#todo-edit-tab .todo-editor-grid{align-items:stretch;}#todo-edit-tab .todo-editor-card-primary{grid-template-rows:auto minmax(0,1fr) auto;align-content:stretch;min-height:0;}#todo-edit-tab .todo-editor-description-group{display:grid;grid-template-rows:auto minmax(0,1fr);min-height:0;}#todo-edit-tab .todo-editor-description-input{min-height:max(180px,100%);height:100%;box-sizing:border-box;resize:vertical;}</style>`;

function renderSectionTitleWithHelp(
  label: string,
  helpText: string,
  options: { id?: string; className?: string } = {},
): string {
  const idAttr = options.id ? ` id="${escapeHtmlAttr(options.id)}"` : "";
  const className = options.className ? ` ${escapeHtmlAttr(options.className)}` : "";
  const help = escapeHtmlAttr(helpText);

  return `<div class="section-title-with-help${className}" title="${help}"><div class="section-title"${idAttr} title="${help}">${escapeHtml(label)}</div><span class="section-title-help-trigger" aria-hidden="true" title="${help}">?</span></div>`;
}

export function buildSchedulerTodoEditorMarkup(options: {
  strings: ReturnType<typeof buildSchedulerWebviewStrings>;
}): string {
  const { strings } = options;

  return `<div id="todo-edit-tab" class="tab-content">
    <div class="todo-editor-shell">
      <div class="todo-editor-header">
        <div>
          ${renderSectionTitleWithHelp(strings.boardDetailTitleCreate, strings.boardDetailModeCreate, { id: "todo-detail-title" })}
          <div id="todo-detail-status" class="note"></div>
        </div>
      </div>

      <form id="todo-detail-form">
        <input type="hidden" id="todo-detail-id">
        <div class="todo-editor-grid">
          <section class="todo-editor-card todo-editor-card-primary">
            <div class="form-group" style="margin:0;">
              <label for="todo-title-input">${escapeHtml(strings.boardFieldTitle)}</label>
              <input type="text" id="todo-title-input">
            </div>
            <div class="form-group todo-editor-description-group" style="margin:0;">
              <label for="todo-description-input">${escapeHtml(strings.boardFieldDescription)}</label>
              <textarea id="todo-description-input" class="todo-editor-description-input"></textarea>
            </div>
            <div class="todo-upload-row">
              <button type="button" class="btn-secondary" id="todo-upload-files-btn">${escapeHtml(strings.boardUploadFiles)}</button>
              <div id="todo-upload-files-note" class="note todo-upload-note">${escapeHtml(strings.boardUploadFilesHint)}</div>
            </div>
          </section>

          <section class="todo-editor-card todo-editor-card-aside">
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
              <div class="form-group" style="margin:0;">
                <label for="todo-due-input">${escapeHtml(strings.boardFieldDueAt)}</label>
                <input type="datetime-local" id="todo-due-input">
              </div>
              <div class="form-group" style="margin:0;">
                <label for="todo-priority-input">${escapeHtml(strings.boardFieldPriority)}</label>
                <select id="todo-priority-input"></select>
              </div>
              <div class="form-group" style="margin:0;">
                <label for="todo-section-input">${escapeHtml(strings.boardFieldSection)}</label>
                <select id="todo-section-input"></select>
              </div>
              <div class="form-group" style="margin:0;">
                <label for="todo-linked-task-select">${escapeHtml(strings.boardFieldLinkedTask)}</label>
                <select id="todo-linked-task-select"></select>
              </div>
            </div>
            <div class="form-group" style="margin:0;">
              <label for="todo-labels-input" title="${escapeHtmlAttr(strings.boardLabelHint)}">${escapeHtml(strings.boardFieldLabels)}</label>
              <div id="todo-label-chip-list" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;"></div>
              <div class="todo-inline-actions-row">
                <input type="text" id="todo-labels-input" autocomplete="off" placeholder="${escapeHtmlAttr(strings.boardLabelInputPlaceholder)}" style="flex:1;">
                <button type="button" class="btn-secondary" id="todo-label-add-btn">${escapeHtml(strings.boardLabelAdd)}</button>
                <button type="button" class="btn-secondary" id="todo-label-color-save-btn">Save Label</button>
                <span class="todo-color-input-shell">
                  <input type="color" id="todo-label-color-input" value="#4f8cff" title="${escapeHtmlAttr(strings.boardLabelSaveColor)}">
                </span>
              </div>
              <div id="todo-label-suggestions" class="label-suggestion-list"></div>
              <div id="todo-label-catalog" class="label-catalog-section"></div>
            </div>
            
            <div class="form-group" style="margin:0;">
              <label for="todo-flag-name-input" title="${escapeHtmlAttr(strings.boardFlagCatalogHint)}">${escapeHtml(strings.boardFieldFlags)}</label>
              <div id="todo-flag-current" style="min-height:24px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:6px;"></div>
              <div class="todo-inline-actions-row" style="margin-top:4px;">
                <input type="text" id="todo-flag-name-input" autocomplete="off" placeholder="New flag name..." style="flex:1;">
                <button type="button" class="btn-secondary" id="todo-flag-add-btn">${escapeHtml(strings.boardFlagAdd)}</button>
                <button type="button" class="btn-secondary" id="todo-flag-color-save-btn">Save Flag</button>
                <span class="todo-color-input-shell">
                  <input type="color" id="todo-flag-color-input" value="#f59e0b" title="Flag color">
                </span>
              </div>
              <div id="todo-flag-picker" class="flag-catalog-section"></div>
              <div class="note" style="margin-top:4px;margin-bottom:8px;">${escapeHtml(strings.boardFlagCatalogHint)}</div>
            </div>
            <div id="todo-linked-task-note" class="note">${escapeHtml(strings.boardTaskDraftNote)}</div>
            <div class="button-group todo-editor-action-row">
              <button type="submit" class="btn-primary" id="todo-save-btn">${escapeHtml(strings.boardSaveCreate)}</button>
              <button type="button" class="btn-secondary" id="todo-complete-btn">${escapeHtml(strings.boardCompleteTodo)}</button>
              <button type="button" class="btn-secondary" id="todo-delete-btn">${escapeHtml(strings.boardDeleteTodo)}</button>
              <button type="button" class="btn-secondary" id="todo-create-task-btn">${escapeHtml(strings.boardCreateTask)}</button>
            </div>
          </section>
        </div>

        <section class="todo-editor-card todo-comments-spotlight" aria-labelledby="todo-comments-heading">
          <div class="todo-comments-spotlight-header">
            <div class="todo-comments-header-copy">
              <div class="todo-comments-eyebrow">${escapeHtml(strings.boardCommentsEyebrow || "Conversation thread")}</div>
              <div class="todo-comments-title-row">
                  ${renderSectionTitleWithHelp(strings.boardCommentsTitle, strings.boardCommentsCreateIntro || "Start the thread early so context, approvals, and decisions do not get buried in the description.", { id: "todo-comments-heading", className: "todo-comments-title-inline" })}
                <span id="todo-comment-count-badge" class="todo-comments-count-badge">${escapeHtml(strings.boardCommentBadgeDraft || "Draft")}</span>
              </div>
              <p id="todo-comment-context-note" class="note todo-comments-context-note">${escapeHtml(strings.boardCommentsCreateIntro || "Start the thread early so context, approvals, and decisions do not get buried in the description.")}</p>
            </div>
            <div id="todo-comment-mode-pill" class="todo-comments-mode-pill">${escapeHtml(strings.boardCommentModeCreate || "Kickoff note")}</div>
          </div>

          <div class="todo-comments-layout">
            <div class="todo-comment-thread-shell">
              <div class="todo-comment-thread-header">
                <div class="todo-comment-thread-title">${escapeHtml(strings.boardCommentThreadTitle || "Thread preview")}</div>
                <div id="todo-comment-thread-note" class="note todo-comment-thread-note">${escapeHtml(strings.boardCommentThreadCreateEmpty || "Start typing to preview the kickoff comment.")}</div>
              </div>
              <div id="todo-comment-list" class="todo-editor-comments" style="min-height:min(52vh,320px);"></div>
            </div>

            <div class="todo-comment-composer-shell">
              <div class="todo-comment-composer-topline">
                <div id="todo-comment-composer-title" class="todo-comment-composer-title">${escapeHtml(strings.boardCommentComposerCreateTitle || "Write the kickoff comment")}</div>
                <div id="todo-comment-composer-note" class="note todo-comment-composer-note">${escapeHtml(strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.")}</div>
              </div>

              <div class="form-group" style="margin:0;">
                <div class="todo-comment-input-label-row">
                  <label for="todo-comment-input">${escapeHtml(strings.boardCommentComposerEditTitle || "Add to the thread")}</label>
                </div>
                <textarea id="todo-comment-input" class="todo-comment-textarea" placeholder="${escapeHtmlAttr(strings.boardCommentCreatePlaceholder || "Capture the first decision, approval note, or handoff context for this todo...")}"></textarea>
              </div>

              <div class="todo-comment-composer-footer">
                <p id="todo-comment-draft-status" class="note todo-comment-draft-status">${escapeHtml(strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.")}</p>
                <div class="button-group" style="margin:0;justify-content:flex-end;">
                  <button type="button" class="btn-secondary" id="todo-add-comment-btn">${escapeHtml(strings.boardAddComment)}</button>
                </div></div></div>
          </div>
        </section>
      </form>
      <div class="todo-editor-footer">
        <button type="button" class="btn-secondary" id="todo-back-btn">${escapeHtml(strings.boardBackToCockpit)}</button>
      </div>
    </div>
  </div>`;
}

export function buildSchedulerListTabMarkup(options: {
  strings: ReturnType<typeof buildSchedulerWebviewStrings>;
}): string {
  const { strings } = options;

  return `<div id="list-tab" class="tab-content"><div id="success-toast" style="display:none; background:var(--vscode-notificationsInfoIcon-foreground); color:var(--vscode-button-foreground); padding:8px 14px; border-radius:4px; margin-bottom:12px; font-size:13px; opacity:1; transition:opacity 0.5s ease-out;"></div><div class="button-group" style="margin-bottom: 16px;">
      <button class="btn-secondary" id="refresh-btn">${escapeHtml(strings.actionRefresh)}</button>
      <button class="btn-secondary" id="auto-show-startup-btn"></button>
    </div>
    <p class="note" id="auto-show-startup-note" style="margin-top:-8px; margin-bottom:12px;"></p>
    <div class="history-toolbar">
      <label for="schedule-history-select">${escapeHtml(strings.cockpitHistoryLabel)}</label>
      <select id="schedule-history-select"></select>
      <button class="btn-secondary" id="restore-history-btn">${escapeHtml(strings.actionRestoreBackup)}</button>
    </div>
    <p class="note" id="schedule-history-note">${escapeHtml(strings.cockpitHistoryNote)}</p>
    <div id="task-filter-bar" class="task-filter-bar">
      <button type="button" class="btn-secondary task-filter-btn active" data-filter="all">${escapeHtml(strings.labelAllTasks)}</button>
      <button type="button" class="btn-secondary task-filter-btn" data-filter="manual">${escapeHtml(strings.labelManualSessions)}</button>
      <button type="button" class="btn-secondary task-filter-btn" data-filter="recurring">${escapeHtml(strings.labelRecurringTasks)}</button>
      <button type="button" class="btn-secondary task-filter-btn" data-filter="one-time">${escapeHtml(strings.labelOneTimeTasks)}</button>
      <label for="task-label-filter">${escapeHtml(strings.labelFilterByLabel)}</label>
      <select id="task-label-filter" class="task-filter-select">
        <option value="">${escapeHtml(strings.labelAllLabels)}</option>
      </select></div><div id="task-list" class="task-list">
      <div class="empty-state">${escapeHtml(strings.noTasksFound)}</div>
    </div>
  </div>`;
}
