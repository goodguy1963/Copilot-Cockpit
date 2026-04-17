export function getEventTargetElement(eventOrTarget) {
  var target = eventOrTarget && eventOrTarget.target ? eventOrTarget.target : eventOrTarget;
  if (target && target.nodeType === 3) {
    target = target.parentElement;
  }
  return target || null;
}

export function getClosestEventTarget(eventOrTarget, selector) {
  var target = getEventTargetElement(eventOrTarget);
  return target && target.closest ? target.closest(selector) : null;
}

export function isBoardDragHandleTarget(target) {
  return !!getClosestEventTarget(target, "[data-todo-drag-handle], [data-section-drag-handle]");
}

export function isTodoInteractiveTarget(target) {
  return !!getClosestEventTarget(
    target,
    [
      "input",
      "button",
      "select",
      "textarea",
      "a",
      "label",
      "[role=\"button\"]",
      "[contenteditable=\"true\"]",
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
      "[data-section-delete]",
    ].join(", "),
  );
}

function scheduleBoardTimeout(options, callback, delay) {
  var timeoutFn = options && typeof options.setTimeout === "function"
    ? options.setTimeout
    : (typeof setTimeout === "function" ? setTimeout : null);
  if (!timeoutFn) {
    callback();
    return null;
  }
  return timeoutFn.call(null, callback, delay);
}

export function handleBoardSectionCollapse(collapseBtn, options) {
  var sectionId = collapseBtn.getAttribute("data-section-collapse");
  options.toggleSectionCollapsed(sectionId);
  var sectionEl = collapseBtn.closest ? collapseBtn.closest("[data-section-id]") : null;
  var bodyWrapper = sectionEl ? sectionEl.querySelector(".section-body-wrapper") : null;
  var isNowCollapsed = options.collapsedSections.has(sectionId);
  collapseBtn.classList.toggle("collapsed", isNowCollapsed);
  collapseBtn.setAttribute("aria-expanded", isNowCollapsed ? "false" : "true");
  collapseBtn.title = isNowCollapsed ? "Expand section" : "Collapse section";
  if (bodyWrapper) { bodyWrapper.classList.toggle("collapsed", isNowCollapsed); }
  if (sectionEl) { sectionEl.classList.toggle("is-collapsed", isNowCollapsed); }
}

export function handleBoardSectionRename(sectionRenameBtn, options) {
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
  var saveRename = function () {
    if (committed) return;
    committed = true;
    var newTitle = inputEl.value.trim();
    if (newTitle && newTitle !== currentTitle) {
      options.vscode.postMessage({ type: "renameCockpitSection", sectionId: sectionId, title: newTitle });
    } else {
      strongEl.style.display = "";
      if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl);
    }
  };
  inputEl.onkeydown = function (e) {
    if (e.key === "Enter") { e.preventDefault(); saveRename(); }
    if (e.key === "Escape") { committed = true; strongEl.style.display = ""; if (inputEl.parentNode) inputEl.parentNode.removeChild(inputEl); }
  };
  inputEl.onblur = function () { scheduleBoardTimeout(options, saveRename, 120); };
  strongEl.style.display = "none";
  strongEl.parentNode.insertBefore(inputEl, strongEl);
  inputEl.select();
}

export function handleBoardSectionDelete(sectionDeleteBtn, options) {
  var sectionId = sectionDeleteBtn.getAttribute("data-section-delete");
  if (sectionDeleteBtn.getAttribute("data-confirming")) {
    options.vscode.postMessage({ type: "deleteCockpitSection", sectionId: sectionId });
    sectionDeleteBtn.removeAttribute("data-confirming");
    return;
  }
  sectionDeleteBtn.setAttribute("data-confirming", "1");
  var origText = sectionDeleteBtn.textContent;
  var origColor = sectionDeleteBtn.style.color;
  sectionDeleteBtn.textContent = options.strings.boardDeleteConfirm || "Delete?";
  sectionDeleteBtn.style.color = "var(--vscode-errorForeground)";
  sectionDeleteBtn.style.opacity = "1";
  scheduleBoardTimeout(options, function () {
    if (sectionDeleteBtn.getAttribute("data-confirming")) {
      sectionDeleteBtn.removeAttribute("data-confirming");
      sectionDeleteBtn.textContent = origText;
      sectionDeleteBtn.style.color = origColor;
      sectionDeleteBtn.style.opacity = "";
    }
  }, 2500);
}

