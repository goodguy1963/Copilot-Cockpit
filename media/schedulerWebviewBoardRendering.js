export function renderTodoBoardMarkup(options) {
  var visibleSections = options.visibleSections;
  var cards = options.cards;
  var filters = options.filters;
  var strings = options.strings;

  if (filters.viewMode === "list") {
    return renderTodoListView(visibleSections, cards, filters, options);
  }

  return renderTodoBoardColumns(visibleSections, cards, filters, options);
}

function getLatestTodoComment(card) {
  return Array.isArray(card.comments) && card.comments.length
    ? card.comments[card.comments.length - 1]
    : null;
}

function renderTodoCompactActions(card, options) {
  var strings = options.strings;
  var helpers = options.helpers;

  function renderActionButton(cls, dataAttr, label, iconHtml) {
    return '<button type="button" class="' + cls + ' todo-list-action-btn todo-card-icon-btn" ' + dataAttr + '="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(label) + '" aria-label="' + helpers.escapeAttr(label) + '">' + iconHtml + '</button>';
  }

  var actions = [
    renderActionButton(
      'btn-secondary todo-card-edit',
      'data-todo-edit',
      strings.boardEditTodo || 'Open Editor',
      '&#9998;'
    )
  ];

  if (card.archived) {
    actions.push(
      renderActionButton(
        'btn-secondary todo-card-restore',
        'data-todo-restore',
        strings.boardRestoreTodo || 'Restore',
        '&#8634;'
      )
    );
    actions.push(
      renderActionButton(
        'btn-danger todo-card-purge',
        'data-todo-purge',
        strings.boardDeleteTodoPermanent || 'Delete Permanently',
        '&#128465;'
      )
    );
  } else {
    if (card.status === "ready") {
      actions.push(
        renderActionButton(
          'btn-secondary todo-card-reject',
          'data-todo-reject',
          strings.boardDeclineTodo || 'Decline',
          '&#8855;'
        )
      );
    }
    actions.push(
      renderActionButton(
        'btn-secondary todo-card-delete',
        'data-todo-delete',
        strings.boardDeleteTodo || 'Delete Todo',
        '&#128465;'
      )
    );
  }

  return '<div class="todo-list-actions' + (actions.length === 1 ? ' has-single-action' : '') + '">' +
    actions.join("") +
    '</div>';
}

function renderTodoListRow(card, sectionId, options) {
  var strings = options.strings;
  var helpers = options.helpers;
  var selectedTodoId = options.selectedTodoId;
  var isSelected = card.id === selectedTodoId;
  var latestComment = getLatestTodoComment(card);
  var summary = card.description
    ? helpers.getTodoDescriptionPreview(card.description)
    : latestComment && latestComment.body
      ? helpers.getTodoCommentSourceLabel(latestComment.source || "human-form") + ': ' + helpers.getTodoDescriptionPreview(latestComment.body)
      : (card.taskId
        ? (strings.boardTaskLinked || "Linked task")
        : (strings.boardDescriptionPreviewEmpty || "No description yet."));
  var cardFlag = Array.isArray(card.flags) && card.flags[0] ? card.flags[0] : "";
  var metaParts = [
    '<span data-card-meta>' + helpers.escapeHtml(helpers.getTodoPriorityLabel(card.priority || "none")) + '</span>',
    '<span data-card-meta>' + helpers.escapeHtml(helpers.getTodoStatusLabel(card.status || "active")) + '</span>'
  ];
  if (card.dueAt) {
    metaParts.push('<span data-card-meta>' + helpers.escapeHtml((strings.boardDueLabel || "Due") + ': ' + helpers.formatTodoDate(card.dueAt)) + '</span>');
  }
  if (card.archived && card.archiveOutcome) {
    metaParts.push('<span data-card-meta>' + helpers.escapeHtml(helpers.getTodoArchiveOutcomeLabel(card.archiveOutcome)) + '</span>');
  }
  if (cardFlag) {
    metaParts.push(helpers.renderFlagChip(cardFlag, false));
  }
  var visibleLabels = Array.isArray(card.labels) ? card.labels.slice(0, 2) : [];
  if (visibleLabels.length) {
    metaParts.push(visibleLabels.map(function (label) {
      return helpers.renderLabelChip(label, false, false);
    }).join(" "));
  }

  return '<article class="todo-list-row" draggable="false" data-todo-id="' + helpers.escapeAttr(card.id) + '" data-section-id="' + helpers.escapeAttr(sectionId) + '" data-order="' + String(card.order || 0) + '" data-selected="' + (isSelected ? 'true' : 'false') + '" style="border-radius:8px;background:' + helpers.getTodoPriorityCardBg(card.priority || "none", false) + ';border:1px solid var(--vscode-widget-border);padding:var(--cockpit-card-pad, 8px);cursor:pointer;">' +
    '<div class="todo-list-main">' +
      '<div class="todo-list-title-line">' +
        '<div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' +
          helpers.renderTodoCompletionCheckbox(card) +
          '<strong class="todo-list-title">' + helpers.escapeHtml(card.title || (strings.boardCardUntitled || "Untitled")) + '</strong>' +
        '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-width:0;">' + helpers.renderTodoDragHandle(card) + metaParts.join("") + '</div>' +
      '</div>' +
      '<div class="cockpit-card-details">' +
        '<div class="note todo-list-summary">' + helpers.escapeHtml(summary) + '</div>' +
      '</div>' +
    '</div>' +
    renderTodoCompactActions(card, options) +
  '</article>';
}

