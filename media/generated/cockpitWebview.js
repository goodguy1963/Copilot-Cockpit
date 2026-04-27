"use strict";
(() => {
  // media/cockpitWebviewBoardInteractions.js
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
        "[data-todo-delete-cancel]",
        "[data-todo-delete-reject]",
        "[data-todo-delete-permanent]",
        "[data-todo-purge]",
        "[data-todo-restore]",
        "[data-todo-complete]",
        "[data-todo-complete-cancel]",
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
    collapseBtn.setAttribute("aria-expanded", isNowCollapsed ? "false" : "true");
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
    var cockpitBoard = options.cockpitBoard;
    var todoCard = null;
    if (cockpitBoard && Array.isArray(cockpitBoard.cards)) {
      for (var oi = 0; oi < cockpitBoard.cards.length; oi++) {
        if (cockpitBoard.cards[oi] && cockpitBoard.cards[oi].id === todoId) {
          todoCard = cockpitBoard.cards[oi];
          break;
        }
      }
    }
    var workflowFlag = "";
    if (todoCard && Array.isArray(todoCard.flags)) {
      todoCard.flags.forEach(function(flag) {
        var key = String(flag || "").trim().toLowerCase();
        if (key === "go") {
          key = "ready";
        }
        if (["new", "needs-bot-review", "needs-user-review", "ready", "on-schedule-list", "final-user-check"].indexOf(key) >= 0) {
          workflowFlag = key;
        }
      });
    }
    var legacyReadyStatus = String(todoCard && todoCard.status || "").trim().toLowerCase() === "ready";
    var isReadyTodo = workflowFlag === "ready" || workflowFlag === "final-user-check" || legacyReadyStatus;
    var completionActionType = isReadyTodo ? "finalizeTodo" : "approveTodo";
    if (!todoId) {
      return;
    }
    if (!options.isPendingGridTodoCompletion || !options.isPendingGridTodoCompletion(todoId)) {
      if (typeof options.startPendingGridTodoCompletion === "function") {
        options.startPendingGridTodoCompletion(todoId);
      }
      return;
    }
    if (typeof options.clearPendingGridTodoCompletion === "function") {
      options.clearPendingGridTodoCompletion(todoId, true);
    }
    completeToggle.disabled = true;
    if (cardEl) {
      cardEl.style.opacity = "0.35";
      cardEl.style.pointerEvents = "none";
    }
    options.vscode.postMessage({ type: completionActionType, todoId });
  }
  function handleBoardTodoCompletionCancel(cancelBtn, options) {
    var todoId = cancelBtn.getAttribute("data-todo-complete-cancel") || "";
    if (!todoId || !options || typeof options.clearPendingGridTodoCompletion !== "function") {
      return;
    }
    options.clearPendingGridTodoCompletion(todoId);
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
  var installedBoardWindow = null;
  var installedBoardDocument = null;
  var pointerDragSession = null;
  var suppressNextBoardClick = false;
  var TODO_POINTER_DRAG_THRESHOLD_PX = 6;
  function resolvePointerCaptureElement(session) {
    if (!session) {
      return null;
    }
    return session.captureElement || session.draggedElement || null;
  }
  function handlePointerCaptureLoss(event) {
    if (!pointerDragSession || pointerDragSession.finishing) {
      return;
    }
    finishPointerDragSession(event, false);
  }
  function installPointerCaptureFallback(session) {
    var captureElement = resolvePointerCaptureElement(session);
    if (!session || session.captureLossListenerBound || !captureElement || typeof captureElement.addEventListener !== "function") {
      return;
    }
    captureElement.addEventListener("lostpointercapture", handlePointerCaptureLoss);
    session.captureLossListenerBound = true;
  }
  function trySetPointerCapture(event, session) {
    if (!session || !event || typeof event.pointerId !== "number") {
      return;
    }
    var captureElement = resolvePointerCaptureElement(session);
    if (!captureElement || typeof captureElement.setPointerCapture !== "function") {
      return;
    }
    try {
      captureElement.setPointerCapture(event.pointerId);
      session.captureElement = captureElement;
      session.pointerId = event.pointerId;
      installPointerCaptureFallback(session);
    } catch (_error) {
    }
  }
  function releasePointerCapture(session) {
    if (!session || typeof session.pointerId !== "number") {
      return;
    }
    var captureElement = resolvePointerCaptureElement(session);
    if (!captureElement || typeof captureElement.releasePointerCapture !== "function") {
      return;
    }
    try {
      captureElement.releasePointerCapture(session.pointerId);
    } catch (_error) {
    }
  }
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
  function getBoardSectionElements(boardColumns) {
    if (!boardColumns || typeof boardColumns.querySelectorAll !== "function") {
      return [];
    }
    return boardColumns.querySelectorAll(".board-column[data-section-id], .todo-list-section[data-section-id]");
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
  function getTodoDropTargetIndex(boardColumns, section, targetCard, draggingTodoId) {
    var fallbackCount = Number(section && section.getAttribute ? section.getAttribute("data-card-count") || 0 : 0);
    var sectionId = section && section.getAttribute ? section.getAttribute("data-section-id") || "" : "";
    var sameSectionCardAdjustment = 0;
    if (targetCard && targetCard.getAttribute && targetCard.getAttribute("data-section-id") === sectionId) {
      sameSectionCardAdjustment = 0;
    }
    if (!boardColumns || typeof boardColumns.querySelectorAll !== "function" || !sectionId) {
      if (targetCard && targetCard.getAttribute) {
        return Number(targetCard.getAttribute("data-order") || 0);
      }
      return Math.max(0, fallbackCount - sameSectionCardAdjustment);
    }
    var sectionCards = Array.prototype.filter.call(
      boardColumns.querySelectorAll("[data-todo-id]"),
      function(card) {
        return card && card.getAttribute && card.getAttribute("data-section-id") === sectionId && card.getAttribute("data-todo-id") !== draggingTodoId;
      }
    );
    if (targetCard) {
      var targetIndex = sectionCards.indexOf(targetCard);
      if (targetIndex >= 0) {
        return targetIndex;
      }
      if (targetCard.getAttribute) {
        return Number(targetCard.getAttribute("data-order") || 0);
      }
    }
    return sectionCards.length > 0 ? sectionCards.length : Math.max(0, fallbackCount - sameSectionCardAdjustment);
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
    if (typeof pointerDragSession.pointerId === "number" && event && typeof event.pointerId === "number" && event.pointerId !== pointerDragSession.pointerId) {
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
    if (pointTarget) {
      pointerDragSession.lastPointTarget = pointTarget;
    }
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
    if (typeof session.pointerId === "number" && event && typeof event.pointerId === "number" && event.pointerId !== session.pointerId) {
      return;
    }
    session.finishing = true;
    if (!session.activated) {
      releasePointerCapture(session);
      setBoardDocumentDragState(options, false);
      pointerDragSession = null;
      suppressNextBoardClick = false;
      return;
    }
    var boardColumns = getBoardColumns(options);
    var pointTarget = cancelled ? null : getPointerPointTarget(options, event);
    if (!cancelled && (!pointTarget || typeof pointTarget.closest !== "function")) {
      pointTarget = session.lastPointTarget || null;
    }
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
        var allSections = getBoardSectionElements(boardColumns);
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
        var targetIndex = getTodoDropTargetIndex(
          boardColumns,
          section,
          targetCard,
          options.getDraggingTodoId()
        );
        options.vscode.postMessage({
          type: "moveTodo",
          todoId: options.getDraggingTodoId(),
          sectionId: section.getAttribute("data-section-id"),
          targetIndex
        });
      }
    }
    releasePointerCapture(session);
    setBoardDocumentDragState(options, false);
    options.finishBoardDragState();
    pointerDragSession = null;
    if (cancelled) {
      suppressNextBoardClick = false;
      return;
    }
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
  var delegatedBoardColumns = null;
  function installBoardClickDelegation(boardColumns) {
    if (!boardColumns || typeof boardColumns.addEventListener !== "function") {
      return;
    }
    if (delegatedBoardColumns === boardColumns) {
      return;
    }
    delegatedBoardColumns = boardColumns;
    boardColumns.addEventListener("click", function(event) {
      var options = activeBoardOptions;
      if (!options) {
        return;
      }
      var target = getEventTargetElement(event);
      if (!target || typeof target.closest !== "function") {
        return;
      }
      if (consumeSuppressedBoardClick(event)) {
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
        options.setPendingBoardDelete(deleteBtn.getAttribute("data-todo-delete") || "", false);
        return;
      }
      var deleteCancelBtn = target.closest("[data-todo-delete-cancel]");
      if (deleteCancelBtn) {
        stopBoardEvent(event);
        options.clearPendingBoardDelete();
        return;
      }
      var deleteRejectBtn = target.closest("[data-todo-delete-reject]");
      if (deleteRejectBtn) {
        stopBoardEvent(event);
        options.submitBoardDeleteChoice("reject");
        return;
      }
      var deletePermanentBtn = target.closest("[data-todo-delete-permanent]");
      if (deletePermanentBtn) {
        stopBoardEvent(event);
        options.submitBoardDeleteChoice("permanent");
        return;
      }
      var purgeBtn = target.closest("[data-todo-purge]");
      if (purgeBtn) {
        stopBoardEvent(event);
        options.setPendingBoardDelete(purgeBtn.getAttribute("data-todo-purge") || "", true);
        return;
      }
      var restoreBtn = target.closest("[data-todo-restore]");
      if (restoreBtn) {
        stopBoardEvent(event);
        options.handleTodoRestore(restoreBtn);
        return;
      }
      var completeCancelBtn = target.closest("[data-todo-complete-cancel]");
      if (completeCancelBtn) {
        stopBoardEvent(event);
        options.handleTodoCompletionCancel(completeCancelBtn);
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
      var sectionHeader = target.closest(".cockpit-section-header");
      if (sectionHeader && !target.closest("[data-section-drag-handle]") && !target.closest("[data-section-rename]") && !target.closest("[data-section-delete]")) {
        var headerCollapseBtn = sectionHeader.querySelector("[data-section-collapse]");
        if (headerCollapseBtn) {
          stopBoardEvent(event);
          options.handleSectionCollapse(headerCollapseBtn);
          return;
        }
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
    Array.prototype.forEach.call(boardColumns.querySelectorAll(".cockpit-section-header"), function(sectionHeader) {
      bindElementListener(sectionHeader, "pointerdown", handleBoardPointerDown);
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
    var sectionHeader = getClosestEventTarget(target, ".cockpit-section-header");
    var boardColumns = getBoardColumns(options);
    if (!boardColumns) {
      return;
    }
    var sectionEl = sectionHandle && sectionHandle.closest ? sectionHandle.closest("[data-section-id]") : null;
    var sectionId = sectionHandle ? sectionHandle.getAttribute("data-section-drag-handle") : "";
    if (sectionHandle) {
      stopBoardEvent(event);
      clearBoardDragClasses(boardColumns);
      pointerDragSession = {
        kind: "section",
        draggedId: sectionId,
        draggedElement: sectionEl,
        captureElement: sectionHandle,
        activated: false,
        lastPointTarget: target,
        pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
        startX: typeof event.clientX === "number" ? event.clientX : 0,
        startY: typeof event.clientY === "number" ? event.clientY : 0
      };
      trySetPointerCapture(event, pointerDragSession);
      activatePointerDragSession(options);
      armBoardClickSuppression();
      return;
    }
    if (sectionHeader && !isTodoInteractiveTarget(target)) {
      var headerSection = sectionHeader.closest ? sectionHeader.closest("[data-section-id]") : null;
      var headerSectionId = headerSection && headerSection.getAttribute ? headerSection.getAttribute("data-section-id") : "";
      if (headerSectionId && !options.isArchiveTodoSectionId(headerSectionId)) {
        clearBoardDragClasses(boardColumns);
        pointerDragSession = {
          kind: "section",
          draggedId: headerSectionId,
          draggedElement: headerSection,
          captureElement: sectionHeader,
          activated: false,
          lastPointTarget: target,
          pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
          startX: typeof event.clientX === "number" ? event.clientX : 0,
          startY: typeof event.clientY === "number" ? event.clientY : 0
        };
        trySetPointerCapture(event, pointerDragSession);
        return;
      }
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
      captureElement: todoHandle || card,
      activated: false,
      lastPointTarget: target,
      pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
      startX: typeof event.clientX === "number" ? event.clientX : 0,
      startY: typeof event.clientY === "number" ? event.clientY : 0
    };
    trySetPointerCapture(event, pointerDragSession);
    if (todoHandle) {
      stopBoardEvent(event);
      activatePointerDragSession(options);
      armBoardClickSuppression();
    }
  }
  function installBoardListeners(options) {
    var win = options.window;
    var doc = options.document;
    if (!win || typeof win.addEventListener !== "function") {
      return;
    }
    if (installedBoardWindow !== win) {
      win.addEventListener("pointermove", updatePointerDragSession, true);
      win.addEventListener("pointerup", function(event) {
        finishPointerDragSession(event, false);
      }, true);
      win.addEventListener("pointercancel", function(event) {
        finishPointerDragSession(event, true);
      }, true);
      win.addEventListener("mouseup", function(event) {
        finishPointerDragSession(event, false);
      }, true);
      win.addEventListener("blur", function(event) {
        finishPointerDragSession(event, true);
      }, true);
      installedBoardWindow = win;
    }
    if (!doc || typeof doc.addEventListener !== "function" || installedBoardDocument === doc) {
      return;
    }
    doc.addEventListener("pointerup", function(event) {
      finishPointerDragSession(event, false);
    }, true);
    doc.addEventListener("pointercancel", function(event) {
      finishPointerDragSession(event, true);
    }, true);
    doc.addEventListener("mouseup", function(event) {
      finishPointerDragSession(event, false);
    }, true);
    doc.addEventListener("visibilitychange", function() {
      if (doc.visibilityState === "hidden") {
        finishPointerDragSession(null, true);
      }
    }, true);
    installedBoardDocument = doc;
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

  // media/cockpitWebviewDebug.js
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
        comment: "",
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
      nextDraft.comment = params.todoCommentInput ? String(params.todoCommentInput.value || "") : "";
      nextDraft.title = params.todoTitleInput ? String(params.todoTitleInput.value || "") : "";
      nextDraft.description = params.todoDescriptionInput ? String(params.todoDescriptionInput.value || "") : "";
      nextDraft.dueAt = params.todoDueInput ? String(params.todoDueInput.value || "") : "";
      nextDraft.priority = params.todoPriorityInput ? String(params.todoPriorityInput.value || "none") : "none";
      nextDraft.sectionId = params.todoSectionInput ? String(params.todoSectionInput.value || "") : "";
      nextDraft.taskId = params.todoLinkedTaskSelect ? String(params.todoLinkedTaskSelect.value || "") : "";
      if (params.reason) {
        emitWebviewDebug("todoDraftSync", {
          reason: params.reason,
          hasComment: nextDraft.comment.length > 0,
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

  // media/cockpitWebviewBoardRendering.js
  function renderTodoBoardMarkup(options) {
    var visibleSections2 = options.visibleSections;
    var cards = options.cards;
    var filters2 = options.filters;
    var strings = options.strings;
    if (filters2.viewMode === "list") {
      return renderTodoListView(visibleSections2, cards, filters2, options);
    }
    return renderTodoBoardColumns(visibleSections2, cards, filters2, options);
  }
  function getLatestTodoComment(card) {
    return Array.isArray(card.comments) && card.comments.length ? card.comments[card.comments.length - 1] : null;
  }
  function renderTodoCompactActions(card, options, layout) {
    var strings = options.strings;
    var helpers = options.helpers;
    var isDeleteConfirmOpen = options.pendingBoardDeleteTodoId === card.id;
    var permanentOnly = !!(card.archived || isDeleteConfirmOpen && options.pendingBoardDeletePermanentOnly);
    var actionRowClass = layout === "board" ? "todo-card-action-row" : "todo-list-actions";
    function renderActionButton(cls, dataAttr, label, iconHtml) {
      return '<button type="button" class="' + cls + ' todo-list-action-btn todo-card-icon-btn" ' + dataAttr + '="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(label) + '" aria-label="' + helpers.escapeAttr(label) + '">' + iconHtml + "</button>";
    }
    function renderConfirmButton(cls, dataAttr, label) {
      return '<button type="button" class="' + cls + ' todo-list-action-btn" ' + dataAttr + '="' + helpers.escapeAttr(card.id) + '" title="' + helpers.escapeAttr(label) + '" aria-label="' + helpers.escapeAttr(label) + '">' + helpers.escapeHtml(label) + "</button>";
    }
    if (isDeleteConfirmOpen) {
      var confirmActions = [
        renderConfirmButton(
          "btn-secondary todo-card-delete-cancel",
          "data-todo-delete-cancel",
          strings.boardDeleteTodoCancel || "Cancel"
        )
      ];
      if (!permanentOnly) {
        confirmActions.push(
          renderConfirmButton(
            "btn-secondary todo-card-delete-reject",
            "data-todo-delete-reject",
            strings.boardDeleteTodoReject || "Archive as Rejected"
          )
        );
      }
      confirmActions.push(
        renderConfirmButton(
          "btn-danger todo-card-delete-permanent",
          "data-todo-delete-permanent",
          strings.boardDeleteTodoPermanent || "Delete Permanently"
        )
      );
      return '<div class="' + actionRowClass + '">' + confirmActions.join("") + "</div>";
    }
    var actions = [
      renderActionButton(
        "btn-secondary todo-card-edit",
        "data-todo-edit",
        strings.boardEditTodo || "Open Editor",
        "&#9998;"
      )
    ];
    if (card.archived) {
      actions.push(
        renderActionButton(
          "btn-secondary todo-card-restore",
          "data-todo-restore",
          strings.boardRestoreTodo || "Restore",
          "&#8634;"
        )
      );
      actions.push(
        renderActionButton(
          "btn-danger todo-card-purge",
          "data-todo-purge",
          strings.boardDeleteTodoPermanent || "Delete Permanently",
          "&#128465;"
        )
      );
    } else {
      actions.push(
        renderActionButton(
          "btn-secondary todo-card-delete",
          "data-todo-delete",
          strings.boardDeleteTodo || "Delete Todo",
          "&#128465;"
        )
      );
    }
    return '<div class="' + actionRowClass + (actions.length === 1 ? " has-single-action" : "") + '">' + actions.join("") + "</div>";
  }
  function renderTodoListRow(card, sectionId, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var selectedTodoId = options.selectedTodoId;
    var isSelected = card.id === selectedTodoId;
    var latestComment = getLatestTodoComment(card);
    var descriptionText = card.description ? helpers.getTodoDescriptionPreview(card.description) : card.taskId ? strings.boardTaskLinked || "Linked task" : strings.boardDescriptionPreviewEmpty || "No description yet.";
    var latestCommentText = latestComment && latestComment.body ? "#" + String(latestComment.sequence || 1) + " \u2022 " + helpers.getTodoCommentSourceLabel(latestComment.source || "human-form") + " \u2022 " + helpers.getTodoDescriptionPreview(latestComment.body) : strings.boardCommentsEmpty || "No comments yet.";
    var visibleFlags = Array.isArray(card.flags) ? card.flags.slice(0, 6) : [];
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
    var visibleLabels = Array.isArray(card.labels) ? card.labels.slice(0, 6) : [];
    var chipMarkup = visibleFlags.length || visibleLabels.length ? '<div class="todo-list-chip-row">' + (visibleFlags.length ? '<div class="card-flags">' + visibleFlags.map(function(flag, idx) {
      return '<span data-flag-slot="' + idx + '">' + helpers.renderFlagChip(flag, false) + "</span>";
    }).join("") + "</div>" : "") + (visibleLabels.length ? '<div class="card-labels">' + visibleLabels.map(function(label, idx) {
      return '<span data-label-slot="' + idx + '">' + helpers.renderLabelChip(label, false, false) + "</span>";
    }).join("") + "</div>" : "") + "</div>" : "";
    return '<article class="todo-list-row" draggable="false" data-todo-id="' + helpers.escapeAttr(card.id) + '" data-section-id="' + helpers.escapeAttr(sectionId) + '" data-order="' + String(card.order || 0) + '" data-selected="' + (isSelected ? "true" : "false") + '" style="border-radius:8px;background:' + helpers.getTodoPriorityCardBg(card.priority || "none", false) + ';border:1px solid var(--vscode-widget-border);padding:var(--cockpit-card-pad, 8px);cursor:pointer;"><div class="todo-list-main"><div class="todo-list-title-line"><div class="todo-list-title-block">' + helpers.renderTodoCompletionCheckbox(card) + '<strong class="todo-list-title">' + helpers.escapeHtml(card.title || (strings.boardCardUntitled || "Untitled")) + '</strong></div><div class="todo-list-meta-trail">' + helpers.renderTodoDragHandle(card) + metaParts.join("") + "</div></div>" + chipMarkup + '<div class="cockpit-card-details todo-list-card-details"><div class="note todo-list-detail-line todo-list-detail-line-description"><strong data-card-meta>' + helpers.escapeHtml(strings.boardDescriptionLabel || "Description") + ':</strong><span class="todo-list-summary">' + helpers.escapeHtml(descriptionText) + '</span></div><div class="note todo-list-detail-line todo-list-detail-line-comment"><strong data-card-meta>' + helpers.escapeHtml(strings.boardLatestComment || "Latest comment") + ':</strong><span class="todo-list-summary">' + helpers.escapeHtml(latestCommentText) + "</span></div></div></div>" + renderTodoCompactActions(card, options, "list") + "</article>";
  }
  function renderTodoListView(visibleSections2, cards, filters2, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var collapsedSections = options.collapsedSections;
    return '<div class="todo-list-view">' + visibleSections2.map(function(section) {
      var sectionCards = helpers.sortTodoCards(cards.filter(function(card) {
        return card.sectionId === section.id && helpers.cardMatchesTodoFilters(card, filters2);
      }), filters2);
      var isCollapsed = collapsedSections.has(section.id);
      var isSpecialSection = helpers.isSpecialTodoSectionId(section.id);
      var sectionTitle = helpers.escapeHtml(section.title || (strings.boardSectionUntitled || "Section"));
      return '<section class="todo-list-section' + (isCollapsed ? " is-collapsed" : "") + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '"><div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px);"><button type="button" class="cockpit-collapse-btn' + (isCollapsed ? " collapsed" : "") + '" data-section-collapse="' + helpers.escapeAttr(section.id) + '" aria-expanded="' + (isCollapsed ? "false" : "true") + '" title="' + helpers.escapeAttr(isCollapsed ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section") + '">&#9660;</button>' + helpers.renderSectionDragHandle(section, isSpecialSection) + '<div class="cockpit-section-title-group"><strong class="cockpit-section-title">' + sectionTitle + '</strong></div><span class="note cockpit-section-count">(' + String(sectionCards.length) + ")</span>" + (isSpecialSection ? "" : '<div class="cockpit-section-actions"><button type="button" class="btn-icon" data-section-rename="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionRename || "Rename section") + '">&#9998;</button><button type="button" class="btn-icon" data-section-delete="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionDelete || "Delete section") + '">&#215;</button></div>') + '</div><div class="section-body-wrapper' + (isCollapsed ? " collapsed" : "") + '"><div class="section-body-inner"><div class="todo-list-items">' + (sectionCards.length ? sectionCards.map(function(card) {
        return renderTodoListRow(card, section.id, options);
      }).join("") : '<div class="note">' + helpers.escapeHtml(strings.boardListEmptySection || strings.boardEmpty || "No todos in this section.") + "</div>") + "</div></div></div></section>";
    }).join("") + "</div>";
  }
  function renderTodoBoardColumns(visibleSections2, cards, filters2, options) {
    var strings = options.strings;
    var helpers = options.helpers;
    var collapsedSections = options.collapsedSections;
    var selectedTodoId = options.selectedTodoId;
    return '<div style="display:flex;gap:16px;align-items:flex-start;min-width:max-content;">' + visibleSections2.map(function(section) {
      var sectionCards = helpers.sortTodoCards(cards.filter(function(card) {
        return card.sectionId === section.id && helpers.cardMatchesTodoFilters(card, filters2);
      }), filters2);
      var isSpecialSection = helpers.isSpecialTodoSectionId(section.id);
      return '<section class="board-column' + (collapsedSections.has(section.id) ? " is-collapsed" : "") + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-card-count="' + String(sectionCards.length) + '" style="display:flex;flex-direction:column;border-radius:10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);width:var(--cockpit-col-width,240px);min-width:var(--cockpit-col-width,240px);overflow:visible;"><div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px)"><button type="button" class="cockpit-collapse-btn' + (collapsedSections.has(section.id) ? " collapsed" : "") + '" data-section-collapse="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(collapsedSections.has(section.id) ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section") + '">&#9660;</button>' + helpers.renderSectionDragHandle(section, isSpecialSection) + '<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + helpers.escapeHtml(section.title || (strings.boardSectionUntitled || "Section")) + "</strong>" + (isSpecialSection ? "" : '<div class="cockpit-section-actions"><button type="button" class="btn-icon" data-section-rename="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionRename || "Rename section") + '">&#9998;</button><button type="button" class="btn-icon" data-section-delete="' + helpers.escapeAttr(section.id) + '" title="' + helpers.escapeAttr(strings.boardSectionDelete || "Delete section") + '">&#215;</button></div>') + '</div><div class="section-body-wrapper' + (collapsedSections.has(section.id) ? " collapsed" : "") + '"><div class="section-body-inner"><div style="padding:0 var(--cockpit-card-pad,9px) var(--cockpit-card-pad,9px);"><div style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);min-height:60px;">' + (sectionCards.length ? sectionCards.map(function(card) {
        var isSelected = card.id === selectedTodoId;
        var visibleFlags = Array.isArray(card.flags) ? card.flags.slice(0, 6) : [];
        var chipMarkup = visibleFlags.length || Array.isArray(card.labels) && card.labels.length ? '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">' + (visibleFlags.length ? '<div class="card-flags" style="display:flex;flex-wrap:wrap;gap:6px;">' + visibleFlags.map(function(flag, idx) {
          return '<span data-flag-slot="' + idx + '">' + helpers.renderFlagChip(flag, false) + "</span>";
        }).join("") + "</div>" : "") + (Array.isArray(card.labels) && card.labels.length ? '<div class="card-labels" style="display:flex;flex-wrap:wrap;gap:6px;">' + card.labels.slice(0, 6).map(function(label, idx) {
          return '<span data-label-slot="' + idx + '">' + helpers.renderLabelChip(label, false, false) + "</span>";
        }).join("") + "</div>" : "") + "</div>" : "";
        var latestComment = Array.isArray(card.comments) && card.comments.length ? card.comments[card.comments.length - 1] : null;
        var dueMarkup = card.dueAt ? '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml((strings.boardDueLabel || "Due") + ": " + helpers.formatTodoDate(card.dueAt)) + "</span>" : "";
        var archiveMarkup = card.archived && card.archiveOutcome ? '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml(helpers.getTodoArchiveOutcomeLabel(card.archiveOutcome)) + "</span>" : "";
        var latestCommentMarkup = latestComment && latestComment.body ? '<div class="note" style="display:flex;gap:6px;align-items:flex-start;"><strong data-card-meta>' + helpers.escapeHtml(strings.boardLatestComment || "Latest comment") + ":</strong><span data-card-meta>#" + helpers.escapeHtml(String(latestComment.sequence || 1)) + " \u2022 " + helpers.escapeHtml(helpers.getTodoCommentSourceLabel(latestComment.source || "human-form")) + " \u2022 " + helpers.escapeHtml(helpers.getTodoDescriptionPreview(latestComment.body || "")) + "</span></div>" : "";
        return '<article draggable="false" data-todo-id="' + helpers.escapeAttr(card.id) + '" data-section-id="' + helpers.escapeAttr(section.id) + '" data-order="' + String(card.order || 0) + '" data-selected="' + (isSelected ? "true" : "false") + '" style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);border-radius:8px;padding:var(--cockpit-card-pad,8px);background:' + helpers.getTodoPriorityCardBg(card.priority || "none", false) + ';border:1px solid var(--vscode-widget-border);cursor:pointer;"><div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;"><div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">' + helpers.renderTodoCompletionCheckbox(card) + '<strong style="line-height:1.3;min-width:0;">' + helpers.escapeHtml(card.title || (strings.boardCardUntitled || "Untitled")) + '</strong></div><div style="display:flex;align-items:center;gap:6px;">' + helpers.renderTodoDragHandle(card) + '<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">' + helpers.escapeHtml(helpers.getTodoPriorityLabel(card.priority || "none")) + "</span></div></div>" + (dueMarkup || archiveMarkup ? '<div style="display:flex;flex-wrap:wrap;gap:4px;">' + dueMarkup + archiveMarkup + "</div>" : "") + chipMarkup + '<div class="cockpit-card-details"><div class="note" style="white-space:pre-wrap;">' + helpers.escapeHtml(helpers.getTodoDescriptionPreview(card.description || "")) + "</div>" + latestCommentMarkup + "</div>" + renderTodoCompactActions(card, options, "board") + "</article>";
      }).join("") : '<div class="note">' + helpers.escapeHtml(strings.boardEmpty || "No cards yet.") + "</div>") + "</div></div></div></div></section>";
    }).join("") + "</div>";
  }

  // media/cockpitWebviewCronUtils.js
  function clampFriendlyNumber(value, min, max, fallback) {
    var parsed = parseInt(String(value), 10);
    if (isNaN(parsed)) {
      parsed = fallback;
    }
    return Math.max(min, Math.min(max, parsed));
  }
  function padFriendlyNumber(value) {
    var normalized = clampFriendlyNumber(value, 0, 59, 0);
    return normalized < 10 ? "0" + normalized : String(normalized);
  }
  function normalizeDayOfWeekValue(value) {
    var normalizedSource = String(value || "");
    var normalized = normalizedSource.trim().toLowerCase();
    if (/^\d+$/.test(normalized)) {
      var numericValue = parseInt(normalized, 10);
      if (numericValue === 7) {
        numericValue = 0;
      }
      if (numericValue >= 0 && numericValue <= 6) {
        return numericValue;
      }
    }
    var aliases = /* @__PURE__ */ new Map([
      ["sun", 0],
      ["mon", 1],
      ["tue", 2],
      ["wed", 3],
      ["thu", 4],
      ["fri", 5],
      ["sat", 6]
    ]);
    return aliases.has(normalized) ? aliases.get(normalized) : null;
  }
  function formatFriendlyTime(hour, minute) {
    return padFriendlyNumber(hour) + ":" + padFriendlyNumber(minute);
  }
  function isFriendlyCronWholeNumber(value) {
    return /^\d+$/.test(String(value));
  }
  function parseFriendlyCronNumber(value, min, max) {
    if (!isFriendlyCronWholeNumber(value)) {
      return null;
    }
    var parsed = parseInt(String(value), 10);
    if (parsed < min || parsed > max) {
      return null;
    }
    return parsed;
  }
  function getFriendlyFieldsForSelection(selection) {
    switch (selection) {
      case "every-n":
        return ["interval"];
      case "hourly":
        return ["minute"];
      case "daily":
        return ["hour", "minute"];
      case "weekly":
        return ["dow", "hour", "minute"];
      case "monthly":
        return ["dom", "hour", "minute"];
      default:
        return [];
    }
  }
  function syncFriendlyFieldVisibility(builder, selection) {
    var visibleFields = getFriendlyFieldsForSelection(selection);
    var friendlyFields = builder ? builder.querySelectorAll(".friendly-field") : [];
    for (var index = 0; index < friendlyFields.length; index += 1) {
      var element = friendlyFields[index];
      if (!element || !element.getAttribute) {
        continue;
      }
      var fieldName = element.getAttribute("data-field");
      var isVisible = visibleFields.indexOf(fieldName) !== -1;
      if (element.classList) {
        if (isVisible) {
          element.classList.add("visible");
        } else {
          element.classList.remove("visible");
        }
      }
      if (element.style) {
        element.style.display = isVisible ? "block" : "none";
      }
    }
  }
  function buildFriendlyCronExpression(selection, rawValues) {
    var values = rawValues || {};
    switch (selection) {
      case "every-n":
        return "*/" + clampFriendlyNumber(values.interval, 1, 59, 5) + " * * * *";
      case "hourly":
        return clampFriendlyNumber(values.minute, 0, 59, 0) + " * * * *";
      case "daily":
        return clampFriendlyNumber(values.minute, 0, 59, 0) + " " + clampFriendlyNumber(values.hour, 0, 23, 9) + " * * *";
      case "weekly":
        return clampFriendlyNumber(values.minute, 0, 59, 0) + " " + clampFriendlyNumber(values.hour, 0, 23, 9) + " * * " + clampFriendlyNumber(values.dow, 0, 6, 1);
      case "monthly":
        return clampFriendlyNumber(values.minute, 0, 59, 0) + " " + clampFriendlyNumber(values.hour, 0, 23, 9) + " " + clampFriendlyNumber(values.dom, 1, 31, 1) + " * *";
      default:
        return "";
    }
  }
  function parseFriendlyCronExpression(expression) {
    var normalizedExpression = String(expression || "").trim();
    if (!normalizedExpression) {
      return null;
    }
    var cronParts = normalizedExpression.split(/\s+/);
    if (cronParts.length !== 5) {
      return null;
    }
    var minute = cronParts[0];
    var hour = cronParts[1];
    var dayOfMonth = cronParts[2];
    var month = cronParts[3];
    var dayOfWeek = cronParts[4];
    var intervalMatch = /^\*\/(\d+)$/.exec(minute);
    var parsedMinute = parseFriendlyCronNumber(minute, 0, 59);
    var parsedHour = parseFriendlyCronNumber(hour, 0, 23);
    var parsedDayOfMonth = parseFriendlyCronNumber(dayOfMonth, 1, 31);
    var parsedDayOfWeek = normalizeDayOfWeekValue(dayOfWeek);
    if (intervalMatch && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var parsedInterval = parseFriendlyCronNumber(intervalMatch[1], 1, 59);
      return parsedInterval === null ? null : {
        frequency: "every-n",
        interval: parsedInterval
      };
    }
    if (parsedMinute !== null && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return {
        frequency: "hourly",
        minute: parsedMinute
      };
    }
    if (parsedMinute !== null && parsedHour !== null && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      return {
        frequency: "daily",
        hour: parsedHour,
        minute: parsedMinute
      };
    }
    if (parsedMinute !== null && parsedHour !== null && dayOfMonth === "*" && month === "*" && parsedDayOfWeek !== null) {
      return {
        frequency: "weekly",
        dow: parsedDayOfWeek,
        hour: parsedHour,
        minute: parsedMinute
      };
    }
    if (parsedMinute !== null && parsedHour !== null && parsedDayOfMonth !== null && month === "*" && dayOfWeek === "*") {
      return {
        frequency: "monthly",
        dom: parsedDayOfMonth,
        hour: parsedHour,
        minute: parsedMinute
      };
    }
    return null;
  }
  function summarizeCronExpression(expression, strings) {
    var labels = strings || {};
    var fallback = labels.labelFriendlyFallback || "";
    var normalizedExpression = String(expression || "").trim();
    if (!normalizedExpression) {
      return fallback;
    }
    var cronParts = normalizedExpression.split(/\s+/);
    if (cronParts.length !== 5) {
      return fallback;
    }
    var minute = cronParts[0];
    var hour = cronParts[1];
    var dayOfMonth = cronParts[2];
    var month = cronParts[3];
    var dayOfWeek = cronParts[4];
    var normalizedDayOfWeek = String(dayOfWeek || "").toLowerCase();
    var isWeekdays = normalizedDayOfWeek === "1-5" || normalizedDayOfWeek === "mon-fri";
    var everyNMinutesMatch = /^\*\/(\d+)$/.exec(minute);
    if (everyNMinutesMatch && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var everyNTemplate = labels.cronPreviewEveryNMinutes || "";
      return everyNTemplate ? everyNTemplate.replace("{n}", String(everyNMinutesMatch[1])) : fallback;
    }
    if (isFriendlyCronWholeNumber(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var hourlyTemplate = labels.cronPreviewHourlyAtMinute || "";
      return hourlyTemplate ? hourlyTemplate.replace("{m}", String(minute)) : fallback;
    }
    if (isFriendlyCronWholeNumber(minute) && isFriendlyCronWholeNumber(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var dailyTemplate = labels.cronPreviewDailyAt || "";
      var dailyTime = formatFriendlyTime(hour, minute);
      return dailyTemplate ? dailyTemplate.replace("{t}", String(dailyTime)) : fallback;
    }
    if (isFriendlyCronWholeNumber(minute) && isFriendlyCronWholeNumber(hour) && dayOfMonth === "*" && month === "*" && isWeekdays) {
      var weekdaysTemplate = labels.cronPreviewWeekdaysAt || "";
      var weekdaysTime = formatFriendlyTime(hour, minute);
      return weekdaysTemplate ? weekdaysTemplate.replace("{t}", String(weekdaysTime)) : fallback;
    }
    var numericDayOfWeek = normalizeDayOfWeekValue(dayOfWeek);
    if (isFriendlyCronWholeNumber(minute) && isFriendlyCronWholeNumber(hour) && dayOfMonth === "*" && month === "*" && numericDayOfWeek !== null) {
      var weeklyTemplate = labels.cronPreviewWeeklyOnAt || "";
      var dayNames = [
        labels.daySun || "",
        labels.dayMon || "",
        labels.dayTue || "",
        labels.dayWed || "",
        labels.dayThu || "",
        labels.dayFri || "",
        labels.daySat || ""
      ];
      var weeklyTime = formatFriendlyTime(hour, minute);
      var weeklyDayLabel = dayNames[numericDayOfWeek] || String(numericDayOfWeek);
      return weeklyTemplate ? weeklyTemplate.replace("{d}", String(weeklyDayLabel)).replace("{t}", String(weeklyTime)) : fallback;
    }
    if (isFriendlyCronWholeNumber(minute) && isFriendlyCronWholeNumber(hour) && isFriendlyCronWholeNumber(dayOfMonth) && month === "*" && dayOfWeek === "*") {
      var monthlyTemplate = labels.cronPreviewMonthlyOnAt || "";
      var monthlyTime = formatFriendlyTime(hour, minute);
      return monthlyTemplate ? monthlyTemplate.replace("{dom}", String(dayOfMonth)).replace("{t}", String(monthlyTime)) : fallback;
    }
    return fallback;
  }

  // media/cockpitWebviewPromptState.js
  function restorePendingSelectValue(selectEl, desiredValue) {
    var pendingValue = desiredValue || "";
    if (!selectEl || !pendingValue) {
      return pendingValue;
    }
    selectEl.value = pendingValue;
    return selectEl.value === pendingValue ? "" : pendingValue;
  }
  function buildPromptTemplatePlaceholder(escapeHtml, placeholderText) {
    return '<option value="">' + escapeHtml(placeholderText) + "</option>";
  }
  function buildPromptTemplateMarkup(templates, escapeAttr, escapeHtml) {
    return templates.map(function(template) {
      return '<option value="' + escapeAttr(template.path) + '">' + escapeHtml(template.name) + "</option>";
    }).join("");
  }
  function updatePromptTemplateOptions(params) {
    var templateSelect = params.templateSelect;
    if (!templateSelect) {
      return;
    }
    var selectedPath = params.selectedPath || "";
    var promptTemplates = Array.isArray(params.promptTemplates) ? params.promptTemplates : [];
    var currentSource = params.source || "inline";
    var placeholderText = params.strings && params.strings.placeholderSelectTemplate || "";
    var escapeHtml = params.escapeHtml;
    var escapeAttr = params.escapeAttr;
    var placeholder = buildPromptTemplatePlaceholder(escapeHtml, placeholderText);
    var filteredTemplates = promptTemplates.filter(function(template) {
      return template && template.source === currentSource;
    });
    var optionMarkup = placeholder + buildPromptTemplateMarkup(filteredTemplates, escapeAttr, escapeHtml);
    templateSelect.innerHTML = optionMarkup;
    if (!selectedPath) {
      var emptyValue = "";
      templateSelect.value = emptyValue;
      return;
    }
    var nextTemplateValue = selectedPath;
    templateSelect.value = nextTemplateValue;
    if (templateSelect.value !== nextTemplateValue) {
      templateSelect.value = "";
    }
  }
  function applyPromptSourceUi(params) {
    var effectiveSource = params.source || "inline";
    var templateSelect = params.templateSelect;
    var promptTextEl = params.promptTextEl;
    var templateSelectGroup = params.templateSelectGroup;
    var promptGroup = params.promptGroup;
    var keepSelection = params.keepSelection === true;
    var selectedPath = keepSelection && templateSelect ? templateSelect.value : "";
    var usesInlinePrompt = effectiveSource === "inline";
    if (promptTextEl) {
      promptTextEl.required = usesInlinePrompt;
    }
    if (templateSelect) {
      templateSelect.required = !usesInlinePrompt;
    }
    if (templateSelectGroup) {
      templateSelectGroup.style.display = usesInlinePrompt ? "none" : "block";
    } else if (!usesInlinePrompt && typeof params.warnMissingTemplateGroup === "function") {
      params.warnMissingTemplateGroup();
    }
    if (promptGroup) {
      promptGroup.style.display = "block";
    }
    if (usesInlinePrompt) {
      var shouldClearSelection = !keepSelection && templateSelect;
      if (shouldClearSelection) {
        templateSelect.value = "";
      }
      return;
    }
    updatePromptTemplateOptions({
      templateSelect,
      promptTemplates: params.promptTemplates,
      source: effectiveSource,
      selectedPath,
      strings: params.strings,
      escapeHtml: params.escapeHtml,
      escapeAttr: params.escapeAttr
    });
  }
  function syncPromptTemplatesFromMessage(params) {
    var templateSelect = params.templateSelect;
    var currentTemplateValue = params.pendingTemplatePath || (templateSelect ? templateSelect.value : "");
    updatePromptTemplateOptions({
      templateSelect,
      promptTemplates: params.promptTemplates,
      source: params.currentSource,
      selectedPath: currentTemplateValue,
      strings: params.strings,
      escapeHtml: params.escapeHtml,
      escapeAttr: params.escapeAttr
    });
    var nextPendingTemplatePath = restorePendingSelectValue(
      templateSelect,
      currentTemplateValue
    );
    if (params.templateSelectGroup) {
      params.templateSelectGroup.style.display = params.currentSource === "local" || params.currentSource === "global" ? "block" : "none";
    }
    return nextPendingTemplatePath;
  }

  // media/cockpitWebviewTaskCards.js
  function buildTaskInlineSelect(params) {
    var items = Array.isArray(params.items) ? params.items : [];
    var selectedId = params.selectedId || "";
    var fallbackSelectedId = params.fallbackSelectedId || "";
    var effectiveSelectedId = selectedId || fallbackSelectedId;
    var hasSelectedOption = !selectedId;
    var options = '<option value="">' + params.escapeHtml(params.placeholder || "") + "</option>";
    items.forEach(function(item) {
      var id = item && (item.id || item.slug);
      if (!id) {
        return;
      }
      var label = params.getLabel(item, id);
      if (id === selectedId) {
        hasSelectedOption = true;
      }
      options += '<option value="' + params.escapeAttr(id) + '"' + (id === effectiveSelectedId ? " selected" : "") + ">" + params.escapeHtml(label) + "</option>";
    });
    if (selectedId && !hasSelectedOption) {
      options += '<option value="' + params.escapeAttr(selectedId) + '" selected>' + params.escapeHtml(selectedId) + "</option>";
    }
    return '<select class="task-inline-select ' + params.className + '" data-id="' + params.taskId + '">' + options + "</select>";
  }
  function buildTaskConfigRowMarkup(params) {
    var agentSelect = buildTaskInlineSelect({
      items: params.agents,
      selectedId: params.task && params.task.agent,
      className: "task-agent-select",
      placeholder: params.strings.placeholderSelectAgent || "Agent",
      fallbackSelectedId: params.executionDefaults && params.executionDefaults.agent,
      taskId: params.taskId,
      escapeAttr: params.escapeAttr,
      escapeHtml: params.escapeHtml,
      getLabel: function(item, id) {
        return item && item.name || id;
      }
    });
    var modelSelect = buildTaskInlineSelect({
      items: params.models,
      selectedId: params.task && params.task.model,
      className: "task-model-select",
      placeholder: params.strings.placeholderSelectModel || "Model",
      fallbackSelectedId: params.executionDefaults && params.executionDefaults.model,
      taskId: params.taskId,
      escapeAttr: params.escapeAttr,
      escapeHtml: params.escapeHtml,
      getLabel: function(item, id) {
        return params.formatModelLabel(item || { id, name: id });
      }
    });
    return '<div class="task-config">' + agentSelect + modelSelect + "</div>";
  }
  function buildBaseTaskActionsMarkup(params) {
    var createActionButton = function(button) {
      return '<button class="' + button.className + '" data-action="' + button.action + '" data-id="' + params.taskId + '" title="' + params.escapeAttr(button.title) + '">' + button.icon + "</button>";
    };
    return [
      {
        className: "btn-secondary btn-icon",
        action: "toggle",
        title: params.toggleTitle,
        icon: params.toggleIcon
      },
      {
        className: "btn-secondary btn-icon",
        action: "run",
        title: params.strings.actionRun,
        icon: "\u{1F680}"
      },
      {
        className: "btn-secondary btn-icon",
        action: "edit",
        title: params.strings.actionEdit,
        icon: "\u270F\uFE0F"
      },
      {
        className: "btn-secondary btn-icon",
        action: "copy",
        title: params.strings.actionCopyPrompt,
        icon: "\u{1F4CB}"
      },
      {
        className: "btn-secondary btn-icon",
        action: "duplicate",
        title: params.strings.actionDuplicate,
        icon: "\u{1F4C4}"
      }
    ].map(createActionButton).join("");
  }

  // media/cockpitWebviewTaskActions.js
  function getConnectedTaskList(taskList, getTaskList) {
    if (taskList && taskList.isConnected) {
      return taskList;
    }
    return getTaskList();
  }
  function handleTaskListClick(params) {
    var event = params.event;
    var taskList = params.taskList;
    var getTaskList = params.getTaskList;
    var readyTodoOpenTarget = params.getClosestEventTarget(
      event.target,
      "[data-ready-todo-open]"
    );
    if (readyTodoOpenTarget) {
      taskList = getConnectedTaskList(taskList, getTaskList);
      if (taskList && taskList.contains(readyTodoOpenTarget)) {
        event.preventDefault();
        var openTodoId = readyTodoOpenTarget.getAttribute("data-ready-todo-open");
        if (openTodoId) {
          params.openTodoEditor(openTodoId);
        }
        return true;
      }
    }
    var actionTarget = params.resolveActionTarget(event.target);
    if (!actionTarget) {
      return false;
    }
    taskList = getConnectedTaskList(taskList, getTaskList);
    if (taskList && !taskList.contains(actionTarget)) {
      return false;
    }
    var action = actionTarget.getAttribute("data-action");
    var taskId = actionTarget.getAttribute("data-id");
    var hasTaskAction = Boolean(action && taskId);
    if (!hasTaskAction) {
      return false;
    }
    var handler = params.actionHandlers[action];
    if (typeof handler !== "function") {
      return false;
    }
    event.preventDefault();
    handler(taskId);
    return true;
  }

  // media/cockpitWebviewTaskSelectState.js
  function selectHasOptionValue(selectEl, value) {
    if (!selectEl) return false;
    if (!value) return false;
    var optionCollection = selectEl.options;
    if (!optionCollection || typeof optionCollection.length !== "number") return false;
    for (var index = 0; index < optionCollection.length; index++) {
      var currentOption = optionCollection[index];
      if (currentOption && currentOption.value === value) return true;
    }
    return false;
  }
  function populateAgentDropdown(params) {
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
  function populateModelDropdown(params) {
    var modelSelect = params.modelSelect;
    if (!modelSelect) return;
    var items = Array.isArray(params.models) ? params.models : [];
    var escapeAttr = params.escapeAttr;
    var escapeHtml = params.escapeHtml;
    var strings = params.strings || {};
    var executionDefaults = params.executionDefaults || {};
    var formatModelLabel2 = params.formatModelLabel;
    if (items.length === 0) {
      var noText = strings.placeholderNoModels || "";
      modelSelect.innerHTML = '<option value="">' + escapeHtml(noText) + "</option>";
      return;
    }
    var selectText = strings.placeholderSelectModel || "";
    var placeholder = '<option value="">' + escapeHtml(selectText) + "</option>";
    modelSelect.innerHTML = placeholder + items.map(function(model) {
      return '<option value="' + escapeAttr(model.id) + '">' + escapeHtml(formatModelLabel2(model)) + "</option>";
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

  // media/cockpitWebviewDisplayUtils.js
  function pickPathLeaf(value) {
    if (!value) {
      return "";
    }
    var normalized = String(value);
    var lastBackslash = normalized.lastIndexOf("\\");
    var lastSlash = normalized.lastIndexOf("/");
    return normalized.substring(Math.max(lastBackslash, lastSlash) + 1);
  }
  function decodeFileLikePath(value) {
    if (!value) {
      return "";
    }
    var normalized = String(value);
    if (!/^file:\/\/\/?/i.test(normalized)) {
      return pickPathLeaf(normalized);
    }
    try {
      var parsed = new URL(normalized);
      if (parsed.protocol === "file:") {
        return pickPathLeaf(decodeURIComponent(parsed.pathname || ""));
      }
    } catch (_error) {
    }
    return pickPathLeaf(normalized.replace(/^file:\/\/\/?/i, ""));
  }
  function inferModelSourceName(model) {
    var fragments = [
      model && model.id,
      model && model.name,
      model && model.vendor,
      model && model.description
    ].filter(Boolean).map(function(value) {
      return String(value).trim().toLowerCase();
    }).join(" ");
    if (fragments.indexOf("openrouter") >= 0) {
      return "OpenRouter";
    }
    if (fragments.indexOf("copilot") >= 0 || fragments.indexOf("codex") >= 0 || fragments.indexOf("github") >= 0 || fragments.indexOf("microsoft") >= 0) {
      return "Copilot";
    }
    return model && model.vendor ? String(model.vendor).trim() : "";
  }
  function formatModelLabel(model) {
    var displayName = model && (model.name || model.id) ? String(model.name || model.id).trim() : "";
    var sourceName = inferModelSourceName(model);
    return !sourceName || sourceName.toLowerCase() === displayName.toLowerCase() ? displayName : displayName + " \u2022 " + sourceName;
  }
  function formatCountdown(totalSeconds) {
    var remainingSeconds = Math.max(0, Math.floor(totalSeconds));
    var units = [
      ["y", 365 * 24 * 60 * 60],
      ["mo", 30 * 24 * 60 * 60],
      ["w", 7 * 24 * 60 * 60],
      ["d", 24 * 60 * 60],
      ["h", 60 * 60],
      ["m", 60],
      ["s", 1]
    ];
    var parts = [];
    units.forEach(function(entry) {
      var label = entry[0];
      var seconds = entry[1];
      if (remainingSeconds < seconds) {
        return;
      }
      var count = Math.floor(remainingSeconds / seconds);
      remainingSeconds -= count * seconds;
      parts.push(String(count) + label);
    });
    return parts.length > 0 ? parts.join(" ") : "0s";
  }
  function getNextRunCountdownText(enabled, nextRunMs, nowMs) {
    if (!enabled || !isFinite(nextRunMs) || nextRunMs <= 0) {
      return "";
    }
    var referenceNow = typeof nowMs === "number" ? nowMs : Date.now();
    var remainingMs = nextRunMs - referenceNow;
    return remainingMs > 0 ? " (in " + formatCountdown(Math.floor(remainingMs / 1e3)) + ")" : " (due now)";
  }
  function sanitizeAbsolutePaths(text) {
    if (!text) {
      return "";
    }
    return String(text).replace(/'(file:\/\/[^']+)'/gi, function(_match, captured) {
      return "'" + decodeFileLikePath(captured) + "'";
    }).replace(/"(file:\/\/[^"]+)"/gi, function(_match, captured) {
      return '"' + decodeFileLikePath(captured) + '"';
    }).replace(/file:\/\/[^\s"'`]+/gi, function(captured) {
      return decodeFileLikePath(captured);
    }).replace(/'((?:[A-Za-z]:(?:\\|\/)|\\\\)[^']+)'/g, function(_match, captured) {
      return "'" + decodeFileLikePath(captured) + "'";
    }).replace(/"((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"]+)"/g, function(_match, captured) {
      return '"' + decodeFileLikePath(captured) + '"';
    }).replace(/(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g, function(_match, prefix, captured) {
      return String(prefix) + decodeFileLikePath(captured);
    }).replace(/'(\/[^']+)'/g, function(_match, captured) {
      return "'" + decodeFileLikePath(captured) + "'";
    }).replace(/"(\/[^\"]+)"/g, function(_match, captured) {
      return '"' + decodeFileLikePath(captured) + '"';
    }).replace(/(^|[\s(])(\/[^\s"'`]+)/g, function(_match, prefix, captured) {
      return String(prefix) + decodeFileLikePath(captured);
    });
  }
  function normalizeDefaultJitterSeconds(rawValue) {
    var parsed = typeof rawValue === "number" ? rawValue : Number(rawValue);
    if (!isFinite(parsed)) {
      return 600;
    }
    return Math.max(0, Math.min(1800, Math.floor(parsed)));
  }

  // media/cockpitWebviewBootstrap.js
  function parseBootstrapPayload(documentRef) {
    var scriptNode = documentRef.getElementById("initial-data");
    if (!scriptNode || !scriptNode.textContent) {
      return {};
    }
    try {
      return JSON.parse(scriptNode.textContent) || {};
    } catch (_error) {
      return {};
    }
  }
  function resolveLogLevel(payload) {
    return typeof payload.logLevel === "string" && payload.logLevel ? payload.logLevel : "info";
  }
  function resolveLogDirectory(payload) {
    return typeof payload.logDirectory === "string" ? payload.logDirectory : "";
  }
  function readInitialWebviewBootstrap(documentRef) {
    var payload = parseBootstrapPayload(documentRef);
    var strings = payload && payload.strings ? payload.strings : {};
    return {
      initialData: payload,
      strings,
      currentLogLevel: resolveLogLevel(payload),
      currentLogDirectory: resolveLogDirectory(payload)
    };
  }
  function firstErrorLine(reason, unknownText) {
    var raw = unknownText || "";
    var resolvedReason = reason;
    if (typeof resolvedReason === "string") {
      raw = resolvedReason;
    } else if (resolvedReason) {
      var reasonMessage = typeof resolvedReason === "object" && "message" in resolvedReason ? resolvedReason.message : resolvedReason;
      raw = String(reasonMessage);
    }
    return String(raw).split(/\r?\n/)[0];
  }
  function installGlobalErrorHandlers(params) {
    params.window.onerror = function(messageText, _url, line) {
      var prefix = params.strings.webviewScriptErrorPrefix || "";
      var linePrefix = params.strings.webviewLinePrefix || "";
      var lineSuffix = params.strings.webviewLineSuffix || "";
      params.showGlobalError(
        prefix + params.sanitizeAbsolutePaths(String(messageText)) + linePrefix + String(line) + lineSuffix
      );
    };
    params.window.onunhandledrejection = function(event) {
      var prefix = params.strings.webviewUnhandledErrorPrefix || "";
      params.showGlobalError(
        prefix + params.sanitizeAbsolutePaths(
          firstErrorLine(
            event && event.reason ? event.reason : null,
            params.strings.webviewUnknown || ""
          )
        )
      );
    };
  }

  // media/cockpitWebviewInitialState.js
  function readArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function createInitialSchedulerWebviewState(initialData, normalizeStorageSettings) {
    var data = initialData || {};
    return {
      storageSettings: normalizeStorageSettings(data.storageSettings),
      researchProfiles: readArray(data.researchProfiles),
      activeResearchRun: data.activeResearchRun || null,
      recentResearchRuns: readArray(data.recentResearchRuns),
      agents: readArray(data.agents),
      models: readArray(data.models),
      promptTemplates: readArray(data.promptTemplates),
      skills: readArray(data.skills),
      cockpitHistory: readArray(data.cockpitHistory),
      defaultChatSession: data.defaultChatSession === "continue" ? "continue" : "new",
      autoShowOnStartup: !!data.autoShowOnStartup,
      workspacePaths: readArray(data.workspacePaths),
      caseInsensitivePaths: !!data.caseInsensitivePaths
    };
  }

  // media/cockpitWebviewDomRefs.js
  function createSchedulerWebviewDomRefs(document2) {
    return {
      taskForm: document2.getElementById("task-form"),
      taskList: document2.getElementById("task-list"),
      editTaskIdInput: document2.getElementById("edit-task-id"),
      submitBtn: document2.getElementById("submit-btn"),
      testBtn: document2.getElementById("test-btn"),
      refreshBtn: document2.getElementById("refresh-btn"),
      autoShowStartupBtn: document2.getElementById("auto-show-startup-btn"),
      cockpitHistorySelect: document2.getElementById("schedule-history-select"),
      restoreHistoryBtn: document2.getElementById("restore-history-btn"),
      autoShowStartupNote: document2.getElementById("auto-show-startup-note"),
      friendlyBuilder: document2.getElementById("friendly-builder"),
      recurringScheduleGroup: document2.getElementById("recurring-schedule-group"),
      oneTimeDelayGroup: document2.getElementById("one-time-delay-group"),
      cronPreset: document2.getElementById("cron-preset"),
      cronExpression: document2.getElementById("cron-expression"),
      oneTimeDelayHours: document2.getElementById("one-time-delay-hours"),
      oneTimeDelayMinutes: document2.getElementById("one-time-delay-minutes"),
      oneTimeDelaySeconds: document2.getElementById("one-time-delay-seconds"),
      oneTimeDelayPreviewText: document2.getElementById("one-time-delay-preview-text"),
      agentSelect: document2.getElementById("agent-select"),
      modelSelect: document2.getElementById("model-select"),
      chatSessionGroup: document2.getElementById("chat-session-group"),
      chatSessionSelect: document2.getElementById("chat-session"),
      templateSelect: document2.getElementById("template-select"),
      templateSelectGroup: document2.getElementById("template-select-group"),
      templateRefreshBtn: document2.getElementById("template-refresh-btn"),
      skillSelect: document2.getElementById("skill-select"),
      skillDetailsNote: document2.getElementById("skill-details-note"),
      insertSkillBtn: document2.getElementById("insert-skill-btn"),
      setupMcpBtn: document2.getElementById("setup-mcp-btn"),
      setupCodexBtn: document2.getElementById("setup-codex-btn"),
      setupCodexSkillsBtn: document2.getElementById("setup-codex-skills-btn"),
      syncBundledSkillsBtn: document2.getElementById("sync-bundled-skills-btn"),
      stageBundledAgentsBtn: document2.getElementById("stage-bundled-agents-btn"),
      syncBundledAgentsBtn: document2.getElementById("sync-bundled-agents-btn"),
      openCopilotSettingsBtn: document2.getElementById("open-copilot-settings-btn"),
      openExtensionSettingsBtn: document2.getElementById("open-extension-settings-btn"),
      refreshStorageStatusBtn: document2.getElementById("refresh-storage-status-btn"),
      settingsStatusRefreshNote: document2.getElementById("settings-status-refresh-note"),
      importStorageFromJsonBtn: document2.getElementById("import-storage-from-json-btn"),
      exportStorageToJsonBtn: document2.getElementById("export-storage-to-json-btn"),
      helpLanguageSelect: document2.getElementById("help-language-select"),
      settingsLanguageSelect: document2.getElementById("settings-language-select"),
      helpWarpLayer: document2.getElementById("help-warp-layer"),
      helpIntroRocket: document2.getElementById("help-intro-rocket"),
      promptGroup: document2.getElementById("prompt-group"),
      promptTextEl: document2.getElementById("prompt-text"),
      jitterSecondsInput: document2.getElementById("jitter-seconds"),
      friendlyFrequency: document2.getElementById("friendly-frequency"),
      friendlyInterval: document2.getElementById("friendly-interval"),
      friendlyMinute: document2.getElementById("friendly-minute"),
      friendlyHour: document2.getElementById("friendly-hour"),
      friendlyDow: document2.getElementById("friendly-dow"),
      friendlyDom: document2.getElementById("friendly-dom"),
      openGuruBtn: document2.getElementById("open-guru-btn"),
      cronPreviewText: document2.getElementById("cron-preview-text"),
      newTaskBtn: document2.getElementById("new-task-btn"),
      taskFilterBar: document2.getElementById("task-filter-bar"),
      taskLabelFilter: document2.getElementById("task-label-filter"),
      taskLabelsInput: document2.getElementById("task-labels"),
      runFirstGroup: document2.getElementById("run-first-group"),
      jobsFolderList: document2.getElementById("jobs-folder-list"),
      jobsCurrentFolderBanner: document2.getElementById("jobs-current-folder-banner"),
      jobsList: document2.getElementById("jobs-list"),
      jobsEmptyState: document2.getElementById("jobs-empty-state"),
      jobsDetails: document2.getElementById("jobs-details"),
      jobsLayout: document2.getElementById("jobs-layout"),
      jobsToggleSidebarBtn: document2.getElementById("jobs-toggle-sidebar-btn"),
      jobsShowSidebarBtn: document2.getElementById("jobs-show-sidebar-btn"),
      jobsNewFolderBtn: document2.getElementById("jobs-new-folder-btn"),
      jobsRenameFolderBtn: document2.getElementById("jobs-rename-folder-btn"),
      jobsDeleteFolderBtn: document2.getElementById("jobs-delete-folder-btn"),
      jobsNewJobBtn: document2.getElementById("jobs-new-job-btn"),
      jobsSaveBtn: document2.getElementById("jobs-save-btn"),
      jobsSaveDeckBtn: document2.getElementById("jobs-save-deck-btn"),
      jobsDuplicateBtn: document2.getElementById("jobs-duplicate-btn"),
      jobsPauseBtn: document2.getElementById("jobs-pause-btn"),
      jobsCompileBtn: document2.getElementById("jobs-compile-btn"),
      jobsDeleteBtn: document2.getElementById("jobs-delete-btn"),
      jobsBackBtn: document2.getElementById("jobs-back-btn"),
      jobsOpenEditorBtn: document2.getElementById("jobs-open-editor-btn"),
      tabBar: document2.querySelector(".tab-bar"),
      boardFilterSticky: document2.getElementById("board-filter-sticky"),
      boardSummary: document2.getElementById("board-summary"),
      githubBoardInboxRoot: document2.getElementById("github-board-inbox-root"),
      boardColumns: document2.getElementById("board-columns"),
      todoToggleFiltersBtn: document2.getElementById("todo-toggle-filters-btn"),
      todoSearchInput: document2.getElementById("todo-search-input"),
      todoSectionFilter: document2.getElementById("todo-section-filter"),
      todoLabelFilter: document2.getElementById("todo-label-filter"),
      todoFlagFilter: document2.getElementById("todo-flag-filter"),
      todoPriorityFilter: document2.getElementById("todo-priority-filter"),
      todoStatusFilter: document2.getElementById("todo-status-filter"),
      todoArchiveOutcomeFilter: document2.getElementById("todo-archive-outcome-filter"),
      todoSortBy: document2.getElementById("todo-sort-by"),
      todoSortDirection: document2.getElementById("todo-sort-direction"),
      todoViewMode: document2.getElementById("todo-view-mode"),
      todoShowRecurringTasks: document2.getElementById("todo-show-recurring-tasks"),
      todoShowArchived: document2.getElementById("todo-show-archived"),
      todoHideCardDetails: document2.getElementById("todo-hide-card-details"),
      todoNewBtn: document2.getElementById("todo-new-btn"),
      todoClearSelectionBtn: document2.getElementById("todo-clear-selection-btn"),
      todoClearFiltersBtn: document2.getElementById("todo-clear-filters-btn"),
      todoBackBtn: document2.getElementById("todo-back-btn"),
      todoDetailTitle: document2.getElementById("todo-detail-title"),
      todoDetailModeNote: document2.getElementById("todo-detail-mode-note"),
      todoDetailForm: document2.getElementById("todo-detail-form"),
      todoDetailId: document2.getElementById("todo-detail-id"),
      todoTitleInput: document2.getElementById("todo-title-input"),
      todoDescriptionInput: document2.getElementById("todo-description-input"),
      todoDueInput: document2.getElementById("todo-due-input"),
      todoPriorityInput: document2.getElementById("todo-priority-input"),
      todoSectionInput: document2.getElementById("todo-section-input"),
      todoLinkedTaskSelect: document2.getElementById("todo-linked-task-select"),
      todoDetailStatus: document2.getElementById("todo-detail-status"),
      todoLabelChipList: document2.getElementById("todo-label-chip-list"),
      todoLabelsInput: document2.getElementById("todo-labels-input"),
      todoLabelSuggestions: document2.getElementById("todo-label-suggestions"),
      todoLabelColorInput: document2.getElementById("todo-label-color-input"),
      todoLabelAddBtn: document2.getElementById("todo-label-add-btn"),
      todoLabelColorSaveBtn: document2.getElementById("todo-label-color-save-btn"),
      todoLabelCatalog: document2.getElementById("todo-label-catalog"),
      todoFlagNameInput: document2.getElementById("todo-flag-name-input"),
      todoFlagColorInput: document2.getElementById("todo-flag-color-input"),
      todoFlagAddBtn: document2.getElementById("todo-flag-add-btn"),
      todoFlagColorSaveBtn: document2.getElementById("todo-flag-color-save-btn"),
      todoLinkedTaskNote: document2.getElementById("todo-linked-task-note"),
      todoSaveBtn: document2.getElementById("todo-save-btn"),
      todoCreateTaskBtn: document2.getElementById("todo-create-task-btn"),
      todoCompleteBtn: document2.getElementById("todo-complete-btn"),
      todoDeleteBtn: document2.getElementById("todo-delete-btn"),
      todoUploadFilesBtn: document2.getElementById("todo-upload-files-btn"),
      todoUploadFilesNote: document2.getElementById("todo-upload-files-note"),
      todoCommentList: document2.getElementById("todo-comment-list"),
      todoCommentInput: document2.getElementById("todo-comment-input"),
      todoAddCommentBtn: document2.getElementById("todo-add-comment-btn"),
      todoCommentCountBadge: document2.getElementById("todo-comment-count-badge"),
      todoCommentModePill: document2.getElementById("todo-comment-mode-pill"),
      todoCommentContextNote: document2.getElementById("todo-comment-context-note"),
      todoCommentComposerTitle: document2.getElementById("todo-comment-composer-title"),
      todoCommentComposerNote: document2.getElementById("todo-comment-composer-note"),
      todoCommentDraftStatus: document2.getElementById("todo-comment-draft-status"),
      todoCommentThreadNote: document2.getElementById("todo-comment-thread-note"),
      jobsNameInput: document2.getElementById("jobs-name-input"),
      jobsCronPreset: document2.getElementById("jobs-cron-preset"),
      jobsCronInput: document2.getElementById("jobs-cron-input"),
      jobsCronPreviewText: document2.getElementById("jobs-cron-preview-text"),
      jobsOpenGuruBtn: document2.getElementById("jobs-open-guru-btn"),
      jobsFriendlyBuilder: document2.getElementById("jobs-friendly-builder"),
      jobsFriendlyFrequency: document2.getElementById("jobs-friendly-frequency"),
      jobsFriendlyInterval: document2.getElementById("jobs-friendly-interval"),
      jobsFriendlyMinute: document2.getElementById("jobs-friendly-minute"),
      jobsFriendlyHour: document2.getElementById("jobs-friendly-hour"),
      jobsFriendlyDow: document2.getElementById("jobs-friendly-dow"),
      jobsFriendlyDom: document2.getElementById("jobs-friendly-dom"),
      jobsFolderSelect: document2.getElementById("jobs-folder-select"),
      jobsStatusPill: document2.getElementById("jobs-status-pill"),
      jobsTimelineInline: document2.getElementById("jobs-timeline-inline"),
      jobsWorkflowMetrics: document2.getElementById("jobs-workflow-metrics"),
      jobsStepList: document2.getElementById("jobs-step-list"),
      jobsPauseNameInput: document2.getElementById("jobs-pause-name-input"),
      jobsCreatePauseBtn: document2.getElementById("jobs-create-pause-btn"),
      jobsExistingTaskSelect: document2.getElementById("jobs-existing-task-select"),
      jobsExistingWindowInput: document2.getElementById("jobs-existing-window-input"),
      jobsAttachBtn: document2.getElementById("jobs-attach-btn"),
      jobsStepNameInput: document2.getElementById("jobs-step-name-input"),
      jobsStepWindowInput: document2.getElementById("jobs-step-window-input"),
      jobsStepPromptInput: document2.getElementById("jobs-step-prompt-input"),
      jobsStepAgentSelect: document2.getElementById("jobs-step-agent-select"),
      jobsStepModelSelect: document2.getElementById("jobs-step-model-select"),
      jobsStepLabelsInput: document2.getElementById("jobs-step-labels-input"),
      jobsCreateStepBtn: document2.getElementById("jobs-create-step-btn"),
      researchNewBtn: document2.getElementById("research-new-btn"),
      researchLoadAutoAgentExampleBtn: document2.getElementById("research-load-autoagent-example-btn"),
      researchSaveBtn: document2.getElementById("research-save-btn"),
      researchDuplicateBtn: document2.getElementById("research-duplicate-btn"),
      researchDeleteBtn: document2.getElementById("research-delete-btn"),
      researchStartBtn: document2.getElementById("research-start-btn"),
      researchStopBtn: document2.getElementById("research-stop-btn"),
      researchEditIdInput: document2.getElementById("research-edit-id"),
      researchNameInput: document2.getElementById("research-name"),
      researchInstructionsInput: document2.getElementById("research-instructions"),
      researchEditablePathsInput: document2.getElementById("research-editable-paths"),
      researchBenchmarkInput: document2.getElementById("research-benchmark-command"),
      researchMetricPatternInput: document2.getElementById("research-metric-pattern"),
      researchMetricDirectionSelect: document2.getElementById("research-metric-direction"),
      researchMaxIterationsInput: document2.getElementById("research-max-iterations"),
      researchMaxMinutesInput: document2.getElementById("research-max-minutes"),
      researchMaxFailuresInput: document2.getElementById("research-max-failures"),
      researchBenchmarkTimeoutInput: document2.getElementById("research-benchmark-timeout"),
      researchEditWaitInput: document2.getElementById("research-edit-wait"),
      researchAgentSelect: document2.getElementById("research-agent-select"),
      researchModelSelect: document2.getElementById("research-model-select"),
      researchProfileList: document2.getElementById("research-profile-list"),
      researchRunList: document2.getElementById("research-run-list"),
      researchRunTitle: document2.getElementById("research-run-title"),
      researchFormError: document2.getElementById("research-form-error"),
      researchActiveEmpty: document2.getElementById("research-active-empty"),
      researchActiveDetails: document2.getElementById("research-active-details"),
      researchActiveStatus: document2.getElementById("research-active-status"),
      researchActiveBest: document2.getElementById("research-active-best"),
      researchActiveAttempts: document2.getElementById("research-active-attempts"),
      researchActiveLastOutcome: document2.getElementById("research-active-last-outcome"),
      researchActiveMeta: document2.getElementById("research-active-meta"),
      researchAttemptList: document2.getElementById("research-attempt-list"),
      githubIntegrationEnabledInput: document2.getElementById("github-integration-enabled"),
      githubIntegrationOwnerInput: document2.getElementById("github-integration-owner"),
      githubIntegrationRepoInput: document2.getElementById("github-integration-repo"),
      githubIntegrationApiBaseUrlInput: document2.getElementById("github-integration-api-base-url"),
      githubIntegrationAutomationPromptTemplateInput: document2.getElementById("github-integration-automation-prompt-template"),
      githubIntegrationSaveBtn: document2.getElementById("github-integration-save-btn"),
      githubIntegrationRefreshBtn: document2.getElementById("github-integration-refresh-btn"),
      githubIntegrationFeedback: document2.getElementById("github-integration-feedback"),
      githubIntegrationStatusValue: document2.getElementById("github-integration-status-value"),
      githubIntegrationRepositoryStatus: document2.getElementById("github-integration-repository-status"),
      githubIntegrationConnectionStatus: document2.getElementById("github-integration-connection-status"),
      githubIntegrationLastSyncAt: document2.getElementById("github-integration-last-sync-at"),
      githubIntegrationUpdatedAt: document2.getElementById("github-integration-updated-at"),
      githubIntegrationStatusNote: document2.getElementById("github-integration-status-note"),
      telegramEnabledInput: document2.getElementById("telegram-enabled"),
      telegramBotTokenInput: document2.getElementById("telegram-bot-token"),
      telegramChatIdInput: document2.getElementById("telegram-chat-id"),
      telegramMessagePrefixInput: document2.getElementById("telegram-message-prefix"),
      telegramSaveBtn: document2.getElementById("telegram-save-btn"),
      telegramTestBtn: document2.getElementById("telegram-test-btn"),
      telegramFeedback: document2.getElementById("telegram-feedback"),
      telegramTokenStatus: document2.getElementById("telegram-token-status"),
      telegramChatStatus: document2.getElementById("telegram-chat-status"),
      telegramHookStatus: document2.getElementById("telegram-hook-status"),
      telegramUpdatedAt: document2.getElementById("telegram-updated-at"),
      telegramStatusNote: document2.getElementById("telegram-status-note"),
      defaultAgentSelect: document2.getElementById("default-agent-select"),
      defaultModelSelect: document2.getElementById("default-model-select"),
      executionDefaultsSaveBtn: document2.getElementById("execution-defaults-save-btn"),
      executionDefaultsNote: document2.getElementById("execution-defaults-note"),
      approvalModeSelect: document2.getElementById("settings-approval-mode-select"),
      approvalModeNote: document2.getElementById("settings-approval-mode-note"),
      needsBotReviewCommentTemplateInput: document2.getElementById("needs-bot-review-comment-template-input"),
      needsBotReviewPromptTemplateInput: document2.getElementById("needs-bot-review-prompt-template-input"),
      needsBotReviewAgentSelect: document2.getElementById("needs-bot-review-agent-select"),
      needsBotReviewModelSelect: document2.getElementById("needs-bot-review-model-select"),
      needsBotReviewChatSessionSelect: document2.getElementById("needs-bot-review-chat-session-select"),
      readyPromptTemplateInput: document2.getElementById("ready-prompt-template-input"),
      reviewDefaultsSaveBtn: document2.getElementById("review-defaults-save-btn"),
      reviewDefaultsNote: document2.getElementById("review-defaults-note"),
      settingsStorageModeSelect: document2.getElementById("settings-storage-mode-select"),
      settingsSearchProviderSelect: document2.getElementById("settings-search-provider-select"),
      settingsResearchProviderSelect: document2.getElementById("settings-research-provider-select"),
      settingsStorageMirrorInput: document2.getElementById("settings-storage-mirror-input"),
      settingsAutoIgnorePrivateFilesInput: document2.getElementById("settings-auto-ignore-private-files-input"),
      settingsFlagReadyInput: document2.getElementById("settings-flag-ready-input"),
      settingsFlagNeedsBotReviewInput: document2.getElementById("settings-flag-needs-bot-review-input"),
      settingsFlagNeedsUserReviewInput: document2.getElementById("settings-flag-needs-user-review-input"),
      settingsFlagNewInput: document2.getElementById("settings-flag-new-input"),
      settingsFlagOnScheduleListInput: document2.getElementById("settings-flag-on-schedule-list-input"),
      settingsFlagFinalUserCheckInput: document2.getElementById("settings-flag-final-user-check-input"),
      settingsStorageSaveBtn: document2.getElementById("settings-storage-save-btn"),
      settingsStorageNote: document2.getElementById("settings-storage-note"),
      settingsVersionValue: document2.getElementById("settings-version-value"),
      settingsMcpStatusValue: document2.getElementById("settings-mcp-status-value"),
      settingsMcpUpdatedValue: document2.getElementById("settings-mcp-updated-value"),
      settingsSkillsUpdatedValue: document2.getElementById("settings-skills-updated-value"),
      settingsAgentsUpdatedValue: document2.getElementById("settings-agents-updated-value"),
      settingsLogLevelSelect: document2.getElementById("settings-log-level-select"),
      settingsLogDirectoryInput: document2.getElementById("settings-log-directory"),
      settingsOpenLogFolderBtn: document2.getElementById("settings-open-log-folder-btn"),
      boardAddSectionBtn: document2.getElementById("board-add-section-btn"),
      boardSectionInlineForm: document2.getElementById("board-section-inline-form"),
      boardSectionNameInput: document2.getElementById("board-section-name-input"),
      boardSectionSaveBtn: document2.getElementById("board-section-save-btn"),
      boardSectionCancelBtn: document2.getElementById("board-section-cancel-btn"),
      cockpitColSlider: document2.getElementById("cockpit-col-slider")
    };
  }

  // media/cockpitWebviewBoardState.js
  function createBoardRenderState() {
    return {
      draggingTodoId: null,
      isBoardDragging: false,
      pendingBoardRender: false,
      scheduledBoardRenderFrame: 0
    };
  }
  function requestBoardRender(state, requestAnimationFrameImpl, renderBoard) {
    if (state.isBoardDragging) {
      state.pendingBoardRender = true;
      return;
    }
    if (state.scheduledBoardRenderFrame) {
      return;
    }
    state.scheduledBoardRenderFrame = requestAnimationFrameImpl(function() {
      state.scheduledBoardRenderFrame = 0;
      if (state.isBoardDragging) {
        state.pendingBoardRender = true;
        return;
      }
      renderBoard();
    });
  }
  function finishBoardDrag(state, resetSectionDragState, requestRender) {
    state.draggingTodoId = null;
    resetSectionDragState();
    state.isBoardDragging = false;
    if (!state.pendingBoardRender) {
      return;
    }
    state.pendingBoardRender = false;
    requestRender();
  }

  // media/cockpitWebviewDefaults.js
  function resolveInitialSchedulerCollections(initialData) {
    return {
      tasks: Array.isArray(initialData.tasks) ? initialData.tasks : [],
      jobs: Array.isArray(initialData.jobs) ? initialData.jobs : [],
      jobFolders: Array.isArray(initialData.jobFolders) ? initialData.jobFolders : [],
      cockpitBoard: initialData.cockpitBoard || {
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
          showRecurringTasks: false
        },
        updatedAt: ""
      },
      githubIntegration: initialData.githubIntegration || {
        enabled: false,
        hasConnection: false,
        syncStatus: "disabled",
        inbox: {
          issues: { items: [], itemCount: 0 },
          pullRequests: { items: [], itemCount: 0 },
          securityAlerts: { items: [], itemCount: 0 }
        },
        inboxCounts: {
          issues: 0,
          pullRequests: 0,
          securityAlerts: 0,
          total: 0
        }
      },
      telegramNotification: initialData.telegramNotification || {
        enabled: false,
        hasBotToken: false,
        hookConfigured: false
      },
      executionDefaults: initialData.executionDefaults || {
        agent: "agent",
        model: ""
      },
      reviewDefaults: initialData.reviewDefaults || {
        needsBotReviewCommentTemplate: "",
        needsBotReviewPromptTemplate: "",
        needsBotReviewAgent: "agent",
        needsBotReviewModel: "",
        needsBotReviewChatSession: "new",
        readyPromptTemplate: ""
      }
    };
  }
  function normalizeMcpSetupStatus(value, previousValue) {
    switch (value) {
      case "configured":
      case "missing":
      case "stale":
      case "invalid":
      case "workspace-required":
        return value;
      default:
        return previousValue || "workspace-required";
    }
  }
  function createStorageSettingsNormalizer(normalizeTodoLabelKey) {
    return function normalizeStorageSettings(value, previousValue) {
      var disabledSystemFlagKeys = Array.isArray(value && value.disabledSystemFlagKeys) ? value.disabledSystemFlagKeys.map(function(entry) {
        return normalizeTodoLabelKey(entry);
      }).filter(function(entry, index, values) {
        return !!entry && values.indexOf(entry) === index;
      }) : (previousValue && previousValue.disabledSystemFlagKeys || []).slice();
      var hasExplicitResearchProvider = !!value && Object.prototype.hasOwnProperty.call(value, "researchProvider");
      var hasExplicitAutoIgnorePrivateFiles = !!value && Object.prototype.hasOwnProperty.call(value, "autoIgnorePrivateFiles");
      var normalizedSearchProvider = value && value.searchProvider === "tavily" ? "tavily" : previousValue && previousValue.searchProvider || "built-in";
      var normalizedResearchProvider;
      if (hasExplicitResearchProvider) {
        normalizedResearchProvider = value && (value.researchProvider === "perplexity" || value.researchProvider === "tavily" || value.researchProvider === "google-grounded") ? value.researchProvider : "none";
      } else if (value && value.searchProvider === "perplexity") {
        normalizedResearchProvider = "perplexity";
      } else if (value && value.searchProvider === "tavily") {
        normalizedResearchProvider = "tavily";
      } else {
        normalizedResearchProvider = previousValue && previousValue.researchProvider || "none";
      }
      return {
        mode: value && value.mode === "json" ? "json" : "sqlite",
        searchProvider: normalizedSearchProvider,
        researchProvider: normalizedResearchProvider,
        sqliteJsonMirror: !value || value.sqliteJsonMirror !== false,
        autoIgnorePrivateFiles: hasExplicitAutoIgnorePrivateFiles ? value.autoIgnorePrivateFiles !== false : (previousValue && previousValue.autoIgnorePrivateFiles) !== false,
        disabledSystemFlagKeys,
        appVersion: value && typeof value.appVersion === "string" ? value.appVersion : previousValue && previousValue.appVersion || "",
        mcpSetupStatus: normalizeMcpSetupStatus(
          value && value.mcpSetupStatus,
          previousValue && previousValue.mcpSetupStatus
        ),
        lastMcpSupportUpdateAt: value && typeof value.lastMcpSupportUpdateAt === "string" ? value.lastMcpSupportUpdateAt : previousValue && previousValue.lastMcpSupportUpdateAt || "",
        lastBundledSkillsSyncAt: value && typeof value.lastBundledSkillsSyncAt === "string" ? value.lastBundledSkillsSyncAt : previousValue && previousValue.lastBundledSkillsSyncAt || "",
        lastBundledAgentsSyncAt: value && typeof value.lastBundledAgentsSyncAt === "string" ? value.lastBundledAgentsSyncAt : previousValue && previousValue.lastBundledAgentsSyncAt || ""
      };
    };
  }

  // media/cockpitWebviewTabState.js
  function forEachTabElement(document2, selector, callback) {
    Array.prototype.forEach.call(document2.querySelectorAll(selector), callback);
  }
  function activateSchedulerTab(document2, tabName) {
    forEachTabElement(document2, ".tab-button", function(button) {
      button.classList.remove("active");
    });
    forEachTabElement(document2, ".tab-content", function(content) {
      content.classList.remove("active");
    });
    var targetButton = document2.querySelector(
      '.tab-button[data-tab="' + tabName + '"]'
    );
    var targetContent = document2.getElementById(tabName + "-tab");
    if (targetButton) {
      targetButton.classList.add("active");
    }
    if (targetContent) {
      targetContent.classList.add("active");
    }
  }
  function bindSelectValueChange(control, onChange) {
    if (!control) {
      return;
    }
    control.addEventListener("change", function() {
      onChange(control);
    });
  }
  function bindGenericChange(control, handler) {
    if (!control) {
      return;
    }
    control.addEventListener("change", handler);
  }
  function bindTabButtons(document2, switchTab) {
    Array.prototype.forEach.call(
      document2.querySelectorAll(".tab-button[data-tab]"),
      function(button) {
        button.addEventListener("click", function(event) {
          event.preventDefault();
          var stopEvent = event.stopImmediatePropagation || event.stopPropagation;
          stopEvent.call(event);
          var selectedTabName = button.getAttribute("data-tab");
          if (selectedTabName) {
            switchTab(selectedTabName);
          }
        });
      }
    );
  }
  function bindTaskFilterBar(taskFilterBar, options) {
    if (!taskFilterBar) {
      return;
    }
    options.syncTaskFilterButtons();
    taskFilterBar.addEventListener("click", function(event) {
      var target = event && event.target;
      var filterButton = target || null;
      while (filterButton && filterButton !== taskFilterBar) {
        if (filterButton.getAttribute && filterButton.getAttribute("data-filter")) {
          break;
        }
        filterButton = filterButton.parentElement;
      }
      if (!filterButton || filterButton === taskFilterBar) {
        return;
      }
      var filterValue = filterButton.getAttribute("data-filter");
      if (!options.isValidTaskFilter(filterValue)) {
        return;
      }
      options.setActiveTaskFilter(filterValue);
      options.syncTaskFilterButtons();
      options.persistTaskFilter();
      options.renderTaskList();
    });
  }

  // media/cockpitWebviewBindings.js
  function bindInputFeedbackClear(elements, clearFeedback) {
    elements.forEach(function(element) {
      if (!element || typeof element.addEventListener !== "function") {
        return;
      }
      element.addEventListener("input", clearFeedback);
      element.addEventListener("change", clearFeedback);
    });
  }
  function bindClickAction(button, action) {
    if (!button || typeof button.addEventListener !== "function") {
      return;
    }
    button.addEventListener("click", action);
  }
  function bindSelectChange(select, onChange) {
    if (!select) {
      return;
    }
    var handleChange = function() {
      onChange(select);
    };
    select.addEventListener("change", handleChange);
  }
  function bindDocumentValueDelegates(document2, eventName, handlersById) {
    var handleDelegateEvent = function(event) {
      var target = event && event.target;
      if (!target || typeof target.id !== "string") {
        return;
      }
      var handler = handlersById[target.id];
      if (typeof handler === "function") {
        handler(target);
      }
    };
    document2.addEventListener(eventName, handleDelegateEvent);
  }
  function bindOpenCronGuruButton(button, getExpression, windowObject) {
    var fallbackExpression = "* * * * *";
    bindClickAction(button, function() {
      var expression = getExpression().trim();
      if (!expression) {
        expression = fallbackExpression;
      }
      var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
      windowObject.open(targetUrl, "_blank");
    });
  }
  function bindInlineTaskQuickUpdate(document2, vscode) {
    function postInlineTaskUpdate(target, data) {
      vscode.postMessage({
        type: "updateTask",
        taskId: target.getAttribute("data-id"),
        data
      });
    }
    document2.addEventListener("change", function(event) {
      var target = event && event.target;
      if (!target) {
        return;
      }
      if (target.classList.contains("task-agent-select")) {
        postInlineTaskUpdate(target, { agent: target.value });
        return;
      }
      if (target.classList.contains("task-model-select")) {
        postInlineTaskUpdate(target, { model: target.value });
      }
    });
  }

  // media/cockpitWebviewFormBindings.js
  function bindPromptSourceDelegation(document2, applyPromptSource) {
    document2.addEventListener("change", function(event) {
      var target = event && event.target;
      var isPromptSourceRadio = target && target.name === "prompt-source" && target.checked;
      if (isPromptSourceRadio) {
        applyPromptSource(String(target.value || ""));
      }
    });
  }
  function bindCronPresetPair(presetControl, valueControl, onSynchronized) {
    if (!presetControl || !valueControl) {
      return;
    }
    presetControl.addEventListener("change", function() {
      var nextPresetValue = presetControl.value;
      if (nextPresetValue) {
        valueControl.value = nextPresetValue;
      }
      onSynchronized();
    });
    valueControl.addEventListener("input", function() {
      presetControl.value = "";
      onSynchronized();
    });
  }
  function bindTemplateSelectionLoader(templateSelect, document2, vscode) {
    if (!templateSelect) {
      return;
    }
    templateSelect.addEventListener("change", function() {
      var selectedPath = templateSelect.value;
      if (!selectedPath) {
        return;
      }
      var promptSourceControl = document2.querySelector(
        'input[name="prompt-source"]:checked'
      );
      var templateMessage = {
        type: "loadPromptTemplate",
        path: selectedPath,
        source: promptSourceControl ? promptSourceControl.value : "inline"
      };
      vscode.postMessage(templateMessage);
    });
  }

  // media/cockpitWebviewTaskSubmit.js
  function showFormError(formErrorElement, message) {
    if (!formErrorElement) {
      return false;
    }
    formErrorElement.textContent = message;
    formErrorElement.style.display = "block";
    return true;
  }
  function getTrimmedValue(value) {
    return String(value || "").trim();
  }
  function normalizeOneTimeDelaySeconds(value) {
    var numericValue = typeof value === "number" ? value : Number(value);
    if (!isFinite(numericValue)) {
      return 0;
    }
    var wholeSeconds = Math.floor(numericValue);
    return wholeSeconds > 0 ? wholeSeconds : 0;
  }
  function validateTaskSubmission(options) {
    var taskData = options.taskData;
    var promptSourceValue = options.promptSourceValue;
    var formErr = options.formErr;
    var strings = options.strings;
    var editingTaskId = options.editingTaskId;
    var getTaskByIdLocal = options.getTaskByIdLocal;
    var nameValue = getTrimmedValue(taskData.name);
    if (!nameValue) {
      showFormError(formErr, strings.taskNameRequired || "");
      return false;
    }
    var templateValue = getTrimmedValue(taskData.promptPath);
    if (promptSourceValue !== "inline" && !templateValue) {
      showFormError(formErr, strings.templateRequired || "");
      return false;
    }
    var promptValue = getTrimmedValue(taskData.prompt);
    if (promptSourceValue !== "inline" && !promptValue && editingTaskId) {
      var editingTask = getTaskByIdLocal(editingTaskId);
      taskData.prompt = editingTask && typeof editingTask.prompt === "string" ? editingTask.prompt : "";
      promptValue = getTrimmedValue(taskData.prompt);
    }
    if (promptSourceValue === "inline" && !promptValue) {
      showFormError(formErr, strings.promptRequired || "");
      return false;
    }
    var cronValue = getTrimmedValue(taskData.cronExpression);
    if (taskData.oneTime) {
      if (normalizeOneTimeDelaySeconds(taskData.oneTimeDelaySeconds) < 1) {
        showFormError(
          formErr,
          strings.oneTimeDelayRequired || strings.invalidCronExpression || ""
        );
        return false;
      }
    } else if (!cronValue) {
      showFormError(
        formErr,
        strings.cronExpressionRequired || strings.invalidCronExpression || ""
      );
      return false;
    }
    return true;
  }
  function postTaskSubmission(vscode, editingTaskId, taskData) {
    var isEditing = Boolean(editingTaskId);
    var message = isEditing ? {
      type: "updateTask",
      taskId: String(editingTaskId),
      data: taskData
    } : {
      type: "createTask",
      data: taskData
    };
    vscode.postMessage(message);
    if (isEditing) {
      return;
    }
  }
  function buildTaskSubmissionData(options) {
    var editorState = options.editorState || {};
    var parsedLabels = options.parseLabels ? options.parseLabels(editorState.labels || "") : [];
    return {
      name: editorState.name || "",
      prompt: editorState.prompt || "",
      cronExpression: editorState.cronExpression || (editorState.oneTime ? "* * * * *" : ""),
      labels: parsedLabels,
      agent: editorState.agent || "",
      model: editorState.model || "",
      scope: editorState.scope || "workspace",
      promptSource: editorState.promptSource || "inline",
      promptPath: editorState.promptPath || "",
      runFirstInOneMinute: !!options.runFirstInOneMinute,
      oneTime: !!editorState.oneTime,
      oneTimeDelaySeconds: editorState.oneTime ? normalizeOneTimeDelaySeconds(editorState.oneTimeDelaySeconds) : 0,
      manualSession: !!editorState.manualSession,
      jitterSeconds: Number(editorState.jitterSeconds || 0),
      enabled: options.editingTaskId ? options.editingTaskEnabled : true,
      chatSession: editorState.oneTime ? "" : editorState.chatSession || "new"
    };
  }

  // media/cockpitWebviewToolbarBindings.js
  function postRefreshMessages(vscode) {
    ["refreshTasks", "refreshAgents", "refreshPrompts"].forEach(function(type) {
      vscode.postMessage({ type });
    });
  }
  function findHistoryEntry(entries, snapshotId) {
    return (Array.isArray(entries) ? entries : []).find(function(entry) {
      return entry && entry.id === snapshotId;
    });
  }
  function bindTaskTestButton(button, options) {
    bindClickAction(button, function() {
      var promptTextEl = options.document.getElementById("prompt-text");
      var prompt = promptTextEl ? promptTextEl.value : "";
      var agent = options.agentSelect ? options.agentSelect.value : "";
      var model = options.modelSelect ? options.modelSelect.value : "";
      if (!prompt) {
        return;
      }
      var promptMessage = Object.assign(
        { type: "testPrompt" },
        { prompt, agent, model }
      );
      options.vscode.postMessage(promptMessage);
    });
  }
  function bindRefreshButton(button, vscode) {
    bindClickAction(button, function() {
      postRefreshMessages(vscode);
    });
  }
  function bindAutoShowStartupButton(button, vscode) {
    bindClickAction(button, function() {
      vscode.postMessage({ type: "toggleAutoShowOnStartup" });
    });
  }
  function bindRestoreHistoryButton(button, options) {
    bindClickAction(button, function() {
      var snapshotId = options.cockpitHistorySelect ? options.cockpitHistorySelect.value : "";
      if (!snapshotId) {
        options.window.alert(
          options.strings.cockpitHistoryRestoreSelectRequired || "Select a backup version first"
        );
        return;
      }
      var selectedEntry = findHistoryEntry(options.cockpitHistory, snapshotId);
      var selectedLabel = options.formatHistoryLabel(selectedEntry);
      var confirmText = (options.strings.cockpitHistoryRestoreConfirm || "Restore the repo schedule from {createdAt}? The current state will be backed up first.").replace("{createdAt}", selectedLabel).replace("{timestamp}", selectedLabel);
      if (!options.window.confirm(confirmText)) {
        return;
      }
      options.vscode.postMessage({
        type: "restoreScheduleHistory",
        snapshotId
      });
    });
  }

  // media/cockpitWebviewJobBindings.js
  function bindJobToolbarButtons(options) {
    bindClickAction(options.jobsNewFolderBtn, function() {
      options.vscode.postMessage({
        type: "requestCreateJobFolder",
        parentFolderId: options.getSelectedJobFolderId() || void 0
      });
    });
    bindClickAction(options.jobsRenameFolderBtn, function() {
      var selectedJobFolderId = options.getSelectedJobFolderId();
      if (!selectedJobFolderId) return;
      options.vscode.postMessage({
        type: "requestRenameJobFolder",
        folderId: selectedJobFolderId
      });
    });
    bindClickAction(options.jobsDeleteFolderBtn, function() {
      var selectedJobFolderId = options.getSelectedJobFolderId();
      if (!selectedJobFolderId) return;
      options.vscode.postMessage({
        type: "requestDeleteJobFolder",
        folderId: selectedJobFolderId
      });
    });
    function requestCreateJob(switchToEditor) {
      options.setCreatingJob(true);
      options.syncEditorTabLabels();
      options.vscode.postMessage({
        type: "requestCreateJob",
        folderId: options.getSelectedJobFolderId() || void 0
      });
      if (switchToEditor) {
        options.switchTab("jobs-edit");
      }
    }
    bindClickAction(options.jobsNewJobBtn, function() {
      requestCreateJob(true);
    });
    bindClickAction(options.jobsEmptyNewBtn, function() {
      requestCreateJob(false);
    });
    bindClickAction(options.jobsBackBtn, function() {
      options.switchTab("jobs");
    });
    bindClickAction(options.jobsOpenEditorBtn, function() {
      options.openJobEditor(options.getSelectedJobId() || "");
    });
    bindClickAction(options.jobsSaveBtn, options.submitJobEditor);
    bindClickAction(options.jobsSaveDeckBtn, options.submitJobEditor);
    bindClickAction(options.jobsDuplicateBtn, function() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      options.vscode.postMessage({ type: "duplicateJob", jobId: selectedJobId });
    });
    function toggleSelectedJobPaused() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      options.vscode.postMessage({ type: "toggleJobPaused", jobId: selectedJobId });
    }
    bindClickAction(options.jobsPauseBtn, toggleSelectedJobPaused);
    bindClickAction(options.jobsStatusPill, toggleSelectedJobPaused);
    bindClickAction(options.jobsCompileBtn, function() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      options.vscode.postMessage({ type: "compileJob", jobId: selectedJobId });
    });
    bindClickAction(options.jobsToggleSidebarBtn, function() {
      options.toggleJobsSidebar();
    });
    bindClickAction(options.jobsShowSidebarBtn, function() {
      options.showJobsSidebar();
    });
    bindClickAction(options.jobsDeleteBtn, function() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      options.vscode.postMessage({ type: "deleteJob", jobId: selectedJobId });
    });
    bindClickAction(options.jobsAttachBtn, function() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId || !options.jobsExistingTaskSelect || !options.jobsExistingTaskSelect.value) {
        return;
      }
      options.vscode.postMessage({
        type: "attachTaskToJob",
        jobId: selectedJobId,
        taskId: options.jobsExistingTaskSelect.value,
        windowMinutes: options.jobsExistingWindowInput ? Number(options.jobsExistingWindowInput.value || 30) : 30
      });
    });
    bindClickAction(options.jobsCreateStepBtn, function() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      var name = options.jobsStepNameInput ? options.jobsStepNameInput.value.trim() : "";
      var prompt = options.jobsStepPromptInput ? options.jobsStepPromptInput.value.trim() : "";
      if (!name || !prompt) return;
      var selectedJob = options.getJobById(selectedJobId);
      options.vscode.postMessage({
        type: "createJobTask",
        jobId: selectedJobId,
        windowMinutes: options.jobsStepWindowInput ? Number(options.jobsStepWindowInput.value || 30) : 30,
        data: {
          name,
          prompt,
          cronExpression: selectedJob && selectedJob.cronExpression ? selectedJob.cronExpression : "0 9 * * 1-5",
          agent: options.jobsStepAgentSelect ? options.jobsStepAgentSelect.value : "",
          model: options.jobsStepModelSelect ? options.jobsStepModelSelect.value : "",
          labels: options.parseLabels(
            options.jobsStepLabelsInput ? options.jobsStepLabelsInput.value : ""
          ),
          scope: "workspace",
          promptSource: "inline",
          oneTime: false
        }
      });
      if (options.jobsStepNameInput) options.jobsStepNameInput.value = "";
      if (options.jobsStepPromptInput) options.jobsStepPromptInput.value = "";
      if (options.jobsStepLabelsInput) options.jobsStepLabelsInput.value = "";
      if (options.jobsStepWindowInput) options.jobsStepWindowInput.value = "30";
    });
    bindClickAction(options.jobsCreatePauseBtn, function() {
      var selectedJobId = options.getSelectedJobId();
      if (!selectedJobId) return;
      var title = options.jobsPauseNameInput ? options.jobsPauseNameInput.value.trim() : "";
      options.vscode.postMessage({
        type: "createJobPause",
        jobId: selectedJobId,
        data: {
          title: title || options.defaultPauseTitle || "Manual review"
        }
      });
      if (options.jobsPauseNameInput) {
        options.jobsPauseNameInput.value = "";
      }
    });
  }

  // media/cockpitWebviewUtilityBindings.js
  function resolveLanguageValue(value) {
    return value || "auto";
  }
  function postUtilityAction(vscode, type) {
    vscode.postMessage({ type });
  }
  function bindTemplateRefreshButton(button, options) {
    bindClickAction(button, function() {
      postUtilityAction(options.vscode, "refreshPrompts");
      var selectedPath = options.templateSelect ? options.templateSelect.value : "";
      var promptSourceControl = options.document.querySelector(
        'input[name="prompt-source"]:checked'
      );
      var source = promptSourceControl ? promptSourceControl.value : "inline";
      if (selectedPath && (source === "local" || source === "global")) {
        var templateMessage = Object.assign(
          { type: "loadPromptTemplate" },
          { path: selectedPath, source }
        );
        options.vscode.postMessage(templateMessage);
      }
    });
  }
  function bindUtilityActionButtons(vscode, buttonMap) {
    Object.keys(buttonMap).forEach(function(action) {
      bindClickAction(buttonMap[action], function() {
        postUtilityAction(vscode, action);
      });
    });
  }
  function syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, value) {
    var nextValue = resolveLanguageValue(value);
    if (helpLanguageSelect) {
      helpLanguageSelect.value = nextValue;
    }
    if (settingsLanguageSelect) {
      settingsLanguageSelect.value = nextValue;
    }
  }
  function saveLanguageSelection(helpLanguageSelect, settingsLanguageSelect, vscode, value) {
    var nextValue = resolveLanguageValue(value);
    syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, nextValue);
    vscode.postMessage({
      type: "setLanguage",
      language: nextValue
    });
  }
  function bindLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, vscode, initialValue) {
    syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, initialValue);
    if (helpLanguageSelect) {
      helpLanguageSelect.addEventListener("change", function() {
        saveLanguageSelection(
          helpLanguageSelect,
          settingsLanguageSelect,
          vscode,
          helpLanguageSelect.value
        );
      });
    }
    if (settingsLanguageSelect) {
      settingsLanguageSelect.addEventListener("change", function() {
        saveLanguageSelection(
          helpLanguageSelect,
          settingsLanguageSelect,
          vscode,
          settingsLanguageSelect.value
        );
      });
    }
  }

  // media/cockpitWebviewJobInteractions.js
  function handleSchedulerDetailClick(event, options) {
    var target = event && event.target;
    var researchProfileCard = options.getClosestEventTarget(event, "[data-research-id]");
    if (researchProfileCard && options.researchProfileList && options.researchProfileList.contains(researchProfileCard)) {
      event.preventDefault();
      event.stopPropagation();
      options.selectResearchProfile(
        researchProfileCard.getAttribute("data-research-id") || ""
      );
      return true;
    }
    var researchRunCard = options.getClosestEventTarget(event, "[data-run-id]");
    if (researchRunCard && options.researchRunList && options.researchRunList.contains(researchRunCard)) {
      event.preventDefault();
      event.stopPropagation();
      options.selectResearchRun(researchRunCard.getAttribute("data-run-id") || "");
      return true;
    }
    var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
    if (folderItem && options.jobsFolderList && options.jobsFolderList.contains(folderItem)) {
      options.setSelectedJobFolderId(folderItem.getAttribute("data-job-folder") || "");
      options.setSelectedJobId("");
      options.persistTaskFilter();
      options.renderJobsTab();
      return true;
    }
    var openJobEditorButton = target && target.closest ? target.closest("[data-job-open-editor]") : null;
    if (openJobEditorButton && options.jobsList && options.jobsList.contains(openJobEditorButton)) {
      options.openJobEditor(
        openJobEditorButton.getAttribute("data-job-open-editor") || ""
      );
      return true;
    }
    var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
    if (jobItem && options.jobsList && options.jobsList.contains(jobItem)) {
      options.setSelectedJobId(jobItem.getAttribute("data-job-id") || "");
      options.persistTaskFilter();
      options.renderJobsTab();
      return true;
    }
    var jobAction = target && target.getAttribute ? target.getAttribute("data-job-action") : "";
    if (!jobAction) {
      return false;
    }
    if (jobAction === "detach-node") {
      var detachNodeId = target.getAttribute("data-job-node-id") || "";
      if (options.getSelectedJobId() && detachNodeId) {
        options.vscode.postMessage({
          type: "requestDeleteJobTask",
          jobId: options.getSelectedJobId(),
          nodeId: detachNodeId
        });
      }
      return true;
    }
    if (jobAction === "edit-task") {
      var editTaskId = target.getAttribute("data-job-task-id") || "";
      if (editTaskId && typeof options.editTask === "function") {
        options.editTask(editTaskId);
      }
      return true;
    }
    if (jobAction === "edit-pause") {
      var editPauseNodeId = target.getAttribute("data-job-node-id") || "";
      if (options.getSelectedJobId() && editPauseNodeId) {
        options.vscode.postMessage({
          type: "requestRenameJobPause",
          jobId: options.getSelectedJobId(),
          nodeId: editPauseNodeId
        });
      }
      return true;
    }
    if (jobAction === "delete-pause") {
      var deletePauseNodeId = target.getAttribute("data-job-node-id") || "";
      if (options.getSelectedJobId() && deletePauseNodeId) {
        options.vscode.postMessage({
          type: "requestDeleteJobPause",
          jobId: options.getSelectedJobId(),
          nodeId: deletePauseNodeId
        });
      }
      return true;
    }
    if (jobAction === "approve-pause") {
      var approveNodeId = target.getAttribute("data-job-node-id") || "";
      if (options.getSelectedJobId() && approveNodeId) {
        options.vscode.postMessage({
          type: "approveJobPause",
          jobId: options.getSelectedJobId(),
          nodeId: approveNodeId
        });
      }
      return true;
    }
    if (jobAction === "reject-pause") {
      var rejectNodeId = target.getAttribute("data-job-node-id") || "";
      if (options.getSelectedJobId() && rejectNodeId) {
        options.vscode.postMessage({
          type: "rejectJobPause",
          jobId: options.getSelectedJobId(),
          nodeId: rejectNodeId
        });
      }
      return true;
    }
    if (jobAction === "run-task") {
      var runTaskId = target.getAttribute("data-job-task-id") || "";
      if (runTaskId && typeof options.runTask === "function") {
        options.runTask(runTaskId);
      }
      return true;
    }
    return false;
  }
  function bindJobNodeWindowChange(document2, options) {
    document2.addEventListener("change", function(event) {
      var target = event && event.target;
      if (!target) return;
      if (target.classList && target.classList.contains("job-node-window-input")) {
        var selectedJobId = options.getSelectedJobId();
        if (!selectedJobId) return;
        var nodeId = target.getAttribute("data-job-node-window-id") || "";
        if (!nodeId) return;
        options.vscode.postMessage({
          type: "updateJobNodeWindow",
          jobId: selectedJobId,
          nodeId,
          windowMinutes: Number(target.value || 30)
        });
      }
    });
  }
  function bindJobDragAndDrop(document2, options) {
    document2.addEventListener("dragstart", function(event) {
      var target = event && event.target;
      var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
      if (jobItem && options.jobsList && options.jobsList.contains(jobItem)) {
        options.setDraggedJobId(jobItem.getAttribute("data-job-id") || "");
        if (jobItem.classList) jobItem.classList.add("dragging");
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
        return;
      }
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      if (!card) return;
      options.setDraggedJobNodeId(card.getAttribute("data-job-node-id") || "");
      if (card.classList) card.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
      }
    });
    document2.addEventListener("dragend", function(event) {
      var target = event && event.target;
      var jobItem = target && target.closest ? target.closest("[data-job-id]") : null;
      if (jobItem && jobItem.classList) jobItem.classList.remove("dragging");
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      if (card && card.classList) card.classList.remove("dragging");
      options.setDraggedJobId("");
      options.setDraggedJobNodeId("");
      Array.prototype.forEach.call(
        document2.querySelectorAll(".jobs-step-card.drag-over"),
        function(item) {
          if (item && item.classList) item.classList.remove("drag-over");
        }
      );
      Array.prototype.forEach.call(
        document2.querySelectorAll(".jobs-folder-item.drag-over"),
        function(item) {
          if (item && item.classList) item.classList.remove("drag-over");
        }
      );
    });
    document2.addEventListener("dragover", function(event) {
      var target = event && event.target;
      var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
      if (folderItem && options.getDraggedJobId()) {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        if (folderItem.classList) folderItem.classList.add("drag-over");
        return;
      }
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      if (!card || !options.getDraggedJobNodeId()) return;
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
      if (card.classList) card.classList.add("drag-over");
    });
    document2.addEventListener("dragleave", function(event) {
      var target = event && event.target;
      var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
      if (folderItem && folderItem.classList) folderItem.classList.remove("drag-over");
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      if (card && card.classList) card.classList.remove("drag-over");
    });
    document2.addEventListener("drop", function(event) {
      var target = event && event.target;
      var draggedJobId = options.getDraggedJobId();
      var folderItem = target && target.closest ? target.closest("[data-job-folder]") : null;
      if (folderItem && draggedJobId) {
        event.preventDefault();
        if (folderItem.classList) folderItem.classList.remove("drag-over");
        var droppedFolderId = folderItem.getAttribute("data-job-folder") || "";
        var draggedJob = options.getJobById(draggedJobId);
        if (!draggedJob) return;
        if ((draggedJob.folderId || "") === droppedFolderId) return;
        options.vscode.postMessage({
          type: "updateJob",
          jobId: draggedJobId,
          data: {
            folderId: droppedFolderId || void 0
          }
        });
        return;
      }
      var card = target && target.closest ? target.closest("[data-job-node-id]") : null;
      var draggedJobNodeId = options.getDraggedJobNodeId();
      var selectedJobId = options.getSelectedJobId();
      if (!card || !draggedJobNodeId || !selectedJobId) return;
      event.preventDefault();
      if (card.classList) card.classList.remove("drag-over");
      var targetNodeId = card.getAttribute("data-job-node-id") || "";
      var selectedJob = options.getJobById(selectedJobId);
      if (!selectedJob || !Array.isArray(selectedJob.nodes)) return;
      var targetIndex = selectedJob.nodes.findIndex(function(node) {
        return node && node.id === targetNodeId;
      });
      if (targetIndex < 0 || draggedJobNodeId === targetNodeId) return;
      options.vscode.postMessage({
        type: "reorderJobNode",
        jobId: selectedJobId,
        nodeId: draggedJobNodeId,
        targetIndex
      });
    });
  }

  // media/cockpitWebviewTransientState.js
  function createSchedulerWebviewTransientState(createEmptyTodoDraft, localStorage2, helpWarpSeenKey) {
    return {
      currentTodoLabels: [],
      currentTodoDraft: createEmptyTodoDraft(),
      selectedTodoLabelName: "",
      currentTodoFlag: "",
      pendingTodoFilters: null,
      pendingDeleteLabelName: "",
      pendingDeleteFlagName: "",
      pendingTodoDeleteId: "",
      pendingBoardDeleteTodoId: "",
      pendingBoardDeletePermanentOnly: false,
      todoDeleteModalRoot: null,
      todoCommentModalRoot: null,
      pendingAgentValue: "",
      pendingModelValue: "",
      pendingTemplatePath: "",
      editingTaskEnabled: true,
      pendingSubmit: false,
      helpWarpIntroPending: readHelpWarpIntroPending(localStorage2, helpWarpSeenKey),
      helpWarpFadeTimeout: 0,
      helpWarpCleanupTimeout: 0,
      isCreatingJob: false,
      todoEditorListenersBound: false
    };
  }
  function readHelpWarpIntroPending(localStorage2, helpWarpSeenKey) {
    try {
      return localStorage2.getItem(helpWarpSeenKey) !== "1";
    } catch (_error) {
      return true;
    }
  }

  // media/cockpitWebview.js
  (function() {
    var vscode = null;
    var bootstrapData = readInitialWebviewBootstrap(document);
    var initialData = bootstrapData.initialData;
    var strings = bootstrapData.strings;
    var currentLogLevel = bootstrapData.currentLogLevel;
    var currentLogDirectory = bootstrapData.currentLogDirectory;
    var storageStatusRefreshNoteTimer = null;
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
    installGlobalErrorHandlers({
      window,
      strings,
      showGlobalError,
      sanitizeAbsolutePaths
    });
    function createFallbackVsCodeApi() {
      return { postMessage: function() {
      } };
    }
    var hasVsCodeApi = typeof acquireVsCodeApi === "function";
    vscode = hasVsCodeApi ? acquireVsCodeApi() : createFallbackVsCodeApi();
    if (!hasVsCodeApi) {
      vscode = createFallbackVsCodeApi();
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
    var initialCollections = resolveInitialSchedulerCollections(initialData);
    var tasks = initialCollections.tasks;
    var jobs = initialCollections.jobs;
    var jobFolders = initialCollections.jobFolders;
    var cockpitBoard = initialCollections.cockpitBoard;
    var githubIntegration = initialCollections.githubIntegration;
    var telegramNotification = initialCollections.telegramNotification;
    var executionDefaults = initialCollections.executionDefaults;
    var reviewDefaults = initialCollections.reviewDefaults;
    var normalizeStorageSettings = createStorageSettingsNormalizer(normalizeTodoLabelKey);
    var initialState = createInitialSchedulerWebviewState(
      initialData,
      normalizeStorageSettings
    );
    var storageSettings = initialState.storageSettings;
    var researchProfiles = initialState.researchProfiles;
    var activeResearchRun = initialState.activeResearchRun;
    var recentResearchRuns = initialState.recentResearchRuns;
    var agents = initialState.agents;
    var models = initialState.models;
    var promptTemplates = initialState.promptTemplates;
    var skills = initialState.skills;
    var cockpitHistory = initialState.cockpitHistory;
    var defaultChatSession = initialState.defaultChatSession;
    var autoShowOnStartup = initialState.autoShowOnStartup;
    var workspacePaths = initialState.workspacePaths;
    var caseInsensitivePaths = initialState.caseInsensitivePaths;
    var editingTaskId = null;
    var selectedTodoId = null;
    var TODO_COMPLETION_CONFIRM_TIMEOUT_MS = 3e4;
    var READY_TODO_CREATE_PENDING_TIMEOUT_MS = 1e4;
    var todoCompletionConfirmState = null;
    var todoCompletionConfirmTimer = null;
    var pendingGridTodoCompletions = {};
    var pendingReadyTodoDraftCreates = {};
    var EDITOR_CREATE_SYMBOL = "+";
    var EDITOR_EDIT_SYMBOL = "\u2699";
    var boardRenderState = createBoardRenderState();
    var draggingTodoId = null;
    var isBoardDragging = false;
    function requestCockpitBoardRender() {
      boardRenderState.draggingTodoId = draggingTodoId;
      boardRenderState.isBoardDragging = isBoardDragging;
      requestBoardRender(boardRenderState, requestAnimationFrame, function() {
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
        function() {
          draggingSectionId = null;
          lastDragOverSectionId = null;
        },
        function() {
          draggingTodoId = boardRenderState.draggingTodoId;
          isBoardDragging = boardRenderState.isBoardDragging;
          requestCockpitBoardRender();
        }
      );
      draggingTodoId = boardRenderState.draggingTodoId;
      isBoardDragging = boardRenderState.isBoardDragging;
    }
    var HELP_WARP_SEEN_KEY = "copilot-scheduler-help-warp-seen-v1";
    var GITHUB_INBOX_COLLAPSED_KEY = "copilot-scheduler-github-inbox-collapsed-v1";
    var transientState = createSchedulerWebviewTransientState(
      createEmptyTodoDraft,
      localStorage,
      HELP_WARP_SEEN_KEY
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
    var pendingTodoLabelEditorState = { name: "", color: "" };
    var pendingTodoFlagEditorState = { name: "", color: "" };
    var githubBoardInboxCollapsed = false;
    try {
      githubBoardInboxCollapsed = localStorage.getItem(GITHUB_INBOX_COLLAPSED_KEY) === "true";
    } catch (error) {
      githubBoardInboxCollapsed = false;
    }
    function resetTodoDraft(reason) {
      currentTodoDraft = debugTools.resetTodoDraft(reason);
      clearPendingTodoEditorColors();
    }
    function syncTodoDraftFromInputs(reason) {
      currentTodoDraft = debugTools.syncTodoDraftFromInputs({
        currentTodoDraft,
        reason,
        selectedTodoId,
        todoCommentInput,
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
    function getActiveTodoEditorId() {
      var editorTodoId = todoDetailId ? String(todoDetailId.value || "").trim() : "";
      if (editorTodoId) {
        return editorTodoId;
      }
      return selectedTodoId ? String(selectedTodoId) : "";
    }
    var defaultJitterSeconds = normalizeDefaultJitterSeconds(
      initialData.defaultJitterSeconds
    );
    var locale = typeof initialData.locale === "string" && initialData.locale || void 0;
    var lastRenderedTasksHtml = "";
    var pendingTaskListRender = false;
    var {
      taskForm,
      taskList,
      editTaskIdInput,
      submitBtn,
      testBtn,
      refreshBtn,
      autoShowStartupBtn,
      cockpitHistorySelect,
      restoreHistoryBtn,
      autoShowStartupNote,
      friendlyBuilder,
      recurringScheduleGroup,
      oneTimeDelayGroup,
      cronPreset,
      cronExpression,
      oneTimeDelayHours,
      oneTimeDelayMinutes,
      oneTimeDelaySeconds,
      oneTimeDelayPreviewText,
      agentSelect,
      modelSelect,
      chatSessionGroup,
      chatSessionSelect,
      templateSelect,
      templateSelectGroup,
      templateRefreshBtn,
      skillSelect,
      skillDetailsNote,
      insertSkillBtn,
      setupMcpBtn,
      setupCodexBtn,
      setupCodexSkillsBtn,
      syncBundledSkillsBtn,
      stageBundledAgentsBtn,
      syncBundledAgentsBtn,
      openCopilotSettingsBtn,
      openExtensionSettingsBtn,
      refreshStorageStatusBtn,
      settingsStatusRefreshNote,
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
      openGuruBtn,
      cronPreviewText,
      newTaskBtn,
      taskFilterBar,
      taskLabelFilter,
      taskLabelsInput,
      runFirstGroup,
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
      githubBoardInboxRoot,
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
      githubIntegrationEnabledInput,
      githubIntegrationOwnerInput,
      githubIntegrationRepoInput,
      githubIntegrationApiBaseUrlInput,
      githubIntegrationAutomationPromptTemplateInput,
      githubIntegrationSaveBtn,
      githubIntegrationRefreshBtn,
      githubIntegrationFeedback,
      githubIntegrationStatusValue,
      githubIntegrationRepositoryStatus,
      githubIntegrationConnectionStatus,
      githubIntegrationLastSyncAt,
      githubIntegrationUpdatedAt,
      githubIntegrationStatusNote,
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
      approvalModeSelect,
      approvalModeNote: approvalModeNoteEl,
      needsBotReviewCommentTemplateInput,
      needsBotReviewPromptTemplateInput,
      needsBotReviewAgentSelect,
      needsBotReviewModelSelect,
      needsBotReviewChatSessionSelect,
      readyPromptTemplateInput,
      reviewDefaultsSaveBtn,
      reviewDefaultsNote,
      settingsStorageModeSelect,
      settingsSearchProviderSelect,
      settingsResearchProviderSelect,
      settingsStorageMirrorInput,
      settingsAutoIgnorePrivateFilesInput,
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
      settingsAgentsUpdatedValue,
      settingsLogLevelSelect,
      settingsLogDirectoryInput,
      settingsOpenLogFolderBtn,
      boardAddSectionBtn,
      boardSectionInlineForm,
      boardSectionNameInput,
      boardSectionSaveBtn,
      boardSectionCancelBtn,
      cockpitColSlider
    } = createSchedulerWebviewDomRefs(document);
    var activeTaskFilter = "all";
    var restoredTaskFilterWasExplicit = false;
    var activeLabelFilter = "";
    var restoredLabelFilterWasExplicit = false;
    var taskSectionCollapseState = {
      manual: false,
      jobs: true,
      recurring: false,
      "todo-draft": false,
      "one-time": false
    };
    var selectedJobFolderId = "";
    var selectedJobId = "";
    var selectedResearchId = "";
    var selectedResearchRunId = "";
    var activeTabName = "";
    var tabScrollPositions = /* @__PURE__ */ Object.create(null);
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
    var boardCardDetailsHidden = (function() {
      try {
        return localStorage.getItem("cockpit-hide-card-details") === "1";
      } catch (_e) {
        return false;
      }
    })();
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
    function getCockpitCompactDetailsThreshold() {
      var min = cockpitColSlider ? Number(cockpitColSlider.min) : 180;
      var max = cockpitColSlider ? Number(cockpitColSlider.max) : 520;
      var range = max - min;
      if (!(range > 0)) {
        return 214;
      }
      return Math.round(min + range * 0.16);
    }
    function applyCockpitColumnScale(w) {
      var font = Math.round(9 + (w - 180) * 3 / 340);
      var pad = Math.round(6 + (w - 180) * 5 / 340);
      var gap = Math.round(3 + (w - 180) * 3 / 340);
      var chipFont = Math.max(8, Math.round(8 + (w - 180) * 3 / 340));
      var chipGap = Math.max(2, Math.round(2 + (w - 180) * 2 / 340));
      var labelPadY = Math.max(0, Math.round((w - 180) * 2 / 340));
      var labelPadX = Math.max(4, Math.round(4 + (w - 180) * 3 / 340));
      var flagPadY = Math.max(0, Math.round((w - 180) * 2 / 340));
      var flagPadX = Math.max(4, Math.round(4 + (w - 180) * 3 / 340));
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
        w <= getCockpitCompactDetailsThreshold()
      );
    }
    (function() {
      var saved = localStorage.getItem("cockpit-col-width");
      var w = saved ? Number(saved) : cockpitColSlider ? Number(cockpitColSlider.value) : 240;
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
      return value === "help" || value === "settings" || value === "research" || value === "jobs" || value === "jobs-edit" || value === "list" || value === "create" || value === "board" || value === "todo-edit";
    }
    function getWindowScrollY() {
      if (typeof window.scrollY === "number") {
        return Math.max(0, Math.round(window.scrollY));
      }
      var scrollingElement = document.scrollingElement || document.documentElement || document.body;
      return scrollingElement && typeof scrollingElement.scrollTop === "number" ? Math.max(0, Math.round(scrollingElement.scrollTop)) : 0;
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
        window.requestAnimationFrame(function() {
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
          Object.keys(taskSectionCollapseState).forEach(function(key) {
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
          Object.keys(state.tabScrollPositions).forEach(function(key) {
            var value = state.tabScrollPositions[key];
            if (isPersistedTabName(key) && typeof value === "number" && isFinite(value) && value >= 0) {
              tabScrollPositions[key] = Math.round(value);
            }
          });
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
      boardStickyMetricsFrame = requestAnimationFrame(function() {
        boardStickyMetricsFrame = 0;
        updateBoardStickyMetrics();
      });
    }
    function updateBoardStickyMetrics() {
      var tabBarStickyTop = 0;
      if (tabBar) {
        tabBarStickyTop = Math.max(
          0,
          Math.ceil(tabBar.getBoundingClientRect().height)
        );
      }
      var stickyTop = tabBarStickyTop;
      if (boardFilterSticky && isTabActive("board")) {
        stickyTop = Math.max(
          tabBarStickyTop,
          tabBarStickyTop + Math.ceil(boardFilterSticky.getBoundingClientRect().height + 8)
        );
      }
      document.documentElement.style.setProperty(
        "--cockpit-tab-bar-sticky-top",
        tabBarStickyTop + "px"
      );
      document.documentElement.style.setProperty(
        "--cockpit-board-sticky-top",
        stickyTop + "px"
      );
    }
    function clearBoardAutoCollapseSettle() {
      boardAutoCollapseSettleY = 0;
      boardAutoCollapseSettleDistance = 0;
      boardAutoCollapseSettleUntil = 0;
    }
    function armBoardAutoCollapseSettle(currentY) {
      var stickyHeight = boardFilterSticky ? Math.ceil(boardFilterSticky.getBoundingClientRect().height) : 0;
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
        document.documentElement ? document.documentElement.scrollTop || 0 : 0
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
          boardFiltersAutoCollapsed ? "true" : "false"
        );
      }
      if (todoToggleFiltersBtn) {
        var isCollapsed = isBoardFiltersCollapsed();
        todoToggleFiltersBtn.textContent = isCollapsed ? strings.boardShowFilters || "Show Filters" : strings.boardHideFilters || "Hide Filters";
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
      var separator = currentValue ? /\n\s*$/.test(currentValue) ? "\n" : "\n\n" : "";
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
      var separator = currentValue ? /\n\s*$/.test(currentValue) ? "\n" : "\n\n" : "";
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
        String(todoPriorityInput.value || "none")
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
    function clearGitHubIntegrationFeedback() {
      if (!githubIntegrationFeedback) return;
      githubIntegrationFeedback.textContent = "";
      githubIntegrationFeedback.style.display = "none";
      githubIntegrationFeedback.classList.remove("error");
    }
    function showGitHubIntegrationFeedback(message, isError) {
      if (!githubIntegrationFeedback) return;
      githubIntegrationFeedback.textContent = String(message || "");
      githubIntegrationFeedback.style.display = message ? "block" : "none";
      githubIntegrationFeedback.classList.toggle("error", !!isError);
    }
    function getGitHubSyncStatusLabel(status) {
      switch (status) {
        case "ready":
          return strings.githubIntegrationStatusReady || "Ready";
        case "syncing":
          return strings.githubIntegrationStatusSyncing || "Syncing";
        case "stale":
          return strings.githubIntegrationStatusStale || "Stale";
        case "partial":
          return strings.githubIntegrationStatusPartial || "Needs setup";
        case "rate-limited":
          return strings.githubIntegrationStatusRateLimited || "Rate-limited";
        case "error":
          return strings.githubIntegrationStatusError || "Error";
        default:
          return strings.githubIntegrationStatusDisabled || "Disabled";
      }
    }
    function getGitHubSyncStatusIndicator(status) {
      switch (status) {
        case "ready":
          return {
            color: "var(--vscode-testing-iconPassed, #4caf50)",
            icon: "\u25CF"
          };
        case "syncing":
          return {
            color: "var(--vscode-focusBorder, #3794ff)",
            icon: "\u25CF"
          };
        case "stale":
        case "partial":
        case "rate-limited":
          return {
            color: "var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground, #cca700))",
            icon: "\u25CF"
          };
        case "error":
          return {
            color: "var(--vscode-errorForeground, var(--vscode-testing-iconFailed, #f14c4c))",
            icon: "\u25CF"
          };
        default:
          return {
            color: "var(--vscode-descriptionForeground)",
            icon: "\u25CB"
          };
      }
    }
    function renderGitHubSyncStatusIndicator(status) {
      var label = getGitHubSyncStatusLabel(status);
      var indicator = getGitHubSyncStatusIndicator(status);
      return '<span style="display:inline-flex;align-items:center;gap:6px;"><span aria-hidden="true" style="min-width:1em;text-align:center;color:' + indicator.color + ';">' + escapeHtml(indicator.icon) + "</span><span>" + escapeHtml(label) + "</span></span>";
    }
    function collectGitHubIntegrationFormData() {
      return {
        enabled: !!(githubIntegrationEnabledInput && githubIntegrationEnabledInput.checked),
        owner: githubIntegrationOwnerInput ? String(githubIntegrationOwnerInput.value || "") : "",
        repo: githubIntegrationRepoInput ? String(githubIntegrationRepoInput.value || "") : "",
        apiBaseUrl: githubIntegrationApiBaseUrlInput ? String(githubIntegrationApiBaseUrlInput.value || "") : "",
        automationPromptTemplate: githubIntegrationAutomationPromptTemplateInput ? String(githubIntegrationAutomationPromptTemplateInput.value || "") : ""
      };
    }
    function createEmptyGitHubIntegrationState() {
      return {
        enabled: false,
        hasConnection: false,
        syncStatus: "disabled",
        inbox: {
          issues: { items: [], itemCount: 0 },
          pullRequests: { items: [], itemCount: 0 },
          securityAlerts: { items: [], itemCount: 0 }
        },
        inboxCounts: {
          issues: 0,
          pullRequests: 0,
          securityAlerts: 0,
          total: 0
        }
      };
    }
    function getGitHubInboxSnapshot() {
      var fallback = createEmptyGitHubIntegrationState().inbox;
      var snapshot = githubIntegration && githubIntegration.inbox ? githubIntegration.inbox : fallback;
      return {
        issues: snapshot.issues || fallback.issues,
        pullRequests: snapshot.pullRequests || fallback.pullRequests,
        securityAlerts: snapshot.securityAlerts || fallback.securityAlerts
      };
    }
    function getGitHubInboxCounts() {
      var snapshot = getGitHubInboxSnapshot();
      var counts = githubIntegration && githubIntegration.inboxCounts ? githubIntegration.inboxCounts : {};
      var issues = Number(counts.issues || snapshot.issues.itemCount || (snapshot.issues.items || []).length || 0);
      var pullRequests = Number(counts.pullRequests || snapshot.pullRequests.itemCount || (snapshot.pullRequests.items || []).length || 0);
      var securityAlerts = Number(counts.securityAlerts || snapshot.securityAlerts.itemCount || (snapshot.securityAlerts.items || []).length || 0);
      return {
        issues,
        pullRequests,
        securityAlerts,
        total: Number(counts.total || issues + pullRequests + securityAlerts || 0)
      };
    }
    function hasGitHubRefreshConfiguration() {
      return !!(githubIntegration && githubIntegration.enabled && githubIntegration.hasConnection && String(githubIntegration.owner || "").trim() && String(githubIntegration.repo || "").trim());
    }
    function persistGitHubInboxCollapseState() {
      try {
        localStorage.setItem(GITHUB_INBOX_COLLAPSED_KEY, githubBoardInboxCollapsed ? "true" : "false");
      } catch (error) {
      }
    }
    function getGitHubInboxItem(itemId) {
      var snapshot = getGitHubInboxSnapshot();
      var lanes = [snapshot.issues, snapshot.pullRequests, snapshot.securityAlerts];
      for (var laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
        var lane = lanes[laneIndex];
        var items = Array.isArray(lane && lane.items) ? lane.items : [];
        for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
          if (items[itemIndex] && items[itemIndex].id === itemId) {
            return items[itemIndex];
          }
        }
      }
      return null;
    }
    function getGitHubInboxSubtypeLabel(subtype) {
      switch (subtype) {
        case "code-scanning":
          return strings.githubInboxCodeScanning || "Code Scanning";
        case "dependabot":
          return strings.githubInboxDependabot || "Dependabot";
        default:
          return "";
      }
    }
    function getGitHubInboxLaneLabel(laneKey) {
      switch (laneKey) {
        case "issues":
          return strings.githubInboxIssues || "Issues";
        case "pullRequests":
          return strings.githubInboxPullRequests || "Pull Requests";
        default:
          return strings.githubInboxSecurityAlerts || "Security Alerts";
      }
    }
    function buildGitHubInboxMeta(item) {
      var parts = [];
      if (typeof item.number === "number" && isFinite(item.number)) {
        parts.push("#" + String(item.number));
      }
      if (item.subtype) {
        parts.push(getGitHubInboxSubtypeLabel(item.subtype));
      }
      if (item.state) {
        parts.push(String(item.state));
      }
      if (item.severity) {
        parts.push(String(item.severity));
      }
      if (item.headRef || item.baseRef) {
        parts.push(String(item.headRef || "?") + " -> " + String(item.baseRef || "?"));
      }
      if (item.updatedAt) {
        parts.push(formatSettingsTimestamp(item.updatedAt));
      }
      return parts;
    }
    function getGitHubTodoLabels(item) {
      var labels = ["github"];
      if (item.kind === "issue") {
        labels.push("github-issue");
      } else if (item.kind === "pullRequest") {
        labels.push("github-pr");
      } else {
        labels.push("github-security");
        if (item.subtype === "code-scanning") {
          labels.push("code-scanning");
        }
        if (item.subtype === "dependabot") {
          labels.push("dependabot");
        }
      }
      return labels;
    }
    function getGitHubTodoTitle(item) {
      var prefix = item.kind === "pullRequest" ? "PR" : item.kind === "issue" ? "Issue" : item.subtype === "dependabot" ? "Dependabot Alert" : "Security Alert";
      return prefix + (typeof item.number === "number" && isFinite(item.number) ? " #" + String(item.number) : "") + ": " + String(item.title || "GitHub item");
    }
    function buildGitHubTodoDescription(item) {
      var parts = [];
      if (item.summary) {
        parts.push(String(item.summary));
      }
      var meta = [];
      if (item.state) {
        meta.push("State: " + String(item.state));
      }
      if (item.severity) {
        meta.push("Severity: " + String(item.severity));
      }
      if (item.headRef || item.baseRef) {
        meta.push("Branches: " + String(item.headRef || "?") + " -> " + String(item.baseRef || "?"));
      }
      if (meta.length > 0) {
        parts.push(meta.join(" | "));
      }
      parts.push("GitHub source: " + String(item.url || ""));
      return parts.join("\n\n");
    }
    function buildGitHubTodoSource(item) {
      if (!item) {
        return void 0;
      }
      var source = {
        itemId: String(item.id || ""),
        kind: String(item.kind || ""),
        title: String(item.title || getGitHubTodoTitle(item)),
        url: String(item.url || ""),
        owner: githubIntegration && githubIntegration.owner ? String(githubIntegration.owner) : void 0,
        repo: githubIntegration && githubIntegration.repo ? String(githubIntegration.repo) : void 0,
        state: item.state ? String(item.state) : void 0,
        severity: item.severity ? String(item.severity) : void 0,
        baseRef: item.baseRef ? String(item.baseRef) : void 0,
        headRef: item.headRef ? String(item.headRef) : void 0,
        updatedAt: item.updatedAt ? String(item.updatedAt) : void 0
      };
      if (item.subtype) {
        source.subtype = String(item.subtype);
      }
      if (typeof item.number === "number" && isFinite(item.number)) {
        source.number = item.number;
      }
      return source;
    }
    function createTodoFromGitHubInboxItem(itemId, needsReview) {
      var item = getGitHubInboxItem(itemId);
      if (!item) {
        return;
      }
      vscode.postMessage({
        type: "createTodo",
        data: {
          title: getGitHubTodoTitle(item),
          description: buildGitHubTodoDescription(item),
          labels: getGitHubTodoLabels(item),
          priority: item.kind === "securityAlert" ? "high" : "none",
          flags: needsReview ? ["needs-bot-review"] : void 0,
          githubSource: buildGitHubTodoSource(item)
        }
      });
    }
    function renderGitHubInboxItem(item) {
      var meta = buildGitHubInboxMeta(item);
      var titleMarkup = '<a href="' + escapeAttr(String(item.url || "")) + '" target="_blank" rel="noopener" style="color:var(--vscode-textLink-foreground);text-decoration:none;">' + escapeHtml(String(item.title || "GitHub item")) + "</a>";
      return '<div style="border:1px solid var(--vscode-panel-border);border-radius:8px;padding:10px;background:var(--vscode-editor-background);display:flex;flex-direction:column;gap:6px;"><div style="font-weight:600;line-height:1.35;">' + titleMarkup + "</div>" + (meta.length > 0 ? '<div class="note" style="margin:0;">' + escapeHtml(meta.join(" \u2022 ")) + "</div>" : "") + (item.summary ? '<div class="note" style="margin:0;">' + escapeHtml(String(item.summary)) + "</div>" : "") + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;"><button type="button" class="btn-secondary" data-github-create-todo="' + escapeAttr(String(item.id || "")) + '">' + escapeHtml(strings.githubInboxCreateTodo || "Create Todo") + '</button><button type="button" class="btn-secondary" data-github-create-review-todo="' + escapeAttr(String(item.id || "")) + '">' + escapeHtml(strings.githubInboxCreateTodoReview || "Create Todo + Review") + "</button></div></div>";
    }
    function renderGitHubInboxLane(laneKey, lane) {
      var items = Array.isArray(lane && lane.items) ? lane.items : [];
      var laneCount = Number(lane && lane.itemCount || items.length || 0);
      return '<section style="border:1px solid var(--vscode-panel-border);border-radius:10px;padding:12px;background:var(--vscode-editor-background);display:flex;flex-direction:column;gap:10px;min-width:0;"><div style="display:flex;align-items:center;justify-content:space-between;gap:10px;"><div class="section-title" style="margin:0;">' + escapeHtml(getGitHubInboxLaneLabel(laneKey)) + '</div><div class="note" style="margin:0;">' + escapeHtml(String(laneCount)) + "</div></div>" + (lane && lane.error ? '<div class="note" style="margin:0;color:var(--vscode-inputValidation-warningForeground, var(--vscode-editorWarning-foreground, #cca700));">' + escapeHtml(String(lane.error)) + "</div>" : "") + (items.length > 0 ? items.map(function(item) {
        return renderGitHubInboxItem(item);
      }).join("") : '<div class="note" style="margin:0;">' + escapeHtml(strings.githubInboxLaneEmpty || "No items in this lane.") + "</div>") + "</section>";
    }
    function renderGitHubBoardInbox() {
      if (!githubBoardInboxRoot) {
        return;
      }
      if (!githubIntegration || !githubIntegration.enabled) {
        githubBoardInboxRoot.innerHTML = "";
        githubBoardInboxRoot.style.display = "none";
        return;
      }
      githubBoardInboxRoot.style.display = "block";
      var counts = getGitHubInboxCounts();
      var snapshot = getGitHubInboxSnapshot();
      var canRefresh = hasGitHubRefreshConfiguration();
      var toggleLabel = githubBoardInboxCollapsed ? strings.githubInboxExpand || "Expand" : strings.githubInboxCollapse || "Collapse";
      githubBoardInboxRoot.innerHTML = '<section class="telegram-card settings-card settings-card-github" style="margin-bottom:12px;"><div class="settings-card-header" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;"><div><div class="section-title">GitHub ' + escapeHtml(strings.githubInboxTitle || "Inbox") + '</div><p class="note" style="margin:6px 0 0 0;">' + escapeHtml(String(githubIntegration.statusMessage || strings.githubIntegrationWorkspaceNote || "")) + '</p></div><div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;"><button type="button" class="btn-secondary" id="github-board-refresh-btn"' + (canRefresh && githubIntegration.syncStatus !== "syncing" ? "" : " disabled") + ">" + escapeHtml(strings.githubIntegrationRefresh || "Refresh GitHub Inbox") + '</button><button type="button" class="btn-secondary" id="github-board-toggle-btn">' + escapeHtml(toggleLabel) + '</button></div></div><div class="telegram-status-grid" style="margin-top:12px;"><div class="telegram-status-item"><div class="telegram-status-label">' + escapeHtml(strings.githubIntegrationStatus || "Status") + '</div><div class="telegram-status-value">' + renderGitHubSyncStatusIndicator(githubIntegration.syncStatus) + '</div></div><div class="telegram-status-item"><div class="telegram-status-label">' + escapeHtml(strings.githubInboxIssues || "Issues") + '</div><div class="telegram-status-value">' + escapeHtml(String(counts.issues)) + '</div></div><div class="telegram-status-item"><div class="telegram-status-label">' + escapeHtml(strings.githubInboxPullRequests || "Pull Requests") + '</div><div class="telegram-status-value">' + escapeHtml(String(counts.pullRequests)) + '</div></div><div class="telegram-status-item"><div class="telegram-status-label">' + escapeHtml(strings.githubInboxSecurityAlerts || "Security Alerts") + '</div><div class="telegram-status-value">' + escapeHtml(String(counts.securityAlerts)) + '</div></div><div class="telegram-status-item"><div class="telegram-status-label">' + escapeHtml(strings.githubIntegrationLastSyncAt || "Last sync") + '</div><div class="telegram-status-value">' + escapeHtml(formatSettingsTimestamp(githubIntegration.lastSyncAt)) + "</div></div></div>" + (!githubBoardInboxCollapsed ? '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:12px;">' + renderGitHubInboxLane("issues", snapshot.issues) + renderGitHubInboxLane("pullRequests", snapshot.pullRequests) + renderGitHubInboxLane("securityAlerts", snapshot.securityAlerts) + "</div>" : "") + (counts.total === 0 && !snapshot.issues.error && !snapshot.pullRequests.error && !snapshot.securityAlerts.error ? '<div class="note" style="margin-top:12px;">' + escapeHtml(strings.githubInboxEmpty || "No cached GitHub items yet.") + "</div>" : "") + "</section>";
      var refreshBtn2 = document.getElementById("github-board-refresh-btn");
      if (refreshBtn2) {
        refreshBtn2.onclick = function() {
          requestGitHubIntegrationRefresh();
        };
      }
      var toggleBtn = document.getElementById("github-board-toggle-btn");
      if (toggleBtn) {
        toggleBtn.onclick = function() {
          githubBoardInboxCollapsed = !githubBoardInboxCollapsed;
          persistGitHubInboxCollapseState();
          renderGitHubBoardInbox();
        };
      }
      Array.prototype.forEach.call(
        githubBoardInboxRoot.querySelectorAll("[data-github-create-todo]"),
        function(button) {
          button.onclick = function() {
            createTodoFromGitHubInboxItem(button.getAttribute("data-github-create-todo"), false);
          };
        }
      );
      Array.prototype.forEach.call(
        githubBoardInboxRoot.querySelectorAll("[data-github-create-review-todo]"),
        function(button) {
          button.onclick = function() {
            createTodoFromGitHubInboxItem(button.getAttribute("data-github-create-review-todo"), true);
          };
        }
      );
    }
    function requestGitHubIntegrationRefresh() {
      githubIntegration = Object.assign({}, createEmptyGitHubIntegrationState(), githubIntegration || {}, {
        syncStatus: "syncing",
        statusMessage: strings.githubIntegrationRefreshing || "Refreshing GitHub inbox..."
      });
      showGitHubIntegrationFeedback(strings.githubIntegrationRefreshing || "Refreshing GitHub inbox...", false);
      renderGitHubIntegrationTab();
      renderCockpitBoard();
      vscode.postMessage({ type: "refreshGitHubIntegration" });
    }
    function renderGitHubIntegrationTab() {
      if (githubIntegrationEnabledInput) {
        githubIntegrationEnabledInput.checked = !!githubIntegration.enabled;
      }
      if (githubIntegrationOwnerInput) {
        githubIntegrationOwnerInput.value = githubIntegration.owner || "";
      }
      if (githubIntegrationRepoInput) {
        githubIntegrationRepoInput.value = githubIntegration.repo || "";
      }
      if (githubIntegrationApiBaseUrlInput) {
        githubIntegrationApiBaseUrlInput.value = githubIntegration.apiBaseUrl || "";
      }
      if (githubIntegrationAutomationPromptTemplateInput) {
        githubIntegrationAutomationPromptTemplateInput.value = githubIntegration.automationPromptTemplate || "";
      }
      if (githubIntegrationStatusValue) {
        githubIntegrationStatusValue.innerHTML = renderGitHubSyncStatusIndicator(githubIntegration.syncStatus);
        githubIntegrationStatusValue.title = getGitHubSyncStatusLabel(githubIntegration.syncStatus);
      }
      if (githubIntegrationRepositoryStatus) {
        var owner = String(githubIntegration.owner || "").trim();
        var repo = String(githubIntegration.repo || "").trim();
        githubIntegrationRepositoryStatus.textContent = owner && repo ? owner + "/" + repo : "-";
      }
      if (githubIntegrationConnectionStatus) {
        githubIntegrationConnectionStatus.textContent = githubIntegration.authStatusText || (githubIntegration.hasConnection ? strings.githubIntegrationConnected || "Connected in VS Code" : strings.githubIntegrationNotConnected || "Not connected in VS Code");
      }
      if (githubIntegrationLastSyncAt) {
        githubIntegrationLastSyncAt.textContent = formatSettingsTimestamp(githubIntegration.lastSyncAt);
      }
      if (githubIntegrationUpdatedAt) {
        githubIntegrationUpdatedAt.textContent = formatSettingsTimestamp(githubIntegration.updatedAt);
      }
      if (githubIntegrationStatusNote) {
        githubIntegrationStatusNote.textContent = githubIntegration.statusMessage || strings.githubIntegrationWorkspaceNote || "Settings are repo-local. GitHub refresh uses your current VS Code GitHub connection and cached inbox data.";
      }
      if (githubIntegrationRefreshBtn) {
        githubIntegrationRefreshBtn.disabled = !hasGitHubRefreshConfiguration() || githubIntegration.syncStatus === "syncing";
      }
      if (githubIntegration.syncStatus !== "syncing") {
        clearGitHubIntegrationFeedback();
      }
    }
    function submitGitHubIntegrationForm() {
      clearGitHubIntegrationFeedback();
      vscode.postMessage({
        type: "saveGitHubIntegration",
        data: collectGitHubIntegrationFormData()
      });
      showGitHubIntegrationFeedback(
        strings.githubIntegrationStatusSaved || "Saving GitHub settings...",
        false
      );
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
    function collectReviewDefaultsFormData() {
      return {
        needsBotReviewCommentTemplate: needsBotReviewCommentTemplateInput ? String(needsBotReviewCommentTemplateInput.value || "") : "",
        needsBotReviewPromptTemplate: needsBotReviewPromptTemplateInput ? String(needsBotReviewPromptTemplateInput.value || "") : "",
        needsBotReviewAgent: needsBotReviewAgentSelect ? String(needsBotReviewAgentSelect.value || "") : "",
        needsBotReviewModel: needsBotReviewModelSelect ? String(needsBotReviewModelSelect.value || "") : "",
        needsBotReviewChatSession: needsBotReviewChatSessionSelect && needsBotReviewChatSessionSelect.value === "continue" ? "continue" : "new",
        readyPromptTemplate: readyPromptTemplateInput ? String(readyPromptTemplateInput.value || "") : ""
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
        mode: settingsStorageModeSelect && settingsStorageModeSelect.value === "sqlite" ? "sqlite" : "json",
        searchProvider: settingsSearchProviderSelect && settingsSearchProviderSelect.value === "tavily" ? settingsSearchProviderSelect.value : "built-in",
        researchProvider: settingsResearchProviderSelect && (settingsResearchProviderSelect.value === "perplexity" || settingsResearchProviderSelect.value === "tavily" || settingsResearchProviderSelect.value === "google-grounded") ? settingsResearchProviderSelect.value : "none",
        sqliteJsonMirror: !settingsStorageMirrorInput || settingsStorageMirrorInput.checked !== false,
        autoIgnorePrivateFiles: !settingsAutoIgnorePrivateFilesInput || settingsAutoIgnorePrivateFilesInput.checked !== false,
        disabledSystemFlagKeys
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
        executionDefaults && typeof executionDefaults.agent === "string" ? executionDefaults.agent : "agent",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
      updateSimpleSelect(
        modelSelectEl,
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
      if (executionDefaultsNoteEl) {
        executionDefaultsNoteEl.textContent = strings.executionDefaultsSaved || "Workspace default agent and model settings.";
      }
    }
    function renderReviewDefaultsControls() {
      if (needsBotReviewCommentTemplateInput) {
        needsBotReviewCommentTemplateInput.value = reviewDefaults && typeof reviewDefaults.needsBotReviewCommentTemplate === "string" ? reviewDefaults.needsBotReviewCommentTemplate : "";
      }
      if (needsBotReviewPromptTemplateInput) {
        needsBotReviewPromptTemplateInput.value = reviewDefaults && typeof reviewDefaults.needsBotReviewPromptTemplate === "string" ? reviewDefaults.needsBotReviewPromptTemplate : "";
      }
      if (readyPromptTemplateInput) {
        readyPromptTemplateInput.value = reviewDefaults && typeof reviewDefaults.readyPromptTemplate === "string" ? reviewDefaults.readyPromptTemplate : "";
      }
      updateSimpleSelect(
        needsBotReviewAgentSelect,
        agents,
        strings.placeholderSelectAgent || "Select agent",
        reviewDefaults && typeof reviewDefaults.needsBotReviewAgent === "string" ? reviewDefaults.needsBotReviewAgent : "agent",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
      updateSimpleSelect(
        needsBotReviewModelSelect,
        models,
        strings.placeholderSelectModel || "Select model",
        reviewDefaults && typeof reviewDefaults.needsBotReviewModel === "string" ? reviewDefaults.needsBotReviewModel : "",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return formatModelLabel(item);
        }
      );
      if (needsBotReviewChatSessionSelect) {
        needsBotReviewChatSessionSelect.value = reviewDefaults && reviewDefaults.needsBotReviewChatSession === "continue" ? "continue" : "new";
      }
      if (reviewDefaultsNote) {
        reviewDefaultsNote.textContent = strings.reviewDefaultsSaved || "The review comment text is inserted on review-state changes, and needs-bot-review launches the planning prompt immediately after save.";
      }
    }
    function renderStorageSettingsControls() {
      var disabledSystemFlagKeySet = /* @__PURE__ */ Object.create(null);
      (storageSettings.disabledSystemFlagKeys || []).forEach(function(key) {
        disabledSystemFlagKeySet[normalizeTodoLabelKey(key)] = true;
      });
      if (settingsStorageModeSelect) {
        settingsStorageModeSelect.value = storageSettings.mode === "json" ? "json" : "sqlite";
      }
      if (settingsSearchProviderSelect) {
        settingsSearchProviderSelect.value = storageSettings.searchProvider === "tavily" ? storageSettings.searchProvider : "built-in";
      }
      if (settingsResearchProviderSelect) {
        settingsResearchProviderSelect.value = storageSettings.researchProvider === "perplexity" || storageSettings.researchProvider === "tavily" || storageSettings.researchProvider === "google-grounded" ? storageSettings.researchProvider : "none";
      }
      if (settingsStorageMirrorInput) {
        settingsStorageMirrorInput.checked = storageSettings.sqliteJsonMirror !== false;
      }
      if (settingsAutoIgnorePrivateFilesInput) {
        settingsAutoIgnorePrivateFilesInput.checked = storageSettings.autoIgnorePrivateFiles !== false;
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
        settingsStorageNote.textContent = strings.settingsStorageSaved || "Storage settings are repo-local. Reload after changing the backend mode.";
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
      if (settingsAgentsUpdatedValue) {
        settingsAgentsUpdatedValue.textContent = formatSettingsTimestamp(storageSettings.lastBundledAgentsSyncAt);
      }
    }
    function showStorageStatusRefreshNote() {
      if (!settingsStatusRefreshNote) {
        return;
      }
      settingsStatusRefreshNote.textContent = strings.settingsStatusUpdated || "\u2713 Updated";
      settingsStatusRefreshNote.style.opacity = "1";
      if (storageStatusRefreshNoteTimer) {
        window.clearTimeout(storageStatusRefreshNoteTimer);
      }
      storageStatusRefreshNoteTimer = window.setTimeout(function() {
        settingsStatusRefreshNote.style.opacity = "0";
        settingsStatusRefreshNote.textContent = "";
        storageStatusRefreshNoteTimer = null;
      }, 2e3);
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
      var manualSessionEl = document.getElementById("manual-session");
      var runFirstEl = document.getElementById("run-first");
      var isOneTime = !!(oneTimeEl && oneTimeEl.checked);
      var isManualSession = !!(manualSessionEl && manualSessionEl.checked);
      if (isOneTime && manualSessionEl && manualSessionEl.checked) {
        manualSessionEl.checked = false;
        isManualSession = false;
      }
      if (isManualSession && oneTimeEl && oneTimeEl.checked) {
        oneTimeEl.checked = false;
        isOneTime = false;
      }
      if (recurringScheduleGroup) {
        recurringScheduleGroup.style.display = isOneTime ? "none" : "";
      }
      if (oneTimeDelayGroup) {
        oneTimeDelayGroup.style.display = isOneTime ? "block" : "none";
      }
      if (runFirstGroup) {
        runFirstGroup.style.display = isOneTime ? "none" : "block";
      }
      if (chatSessionGroup) {
        chatSessionGroup.style.display = isOneTime ? "none" : "block";
      }
      if (chatSessionSelect && !chatSessionSelect.value) {
        chatSessionSelect.value = defaultChatSession;
      }
      if (isOneTime && chatSessionSelect) {
        chatSessionSelect.value = defaultChatSession;
      }
      if (isOneTime && runFirstEl && runFirstEl.checked) {
        runFirstEl.checked = false;
      }
      updateOneTimeDelayPreview();
    }
    function normalizeOneTimeDelayPart(value, maxValue) {
      var numericValue = typeof value === "number" ? value : Number(value);
      if (!isFinite(numericValue) || numericValue < 0) {
        return 0;
      }
      var wholeNumber = Math.floor(numericValue);
      if (typeof maxValue === "number") {
        return Math.min(wholeNumber, maxValue);
      }
      return wholeNumber;
    }
    function getOneTimeDelaySecondsFromInputs() {
      return normalizeOneTimeDelayPart(oneTimeDelayHours ? oneTimeDelayHours.value : 0) * 3600 + normalizeOneTimeDelayPart(oneTimeDelayMinutes ? oneTimeDelayMinutes.value : 0, 59) * 60 + normalizeOneTimeDelayPart(oneTimeDelaySeconds ? oneTimeDelaySeconds.value : 0, 59);
    }
    function formatHumanDuration(totalSeconds) {
      var normalizedSeconds = normalizeOneTimeDelayPart(totalSeconds);
      var hours = Math.floor(normalizedSeconds / 3600);
      var minutes = Math.floor(normalizedSeconds % 3600 / 60);
      var seconds = normalizedSeconds % 60;
      if (hours > 0) {
        return minutes > 0 ? hours + " " + (hours === 1 ? "hour" : "hours") + " " + minutes + " " + (minutes === 1 ? "minute" : "minutes") : hours + " " + (hours === 1 ? "hour" : "hours");
      }
      if (minutes > 0) {
        return seconds > 0 ? minutes + " " + (minutes === 1 ? "minute" : "minutes") + " " + seconds + " " + (seconds === 1 ? "second" : "seconds") : minutes + " " + (minutes === 1 ? "minute" : "minutes");
      }
      return normalizedSeconds + " " + (normalizedSeconds === 1 ? "second" : "seconds");
    }
    function setOneTimeDelayInputs(totalSeconds) {
      var normalized = normalizeOneTimeDelayPart(totalSeconds);
      if (oneTimeDelayHours) {
        oneTimeDelayHours.value = String(Math.floor(normalized / 3600));
      }
      if (oneTimeDelayMinutes) {
        oneTimeDelayMinutes.value = String(Math.floor(normalized % 3600 / 60));
      }
      if (oneTimeDelaySeconds) {
        oneTimeDelaySeconds.value = String(normalized % 60);
      }
    }
    function deriveTaskOneTimeDelaySeconds(task) {
      var storedDelay = normalizeOneTimeDelayPart(task && task.oneTimeDelaySeconds);
      if (storedDelay > 0) {
        return storedDelay;
      }
      if (!(task && task.oneTime === true && task.nextRun)) {
        return 0;
      }
      var nextRunDate = new Date(task.nextRun);
      var remainingSeconds = Math.ceil((nextRunDate.getTime() - Date.now()) / 1e3);
      return remainingSeconds > 0 ? remainingSeconds : 0;
    }
    function updateOneTimeDelayPreview() {
      if (!oneTimeDelayPreviewText) {
        return;
      }
      var totalSeconds = getOneTimeDelaySecondsFromInputs();
      if (totalSeconds < 1) {
        oneTimeDelayPreviewText.textContent = strings.oneTimeDelayPreviewUnset || "Set a delay to schedule this one-time run.";
        return;
      }
      var nextRunDate = new Date(Date.now() + totalSeconds * 1e3);
      oneTimeDelayPreviewText.textContent = formatHumanDuration(totalSeconds) + " " + (strings.oneTimeDelayFromNow || "from now") + " \u2022 " + nextRunDate.toLocaleString(locale);
    }
    function formatHistoryLabel(entry) {
      if (!entry || !entry.createdAt) {
        return strings.cockpitHistoryPlaceholder || "Select a backup version";
      }
      var date = new Date(entry.createdAt);
      if (isNaN(date.getTime())) {
        return String(entry.createdAt);
      }
      return date.toLocaleString(locale);
    }
    function syncScheduleHistoryOptions() {
      if (!cockpitHistorySelect) return;
      var previousValue = cockpitHistorySelect.value || "";
      var entries = Array.isArray(cockpitHistory) ? cockpitHistory : [];
      entries = entries.slice().sort(function(a, b) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      if (entries.length === 0) {
        cockpitHistorySelect.innerHTML = '<option value="">' + escapeHtml(strings.cockpitHistoryEmpty || "No backup versions yet") + "</option>";
        cockpitHistorySelect.disabled = true;
        if (restoreHistoryBtn) restoreHistoryBtn.disabled = true;
        return;
      }
      cockpitHistorySelect.innerHTML = '<option value="">' + escapeHtml(strings.cockpitHistoryPlaceholder || "Select a backup version") + "</option>" + entries.map(function(entry) {
        return '<option value="' + escapeAttr(entry.id || "") + '">' + escapeHtml(formatHistoryLabel(entry)) + "</option>";
      }).join("");
      cockpitHistorySelect.disabled = false;
      if (restoreHistoryBtn) restoreHistoryBtn.disabled = false;
      if (previousValue) {
        cockpitHistorySelect.value = previousValue;
      }
      if (cockpitHistorySelect.value !== previousValue) {
        cockpitHistorySelect.value = "";
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
    function isOneTimeTask(task) {
      return !!(task && (task.oneTime === true || String(task.id || "").indexOf("exec-") === 0));
    }
    function normalizeTodoDraftMatchText(value) {
      return String(value || "").trim().toLowerCase();
    }
    function isTodoTaskDraft(task) {
      return !!(task && isOneTimeTask(task) && Array.isArray(task.labels) && task.labels.some(function(label) {
        return normalizeTodoLabelKey(label) === "from-todo-cockpit";
      }));
    }
    function findTodoDraftTaskForTodo(todo) {
      if (!todo || !Array.isArray(tasks)) {
        return null;
      }
      var todoId = normalizeTodoDraftMatchText(todo.id);
      var todoTitle = normalizeTodoDraftMatchText(todo.title);
      var todoDescription = normalizeTodoDraftMatchText(todo.description);
      var todoLabels = Array.isArray(todo.labels) ? todo.labels.map(function(label) {
        return normalizeTodoDraftMatchText(label);
      }).filter(function(label) {
        return label.length > 0;
      }) : [];
      return tasks.find(function(task) {
        if (!isTodoTaskDraft(task)) {
          return false;
        }
        var taskPrompt = normalizeTodoDraftMatchText(task.prompt);
        if (todoId && taskPrompt.indexOf("todo id: " + todoId) >= 0) {
          return true;
        }
        var taskName = normalizeTodoDraftMatchText(task.name);
        if (!todoTitle || taskName !== todoTitle) {
          return false;
        }
        var taskDescription = normalizeTodoDraftMatchText(task.description);
        if (todoDescription && taskDescription !== todoDescription) {
          return false;
        }
        return todoLabels.every(function(label) {
          return Array.isArray(task.labels) && task.labels.some(function(entry) {
            return normalizeTodoDraftMatchText(entry) === label;
          });
        });
      }) || null;
    }
    function hasPendingReadyTodoDraftCreate(todoId) {
      return !!(todoId && Object.prototype.hasOwnProperty.call(pendingReadyTodoDraftCreates, todoId));
    }
    function clearPendingReadyTodoDraftCreate(todoId, skipRender) {
      if (!hasPendingReadyTodoDraftCreate(todoId)) {
        return;
      }
      window.clearTimeout(pendingReadyTodoDraftCreates[todoId]);
      delete pendingReadyTodoDraftCreates[todoId];
      if (!skipRender) {
        renderTaskList(tasks);
      }
    }
    function startPendingReadyTodoDraftCreate(todoId) {
      if (!todoId) {
        return;
      }
      clearPendingReadyTodoDraftCreate(todoId, true);
      pendingReadyTodoDraftCreates[todoId] = window.setTimeout(function() {
        clearPendingReadyTodoDraftCreate(todoId);
      }, READY_TODO_CREATE_PENDING_TIMEOUT_MS);
      renderTaskList(tasks);
    }
    function reconcilePendingReadyTodoDraftCreates() {
      var cardsById = {};
      getAllTodoCards().forEach(function(todo) {
        if (todo && todo.id) {
          cardsById[todo.id] = todo;
        }
      });
      Object.keys(pendingReadyTodoDraftCreates).forEach(function(todoId) {
        var todo = cardsById[todoId];
        if (!todo) {
          clearPendingReadyTodoDraftCreate(todoId, true);
          return;
        }
        if (todo.archived || isRecurringTodoSectionId(todo.sectionId)) {
          clearPendingReadyTodoDraftCreate(todoId, true);
          return;
        }
        if (getTodoWorkflowFlag(todo) !== "ready") {
          clearPendingReadyTodoDraftCreate(todoId, true);
          return;
        }
        if (todo.taskId && isTodoTaskDraft(getTaskById(todo.taskId))) {
          clearPendingReadyTodoDraftCreate(todoId, true);
          return;
        }
        if (findTodoDraftTaskForTodo(todo)) {
          clearPendingReadyTodoDraftCreate(todoId, true);
        }
      });
    }
    function getReadyTodoDraftCandidates() {
      var effectiveLabelFilter = activeLabelFilter;
      if (arguments.length > 0 && typeof arguments[0] === "string") {
        effectiveLabelFilter = arguments[0];
      }
      return getAllTodoCards().filter(function(todo) {
        if (!todo || todo.archived || isRecurringTodoSectionId(todo.sectionId)) {
          return false;
        }
        if (getTodoWorkflowFlag(todo) !== "ready") {
          return false;
        }
        if (hasPendingReadyTodoDraftCreate(todo.id || "")) {
          return false;
        }
        var linkedTask = todo.taskId ? getTaskById(todo.taskId) : null;
        if (linkedTask && isTodoTaskDraft(linkedTask)) {
          return false;
        }
        if (findTodoDraftTaskForTodo(todo)) {
          return false;
        }
        if (effectiveLabelFilter) {
          return Array.isArray(todo.labels) && todo.labels.indexOf(effectiveLabelFilter) >= 0;
        }
        return true;
      });
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
    function clearPendingTodoEditorColor(state) {
      state.name = "";
      state.color = "";
    }
    function clearPendingTodoEditorColors() {
      clearPendingTodoEditorColor(pendingTodoLabelEditorState);
      clearPendingTodoEditorColor(pendingTodoFlagEditorState);
    }
    function rememberPendingTodoEditorColor(state, name, color) {
      state.name = normalizeTodoLabel(name);
      state.color = isValidTodoEditorHexColor(color) ? String(color) : "";
    }
    function getPendingTodoEditorColor(state, name) {
      if (normalizeTodoLabelKey(state.name) !== normalizeTodoLabelKey(name)) {
        return "";
      }
      return isValidTodoEditorHexColor(state.color) ? state.color : "";
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
    function isRecurringTodoSectionId(sectionId) {
      return sectionId === "recurring-tasks";
    }
    function isSpecialTodoSectionId(sectionId) {
      return isArchiveTodoSectionId(sectionId) || isRecurringTodoSectionId(sectionId);
    }
    function getAllTodoCards() {
      return cockpitBoard && Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.slice() : [];
    }
    function runStartupRenderStep(stepName, runStep) {
      try {
        runStep();
      } catch (error) {
        emitWebviewDebug("startupRenderStepFailed", {
          step: stepName,
          error: error && error.message ? String(error.message) : String(error)
        });
        var prefix = strings.webviewClientErrorPrefix || "Webview error: ";
        var detail = error && error.message ? error.message : error;
        var firstLine = String(detail || "").split(/\r?\n/)[0];
        showGlobalError(prefix + sanitizeAbsolutePaths(stepName + ": " + firstLine), {
          durationMs: 0
        });
      }
    }
    function getVisibleTodoCards(filters2) {
      var allCards = getAllTodoCards();
      if (!filters2 || filters2.showArchived !== true) {
        allCards = allCards.filter(function(card) {
          return !card.archived && !isArchiveTodoSectionId(card.sectionId);
        });
      }
      if (!filters2 || filters2.showRecurringTasks !== true) {
        allCards = allCards.filter(function(card) {
          return !isRecurringTodoSectionId(card.sectionId);
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
      var entry = entryOrName && typeof entryOrName === "object" ? entryOrName : getFlagDefinition(entryOrName);
      if (entry && entry.system === true) {
        return true;
      }
      var key = normalizeTodoLabelKey(
        entry && (entry.key || entry.name) ? entry.key || entry.name : entryOrName
      );
      return key === "ready" || key === "needs-bot-review" || key === "needs-user-review" || key === "new" || key === "on-schedule-list" || key === "final-user-check";
    }
    function getTodoWorkflowFlag(card) {
      if (!card || !Array.isArray(card.flags)) {
        return "";
      }
      var workflowKeys = ["new", "needs-bot-review", "needs-user-review", "ready", "on-schedule-list", "final-user-check"];
      var seen = /* @__PURE__ */ Object.create(null);
      var matched = [];
      card.flags.forEach(function(flag) {
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
      return definition && definition.color ? definition.color : "var(--vscode-badge-background)";
    }
    function isValidTodoEditorHexColor(color) {
      return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(color || ""));
    }
    function getValidLabelColorValue(color, fallbackColor) {
      var value = String(color || "");
      if (isValidTodoEditorHexColor(value)) {
        return value;
      }
      return fallbackColor || "#4f8cff";
    }
    function getValidFlagColorValue(color, fallbackColor) {
      var value = String(color || "");
      if (isValidTodoEditorHexColor(value)) {
        return value;
      }
      return fallbackColor || "#f59e0b";
    }
    function upsertLocalLabelDefinition(name, color, previousName) {
      var normalizedName = normalizeTodoLabel(name);
      var nextColor = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(color || "")) ? String(color) : "#4f8cff";
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
          updatedAt: ""
        };
      }
      nextCatalog = Array.isArray(cockpitBoard.labelCatalog) ? cockpitBoard.labelCatalog.slice() : [];
      nextCatalog = nextCatalog.filter(function(entry) {
        var entryKey = normalizeTodoLabelKey(entry && (entry.key || entry.name || ""));
        if (!entryKey) {
          return false;
        }
        if (entryKey === nextKey || previousKey && entryKey === previousKey) {
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
        createdAt: existingEntry && existingEntry.createdAt ? existingEntry.createdAt : void 0,
        updatedAt: cockpitBoard.updatedAt || (/* @__PURE__ */ new Date()).toISOString()
      });
      cockpitBoard = Object.assign({}, cockpitBoard, {
        labelCatalog: nextCatalog.sort(function(left, right) {
          return String(left.name).localeCompare(String(right.name));
        })
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
      if (selectedTodoLabelName && !getLabelDefinition(selectedTodoLabelName)) {
        var stillApplied = currentTodoLabels.some(function(label) {
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
      return '<span data-label-chip="' + escapeAttr(label) + '" style="border-radius:999px;background:' + escapeAttr(color) + ";color:" + escapeAttr(textColor) + ";border:1px solid " + escapeAttr(borderColor) + ';"><button type="button" data-label-chip-select="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;color:inherit;">' + escapeHtml(label) + "</button>" + (removable ? '<button type="button" data-label-chip-remove="' + escapeAttr(label) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;">\xD7</button>' : "") + "</span>";
    }
    function renderFlagChip(flagName, removable) {
      var color = getFlagColor(flagName);
      var textColor = getReadableTextColor(color);
      var displayName = getFlagDisplayName(flagName);
      return '<span data-flag-chip="' + escapeAttr(flagName) + '" style="border-radius:4px;background:' + escapeAttr(color) + ";color:" + escapeAttr(textColor) + ";border:1px solid color-mix(in srgb," + escapeAttr(color) + ' 70%,var(--vscode-panel-border));font-weight:600;"><span>' + escapeHtml(displayName) + "</span>" + (removable ? '<button type="button" data-flag-chip-remove="' + escapeAttr(flagName) + '" style="all:unset;cursor:pointer;font-weight:700;color:inherit;line-height:1;" title="' + escapeAttr(strings.boardFlagClearTitle || strings.boardFlagClear || "Clear flag") + '">\xD7</button>' : "") + "</span>";
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
      var fullCatalog = getLabelCatalog();
      var addedKeys = currentTodoLabels.map(normalizeTodoLabelKey);
      var catalog = fullCatalog.filter(function(entry) {
        return addedKeys.indexOf(normalizeTodoLabelKey(entry.name)) < 0;
      });
      var activeEditEntry = null;
      if (editingLabelOriginalName) {
        for (var catalogIndex = 0; catalogIndex < fullCatalog.length; catalogIndex++) {
          if (normalizeTodoLabelKey(fullCatalog[catalogIndex].name) === normalizeTodoLabelKey(editingLabelOriginalName)) {
            activeEditEntry = fullCatalog[catalogIndex];
            break;
          }
        }
      }
      if (catalog.length === 0 && !activeEditEntry) {
        todoLabelCatalog.innerHTML = "";
        return;
      }
      var activeEditMarkup = "";
      if (activeEditEntry && activeEditEntry.source !== "task") {
        var deletePrompt = String(
          strings.boardLabelCatalogDeleteConfirm || 'Delete label "{name}"?'
        ).replace("{name}", activeEditEntry.name);
        activeEditMarkup = '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 8px;padding:8px 10px;border-radius:10px;border:1px solid color-mix(in srgb,var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground)) 45%,var(--vscode-panel-border));background:linear-gradient(135deg,color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#7f1d1d) 20%,var(--vscode-editorWidget-background)) 0%,color-mix(in srgb,var(--vscode-editorWidget-background) 92%,transparent) 100%);box-shadow:inset 0 1px 0 color-mix(in srgb,#ffffff 10%,transparent);"><span style="font-size:12px;line-height:1.45;font-weight:600;color:var(--vscode-foreground);">' + escapeHtml(deletePrompt) + "</span>" + (isPendingCatalogDelete("label", activeEditEntry.name) ? '<button type="button" data-label-catalog-confirm-delete="' + escapeAttr(activeEditEntry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:26px;padding:4px 12px;border-radius:999px;background:linear-gradient(180deg,color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#c2410c) 78%,var(--vscode-button-background)) 0%,color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#c2410c) 62%,var(--vscode-button-background)) 100%);border:1px solid color-mix(in srgb,var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground)) 78%,var(--vscode-panel-border));color:var(--vscode-button-foreground);box-shadow:0 6px 14px color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#c2410c) 24%,transparent);font-size:11px;font-weight:800;letter-spacing:0.02em;line-height:1.2;white-space:nowrap;" title="' + escapeAttr(strings.boardLabelCatalogDeleteTitle || "Delete label") + '">' + escapeHtml(strings.boardDeleteConfirm || "Delete?") + "</button>" : '<button type="button" data-label-catalog-delete="' + escapeAttr(activeEditEntry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:26px;padding:4px 12px;border-radius:999px;background:linear-gradient(180deg,color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#dc2626) 16%,var(--vscode-editorWidget-background)) 0%,color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#dc2626) 10%,var(--vscode-editorWidget-background)) 100%);border:1px solid color-mix(in srgb,var(--vscode-inputValidation-errorBorder,var(--vscode-errorForeground)) 56%,var(--vscode-panel-border));color:var(--vscode-errorForeground,var(--vscode-foreground));box-shadow:0 4px 12px color-mix(in srgb,var(--vscode-inputValidation-errorBackground,#dc2626) 14%,transparent);font-size:11px;font-weight:800;letter-spacing:0.02em;line-height:1.2;white-space:nowrap;" title="' + escapeAttr(strings.boardLabelCatalogDeleteTitle || "Delete label") + '">' + escapeHtml(strings.boardLabelCatalogDeleteTitle || "Delete label") + "</button>") + "</div>";
      }
      todoLabelCatalog.innerHTML = activeEditMarkup + catalog.map(function(entry) {
        var bg = entry.color || "var(--vscode-badge-background)";
        var fg = getReadableTextColor(bg);
        var borderColor = "color-mix(in srgb," + bg + " 60%,var(--vscode-panel-border))";
        return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 12px;border-radius:999px;background:' + escapeAttr(bg) + ";color:" + escapeAttr(fg) + ";border:1.5px solid " + escapeAttr(borderColor) + ';font-size:12px;"><button type="button" data-label-catalog-select="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="' + escapeAttr(strings.boardLabelCatalogAddTitle || "Add to todo") + '">' + escapeHtml(entry.name) + '</button><button type="button" data-label-catalog-edit="' + escapeAttr(entry.name) + '" data-label-catalog-edit-color="' + escapeAttr(bg) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="' + escapeAttr(strings.boardLabelCatalogEditTitle || "Edit label") + '">\u270E</button></span>';
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
      var activeLabelName = getActiveTodoLabelEditorName();
      var selectedDefinition = activeLabelName ? getLabelDefinition(activeLabelName) : null;
      if (todoLabelColorInput) {
        var draftLabelColor = !selectedTodoId && currentTodoDraft ? getValidLabelColorValue(currentTodoDraft.labelColor, "") : "";
        var pendingLabelColor = getPendingTodoEditorColor(
          pendingTodoLabelEditorState,
          activeLabelName
        );
        var nextLabelColor = pendingLabelColor || draftLabelColor || getValidLabelColorValue(selectedDefinition && selectedDefinition.color, "");
        var isTypingNew = todoLabelsInput && todoLabelsInput.value.trim();
        if (nextLabelColor) {
          todoLabelColorInput.value = getValidLabelColorValue(nextLabelColor, "#4f8cff");
        } else if (activeLabelName || !isTypingNew) {
          todoLabelColorInput.value = "#4f8cff";
        }
        rememberPendingTodoEditorColor(
          pendingTodoLabelEditorState,
          activeLabelName,
          todoLabelColorInput.value
        );
        todoLabelColorInput.disabled = false;
      }
      if (todoLabelColorSaveBtn) {
        todoLabelColorSaveBtn.disabled = !getActiveTodoLabelEditorName();
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
      setTodoEditorLabels(currentTodoLabels.concat([label]), true);
      selectedTodoLabelName = label;
      if (todoLabelSuggestions) todoLabelSuggestions.style.display = "none";
      if (!existingDefinition && pendingColor && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(pendingColor)) {
        upsertLocalLabelDefinition(label, pendingColor);
        vscode.postMessage({
          type: "saveTodoLabelDefinition",
          data: { name: label, color: pendingColor }
        });
      }
      syncTodoEditorTransientDraft();
      syncTodoLabelEditor();
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
        setPendingBoardDelete: function(todoId, permanentOnly) {
          pendingBoardDeleteTodoId = String(todoId || "");
          pendingBoardDeletePermanentOnly = !!permanentOnly;
          requestCockpitBoardRender();
        },
        clearPendingBoardDelete: function() {
          pendingBoardDeleteTodoId = "";
          pendingBoardDeletePermanentOnly = false;
          requestCockpitBoardRender();
        },
        submitBoardDeleteChoice: function(choice) {
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
            todoId
          });
        },
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
            clearPendingGridTodoCompletion,
            isPendingGridTodoCompletion: hasPendingGridTodoCompletion,
            startPendingGridTodoCompletion,
            strings,
            vscode
          });
        },
        handleTodoCompletionCancel: function(cancelBtn) {
          handleBoardTodoCompletionCancel(cancelBtn, {
            clearPendingGridTodoCompletion
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
        isArchiveTodoSectionId,
        isSpecialTodoSectionId
      });
    }
    function ensureTodoEditorListenersBound() {
      if (todoEditorListenersBound) {
        return;
      }
      todoEditorListenersBound = true;
      [todoTitleInput, todoDescriptionInput, todoCommentInput, todoDueInput].forEach(function(element) {
        if (!element || typeof element.addEventListener !== "function") {
          return;
        }
        element.addEventListener("input", function() {
          syncTodoDraftFromInputs("input");
          if (element === todoCommentInput) {
            renderTodoCommentSectionState(selectedTodoId ? findTodoById(selectedTodoId) : null);
          }
        });
      });
      [todoPriorityInput, todoSectionInput, todoLinkedTaskSelect].forEach(function(element) {
        if (!element || typeof element.addEventListener !== "function") {
          return;
        }
        element.addEventListener("change", function() {
          syncTodoDraftFromInputs("change");
          if (element === todoPriorityInput) {
            syncTodoPriorityInputTone();
          }
        });
      });
      bindDebugClickAttempts(todoDetailForm, {
        selector: "#todo-label-add-btn, #todo-label-color-save-btn, #todo-flag-add-btn, #todo-flag-color-save-btn, #todo-label-color-input, #todo-flag-color-input",
        eventName: "todoDetailClickAttempt"
      });
      if (todoDetailForm) {
        todoDetailForm.addEventListener("click", function(event) {
          var templateBtn = getClosestEventTarget(event, "[data-comment-template]");
          if (!templateBtn) {
            return;
          }
          appendTextToTodoComment(String(templateBtn.getAttribute("data-comment-template") || ""));
        });
      }
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
      var activeFlagName = getActiveTodoFlagEditorName();
      var activeFlagDefinition = activeFlagName ? getFlagDefinition(activeFlagName) : null;
      if (todoflagCurrentEl) {
        if (currentTodoFlag) {
          todoflagCurrentEl.innerHTML = renderFlagChip(currentTodoFlag, true);
        } else {
          todoflagCurrentEl.innerHTML = '<span class="note">' + escapeHtml(strings.boardFlagNone || "No flag set.") + "</span>";
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
            var protectedFlag = isProtectedFlagDefinition(entry);
            var displayName = getFlagDisplayName(entry.name);
            return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:' + escapeAttr(bg) + ";color:" + escapeAttr(fg) + ";border:" + borderStyle + ';font-size:inherit;font-weight:600;line-height:1.4;"><button type="button" data-flag-catalog-select="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="' + escapeAttr(strings.boardFlagCatalogSelectTitle || "Set as flag") + '">' + escapeHtml(displayName) + "</button>" + (protectedFlag ? '<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.75;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogLockedTitle || "Built-in flag") + '">\u{1F512}</span>' : pendingDelete ? '<button type="button" data-flag-catalog-confirm-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="' + escapeAttr(strings.boardFlagCatalogDeleteTitle || "Delete flag") + '">' + escapeHtml(strings.boardDeleteConfirm || "Delete?") + "</button>" : '<button type="button" data-flag-catalog-edit="' + escapeAttr(entry.name) + '" data-flag-catalog-edit-color="' + escapeAttr(bg) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogEditTitle || "Edit flag") + '">\u270E</button><button type="button" data-flag-catalog-delete="' + escapeAttr(entry.name) + '" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="' + escapeAttr(strings.boardFlagCatalogDeleteTitle || "Delete flag") + '">\xD7</button>') + "</span>";
          }).join("");
        }
      }
      if (todoFlagColorInput) {
        var draftFlagColor = !selectedTodoId && currentTodoDraft ? getValidFlagColorValue(currentTodoDraft.flagColor, "") : "";
        var pendingFlagColor = getPendingTodoEditorColor(
          pendingTodoFlagEditorState,
          activeFlagName
        );
        var nextFlagColor = pendingFlagColor || draftFlagColor || getValidFlagColorValue(activeFlagDefinition && activeFlagDefinition.color, "");
        todoFlagColorInput.value = getValidFlagColorValue(nextFlagColor, "#f59e0b");
        rememberPendingTodoEditorColor(
          pendingTodoFlagEditorState,
          activeFlagName,
          todoFlagColorInput.value
        );
        todoFlagColorInput.disabled = false;
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
        if (normalizeTodoLabelKey(currentTodoFlag) === normalizeTodoLabelKey(prevName)) {
          currentTodoFlag = name;
        }
      }
      vscode.postMessage({ type: "saveTodoFlagDefinition", data: { name, previousName: prevName || void 0, color } });
      if (!prevName) {
        currentTodoFlag = name;
      }
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
        case "completed":
          return strings.boardStatusCompleted || "Completed";
        case "rejected":
          return strings.boardArchiveRejected || "Rejected";
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
    function renderTodoCommentEmptyMarkup(title, body) {
      return '<div class="todo-comment-empty-state"><div class="todo-comment-empty-title">' + escapeHtml(title) + '</div><div class="note">' + escapeHtml(body) + "</div></div>";
    }
    function renderTodoCommentDraftPreviewMarkup(commentBody) {
      return '<article class="todo-comment-card is-human-form is-user-form is-preview"><div class="todo-comment-header"><div class="todo-comment-heading"><span class="todo-comment-sequence">' + escapeHtml(strings.boardCommentModeCreate || "Kickoff note") + '</span><span class="todo-comment-source-chip">' + escapeHtml(strings.boardCommentSourceHumanForm || "Human form") + '</span></div><div class="todo-comment-meta"><span class="note">' + escapeHtml(strings.boardCommentPreviewPending || "Saved on create") + '</span></div></div><div class="note todo-comment-author">user</div><div class="todo-comment-body">' + escapeHtml(commentBody || "") + '</div><div class="todo-comment-expand-hint">' + escapeHtml(strings.boardCommentThreadCreateNote || "Preview of the kickoff note that will be saved on create.") + "</div></article>";
    }
    function renderTodoCommentListMarkup(comments) {
      if (!comments.length) {
        return renderTodoCommentEmptyMarkup(
          strings.boardCommentsEmpty || "No comments yet.",
          strings.boardCommentEditHint || "Add a focused update without rewriting the full description."
        );
      }
      return comments.slice().reverse().map(function(comment, reverseIndex) {
        var source = comment && comment.source ? String(comment.source) : "human-form";
        var commentIndex = comments.length - reverseIndex - 1;
        var sourceLabel = getTodoCommentSourceLabel(source);
        var sequence = typeof comment.sequence === "number" ? comment.sequence : 1;
        var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
        var toneClass = getTodoCommentToneClass(comment);
        var userFormClass = source === "human-form" && String(comment.author || "").toLowerCase() === "user" ? " is-user-form" : "";
        var rawBody = String(comment.body || "");
        var previewBody = source === "system-event" ? rawBody.replace(/\s+/g, " ").trim() : rawBody;
        if (source === "system-event" && previewBody.length > 140) {
          previewBody = previewBody.slice(0, 137) + "...";
        }
        return '<article class="todo-comment-card' + toneClass + userFormClass + '" data-comment-index="' + escapeAttr(String(commentIndex)) + '" tabindex="0" role="button" aria-label="' + escapeAttr(strings.boardCommentOpenFull || "Open full comment") + '"><div class="todo-comment-header"><div class="todo-comment-heading"><span class="todo-comment-sequence">#' + escapeHtml(String(sequence)) + '</span><span class="todo-comment-source-chip">' + escapeHtml(sourceLabel) + '</span></div><div class="todo-comment-meta"><span class="note">' + escapeHtml(formatTodoDate(displayDate)) + '</span><button type="button" class="btn-icon todo-comment-delete-btn" data-delete-comment-index="' + escapeAttr(String(commentIndex)) + '" title="' + escapeAttr(strings.boardCommentDelete || "Delete comment") + '">&#128465;</button></div></div><div class="note todo-comment-author">' + escapeHtml(comment.author || "system") + '</div><div class="todo-comment-body">' + escapeHtml(previewBody) + '</div><div class="todo-comment-expand-hint">' + escapeHtml(strings.boardCommentOpenFull || "Open full comment") + "</div></article>";
      }).join("");
    }
    function renderTodoCommentSectionState(selectedTodo) {
      var isEditingTodo = !!selectedTodo;
      var isArchivedTodo = !!(selectedTodo && selectedTodo.archived);
      var todoDraft = isEditingTodo ? null : currentTodoDraft;
      var comments = isEditingTodo && Array.isArray(selectedTodo.comments) ? selectedTodo.comments : [];
      var commentDraftValue = todoCommentInput ? String(todoCommentInput.value || "").trim() : !isEditingTodo && todoDraft ? String(todoDraft.comment || "").trim() : "";
      if (todoCommentCountBadge) {
        todoCommentCountBadge.textContent = isEditingTodo ? String(comments.length) : commentDraftValue ? strings.boardCommentBadgePreview || "Preview" : strings.boardCommentBadgeDraft || "Draft";
      }
      if (todoCommentModePill) {
        todoCommentModePill.textContent = isEditingTodo ? strings.boardCommentModeEdit || "Live thread" : strings.boardCommentModeCreate || "Kickoff note";
      }
      if (todoCommentContextNote) {
        todoCommentContextNote.textContent = isEditingTodo ? strings.boardCommentsEditIntro || "Keep approvals, decisions, and handoff context in the thread while the main description stays stable." : strings.boardCommentsCreateIntro || "Start the thread early so context, approvals, and decisions do not get buried in the description.";
      }
      var todoCommentsHeading = document.getElementById("todo-comments-heading");
      if (todoCommentsHeading) {
        var todoCommentsHelpText = isEditingTodo ? strings.boardCommentsEditIntro || "Keep approvals, decisions, and handoff context in the thread while the main description stays stable." : strings.boardCommentsCreateIntro || "Start the thread early so context, approvals, and decisions do not get buried in the description.";
        todoCommentsHeading.setAttribute("title", todoCommentsHelpText);
        var todoCommentsHeadingHelpRoot = todoCommentsHeading.parentElement;
        if (todoCommentsHeadingHelpRoot) {
          todoCommentsHeadingHelpRoot.setAttribute("title", todoCommentsHelpText);
          var todoCommentsHeadingHelpTrigger = todoCommentsHeadingHelpRoot.querySelector(".section-title-help-trigger");
          if (todoCommentsHeadingHelpTrigger) {
            todoCommentsHeadingHelpTrigger.setAttribute("title", todoCommentsHelpText);
          }
        }
      }
      if (todoCommentComposerTitle) {
        todoCommentComposerTitle.textContent = isEditingTodo ? strings.boardCommentComposerEditTitle || "Add to the thread" : strings.boardCommentComposerCreateTitle || "Write the kickoff comment";
      }
      if (todoCommentComposerNote) {
        todoCommentComposerNote.textContent = isEditingTodo ? strings.boardCommentEditHint || "Add a focused update without rewriting the full description." : strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.";
      }
      if (todoCommentDraftStatus) {
        if (isArchivedTodo) {
          todoCommentDraftStatus.textContent = strings.boardReadOnlyArchived || "Archived items are read-only in the editor. Use Restore on the board to reopen them.";
        } else if (isEditingTodo) {
          todoCommentDraftStatus.textContent = commentDraftValue ? strings.boardCommentReadyToAdd || "Ready to append to the live thread." : strings.boardCommentEditHint || "Add a focused update without rewriting the full description.";
        } else {
          todoCommentDraftStatus.textContent = commentDraftValue ? strings.boardCommentCreateReady || "This draft will be saved as the first human comment when you create the todo." : strings.boardCommentCreateHint || "Optional, but recommended: add the first human note now so the todo starts with useful context.";
        }
      }
      if (todoCommentThreadNote) {
        if (isEditingTodo) {
          todoCommentThreadNote.textContent = comments.length > 0 ? strings.boardCommentThreadEditNote || "Open any card to read the full comment or remove a thread entry." : strings.boardCommentEditHint || "Add a focused update without rewriting the full description.";
        } else {
          todoCommentThreadNote.textContent = commentDraftValue ? strings.boardCommentThreadCreateNote || "Preview of the kickoff note that will be saved on create." : strings.boardCommentThreadCreateEmpty || "Start typing to preview the kickoff comment.";
        }
      }
      if (todoCommentInput) {
        todoCommentInput.placeholder = isEditingTodo ? strings.boardCommentPlaceholder || "Add a comment with context, provenance, or approval notes..." : strings.boardCommentCreatePlaceholder || "Capture the first decision, approval note, or handoff context for this todo...";
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
      todoCommentList.innerHTML = commentDraftValue ? renderTodoCommentDraftPreviewMarkup(commentDraftValue) : renderTodoCommentEmptyMarkup(
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
    function normalizeTodoFilters(filters2) {
      var record = filters2 && typeof filters2 === "object" ? filters2 : {};
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
        hideCardDetails: record.hideCardDetails === true
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
      return nextLeft.searchText === nextRight.searchText && areTodoFilterListsEqual(nextLeft.labels, nextRight.labels) && areTodoFilterListsEqual(nextLeft.priorities, nextRight.priorities) && areTodoFilterListsEqual(nextLeft.statuses, nextRight.statuses) && areTodoFilterListsEqual(nextLeft.archiveOutcomes, nextRight.archiveOutcomes) && areTodoFilterListsEqual(nextLeft.flags, nextRight.flags) && nextLeft.sectionId === nextRight.sectionId && nextLeft.sortBy === nextRight.sortBy && nextLeft.sortDirection === nextRight.sortDirection && nextLeft.viewMode === nextRight.viewMode && nextLeft.showArchived === nextRight.showArchived && nextLeft.showRecurringTasks === nextRight.showRecurringTasks && nextLeft.hideCardDetails === nextRight.hideCardDetails;
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
        } catch (_e) {
        }
      }
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
      pendingTodoFilters = next;
      cockpitBoard.filters = next;
      renderCockpitBoard();
      vscode.postMessage({ type: "setTodoFilters", data: next });
    }
    function hasActiveTodoFilters(filters2) {
      var current = filters2 || getTodoFilters();
      return Boolean(
        current.searchText && String(current.searchText).trim() || Array.isArray(current.labels) && current.labels.length > 0 || Array.isArray(current.priorities) && current.priorities.length > 0 || Array.isArray(current.statuses) && current.statuses.length > 0 || Array.isArray(current.archiveOutcomes) && current.archiveOutcomes.length > 0 || Array.isArray(current.flags) && current.flags.length > 0 || current.sectionId && String(current.sectionId).trim() || current.showArchived === true || current.showRecurringTasks === true || current.hideCardDetails === true
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
        hideCardDetails: false
      });
    }
    function getTodoSections(filters2) {
      var sections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice() : [];
      sections.sort(function(left, right) {
        return (left.order || 0) - (right.order || 0);
      });
      return sections.filter(function(section) {
        if (!(filters2 && filters2.showArchived === true) && isArchiveTodoSectionId(section.id)) {
          return false;
        }
        if (!(filters2 && filters2.showRecurringTasks === true) && isRecurringTodoSectionId(section.id)) {
          return false;
        }
        return true;
      });
    }
    function getEditableTodoSections() {
      return getTodoSections({ showArchived: true, showRecurringTasks: true }).filter(function(section) {
        return !isSpecialTodoSectionId(section.id);
      });
    }
    function isTodoReadyForFinalize(card) {
      var workflowFlag = getTodoWorkflowFlag(card);
      return !!(card && !card.archived && (workflowFlag === "ready" || workflowFlag === "final-user-check" || String(card.status || "").toLowerCase() === "ready"));
    }
    function getTodoCompletionActionType(card) {
      return isTodoReadyForFinalize(card) ? "finalizeTodo" : "approveTodo";
    }
    function getTodoCompletionActionLabel(card) {
      return isTodoReadyForFinalize(card) ? strings.boardFinalizeTodo || "Final Accept" : strings.boardApproveTodo || "Approve";
    }
    function getTodoFinalizeConfirmLabel() {
      return strings.boardFinalizeTodoYes || "Yes";
    }
    function getTodoFinalizeCancelLabel() {
      return strings.boardFinalizeTodoNo || "No";
    }
    function clearTodoCompletionConfirmTimer() {
      if (todoCompletionConfirmTimer) {
        window.clearTimeout(todoCompletionConfirmTimer);
        todoCompletionConfirmTimer = null;
      }
    }
    function hasPendingGridTodoCompletion(todoId) {
      return !!(todoId && Object.prototype.hasOwnProperty.call(pendingGridTodoCompletions, todoId));
    }
    function clearPendingGridTodoCompletion(todoId, skipRender) {
      if (!hasPendingGridTodoCompletion(todoId)) {
        return;
      }
      window.clearTimeout(pendingGridTodoCompletions[todoId]);
      delete pendingGridTodoCompletions[todoId];
      if (!skipRender) {
        requestCockpitBoardRender();
      }
    }
    function startPendingGridTodoCompletion(todoId) {
      if (!todoId) {
        return;
      }
      clearPendingGridTodoCompletion(todoId, true);
      pendingGridTodoCompletions[todoId] = window.setTimeout(function() {
        clearPendingGridTodoCompletion(todoId);
      }, TODO_COMPLETION_CONFIRM_TIMEOUT_MS);
      requestCockpitBoardRender();
    }
    function reconcilePendingGridTodoCompletions(cards) {
      var activeCardsById = {};
      if (Array.isArray(cards)) {
        cards.forEach(function(card) {
          if (card && card.id && !card.archived) {
            activeCardsById[card.id] = true;
          }
        });
      }
      Object.keys(pendingGridTodoCompletions).forEach(function(todoId) {
        if (!activeCardsById[todoId]) {
          clearPendingGridTodoCompletion(todoId, true);
        }
      });
    }
    function isTodoCompletionConfirmPending(card) {
      return !!(card && todoCompletionConfirmState && todoCompletionConfirmState.todoId === card.id && todoCompletionConfirmState.actionType === getTodoCompletionActionType(card));
    }
    function getTodoCompletionConfirmStepLabel(card) {
      return (strings.boardConfirmAction || "Confirm") + " " + getTodoCompletionActionLabel(card);
    }
    function syncTodoCompletionButtonState() {
      if (!todoCompleteBtn) {
        return;
      }
      var selectedTodo = selectedTodoId ? findTodoById(selectedTodoId) : null;
      var isEditingTodo = !!selectedTodo;
      var isArchivedTodo = !!(selectedTodo && selectedTodo.archived);
      var hasPendingConfirm = isTodoCompletionConfirmPending(selectedTodo);
      if (todoCompletionConfirmState && !hasPendingConfirm) {
        clearTodoCompletionConfirmTimer();
        todoCompletionConfirmState = null;
      }
      var buttonLabel = isEditingTodo ? getTodoCompletionActionLabel(selectedTodo) : strings.boardApproveTodo || "Approve";
      if (hasPendingConfirm) {
        buttonLabel = getTodoCompletionConfirmStepLabel(selectedTodo);
      }
      todoCompleteBtn.textContent = buttonLabel;
      todoCompleteBtn.disabled = !isEditingTodo || isArchivedTodo;
      todoCompleteBtn.setAttribute("aria-label", buttonLabel);
      todoCompleteBtn.setAttribute("title", buttonLabel);
      todoCompleteBtn.setAttribute("data-confirm-state", hasPendingConfirm ? "pending" : "idle");
    }
    function resetTodoCompletionInlineConfirm() {
      clearTodoCompletionConfirmTimer();
      todoCompletionConfirmState = null;
      syncTodoCompletionButtonState();
    }
    function startTodoCompletionInlineConfirm(card) {
      if (!card || card.archived) {
        return;
      }
      todoCompletionConfirmState = {
        todoId: card.id,
        actionType: getTodoCompletionActionType(card)
      };
      clearTodoCompletionConfirmTimer();
      todoCompletionConfirmTimer = window.setTimeout(function() {
        resetTodoCompletionInlineConfirm();
      }, TODO_COMPLETION_CONFIRM_TIMEOUT_MS);
      syncTodoCompletionButtonState();
    }
    function isTodoCompleted(card) {
      return !!(card && card.archived && card.archiveOutcome === "completed-successfully");
    }
    function renderTodoCompletionButton(card) {
      var isArchivedCard = !!(card && card.archived);
      var hasPendingConfirm = !isArchivedCard && hasPendingGridTodoCompletion(card && card.id);
      var title = isArchivedCard ? strings.boardRestoreTodo || "Restore" : getTodoCompletionActionLabel(card);
      var icon = isTodoCompleted(card) ? "\u2713" : "\u25CB";
      var actionAttr = isArchivedCard ? "data-todo-restore" : "data-todo-complete";
      var className = "todo-complete-button";
      if (isTodoReadyForFinalize(card)) {
        className += " is-ready-to-finalize";
      }
      if (isTodoCompleted(card)) {
        className += " is-completed";
      }
      if (hasPendingConfirm) {
        var confirmLabel = isTodoReadyForFinalize(card) ? strings.boardFinalizeTodoYes || "Yes" : strings.boardConfirmAction || "Confirm";
        var confirmPrompt = isTodoReadyForFinalize(card) ? strings.boardFinalizePrompt || "Archive this todo as completed successfully?" : strings.boardApprovePrompt || "Mark this todo ready for task draft creation?";
        var cancelLabel = isTodoReadyForFinalize(card) ? strings.boardFinalizeTodoNo || "No" : strings.boardCancelAction || "Cancel";
        return '<button type="button" class="' + className + ' is-confirming" data-todo-complete="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(confirmPrompt) + '" aria-label="' + escapeAttr(confirmLabel) + '"' + (isTodoReadyForFinalize(card) ? ' data-finalize-state="confirming"' : "") + ' style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;border:1px solid var(--vscode-input-border, var(--vscode-panel-border));background:var(--vscode-input-background);color:var(--vscode-foreground);cursor:pointer;font-size:12px;font-weight:700;line-height:1;flex:0 0 auto;padding:0 10px;"><span aria-hidden="true">' + escapeHtml(confirmLabel) + '</span></button><button type="button" class="todo-complete-button is-cancel" data-todo-complete-cancel="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(cancelLabel) + '" aria-label="' + escapeAttr(cancelLabel) + '" style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;border:1px solid var(--vscode-input-border, var(--vscode-panel-border));background:var(--vscode-button-secondaryBackground, var(--vscode-input-background));color:var(--vscode-button-secondaryForeground, var(--vscode-foreground));cursor:pointer;font-size:12px;font-weight:700;line-height:1;flex:0 0 auto;padding:0 10px;margin-left:6px;">' + escapeHtml(cancelLabel) + "</button>";
      }
      return '<button type="button" class="' + className + '" ' + actionAttr + '="' + escapeAttr(card.id) + '" data-no-drag="1" title="' + escapeAttr(title) + '" aria-label="' + escapeAttr(title) + '"' + (isTodoReadyForFinalize(card) ? ' data-finalize-state="idle" data-confirm-label="' + escapeAttr(getTodoFinalizeConfirmLabel()) + '" data-cancel-label="' + escapeAttr(getTodoFinalizeCancelLabel()) + '"' : "") + ' style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;border:1px solid var(--vscode-input-border, var(--vscode-panel-border));background:' + (isTodoCompleted(card) ? "color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 82%, var(--vscode-button-background))" : "var(--vscode-input-background)") + ";color:" + (isTodoCompleted(card) ? "var(--vscode-button-foreground)" : "var(--vscode-foreground)") + ';cursor:pointer;font-size:12px;font-weight:700;line-height:1;flex:0 0 auto;"><span aria-hidden="true">' + escapeHtml(icon) + "</span></button>";
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
    function cardMatchesTodoFilters(card, filters2) {
      if (!filters2.showArchived && card.archived) {
        return false;
      }
      if (!filters2.showRecurringTasks && isRecurringTodoSectionId(card.sectionId)) {
        return false;
      }
      if (filters2.sectionId && card.sectionId !== filters2.sectionId) {
        return false;
      }
      if (filters2.labels.length > 0) {
        var hasLabel = (card.labels || []).some(function(label) {
          return filters2.labels.indexOf(label) >= 0;
        });
        if (!hasLabel) return false;
      }
      if (filters2.priorities.length > 0 && filters2.priorities.indexOf(card.priority || "none") < 0) {
        return false;
      }
      if (filters2.statuses.length > 0 && filters2.statuses.indexOf(card.status || "active") < 0) {
        return false;
      }
      if (filters2.archiveOutcomes.length > 0) {
        if (!card.archived || filters2.archiveOutcomes.indexOf(card.archiveOutcome || "") < 0) {
          return false;
        }
      }
      if (filters2.flags.length > 0) {
        var hasFlag = (card.flags || []).some(function(flag) {
          return filters2.flags.indexOf(flag) >= 0;
        });
        if (!hasFlag) return false;
      }
      if (filters2.searchText) {
        var needle = String(filters2.searchText).toLowerCase();
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
    function sortTodoCards(cards, filters2) {
      var direction = filters2.sortDirection === "desc" ? -1 : 1;
      return cards.slice().sort(function(left, right) {
        var result = 0;
        switch (filters2.sortBy) {
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
    function renderTodoFilterControls(filters2, sections, cards) {
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
      if (todoSearchInput) todoSearchInput.value = filters2.searchText || "";
      if (todoSectionFilter) {
        todoSectionFilter.innerHTML = '<option value="">' + escapeHtml(strings.boardAllSections || "All sections") + "</option>" + sections.map(function(section) {
          return '<option value="' + escapeAttr(section.id) + '">' + escapeHtml(section.title) + "</option>";
        }).join("");
        todoSectionFilter.value = filters2.sectionId || "";
      }
      if (todoLabelFilter) {
        todoLabelFilter.innerHTML = '<option value="">' + escapeHtml(strings.boardAllLabels || "All labels") + "</option>" + labels.map(function(label) {
          return '<option value="' + escapeAttr(label) + '">' + escapeHtml(label) + "</option>";
        }).join("");
        todoLabelFilter.value = filters2.labels[0] || "";
      }
      if (todoFlagFilter) {
        todoFlagFilter.innerHTML = '<option value="">' + escapeHtml(strings.boardAllFlags || "All flags") + "</option>" + flags.map(function(flag) {
          return '<option value="' + escapeAttr(flag) + '">' + escapeHtml(flag) + "</option>";
        }).join("");
        todoFlagFilter.value = filters2.flags[0] || "";
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
        todoPriorityFilter.value = filters2.priorities[0] || "";
      }
      if (todoStatusFilter) {
        todoStatusFilter.innerHTML = [
          { value: "", label: strings.boardAllStatuses || "All statuses" },
          { value: "active", label: getTodoStatusLabel("active") },
          { value: "completed", label: getTodoStatusLabel("completed") },
          { value: "rejected", label: getTodoStatusLabel("rejected") }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoStatusFilter.value = filters2.statuses[0] || "";
      }
      if (todoArchiveOutcomeFilter) {
        todoArchiveOutcomeFilter.innerHTML = [
          { value: "", label: strings.boardAllArchiveOutcomes || "All outcomes" },
          { value: "completed-successfully", label: getTodoArchiveOutcomeLabel("completed-successfully") },
          { value: "rejected", label: getTodoArchiveOutcomeLabel("rejected") }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoArchiveOutcomeFilter.value = filters2.archiveOutcomes[0] || "";
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
        todoSortBy.value = filters2.sortBy || "manual";
      }
      if (todoSortDirection) {
        todoSortDirection.innerHTML = [
          { value: "asc", label: strings.boardSortAsc || "Ascending" },
          { value: "desc", label: strings.boardSortDesc || "Descending" }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoSortDirection.value = filters2.sortDirection || "asc";
      }
      if (todoViewMode) {
        todoViewMode.innerHTML = [
          { value: "board", label: strings.boardViewBoard || "Board" },
          { value: "list", label: strings.boardViewList || "List" }
        ].map(function(option) {
          return '<option value="' + escapeAttr(option.value) + '">' + escapeHtml(option.label) + "</option>";
        }).join("");
        todoViewMode.value = filters2.viewMode || "board";
      }
      if (todoShowArchived) {
        todoShowArchived.checked = filters2.showArchived === true;
      }
      if (todoShowRecurringTasks) {
        todoShowRecurringTasks.checked = filters2.showRecurringTasks === true;
      }
      if (todoHideCardDetails) {
        var hideCardDetails = filters2.hideCardDetails === true || boardCardDetailsHidden === true;
        todoHideCardDetails.checked = hideCardDetails;
      }
      document.documentElement.classList.toggle(
        "cockpit-board-hide-card-details",
        filters2.hideCardDetails === true || boardCardDetailsHidden === true
      );
      if (todoClearFiltersBtn) {
        todoClearFiltersBtn.disabled = !hasActiveTodoFilters(filters2);
      }
      if (cockpitColSlider) {
        var widthGroup = cockpitColSlider.closest ? cockpitColSlider.closest(".board-col-width-group") : null;
        if (widthGroup) {
          widthGroup.style.display = filters2.viewMode === "list" ? "none" : "flex";
        }
      }
    }
    function renderTodoDetailPanel(selectedTodo, sections) {
      var isEditingTodo = !!selectedTodo;
      var isArchivedTodo = !!(selectedTodo && selectedTodo.archived);
      var todoDraft = isEditingTodo ? null : currentTodoDraft;
      var isRefreshingSameTodo = isEditingTodo && activeTabName === "todo-edit" && todoDetailId && todoDetailId.value === selectedTodo.id;
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
        var todoDetailHelpText = isEditingTodo ? strings.boardDetailModeEdit || "Update this todo." : strings.boardDetailModeCreate || "Fill the form to create a new todo.";
        todoDetailTitle.textContent = isEditingTodo ? strings.boardDetailTitleEdit || "Edit Todo" : strings.boardDetailTitleCreate || "Create Todo";
        todoDetailTitle.setAttribute("title", todoDetailHelpText);
        var todoDetailTitleHelpRoot = todoDetailTitle.parentElement;
        if (todoDetailTitleHelpRoot) {
          todoDetailTitleHelpRoot.setAttribute("title", todoDetailHelpText);
          var todoDetailTitleHelpTrigger = todoDetailTitleHelpRoot.querySelector(".section-title-help-trigger");
          if (todoDetailTitleHelpTrigger) {
            todoDetailTitleHelpTrigger.setAttribute("title", todoDetailHelpText);
          }
        }
      }
      if (todoDetailModeNote) {
        todoDetailModeNote.textContent = isEditingTodo ? strings.boardDetailModeEdit || "Update this todo." : strings.boardDetailModeCreate || "Fill the form to create a new todo.";
      }
      if (todoDetailId) todoDetailId.value = isEditingTodo ? selectedTodo.id : "";
      if (!isRefreshingSameTodo) {
        if (todoTitleInput) todoTitleInput.value = isEditingTodo ? selectedTodo.title || "" : todoDraft.title || "";
        if (todoDescriptionInput) todoDescriptionInput.value = isEditingTodo ? selectedTodo.description || "" : todoDraft.description || "";
        if (todoCommentInput) todoCommentInput.value = isEditingTodo ? "" : todoDraft.comment || "";
        if (todoDueInput) todoDueInput.value = isEditingTodo ? toLocalDateTimeInput(selectedTodo.dueAt) : todoDraft.dueAt || "";
        if (todoLabelsInput) todoLabelsInput.value = isEditingTodo ? "" : todoDraft.labelInput || "";
        if (todoLabelColorInput && !isEditingTodo && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(todoDraft.labelColor || "")) {
          todoLabelColorInput.value = todoDraft.labelColor;
        }
        currentTodoFlag = isEditingTodo ? getTodoWorkflowFlag(selectedTodo) || ((selectedTodo.flags || [])[0] || "") : todoDraft.flag || "";
        if (todoFlagNameInput) todoFlagNameInput.value = isEditingTodo ? "" : todoDraft.flagInput || "";
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
          todoDetailStatus.textContent = strings.boardStatusLabel ? strings.boardStatusLabel + ": " + (strings.boardStatusActive || "Active") : "Status: Active";
        } else if (selectedTodo.archived) {
          todoDetailStatus.textContent = (strings.boardStatusLabel || "Status") + ": " + getTodoStatusLabel(selectedTodo.status || "active") + " \u2022 " + getTodoArchiveOutcomeLabel(selectedTodo.archiveOutcome || "rejected");
        } else {
          var workflowFlag = getTodoWorkflowFlag(selectedTodo);
          todoDetailStatus.textContent = (strings.boardStatusLabel || "Status") + ": " + getTodoStatusLabel(selectedTodo.status || "active") + " \u2022 " + (strings.boardWorkflowLabel || "Workflow") + ": " + getFlagDisplayName(workflowFlag || "new");
        }
      }
      if (todoPriorityInput) {
        var prevPriority = isRefreshingSameTodo ? todoPriorityInput.value : "";
        todoPriorityInput.innerHTML = ["none", "low", "medium", "high", "urgent"].map(function(priority) {
          return '<option value="' + escapeAttr(priority) + '">' + escapeHtml(getTodoPriorityLabel(priority)) + "</option>";
        }).join("");
        todoPriorityInput.value = isRefreshingSameTodo ? prevPriority : isEditingTodo ? selectedTodo.priority || "none" : todoDraft.priority || "none";
        syncTodoPriorityInputTone();
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
        todoCreateTaskBtn.disabled = !isEditingTodo || isArchivedTodo || getTodoWorkflowFlag(selectedTodo) !== "ready";
      }
      if (todoCompletionConfirmState && !isTodoCompletionConfirmPending(selectedTodo)) {
        clearTodoCompletionConfirmTimer();
        todoCompletionConfirmState = null;
      }
      syncTodoCompletionButtonState();
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
      renderGitHubBoardInbox();
      var filters2 = getTodoFilters();
      var sections = getTodoSections(filters2);
      var allSections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice().sort(function(left, right) {
        return (left.order || 0) - (right.order || 0);
      }) : [];
      var allCards = getAllTodoCards();
      var cards = getVisibleTodoCards(filters2);
      var editorTodoId = activeTabName === "todo-edit" ? getActiveTodoEditorId() : "";
      if (!selectedTodoId && editorTodoId) {
        var editorTodoExists = allCards.some(function(card) {
          return card && card.id === editorTodoId;
        });
        if (editorTodoExists) {
          selectedTodoId = editorTodoId;
        }
      }
      if (selectedTodoId) {
        var selectedTodo = allCards.find(function(card) {
          return card && card.id === selectedTodoId;
        });
        if (selectedTodo && selectedTodo.archived && filters2.showArchived !== true && selectedTodoId !== editorTodoId) {
          selectedTodoId = null;
        }
        if (selectedTodo && isRecurringTodoSectionId(selectedTodo.sectionId) && filters2.showRecurringTasks !== true && selectedTodoId !== editorTodoId) {
          selectedTodoId = null;
        }
        var hasSelectedTodo = allCards.some(function(card) {
          return card && card.id === selectedTodoId;
        });
        if (!hasSelectedTodo) {
          selectedTodoId = null;
        }
      }
      renderTodoFilterControls(filters2, sections, cards);
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
      var visibleSections2 = sections.filter(function(section) {
        return !filters2.sectionId || section.id === filters2.sectionId;
      });
      if (visibleSections2.length === 0) {
        boardColumns.innerHTML = '<div class="note">' + escapeHtml(strings.boardEmpty || "No cards yet.") + "</div>";
        renderTodoDetailPanel(null, sections);
        return;
      }
      boardColumns.innerHTML = renderTodoBoardMarkup({
        visibleSections: visibleSections2,
        cards,
        filters: filters2,
        strings,
        selectedTodoId,
        pendingBoardDeleteTodoId,
        pendingBoardDeletePermanentOnly,
        collapsedSections,
        helpers: {
          escapeAttr,
          escapeHtml,
          sortTodoCards,
          cardMatchesTodoFilters,
          isArchiveTodoSectionId,
          isSpecialTodoSectionId,
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
      scheduleBoardStickyMetrics();
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
          applyCockpitColumnScale(w);
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
      if (todoShowRecurringTasks) {
        todoShowRecurringTasks.onchange = function() {
          updateTodoFilters({ showRecurringTasks: todoShowRecurringTasks.checked === true });
        };
      }
      if (todoHideCardDetails) {
        todoHideCardDetails.onchange = function() {
          updateTodoFilters({ hideCardDetails: todoHideCardDetails.checked === true });
        };
      }
      if (todoToggleFiltersBtn) {
        todoToggleFiltersBtn.onclick = function() {
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
          var commentBody = todoCommentInput ? String(todoCommentInput.value || "").trim() : "";
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
          var activeTodoId = getActiveTodoEditorId();
          if (activeTodoId) {
            selectedTodoId = activeTodoId;
            vscode.postMessage({ type: "updateTodo", todoId: activeTodoId, data: payload });
          } else {
            if (commentBody) {
              payload.comment = commentBody;
            }
            emitWebviewDebug("todoCreateSubmit", {
              hasComment: !!commentBody,
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
          renderTodoCommentSectionState(findTodoById(selectedTodoId));
        };
      }
      if (todoCommentList) {
        todoCommentList.onclick = function(event) {
          var deleteBtn = getClosestEventTarget(event, "[data-delete-comment-index]");
          if (deleteBtn && selectedTodoId) {
            event.stopPropagation();
            var commentIndex = Number(deleteBtn.getAttribute("data-delete-comment-index"));
            if (!isNaN(commentIndex)) {
              vscode.postMessage({
                type: "deleteTodoComment",
                todoId: selectedTodoId,
                commentIndex
              });
            }
            return;
          }
          var commentCard = getClosestEventTarget(event, "[data-comment-index]");
          if (!commentCard || !selectedTodoId) {
            return;
          }
          var commentIndex = Number(commentCard.getAttribute("data-comment-index"));
          var selectedTodo2 = findTodoById(selectedTodoId);
          var comments = selectedTodo2 && Array.isArray(selectedTodo2.comments) ? selectedTodo2.comments : [];
          if (commentIndex < 0 || commentIndex >= comments.length) {
            return;
          }
          openTodoCommentModal(comments[commentIndex]);
        };
        todoCommentList.onkeydown = function(event) {
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
        todoUploadFilesBtn.onclick = function() {
          vscode.postMessage({
            type: "requestTodoFileUpload",
            todoId: selectedTodoId || void 0
          });
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
          var selectedTodo2 = findTodoById(selectedTodoId);
          if (!selectedTodo2 || selectedTodo2.archived) {
            resetTodoCompletionInlineConfirm();
            return;
          }
          var actionType = getTodoCompletionActionType(selectedTodo2);
          if (!isTodoCompletionConfirmPending(selectedTodo2)) {
            startTodoCompletionInlineConfirm(selectedTodo2);
            return;
          }
          resetTodoCompletionInlineConfirm();
          vscode.postMessage({
            type: actionType,
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
              selectedTodoLabelName = def.name;
            } else {
              selectedTodoLabelName = "";
            }
            if (todoLabelColorInput) todoLabelColorInput.disabled = false;
          } else {
            selectedTodoLabelName = "";
          }
          rememberPendingTodoEditorColor(
            pendingTodoLabelEditorState,
            getActiveTodoLabelEditorName(),
            todoLabelColorInput ? todoLabelColorInput.value : ""
          );
          syncTodoLabelEditor();
          if (todoLabelColorSaveBtn) todoLabelColorSaveBtn.disabled = !getActiveTodoLabelEditorName();
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
          rememberPendingTodoEditorColor(
            pendingTodoLabelEditorState,
            getActiveTodoLabelEditorName(),
            todoLabelColorInput.value
          );
          syncTodoEditorTransientDraft();
        };
        todoLabelColorInput.onchange = function() {
          rememberPendingTodoEditorColor(
            pendingTodoLabelEditorState,
            getActiveTodoLabelEditorName(),
            todoLabelColorInput.value
          );
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
          var name = getActiveTodoLabelEditorName();
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
          var previousName = editingLabelOriginalName || (selectedTodoLabelName && normalizeTodoLabelKey(selectedTodoLabelName) !== normalizeTodoLabelKey(normalized) ? selectedTodoLabelName : void 0);
          emitWebviewDebug("todoLabelSaveAccepted", {
            label: normalized,
            color: todoLabelColorInput.value,
            editingExisting: !!previousName
          });
          clearCatalogDeleteState("label");
          upsertLocalLabelDefinition(normalized, todoLabelColorInput.value, previousName);
          vscode.postMessage({ type: "saveTodoLabelDefinition", data: { name: normalized, previousName, color: todoLabelColorInput.value } });
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
            if (normalizeTodoLabelKey(editingLabelOriginalName) === normalizeTodoLabelKey(confirmName)) {
              editingLabelOriginalName = "";
            }
            if (normalizeTodoLabelKey(selectedTodoLabelName) === normalizeTodoLabelKey(confirmName)) {
              selectedTodoLabelName = "";
            }
            if (todoLabelsInput && normalizeTodoLabelKey(todoLabelsInput.value) === normalizeTodoLabelKey(confirmName)) {
              todoLabelsInput.value = "";
            }
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
        todoFlagColorSaveBtn.onclick = function() {
          var todoFlagNameInputEl = document.getElementById("todo-flag-name-input");
          var todoFlagColorInputEl = document.getElementById("todo-flag-color-input");
          var activeFlagName = getActiveTodoFlagEditorName();
          emitWebviewDebug("todoFlagSaveButtonClick", {
            disabled: !!todoFlagColorSaveBtn.disabled,
            inputValue: activeFlagName,
            hasNameInput: !!todoFlagNameInputEl,
            hasColorInput: !!todoFlagColorInputEl
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
          var previousName = editingFlagOriginalName || (currentTodoFlag && normalizeTodoLabelKey(currentTodoFlag) !== normalizeTodoLabelKey(normalized) ? currentTodoFlag : void 0);
          emitWebviewDebug("todoFlagSaveAccepted", {
            flag: normalized,
            color: todoFlagColorInputEl.value,
            editingExisting: !!previousName
          });
          vscode.postMessage({
            type: "saveTodoFlagDefinition",
            data: {
              name: normalized,
              previousName,
              color: todoFlagColorInputEl.value
            }
          });
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
          if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();
          rememberPendingTodoEditorColor(
            pendingTodoFlagEditorState,
            getActiveTodoFlagEditorName(),
            todoFlagColorInput ? todoFlagColorInput.value : ""
          );
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
          if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();
          rememberPendingTodoEditorColor(
            pendingTodoFlagEditorState,
            getActiveTodoFlagEditorName(),
            todoFlagColorInput.value
          );
          syncTodoEditorTransientDraft();
        };
        todoFlagColorInput.onchange = function() {
          if (todoFlagColorSaveBtn) todoFlagColorSaveBtn.disabled = !getActiveTodoFlagEditorName();
          rememberPendingTodoEditorColor(
            pendingTodoFlagEditorState,
            getActiveTodoFlagEditorName(),
            todoFlagColorInput.value
          );
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
      var promptTextEl2 = document.getElementById("prompt-text");
      var checkedInputs = getCheckedTaskEditorInputs();
      var oneTimeEl = document.getElementById("one-time");
      var manualSessionEl = document.getElementById("manual-session");
      var promptSourceValue = checkedInputs.promptSource ? String(checkedInputs.promptSource.value || "inline") : "inline";
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
        prompt: promptTextEl2 ? String(promptTextEl2.value || "") : "",
        cronExpression: cronExpression ? String(cronExpression.value || "") : "",
        oneTimeDelaySeconds: getOneTimeDelaySecondsFromInputs(),
        labels: normalizeTaskLabelsValue(taskLabelsInput ? taskLabelsInput.value : ""),
        agent: agentValue,
        model: modelValue,
        scope: checkedInputs.scope ? String(checkedInputs.scope.value || "workspace") : "workspace",
        promptSource: promptSourceValue,
        promptPath: promptPathValue,
        oneTime,
        manualSession,
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
        oneTimeDelaySeconds: deriveTaskOneTimeDelaySeconds(task),
        labels: normalizeTaskLabelsValue(toLabelString(task.labels)),
        agent: String(task.agent || ""),
        model: String(task.model || ""),
        scope: String(task.scope || "workspace"),
        promptSource: String(task.promptSource || "inline"),
        promptPath: String(task.promptPath || ""),
        oneTime: task.oneTime === true,
        manualSession: task.oneTime === true ? false : task.manualSession === true,
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
      var isEditingTask = !!editingTaskId;
      setTaskSubmitButtonText(isEditingTask);
      setNewTaskButtonVisibility(isEditingTask);
    }
    function openTodoEditor(todoId) {
      clearCatalogDeleteState();
      closeTodoDeleteModal();
      resetTodoCompletionInlineConfirm();
      clearPendingTodoEditorColors();
      selectedTodoId = todoId || null;
      if (todoDetailId) {
        todoDetailId.value = selectedTodoId || "";
      }
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
      resetTodoCompletionInlineConfirm();
      clearPendingTodoEditorColors();
      selectedTodoId = null;
      if (todoDetailId) {
        todoDetailId.value = "";
      }
      resetTodoDraft("reset-editor");
      currentTodoLabels = [];
      selectedTodoLabelName = "";
      currentTodoFlag = "";
      syncEditorTabLabels();
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
    function ensureTodoCommentModal() {
      if (todoCommentModalRoot && document.body.contains(todoCommentModalRoot)) {
        return todoCommentModalRoot;
      }
      todoCommentModalRoot = document.createElement("div");
      todoCommentModalRoot.className = "cockpit-inline-modal";
      todoCommentModalRoot.setAttribute("hidden", "hidden");
      todoCommentModalRoot.innerHTML = '<div class="cockpit-inline-modal-card comment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="todo-comment-modal-title"><div class="cockpit-inline-modal-title" id="todo-comment-modal-title"></div><div class="todo-comment-modal-meta" id="todo-comment-modal-meta"></div><div class="todo-comment-modal-body" id="todo-comment-modal-body"></div><div class="cockpit-inline-modal-actions"><button type="button" class="btn-secondary" data-comment-modal-close="1">' + escapeHtml(strings.boardCancelAction || "Cancel") + "</button></div></div>";
      todoCommentModalRoot.onclick = function(event) {
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
        metaEl.innerHTML = "<span><strong>" + escapeHtml(sourceLabel) + "</strong></span><span>" + escapeHtml(comment.author || "system") + "</span><span>" + escapeHtml(formatTodoDate(displayDate)) + "</span>";
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
      return !!event && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && String(event.key || "").toLowerCase() === "s";
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
    function switchTab(tabName) {
      if (!isPersistedTabName(tabName)) {
        tabName = "help";
      }
      var shouldRefreshStorageStatus = tabName === "settings" && activeTabName !== "settings";
      if (activeTabName) {
        captureTabScrollPosition(activeTabName);
      }
      activateSchedulerTab(document, tabName);
      activeTabName = tabName;
      if (jobsToggleSidebarBtn) {
        jobsToggleSidebarBtn.style.display = "";
      }
      if (jobsShowSidebarBtn) {
        jobsShowSidebarBtn.style.display = tabName === "jobs" && jobsSidebarHidden ? "inline-flex" : "none";
      }
      if (tabName === "list") {
        refreshTaskCountdowns();
      }
      persistTaskFilter();
      restoreTabScrollPosition(tabName);
      updateBoardAutoCollapseFromScroll(true);
      scheduleBoardStickyMetrics();
      if (shouldRefreshStorageStatus) {
        vscode.postMessage({ type: "refreshStorageStatus" });
      }
      maybePlayInitialHelpWarp(tabName);
    }
    function getInitialTabName() {
      if (isPersistedTabName(activeTabName)) {
        return activeTabName;
      }
      var tabName = typeof initialData.initialTab === "string" ? initialData.initialTab : "help";
      return isPersistedTabName(tabName) ? tabName : "help";
    }
    bindSelectValueChange(agentSelect, function(control) {
      pendingAgentValue = control ? String(control.value || "") : "";
      emitWebviewDebug("taskAgentChanged", { value: pendingAgentValue });
    });
    bindSelectValueChange(modelSelect, function(control) {
      pendingModelValue = control ? String(control.value || "") : "";
      emitWebviewDebug("taskModelChanged", { value: pendingModelValue });
    });
    bindSelectValueChange(templateSelect, function(control) {
      pendingTemplatePath = control ? control.value : "";
    });
    var oneTimeToggle = document.getElementById("one-time");
    bindGenericChange(oneTimeToggle, function() {
      syncRecurringChatSessionUi();
    });
    var manualSessionToggle = document.getElementById("manual-session");
    bindGenericChange(manualSessionToggle, function() {
      syncRecurringChatSessionUi();
    });
    [oneTimeDelayHours, oneTimeDelayMinutes, oneTimeDelaySeconds].forEach(function(control) {
      bindGenericChange(control, function() {
        updateOneTimeDelayPreview();
        syncEditorTabLabels();
      });
    });
    bindTaskFilterBar(taskFilterBar, {
      syncTaskFilterButtons,
      isValidTaskFilter,
      setActiveTaskFilter: function(value) {
        activeTaskFilter = value;
      },
      persistTaskFilter,
      renderTaskList: function() {
        renderTaskList(tasks);
      }
    });
    bindSelectValueChange(taskLabelFilter, function(control) {
      activeLabelFilter = control.value || "";
      restoredLabelFilterWasExplicit = false;
      persistTaskFilter();
      renderTaskList(tasks);
    });
    bindPromptSourceDelegation(document, applyPromptSource);
    bindCronPresetPair(cronPreset, cronExpression, function() {
      updateCronPreview();
    });
    bindCronPresetPair(jobsCronPreset, jobsCronInput, function() {
      updateJobsCronPreview();
      syncEditorTabLabels();
    });
    bindSelectValueChange(friendlyFrequency, function() {
      refreshFriendlyCronFromBuilder();
    });
    bindSelectValueChange(jobsFriendlyFrequency, function() {
      refreshJobsFriendlyCronFromBuilder();
    });
    bindInputFeedbackClear(
      [
        githubIntegrationEnabledInput,
        githubIntegrationOwnerInput,
        githubIntegrationRepoInput,
        githubIntegrationApiBaseUrlInput,
        githubIntegrationAutomationPromptTemplateInput
      ],
      clearGitHubIntegrationFeedback
    );
    bindClickAction(githubIntegrationSaveBtn, function() {
      submitGitHubIntegrationForm();
    });
    bindClickAction(githubIntegrationRefreshBtn, function() {
      requestGitHubIntegrationRefresh();
    });
    bindInputFeedbackClear(
      [
        telegramEnabledInput,
        telegramBotTokenInput,
        telegramChatIdInput,
        telegramMessagePrefixInput
      ],
      clearTelegramFeedback
    );
    bindClickAction(telegramSaveBtn, function() {
      submitTelegramForm("saveTelegramNotification");
    });
    bindClickAction(telegramTestBtn, function() {
      submitTelegramForm("testTelegramNotification");
    });
    bindClickAction(executionDefaultsSaveBtn, function() {
      vscode.postMessage({
        type: "saveExecutionDefaults",
        data: collectExecutionDefaultsFormData()
      });
    });
    bindClickAction(reviewDefaultsSaveBtn, function() {
      vscode.postMessage({
        type: "saveReviewDefaults",
        data: collectReviewDefaultsFormData()
      });
    });
    bindClickAction(settingsStorageSaveBtn, function() {
      vscode.postMessage({
        type: "setStorageSettings",
        data: collectStorageSettingsFormData()
      });
    });
    bindSelectChange(approvalModeSelect, function(control) {
      vscode.postMessage({
        type: "setApprovalMode",
        approvalMode: control.value
      });
      if (approvalModeNoteEl) {
        approvalModeNoteEl.style.display = "";
        setTimeout(function() {
          approvalModeNoteEl.style.display = "none";
        }, 3e3);
      }
    });
    bindSelectChange(settingsLogLevelSelect, function(control) {
      currentLogLevel = control.value || "info";
      debugTools.setLogLevel(currentLogLevel);
      renderLoggingControls();
      vscode.postMessage({
        type: "setLogLevel",
        logLevel: currentLogLevel
      });
    });
    bindClickAction(settingsOpenLogFolderBtn, function() {
      vscode.postMessage({ type: "openLogFolder" });
    });
    bindDocumentValueDelegates(document, "change", {
      "friendly-frequency": function() {
        refreshFriendlyCronFromBuilder();
      },
      "jobs-friendly-frequency": function() {
        refreshJobsFriendlyCronFromBuilder();
      }
    });
    bindDocumentValueDelegates(document, "input", {
      "friendly-frequency": function() {
        refreshFriendlyCronFromBuilder();
      },
      "jobs-friendly-frequency": function() {
        refreshJobsFriendlyCronFromBuilder();
      },
      "one-time-delay-hours": function() {
        updateOneTimeDelayPreview();
      },
      "one-time-delay-minutes": function() {
        updateOneTimeDelayPreview();
      },
      "one-time-delay-seconds": function() {
        updateOneTimeDelayPreview();
      }
    });
    document.addEventListener("click", function(event) {
      var target = event && event.target && event.target.nodeType === 3 ? event.target.parentElement : event.target;
      if (!target || typeof target.closest !== "function") {
        return;
      }
      var presetButton = target.closest(".one-time-delay-preset");
      if (!presetButton) {
        return;
      }
      event.preventDefault();
      setOneTimeDelayInputs(presetButton.getAttribute("data-seconds"));
      updateOneTimeDelayPreview();
      syncEditorTabLabels();
    });
    bindFriendlyCronBuilderAutoUpdate({
      controls: [friendlyInterval, friendlyMinute, friendlyHour, friendlyDow, friendlyDom],
      onRefresh: refreshFriendlyCronFromBuilder
    });
    bindFriendlyCronBuilderAutoUpdate({
      controls: [jobsFriendlyInterval, jobsFriendlyMinute, jobsFriendlyHour, jobsFriendlyDow, jobsFriendlyDom],
      onRefresh: refreshJobsFriendlyCronFromBuilder
    });
    bindOpenCronGuruButton(openGuruBtn, function() {
      return cronExpression ? cronExpression.value : "";
    }, window);
    bindOpenCronGuruButton(jobsOpenGuruBtn, function() {
      return jobsCronInput ? jobsCronInput.value : "";
    }, window);
    bindInlineTaskQuickUpdate(document, vscode);
    bindTemplateSelectionLoader(templateSelect, document, vscode);
    function handleTaskFormSubmit(e) {
      e.preventDefault();
      hideGlobalError();
      var formErr = clearTaskFormError();
      var runFirstEl = document.getElementById("run-first");
      var editorState = getCurrentTaskEditorState();
      var taskData = buildTaskSubmissionData({
        editorState,
        parseLabels,
        editingTaskId,
        editingTaskEnabled,
        runFirstInOneMinute: runFirstEl?.checked ?? false
      });
      if (!validateTaskSubmission({
        taskData,
        promptSourceValue: editorState.promptSource,
        formErr,
        strings,
        editingTaskId,
        getTaskByIdLocal
      })) {
        return;
      }
      startPendingTaskSubmit();
      postTaskSubmission(vscode, editingTaskId, taskData);
    }
    if (taskForm) {
      taskForm.addEventListener("submit", handleTaskFormSubmit);
    }
    bindTaskTestButton(testBtn, {
      document,
      agentSelect,
      modelSelect,
      vscode
    });
    bindRefreshButton(refreshBtn, vscode);
    bindAutoShowStartupButton(autoShowStartupBtn, vscode);
    bindRestoreHistoryButton(restoreHistoryBtn, {
      cockpitHistorySelect,
      cockpitHistory,
      strings,
      formatHistoryLabel,
      window,
      vscode
    });
    function handleResearchToolbarAction(actionId) {
      if (actionId === "research-new-btn") {
        isCreatingResearchProfile = true;
        selectedResearchId = "";
        selectedResearchRunId = activeResearchRun && activeResearchRun.id ? activeResearchRun.id : selectedResearchRunId;
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
            data
          });
        } else {
          vscode.postMessage({
            type: "createResearchProfile",
            data
          });
        }
        return true;
      }
      if (actionId === "research-duplicate-btn") {
        if (!selectedResearchId) return true;
        vscode.postMessage({
          type: "duplicateResearchProfile",
          researchId: selectedResearchId
        });
        return true;
      }
      if (actionId === "research-delete-btn") {
        if (!selectedResearchId) return true;
        vscode.postMessage({
          type: "deleteResearchProfile",
          researchId: selectedResearchId
        });
        return true;
      }
      if (actionId === "research-start-btn") {
        if (!selectedResearchId) return true;
        vscode.postMessage({
          type: "startResearchRun",
          researchId: selectedResearchId
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
      jobsNewFolderBtn,
      jobsRenameFolderBtn,
      jobsDeleteFolderBtn,
      jobsNewJobBtn,
      jobsEmptyNewBtn,
      jobsBackBtn,
      jobsOpenEditorBtn,
      jobsSaveBtn,
      jobsSaveDeckBtn,
      jobsDuplicateBtn,
      jobsPauseBtn,
      jobsCompileBtn,
      jobsStatusPill,
      jobsToggleSidebarBtn,
      jobsShowSidebarBtn,
      jobsDeleteBtn,
      jobsAttachBtn,
      jobsExistingTaskSelect,
      jobsExistingWindowInput,
      jobsCreateStepBtn,
      jobsStepNameInput,
      jobsStepPromptInput,
      jobsStepWindowInput,
      jobsStepAgentSelect,
      jobsStepModelSelect,
      jobsStepLabelsInput,
      jobsCreatePauseBtn,
      jobsPauseNameInput,
      defaultPauseTitle: strings.jobsPauseDefaultTitle || "Manual review",
      getSelectedJobFolderId: function() {
        return selectedJobFolderId;
      },
      getSelectedJobId: function() {
        return selectedJobId;
      },
      setCreatingJob: function(value) {
        isCreatingJob = value;
      },
      syncEditorTabLabels,
      switchTab,
      openJobEditor,
      submitJobEditor,
      toggleJobsSidebar: function() {
        jobsSidebarHidden = !jobsSidebarHidden;
        applyJobsSidebarState();
        persistTaskFilter();
      },
      showJobsSidebar: function() {
        jobsSidebarHidden = false;
        applyJobsSidebarState();
        persistTaskFilter();
      },
      getJobById,
      parseLabels,
      vscode
    });
    document.addEventListener("click", function handleBoardClick(e) {
      var target = e && e.target;
      var researchActionButton = getClosestEventTarget(
        e,
        "#research-new-btn, #research-load-autoagent-example-btn, #research-save-btn, #research-duplicate-btn, #research-delete-btn, #research-start-btn, #research-stop-btn"
      );
      if (researchActionButton) {
        e.preventDefault();
        e.stopPropagation();
        if (handleResearchAction(researchActionButton.id || "")) {
          return;
        }
      }
      if (handleSchedulerDetailClick(e, {
        getClosestEventTarget,
        researchProfileList,
        researchRunList,
        selectResearchProfile,
        selectResearchRun,
        jobsFolderList,
        jobsList,
        setSelectedJobFolderId: function(value) {
          selectedJobFolderId = value;
        },
        setSelectedJobId: function(value) {
          selectedJobId = value;
        },
        getSelectedJobId: function() {
          return selectedJobId;
        },
        persistTaskFilter,
        renderJobsTab,
        openJobEditor,
        editTask: typeof window.editTask === "function" ? window.editTask : void 0,
        runTask: typeof window.runTask === "function" ? window.runTask : void 0,
        getJobById,
        vscode
      })) {
        return;
      }
    });
    bindJobNodeWindowChange(document, {
      getSelectedJobId: function() {
        return selectedJobId;
      },
      vscode
    });
    bindJobDragAndDrop(document, {
      jobsList,
      getDraggedJobId: function() {
        return draggedJobId;
      },
      setDraggedJobId: function(value) {
        draggedJobId = value;
      },
      getDraggedJobNodeId: function() {
        return draggedJobNodeId;
      },
      setDraggedJobNodeId: function(value) {
        draggedJobNodeId = value;
      },
      getSelectedJobId: function() {
        return selectedJobId;
      },
      getJobById,
      vscode
    });
    bindTemplateRefreshButton(templateRefreshBtn, {
      templateSelect,
      document,
      vscode
    });
    bindClickAction(insertSkillBtn, function() {
      insertSelectedSkillReference();
    });
    if (skillSelect && typeof skillSelect.addEventListener === "function") {
      skillSelect.addEventListener("change", function() {
        updateSkillDetailsNote();
      });
    }
    bindUtilityActionButtons(vscode, {
      setupMcp: setupMcpBtn,
      setupCodex: setupCodexBtn,
      setupCodexSkills: setupCodexSkillsBtn,
      syncBundledSkills: syncBundledSkillsBtn,
      stageBundledAgents: stageBundledAgentsBtn,
      syncBundledAgents: syncBundledAgentsBtn,
      openCopilotSettings: openCopilotSettingsBtn,
      openExtensionSettings: openExtensionSettingsBtn,
      refreshStorageStatus: refreshStorageStatusBtn,
      importStorageFromJson: importStorageFromJsonBtn,
      exportStorageToJson: exportStorageToJsonBtn
    });
    bindLanguageSelectors(
      helpLanguageSelect,
      settingsLanguageSelect,
      vscode,
      typeof initialData.languageSetting === "string" && initialData.languageSetting ? initialData.languageSetting : "auto"
    );
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
      var current = node && node.nodeType === 3 ? node.parentElement : node;
      while (current && current !== document.body) {
        var hasAction = current.hasAttribute && current.hasAttribute("data-action");
        var hasIdentifier = hasAction && (current.hasAttribute("data-id") || current.hasAttribute("data-task-id") || current.hasAttribute("data-job-id") || current.hasAttribute("data-profile-id"));
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
        text: hasNextRun ? nextRunDate.toLocaleString(locale) : strings.labelNever
      };
    }
    function getTaskScopePresentation(task) {
      var scopeValue = task && task.scope ? task.scope : "workspace";
      var workspacePath = scopeValue === "workspace" ? task.workspacePath || "" : "";
      var workspaceName = workspacePath ? getPathLeafName(workspacePath) : "";
      var inCurrentWorkspace = scopeValue !== "workspace" ? true : !!workspacePath && (workspacePaths || []).some(function(candidatePath) {
        return normalizeWorkspacePathValue(candidatePath) === normalizeWorkspacePathValue(workspacePath);
      });
      var scopeLabel = scopeValue === "global" ? strings.labelScopeGlobal || "" : strings.labelScopeWorkspace || "";
      var scopeText = scopeValue === "global" ? "\u{1F310} " + escapeHtml(scopeLabel) : "\u{1F4C1} " + escapeHtml(scopeLabel) + (workspaceName ? " \u2022 " + escapeHtml(workspaceName) : "");
      if (scopeValue === "workspace") {
        var workspaceBadgeText = inCurrentWorkspace ? strings.labelThisWorkspaceShort || "" : strings.labelOtherWorkspaceShort || "";
        scopeText += " \u2022 " + escapeHtml(workspaceBadgeText);
      }
      return {
        inThisWorkspace: inCurrentWorkspace,
        scopeInfo: scopeText,
        scopeValue
      };
    }
    function appendTaskActionIcon(markup, options) {
      return markup + '<button class="' + options.className + '" data-action="' + options.action + '" data-id="' + options.taskId + '" title="' + escapeAttr(options.title) + '">' + options.icon + "</button>";
    }
    function renderEmptyTaskState() {
      return '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>";
    }
    function renderTaskSectionShell(sectionKey, title, countMarkup, bodyMarkup) {
      var isCollapsed = taskSectionCollapseState[sectionKey] === true;
      var toggleTitle = isCollapsed ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section";
      return '<div class="task-section' + (isCollapsed ? " is-collapsed" : "") + '" data-task-section="' + escapeAttr(sectionKey) + '"><div class="task-section-title"><button type="button" class="task-section-toggle" data-task-section-toggle="' + escapeAttr(sectionKey) + '" aria-expanded="' + (isCollapsed ? "false" : "true") + '" title="' + escapeAttr(toggleTitle) + '">&#9660;</button><span class="cell">' + escapeHtml(title) + "</span>" + countMarkup + '</div><div class="task-section-body"><div class="task-section-body-inner">' + bodyMarkup + "</div></div></div>";
    }
    function getTaskActionHandlers() {
      var actionEntries = [
        ["toggle", window.toggleTask],
        ["run", window.runTask],
        ["edit", window.editTask],
        ["copy", window.copyPrompt],
        ["duplicate", window.duplicateTask],
        ["move", window.moveTaskToCurrentWorkspace],
        ["delete", window.deleteTask]
      ];
      return actionEntries.reduce(function(handlers, entry) {
        handlers[entry[0]] = entry[1];
        return handlers;
      }, {});
    }
    function getTaskStatusPresentation(task) {
      var enabled = task.enabled || false;
      return {
        enabled,
        statusClass: enabled ? "enabled" : "disabled",
        statusText: enabled ? strings.labelEnabled : strings.labelDisabled,
        toggleIcon: enabled ? "\u23F8\uFE0F" : "\u25B6\uFE0F",
        toggleTitle: enabled ? strings.actionDisable : strings.actionEnable
      };
    }
    function renderTaskLabelBadges(task) {
      return getEffectiveLabels(task).map(function(label) {
        return '<span class="task-badge label">' + escapeHtml(label) + "</span>";
      }).join("");
    }
    function renderTaskErrorMarkup(lastErrorText, lastErrorAt) {
      if (!lastErrorText) {
        return "";
      }
      return '<div class="task-prompt" style="color: var(--vscode-errorForeground);">Last error' + (lastErrorAt ? " (" + escapeHtml(lastErrorAt) + ")" : "") + ": " + escapeHtml(lastErrorText) + "</div>";
    }
    function showSuccessToast(messageText) {
      var toast = document.getElementById("success-toast");
      if (!toast) {
        return;
      }
      var prefix = strings.webviewSuccessPrefix || "\u2714 ";
      toast.textContent = prefix + messageText;
      updateToastVisibility(toast, "block", "1");
      scheduleToastVisibility(toast, "0", 3e3);
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
      setTimeout(function() {
        toast.style.opacity = opacity;
      }, delayMs);
    }
    function scheduleToastHide(toast, delayMs) {
      setTimeout(function() {
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
        scope: document.querySelector('input[name="scope"]:checked')
      };
    }
    function renderOneTimeBadge(task, taskIdEscaped) {
      if (task.oneTime !== true) {
        return "";
      }
      return '<span class="task-badge clickable" data-action="toggle" data-id="' + taskIdEscaped + '">' + escapeHtml(strings.labelOneTime || "One-time") + "</span>";
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
      var badgeText = task.chatSession === "continue" ? strings.labelChatSessionBadgeContinue || "Chat: Continue" : strings.labelChatSessionBadgeNew || "Chat: New";
      return '<span class="task-badge" title="' + escapeAttr(label) + '">' + escapeHtml(badgeText) + "</span>";
    }
    function sortVisibleSectionsForRecurringTasks() {
      if (filters.showRecurringTasks !== true) {
        return;
      }
      visibleSections.sort(function(left, right) {
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
        toggleTitle,
        toggleIcon,
        strings,
        escapeAttr
      });
      if (scopeValue === "workspace" && !inThisWorkspace) {
        actionsHtml = appendTaskActionIcon(actionsHtml, {
          className: "btn-secondary btn-icon",
          action: "move",
          taskId: taskIdEscaped,
          title: strings.actionMoveToCurrentWorkspace || "",
          icon: "\u{1F4CC}"
        });
        sortVisibleSectionsForRecurringTasks();
      }
      if (scopeValue === "global" || inThisWorkspace) {
        actionsHtml = appendTaskActionIcon(actionsHtml, {
          className: "btn-danger btn-icon",
          action: "delete",
          taskId: taskIdEscaped,
          title: strings.actionDelete,
          icon: "\u{1F5D1}\uFE0F"
        });
      }
      return actionsHtml;
    }
    function setPromptTextValue(content) {
      var promptTextEl2 = document.getElementById("prompt-text");
      if (promptTextEl2) {
        promptTextEl2.value = content;
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
      return taskItems.filter(function(task) {
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
      return taskItems.some(function(task) {
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
      return promptText.length > 100 ? `${promptText.substring(0, 100)}\u2026` : promptText;
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
        "</span>"
      ];
      return statusParts.join("");
    }
    function renderTaskHeaderBadgesMarkup(options) {
      var badgesHtml = options.manualSessionBadgeHtml + options.chatSessionBadgeHtml + options.oneTimeBadgeHtml;
      if (!badgesHtml) {
        return "";
      }
      return '<div class="task-badges task-badges-inline">' + badgesHtml + "</div>";
    }
    function renderTaskHeaderMarkup(options) {
      return '<div class="task-header" role="group"><div class="task-header-main"><div class="task-title-row"><span class="task-name clickable" role="button" data-action="toggle" data-id="' + options.taskId + '">' + options.taskName + "</span>" + renderTaskStatusMarkup(
        options.taskId,
        options.statusClass,
        options.statusText
      ) + "</div>" + renderTaskHeaderBadgesMarkup(options) + "</div></div>";
    }
    function renderTaskMetaPill(className, contentHtml) {
      return '<span class="task-meta-pill ' + className + '">' + contentHtml + "</span>";
    }
    function renderTaskTimingMarkup(enabled, cronSummary, nextRunPresentation, scopeInfo) {
      var countdownMarkup = '<span class="task-next-run-countdown" data-enabled="' + (enabled ? "true" : "false") + '" data-next-run-ms="' + escapeAttr(nextRunPresentation.millis > 0 ? String(nextRunPresentation.millis) : "") + '"></span>';
      var nextRunMarkup = renderTaskMetaPill(
        "task-meta-pill-next-run",
        escapeHtml(strings.labelNextRun) + /* next-run label */
        ': <span class="task-next-run-label">' + escapeHtml(nextRunPresentation.text) + "</span>" + countdownMarkup
      );
      return '<div class="task-meta-strip">' + renderTaskMetaPill(
        "task-meta-pill-cron",
        "\u23F0 " + escapeHtml(cronSummary)
      ) + nextRunMarkup + renderTaskScopeMarkup(scopeInfo) + "</div>";
    }
    function renderTaskScopeMarkup(scopeInfo) {
      return renderTaskMetaPill("task-meta-pill-scope", scopeInfo);
    }
    function renderTaskPromptMarkup(promptPreview) {
      if (!promptPreview) {
        return "";
      }
      return '<div class="task-prompt">' + escapeHtml(promptPreview) + "</div>";
    }
    function renderTaskCardMarkup(options) {
      return '<div class="' + getTaskCardClassName(
        options.enabled,
        options.scopeValue,
        options.inThisWorkspace
      ) + '" data-id="' + options.taskId + '"><div class="task-card-top">' + renderTaskHeaderMarkup(options) + renderTaskTimingMarkup(
        options.enabled,
        options.cronSummary,
        options.nextRunPresentation,
        options.scopeInfo
      ) + '<div class="task-info task-info-compact"><span>Cron: ' + options.cronText + "</span></div></div>" + (options.labelBadgesHtml ? '<div class="task-badges task-badges-labels">' + options.labelBadgesHtml + "</div>" : "") + renderTaskPromptMarkup(options.promptPreview) + renderTaskErrorMarkup(options.lastErrorText, options.lastErrorAt) + '<div class="task-card-footer">' + options.configRow + '<div class="task-actions" role="toolbar">' + options.actionsHtml + "</div></div></div>";
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
      setTimeout(function() {
        scrollSelectorIntoView(
          jobId ? '[data-job-id="' + jobId + '"]' : "",
          false
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
      setTimeout(function() {
        scrollSelectorIntoView(
          researchId ? '[data-research-id="' + researchId + '"]' : "#research-name",
          !researchId
        );
      }, 50);
    }
    function focusTaskView(taskId) {
      switchTab("list");
      setTimeout(function() {
        scrollTaskCardIntoView(taskId);
      }, 100);
    }
    function focusReadyTodoDraftView(todoId) {
      switchTab("list");
      setTimeout(function() {
        scrollSelectorIntoView(
          todoId ? '[data-ready-todo-id="' + todoId + '"]' : '[data-task-section="todo-draft"]',
          false
        );
      }, 100);
    }
    function focusResearchRunView(runId) {
      switchTab("research");
      if (runId) {
        selectResearchRun(runId);
      }
      setTimeout(function() {
        scrollSelectorIntoView(runId ? '[data-run-id="' + runId + '"]' : "", false);
      }, 50);
    }
    function syncPromptTemplateOptions(templates) {
      promptTemplates = Array.isArray(templates) ? templates : [];
      pendingTemplatePath = syncPromptTemplatesFromMessage({
        promptTemplates,
        pendingTemplatePath,
        templateSelect,
        templateSelectGroup,
        currentSource: getPromptTemplateSourceValue(),
        strings,
        escapeHtml,
        escapeAttr
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
          if (readyTodoId && !hasPendingReadyTodoDraftCreate(readyTodoId)) {
            startPendingReadyTodoDraftCreate(readyTodoId);
            vscode.postMessage({ type: "createTaskFromTodo", todoId: readyTodoId });
          }
          return;
        }
      }
      if (handleTaskListClick({
        event: e,
        taskList,
        getTaskList: function() {
          taskList = document.getElementById("task-list");
          return taskList;
        },
        getClosestEventTarget,
        resolveActionTarget,
        openTodoEditor,
        actionHandlers: getTaskActionHandlers()
      })) {
        return;
      }
    });
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
        var lastErrorAt = lastErrorAtDate && !isNaN(lastErrorAtDate.getTime()) ? lastErrorAtDate.toLocaleString(locale) : "";
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
          task,
          taskId: taskIdEscaped,
          agents,
          models,
          executionDefaults,
          strings,
          escapeAttr,
          escapeHtml,
          formatModelLabel
        });
        var actionsHtml = buildTaskActionMarkup(
          taskIdEscaped,
          toggleTitle,
          toggleIcon,
          scopeValue,
          inThisWorkspace
        );
        return renderTaskCardMarkup({
          actionsHtml,
          chatSessionBadgeHtml,
          configRow,
          cronSummary,
          cronText,
          enabled,
          inThisWorkspace,
          labelBadgesHtml,
          lastErrorAt,
          lastErrorText,
          manualSessionBadgeHtml,
          nextRunPresentation,
          oneTimeBadgeHtml,
          promptPreview,
          scopeInfo,
          scopeValue,
          statusClass,
          statusText,
          taskId: taskIdEscaped,
          taskName
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
          listHtml
        );
      }
      function renderTaskSectionContent(sectionKey, title, contentHtml, itemCount) {
        return renderTaskSectionShell(
          sectionKey,
          title,
          '<span class="task-section-count">' + String(itemCount) + "</span>",
          contentHtml
        );
      }
      function renderTaskSubsection(title, items) {
        var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
        if (!listHtml) {
          listHtml = renderEmptyTaskState();
        }
        return '<div class="task-subsection"><div class="task-subsection-title"><span class="task-subsection-name">' + escapeHtml(title) + '</span><span class="task-subsection-count">' + String(items.length) + '</span></div><div class="task-subsection-body">' + listHtml + "</div></div>";
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
        var dueText = todo.dueAt ? renderTaskMetaPill(
          "task-meta-pill-due",
          escapeHtml(strings.boardDueLabel || "Due") + ": " + escapeHtml(formatTodoDate(todo.dueAt))
        ) : "";
        var labelBadgesHtml = Array.isArray(todo.labels) ? todo.labels.slice(0, 6).map(function(label) {
          return '<span class="task-badge label">' + escapeHtml(label) + "</span>";
        }).join("") : "";
        return '<div class="task-card todo-draft-candidate" data-ready-todo-id="' + escapeAttr(todo.id || "") + '"><div class="task-card-top"><div class="task-header" role="banner"><div class="task-header-main"><div class="task-title-row"><span class="task-name">' + title + '</span><span class="task-status enabled">' + escapeHtml(strings.boardFlagPresetReady || "Ready") + '</span></div></div><div class="task-badges task-badges-inline"><span class="task-badge">Ready Todo</span></div></div><div class="task-meta-strip">' + renderTaskMetaPill(
          "task-meta-pill-workflow",
          escapeHtml(strings.boardWorkflowLabel || "Workflow") + ": " + escapeHtml(strings.boardFlagPresetReady || "Ready")
        ) + renderTaskMetaPill("task-meta-pill-priority", "Priority: " + priority) + dueText + "</div></div>" + (labelBadgesHtml ? '<div class="task-badges task-badges-labels">' + labelBadgesHtml + "</div>" : "") + renderTaskPromptMarkup(description) + '<div class="task-card-footer"><div class="task-actions" aria-label="actions"><button class="btn-secondary" data-ready-todo-open="' + escapeAttr(todo.id || "") + '">Open Todo</button><button class="btn-primary" data-ready-todo-create="' + escapeAttr(todo.id || "") + '">Create Draft</button></div></div></div>';
      }
      var manualSessionTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = isOneTimeTask(task);
        return !isOneTime && !isJobTask(task) && task.manualSession === true;
      });
      var jobTasks = taskItems.filter(function(task) {
        return !!task && isJobTask(task);
      });
      var recurringTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = isOneTimeTask(task);
        return !isOneTime && !isJobTask(task) && task.manualSession !== true;
      });
      var todoDraftTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = isOneTimeTask(task);
        return isOneTime && !isJobTask(task) && isTodoTaskDraft(task) && task.enabled === false;
      });
      var readyTodoDraftCandidates = getReadyTodoDraftCandidates();
      var oneTimeTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = isOneTimeTask(task);
        return isOneTime && !isJobTask(task) && (!isTodoTaskDraft(task) || task.enabled !== false);
      });
      var jobSectionHtml = "";
      if (jobTasks.length > 0) {
        var jobGroupsById = /* @__PURE__ */ Object.create(null);
        jobTasks.forEach(function(task) {
          var jobId = String(task.jobId || "");
          if (!jobId) {
            return;
          }
          if (!jobGroupsById[jobId]) {
            var job = getJobById(jobId);
            jobGroupsById[jobId] = {
              title: job && job.name ? String(job.name) : jobId,
              items: []
            };
          }
          jobGroupsById[jobId].items.push(task);
        });
        var jobGroupEntries = Object.keys(jobGroupsById).map(function(jobId) {
          return {
            id: jobId,
            title: jobGroupsById[jobId].title,
            items: jobGroupsById[jobId].items
          };
        }).sort(function(left, right) {
          return left.title.localeCompare(right.title);
        });
        jobSectionHtml = renderTaskSectionContent(
          "jobs",
          strings.labelJobTasks || "Jobs",
          jobGroupEntries.map(function(entry) {
            return renderTaskSubsection(entry.title, entry.items);
          }).join(""),
          jobTasks.length
        );
      } else {
        jobSectionHtml = renderTaskSectionContent(
          "jobs",
          strings.labelJobTasks || "Jobs",
          '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>",
          0
        );
      }
      var leftColumnHtml = "";
      var rightColumnHtml = "";
      if (activeTaskFilter === "all" || activeTaskFilter === "manual") {
        leftColumnHtml += renderTaskSection(
          "manual",
          strings.labelManualSessions || "Manual Sessions",
          manualSessionTasks
        );
      }
      if (activeTaskFilter === "all") {
        leftColumnHtml += jobSectionHtml;
      }
      if (activeTaskFilter === "all" || activeTaskFilter === "recurring") {
        leftColumnHtml += renderTaskSection(
          "recurring",
          strings.labelRecurringTasks || "Recurring Tasks",
          recurringTasks
        );
      }
      if (activeTaskFilter === "all" || activeTaskFilter === "one-time") {
        var readyTodoNoticeHtml = readyTodoDraftCandidates.length > 0 ? '<div class="note" style="margin-bottom:8px;">' + escapeHtml(String(readyTodoDraftCandidates.length) + " ready todos are waiting for task draft creation.") + "</div>" : "";
        var readyTodoCardsHtml = readyTodoDraftCandidates.map(renderReadyTodoDraftCandidateCard).filter(Boolean).join("");
        var existingTodoDraftsHtml = todoDraftTasks.map(function(task) {
          return renderTaskCard(task).replace(
            'class="task-card',
            'class="task-card todo-draft-compact'
          );
        }).filter(Boolean).join("");
        var todoDraftGridHtml = readyTodoCardsHtml || existingTodoDraftsHtml ? '<div class="todo-draft-grid">' + readyTodoCardsHtml + existingTodoDraftsHtml + "</div>" : "";
        var todoDraftSectionHtml = readyTodoNoticeHtml + todoDraftGridHtml;
        if (!todoDraftSectionHtml) {
          todoDraftSectionHtml = '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>";
        }
        rightColumnHtml += renderTaskSectionContent(
          "todo-draft",
          strings.labelTodoTaskDrafts || "Todo Task Drafts",
          todoDraftSectionHtml,
          readyTodoDraftCandidates.length + todoDraftTasks.length
        );
      }
      if (activeTaskFilter === "all" || activeTaskFilter === "one-time") {
        rightColumnHtml += renderTaskSection(
          "one-time",
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
      var sectionHtml = activeTaskFilter === "all" ? '<div class="task-sections-column task-sections-column-primary">' + leftColumnHtml + '</div><div class="task-sections-column task-sections-column-secondary">' + rightColumnHtml + "</div>" : leftColumnHtml + rightColumnHtml;
      renderedTasks = [
        '<div class="',
        containerClass,
        '"',
        containerStyle,
        ">",
        sectionHtml,
        "</div>"
      ].join("");
      if (renderedTasks === lastRenderedTasksHtml) {
        return;
      }
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
        taskId,
        data
      });
    }
    if (taskList) {
      taskList.addEventListener("change", function(event) {
        var target = event && event.target;
        if (!target || !target.classList) {
          return;
        }
        if (target.classList.contains("task-agent-select")) {
          postTaskInlineChange(
            target.getAttribute("data-id") || "",
            "agent",
            target.value || ""
          );
          return;
        }
        if (target.classList.contains("task-model-select")) {
          postTaskInlineChange(
            target.getAttribute("data-id") || "",
            "model",
            target.value || ""
          );
        }
      });
      taskList.addEventListener("focusout", function(event) {
        var target = event && event.target;
        if (!target || !target.classList) {
          return;
        }
        if (!target.classList.contains("task-agent-select") && !target.classList.contains("task-model-select")) {
          return;
        }
        setTimeout(function() {
          replayPendingTaskListRender();
        }, 0);
      });
    }
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
        [/>/g, "&gt;"]
      ];
      return replacements.reduce(function(value, replacement) {
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
        friendlyFrequency ? friendlyFrequency.value : ""
      );
    }
    function updateJobsFriendlyVisibility() {
      syncFriendlyFieldVisibility(
        jobsFriendlyBuilder,
        jobsFriendlyFrequency ? jobsFriendlyFrequency.value : ""
      );
    }
    function clearFriendlyBuilderControls(options) {
      if (!options) {
        return;
      }
      if (options.frequency) options.frequency.value = "";
      if (options.interval) options.interval.value = "";
      if (options.minute) options.minute.value = "";
      if (options.hour) options.hour.value = "";
      if (options.dow) options.dow.value = "";
      if (options.dom) options.dom.value = "";
      if (typeof options.updateVisibility === "function") {
        options.updateVisibility();
      }
    }
    function syncFriendlyBuilderFromCronExpression(options) {
      if (!options) {
        return false;
      }
      var parsed = parseFriendlyCronExpression(options.expression);
      if (!parsed) {
        clearFriendlyBuilderControls(options);
        return false;
      }
      if (options.frequency) options.frequency.value = parsed.frequency || "";
      if (options.interval) {
        options.interval.value = parsed.interval == null ? "" : String(parsed.interval);
      }
      if (options.minute) {
        options.minute.value = parsed.minute == null ? "" : String(parsed.minute);
      }
      if (options.hour) {
        options.hour.value = parsed.hour == null ? "" : String(parsed.hour);
      }
      if (options.dow) {
        options.dow.value = parsed.dow == null ? "" : String(parsed.dow);
      }
      if (options.dom) {
        options.dom.value = parsed.dom == null ? "" : String(parsed.dom);
      }
      if (typeof options.updateVisibility === "function") {
        options.updateVisibility();
      }
      return true;
    }
    function bindFriendlyCronBuilderAutoUpdate(options) {
      if (!options || typeof options.onRefresh !== "function" || !options.controls) {
        return;
      }
      options.controls.forEach(function(control) {
        if (!control || typeof control.addEventListener !== "function") {
          return;
        }
        control.addEventListener("change", options.onRefresh);
        control.addEventListener("input", options.onRefresh);
      });
    }
    function refreshFriendlyCronFromBuilder() {
      updateFriendlyVisibility();
      generateCronFromFriendly();
    }
    function refreshJobsFriendlyCronFromBuilder() {
      updateJobsFriendlyVisibility();
      generateJobsCronFromFriendly();
      syncEditorTabLabels();
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
        onUpdate: updateCronPreview
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
        onUpdate: updateJobsCronPreview
      });
    }
    function applyFriendlyCronResult(options) {
      var expr = buildFriendlyCronExpression(options.frequency, {
        interval: options.interval,
        minute: options.minute,
        hour: options.hour,
        dow: options.dow,
        dom: options.dom
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
      [syncRecurringChatSessionUi, updateFriendlyVisibility, updateCronPreview, updateOneTimeDelayPreview].forEach(function(refreshFn) {
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
        executionDefaults,
        escapeAttr,
        escapeHtml,
        strings
      };
    }
    function populateAgentDropdown2() {
      populateAgentDropdown(Object.assign({
        agentSelect,
        agents
      }, getTaskExecutionOptionContext()));
    }
    function populateModelDropdown2() {
      populateModelDropdown(Object.assign({
        formatModelLabel,
        modelSelect,
        models
      }, getTaskExecutionOptionContext()));
    }
    function syncSharedAgentAndModelSelectors() {
      renderExecutionDefaultsControls();
      renderReviewDefaultsControls();
      syncJobsStepSelectors();
      syncResearchSelectors();
    }
    function getTaskArrayForEditing() {
      return Array.isArray(tasks) ? tasks : [];
    }
    function findTaskById(taskId) {
      return getTaskArrayForEditing().find(function(task) {
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
        options.pendingValue
      );
      return refreshExecutionTargets({
        eventName: options.eventName,
        debugData: options.createDebugData(currentValue),
        assignItems: options.assignItems,
        updateOptions: options.updateOptions,
        selectElement: options.selectElement,
        currentValue,
        pendingValue: options.pendingValue
      });
    }
    function initializeTaskEditorState() {
      populateAgentDropdown2();
      populateModelDropdown2();
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
      setTimeout(function() {
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
        'input[name="' + groupName + '"][value="' + selectedValue + '"]'
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
      if (jitterSecondsInput) {
        jitterSecondsInput.value = String(defaultJitterSeconds);
      }
      setOneTimeDelayInputs(0);
      if (taskLabelsInput) {
        taskLabelsInput.value = "";
      }
      syncFriendlyBuilderFromCronExpression({
        expression: cronExpression ? cronExpression.value : "",
        frequency: friendlyFrequency,
        interval: friendlyInterval,
        minute: friendlyMinute,
        hour: friendlyHour,
        dow: friendlyDow,
        dom: friendlyDom,
        updateVisibility: updateFriendlyVisibility
      });
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
      syncFriendlyBuilderFromCronExpression({
        expression: task.cronExpression || "",
        frequency: friendlyFrequency,
        interval: friendlyInterval,
        minute: friendlyMinute,
        hour: friendlyHour,
        dow: friendlyDow,
        dom: friendlyDom,
        updateVisibility: updateFriendlyVisibility
      });
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
      setOneTimeDelayInputs(deriveTaskOneTimeDelaySeconds(task));
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
      vscode.postMessage({ type, taskId });
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
        options.pendingValue
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
        templateSelect,
        promptTemplates,
        source,
        selectedPath,
        strings,
        escapeHtml,
        escapeAttr
      });
    }
    function applyPromptSource(source, keepSelection) {
      applyPromptSourceUi({
        source,
        keepSelection,
        templateSelect,
        promptTextEl,
        templateSelectGroup,
        promptGroup,
        promptTemplates,
        strings,
        escapeHtml,
        escapeAttr,
        warnMissingTemplateGroup: function() {
          console.warn(
            "[CopilotCockpit] Template select container not found; template picking is disabled."
          );
        }
      });
    }
    function getSelectedSkill() {
      if (!skillSelect) {
        return void 0;
      }
      var selectedPath = skillSelect.value || "";
      if (!selectedPath) {
        return void 0;
      }
      return (Array.isArray(skills) ? skills : []).find(function(skill) {
        return skill && skill.path === selectedPath;
      });
    }
    function getSkillTypeLabel(skill) {
      if (!skill || skill.skillType !== "support") {
        return strings.skillTypeOperational || "Operational";
      }
      return strings.skillTypeSupport || "Support";
    }
    function formatSkillMetadataList(values) {
      return Array.isArray(values) && values.length > 0 ? values.join(", ") : strings.skillMetadataNone || "none";
    }
    function buildSkillOptionLabel(skill) {
      if (!skill) {
        return "";
      }
      var reference = skill.reference || skill.name || "";
      return getSkillTypeLabel(skill) + ": " + reference;
    }
    function buildSkillDetailsText(skill) {
      if (!skill) {
        return strings.skillMetadataEmptyState || "";
      }
      var template = strings.skillMetadataSummaryTemplate || "Type: {type}. Focus: {summary}. Tools: {tools}. Ready flags: {readyFlags}. Closeout flags: {closeoutFlags}. Approval: {approval}.";
      return template.replace("{type}", getSkillTypeLabel(skill)).replace("{summary}", skill.promptSummary || skill.reference || skill.name || (strings.skillMetadataNone || "none")).replace("{tools}", formatSkillMetadataList(skill.toolNamespaces)).replace("{readyFlags}", formatSkillMetadataList(skill.readyWorkflowFlags)).replace("{closeoutFlags}", formatSkillMetadataList(skill.closeoutWorkflowFlags)).replace(
        "{approval}",
        skill.approvalSensitive ? strings.skillApprovalSensitive || "Approval-sensitive" : strings.skillApprovalRoutine || "Routine"
      );
    }
    function updateSkillDetailsNote() {
      if (!skillDetailsNote) {
        return;
      }
      skillDetailsNote.textContent = buildSkillDetailsText(getSelectedSkill());
    }
    function updateSkillOptions() {
      if (!skillSelect) return;
      var items = Array.isArray(skills) ? skills : [];
      var placeholder = strings.placeholderSelectSkill || "Select a skill";
      var previousValue = skillSelect.value || "";
      skillSelect.innerHTML = '<option value="">' + escapeHtml(placeholder) + "</option>" + items.map(function(skill) {
        return '<option value="' + escapeAttr(skill.path || "") + '">' + escapeHtml(buildSkillOptionLabel(skill)) + "</option>";
      }).join("");
      skillSelect.value = items.some(function(skill) {
        return skill && skill.path === previousValue;
      }) ? previousValue : "";
      updateSkillDetailsNote();
    }
    function insertSelectedSkillReference() {
      if (!skillSelect || !promptGroup) return;
      var selectedSkill = getSelectedSkill();
      if (!selectedSkill) return;
      var sourceRadio = document.querySelector('input[name="prompt-source"][value="inline"]');
      if (sourceRadio) {
        sourceRadio.checked = true;
      }
      applyPromptSource("inline", false);
      var promptTextEl2 = document.getElementById("prompt-text");
      if (!promptTextEl2) return;
      var template = strings.skillSentenceTemplate || "Use {skill} to know how things must be done.";
      var sentence = template.replace("{skill}", selectedSkill.reference || selectedSkill.name || "skill");
      var current = promptTextEl2.value || "";
      promptTextEl2.value = current.trim() ? current.replace(/\s*$/, "\n\n") + sentence : sentence;
      if (typeof promptTextEl2.focus === "function") {
        promptTextEl2.focus();
      }
    }
    function updateSimpleSelect(selectEl, items, placeholder, selectedValue, getValue, getLabel) {
      if (!selectEl) return;
      var optionItems = Array.isArray(items) ? items : [];
      var normalizedSelectedValue = selectedValue || "";
      var hasSelectedOption = !normalizedSelectedValue;
      var html = '<option value="">' + escapeHtml(placeholder || "") + "</option>" + optionItems.map(function(item) {
        var value = getValue(item);
        var label = getLabel(item);
        if (value === normalizedSelectedValue) {
          hasSelectedOption = true;
        }
        return '<option value="' + escapeAttr(value) + '">' + escapeHtml(label) + "</option>";
      }).join("");
      if (normalizedSelectedValue && !hasSelectedOption) {
        html += '<option value="' + escapeAttr(normalizedSelectedValue) + '" selected>' + escapeHtml(normalizedSelectedValue) + "</option>";
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
    function getAutoAgentResearchExampleProfile() {
      return {
        name: strings.researchAutoAgentExampleName || "AutoAgent Harbor Example",
        instructions: strings.researchAutoAgentExampleInstructions || "Use this preset inside the autoagent repo to improve the Harbor agent harness score by editing agent.py while refining the experiment directive in program.md. Start with one representative task, keep the editable surface small, and make sure the benchmark command prints a final numeric score or reward line that matches the regex before you run the loop.",
        editablePaths: ["agent.py", "program.md"],
        benchmarkCommand: 'uv run harbor run -p tasks/ --task-name "<task-name>" -l 1 -n 1 --agent-import-path agent:AutoAgent -o jobs --job-name latest',
        metricPattern: "(?:score|reward)\\s*[:=]\\s*([0-9.]+)",
        metricDirection: "maximize",
        maxIterations: 8,
        maxMinutes: 90,
        maxConsecutiveFailures: 3,
        benchmarkTimeoutSeconds: 900,
        editWaitSeconds: 45,
        agent: "",
        model: ""
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
        if (!researchFormDirty && !isCreatingResearchProfile) {
          resetResearchForm(null);
        }
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
        "#one-time-delay-hours",
        "#one-time-delay-minutes",
        "#one-time-delay-seconds",
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
      var jobsOverviewStats = document.getElementById("jobs-overview-stats");
      var jobsOverviewSelection = document.getElementById("jobs-overview-selection");
      var visibleJobs = getVisibleJobs();
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
      if (jobsOverviewStats) {
        var activeJobsCount = visibleJobs.filter(function(job) {
          return job && !job.paused && !job.archived;
        }).length;
        var visibleNodeCount = visibleJobs.reduce(function(total, job) {
          return total + (Array.isArray(job && job.nodes) ? job.nodes.length : 0);
        }, 0);
        var folderCount = 1 + (Array.isArray(jobFolders) ? jobFolders.filter(function(folder) {
          return folder && !isArchiveFolder(folder);
        }).length : 0);
        jobsOverviewStats.innerHTML = [
          { label: strings.jobsTitle || "Jobs", value: String(visibleJobs.length) },
          { label: strings.jobsRunning || "Active", value: String(activeJobsCount) },
          { label: strings.jobsFoldersTitle || "Folders", value: String(folderCount) },
          { label: strings.jobsWorkflowTaskCount || "Task steps", value: String(visibleNodeCount) }
        ].map(function(item) {
          return '<div class="jobs-overview-stat"><div class="jobs-overview-stat-label">' + escapeHtml(item.label) + '</div><div class="jobs-overview-stat-value">' + escapeHtml(item.value) + "</div></div>";
        }).join("");
      }
      if (jobsOverviewSelection) {
        var selectedFolderForOverview = getSelectedJobFolder();
        var currentFolderName = selectedJobFolderId ? (selectedFolderForOverview || {}).name || (strings.jobsRootFolder || "All jobs") : strings.jobsRootFolder || "All jobs";
        var currentFolderPath = getFolderPath(selectedJobFolderId);
        if (selectedJob) {
          var selectedJobSummary = getCronSummary(selectedJob.cronExpression || "");
          var selectedJobNodes = Array.isArray(selectedJob.nodes) ? selectedJob.nodes : [];
          jobsOverviewSelection.innerHTML = '<div class="jobs-overview-selection-card"><div class="jobs-overview-selection-header"><div><div class="jobs-overview-selection-label">' + escapeHtml(strings.jobsCurrentFolderLabel || "Current folder") + '</div><strong class="jobs-overview-selection-title" title="' + escapeAttr(selectedJob.name || "") + '">' + escapeHtml(selectedJob.name || "") + '</strong></div><span class="jobs-pill' + (selectedJob.paused || selectedJob.archived ? " is-inactive" : "") + '">' + escapeHtml(getJobStatusText(selectedJob)) + '</span></div><div class="jobs-overview-selection-meta"><span>' + escapeHtml(currentFolderName) + "</span><span>" + escapeHtml(selectedJobSummary !== (strings.labelFriendlyFallback || "") ? selectedJobSummary : selectedJob.cronExpression || "-") + "</span><span>" + escapeHtml(String(selectedJobNodes.length) + " items") + '</span></div><div class="jobs-overview-selection-note">' + escapeHtml(currentFolderPath || (strings.jobsSelectJob || "Select a job to edit its workflow.")) + "</div></div>";
        } else {
          jobsOverviewSelection.innerHTML = '<div class="jobs-overview-selection-card jobs-overview-selection-empty"><div class="jobs-overview-selection-label">' + escapeHtml(strings.jobsCurrentFolderLabel || "Current folder") + '</div><strong class="jobs-overview-selection-title">' + escapeHtml(currentFolderName) + '</strong><div class="jobs-overview-selection-note">' + escapeHtml(currentFolderPath || (strings.jobsRootFolder || "All jobs")) + '</div><div class="jobs-overview-selection-meta"><span>' + escapeHtml(strings.jobsSelectJob || "Select a job to edit its workflow.") + "</span></div></div>";
        }
      }
      var isJobCreateMode = !selectedJob && isCreatingJob;
      applyJobsSidebarState();
      if (jobsOpenEditorBtn) {
        jobsOpenEditorBtn.disabled = !selectedJob;
      }
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
      syncFriendlyBuilderFromCronExpression({
        expression: jobsCronInput ? jobsCronInput.value : "",
        frequency: jobsFriendlyFrequency,
        interval: jobsFriendlyInterval,
        minute: jobsFriendlyMinute,
        hour: jobsFriendlyHour,
        dow: jobsFriendlyDow,
        dom: jobsFriendlyDom,
        updateVisibility: updateJobsFriendlyVisibility
      });
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
    initializeTaskEditorState();
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
      postTaskMessage("deleteTask", id);
    };
    window.addEventListener("message", function handleMessage(event) {
      var message = getHostMessage(event);
      var messageType = message && message.type;
      try {
        switch (messageType) {
          case "updateTasks":
            tasks = Array.isArray(message.tasks) ? message.tasks : [];
            reconcilePendingReadyTodoDraftCreates();
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
              version: 4,
              sections: [],
              cards: [],
              filters: { labels: [], priorities: [], statuses: [], archiveOutcomes: [], flags: [], sortBy: "manual", sortDirection: "asc", viewMode: "board", showArchived: false, showRecurringTasks: false },
              updatedAt: ""
            };
            if (pendingTodoFilters) {
              var incomingFilters = normalizeTodoFilters(cockpitBoard.filters);
              if (areTodoFiltersEqual(incomingFilters, pendingTodoFilters)) {
                pendingTodoFilters = null;
              } else {
                cockpitBoard = Object.assign({}, cockpitBoard, {
                  filters: normalizeTodoFilters(Object.assign({}, incomingFilters, pendingTodoFilters))
                });
              }
            }
            reconcilePendingGridTodoCompletions(cockpitBoard.cards);
            reconcilePendingReadyTodoDraftCreates();
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
            if (pendingBoardDeleteTodoId && !cockpitBoard.cards.some(function(card) {
              return card && card.id === pendingBoardDeleteTodoId;
            })) {
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
            researchProfiles = Array.isArray(message.profiles) ? message.profiles : [];
            activeResearchRun = message.activeRun || null;
            recentResearchRuns = Array.isArray(message.recentRuns) ? message.recentRuns : [];
            if (activeResearchRun && (!selectedResearchRunId || selectedResearchRunId === activeResearchRun.id)) {
              selectedResearchRunId = activeResearchRun.id;
            } else {
              ensureValidResearchRunSelection();
            }
            if (!selectedResearchId) {
              ensureValidResearchSelection();
            }
            renderResearchTab();
            break;
          case "updateGitHubIntegration":
            githubIntegration = message.githubIntegration || createEmptyGitHubIntegrationState();
            renderGitHubIntegrationTab();
            renderCockpitBoard();
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
          case "updateStorageSettings":
            storageSettings = normalizeStorageSettings(message.storageSettings, storageSettings);
            renderStorageSettingsControls();
            showStorageStatusRefreshNote();
            break;
          case "updateApprovalMode":
            if (approvalModeSelect && message.approvalMode) {
              approvalModeSelect.value = message.approvalMode;
            }
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
            renderTaskList(tasks);
            break;
          case "updateReviewDefaults":
            reviewDefaults = message.reviewDefaults || {
              needsBotReviewCommentTemplate: "",
              needsBotReviewPromptTemplate: "",
              needsBotReviewAgent: "agent",
              needsBotReviewModel: "",
              needsBotReviewChatSession: "new",
              readyPromptTemplate: ""
            };
            renderReviewDefaultsControls();
            break;
          case "updateAgents":
            pendingAgentValue = refreshExecutionSelectTargets({
              eventName: "updateAgents",
              selectElement: agentSelect,
              pendingValue: pendingAgentValue,
              createDebugData: function(currentValue) {
                return {
                  currentAgentValue: currentValue,
                  agentCount: Array.isArray(message.agents) ? message.agents.length : 0
                };
              },
              assignItems: function() {
                agents = Array.isArray(message.agents) ? message.agents : [];
              },
              updateOptions: populateAgentDropdown2
            });
            syncSharedAgentAndModelSelectors();
            break;
          case "updateModels":
            pendingModelValue = refreshExecutionSelectTargets({
              eventName: "updateModels",
              selectElement: modelSelect,
              pendingValue: pendingModelValue,
              createDebugData: function(currentValue) {
                return {
                  currentModelValue: currentValue,
                  modelCount: Array.isArray(message.models) ? message.models.length : 0
                };
              },
              assignItems: function() {
                models = Array.isArray(message.models) ? message.models : [];
              },
              updateOptions: populateModelDropdown2
            });
            syncSharedAgentAndModelSelectors();
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
            cockpitHistory = Array.isArray(message.entries) ? message.entries : [];
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
          case "focusReadyTodoDraft":
            focusReadyTodoDraftView(message.todoId);
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
                "success"
              );
            } else if (!message.cancelled) {
              setTodoUploadNote(
                String(message.message || strings.boardUploadFilesError || ""),
                "error"
              );
            } else {
              setTodoUploadNote(
                String(message.message || strings.boardUploadFilesHint || ""),
                "neutral"
              );
            }
            break;
        }
      } catch (e) {
        showWebviewClientError(e);
      }
    });
    renderTaskList(tasks);
    switchTab(getInitialTabName());
    window.addEventListener("scroll", function() {
      if (activeTabName) {
        captureTabScrollPosition(activeTabName);
        persistTaskFilter();
      }
      updateBoardAutoCollapseFromScroll(false);
    }, { passive: true });
    window.addEventListener("resize", scheduleBoardStickyMetrics);
    document.addEventListener("keydown", function(event) {
      handleGlobalSaveShortcut(event);
      if (event.key === "Escape") {
        closeTodoDeleteModal();
        closeTodoCommentModal();
      }
    });
    scheduleBoardStickyMetrics();
    setInterval(function() {
      if (isTabActive("list")) {
        refreshTaskCountdowns();
      }
    }, 1e3);
    vscode.postMessage({ type: "webviewReady" });
  })();
})();
