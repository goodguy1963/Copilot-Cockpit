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
      "[data-todo-complete]",
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
  options.vscode.postMessage({ type: nextActionType, todoId: todoId });
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
        options.vscode.postMessage({ type: "reorderCockpitSection", sectionId: options.getDraggingSectionId(), targetIndex: targetIndex });
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
        targetIndex: targetIndex,
      });
    }
  }
  setBoardDocumentDragState(options, false);
  options.finishBoardDragState();
  pointerDragSession = null;
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
// A single persistent click listener on boardColumns handles ALL interactive
// clicks (buttons, card selection).  This is resilient to innerHTML rebuilds
// that destroy per-element handlers between pointerdown and click.
var boardClickDelegationInstalled = false;

function installBoardClickDelegation(boardColumns) {
  if (boardClickDelegationInstalled || !boardColumns || typeof boardColumns.addEventListener !== "function") {
    return;
  }
  boardClickDelegationInstalled = true;

  boardColumns.addEventListener("click", function (event) {
    var options = activeBoardOptions;
    if (!options) {
      return;
    }
    var target = getEventTargetElement(event);
    if (!target || typeof target.closest !== "function") {
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
      options.openTodoDeleteModal(deleteBtn.getAttribute("data-todo-delete") || "");
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

  // Only pointerdown bindings survive here — needed per-element for drag
  // initiation.  All click handling is delegated above.

  Array.prototype.forEach.call(boardColumns.querySelectorAll("[data-section-drag-handle]"), function (sectionHandle) {
    bindElementListener(sectionHandle, "pointerdown", handleBoardPointerDown);
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
      startY: typeof event.clientY === "number" ? event.clientY : 0,
    };
    activatePointerDragSession(options);
    armBoardClickSuppression();
    return;
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
    activated: false,
    startX: typeof event.clientX === "number" ? event.clientX : 0,
    startY: typeof event.clientY === "number" ? event.clientY : 0,
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
  win.addEventListener("pointerup", function (event) {
    finishPointerDragSession(event, false);
  }, true);
  win.addEventListener("pointercancel", function (event) {
    finishPointerDragSession(event, true);
  }, true);
  boardListenersInstalled = true;
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