export function handleBoardTodoCompletion(completeToggle, options) {
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
    todoCard.flags.forEach(function (flag) {
      var key = String(flag || "").trim().toLowerCase();
      if (key === "go") {
        key = "ready";
      }
      if (["new", "needs-bot-review", "needs-user-review", "ready", "on-schedule-list", "final-user-check"].indexOf(key) >= 0) {
        workflowFlag = key;
      }
    });
  }
  var isReadyTodo = workflowFlag === "ready" || workflowFlag === "final-user-check";
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
  options.vscode.postMessage({ type: completionActionType, todoId: todoId });
}

export function handleBoardTodoCompletionCancel(cancelBtn, options) {
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
    // Some webview/event targets do not support pointer capture; fall back.
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
    // Ignore release failures; the drag session still needs to complete.
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
  return (deltaX * deltaX) + (deltaY * deltaY) >= (TODO_POINTER_DRAG_THRESHOLD_PX * TODO_POINTER_DRAG_THRESHOLD_PX);
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
  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-id].section-drag-over"), function (el) {
    el.classList.remove("section-drag-over");
  });
  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-id].section-dragging"), function (el) {
    el.classList.remove("section-dragging");
  });
  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-todo-id].todo-dragging"), function (el) {
    el.classList.remove("todo-dragging");
  });
  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-todo-id].todo-drop-target"), function (el) {
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
    function (card) {
      return card && card.getAttribute && card.getAttribute("data-section-id") === sectionId && card.getAttribute("data-todo-id") !== draggingTodoId;
    },
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

  return sectionCards.length > 0
    ? sectionCards.length
    : Math.max(0, fallbackCount - sameSectionCardAdjustment);
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
  if (
    typeof pointerDragSession.pointerId === "number" &&
    event &&
    typeof event.pointerId === "number" &&
    event.pointerId !== pointerDragSession.pointerId
  ) {
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
  if (
    typeof session.pointerId === "number" &&
    event &&
    typeof event.pointerId === "number" &&
    event.pointerId !== session.pointerId
  ) {
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
        options.vscode.postMessage({ type: "reorderCockpitSection", sectionId: options.getDraggingSectionId(), targetIndex: targetIndex });
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
        options.getDraggingTodoId(),
      );
      options.vscode.postMessage({
        type: "moveTodo",
        todoId: options.getDraggingTodoId(),
        sectionId: section.getAttribute("data-section-id"),
        targetIndex: targetIndex,
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
  // Safety: reset suppressNextBoardClick after a short delay so it doesn't
  // stay stuck if the browser never fires the trailing click event (e.g.
  // when the pointer ends on a different element than where it started).
  if (typeof setTimeout === "function") {
    setTimeout(function () { suppressNextBoardClick = false; }, 350);
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

// ---------- Delegated click handling ----------
// A single persistent click listener on the current board root handles ALL
// interactive clicks. Rebind when the board root element itself changes.
var delegatedBoardColumns = null;

function installBoardClickDelegation(boardColumns) {
  if (!boardColumns || typeof boardColumns.addEventListener !== "function") {
    return;
  }
  if (delegatedBoardColumns === boardColumns) {
    return;
  }
  delegatedBoardColumns = boardColumns;

  boardColumns.addEventListener("click", function (event) {
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

    // --- Todo action buttons (highest priority) ---
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

    // --- Section buttons ---
    var collapseBtn = target.closest("[data-section-collapse]");
    if (collapseBtn) {
      stopBoardEvent(event);
      options.handleSectionCollapse(collapseBtn);
      return;
    }

    var sectionHeader = target.closest(".cockpit-section-header");
    if (
      sectionHeader &&
      !target.closest("[data-section-drag-handle]") &&
      !target.closest("[data-section-rename]") &&
      !target.closest("[data-section-delete]")
    ) {
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

    // --- Card body click (least specific: selection) ---
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

  // Only pointerdown bindings survive here — needed per-element for drag
  // initiation.  All click handling is delegated above.

  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-drag-handle]"), function (sectionHandle) {
    bindElementListener(sectionHandle, "pointerdown", handleBoardPointerDown);
  });

  Array.prototype.forEach.call(boardColumns.querySelectorAll(".cockpit-section-header"), function (sectionHeader) {
    bindElementListener(sectionHeader, "pointerdown", handleBoardPointerDown);
  });

  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-todo-id]"), function (card) {
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
  var sectionEl = sectionHandle && sectionHandle.closest
    ? sectionHandle.closest("[data-section-id]")
    : null;
  var sectionId = sectionHandle
    ? sectionHandle.getAttribute("data-section-drag-handle")
    : "";
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
      startY: typeof event.clientY === "number" ? event.clientY : 0,
    };
    trySetPointerCapture(event, pointerDragSession);
    activatePointerDragSession(options);
    armBoardClickSuppression();
    return;
  }
  if (sectionHeader && !isTodoInteractiveTarget(target)) {
    var headerSection = sectionHeader.closest
      ? sectionHeader.closest("[data-section-id]")
      : null;
    var headerSectionId = headerSection && headerSection.getAttribute
      ? headerSection.getAttribute("data-section-id")
      : "";
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
        startY: typeof event.clientY === "number" ? event.clientY : 0,
      };
      trySetPointerCapture(event, pointerDragSession);
      return;
    }
  }
  var card = todoHandle && todoHandle.closest
    ? todoHandle.closest("[data-todo-id]")
    : getClosestEventTarget(target, "[data-todo-id]");
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
    draggedId: todoHandle
      ? (todoHandle.getAttribute("data-todo-drag-handle") || card.getAttribute("data-todo-id"))
      : (card.getAttribute("data-todo-id") || ""),
    draggedElement: card,
    captureElement: todoHandle || card,
    activated: false,
    lastPointTarget: target,
    pointerId: typeof event.pointerId === "number" ? event.pointerId : null,
    startX: typeof event.clientX === "number" ? event.clientX : 0,
    startY: typeof event.clientY === "number" ? event.clientY : 0,
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
    win.addEventListener("pointerup", function (event) {
      finishPointerDragSession(event, false);
    }, true);
    win.addEventListener("pointercancel", function (event) {
      finishPointerDragSession(event, true);
    }, true);
    win.addEventListener("mouseup", function (event) {
      finishPointerDragSession(event, false);
    }, true);
    win.addEventListener("blur", function (event) {
      finishPointerDragSession(event, true);
    }, true);
    installedBoardWindow = win;
  }
  if (!doc || typeof doc.addEventListener !== "function" || installedBoardDocument === doc) {
    return;
  }
  doc.addEventListener("pointerup", function (event) {
    finishPointerDragSession(event, false);
  }, true);
  doc.addEventListener("pointercancel", function (event) {
    finishPointerDragSession(event, true);
  }, true);
  doc.addEventListener("mouseup", function (event) {
    finishPointerDragSession(event, false);
  }, true);
  doc.addEventListener("visibilitychange", function () {
    if (doc.visibilityState === "hidden") {
      finishPointerDragSession(null, true);
    }
  }, true);
  installedBoardDocument = doc;
}

export function bindBoardColumnInteractions(options) {
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