function renderTodoListView(visibleSections, cards, filters, options) {
  var strings = options.strings;
  var helpers = options.helpers;
  var collapsedSections = options.collapsedSections;
  return '<div class="todo-list-view">' +
    visibleSections.map(function (section) {
      var sectionCards = helpers.sortTodoCards(cards.filter(function (card) {
        return card.sectionId === section.id && helpers.cardMatchesTodoFilters(card, filters);
      }), filters);
      var isCollapsed = collapsedSections.has(section.id);
      var isSpecialSection = helpers.isSpecialTodoSectionId(section.id);
      return '<section class="todo-list-section' + (isCollapsed ? ' is-collapsed' : '') + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '">' +
        '<div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px);">' +
          '<button type="button" class="cockpit-collapse-btn' + (isCollapsed ? ' collapsed' : '') + '" data-section-collapse="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(isCollapsed ? (strings.boardSectionExpand || "Expand section") : (strings.boardSectionCollapse || "Collapse section")) + '">&#9660;</button>' +
          helpers.renderSectionDragHandle(section, isSpecialSection) +
          '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + helpers.escapeHtml(section.title || (strings.boardSectionUntitled || "Section")) + ' <span class="note">(' + String(sectionCards.length) + ')</span></strong>' +
          (isSpecialSection
            ? ''
            : '<div class="cockpit-section-actions">' +
              '<button type="button" class="btn-icon" data-section-rename="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionRename || "Rename section") + '">&#9998;</button>' +
              '<button type="button" class="btn-icon" data-section-delete="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionDelete || "Delete section") + '">&#215;</button>' +
            '</div>') +
        '</div>' +
        '<div class="section-body-wrapper' + (isCollapsed ? ' collapsed' : '') + '">' +
          '<div class="section-body-inner">' +
            '<div class="todo-list-items">' +
              (sectionCards.length
                ? sectionCards.map(function (card) {
                  return renderTodoListRow(card, section.id, options);
                }).join("")
                : '<div class="note">' + helpers.escapeHtml(strings.boardListEmptySection || strings.boardEmpty || "No todos in this section.") + '</div>') +
            '</div>' +
          '</div>' +
        '</div>' +
      '</section>';
    }).join("") +
  '</div>';
}

