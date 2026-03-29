"use strict";
(() => {
  // media/schedulerWebviewBoardInteractions.js
  function getEventTargetElement(eventOrTarget) {
    var target = eventOrTarget && eventOrTarget.target ? eventOrTarget.target : eventOrTarget;
    if (target && target.nodeType === 3) {
      target = target.parentElement;
    }
    return target || null;
  }
  function getClosestEventTarget(eventOrTarget, selector) {
    var target = getEventTargetElement(eventOrTarget);
    return target && target.closest ? target.closest(selector) : null;
  }
  function isTodoInteractiveTarget(target) {
    return !!getClosestEventTarget(
      target,
      [
        "input",
        "button",
        "select",
        "textarea",
        "a",
        "label",
        '[role="button"]',
        '[contenteditable="true"]',
        "[data-no-drag]",
        "[data-todo-edit]",
        "[data-todo-delete]",
        "[data-todo-purge]",
        "[data-todo-reject]",
        "[data-todo-restore]",
        "[data-todo-complete]",
        "[data-section-collapse]",
        "[data-section-rename]",
        "[data-section-delete]"
      ].join(", ")
    );
  }
  function scheduleBoardTimeout(options, callback, delay) {
    var timeoutFn = options && typeof options.setTimeout === "function" ? options.setTimeout : typeof setTimeout === "function" ? setTimeout : null;
    if (!timeoutFn) {
      callback();
      return null;
    }
    return timeoutFn.call(null, callback, delay);
  }
  function handleBoardSectionCollapse(collapseBtn, options) {
    var sectionId = collapseBtn.getAttribute("data-section-collapse");
    options.toggleSectionCollapsed(sectionId);
    var sectionEl = collapseBtn.closest ? collapseBtn.closest("[data-section-id]") : null;
    var bodyWrapper = sectionEl ? sectionEl.querySelector(".section-body-wrapper") : null;
    var isNowCollapsed = options.collapsedSections.has(sectionId);
    collapseBtn.classList.toggle("collapsed", isNowCollapsed);
    collapseBtn.title = isNowCollapsed ? "Expand section" : "Collapse section";
    if (bodyWrapper) {
      bodyWrapper.classList.toggle("collapsed", isNowCollapsed);
    }
    if (sectionEl) {
      sectionEl.classList.toggle("is-collapsed", isNowCollapsed);
    }
  }
  function handleBoardSectionRename(sectionRenameBtn, options) {
    var sectionId = sectionRenameBtn.getAttribute("data-section-rename");
    var sectionEl = sectionRenameBtn.closest ? sectionRenameBtn.closest("[data-section-id]") : null;
    var sectionHeader = sectionEl ? sectionEl.querySelector(".cockpit-section-header") : null;
    var strongEl = sectionHeader ? sectionHeader.querySelector("strong") : null;
    if (!strongEl) return;
    var currentTitle = strongEl.textContent || "";
    var inputEl = options.document.createElement("input");
    inputEl.type = "text";
    inputEl.value = currentTitle;
    inputEl.style.cssText = "font-weight:600;font-size:inherit;width:110px;max-width:100%;border:1px solid var(--vscode-focusBorder);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:3px;padding:1px 4px;";
    var committed = false;
    var saveRename = function() {
      if (committed) return;
      committed = true;
      var newTitle = inputEl.value.trim();
      if (newTitle && newTitle !== currentTitle) {
        options.vscode.postMessage({ type: "renameCockpitSection", sectionId, title: newTitle });
      } else {
        strongEl.style.display = "";
        if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      }
    };
    inputEl.onkeydown = function(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        saveRename();
      }
      if (e.key === "Escape") {
        committed = true;
        strongEl.style.display = "";
        if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
      }
    };
    inputEl.onblur = function() {
      scheduleBoardTimeout(options, saveRename, 120);
    };
    strongEl.style.display = "none";
    strongEl.parentNode.insertBefore(inputEl, strongEl);
    inputEl.select();
  }
  function handleBoardSectionDelete(sectionDeleteBtn, options) {
    var sectionId = sectionDeleteBtn.getAttribute("data-section-delete");
    if (sectionDeleteBtn.getAttribute("data-confirming")) {
      options.vscode.postMessage({ type: "deleteCockpitSection", sectionId });
      sectionDeleteBtn.removeAttribute("data-confirming");
      return;
    }
    sectionDeleteBtn.setAttribute("data-confirming", "1");
    var origText = sectionDeleteBtn.textContent;
    var origColor = sectionDeleteBtn.style.color;
    sectionDeleteBtn.textContent = options.strings.boardDeleteConfirm || "Delete?";
    sectionDeleteBtn.style.color = "var(--vscode-errorForeground)";
    sectionDeleteBtn.style.opacity = "1";
    scheduleBoardTimeout(options, function() {
      if (sectionDeleteBtn.getAttribute("data-confirming")) {
        sectionDeleteBtn.removeAttribute("data-confirming");
        sectionDeleteBtn.textContent = origText;
        sectionDeleteBtn.style.color = origColor;
        sectionDeleteBtn.style.opacity = "";
      }
    }, 2500);
  }
  function handleBoardTodoCompletion(completeToggle, options) {
    var todoId = completeToggle.getAttribute("data-todo-complete");
    var cardEl = completeToggle.closest ? completeToggle.closest("[data-todo-id]") : null;
    completeToggle.disabled = true;
    if (cardEl) {
      cardEl.style.opacity = "0.35";
      cardEl.style.pointerEvents = "none";
    }
    var nextActionType = "approveTodo";
    var cockpitBoard = options.cockpitBoard;
    if (cockpitBoard && Array.isArray(cockpitBoard.cards)) {
      for (var oi = 0; oi < cockpitBoard.cards.length; oi++) {
        if (cockpitBoard.cards[oi] && cockpitBoard.cards[oi].id === todoId) {
          if (cockpitBoard.cards[oi].status === "ready") {
            nextActionType = "finalizeTodo";
          }
          break;
        }
      }
    }
    options.vscode.postMessage({ type: nextActionType, todoId });
  }
  function stopBoardEvent(event) {
    if (!event) {
      return;
    }
    if (typeof event.preventDefault === "function") {
      event.preventDefault();
    }
    if (typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
  }
  var activeBoardOptions = null;
  var boardListenersInstalled = false;
  var pointerDragSession = null;
  var suppressNextBoardClick = false;
  var TODO_POINTER_DRAG_THRESHOLD_PX = 6;
  function setBoardDocumentDragState(options, active, kind) {
    var doc = options && options.document;
    var body = doc && doc.body;
    if (!body || !body.classList) {
      return;
    }
    body.classList.toggle("cockpit-board-dragging", !!active);
    body.classList.toggle("cockpit-board-dragging-section", !!active && kind === "section");
    body.classList.toggle("cockpit-board-dragging-todo", !!active && kind === "todo");
    if (body.style) {
      body.style.userSelect = active ? "none" : "";
      body.style.webkitUserSelect = active ? "none" : "";
      body.style.cursor = active ? "grabbing" : "";
    }
  }
  function armBoardClickSuppression() {
    suppressNextBoardClick = true;
  }
  function consumeSuppressedBoardClick(event) {
    if (!suppressNextBoardClick) {
      return false;
    }
    suppressNextBoardClick = false;
    stopBoardEvent(event);
    return true;
  }
  function hasTodoPointerDragThreshold(event, session) {
    if (!event || !session || typeof event.clientX !== "number" || typeof event.clientY !== "number") {
      return true;
    }
    var deltaX = event.clientX - session.startX;
    var deltaY = event.clientY - session.startY;
    return deltaX * deltaX + deltaY * deltaY >= TODO_POINTER_DRAG_THRESHOLD_PX * TODO_POINTER_DRAG_THRESHOLD_PX;
  }
  function activatePointerDragSession(options) {
    var session = pointerDragSession;
    if (!options || !session || session.activated) {
      return;
    }
    session.activated = true;
    options.setIsBoardDragging(true);
    setBoardDocumentDragState(options, true, session.kind);
    if (session.kind === "section") {
      options.setDraggingSectionId(session.draggedId);
      options.setLastDragOverSectionId(null);
      if (session.draggedElement) {
        session.draggedElement.classList.add("section-dragging");
      }
      return;
    }
    options.setDraggingTodoId(session.draggedId);
    if (session.draggedElement) {
      session.draggedElement.classList.add("todo-dragging");
    }
  }
  function getBoardColumns(options) {
    if (!options) {
      return null;
    }
    if (typeof options.getBoardColumns === "function") {
      return options.getBoardColumns();
    }
    return options.boardColumns || null;
  }
  function getBoardTarget(eventOrTarget) {
    return getEventTargetElement(eventOrTarget);
  }
  function isTargetInsideBoard(options, target) {
    var boardColumns = getBoardColumns(options);
    var element = getBoardTarget(target);
    return !!(boardColumns && element && typeof boardColumns.contains === "function" && boardColumns.contains(element));
  }
  function clearBoardDragClasses(boardColumns) {
    if (!boardColumns || typeof boardColumns.querySelectorAll !== "function") {
      return;
    }
    Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-id].section-drag-over"), function(el) {
      el.classList.remove("section-drag-over");
    });
    Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-id].section-dragging"), function(el) {
      el.classList.remove("section-dragging");
    });
    Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-todo-id].todo-dragging"), function(el) {
      el.classList.remove("todo-dragging");
    });
    Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-todo-id].todo-drop-target"), function(el) {
      el.classList.remove("todo-drop-target");
    });
  }
  function getPointerPointTarget(options, event) {
    var doc = options && options.document;
    if (doc && typeof doc.elementFromPoint === "function" && event && typeof event.clientX === "number" && typeof event.clientY === "number") {
      var pointTarget = doc.elementFromPoint(event.clientX, event.clientY);
      if (pointTarget) {
        return pointTarget;
      }
    }
    return getBoardTarget(event);
  }
  function updateSectionDragState(options, boardColumns, pointTarget) {
    var section = getClosestEventTarget(pointTarget, "[data-section-id]");
    clearBoardDragClasses(boardColumns);
    if (!section) {
      options.setLastDragOverSectionId(null);
      if (pointerDragSession && pointerDragSession.draggedElement) {
        pointerDragSession.draggedElement.classList.add("section-dragging");
      }
      return;
    }
    var sectionId = section.getAttribute("data-section-id");
    var draggingSectionId = options.getDraggingSectionId();
    if (!sectionId || sectionId === draggingSectionId || options.isArchiveTodoSectionId(sectionId)) {
      options.setLastDragOverSectionId(null);
      if (pointerDragSession && pointerDragSession.draggedElement) {
        pointerDragSession.draggedElement.classList.add("section-dragging");
      }
      return;
    }
    section.classList.add("section-drag-over");
    if (pointerDragSession && pointerDragSession.draggedElement) {
      pointerDragSession.draggedElement.classList.add("section-dragging");
    }
    options.setLastDragOverSectionId(sectionId);
  }
  function updateTodoDragState(options, boardColumns, pointTarget) {
    var section = getClosestEventTarget(pointTarget, "[data-section-id]");
    var targetCard = getClosestEventTarget(pointTarget, "[data-todo-id]");
    clearBoardDragClasses(boardColumns);
    if (pointerDragSession && pointerDragSession.draggedElement) {
      pointerDragSession.draggedElement.classList.add("todo-dragging");
    }
    if (!section) {
      return;
    }
    var sectionId = section.getAttribute("data-section-id");
    if (!sectionId || options.isArchiveTodoSectionId(sectionId)) {
      return;
    }
    if (targetCard && targetCard.getAttribute("data-todo-id") !== options.getDraggingTodoId()) {
      targetCard.classList.add("todo-drop-target");
      return;
    }
    section.classList.add("section-drag-over");
  }
  function updatePointerDragSession(event) {
    var options = activeBoardOptions;
    if (!options || !pointerDragSession) {
      return;
    }
    if (!pointerDragSession.activated) {
      if (!hasTodoPointerDragThreshold(event, pointerDragSession)) {
        return;
      }
      activatePointerDragSession(options);
      armBoardClickSuppression();
    }
    stopBoardEvent(event);
    var boardColumns = getBoardColumns(options);
    if (!boardColumns) {
      setBoardDocumentDragState(options, false);
      options.finishBoardDragState();
      pointerDragSession = null;
      return;
    }
    var pointTarget = getPointerPointTarget(options, event);
    if (pointerDragSession.kind === "section") {
      updateSectionDragState(options, boardColumns, pointTarget);
      return;
    }
    updateTodoDragState(options, boardColumns, pointTarget);
  }
  function finishPointerDragSession(event, cancelled) {
    var options = activeBoardOptions;
    var session = pointerDragSession;
    if (!options || !session) {
      pointerDragSession = null;
      return;
    }
    if (!session.activated) {
      setBoardDocumentDragState(options, false);
      pointerDragSession = null;
      return;
    }
    var boardColumns = getBoardColumns(options);
    var pointTarget = cancelled ? null : getPointerPointTarget(options, event);
    if (boardColumns) {
      clearBoardDragClasses(boardColumns);
    }
    if (!cancelled && boardColumns && session.kind === "section") {
      var dropSection = getClosestEventTarget(pointTarget, "[data-section-id]");
      var dropSectionId = dropSection ? dropSection.getAttribute("data-section-id") : null;
      if (!dropSectionId || dropSectionId === options.getDraggingSectionId()) {
        dropSectionId = options.getLastDragOverSectionId();
      }
      if (dropSectionId && dropSectionId !== options.getDraggingSectionId()) {
        var allSections = boardColumns.querySelectorAll("[data-section-id]");
        var targetIndex = -1;
        for (var i = 0; i < allSections.length; i += 1) {
          if (allSections[i].getAttribute("data-section-id") === dropSectionId) {
            targetIndex = i;
            break;
          }
        }
        if (targetIndex >= 0) {
          options.vscode.postMessage({ type: "reorderCockpitSection", sectionId: options.getDraggingSectionId(), targetIndex });
        }
      }
    }
    if (!cancelled && boardColumns && session.kind === "todo") {
      var section = getClosestEventTarget(pointTarget, "[data-section-id]");
      var targetCard = getClosestEventTarget(pointTarget, "[data-todo-id]");
      if (section && options.getDraggingTodoId() && !options.isArchiveTodoSectionId(section.getAttribute("data-section-id"))) {
        var targetIndex = targetCard ? Number(targetCard.getAttribute("data-order") || 0) : Number(section.getAttribute("data-card-count") || 0);
        options.vscode.postMessage({
          type: "moveTodo",
          todoId: options.getDraggingTodoId(),
          sectionId: section.getAttribute("data-section-id"),
          targetIndex
        });
      }
    }
    setBoardDocumentDragState(options, false);
    options.finishBoardDragState();
    pointerDragSession = null;
    if (typeof setTimeout === "function") {
      setTimeout(function() {
        suppressNextBoardClick = false;
      }, 350);
    }
  }
  function handleBoardTodoChange(completeToggle, event) {
    var options = activeBoardOptions;
    if (!options) {
      return;
    }
    var target = getBoardTarget(event);
    if (!completeToggle || !target || !isTargetInsideBoard(options, target)) {
      return;
    }
    if (event && typeof event.stopPropagation === "function") {
      event.stopPropagation();
    }
    options.handleTodoCompletion(completeToggle);
  }
  function bindElementListener(element, eventName, handler) {
    if (!element || typeof element.addEventListener !== "function") {
      return;
    }
    element.addEventListener(eventName, handler);
  }
  var boardClickDelegationInstalled = false;
  function installBoardClickDelegation(boardColumns) {
    if (boardClickDelegationInstalled || !boardColumns || typeof boardColumns.addEventListener !== "function") {
      return;
    }
    boardClickDelegationInstalled = true;
    boardColumns.addEventListener("click", function(event) {
      var options = activeBoardOptions;
      if (!options) {
        return;
      }
      var target = getEventTargetElement(event);
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var editBtn = target.closest("[data-todo-edit]");
      if (editBtn) {
        stopBoardEvent(event);
        options.openTodoEditor(editBtn.getAttribute("data-todo-edit") || "");
        return;
      }
      var deleteBtn = target.closest("[data-todo-delete]");
      if (deleteBtn) {
        stopBoardEvent(event);
        options.openTodoDeleteModal(deleteBtn.getAttribute("data-todo-delete") || "");
        return;
      }
      var purgeBtn = target.closest("[data-todo-purge]");
      if (purgeBtn) {
        stopBoardEvent(event);
        options.openTodoDeleteModal(purgeBtn.getAttribute("data-todo-purge") || "", { permanentOnly: true });
        return;
      }
      var rejectBtn = target.closest("[data-todo-reject]");
      if (rejectBtn) {
        stopBoardEvent(event);
        options.handleTodoReject(rejectBtn);
        return;
      }
      var restoreBtn = target.closest("[data-todo-restore]");
      if (restoreBtn) {
        stopBoardEvent(event);
        options.handleTodoRestore(restoreBtn);
        return;
      }
      var completeBtn = target.closest("[data-todo-complete]");
      if (completeBtn) {
        handleBoardTodoChange(completeBtn, event);
        return;
      }
      var collapseBtn = target.closest("[data-section-collapse]");
      if (collapseBtn) {
        stopBoardEvent(event);
        options.handleSectionCollapse(collapseBtn);
        return;
      }
      var renameBtn = target.closest("[data-section-rename]");
      if (renameBtn) {
        stopBoardEvent(event);
        options.handleSectionRename(renameBtn);
        return;
      }
      var sectionDelBtn = target.closest("[data-section-delete]");
      if (sectionDelBtn) {
        stopBoardEvent(event);
        options.handleSectionDelete(sectionDelBtn);
        return;
      }
      var card = target.closest("[data-todo-id]");
      if (card) {
        if (consumeSuppressedBoardClick(event)) {
          return;
        }
        if (isTodoInteractiveTarget(target)) {
          return;
        }
        options.setSelectedTodoId(card.getAttribute("data-todo-id"));
        options.renderCockpitBoard();
      }
    });
  }
  function bindRenderedBoardListeners(boardColumns, options) {
    if (!boardColumns || typeof boardColumns.querySelectorAll !== "function") {
      return;
    }
    Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-drag-handle]"), function(sectionHandle) {
      bindElementListener(sectionHandle, "pointerdown", handleBoardPointerDown);
    });
    Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-todo-id]"), function(card) {
      bindElementListener(card, "pointerdown", handleBoardPointerDown);
    });
  }
  function handleBoardPointerDown(event) {
    var options = activeBoardOptions;
    if (!options) {
      return;
    }
    suppressNextBoardClick = false;
    if (typeof event.button === "number" && event.button !== 0) {
      return;
    }
    var target = getBoardTarget(event);
    if (!isTargetInsideBoard(options, target)) {
      return;
    }
    var sectionHandle = getClosestEventTarget(target, "[data-section-drag-handle]");
    var todoHandle = getClosestEventTarget(target, "[data-todo-drag-handle]");
    var boardColumns = getBoardColumns(options);
    if (!boardColumns) {
      return;
    }
    if (sectionHandle) {
      stopBoardEvent(event);
      clearBoardDragClasses(boardColumns);
      var sectionId = sectionHandle.getAttribute("data-section-drag-handle");
      var sectionEl = sectionHandle.closest ? sectionHandle.closest("[data-section-id]") : null;
      pointerDragSession = {
        kind: "section",
        draggedId: sectionId,
        draggedElement: sectionEl,
        activated: false,
        startX: typeof event.clientX === "number" ? event.clientX : 0,
        startY: typeof event.clientY === "number" ? event.clientY : 0
      };
      activatePointerDragSession(options);
      armBoardClickSuppression();
      return;
    }
    var card = todoHandle && todoHandle.closest ? todoHandle.closest("[data-todo-id]") : getClosestEventTarget(target, "[data-todo-id]");
    if (!card) {
      return;
    }
    var sectionId = card.getAttribute ? card.getAttribute("data-section-id") : "";
    if (!todoHandle && (isTodoInteractiveTarget(target) || options.isArchiveTodoSectionId(sectionId || ""))) {
      return;
    }
    clearBoardDragClasses(boardColumns);
    pointerDragSession = {
      kind: "todo",
      draggedId: todoHandle ? todoHandle.getAttribute("data-todo-drag-handle") || card.getAttribute("data-todo-id") : card.getAttribute("data-todo-id") || "",
      draggedElement: card,
      activated: false,
      startX: typeof event.clientX === "number" ? event.clientX : 0,
      startY: typeof event.clientY === "number" ? event.clientY : 0
    };
    if (todoHandle) {
      stopBoardEvent(event);
      activatePointerDragSession(options);
      armBoardClickSuppression();
    }
  }
  function installBoardListeners(options) {
    if (boardListenersInstalled) {
      return;
    }
    var win = options.window;
    if (!win || typeof win.addEventListener !== "function") {
      return;
    }
    win.addEventListener("pointermove", updatePointerDragSession, true);
    win.addEventListener("pointerup", function(event) {
      finishPointerDragSession(event, false);
    }, true);
    win.addEventListener("pointercancel", function(event) {
      finishPointerDragSession(event, true);
    }, true);
    boardListenersInstalled = true;
  }
  function bindBoardColumnInteractions(options) {
    var boardColumns = getBoardColumns(options);
    if (!boardColumns) {
      return;
    }
    activeBoardOptions = options;
    setBoardDocumentDragState(options, false);
    clearBoardDragClasses(boardColumns);
    installBoardClickDelegation(boardColumns);
    bindRenderedBoardListeners(boardColumns, options);
    installBoardListeners(options);
  }

  // media/schedulerWebviewDebug.js
  function createWebviewDebugTools(options) {
    var currentLogLevel = options && typeof options.initialLogLevel === "string" ? options.initialLogLevel : "info";
    function shouldEmitDetailedLogs() {
      return currentLogLevel === "debug";
    }
    function cloneDebugDetail(detail) {
      if (typeof detail === "undefined") {
        return {};
      }
      try {
        return JSON.parse(JSON.stringify(detail));
      } catch (_error) {
        return { value: String(detail) };
      }
    }
    function emitWebviewDebug(eventName, detail) {
      if (!shouldEmitDetailedLogs()) {
        return;
      }
      var payload = {
        event: eventName,
        detail: cloneDebugDetail(detail)
      };
      try {
        if (options && options.console && typeof options.console.log === "function") {
          options.console.log("[SchedulerWebviewDebug]", payload);
        }
      } catch (_error) {
      }
      try {
        if (options && options.vscode && typeof options.vscode.postMessage === "function") {
          options.vscode.postMessage({
            type: "debugWebview",
            event: eventName,
            detail: payload.detail
          });
        }
      } catch (_error) {
      }
    }
    function createEmptyTodoDraft() {
      return {
        title: "",
        description: "",
        dueAt: "",
        flagColor: "#f59e0b",
        flagInput: "",
        priority: "none",
        flag: "",
        labelColor: "#4f8cff",
        labelInput: "",
        sectionId: "",
        taskId: ""
      };
    }
    function resetTodoDraft(reason) {
      var nextDraft = createEmptyTodoDraft();
      emitWebviewDebug("todoDraftReset", { reason: reason || "unknown" });
      return nextDraft;
    }
    function syncTodoDraftFromInputs(params) {
      if (!params || params.selectedTodoId) {
        return params ? params.currentTodoDraft : createEmptyTodoDraft();
      }
      var nextDraft = params.currentTodoDraft || createEmptyTodoDraft();
      nextDraft.title = params.todoTitleInput ? String(params.todoTitleInput.value || "") : "";
      nextDraft.description = params.todoDescriptionInput ? String(params.todoDescriptionInput.value || "") : "";
      nextDraft.dueAt = params.todoDueInput ? String(params.todoDueInput.value || "") : "";
      nextDraft.priority = params.todoPriorityInput ? String(params.todoPriorityInput.value || "none") : "none";
      nextDraft.sectionId = params.todoSectionInput ? String(params.todoSectionInput.value || "") : "";
      nextDraft.taskId = params.todoLinkedTaskSelect ? String(params.todoLinkedTaskSelect.value || "") : "";
      if (params.reason) {
        emitWebviewDebug("todoDraftSync", {
          reason: params.reason,
          titleLength: nextDraft.title.length,
          hasDescription: nextDraft.description.length > 0,
          hasDueAt: !!nextDraft.dueAt,
          sectionId: nextDraft.sectionId,
          taskId: nextDraft.taskId
        });
      }
      return nextDraft;
    }
    function setLogLevel(nextLevel) {
      currentLogLevel = typeof nextLevel === "string" && nextLevel ? nextLevel : "info";
    }
    function getLogLevel() {
      return currentLogLevel;
    }
    return {
      createEmptyTodoDraft,
      emitWebviewDebug,
      getLogLevel,
      resetTodoDraft,
      setLogLevel,
      syncTodoDraftFromInputs
    };
  }

  // media/schedulerWebviewBoardRendering.js
  function renderTodoBoardMarkup(options) {
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
    return Array.isArray(card.comments) && card.comments.length ? card.comments[card.comments.length - 1] : null;
  }
  function renderTodoCompactActions(card, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var actions = [
      '<button type="button" class="btn-secondary todo-card-edit todo-list-action-btn" data-todo-edit="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(strings.boardEditTodo || "Open Editor") + '" style="color:var(--vscode-textLink-foreground);">&#9998; ' + helpers.escapeHtml(strings.boardEditTodoShort || "Edit") + "</button>"
    ];
    if (card.archived) {
      actions.push(
        '<button type="button" class="btn-secondary todo-card-restore todo-list-action-btn" data-todo-restore="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(strings.boardRestoreTodo || "Restore") + '">&#8634; ' + helpers.escapeHtml(strings.boardRestoreTodo || "Restore") + "</button>"
      );
      actions.push(
        '<button type="button" class="btn-danger todo-card-purge todo-list-action-btn" data-todo-purge="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(strings.boardDeleteTodoPermanent || "Delete Permanently") + '">&#128465; ' + helpers.escapeHtml(strings.boardDeleteTodoPermanent || "Delete Permanently") + "</button>"
      );
    } else {
      if (card.status === "ready") {
        actions.push(
          '<button type="button" class="btn-secondary todo-card-reject todo-list-action-btn" data-todo-reject="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(strings.boardDeclineTodo || "Decline") + '">&#8601; ' + helpers.escapeHtml(strings.boardDeclineTodo || "Decline") + "</button>"
        );
      }
      actions.push(
        '<button type="button" class="btn-secondary todo-card-delete todo-list-action-btn" data-todo-delete="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(strings.boardDeleteTodo || "Delete Todo") + '">&#128465; ' + helpers.escapeHtml(strings.boardDeleteTodoShort || "Delete") + "</button>"
      );
    }
    return '<div class="todo-list-actions' + (actions.length === 1 ? " has-single-action" : "") + '">' + actions.join("") + "</div>";
  }
  function renderTodoListRow(card, sectionId, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var selectedTodoId = options.selectedTodoId;
    var isSelected = card.id === selectedTodoId;
    var latestComment = getLatestTodoComment(card);
    var summary = card.description ? helpers.getTodoDescriptionPreview(card.description) : latestComment && latestComment.body ? helpers.getTodoCommentSourceLabel(latestComment.source || "human-form") + ": " + helpers.getTodoDescriptionPreview(latestComment.body) : card.taskId ? strings.boardTaskLinked || "Linked task" : strings.boardDescriptionPreviewEmpty || "No description yet.";
    var cardFlag = Array.isArray(card.flags) && card.flags[0] ? card.flags[0] : "";
    var metaParts = [
      "<span data-card-meta>" + helpers.escapeHtml(helpers.getTodoPriorityLabel(card.priority || "none")) + "</span>",
      "<span data-card-meta>" + helpers.escapeHtml(helpers.getTodoStatusLabel(card.status || "active")) + "</span>"
    ];
    if (card.dueAt) {
      metaParts.push("<span data-card-meta>" + helpers.escapeHtml((strings.boardDueLabel || "Due") + ": " + helpers.formatTodoDate(card.dueAt)) + "</span>");
    }
    if (card.archived && card.archiveOutcome) {
      metaParts.push("<span data-card-meta>" + helpers.escapeHtml(helpers.getTodoArchiveOutcomeLabel(card.archiveOutcome)) + "</span>");
    }
    if (cardFlag) {
      metaParts.push(helpers.renderFlagChip(cardFlag, false));
    }
    var visibleLabels = Array.isArray(card.labels) ? card.labels.slice(0, 2) : [];
    if (visibleLabels.length) {
      metaParts.push(visibleLabels.map(function(label) {
        return helpers.renderLabelChip(label, false, false);
      }).join(" "));
    }
    return '<article class="todo-list-row" draggable="false" data-todo-id="' + helpers.escapeAttr(card.id) + '" data-section-id="' + helpers.escapeAttr(sectionId) + '" data-order="' + String(card.order || 0) + '" style="border-radius:8px;background:' + helpers.getTodoPriorityCardBg(card.priority || "none", isSelected) + ";border:1px solid " + (isSelected ? "var(--vscode-focusBorder)" : "var(--vscode-widget-border)") + ';padding:var(--cockpit-card-pad, 8px);cursor:pointer;"><div class="todo-list-main"><div class="todo-list-title-line"><div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' + helpers.renderTodoCompletionCheckbox(card) + '<strong class="todo-list-title">' + helpers.escapeHtml(card.title || (strings.boardCardUntitled || "Untitled")) + '</strong></div><div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;min-width:0;">' + helpers.renderTodoDragHandle(card) + metaParts.join("") + '</div></div><div class="note todo-list-summary">' + helpers.escapeHtml(summary) + "</div></div>" + renderTodoCompactActions(card, options) + "</article>";
  }
  function renderTodoListView(visibleSections, cards, filters, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var collapsedSections = options.collapsedSections;
    return '<div class="todo-list-view">' + visibleSections.map(function(section) {
      var sectionCards = helpers.sortTodoCards(cards.filter(function(card) {
        return card.sectionId === section.id && helpers.cardMatchesTodoFilters(card, filters);
      }), filters);
      var isCollapsed = collapsedSections.has(section.id);
      var isArchiveSection = helpers.isArchiveTodoSectionId(section.id);
      return '<section class="todo-list-section' + (isCollapsed ? " is-collapsed" : "") + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '"><div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px);"><button type="button" class="cockpit-collapse-btn' + (isCollapsed ? " collapsed" : "") + '" data-section-collapse="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(isCollapsed ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section") + '">&#9660;</button>' + helpers.renderSectionDragHandle(section, isArchiveSection) + '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + helpers.escapeHtml(section.title || (strings.boardSectionUntitled || "Section")) + ' <span class="note">(' + String(sectionCards.length) + ")</span></strong>" + (isArchiveSection ? "" : '<div class="cockpit-section-actions"><button type="button" class="btn-icon" data-section-rename="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionRename || "Rename section") + '">&#9998;</button><button type="button" class="btn-icon" data-section-delete="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionDelete || "Delete section") + '">&#215;</button></div>') + '</div><div class="section-body-wrapper' + (isCollapsed ? " collapsed" : "") + '"><div class="section-body-inner"><div class="todo-list-items">' + (sectionCards.length ? sectionCards.map(function(card) {
        return renderTodoListRow(card, section.id, options);
      }).join("") : '<div class="note">' + helpers.escapeHtml(strings.boardListEmptySection || strings.boardEmpty || "No todos in this section.") + "</div>") + "</div></div></div></section>";
    }).join("") + "</div>";
  }
  function renderTodoBoardColumns(visibleSections, cards, filters, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var collapsedSections = options.collapsedSections;
    var selectedTodoId = options.selectedTodoId;
    return '<div style="display:flex;gap:16px;align-items:flex-start;min-width:max-content;">' + visibleSections.map(function(section) {
      var sectionCards = helpers.sortTodoCards(cards.filter(function(card) {
        return card.sectionId === section.id && helpers.cardMatchesTodoFilters(card, filters);
      }), filters);
      var isArchiveSection = helpers.isArchiveTodoSectionId(section.id);
      return '<section class="board-column' + (collapsedSections.has(section.id) ? " is-collapsed" : "") + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '" style="display:flex;flex-direction:column;border-radius:10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);width:var(--cockpit-col-width,240px);min-width:var(--cockpit-col-width,240px);overflow-x:hidden;"><div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px)"><button type="button" class="cockpit-collapse-btn' + (collapsedSections.has(section.id) ? " collapsed" : "") + '" data-section-collapse="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(collapsedSections.has(section.id) ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section") + '">&#9660;</button>' + helpers.renderSectionDragHandle(section, isArchiveSection) + '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + helpers.escapeHtml(section.title || (strings.boardSectionUntitled || "Section")) + "</strong>" + (isArchiveSection ? "" : '<div class="cockpit-section-actions"><button type="button" class="btn-icon" data-section-rename="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionRename || "Rename section") + '">&#9998;</button><button type="button" class="btn-icon" data-section-delete="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionDelete || "Delete section") + '">&#215;</button></div>') + '</div><div class="section-body-wrapper' + (collapsedSections.has(section.id) ? " collapsed" : "") + '"><div class="section-body-inner"><div style="padding:0 var(--cockpit-card-pad,9px) var(--cockpit-card-pad,9px);"><div style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);min-height:60px;">' + (sectionCards.length ? sectionCards.map(function(card) {
        var isSelected = card.id === selectedTodoId;
        var cardFlag = Array.isArray(card.flags) && card.flags[0] ? card.flags[0] : "";
        var chipMarkup = cardFlag || Array.isArray(card.labels) && card.labels.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">' + (cardFlag ? helpers.renderFlagChip(cardFlag, false) : "") + (Array.isArray(card.labels) && card.labels.length ? '<div class="card-labels" style="display:flex;flex-wrap:wrap;gap:6px;">' + card.labels.slice(0, 6).map(function(label, idx) {
          return '<span data-label-slot="' + idx + '">' + helpers.renderLabelChip(label, false, false) + "</span>";
        }).join("") + "</div>" : "") + "</div>" : "";
        var latestComment = Array.isArray(card.comments) && card.comments.length ? card.comments[card.comments.length - 1] : null;
        var dueMarkup = card.dueAt ? '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml((strings.boardDueLabel || "Due") + ": " + helpers.formatTodoDate(card.dueAt)) + "</span>" : "";
        var archiveMarkup = card.archived && card.archiveOutcome ? '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml(helpers.getTodoArchiveOutcomeLabel(card.archiveOutcome)) + "</span>" : "";
        var latestCommentMarkup = latestComment && latestComment.body ? '<div class="note" style="display:flex;gap:6px;align-items:flex-start;"><strong data-card-meta>' + helpers.escapeHtml(strings.boardLatestComment || "Latest comment") + ":</strong><span data-card-meta>#" + helpers.escapeHtml(String(latestComment.sequence || 1)) + " \u2022 " + helpers.escapeHtml(helpers.getTodoCommentSourceLabel(latestComment.source || "human-form")) + " \u2022 " + helpers.escapeHtml(helpers.getTodoDescriptionPreview(latestComment.body || "")) + "</span></div>" : "";
        return '<article draggable="false" data-todo-id="' + helpers.escapeAttr(card.id) + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-order="' + String(card.order || 0) + '" style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);border-radius:8px;padding:var(--cockpit-card-pad,8px);background:' + helpers.getTodoPriorityCardBg(card.priority || "none", isSelected) + ";border:1px solid " + (isSelected ? "var(--vscode-focusBorder)" : "var(--vscode-widget-border)") + ';cursor:pointer;"><div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;"><div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' + helpers.renderTodoCompletionCheckbox(card) + '<strong style="line-height:1.3;min-width:0;">' + helpers.escapeHtml(card.title || (strings.boardCardUntitled || "Untitled")) + '</strong></div><div style="display:flex;align-items:center;gap:6px;">' + helpers.renderTodoDragHandle(card) + '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml(helpers.getTodoPriorityLabel(card.priority || "none")) + "</span></div></div>" + (dueMarkup || archiveMarkup ? '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + dueMarkup + archiveMarkup + "</div>" : "") + chipMarkup + '<div class="note" style="white-space:pre-wrap;">' + helpers.escapeHtml(helpers.getTodoDescriptionPreview(card.description || "")) + "</div>" + latestCommentMarkup + renderTodoCompactActions(card, options).replace("todo-list-actions", "todo-card-action-row") + "</article>";
      }).join("") : '<div class="note">' + helpers.escapeHtml(strings.boardEmpty || "No cards yet.") + "</div>") + "</div></div></div></div></section>";
    }).join("") + "</div>";
  }

  // media/schedulerWebviewTaskSelectState.js
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
  function updateAgentOptions(params) {
    var agentSelect = params.agentSelect;
    if (!agentSelect) return;
    var items = Array.isArray(params.agents) ? params.agents : [];
    var escapeAttr = params.escapeAttr;
    var escapeHtml = params.escapeHtml;
    var strings = params.strings || {};
    var executionDefaults = params.executionDefaults || {};
    if (items.length === 0) {
      var noText = strings.placeholderNoAgents || "";
      agentSelect.innerHTML = '<option value="">' + escapeHtml(noText) + "</option>";
      return;
    }
    var selectText = strings.placeholderSelectAgent || "";
    var placeholder = '<option value="">' + escapeHtml(selectText) + "</option>";
    agentSelect.innerHTML = placeholder + items.map(function(agent) {
      return '<option value="' + escapeAttr(agent.id) + '">' + escapeHtml(agent.name) + "</option>";
    }).join("");
    if (!agentSelect.value) {
      var defaultAgentId = executionDefaults && typeof executionDefaults.agent === "string" ? executionDefaults.agent : "agent";
      var hasDefaultAgent = items.find(function(agent) {
        return agent.id === defaultAgentId;
      });
      if (hasDefaultAgent) {
        agentSelect.value = defaultAgentId;
      }
    }
  }
  function updateModelOptions(params) {
    var modelSelect = params.modelSelect;
    if (!modelSelect) return;
    var items = Array.isArray(params.models) ? params.models : [];
    var escapeAttr = params.escapeAttr;
    var escapeHtml = params.escapeHtml;
    var strings = params.strings || {};
    var executionDefaults = params.executionDefaults || {};
    var formatModelLabel = params.formatModelLabel;
    if (items.length === 0) {
      var noText = strings.placeholderNoModels || "";
      modelSelect.innerHTML = '<option value="">' + escapeHtml(noText) + "</option>";
      return;
    }
    var selectText = strings.placeholderSelectModel || "";
    var placeholder = '<option value="">' + escapeHtml(selectText) + "</option>";
    modelSelect.innerHTML = placeholder + items.map(function(model) {
      return '<option value="' + escapeAttr(model.id) + '">' + escapeHtml(formatModelLabel(model)) + "</option>";
    }).join("");
    if (!modelSelect.value) {
      var defaultModelId = executionDefaults && typeof executionDefaults.model === "string" ? executionDefaults.model : "";
      var hasDefaultModel = items.find(function(model) {
        return model.id === defaultModelId;
      });
      if (hasDefaultModel) {
        modelSelect.value = defaultModelId;
      }
    }
  }

  // media/schedulerWebview.js
  (function() {
    var vscode = null;
    var strings = {};
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
    var currentLogLevel = typeof initialData.logLevel === "string" && initialData.logLevel ? initialData.logLevel : "info";
    var currentLogDirectory = typeof initialData.logDirectory === "string" ? initialData.logDirectory : "";
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
      if (normalized.indexOf("copilot") >= 0 || normalized.indexOf("codex") >= 0 || normalized.indexOf("github") >= 0 || normalized.indexOf("microsoft") >= 0) {
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
      return name + " \u2022 " + source;
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
        { label: "s", seconds: 1 }
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
        return " (in " + formatCountdown(Math.floor(diffMs / 1e3)) + ")";
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
      taskList.querySelectorAll(".task-next-run-countdown").forEach(function(node) {
        var nextRunMs = Number(node.getAttribute("data-next-run-ms") || "");
        var enabled = node.getAttribute("data-enabled") === "true";
        node.textContent = getNextRunCountdownText(enabled, nextRunMs);
      });
    }
    function sanitizeAbsolutePaths(text) {
      if (!text) return "";
      var s = String(text);
      return s.replace(/'(file:\/\/[^']+)'/gi, function(_m, p1) {
        return "'" + basenameFromPathLike(p1) + "'";
      }).replace(/"(file:\/\/[^"]+)"/gi, function(_m, p1) {
        return '"' + basenameFromPathLike(p1) + '"';
      }).replace(/file:\/\/[^\s"'`]+/gi, function(m) {
        return basenameFromPathLike(m);
      }).replace(/'((?:[A-Za-z]:(?:\\|\/)|\\\\)[^']+)'/g, function(_m, p1) {
        return "'" + basenameFromPathLike(p1) + "'";
      }).replace(/"((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"]+)"/g, function(_m, p1) {
        return '"' + basenameFromPathLike(p1) + '"';
      }).replace(
        /(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g,
        function(_m, prefix, p1) {
          return String(prefix) + basenameFromPathLike(p1);
        }
      ).replace(/'(\/[^']+)'/g, function(_m, p1) {
        return "'" + basenameFromPathLike(p1) + "'";
      }).replace(/"(\/[^\"]+)"/g, function(_m, p1) {
        return '"' + basenameFromPathLike(p1) + '"';
      }).replace(/(^|[\s(])(\/[^\s"'`]+)/g, function(_m, prefix, p1) {
        return String(prefix) + basenameFromPathLike(p1);
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
      var durationMs = options && typeof options.durationMs === "number" ? options.durationMs : 8e3;
      if (durationMs > 0) {
        globalErrorHideTimer = setTimeout(function() {
          hideGlobalError();
        }, durationMs);
      }
    }
    window.onerror = function(msg, url, line, col, error) {
      var prefix = strings.webviewScriptErrorPrefix || "";
      var linePrefix = strings.webviewLinePrefix || "";
      var lineSuffix = strings.webviewLineSuffix || "";
      showGlobalError(
        prefix + sanitizeAbsolutePaths(String(msg)) + linePrefix + String(line) + lineSuffix
      );
    };
    window.onunhandledrejection = function(ev) {
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
      raw = String(raw).split(/\r?\n/)[0];
      showGlobalError(prefix + sanitizeAbsolutePaths(raw));
    };
    if (typeof acquireVsCodeApi === "function") {
      vscode = acquireVsCodeApi();
    } else {
      vscode = { postMessage: function() {
      } };
      showGlobalError(strings.webviewApiUnavailable || "", { durationMs: 0 });
    }
    var debugTools = createWebviewDebugTools({
      console,
      initialLogLevel: currentLogLevel,
      vscode
    });
    var createEmptyTodoDraft = debugTools.createEmptyTodoDraft;
    var emitWebviewDebug = debugTools.emitWebviewDebug;
    function bindDebugClickAttempts(element, config) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("click", function(event) {
        var target = event && event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
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
          selectedTodoId: selectedTodoId || ""
        });
      }, true);
    }
    var tasks = Array.isArray(initialData.tasks) ? initialData.tasks : [];
    var jobs = Array.isArray(initialData.jobs) ? initialData.jobs : [];
    var jobFolders = Array.isArray(initialData.jobFolders) ? initialData.jobFolders : [];
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
        showArchived: false
      },
      updatedAt: ""
    };
    var telegramNotification = initialData.telegramNotification || {
      enabled: false,
      hasBotToken: false,
      hookConfigured: false
    };
    var executionDefaults = initialData.executionDefaults || {
      agent: "agent",
      model: ""
    };
    var researchProfiles = Array.isArray(initialData.researchProfiles) ? initialData.researchProfiles : [];
    var activeResearchRun = initialData.activeResearchRun || null;
    var recentResearchRuns = Array.isArray(initialData.recentResearchRuns) ? initialData.recentResearchRuns : [];
    var agents = Array.isArray(initialData.agents) ? initialData.agents : [];
    var models = Array.isArray(initialData.models) ? initialData.models : [];
    var promptTemplates = Array.isArray(initialData.promptTemplates) ? initialData.promptTemplates : [];
    var skills = Array.isArray(initialData.skills) ? initialData.skills : [];
    var scheduleHistory = Array.isArray(initialData.scheduleHistory) ? initialData.scheduleHistory : [];
    var defaultChatSession = initialData.defaultChatSession === "continue" ? "continue" : "new";
    var autoShowOnStartup = !!initialData.autoShowOnStartup;
    var workspacePaths = Array.isArray(initialData.workspacePaths) ? initialData.workspacePaths : [];
    var caseInsensitivePaths = !!initialData.caseInsensitivePaths;
    var editingTaskId = null;
    var selectedTodoId = null;
    var EDITOR_CREATE_SYMBOL = "+";
    var EDITOR_EDIT_SYMBOL = "\u2699";
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
      scheduledBoardRenderFrame = requestAnimationFrame(function() {
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
    var pendingDeleteLabelName = "";
    var pendingDeleteFlagName = "";
    var pendingTodoDeleteId = "";
    var todoDeleteModalRoot = null;
    var pendingAgentValue = "";
    var pendingModelValue = "";
    var pendingTemplatePath = "";
    var editingTaskEnabled = true;
    var pendingSubmit = false;
    var HELP_WARP_SEEN_KEY = "copilot-scheduler-help-warp-seen-v1";
    var helpWarpIntroPending = (function() {
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
        currentTodoDraft,
        reason,
        selectedTodoId,
        todoDescriptionInput,
        todoDueInput,
        todoLinkedTaskSelect,
        todoPriorityInput,
        todoSectionInput,
        todoTitleInput
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
      currentTodoDraft.labelInput = todoLabelsInput ? String(todoLabelsInput.value || "") : currentTodoDraft.labelInput || "";
      currentTodoDraft.labelColor = todoLabelColorInput ? String(todoLabelColorInput.value || "") : currentTodoDraft.labelColor || "#4f8cff";
      currentTodoDraft.flagInput = todoFlagNameInput ? String(todoFlagNameInput.value || "") : currentTodoDraft.flagInput || "";
      currentTodoDraft.flagColor = todoFlagColorInput ? String(todoFlagColorInput.value || "") : currentTodoDraft.flagColor || "#f59e0b";
    }
    var defaultJitterSeconds = (function() {
      var raw = initialData.defaultJitterSeconds;
      var n = typeof raw === "number" ? raw : Number(raw);
      if (!isFinite(n)) return 600;
      var i = Math.floor(n);
      if (i < 0) return 0;
      if (i > 1800) return 1800;
      return i;
    })();
    var locale = typeof initialData.locale === "string" && initialData.locale ? initialData.locale : void 0;
    var lastRenderedTasksHtml = "";
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
    var todoShowArchived = document.getElementById("todo-show-archived");
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
    var settingsLogLevelSelect = document.getElementById("settings-log-level-select");
    var settingsLogDirectoryInput = document.getElementById("settings-log-directory");
    var settingsOpenLogFolderBtn = document.getElementById("settings-open-log-folder-btn");
    var boardAddSectionBtn = document.getElementById("board-add-section-btn");
    var boardSectionInlineForm = document.getElementById("board-section-inline-form");
    var boardSectionNameInput = document.getElementById("board-section-name-input");
    var boardSectionSaveBtn = document.getElementById("board-section-save-btn");
    var boardSectionCancelBtn = document.getElementById("board-section-cancel-btn");
    var cockpitColSlider = document.getElementById("cockpit-col-slider");
    var activeTaskFilter = "all";
    var activeLabelFilter = "";
    var selectedJobFolderId = "";
    var selectedJobId = "";
    var selectedResearchId = "";
    var selectedResearchRunId = "";
    var draggedJobNodeId = "";
    var draggedJobId = "";
    var draggingSectionId = null;
    var lastDragOverSectionId = null;
    var jobsSidebarHidden = false;
    var boardFiltersCollapsed = false;
    var editingFlagOriginalName = "";
    var editingLabelOriginalName = "";
    var collapsedSections = (function() {
      try {
        return new Set(JSON.parse(localStorage.getItem("cockpit-collapsed-sections") || "[]"));
      } catch (e) {
        return /* @__PURE__ */ new Set();
      }
    })();
    function toggleSectionCollapsed(sectionId) {
      if (collapsedSections.has(sectionId)) {
        collapsedSections.delete(sectionId);
      } else {
        collapsedSections.add(sectionId);
      }
      try {
        localStorage.setItem("cockpit-collapsed-sections", JSON.stringify(Array.from(collapsedSections)));
      } catch (e) {
      }
    }
    function setLabelSlotsClass(w) {
      var cls = w >= 390 ? "labels-6" : w >= 300 ? "labels-3" : "labels-1";
      document.documentElement.classList.remove("labels-1", "labels-3", "labels-6");
      document.documentElement.classList.add(cls);
    }
    (function() {
      var saved = localStorage.getItem("cockpit-col-width");
      var w = saved ? Number(saved) : cockpitColSlider ? Number(cockpitColSlider.value) : 240;
      if (w >= 180 && w <= 520) {
        document.documentElement.style.setProperty("--cockpit-col-width", w + "px");
        document.documentElement.style.setProperty("--cockpit-col-font", Math.round(10 + (w - 180) * 3 / 340) + "px");
        document.documentElement.style.setProperty("--cockpit-card-pad", Math.round(8 + (w - 180) * 6 / 340) + "px");
        document.documentElement.style.setProperty("--cockpit-card-gap", Math.round(4 + (w - 180) * 4 / 340) + "px");
        setLabelSlotsClass(w);
        if (cockpitColSlider && !saved) cockpitColSlider.value = String(w);
      }
    })();
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
        if (state && typeof state.boardFiltersCollapsed === "boolean") {
          boardFiltersCollapsed = state.boardFiltersCollapsed;
        }
        if (state && typeof state.selectedResearchId === "string") {
          selectedResearchId = state.selectedResearchId;
        }
        if (state && typeof state.selectedResearchRunId === "string") {
          selectedResearchRunId = state.selectedResearchRunId;
        }
      } catch (_e) {
      }
    }
    function persistTaskFilter() {
      if (!vscode || typeof vscode.setState !== "function") return;
      try {
        var prev = typeof vscode.getState === "function" ? vscode.getState() || {} : {};
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
        next.boardFiltersCollapsed = boardFiltersCollapsed;
        next.selectedResearchId = selectedResearchId;
        next.selectedResearchRunId = selectedResearchRunId;
        vscode.setState(next);
      } catch (_e) {
      }
    }
    function clearTelegramFeedback() {
      if (!telegramFeedback) return;
      telegramFeedback.textContent = "";
      telegramFeedback.style.display = "none";
      telegramFeedback.classList.remove("error");
    }
    function applyBoardFilterCollapseState() {
      if (boardFilterSticky && boardFilterSticky.classList) {
        boardFilterSticky.classList.toggle("is-collapsed", !!boardFiltersCollapsed);
      }
      if (todoToggleFiltersBtn) {
        var isCollapsed = !!boardFiltersCollapsed;
        todoToggleFiltersBtn.textContent = isCollapsed ? strings.boardShowFilters || "Show Filters" : strings.boardHideFilters || "Hide Filters";
        todoToggleFiltersBtn.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      }
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
        messagePrefix: telegramMessagePrefixInput ? String(telegramMessagePrefixInput.value || "") : ""
      };
    }
    function validateTelegramFormData(data) {
      var needsConfig = data.enabled || !!String(data.chatId || "").trim() || !!String(data.messagePrefix || "").trim();
      if (needsConfig && !String(data.chatId || "").trim()) {
        return strings.telegramValidationChatId || "Telegram chat ID is required.";
      }
      if (needsConfig && !String(data.botToken || "").trim() && !(telegramNotification && telegramNotification.hasBotToken)) {
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
        telegramBotTokenInput.placeholder = telegramNotification.hasBotToken ? strings.telegramSavedToken || "Bot token stored privately" : strings.telegramBotTokenPlaceholder || "123456:ABCDEF...";
      }
      if (telegramTokenStatus) {
        telegramTokenStatus.textContent = telegramNotification.hasBotToken ? strings.telegramSavedToken || "Bot token stored privately" : strings.telegramMissingToken || "No bot token saved yet";
      }
      if (telegramChatStatus) {
        telegramChatStatus.textContent = telegramNotification.chatId || "-";
      }
      if (telegramHookStatus) {
        telegramHookStatus.textContent = telegramNotification.hookConfigured ? strings.telegramHookReady || "Stop hook configured" : strings.telegramHookMissing || "Stop hook files not configured";
      }
      if (telegramUpdatedAt) {
        telegramUpdatedAt.textContent = formatTelegramUpdatedAt(telegramNotification.updatedAt);
      }
      if (telegramStatusNote) {
        telegramStatusNote.textContent = strings.telegramWorkspaceNote || "The hook files are generated under .github/hooks and read secrets from .vscode/scheduler.private.json.";
      }
      clearTelegramFeedback();
    }
    function collectExecutionDefaultsFormData() {
      return {
        agent: defaultAgentSelect ? String(defaultAgentSelect.value || "") : "",
        model: defaultModelSelect ? String(defaultModelSelect.value || "") : ""
      };
    }
    function renderExecutionDefaultsControls() {
      updateSimpleSelect(
        defaultAgentSelect,
        agents,
        strings.placeholderSelectAgent || "Select agent",
        executionDefaults && typeof executionDefaults.agent === "string" ? executionDefaults.agent : "agent",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
      updateSimpleSelect(
        defaultModelSelect,
        models,
        strings.placeholderSelectModel || "Select model",
        executionDefaults && typeof executionDefaults.model === "string" ? executionDefaults.model : "",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return formatModelLabel(item);
        }
      );
      if (executionDefaultsNote) {
        executionDefaultsNote.textContent = strings.executionDefaultsSaved || "Workspace default agent and model settings.";
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
      return job && job.paused ? strings.jobsPaused || "Inactive" : strings.jobsRunning || "Active";
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
        var top = 4 + i * 91 / 22 + Math.random() * 3.5;
        var delay = Math.random() * 0.95;
        var duration = 1.05 + Math.random() * 1.25;
        var length = 110 + Math.round(Math.random() * 180);
        var thickness = 1 + Math.round(Math.random() * 2);
        var rotation = (-7 + Math.random() * 14).toFixed(2);
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
        window.setTimeout(function() {
          if (helpIntroRocket) {
            helpIntroRocket.classList.remove("is-launching");
          }
        }, 1250);
      }
      helpWarpFadeTimeout = window.setTimeout(function() {
        if (helpWarpLayer) {
          helpWarpLayer.classList.add("is-fading");
        }
      }, 1e4);
      helpWarpCleanupTimeout = window.setTimeout(function() {
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
      } catch (_e) {
      }
      triggerHelpWarpAnimation({ animateRocket: false });
    }
    function syncAutoShowOnStartupUi() {
      if (autoShowStartupBtn) {
        autoShowStartupBtn.textContent = autoShowOnStartup ? strings.autoShowOnStartupToggleEnabled || "Disable Auto Open" : strings.autoShowOnStartupToggleDisabled || "Enable Auto Open";
      }
      if (autoShowStartupNote) {
        autoShowStartupNote.textContent = autoShowOnStartup ? strings.autoShowOnStartupEnabled || "Auto-open on startup: On" : strings.autoShowOnStartupDisabled || "Auto-open on startup: Off";
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
      entries = entries.slice().sort(function(a, b) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      if (entries.length === 0) {
        scheduleHistorySelect.innerHTML = '<option value="">' + escapeHtml(strings.scheduleHistoryEmpty || "No backup versions yet") + "</option>";
        scheduleHistorySelect.disabled = true;
        if (restoreHistoryBtn) restoreHistoryBtn.disabled = true;
        return;
      }
      scheduleHistorySelect.innerHTML = '<option value="">' + escapeHtml(strings.scheduleHistoryPlaceholder || "Select a backup version") + "</option>" + entries.map(function(entry) {
        return '<option value="' + escapeAttr(entry.id || "") + '">' + escapeHtml(formatHistoryLabel(entry)) + "</option>";
      }).join("");
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
      return String(value).split(",").map(function(item) {
        return String(item || "").trim();
      }).filter(function(item, index, list) {
        return item && list.indexOf(item) === index;
      });
    }
    function toLabelString(labels) {
      return Array.isArray(labels) ? labels.join(", ") : "";
    }
    function getJobById(id) {
      return (Array.isArray(jobs) ? jobs : []).find(function(job) {
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
      var approved = job && job.runtime && Array.isArray(job.runtime.approvedPauseNodeIds) ? job.runtime.approvedPauseNodeIds : [];
      return approved.filter(function(value) {
        return typeof value === "string" && value;
      });
    }
    function getWaitingPauseState(job) {
      return job && job.runtime && job.runtime.waitingPause ? job.runtime.waitingPause : null;
    }
    function getFolderById(id) {
      return (Array.isArray(jobFolders) ? jobFolders : []).find(function(folder) {
        return folder && folder.id === id;
      }) || null;
    }
    function getTaskById(id) {
      return (Array.isArray(tasks) ? tasks : []).find(function(task) {
        return task && task.id === id;
      }) || null;
    }
    function getVisibleJobs() {
      return (Array.isArray(jobs) ? jobs : []).filter(function(job) {
        return job && (job.folderId || "") === selectedJobFolderId;
      }).sort(function(a, b) {
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
      getAllTodoCards().forEach(function(card) {
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
      return (Array.isArray(list) ? list.slice() : []).sort(function(a, b) {
        var diff = getComparableTime(a && a.nextRun) - getComparableTime(b && b.nextRun);
        if (diff !== 0) return diff;
        var aName = a && a.name ? String(a.name) : "";
        var bName = b && b.name ? String(b.name) : "";
        return aName.localeCompare(bName);
      });
    }
    function getStandaloneTasks() {
      return sortTasksByNextRun(
        (Array.isArray(tasks) ? tasks : []).filter(function(task) {
          return task && task.oneTime !== true;
        })
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
      (Array.isArray(tasks) ? tasks : []).forEach(function(task) {
        getEffectiveLabels(task).forEach(function(label) {
          if (values.indexOf(label) === -1) {
            values.push(label);
          }
        });
      });
      values.sort(function(a, b) {
        return String(a).localeCompare(String(b));
      });
      var currentValue = activeLabelFilter || "";
      taskLabelFilter.innerHTML = '<option value="">' + escapeHtml(strings.labelAllLabels || "All labels") + "</option>" + values.map(function(label) {
        return '<option value="' + escapeAttr(label) + '">' + escapeHtml(label) + "</option>";
      }).join("");
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
    renderLoggingControls();
    function parseTagList(text) {
      if (!text) return [];
      return String(text).split(",").map(function(entry) {
        return entry.trim();
      }).filter(function(entry) {
        return entry.length > 0;
      });
    }
    function normalizeTodoLabel(value) {
      return String(value || "").trim().replace(/\s+/g, " ");
    }
    function normalizeTodoLabelKey(value) {
      return normalizeTodoLabel(value).toLowerCase();
    }
    function dedupeStringList(values) {
      var seen = {};
      return (Array.isArray(values) ? values : []).map(normalizeTodoLabel).filter(function(value) {
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
    function getAllTodoCards() {
      return cockpitBoard && Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.slice() : [];
    }
    function getVisibleTodoCards(filters) {
      var allCards = getAllTodoCards();
      if (!filters || filters.showArchived !== true) {
        return allCards.filter(function(card) {
          return !card.archived && !isArchiveTodoSectionId(card.sectionId);
        });
      }
      return allCards;
    }
    function getTaskLabelCatalog() {
      var catalog = [];
      var seen = /* @__PURE__ */ Object.create(null);
      (Array.isArray(tasks) ? tasks : []).forEach(function(task) {
        getEffectiveLabels(task).forEach(function(label) {
          var normalizedName = normalizeTodoLabel(label);
          var key = normalizeTodoLabelKey(normalizedName);
          if (!normalizedName || !key || seen[key]) {
            return;
          }
          seen[key] = true;
          catalog.push({
            key,
            name: normalizedName,
            color: "var(--vscode-badge-background)",
            source: "task"
          });
        });
      });
      return catalog.sort(function(left, right) {
        return String(left.name).localeCompare(String(right.name));
      });
    }
    function getLabelCatalog() {
      var merged = [];
      var byKey = /* @__PURE__ */ Object.create(null);
      var boardCatalog = cockpitBoard && Array.isArray(cockpitBoard.labelCatalog) ? cockpitBoard.labelCatalog.slice() : [];
      boardCatalog.forEach(function(entry) {
        var normalizedName = normalizeTodoLabel(entry && entry.name);
        var key = normalizeTodoLabelKey(entry && (entry.key || entry.name || ""));
        if (!normalizedName || !key) {
          return;
        }
        byKey[key] = {
          key,
          name: normalizedName,
          color: entry.color || "var(--vscode-badge-background)",
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          source: "board"
        };
      });
      getTaskLabelCatalog().forEach(function(entry) {
        if (!byKey[entry.key]) {
          byKey[entry.key] = entry;
        }
      });
      Object.keys(byKey).forEach(function(key) {
        merged.push(byKey[key]);
      });
      return merged.sort(function(left, right) {
        return String(left.name).localeCompare(String(right.name));
      });
    }
    function getFlagCatalog() {
      return cockpitBoard && Array.isArray(cockpitBoard.flagCatalog) ? cockpitBoard.flagCatalog.slice() : [];
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
      return definition && definition.color ? definition.color : "#f59e0b";
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
      return definition && definition.color ? definition.color : "var(--vscode-badge-background)";
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
        currentTodoLabels.filter(function(entry) {
          return normalizeTodoLabelKey(entry) !== normalizeTodoLabelKey(label);
        }),
        true
      );
      if (normalizeTodoLabelKey(selectedTodoLabelName) === normalizeTodoLabelKey(label)) {
        selectedTodoLabelName = "";
      }
    }
    function reconcileTodoEditorCatalogState() {
      currentTodoLabels = currentTodoLabels.filter(function(label) {
        return !!getLabelDefinition(label);
      });
      if (currentTodoFlag && !getFlagDefinition(currentTodoFlag)) {
        currentTodoFlag = "";
      }
      if (selectedTodoLabelName && !getLabelDefinition(selectedTodoLabelName)) {
        selectedTodoLabelName = "";
      }
    }
    function getReadableTextColor(background) {
      var value = String(background || "").trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        var hex = value.slice(1);
        if (hex.length === 3) {
          hex = hex.split("").map(function(part) {
            return part + part;
          }).join("");
        }
        var red = parseInt(hex.slice(0, 2), 16);
        var green = parseInt(hex.slice(2, 4), 16);
        var blue = parseInt(hex.slice(4, 6), 16);
        var luminance = (red * 299 + green * 587 + blue * 114) / 1e3;
        return luminance >= 150 ? "#111111" : "#ffffff";
      }
      return "var(--vscode-badge-foreground)";
    }
    function renderLabelChip(label, removable, selected) {
      var color = getLabelColor(label);
      var textColor = getReadableTextColor(color);
      var borderColor = selected ? "var(--vscode-focusBorder)" : "var(--vscode-panel-border)";
      return '<span data-label-chip="' + escapeAttr(label) + '" style="display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;background:' + escapeAttr(color) + ";color:" + escapeAttr(textColor) + ";border:1px solid " + escapeAttr(borderColor) + ';font-size:inherit;line-height:1.4;"><button type="button" data-label-chip-select="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;color:inherit;">' + escapeHtml(label) + "</button>" + (removable ? '<button type="button" data-label-chip-remove="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;">\xD7</button>' : "") + "</span>";
    }
    function renderFlagChip(flagName, removable) {
      var color = getFlagColor(flagName);
      var textColor = getReadableTextColor(color);
      return '<span data-flag-chip="' + escapeAttr(flagName) + '" style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:' + escapeAttr(color) + ";color:" + escapeAttr(textColor) + ";border:1px solid color-mix(in srgb," + escapeAttr(color) + ' 70%,var(--vscode-panel-border));font-size:inherit;line-height:1.4;font-weight:600;"><span>' + escapeHtml(flagName) + "</span>" + (removable ? '<button type="button" data-flag-chip-remove="' + escapeAttr(flagName) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;line-height:1;" title="' + escapeAttr(strings.boardFlagClearTitle || strings.boardFlagClear || "Clear flag") + '">\xD7</button>' : "") + "</span>";
    }
    function setTodoEditorLabels(labels, preserveSelection) {
      currentTodoLabels = dedupeStringList(labels);
      if (!preserveSelection) {
        selectedTodoLabelName = currentTodoLabels[0] || "";
      } else if (selectedTodoLabelName && currentTodoLabels.map(normalizeTodoLabelKey).indexOf(normalizeTodoLabelKey(selectedTodoLabelName)) < 0) {
        selectedTodoLabelName = currentTodoLabels[0] || "";
      }
      syncEditorTabLabels();
    }
    function syncLabelCatalog() {
      if (!todoLabelCatalog) return;
      var addedKeys = currentTodoLabels.map(normalizeTodoLabelKey);
      var catalog = getLabelCatalog().filter(function(entry) {
        return addedKeys.indexOf(normalizeTodoLabelKey(entry.name)) < 0;
      });
      if (catalog.length === 0) {
        todoLabelCatalog.innerHTML = "";
        return;
      }
      todoLabelCatalog.innerHTML = catalog.map(function(entry) {
        var bg = entry.color || "var(--vscode-badge-background)";
        var fg = getReadableTextColor(bg);
        var borderColor = "color-mix(in srgb," + bg + " 60%,var(--vscode-panel-border))";
        var canDelete = entry.source !== "task";
        var pendingDelete = canDelete && isPendingCatalogDelete("label", entry.name);
        return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 12px;border-radius:999px;background:' + escapeAttr(bg) + ";color:" + escapeAttr(fg) + ";border:1.5px solid " + escapeAttr(borderColor) + ';font-size:12px;"><button type="button" data-label-catalog-select="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="' + escapeAttr(strings.boardLabelCatalogAddTitle || "Add to todo") + '">' + escapeHtml(entry.name) + "</button>" + (pendingDelete ? '<button type="button" data-label-catalog-confirm-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="' + escapeAttr(strings.boardLabelCatalogDeleteTitle || "Delete label") + '">' + escapeHtml(strings.boardDeleteConfirm || "Delete?") + "</button>" : '<button type="button" data-label-catalog-edit="' + escapeAttr(entry.name) + '" data-label-catalog-edit-color="' + escapeAttr(bg) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="' + escapeAttr(strings.boardLabelCatalogEditTitle || "Edit label") + '">\u270E</button>' + (canDelete ? '<button type="button" data-label-catalog-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="' + escapeAttr(strings.boardLabelCatalogDeleteTitle || "Delete label") + '">\xD7</button>' : "")) + "</span>";
      }).join("");
    }
    function syncTodoLabelSuggestions() {
      if (!todoLabelSuggestions) {
        return;
      }
      var inputValue = todoLabelsInput ? normalizeTodoLabelKey(todoLabelsInput.value) : "";
      var addedKeys = currentTodoLabels.map(normalizeTodoLabelKey);
      var labels = dedupeStringList(
        getLabelCatalog().map(function(entry) {
          return entry.name;
        }).concat(currentTodoLabels)
      ).filter(function(label) {
        return addedKeys.indexOf(normalizeTodoLabelKey(label)) < 0;
      }).sort(function(left, right) {
        return left.localeCompare(right);
      });
      if (inputValue) {
        labels = labels.filter(function(label) {
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
      todoLabelSuggestions.innerHTML = labels.map(function(label) {
        var bg = getLabelColor(label);
        var fg = getReadableTextColor(bg);
        return '<button type="button" data-label-suggestion="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;padding:5px 14px;border-radius:999px;background:' + escapeAttr(bg) + ";color:" + escapeAttr(fg) + ";border:1px solid color-mix(in srgb," + escapeAttr(bg) + ' 60%,var(--vscode-panel-border));font-size:12.5px;line-height:1.5;">' + escapeHtml(label) + "</button>";
      }).join("");
    }
    function syncTodoLabelEditor() {
      if (todoLabelChipList) {
        todoLabelChipList.innerHTML = currentTodoLabels.length > 0 ? currentTodoLabels.map(function(label) {
          return renderLabelChip(
            label,
            true,
            normalizeTodoLabelKey(label) === normalizeTodoLabelKey(selectedTodoLabelName)
          );
        }).join("") : '<div class="note">No labels yet.</div>';
      }
      var selectedDefinition = selectedTodoLabelName ? getLabelDefinition(selectedTodoLabelName) : null;
      if (todoLabelColorInput) {
        var isTypingNew = todoLabelsInput && todoLabelsInput.value.trim();
        if (selectedTodoLabelName) {
          todoLabelColorInput.value = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(
            selectedDefinition && selectedDefinition.color ? selectedDefinition.color : ""
          ) ? selectedDefinition.color : "#4f8cff";
        } else if (!isTypingNew) {
          todoLabelColorInput.value = "#4f8cff";
        }
        todoLabelColorInput.disabled = false;
      }
      if (todoLabelColorSaveBtn) {
        todoLabelColorSaveBtn.disabled = !todoLabelsInput || !todoLabelsInput.value.trim();
      }
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
          rawValue: String(todoLabelsInput.value || "")
        });
        return;
      }
      emitWebviewDebug("todoLabelAddAccepted", {
        label,
        editingExisting: !!editingLabelOriginalName,
        color: todoLabelColorInput ? todoLabelColorInput.value : ""
      });
      var prevName = editingLabelOriginalName;
      editingLabelOriginalName = "";
      var pendingColor = todoLabelColorInput ? todoLabelColorInput.value : "";
      todoLabelsInput.value = "";
      if (prevName) {
        var prevKey = normalizeTodoLabelKey(prevName);
        var currentLabelKeys = currentTodoLabels.map(normalizeTodoLabelKey);
        var prevIndex = currentLabelKeys.indexOf(prevKey);
        if (normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(label)) {
          vscode.postMessage({ type: "deleteTodoLabelDefinition", data: { name: prevName } });
        }
        if (prevIndex >= 0) {
          var renamedLabels = currentTodoLabels.slice();
          renamedLabels.splice(prevIndex, 1, label);
          setTodoEditorLabels(renamedLabels, true);
          selectedTodoLabelName = label;
        }
        if (pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
          vscode.postMessage({ type: "saveTodoLabelDefinition", data: { name: label, color: pendingColor } });
        }
        if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
        syncTodoEditorTransientDraft();
        syncTodoLabelEditor();
        return;
      }
      setTodoEditorLabels(currentTodoLabels.concat([label]), true);
      selectedTodoLabelName = label;
      if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
      syncTodoEditorTransientDraft();
      syncTodoLabelEditor();
      if (pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
        vscode.postMessage({
          type: "saveTodoLabelDefinition",
          data: { name: label, color: pendingColor }
        });
      }
    }
    function removeEditorLabel(label) {
      clearCatalogDeleteState("label");
      setTodoEditorLabels(
        currentTodoLabels.filter(function(entry) {
          return normalizeTodoLabelKey(entry) !== normalizeTodoLabelKey(label);
        }),
        true
      );
      syncTodoLabelEditor();
    }
    function bindRenderedCockpitBoardInteractions() {
      bindBoardColumnInteractions({
        boardColumns,
        getBoardColumns: function() {
          return boardColumns;
        },
        document,
        window,
        vscode,
        renderCockpitBoard,
        openTodoEditor,
        openTodoDeleteModal,
        handleSectionCollapse: function(collapseBtn) {
          handleBoardSectionCollapse(collapseBtn, {
            toggleSectionCollapsed,
            collapsedSections
          });
        },
        handleSectionRename: function(sectionRenameBtn) {
          handleBoardSectionRename(sectionRenameBtn, {
            document,
            vscode,
            setTimeout
          });
        },
        handleSectionDelete: function(sectionDeleteBtn) {
          handleBoardSectionDelete(sectionDeleteBtn, {
            strings,
            vscode,
            setTimeout
          });
        },
        handleTodoCompletion: function(completeToggle) {
          handleBoardTodoCompletion(completeToggle, {
            cockpitBoard,
            vscode
          });
        },
        handleTodoReject: function(rejectBtn) {
          var todoId = rejectBtn.getAttribute("data-todo-reject") || "";
          if (!todoId) {
            return;
          }
          vscode.postMessage({ type: "rejectTodo", todoId });
        },
        handleTodoRestore: function(restoreBtn) {
          var todoId = restoreBtn.getAttribute("data-todo-restore") || "";
          if (!todoId) {
            return;
          }
          vscode.postMessage({ type: "archiveTodo", todoId, archived: false });
        },
        setSelectedTodoId: function(todoId) {
          selectedTodoId = todoId;
        },
        getDraggingSectionId: function() {
          return draggingSectionId;
        },
        setDraggingSectionId: function(value) {
          draggingSectionId = value;
        },
        getLastDragOverSectionId: function() {
          return lastDragOverSectionId;
        },
        setLastDragOverSectionId: function(value) {
          lastDragOverSectionId = value;
        },
        getDraggingTodoId: function() {
          return draggingTodoId;
        },
        setDraggingTodoId: function(value) {
          draggingTodoId = value;
        },
        setIsBoardDragging: function(value) {
          isBoardDragging = value;
        },
        requestAnimationFrame,
        finishBoardDragState,
        isArchiveTodoSectionId
      });
    }
    function ensureTodoEditorListenersBound() {
      if (todoEditorListenersBound) {
        return;
      }
      todoEditorListenersBound = true;
      [todoTitleInput, todoDescriptionInput, todoDueInput].forEach(function(element) {
        if (!element || typeof element.addEventListener !== "function") {
          return;
        }
        element.addEventListener("input", function() {
          syncTodoDraftFromInputs("input");
        });
      });
      [todoPriorityInput, todoSectionInput, todoLinkedTaskSelect].forEach(function(element) {
        if (!element || typeof element.addEventListener !== "function") {
          return;
        }
        element.addEventListener("change", function() {
          syncTodoDraftFromInputs("change");
        });
      });
      bindDebugClickAttempts(todoDetailForm, {
        selector: "#todo-label-add-btn, #todo-label-color-save-btn, #todo-flag-add-btn, #todo-flag-color-save-btn, #todo-label-color-input, #todo-flag-color-input",
        eventName: "todoDetailClickAttempt"
      });
      document.addEventListener("click", function(event) {
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
            if (normalizeTodoLabelKey(feCatalog[fei].name) === normalizeTodoLabelKey(feName)) {
              feEntry = feCatalog[fei];
              break;
            }
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
          todoflagCurrentEl.innerHTML = '<span class="note">No flag set.</span>';
        }
      }
      if (todoFlagPickerEl) {
        var catalog = getFlagCatalog();
        if (catalog.length === 0) {
          todoFlagPickerEl.innerHTML = "";
        } else {
          todoFlagPickerEl.innerHTML = catalog.map(function(entry) {
            var bg = entry.color || "#f59e0b";
            var fg = getReadableTextColor(bg);
            var isActive = normalizeTodoLabelKey(entry.name) === normalizeTodoLabelKey(currentTodoFlag);
            var borderStyle = isActive ? "2px solid var(--vscode-focusBorder)" : "1px solid color-mix(in srgb," + bg + " 70%,var(--vscode-panel-border))";
            var pendingDelete = isPendingCatalogDelete("flag", entry.name);
            return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:' + escapeAttr(bg) + ";color:" + escapeAttr(fg) + ";border:" + borderStyle + ';font-size:inherit;font-weight:600;line-height:1.4;"><button type="button" data-flag-catalog-select="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="' + escapeAttr(strings.boardFlagCatalogSelectTitle || "Set as flag") + '">' + escapeHtml(entry.name) + "</button>" + (pendingDelete ? '<button type="button" data-flag-catalog-confirm-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="' + escapeAttr(strings.boardFlagCatalogDeleteTitle || "Delete flag") + '">' + escapeHtml(strings.boardDeleteConfirm || "Delete?") + "</button>" : '<button type="button" data-flag-catalog-edit="' + escapeAttr(entry.name) + '" data-flag-catalog-edit-color="' + escapeAttr(bg) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogEditTitle || "Edit flag") + '">\u270E</button><button type="button" data-flag-catalog-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogDeleteTitle || "Delete flag") + '">\xD7</button>') + "</span>";
          }).join("");
        }
      }
      syncEditorTabLabels();
    }
    function addFlagFromInput() {
      clearCatalogDeleteState("flag");
      var todoFlagNameInput2 = document.getElementById("todo-flag-name-input");
      var todoFlagColorInput2 = document.getElementById("todo-flag-color-input");
      if (!todoFlagNameInput2) {
        emitWebviewDebug("todoFlagAddIgnored", { reason: "missingInput" });
        return;
      }
      var name = normalizeTodoLabel(todoFlagNameInput2.value);
      if (!name) {
        emitWebviewDebug("todoFlagAddIgnored", {
          reason: "emptyFlag",
          rawValue: String(todoFlagNameInput2.value || "")
        });
        return;
      }
      var color = todoFlagColorInput2 ? todoFlagColorInput2.value : "#f59e0b";
      emitWebviewDebug("todoFlagAddAccepted", {
        flag: name,
        editingExisting: !!editingFlagOriginalName,
        color
      });
      var prevName = editingFlagOriginalName;
      editingFlagOriginalName = "";
      todoFlagNameInput2.value = "";
      if (prevName && normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(name)) {
        vscode.postMessage({ type: "deleteTodoFlagDefinition", data: { name: prevName } });
        if (normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(prevName)) {
          currentTodoFlag = name;
        }
      }
      vscode.postMessage({ type: "saveTodoFlagDefinition", data: { name, color } });
      if (!prevName) {
        currentTodoFlag = name;
      }
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
      if (!value) return void 0;
      var date = new Date(value);
      if (isNaN(date.getTime())) return void 0;
      return date.toISOString();
    }
    function formatTodoDate(value) {
      if (!value) return "";
      var date = new Date(value);
      if (isNaN(date.getTime())) return String(value);
      return date.toLocaleString(locale || void 0, {
        dateStyle: "medium",
        timeStyle: "short"
      });
    }
    function getTodoPriorityLabel(priority) {
      switch (priority) {
        case "low":
          return strings.boardPriorityLow || "Low";
        case "medium":
          return strings.boardPriorityMedium || "Medium";
        case "high":
          return strings.boardPriorityHigh || "High";
        case "urgent":
          return strings.boardPriorityUrgent || "Urgent";
        default:
          return strings.boardPriorityNone || "None";
      }
    }
    function getTodoPriorityRank(priority) {
      switch (priority) {
        case "urgent":
          return 4;
        case "high":
          return 3;
        case "medium":
          return 2;
        case "low":
          return 1;
        default:
          return 0;
      }
    }
    function getTodoPriorityCardBg(priority, isSelected) {
      if (isSelected) return "var(--vscode-list-activeSelectionBackground)";
      switch (priority) {
        case "urgent":
          return "color-mix(in srgb, #ef4444 12%, var(--vscode-sideBar-background))";
        case "high":
          return "color-mix(in srgb, #f59e0b 12%, var(--vscode-sideBar-background))";
        case "medium":
          return "color-mix(in srgb, #3b82f6 12%, var(--vscode-sideBar-background))";
        case "low":
          return "color-mix(in srgb, #6b7280 12%, var(--vscode-sideBar-background))";
        default:
          return "color-mix(in srgb, #9ca3af 6%, var(--vscode-sideBar-background))";
      }
    }
    function getTodoStatusLabel(status) {
      switch (status) {
        case "ready":
          return strings.boardStatusReady || "Ready";
        case "completed":
          return strings.boardStatusCompleted || "Completed";
        case "rejected":
          return strings.boardStatusRejected || "Rejected";
        default:
          return strings.boardStatusActive || "Active";
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
        case "bot-mcp":
          return strings.boardCommentSourceBotMcp || "Bot MCP";
        case "bot-manual":
          return strings.boardCommentSourceBotManual || "Bot manual";
        case "system-event":
          return strings.boardCommentSourceSystemEvent || "System event";
        default:
          return strings.boardCommentSourceHumanForm || "Human form";
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
        viewMode: filters.viewMode === "list" ? "list" : "board",
        showArchived: filters.showArchived === true
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
          updatedAt: ""
        };
      }
      cockpitBoard.filters = next;
      renderCockpitBoard();
      vscode.postMessage({ type: "setTodoFilters", data: next });
    }
    function hasActiveTodoFilters(filters) {
      var current = filters || getTodoFilters();
      return Boolean(
        current.searchText && String(current.searchText).trim() || Array.isArray(current.labels) && current.labels.length > 0 || Array.isArray(current.priorities) && current.priorities.length > 0 || Array.isArray(current.statuses) && current.statuses.length > 0 || Array.isArray(current.archiveOutcomes) && current.archiveOutcomes.length > 0 || Array.isArray(current.flags) && current.flags.length > 0 || current.sectionId && String(current.sectionId).trim() || current.showArchived === true
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
        showArchived: false
      });
    }
    function getTodoSections(filters) {
      var sections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice() : [];
      sections.sort(function(left, right) {
        return (left.order || 0) - (right.order || 0);
      });
      return sections.filter(function(section) {
        return filters && filters.showArchived === true ? true : !isArchiveTodoSectionId(section.id);
      });
    }
    function getEditableTodoSections() {
      return getTodoSections({ showArchived: true }).filter(function(section) {
        return !isArchiveTodoSectionId(section.id);
      });
    }
    function isTodoReadyForFinalize(card) {
      return !!(card && !card.archived && card.status === "ready");
    }
    function getTodoCompletionActionType(card) {
      return isTodoReadyForFinalize(card) ? "finalizeTodo" : "approveTodo";
    }
    function getTodoCompletionActionLabel(card) {
      return isTodoReadyForFinalize(card) ? strings.boardFinalizeTodo || "Final Accept" : strings.boardApproveTodo || "Approve";
    }
    function isTodoCompleted(card) {
      return !!(card && card.archived && card.archiveOutcome === "completed-successfully");
    }
    function renderTodoCompletionButton(card) {
      var isArchivedCard = !!(card && card.archived);
      var title = isArchivedCard ? strings.boardRestoreTodo || "Restore" : getTodoCompletionActionLabel(card);
      var icon = isTodoCompleted(card) ? "\u2713" : isTodoReadyForFinalize(card) ? "\u2713\u2713" : "\u25CB";
      var actionAttr = isArchivedCard ? "data-todo-restore" : "data-todo-complete";
      return '<button type="button" class="todo-complete-button" ' + actionAttr + '="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(title) + '" aria-label="' + escapeAttr(title) + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;border:1px solid var(--vscode-input-border, var(--vscode-panel-border));background:' + (isTodoCompleted(card) ? "var(--vscode-button-background)" : "var(--vscode-input-background)") + ";color:" + (isTodoCompleted(card) ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)") + ';cursor:pointer;font-size:12px;font-weight:700;line-height:1;flex:0 0 auto;"><span aria-hidden="true">' + escapeHtml(icon) + "</span></button>";
    }
    function renderTodoDragHandle(card) {
      if (!card || card.archived) {
        return "";
      }
      return '<span class="cockpit-drag-handle" data-todo-drag-handle="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(strings.boardReorderTodo || "Drag todo") + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:0 4px;cursor:grab;color:var(--vscode-descriptionForeground);user-select:none;line-height:1;font-weight:700;">::</span>';
    }
    function renderSectionDragHandle(section, isArchiveSection) {
      if (!section || isArchiveSection) {
        return "";
      }
      return '<span class="cockpit-drag-handle" data-section-drag-handle="' + escapeAttr(section.id) + '" data-no-drag="1" title="' + escapeAttr(strings.boardReorderSection || "Drag section") + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:0 4px;cursor:grab;color:var(--vscode-descriptionForeground);user-select:none;line-height:1;font-weight:700;">::</span>';
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
        var hasLabel = (card.labels || []).some(function(label) {
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
        var hasFlag = (card.flags || []).some(function(flag) {
          return filters.flags.indexOf(flag) >= 0;
        });
        if (!hasFlag) return false;
      }
      if (filters.searchText) {
        var needle = String(filters.searchText).toLowerCase();
        var commentsText = (card.comments || []).map(function(comment) {
          return (comment.author || "") + " " + (comment.body || "");
        }).join(" ");
        var haystack = [
          card.title || "",
          card.description || "",
          (card.labels || []).join(" "),
          (card.flags || []).join(" "),
          commentsText
        ].join(" ").toLowerCase();
        if (haystack.indexOf(needle) < 0) {
          return false;
        }
      }
      return true;
    }
    function sortTodoCards(cards, filters) {
      var direction = filters.sortDirection === "desc" ? -1 : 1;
      return cards.slice().sort(function(left, right) {
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
        getLabelCatalog().map(function(entry) {
          return entry.name;
        }).concat((Array.isArray(cards) ? cards : []).reduce(function(all, card) {
          return all.concat(card.labels || []);
        }, []))
      ).sort();
      var flags = dedupeStringList(
        getFlagCatalog().map(function(entry) {
          return entry.name;
        }).concat((Array.isArray(cards) ? cards : []).reduce(function(all, card) {
          return all.concat(card.flags || []);
        }, []))
      ).sort();
      if (todoSearchInput) todoSearchInput.value = filters.searchText || "";
      if (todoSectionFilter) {
        todoSectionFilter.innerHTML = '<option value="">' + escapeHtml(strings.boardAllSections || "All sections") + "</option>" + sections.map(function(section) {
          return '<option value="' + escapeAttr(section.id) + '">' + escapeHtml(section.title) + "</option>";
        }).join("");
        todoSectionFilter.value = filters.sectionId || "";
      }
      if (todoLabelFilter) {
        todoLabelFilter.innerHTML = '<option value="">' + escapeHtml(strings.boardAllLabels || "All labels") + "</option>" + labels.map(function(label) {
          return '<option value="' + escapeAttr(label) + '">' + escapeHtml(label) + "</option>";
        }).join("");
        todoLabelFilter.value = filters.labels[0] || "";
      }
      if (todoFlagFilter) {
        todoFlagFilter.innerHTML = '<option value="">' + escapeHtml(strings.boardAllFlags || "All flags") + "</option>" + flags.map(function(flag) {
          return '<option value="' + escapeAttr(flag) + '">' + escapeHtml(flag) + "</option>";
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
          { value: "urgent", label: getTodoPriorityLabel("urgent") }
        ].map(function(option) {
          var optStyle = PRIORITY_FILTER_STYLES[option.value] || "";
          var style = optStyle ? ' style="' + optStyle + '"' : "";
          return '<option value="' + escapeAttr(option.value) + '"' + style + ">" + escapeHtml(option.label) + "</option>";
        }).join("");
        todoPriorityFilter.value = filters.priorities[0] || "";
      }
      if (todoStatusFilter) {
        todoStatusFilter.innerHTML = [
          { value: "", label: strings.boardAllStatuses || "All statuses" },
          { value: "active", label: getTodoStatusLabel("active") },
          { value: "ready", label: getTodoStatusLabel("ready") },
          { value: "completed", label: getTodoStatusLabel("completed") },
          { value: "rejected", label: getTodoStatusLabel("rejected") }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoStatusFilter.value = filters.statuses[0] || "";
      }
      if (todoArchiveOutcomeFilter) {
        todoArchiveOutcomeFilter.innerHTML = [
          { value: "", label: strings.boardAllArchiveOutcomes || "All outcomes" },
          { value: "completed-successfully", label: getTodoArchiveOutcomeLabel("completed-successfully") },
          { value: "rejected", label: getTodoArchiveOutcomeLabel("rejected") }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoArchiveOutcomeFilter.value = filters.archiveOutcomes[0] || "";
      }
      if (todoSortBy) {
        todoSortBy.innerHTML = [
          { value: "manual", label: strings.boardSortManual || "Manual order" },
          { value: "dueAt", label: strings.boardSortDueAt || "Due date" },
          { value: "priority", label: strings.boardSortPriority || "Priority" },
          { value: "updatedAt", label: strings.boardSortUpdatedAt || "Last updated" },
          { value: "createdAt", label: strings.boardSortCreatedAt || "Created date" }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoSortBy.value = filters.sortBy || "manual";
      }
      if (todoSortDirection) {
        todoSortDirection.innerHTML = [
          { value: "asc", label: strings.boardSortAsc || "Ascending" },
          { value: "desc", label: strings.boardSortDesc || "Descending" }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoSortDirection.value = filters.sortDirection || "asc";
      }
      if (todoViewMode) {
        todoViewMode.innerHTML = [
          { value: "board", label: strings.boardViewBoard || "Board" },
          { value: "list", label: strings.boardViewList || "List" }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoViewMode.value = filters.viewMode || "board";
      }
      if (todoShowArchived) {
        todoShowArchived.checked = filters.showArchived === true;
      }
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
      var isRefreshingSameTodo = isEditingTodo && todoDetailId && todoDetailId.value === selectedTodo.id;
      var sectionOptions = getEditableTodoSections();
      if (isEditingTodo && selectedTodo && selectedTodo.sectionId) {
        var hasCurrentSection = sectionOptions.some(function(section) {
          return section.id === selectedTodo.sectionId;
        });
        if (!hasCurrentSection) {
          var currentSection = (Array.isArray(sections) ? sections : []).find(function(section) {
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
        todoDetailTitle.textContent = isEditingTodo ? strings.boardDetailTitleEdit || "Edit Todo" : strings.boardDetailTitleCreate || "Create Todo";
      }
      if (todoDetailModeNote) {
        todoDetailModeNote.textContent = isEditingTodo ? strings.boardDetailModeEdit || "Update this todo." : strings.boardDetailModeCreate || "Fill the form to create a new todo.";
      }
      if (todoDetailId) todoDetailId.value = isEditingTodo ? selectedTodo.id : "";
      if (!isRefreshingSameTodo) {
        if (todoTitleInput) todoTitleInput.value = isEditingTodo ? selectedTodo.title || "" : todoDraft.title || "";
        if (todoDescriptionInput) todoDescriptionInput.value = isEditingTodo ? selectedTodo.description || "" : todoDraft.description || "";
        if (todoDueInput) todoDueInput.value = isEditingTodo ? toLocalDateTimeInput(selectedTodo.dueAt) : todoDraft.dueAt || "";
        if (todoLabelsInput) todoLabelsInput.value = isEditingTodo ? "" : todoDraft.labelInput || "";
        if (todoLabelColorInput && !isEditingTodo && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(todoDraft.labelColor || "")) {
          todoLabelColorInput.value = todoDraft.labelColor;
        }
        currentTodoFlag = isEditingTodo ? (selectedTodo.flags || [])[0] || "" : todoDraft.flag || "";
        if (todoFlagNameInput) todoFlagNameInput.value = isEditingTodo ? "" : todoDraft.flagInput || "";
        if (todoFlagColorInput && !isEditingTodo && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(todoDraft.flagColor || "")) {
          todoFlagColorInput.value = todoDraft.flagColor;
        }
      }
      syncTodoFlagDraft();
      syncFlagEditor();
      syncTodoLabelEditor();
      if (todoFlagColorSaveBtn) {
        todoFlagColorSaveBtn.disabled = !todoFlagNameInput || !todoFlagNameInput.value.trim();
      }
      if (todoDetailStatus) {
        if (!isEditingTodo) {
          todoDetailStatus.textContent = strings.boardStatusLabel ? strings.boardStatusLabel + ": " + (strings.boardStatusActive || "Active") : "Status: Active";
        } else if (selectedTodo.archived) {
          todoDetailStatus.textContent = (strings.boardStatusLabel || "Status") + ": " + getTodoStatusLabel(selectedTodo.status || "active") + " \u2022 " + getTodoArchiveOutcomeLabel(selectedTodo.archiveOutcome || "rejected");
        } else {
          todoDetailStatus.textContent = (strings.boardStatusLabel || "Status") + ": " + getTodoStatusLabel(selectedTodo.status || "active");
        }
      }
      if (todoPriorityInput) {
        var prevPriority = isRefreshingSameTodo ? todoPriorityInput.value : "";
        var PRIORITY_EDIT_STYLES = { none: "background:#d1d5db;color:#374151;", low: "background:#6b7280;color:#fff;", medium: "background:#3b82f6;color:#fff;", high: "background:#f59e0b;color:#fff;", urgent: "background:#ef4444;color:#fff;" };
        todoPriorityInput.innerHTML = ["none", "low", "medium", "high", "urgent"].map(function(priority) {
          var optStyle = PRIORITY_EDIT_STYLES[priority] || "";
          var style = optStyle ? ' style="' + optStyle + '"' : "";
          return '<option value="' + escapeAttr(priority) + '"' + style + ">" + escapeHtml(getTodoPriorityLabel(priority)) + "</option>";
        }).join("");
        todoPriorityInput.value = isRefreshingSameTodo ? prevPriority : isEditingTodo ? selectedTodo.priority || "none" : todoDraft.priority || "none";
      }
      if (todoSectionInput) {
        var prevSection = isRefreshingSameTodo ? todoSectionInput.value : "";
        todoSectionInput.innerHTML = sectionOptions.map(function(section) {
          return '<option value="' + escapeAttr(section.id) + '">' + escapeHtml(section.title) + "</option>";
        }).join("");
        if (isRefreshingSameTodo && selectHasOptionValue(todoSectionInput, prevSection)) {
          todoSectionInput.value = prevSection;
        } else {
          todoSectionInput.value = isEditingTodo ? selectedTodo.sectionId : todoDraft.sectionId && selectHasOptionValue(todoSectionInput, todoDraft.sectionId) ? todoDraft.sectionId : sectionOptions[0] ? sectionOptions[0].id : "";
        }
      }
      if (!isRefreshingSameTodo) {
        syncTodoLinkedTaskOptions(isEditingTodo && selectedTodo ? selectedTodo.taskId || "" : todoDraft.taskId || "");
      }
      if (!isEditingTodo) {
        currentTodoDraft.priority = todoPriorityInput ? todoPriorityInput.value || "none" : "none";
        currentTodoDraft.sectionId = todoSectionInput ? todoSectionInput.value || "" : "";
        currentTodoDraft.dueAt = todoDueInput ? todoDueInput.value || "" : "";
      }
      if (todoSaveBtn) {
        todoSaveBtn.textContent = isEditingTodo ? strings.boardSaveUpdate || "Save Todo" : strings.boardSaveCreate || "Create Todo";
        todoSaveBtn.disabled = isArchivedTodo;
      }
      if (todoCreateTaskBtn) {
        todoCreateTaskBtn.disabled = !isEditingTodo || isArchivedTodo;
      }
      if (todoCompleteBtn) {
        todoCompleteBtn.textContent = isEditingTodo ? getTodoCompletionActionLabel(selectedTodo) : strings.boardApproveTodo || "Approve";
        todoCompleteBtn.disabled = !isEditingTodo || isArchivedTodo;
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
        todoCommentList.innerHTML = comments.length > 0 ? comments.map(function(comment) {
          var sourceLabel = getTodoCommentSourceLabel(comment.source || "human-form");
          var sequence = typeof comment.sequence === "number" ? comment.sequence : 1;
          var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
          var userFormClass = comment.source === "human-form" && String(comment.author || "").toLowerCase() === "user" ? " is-user-form" : "";
          return '<article class="todo-comment-card' + userFormClass + '"><div class="todo-comment-header"><strong>#' + escapeHtml(String(sequence)) + " \u2022 " + escapeHtml(sourceLabel) + '</strong><span class="note">' + escapeHtml(formatTodoDate(displayDate)) + '</span></div><div class="note todo-comment-author">' + escapeHtml(comment.author || "system") + '</div><div class="note todo-comment-body">' + escapeHtml(comment.body || "") + "</div></article>";
        }).join("") : '<div class="note">' + escapeHtml(strings.boardCommentsEmpty || "No comments yet.") + "</div>";
      }
    }
    function syncTodoLinkedTaskOptions(preferredTaskId) {
      if (!todoLinkedTaskSelect) {
        return;
      }
      var currentValue = todoLinkedTaskSelect.value || "";
      var nextValue = preferredTaskId || currentValue;
      todoLinkedTaskSelect.innerHTML = '<option value="">' + escapeHtml(strings.boardLinkedTaskNone || "No linked task") + "</option>" + tasks.map(function(task) {
        return '<option value="' + escapeAttr(task.id) + '">' + escapeHtml(task.name || task.id) + "</option>";
      }).join("");
      if (!nextValue) {
        todoLinkedTaskSelect.value = "";
        if (!selectedTodoId) {
          currentTodoDraft.taskId = "";
        }
        return;
      }
      var hasTaskOption = tasks.some(function(task) {
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
      var allSections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice().sort(function(left, right) {
        return (left.order || 0) - (right.order || 0);
      }) : [];
      var allCards = getAllTodoCards();
      var cards = getVisibleTodoCards(filters);
      if (selectedTodoId) {
        var selectedTodo = allCards.find(function(card) {
          return card && card.id === selectedTodoId;
        });
        if (selectedTodo && selectedTodo.archived && filters.showArchived !== true) {
          selectedTodoId = null;
        }
        var hasSelectedTodo = allCards.some(function(card) {
          return card && card.id === selectedTodoId;
        });
        if (!hasSelectedTodo) {
          selectedTodoId = null;
        }
      }
      renderTodoFilterControls(filters, sections, cards);
      if (boardSummary) {
        var activeCount = allCards.filter(function(card) {
          return !card.archived;
        }).length;
        var archivedCount = allCards.filter(function(card) {
          return card.archived;
        }).length;
        boardSummary.textContent = (strings.boardSections || "Sections") + ": " + sections.length + " \u2022 " + (strings.boardCards || "Cards") + ": " + activeCount + " \u2022 Archived: " + String(archivedCount) + " \u2022 " + (strings.boardComments || "Comments") + ": " + allCards.reduce(function(count, card) {
          return count + (Array.isArray(card.comments) ? card.comments.length : 0);
        }, 0);
      }
      if (!boardColumns) {
        return;
      }
      var visibleSections = sections.filter(function(section) {
        return !filters.sectionId || section.id === filters.sectionId;
      });
      if (visibleSections.length === 0) {
        boardColumns.innerHTML = '<div class="note">' + escapeHtml(strings.boardEmpty || "No cards yet.") + "</div>";
        renderTodoDetailPanel(null, sections);
        return;
      }
      boardColumns.innerHTML = renderTodoBoardMarkup({
        visibleSections,
        cards,
        filters,
        strings,
        selectedTodoId,
        collapsedSections,
        helpers: {
          escapeAttr,
          escapeHtml,
          sortTodoCards,
          cardMatchesTodoFilters,
          isArchiveTodoSectionId,
          renderSectionDragHandle,
          renderTodoCompletionCheckbox: renderTodoCompletionButton,
          renderTodoDragHandle,
          renderFlagChip,
          renderLabelChip,
          getTodoPriorityLabel,
          getTodoStatusLabel,
          getTodoDescriptionPreview,
          getTodoCommentSourceLabel,
          getTodoArchiveOutcomeLabel,
          getTodoPriorityCardBg,
          formatTodoDate
        }
      });
      renderTodoDetailPanel(
        selectedTodoId ? allCards.find(function(card) {
          return card.id === selectedTodoId;
        }) || null : null,
        allSections
      );
      if (boardColumns) {
        bindRenderedCockpitBoardInteractions();
      }
      if (todoNewBtn) {
        todoNewBtn.onclick = function() {
          clearCatalogDeleteState();
          openTodoEditor("");
        };
      }
      if (todoClearSelectionBtn) {
        todoClearSelectionBtn.onclick = function() {
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
        boardAddSectionBtn.onclick = function() {
          boardAddSectionBtn.style.display = "none";
          if (boardSectionInlineForm) {
            boardSectionInlineForm.style.display = "flex";
            if (boardSectionNameInput) {
              boardSectionNameInput.value = "";
              boardSectionNameInput.focus();
            }
          }
        };
      }
      function hideSectionForm() {
        if (boardSectionInlineForm) boardSectionInlineForm.style.display = "none";
        if (boardAddSectionBtn) boardAddSectionBtn.style.display = "";
      }
      function doAddSection() {
        var title = boardSectionNameInput ? boardSectionNameInput.value.trim() : "";
        if (title) {
          vscode.postMessage({ type: "addCockpitSection", title });
        }
        hideSectionForm();
      }
      if (boardSectionSaveBtn) {
        boardSectionSaveBtn.onclick = doAddSection;
      }
      if (boardSectionCancelBtn) {
        boardSectionCancelBtn.onclick = hideSectionForm;
      }
      if (boardSectionNameInput) {
        boardSectionNameInput.onkeydown = function(e) {
          if (e.key === "Enter") {
            e.preventDefault();
            doAddSection();
          }
          if (e.key === "Escape") {
            hideSectionForm();
          }
        };
      }
      if (cockpitColSlider) {
        cockpitColSlider.oninput = function() {
          var w = Number(cockpitColSlider.value);
          document.documentElement.style.setProperty("--cockpit-col-width", w + "px");
          var font = Math.round(10 + (w - 180) * 3 / 340);
          document.documentElement.style.setProperty("--cockpit-col-font", font + "px");
          var pad = Math.round(8 + (w - 180) * 6 / 340);
          document.documentElement.style.setProperty("--cockpit-card-pad", pad + "px");
          var gap = Math.round(4 + (w - 180) * 4 / 340);
          document.documentElement.style.setProperty("--cockpit-card-gap", gap + "px");
          setLabelSlotsClass(w);
          try {
            localStorage.setItem("cockpit-col-width", w);
          } catch (e) {
          }
        };
      }
      if (todoBackBtn) {
        todoBackBtn.onclick = function() {
          switchTab("board");
        };
      }
      if (todoSearchInput) {
        todoSearchInput.oninput = function() {
          updateTodoFilters({ searchText: todoSearchInput.value || "" });
        };
      }
      if (todoSectionFilter) {
        todoSectionFilter.onchange = function() {
          updateTodoFilters({ sectionId: todoSectionFilter.value || "" });
        };
      }
      if (todoLabelFilter) {
        todoLabelFilter.onchange = function() {
          updateTodoFilters({ labels: todoLabelFilter.value ? [todoLabelFilter.value] : [] });
        };
      }
      if (todoFlagFilter) {
        todoFlagFilter.onchange = function() {
          updateTodoFilters({ flags: todoFlagFilter.value ? [todoFlagFilter.value] : [] });
        };
      }
      if (todoPriorityFilter) {
        todoPriorityFilter.onchange = function() {
          updateTodoFilters({ priorities: todoPriorityFilter.value ? [todoPriorityFilter.value] : [] });
        };
      }
      if (todoStatusFilter) {
        todoStatusFilter.onchange = function() {
          updateTodoFilters({ statuses: todoStatusFilter.value ? [todoStatusFilter.value] : [] });
        };
      }
      if (todoArchiveOutcomeFilter) {
        todoArchiveOutcomeFilter.onchange = function() {
          updateTodoFilters({ archiveOutcomes: todoArchiveOutcomeFilter.value ? [todoArchiveOutcomeFilter.value] : [] });
        };
      }
      if (todoSortBy) {
        todoSortBy.onchange = function() {
          updateTodoFilters({ sortBy: todoSortBy.value || "manual" });
        };
      }
      if (todoSortDirection) {
        todoSortDirection.onchange = function() {
          updateTodoFilters({ sortDirection: todoSortDirection.value || "asc" });
        };
      }
      if (todoViewMode) {
        todoViewMode.onchange = function() {
          updateTodoFilters({ viewMode: todoViewMode.value === "list" ? "list" : "board" });
        };
      }
      if (todoShowArchived) {
        todoShowArchived.onchange = function() {
          updateTodoFilters({ showArchived: todoShowArchived.checked === true });
        };
      }
      if (todoToggleFiltersBtn) {
        todoToggleFiltersBtn.onclick = function() {
          boardFiltersCollapsed = !boardFiltersCollapsed;
          applyBoardFilterCollapseState();
          persistTaskFilter();
        };
      }
      if (todoClearFiltersBtn) {
        todoClearFiltersBtn.onclick = function() {
          clearTodoFilters();
        };
      }
      if (todoDetailForm) {
        todoDetailForm.onsubmit = function(event) {
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
            taskId: todoLinkedTaskSelect && todoLinkedTaskSelect.value ? todoLinkedTaskSelect.value : null
          };
          if (selectedTodoId) {
            vscode.postMessage({ type: "updateTodo", todoId: selectedTodoId, data: payload });
          } else {
            emitWebviewDebug("todoCreateSubmit", {
              titleLength: payload.title.length,
              sectionId: payload.sectionId,
              taskId: payload.taskId || ""
            });
            vscode.postMessage({ type: "createTodo", data: payload });
          }
        };
      }
      if (todoAddCommentBtn) {
        todoAddCommentBtn.onclick = function() {
          if (!selectedTodoId || !todoCommentInput || !todoCommentInput.value.trim()) {
            return;
          }
          vscode.postMessage({
            type: "addTodoComment",
            todoId: selectedTodoId,
            data: { body: todoCommentInput.value.trim(), author: "user", source: "human-form" }
          });
          todoCommentInput.value = "";
        };
      }
      if (todoCreateTaskBtn) {
        todoCreateTaskBtn.onclick = function() {
          if (!selectedTodoId) return;
          vscode.postMessage({ type: "createTaskFromTodo", todoId: selectedTodoId });
        };
      }
      if (todoCompleteBtn) {
        todoCompleteBtn.onclick = function() {
          if (!selectedTodoId) return;
          var selectedTodo2 = cockpitBoard && Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.find(function(card) {
            return card && card.id === selectedTodoId;
          }) : null;
          vscode.postMessage({
            type: getTodoCompletionActionType(selectedTodo2),
            todoId: selectedTodoId
          });
        };
      }
      if (todoDeleteBtn) {
        todoDeleteBtn.onclick = function() {
          if (!selectedTodoId) return;
          openTodoDeleteModal(selectedTodoId);
        };
      }
      if (todoLabelAddBtn) {
        todoLabelAddBtn.onclick = function() {
          emitWebviewDebug("todoLabelAddButtonClick", {
            disabled: !!todoLabelAddBtn.disabled,
            inputValue: todoLabelsInput ? String(todoLabelsInput.value || "") : ""
          });
          addEditorLabelFromInput();
        };
      }
      if (todoLabelsInput) {
        todoLabelsInput.oninput = function() {
          var label = normalizeTodoLabel(todoLabelsInput.value);
          if (label) {
            var def = getLabelDefinition(label);
            if (def && def.color && todoLabelColorInput) {
              todoLabelColorInput.value = def.color;
            }
            if (todoLabelColorInput) todoLabelColorInput.disabled = false;
          } else {
            selectedTodoLabelName = "";
            syncTodoLabelEditor();
          }
          if (todoLabelColorSaveBtn) todoLabelColorSaveBtn.disabled = !todoLabelsInput.value.trim();
          syncTodoEditorTransientDraft();
          syncTodoLabelSuggestions();
        };
        todoLabelsInput.onfocus = function() {
          syncTodoLabelSuggestions();
        };
        todoLabelsInput.onblur = function() {
          setTimeout(function() {
            if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
          }, 200);
        };
        todoLabelsInput.onkeydown = function(event) {
          if (event.key === "Enter") {
            event.preventDefault();
            addEditorLabelFromInput();
          } else if (event.key === "Escape") {
            if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
          }
        };
      }
      if (todoLabelColorInput) {
        todoLabelColorInput.oninput = function() {
          syncTodoEditorTransientDraft();
        };
        todoLabelColorInput.onchange = function() {
          syncTodoEditorTransientDraft();
        };
      }
      if (todoLabelChipList) {
        todoLabelChipList.onclick = function(event) {
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
        todoLabelColorSaveBtn.onclick = function() {
          var name = todoLabelsInput ? todoLabelsInput.value.trim() : "";
          emitWebviewDebug("todoLabelSaveButtonClick", {
            disabled: !!todoLabelColorSaveBtn.disabled,
            inputValue: name,
            hasColorInput: !!todoLabelColorInput
          });
          if (!name || !todoLabelColorInput) {
            emitWebviewDebug("todoLabelSaveIgnored", {
              reason: !name ? "emptyLabel" : "missingColorInput"
            });
            return;
          }
          var normalized = normalizeTodoLabel ? normalizeTodoLabel(name) : name;
          emitWebviewDebug("todoLabelSaveAccepted", {
            label: normalized,
            color: todoLabelColorInput.value,
            editingExisting: !!editingLabelOriginalName
          });
          vscode.postMessage({ type: "saveTodoLabelDefinition", data: { name: normalized, color: todoLabelColorInput.value } });
          var prevName = editingLabelOriginalName;
          if (prevName && normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(normalized)) {
            vscode.postMessage({ type: "deleteTodoLabelDefinition", data: { name: prevName } });
            var prevIdx = currentTodoLabels.map(normalizeTodoLabelKey).indexOf(normalizeTodoLabelKey(prevName));
            if (prevIdx >= 0) {
              var newLabels = currentTodoLabels.slice();
              newLabels.splice(prevIdx, 1, normalized);
              setTodoEditorLabels(newLabels, true);
            }
          }
          editingLabelOriginalName = "";
          todoLabelsInput.value = "";
          syncTodoEditorTransientDraft();
          syncTodoLabelEditor();
        };
      }
      if (todoLabelSuggestions) {
        todoLabelSuggestions.onclick = function(event) {
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
        todoLabelCatalog.onclick = function(event) {
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
              if (normalizeTodoLabelKey(eCatalog[ei].name) === normalizeTodoLabelKey(eName)) {
                eEntry = eCatalog[ei];
                break;
              }
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
            editingLabelOriginalName = "";
            if (todoLabelsInput) todoLabelsInput.value = name;
            syncTodoEditorTransientDraft();
            addEditorLabelFromInput();
          }
        };
      }
      if (todoFlagColorSaveBtn) {
        todoFlagColorSaveBtn.onclick = function() {
          var todoFlagNameInputEl = document.getElementById("todo-flag-name-input");
          var todoFlagColorInputEl = document.getElementById("todo-flag-color-input");
          emitWebviewDebug("todoFlagSaveButtonClick", {
            disabled: !!todoFlagColorSaveBtn.disabled,
            hasNameInput: !!todoFlagNameInputEl,
            hasColorInput: !!todoFlagColorInputEl
          });
          if (!todoFlagNameInputEl || !todoFlagColorInputEl) {
            emitWebviewDebug("todoFlagSaveIgnored", { reason: "missingInputs" });
            return;
          }
          var name = todoFlagNameInputEl.value.trim();
          if (!name) {
            emitWebviewDebug("todoFlagSaveIgnored", { reason: "emptyFlag" });
            return;
          }
          var normalized = normalizeTodoLabel ? normalizeTodoLabel(name) : name;
          emitWebviewDebug("todoFlagSaveAccepted", {
            flag: normalized,
            color: todoFlagColorInputEl.value,
            editingExisting: !!editingFlagOriginalName
          });
          vscode.postMessage({
            type: "saveTodoFlagDefinition",
            data: {
              name: normalized,
              color: todoFlagColorInputEl.value
            }
          });
          var prevName = editingFlagOriginalName;
          if (prevName && normalizeTodoLabelKey(prevName) !== normalizeTodoLabelKey(normalized)) {
            vscode.postMessage({ type: "deleteTodoFlagDefinition", data: { name: prevName } });
            if (normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(prevName)) {
              currentTodoFlag = normalized;
              syncTodoFlagDraft();
              syncFlagEditor();
            }
          }
          editingFlagOriginalName = "";
          todoFlagNameInputEl.value = "";
          syncTodoEditorTransientDraft();
        };
      }
      if (todoFlagAddBtn) {
        todoFlagAddBtn.onclick = function() {
          emitWebviewDebug("todoFlagAddButtonClick", {
            disabled: !!todoFlagAddBtn.disabled,
            inputValue: todoFlagNameInput ? String(todoFlagNameInput.value || "") : ""
          });
          addFlagFromInput();
        };
      }
      if (todoFlagNameInput) {
        todoFlagNameInput.oninput = function() {
          if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !todoFlagNameInput.value.trim();
          syncTodoEditorTransientDraft();
        };
        todoFlagNameInput.onkeydown = function(event) {
          if (event.key === "Enter") {
            event.preventDefault();
            addFlagFromInput();
          }
        };
      }
      if (todoFlagColorInput) {
        todoFlagColorInput.oninput = function() {
          syncTodoEditorTransientDraft();
        };
        todoFlagColorInput.onchange = function() {
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
        oneTime,
        chatSession: oneTime ? "" : chatSessionSelect ? String(chatSessionSelect.value || "") : "",
        jitterSeconds: jitterSecondsInput ? Number(jitterSecondsInput.value || 0) : 0
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
        chatSession: task.oneTime === true ? "" : String(task.chatSession || defaultChatSession || "new"),
        jitterSeconds: Number(task.jitterSeconds != null ? task.jitterSeconds : defaultJitterSeconds)
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
        flag: normalizeTodoLabelKey(currentTodoFlag || "")
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
        flag: normalizeTodoLabelKey((card.flags || [])[0] || "")
      };
    }
    function getCurrentJobEditorState() {
      return {
        name: jobsNameInput ? String(jobsNameInput.value || "") : "",
        cronExpression: jobsCronInput ? String(jobsCronInput.value || "") : "",
        folderId: jobsFolderSelect ? String(jobsFolderSelect.value || "") : ""
      };
    }
    function getSavedJobEditorState(job) {
      if (!job) {
        return null;
      }
      return {
        name: String(job.name || ""),
        cronExpression: String(job.cronExpression || ""),
        folderId: String(job.folderId || "")
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
      var selectedTodo = cockpitBoard && Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.find(function(card) {
        return card && card.id === selectedTodoId;
      }) : null;
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
          title = title + " \u2022 " + (strings.tabUnsavedChanges || strings.researchUnsavedChanges || "Unsaved changes");
        }
        button.title = title;
        button.setAttribute("aria-label", title || tabName);
      }
    }
    function syncEditorTabLabels() {
      setEditorTabState("create", {
        symbol: editingTaskId ? EDITOR_EDIT_SYMBOL : EDITOR_CREATE_SYMBOL,
        dirty: isTaskEditorDirty(),
        title: editingTaskId ? strings.tabTaskEditorEdit || strings.tabEdit || "Edit Task" : strings.tabTaskEditorCreate || strings.tabTaskEditor || "Create Task"
      });
      setEditorTabState("todo-edit", {
        symbol: selectedTodoId ? EDITOR_EDIT_SYMBOL : EDITOR_CREATE_SYMBOL,
        dirty: isTodoEditorDirty(),
        title: selectedTodoId ? strings.tabTodoEditorEdit || strings.boardDetailTitleEdit || "Edit Todo" : strings.tabTodoEditorCreate || strings.tabTodoEditor || "Create Todo"
      });
      setEditorTabState("jobs-edit", {
        symbol: isCreatingJob || !selectedJobId ? EDITOR_CREATE_SYMBOL : EDITOR_EDIT_SYMBOL,
        dirty: isJobsEditorDirty(),
        title: isCreatingJob || !selectedJobId ? strings.tabJobsEditorCreate || strings.tabJobsEditor || "Create Job" : strings.tabJobsEditorEdit || "Edit Job"
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
      todoDeleteModalRoot.innerHTML = '<div class="cockpit-inline-modal-card" role="dialog" aria-modal="true" aria-labelledby="todo-delete-modal-title"><div class="cockpit-inline-modal-title" id="todo-delete-modal-title"></div><div class="note" data-todo-delete-modal-message></div><div class="cockpit-inline-modal-actions"><button type="button" class="btn-secondary" data-todo-delete-cancel>' + escapeHtml(strings.boardDeleteTodoCancel || "Cancel") + '</button><button type="button" class="btn-secondary" data-todo-delete-reject>' + escapeHtml(strings.boardDeleteTodoReject || "Archive as Rejected") + '</button><button type="button" class="btn-danger" data-todo-delete-permanent>' + escapeHtml(strings.boardDeleteTodoPermanent || "Delete Permanently") + "</button></div></div>";
      todoDeleteModalRoot.onclick = function(event) {
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
    function openTodoDeleteModal(todoId, options) {
      if (!todoId) {
        return;
      }
      var permanentOnly = !!(options && options.permanentOnly);
      var todo = cockpitBoard && Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.find(function(card) {
        return card && card.id === todoId;
      }) : null;
      var modal = ensureTodoDeleteModal();
      pendingTodoDeleteId = todoId;
      var titleEl = modal.querySelector("#todo-delete-modal-title");
      var messageEl = modal.querySelector("[data-todo-delete-modal-message]");
      var rejectBtn = modal.querySelector("[data-todo-delete-reject]");
      if (titleEl) {
        titleEl.textContent = permanentOnly ? strings.boardDeleteTodoPermanent || "Delete Permanently" : strings.boardDeleteTodoTitle || "Delete Todo";
      }
      if (messageEl) {
        var promptText = permanentOnly ? strings.boardDeleteTodoPermanentPrompt || "Delete this archived todo permanently? This cannot be undone." : strings.boardDeleteTodoPrompt || "Choose whether this todo should be rejected into the archive or removed permanently.";
        messageEl.textContent = todo && todo.title ? '"' + String(todo.title || "") + '". ' + promptText : promptText;
      }
      if (rejectBtn) {
        rejectBtn.hidden = permanentOnly;
      }
      modal.removeAttribute("hidden");
      modal.classList.add("is-open");
      setTimeout(function() {
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
        todoId
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
          isCreatingJob,
          hasName: !!jobName,
          hasCron: !!cronExpressionValue
        });
        return;
      }
      if (isCreatingJob || !selectedJobId) {
        emitWebviewDebug("jobCreateSubmit", {
          name: jobName,
          folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : ""
        });
        vscode.postMessage({
          type: "createJob",
          data: {
            name: jobName,
            cronExpression: cronExpressionValue,
            folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : void 0
          }
        });
        return;
      }
      vscode.postMessage({
        type: "updateJob",
        jobId: selectedJobId,
        data: {
          name: jobsNameInput ? jobsNameInput.value : "",
          cronExpression: jobsCronInput ? jobsCronInput.value : "",
          folderId: jobsFolderSelect && jobsFolderSelect.value ? jobsFolderSelect.value : void 0
        }
      });
    }
    function isTabActive(tabName) {
      var targetContent = document.getElementById(tabName + "-tab");
      return !!(targetContent && targetContent.classList.contains("active"));
    }
    function switchTab(tabName) {
      document.querySelectorAll(".tab-button").forEach(function(b) {
        b.classList.remove("active");
      });
      document.querySelectorAll(".tab-content").forEach(function(c) {
        c.classList.remove("active");
      });
      var targetBtn = document.querySelector(
        '.tab-button[data-tab="' + tabName + '"]'
      );
      var targetContent = document.getElementById(tabName + "-tab");
      if (targetBtn) targetBtn.classList.add("active");
      if (targetContent) targetContent.classList.add("active");
      if (jobsToggleSidebarBtn) {
        jobsToggleSidebarBtn.style.display = "";
      }
      if (jobsShowSidebarBtn) {
        jobsShowSidebarBtn.style.display = tabName === "jobs" && jobsSidebarHidden ? "inline-flex" : "none";
      }
      if (tabName === "list") {
        refreshTaskCountdowns();
      }
      maybePlayInitialHelpWarp(tabName);
    }
    function getInitialTabName() {
      var tabName = typeof initialData.initialTab === "string" ? initialData.initialTab : "help";
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
    if (agentSelect) {
      agentSelect.addEventListener("change", function() {
        pendingAgentValue = agentSelect ? String(agentSelect.value || "") : "";
        emitWebviewDebug("taskAgentChanged", { value: pendingAgentValue });
      });
    }
    if (modelSelect) {
      modelSelect.addEventListener("change", function() {
        pendingModelValue = modelSelect ? String(modelSelect.value || "") : "";
        emitWebviewDebug("taskModelChanged", { value: pendingModelValue });
      });
    }
    if (templateSelect) {
      templateSelect.addEventListener("change", function() {
        pendingTemplatePath = templateSelect ? templateSelect.value : "";
      });
    }
    var oneTimeToggle = document.getElementById("one-time");
    if (oneTimeToggle) {
      oneTimeToggle.addEventListener("change", function() {
        syncRecurringChatSessionUi();
      });
    }
    Array.prototype.forEach.call(document.querySelectorAll(".tab-button[data-tab]"), function(button) {
      button.addEventListener("click", function(e) {
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
      taskFilterBar.addEventListener("click", function(e) {
        var target = e && e.target;
        var filterButton = target;
        while (filterButton && filterButton !== taskFilterBar) {
          if (filterButton.getAttribute && filterButton.getAttribute("data-filter")) {
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
      taskLabelFilter.addEventListener("change", function() {
        activeLabelFilter = taskLabelFilter.value || "";
        persistTaskFilter();
        renderTaskList(tasks);
      });
    }
    document.addEventListener("change", function(e) {
      var target = e.target;
      if (target && target.name === "prompt-source" && target.checked) {
        applyPromptSource(target.value);
      }
    });
    if (cronPreset && cronExpression) {
      cronPreset.addEventListener("change", function() {
        if (cronPreset.value) {
          cronExpression.value = cronPreset.value;
        }
        updateCronPreview();
      });
      cronExpression.addEventListener("input", function() {
        cronPreset.value = "";
        updateCronPreview();
      });
    }
    if (jobsCronPreset && jobsCronInput) {
      jobsCronPreset.addEventListener("change", function() {
        if (jobsCronPreset.value) {
          jobsCronInput.value = jobsCronPreset.value;
        }
        updateJobsCronPreview();
        syncEditorTabLabels();
      });
      jobsCronInput.addEventListener("input", function() {
        jobsCronPreset.value = "";
        updateJobsCronPreview();
        syncEditorTabLabels();
      });
    }
    if (friendlyFrequency) {
      friendlyFrequency.addEventListener("change", function() {
        updateFriendlyVisibility();
      });
    }
    if (jobsFriendlyFrequency) {
      jobsFriendlyFrequency.addEventListener("change", function() {
        updateJobsFriendlyVisibility();
        syncEditorTabLabels();
      });
    }
    [telegramEnabledInput, telegramBotTokenInput, telegramChatIdInput, telegramMessagePrefixInput].forEach(function(element) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("input", clearTelegramFeedback);
      element.addEventListener("change", clearTelegramFeedback);
    });
    if (telegramSaveBtn) {
      telegramSaveBtn.addEventListener("click", function() {
        submitTelegramForm("saveTelegramNotification");
      });
    }
    if (telegramTestBtn) {
      telegramTestBtn.addEventListener("click", function() {
        submitTelegramForm("testTelegramNotification");
      });
    }
    if (executionDefaultsSaveBtn) {
      executionDefaultsSaveBtn.addEventListener("click", function() {
        vscode.postMessage({
          type: "saveExecutionDefaults",
          data: collectExecutionDefaultsFormData()
        });
      });
    }
    if (settingsLogLevelSelect) {
      settingsLogLevelSelect.addEventListener("change", function() {
        currentLogLevel = settingsLogLevelSelect.value || "info";
        debugTools.setLogLevel(currentLogLevel);
        renderLoggingControls();
        vscode.postMessage({
          type: "setLogLevel",
          logLevel: currentLogLevel
        });
      });
    }
    if (settingsOpenLogFolderBtn) {
      settingsOpenLogFolderBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "openLogFolder" });
      });
    }
    document.addEventListener("change", function(e) {
      var target = e && e.target;
      if (target && target.id === "friendly-frequency") {
        updateFriendlyVisibility();
      }
      if (target && target.id === "jobs-friendly-frequency") {
        updateJobsFriendlyVisibility();
      }
    });
    document.addEventListener("input", function(e) {
      var target = e && e.target;
      if (target && target.id === "friendly-frequency") {
        updateFriendlyVisibility();
      }
      if (target && target.id === "jobs-friendly-frequency") {
        updateJobsFriendlyVisibility();
      }
    });
    if (friendlyGenerate) {
      friendlyGenerate.addEventListener("click", function() {
        generateCronFromFriendly();
      });
    }
    if (jobsFriendlyGenerate) {
      jobsFriendlyGenerate.addEventListener("click", function() {
        generateJobsCronFromFriendly();
        syncEditorTabLabels();
      });
    }
    if (openGuruBtn) {
      openGuruBtn.addEventListener("click", function() {
        var expression = cronExpression ? cronExpression.value.trim() : "";
        if (!expression) {
          expression = "* * * * *";
        }
        var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
        window.open(targetUrl, "_blank");
      });
    }
    if (jobsOpenGuruBtn) {
      jobsOpenGuruBtn.addEventListener("click", function() {
        var expression = jobsCronInput ? jobsCronInput.value.trim() : "";
        if (!expression) {
          expression = "* * * * *";
        }
        var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
        window.open(targetUrl, "_blank");
      });
    }
    document.addEventListener("change", function(e) {
      var target = e.target;
      if (!target) return;
      if (target.classList.contains("task-agent-select")) {
        var taskId = target.getAttribute("data-id");
        var value = target.value;
        vscode.postMessage({
          type: "updateTask",
          taskId,
          data: { agent: value }
        });
      } else if (target.classList.contains("task-model-select")) {
        var taskId = target.getAttribute("data-id");
        var value = target.value;
        vscode.postMessage({
          type: "updateTask",
          taskId,
          data: { model: value }
        });
      }
    });
    if (templateSelect) {
      templateSelect.addEventListener("change", function() {
        var selectedPath = templateSelect.value;
        if (selectedPath) {
          var sourceEl = document.querySelector(
            'input[name="prompt-source"]:checked'
          );
          var source = sourceEl ? sourceEl.value : "inline";
          vscode.postMessage({
            type: "loadPromptTemplate",
            path: selectedPath,
            source
          });
        }
      });
    }
    if (taskForm) {
      taskForm.addEventListener("submit", function(e) {
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
          'input[name="prompt-source"]:checked'
        );
        var runFirstEl = document.getElementById("run-first");
        var oneTimeEl = document.getElementById("one-time");
        var promptSourceValue = promptSourceEl ? promptSourceEl.value : "inline";
        var agentValue = agentSelect ? agentSelect.value : "";
        if (!agentValue && pendingAgentValue) {
          agentValue = pendingAgentValue;
        }
        var modelValue = modelSelect ? modelSelect.value : "";
        if (!modelValue && pendingModelValue) {
          modelValue = pendingModelValue;
        }
        var promptPathValue = templateSelect ? templateSelect.value : "";
        if (promptSourceValue !== "inline" && editingTaskId && !promptPathValue && pendingTemplatePath) {
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
          jitterSeconds: jitterSecondsInput ? Number(jitterSecondsInput.value || 0) : 0,
          enabled: editingTaskId ? editingTaskEnabled : true
        };
        if (!taskData.oneTime) {
          taskData.chatSession = chatSessionSelect && chatSessionSelect.value === "continue" ? "continue" : "new";
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
            formErr.textContent = strings.cronExpressionRequired || strings.invalidCronExpression || "";
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
            data: taskData
          });
        } else {
          vscode.postMessage({
            type: "createTask",
            data: taskData
          });
        }
      });
    }
    if (testBtn) {
      testBtn.addEventListener("click", function() {
        var promptTextEl = document.getElementById("prompt-text");
        var prompt = promptTextEl ? promptTextEl.value : "";
        var agent = agentSelect ? agentSelect.value : "";
        var model = modelSelect ? modelSelect.value : "";
        if (prompt) {
          vscode.postMessage({
            type: "testPrompt",
            prompt,
            agent,
            model
          });
        }
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "refreshTasks" });
        vscode.postMessage({ type: "refreshAgents" });
        vscode.postMessage({ type: "refreshPrompts" });
      });
    }
    if (autoShowStartupBtn) {
      autoShowStartupBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "toggleAutoShowOnStartup" });
      });
    }
    if (restoreHistoryBtn) {
      restoreHistoryBtn.addEventListener("click", function() {
        var snapshotId = scheduleHistorySelect ? scheduleHistorySelect.value : "";
        if (!snapshotId) {
          window.alert(
            strings.scheduleHistoryRestoreSelectRequired || "Select a backup version first"
          );
          return;
        }
        var selectedEntry = (Array.isArray(scheduleHistory) ? scheduleHistory : []).find(
          function(entry) {
            return entry && entry.id === snapshotId;
          }
        );
        var selectedLabel = formatHistoryLabel(selectedEntry);
        var confirmText = (strings.scheduleHistoryRestoreConfirm || "Restore the repo schedule from {createdAt}? The current state will be backed up first.").replace("{createdAt}", selectedLabel).replace("{timestamp}", selectedLabel);
        if (!window.confirm(confirmText)) {
          return;
        }
        vscode.postMessage({
          type: "restoreScheduleHistory",
          snapshotId
        });
      });
    }
    if (researchNewBtn) {
      researchNewBtn.addEventListener("click", function() {
        isCreatingResearchProfile = true;
        selectedResearchId = "";
        resetResearchForm(null);
        renderResearchTab();
      });
    }
    if (researchSaveBtn) {
      researchSaveBtn.addEventListener("click", function() {
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
            data
          });
        } else {
          vscode.postMessage({
            type: "createResearchProfile",
            data
          });
        }
      });
    }
    if (researchDuplicateBtn) {
      researchDuplicateBtn.addEventListener("click", function() {
        if (!selectedResearchId) return;
        vscode.postMessage({
          type: "duplicateResearchProfile",
          researchId: selectedResearchId
        });
      });
    }
    if (researchDeleteBtn) {
      researchDeleteBtn.addEventListener("click", function() {
        if (!selectedResearchId) return;
        vscode.postMessage({
          type: "deleteResearchProfile",
          researchId: selectedResearchId
        });
      });
    }
    if (researchStartBtn) {
      researchStartBtn.addEventListener("click", function() {
        if (!selectedResearchId) return;
        vscode.postMessage({
          type: "startResearchRun",
          researchId: selectedResearchId
        });
      });
    }
    if (researchStopBtn) {
      researchStopBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "stopResearchRun" });
      });
    }
    if (researchProfileList) {
      researchProfileList.addEventListener("click", function(e) {
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
      researchRunList.addEventListener("click", function(e) {
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
      jobsNewFolderBtn.addEventListener("click", function() {
        vscode.postMessage({
          type: "requestCreateJobFolder",
          parentFolderId: selectedJobFolderId || void 0
        });
      });
    }
    if (jobsRenameFolderBtn) {
      jobsRenameFolderBtn.addEventListener("click", function() {
        if (!selectedJobFolderId) return;
        vscode.postMessage({
          type: "requestRenameJobFolder",
          folderId: selectedJobFolderId
        });
      });
    }
    if (jobsDeleteFolderBtn) {
      jobsDeleteFolderBtn.addEventListener("click", function() {
        if (!selectedJobFolderId) return;
        vscode.postMessage({ type: "requestDeleteJobFolder", folderId: selectedJobFolderId });
      });
    }
    if (jobsNewJobBtn) {
      jobsNewJobBtn.addEventListener("click", function() {
        isCreatingJob = true;
        syncEditorTabLabels();
        vscode.postMessage({
          type: "requestCreateJob",
          folderId: selectedJobFolderId || void 0
        });
        switchTab("jobs-edit");
      });
    }
    var jobsEmptyNewBtn = document.getElementById("jobs-empty-new-btn");
    if (jobsEmptyNewBtn) {
      jobsEmptyNewBtn.addEventListener("click", function() {
        isCreatingJob = true;
        syncEditorTabLabels();
        vscode.postMessage({
          type: "requestCreateJob",
          folderId: selectedJobFolderId || void 0
        });
      });
    }
    if (jobsBackBtn) {
      jobsBackBtn.addEventListener("click", function() {
        switchTab("jobs");
      });
    }
    if (jobsOpenEditorBtn) {
      jobsOpenEditorBtn.addEventListener("click", function() {
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
      jobsDuplicateBtn.addEventListener("click", function() {
        if (!selectedJobId) return;
        vscode.postMessage({ type: "duplicateJob", jobId: selectedJobId });
      });
    }
    if (jobsPauseBtn) {
      jobsPauseBtn.addEventListener("click", function() {
        if (!selectedJobId) return;
        vscode.postMessage({ type: "toggleJobPaused", jobId: selectedJobId });
      });
    }
    if (jobsCompileBtn) {
      jobsCompileBtn.addEventListener("click", function() {
        if (!selectedJobId) return;
        vscode.postMessage({ type: "compileJob", jobId: selectedJobId });
      });
    }
    if (jobsStatusPill) {
      jobsStatusPill.addEventListener("click", function() {
        if (!selectedJobId) return;
        vscode.postMessage({ type: "toggleJobPaused", jobId: selectedJobId });
      });
    }
    if (jobsToggleSidebarBtn) {
      jobsToggleSidebarBtn.addEventListener("click", function() {
        jobsSidebarHidden = !jobsSidebarHidden;
        applyJobsSidebarState();
        persistTaskFilter();
      });
    }
    if (jobsShowSidebarBtn) {
      jobsShowSidebarBtn.addEventListener("click", function() {
        jobsSidebarHidden = false;
        applyJobsSidebarState();
        persistTaskFilter();
      });
    }
    if (jobsDeleteBtn) {
      jobsDeleteBtn.addEventListener("click", function() {
        if (!selectedJobId) return;
        vscode.postMessage({ type: "deleteJob", jobId: selectedJobId });
      });
    }
    if (jobsAttachBtn) {
      jobsAttachBtn.addEventListener("click", function() {
        if (!selectedJobId || !jobsExistingTaskSelect || !jobsExistingTaskSelect.value) return;
        vscode.postMessage({
          type: "attachTaskToJob",
          jobId: selectedJobId,
          taskId: jobsExistingTaskSelect.value,
          windowMinutes: jobsExistingWindowInput ? Number(jobsExistingWindowInput.value || 30) : 30
        });
      });
    }
    if (jobsCreateStepBtn) {
      jobsCreateStepBtn.addEventListener("click", function() {
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
            name,
            prompt,
            cronExpression: selectedJob && selectedJob.cronExpression ? selectedJob.cronExpression : "0 9 * * 1-5",
            agent: jobsStepAgentSelect ? jobsStepAgentSelect.value : "",
            model: jobsStepModelSelect ? jobsStepModelSelect.value : "",
            labels: parseLabels(jobsStepLabelsInput ? jobsStepLabelsInput.value : ""),
            scope: "workspace",
            promptSource: "inline",
            oneTime: false
          }
        });
        if (jobsStepNameInput) jobsStepNameInput.value = "";
        if (jobsStepPromptInput) jobsStepPromptInput.value = "";
        if (jobsStepLabelsInput) jobsStepLabelsInput.value = "";
        if (jobsStepWindowInput) jobsStepWindowInput.value = "30";
      });
    }
    if (jobsCreatePauseBtn) {
      jobsCreatePauseBtn.addEventListener("click", function() {
        if (!selectedJobId) return;
        var title = jobsPauseNameInput ? jobsPauseNameInput.value.trim() : "";
        vscode.postMessage({
          type: "createJobPause",
          jobId: selectedJobId,
          data: {
            title: title || strings.jobsPauseDefaultTitle || "Manual review"
          }
        });
        if (jobsPauseNameInput) {
          jobsPauseNameInput.value = "";
        }
      });
    }
    document.addEventListener("click", function(e) {
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
    document.addEventListener("change", function(e) {
      var target = e && e.target;
      if (!target) return;
      if (target.classList && target.classList.contains("job-node-window-input")) {
        if (!selectedJobId) return;
        var nodeId = target.getAttribute("data-job-node-window-id") || "";
        if (!nodeId) return;
        vscode.postMessage({
          type: "updateJobNodeWindow",
          jobId: selectedJobId,
          nodeId,
          windowMinutes: Number(target.value || 30)
        });
      }
    });
    document.addEventListener("dragstart", function(e) {
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
    document.addEventListener("dragend", function(e) {
      var target = e && e.target;
      var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
      if (jobItem && jobItem.classList) jobItem.classList.remove("dragging");
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      if (card && card.classList) card.classList.remove("dragging");
      draggedJobId = "";
      draggedJobNodeId = "";
      Array.prototype.forEach.call(document.querySelectorAll(".jobs-step-card.drag-over"), function(item) {
        if (item && item.classList) item.classList.remove("drag-over");
      });
      Array.prototype.forEach.call(document.querySelectorAll(".jobs-folder-item.drag-over"), function(item) {
        if (item && item.classList) item.classList.remove("drag-over");
      });
    });
    document.addEventListener("dragover", function(e) {
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
    document.addEventListener("dragleave", function(e) {
      var target = e && e.target;
      var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
      if (folderItem && folderItem.classList) folderItem.classList.remove("drag-over");
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      if (card && card.classList) card.classList.remove("drag-over");
    });
    document.addEventListener("drop", function(e) {
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
            folderId: droppedFolderId || void 0
          }
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
      var targetIndex = selectedJob.nodes.findIndex(function(node) {
        return node && node.id === targetNodeId;
      });
      if (targetIndex < 0 || draggedJobNodeId === targetNodeId) return;
      vscode.postMessage({
        type: "reorderJobNode",
        jobId: selectedJobId,
        nodeId: draggedJobNodeId,
        targetIndex
      });
    });
    if (templateRefreshBtn) {
      templateRefreshBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "refreshPrompts" });
        var selectedPath = templateSelect ? templateSelect.value : "";
        var sourceEl = document.querySelector(
          'input[name="prompt-source"]:checked'
        );
        var source = sourceEl ? sourceEl.value : "inline";
        if (selectedPath && (source === "local" || source === "global")) {
          vscode.postMessage({
            type: "loadPromptTemplate",
            path: selectedPath,
            source
          });
        }
      });
    }
    if (insertSkillBtn) {
      insertSkillBtn.addEventListener("click", function() {
        insertSelectedSkillReference();
      });
    }
    if (setupMcpBtn) {
      setupMcpBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "setupMcp" });
      });
    }
    if (syncBundledSkillsBtn) {
      syncBundledSkillsBtn.addEventListener("click", function() {
        vscode.postMessage({ type: "syncBundledSkills" });
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
        language: nextValue
      });
    }
    syncLanguageSelectors(
      typeof initialData.languageSetting === "string" && initialData.languageSetting ? initialData.languageSetting : "auto"
    );
    if (helpLanguageSelect) {
      helpLanguageSelect.addEventListener("change", function() {
        saveLanguageSelection(helpLanguageSelect.value);
      });
    }
    if (settingsLanguageSelect) {
      settingsLanguageSelect.addEventListener("change", function() {
        saveLanguageSelection(settingsLanguageSelect.value);
      });
    }
    var btnIntroTutorial = document.getElementById("btn-intro-tutorial");
    if (btnIntroTutorial) {
      btnIntroTutorial.addEventListener("click", function() {
        vscode.postMessage({ type: "introTutorial" });
      });
    }
    var btnPlanIntegration = document.getElementById("btn-plan-integration");
    if (btnPlanIntegration) {
      btnPlanIntegration.addEventListener("click", function() {
        vscode.postMessage({ type: "planIntegration" });
      });
    }
    if (helpIntroRocket) {
      helpIntroRocket.addEventListener("click", function() {
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
        btn.addEventListener("click", function() {
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
      window.requestAnimationFrame(function() {
        maybePlayInitialHelpWarp("help");
      });
    }
    function resolveActionTarget(node) {
      var el = node && node.nodeType === 3 ? node.parentElement : node;
      while (el && el !== document.body) {
        if (el.hasAttribute && el.hasAttribute("data-action") && (el.hasAttribute("data-id") || el.hasAttribute("data-task-id") || el.hasAttribute("data-job-id") || el.hasAttribute("data-profile-id"))) {
          return el;
        }
        el = el.parentElement;
      }
      return null;
    }
    document.addEventListener("click", function(e) {
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
        delete: window.deleteTask
      };
      var handler = actionHandlers[action];
      if (typeof handler === "function") {
        e.preventDefault();
        handler(taskId);
      }
    });
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
        taskItems = taskItems.filter(function(task) {
          return getEffectiveLabels(task).indexOf(activeLabelFilter) !== -1;
        });
      }
      var renderedTasks = "";
      function normalizePath(p) {
        if (!p) return "";
        var s = String(p).replace(/\\/g, "/");
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
        var statusText = enabled ? strings.labelEnabled : strings.labelDisabled;
        var toggleIcon = enabled ? "\u23F8\uFE0F" : "\u25B6\uFE0F";
        var toggleTitle = enabled ? strings.actionDisable : strings.actionEnable;
        var nextRunDate = task.nextRun ? new Date(task.nextRun) : null;
        var nextRunMs = nextRunDate && !isNaN(nextRunDate.getTime()) ? nextRunDate.getTime() : 0;
        var nextRun = nextRunDate && !isNaN(nextRunDate.getTime()) ? nextRunDate.toLocaleString(locale) : strings.labelNever;
        var promptText = typeof task.prompt === "string" ? task.prompt : "";
        var promptPreview = promptText.length > 100 ? promptText.substring(0, 100) + "..." : promptText;
        var lastErrorText = typeof task.lastError === "string" ? task.lastError : "";
        var lastErrorAtDate = task.lastErrorAt ? new Date(task.lastErrorAt) : null;
        var lastErrorAt = lastErrorAtDate && !isNaN(lastErrorAtDate.getTime()) ? lastErrorAtDate.toLocaleString(locale) : "";
        var cronText = escapeHtml(task.cronExpression || "");
        var cronSummary = getCronSummary(task.cronExpression || "");
        var taskName = escapeHtml(task.name || "");
        var scopeValue = task.scope || "workspace";
        var scopeLabel = scopeValue === "global" ? strings.labelScopeGlobal || "" : strings.labelScopeWorkspace || "";
        var wsPath = scopeValue === "workspace" ? task.workspacePath || "" : "";
        var wsName = wsPath ? basename(wsPath) : "";
        var inThisWorkspace = scopeValue === "global" ? true : !!wsPath && (workspacePaths || []).some(function(p) {
          return normalizePath(p) === normalizePath(wsPath);
        });
        var otherWsLabel = strings.labelOtherWorkspaceShort || "";
        var thisWsLabel = strings.labelThisWorkspaceShort || "";
        var scopeInfo = scopeValue === "global" ? "\u{1F310} " + escapeHtml(scopeLabel) : "\u{1F4C1} " + escapeHtml(scopeLabel) + (wsName ? " \u2022 " + escapeHtml(wsName) : "");
        if (scopeValue === "workspace") {
          scopeInfo += " \u2022 " + escapeHtml(inThisWorkspace ? thisWsLabel : otherWsLabel);
        }
        var oneTimeBadgeHtml = task.oneTime === true ? '<span class="task-badge clickable" data-action="toggle" data-id="' + escapeAttr(task.id || "") + '">' + escapeHtml(strings.labelOneTime || "One-time") + "</span>" : "";
        var chatSessionBadgeHtml = task.oneTime === true ? "" : '<span class="task-badge" title="' + escapeAttr(strings.labelChatSession || "Recurring chat session") + '">' + escapeHtml(
          task.chatSession === "continue" ? strings.labelChatSessionBadgeContinue || "Chat: Continue" : strings.labelChatSessionBadgeNew || "Chat: New"
        ) + "</span>";
        var labelBadgesHtml = getEffectiveLabels(task).map(function(label) {
          return '<span class="task-badge label">' + escapeHtml(label) + "</span>";
        }).join("");
        var taskIdEscaped = escapeAttr(task.id || "");
        function createSelect(items, selectedId, cls, placeholder) {
          var options = '<option value="">' + escapeHtml(placeholder) + "</option>";
          if (Array.isArray(items)) {
            items.forEach(function(item) {
              var id = item.id || item.slug;
              var label = cls && cls.indexOf("model") >= 0 ? formatModelLabel(item) : item.name || id;
              var sel = id === selectedId ? " selected" : "";
              options += '<option value="' + escapeAttr(id) + '"' + sel + ">" + escapeHtml(label) + "</option>";
            });
          }
          return '<select class="' + cls + '" data-id="' + taskIdEscaped + '" style="width: auto; max-width: 140px; display: inline-block; padding: 2px 4px; margin-right: 8px; height: 26px; font-size: 11px;">' + options + "</select>";
        }
        var agentSelect2 = createSelect(agents, task.agent, "task-agent-select", strings.placeholderSelectAgent || "Agent");
        var modelSelect2 = createSelect(models, task.model, "task-model-select", strings.placeholderSelectModel || "Model");
        var configRow = '<div class="task-config" style="margin: 4px 0 8px 0; display: flex; align-items: center;">' + agentSelect2 + modelSelect2 + "</div>";
        var actionsHtml = '<button class="btn-secondary btn-icon" data-action="toggle" data-id="' + taskIdEscaped + '" title="' + escapeAttr(toggleTitle) + '">' + toggleIcon + '</button><button class="btn-secondary btn-icon" data-action="run" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionRun) + '">\u{1F680}</button><button class="btn-secondary btn-icon" data-action="edit" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionEdit) + '">\u270F\uFE0F</button><button class="btn-secondary btn-icon" data-action="copy" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionCopyPrompt) + '">\u{1F4CB}</button><button class="btn-secondary btn-icon" data-action="duplicate" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionDuplicate) + '">\u{1F4C4}</button>';
        if (scopeValue === "workspace" && !inThisWorkspace) {
          actionsHtml += '<button class="btn-secondary btn-icon" data-action="move" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionMoveToCurrentWorkspace || "") + '">\u{1F4CC}</button>';
        }
        if (scopeValue === "global" || inThisWorkspace) {
          actionsHtml += '<button class="btn-danger btn-icon" data-action="delete" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionDelete) + '">\u{1F5D1}\uFE0F</button>';
        }
        return '<div class="task-card ' + (enabled ? "" : "disabled") + (scopeValue === "workspace" && !inThisWorkspace ? " other-workspace" : "") + '" data-id="' + taskIdEscaped + '"><div class="task-header"><div class="task-header-main"><span class="task-name clickable" data-action="toggle" data-id="' + taskIdEscaped + '">' + taskName + "</span>" + chatSessionBadgeHtml + oneTimeBadgeHtml + '</div><span class="task-status ' + statusClass + '" data-action="toggle" data-id="' + taskIdEscaped + '">' + escapeHtml(statusText) + '</span></div><div class="task-info"><span>\u23F0 ' + escapeHtml(cronSummary) + "</span><span>" + escapeHtml(strings.labelNextRun) + ': <span class="task-next-run-label">' + escapeHtml(nextRun) + '</span><span class="task-next-run-countdown" data-enabled="' + (enabled ? "true" : "false") + '" data-next-run-ms="' + escapeAttr(nextRunMs > 0 ? String(nextRunMs) : "") + '"></span></span><span>' + scopeInfo + '</span></div><div class="task-info"><span>Cron: ' + cronText + "</span></div>" + (labelBadgesHtml ? '<div class="task-badges">' + labelBadgesHtml + "</div>" : "") + configRow + '<div class="task-prompt">' + escapeHtml(promptPreview) + "</div>" + (lastErrorText ? '<div class="task-prompt" style="color: var(--vscode-errorForeground);">Last error' + (lastErrorAt ? " (" + escapeHtml(lastErrorAt) + ")" : "") + ": " + escapeHtml(lastErrorText) + "</div>" : "") + '<div class="task-actions">' + actionsHtml + "</div></div>";
      }
      function renderTaskSection(title, items) {
        var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
        if (!listHtml) {
          listHtml = '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>";
        }
        return '<div class="task-section"><div class="task-section-title"><span>' + escapeHtml(title) + "</span><span>" + String(items.length) + "</span></div>" + listHtml + "</div>";
      }
      var recurringTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = task.oneTime === true || task.id && task.id.indexOf("exec-") === 0;
        return !isOneTime;
      });
      var oneTimeTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = task.oneTime === true || task.id && task.id.indexOf("exec-") === 0;
        return isOneTime;
      });
      var sectionHtml = "";
      if (activeTaskFilter === "all" || activeTaskFilter === "recurring") {
        sectionHtml += renderTaskSection(
          strings.labelRecurringTasks || "Recurring Tasks",
          recurringTasks
        );
      }
      if (activeTaskFilter === "all" || activeTaskFilter === "one-time") {
        sectionHtml += renderTaskSection(
          strings.labelOneTimeTasks || "One-time Tasks",
          oneTimeTasks
        );
      }
      var containerClass = "task-sections";
      var containerStyle = "";
      if (activeTaskFilter !== "all") {
        containerClass += " filtered";
        containerStyle = ' style="display:grid;grid-template-columns:1fr;"';
      }
      renderedTasks = '<div class="' + containerClass + '"' + containerStyle + ">" + sectionHtml + "</div>";
      if (renderedTasks === lastRenderedTasksHtml) {
        return;
      }
      if (isInlineTaskSelectActive()) {
        return;
      }
      lastRenderedTasksHtml = renderedTasks;
      taskList.innerHTML = renderedTasks;
      refreshTaskCountdowns();
    }
    function escapeHtml(text) {
      if (text == null) return "";
      var div = document.createElement("div");
      div.textContent = String(text);
      return div.innerHTML;
    }
    function escapeAttr(text) {
      if (typeof text !== "string") text = String(text || "");
      return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
      strings.daySat || ""
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
      var normalized = String(value || "").trim().toLowerCase();
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
        sat: 6
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
      var isNumber = function(value) {
        return /^\d+$/.test(String(value));
      };
      var dowLower = String(dow || "").toLowerCase();
      var isWeekdays = dowLower === "1-5" || dowLower === "mon-fri";
      var everyN = /^\*\/(\d+)$/.exec(minute);
      if (everyN && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
        var tplEveryN = strings.cronPreviewEveryNMinutes || "";
        return tplEveryN ? tplEveryN.replace("{n}", String(everyN[1])) : fallback;
      }
      if (isNumber(minute) && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
        var tplHourly = strings.cronPreviewHourlyAtMinute || "";
        return tplHourly ? tplHourly.replace("{m}", String(minute)) : fallback;
      }
      if (isNumber(minute) && isNumber(hour) && dom === "*" && mon === "*" && dow === "*") {
        var tplDaily = strings.cronPreviewDailyAt || "";
        var t = formatTime(hour, minute);
        return tplDaily ? tplDaily.replace("{t}", String(t)) : fallback;
      }
      if (isNumber(minute) && isNumber(hour) && dom === "*" && mon === "*" && isWeekdays) {
        var tplWeekdays = strings.cronPreviewWeekdaysAt || "";
        var t = formatTime(hour, minute);
        return tplWeekdays ? tplWeekdays.replace("{t}", String(t)) : fallback;
      }
      var dowValue = normalizeDow(dow);
      if (isNumber(minute) && isNumber(hour) && dom === "*" && mon === "*" && dowValue !== null) {
        var dayLabel = dayNames[dowValue] || String(dowValue);
        var tplWeekly = strings.cronPreviewWeeklyOnAt || "";
        var t = formatTime(hour, minute);
        return tplWeekly ? tplWeekly.replace("{d}", String(dayLabel)).replace("{t}", String(t)) : fallback;
      }
      if (isNumber(minute) && isNumber(hour) && isNumber(dom) && mon === "*" && dow === "*") {
        var tplMonthly = strings.cronPreviewMonthlyOnAt || "";
        var t = formatTime(hour, minute);
        return tplMonthly ? tplMonthly.replace("{dom}", String(dom)).replace("{t}", String(t)) : fallback;
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
      var friendlyFields = friendlyBuilder ? friendlyBuilder.querySelectorAll(".friendly-field") : [];
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
      var friendlyFields = jobsFriendlyBuilder ? jobsFriendlyBuilder.querySelectorAll(".friendly-field") : [];
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
            5
          );
          expr = "*/" + interval + " * * * *";
          break;
        }
        case "hourly": {
          var minuteValue = boundedNumber(
            friendlyMinute ? friendlyMinute.value : "",
            0,
            59,
            0
          );
          expr = minuteValue + " * * * *";
          break;
        }
        case "daily": {
          var dailyMinute = boundedNumber(
            friendlyMinute ? friendlyMinute.value : "",
            0,
            59,
            0
          );
          var dailyHour = boundedNumber(
            friendlyHour ? friendlyHour.value : "",
            0,
            23,
            9
          );
          expr = dailyMinute + " " + dailyHour + " * * *";
          break;
        }
        case "weekly": {
          var weeklyMinute = boundedNumber(
            friendlyMinute ? friendlyMinute.value : "",
            0,
            59,
            0
          );
          var weeklyHour = boundedNumber(
            friendlyHour ? friendlyHour.value : "",
            0,
            23,
            9
          );
          var dowValue = boundedNumber(
            friendlyDow ? friendlyDow.value : "",
            0,
            6,
            1
          );
          expr = weeklyMinute + " " + weeklyHour + " * * " + dowValue;
          break;
        }
        case "monthly": {
          var monthlyMinute = boundedNumber(
            friendlyMinute ? friendlyMinute.value : "",
            0,
            59,
            0
          );
          var monthlyHour = boundedNumber(
            friendlyHour ? friendlyHour.value : "",
            0,
            23,
            9
          );
          var domValue = boundedNumber(
            friendlyDom ? friendlyDom.value : "",
            1,
            31,
            1
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
            5
          );
          expr = "*/" + interval + " * * * *";
          break;
        }
        case "hourly": {
          var minuteValue = boundedNumber(
            jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
            0,
            59,
            0
          );
          expr = minuteValue + " * * * *";
          break;
        }
        case "daily": {
          var dailyMinute = boundedNumber(
            jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
            0,
            59,
            0
          );
          var dailyHour = boundedNumber(
            jobsFriendlyHour ? jobsFriendlyHour.value : "",
            0,
            23,
            9
          );
          expr = dailyMinute + " " + dailyHour + " * * *";
          break;
        }
        case "weekly": {
          var weeklyMinute = boundedNumber(
            jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
            0,
            59,
            0
          );
          var weeklyHour = boundedNumber(
            jobsFriendlyHour ? jobsFriendlyHour.value : "",
            0,
            23,
            9
          );
          var dowValue = boundedNumber(
            jobsFriendlyDow ? jobsFriendlyDow.value : "",
            0,
            6,
            1
          );
          expr = weeklyMinute + " " + weeklyHour + " * * " + dowValue;
          break;
        }
        case "monthly": {
          var monthlyMinute = boundedNumber(
            jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
            0,
            59,
            0
          );
          var monthlyHour = boundedNumber(
            jobsFriendlyHour ? jobsFriendlyHour.value : "",
            0,
            23,
            9
          );
          var domValue = boundedNumber(
            jobsFriendlyDom ? jobsFriendlyDom.value : "",
            1,
            31,
            1
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
    function updateAgentOptions2() {
      updateAgentOptions({
        agentSelect,
        agents,
        escapeAttr,
        escapeHtml,
        executionDefaults,
        strings
      });
    }
    function updateModelOptions2() {
      updateModelOptions({
        escapeAttr,
        escapeHtml,
        executionDefaults,
        formatModelLabel,
        modelSelect,
        models,
        strings
      });
    }
    function updateTemplateOptions(source, selectedPath) {
      if (!templateSelect) return;
      selectedPath = selectedPath || "";
      var templates = Array.isArray(promptTemplates) ? promptTemplates : [];
      var filtered = templates.filter(function(t) {
        return t.source === source;
      });
      var selectText = strings.placeholderSelectTemplate || "";
      var placeholder = '<option value="">' + escapeHtml(selectText) + "</option>";
      templateSelect.innerHTML = placeholder + filtered.map(function(t) {
        return '<option value="' + escapeAttr(t.path) + '">' + escapeHtml(t.name) + "</option>";
      }).join("");
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
      var selectedPath = keepSelection && templateSelect ? templateSelect.value : "";
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
          "[CopilotScheduler] Template select group missing; template selection is disabled."
        );
      }
      if (promptGroup) promptGroup.style.display = "block";
      updateTemplateOptions(effectiveSource, selectedPath);
    }
    function updateSkillOptions() {
      if (!skillSelect) return;
      var items = Array.isArray(skills) ? skills : [];
      var placeholder = strings.placeholderSelectSkill || "Select a skill";
      skillSelect.innerHTML = '<option value="">' + escapeHtml(placeholder) + "</option>" + items.map(function(skill) {
        return '<option value="' + escapeAttr(skill.path || "") + '">' + escapeHtml(skill.reference || skill.name || "") + "</option>";
      }).join("");
    }
    function insertSelectedSkillReference() {
      if (!skillSelect || !promptGroup) return;
      var selectedPath = skillSelect.value || "";
      if (!selectedPath) return;
      var selectedSkill = (Array.isArray(skills) ? skills : []).find(function(skill) {
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
      promptTextEl.value = current.trim() ? current.replace(/\s*$/, "\n\n") + sentence : sentence;
      if (typeof promptTextEl.focus === "function") {
        promptTextEl.focus();
      }
    }
    function updateSimpleSelect(selectEl, items, placeholder, selectedValue, getValue, getLabel) {
      if (!selectEl) return;
      var optionItems = Array.isArray(items) ? items : [];
      var html = '<option value="">' + escapeHtml(placeholder || "") + "</option>" + optionItems.map(function(item) {
        var value = getValue(item);
        var label = getLabel(item);
        return '<option value="' + escapeAttr(value) + '">' + escapeHtml(label) + "</option>";
      }).join("");
      selectEl.innerHTML = html;
      selectEl.value = selectedValue || "";
      if (selectEl.value !== (selectedValue || "")) {
        selectEl.value = "";
      }
    }
    function syncJobsFolderSelect(selectedValue) {
      updateSimpleSelect(
        jobsFolderSelect,
        Array.isArray(jobFolders) ? jobFolders.slice().sort(function(a, b) {
          return String(a && a.name || "").localeCompare(String(b && b.name || ""));
        }) : [],
        strings.jobsRootFolder || "All jobs",
        selectedValue || "",
        function(folder) {
          return folder && folder.id ? folder.id : "";
        },
        function(folder) {
          var depth = getFolderDepth(folder);
          var prefix = new Array(depth + 1).join("  ");
          return prefix + (folder && folder.name ? folder.name : "");
        }
      );
    }
    function syncJobsStepSelectors() {
      updateSimpleSelect(
        jobsStepAgentSelect,
        agents,
        strings.placeholderSelectAgent || "Select agent",
        jobsStepAgentSelect ? jobsStepAgentSelect.value : "",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
      updateSimpleSelect(
        jobsStepModelSelect,
        models,
        strings.placeholderSelectModel || "Select model",
        jobsStepModelSelect ? jobsStepModelSelect.value : "",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
    }
    function syncJobsExistingTaskSelect() {
      var standaloneTasks = getStandaloneTasks();
      updateSimpleSelect(
        jobsExistingTaskSelect,
        standaloneTasks,
        strings.jobsNoStandaloneTasks || "No standalone tasks available",
        jobsExistingTaskSelect ? jobsExistingTaskSelect.value : "",
        function(task) {
          return task && task.id ? task.id : "";
        },
        function(task) {
          if (!task || !task.name) {
            return "";
          }
          if (!task.jobId) {
            return task.name;
          }
          var job = getJobById(task.jobId);
          return job && job.name ? task.name + " \xB7 " + job.name : task.name;
        }
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
      var hasSelected = profiles.some(function(profile) {
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
      var totalSeconds = Math.max(0, Math.floor((end - start) / 1e3));
      return formatCountdown(totalSeconds);
    }
    function formatOutcomeLabel(outcome) {
      return String(outcome || "").replace(/-/g, " ");
    }
    function getResearchRunById(runId) {
      return (Array.isArray(recentResearchRuns) ? recentResearchRuns : []).find(function(run) {
        return run && run.id === runId;
      });
    }
    function ensureValidResearchRunSelection() {
      var runs = Array.isArray(recentResearchRuns) ? recentResearchRuns : [];
      var activeId = activeResearchRun && activeResearchRun.id ? activeResearchRun.id : "";
      var hasSelected = runs.some(function(run) {
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
      return String(raw || "").split(/\r?\n/).map(function(line) {
        return String(line || "").trim();
      }).filter(function(line) {
        return line.length > 0;
      });
    }
    function getSelectedResearchProfile() {
      return (Array.isArray(researchProfiles) ? researchProfiles : []).find(function(profile) {
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
        researchEditablePathsInput.value = value && Array.isArray(value.editablePaths) ? value.editablePaths.join("\n") : "";
      }
      if (researchBenchmarkInput) {
        researchBenchmarkInput.value = value && value.benchmarkCommand ? value.benchmarkCommand : "";
      }
      if (researchMetricPatternInput) {
        researchMetricPatternInput.value = value && value.metricPattern ? value.metricPattern : "";
      }
      if (researchMetricDirectionSelect) {
        researchMetricDirectionSelect.value = value && value.metricDirection === "minimize" ? "minimize" : "maximize";
      }
      if (researchMaxIterationsInput) {
        researchMaxIterationsInput.value = String(value && value.maxIterations !== void 0 ? value.maxIterations : 3);
      }
      if (researchMaxMinutesInput) {
        researchMaxMinutesInput.value = String(value && value.maxMinutes !== void 0 ? value.maxMinutes : 15);
      }
      if (researchMaxFailuresInput) {
        researchMaxFailuresInput.value = String(value && value.maxConsecutiveFailures !== void 0 ? value.maxConsecutiveFailures : 2);
      }
      if (researchBenchmarkTimeoutInput) {
        researchBenchmarkTimeoutInput.value = String(value && value.benchmarkTimeoutSeconds !== void 0 ? value.benchmarkTimeoutSeconds : 180);
      }
      if (researchEditWaitInput) {
        researchEditWaitInput.value = String(value && value.editWaitSeconds !== void 0 ? value.editWaitSeconds : 20);
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
          researchEditablePathsInput ? researchEditablePathsInput.value : ""
        ),
        benchmarkCommand: researchBenchmarkInput ? researchBenchmarkInput.value : "",
        metricPattern: researchMetricPatternInput ? researchMetricPatternInput.value : "",
        metricDirection: researchMetricDirectionSelect && researchMetricDirectionSelect.value === "minimize" ? "minimize" : "maximize",
        maxIterations: researchMaxIterationsInput ? Number(researchMaxIterationsInput.value || 0) : 0,
        maxMinutes: researchMaxMinutesInput ? Number(researchMaxMinutesInput.value || 0) : 0,
        maxConsecutiveFailures: researchMaxFailuresInput ? Number(researchMaxFailuresInput.value || 0) : 0,
        benchmarkTimeoutSeconds: researchBenchmarkTimeoutInput ? Number(researchBenchmarkTimeoutInput.value || 0) : 0,
        editWaitSeconds: researchEditWaitInput ? Number(researchEditWaitInput.value || 0) : 0,
        agent: researchAgentSelect ? researchAgentSelect.value : "",
        model: researchModelSelect ? researchModelSelect.value : ""
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
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
      updateSimpleSelect(
        researchModelSelect,
        models,
        strings.placeholderSelectModel || "Select model",
        researchModelSelect ? researchModelSelect.value : "",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
    }
    function renderResearchProfiles() {
      ensureValidResearchSelection();
      if (!researchProfileList) {
        return;
      }
      var profiles = Array.isArray(researchProfiles) ? researchProfiles.slice() : [];
      profiles.sort(function(a, b) {
        return String(a && a.name || "").localeCompare(String(b && b.name || ""));
      });
      if (profiles.length === 0) {
        researchProfileList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.researchEmptyProfiles || "No research profiles yet.") + "</div>";
        resetResearchForm(null);
        return;
      }
      researchProfileList.innerHTML = profiles.map(function(profile) {
        var isActive = profile && profile.id === selectedResearchId;
        return '<div class="research-card' + (isActive ? " active" : "") + '" data-research-id="' + escapeAttr(profile.id || "") + '"><div class="research-card-header"><strong>' + escapeHtml(profile.name || "") + '</strong><span class="jobs-pill">' + escapeHtml(profile.metricDirection === "minimize" ? strings.researchDirectionMinimize || "Minimize" : strings.researchDirectionMaximize || "Maximize") + '</span></div><div class="research-meta">' + escapeHtml(profile.benchmarkCommand || "") + '</div><div class="research-chip-row"><span class="research-chip">' + escapeHtml((strings.researchEditableCount || "Editable files") + ": " + String((profile.editablePaths || []).length)) + '</span><span class="research-chip">' + escapeHtml((strings.researchBudgetShort || "Budget") + ": " + String(profile.maxIterations || 0) + " / " + String(profile.maxMinutes || 0) + "m") + '</span><span class="research-chip">' + escapeHtml((strings.researchMetricPatternShort || "Metric") + ": " + String(profile.metricPattern || "")) + "</span></div></div>";
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
      researchRunList.innerHTML = runs.map(function(run) {
        var lastAttempt = Array.isArray(run.attempts) && run.attempts.length > 0 ? run.attempts[run.attempts.length - 1] : null;
        var isActive = run && run.id === selectedResearchRunId;
        return '<div class="research-run-card' + (isActive ? " active" : "") + '" data-run-id="' + escapeAttr(run.id || "") + '"><div class="research-run-card-header"><strong>' + escapeHtml(run.profileName || "") + '</strong><span class="jobs-pill">' + escapeHtml(formatResearchStatus(run.status)) + '</span></div><div class="research-run-meta">' + escapeHtml("Best: " + (run.bestScore !== void 0 ? String(run.bestScore) : strings.researchNoScore || "No score yet")) + "\n" + escapeHtml("Duration: " + formatResearchDuration(run.startedAt, run.finishedAt)) + "\n" + escapeHtml("Attempts: " + String(Array.isArray(run.attempts) ? run.attempts.length : 0)) + (lastAttempt ? "\n" + escapeHtml("Last: " + (lastAttempt.summary || lastAttempt.outcome || "")) : "") + "</div></div>";
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
        researchActiveBest.textContent = run.bestScore !== void 0 ? String(run.bestScore) : strings.researchNoScore || "No score yet";
      }
      if (researchActiveAttempts) {
        researchActiveAttempts.textContent = String(attempts.length);
      }
      if (researchActiveLastOutcome) {
        researchActiveLastOutcome.textContent = lastAttempt ? String(lastAttempt.outcome || "-") : "-";
      }
      if (researchActiveMeta) {
        researchActiveMeta.textContent = [
          run.profileName || "",
          (strings.researchStartedAt || "Started") + ": " + formatResearchDate(run.startedAt),
          (strings.researchFinishedAt || "Finished") + ": " + formatResearchDate(run.finishedAt),
          (strings.researchDuration || "Duration") + ": " + formatResearchDuration(run.startedAt, run.finishedAt),
          (strings.researchBaselineScore || "Baseline score") + ": " + (run.baselineScore !== void 0 ? String(run.baselineScore) : strings.researchNoScore || "No score yet"),
          (strings.researchBestScore || "Best score") + ": " + (run.bestScore !== void 0 ? String(run.bestScore) : strings.researchNoScore || "No score yet"),
          (strings.researchCompletedIterations || "Completed iterations") + ": " + String(run.completedIterations || 0),
          run.stopReason ? (strings.researchStopReason || "Stop reason") + ": " + run.stopReason : ""
        ].filter(Boolean).join("\n");
      }
      if (researchAttemptList) {
        researchAttemptList.innerHTML = attempts.map(function(attempt) {
          var title = attempt.iteration === 0 ? strings.researchBaselineLabel || "Baseline" : (strings.researchIterationLabel || "Iteration") + " " + attempt.iteration;
          var metaLines = [
            attempt.summary || "",
            (strings.researchStartedAt || "Started") + ": " + formatResearchDate(attempt.startedAt),
            attempt.finishedAt ? (strings.researchFinishedAt || "Finished") + ": " + formatResearchDate(attempt.finishedAt) : "",
            attempt.score !== void 0 ? "Score: " + String(attempt.score) : "",
            attempt.bestScoreAfter !== void 0 ? (strings.researchBestScore || "Best score") + ": " + String(attempt.bestScoreAfter) : "",
            attempt.exitCode !== void 0 ? (strings.researchExitCode || "Exit code") + ": " + String(attempt.exitCode) : ""
          ].filter(Boolean);
          var pathLines = [];
          if (Array.isArray(attempt.changedPaths) && attempt.changedPaths.length > 0) {
            pathLines.push(
              (strings.researchChangedFiles || "Changed files") + ": " + attempt.changedPaths.join(", ")
            );
          }
          if (Array.isArray(attempt.policyViolationPaths) && attempt.policyViolationPaths.length > 0) {
            pathLines.push(
              (strings.researchViolationFiles || "Policy violation files") + ": " + attempt.policyViolationPaths.join(", ")
            );
          }
          if (attempt.snapshot && attempt.snapshot.label) {
            pathLines.push(
              (strings.researchSnapshot || "Snapshot") + ": " + attempt.snapshot.label
            );
          }
          return '<div class="research-attempt-card"><div class="research-attempt-card-header"><strong>' + escapeHtml(title) + '</strong><span class="jobs-pill">' + escapeHtml(formatOutcomeLabel(attempt.outcome || "")) + '</span></div><div class="research-attempt-meta">' + escapeHtml(metaLines.join("\n")) + "</div>" + (pathLines.length > 0 ? '<div class="research-attempt-paths">' + escapeHtml(pathLines.join("\n")) + "</div>" : "") + (attempt.output ? '<div class="research-output"><details><summary>' + escapeHtml(strings.researchBenchmarkOutput || "Benchmark output") + "</summary><pre>" + escapeHtml(attempt.output) + "</pre></details></div>" : "") + "</div>";
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
        researchSaveBtn.textContent = isCreatingResearchProfile ? strings.researchCreateProfile || strings.researchSaveProfile || "Create Profile" : strings.researchSaveProfile || "Save Profile";
      }
      if (researchDuplicateBtn) {
        researchDuplicateBtn.disabled = !selectedResearchId;
      }
      if (researchDeleteBtn) {
        researchDeleteBtn.disabled = !selectedResearchId;
      }
      if (researchStartBtn) {
        researchStartBtn.disabled = !selectedResearchId || activeResearchRun && activeResearchRun.status === "running";
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
      vscode.postMessage({ type: messageType, data });
      showTelegramFeedback(
        messageType === "saveTelegramNotification" ? strings.telegramStatusSaved || "Saving Telegram settings..." : strings.telegramTest || "Sending test message...",
        false
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
        researchModelSelect
      ].forEach(function(element) {
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
      ["input", "change"].forEach(function(eventName) {
        document.addEventListener(eventName, function(event) {
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
        var currentFolderName = selectedJobFolderId ? (selectedFolder || {}).name || (strings.jobsRootFolder || "All jobs") : strings.jobsRootFolder || "All jobs";
        jobsCurrentFolderBanner.innerHTML = '<div><span class="jobs-current-folder-label">' + escapeHtml(strings.jobsCurrentFolderLabel || "Current folder") + '</span><strong class="jobs-current-folder-name">' + escapeHtml(isArchive ? strings.jobsArchiveFolderBadge || currentFolderName : currentFolderName) + '</strong><div class="jobs-folder-path">' + escapeHtml(getFolderPath(selectedJobFolderId)) + '</div></div><span class="jobs-pill' + (isArchive ? " is-inactive" : "") + '">' + escapeHtml(strings.jobsCurrentFolderBadge || "Current") + "</span>";
      }
      if (jobsRenameFolderBtn) jobsRenameFolderBtn.disabled = !selectedJobFolderId;
      if (jobsDeleteFolderBtn) jobsDeleteFolderBtn.disabled = !selectedJobFolderId;
      if (jobsFolderList) {
        var folderItems = (Array.isArray(jobFolders) ? jobFolders.slice() : []).sort(function(a, b) {
          var archiveDiff = (isArchiveFolder(a) ? 1 : 0) - (isArchiveFolder(b) ? 1 : 0);
          if (archiveDiff !== 0) return archiveDiff;
          var depthDiff = getFolderDepth(a) - getFolderDepth(b);
          if (depthDiff !== 0) return depthDiff;
          return String(a && a.name || "").localeCompare(String(b && b.name || ""));
        });
        var rootClass = selectedJobFolderId ? "jobs-folder-item" : "jobs-folder-item active";
        var folderHtml = '<div class="' + rootClass + '" data-job-folder=""><div class="jobs-folder-item-header"><span>' + escapeHtml(strings.jobsRootFolder || "All jobs") + '</span><span class="jobs-pill">' + String((Array.isArray(jobs) ? jobs : []).filter(function(job) {
          return job && !(job.folderId || "");
        }).length) + "</span></div></div>";
        folderHtml += folderItems.map(function(folder) {
          var depth = getFolderDepth(folder);
          var isActive = folder && folder.id === selectedJobFolderId;
          var archiveClass = isArchiveFolder(folder) ? " is-archive" : "";
          var count = (Array.isArray(jobs) ? jobs : []).filter(function(job) {
            return job && job.folderId === folder.id;
          }).length;
          var indent = new Array(depth + 1).join('<span class="jobs-folder-indent"></span>');
          var folderPath = getFolderPath(folder.id);
          return '<div class="jobs-folder-item' + (isActive ? " active" : "") + archiveClass + '" data-job-folder="' + escapeAttr(folder.id || "") + '"><div class="jobs-folder-item-header"><span>' + indent + escapeHtml(folder.name || "") + '</span><span class="jobs-pill">' + String(count) + "</span></div>" + (isArchiveFolder(folder) ? '<div class="jobs-folder-path"><span class="jobs-pill is-inactive">' + escapeHtml(strings.jobsArchiveFolderBadge || "Archived jobs") + "</span></div>" : '<div class="jobs-folder-path">' + escapeHtml(folderPath) + "</div>") + "</div>";
        }).join("");
        jobsFolderList.innerHTML = folderHtml || '<div class="jobs-empty">' + escapeHtml(strings.jobsNoFolders || "No folders yet.") + "</div>";
      }
      if (jobsList) {
        var visibleJobs = getVisibleJobs();
        if (visibleJobs.length === 0) {
          jobsList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.jobsNoJobs || "No jobs in this folder yet.") + "</div>";
        } else {
          jobsList.innerHTML = visibleJobs.map(function(job) {
            var scheduleSummary = getCronSummary(job.cronExpression || "");
            var scheduleLabel = scheduleSummary !== (strings.labelFriendlyFallback || "") ? scheduleSummary : job.cronExpression || "";
            var statusClass = "";
            if (job && job.runtime && job.runtime.waitingPause) {
              statusClass = " is-waiting";
            } else if (job && (job.paused || job.archived)) {
              statusClass = " is-inactive";
            }
            return '<div class="jobs-list-item' + (job.id === selectedJobId ? " active" : "") + '" data-job-id="' + escapeAttr(job.id || "") + '" draggable="true"><div class="jobs-list-item-header"><strong>' + escapeHtml(job.name || "") + '</strong><span class="jobs-pill' + statusClass + '">' + escapeHtml(getJobStatusText(job)) + '</span></div><div class="jobs-list-item-meta-row" title="' + escapeAttr(job.cronExpression || "") + '"><div class="jobs-list-item-meta">' + escapeHtml(scheduleLabel) + " \u2022 " + String(Array.isArray(job.nodes) ? job.nodes.length : 0) + ' items</div><div style="display:flex;align-items:center;gap:8px;">' + (job.archived ? '<span class="jobs-pill is-inactive">' + escapeHtml(strings.jobsArchivedBadge || "Archived") + "</span>" : "") + '<button type="button" class="btn-secondary" data-job-open-editor="' + escapeAttr(job.id || "") + '">' + escapeHtml(strings.jobsOpenEditor || "Open editor") + "</button></div></div></div>";
          }).join("");
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
      var pauseCount = selectedNodes.filter(function(node) {
        return isPauseNode(node);
      }).length;
      var taskCount = Math.max(0, selectedNodes.length - pauseCount);
      var cadenceText = getJobsCadenceText(selectedJob ? selectedJob.cronExpression || "" : "");
      if (jobsWorkflowMetrics) {
        jobsWorkflowMetrics.innerHTML = [
          {
            label: strings.jobsWorkflowStatus || "Status",
            value: selectedJob ? getJobStatusText(selectedJob) : strings.jobsCreateJob || "New Job",
            tone: selectedWaitingPause ? "is-waiting" : selectedJob && (selectedJob.paused || selectedJob.archived) ? "is-muted" : "is-accent"
          },
          {
            label: strings.jobsWorkflowCadence || "Cadence",
            value: selectedJob ? cadenceText : strings.jobsEditorScheduleNote || "Define a schedule before saving.",
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
        ].map(function(metric) {
          return '<div class="jobs-workflow-metric' + (String(metric.value || "").length > 18 ? " is-compact" : "") + (metric.tone ? " " + metric.tone : "") + '" title="' + escapeAttr(metric.value) + '"><div class="jobs-workflow-metric-label">' + escapeHtml(metric.label) + '</div><div class="jobs-workflow-metric-value"' + (metric.valueAttr || "") + ">" + escapeHtml(metric.value) + "</div></div>";
        }).join("");
      }
      if (jobsNameInput) jobsNameInput.value = selectedJob ? selectedJob.name || "" : "";
      if (jobsCronInput) jobsCronInput.value = selectedJob ? selectedJob.cronExpression || "" : "0 9 * * 1-5";
      if (jobsCronPreset) jobsCronPreset.value = "";
      syncJobsFolderSelect(selectedJob ? selectedJob.folderId || "" : selectedJobFolderId || "");
      if (jobsStatusPill) {
        jobsStatusPill.textContent = selectedJob ? getJobStatusText(selectedJob) : strings.jobsRunning || "Running";
        if (jobsStatusPill.classList) {
          jobsStatusPill.classList.toggle("is-inactive", !!(selectedJob && (selectedJob.paused || selectedJob.archived)));
          jobsStatusPill.classList.toggle("is-waiting", !!selectedWaitingPause);
        }
        jobsStatusPill.disabled = !selectedJob;
      }
      if (jobsPauseBtn) {
        jobsPauseBtn.textContent = selectedJob && selectedJob.paused ? strings.jobsResume || "Resume Job" : strings.jobsPause || "Pause Job";
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
        jobsSaveBtn.textContent = selectedJob ? strings.jobsSave || "Save Job" : strings.jobsCreateJob || "New Job";
      }
      if (jobsTimelineInline) {
        var timelineHtml = selectedNodes.map(function(node, index) {
          var taskName = "";
          if (isPauseNode(node)) {
            taskName = (strings.jobsPausePrefix || "Pause") + ": " + (node.title || (strings.jobsPauseDefaultTitle || "Manual review"));
          } else {
            var task = getTaskById(node.taskId);
            taskName = task && task.name ? task.name : (strings.jobsStepPrefix || "Step") + " " + String(index + 1);
          }
          return '<span class="jobs-timeline-node" title="' + escapeAttr(taskName) + '">' + escapeHtml(taskName) + "</span>" + (index < selectedNodes.length - 1 ? '<span class="jobs-timeline-arrow">\u2192</span>' : "");
        }).join("");
        jobsTimelineInline.innerHTML = selectedJob ? timelineHtml || escapeHtml(strings.jobsTimelineEmpty || "No steps yet") : escapeHtml(strings.jobsTimelineEmpty || "No steps yet");
      }
      syncJobsExistingTaskSelect();
      syncJobsStepSelectors();
      updateJobsCronPreview();
      updateJobsFriendlyVisibility();
      if (jobsStepList) {
        if (!selectedJob) {
          jobsStepList.innerHTML = '<div class="jobs-empty">' + escapeHtml(strings.jobsCreateJob || "Create Job") + ": " + escapeHtml(strings.jobsSave || "Save Job") + "</div>";
          return;
        }
        var stepCards = selectedNodes.map(function(node, index) {
          if (isPauseNode(node)) {
            var isWaiting = !!selectedWaitingPause && selectedWaitingPause.nodeId === node.id;
            var isApproved = approvedPauseIds.indexOf(node.id) >= 0;
            var pauseStatusText = isWaiting ? strings.jobsPauseWaiting || "Waiting for approval" : isApproved ? strings.jobsPauseApproved || "Approved" : strings.jobsPauseDefaultTitle || "Manual review";
            return '<div class="jobs-step-card jobs-pause-card' + (isWaiting ? " is-waiting" : "") + '" draggable="true" data-job-node-id="' + escapeAttr(node.id || "") + '"><div class="jobs-step-header"><strong title="' + escapeAttr(node.title || "") + '">' + String(index + 1) + ". " + escapeHtml(node.title || (strings.jobsPauseDefaultTitle || "Manual review")) + '</strong><span class="jobs-pill' + (isWaiting ? " is-waiting" : "") + '">' + escapeHtml(pauseStatusText) + '</span></div><div class="jobs-pause-copy">' + escapeHtml(strings.jobsPauseHelpText || "This checkpoint blocks downstream steps until you approve the previous result.") + '</div><div class="jobs-step-toolbar"><button type="button" class="btn-secondary" data-job-action="edit-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseEdit || "Edit") + '</button><button type="button" class="btn-danger" data-job-action="delete-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseDelete || "Delete") + "</button>" + (isWaiting ? '<button type="button" class="btn-primary" data-job-action="approve-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseApprove || "Approve") + '</button><button type="button" class="btn-secondary" data-job-action="reject-pause" data-job-node-id="' + escapeAttr(node.id || "") + '">' + escapeHtml(strings.jobsPauseReject || "Reject and edit previous step") + "</button>" : "") + "</div></div>";
          }
          var task = getTaskById(node.taskId);
          var taskName = task && task.name ? task.name : "Missing task";
          var taskPrompt = task && task.prompt ? String(task.prompt) : "";
          var preview = taskPrompt.length > 120 ? taskPrompt.slice(0, 120) + "..." : taskPrompt;
          var nextRunText = task && task.nextRun ? new Date(task.nextRun).toLocaleString(locale) : strings.labelNever || "Never";
          return '<div class="jobs-step-card" draggable="true" data-job-node-id="' + escapeAttr(node.id || "") + '"><div class="jobs-step-header"><strong title="' + escapeAttr(taskName) + '">' + String(index + 1) + ". " + escapeHtml(taskName) + '</strong><span class="jobs-pill">' + escapeHtml(String(node.windowMinutes || 30) + "m") + '</span></div><div class="jobs-step-meta">' + escapeHtml(strings.labelNextRun || "Next run") + ": " + escapeHtml(nextRunText) + '</div><div class="jobs-step-summary" title="' + escapeAttr(taskPrompt || preview) + '">' + escapeHtml(preview || "-") + '</div><div class="jobs-inline-form"><div class="form-group"><input type="number" class="job-node-window-input" data-job-node-window-id="' + escapeAttr(node.id || "") + '" min="1" max="1440" value="' + escapeAttr(String(node.windowMinutes || 30)) + '"></div></div><div class="jobs-step-toolbar"><button type="button" class="btn-secondary" data-job-action="edit-task" data-job-task-id="' + escapeAttr(node.taskId || "") + '">' + escapeHtml(strings.actionEdit || "Edit") + '</button><button type="button" class="btn-secondary" data-job-action="run-task" data-job-task-id="' + escapeAttr(node.taskId || "") + '">' + escapeHtml(strings.actionRun || "Run") + '</button><button type="button" class="btn-danger" data-job-action="detach-node" data-job-node-id="' + escapeAttr(node.id || "") + '">Delete</button></div></div>';
        }).join("");
        jobsStepList.innerHTML = stepCards || '<div class="jobs-empty">' + escapeHtml(strings.jobsEmptySteps || "This job has no steps yet.") + "</div>";
      }
    }
    updateAgentOptions2();
    updateModelOptions2();
    var initialPromptSource = document.querySelector(
      'input[name="prompt-source"]:checked'
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
    window.runTask = function(id) {
      vscode.postMessage({ type: "runTask", taskId: id });
    };
    window.editTask = function(id) {
      var taskListArray = Array.isArray(tasks) ? tasks : [];
      var task = taskListArray.find(function(t) {
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
      pendingAgentValue = task.agent || "";
      pendingModelValue = task.model || "";
      if (agentSelect) {
        if (pendingAgentValue && selectHasOptionValue(agentSelect, pendingAgentValue)) {
          agentSelect.value = pendingAgentValue;
          pendingAgentValue = "";
        } else if (pendingAgentValue) {
          agentSelect.value = "";
        }
      }
      if (modelSelect) {
        if (pendingModelValue && selectHasOptionValue(modelSelect, pendingModelValue)) {
          modelSelect.value = pendingModelValue;
          pendingModelValue = "";
        } else if (pendingModelValue) {
          modelSelect.value = "";
        }
      }
      editingTaskEnabled = task.enabled !== false;
      var scopeValue = task.scope || "workspace";
      var scopeRadio = document.querySelector(
        'input[name="scope"][value="' + scopeValue + '"]'
      );
      if (scopeRadio) {
        scopeRadio.checked = true;
      }
      var sourceValue = task.promptSource || "inline";
      var sourceRadio = document.querySelector(
        'input[name="prompt-source"][value="' + sourceValue + '"]'
      );
      if (sourceRadio) {
        sourceRadio.checked = true;
      }
      applyPromptSource(sourceValue, true);
      pendingTemplatePath = task.promptPath || "";
      if (templateSelect) {
        if (pendingTemplatePath && selectHasOptionValue(templateSelect, pendingTemplatePath)) {
          templateSelect.value = pendingTemplatePath;
          pendingTemplatePath = "";
        } else if (pendingTemplatePath) {
          templateSelect.value = "";
        }
      }
      if (jitterSecondsInput) {
        jitterSecondsInput.value = String(
          task.jitterSeconds ?? defaultJitterSeconds
        );
      }
      var runFirstEl = document.getElementById("run-first");
      if (runFirstEl) runFirstEl.checked = false;
      var oneTimeEl = document.getElementById("one-time");
      if (oneTimeEl) oneTimeEl.checked = task.oneTime === true;
      if (chatSessionSelect) {
        chatSessionSelect.value = task.chatSession === "continue" ? "continue" : task.chatSession === "new" ? "new" : defaultChatSession;
      }
      syncRecurringChatSessionUi();
      switchTab("create");
    };
    if (newTaskBtn) {
      newTaskBtn.addEventListener("click", function() {
        resetForm();
        switchTab("create");
        try {
          var taskNameEl = document.getElementById("task-name");
          if (taskNameEl && typeof taskNameEl.focus === "function") {
            taskNameEl.focus();
          }
        } catch (e) {
        }
      });
    }
    window.copyPrompt = function(id) {
      vscode.postMessage({ type: "copyTask", taskId: id });
    };
    window.duplicateTask = function(id) {
      vscode.postMessage({ type: "duplicateTask", taskId: id });
    };
    window.moveTaskToCurrentWorkspace = function(id) {
      vscode.postMessage({ type: "moveTaskToCurrentWorkspace", taskId: id });
    };
    window.toggleTask = function(id) {
      vscode.postMessage({ type: "toggleTask", taskId: id });
    };
    window.deleteTask = function(id) {
      var task = tasks.find(function(t) {
        return t && t.id === id;
      });
      if (!task) {
        return;
      }
      vscode.postMessage({ type: "deleteTask", taskId: id });
    };
    window.addEventListener("message", function(event) {
      var message = event.data;
      try {
        switch (message.type) {
          case "updateTasks":
            tasks = Array.isArray(message.tasks) ? message.tasks : [];
            emitWebviewDebug("updateTasks", {
              taskCount: tasks.length,
              selectedTodoId: selectedTodoId || "",
              isCreatingJob
            });
            syncTaskLabelFilterOptions();
            syncJobsExistingTaskSelect();
            renderTaskList(message.tasks);
            renderJobsTab();
            syncTodoLinkedTaskOptions(selectedTodoId ? "" : todoLinkedTaskSelect ? todoLinkedTaskSelect.value : "");
            break;
          case "updateJobs":
            jobs = Array.isArray(message.jobs) ? message.jobs : [];
            syncTaskLabelFilterOptions();
            renderTaskList(tasks);
            renderJobsTab();
            break;
          case "updateJobFolders":
            jobFolders = Array.isArray(message.jobFolders) ? message.jobFolders : [];
            renderJobsTab();
            break;
          case "updateCockpitBoard":
            cockpitBoard = message.cockpitBoard || {
              version: 1,
              sections: [],
              cards: [],
              filters: { labels: [], priorities: [], flags: [], sortBy: "manual", sortDirection: "asc", showArchived: false },
              updatedAt: ""
            };
            emitWebviewDebug("updateCockpitBoard", {
              sectionCount: Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.length : 0,
              cardCount: Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.length : 0,
              selectedTodoId: selectedTodoId || "",
              draftTitleLength: currentTodoDraft.title.length
            });
            if (pendingTodoDeleteId && !cockpitBoard.cards.some(function(card) {
              return card && card.id === pendingTodoDeleteId;
            })) {
              closeTodoDeleteModal();
            }
            clearCatalogDeleteState();
            syncTaskLabelFilterOptions();
            renderTaskList(tasks);
            requestCockpitBoardRender();
            reconcileTodoEditorCatalogState();
            syncFlagEditor();
            syncTodoLabelEditor();
            break;
          case "updateResearchState":
            researchProfiles = Array.isArray(message.profiles) ? message.profiles : [];
            activeResearchRun = message.activeRun || null;
            recentResearchRuns = Array.isArray(message.recentRuns) ? message.recentRuns : [];
            if (activeResearchRun && (!selectedResearchRunId || selectedResearchRunId === activeResearchRun.id)) {
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
              hookConfigured: false
            };
            renderTelegramTab();
            break;
          case "updateLogLevel":
            currentLogLevel = typeof message.logLevel === "string" && message.logLevel ? message.logLevel : "info";
            debugTools.setLogLevel(currentLogLevel);
            renderLoggingControls();
            break;
          case "updateExecutionDefaults":
            executionDefaults = message.executionDefaults || {
              agent: "agent",
              model: ""
            };
            emitWebviewDebug("updateExecutionDefaults", {
              agent: executionDefaults.agent || "",
              model: executionDefaults.model || "",
              editingTaskId: editingTaskId || "",
              pendingAgentValue,
              pendingModelValue
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
            break;
          case "updateAgents":
            {
              var currentAgentValue = pendingAgentValue || (agentSelect ? agentSelect.value : "");
              emitWebviewDebug("updateAgents", {
                currentAgentValue,
                agentCount: Array.isArray(message.agents) ? message.agents.length : 0
              });
              agents = Array.isArray(message.agents) ? message.agents : [];
              updateAgentOptions2();
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
              var currentModelValue = pendingModelValue || (modelSelect ? modelSelect.value : "");
              emitWebviewDebug("updateModels", {
                currentModelValue,
                modelCount: Array.isArray(message.models) ? message.models.length : 0
              });
              models = Array.isArray(message.models) ? message.models : [];
              updateModelOptions2();
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
            promptTemplates = Array.isArray(message.templates) ? message.templates : [];
            {
              var sourceElement = document.querySelector(
                'input[name="prompt-source"]:checked'
              );
              var currentSource = sourceElement ? sourceElement.value : "inline";
              var currentTemplateValue = pendingTemplatePath || (templateSelect ? templateSelect.value : "");
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
            scheduleHistory = Array.isArray(message.entries) ? message.entries : [];
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
                setTimeout(function() {
                  toast.style.opacity = "0";
                }, 3e3);
                setTimeout(function() {
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
            setTimeout(function() {
              var list = document.querySelectorAll(".task-card");
              var card = null;
              for (var i = 0; i < list.length; i++) {
                var el = list[i];
                if (el && el.getAttribute && el.getAttribute("data-id") === message.taskId) {
                  card = el;
                  break;
                }
              }
              if (card) card.scrollIntoView({ behavior: "smooth" });
            }, 100);
            break;
          case "focusJob":
            selectedJobFolderId = typeof message.folderId === "string" ? message.folderId : "";
            var focusedJobId = message.jobId || "";
            isCreatingJob = true;
            selectedJobId = "";
            persistTaskFilter();
            renderJobsTab();
            switchTab("jobs");
            setTimeout(function() {
              var jobCard = focusedJobId ? document.querySelector('[data-job-id="' + focusedJobId + '"]') : null;
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
            setTimeout(function() {
              try {
                var taskNameEl = document.getElementById("task-name");
                if (taskNameEl && typeof taskNameEl.focus === "function") {
                  taskNameEl.focus();
                }
              } catch (e) {
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
    renderTaskList(tasks);
    switchTab(getInitialTabName());
    setInterval(function() {
      if (isTabActive("list")) {
        refreshTaskCountdowns();
      }
    }, 1e3);
    vscode.postMessage({ type: "webviewReady" });
  })();
})();
//# sourceMappingURL=schedulerWebview.js.map