function renderTodoBoardColumns(visibleSections, cards, filters, options) {
  var strings = options.strings;
  var helpers = options.helpers;
  var collapsedSections = options.collapsedSections;
  var selectedTodoId = options.selectedTodoId;
  return '<div style="display:flex;gap:16px;align-items:flex-start;min-width:max-content;">' +
    visibleSections.map(function (section) {
      var sectionCards = helpers.sortTodoCards(cards.filter(function (card) {
        return card.sectionId === section.id && helpers.cardMatchesTodoFilters(card, filters);
      }), filters);
      var isSpecialSection = helpers.isSpecialTodoSectionId(section.id);
      return (
        '<section class="board-column' + (collapsedSections.has(section.id) ? ' is-collapsed' : '') + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '" style="display:flex;flex-direction:column;border-radius:10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);width:var(--cockpit-col-width,240px);min-width:var(--cockpit-col-width,240px);overflow:visible;">' +
        '<div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px)">' +
        '<button type="button" class="cockpit-collapse-btn' + (collapsedSections.has(section.id) ? ' collapsed' : '') + '" data-section-collapse="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(collapsedSections.has(section.id) ? (strings.boardSectionExpand || "Expand section") : (strings.boardSectionCollapse || "Collapse section")) + '">&#9660;</button>' +
        helpers.renderSectionDragHandle(section, isSpecialSection) +
        '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + helpers.escapeHtml(section.title || (strings.boardSectionUntitled || "Section")) + '</strong>' +
        (isSpecialSection
          ? ''
          : '<div class="cockpit-section-actions">' +
            '<button type="button" class="btn-icon" data-section-rename="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionRename || "Rename section") + '">&#9998;</button>' +
            '<button type="button" class="btn-icon" data-section-delete="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionDelete || "Delete section") + '">&#215;</button>' +
          '</div>') +
        '</div>' +
        '<div class="section-body-wrapper' + (collapsedSections.has(section.id) ? ' collapsed' : '') + '">' +
        '<div class="section-body-inner">' +
          '<div style="padding:0 var(--cockpit-card-pad,9px) var(--cockpit-card-pad,9px);">'+
        '<div style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);min-height:60px;">'  +
        (sectionCards.length
          ? sectionCards.map(function (card) {
            var isSelected = card.id === selectedTodoId;
            var cardFlag = Array.isArray(card.flags) && card.flags[0] ? card.flags[0] : "";
            var chipMarkup = (cardFlag || (Array.isArray(card.labels) && card.labels.length))
              ? '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">' +
                (cardFlag ? helpers.renderFlagChip(cardFlag, false) : '') +
                (Array.isArray(card.labels) && card.labels.length
                  ? '<div class="card-labels" style="display:flex;flex-wrap:wrap;gap:6px;">' + card.labels.slice(0, 6).map(function (label, idx) {
                      return '<span data-label-slot="' + idx + '">' + helpers.renderLabelChip(label, false, false) + '</span>';
                    }).join("") + '</div>'
                  : '') +
                '</div>'
              : '';
            var latestComment = Array.isArray(card.comments) && card.comments.length
              ? card.comments[card.comments.length - 1]
              : null;
            var dueMarkup = card.dueAt
              ? '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml((strings.boardDueLabel || "Due") + ': ' + helpers.formatTodoDate(card.dueAt)) + '</span>'
              : '';
            var archiveMarkup = card.archived && card.archiveOutcome
              ? '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml(helpers.getTodoArchiveOutcomeLabel(card.archiveOutcome)) + '</span>'
              : '';
            var latestCommentMarkup = latestComment && latestComment.body
              ? '<div class="note" style="display:flex;gap:6px;align-items:flex-start;">' +
                '<strong data-card-meta>' + helpers.escapeHtml(strings.boardLatestComment || "Latest comment") + ':</strong>' +
                '<span data-card-meta>#' + helpers.escapeHtml(String(latestComment.sequence || 1)) + ' • ' + helpers.escapeHtml(helpers.getTodoCommentSourceLabel(latestComment.source || "human-form")) + ' • ' + helpers.escapeHtml(helpers.getTodoDescriptionPreview(latestComment.body || "")) + '</span>' +
                '</div>'
              : '';
            return (
              '<article draggable="false" data-todo-id="' + helpers.escapeAttr(card.id) + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-order="' + String(card.order || 0) + '" data-selected="' + (isSelected ? 'true' : 'false') + '" style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);border-radius:8px;padding:var(--cockpit-card-pad,8px);background:' + helpers.getTodoPriorityCardBg(card.priority || "none", false) + ';border:1px solid var(--vscode-widget-border);cursor:pointer;">' +
              '<div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;">' +
              '<div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' +
              helpers.renderTodoCompletionCheckbox(card) +
              '<strong style="line-height:1.3;min-width:0;">' + helpers.escapeHtml(card.title || (strings.boardCardUntitled || "Untitled")) + '</strong>' +
              '</div>' +
              '<div style="display:flex;align-items:center;gap:6px;">' + helpers.renderTodoDragHandle(card) + '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml(helpers.getTodoPriorityLabel(card.priority || "none")) + '</span></div>' +
              '</div>' +
              (dueMarkup || archiveMarkup ? '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + dueMarkup + archiveMarkup + '</div>' : '') +
              chipMarkup +
              '<div class="cockpit-card-details">' +
                '<div class="note" style="white-space:pre-wrap;">' + helpers.escapeHtml(helpers.getTodoDescriptionPreview(card.description || "")) + '</div>' +
                latestCommentMarkup +
              '</div>' +
              renderTodoCompactActions(card, options).replace('todo-list-actions', 'todo-card-action-row') +
              '</article>'
            );
          }).join("")
          : '<div class="note">' + helpers.escapeHtml(strings.boardEmpty || "No cards yet.") + '</div>') +
          '</div>' +
          '</div>' +
          '</div>' +
          '</div>' +
          '</section>'
      );
    }).join("") +
    '</div>';
}