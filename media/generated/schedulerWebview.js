<<<<<<< HEAD
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
        "[data-todo-delete-cancel]",
        "[data-todo-delete-reject]",
        "[data-todo-delete-permanent]",
        "[data-todo-purge]",
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
    var isReadyTodo = workflowFlag === "final-user-check";
    function clearCompletionConfirmState() {
      completeToggle.removeAttribute("data-confirming");
      completeToggle.classList.remove("is-confirming");
      completeToggle.setAttribute("data-finalize-state", "idle");
      if (completeToggle.hasAttribute("data-original-title")) {
        completeToggle.setAttribute(
          "title",
          completeToggle.getAttribute("data-original-title") || ""
        );
        completeToggle.setAttribute(
          "aria-label",
          completeToggle.getAttribute("data-original-title") || ""
        );
        completeToggle.removeAttribute("data-original-title");
      }
      if (completeToggle.hasAttribute("data-original-html")) {
        completeToggle.innerHTML = completeToggle.getAttribute("data-original-html") || "";
        completeToggle.removeAttribute("data-original-html");
      }
      var cancelBtn2 = cardEl && cardEl.querySelector ? cardEl.querySelector('[data-todo-finalize-cancel="' + todoId + '"]') : null;
      if (cancelBtn2 && cancelBtn2.parentNode) {
        cancelBtn2.parentNode.removeChild(cancelBtn2);
      }
    }
    if (!todoId) {
      return;
    }
    if (!isReadyTodo) {
      completeToggle.disabled = true;
      if (cardEl) {
        cardEl.style.opacity = "0.35";
        cardEl.style.pointerEvents = "none";
      }
      options.vscode.postMessage({ type: "approveTodo", todoId });
      return;
    }
    if (!completeToggle.getAttribute("data-confirming")) {
      completeToggle.setAttribute("data-confirming", "1");
      completeToggle.classList.add("is-confirming");
      completeToggle.setAttribute("data-finalize-state", "confirming");
      completeToggle.setAttribute(
        "data-original-title",
        completeToggle.getAttribute("title") || ""
      );
      completeToggle.setAttribute("data-original-html", completeToggle.innerHTML || "");
      completeToggle.setAttribute(
        "title",
        options.strings.boardFinalizePrompt || "Archive this todo as completed successfully?"
      );
      completeToggle.setAttribute(
        "aria-label",
        options.strings.boardFinalizeTodoYes || "Yes"
      );
      completeToggle.innerHTML = '<span aria-hidden="true">' + (options.strings.boardFinalizeTodoYes || "Yes") + "</span>";
      var cancelBtn = options.document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "todo-complete-button is-cancel";
      cancelBtn.setAttribute("data-todo-finalize-cancel", todoId);
      cancelBtn.setAttribute("data-no-drag", "1");
      cancelBtn.setAttribute("title", options.strings.boardFinalizeTodoNo || "No");
      cancelBtn.setAttribute("aria-label", options.strings.boardFinalizeTodoNo || "No");
      cancelBtn.textContent = options.strings.boardFinalizeTodoNo || "No";
      cancelBtn.onclick = function(event) {
        stopBoardEvent(event);
        clearCompletionConfirmState();
      };
      if (completeToggle.parentNode) {
        completeToggle.parentNode.insertBefore(cancelBtn, completeToggle.nextSibling);
      }
      return;
    }
    clearCompletionConfirmState();
    completeToggle.disabled = true;
    if (cardEl) {
      cardEl.style.opacity = "0.35";
      cardEl.style.pointerEvents = "none";
    }
    options.vscode.postMessage({ type: "finalizeTodo", todoId });
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
    var sectionEl = sectionHandle && sectionHandle.closest ? sectionHandle.closest("[data-section-id]") : null;
    var sectionId = sectionHandle ? sectionHandle.getAttribute("data-section-drag-handle") : "";
    if (sectionHandle) {
      stopBoardEvent(event);
      clearBoardDragClasses(boardColumns);
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

  // media/schedulerWebviewBoardRendering.js
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

  // media/schedulerWebviewCronUtils.js
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
    var normalized = String(value || "").trim().toLowerCase();
    if (/^\d+$/.test(normalized)) {
      var numericValue = parseInt(normalized, 10);
      if (numericValue === 7) {
        numericValue = 0;
      }
      if (numericValue >= 0 && numericValue <= 6) {
        return numericValue;
      }
    }
    var aliases = {
      sun: 0,
      mon: 1,
      tue: 2,
      wed: 3,
      thu: 4,
      fri: 5,
      sat: 6
    };
    return Object.prototype.hasOwnProperty.call(aliases, normalized) ? aliases[normalized] : null;
  }
  function formatFriendlyTime(hour, minute) {
    return padFriendlyNumber(hour) + ":" + padFriendlyNumber(minute);
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
  function summarizeCronExpression(expression, strings) {
    var labels = strings || {};
    var fallback = labels.labelFriendlyFallback || "";
    var normalizedExpression = String(expression || "").trim();
    if (!normalizedExpression) {
      return fallback;
    }
    var parts = normalizedExpression.split(/\s+/);
    if (parts.length !== 5) {
      return fallback;
    }
    var minute = parts[0];
    var hour = parts[1];
    var dayOfMonth = parts[2];
    var month = parts[3];
    var dayOfWeek = parts[4];
    var isWholeNumber = function(value) {
      return /^\d+$/.test(String(value));
    };
    var normalizedDayOfWeek = String(dayOfWeek || "").toLowerCase();
    var isWeekdays = normalizedDayOfWeek === "1-5" || normalizedDayOfWeek === "mon-fri";
    var everyNMinutesMatch = /^\*\/(\d+)$/.exec(minute);
    if (everyNMinutesMatch && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var everyNTemplate = labels.cronPreviewEveryNMinutes || "";
      return everyNTemplate ? everyNTemplate.replace("{n}", String(everyNMinutesMatch[1])) : fallback;
    }
    if (isWholeNumber(minute) && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var hourlyTemplate = labels.cronPreviewHourlyAtMinute || "";
      return hourlyTemplate ? hourlyTemplate.replace("{m}", String(minute)) : fallback;
    }
    if (isWholeNumber(minute) && isWholeNumber(hour) && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
      var dailyTemplate = labels.cronPreviewDailyAt || "";
      var dailyTime = formatFriendlyTime(hour, minute);
      return dailyTemplate ? dailyTemplate.replace("{t}", String(dailyTime)) : fallback;
    }
    if (isWholeNumber(minute) && isWholeNumber(hour) && dayOfMonth === "*" && month === "*" && isWeekdays) {
      var weekdaysTemplate = labels.cronPreviewWeekdaysAt || "";
      var weekdaysTime = formatFriendlyTime(hour, minute);
      return weekdaysTemplate ? weekdaysTemplate.replace("{t}", String(weekdaysTime)) : fallback;
    }
    var numericDayOfWeek = normalizeDayOfWeekValue(dayOfWeek);
    if (isWholeNumber(minute) && isWholeNumber(hour) && dayOfMonth === "*" && month === "*" && numericDayOfWeek !== null) {
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
    if (isWholeNumber(minute) && isWholeNumber(hour) && isWholeNumber(dayOfMonth) && month === "*" && dayOfWeek === "*") {
      var monthlyTemplate = labels.cronPreviewMonthlyOnAt || "";
      var monthlyTime = formatFriendlyTime(hour, minute);
      return monthlyTemplate ? monthlyTemplate.replace("{dom}", String(dayOfMonth)).replace("{t}", String(monthlyTime)) : fallback;
    }
    return fallback;
  }

  // media/schedulerWebviewPromptState.js
  function restorePendingSelectValue(selectEl, desiredValue) {
    var pendingValue = desiredValue || "";
    if (!selectEl || !pendingValue) {
      return pendingValue;
    }
    selectEl.value = pendingValue;
    return selectEl.value === pendingValue ? "" : pendingValue;
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
    var placeholder = '<option value="">' + escapeHtml(placeholderText) + "</option>";
    templateSelect.innerHTML = placeholder + promptTemplates.filter(function(template) {
      return template && template.source === currentSource;
    }).map(function(template) {
      return '<option value="' + escapeAttr(template.path) + '">' + escapeHtml(template.name) + "</option>";
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
      if (!keepSelection && templateSelect) {
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

  // media/schedulerWebviewTaskCards.js
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
    return '<select class="' + params.className + '" data-id="' + params.taskId + '" style="width: auto; max-width: 140px; display: inline-block; padding: 2px 4px; margin-right: 8px; height: 26px; font-size: 11px;">' + options + "</select>";
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
    return '<div class="task-config" style="margin: 4px 0 8px 0; display: flex; align-items: center;">' + agentSelect + modelSelect + "</div>";
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

  // media/schedulerWebviewTaskActions.js
  function handleTaskListClick(params) {
    var event = params.event;
    var taskList = params.taskList;
    var getTaskList = params.getTaskList;
    var readyTodoOpenTarget = params.getClosestEventTarget(
      event.target,
      "[data-ready-todo-open]"
    );
    if (readyTodoOpenTarget) {
      if (!taskList || !taskList.isConnected) {
        taskList = getTaskList();
      }
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
    if (!taskList || !taskList.isConnected) {
      taskList = getTaskList();
    }
    if (taskList && !taskList.contains(actionTarget)) {
      return false;
    }
    var action = actionTarget.getAttribute("data-action");
    var taskId = actionTarget.getAttribute("data-id");
    if (!action || !taskId) {
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

  // media/schedulerWebviewTaskSelectState.js
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

  // media/schedulerWebviewDisplayUtils.js
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

  // media/schedulerWebviewBootstrap.js
  function readInitialWebviewBootstrap(documentRef) {
    var initialData = {};
    try {
      var initialScript = documentRef.getElementById("initial-data");
      if (initialScript && initialScript.textContent) {
        initialData = JSON.parse(initialScript.textContent) || {};
      }
    } catch (_error) {
      initialData = {};
    }
    return {
      initialData,
      strings: initialData.strings || {},
      currentLogLevel: typeof initialData.logLevel === "string" && initialData.logLevel ? initialData.logLevel : "info",
      currentLogDirectory: typeof initialData.logDirectory === "string" ? initialData.logDirectory : ""
    };
  }
  function firstErrorLine(reason, unknownText) {
    var raw = unknownText || "";
    if (reason) {
      if (typeof reason === "string") {
        raw = reason;
      } else if (typeof reason === "object" && reason.message) {
        raw = String(reason.message);
      } else {
        raw = String(reason);
      }
    }
    return String(raw).split(/\r?\n/)[0];
  }
  function installGlobalErrorHandlers(params) {
    params.window.onerror = function(msg, _url, line) {
      var prefix = params.strings.webviewScriptErrorPrefix || "";
      var linePrefix = params.strings.webviewLinePrefix || "";
      var lineSuffix = params.strings.webviewLineSuffix || "";
      params.showGlobalError(
        prefix + params.sanitizeAbsolutePaths(String(msg)) + linePrefix + String(line) + lineSuffix
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

  // media/schedulerWebviewInitialState.js
  function readArray(value) {
    return Array.isArray(value) ? value : [];
  }
  function createInitialSchedulerWebviewState(initialData, normalizeStorageSettings2) {
    var data = initialData || {};
    return {
      storageSettings: normalizeStorageSettings2(data.storageSettings),
      researchProfiles: readArray(data.researchProfiles),
      activeResearchRun: data.activeResearchRun || null,
      recentResearchRuns: readArray(data.recentResearchRuns),
      agents: readArray(data.agents),
      models: readArray(data.models),
      promptTemplates: readArray(data.promptTemplates),
      skills: readArray(data.skills),
      scheduleHistory: readArray(data.scheduleHistory),
      defaultChatSession: data.defaultChatSession === "continue" ? "continue" : "new",
      autoShowOnStartup: !!data.autoShowOnStartup,
      workspacePaths: readArray(data.workspacePaths),
      caseInsensitivePaths: !!data.caseInsensitivePaths
    };
  }

  // media/schedulerWebviewDomRefs.js
  function createSchedulerWebviewDomRefs(document2) {
    return {
      taskForm: document2.getElementById("task-form"),
      taskList: document2.getElementById("task-list"),
      editTaskIdInput: document2.getElementById("edit-task-id"),
      submitBtn: document2.getElementById("submit-btn"),
      testBtn: document2.getElementById("test-btn"),
      refreshBtn: document2.getElementById("refresh-btn"),
      autoShowStartupBtn: document2.getElementById("auto-show-startup-btn"),
      scheduleHistorySelect: document2.getElementById("schedule-history-select"),
      restoreHistoryBtn: document2.getElementById("restore-history-btn"),
      autoShowStartupNote: document2.getElementById("auto-show-startup-note"),
      friendlyBuilder: document2.getElementById("friendly-builder"),
      cronPreset: document2.getElementById("cron-preset"),
      cronExpression: document2.getElementById("cron-expression"),
      agentSelect: document2.getElementById("agent-select"),
      modelSelect: document2.getElementById("model-select"),
      chatSessionGroup: document2.getElementById("chat-session-group"),
      chatSessionSelect: document2.getElementById("chat-session"),
      templateSelect: document2.getElementById("template-select"),
      templateSelectGroup: document2.getElementById("template-select-group"),
      templateRefreshBtn: document2.getElementById("template-refresh-btn"),
      skillSelect: document2.getElementById("skill-select"),
      insertSkillBtn: document2.getElementById("insert-skill-btn"),
      setupMcpBtn: document2.getElementById("setup-mcp-btn"),
      syncBundledSkillsBtn: document2.getElementById("sync-bundled-skills-btn"),
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
      friendlyGenerate: document2.getElementById("friendly-generate"),
      openGuruBtn: document2.getElementById("open-guru-btn"),
      cronPreviewText: document2.getElementById("cron-preview-text"),
      newTaskBtn: document2.getElementById("new-task-btn"),
      taskFilterBar: document2.getElementById("task-filter-bar"),
      taskLabelFilter: document2.getElementById("task-label-filter"),
      taskLabelsInput: document2.getElementById("task-labels"),
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
      jobsFriendlyGenerate: document2.getElementById("jobs-friendly-generate"),
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
      spotReviewTemplateInput: document2.getElementById("spot-review-template-input"),
      botReviewPromptTemplateInput: document2.getElementById("bot-review-prompt-template-input"),
      botReviewAgentSelect: document2.getElementById("bot-review-agent-select"),
      botReviewModelSelect: document2.getElementById("bot-review-model-select"),
      botReviewChatSessionSelect: document2.getElementById("bot-review-chat-session-select"),
      reviewDefaultsSaveBtn: document2.getElementById("review-defaults-save-btn"),
      reviewDefaultsNote: document2.getElementById("review-defaults-note"),
      settingsStorageModeSelect: document2.getElementById("settings-storage-mode-select"),
      settingsStorageMirrorInput: document2.getElementById("settings-storage-mirror-input"),
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

  // media/schedulerWebviewBoardState.js
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

  // media/schedulerWebviewDefaults.js
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
        spotReviewTemplate: "",
        botReviewPromptTemplate: "",
        botReviewAgent: "agent",
        botReviewModel: "",
        botReviewChatSession: "new"
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
    return function normalizeStorageSettings2(value, previousValue) {
      var disabledSystemFlagKeys = Array.isArray(value && value.disabledSystemFlagKeys) ? value.disabledSystemFlagKeys.map(function(entry) {
        return normalizeTodoLabelKey(entry);
      }).filter(function(entry, index, values) {
        return !!entry && values.indexOf(entry) === index;
      }) : (previousValue && previousValue.disabledSystemFlagKeys || []).slice();
      return {
        mode: value && value.mode === "json" ? "json" : "sqlite",
        sqliteJsonMirror: !value || value.sqliteJsonMirror !== false,
        disabledSystemFlagKeys,
        appVersion: value && typeof value.appVersion === "string" ? value.appVersion : previousValue && previousValue.appVersion || "",
        mcpSetupStatus: normalizeMcpSetupStatus(
          value && value.mcpSetupStatus,
          previousValue && previousValue.mcpSetupStatus
        ),
        lastMcpSupportUpdateAt: value && typeof value.lastMcpSupportUpdateAt === "string" ? value.lastMcpSupportUpdateAt : previousValue && previousValue.lastMcpSupportUpdateAt || "",
        lastBundledSkillsSyncAt: value && typeof value.lastBundledSkillsSyncAt === "string" ? value.lastBundledSkillsSyncAt : previousValue && previousValue.lastBundledSkillsSyncAt || ""
      };
    };
  }

  // media/schedulerWebviewTabState.js
  function activateSchedulerTab(document2, tabName) {
    document2.querySelectorAll(".tab-button").forEach(function(button) {
      button.classList.remove("active");
    });
    document2.querySelectorAll(".tab-content").forEach(function(content) {
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
          event.stopPropagation();
          var tabName = button.getAttribute("data-tab");
          if (tabName) {
            switchTab(tabName);
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
      var filterButton = target;
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

  // media/schedulerWebviewBindings.js
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
    if (!button) {
      return;
    }
    button.addEventListener("click", action);
  }
  function bindSelectChange(select, onChange) {
    if (!select) {
      return;
    }
    select.addEventListener("change", function() {
      onChange(select);
    });
  }
  function bindDocumentValueDelegates(document2, eventName, handlersById) {
    document2.addEventListener(eventName, function(event) {
      var target = event && event.target;
      if (!target || typeof target.id !== "string") {
        return;
      }
      var handler = handlersById[target.id];
      if (typeof handler === "function") {
        handler(target);
      }
    });
  }
  function bindOpenCronGuruButton(button, getExpression, windowObject) {
    bindClickAction(button, function() {
      var expression = getExpression().trim();
      if (!expression) {
        expression = "* * * * *";
      }
      var targetUrl = "https://crontab.guru/#" + encodeURIComponent(expression);
      windowObject.open(targetUrl, "_blank");
    });
  }
  function bindInlineTaskQuickUpdate(document2, vscode) {
    document2.addEventListener("change", function(event) {
      var target = event && event.target;
      if (!target) return;
      if (target.classList.contains("task-agent-select")) {
        vscode.postMessage({
          type: "updateTask",
          taskId: target.getAttribute("data-id"),
          data: { agent: target.value }
        });
        return;
      }
      if (target.classList.contains("task-model-select")) {
        vscode.postMessage({
          type: "updateTask",
          taskId: target.getAttribute("data-id"),
          data: { model: target.value }
        });
      }
    });
  }

  // media/schedulerWebviewFormBindings.js
  function bindPromptSourceDelegation(document2, applyPromptSource) {
    document2.addEventListener("change", function(event) {
      var target = event && event.target;
      if (target && target.name === "prompt-source" && target.checked) {
        applyPromptSource(target.value);
      }
    });
  }
  function bindCronPresetPair(presetControl, valueControl, onSynchronized) {
    if (!presetControl || !valueControl) {
      return;
    }
    presetControl.addEventListener("change", function() {
      if (presetControl.value) {
        valueControl.value = presetControl.value;
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
      var sourceEl = document2.querySelector(
        'input[name="prompt-source"]:checked'
      );
      vscode.postMessage({
        type: "loadPromptTemplate",
        path: selectedPath,
        source: sourceEl ? sourceEl.value : "inline"
      });
    });
  }

  // media/schedulerWebviewTaskSubmit.js
  function showFormError(formErrorElement, message) {
    if (!formErrorElement) {
      return false;
    }
    formErrorElement.textContent = message;
    formErrorElement.style.display = "block";
    return true;
  }
  function validateTaskSubmission(options) {
    var taskData = options.taskData;
    var promptSourceValue = options.promptSourceValue;
    var formErr = options.formErr;
    var strings = options.strings;
    var editingTaskId = options.editingTaskId;
    var getTaskByIdLocal = options.getTaskByIdLocal;
    var nameValue = (taskData.name || "").trim();
    if (!nameValue) {
      showFormError(formErr, strings.taskNameRequired || "");
      return false;
    }
    var templateValue = (taskData.promptPath || "").trim();
    if (promptSourceValue !== "inline" && !templateValue) {
      showFormError(formErr, strings.templateRequired || "");
      return false;
    }
    var promptValue = (taskData.prompt || "").trim();
    if (promptSourceValue !== "inline" && !promptValue && editingTaskId) {
      var editingTask = getTaskByIdLocal(editingTaskId);
      taskData.prompt = editingTask && typeof editingTask.prompt === "string" ? editingTask.prompt : "";
      promptValue = (taskData.prompt || "").trim();
    }
    if (promptSourceValue === "inline" && !promptValue) {
      showFormError(formErr, strings.promptRequired || "");
      return false;
    }
    var cronValue = (taskData.cronExpression || "").trim();
    if (!cronValue) {
      showFormError(
        formErr,
        strings.cronExpressionRequired || strings.invalidCronExpression || ""
      );
      return false;
    }
    return true;
  }
  function postTaskSubmission(vscode, editingTaskId, taskData) {
    if (editingTaskId) {
      vscode.postMessage({
        type: "updateTask",
        taskId: editingTaskId,
        data: taskData
      });
      return;
    }
    vscode.postMessage({
      type: "createTask",
      data: taskData
    });
  }
  function buildTaskSubmissionData(options) {
    var editorState = options.editorState || {};
    var labels = options.parseLabels ? options.parseLabels(editorState.labels || "") : [];
    return {
      name: editorState.name || "",
      prompt: editorState.prompt || "",
      cronExpression: editorState.cronExpression || "",
      labels,
      agent: editorState.agent || "",
      model: editorState.model || "",
      scope: editorState.scope || "workspace",
      promptSource: editorState.promptSource || "inline",
      promptPath: editorState.promptPath || "",
      runFirstInOneMinute: !!options.runFirstInOneMinute,
      oneTime: !!editorState.oneTime,
      manualSession: !!editorState.manualSession,
      jitterSeconds: Number(editorState.jitterSeconds || 0),
      enabled: options.editingTaskId ? options.editingTaskEnabled : true,
      chatSession: editorState.oneTime ? "" : editorState.chatSession || "new"
    };
  }

  // media/schedulerWebviewToolbarBindings.js
  function bindTaskTestButton(button, options) {
    bindClickAction(button, function() {
      var promptTextEl = options.document.getElementById("prompt-text");
      var prompt = promptTextEl ? promptTextEl.value : "";
      var agent = options.agentSelect ? options.agentSelect.value : "";
      var model = options.modelSelect ? options.modelSelect.value : "";
      if (!prompt) {
        return;
      }
      options.vscode.postMessage({
        type: "testPrompt",
        prompt,
        agent,
        model
      });
    });
  }
  function bindRefreshButton(button, vscode) {
    bindClickAction(button, function() {
      vscode.postMessage({ type: "refreshTasks" });
      vscode.postMessage({ type: "refreshAgents" });
      vscode.postMessage({ type: "refreshPrompts" });
    });
  }
  function bindAutoShowStartupButton(button, vscode) {
    bindClickAction(button, function() {
      vscode.postMessage({ type: "toggleAutoShowOnStartup" });
    });
  }
  function bindRestoreHistoryButton(button, options) {
    bindClickAction(button, function() {
      var snapshotId = options.scheduleHistorySelect ? options.scheduleHistorySelect.value : "";
      if (!snapshotId) {
        options.window.alert(
          options.strings.scheduleHistoryRestoreSelectRequired || "Select a backup version first"
        );
        return;
      }
      var selectedEntry = (Array.isArray(options.scheduleHistory) ? options.scheduleHistory : []).find(function(entry) {
        return entry && entry.id === snapshotId;
      });
      var selectedLabel = options.formatHistoryLabel(selectedEntry);
      var confirmText = (options.strings.scheduleHistoryRestoreConfirm || "Restore the repo schedule from {createdAt}? The current state will be backed up first.").replace("{createdAt}", selectedLabel).replace("{timestamp}", selectedLabel);
      if (!options.window.confirm(confirmText)) {
        return;
      }
      options.vscode.postMessage({
        type: "restoreScheduleHistory",
        snapshotId
      });
    });
  }

  // media/schedulerWebviewJobBindings.js
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

  // media/schedulerWebviewUtilityBindings.js
  function bindTemplateRefreshButton(button, options) {
    bindClickAction(button, function() {
      options.vscode.postMessage({ type: "refreshPrompts" });
      var selectedPath = options.templateSelect ? options.templateSelect.value : "";
      var sourceEl = options.document.querySelector(
        'input[name="prompt-source"]:checked'
      );
      var source = sourceEl ? sourceEl.value : "inline";
      if (selectedPath && (source === "local" || source === "global")) {
        options.vscode.postMessage({
          type: "loadPromptTemplate",
          path: selectedPath,
          source
        });
      }
    });
  }
  function bindUtilityActionButtons(vscode, buttonMap) {
    Object.keys(buttonMap).forEach(function(action) {
      bindClickAction(buttonMap[action], function() {
        vscode.postMessage({ type: action });
      });
    });
  }
  function syncLanguageSelectors(helpLanguageSelect, settingsLanguageSelect, value) {
    var nextValue = value || "auto";
    if (helpLanguageSelect) {
      helpLanguageSelect.value = nextValue;
    }
    if (settingsLanguageSelect) {
      settingsLanguageSelect.value = nextValue;
    }
  }
  function saveLanguageSelection(helpLanguageSelect, settingsLanguageSelect, vscode, value) {
    var nextValue = value || "auto";
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

  // media/schedulerWebviewJobInteractions.js
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

  // media/schedulerWebviewTransientState.js
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

  // media/schedulerWebview.js
  (function() {
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
    var initialCollections = resolveInitialSchedulerCollections(initialData);
    var tasks = initialCollections.tasks;
    var jobs = initialCollections.jobs;
    var jobFolders = initialCollections.jobFolders;
    var cockpitBoard = initialCollections.cockpitBoard;
    var telegramNotification = initialCollections.telegramNotification;
    var executionDefaults = initialCollections.executionDefaults;
    var reviewDefaults = initialCollections.reviewDefaults;
    var initialState = createInitialSchedulerWebviewState(
      initialData,
      createStorageSettingsNormalizer(normalizeTodoLabelKey)
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
    var EDITOR_EDIT_SYMBOL = "\u2699";
    var boardRenderState = createBoardRenderState();
    var draggingTodoId = null;
    var isBoardDragging = false;
    var pendingBoardRender = false;
    var scheduledBoardRenderFrame = 0;
    function requestCockpitBoardRender() {
      boardRenderState.draggingTodoId = draggingTodoId;
      boardRenderState.isBoardDragging = isBoardDragging;
      boardRenderState.pendingBoardRender = pendingBoardRender;
      boardRenderState.scheduledBoardRenderFrame = scheduledBoardRenderFrame;
      requestBoardRender(boardRenderState, requestAnimationFrame, function() {
        renderCockpitBoard();
      });
      draggingTodoId = boardRenderState.draggingTodoId;
      isBoardDragging = boardRenderState.isBoardDragging;
      pendingBoardRender = boardRenderState.pendingBoardRender;
      scheduledBoardRenderFrame = boardRenderState.scheduledBoardRenderFrame;
    }
    function finishBoardDragState() {
      boardRenderState.draggingTodoId = draggingTodoId;
      boardRenderState.isBoardDragging = isBoardDragging;
      boardRenderState.pendingBoardRender = pendingBoardRender;
      boardRenderState.scheduledBoardRenderFrame = scheduledBoardRenderFrame;
      finishBoardDrag(
        boardRenderState,
        function() {
          draggingSectionId = null;
          lastDragOverSectionId = null;
        },
        function() {
          draggingTodoId = boardRenderState.draggingTodoId;
          isBoardDragging = boardRenderState.isBoardDragging;
          pendingBoardRender = boardRenderState.pendingBoardRender;
          scheduledBoardRenderFrame = boardRenderState.scheduledBoardRenderFrame;
          requestCockpitBoardRender();
        }
      );
      draggingTodoId = boardRenderState.draggingTodoId;
      isBoardDragging = boardRenderState.isBoardDragging;
      pendingBoardRender = boardRenderState.pendingBoardRender;
      scheduledBoardRenderFrame = boardRenderState.scheduledBoardRenderFrame;
    }
    var HELP_WARP_SEEN_KEY = "copilot-scheduler-help-warp-seen-v1";
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
    function resetTodoDraft(reason) {
      currentTodoDraft = debugTools.resetTodoDraft(reason);
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
    var defaultJitterSeconds = normalizeDefaultJitterSeconds(
      initialData.defaultJitterSeconds
    );
    var locale = typeof initialData.locale === "string" && initialData.locale ? initialData.locale : void 0;
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
      spotReviewTemplateInput,
      botReviewPromptTemplateInput,
      botReviewAgentSelect,
      botReviewModelSelect,
      botReviewChatSessionSelect,
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
      cockpitColSlider
    } = createSchedulerWebviewDomRefs(document);
    var activeTaskFilter = "all";
    var activeLabelFilter = "";
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
        }
        if (state && typeof state.labelFilter === "string") {
          activeLabelFilter = state.labelFilter;
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
        spotReviewTemplate: spotReviewTemplateInput ? String(spotReviewTemplateInput.value || "") : "",
        botReviewPromptTemplate: botReviewPromptTemplateInput ? String(botReviewPromptTemplateInput.value || "") : "",
        botReviewAgent: botReviewAgentSelect ? String(botReviewAgentSelect.value || "") : "",
        botReviewModel: botReviewModelSelect ? String(botReviewModelSelect.value || "") : "",
        botReviewChatSession: botReviewChatSessionSelect && botReviewChatSessionSelect.value === "continue" ? "continue" : "new"
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
        sqliteJsonMirror: !settingsStorageMirrorInput || settingsStorageMirrorInput.checked !== false,
        disabledSystemFlagKeys
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
    function renderReviewDefaultsControls() {
      if (spotReviewTemplateInput) {
        spotReviewTemplateInput.value = reviewDefaults && typeof reviewDefaults.spotReviewTemplate === "string" ? reviewDefaults.spotReviewTemplate : "";
      }
      if (botReviewPromptTemplateInput) {
        botReviewPromptTemplateInput.value = reviewDefaults && typeof reviewDefaults.botReviewPromptTemplate === "string" ? reviewDefaults.botReviewPromptTemplate : "";
      }
      updateSimpleSelect(
        botReviewAgentSelect,
        agents,
        strings.placeholderSelectAgent || "Select agent",
        reviewDefaults && typeof reviewDefaults.botReviewAgent === "string" ? reviewDefaults.botReviewAgent : "agent",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return item && item.name ? item.name : "";
        }
      );
      updateSimpleSelect(
        botReviewModelSelect,
        models,
        strings.placeholderSelectModel || "Select model",
        reviewDefaults && typeof reviewDefaults.botReviewModel === "string" ? reviewDefaults.botReviewModel : "",
        function(item) {
          return item && item.id ? item.id : "";
        },
        function(item) {
          return formatModelLabel(item);
        }
      );
      if (botReviewChatSessionSelect) {
        botReviewChatSessionSelect.value = reviewDefaults && reviewDefaults.botReviewChatSession === "continue" ? "continue" : "new";
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
    function getReadyTodoDraftCandidates() {
      return getAllTodoCards().filter(function(todo) {
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
        if (activeLabelFilter) {
          return Array.isArray(todo.labels) && todo.labels.indexOf(activeLabelFilter) >= 0;
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
    renderReviewDefaultsControls();
    renderStorageSettingsControls();
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
    function getValidLabelColorValue(color, fallbackColor) {
      var value = String(color || "");
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) {
        return value;
      }
      return fallbackColor || "#4f8cff";
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
            document,
            strings,
            setTimeout,
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
      return comments.map(function(comment, commentIndex) {
        var sourceLabel = getTodoCommentSourceLabel(comment.source || "human-form");
        var sequence = typeof comment.sequence === "number" ? comment.sequence : 1;
        var displayDate = comment.updatedAt || comment.editedAt || comment.createdAt;
        var toneClass = getTodoCommentToneClass(comment);
        var userFormClass = comment.source === "human-form" && String(comment.author || "").toLowerCase() === "user" ? " is-user-form" : "";
        return '<article class="todo-comment-card' + toneClass + userFormClass + '" data-comment-index="' + escapeAttr(String(commentIndex)) + '" tabindex="0" role="button" aria-label="' + escapeAttr(strings.boardCommentOpenFull || "Open full comment") + '"><div class="todo-comment-header"><div class="todo-comment-heading"><span class="todo-comment-sequence">#' + escapeHtml(String(sequence)) + '</span><span class="todo-comment-source-chip">' + escapeHtml(sourceLabel) + '</span></div><div class="todo-comment-meta"><span class="note">' + escapeHtml(formatTodoDate(displayDate)) + '</span><button type="button" class="btn-icon todo-comment-delete-btn" data-delete-comment-index="' + escapeAttr(String(commentIndex)) + '" title="' + escapeAttr(strings.boardCommentDelete || "Delete comment") + '">&#128465;</button></div></div><div class="note todo-comment-author">' + escapeHtml(comment.author || "system") + '</div><div class="todo-comment-body">' + escapeHtml(comment.body || "") + '</div><div class="todo-comment-expand-hint">' + escapeHtml(strings.boardCommentOpenFull || "Open full comment") + "</div></article>";
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
      return !!(card && !card.archived && getTodoWorkflowFlag(card) === "final-user-check");
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
    function isTodoCompleted(card) {
      return !!(card && card.archived && card.archiveOutcome === "completed-successfully");
    }
    function renderTodoCompletionButton(card) {
      var isArchivedCard = !!(card && card.archived);
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
      if (todoCompleteBtn) {
        todoCompleteBtn.textContent = isEditingTodo ? getTodoCompletionActionLabel(selectedTodo) : strings.boardApproveTodo || "Approve";
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
      var filters2 = getTodoFilters();
      var sections = getTodoSections(filters2);
      var allSections = Array.isArray(cockpitBoard.sections) ? cockpitBoard.sections.slice().sort(function(left, right) {
        return (left.order || 0) - (right.order || 0);
      }) : [];
      var allCards = getAllTodoCards();
      var cards = getVisibleTodoCards(filters2);
      if (selectedTodoId) {
        var selectedTodo = allCards.find(function(card) {
          return card && card.id === selectedTodoId;
        });
        if (selectedTodo && selectedTodo.archived && filters2.showArchived !== true) {
          selectedTodoId = null;
        }
        if (selectedTodo && isRecurringTodoSectionId(selectedTodo.sectionId) && filters2.showRecurringTasks !== true) {
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
          var selectedTodo2 = cockpitBoard && Array.isArray(cockpitBoard.cards) ? cockpitBoard.cards.find(function(card) {
            return card && card.id === selectedTodoId;
          }) : null;
          var actionType = getTodoCompletionActionType(selectedTodo2);
          if (actionType === "finalizeTodo") {
            var finalizeConfirmed = typeof window.confirm === "function" ? window.confirm(strings.boardFinalizePrompt || "Archive this todo as completed successfully?") : true;
            if (!finalizeConfirmed) {
              return;
            }
          }
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
            syncTodoLabelEditor();
          } else {
            selectedTodoLabelName = "";
            syncTodoLabelEditor();
          }
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
          syncTodoEditorTransientDraft();
        };
        todoFlagColorInput.onchange = function() {
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
      var promptTextEl2 = document.getElementById("prompt-text");
      var scopeEl = document.querySelector('input[name="scope"]:checked');
      var promptSourceEl = document.querySelector('input[name="prompt-source"]:checked');
      var oneTimeEl = document.getElementById("one-time");
      var manualSessionEl = document.getElementById("manual-session");
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
      var manualSession = !oneTime && !!(manualSessionEl && manualSessionEl.checked);
      return {
        name: taskNameEl ? String(taskNameEl.value || "") : "",
        prompt: promptTextEl2 ? String(promptTextEl2.value || "") : "",
        cronExpression: cronExpression ? String(cronExpression.value || "") : "",
        labels: normalizeTaskLabelsValue(taskLabelsInput ? taskLabelsInput.value : ""),
        agent: agentValue,
        model: modelValue,
        scope: scopeEl ? String(scopeEl.value || "workspace") : "workspace",
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
    bindTabButtons(document, switchTab);
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
      updateFriendlyVisibility();
    });
    bindSelectValueChange(jobsFriendlyFrequency, function() {
      updateJobsFriendlyVisibility();
      syncEditorTabLabels();
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
        updateFriendlyVisibility();
      },
      "jobs-friendly-frequency": function() {
        updateJobsFriendlyVisibility();
      }
    });
    bindDocumentValueDelegates(document, "input", {
      "friendly-frequency": function() {
        updateFriendlyVisibility();
      },
      "jobs-friendly-frequency": function() {
        updateJobsFriendlyVisibility();
      }
    });
    bindClickAction(friendlyGenerate, function() {
      generateCronFromFriendly();
    });
    bindClickAction(jobsFriendlyGenerate, function() {
      generateJobsCronFromFriendly();
      syncEditorTabLabels();
    });
    bindOpenCronGuruButton(openGuruBtn, function() {
      return cronExpression ? cronExpression.value : "";
    }, window);
    bindOpenCronGuruButton(jobsOpenGuruBtn, function() {
      return jobsCronInput ? jobsCronInput.value : "";
    }, window);
    bindInlineTaskQuickUpdate(document, vscode);
    bindTemplateSelectionLoader(templateSelect, document, vscode);
    if (taskForm) {
      taskForm.addEventListener("submit", function(e) {
        e.preventDefault();
        hideGlobalError();
        var formErr = document.getElementById("form-error");
        if (formErr) {
          formErr.style.display = "none";
        }
        var runFirstEl = document.getElementById("run-first");
        var editorState = getCurrentTaskEditorState();
        var taskData = buildTaskSubmissionData({
          editorState,
          parseLabels,
          editingTaskId,
          editingTaskEnabled,
          runFirstInOneMinute: runFirstEl ? runFirstEl.checked : false
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
        pendingSubmit = true;
        if (submitBtn) submitBtn.disabled = true;
        postTaskSubmission(vscode, editingTaskId, taskData);
      });
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
      scheduleHistorySelect,
      scheduleHistory,
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
    document.addEventListener("click", function(e) {
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
    bindUtilityActionButtons(vscode, {
      setupMcp: setupMcpBtn,
      syncBundledSkills: syncBundledSkillsBtn,
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
        taskList,
        getTaskList: function() {
          taskList = document.getElementById("task-list");
          return taskList;
        },
        getClosestEventTarget,
        resolveActionTarget,
        openTodoEditor,
        actionHandlers: {
          toggle: window.toggleTask,
          run: window.runTask,
          edit: window.editTask,
          copy: window.copyPrompt,
          duplicate: window.duplicateTask,
          move: window.moveTaskToCurrentWorkspace,
          delete: window.deleteTask
        }
      })) {
        return;
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
        var manualSessionBadgeHtml = task.oneTime === true || task.manualSession !== true ? "" : '<span class="task-badge" title="' + escapeAttr(strings.labelManualSession || "Manual session") + '">' + escapeHtml(strings.labelManualSession || "Manual session") + "</span>";
        var chatSessionBadgeHtml = task.oneTime === true ? "" : '<span class="task-badge" title="' + escapeAttr(strings.labelChatSession || "Recurring chat session") + '">' + escapeHtml(
          task.chatSession === "continue" ? strings.labelChatSessionBadgeContinue || "Chat: Continue" : strings.labelChatSessionBadgeNew || "Chat: New"
        ) + "</span>";
        var labelBadgesHtml = getEffectiveLabels(task).map(function(label) {
          return '<span class="task-badge label">' + escapeHtml(label) + "</span>";
        }).join("");
        var taskIdEscaped = escapeAttr(task.id || "");
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
        var actionsHtml = buildBaseTaskActionsMarkup({
          taskId: taskIdEscaped,
          toggleTitle,
          toggleIcon,
          strings,
          escapeAttr
        });
        if (scopeValue === "workspace" && !inThisWorkspace) {
          actionsHtml += '<button class="btn-secondary btn-icon" data-action="move" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionMoveToCurrentWorkspace || "") + '">\u{1F4CC}</button>';
          if (filters.showRecurringTasks === true) {
            visibleSections.sort(function(left, right) {
              var leftRecurring = isRecurringTodoSectionId(left.id);
              var rightRecurring = isRecurringTodoSectionId(right.id);
              if (leftRecurring === rightRecurring) {
                return 0;
              }
              return leftRecurring ? -1 : 1;
            });
          }
        }
        if (scopeValue === "global" || inThisWorkspace) {
          actionsHtml += '<button class="btn-danger btn-icon" data-action="delete" data-id="' + taskIdEscaped + '" title="' + escapeAttr(strings.actionDelete) + '">\u{1F5D1}\uFE0F</button>';
        }
        return '<div class="task-card ' + (enabled ? "" : "disabled") + (scopeValue === "workspace" && !inThisWorkspace ? " other-workspace" : "") + '" data-id="' + taskIdEscaped + '"><div class="task-header"><div class="task-header-main"><span class="task-name clickable" data-action="toggle" data-id="' + taskIdEscaped + '">' + taskName + "</span>" + manualSessionBadgeHtml + chatSessionBadgeHtml + oneTimeBadgeHtml + '</div><span class="task-status ' + statusClass + '" data-action="toggle" data-id="' + taskIdEscaped + '">' + escapeHtml(statusText) + '</span></div><div class="task-info"><span>\u23F0 ' + escapeHtml(cronSummary) + "</span><span>" + escapeHtml(strings.labelNextRun) + ': <span class="task-next-run-label">' + escapeHtml(nextRun) + '</span><span class="task-next-run-countdown" data-enabled="' + (enabled ? "true" : "false") + '" data-next-run-ms="' + escapeAttr(nextRunMs > 0 ? String(nextRunMs) : "") + '"></span></span><span>' + scopeInfo + '</span></div><div class="task-info"><span>Cron: ' + cronText + "</span></div>" + (labelBadgesHtml ? '<div class="task-badges">' + labelBadgesHtml + "</div>" : "") + configRow + '<div class="task-prompt">' + escapeHtml(promptPreview) + "</div>" + (lastErrorText ? '<div class="task-prompt" style="color: var(--vscode-errorForeground);">Last error' + (lastErrorAt ? " (" + escapeHtml(lastErrorAt) + ")" : "") + ": " + escapeHtml(lastErrorText) + "</div>" : "") + '<div class="task-actions">' + actionsHtml + "</div></div>";
      }
      function renderTaskSection(sectionKey, title, items) {
        var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
        if (!listHtml) {
          listHtml = '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>";
        }
        var isCollapsed = taskSectionCollapseState[sectionKey] === true;
        return '<div class="task-section' + (isCollapsed ? " is-collapsed" : "") + '" data-task-section="' + escapeAttr(sectionKey) + '"><div class="task-section-title"><button type="button" class="task-section-toggle" data-task-section-toggle="' + escapeAttr(sectionKey) + '" aria-expanded="' + (isCollapsed ? "false" : "true") + '" title="' + escapeAttr(isCollapsed ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section") + '">&#9660;</button><span>' + escapeHtml(title) + "</span><span>" + String(items.length) + '</span></div><div class="task-section-body"><div class="task-section-body-inner">' + listHtml + "</div></div></div>";
      }
      function renderTaskSectionContent(sectionKey, title, contentHtml, itemCount) {
        var isCollapsed = taskSectionCollapseState[sectionKey] === true;
        return '<div class="task-section' + (isCollapsed ? " is-collapsed" : "") + '" data-task-section="' + escapeAttr(sectionKey) + '"><div class="task-section-title"><button type="button" class="task-section-toggle" data-task-section-toggle="' + escapeAttr(sectionKey) + '" aria-expanded="' + (isCollapsed ? "false" : "true") + '" title="' + escapeAttr(isCollapsed ? strings.boardSectionExpand || "Expand section" : strings.boardSectionCollapse || "Collapse section") + '">&#9660;</button><span>' + escapeHtml(title) + '</span><span class="task-section-count">' + String(itemCount) + '</span></div><div class="task-section-body"><div class="task-section-body-inner">' + contentHtml + "</div></div></div>";
      }
      function renderTaskSubsection(title, items) {
        var listHtml = items.map(renderTaskCard).filter(Boolean).join("");
        if (!listHtml) {
          listHtml = '<div class="empty-state">' + escapeHtml(strings.noTasksFound) + "</div>";
        }
        return '<div class="task-subsection"><div class="task-subsection-title"><span class="task-subsection-name">' + escapeHtml(title) + '</span><span class="task-subsection-count">' + String(items.length) + '</span></div><div class="task-subsection-body">' + listHtml + "</div></div>";
      }
      function isTodoTaskDraft2(task) {
        return !!(task && Array.isArray(task.labels) && task.labels.some(function(label) {
          return normalizeTodoLabelKey(label) === "from-todo-cockpit";
        }));
      }
      function isJobTask(task) {
        return !!(task && task.jobId);
      }
      function renderReadyTodoDraftCandidateCard(todo) {
        if (!todo) {
          return "";
        }
        var title = escapeHtml(todo.title || "Untitled Todo");
        var description = escapeHtml(getTodoDescriptionPreview(todo.description || ""));
        var priority = escapeHtml(getTodoPriorityLabel(todo.priority || "none"));
        var dueText = todo.dueAt ? "<span>" + escapeHtml(strings.boardDueLabel || "Due") + ": " + escapeHtml(formatTodoDate(todo.dueAt)) + "</span>" : "";
        var labelBadgesHtml = Array.isArray(todo.labels) ? todo.labels.slice(0, 6).map(function(label) {
          return '<span class="task-badge label">' + escapeHtml(label) + "</span>";
        }).join("") : "";
        return '<div class="task-card todo-draft-candidate" data-ready-todo-id="' + escapeAttr(todo.id || "") + '"><div class="task-header"><div class="task-header-main"><span class="task-name">' + title + '</span><span class="task-badge">Ready Todo</span></div><span class="task-status enabled">' + escapeHtml(strings.boardFlagPresetReady || "Ready") + '</span></div><div class="task-info"><span>' + escapeHtml(strings.boardWorkflowLabel || "Workflow") + ": " + escapeHtml(strings.boardFlagPresetReady || "Ready") + "</span><span>Priority: " + priority + "</span>" + dueText + "</div>" + (labelBadgesHtml ? '<div class="task-badges">' + labelBadgesHtml + "</div>" : "") + '<div class="task-prompt">' + description + '</div><div class="task-actions"><button class="btn-secondary" data-ready-todo-open="' + escapeAttr(todo.id || "") + '">Open Todo</button><button class="btn-primary" data-ready-todo-create="' + escapeAttr(todo.id || "") + '">Create Draft</button></div></div>';
      }
      var manualSessionTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = task.oneTime === true || task.id && task.id.indexOf("exec-") === 0;
        return !isOneTime && !isJobTask(task) && task.manualSession === true;
      });
      var jobTasks = taskItems.filter(function(task) {
        return !!task && isJobTask(task);
      });
      var recurringTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = task.oneTime === true || task.id && task.id.indexOf("exec-") === 0;
        return !isOneTime && !isJobTask(task) && task.manualSession !== true;
      });
      var todoDraftTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = task.oneTime === true || task.id && task.id.indexOf("exec-") === 0;
        return isOneTime && !isJobTask(task) && isTodoTaskDraft2(task);
      });
      var readyTodoDraftCandidates = getReadyTodoDraftCandidates();
      var oneTimeTasks = taskItems.filter(function(task) {
        if (!task) return false;
        var isOneTime = task.oneTime === true || task.id && task.id.indexOf("exec-") === 0;
        return isOneTime && !isJobTask(task) && !isTodoTaskDraft2(task);
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
        var existingTodoDraftsHtml = todoDraftTasks.map(renderTaskCard).filter(Boolean).join("");
        var todoDraftSectionHtml = readyTodoNoticeHtml + readyTodoCardsHtml + existingTodoDraftsHtml;
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
      renderedTasks = '<div class="' + containerClass + '"' + containerStyle + ">" + sectionHtml + "</div>";
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
    function getCronSummary(expression) {
      return summarizeCronExpression(expression, strings);
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
    function generateCronFromFriendly() {
      if (!friendlyFrequency || !cronExpression) return;
      var expr = buildFriendlyCronExpression(friendlyFrequency.value, {
        interval: friendlyInterval ? friendlyInterval.value : "",
        minute: friendlyMinute ? friendlyMinute.value : "",
        hour: friendlyHour ? friendlyHour.value : "",
        dow: friendlyDow ? friendlyDow.value : "",
        dom: friendlyDom ? friendlyDom.value : ""
      });
      if (expr) {
        cronExpression.value = expr;
        if (cronPreset) cronPreset.value = "";
        updateCronPreview();
      }
    }
    function generateJobsCronFromFriendly() {
      if (!jobsFriendlyFrequency || !jobsCronInput) return;
      var expr = buildFriendlyCronExpression(jobsFriendlyFrequency.value, {
        interval: jobsFriendlyInterval ? jobsFriendlyInterval.value : "",
        minute: jobsFriendlyMinute ? jobsFriendlyMinute.value : "",
        hour: jobsFriendlyHour ? jobsFriendlyHour.value : "",
        dow: jobsFriendlyDow ? jobsFriendlyDow.value : "",
        dom: jobsFriendlyDom ? jobsFriendlyDom.value : ""
      });
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
      var manualSessionEl = document.getElementById("manual-session");
      if (manualSessionEl) manualSessionEl.checked = false;
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
            "[CopilotScheduler] Template select group missing; template selection is disabled."
          );
        }
      });
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
      var promptTextEl2 = document.getElementById("prompt-text");
      if (taskNameEl) taskNameEl.value = task.name || "";
      if (taskLabelsInput) taskLabelsInput.value = toLabelString(task.labels);
      if (promptTextEl2)
        promptTextEl2.value = typeof task.prompt === "string" ? task.prompt : "";
      if (cronExpression) cronExpression.value = task.cronExpression || "";
      if (cronPreset) cronPreset.value = "";
      updateCronPreview();
      pendingAgentValue = task.agent || "";
      pendingModelValue = task.model || "";
      if (agentSelect) {
        if (pendingAgentValue && !selectHasOptionValue(agentSelect, pendingAgentValue)) {
          agentSelect.value = "";
        } else {
          pendingAgentValue = restorePendingSelectValue(
            agentSelect,
            pendingAgentValue
          );
        }
      }
      if (modelSelect) {
        if (pendingModelValue && !selectHasOptionValue(modelSelect, pendingModelValue)) {
          modelSelect.value = "";
        } else {
          pendingModelValue = restorePendingSelectValue(
            modelSelect,
            pendingModelValue
          );
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
        if (pendingTemplatePath && !selectHasOptionValue(templateSelect, pendingTemplatePath)) {
          templateSelect.value = "";
        } else {
          pendingTemplatePath = restorePendingSelectValue(
            templateSelect,
            pendingTemplatePath
          );
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
      var manualSessionEl = document.getElementById("manual-session");
      if (manualSessionEl) manualSessionEl.checked = task.oneTime === true ? false : task.manualSession === true;
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
              spotReviewTemplate: "",
              botReviewPromptTemplate: "",
              botReviewAgent: "agent",
              botReviewModel: "",
              botReviewChatSession: "new"
            };
            renderReviewDefaultsControls();
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
              renderReviewDefaultsControls();
              syncJobsStepSelectors();
              syncResearchSelectors();
              if (agentSelect && currentAgentValue) {
                pendingAgentValue = restorePendingSelectValue(
                  agentSelect,
                  currentAgentValue
                );
              }
              renderTaskList(tasks);
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
              renderReviewDefaultsControls();
              syncJobsStepSelectors();
              syncResearchSelectors();
              if (modelSelect && currentModelValue) {
                pendingModelValue = restorePendingSelectValue(
                  modelSelect,
                  currentModelValue
                );
              }
              renderTaskList(tasks);
            }
            break;
          case "updatePromptTemplates":
            promptTemplates = Array.isArray(message.templates) ? message.templates : [];
            {
              var sourceElement = document.querySelector(
                'input[name="prompt-source"]:checked'
              );
              var currentSource = sourceElement ? sourceElement.value : "inline";
              pendingTemplatePath = syncPromptTemplatesFromMessage({
                promptTemplates,
                pendingTemplatePath,
                templateSelect,
                templateSelectGroup,
                currentSource,
                strings,
                escapeHtml,
                escapeAttr
              });
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
            var promptTextEl2 = document.getElementById("prompt-text");
            if (promptTextEl2) promptTextEl2.value = message.content;
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
          case "focusResearchProfile":
            switchTab("research");
            if (message.researchId) {
              selectResearchProfile(message.researchId);
            } else {
              isCreatingResearchProfile = true;
              selectedResearchId = "";
              resetResearchForm(null);
              renderResearchTab();
            }
            setTimeout(function() {
              var selector = message.researchId ? '[data-research-id="' + message.researchId + '"]' : "#research-name";
              var element = document.querySelector(selector);
              if (!element) {
                return;
              }
              if (typeof element.scrollIntoView === "function") {
                element.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
              if (!message.researchId && typeof element.focus === "function") {
                element.focus();
              }
            }, 50);
            break;
          case "focusResearchRun":
            switchTab("research");
            if (message.runId) {
              selectResearchRun(message.runId);
            }
            setTimeout(function() {
              var runCard = message.runId ? document.querySelector('[data-run-id="' + message.runId + '"]') : null;
              if (runCard && typeof runCard.scrollIntoView === "function") {
                runCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
=======
"use strict";(()=>{function ji(o){var r=o&&o.target?o.target:o;return r&&r.nodeType===3&&(r=r.parentElement),r||null}function H(o,r){var s=ji(o);return s&&s.closest?s.closest(r):null}function Jd(o){return!!H(o,["input","button","select","textarea","a","label",'[role="button"]','[contenteditable="true"]',"[data-no-drag]","[data-todo-edit]","[data-todo-delete]","[data-todo-delete-cancel]","[data-todo-delete-reject]","[data-todo-delete-permanent]","[data-todo-purge]","[data-todo-restore]","[data-todo-complete]","[data-section-collapse]","[data-section-rename]","[data-section-delete]"].join(", "))}function zd(o,r,s){var u=o&&typeof o.setTimeout=="function"?o.setTimeout:typeof setTimeout=="function"?setTimeout:null;return u?u.call(null,r,s):(r(),null)}function Vd(o,r){var s=o.getAttribute("data-section-collapse");r.toggleSectionCollapsed(s);var u=o.closest?o.closest("[data-section-id]"):null,f=u?u.querySelector(".section-body-wrapper"):null,h=r.collapsedSections.has(s);o.classList.toggle("collapsed",h),o.setAttribute("aria-expanded",h?"false":"true"),o.title=h?"Expand section":"Collapse section",f&&f.classList.toggle("collapsed",h),u&&u.classList.toggle("is-collapsed",h)}function Wd(o,r){var s=o.getAttribute("data-section-rename"),u=o.closest?o.closest("[data-section-id]"):null,f=u?u.querySelector(".cockpit-section-header"):null,h=f?f.querySelector("strong"):null;if(h){var O=h.textContent||"",E=r.document.createElement("input");E.type="text",E.value=O,E.style.cssText="font-weight:600;font-size:inherit;width:110px;max-width:100%;border:1px solid var(--vscode-focusBorder);background:var(--vscode-input-background);color:var(--vscode-input-foreground);border-radius:3px;padding:1px 4px;";var j=!1,F=function(){if(!j){j=!0;var T=E.value.trim();T&&T!==O?r.vscode.postMessage({type:"renameCockpitSection",sectionId:s,title:T}):(h.style.display="",E.parentNode&&E.parentNode.removeChild(E))}};E.onkeydown=function(T){T.key==="Enter"&&(T.preventDefault(),F()),T.key==="Escape"&&(j=!0,h.style.display="",E.parentNode&&E.parentNode.removeChild(E))},E.onblur=function(){zd(r,F,120)},h.style.display="none",h.parentNode.insertBefore(E,h),E.select()}}function Ud(o,r){var s=o.getAttribute("data-section-delete");if(o.getAttribute("data-confirming")){r.vscode.postMessage({type:"deleteCockpitSection",sectionId:s}),o.removeAttribute("data-confirming");return}o.setAttribute("data-confirming","1");var u=o.textContent,f=o.style.color;o.textContent=r.strings.boardDeleteConfirm||"Delete?",o.style.color="var(--vscode-errorForeground)",o.style.opacity="1",zd(r,function(){o.getAttribute("data-confirming")&&(o.removeAttribute("data-confirming"),o.textContent=u,o.style.color=f,o.style.opacity="")},2500)}function _d(o,r){var s=o.getAttribute("data-todo-complete"),u=o.closest?o.closest("[data-todo-id]"):null,f=r.cockpitBoard,h=null;if(f&&Array.isArray(f.cards)){for(var O=0;O<f.cards.length;O++)if(f.cards[O]&&f.cards[O].id===s){h=f.cards[O];break}}var E="";h&&Array.isArray(h.flags)&&h.flags.forEach(function(A){var R=String(A||"").trim().toLowerCase();R==="go"&&(R="ready"),["new","needs-bot-review","needs-user-review","ready","on-schedule-list","final-user-check"].indexOf(R)>=0&&(E=R)});var j=E==="final-user-check";function F(){o.removeAttribute("data-confirming"),o.classList.remove("is-confirming"),o.setAttribute("data-finalize-state","idle"),o.hasAttribute("data-original-title")&&(o.setAttribute("title",o.getAttribute("data-original-title")||""),o.setAttribute("aria-label",o.getAttribute("data-original-title")||""),o.removeAttribute("data-original-title")),o.hasAttribute("data-original-html")&&(o.innerHTML=o.getAttribute("data-original-html")||"",o.removeAttribute("data-original-html"));var A=u&&u.querySelector?u.querySelector('[data-todo-finalize-cancel="'+s+'"]'):null;A&&A.parentNode&&A.parentNode.removeChild(A)}if(s){if(!j){o.disabled=!0,u&&(u.style.opacity="0.35",u.style.pointerEvents="none"),r.vscode.postMessage({type:"approveTodo",todoId:s});return}if(!o.getAttribute("data-confirming")){o.setAttribute("data-confirming","1"),o.classList.add("is-confirming"),o.setAttribute("data-finalize-state","confirming"),o.setAttribute("data-original-title",o.getAttribute("title")||""),o.setAttribute("data-original-html",o.innerHTML||""),o.setAttribute("title",r.strings.boardFinalizePrompt||"Archive this todo as completed successfully?"),o.setAttribute("aria-label",r.strings.boardFinalizeTodoYes||"Yes"),o.innerHTML='<span aria-hidden="true">'+(r.strings.boardFinalizeTodoYes||"Yes")+"</span>";var T=r.document.createElement("button");T.type="button",T.className="todo-complete-button is-cancel",T.setAttribute("data-todo-finalize-cancel",s),T.setAttribute("data-no-drag","1"),T.setAttribute("title",r.strings.boardFinalizeTodoNo||"No"),T.setAttribute("aria-label",r.strings.boardFinalizeTodoNo||"No"),T.textContent=r.strings.boardFinalizeTodoNo||"No",T.onclick=function(A){Ee(A),F()},o.parentNode&&o.parentNode.insertBefore(T,o.nextSibling);return}F(),o.disabled=!0,u&&(u.style.opacity="0.35",u.style.pointerEvents="none"),r.vscode.postMessage({type:"finalizeTodo",todoId:s})}}function Ee(o){o&&(typeof o.preventDefault=="function"&&o.preventDefault(),typeof o.stopPropagation=="function"&&o.stopPropagation())}var _a=null,Pd=!1,ne=null,en=!1,Rd=6;function tn(o,r,s){var u=o&&o.document,f=u&&u.body;!f||!f.classList||(f.classList.toggle("cockpit-board-dragging",!!r),f.classList.toggle("cockpit-board-dragging-section",!!r&&s==="section"),f.classList.toggle("cockpit-board-dragging-todo",!!r&&s==="todo"),f.style&&(f.style.userSelect=r?"none":"",f.style.webkitUserSelect=r?"none":"",f.style.cursor=r?"grabbing":""))}function xi(){en=!0}function gf(o){return en?(en=!1,Ee(o),!0):!1}function bf(o,r){if(!o||!r||typeof o.clientX!="number"||typeof o.clientY!="number")return!0;var s=o.clientX-r.startX,u=o.clientY-r.startY;return s*s+u*u>=Rd*Rd}function Li(o){var r=ne;if(!(!o||!r||r.activated)){if(r.activated=!0,o.setIsBoardDragging(!0),tn(o,!0,r.kind),r.kind==="section"){o.setDraggingSectionId(r.draggedId),o.setLastDragOverSectionId(null),r.draggedElement&&r.draggedElement.classList.add("section-dragging");return}o.setDraggingTodoId(r.draggedId),r.draggedElement&&r.draggedElement.classList.add("todo-dragging")}}function an(o){return o?typeof o.getBoardColumns=="function"?o.getBoardColumns():o.boardColumns||null:null}function yf(o){return!o||typeof o.querySelectorAll!="function"?[]:o.querySelectorAll(".board-column[data-section-id], .todo-list-section[data-section-id]")}function Co(o){return ji(o)}function Yd(o,r){var s=an(o),u=Co(r);return!!(s&&u&&typeof s.contains=="function"&&s.contains(u))}function Ua(o){!o||typeof o.querySelectorAll!="function"||(Array.prototype.forEach.call(o.querySelectorAll("[data-section-id].section-drag-over"),function(r){r.classList.remove("section-drag-over")}),Array.prototype.forEach.call(o.querySelectorAll("[data-section-id].section-dragging"),function(r){r.classList.remove("section-dragging")}),Array.prototype.forEach.call(o.querySelectorAll("[data-todo-id].todo-dragging"),function(r){r.classList.remove("todo-dragging")}),Array.prototype.forEach.call(o.querySelectorAll("[data-todo-id].todo-drop-target"),function(r){r.classList.remove("todo-drop-target")}))}function Kd(o,r){var s=o&&o.document;if(s&&typeof s.elementFromPoint=="function"&&r&&typeof r.clientX=="number"&&typeof r.clientY=="number"){var u=s.elementFromPoint(r.clientX,r.clientY);if(u)return u}return Co(r)}function hf(o,r,s){var u=H(s,"[data-section-id]");if(Ua(r),!u){o.setLastDragOverSectionId(null),ne&&ne.draggedElement&&ne.draggedElement.classList.add("section-dragging");return}var f=u.getAttribute("data-section-id"),h=o.getDraggingSectionId();if(!f||f===h||o.isArchiveTodoSectionId(f)){o.setLastDragOverSectionId(null),ne&&ne.draggedElement&&ne.draggedElement.classList.add("section-dragging");return}u.classList.add("section-drag-over"),ne&&ne.draggedElement&&ne.draggedElement.classList.add("section-dragging"),o.setLastDragOverSectionId(f)}function Sf(o,r,s){var u=H(s,"[data-section-id]"),f=H(s,"[data-todo-id]");if(Ua(r),ne&&ne.draggedElement&&ne.draggedElement.classList.add("todo-dragging"),!!u){var h=u.getAttribute("data-section-id");if(!(!h||o.isArchiveTodoSectionId(h))){if(f&&f.getAttribute("data-todo-id")!==o.getDraggingTodoId()){f.classList.add("todo-drop-target");return}u.classList.add("section-drag-over")}}}function kf(o){var r=_a;if(!(!r||!ne)){if(!ne.activated){if(!bf(o,ne))return;Li(r),xi()}Ee(o);var s=an(r);if(!s){tn(r,!1),r.finishBoardDragState(),ne=null;return}var u=Kd(r,o);if(ne.kind==="section"){hf(r,s,u);return}Sf(r,s,u)}}function Nd(o,r){var s=_a,u=ne;if(!s||!u){ne=null;return}if(!u.activated){tn(s,!1),ne=null;return}var f=an(s),h=r?null:Kd(s,o);if(f&&Ua(f),!r&&f&&u.kind==="section"){var O=H(h,"[data-section-id]"),E=O?O.getAttribute("data-section-id"):null;if((!E||E===s.getDraggingSectionId())&&(E=s.getLastDragOverSectionId()),E&&E!==s.getDraggingSectionId()){for(var j=yf(f),F=-1,T=0;T<j.length;T+=1)if(j[T].getAttribute("data-section-id")===E){F=T;break}F>=0&&s.vscode.postMessage({type:"reorderCockpitSection",sectionId:s.getDraggingSectionId(),targetIndex:F})}}if(!r&&f&&u.kind==="todo"){var A=H(h,"[data-section-id]"),R=H(h,"[data-todo-id]");if(A&&s.getDraggingTodoId()&&!s.isArchiveTodoSectionId(A.getAttribute("data-section-id"))){var F=Number(R?R.getAttribute("data-order")||0:A.getAttribute("data-card-count")||0);s.vscode.postMessage({type:"moveTodo",todoId:s.getDraggingTodoId(),sectionId:A.getAttribute("data-section-id"),targetIndex:F})}}tn(s,!1),s.finishBoardDragState(),ne=null,typeof setTimeout=="function"&&setTimeout(function(){en=!1},350)}function Af(o,r){var s=_a;if(s){var u=Co(r);!o||!u||!Yd(s,u)||(r&&typeof r.stopPropagation=="function"&&r.stopPropagation(),s.handleTodoCompletion(o))}}function Od(o,r,s){!o||typeof o.addEventListener!="function"||o.addEventListener(r,s)}var Hd=!1;function Tf(o){Hd||!o||typeof o.addEventListener!="function"||(Hd=!0,o.addEventListener("click",function(r){var s=_a;if(s){var u=ji(r);if(!(!u||typeof u.closest!="function")){var f=u.closest("[data-todo-edit]");if(f){Ee(r),s.openTodoEditor(f.getAttribute("data-todo-edit")||"");return}var h=u.closest("[data-todo-delete]");if(h){Ee(r),s.setPendingBoardDelete(h.getAttribute("data-todo-delete")||"",!1);return}var O=u.closest("[data-todo-delete-cancel]");if(O){Ee(r),s.clearPendingBoardDelete();return}var E=u.closest("[data-todo-delete-reject]");if(E){Ee(r),s.submitBoardDeleteChoice("reject");return}var j=u.closest("[data-todo-delete-permanent]");if(j){Ee(r),s.submitBoardDeleteChoice("permanent");return}var F=u.closest("[data-todo-purge]");if(F){Ee(r),s.setPendingBoardDelete(F.getAttribute("data-todo-purge")||"",!0);return}var T=u.closest("[data-todo-restore]");if(T){Ee(r),s.handleTodoRestore(T);return}var A=u.closest("[data-todo-complete]");if(A){Af(A,r);return}var R=u.closest("[data-section-collapse]");if(R){Ee(r),s.handleSectionCollapse(R);return}var ae=u.closest(".cockpit-section-header");if(ae&&!u.closest("[data-section-drag-handle]")&&!u.closest("[data-section-rename]")&&!u.closest("[data-section-delete]")){var oe=ae.querySelector("[data-section-collapse]");if(oe){Ee(r),s.handleSectionCollapse(oe);return}}var le=u.closest("[data-section-rename]");if(le){Ee(r),s.handleSectionRename(le);return}var _e=u.closest("[data-section-delete]");if(_e){Ee(r),s.handleSectionDelete(_e);return}var ze=u.closest("[data-todo-id]");if(ze){if(gf(r)||Jd(u))return;s.setSelectedTodoId(ze.getAttribute("data-todo-id")),s.renderCockpitBoard()}}}}))}function Ef(o,r){!o||typeof o.querySelectorAll!="function"||(Array.prototype.forEach.call(o.querySelectorAll("[data-section-drag-handle]"),function(s){Od(s,"pointerdown",qd)}),Array.prototype.forEach.call(o.querySelectorAll("[data-todo-id]"),function(s){Od(s,"pointerdown",qd)}))}function qd(o){var r=_a;if(r&&(en=!1,!(typeof o.button=="number"&&o.button!==0))){var s=Co(o);if(Yd(r,s)){var u=H(s,"[data-section-drag-handle]"),f=H(s,"[data-todo-drag-handle]"),h=an(r);if(h){var O=u&&u.closest?u.closest("[data-section-id]"):null,j=u?u.getAttribute("data-section-drag-handle"):"";if(u){Ee(o),Ua(h),ne={kind:"section",draggedId:j,draggedElement:O,activated:!1,startX:typeof o.clientX=="number"?o.clientX:0,startY:typeof o.clientY=="number"?o.clientY:0},Li(r),xi();return}var E=f&&f.closest?f.closest("[data-todo-id]"):H(s,"[data-todo-id]");if(E){var j=E.getAttribute?E.getAttribute("data-section-id"):"";!f&&(Jd(s)||r.isArchiveTodoSectionId(j||""))||(Ua(h),ne={kind:"todo",draggedId:f?f.getAttribute("data-todo-drag-handle")||E.getAttribute("data-todo-id"):E.getAttribute("data-todo-id")||"",draggedElement:E,activated:!1,startX:typeof o.clientX=="number"?o.clientX:0,startY:typeof o.clientY=="number"?o.clientY:0},f&&(Ee(o),Li(r),xi()))}}}}}function If(o){if(!Pd){var r=o.window;!r||typeof r.addEventListener!="function"||(r.addEventListener("pointermove",kf,!0),r.addEventListener("pointerup",function(s){Nd(s,!1)},!0),r.addEventListener("pointercancel",function(s){Nd(s,!0)},!0),Pd=!0)}}function Xd(o){var r=an(o);r&&(_a=o,tn(o,!1),Ua(r),Tf(r),Ef(r,o),If(o))}function $d(o){var r=o&&typeof o.initialLogLevel=="string"?o.initialLogLevel:"info";function s(){return r==="debug"}function u(T){if(typeof T>"u")return{};try{return JSON.parse(JSON.stringify(T))}catch{return{value:String(T)}}}function f(T,A){if(s()){var R={event:T,detail:u(A)};try{o&&o.console&&typeof o.console.log=="function"&&o.console.log("[SchedulerWebviewDebug]",R)}catch{}try{o&&o.vscode&&typeof o.vscode.postMessage=="function"&&o.vscode.postMessage({type:"debugWebview",event:T,detail:R.detail})}catch{}}}function h(){return{comment:"",title:"",description:"",dueAt:"",flagColor:"#f59e0b",flagInput:"",priority:"none",flag:"",labelColor:"#4f8cff",labelInput:"",sectionId:"",taskId:""}}function O(T){var A=h();return f("todoDraftReset",{reason:T||"unknown"}),A}function E(T){if(!T||T.selectedTodoId)return T?T.currentTodoDraft:h();var A=T.currentTodoDraft||h();return A.comment=T.todoCommentInput?String(T.todoCommentInput.value||""):"",A.title=T.todoTitleInput?String(T.todoTitleInput.value||""):"",A.description=T.todoDescriptionInput?String(T.todoDescriptionInput.value||""):"",A.dueAt=T.todoDueInput?String(T.todoDueInput.value||""):"",A.priority=T.todoPriorityInput?String(T.todoPriorityInput.value||"none"):"none",A.sectionId=T.todoSectionInput?String(T.todoSectionInput.value||""):"",A.taskId=T.todoLinkedTaskSelect?String(T.todoLinkedTaskSelect.value||""):"",T.reason&&f("todoDraftSync",{reason:T.reason,hasComment:A.comment.length>0,titleLength:A.title.length,hasDescription:A.description.length>0,hasDueAt:!!A.dueAt,sectionId:A.sectionId,taskId:A.taskId}),A}function j(T){r=typeof T=="string"&&T?T:"info"}function F(){return r}return{createEmptyTodoDraft:h,emitWebviewDebug:f,getLogLevel:F,resetTodoDraft:O,setLogLevel:j,syncTodoDraftFromInputs:E}}function Gd(o){var r=o.visibleSections,s=o.cards,u=o.filters,f=o.strings;return u.viewMode==="list"?Bf(r,s,u,o):xf(r,s,u,o)}function wf(o){return Array.isArray(o.comments)&&o.comments.length?o.comments[o.comments.length-1]:null}function Zd(o,r,s){var u=r.strings,f=r.helpers,h=r.pendingBoardDeleteTodoId===o.id,O=!!(o.archived||h&&r.pendingBoardDeletePermanentOnly),E=s==="board"?"todo-card-action-row":"todo-list-actions";function j(R,ae,oe,le){return'<button type="button" class="'+R+' todo-list-action-btn todo-card-icon-btn" '+ae+'="'+f.escapeAttr(o.id)+'" title="'+f.escapeAttr(oe)+'" aria-label="'+f.escapeAttr(oe)+'">'+le+"</button>"}function F(R,ae,oe){return'<button type="button" class="'+R+' todo-list-action-btn" '+ae+'="'+f.escapeAttr(o.id)+'" title="'+f.escapeAttr(oe)+'" aria-label="'+f.escapeAttr(oe)+'">'+f.escapeHtml(oe)+"</button>"}if(h){var T=[F("btn-secondary todo-card-delete-cancel","data-todo-delete-cancel",u.boardDeleteTodoCancel||"Cancel")];return O||T.push(F("btn-secondary todo-card-delete-reject","data-todo-delete-reject",u.boardDeleteTodoReject||"Archive as Rejected")),T.push(F("btn-danger todo-card-delete-permanent","data-todo-delete-permanent",u.boardDeleteTodoPermanent||"Delete Permanently")),'<div class="'+E+'">'+T.join("")+"</div>"}var A=[j("btn-secondary todo-card-edit","data-todo-edit",u.boardEditTodo||"Open Editor","&#9998;")];return o.archived?(A.push(j("btn-secondary todo-card-restore","data-todo-restore",u.boardRestoreTodo||"Restore","&#8634;")),A.push(j("btn-danger todo-card-purge","data-todo-purge",u.boardDeleteTodoPermanent||"Delete Permanently","&#128465;"))):A.push(j("btn-secondary todo-card-delete","data-todo-delete",u.boardDeleteTodo||"Delete Todo","&#128465;")),'<div class="'+E+(A.length===1?" has-single-action":"")+'">'+A.join("")+"</div>"}function Cf(o,r,s){var u=s.strings,f=s.helpers,h=s.selectedTodoId,O=o.id===h,E=wf(o),j=o.description?f.getTodoDescriptionPreview(o.description):o.taskId?u.boardTaskLinked||"Linked task":u.boardDescriptionPreviewEmpty||"No description yet.",F=E&&E.body?"#"+String(E.sequence||1)+" \u2022 "+f.getTodoCommentSourceLabel(E.source||"human-form")+" \u2022 "+f.getTodoDescriptionPreview(E.body):u.boardCommentsEmpty||"No comments yet.",T=Array.isArray(o.flags)?o.flags.slice(0,6):[],A=["<span data-card-meta>"+f.escapeHtml(f.getTodoPriorityLabel(o.priority||"none"))+"</span>","<span data-card-meta>"+f.escapeHtml(f.getTodoStatusLabel(o.status||"active"))+"</span>"];o.dueAt&&A.push("<span data-card-meta>"+f.escapeHtml((u.boardDueLabel||"Due")+": "+f.formatTodoDate(o.dueAt))+"</span>"),o.archived&&o.archiveOutcome&&A.push("<span data-card-meta>"+f.escapeHtml(f.getTodoArchiveOutcomeLabel(o.archiveOutcome))+"</span>");var R=Array.isArray(o.labels)?o.labels.slice(0,6):[],ae=T.length||R.length?'<div class="todo-list-chip-row">'+(T.length?'<div class="card-flags">'+T.map(function(oe,le){return'<span data-flag-slot="'+le+'">'+f.renderFlagChip(oe,!1)+"</span>"}).join("")+"</div>":"")+(R.length?'<div class="card-labels">'+R.map(function(oe,le){return'<span data-label-slot="'+le+'">'+f.renderLabelChip(oe,!1,!1)+"</span>"}).join("")+"</div>":"")+"</div>":"";return'<article class="todo-list-row" draggable="false" data-todo-id="'+f.escapeAttr(o.id)+'" data-section-id="'+f.escapeAttr(r)+'" data-order="'+String(o.order||0)+'" data-selected="'+(O?"true":"false")+'" style="border-radius:8px;background:'+f.getTodoPriorityCardBg(o.priority||"none",!1)+';border:1px solid var(--vscode-widget-border);padding:var(--cockpit-card-pad, 8px);cursor:pointer;"><div class="todo-list-main"><div class="todo-list-title-line"><div class="todo-list-title-block">'+f.renderTodoCompletionCheckbox(o)+'<strong class="todo-list-title">'+f.escapeHtml(o.title||u.boardCardUntitled||"Untitled")+'</strong></div><div class="todo-list-meta-trail">'+f.renderTodoDragHandle(o)+A.join("")+"</div></div>"+ae+'<div class="cockpit-card-details todo-list-card-details"><div class="note todo-list-detail-line todo-list-detail-line-description"><strong data-card-meta>'+f.escapeHtml(u.boardDescriptionLabel||"Description")+':</strong><span class="todo-list-summary">'+f.escapeHtml(j)+'</span></div><div class="note todo-list-detail-line todo-list-detail-line-comment"><strong data-card-meta>'+f.escapeHtml(u.boardLatestComment||"Latest comment")+':</strong><span class="todo-list-summary">'+f.escapeHtml(F)+"</span></div></div></div>"+Zd(o,s,"list")+"</article>"}function Bf(o,r,s,u){var f=u.strings,h=u.helpers,O=u.collapsedSections;return'<div class="todo-list-view">'+o.map(function(E){var j=h.sortTodoCards(r.filter(function(R){return R.sectionId===E.id&&h.cardMatchesTodoFilters(R,s)}),s),F=O.has(E.id),T=h.isSpecialTodoSectionId(E.id),A=h.escapeHtml(E.title||f.boardSectionUntitled||"Section");return'<section class="todo-list-section'+(F?" is-collapsed":"")+'" data-section-id="'+h.escapeAttr(E.id)+'" data-card-count="'+String(j.length)+'"><div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px);"><button type="button" class="cockpit-collapse-btn'+(F?" collapsed":"")+'" data-section-collapse="'+h.escapeAttr(E.id)+'" aria-expanded="'+(F?"false":"true")+'" title="'+h.escapeAttr(F?f.boardSectionExpand||"Expand section":f.boardSectionCollapse||"Collapse section")+'">&#9660;</button>'+h.renderSectionDragHandle(E,T)+'<div class="cockpit-section-title-group"><strong class="cockpit-section-title">'+A+'</strong></div><span class="note cockpit-section-count">('+String(j.length)+")</span>"+(T?"":'<div class="cockpit-section-actions"><button type="button" class="btn-icon" data-section-rename="'+h.escapeAttr(E.id)+'" title="'+h.escapeAttr(f.boardSectionRename||"Rename section")+'">&#9998;</button><button type="button" class="btn-icon" data-section-delete="'+h.escapeAttr(E.id)+'" title="'+h.escapeAttr(f.boardSectionDelete||"Delete section")+'">&#215;</button></div>')+'</div><div class="section-body-wrapper'+(F?" collapsed":"")+'"><div class="section-body-inner"><div class="todo-list-items">'+(j.length?j.map(function(R){return Cf(R,E.id,u)}).join(""):'<div class="note">'+h.escapeHtml(f.boardListEmptySection||f.boardEmpty||"No todos in this section.")+"</div>")+"</div></div></div></section>"}).join("")+"</div>"}function xf(o,r,s,u){var f=u.strings,h=u.helpers,O=u.collapsedSections,E=u.selectedTodoId;return'<div style="display:flex;gap:16px;align-items:flex-start;min-width:max-content;">'+o.map(function(j){var F=h.sortTodoCards(r.filter(function(A){return A.sectionId===j.id&&h.cardMatchesTodoFilters(A,s)}),s),T=h.isSpecialTodoSectionId(j.id);return'<section class="board-column'+(O.has(j.id)?" is-collapsed":"")+'" data-section-id="'+h.escapeAttr(j.id)+'" data-card-count="'+String(F.length)+'" style="display:flex;flex-direction:column;border-radius:10px;background:var(--vscode-editorWidget-background);border:1px solid var(--vscode-panel-border);width:var(--cockpit-col-width,240px);min-width:var(--cockpit-col-width,240px);overflow:visible;"><div class="cockpit-section-header" draggable="false" style="padding:var(--cockpit-card-pad,9px)"><button type="button" class="cockpit-collapse-btn'+(O.has(j.id)?" collapsed":"")+'" data-section-collapse="'+h.escapeAttr(j.id)+'" title="'+h.escapeAttr(O.has(j.id)?f.boardSectionExpand||"Expand section":f.boardSectionCollapse||"Collapse section")+'">&#9660;</button>'+h.renderSectionDragHandle(j,T)+'<strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">'+h.escapeHtml(j.title||f.boardSectionUntitled||"Section")+"</strong>"+(T?"":'<div class="cockpit-section-actions"><button type="button" class="btn-icon" data-section-rename="'+h.escapeAttr(j.id)+'" title="'+h.escapeAttr(f.boardSectionRename||"Rename section")+'">&#9998;</button><button type="button" class="btn-icon" data-section-delete="'+h.escapeAttr(j.id)+'" title="'+h.escapeAttr(f.boardSectionDelete||"Delete section")+'">&#215;</button></div>')+'</div><div class="section-body-wrapper'+(O.has(j.id)?" collapsed":"")+'"><div class="section-body-inner"><div style="padding:0 var(--cockpit-card-pad,9px) var(--cockpit-card-pad,9px);"><div style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);min-height:60px;">'+(F.length?F.map(function(A){var R=A.id===E,ae=Array.isArray(A.flags)?A.flags.slice(0,6):[],oe=ae.length||Array.isArray(A.labels)&&A.labels.length?'<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">'+(ae.length?'<div class="card-flags" style="display:flex;flex-wrap:wrap;gap:6px;">'+ae.map(function(V,Ka){return'<span data-flag-slot="'+Ka+'">'+h.renderFlagChip(V,!1)+"</span>"}).join("")+"</div>":"")+(Array.isArray(A.labels)&&A.labels.length?'<div class="card-labels" style="display:flex;flex-wrap:wrap;gap:6px;">'+A.labels.slice(0,6).map(function(V,Ka){return'<span data-label-slot="'+Ka+'">'+h.renderLabelChip(V,!1,!1)+"</span>"}).join("")+"</div>":"")+"</div>":"",le=Array.isArray(A.comments)&&A.comments.length?A.comments[A.comments.length-1]:null,_e=A.dueAt?'<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">'+h.escapeHtml((f.boardDueLabel||"Due")+": "+h.formatTodoDate(A.dueAt))+"</span>":"",ze=A.archived&&A.archiveOutcome?'<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">'+h.escapeHtml(h.getTodoArchiveOutcomeLabel(A.archiveOutcome))+"</span>":"",Bo=le&&le.body?'<div class="note" style="display:flex;gap:6px;align-items:flex-start;"><strong data-card-meta>'+h.escapeHtml(f.boardLatestComment||"Latest comment")+":</strong><span data-card-meta>#"+h.escapeHtml(String(le.sequence||1))+" \u2022 "+h.escapeHtml(h.getTodoCommentSourceLabel(le.source||"human-form"))+" \u2022 "+h.escapeHtml(h.getTodoDescriptionPreview(le.body||""))+"</span></div>":"";return'<article draggable="false" data-todo-id="'+h.escapeAttr(A.id)+'" data-section-id="'+h.escapeAttr(j.id)+'" data-order="'+String(A.order||0)+'" data-selected="'+(R?"true":"false")+'" style="display:flex;flex-direction:column;gap:var(--cockpit-card-gap,4px);border-radius:8px;padding:var(--cockpit-card-pad,8px);background:'+h.getTodoPriorityCardBg(A.priority||"none",!1)+';border:1px solid var(--vscode-widget-border);cursor:pointer;"><div style="display:flex;justify-content:space-between;gap:6px;align-items:flex-start;"><div style="display:flex;align-items:flex-start;gap:8px;min-width:0;flex:1;">'+h.renderTodoCompletionCheckbox(A)+'<strong style="line-height:1.3;min-width:0;">'+h.escapeHtml(A.title||f.boardCardUntitled||"Untitled")+'</strong></div><div style="display:flex;align-items:center;gap:6px;">'+h.renderTodoDragHandle(A)+'<span data-card-meta style="white-space:nowrap;color:var(--vscode-descriptionForeground);">'+h.escapeHtml(h.getTodoPriorityLabel(A.priority||"none"))+"</span></div></div>"+(_e||ze?'<div style="display:flex;flex-wrap:wrap;gap:4px;">'+_e+ze+"</div>":"")+oe+'<div class="cockpit-card-details"><div class="note" style="white-space:pre-wrap;">'+h.escapeHtml(h.getTodoDescriptionPreview(A.description||""))+"</div>"+Bo+"</div>"+Zd(A,u,"board")+"</article>"}).join(""):'<div class="note">'+h.escapeHtml(f.boardEmpty||"No cards yet.")+"</div>")+"</div></div></div></div></section>"}).join("")+"</div>"}function Ya(o,r){if(!o||!r)return!1;var s=o.options;if(!s||typeof s.length!="number")return!1;for(var u=0;u<s.length;u++){var f=s[u];if(f&&f.value===r)return!0}return!1}function Qd(o){var r=o.agentSelect;if(r){var s=Array.isArray(o.agents)?o.agents:[],u=o.escapeAttr,f=o.escapeHtml,h=o.strings||{},O=o.executionDefaults||{};if(s.length===0){var E=h.placeholderNoAgents||"";r.innerHTML='<option value="">'+f(E)+"</option>";return}var j=h.placeholderSelectAgent||"",F='<option value="">'+f(j)+"</option>";if(r.innerHTML=F+s.map(function(R){return'<option value="'+u(R.id)+'">'+f(R.name)+"</option>"}).join(""),!r.value){var T=O&&typeof O.agent=="string"?O.agent:"agent",A=s.find(function(R){return R.id===T});A&&(r.value=T)}}}function ec(o){var r=o.modelSelect;if(r){var s=Array.isArray(o.models)?o.models:[],u=o.escapeAttr,f=o.escapeHtml,h=o.strings||{},O=o.executionDefaults||{},E=o.formatModelLabel;if(s.length===0){var j=h.placeholderNoModels||"";r.innerHTML='<option value="">'+f(j)+"</option>";return}var F=h.placeholderSelectModel||"",T='<option value="">'+f(F)+"</option>";if(r.innerHTML=T+s.map(function(ae){return'<option value="'+u(ae.id)+'">'+f(E(ae))+"</option>"}).join(""),!r.value){var A=O&&typeof O.model=="string"?O.model:"",R=s.find(function(ae){return ae.id===A});R&&(r.value=A)}}}(function(){var o=null,r={},s={};try{var u=document.getElementById("initial-data");u&&u.textContent&&(s=JSON.parse(u.textContent)||{})}catch{s={}}r=s.strings||{};var f=typeof s.logLevel=="string"&&s.logLevel?s.logLevel:"info",h=typeof s.logDirectory=="string"?s.logDirectory:"";function O(e){if(!e)return"";var t=String(e),a=t.lastIndexOf("\\"),n=t.lastIndexOf("/");return t.substring(Math.max(a,n)+1)}function E(e){if(!e)return"";var t=String(e);if(/^file:\/\/\/?/i.test(t))try{var a=new URL(t);a.protocol==="file:"?t=decodeURIComponent(a.pathname||""):t=t.replace(/^file:\/\/\/?/i,"")}catch{t=t.replace(/^file:\/\/\/?/i,"")}return O(t)}function j(e){var t=e&&e.id?String(e.id).trim():"",a=e&&e.name?String(e.name).trim():"",n=e&&e.vendor?String(e.vendor).trim():"",i=e&&e.description?String(e.description).trim():"",l=(t+" "+a+" "+n+" "+i).toLowerCase();return l.indexOf("openrouter")>=0?"OpenRouter":l.indexOf("copilot")>=0||l.indexOf("codex")>=0||l.indexOf("github")>=0||l.indexOf("microsoft")>=0?"Copilot":n}function F(e){var t=e&&(e.name||e.id)?String(e.name||e.id).trim():"",a=j(e);return!a||a.toLowerCase()===t.toLowerCase()?t:t+" \u2022 "+a}function T(e){for(var t=Math.max(0,Math.floor(e)),a=[{label:"y",seconds:365*24*60*60},{label:"mo",seconds:720*60*60},{label:"w",seconds:10080*60},{label:"d",seconds:1440*60},{label:"h",seconds:3600},{label:"m",seconds:60},{label:"s",seconds:1}],n=[],i=0;i<a.length;i+=1){var l=a[i],g=Math.floor(t/l.seconds);g<=0||(n.push(String(g)+l.label),t-=g*l.seconds)}return n.length===0?"0s":n.join(" ")}function A(e,t){if(!e||!isFinite(t)||t<=0)return"";var a=t-Date.now();return a>0?" (in "+T(Math.floor(a/1e3))+")":" (due now)"}function R(){(!U||!U.isConnected)&&(U=document.getElementById("task-list")),U&&U.querySelectorAll(".task-next-run-countdown").forEach(function(e){var t=Number(e.getAttribute("data-next-run-ms")||""),a=e.getAttribute("data-enabled")==="true";e.textContent=A(a,t)})}function ae(e){if(!e)return"";var t=String(e);return t.replace(/'(file:\/\/[^']+)'/gi,function(a,n){return"'"+E(n)+"'"}).replace(/"(file:\/\/[^"]+)"/gi,function(a,n){return'"'+E(n)+'"'}).replace(/file:\/\/[^\s"'`]+/gi,function(a){return E(a)}).replace(/'((?:[A-Za-z]:(?:\\|\/)|\\\\)[^']+)'/g,function(a,n){return"'"+E(n)+"'"}).replace(/"((?:[A-Za-z]:(?:\\|\/)|\\\\)[^"]+)"/g,function(a,n){return'"'+E(n)+'"'}).replace(/(^|[^A-Za-z0-9_])((?:[A-Za-z]:(?:\\|\/)|\\\\)[^\s"'`]+)/g,function(a,n,i){return String(n)+E(i)}).replace(/'(\/[^']+)'/g,function(a,n){return"'"+E(n)+"'"}).replace(/"(\/[^\"]+)"/g,function(a,n){return'"'+E(n)+'"'}).replace(/(^|[\s(])(\/[^\s"'`]+)/g,function(a,n,i){return String(n)+E(i)})}var oe=0;function le(){var e=document.getElementById("global-error-banner"),t=document.getElementById("global-error-text");oe&&(clearTimeout(oe),oe=0),t&&(t.textContent=""),e&&e.classList.remove("is-visible")}function _e(e,t){var a=document.getElementById("global-error-banner"),n=document.getElementById("global-error-text");if(a){var i=ae(String(e||"")).trim();if(!i){le();return}oe&&(clearTimeout(oe),oe=0),n?n.textContent=i:a.textContent=i,a.classList.add("is-visible");var l=t&&typeof t.durationMs=="number"?t.durationMs:8e3;l>0&&(oe=setTimeout(function(){le()},l))}}window.onerror=function(e,t,a,n,i){var l=r.webviewScriptErrorPrefix||"",g=r.webviewLinePrefix||"",c=r.webviewLineSuffix||"";_e(l+ae(String(e))+g+String(a)+c)},window.onunhandledrejection=function(e){var t=r.webviewUnhandledErrorPrefix||"",a=r.webviewUnknown||"",n=e&&e.reason?e.reason:null,i=a;n&&(typeof n=="string"?i=n:typeof n=="object"&&n.message?i=String(n.message):i=String(n)),i=String(i).split(/\r?\n/)[0],_e(t+ae(i))},typeof acquireVsCodeApi=="function"?o=acquireVsCodeApi():(o={postMessage:function(){}},_e(r.webviewApiUnavailable||"",{durationMs:0}));var ze=$d({console,initialLogLevel:f,vscode:o}),Bo=ze.createEmptyTodoDraft,V=ze.emitWebviewDebug;function Ka(e,t){!e||typeof e.addEventListener!="function"||e.addEventListener("click",function(a){var n=a&&a.target&&a.target.nodeType===3?a.target.parentElement:a.target;if(!(!n||typeof n.closest!="function")){var i=n.closest(t.selector);i&&V(t.eventName,{controlId:i.id||"",tagName:i.tagName?String(i.tagName).toLowerCase():"",disabled:!!i.disabled,selectedTodoId:B||""})}},!0)}var W=Array.isArray(s.tasks)?s.tasks:[],nt=Array.isArray(s.jobs)?s.jobs:[],Yt=Array.isArray(s.jobFolders)?s.jobFolders:[],L=s.cockpitBoard||{version:4,sections:[],cards:[],labelCatalog:[],archives:{completedSuccessfully:[],rejected:[]},filters:{labels:[],priorities:[],statuses:[],archiveOutcomes:[],flags:[],sortBy:"manual",sortDirection:"asc",viewMode:"board",showArchived:!1,showRecurringTasks:!1},updatedAt:""},Ye=s.telegramNotification||{enabled:!1,hasBotToken:!1,hookConfigured:!1},ue=s.executionDefaults||{agent:"agent",model:""},me=s.reviewDefaults||{needsBotReviewCommentTemplate:"",needsBotReviewPromptTemplate:"",needsBotReviewAgent:"agent",needsBotReviewModel:"",needsBotReviewChatSession:"new",readyPromptTemplate:""};function tc(e,t){switch(e){case"configured":case"missing":case"stale":case"invalid":case"workspace-required":return e;default:return t||"workspace-required"}}function Di(e,t){var a=Array.isArray(e&&e.disabledSystemFlagKeys)?e.disabledSystemFlagKeys.map(function(n){return I(n)}).filter(function(n,i,l){return!!n&&l.indexOf(n)===i}):(t&&t.disabledSystemFlagKeys||[]).slice();return{mode:e&&e.mode==="json"?"json":"sqlite",sqliteJsonMirror:!e||e.sqliteJsonMirror!==!1,disabledSystemFlagKeys:a,appVersion:e&&typeof e.appVersion=="string"?e.appVersion:t&&t.appVersion||"",mcpSetupStatus:tc(e&&e.mcpSetupStatus,t&&t.mcpSetupStatus),lastMcpSupportUpdateAt:e&&typeof e.lastMcpSupportUpdateAt=="string"?e.lastMcpSupportUpdateAt:t&&t.lastMcpSupportUpdateAt||"",lastBundledSkillsSyncAt:e&&typeof e.lastBundledSkillsSyncAt=="string"?e.lastBundledSkillsSyncAt:t&&t.lastBundledSkillsSyncAt||""}}var ot=Di(s.storageSettings),Kt=Array.isArray(s.researchProfiles)?s.researchProfiles:[],Ie=s.activeResearchRun||null,Xt=Array.isArray(s.recentResearchRuns)?s.recentResearchRuns:[],$t=Array.isArray(s.agents)?s.agents:[],Gt=Array.isArray(s.models)?s.models:[],xo=Array.isArray(s.promptTemplates)?s.promptTemplates:[],Xa=Array.isArray(s.skills)?s.skills:[],$a=Array.isArray(s.scheduleHistory)?s.scheduleHistory:[],va=s.defaultChatSession==="continue"?"continue":"new",Lo=!!s.autoShowOnStartup,ac=Array.isArray(s.workspacePaths)?s.workspacePaths:[],rc=!!s.caseInsensitivePaths,he=null,B=null,rn="+",jo="\u2699",Do=null,nn=!1,on=!1,Mo=0;function Ga(){if(nn){on=!0;return}Mo||(Mo=requestAnimationFrame(function(){if(Mo=0,nn){on=!0;return}zt()}))}function nc(){Do=null,Xo=null,$o=null,nn=!1,on&&(on=!1,Ga())}var G=[],ie=Bo(),Y="",X="",Za=null,Fo="",Po="",pa="",it="",Qa=!1,Fe=null,Pe=null,ge="",be="",we="",Ro=!0,ma=!1,Mi="copilot-scheduler-help-warp-seen-v1",Fi=(function(){try{return localStorage.getItem(Mi)!=="1"}catch{return!0}})(),Pi=0,Ri=0,Re=!1,Ni=!1;function Oi(e){ie=ze.resetTodoDraft(e)}function er(e){ie=ze.syncTodoDraftFromInputs({currentTodoDraft:ie,reason:e,selectedTodoId:B,todoCommentInput:se,todoDescriptionInput:Xe,todoDueInput:tt,todoLinkedTaskSelect:xe,todoPriorityInput:Ae,todoSectionInput:Be,todoTitleInput:Bt})}function yt(){B||!ie||(ie.flag=X||"")}function Se(){B||!ie||(ie.flag=X||"",ie.labelInput=q?String(q.value||""):ie.labelInput||"",ie.labelColor=K?String(K.value||""):ie.labelColor||"#4f8cff",ie.flagInput=qe?String(qe.value||""):ie.flagInput||"",ie.flagColor=na?String(na.value||""):ie.flagColor||"#f59e0b")}var No=(function(){var e=s.defaultJitterSeconds,t=typeof e=="number"?e:Number(e);if(!isFinite(t))return 600;var a=Math.floor(t);return a<0?0:a>1800?1800:a})(),ht=typeof s.locale=="string"&&s.locale?s.locale:void 0,Hi="",sn=!1,tr=document.getElementById("task-form"),U=document.getElementById("task-list"),qi=document.getElementById("edit-task-id"),Ve=document.getElementById("submit-btn"),Ji=document.getElementById("test-btn"),zi=document.getElementById("refresh-btn"),ln=document.getElementById("auto-show-startup-btn"),Ke=document.getElementById("schedule-history-select"),ga=document.getElementById("restore-history-btn"),Vi=document.getElementById("auto-show-startup-note"),Wi=document.getElementById("friendly-builder"),st=document.getElementById("cron-preset"),Ce=document.getElementById("cron-expression"),Z=document.getElementById("agent-select"),Q=document.getElementById("model-select"),Ui=document.getElementById("chat-session-group"),ke=document.getElementById("chat-session"),_=document.getElementById("template-select"),St=document.getElementById("template-select-group"),_i=document.getElementById("template-refresh-btn"),dn=document.getElementById("skill-select"),Yi=document.getElementById("insert-skill-btn"),Ki=document.getElementById("setup-mcp-btn"),Xi=document.getElementById("sync-bundled-skills-btn"),$i=document.getElementById("import-storage-from-json-btn"),Gi=document.getElementById("export-storage-to-json-btn"),ar=document.getElementById("help-language-select"),rr=document.getElementById("settings-language-select"),Ne=document.getElementById("help-warp-layer"),kt=document.getElementById("help-intro-rocket"),nr=document.getElementById("prompt-group"),Zi=document.getElementById("prompt-text"),At=document.getElementById("jitter-seconds"),Tt=document.getElementById("friendly-frequency"),Qi=document.getElementById("friendly-interval"),Et=document.getElementById("friendly-minute"),ba=document.getElementById("friendly-hour"),es=document.getElementById("friendly-dow"),ts=document.getElementById("friendly-dom"),as=document.getElementById("friendly-generate"),rs=document.getElementById("open-guru-btn"),ns=document.getElementById("cron-preview-text"),cn=document.getElementById("new-task-btn"),ya=document.getElementById("task-filter-bar"),It=document.getElementById("task-label-filter"),wt=document.getElementById("task-labels"),un=document.getElementById("jobs-folder-list"),os=document.getElementById("jobs-current-folder-banner"),lt=document.getElementById("jobs-list"),fn=document.getElementById("jobs-empty-state"),vn=document.getElementById("jobs-details"),Oo=document.getElementById("jobs-layout"),pn=document.getElementById("jobs-toggle-sidebar-btn"),ha=document.getElementById("jobs-show-sidebar-btn"),is=document.getElementById("jobs-new-folder-btn"),mn=document.getElementById("jobs-rename-folder-btn"),gn=document.getElementById("jobs-delete-folder-btn"),ss=document.getElementById("jobs-new-job-btn"),bn=document.getElementById("jobs-save-btn"),ls=document.getElementById("jobs-save-deck-btn"),yn=document.getElementById("jobs-duplicate-btn"),or=document.getElementById("jobs-pause-btn"),hn=document.getElementById("jobs-compile-btn"),Sn=document.getElementById("jobs-delete-btn"),ds=document.getElementById("jobs-back-btn"),cs=document.getElementById("jobs-open-editor-btn"),us=document.querySelector(".tab-bar"),Ct=document.getElementById("board-filter-sticky"),fs=document.getElementById("board-summary"),Sa=document.getElementById("board-columns"),ir=document.getElementById("todo-toggle-filters-btn"),sr=document.getElementById("todo-search-input"),ka=document.getElementById("todo-section-filter"),Zt=document.getElementById("todo-label-filter"),Qt=document.getElementById("todo-flag-filter"),ea=document.getElementById("todo-priority-filter"),ta=document.getElementById("todo-status-filter"),aa=document.getElementById("todo-archive-outcome-filter"),Aa=document.getElementById("todo-sort-by"),Ta=document.getElementById("todo-sort-direction"),Ea=document.getElementById("todo-view-mode"),lr=document.getElementById("todo-show-recurring-tasks"),dr=document.getElementById("todo-show-archived"),cr=document.getElementById("todo-hide-card-details"),vs=document.getElementById("todo-new-btn"),ps=document.getElementById("todo-clear-selection-btn"),kn=document.getElementById("todo-clear-filters-btn"),ms=document.getElementById("todo-back-btn"),gs=document.getElementById("todo-detail-title"),bs=document.getElementById("todo-detail-mode-note"),Ia=document.getElementById("todo-detail-form"),An=document.getElementById("todo-detail-id"),Bt=document.getElementById("todo-title-input"),Xe=document.getElementById("todo-description-input"),tt=document.getElementById("todo-due-input"),Ae=document.getElementById("todo-priority-input"),Be=document.getElementById("todo-section-input"),xe=document.getElementById("todo-linked-task-select"),Tn=document.getElementById("todo-detail-status"),En=document.getElementById("todo-label-chip-list"),q=document.getElementById("todo-labels-input"),Le=document.getElementById("todo-label-suggestions"),K=document.getElementById("todo-label-color-input"),Ho=document.getElementById("todo-label-add-btn"),ra=document.getElementById("todo-label-color-save-btn"),ur=document.getElementById("todo-label-catalog"),qe=document.getElementById("todo-flag-name-input"),na=document.getElementById("todo-flag-color-input"),qo=document.getElementById("todo-flag-add-btn"),$e=document.getElementById("todo-flag-color-save-btn"),oa=document.getElementById("todo-linked-task-note"),fr=document.getElementById("todo-save-btn"),In=document.getElementById("todo-create-task-btn"),vr=document.getElementById("todo-complete-btn"),wn=document.getElementById("todo-delete-btn"),Cn=document.getElementById("todo-upload-files-btn"),pr=document.getElementById("todo-upload-files-note"),wa=document.getElementById("todo-comment-list"),se=document.getElementById("todo-comment-input"),Ca=document.getElementById("todo-add-comment-btn"),ys=document.getElementById("todo-comment-count-badge"),hs=document.getElementById("todo-comment-mode-pill"),Ss=document.getElementById("todo-comment-context-note"),ks=document.getElementById("todo-comment-composer-title"),As=document.getElementById("todo-comment-composer-note"),Bn=document.getElementById("todo-comment-draft-status"),Jo=document.getElementById("todo-comment-thread-note"),xt=document.getElementById("jobs-name-input"),dt=document.getElementById("jobs-cron-preset"),fe=document.getElementById("jobs-cron-input"),Ts=document.getElementById("jobs-cron-preview-text"),Es=document.getElementById("jobs-open-guru-btn"),Is=document.getElementById("jobs-friendly-builder"),Ba=document.getElementById("jobs-friendly-frequency"),ws=document.getElementById("jobs-friendly-interval"),Lt=document.getElementById("jobs-friendly-minute"),xa=document.getElementById("jobs-friendly-hour"),Cs=document.getElementById("jobs-friendly-dow"),Bs=document.getElementById("jobs-friendly-dom"),xs=document.getElementById("jobs-friendly-generate"),We=document.getElementById("jobs-folder-select"),jt=document.getElementById("jobs-status-pill"),Ls=document.getElementById("jobs-timeline-inline"),La=document.getElementById("jobs-workflow-metrics"),zo=document.getElementById("jobs-step-list"),xn=document.getElementById("jobs-pause-name-input"),js=document.getElementById("jobs-create-pause-btn"),ja=document.getElementById("jobs-existing-task-select"),Ds=document.getElementById("jobs-existing-window-input"),Ln=document.getElementById("jobs-attach-btn"),jn=document.getElementById("jobs-step-name-input"),Dn=document.getElementById("jobs-step-window-input"),Mn=document.getElementById("jobs-step-prompt-input"),mr=document.getElementById("jobs-step-agent-select"),gr=document.getElementById("jobs-step-model-select"),Fn=document.getElementById("jobs-step-labels-input"),Ms=document.getElementById("jobs-create-step-btn"),Lf=document.getElementById("research-new-btn"),jf=document.getElementById("research-load-autoagent-example-btn"),Fs=document.getElementById("research-save-btn"),Ps=document.getElementById("research-duplicate-btn"),Rs=document.getElementById("research-delete-btn"),Ns=document.getElementById("research-start-btn"),Os=document.getElementById("research-stop-btn"),Dt=document.getElementById("research-edit-id"),Ge=document.getElementById("research-name"),br=document.getElementById("research-instructions"),yr=document.getElementById("research-editable-paths"),hr=document.getElementById("research-benchmark-command"),Sr=document.getElementById("research-metric-pattern"),kr=document.getElementById("research-metric-direction"),Ar=document.getElementById("research-max-iterations"),Tr=document.getElementById("research-max-minutes"),Er=document.getElementById("research-max-failures"),Ir=document.getElementById("research-benchmark-timeout"),wr=document.getElementById("research-edit-wait"),Mt=document.getElementById("research-agent-select"),Ft=document.getElementById("research-model-select"),Cr=document.getElementById("research-profile-list"),Br=document.getElementById("research-run-list"),Hs=document.getElementById("research-run-title"),Da=document.getElementById("research-form-error"),Pn=document.getElementById("research-active-empty"),Vo=document.getElementById("research-active-details"),qs=document.getElementById("research-active-status"),Js=document.getElementById("research-active-best"),zs=document.getElementById("research-active-attempts"),Vs=document.getElementById("research-active-last-outcome"),Ws=document.getElementById("research-active-meta"),Rn=document.getElementById("research-attempt-list"),xr=document.getElementById("telegram-enabled"),Ma=document.getElementById("telegram-bot-token"),Lr=document.getElementById("telegram-chat-id"),jr=document.getElementById("telegram-message-prefix"),Us=document.getElementById("telegram-save-btn"),_s=document.getElementById("telegram-test-btn"),Pt=document.getElementById("telegram-feedback"),Ys=document.getElementById("telegram-token-status"),Ks=document.getElementById("telegram-chat-status"),Xs=document.getElementById("telegram-hook-status"),$s=document.getElementById("telegram-updated-at"),Gs=document.getElementById("telegram-status-note"),Wo=document.getElementById("default-agent-select"),Uo=document.getElementById("default-model-select"),Zs=document.getElementById("execution-defaults-save-btn"),Qs=document.getElementById("execution-defaults-note"),Nn=document.getElementById("needs-bot-review-comment-template-input"),On=document.getElementById("needs-bot-review-prompt-template-input"),_o=document.getElementById("needs-bot-review-agent-select"),Yo=document.getElementById("needs-bot-review-model-select"),Hn=document.getElementById("needs-bot-review-chat-session-select"),qn=document.getElementById("ready-prompt-template-input"),el=document.getElementById("review-defaults-save-btn"),tl=document.getElementById("review-defaults-note"),Jn=document.getElementById("settings-storage-mode-select"),zn=document.getElementById("settings-storage-mirror-input"),Vn=document.getElementById("settings-flag-ready-input"),Wn=document.getElementById("settings-flag-needs-bot-review-input"),Un=document.getElementById("settings-flag-needs-user-review-input"),_n=document.getElementById("settings-flag-new-input"),Yn=document.getElementById("settings-flag-on-schedule-list-input"),Kn=document.getElementById("settings-flag-final-user-check-input"),al=document.getElementById("settings-storage-save-btn"),rl=document.getElementById("settings-storage-note"),nl=document.getElementById("settings-version-value"),ol=document.getElementById("settings-mcp-status-value"),il=document.getElementById("settings-mcp-updated-value"),sl=document.getElementById("settings-skills-updated-value"),Dr=document.getElementById("settings-log-level-select"),Ko=document.getElementById("settings-log-directory"),ll=document.getElementById("settings-open-log-folder-btn"),Mr=document.getElementById("board-add-section-btn"),Xn=document.getElementById("board-section-inline-form"),ia=document.getElementById("board-section-name-input"),dl=document.getElementById("board-section-save-btn"),cl=document.getElementById("board-section-cancel-btn"),Oe=document.getElementById("cockpit-col-slider"),je="all",ct="",sa={manual:!1,jobs:!0,recurring:!1,"todo-draft":!1,"one-time":!1},ee="",C="",$="",Je="",ut="",Fr=Object.create(null),Fa="",Pa="",Xo=null,$o=null,Rt=!1,Pr=!1,Nt=!1,Rr=0,Go=0,Zo=0,$n=0,Qo=0,Gn=(function(){try{return localStorage.getItem("cockpit-hide-card-details")==="1"}catch{return!1}})(),Ot="",at="",Ra=(function(){try{return new Set(JSON.parse(localStorage.getItem("cockpit-collapsed-sections")||"[]"))}catch{return new Set}})();function oc(e){Ra.has(e)?Ra.delete(e):Ra.add(e);try{localStorage.setItem("cockpit-collapsed-sections",JSON.stringify(Array.from(Ra)))}catch{}}function ic(e){var t=e>=390?"labels-6":e>=300?"labels-3":"labels-1";document.documentElement.classList.remove("labels-1","labels-3","labels-6"),document.documentElement.classList.add(t)}function sc(){var e=Oe?Number(Oe.min):180,t=Oe?Number(Oe.max):520,a=t-e;return a>0?Math.round(e+a*.1):214}function ul(e){var t=Math.round(10+(e-180)*3/340),a=Math.round(8+(e-180)*6/340),n=Math.round(4+(e-180)*4/340),i=Math.max(8,Math.round(8+(e-180)*4/340)),l=Math.max(2,Math.round(2+(e-180)*2/340)),g=Math.max(0,Math.round(1+(e-180)*2/340)),c=Math.max(4,Math.round(4+(e-180)*4/340)),y=Math.max(0,Math.round(1+(e-180)*2/340)),S=Math.max(4,Math.round(4+(e-180)*4/340));document.documentElement.style.setProperty("--cockpit-col-width",e+"px"),document.documentElement.style.setProperty("--cockpit-col-font",t+"px"),document.documentElement.style.setProperty("--cockpit-card-pad",a+"px"),document.documentElement.style.setProperty("--cockpit-card-gap",n+"px"),document.documentElement.style.setProperty("--cockpit-chip-font",i+"px"),document.documentElement.style.setProperty("--cockpit-chip-gap",l+"px"),document.documentElement.style.setProperty("--cockpit-label-pad-y",g+"px"),document.documentElement.style.setProperty("--cockpit-label-pad-x",c+"px"),document.documentElement.style.setProperty("--cockpit-flag-pad-y",y+"px"),document.documentElement.style.setProperty("--cockpit-flag-pad-x",S+"px"),ic(e),document.documentElement.classList.toggle("cockpit-board-compact-details",e<=sc())}(function(){var e=localStorage.getItem("cockpit-col-width"),t=e?Number(e):Oe?Number(Oe.value):240;t>=180&&t<=520&&(ul(t),Oe&&!e&&(Oe.value=String(t)))})();var la=!1,Nr=!1,lc="";function fl(e){return e==="all"||e==="manual"||e==="recurring"||e==="one-time"}function dc(e){return e==="manual"||e==="jobs"||e==="recurring"||e==="todo-draft"||e==="one-time"}function da(e){return e==="help"||e==="settings"||e==="research"||e==="jobs"||e==="jobs-edit"||e==="list"||e==="create"||e==="board"||e==="todo-edit"}function cc(){if(typeof window.scrollY=="number")return Math.max(0,Math.round(window.scrollY));var e=document.scrollingElement||document.documentElement||document.body;return e&&typeof e.scrollTop=="number"?Math.max(0,Math.round(e.scrollTop)):0}function vl(e){var t=Number(e);(!isFinite(t)||t<0)&&(t=0),window.scrollTo(0,Math.round(t))}function pl(e){da(e)&&(Fr[e]=cc())}function uc(e){var t=0;if(da(e)&&typeof Fr[e]=="number"&&(t=Fr[e]),typeof window.requestAnimationFrame=="function"){window.requestAnimationFrame(function(){vl(t)});return}vl(t)}function fc(){if(!(!o||typeof o.getState!="function"))try{var e=o.getState()||{},t=e&&e.taskFilter;fl(t)&&(je=t),e&&typeof e.labelFilter=="string"&&(ct=e.labelFilter),e&&e.taskSectionCollapseState&&typeof e.taskSectionCollapseState=="object"&&Object.keys(sa).forEach(function(a){typeof e.taskSectionCollapseState[a]=="boolean"&&(sa[a]=e.taskSectionCollapseState[a])}),e&&typeof e.selectedJobFolderId=="string"&&(ee=e.selectedJobFolderId),e&&typeof e.selectedJobId=="string"&&(C=e.selectedJobId),e&&typeof e.jobsSidebarHidden=="boolean"&&(Rt=e.jobsSidebarHidden),e&&typeof e.boardFiltersCollapsed=="boolean"&&(Pr=e.boardFiltersCollapsed),e&&typeof e.selectedResearchId=="string"&&($=e.selectedResearchId),e&&typeof e.selectedResearchRunId=="string"&&(Je=e.selectedResearchRunId),e&&da(e.activeTab)&&(ut=e.activeTab),e&&e.tabScrollPositions&&typeof e.tabScrollPositions=="object"&&Object.keys(e.tabScrollPositions).forEach(function(a){var n=e.tabScrollPositions[a];da(a)&&typeof n=="number"&&isFinite(n)&&n>=0&&(Fr[a]=Math.round(n))})}catch{}}function ye(){if(!(!o||typeof o.setState!="function"))try{var e=typeof o.getState=="function"?o.getState()||{}:{},t={};if(e&&typeof e=="object")for(var a in e)Object.prototype.hasOwnProperty.call(e,a)&&(t[a]=e[a]);t.taskFilter=je,t.labelFilter=ct,t.taskSectionCollapseState=sa,t.selectedJobFolderId=ee,t.selectedJobId=C,t.jobsSidebarHidden=Rt,t.boardFiltersCollapsed=Pr,t.selectedResearchId=$,t.selectedResearchRunId=Je,t.activeTab=ut,t.tabScrollPositions=Fr,o.setState(t)}catch{}}function Zn(){Pt&&(Pt.textContent="",Pt.style.display="none",Pt.classList.remove("error"))}function ei(){return!!(Pr||Nt)}function Na(){Go||(Go=requestAnimationFrame(function(){Go=0,vc()}))}function vc(){var e=0;us&&(e=Math.max(0,Math.ceil(us.getBoundingClientRect().height)));var t=e;Ct&&Ur("board")&&(t=Math.max(e,e+Math.ceil(Ct.getBoundingClientRect().height+8))),document.documentElement.style.setProperty("--cockpit-tab-bar-sticky-top",e+"px"),document.documentElement.style.setProperty("--cockpit-board-sticky-top",t+"px")}function ml(){Zo=0,$n=0,Qo=0}function pc(e){var t=Ct?Math.ceil(Ct.getBoundingClientRect().height):0;Zo=e,$n=Math.max(56,Math.ceil(t+16)),Qo=Date.now()+240}function mc(e){return Qo>Date.now()?!0:$n<=0?!1:Math.abs(e-Zo)<=$n?!0:(ml(),!1)}function gl(e){var t=Math.max(window.scrollY||0,document.documentElement&&document.documentElement.scrollTop||0);if(e||!Ur("board")){Rr=t,ml(),Nt&&(Nt=!1,Qn());return}if(mc(t)){Rr=t;return}var a=Nt;t>Rr+18&&t>140?a=!0:(t<Rr-14||t<72)&&(a=!1),Rr=t,a!==Nt&&(Nt=a,pc(t),Qn())}function Qn(){if(Ct&&Ct.classList){var e=ei();Ct.classList.toggle("is-collapsed",e),Ct.setAttribute("data-auto-collapsed",Nt?"true":"false")}if(ir){var t=ei();ir.textContent=t?r.boardShowFilters||"Show Filters":r.boardHideFilters||"Hide Filters",ir.setAttribute("aria-expanded",t?"false":"true")}Na()}function eo(e){if(!e||!L||!Array.isArray(L.cards))return null;for(var t=0;t<L.cards.length;t+=1){var a=L.cards[t];if(a&&a.id===e)return a}return null}function to(e,t){pr&&(pr.textContent=e||r.boardUploadFilesHint||"",pr.classList.remove("is-success","is-error"),t==="success"?pr.classList.add("is-success"):t==="error"&&pr.classList.add("is-error"))}function gc(e){if(!(!Xe||!e)){var t=String(Xe.value||""),a=t?/\n\s*$/.test(t)?`
`:`

`:"";Xe.value=t+a+e,er("upload")}}function bc(e){if(!(!se||!e||se.disabled)){var t=String(se.value||"");if(t.indexOf(e)>=0){se.focus();return}var a=t?/\n\s*$/.test(t)?`
`:`

`:"";se.value=t+a+e,er("comment-template"),mo(B?eo(B):null),se.focus()}}function bl(){Ae&&Ae.setAttribute("data-priority",String(Ae.value||"none"))}function yc(e){var t=e&&e.source?String(e.source):"human-form";return t==="bot-mcp"?" is-bot-mcp":t==="bot-manual"?" is-bot-manual":t==="system-event"?" is-system-event":" is-human-form"}function yl(e,t){Pt&&(Pt.textContent=String(e||""),Pt.style.display=e?"block":"none",Pt.classList.toggle("error",!!t))}function hc(e){if(!e)return"-";var t=new Date(e);return isNaN(t.getTime())?String(e):t.toLocaleString(ht)}function hl(e){if(!e)return r.settingsStorageNeverUpdated||"Never";var t=new Date(e);return isNaN(t.getTime())?String(e):t.toLocaleString(ht)}function Sc(e){switch(e){case"configured":return r.settingsStorageMcpStatusConfigured||"Configured";case"missing":return r.settingsStorageMcpStatusMissing||"Missing";case"stale":return r.settingsStorageMcpStatusStale||"Needs refresh";case"invalid":return r.settingsStorageMcpStatusInvalid||"Invalid";default:return r.settingsStorageMcpStatusWorkspaceRequired||"Open a workspace to inspect"}}function kc(){return{enabled:!!(xr&&xr.checked),botToken:Ma?String(Ma.value||""):"",chatId:Lr?String(Lr.value||""):"",messagePrefix:jr?String(jr.value||""):""}}function Ac(e){var t=e.enabled||!!String(e.chatId||"").trim()||!!String(e.messagePrefix||"").trim();return t&&!String(e.chatId||"").trim()?r.telegramValidationChatId||"Telegram chat ID is required.":t&&!String(e.botToken||"").trim()&&!(Ye&&Ye.hasBotToken)?r.telegramValidationBotToken||"Telegram bot token is required.":""}function Sl(){xr&&(xr.checked=!!Ye.enabled),Lr&&(Lr.value=Ye.chatId||""),jr&&(jr.value=Ye.messagePrefix||""),Ma&&(Ma.value="",Ma.placeholder=Ye.hasBotToken?r.telegramSavedToken||"Bot token stored privately":r.telegramBotTokenPlaceholder||"123456:ABCDEF..."),Ys&&(Ys.textContent=Ye.hasBotToken?r.telegramSavedToken||"Bot token stored privately":r.telegramMissingToken||"No bot token saved yet"),Ks&&(Ks.textContent=Ye.chatId||"-"),Xs&&(Xs.textContent=Ye.hookConfigured?r.telegramHookReady||"Stop hook configured":r.telegramHookMissing||"Stop hook files not configured"),$s&&($s.textContent=hc(Ye.updatedAt)),Gs&&(Gs.textContent=r.telegramWorkspaceNote||"The hook files are generated under .github/hooks and read secrets from .vscode/scheduler.private.json."),Zn()}function Tc(){return{agent:Wo?String(Wo.value||""):"",model:Uo?String(Uo.value||""):""}}function Ec(){return{needsBotReviewCommentTemplate:Nn?String(Nn.value||""):"",needsBotReviewPromptTemplate:On?String(On.value||""):"",needsBotReviewAgent:_o?String(_o.value||""):"",needsBotReviewModel:Yo?String(Yo.value||""):"",needsBotReviewChatSession:Hn&&Hn.value==="continue"?"continue":"new",readyPromptTemplate:qn?String(qn.value||""):""}}function Ic(){var e=[];return Vn&&Vn.checked===!1&&e.push("ready"),Wn&&Wn.checked===!1&&e.push("needs-bot-review"),Un&&Un.checked===!1&&e.push("needs-user-review"),_n&&_n.checked===!1&&e.push("new"),Yn&&Yn.checked===!1&&e.push("on-schedule-list"),Kn&&Kn.checked===!1&&e.push("final-user-check"),{mode:Jn&&Jn.value==="sqlite"?"sqlite":"json",sqliteJsonMirror:!zn||zn.checked!==!1,disabledSystemFlagKeys:e}}function ao(){rt(Wo,$t,r.placeholderSelectAgent||"Select agent",ue&&typeof ue.agent=="string"?ue.agent:"agent",function(e){return e&&e.id?e.id:""},function(e){return e&&e.name?e.name:""}),rt(Uo,Gt,r.placeholderSelectModel||"Select model",ue&&typeof ue.model=="string"?ue.model:"",function(e){return e&&e.id?e.id:""},function(e){return F(e)}),Qs&&(Qs.textContent=r.executionDefaultsSaved||"Workspace default agent and model settings.")}function ro(){Nn&&(Nn.value=me&&typeof me.needsBotReviewCommentTemplate=="string"?me.needsBotReviewCommentTemplate:""),On&&(On.value=me&&typeof me.needsBotReviewPromptTemplate=="string"?me.needsBotReviewPromptTemplate:""),qn&&(qn.value=me&&typeof me.readyPromptTemplate=="string"?me.readyPromptTemplate:""),rt(_o,$t,r.placeholderSelectAgent||"Select agent",me&&typeof me.needsBotReviewAgent=="string"?me.needsBotReviewAgent:"agent",function(e){return e&&e.id?e.id:""},function(e){return e&&e.name?e.name:""}),rt(Yo,Gt,r.placeholderSelectModel||"Select model",me&&typeof me.needsBotReviewModel=="string"?me.needsBotReviewModel:"",function(e){return e&&e.id?e.id:""},function(e){return F(e)}),Hn&&(Hn.value=me&&me.needsBotReviewChatSession==="continue"?"continue":"new"),tl&&(tl.textContent=r.reviewDefaultsSaved||"The review comment text is inserted on review-state changes, and needs-bot-review launches the planning prompt immediately after save.")}function kl(){var e=Object.create(null);(ot.disabledSystemFlagKeys||[]).forEach(function(t){e[I(t)]=!0}),Jn&&(Jn.value=ot.mode==="json"?"json":"sqlite"),zn&&(zn.checked=ot.sqliteJsonMirror!==!1),Vn&&(Vn.checked=!e.ready),Wn&&(Wn.checked=!e["needs-bot-review"]),Un&&(Un.checked=!e["needs-user-review"]),_n&&(_n.checked=!e.new),Yn&&(Yn.checked=!e["on-schedule-list"]),Kn&&(Kn.checked=!e["final-user-check"]),rl&&(rl.textContent=r.settingsStorageSaved||"Storage settings are repo-local. Reload after changing the backend mode."),nl&&(nl.textContent=ot.appVersion||"-"),ol&&(ol.textContent=Sc(ot.mcpSetupStatus)),il&&(il.textContent=hl(ot.lastMcpSupportUpdateAt)),sl&&(sl.textContent=hl(ot.lastBundledSkillsSyncAt))}function ti(){Dr&&(Dr.value=f||"info"),Ko&&(Ko.value=h||"",Ko.title=h||"")}function ai(){Oo&&Oo.classList&&Oo.classList.toggle("sidebar-collapsed",!!Rt),ha&&(ha.style.display=Rt?"inline-flex":"none")}function ri(e){return e&&e.runtime&&e.runtime.waitingPause?r.jobsPauseWaiting||"Waiting for approval":e&&e.archived?r.jobsArchivedBadge||"Archived":e&&e.paused?r.jobsPaused||"Inactive":r.jobsRunning||"Active"}function Al(){if(ya)for(var e=ya.querySelectorAll(".task-filter-btn"),t=0;t<e.length;t++){var a=e[t];!a||!a.classList||(a.getAttribute("data-filter")===je?a.classList.add("active"):a.classList.remove("active"))}}function wc(){if(Ne){Ne.textContent="";for(var e=0;e<22;e+=1){var t=document.createElement("span"),a=4+e*91/22+Math.random()*3.5,n=Math.random()*.95,i=1.05+Math.random()*1.25,l=110+Math.round(Math.random()*180),g=1+Math.round(Math.random()*2),c=(-7+Math.random()*14).toFixed(2);t.className="help-warp-streak",t.style.setProperty("--warp-top",a.toFixed(2)+"%"),t.style.setProperty("--warp-delay",n.toFixed(2)+"s"),t.style.setProperty("--warp-duration",i.toFixed(2)+"s"),t.style.setProperty("--warp-length",String(l)+"px"),t.style.setProperty("--warp-thickness",String(g)+"px"),t.style.setProperty("--warp-rotate",c+"deg"),Ne.appendChild(t)}}}function Tl(e){if(Ne){var t=e||{};window.clearTimeout(Pi),window.clearTimeout(Ri),Ne.classList.remove("is-active"),Ne.classList.remove("is-fading"),wc(),Ne.offsetWidth,Ne.classList.add("is-active"),t.animateRocket&&kt&&(kt.classList.remove("is-launching"),kt.offsetWidth,kt.classList.add("is-launching"),window.setTimeout(function(){kt&&kt.classList.remove("is-launching")},1250)),Pi=window.setTimeout(function(){Ne&&Ne.classList.add("is-fading")},1e4),Ri=window.setTimeout(function(){Ne&&(Ne.classList.remove("is-active"),Ne.classList.remove("is-fading"),Ne.textContent="")},13800)}}function El(e){if(!(e!=="help"||!Fi)){Fi=!1;try{localStorage.setItem(Mi,"1")}catch{}Tl({animateRocket:!1})}}function Il(){ln&&(ln.textContent=Lo?r.autoShowOnStartupToggleEnabled||"Disable Auto Open":r.autoShowOnStartupToggleDisabled||"Enable Auto Open"),Vi&&(Vi.textContent=Lo?r.autoShowOnStartupEnabled||"Auto-open on startup: On":r.autoShowOnStartupDisabled||"Auto-open on startup: Off")}function Or(){var e=document.getElementById("one-time"),t=document.getElementById("manual-session"),a=!!(e&&e.checked),n=!!(t&&t.checked);Ui&&(Ui.style.display=a?"none":"block"),ke&&!ke.value&&(ke.value=va),a&&ke&&(ke.value=va),a&&t&&t.checked&&(t.checked=!1),n&&e&&e.checked&&(e.checked=!1)}function wl(e){if(!e||!e.createdAt)return r.scheduleHistoryPlaceholder||"Select a backup version";var t=new Date(e.createdAt);return isNaN(t.getTime())?String(e.createdAt):t.toLocaleString(ht)}function Cl(){if(Ke){var e=Ke.value||"",t=Array.isArray($a)?$a:[];if(t=t.slice().sort(function(a,n){return new Date(n.createdAt).getTime()-new Date(a.createdAt).getTime()}),t.length===0){Ke.innerHTML='<option value="">'+d(r.scheduleHistoryEmpty||"No backup versions yet")+"</option>",Ke.disabled=!0,ga&&(ga.disabled=!0);return}Ke.innerHTML='<option value="">'+d(r.scheduleHistoryPlaceholder||"Select a backup version")+"</option>"+t.map(function(a){return'<option value="'+v(a.id||"")+'">'+d(wl(a))+"</option>"}).join(""),Ke.disabled=!1,ga&&(ga.disabled=!1),e&&(Ke.value=e),Ke.value!==e&&(Ke.value="")}}function ni(e){return e?String(e).split(",").map(function(t){return String(t||"").trim()}).filter(function(t,a,n){return t&&n.indexOf(t)===a}):[]}function Bl(e){return Array.isArray(e)?e.join(", "):""}function ft(e){return(Array.isArray(nt)?nt:[]).find(function(t){return t&&t.id===e})||null}function oi(e){return!!e&&e.type==="pause"}function Df(e){return!!e&&e.type!=="pause"&&!!e.taskId}function Cc(e){var t=e&&e.runtime&&Array.isArray(e.runtime.approvedPauseNodeIds)?e.runtime.approvedPauseNodeIds:[];return t.filter(function(a){return typeof a=="string"&&a})}function Bc(e){return e&&e.runtime&&e.runtime.waitingPause?e.runtime.waitingPause:null}function Hr(e){return(Array.isArray(Yt)?Yt:[]).find(function(t){return t&&t.id===e})||null}function ii(e){return(Array.isArray(W)?W:[]).find(function(t){return t&&t.id===e})||null}function xc(){return co().filter(function(e){if(!e||e.archived||qt(e.sectionId)||Oa(e)!=="ready")return!1;var t=e.taskId?ii(e.taskId):null;return t&&isTodoTaskDraft(t)?!1:ct?Array.isArray(e.labels)&&e.labels.indexOf(ct)>=0:!0})}function si(){return(Array.isArray(nt)?nt:[]).filter(function(e){return e&&(e.folderId||"")===ee}).sort(function(e,t){var a=io(t&&t.updatedAt)-io(e&&e.updatedAt);if(a!==0)return a;var n=e&&e.name?String(e.name):"",i=t&&t.name?String(t.name):"";return n.localeCompare(i)})}function no(e){for(var t=0,a=e;a&&a.parentId&&(t+=1,a=Hr(a.parentId),!(t>20)););return t}function xl(e){if(!e)return r.jobsRootFolder||"All jobs";for(var t=[],a=Hr(e),n=0;a&&n<20;)t.unshift(a.name||""),a=a.parentId?Hr(a.parentId):null,n+=1;return t.unshift(r.jobsRootFolder||"All jobs"),t.filter(Boolean).join(" / ")}function qr(e){return!!e&&String(e.name||"").toLowerCase()===String(r.jobsArchiveFolder||"Archive").toLowerCase()}function Lc(e){if(!e)return[];var t=[];return co().forEach(function(a){!a||a.taskId!==e||!Array.isArray(a.labels)||(t=t.concat(a.labels))}),Ht(t)}function oo(e){var t=[];if(e&&Array.isArray(e.labels)&&(t=t.concat(e.labels)),e&&e.jobId){var a=ft(e.jobId);a&&a.name&&t.push(a.name)}return e&&e.id&&(t=t.concat(Lc(e.id))),Ht(t)}function io(e){if(!e)return Number.MAX_SAFE_INTEGER;var t=new Date(e),a=t.getTime();return isNaN(a)?Number.MAX_SAFE_INTEGER:a}function Ll(e){return(Array.isArray(e)?e.slice():[]).sort(function(t,a){var n=io(t&&t.nextRun)-io(a&&a.nextRun);if(n!==0)return n;var i=t&&t.name?String(t.name):"",l=a&&a.name?String(a.name):"";return i.localeCompare(l)})}function jc(){return Ll((Array.isArray(W)?W:[]).filter(function(e){return e&&e.oneTime!==!0}))}function jl(e){var t=_r(e||"");return(!t||t===(r.labelFriendlyFallback||""))&&(t=e||r.labelNever||"Never"),t}function Dc(){if(La){var e=La.querySelector("[data-jobs-workflow-cadence]");if(e){var t=fe?String(fe.value||"").trim():"";e.textContent=jl(t),e.parentElement&&e.parentElement.setAttribute("title",e.textContent||"")}}}function so(){if(It){var e=[];(Array.isArray(W)?W:[]).forEach(function(a){oo(a).forEach(function(n){e.indexOf(n)===-1&&e.push(n)})}),e.sort(function(a,n){return String(a).localeCompare(String(n))});var t=ct||"";It.innerHTML='<option value="">'+d(r.labelAllLabels||"All labels")+"</option>"+e.map(function(a){return'<option value="'+v(a)+'">'+d(a)+"</option>"}).join(""),It.value=t,It.value!==t&&(ct="",It.value="")}}function Mc(){if(ee&&!Hr(ee)&&(ee=""),Re){C="";return}var e=C?ft(C):null;if(e&&(e.folderId||"")!==ee&&(C="",e=null),C&&!e&&(C=""),!C){var t=si();t.length>0&&(C=t[0].id)}}function Fc(){return ee?Hr(ee):null}fc(),Qn(),Il(),Cl(),Yr(),Xr(),Ti(),Xu(),$u(),fa(),Sl(),zt(),ao(),ro(),kl(),ti();function Mf(e){return e?String(e).split(",").map(function(t){return t.trim()}).filter(function(t){return t.length>0}):[]}function ve(e){return String(e||"").trim().replace(/\s+/g," ")}function I(e){return ve(e).toLowerCase()}function li(){var e=q?ve(q.value):"";return e||(at?ve(at):Y?ve(Y):"")}function lo(){var e=qe?ve(qe.value):"";return e||(Ot?ve(Ot):X?ve(X):"")}function Ht(e){var t={};return(Array.isArray(e)?e:[]).map(ve).filter(function(a){var n=I(a);return!n||t[n]?!1:(t[n]=!0,!0)})}function Jr(e){return e==="archive-completed"||e==="archive-rejected"}function qt(e){return e==="recurring-tasks"}function di(e){return Jr(e)||qt(e)}function co(){return L&&Array.isArray(L.cards)?L.cards.slice():[]}function Pc(e){var t=co();return(!e||e.showArchived!==!0)&&(t=t.filter(function(a){return!a.archived&&!Jr(a.sectionId)})),(!e||e.showRecurringTasks!==!0)&&(t=t.filter(function(a){return!qt(a.sectionId)})),t}function Rc(){var e=[],t=Object.create(null);return(Array.isArray(W)?W:[]).forEach(function(a){oo(a).forEach(function(n){var i=ve(n),l=I(i);!i||!l||t[l]||(t[l]=!0,e.push({key:l,name:i,color:"var(--vscode-badge-background)",source:"task"}))})}),e.sort(function(a,n){return String(a.name).localeCompare(String(n.name))})}function zr(){var e=[],t=Object.create(null),a=L&&Array.isArray(L.labelCatalog)?L.labelCatalog.slice():[];return a.forEach(function(n){var i=ve(n&&n.name),l=I(n&&(n.key||n.name||""));!i||!l||(t[l]={key:l,name:i,color:n.color||"var(--vscode-badge-background)",createdAt:n.createdAt,updatedAt:n.updatedAt,source:"board"})}),Rc().forEach(function(n){t[n.key]||(t[n.key]=n)}),Object.keys(t).forEach(function(n){e.push(t[n])}),e.sort(function(n,i){return String(n.name).localeCompare(String(i.name))})}function uo(){return L&&Array.isArray(L.flagCatalog)?L.flagCatalog.slice():[]}function ci(e){for(var t=I(e),a=uo(),n=0;n<a.length;n+=1)if(I(a[n].key||a[n].name)===t)return a[n];return null}function Nc(e){var t=ci(e);return t&&t.color?t.color:"#f59e0b"}function ui(e){var t=I(e);if(t==="ready"||t==="go")return r.boardFlagPresetReady||"Ready";if(t==="needs-bot-review")return r.boardFlagPresetNeedsBotReview||"Needs bot review";if(t==="needs-user-review")return r.boardFlagPresetNeedsUserReview||"Needs user review";if(t==="new")return r.boardFlagPresetNew||"New";if(t==="on-schedule-list")return r.boardFlagPresetOnScheduleList||"On Schedule List";if(t==="final-user-check")return r.boardFlagPresetFinalUserCheck||"Final User Check";var a=ci(e);return a&&a.name?a.name:e}function Oc(e){var t=e&&typeof e=="object"?e:ci(e);if(t&&t.system===!0)return!0;var a=I(t&&(t.key||t.name)?t.key||t.name:e);return a==="ready"||a==="needs-bot-review"||a==="needs-user-review"||a==="new"||a==="on-schedule-list"||a==="final-user-check"}function Oa(e){if(!e||!Array.isArray(e.flags))return"";var t=["new","needs-bot-review","needs-user-review","ready","on-schedule-list","final-user-check"],a=Object.create(null),n=[];return e.flags.forEach(function(i){var l=I(i);l==="go"&&(l="ready"),t.indexOf(l)>=0&&!a[l]&&(a[l]=!0,n.push(l))}),n.length?n[n.length-1]:""}function ca(e){for(var t=I(e),a=zr(),n=0;n<a.length;n+=1)if(I(a[n].key||a[n].name)===t)return a[n];return null}function Dl(e){var t=ca(e);return t&&t.color?t.color:"var(--vscode-badge-background)"}function Ml(e,t){var a=String(e||"");return/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a)?a:t||"#4f8cff"}function fi(e,t,a){var n=ve(e),i=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(t||""))?String(t):"#4f8cff",l=I(n),g=I(a||""),c=null,y;!n||!l||(L||(L={version:4,sections:[],cards:[],labelCatalog:[],filters:{labels:[],priorities:[],statuses:[],archiveOutcomes:[],flags:[],sortBy:"manual",sortDirection:"asc",viewMode:"board",showArchived:!1,showRecurringTasks:!1},updatedAt:""}),y=Array.isArray(L.labelCatalog)?L.labelCatalog.slice():[],y=y.filter(function(S){var w=I(S&&(S.key||S.name||""));return w?w===l||g&&w===g?(c||(c=S),!1):!0:!1}),y.push({key:l,name:n,color:i,createdAt:c&&c.createdAt?c.createdAt:void 0,updatedAt:L.updatedAt||new Date().toISOString()}),L=Object.assign({},L,{labelCatalog:y.sort(function(S,w){return String(S.name).localeCompare(String(w.name))})}))}function De(e){(!e||e==="label")&&(Fo=""),(!e||e==="flag")&&(Po="")}function Fl(e,t){var a=e==="flag"?Po:Fo;return!!a&&I(a)===I(t||"")}function Hc(e){ua(G.filter(function(t){return I(t)!==I(e)}),!0),I(Y)===I(e)&&(Y="")}function qc(){if(Y&&!ca(Y)){var e=G.some(function(t){return I(t)===I(Y)});e||(Y="")}}function Vr(e){var t=String(e||"").trim();if(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(t)){var a=t.slice(1);a.length===3&&(a=a.split("").map(function(c){return c+c}).join(""));var n=parseInt(a.slice(0,2),16),i=parseInt(a.slice(2,4),16),l=parseInt(a.slice(4,6),16),g=(n*299+i*587+l*114)/1e3;return g>=150?"#111111":"#ffffff"}return"var(--vscode-badge-foreground)"}function Pl(e,t,a){var n=Dl(e),i=Vr(n),l=a?"var(--vscode-focusBorder)":"var(--vscode-panel-border)";return'<span data-label-chip="'+v(e)+'" style="border-radius:999px;background:'+v(n)+";color:"+v(i)+";border:1px solid "+v(l)+';"><button type="button" data-label-chip-select="'+v(e)+'" style="all:unset;cursor:pointer;color:inherit;">'+d(e)+"</button>"+(t?'<button type="button" data-label-chip-remove="'+v(e)+'" style="all:unset;cursor:pointer;font-weight:700;color:inherit;">\xD7</button>':"")+"</span>"}function Rl(e,t){var a=Nc(e),n=Vr(a),i=ui(e);return'<span data-flag-chip="'+v(e)+'" style="border-radius:4px;background:'+v(a)+";color:"+v(n)+";border:1px solid color-mix(in srgb,"+v(a)+' 70%,var(--vscode-panel-border));font-weight:600;"><span>'+d(i)+"</span>"+(t?'<button type="button" data-flag-chip-remove="'+v(e)+'" style="all:unset;cursor:pointer;font-weight:700;color:inherit;line-height:1;" title="'+v(r.boardFlagClearTitle||r.boardFlagClear||"Clear flag")+'">\xD7</button>':"")+"</span>"}function ua(e,t){G=Ht(e),t?Y&&G.map(I).indexOf(I(Y))<0&&(Y=G[0]||""):Y=G[0]||"",Me()}function Jc(){if(ur){var e=G.map(I),t=zr().filter(function(a){return e.indexOf(I(a.name))<0});if(t.length===0){ur.innerHTML="";return}ur.innerHTML=t.map(function(a){var n=a.color||"var(--vscode-badge-background)",i=Vr(n),l="color-mix(in srgb,"+n+" 60%,var(--vscode-panel-border))",g=a.source!=="task",c=g&&Fl("label",a.name);return'<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px 3px 12px;border-radius:999px;background:'+v(n)+";color:"+v(i)+";border:1.5px solid "+v(l)+';font-size:12px;"><button type="button" data-label-catalog-select="'+v(a.name)+'" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="'+v(r.boardLabelCatalogAddTitle||"Add to todo")+'">'+d(a.name)+"</button>"+(c?'<button type="button" data-label-catalog-confirm-delete="'+v(a.name)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="'+v(r.boardLabelCatalogDeleteTitle||"Delete label")+'">'+d(r.boardDeleteConfirm||"Delete?")+"</button>":'<button type="button" data-label-catalog-edit="'+v(a.name)+'" data-label-catalog-edit-color="'+v(n)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="'+v(r.boardLabelCatalogEditTitle||"Edit label")+'">\u270E</button>'+(g?'<button type="button" data-label-catalog-delete="'+v(a.name)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="'+v(r.boardLabelCatalogDeleteTitle||"Delete label")+'">\xD7</button>':""))+"</span>"}).join("")}}function vi(){if(Le){var e=q?I(q.value):"",t=G.map(I),a=Ht(zr().map(function(n){return n.name}).concat(G)).filter(function(n){return t.indexOf(I(n))<0}).sort(function(n,i){return n.localeCompare(i)});if(e?a=a.filter(function(n){return I(n).indexOf(e)>=0}):a=[],a.length===0){Le.style.display="none",Le.innerHTML="";return}Le.style.display="flex",Le.innerHTML=a.map(function(n){var i=Dl(n),l=Vr(i);return'<button type="button" data-label-suggestion="'+v(n)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;padding:5px 14px;border-radius:999px;background:'+v(i)+";color:"+v(l)+";border:1px solid color-mix(in srgb,"+v(i)+' 60%,var(--vscode-panel-border));font-size:12.5px;line-height:1.5;">'+d(n)+"</button>"}).join("")}}function Ue(){En&&(En.innerHTML=G.length>0?G.map(function(a){return Pl(a,!0,I(a)===I(Y))}).join(""):'<div class="note">No labels yet.</div>');var e=Y?ca(Y):null;if(K){var t=q&&q.value.trim();Y?K.value=/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(e&&e.color?e.color:"")?e.color:"#4f8cff":t||(K.value="#4f8cff"),K.disabled=!1}ra&&(ra.disabled=!li()),vi(),Jc()}function fo(){if(!q){V("todoLabelAddIgnored",{reason:"missingInput"});return}De("label");var e=ve(q.value);if(!e){V("todoLabelAddIgnored",{reason:"emptyLabel",rawValue:String(q.value||"")});return}V("todoLabelAddAccepted",{label:e,editingExisting:!!at,color:K?K.value:""});var t=at;at="";var a=K?K.value:"",n=ca(e);if(q.value="",t){var i=I(t),l=G.map(I),g=l.indexOf(i);if(g>=0){var c=G.slice();c.splice(g,1,e),ua(c,!0),Y=e}a&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a)&&(fi(e,a,t),o.postMessage({type:"saveTodoLabelDefinition",data:{name:e,previousName:t,color:a}})),Le&&(Le.style.display="none"),Se(),Ue();return}ua(G.concat([e]),!0),Y=e,Le&&(Le.style.display="none"),!n&&a&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(a)&&(fi(e,a),o.postMessage({type:"saveTodoLabelDefinition",data:{name:e,color:a}})),Se(),Ue()}function zc(e){De("label"),ua(G.filter(function(t){return I(t)!==I(e)}),!0),Ue()}function Vc(){Xd({boardColumns:Sa,getBoardColumns:function(){return Sa},document,window,vscode:o,renderCockpitBoard:zt,openTodoEditor:yi,openTodoDeleteModal:Xl,setPendingBoardDelete:function(e,t){it=String(e||""),Qa=!!t,Ga()},clearPendingBoardDelete:function(){it="",Qa=!1,Ga()},submitBoardDeleteChoice:function(e){if(it){var t=it;it="",Qa=!1,B===t&&(B=null,G=[],Y="",X=""),Ga(),o.postMessage({type:e==="permanent"?"purgeTodo":"rejectTodo",todoId:t})}},handleSectionCollapse:function(e){Vd(e,{toggleSectionCollapsed:oc,collapsedSections:Ra})},handleSectionRename:function(e){Wd(e,{document,vscode:o,setTimeout})},handleSectionDelete:function(e){Ud(e,{strings:r,vscode:o,setTimeout})},handleTodoCompletion:function(e){_d(e,{cockpitBoard:L,document,strings:r,setTimeout,vscode:o})},handleTodoReject:function(e){var t=e.getAttribute("data-todo-reject")||"";t&&o.postMessage({type:"rejectTodo",todoId:t})},handleTodoRestore:function(e){var t=e.getAttribute("data-todo-restore")||"";t&&o.postMessage({type:"archiveTodo",todoId:t,archived:!1})},setSelectedTodoId:function(e){B=e},getDraggingSectionId:function(){return Xo},setDraggingSectionId:function(e){Xo=e},getLastDragOverSectionId:function(){return $o},setLastDragOverSectionId:function(e){$o=e},getDraggingTodoId:function(){return Do},setDraggingTodoId:function(e){Do=e},setIsBoardDragging:function(e){nn=e},requestAnimationFrame,finishBoardDragState:nc,isArchiveTodoSectionId:Jr,isSpecialTodoSectionId:di})}function Wc(){Ni||(Ni=!0,[Bt,Xe,se,tt].forEach(function(e){!e||typeof e.addEventListener!="function"||e.addEventListener("input",function(){er("input"),e===se&&mo(B?eo(B):null)})}),[Ae,Be,xe].forEach(function(e){!e||typeof e.addEventListener!="function"||e.addEventListener("change",function(){er("change"),e===Ae&&bl()})}),Ka(Ia,{selector:"#todo-label-add-btn, #todo-label-color-save-btn, #todo-flag-add-btn, #todo-flag-color-save-btn, #todo-label-color-input, #todo-flag-color-input",eventName:"todoDetailClickAttempt"}),Ia&&Ia.addEventListener("click",function(e){var t=H(e,"[data-comment-template]");t&&bc(String(t.getAttribute("data-comment-template")||""))}),document.addEventListener("click",function(e){var t=H(e,"[data-flag-chip-remove]");if(t){X="",yt(),vt();return}var a=H(e,"[data-flag-catalog-select]");if(a){e.preventDefault(),e.stopPropagation(),De("flag");var n=a.getAttribute("data-flag-catalog-select")||"";if(!n)return;X=ve(n)||n,yt(),vt();return}var i=H(e,"[data-flag-catalog-edit]");if(i){e.preventDefault(),e.stopPropagation(),De("flag");for(var l=i.getAttribute("data-flag-catalog-edit")||"",g=uo(),c=null,y=0;y<g.length;y++)if(I(g[y].name)===I(l)){c=g[y];break}var S=document.getElementById("todo-flag-name-input"),w=document.getElementById("todo-flag-color-input");S&&(S.value=c?c.name:l),w&&c&&c.color&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.color)&&(w.value=c.color),Ot=l,Se(),S&&S.focus();return}var N=H(e,"[data-flag-catalog-confirm-delete]");if(N){e.preventDefault(),e.stopPropagation();var p=N.getAttribute("data-flag-catalog-confirm-delete")||"";if(!p)return;De("flag"),I(X)===I(p)&&(X="",yt()),vt(),o.postMessage({type:"deleteTodoFlagDefinition",data:{name:p}});return}var m=H(e,"[data-flag-catalog-delete]");if(m){e.preventDefault(),e.stopPropagation();var n=m.getAttribute("data-flag-catalog-delete")||"";if(!n)return;Po=n,vt()}}))}function vt(){var e=document.getElementById("todo-flag-current"),t=document.getElementById("todo-flag-picker");if(e&&(X?e.innerHTML=Rl(X,!0):e.innerHTML='<span class="note">'+d(r.boardFlagNone||"No flag set.")+"</span>"),t){var a=uo();a.length===0?t.innerHTML="":t.innerHTML=a.map(function(n){var i=n.color||"#f59e0b",l=Vr(i),g=I(n.name)===I(X),c=g?"2px solid var(--vscode-focusBorder)":"1px solid color-mix(in srgb,"+i+" 70%,var(--vscode-panel-border))",y=Fl("flag",n.name),S=Oc(n),w=ui(n.name);return'<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:4px;background:'+v(i)+";color:"+v(l)+";border:"+c+';font-size:inherit;font-weight:600;line-height:1.4;"><button type="button" data-flag-catalog-select="'+v(n.name)+'" style="all:unset;cursor:pointer;flex:1;padding:2px 0;" title="'+v(r.boardFlagCatalogSelectTitle||"Set as flag")+'">'+d(w)+"</button>"+(S?'<span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.75;line-height:1;" title="'+v(r.boardFlagCatalogLockedTitle||"Built-in flag")+'">\u{1F512}</span>':y?'<button type="button" data-flag-catalog-confirm-delete="'+v(n.name)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-height:18px;padding:1px 8px;border-radius:999px;background:rgba(0,0,0,0.16);font-size:11px;font-weight:700;line-height:1.2;" title="'+v(r.boardFlagCatalogDeleteTitle||"Delete flag")+'">'+d(r.boardDeleteConfirm||"Delete?")+"</button>":'<button type="button" data-flag-catalog-edit="'+v(n.name)+'" data-flag-catalog-edit-color="'+v(i)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:11px;opacity:0.7;line-height:1;" title="'+v(r.boardFlagCatalogEditTitle||"Edit flag")+'">\u270E</button><button type="button" data-flag-catalog-delete="'+v(n.name)+'" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;min-width:22px;min-height:22px;padding:2px 4px;border-radius:999px;font-size:14px;font-weight:700;opacity:0.8;line-height:1;" title="'+v(r.boardFlagCatalogDeleteTitle||"Delete flag")+'">\xD7</button>')+"</span>"}).join("")}Me()}function Nl(){De("flag");var e=document.getElementById("todo-flag-name-input"),t=document.getElementById("todo-flag-color-input");if(!e){V("todoFlagAddIgnored",{reason:"missingInput"});return}var a=ve(e.value);if(!a){V("todoFlagAddIgnored",{reason:"emptyFlag",rawValue:String(e.value||"")});return}var n=t?t.value:"#f59e0b";V("todoFlagAddAccepted",{flag:a,editingExisting:!!Ot,color:n});var i=Ot;Ot="",e.value="",i&&I(i)!==I(a)&&I(X)===I(i)&&(X=a),o.postMessage({type:"saveTodoFlagDefinition",data:{name:a,previousName:i||void 0,color:n}}),i||(X=a),yt(),Se(),vt()}function Ol(e){if(!e)return"";var t=new Date(e);if(isNaN(t.getTime()))return"";var a=t.getFullYear(),n=Ja(t.getMonth()+1),i=Ja(t.getDate()),l=Ja(t.getHours()),g=Ja(t.getMinutes());return a+"-"+n+"-"+i+"T"+l+":"+g}function Uc(e){if(e){var t=new Date(e);if(!isNaN(t.getTime()))return t.toISOString()}}function vo(e){if(!e)return"";var t=new Date(e);return isNaN(t.getTime())?String(e):t.toLocaleString(ht||void 0,{dateStyle:"medium",timeStyle:"short"})}function Jt(e){switch(e){case"low":return r.boardPriorityLow||"Low";case"medium":return r.boardPriorityMedium||"Medium";case"high":return r.boardPriorityHigh||"High";case"urgent":return r.boardPriorityUrgent||"Urgent";default:return r.boardPriorityNone||"None"}}function Hl(e){switch(e){case"urgent":return 4;case"high":return 3;case"medium":return 2;case"low":return 1;default:return 0}}function _c(e,t){if(t)return"var(--vscode-list-activeSelectionBackground)";switch(e){case"urgent":return"color-mix(in srgb, #ef4444 12%, var(--vscode-sideBar-background))";case"high":return"color-mix(in srgb, #f59e0b 12%, var(--vscode-sideBar-background))";case"medium":return"color-mix(in srgb, #3b82f6 12%, var(--vscode-sideBar-background))";case"low":return"color-mix(in srgb, #6b7280 12%, var(--vscode-sideBar-background))";default:return"color-mix(in srgb, #9ca3af 6%, var(--vscode-sideBar-background))"}}function Ha(e){switch(e){case"completed":return r.boardStatusCompleted||"Completed";case"rejected":return r.boardArchiveRejected||"Rejected";default:return r.boardStatusActive||"Active"}}function po(e){switch(e){case"completed-successfully":return r.boardArchiveCompletedSuccessfully||"Completed successfully";case"rejected":return r.boardArchiveRejected||"Rejected";default:return r.boardAllArchiveOutcomes||"All outcomes"}}function pi(e){switch(e){case"bot-mcp":return r.boardCommentSourceBotMcp||"Bot MCP";case"bot-manual":return r.boardCommentSourceBotManual||"Bot manual";case"system-event":return r.boardCommentSourceSystemEvent||"System event";default:return r.boardCommentSourceHumanForm||"Human form"}}function ql(e,t){return'<div class="todo-comment-empty-state"><div class="todo-comment-empty-title">'+d(e)+'</div><div class="note">'+d(t)+"</div></div>"}function Yc(e){return'<article class="todo-comment-card is-human-form is-user-form is-preview"><div class="todo-comment-header"><div class="todo-comment-heading"><span class="todo-comment-sequence">'+d(r.boardCommentModeCreate||"Kickoff note")+'</span><span class="todo-comment-source-chip">'+d(r.boardCommentSourceHumanForm||"Human form")+'</span></div><div class="todo-comment-meta"><span class="note">'+d(r.boardCommentPreviewPending||"Saved on create")+'</span></div></div><div class="note todo-comment-author">user</div><div class="todo-comment-body">'+d(e||"")+'</div><div class="todo-comment-expand-hint">'+d(r.boardCommentThreadCreateNote||"Preview of the kickoff note that will be saved on create.")+"</div></article>"}function Kc(e){return e.length?e.map(function(t,a){var n=pi(t.source||"human-form"),i=typeof t.sequence=="number"?t.sequence:1,l=t.updatedAt||t.editedAt||t.createdAt,g=yc(t),c=t.source==="human-form"&&String(t.author||"").toLowerCase()==="user"?" is-user-form":"";return'<article class="todo-comment-card'+g+c+'" data-comment-index="'+v(String(a))+'" tabindex="0" role="button" aria-label="'+v(r.boardCommentOpenFull||"Open full comment")+'"><div class="todo-comment-header"><div class="todo-comment-heading"><span class="todo-comment-sequence">#'+d(String(i))+'</span><span class="todo-comment-source-chip">'+d(n)+'</span></div><div class="todo-comment-meta"><span class="note">'+d(vo(l))+'</span><button type="button" class="btn-icon todo-comment-delete-btn" data-delete-comment-index="'+v(String(a))+'" title="'+v(r.boardCommentDelete||"Delete comment")+'">&#128465;</button></div></div><div class="note todo-comment-author">'+d(t.author||"system")+'</div><div class="todo-comment-body">'+d(t.body||"")+'</div><div class="todo-comment-expand-hint">'+d(r.boardCommentOpenFull||"Open full comment")+"</div></article>"}).join(""):ql(r.boardCommentsEmpty||"No comments yet.",r.boardCommentEditHint||"Add a focused update without rewriting the full description.")}function mo(e){var t=!!e,a=!!(e&&e.archived),n=t?null:ie,i=t&&Array.isArray(e.comments)?e.comments:[],l=se?String(se.value||"").trim():!t&&n?String(n.comment||"").trim():"";if(ys&&(ys.textContent=t?String(i.length):l?r.boardCommentBadgePreview||"Preview":r.boardCommentBadgeDraft||"Draft"),hs&&(hs.textContent=t?r.boardCommentModeEdit||"Live thread":r.boardCommentModeCreate||"Kickoff note"),Ss&&(Ss.textContent=t?r.boardCommentsEditIntro||"Keep approvals, decisions, and handoff context in the thread while the main description stays stable.":r.boardCommentsCreateIntro||"Start the thread early so context, approvals, and decisions do not get buried in the description."),ks&&(ks.textContent=t?r.boardCommentComposerEditTitle||"Add to the thread":r.boardCommentComposerCreateTitle||"Write the kickoff comment"),As&&(As.textContent=t?r.boardCommentEditHint||"Add a focused update without rewriting the full description.":r.boardCommentCreateHint||"Optional, but recommended: add the first human note now so the todo starts with useful context."),Bn&&(a?Bn.textContent=r.boardReadOnlyArchived||"Archived items are read-only in the editor. Use Restore on the board to reopen them.":t?Bn.textContent=l?r.boardCommentReadyToAdd||"Ready to append to the live thread.":r.boardCommentEditHint||"Add a focused update without rewriting the full description.":Bn.textContent=l?r.boardCommentCreateReady||"This draft will be saved as the first human comment when you create the todo.":r.boardCommentCreateHint||"Optional, but recommended: add the first human note now so the todo starts with useful context."),Jo&&(t?Jo.textContent=i.length>0?r.boardCommentThreadEditNote||"Open any card to read the full comment or remove a thread entry.":r.boardCommentEditHint||"Add a focused update without rewriting the full description.":Jo.textContent=l?r.boardCommentThreadCreateNote||"Preview of the kickoff note that will be saved on create.":r.boardCommentThreadCreateEmpty||"Start typing to preview the kickoff comment."),se&&(se.placeholder=t?r.boardCommentPlaceholder||"Add a comment with context, provenance, or approval notes...":r.boardCommentCreatePlaceholder||"Capture the first decision, approval note, or handoff context for this todo..."),Ca&&(Ca.textContent=r.boardAddComment||"Add Comment",Ca.hidden=!t,Ca.disabled=!t||a||!l),!!wa){if(t){wa.innerHTML=Kc(i);return}wa.innerHTML=l?Yc(l):ql(r.boardCommentBadgeDraft||"Draft",r.boardCommentThreadCreateEmpty||"Start typing to preview the kickoff comment.")}}function Jl(e){var t=String(e||"").trim().replace(/\s+/g," ");return t?t.length>140?t.slice(0,137)+"...":t:r.boardDescriptionPreviewEmpty||"No description yet."}function qa(e){var t=e&&typeof e=="object"?e:{};return{searchText:t.searchText||"",labels:Array.isArray(t.labels)?t.labels.slice():[],priorities:Array.isArray(t.priorities)?t.priorities.slice():[],statuses:Array.isArray(t.statuses)?t.statuses.slice():[],archiveOutcomes:Array.isArray(t.archiveOutcomes)?t.archiveOutcomes.slice():[],flags:Array.isArray(t.flags)?t.flags.slice():[],sectionId:t.sectionId||"",sortBy:t.sortBy||"manual",sortDirection:t.sortDirection||"asc",viewMode:t.viewMode==="list"?"list":"board",showArchived:t.showArchived===!0,showRecurringTasks:t.showRecurringTasks===!0,hideCardDetails:t.hideCardDetails===!0}}function Wr(e,t){if(e.length!==t.length)return!1;for(var a=0;a<e.length;a+=1)if(e[a]!==t[a])return!1;return!0}function Xc(e,t){var a=qa(e),n=qa(t);return a.searchText===n.searchText&&Wr(a.labels,n.labels)&&Wr(a.priorities,n.priorities)&&Wr(a.statuses,n.statuses)&&Wr(a.archiveOutcomes,n.archiveOutcomes)&&Wr(a.flags,n.flags)&&a.sectionId===n.sectionId&&a.sortBy===n.sortBy&&a.sortDirection===n.sortDirection&&a.viewMode===n.viewMode&&a.showArchived===n.showArchived&&a.showRecurringTasks===n.showRecurringTasks&&a.hideCardDetails===n.hideCardDetails}function mi(){return qa(L&&L.filters?L.filters:{})}function He(e){var t=qa(Object.assign({},mi(),e||{}));if(e&&typeof e.hideCardDetails=="boolean"){Gn=e.hideCardDetails;try{localStorage.setItem("cockpit-hide-card-details",Gn?"1":"0")}catch{}}L||(L={sections:[],cards:[],labelCatalog:[],archives:{completedSuccessfully:[],rejected:[]},filters:{},updatedAt:""}),Za=t,L.filters=t,zt(),o.postMessage({type:"setTodoFilters",data:t})}function $c(e){var t=e||mi();return!!(t.searchText&&String(t.searchText).trim()||Array.isArray(t.labels)&&t.labels.length>0||Array.isArray(t.priorities)&&t.priorities.length>0||Array.isArray(t.statuses)&&t.statuses.length>0||Array.isArray(t.archiveOutcomes)&&t.archiveOutcomes.length>0||Array.isArray(t.flags)&&t.flags.length>0||t.sectionId&&String(t.sectionId).trim()||t.showArchived===!0||t.showRecurringTasks===!0||t.hideCardDetails===!0)}function Gc(){He({searchText:"",labels:[],priorities:[],statuses:[],archiveOutcomes:[],flags:[],sectionId:"",showArchived:!1,showRecurringTasks:!1,hideCardDetails:!1})}function zl(e){var t=Array.isArray(L.sections)?L.sections.slice():[];return t.sort(function(a,n){return(a.order||0)-(n.order||0)}),t.filter(function(a){return!(!(e&&e.showArchived===!0)&&Jr(a.id)||!(e&&e.showRecurringTasks===!0)&&qt(a.id))})}function Zc(){return zl({showArchived:!0,showRecurringTasks:!0}).filter(function(e){return!di(e.id)})}function go(e){return!!(e&&!e.archived&&Oa(e)==="final-user-check")}function Qc(e){return go(e)?"finalizeTodo":"approveTodo"}function Vl(e){return go(e)?r.boardFinalizeTodo||"Final Accept":r.boardApproveTodo||"Approve"}function eu(){return r.boardFinalizeTodoYes||"Yes"}function tu(){return r.boardFinalizeTodoNo||"No"}function bo(e){return!!(e&&e.archived&&e.archiveOutcome==="completed-successfully")}function au(e){var t=!!(e&&e.archived),a=t?r.boardRestoreTodo||"Restore":Vl(e),n=bo(e)?"\u2713":"\u25CB",i=t?"data-todo-restore":"data-todo-complete",l="todo-complete-button";return go(e)&&(l+=" is-ready-to-finalize"),bo(e)&&(l+=" is-completed"),'<button type="button" class="'+l+'" '+i+'="'+v(e.id)+'" data-no-drag="1" title="'+v(a)+'" aria-label="'+v(a)+'"'+(go(e)?' data-finalize-state="idle" data-confirm-label="'+v(eu())+'" data-cancel-label="'+v(tu())+'"':"")+' style="display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;border-radius:999px;border:1px solid var(--vscode-input-border, var(--vscode-panel-border));background:'+(bo(e)?"color-mix(in srgb, var(--vscode-testing-iconPassed, #4caf50) 82%, var(--vscode-button-background))":"var(--vscode-input-background)")+";color:"+(bo(e)?"var(--vscode-button-foreground)":"var(--vscode-foreground)")+';cursor:pointer;font-size:12px;font-weight:700;line-height:1;flex:0 0 auto;"><span aria-hidden="true">'+d(n)+"</span></button>"}function ru(e){return!e||e.archived?"":'<span class="cockpit-drag-handle" data-todo-drag-handle="'+v(e.id)+'" data-no-drag="1" title="'+v(r.boardReorderTodo||"Drag todo")+'" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:0 4px;cursor:grab;color:var(--vscode-descriptionForeground);user-select:none;line-height:1;font-weight:700;">::</span>'}function nu(e,t){return!e||t?"":'<span class="cockpit-drag-handle" data-section-drag-handle="'+v(e.id)+'" data-no-drag="1" title="'+v(r.boardReorderSection||"Drag section")+'" style="display:inline-flex;align-items:center;justify-content:center;min-width:18px;padding:0 4px;cursor:grab;color:var(--vscode-descriptionForeground);user-select:none;line-height:1;font-weight:700;">::</span>'}function ou(e){if(!e)return null;for(var t=0;t<W.length;t+=1)if(W[t]&&W[t].id===e)return W[t];return null}function iu(e,t){if(!t.showArchived&&e.archived||!t.showRecurringTasks&&qt(e.sectionId)||t.sectionId&&e.sectionId!==t.sectionId)return!1;if(t.labels.length>0){var a=(e.labels||[]).some(function(c){return t.labels.indexOf(c)>=0});if(!a)return!1}if(t.priorities.length>0&&t.priorities.indexOf(e.priority||"none")<0||t.statuses.length>0&&t.statuses.indexOf(e.status||"active")<0||t.archiveOutcomes.length>0&&(!e.archived||t.archiveOutcomes.indexOf(e.archiveOutcome||"")<0))return!1;if(t.flags.length>0){var n=(e.flags||[]).some(function(c){return t.flags.indexOf(c)>=0});if(!n)return!1}if(t.searchText){var i=String(t.searchText).toLowerCase(),l=(e.comments||[]).map(function(c){return(c.author||"")+" "+(c.body||"")}).join(" "),g=[e.title||"",e.description||"",(e.labels||[]).join(" "),(e.flags||[]).join(" "),l].join(" ").toLowerCase();if(g.indexOf(i)<0)return!1}return!0}function su(e,t){var a=t.sortDirection==="desc"?-1:1;return e.slice().sort(function(n,i){var l=0;switch(t.sortBy){case"dueAt":{var g=n.dueAt?new Date(n.dueAt).getTime():Number.MAX_SAFE_INTEGER,c=i.dueAt?new Date(i.dueAt).getTime():Number.MAX_SAFE_INTEGER;l=g-c;break}case"priority":l=Hl(n.priority)-Hl(i.priority);break;case"updatedAt":l=new Date(n.updatedAt||0).getTime()-new Date(i.updatedAt||0).getTime();break;case"createdAt":l=new Date(n.createdAt||0).getTime()-new Date(i.createdAt||0).getTime();break;default:l=(n.order||0)-(i.order||0);break}return l===0&&(l=String(n.title||"").localeCompare(String(i.title||""))),l*a})}function lu(e,t,a){var n=Ht(zr().map(function(y){return y.name}).concat((Array.isArray(a)?a:[]).reduce(function(y,S){return y.concat(S.labels||[])},[]))).sort(),i=Ht(uo().map(function(y){return y.name}).concat((Array.isArray(a)?a:[]).reduce(function(y,S){return y.concat(S.flags||[])},[]))).sort();if(sr&&(sr.value=e.searchText||""),ka&&(ka.innerHTML='<option value="">'+d(r.boardAllSections||"All sections")+"</option>"+t.map(function(y){return'<option value="'+v(y.id)+'">'+d(y.title)+"</option>"}).join(""),ka.value=e.sectionId||""),Zt&&(Zt.innerHTML='<option value="">'+d(r.boardAllLabels||"All labels")+"</option>"+n.map(function(y){return'<option value="'+v(y)+'">'+d(y)+"</option>"}).join(""),Zt.value=e.labels[0]||""),Qt&&(Qt.innerHTML='<option value="">'+d(r.boardAllFlags||"All flags")+"</option>"+i.map(function(y){return'<option value="'+v(y)+'">'+d(y)+"</option>"}).join(""),Qt.value=e.flags[0]||""),ea){var l={"":"",none:"background:#d1d5db;color:#374151;",low:"background:#6b7280;color:#fff;",medium:"background:#3b82f6;color:#fff;",high:"background:#f59e0b;color:#fff;",urgent:"background:#ef4444;color:#fff;"};ea.innerHTML=[{value:"",label:r.boardAllPriorities||"All priorities"},{value:"none",label:Jt("none")},{value:"low",label:Jt("low")},{value:"medium",label:Jt("medium")},{value:"high",label:Jt("high")},{value:"urgent",label:Jt("urgent")}].map(function(y){var S=l[y.value]||"",w=S?' style="'+S+'"':"";return'<option value="'+v(y.value)+'"'+w+">"+d(y.label)+"</option>"}).join(""),ea.value=e.priorities[0]||""}if(ta&&(ta.innerHTML=[{value:"",label:r.boardAllStatuses||"All statuses"},{value:"active",label:Ha("active")},{value:"completed",label:Ha("completed")},{value:"rejected",label:Ha("rejected")}].map(function(y){return'<option value="'+v(y.value)+'">'+d(y.label)+"</option>"}).join(""),ta.value=e.statuses[0]||""),aa&&(aa.innerHTML=[{value:"",label:r.boardAllArchiveOutcomes||"All outcomes"},{value:"completed-successfully",label:po("completed-successfully")},{value:"rejected",label:po("rejected")}].map(function(y){return'<option value="'+v(y.value)+'">'+d(y.label)+"</option>"}).join(""),aa.value=e.archiveOutcomes[0]||""),Aa&&(Aa.innerHTML=[{value:"manual",label:r.boardSortManual||"Manual order"},{value:"dueAt",label:r.boardSortDueAt||"Due date"},{value:"priority",label:r.boardSortPriority||"Priority"},{value:"updatedAt",label:r.boardSortUpdatedAt||"Last updated"},{value:"createdAt",label:r.boardSortCreatedAt||"Created date"}].map(function(y){return'<option value="'+v(y.value)+'">'+d(y.label)+"</option>"}).join(""),Aa.value=e.sortBy||"manual"),Ta&&(Ta.innerHTML=[{value:"asc",label:r.boardSortAsc||"Ascending"},{value:"desc",label:r.boardSortDesc||"Descending"}].map(function(y){return'<option value="'+v(y.value)+'">'+d(y.label)+"</option>"}).join(""),Ta.value=e.sortDirection||"asc"),Ea&&(Ea.innerHTML=[{value:"board",label:r.boardViewBoard||"Board"},{value:"list",label:r.boardViewList||"List"}].map(function(y){return'<option value="'+v(y.value)+'">'+d(y.label)+"</option>"}).join(""),Ea.value=e.viewMode||"board"),dr&&(dr.checked=e.showArchived===!0),lr&&(lr.checked=e.showRecurringTasks===!0),cr){var g=e.hideCardDetails===!0||Gn===!0;cr.checked=g}if(document.documentElement.classList.toggle("cockpit-board-hide-card-details",e.hideCardDetails===!0||Gn===!0),kn&&(kn.disabled=!$c(e)),Oe){var c=Oe.closest?Oe.closest(".board-col-width-group"):null;c&&(c.style.display=e.viewMode==="list"?"none":"flex")}}function Wl(e,t){var a=!!e,n=!!(e&&e.archived),i=a?null:ie,l=a&&An&&An.value===e.id,g=Zc();if(a&&e&&e.sectionId){var c=g.some(function(m){return m.id===e.sectionId});if(!c){var y=(Array.isArray(t)?t:[]).find(function(m){return m.id===e.sectionId});y&&(g=g.concat([y]))}}if(Me(),l||(a?ua(e.labels||[],!1):ua(G,!0)),gs&&(gs.textContent=a?r.boardDetailTitleEdit||"Edit Todo":r.boardDetailTitleCreate||"Create Todo"),bs&&(bs.textContent=a?r.boardDetailModeEdit||"Update this todo.":r.boardDetailModeCreate||"Fill the form to create a new todo."),An&&(An.value=a?e.id:""),l||(Bt&&(Bt.value=a?e.title||"":i.title||""),Xe&&(Xe.value=a?e.description||"":i.description||""),se&&(se.value=a?"":i.comment||""),tt&&(tt.value=a?Ol(e.dueAt):i.dueAt||""),q&&(q.value=a?"":i.labelInput||""),K&&!a&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(i.labelColor||"")&&(K.value=i.labelColor),X=a?Oa(e)||(e.flags||[])[0]||"":i.flag||"",qe&&(qe.value=a?"":i.flagInput||""),na&&!a&&/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(i.flagColor||"")&&(na.value=i.flagColor)),to(r.boardUploadFilesHint||"","neutral"),yt(),vt(),Ue(),$e&&($e.disabled=!qe||!qe.value.trim()),Tn)if(!a)Tn.textContent=r.boardStatusLabel?r.boardStatusLabel+": "+(r.boardStatusActive||"Active"):"Status: Active";else if(e.archived)Tn.textContent=(r.boardStatusLabel||"Status")+": "+Ha(e.status||"active")+" \u2022 "+po(e.archiveOutcome||"rejected");else{var S=Oa(e);Tn.textContent=(r.boardStatusLabel||"Status")+": "+Ha(e.status||"active")+" \u2022 "+(r.boardWorkflowLabel||"Workflow")+": "+ui(S||"new")}if(Ae){var w=l?Ae.value:"";Ae.innerHTML=["none","low","medium","high","urgent"].map(function(m){return'<option value="'+v(m)+'">'+d(Jt(m))+"</option>"}).join(""),Ae.value=l?w:a?e.priority||"none":i.priority||"none",bl()}if(Be){var N=l?Be.value:"";Be.innerHTML=g.map(function(m){return'<option value="'+v(m.id)+'">'+d(m.title)+"</option>"}).join(""),l&&Ya(Be,N)?Be.value=N:Be.value=a?e.sectionId:i.sectionId&&Ya(Be,i.sectionId)?i.sectionId:g[0]?g[0].id:""}l||Ul(a&&e?e.taskId||"":i.taskId||""),a||(ie.priority=Ae&&Ae.value||"none",ie.sectionId=Be&&Be.value||"",ie.dueAt=tt&&tt.value||""),fr&&(fr.textContent=a?r.boardSaveUpdate||"Save Todo":r.boardSaveCreate||"Create Todo",fr.disabled=n),In&&(In.disabled=!a||n||Oa(e)!=="ready"),vr&&(vr.textContent=a?Vl(e):r.boardApproveTodo||"Approve",vr.disabled=!a||n),wn&&(wn.disabled=!a||n),Cn&&(Cn.disabled=!!n),se&&(se.disabled=!!n);var p=a?ou(e.taskId):null;oa&&(a?e.archived?oa.textContent=r.boardReadOnlyArchived||"Archived items are read-only.":Oa(e)==="ready"?oa.textContent=r.boardReadyForTask||"Approved items can become scheduled task drafts or be final accepted.":e.taskId&&!p?oa.textContent=r.boardTaskMissing||"Linked task not found in Task List.":p?oa.textContent=(r.boardTaskLinked||"Linked task")+": "+(p.name||p.id):oa.textContent=r.boardTaskDraftNote||"Scheduled tasks remain separate from planning todos.":oa.textContent=r.boardTaskDraftNote||"Scheduled tasks remain separate from planning todos."),Me(),mo(e)}function Ul(e){if(xe){var t=xe.value||"",a=e||t;if(xe.innerHTML='<option value="">'+d(r.boardLinkedTaskNone||"No linked task")+"</option>"+W.map(function(i){return'<option value="'+v(i.id)+'">'+d(i.name||i.id)+"</option>"}).join(""),!a){xe.value="",B||(ie.taskId="");return}var n=W.some(function(i){return i&&i.id===a});xe.value=n?a:"",B||(ie.taskId=xe.value||"")}}function zt(){Wc();var e=mi(),t=zl(e),a=Array.isArray(L.sections)?L.sections.slice().sort(function(p,m){return(p.order||0)-(m.order||0)}):[],n=co(),i=Pc(e);if(B){var l=n.find(function(p){return p&&p.id===B});l&&l.archived&&e.showArchived!==!0&&(B=null),l&&qt(l.sectionId)&&e.showRecurringTasks!==!0&&(B=null);var g=n.some(function(p){return p&&p.id===B});g||(B=null)}if(lu(e,t,i),fs){var c=n.filter(function(p){return!p.archived}).length,y=n.filter(function(p){return p.archived}).length;fs.textContent=(r.boardSections||"Sections")+": "+t.length+" \u2022 "+(r.boardCards||"Cards")+": "+c+" \u2022 Archived: "+String(y)+" \u2022 "+(r.boardComments||"Comments")+": "+n.reduce(function(p,m){return p+(Array.isArray(m.comments)?m.comments.length:0)},0)}if(!Sa)return;var S=t.filter(function(p){return!e.sectionId||p.id===e.sectionId});if(S.length===0){Sa.innerHTML='<div class="note">'+d(r.boardEmpty||"No cards yet.")+"</div>",Wl(null,t);return}Sa.innerHTML=Gd({visibleSections:S,cards:i,filters:e,strings:r,selectedTodoId:B,pendingBoardDeleteTodoId:it,pendingBoardDeletePermanentOnly:Qa,collapsedSections:Ra,helpers:{escapeAttr:v,escapeHtml:d,sortTodoCards:su,cardMatchesTodoFilters:iu,isArchiveTodoSectionId:Jr,isSpecialTodoSectionId:di,renderSectionDragHandle:nu,renderTodoCompletionCheckbox:au,renderTodoDragHandle:ru,renderFlagChip:Rl,renderLabelChip:Pl,getTodoPriorityLabel:Jt,getTodoStatusLabel:Ha,getTodoDescriptionPreview:Jl,getTodoCommentSourceLabel:pi,getTodoArchiveOutcomeLabel:po,getTodoPriorityCardBg:_c,formatTodoDate:vo}}),Wl(B&&n.find(function(p){return p.id===B})||null,a),Sa&&Vc(),Na(),vs&&(vs.onclick=function(){De(),yi("")}),ps&&(ps.onclick=function(){De(),B=null,G=[],Y="",X="",yt(),zt(),pe("board")}),Mr&&(Mr.onclick=function(){Mr.style.display="none",Xn&&(Xn.style.display="flex",ia&&(ia.value="",ia.focus()))});function w(){Xn&&(Xn.style.display="none"),Mr&&(Mr.style.display="")}function N(){var p=ia?ia.value.trim():"";p&&o.postMessage({type:"addCockpitSection",title:p}),w()}dl&&(dl.onclick=N),cl&&(cl.onclick=w),ia&&(ia.onkeydown=function(p){p.key==="Enter"&&(p.preventDefault(),N()),p.key==="Escape"&&w()}),Oe&&(Oe.oninput=function(){var p=Number(Oe.value);ul(p);try{localStorage.setItem("cockpit-col-width",p)}catch{}}),ms&&(ms.onclick=function(){pe("board")}),sr&&(sr.oninput=function(){He({searchText:sr.value||""})}),ka&&(ka.onchange=function(){He({sectionId:ka.value||""})}),Zt&&(Zt.onchange=function(){He({labels:Zt.value?[Zt.value]:[]})}),Qt&&(Qt.onchange=function(){He({flags:Qt.value?[Qt.value]:[]})}),ea&&(ea.onchange=function(){He({priorities:ea.value?[ea.value]:[]})}),ta&&(ta.onchange=function(){He({statuses:ta.value?[ta.value]:[]})}),aa&&(aa.onchange=function(){He({archiveOutcomes:aa.value?[aa.value]:[]})}),Aa&&(Aa.onchange=function(){He({sortBy:Aa.value||"manual"})}),Ta&&(Ta.onchange=function(){He({sortDirection:Ta.value||"asc"})}),Ea&&(Ea.onchange=function(){He({viewMode:Ea.value==="list"?"list":"board"})}),dr&&(dr.onchange=function(){He({showArchived:dr.checked===!0})}),lr&&(lr.onchange=function(){He({showRecurringTasks:lr.checked===!0})}),cr&&(cr.onchange=function(){He({hideCardDetails:cr.checked===!0})}),ir&&(ir.onclick=function(){ei()?(Pr=!1,Nt=!1):Pr=!0,Qn(),ye()}),kn&&(kn.onclick=function(){Gc()}),Ia&&(Ia.onsubmit=function(p){if(p.preventDefault(),!(!Bt||!Be||!Ae)){er("submit");var m=se?String(se.value||"").trim():"",x={title:Bt.value||"",description:Xe?Xe.value:"",dueAt:Uc(tt?tt.value:"")||null,sectionId:Be.value||"",priority:Ae.value||"none",labels:G.slice(),flags:X?[X]:[],taskId:xe&&xe.value?xe.value:null};B?o.postMessage({type:"updateTodo",todoId:B,data:x}):(m&&(x.comment=m),V("todoCreateSubmit",{hasComment:!!m,titleLength:x.title.length,sectionId:x.sectionId,taskId:x.taskId||""}),o.postMessage({type:"createTodo",data:x}))}}),Ca&&(Ca.onclick=function(){!B||!se||!se.value.trim()||(o.postMessage({type:"addTodoComment",todoId:B,data:{body:se.value.trim(),author:"user",source:"human-form"}}),se.value="",mo(eo(B)))}),wa&&(wa.onclick=function(p){var m=H(p,"[data-delete-comment-index]");if(m&&B){p.stopPropagation();var D=Number(m.getAttribute("data-delete-comment-index"));isNaN(D)||o.postMessage({type:"deleteTodoComment",todoId:B,commentIndex:D});return}var x=H(p,"[data-comment-index]");if(!(!x||!B)){var D=Number(x.getAttribute("data-comment-index")),P=eo(B),k=P&&Array.isArray(P.comments)?P.comments:[];D<0||D>=k.length||Eu(k[D])}},wa.onkeydown=function(p){if(!(p.key!=="Enter"&&p.key!==" ")){var m=H(p,"[data-comment-index]");m&&(p.preventDefault(),m.click())}}),Cn&&(Cn.onclick=function(){o.postMessage({type:"requestTodoFileUpload",todoId:B||void 0})}),In&&(In.onclick=function(){B&&o.postMessage({type:"createTaskFromTodo",todoId:B})}),vr&&(vr.onclick=function(){if(B){var p=L&&Array.isArray(L.cards)?L.cards.find(function(D){return D&&D.id===B}):null,m=Qc(p);if(m==="finalizeTodo"){var x=typeof window.confirm=="function"?window.confirm(r.boardFinalizePrompt||"Archive this todo as completed successfully?"):!0;if(!x)return}o.postMessage({type:m,todoId:B})}}),wn&&(wn.onclick=function(){B&&Xl(B)}),Ho&&(Ho.onclick=function(){V("todoLabelAddButtonClick",{disabled:!!Ho.disabled,inputValue:q?String(q.value||""):""}),fo()}),q&&(q.oninput=function(){var p=ve(q.value);if(p){var m=ca(p);m&&m.color&&K?(K.value=m.color,Y=m.name):Y="",K&&(K.disabled=!1),Ue()}else Y="",Ue();ra&&(ra.disabled=!li()),Se(),vi()},q.onfocus=function(){vi()},q.onblur=function(){setTimeout(function(){Le&&(Le.style.display="none")},200)},q.onkeydown=function(p){p.key==="Enter"?(p.preventDefault(),fo()):p.key==="Escape"&&Le&&(Le.style.display="none")}),K&&(K.oninput=function(){Se()},K.onchange=function(){Se()}),En&&(En.onclick=function(p){var m=H(p,"[data-label-chip-remove]"),x=H(p,"[data-label-chip-select]");if(m){zc(m.getAttribute("data-label-chip-remove")||"");return}if(x){De("label");var D=x.getAttribute("data-label-chip-select")||"";Y=D,q&&(q.value=D,q.focus()),Se(),Ue()}}),ra&&(ra.onclick=function(){var p=li();if(V("todoLabelSaveButtonClick",{disabled:!!ra.disabled,inputValue:p,hasColorInput:!!K}),!p||!K){V("todoLabelSaveIgnored",{reason:p?"missingColorInput":"emptyLabel"});return}var m=ve?ve(p):p,x=at||(Y&&I(Y)!==I(m)?Y:void 0);V("todoLabelSaveAccepted",{label:m,color:K.value,editingExisting:!!x}),fi(m,K.value,x),o.postMessage({type:"saveTodoLabelDefinition",data:{name:m,previousName:x,color:K.value}});var D=x;if(D&&I(D)!==I(m)){var P=G.map(I).indexOf(I(D));if(P>=0){var k=G.slice();k.splice(P,1,m),ua(k,!0)}}Y=m,at="",q&&(q.value=m),Se(),Ue()}),Le&&(Le.onclick=function(p){var m=H(p,"[data-label-suggestion]");if(m){var x=m.getAttribute("data-label-suggestion")||"",D=ca(x);at="",D&&D.color&&K&&(K.value=D.color),q&&(q.value=x),Se(),fo()}}),ur&&(ur.onclick=function(p){var m=H(p,"[data-label-catalog-edit]"),x=H(p,"[data-label-catalog-delete]"),D=H(p,"[data-label-catalog-confirm-delete]"),P=H(p,"[data-label-catalog-select]");if(m){p.preventDefault(),p.stopPropagation(),De("label");for(var k=m.getAttribute("data-label-catalog-edit")||"",J=zr(),z=null,re=0;re<J.length;re++)if(I(J[re].name)===I(k)){z=J[re];break}q&&(q.value=z?z.name:k),K&&(K.value=Ml(z&&z.color,"#4f8cff")),Y=z?z.name:k,at=z?z.name:k,Se(),Ue(),q&&q.focus();return}if(D){p.preventDefault(),p.stopPropagation();var Te=D.getAttribute("data-label-catalog-confirm-delete")||"";if(!Te)return;De("label"),Hc(Te),Ue(),o.postMessage({type:"deleteTodoLabelDefinition",data:{name:Te}});return}if(x){p.preventDefault(),p.stopPropagation();var te=x.getAttribute("data-label-catalog-delete")||"";if(!te)return;Fo=te,Ue();return}if(P){p.preventDefault(),p.stopPropagation(),De("label");var te=P.getAttribute("data-label-catalog-select")||"";if(!te)return;var mt=ca(te);at="",q&&(q.value=te),K&&(K.value=Ml(mt&&mt.color,K.value||"#4f8cff")),Se(),fo()}}),$e&&($e.onclick=function(){var p=document.getElementById("todo-flag-name-input"),m=document.getElementById("todo-flag-color-input"),x=lo();if(V("todoFlagSaveButtonClick",{disabled:!!$e.disabled,inputValue:x,hasNameInput:!!p,hasColorInput:!!m}),!p||!m){V("todoFlagSaveIgnored",{reason:"missingInputs"});return}var D=x;if(!D){V("todoFlagSaveIgnored",{reason:"emptyFlag"});return}var P=ve?ve(D):D,k=Ot||(X&&I(X)!==I(P)?X:void 0);V("todoFlagSaveAccepted",{flag:P,color:m.value,editingExisting:!!k}),o.postMessage({type:"saveTodoFlagDefinition",data:{name:P,previousName:k,color:m.value}});var J=k;J&&I(J)!==I(P)&&I(X)===I(J)&&(X=P,yt(),vt()),(!J||I(X)===I(J))&&(X=P,yt()),Ot="",p.value=P,Se(),vt()}),qo&&(qo.onclick=function(){V("todoFlagAddButtonClick",{disabled:!!qo.disabled,inputValue:qe?String(qe.value||""):""}),Nl()}),qe&&(qe.oninput=function(){$e&&($e.disabled=!lo()),Se()},qe.onkeydown=function(p){p.key==="Enter"&&(p.preventDefault(),Nl())}),na&&(na.oninput=function(){$e&&($e.disabled=!lo()),Se()},na.onchange=function(){$e&&($e.disabled=!lo()),Se()})}function du(e){return document.querySelector('[data-tab-label="'+e+'"]')}function cu(e){return document.querySelector('[data-tab-symbol="'+e+'"]')}function uu(e){return document.querySelector('.tab-button[data-tab="'+e+'"]')}function _l(e){if(!e)return null;for(var t=Array.isArray(W)?W:[],a=0;a<t.length;a+=1)if(t[a]&&t[a].id===e)return t[a];return null}function Yl(e){return ni(e||"").join(",")}function fu(){var e=document.getElementById("task-name"),t=document.getElementById("prompt-text"),a=document.querySelector('input[name="scope"]:checked'),n=document.querySelector('input[name="prompt-source"]:checked'),i=document.getElementById("one-time"),l=document.getElementById("manual-session"),g=n?String(n.value||"inline"):"inline",c=_?String(_.value||""):"";g!=="inline"&&!c&&we&&(c=we);var y=Z?String(Z.value||""):"";!y&&ge&&(y=ge);var S=Q?String(Q.value||""):"";!S&&be&&(S=be);var w=!!(i&&i.checked),N=!w&&!!(l&&l.checked);return{name:e?String(e.value||""):"",prompt:t?String(t.value||""):"",cronExpression:Ce?String(Ce.value||""):"",labels:Yl(wt?wt.value:""),agent:y,model:S,scope:a?String(a.value||"workspace"):"workspace",promptSource:g,promptPath:c,oneTime:w,manualSession:N,chatSession:w?"":ke?String(ke.value||""):"",jitterSeconds:At?Number(At.value||0):0}}function vu(e){return e?{name:String(e.name||""),prompt:typeof e.prompt=="string"?e.prompt:"",cronExpression:String(e.cronExpression||""),labels:Yl(Bl(e.labels)),agent:String(e.agent||""),model:String(e.model||""),scope:String(e.scope||"workspace"),promptSource:String(e.promptSource||"inline"),promptPath:String(e.promptPath||""),oneTime:e.oneTime===!0,manualSession:e.oneTime===!0?!1:e.manualSession===!0,chatSession:e.oneTime===!0?"":String(e.chatSession||va||"new"),jitterSeconds:Number(e.jitterSeconds!=null?e.jitterSeconds:No)}:null}function pu(){return{title:Bt?String(Bt.value||""):"",description:Xe?String(Xe.value||""):"",dueAt:tt?String(tt.value||""):"",priority:Ae?String(Ae.value||"none"):"none",sectionId:Be?String(Be.value||""):"",taskId:xe?String(xe.value||""):"",labels:Ht(G).map(I).join(","),flag:I(X||"")}}function mu(e){return e?{title:String(e.title||""),description:String(e.description||""),dueAt:Ol(e.dueAt),priority:String(e.priority||"none"),sectionId:String(e.sectionId||""),taskId:String(e.taskId||""),labels:Ht(e.labels||[]).map(I).join(","),flag:I((e.flags||[])[0]||"")}:null}function gu(){return{name:xt?String(xt.value||""):"",cronExpression:fe?String(fe.value||""):"",folderId:We?String(We.value||""):""}}function bu(e){return e?{name:String(e.name||""),cronExpression:String(e.cronExpression||""),folderId:String(e.folderId||"")}:null}function gi(e,t){if(!e||!t)return e===t;var a=Object.keys(e),n=Object.keys(t);if(a.length!==n.length)return!1;for(var i=0;i<a.length;i+=1){var l=a[i];if(e[l]!==t[l])return!1}return!0}function yu(){return he?!gi(fu(),vu(_l(he))):!1}function hu(){if(!B)return!1;var e=L&&Array.isArray(L.cards)?L.cards.find(function(t){return t&&t.id===B}):null;return!gi(pu(),mu(e))}function Su(){return Re||!C?!1:!gi(gu(),bu(ft(C)))}function bi(e,t){var a=uu(e),n=cu(e),i=du(e);if(n&&(n.textContent=t.symbol||rn),i&&(i.textContent="",i.classList&&i.classList.toggle("is-dirty",t.dirty===!0)),a){var l=t.title||"";t.dirty&&(l=l+" \u2022 "+(r.tabUnsavedChanges||r.researchUnsavedChanges||"Unsaved changes")),a.title=l,a.setAttribute("aria-label",l||e)}}function Me(){bi("create",{symbol:he?jo:rn,dirty:yu(),title:he?r.tabTaskEditorEdit||r.tabEdit||"Edit Task":r.tabTaskEditorCreate||r.tabTaskEditor||"Create Task"}),bi("todo-edit",{symbol:B?jo:rn,dirty:hu(),title:B?r.tabTodoEditorEdit||r.boardDetailTitleEdit||"Edit Todo":r.tabTodoEditorCreate||r.tabTodoEditor||"Create Todo"}),bi("jobs-edit",{symbol:Re||!C?rn:jo,dirty:Su(),title:Re||!C?r.tabJobsEditorCreate||r.tabJobsEditor||"Create Job":r.tabJobsEditorEdit||"Edit Job"})}function Kl(e){if(he=e||null,qi&&(qi.value=he||""),Me(),Ve){var t=he?r.actionSave:r.actionCreate;t&&(Ve.textContent=t)}cn&&(cn.style.display=he?"inline-flex":"none")}function yi(e){De(),Vt(),B=e||null,B?V("openTodoEditor",{mode:"edit",todoId:B}):(Oi("open-create"),G=[],Y="",X="",V("openTodoEditor",{mode:"create"})),zt(),pe("todo-edit")}function ku(){De(),Vt(),B=null,Oi("reset-editor"),G=[],Y="",X="",zt()}function Au(){return Fe&&document.body.contains(Fe)||(Fe=document.createElement("div"),Fe.className="cockpit-inline-modal",Fe.setAttribute("hidden","hidden"),Fe.innerHTML='<div class="cockpit-inline-modal-card" role="dialog" aria-modal="true" aria-labelledby="todo-delete-modal-title"><div class="cockpit-inline-modal-title" id="todo-delete-modal-title"></div><div class="note" data-todo-delete-modal-message></div><div class="cockpit-inline-modal-actions"><button type="button" class="btn-secondary" data-todo-delete-cancel>'+d(r.boardDeleteTodoCancel||"Cancel")+'</button><button type="button" class="btn-secondary" data-todo-delete-reject>'+d(r.boardDeleteTodoReject||"Archive as Rejected")+'</button><button type="button" class="btn-danger" data-todo-delete-permanent>'+d(r.boardDeleteTodoPermanent||"Delete Permanently")+"</button></div></div>",Fe.onclick=function(e){if(e.target===Fe){Vt();return}var t=H(e,"[data-todo-delete-cancel]");if(t){Vt();return}var a=H(e,"[data-todo-delete-reject]");if(a){$l("reject");return}var n=H(e,"[data-todo-delete-permanent]");n&&$l("permanent")},document.body.appendChild(Fe)),Fe}function Vt(){pa="",Fe&&(Fe.classList.remove("is-open"),Fe.setAttribute("hidden","hidden"))}function Tu(){return Pe&&document.body.contains(Pe)||(Pe=document.createElement("div"),Pe.className="cockpit-inline-modal",Pe.setAttribute("hidden","hidden"),Pe.innerHTML='<div class="cockpit-inline-modal-card comment-detail-modal" role="dialog" aria-modal="true" aria-labelledby="todo-comment-modal-title"><div class="cockpit-inline-modal-title" id="todo-comment-modal-title"></div><div class="todo-comment-modal-meta" id="todo-comment-modal-meta"></div><div class="todo-comment-modal-body" id="todo-comment-modal-body"></div><div class="cockpit-inline-modal-actions"><button type="button" class="btn-secondary" data-comment-modal-close="1">'+d(r.boardCancelAction||"Cancel")+"</button></div></div>",Pe.onclick=function(e){if(e.target===Pe){hi();return}var t=H(e,"[data-comment-modal-close]");t&&hi()},document.body.appendChild(Pe)),Pe}function hi(){Pe&&(Pe.classList.remove("is-open"),Pe.setAttribute("hidden","hidden"))}function Eu(e){if(e){var t=Tu(),a=t.querySelector("#todo-comment-modal-title"),n=t.querySelector("#todo-comment-modal-meta"),i=t.querySelector("#todo-comment-modal-body"),l=pi(e.source||"human-form"),g=e.updatedAt||e.editedAt||e.createdAt;a&&(a.textContent=r.boardCommentModalTitle||"Comment Detail"),n&&(n.innerHTML="<span><strong>"+d(l)+"</strong></span><span>"+d(e.author||"system")+"</span><span>"+d(vo(g))+"</span>"),i&&(i.textContent=e.body||""),t.removeAttribute("hidden"),t.classList.add("is-open")}}function Xl(e,t){if(e){var a=!!(t&&t.permanentOnly),n=L&&Array.isArray(L.cards)?L.cards.find(function(S){return S&&S.id===e}):null,i=Au();pa=e;var l=i.querySelector("#todo-delete-modal-title"),g=i.querySelector("[data-todo-delete-modal-message]"),c=i.querySelector("[data-todo-delete-reject]");if(l&&(l.textContent=a?r.boardDeleteTodoPermanent||"Delete Permanently":r.boardDeleteTodoTitle||"Delete Todo"),g){var y=a?r.boardDeleteTodoPermanentPrompt||"Delete this archived todo permanently? This cannot be undone.":r.boardDeleteTodoPrompt||"Choose whether this todo should be rejected into the archive or removed permanently.";g.textContent=n&&n.title?'"'+String(n.title||"")+'". '+y:y}c&&(c.hidden=a),i.removeAttribute("hidden"),i.classList.add("is-open"),setTimeout(function(){var S=i.querySelector(a?"[data-todo-delete-permanent]":"[data-todo-delete-reject]");S&&typeof S.focus=="function"&&S.focus()},0)}}function $l(e){if(!pa){Vt();return}var t=pa;Vt(),B===t&&(B=null,G=[],Y="",X="",zt()),o.postMessage({type:e==="permanent"?"purgeTodo":"rejectTodo",todoId:t})}function Gl(e){if(Re=!1,typeof e=="string")C=e;else if(!C){var t=si();C=t.length?String(t[0].id||""):""}ye(),pt(),pe("jobs-edit")}function Iu(){Re=!0,C="",ye(),pt(),pe("jobs-edit")}function Zl(){var e=xt?String(xt.value||"").trim():"",t=fe?String(fe.value||"").trim():"";if(!e||!t){V("jobSaveBlocked",{isCreatingJob:Re,hasName:!!e,hasCron:!!t});return}if(Re||!C){V("jobCreateSubmit",{name:e,folderId:We&&We.value?We.value:""}),o.postMessage({type:"createJob",data:{name:e,cronExpression:t,folderId:We&&We.value?We.value:void 0}});return}o.postMessage({type:"updateJob",jobId:C,data:{name:xt?xt.value:"",cronExpression:fe?fe.value:"",folderId:We&&We.value?We.value:void 0}})}function Ql(e){return e?typeof e.requestSubmit=="function"?(e.requestSubmit(),!0):e.dispatchEvent(new Event("submit",{bubbles:!0,cancelable:!0})):!1}function wu(e){return!!e&&(e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&String(e.key||"").toLowerCase()==="s"}function Cu(e){if(wu(e)){if(Ur("create")){e.preventDefault(),ma||Ql(tr);return}Ur("todo-edit")&&(e.preventDefault(),(!fr||!fr.disabled)&&Ql(Ia))}}function Ur(e){var t=document.getElementById(e+"-tab");return!!(t&&t.classList.contains("active"))}function pe(e){da(e)||(e="help"),ut&&pl(ut),document.querySelectorAll(".tab-button").forEach(function(n){n.classList.remove("active")}),document.querySelectorAll(".tab-content").forEach(function(n){n.classList.remove("active")});var t=document.querySelector('.tab-button[data-tab="'+e+'"]'),a=document.getElementById(e+"-tab");t&&t.classList.add("active"),a&&a.classList.add("active"),ut=e,pn&&(pn.style.display=""),ha&&(ha.style.display=e==="jobs"&&Rt?"inline-flex":"none"),e==="list"&&R(),ye(),uc(e),gl(!0),Na(),El(e)}function Bu(){if(da(ut))return ut;var e=typeof s.initialTab=="string"?s.initialTab:"help";return da(e)?e:"help"}Z&&Z.addEventListener("change",function(){ge=Z?String(Z.value||""):"",V("taskAgentChanged",{value:ge})}),Q&&Q.addEventListener("change",function(){be=Q?String(Q.value||""):"",V("taskModelChanged",{value:be})}),_&&_.addEventListener("change",function(){we=_?_.value:""});var ed=document.getElementById("one-time");ed&&ed.addEventListener("change",function(){Or()});var td=document.getElementById("manual-session");td&&td.addEventListener("change",function(){Or()}),Array.prototype.forEach.call(document.querySelectorAll(".tab-button[data-tab]"),function(e){e.addEventListener("click",function(t){t.preventDefault(),t.stopPropagation();var a=e.getAttribute("data-tab");a&&pe(a)})}),ya&&(Al(),ya.addEventListener("click",function(e){for(var t=e&&e.target,a=t;a&&a!==ya&&!(a.getAttribute&&a.getAttribute("data-filter"));)a=a.parentElement;if(!(!a||a===ya)){var n=a.getAttribute("data-filter");fl(n)&&(je=n,Al(),ye(),Ze(W))}})),It&&It.addEventListener("change",function(){ct=It.value||"",ye(),Ze(W)}),document.addEventListener("change",function(e){var t=e.target;t&&t.name==="prompt-source"&&t.checked&&$r(t.value)}),st&&Ce&&(st.addEventListener("change",function(){st.value&&(Ce.value=st.value),za()}),Ce.addEventListener("input",function(){st.value="",za()})),dt&&fe&&(dt.addEventListener("change",function(){dt.value&&(fe.value=dt.value),Yr(),Me()}),fe.addEventListener("input",function(){dt.value="",Yr(),Me()})),Tt&&Tt.addEventListener("change",function(){Kr()}),Ba&&Ba.addEventListener("change",function(){Xr(),Me()}),[xr,Ma,Lr,jr].forEach(function(e){!e||typeof e.addEventListener!="function"||(e.addEventListener("input",Zn),e.addEventListener("change",Zn))}),Us&&Us.addEventListener("click",function(){kd("saveTelegramNotification")}),_s&&_s.addEventListener("click",function(){kd("testTelegramNotification")}),Zs&&Zs.addEventListener("click",function(){o.postMessage({type:"saveExecutionDefaults",data:Tc()})}),el&&el.addEventListener("click",function(){o.postMessage({type:"saveReviewDefaults",data:Ec()})}),al&&al.addEventListener("click",function(){o.postMessage({type:"setStorageSettings",data:Ic()})}),Dr&&Dr.addEventListener("change",function(){f=Dr.value||"info",ze.setLogLevel(f),ti(),o.postMessage({type:"setLogLevel",logLevel:f})}),ll&&ll.addEventListener("click",function(){o.postMessage({type:"openLogFolder"})}),document.addEventListener("change",function(e){var t=e&&e.target;t&&t.id==="friendly-frequency"&&Kr(),t&&t.id==="jobs-friendly-frequency"&&Xr()}),document.addEventListener("input",function(e){var t=e&&e.target;t&&t.id==="friendly-frequency"&&Kr(),t&&t.id==="jobs-friendly-frequency"&&Xr()}),as&&as.addEventListener("click",function(){Pu()}),xs&&xs.addEventListener("click",function(){Ru(),Me()}),rs&&rs.addEventListener("click",function(){var e=Ce?Ce.value.trim():"";e||(e="* * * * *");var t="https://crontab.guru/#"+encodeURIComponent(e);window.open(t,"_blank")}),Es&&Es.addEventListener("click",function(){var e=fe?fe.value.trim():"";e||(e="* * * * *");var t="https://crontab.guru/#"+encodeURIComponent(e);window.open(t,"_blank")}),document.addEventListener("change",function(e){var t=e.target;if(t){if(t.classList.contains("task-agent-select")){var a=t.getAttribute("data-id"),n=t.value;o.postMessage({type:"updateTask",taskId:a,data:{agent:n}})}else if(t.classList.contains("task-model-select")){var a=t.getAttribute("data-id"),n=t.value;o.postMessage({type:"updateTask",taskId:a,data:{model:n}})}}}),_&&_.addEventListener("change",function(){var e=_.value;if(e){var t=document.querySelector('input[name="prompt-source"]:checked'),a=t?t.value:"inline";o.postMessage({type:"loadPromptTemplate",path:e,source:a})}}),tr&&tr.addEventListener("submit",function(e){e.preventDefault(),le();var t=document.getElementById("form-error");t&&(t.style.display="none");var a=document.getElementById("task-name"),n=document.getElementById("prompt-text"),i=document.querySelector('input[name="scope"]:checked'),l=document.querySelector('input[name="prompt-source"]:checked'),g=document.getElementById("run-first"),c=document.getElementById("one-time"),y=document.getElementById("manual-session"),S=l?l.value:"inline",w=Z?Z.value:"";!w&&ge&&(w=ge);var N=Q?Q.value:"";!N&&be&&(N=be);var p=_?_.value:"";S!=="inline"&&he&&!p&&we&&(p=we);var m={name:a?a.value:"",prompt:n?n.value:"",cronExpression:Ce?Ce.value:"",labels:ni(wt?wt.value:""),agent:w,model:N,scope:i?i.value:"workspace",promptSource:S,promptPath:p,runFirstInOneMinute:g?g.checked:!1,oneTime:c?c.checked:!1,manualSession:c&&c.checked?!1:!!(y&&y.checked),jitterSeconds:At?Number(At.value||0):0,enabled:he?Ro:!0};m.oneTime||(m.chatSession=ke&&ke.value==="continue"?"continue":"new");var x=(m.name||"").trim();if(!x){t&&(t.textContent=r.taskNameRequired||"",t.style.display="block");return}var D=(m.promptPath||"").trim();if(S!=="inline"&&!D){t&&(t.textContent=r.templateRequired||"",t.style.display="block");return}var P=(m.prompt||"").trim();if(S!=="inline"&&!P&&he){var k=_l(he);m.prompt=k&&typeof k.prompt=="string"?k.prompt:"",P=(m.prompt||"").trim()}if(S==="inline"&&!P){t&&(t.textContent=r.promptRequired||"",t.style.display="block");return}var J=(m.cronExpression||"").trim();if(!J){t&&(t.textContent=r.cronExpressionRequired||r.invalidCronExpression||"",t.style.display="block");return}ma=!0,Ve&&(Ve.disabled=!0),he?o.postMessage({type:"updateTask",taskId:he,data:m}):o.postMessage({type:"createTask",data:m})}),Ji&&Ji.addEventListener("click",function(){var e=document.getElementById("prompt-text"),t=e?e.value:"",a=Z?Z.value:"",n=Q?Q.value:"";t&&o.postMessage({type:"testPrompt",prompt:t,agent:a,model:n})}),zi&&zi.addEventListener("click",function(){o.postMessage({type:"refreshTasks"}),o.postMessage({type:"refreshAgents"}),o.postMessage({type:"refreshPrompts"})}),ln&&ln.addEventListener("click",function(){o.postMessage({type:"toggleAutoShowOnStartup"})}),ga&&ga.addEventListener("click",function(){var e=Ke?Ke.value:"";if(!e){window.alert(r.scheduleHistoryRestoreSelectRequired||"Select a backup version first");return}var t=(Array.isArray($a)?$a:[]).find(function(i){return i&&i.id===e}),a=wl(t),n=(r.scheduleHistoryRestoreConfirm||"Restore the repo schedule from {createdAt}? The current state will be backed up first.").replace("{createdAt}",a).replace("{timestamp}",a);window.confirm(n)&&o.postMessage({type:"restoreScheduleHistory",snapshotId:e})});function xu(e){return e==="research-new-btn"?(la=!0,$="",Je=Ie&&Ie.id?Ie.id:Je,Va(null),fa(),Ge&&typeof Ge.focus=="function"&&Ge.focus(),!0):e==="research-load-autoagent-example-btn"?(Va(Vu()),Nr=!0,fa(),Ge&&typeof Ge.focus=="function"&&Ge.focus(),!0):!1}function Lu(e){if(xu(e))return!0;if(e==="research-save-btn"){var t=Wu(),a=Uu(t);return a?(Ou(a),!0):(Ai(),$?o.postMessage({type:"updateResearchProfile",researchId:$,data:t}):o.postMessage({type:"createResearchProfile",data:t}),!0)}return e==="research-duplicate-btn"?($&&o.postMessage({type:"duplicateResearchProfile",researchId:$}),!0):e==="research-delete-btn"?($&&o.postMessage({type:"deleteResearchProfile",researchId:$}),!0):e==="research-start-btn"?($&&o.postMessage({type:"startResearchRun",researchId:$}),!0):e==="research-stop-btn"?(o.postMessage({type:"stopResearchRun"}),!0):!1}function ad(e){$=e||"",la=!$;var t=hd();return Va(t||null),fa(),!!t}function rd(e){Je=e||"",ye(),fa()}is&&is.addEventListener("click",function(){o.postMessage({type:"requestCreateJobFolder",parentFolderId:ee||void 0})}),mn&&mn.addEventListener("click",function(){ee&&o.postMessage({type:"requestRenameJobFolder",folderId:ee})}),gn&&gn.addEventListener("click",function(){ee&&o.postMessage({type:"requestDeleteJobFolder",folderId:ee})}),ss&&ss.addEventListener("click",function(){Re=!0,Me(),o.postMessage({type:"requestCreateJob",folderId:ee||void 0}),pe("jobs-edit")});var nd=document.getElementById("jobs-empty-new-btn");nd&&nd.addEventListener("click",function(){Re=!0,Me(),o.postMessage({type:"requestCreateJob",folderId:ee||void 0})}),ds&&ds.addEventListener("click",function(){pe("jobs")}),cs&&cs.addEventListener("click",function(){Gl(C||"")}),bn&&bn.addEventListener("click",Zl),ls&&ls.addEventListener("click",Zl),yn&&yn.addEventListener("click",function(){C&&o.postMessage({type:"duplicateJob",jobId:C})}),or&&or.addEventListener("click",function(){C&&o.postMessage({type:"toggleJobPaused",jobId:C})}),hn&&hn.addEventListener("click",function(){C&&o.postMessage({type:"compileJob",jobId:C})}),jt&&jt.addEventListener("click",function(){C&&o.postMessage({type:"toggleJobPaused",jobId:C})}),pn&&pn.addEventListener("click",function(){Rt=!Rt,ai(),ye()}),ha&&ha.addEventListener("click",function(){Rt=!1,ai(),ye()}),Sn&&Sn.addEventListener("click",function(){C&&o.postMessage({type:"deleteJob",jobId:C})}),Ln&&Ln.addEventListener("click",function(){!C||!ja||!ja.value||o.postMessage({type:"attachTaskToJob",jobId:C,taskId:ja.value,windowMinutes:Ds?Number(Ds.value||30):30})}),Ms&&Ms.addEventListener("click",function(){if(C){var e=jn?jn.value.trim():"",t=Mn?Mn.value.trim():"";if(!(!e||!t)){var a=ft(C);o.postMessage({type:"createJobTask",jobId:C,windowMinutes:Dn?Number(Dn.value||30):30,data:{name:e,prompt:t,cronExpression:a&&a.cronExpression?a.cronExpression:"0 9 * * 1-5",agent:mr?mr.value:"",model:gr?gr.value:"",labels:ni(Fn?Fn.value:""),scope:"workspace",promptSource:"inline",oneTime:!1}}),jn&&(jn.value=""),Mn&&(Mn.value=""),Fn&&(Fn.value=""),Dn&&(Dn.value="30")}}}),js&&js.addEventListener("click",function(){if(C){var e=xn?xn.value.trim():"";o.postMessage({type:"createJobPause",jobId:C,data:{title:e||r.jobsPauseDefaultTitle||"Manual review"}}),xn&&(xn.value="")}}),document.addEventListener("click",function(e){var t=e&&e.target,a=H(e,"#research-new-btn, #research-load-autoagent-example-btn, #research-save-btn, #research-duplicate-btn, #research-delete-btn, #research-start-btn, #research-stop-btn");if(!(a&&(e.preventDefault(),e.stopPropagation(),Lu(a.id||"")))){var n=H(e,"[data-research-id]");if(n&&Cr&&Cr.contains(n)){e.preventDefault(),e.stopPropagation(),ad(n.getAttribute("data-research-id")||"");return}var i=H(e,"[data-run-id]");if(i&&Br&&Br.contains(i)){e.preventDefault(),e.stopPropagation(),rd(i.getAttribute("data-run-id")||"");return}var l=t&&t.closest?t.closest("[data-job-folder]"):null;if(l&&un&&un.contains(l)){ee=l.getAttribute("data-job-folder")||"",C="",ye(),pt();return}var g=t&&t.closest?t.closest("[data-job-open-editor]"):null;if(g&&lt&&lt.contains(g)){Gl(g.getAttribute("data-job-open-editor")||"");return}var c=t&&t.closest?t.closest("[data-job-id]"):null;if(c&&lt&&lt.contains(c)){C=c.getAttribute("data-job-id")||"",ye(),pt();return}var y=t&&t.getAttribute?t.getAttribute("data-job-action"):"";if(y){if(y==="detach-node"){var S=t.getAttribute("data-job-node-id")||"";C&&S&&o.postMessage({type:"requestDeleteJobTask",jobId:C,nodeId:S});return}if(y==="edit-task"){var w=t.getAttribute("data-job-task-id")||"";w&&typeof window.editTask=="function"&&window.editTask(w);return}if(y==="edit-pause"){var N=t.getAttribute("data-job-node-id")||"";C&&N&&o.postMessage({type:"requestRenameJobPause",jobId:C,nodeId:N});return}if(y==="delete-pause"){var p=t.getAttribute("data-job-node-id")||"";C&&p&&o.postMessage({type:"requestDeleteJobPause",jobId:C,nodeId:p});return}if(y==="approve-pause"){var m=t.getAttribute("data-job-node-id")||"";C&&m&&o.postMessage({type:"approveJobPause",jobId:C,nodeId:m});return}if(y==="reject-pause"){var x=t.getAttribute("data-job-node-id")||"";C&&x&&o.postMessage({type:"rejectJobPause",jobId:C,nodeId:x});return}if(y==="run-task"){var D=t.getAttribute("data-job-task-id")||"";D&&typeof window.runTask=="function"&&window.runTask(D)}}}}),document.addEventListener("change",function(e){var t=e&&e.target;if(t&&t.classList&&t.classList.contains("job-node-window-input")){if(!C)return;var a=t.getAttribute("data-job-node-window-id")||"";if(!a)return;o.postMessage({type:"updateJobNodeWindow",jobId:C,nodeId:a,windowMinutes:Number(t.value||30)})}}),document.addEventListener("dragstart",function(e){var t=e&&e.target,a=t&&t.closest?t.closest("[data-job-id]"):null;if(a&&lt&&lt.contains(a)){Pa=a.getAttribute("data-job-id")||"",a.classList&&a.classList.add("dragging"),e.dataTransfer&&(e.dataTransfer.effectAllowed="move");return}var n=t&&t.closest?t.closest("[data-job-node-id]"):null;n&&(Fa=n.getAttribute("data-job-node-id")||"",n.classList&&n.classList.add("dragging"),e.dataTransfer&&(e.dataTransfer.effectAllowed="move"))}),document.addEventListener("dragend",function(e){var t=e&&e.target,a=t&&t.closest?t.closest("[data-job-id]"):null;a&&a.classList&&a.classList.remove("dragging");var n=t&&t.closest?t.closest("[data-job-node-id]"):null;n&&n.classList&&n.classList.remove("dragging"),Pa="",Fa="",Array.prototype.forEach.call(document.querySelectorAll(".jobs-step-card.drag-over"),function(i){i&&i.classList&&i.classList.remove("drag-over")}),Array.prototype.forEach.call(document.querySelectorAll(".jobs-folder-item.drag-over"),function(i){i&&i.classList&&i.classList.remove("drag-over")})}),document.addEventListener("dragover",function(e){var t=e&&e.target,a=t&&t.closest?t.closest("[data-job-folder]"):null;if(a&&Pa){e.preventDefault(),e.dataTransfer&&(e.dataTransfer.dropEffect="move"),a.classList&&a.classList.add("drag-over");return}var n=t&&t.closest?t.closest("[data-job-node-id]"):null;!n||!Fa||(e.preventDefault(),e.dataTransfer&&(e.dataTransfer.dropEffect="move"),n.classList&&n.classList.add("drag-over"))}),document.addEventListener("dragleave",function(e){var t=e&&e.target,a=t&&t.closest?t.closest("[data-job-folder]"):null;a&&a.classList&&a.classList.remove("drag-over");var n=t&&t.closest?t.closest("[data-job-node-id]"):null;n&&n.classList&&n.classList.remove("drag-over")}),document.addEventListener("drop",function(e){var t=e&&e.target,a=t&&t.closest?t.closest("[data-job-folder]"):null;if(a&&Pa){e.preventDefault(),a.classList&&a.classList.remove("drag-over");var n=a.getAttribute("data-job-folder")||"",i=ft(Pa);if(!i||(i.folderId||"")===n)return;o.postMessage({type:"updateJob",jobId:Pa,data:{folderId:n||void 0}});return}var l=t&&t.closest?t.closest("[data-job-node-id]"):null;if(!(!l||!Fa||!C)){e.preventDefault(),l.classList&&l.classList.remove("drag-over");var g=l.getAttribute("data-job-node-id")||"",c=ft(C);if(!(!c||!Array.isArray(c.nodes))){var y=c.nodes.findIndex(function(S){return S&&S.id===g});y<0||Fa===g||o.postMessage({type:"reorderJobNode",jobId:C,nodeId:Fa,targetIndex:y})}}}),_i&&_i.addEventListener("click",function(){o.postMessage({type:"refreshPrompts"});var e=_?_.value:"",t=document.querySelector('input[name="prompt-source"]:checked'),a=t?t.value:"inline";e&&(a==="local"||a==="global")&&o.postMessage({type:"loadPromptTemplate",path:e,source:a})}),Yi&&Yi.addEventListener("click",function(){Nu()}),Ki&&Ki.addEventListener("click",function(){o.postMessage({type:"setupMcp"})}),Xi&&Xi.addEventListener("click",function(){o.postMessage({type:"syncBundledSkills"})}),$i&&$i.addEventListener("click",function(){o.postMessage({type:"importStorageFromJson"})}),Gi&&Gi.addEventListener("click",function(){o.postMessage({type:"exportStorageToJson"})});function od(e){var t=e||"auto";ar&&(ar.value=t),rr&&(rr.value=t)}function id(e){var t=e||"auto";od(t),o.postMessage({type:"setLanguage",language:t})}od(typeof s.languageSetting=="string"&&s.languageSetting?s.languageSetting:"auto"),ar&&ar.addEventListener("change",function(){id(ar.value)}),rr&&rr.addEventListener("change",function(){id(rr.value)});var sd=document.getElementById("btn-intro-tutorial");sd&&sd.addEventListener("click",function(){o.postMessage({type:"introTutorial"})});var ld=document.getElementById("btn-plan-integration");ld&&ld.addEventListener("click",function(){o.postMessage({type:"planIntegration"})}),kt&&kt.addEventListener("click",function(){Tl({animateRocket:!0})}),["btn-help-switch-settings","btn-help-switch-board","btn-help-switch-create","btn-help-switch-list","btn-help-switch-jobs","btn-help-switch-research"].forEach(function(e){var t=document.getElementById(e);t&&t.addEventListener("click",function(){var a={"btn-help-switch-settings":"settings","btn-help-switch-board":"board","btn-help-switch-create":"create","btn-help-switch-list":"list","btn-help-switch-jobs":"jobs","btn-help-switch-research":"research"};pe(a[e])})}),document.getElementById("help-tab")&&document.getElementById("help-tab").classList.contains("active")&&window.requestAnimationFrame(function(){El("help")});function ju(e){for(var t=e&&e.nodeType===3?e.parentElement:e;t&&t!==document.body;){if(t.hasAttribute&&t.hasAttribute("data-action")&&(t.hasAttribute("data-id")||t.hasAttribute("data-task-id")||t.hasAttribute("data-job-id")||t.hasAttribute("data-profile-id")))return t;t=t.parentElement}return null}document.addEventListener("click",function(e){for(var t=e&&e.target&&e.target.nodeType===3?e.target.parentElement:e.target;t&&t!==document.body&&!(t.getAttribute&&t.getAttribute("data-task-section-toggle"));)t=t.parentElement;if(t&&t!==document.body&&((!U||!U.isConnected)&&(U=document.getElementById("task-list")),U&&U.contains(t))){var a=t.getAttribute("data-task-section-toggle");if(dc(a)){e.preventDefault(),sa[a]=sa[a]!==!0,ye(),Ze(W);return}}var n=H(e,"[data-ready-todo-create]");if(n&&((!U||!U.isConnected)&&(U=document.getElementById("task-list")),U&&U.contains(n))){e.preventDefault();var i=n.getAttribute("data-ready-todo-create");i&&o.postMessage({type:"createTaskFromTodo",todoId:i});return}var l=H(e,"[data-ready-todo-open]");if(l&&((!U||!U.isConnected)&&(U=document.getElementById("task-list")),U&&U.contains(l))){e.preventDefault();var g=l.getAttribute("data-ready-todo-open");g&&yi(g);return}var c=ju(e.target);if(c&&((!U||!U.isConnected)&&(U=document.getElementById("task-list")),!(U&&!U.contains(c)))){var y=c.getAttribute("data-action"),S=c.getAttribute("data-id");if(!(!y||!S)){var w={toggle:window.toggleTask,run:window.runTask,edit:window.editTask,copy:window.copyPrompt,duplicate:window.duplicateTask,move:window.moveTaskToCurrentWorkspace,delete:window.deleteTask},N=w[y];typeof N=="function"&&(e.preventDefault(),N(S))}}});function Ze(e){if(Array.isArray(e)&&(W=e.filter(Boolean)),(!U||!U.isConnected)&&(U=document.getElementById("task-list")),!U)return;var t=Array.isArray(W)?W.filter(Boolean):[];t=Ll(t),ct&&(t=t.filter(function(b){return oo(b).indexOf(ct)!==-1}));var a="";function n(b){if(!b)return"";var M=String(b).replace(/\\/g,"/");return M==="/"||(M=M.replace(/\/+$/,""),M==="")?"/":rc?M.toLowerCase():M}function i(b){if(!b)return"";var M=String(b).replace(/[/\\]+$/,""),ce=M.split(/[/\\]+/);return ce.length?ce[ce.length-1]||"":M}function l(b){if(!b||!b.id)return"";var M=b.enabled||!1,ce=M?"enabled":"disabled",bt=M?r.labelEnabled:r.labelDisabled,Qe=M?"\u23F8\uFE0F":"\u25B6\uFE0F",Ao=M?r.actionDisable:r.actionEnable,Wt=b.nextRun?new Date(b.nextRun):null,wd=Wt&&!isNaN(Wt.getTime())?Wt.getTime():0,Zu=Wt&&!isNaN(Wt.getTime())?Wt.toLocaleString(ht):r.labelNever,Ei=typeof b.prompt=="string"?b.prompt:"",Qu=Ei.length>100?Ei.substring(0,100)+"...":Ei,Cd=typeof b.lastError=="string"?b.lastError:"",Ii=b.lastErrorAt?new Date(b.lastErrorAt):null,Bd=Ii&&!isNaN(Ii.getTime())?Ii.toLocaleString(ht):"",ef=d(b.cronExpression||""),tf=_r(b.cronExpression||""),af=d(b.name||""),Ut=b.scope||"workspace",xd=Ut==="global"?r.labelScopeGlobal||"":r.labelScopeWorkspace||"",To=Ut==="workspace"&&b.workspacePath||"",Ld=To?i(To):"",Eo=Ut==="global"?!0:!!To&&(ac||[]).some(function(_t){return n(_t)===n(To)}),rf=r.labelOtherWorkspaceShort||"",nf=r.labelThisWorkspaceShort||"",jd=Ut==="global"?"\u{1F310} "+d(xd):"\u{1F4C1} "+d(xd)+(Ld?" \u2022 "+d(Ld):"");Ut==="workspace"&&(jd+=" \u2022 "+d(Eo?nf:rf));var of=b.oneTime===!0?'<span class="task-badge clickable" data-action="toggle" data-id="'+v(b.id||"")+'">'+d(r.labelOneTime||"One-time")+"</span>":"",sf=b.oneTime===!0||b.manualSession!==!0?"":'<span class="task-badge" title="'+v(r.labelManualSession||"Manual session")+'">'+d(r.labelManualSession||"Manual session")+"</span>",lf=b.oneTime===!0?"":'<span class="task-badge" title="'+v(r.labelChatSession||"Recurring chat session")+'">'+d(b.chatSession==="continue"?r.labelChatSessionBadgeContinue||"Chat: Continue":r.labelChatSessionBadgeNew||"Chat: New")+"</span>",Dd=oo(b).map(function(_t){return'<span class="task-badge label">'+d(_t)+"</span>"}).join(""),et=v(b.id||"");function Md(_t,Io,Wa,Ci,ff){var vf=Io||ff||"",Zr=Io||"",Fd=!Zr,Bi='<option value="">'+d(Ci)+"</option>";return Array.isArray(_t)&&_t.forEach(function(wo){var Qr=wo.id||wo.slug;if(Qr){var pf=Wa&&Wa.indexOf("model")>=0?F(wo):wo.name||Qr;Qr===Zr&&(Fd=!0);var mf=Qr===vf?" selected":"";Bi+='<option value="'+v(Qr)+'"'+mf+">"+d(pf)+"</option>"}}),Zr&&!Fd&&(Bi+='<option value="'+v(Zr)+'" selected>'+d(Zr)+"</option>"),'<select class="'+Wa+'" data-id="'+et+'" style="width: auto; max-width: 140px; display: inline-block; padding: 2px 4px; margin-right: 8px; height: 26px; font-size: 11px;">'+Bi+"</select>"}var df=Md($t,b.agent,"task-agent-select",r.placeholderSelectAgent||"Agent",ue&&ue.agent),cf=Md(Gt,b.model,"task-model-select",r.placeholderSelectModel||"Model",ue&&ue.model),uf='<div class="task-config" style="margin: 4px 0 8px 0; display: flex; align-items: center;">'+df+cf+"</div>",wi='<button class="btn-secondary btn-icon" data-action="toggle" data-id="'+et+'" title="'+v(Ao)+'">'+Qe+'</button><button class="btn-secondary btn-icon" data-action="run" data-id="'+et+'" title="'+v(r.actionRun)+'">\u{1F680}</button><button class="btn-secondary btn-icon" data-action="edit" data-id="'+et+'" title="'+v(r.actionEdit)+'">\u270F\uFE0F</button><button class="btn-secondary btn-icon" data-action="copy" data-id="'+et+'" title="'+v(r.actionCopyPrompt)+'">\u{1F4CB}</button><button class="btn-secondary btn-icon" data-action="duplicate" data-id="'+et+'" title="'+v(r.actionDuplicate)+'">\u{1F4C4}</button>';return Ut==="workspace"&&!Eo&&(wi+='<button class="btn-secondary btn-icon" data-action="move" data-id="'+et+'" title="'+v(r.actionMoveToCurrentWorkspace||"")+'">\u{1F4CC}</button>',filters.showRecurringTasks===!0&&visibleSections.sort(function(_t,Io){var Wa=qt(_t.id),Ci=qt(Io.id);return Wa===Ci?0:Wa?-1:1})),(Ut==="global"||Eo)&&(wi+='<button class="btn-danger btn-icon" data-action="delete" data-id="'+et+'" title="'+v(r.actionDelete)+'">\u{1F5D1}\uFE0F</button>'),'<div class="task-card '+(M?"":"disabled")+(Ut==="workspace"&&!Eo?" other-workspace":"")+'" data-id="'+et+'"><div class="task-header"><div class="task-header-main"><span class="task-name clickable" data-action="toggle" data-id="'+et+'">'+af+"</span>"+sf+lf+of+'</div><span class="task-status '+ce+'" data-action="toggle" data-id="'+et+'">'+d(bt)+'</span></div><div class="task-info"><span>\u23F0 '+d(tf)+"</span><span>"+d(r.labelNextRun)+': <span class="task-next-run-label">'+d(Zu)+'</span><span class="task-next-run-countdown" data-enabled="'+(M?"true":"false")+'" data-next-run-ms="'+v(wd>0?String(wd):"")+'"></span></span><span>'+jd+'</span></div><div class="task-info"><span>Cron: '+ef+"</span></div>"+(Dd?'<div class="task-badges">'+Dd+"</div>":"")+uf+'<div class="task-prompt">'+d(Qu)+"</div>"+(Cd?'<div class="task-prompt" style="color: var(--vscode-errorForeground);">Last error'+(Bd?" ("+d(Bd)+")":"")+": "+d(Cd)+"</div>":"")+'<div class="task-actions">'+wi+"</div></div>"}function g(b,M,ce){var bt=ce.map(l).filter(Boolean).join("");bt||(bt='<div class="empty-state">'+d(r.noTasksFound)+"</div>");var Qe=sa[b]===!0;return'<div class="task-section'+(Qe?" is-collapsed":"")+'" data-task-section="'+v(b)+'"><div class="task-section-title"><button type="button" class="task-section-toggle" data-task-section-toggle="'+v(b)+'" aria-expanded="'+(Qe?"false":"true")+'" title="'+v(Qe?r.boardSectionExpand||"Expand section":r.boardSectionCollapse||"Collapse section")+'">&#9660;</button><span>'+d(M)+"</span><span>"+String(ce.length)+'</span></div><div class="task-section-body"><div class="task-section-body-inner">'+bt+"</div></div></div>"}function c(b,M,ce,bt){var Qe=sa[b]===!0;return'<div class="task-section'+(Qe?" is-collapsed":"")+'" data-task-section="'+v(b)+'"><div class="task-section-title"><button type="button" class="task-section-toggle" data-task-section-toggle="'+v(b)+'" aria-expanded="'+(Qe?"false":"true")+'" title="'+v(Qe?r.boardSectionExpand||"Expand section":r.boardSectionCollapse||"Collapse section")+'">&#9660;</button><span>'+d(M)+'</span><span class="task-section-count">'+String(bt)+'</span></div><div class="task-section-body"><div class="task-section-body-inner">'+ce+"</div></div></div>"}function y(b,M){var ce=M.map(l).filter(Boolean).join("");return ce||(ce='<div class="empty-state">'+d(r.noTasksFound)+"</div>"),'<div class="task-subsection"><div class="task-subsection-title"><span class="task-subsection-name">'+d(b)+'</span><span class="task-subsection-count">'+String(M.length)+'</span></div><div class="task-subsection-body">'+ce+"</div></div>"}function S(b){return!!(b&&Array.isArray(b.labels)&&b.labels.some(function(M){return I(M)==="from-todo-cockpit"}))}function w(b){return!!(b&&b.jobId)}function N(b){if(!b)return"";var M=d(b.title||"Untitled Todo"),ce=d(Jl(b.description||"")),bt=d(Jt(b.priority||"none")),Qe=b.dueAt?"<span>"+d(r.boardDueLabel||"Due")+": "+d(vo(b.dueAt))+"</span>":"",Ao=Array.isArray(b.labels)?b.labels.slice(0,6).map(function(Wt){return'<span class="task-badge label">'+d(Wt)+"</span>"}).join(""):"";return'<div class="task-card todo-draft-candidate" data-ready-todo-id="'+v(b.id||"")+'"><div class="task-header"><div class="task-header-main"><span class="task-name">'+M+'</span><span class="task-badge">Ready Todo</span></div><span class="task-status enabled">'+d(r.boardFlagPresetReady||"Ready")+'</span></div><div class="task-info"><span>'+d(r.boardWorkflowLabel||"Workflow")+": "+d(r.boardFlagPresetReady||"Ready")+"</span><span>Priority: "+bt+"</span>"+Qe+"</div>"+(Ao?'<div class="task-badges">'+Ao+"</div>":"")+'<div class="task-prompt">'+ce+'</div><div class="task-actions"><button class="btn-secondary" data-ready-todo-open="'+v(b.id||"")+'">Open Todo</button><button class="btn-primary" data-ready-todo-create="'+v(b.id||"")+'">Create Draft</button></div></div>'}var p=t.filter(function(b){if(!b)return!1;var M=b.oneTime===!0||b.id&&b.id.indexOf("exec-")===0;return!M&&!w(b)&&b.manualSession===!0}),m=t.filter(function(b){return!!b&&w(b)}),x=t.filter(function(b){if(!b)return!1;var M=b.oneTime===!0||b.id&&b.id.indexOf("exec-")===0;return!M&&!w(b)&&b.manualSession!==!0}),D=t.filter(function(b){if(!b)return!1;var M=b.oneTime===!0||b.id&&b.id.indexOf("exec-")===0;return M&&!w(b)&&S(b)}),P=xc(),k=t.filter(function(b){if(!b)return!1;var M=b.oneTime===!0||b.id&&b.id.indexOf("exec-")===0;return M&&!w(b)&&!S(b)}),J="";if(m.length>0){var z=Object.create(null);m.forEach(function(b){var M=String(b.jobId||"");if(M){if(!z[M]){var ce=ft(M);z[M]={title:ce&&ce.name?String(ce.name):M,items:[]}}z[M].items.push(b)}});var re=Object.keys(z).map(function(b){return{id:b,title:z[b].title,items:z[b].items}}).sort(function(b,M){return b.title.localeCompare(M.title)});J=c("jobs",r.labelJobTasks||"Jobs",re.map(function(b){return y(b.title,b.items)}).join(""),m.length)}else J=c("jobs",r.labelJobTasks||"Jobs",'<div class="empty-state">'+d(r.noTasksFound)+"</div>",0);var Te="",te="";if((je==="all"||je==="manual")&&(Te+=g("manual",r.labelManualSessions||"Manual Sessions",p)),je==="all"&&(Te+=J),(je==="all"||je==="recurring")&&(Te+=g("recurring",r.labelRecurringTasks||"Recurring Tasks",x)),je==="all"||je==="one-time"){var mt=P.length>0?'<div class="note" style="margin-bottom:8px;">'+d(String(P.length)+" ready todos are waiting for task draft creation.")+"</div>":"",gt=P.map(N).filter(Boolean).join(""),ko=D.map(l).filter(Boolean).join(""),Gr=mt+gt+ko;Gr||(Gr='<div class="empty-state">'+d(r.noTasksFound)+"</div>"),te+=c("todo-draft",r.labelTodoTaskDrafts||"Todo Task Drafts",Gr,P.length+D.length)}(je==="all"||je==="one-time")&&(te+=g("one-time",r.labelOneTimeTasks||"One-time Tasks",k));var Ed="task-sections",Id="";je!=="all"&&(Ed+=" filtered",Id=' style="display:grid;grid-template-columns:1fr;"');var Gu=je==="all"?'<div class="task-sections-column task-sections-column-primary">'+Te+'</div><div class="task-sections-column task-sections-column-secondary">'+te+"</div>":Te+te;if(a='<div class="'+Ed+'"'+Id+">"+Gu+"</div>",a!==Hi){if(cd()){sn=!0;return}sn=!1,Hi=a,U.innerHTML=a,R()}}function Du(){!sn||cd()||(sn=!1,Ze(W))}function dd(e,t,a){if(e){var n={};n[t]=a,o.postMessage({type:"updateTask",taskId:e,data:n})}}U&&(U.addEventListener("change",function(e){var t=e&&e.target;if(!(!t||!t.classList)){if(t.classList.contains("task-agent-select")){dd(t.getAttribute("data-id")||"","agent",t.value||"");return}t.classList.contains("task-model-select")&&dd(t.getAttribute("data-id")||"","model",t.value||"")}}),U.addEventListener("focusout",function(e){var t=e&&e.target;!t||!t.classList||!t.classList.contains("task-agent-select")&&!t.classList.contains("task-model-select")||setTimeout(function(){Du()},0)}));function d(e){if(e==null)return"";var t=document.createElement("div");return t.textContent=String(e),t.innerHTML}function v(e){return typeof e!="string"&&(e=String(e||"")),e.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function cd(){var e=document.activeElement;return!e||!e.classList?!1:e.classList.contains("task-agent-select")||e.classList.contains("task-model-select")}var Mu=[r.daySun||"",r.dayMon||"",r.dayTue||"",r.dayWed||"",r.dayThu||"",r.dayFri||"",r.daySat||""];function Ja(e){var t=parseInt(String(e),10);return isNaN(t)&&(t=0),t<10?"0"+t:String(t)}function de(e,t,a,n){var i=parseInt(String(e),10);return isNaN(i)&&(i=n),i=Math.max(t,Math.min(a,i)),i}function Fu(e){var t=String(e||"").trim().toLowerCase();if(/^\d+$/.test(t)){var a=parseInt(t,10);if(a===7&&(a=0),a>=0&&a<=6)return a}var n={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6};return n.hasOwnProperty(t)?n[t]:null}function yo(e,t){return Ja(e)+":"+Ja(t)}function _r(e){var t=r.labelFriendlyFallback||"",a=(e||"").trim();if(!a)return t;var n=a.split(/\s+/);if(n.length!==5)return t;var i=n[0],l=n[1],g=n[2],c=n[3],y=n[4],S=function(te){return/^\d+$/.test(String(te))},w=String(y||"").toLowerCase(),N=w==="1-5"||w==="mon-fri",p=/^\*\/(\d+)$/.exec(i);if(p&&l==="*"&&g==="*"&&c==="*"&&y==="*"){var m=r.cronPreviewEveryNMinutes||"";return m?m.replace("{n}",String(p[1])):t}if(S(i)&&l==="*"&&g==="*"&&c==="*"&&y==="*"){var x=r.cronPreviewHourlyAtMinute||"";return x?x.replace("{m}",String(i)):t}if(S(i)&&S(l)&&g==="*"&&c==="*"&&y==="*"){var D=r.cronPreviewDailyAt||"",P=yo(l,i);return D?D.replace("{t}",String(P)):t}if(S(i)&&S(l)&&g==="*"&&c==="*"&&N){var k=r.cronPreviewWeekdaysAt||"",P=yo(l,i);return k?k.replace("{t}",String(P)):t}var J=Fu(y);if(S(i)&&S(l)&&g==="*"&&c==="*"&&J!==null){var z=Mu[J]||String(J),re=r.cronPreviewWeeklyOnAt||"",P=yo(l,i);return re?re.replace("{d}",String(z)).replace("{t}",String(P)):t}if(S(i)&&S(l)&&S(g)&&c==="*"&&y==="*"){var Te=r.cronPreviewMonthlyOnAt||"",P=yo(l,i);return Te?Te.replace("{dom}",String(g)).replace("{t}",String(P)):t}return t}function za(){!ns||!Ce||(ns.textContent=_r(Ce.value||""))}function Yr(){!Ts||!fe||(Ts.textContent=_r(fe.value||""),Dc())}function Kr(){var e=Tt?Tt.value:"",t=[];switch(e){case"every-n":t=["interval"];break;case"hourly":t=["minute"];break;case"daily":t=["hour","minute"];break;case"weekly":t=["dow","hour","minute"];break;case"monthly":t=["dom","hour","minute"];break;default:t=[]}for(var a=Wi?Wi.querySelectorAll(".friendly-field"):[],n=0;n<a.length;n++){var i=a[n];if(!(!i||!i.getAttribute)){var l=i.getAttribute("data-field");t.indexOf(l)!==-1?(i.classList&&i.classList.add("visible"),i.style&&(i.style.display="block")):(i.classList&&i.classList.remove("visible"),i.style&&(i.style.display="none"))}}}function Xr(){var e=Ba?Ba.value:"",t=[];switch(e){case"every-n":t=["interval"];break;case"hourly":t=["minute"];break;case"daily":t=["hour","minute"];break;case"weekly":t=["dow","hour","minute"];break;case"monthly":t=["dom","hour","minute"];break;default:t=[]}for(var a=Is?Is.querySelectorAll(".friendly-field"):[],n=0;n<a.length;n++){var i=a[n];if(!(!i||!i.getAttribute)){var l=i.getAttribute("data-field");t.indexOf(l)!==-1?(i.classList&&i.classList.add("visible"),i.style&&(i.style.display="block")):(i.classList&&i.classList.remove("visible"),i.style&&(i.style.display="none"))}}}function Pu(){if(!(!Tt||!Ce)){var e=Tt.value,t="";switch(e){case"every-n":{var a=de(Qi?Qi.value:"",1,59,5);t="*/"+a+" * * * *";break}case"hourly":{var n=de(Et?Et.value:"",0,59,0);t=n+" * * * *";break}case"daily":{var i=de(Et?Et.value:"",0,59,0),l=de(ba?ba.value:"",0,23,9);t=i+" "+l+" * * *";break}case"weekly":{var g=de(Et?Et.value:"",0,59,0),c=de(ba?ba.value:"",0,23,9),y=de(es?es.value:"",0,6,1);t=g+" "+c+" * * "+y;break}case"monthly":{var S=de(Et?Et.value:"",0,59,0),w=de(ba?ba.value:"",0,23,9),N=de(ts?ts.value:"",1,31,1);t=S+" "+w+" "+N+" * *";break}default:t=""}t&&(Ce.value=t,st&&(st.value=""),za())}}function Ru(){if(!(!Ba||!fe)){var e=Ba.value,t="";switch(e){case"every-n":{var a=de(ws?ws.value:"",1,59,5);t="*/"+a+" * * * *";break}case"hourly":{var n=de(Lt?Lt.value:"",0,59,0);t=n+" * * * *";break}case"daily":{var i=de(Lt?Lt.value:"",0,59,0),l=de(xa?xa.value:"",0,23,9);t=i+" "+l+" * * *";break}case"weekly":{var g=de(Lt?Lt.value:"",0,59,0),c=de(xa?xa.value:"",0,23,9),y=de(Cs?Cs.value:"",0,6,1);t=g+" "+c+" * * "+y;break}case"monthly":{var S=de(Lt?Lt.value:"",0,59,0),w=de(xa?xa.value:"",0,23,9),N=de(Bs?Bs.value:"",1,31,1);t=S+" "+w+" "+N+" * *";break}default:t=""}t&&(fe.value=t,dt&&(dt.value=""),Yr())}}function Si(){tr&&tr.reset(),Kl(null),ge="",be="",we="",Ro=!0,$r("inline"),Tt&&(Tt.value=""),At&&(At.value=String(No)),wt&&(wt.value="");var e=document.getElementById("run-first");e&&(e.checked=!1);var t=document.getElementById("one-time");t&&(t.checked=!1);var a=document.getElementById("manual-session");a&&(a.checked=!1),ke&&(ke.value=va),Z&&(Z.value=ue.agent||""),Q&&(Q.value=ue.model||""),Or(),Kr(),za()}function ud(){Qd({agentSelect:Z,agents:$t,escapeAttr:v,escapeHtml:d,executionDefaults:ue,strings:r})}function fd(){ec({escapeAttr:v,escapeHtml:d,executionDefaults:ue,formatModelLabel:F,modelSelect:Q,models:Gt,strings:r})}function vd(e,t){if(_){t=t||"";var a=Array.isArray(xo)?xo:[],n=a.filter(function(g){return g.source===e}),i=r.placeholderSelectTemplate||"",l='<option value="">'+d(i)+"</option>";if(_.innerHTML=l+n.map(function(g){return'<option value="'+v(g.path)+'">'+d(g.name)+"</option>"}).join(""),!t){_.value="";return}_.value=t,_.value!==t&&(_.value="")}}function $r(e,t){var a=e||"inline",n=t&&_?_.value:"",i=a==="inline";if(Zi&&(Zi.required=i),_&&(_.required=!i),i){St&&(St.style.display="none"),nr&&(nr.style.display="block"),!t&&_&&(_.value="");return}St?St.style.display="block":console.warn("[CopilotScheduler] Template select group missing; template selection is disabled."),nr&&(nr.style.display="block"),vd(a,n)}function pd(){if(dn){var e=Array.isArray(Xa)?Xa:[],t=r.placeholderSelectSkill||"Select a skill";dn.innerHTML='<option value="">'+d(t)+"</option>"+e.map(function(a){return'<option value="'+v(a.path||"")+'">'+d(a.reference||a.name||"")+"</option>"}).join("")}}function Nu(){if(!(!dn||!nr)){var e=dn.value||"";if(e){var t=(Array.isArray(Xa)?Xa:[]).find(function(c){return c&&c.path===e});if(t){var a=document.querySelector('input[name="prompt-source"][value="inline"]');a&&(a.checked=!0),$r("inline",!1);var n=document.getElementById("prompt-text");if(n){var i=r.skillSentenceTemplate||"Use {skill} to know how things must be done.",l=i.replace("{skill}",t.reference||t.name||"skill"),g=n.value||"";n.value=g.trim()?g.replace(/\s*$/,`

`)+l:l,typeof n.focus=="function"&&n.focus()}}}}}function rt(e,t,a,n,i,l){if(e){var g=Array.isArray(t)?t:[],c=n||"",y=!c,S='<option value="">'+d(a||"")+"</option>"+g.map(function(w){var N=i(w),p=l(w);return N===c&&(y=!0),'<option value="'+v(N)+'">'+d(p)+"</option>"}).join("");c&&!y&&(S+='<option value="'+v(c)+'" selected>'+d(c)+"</option>"),e.innerHTML=S,e.value=c,e.value!==c&&(e.value="")}}function md(e){rt(We,Array.isArray(Yt)?Yt.slice().sort(function(t,a){return String(t&&t.name||"").localeCompare(String(a&&a.name||""))}):[],r.jobsRootFolder||"All jobs",e||"",function(t){return t&&t.id?t.id:""},function(t){var a=no(t),n=new Array(a+1).join("  ");return n+(t&&t.name?t.name:"")})}function ho(){rt(mr,$t,r.placeholderSelectAgent||"Select agent",mr?mr.value:"",function(e){return e&&e.id?e.id:""},function(e){return e&&e.name?e.name:""}),rt(gr,Gt,r.placeholderSelectModel||"Select model",gr?gr.value:"",function(e){return e&&e.id?e.id:""},function(e){return e&&e.name?e.name:""})}function ki(){var e=jc();rt(ja,e,r.jobsNoStandaloneTasks||"No standalone tasks available",ja?ja.value:"",function(t){return t&&t.id?t.id:""},function(t){if(!t||!t.name)return"";if(!t.jobId)return t.name;var a=ft(t.jobId);return a&&a.name?t.name+" \xB7 "+a.name:t.name}),Ln&&(Ln.disabled=e.length===0)}function gd(){var e=Array.isArray(Kt)?Kt:[];if(la){Dt&&(Dt.value="");return}var t=e.some(function(a){return a&&a.id===$});t||($=e.length>0&&e[0]?e[0].id:""),Dt&&(Dt.value=$||"")}function Ai(){Da&&(Da.textContent="",Da.style.display="none")}function Ou(e){Da&&(Da.textContent=String(e||""),Da.style.display=e?"block":"none")}function So(e){if(!e)return"-";var t=new Date(e);return isNaN(t.getTime())?String(e):t.toLocaleString(ht)}function bd(e,t){if(!e)return"-";var a=new Date(e).getTime();if(!isFinite(a))return"-";var n=t?new Date(t).getTime():Date.now();if(!isFinite(n)||n<a)return"-";var i=Math.max(0,Math.floor((n-a)/1e3));return T(i)}function Hu(e){return String(e||"").replace(/-/g," ")}function qu(e){return(Array.isArray(Xt)?Xt:[]).find(function(t){return t&&t.id===e})}function yd(){var e=Array.isArray(Xt)?Xt:[],t=Ie&&Ie.id?Ie.id:"",a=e.some(function(n){return n&&n.id===Je});if(!a){if(t){Je=t;return}Je=e.length>0&&e[0]?e[0].id:""}}function Ju(){return yd(),qu(Je)||null}function zu(e){return String(e||"").split(/\r?\n/).map(function(t){return String(t||"").trim()}).filter(function(t){return t.length>0})}function hd(){return(Array.isArray(Kt)?Kt:[]).find(function(e){return e&&e.id===$})}function Sd(e){return e==="running"?r.researchStatusRunning||"Running":e==="stopping"?r.researchStatusStopping||"Stopping":e==="completed"?r.researchStatusCompleted||"Completed":e==="failed"?r.researchStatusFailed||"Failed":e==="stopped"?r.researchStatusStopped||"Stopped":r.researchStatusIdle||"Idle"}function Vu(){return{name:r.researchAutoAgentExampleName||"AutoAgent Harbor Example",instructions:r.researchAutoAgentExampleInstructions||"Use this preset inside the autoagent repo to improve the Harbor agent harness score by editing agent.py while refining the experiment directive in program.md. Start with one representative task, keep the editable surface small, and make sure the benchmark command prints a final numeric score or reward line that matches the regex before you run the loop.",editablePaths:["agent.py","program.md"],benchmarkCommand:'uv run harbor run -p tasks/ --task-name "<task-name>" -l 1 -n 1 --agent-import-path agent:AutoAgent -o jobs --job-name latest',metricPattern:"(?:score|reward)\\s*[:=]\\s*([0-9.]+)",metricDirection:"maximize",maxIterations:8,maxMinutes:90,maxConsecutiveFailures:3,benchmarkTimeoutSeconds:900,editWaitSeconds:45,agent:"",model:""}}function Va(e){var t=e||null;$=t&&t.id?t.id:"",lc=$||"",Nr=!1,la=!$,Ai(),Dt&&(Dt.value=$||""),Ge&&(Ge.value=t&&t.name?t.name:""),br&&(br.value=t&&t.instructions?t.instructions:""),yr&&(yr.value=t&&Array.isArray(t.editablePaths)?t.editablePaths.join(`
`):""),hr&&(hr.value=t&&t.benchmarkCommand?t.benchmarkCommand:""),Sr&&(Sr.value=t&&t.metricPattern?t.metricPattern:""),kr&&(kr.value=t&&t.metricDirection==="minimize"?"minimize":"maximize"),Ar&&(Ar.value=String(t&&t.maxIterations!==void 0?t.maxIterations:3)),Tr&&(Tr.value=String(t&&t.maxMinutes!==void 0?t.maxMinutes:15)),Er&&(Er.value=String(t&&t.maxConsecutiveFailures!==void 0?t.maxConsecutiveFailures:2)),Ir&&(Ir.value=String(t&&t.benchmarkTimeoutSeconds!==void 0?t.benchmarkTimeoutSeconds:180)),wr&&(wr.value=String(t&&t.editWaitSeconds!==void 0?t.editWaitSeconds:20)),Mt&&(Mt.value=t&&t.agent?t.agent:""),Ft&&(Ft.value=t&&t.model?t.model:""),ye()}function Wu(){return{name:Ge?Ge.value:"",instructions:br?br.value:"",editablePaths:zu(yr?yr.value:""),benchmarkCommand:hr?hr.value:"",metricPattern:Sr?Sr.value:"",metricDirection:kr&&kr.value==="minimize"?"minimize":"maximize",maxIterations:Ar?Number(Ar.value||0):0,maxMinutes:Tr?Number(Tr.value||0):0,maxConsecutiveFailures:Er?Number(Er.value||0):0,benchmarkTimeoutSeconds:Ir?Number(Ir.value||0):0,editWaitSeconds:wr?Number(wr.value||0):0,agent:Mt?Mt.value:"",model:Ft?Ft.value:""}}function Uu(e){return String(e.name||"").trim()?String(e.benchmarkCommand||"").trim()?String(e.metricPattern||"").trim()?!Array.isArray(e.editablePaths)||e.editablePaths.length===0?r.researchEditableRequired||"Add at least one editable file path.":"":r.researchMetricRequired||"Metric regex is required.":r.researchBenchmarkRequired||"Benchmark command is required.":r.researchProfileNameRequired||"Research profile name is required."}function Ti(){rt(Mt,$t,r.placeholderSelectAgent||"Select agent",Mt?Mt.value:"",function(e){return e&&e.id?e.id:""},function(e){return e&&e.name?e.name:""}),rt(Ft,Gt,r.placeholderSelectModel||"Select model",Ft?Ft.value:"",function(e){return e&&e.id?e.id:""},function(e){return e&&e.name?e.name:""})}function _u(){if(gd(),!!Cr){var e=Array.isArray(Kt)?Kt.slice():[];if(e.sort(function(t,a){return String(t&&t.name||"").localeCompare(String(a&&a.name||""))}),e.length===0){Cr.innerHTML='<div class="jobs-empty">'+d(r.researchEmptyProfiles||"No research profiles yet.")+"</div>",!Nr&&!la&&Va(null);return}Cr.innerHTML=e.map(function(t){var a=t&&t.id===$;return'<div class="research-card'+(a?" active":"")+'" data-research-id="'+v(t.id||"")+'"><div class="research-card-header"><strong>'+d(t.name||"")+'</strong><span class="jobs-pill">'+d(t.metricDirection==="minimize"?r.researchDirectionMinimize||"Minimize":r.researchDirectionMaximize||"Maximize")+'</span></div><div class="research-meta">'+d(t.benchmarkCommand||"")+'</div><div class="research-chip-row"><span class="research-chip">'+d((r.researchEditableCount||"Editable files")+": "+String((t.editablePaths||[]).length))+'</span><span class="research-chip">'+d((r.researchBudgetShort||"Budget")+": "+String(t.maxIterations||0)+" / "+String(t.maxMinutes||0)+"m")+'</span><span class="research-chip">'+d((r.researchMetricPatternShort||"Metric")+": "+String(t.metricPattern||""))+"</span></div></div>"}).join("")}}function Yu(){if(Br){var e=Array.isArray(Xt)?Xt:[];if(e.length===0){Br.innerHTML='<div class="jobs-empty">'+d(r.researchEmptyRuns||"No research runs yet.")+"</div>";return}Br.innerHTML=e.map(function(t){var a=Array.isArray(t.attempts)&&t.attempts.length>0?t.attempts[t.attempts.length-1]:null,n=t&&t.id===Je;return'<div class="research-run-card'+(n?" active":"")+'" data-run-id="'+v(t.id||"")+'"><div class="research-run-card-header"><strong>'+d(t.profileName||"")+'</strong><span class="jobs-pill">'+d(Sd(t.status))+'</span></div><div class="research-run-meta">'+d("Best: "+(t.bestScore!==void 0?String(t.bestScore):r.researchNoScore||"No score yet"))+`
`+d("Duration: "+bd(t.startedAt,t.finishedAt))+`
`+d("Attempts: "+String(Array.isArray(t.attempts)?t.attempts.length:0))+(a?`
`+d("Last: "+(a.summary||a.outcome||"")):"")+"</div></div>"}).join("")}}function Ku(){if(!(!Pn||!Vo)){var e=Ju();if(Hs&&(Hs.textContent=r.researchActiveRunTitle||"Run details"),!e){Pn.style.display="block",Vo.style.display="none",Pn.textContent=r.researchNoRunSelected||"Select a recent run to inspect its attempts.",Rn&&(Rn.innerHTML="");return}Pn.style.display="none",Vo.style.display="block";var t=Array.isArray(e.attempts)?e.attempts:[],a=t.length>0?t[t.length-1]:null;qs&&(qs.textContent=Sd(e.status)),Js&&(Js.textContent=e.bestScore!==void 0?String(e.bestScore):r.researchNoScore||"No score yet"),zs&&(zs.textContent=String(t.length)),Vs&&(Vs.textContent=a?String(a.outcome||"-"):"-"),Ws&&(Ws.textContent=[e.profileName||"",(r.researchStartedAt||"Started")+": "+So(e.startedAt),(r.researchFinishedAt||"Finished")+": "+So(e.finishedAt),(r.researchDuration||"Duration")+": "+bd(e.startedAt,e.finishedAt),(r.researchBaselineScore||"Baseline score")+": "+(e.baselineScore!==void 0?String(e.baselineScore):r.researchNoScore||"No score yet"),(r.researchBestScore||"Best score")+": "+(e.bestScore!==void 0?String(e.bestScore):r.researchNoScore||"No score yet"),(r.researchCompletedIterations||"Completed iterations")+": "+String(e.completedIterations||0),e.stopReason?(r.researchStopReason||"Stop reason")+": "+e.stopReason:""].filter(Boolean).join(`
`)),Rn&&(Rn.innerHTML=t.map(function(n){var i=n.iteration===0?r.researchBaselineLabel||"Baseline":(r.researchIterationLabel||"Iteration")+" "+n.iteration,l=[n.summary||"",(r.researchStartedAt||"Started")+": "+So(n.startedAt),n.finishedAt?(r.researchFinishedAt||"Finished")+": "+So(n.finishedAt):"",n.score!==void 0?"Score: "+String(n.score):"",n.bestScoreAfter!==void 0?(r.researchBestScore||"Best score")+": "+String(n.bestScoreAfter):"",n.exitCode!==void 0?(r.researchExitCode||"Exit code")+": "+String(n.exitCode):""].filter(Boolean),g=[];return Array.isArray(n.changedPaths)&&n.changedPaths.length>0&&g.push((r.researchChangedFiles||"Changed files")+": "+n.changedPaths.join(", ")),Array.isArray(n.policyViolationPaths)&&n.policyViolationPaths.length>0&&g.push((r.researchViolationFiles||"Policy violation files")+": "+n.policyViolationPaths.join(", ")),n.snapshot&&n.snapshot.label&&g.push((r.researchSnapshot||"Snapshot")+": "+n.snapshot.label),'<div class="research-attempt-card"><div class="research-attempt-card-header"><strong>'+d(i)+'</strong><span class="jobs-pill">'+d(Hu(n.outcome||""))+'</span></div><div class="research-attempt-meta">'+d(l.join(`
`))+"</div>"+(g.length>0?'<div class="research-attempt-paths">'+d(g.join(`
`))+"</div>":"")+(n.output?'<div class="research-output"><details><summary>'+d(r.researchBenchmarkOutput||"Benchmark output")+"</summary><pre>"+d(n.output)+"</pre></details></div>":"")+"</div>"}).join(""))}}function fa(){_u(),Yu(),Ku();var e=hd();Nr?Dt&&(Dt.value=$||""):Va(e||null),Fs&&(Fs.textContent=la?r.researchCreateProfile||r.researchSaveProfile||"Create Profile":r.researchSaveProfile||"Save Profile"),Ps&&(Ps.disabled=!$),Rs&&(Rs.disabled=!$),Ns&&(Ns.disabled=!$||Ie&&Ie.status==="running"),Os&&(Os.disabled=!(Ie&&(Ie.status==="running"||Ie.status==="stopping"))),ye()}function kd(e){Zn();var t=kc(),a=Ac(t);if(a){yl(a,!0);return}o.postMessage({type:e,data:t}),yl(e==="saveTelegramNotification"?r.telegramStatusSaved||"Saving Telegram settings...":r.telegramTest||"Sending test message...",!1)}function Ad(){Nr=!0,Ai()}function Xu(){[Ge,br,yr,hr,Sr,kr,Ar,Tr,Er,Ir,wr,Mt,Ft].forEach(function(e){!e||typeof e.addEventListener!="function"||(e.addEventListener("input",Ad),e.addEventListener("change",Ad))})}function $u(){var e=["#task-name","#prompt-text","#cron-expression","#task-labels","#agent-select","#model-select","#template-select","#jitter-seconds","#chat-session","#run-first","#one-time",'input[name="scope"]','input[name="prompt-source"]',"#todo-title-input","#todo-description-input","#todo-due-input","#todo-priority-input","#todo-section-input","#todo-linked-task-select","#todo-labels-input","#todo-label-color-input","#todo-flag-name-input","#todo-flag-color-input","#jobs-name-input","#jobs-cron-input","#jobs-folder-select"].join(", ");["input","change"].forEach(function(t){document.addEventListener(t,function(a){var n=a&&a.target;!n||typeof n.matches!="function"||n.matches(e)&&Me()})})}function pt(){if(Mc(),ye(),Me(),os){var e=Fc(),t=qr(e),a=ee?(e||{}).name||r.jobsRootFolder||"All jobs":r.jobsRootFolder||"All jobs";os.innerHTML='<div><span class="jobs-current-folder-label">'+d(r.jobsCurrentFolderLabel||"Current folder")+'</span><strong class="jobs-current-folder-name">'+d(t&&r.jobsArchiveFolderBadge||a)+'</strong><div class="jobs-folder-path">'+d(xl(ee))+'</div></div><span class="jobs-pill'+(t?" is-inactive":"")+'">'+d(r.jobsCurrentFolderBadge||"Current")+"</span>"}if(mn&&(mn.disabled=!ee),gn&&(gn.disabled=!ee),un){var n=(Array.isArray(Yt)?Yt.slice():[]).sort(function(k,J){var z=(qr(k)?1:0)-(qr(J)?1:0);if(z!==0)return z;var re=no(k)-no(J);return re!==0?re:String(k&&k.name||"").localeCompare(String(J&&J.name||""))}),i=ee?"jobs-folder-item":"jobs-folder-item active",l='<div class="'+i+'" data-job-folder=""><div class="jobs-folder-item-header"><span>'+d(r.jobsRootFolder||"All jobs")+'</span><span class="jobs-pill">'+String((Array.isArray(nt)?nt:[]).filter(function(k){return k&&!k.folderId}).length)+"</span></div></div>";l+=n.map(function(k){var J=no(k),z=k&&k.id===ee,re=qr(k)?" is-archive":"",Te=(Array.isArray(nt)?nt:[]).filter(function(gt){return gt&&gt.folderId===k.id}).length,te=new Array(J+1).join('<span class="jobs-folder-indent"></span>'),mt=xl(k.id);return'<div class="jobs-folder-item'+(z?" active":"")+re+'" data-job-folder="'+v(k.id||"")+'"><div class="jobs-folder-item-header"><span>'+te+d(k.name||"")+'</span><span class="jobs-pill">'+String(Te)+"</span></div>"+(qr(k)?'<div class="jobs-folder-path"><span class="jobs-pill is-inactive">'+d(r.jobsArchiveFolderBadge||"Archived jobs")+"</span></div>":'<div class="jobs-folder-path">'+d(mt)+"</div>")+"</div>"}).join(""),un.innerHTML=l||'<div class="jobs-empty">'+d(r.jobsNoFolders||"No folders yet.")+"</div>"}if(lt){var g=si();g.length===0?lt.innerHTML='<div class="jobs-empty">'+d(r.jobsNoJobs||"No jobs in this folder yet.")+"</div>":lt.innerHTML=g.map(function(k){var J=_r(k.cronExpression||""),z=J!==(r.labelFriendlyFallback||"")?J:k.cronExpression||"",re="";return k&&k.runtime&&k.runtime.waitingPause?re=" is-waiting":k&&(k.paused||k.archived)&&(re=" is-inactive"),'<div class="jobs-list-item'+(k.id===C?" active":"")+'" data-job-id="'+v(k.id||"")+'" draggable="true"><div class="jobs-list-item-header"><strong>'+d(k.name||"")+'</strong><span class="jobs-pill'+re+'">'+d(ri(k))+'</span></div><div class="jobs-list-item-meta-row" title="'+v(k.cronExpression||"")+'"><div class="jobs-list-item-meta">'+d(z)+" \u2022 "+String(Array.isArray(k.nodes)?k.nodes.length:0)+' items</div><div style="display:flex;align-items:center;gap:8px;">'+(k.archived?'<span class="jobs-pill is-inactive">'+d(r.jobsArchivedBadge||"Archived")+"</span>":"")+'<button type="button" class="btn-secondary" data-job-open-editor="'+v(k.id||"")+'">'+d(r.jobsOpenEditor||"Open editor")+"</button></div></div></div>"}).join("")}var c=ft(C),y=!c&&Re;if(ai(),!c&&!y){La&&(La.innerHTML=""),fn&&(fn.style.display="block"),vn&&(vn.style.display="none");return}c&&(Re=!1),Me(),fn&&(fn.style.display="none"),vn&&(vn.style.display="block");var S=c&&Array.isArray(c.nodes)?c.nodes:[],w=Bc(c),N=Cc(c),p=S.filter(function(k){return oi(k)}).length,m=Math.max(0,S.length-p),x=jl(c&&c.cronExpression||"");if(La&&(La.innerHTML=[{label:r.jobsWorkflowStatus||"Status",value:c?ri(c):r.jobsCreateJob||"New Job",tone:w?"is-waiting":c&&(c.paused||c.archived)?"is-muted":"is-accent"},{label:r.jobsWorkflowCadence||"Cadence",value:c?x:r.jobsEditorScheduleNote||"Define a schedule before saving.",tone:"is-accent",valueAttr:c?' data-jobs-workflow-cadence="1"':""},{label:r.jobsWorkflowTaskCount||"Task steps",value:String(m),tone:""},{label:r.jobsWorkflowPauseCount||"Pause checkpoints",value:String(p),tone:p>0?"is-accent":""}].map(function(k){return'<div class="jobs-workflow-metric'+(String(k.value||"").length>18?" is-compact":"")+(k.tone?" "+k.tone:"")+'" title="'+v(k.value)+'"><div class="jobs-workflow-metric-label">'+d(k.label)+'</div><div class="jobs-workflow-metric-value"'+(k.valueAttr||"")+">"+d(k.value)+"</div></div>"}).join("")),xt&&(xt.value=c&&c.name||""),fe&&(fe.value=c?c.cronExpression||"":"0 9 * * 1-5"),dt&&(dt.value=""),md(c?c.folderId||"":ee||""),jt&&(jt.textContent=c?ri(c):r.jobsRunning||"Running",jt.classList&&(jt.classList.toggle("is-inactive",!!(c&&(c.paused||c.archived))),jt.classList.toggle("is-waiting",!!w)),jt.disabled=!c),or&&(or.textContent=c&&c.paused?r.jobsResume||"Resume Job":r.jobsPause||"Pause Job",or.disabled=!c),hn&&(hn.disabled=!c||S.length===0),yn&&(yn.disabled=!c),Sn&&(Sn.disabled=!c),bn&&(bn.textContent=c?r.jobsSave||"Save Job":r.jobsCreateJob||"New Job"),Ls){var D=S.map(function(k,J){var z="";if(oi(k))z=(r.jobsPausePrefix||"Pause")+": "+(k.title||r.jobsPauseDefaultTitle||"Manual review");else{var re=ii(k.taskId);z=re&&re.name?re.name:(r.jobsStepPrefix||"Step")+" "+String(J+1)}return'<span class="jobs-timeline-node" title="'+v(z)+'">'+d(z)+"</span>"+(J<S.length-1?'<span class="jobs-timeline-arrow">\u2192</span>':"")}).join("");Ls.innerHTML=c&&D||d(r.jobsTimelineEmpty||"No steps yet")}if(ki(),ho(),Yr(),Xr(),zo){if(!c){zo.innerHTML='<div class="jobs-empty">'+d(r.jobsCreateJob||"Create Job")+": "+d(r.jobsSave||"Save Job")+"</div>";return}var P=S.map(function(k,J){if(oi(k)){var z=!!w&&w.nodeId===k.id,re=N.indexOf(k.id)>=0,Te=z?r.jobsPauseWaiting||"Waiting for approval":re?r.jobsPauseApproved||"Approved":r.jobsPauseDefaultTitle||"Manual review";return'<div class="jobs-step-card jobs-pause-card'+(z?" is-waiting":"")+'" draggable="true" data-job-node-id="'+v(k.id||"")+'"><div class="jobs-step-header"><strong title="'+v(k.title||"")+'">'+String(J+1)+". "+d(k.title||r.jobsPauseDefaultTitle||"Manual review")+'</strong><span class="jobs-pill'+(z?" is-waiting":"")+'">'+d(Te)+'</span></div><div class="jobs-pause-copy">'+d(r.jobsPauseHelpText||"This checkpoint blocks downstream steps until you approve the previous result.")+'</div><div class="jobs-step-toolbar"><button type="button" class="btn-secondary" data-job-action="edit-pause" data-job-node-id="'+v(k.id||"")+'">'+d(r.jobsPauseEdit||"Edit")+'</button><button type="button" class="btn-danger" data-job-action="delete-pause" data-job-node-id="'+v(k.id||"")+'">'+d(r.jobsPauseDelete||"Delete")+"</button>"+(z?'<button type="button" class="btn-primary" data-job-action="approve-pause" data-job-node-id="'+v(k.id||"")+'">'+d(r.jobsPauseApprove||"Approve")+'</button><button type="button" class="btn-secondary" data-job-action="reject-pause" data-job-node-id="'+v(k.id||"")+'">'+d(r.jobsPauseReject||"Reject and edit previous step")+"</button>":"")+"</div></div>"}var te=ii(k.taskId),mt=te&&te.name?te.name:"Missing task",gt=te&&te.prompt?String(te.prompt):"",ko=gt.length>120?gt.slice(0,120)+"...":gt,Gr=te&&te.nextRun?new Date(te.nextRun).toLocaleString(ht):r.labelNever||"Never";return'<div class="jobs-step-card" draggable="true" data-job-node-id="'+v(k.id||"")+'"><div class="jobs-step-header"><strong title="'+v(mt)+'">'+String(J+1)+". "+d(mt)+'</strong><span class="jobs-pill">'+d(String(k.windowMinutes||30)+"m")+'</span></div><div class="jobs-step-meta">'+d(r.labelNextRun||"Next run")+": "+d(Gr)+'</div><div class="jobs-step-summary" title="'+v(gt||ko)+'">'+d(ko||"-")+'</div><div class="jobs-inline-form"><div class="form-group"><input type="number" class="job-node-window-input" data-job-node-window-id="'+v(k.id||"")+'" min="1" max="1440" value="'+v(String(k.windowMinutes||30))+'"></div></div><div class="jobs-step-toolbar"><button type="button" class="btn-secondary" data-job-action="edit-task" data-job-task-id="'+v(k.taskId||"")+'">'+d(r.actionEdit||"Edit")+'</button><button type="button" class="btn-secondary" data-job-action="run-task" data-job-task-id="'+v(k.taskId||"")+'">'+d(r.actionRun||"Run")+'</button><button type="button" class="btn-danger" data-job-action="detach-node" data-job-node-id="'+v(k.id||"")+'">Delete</button></div></div>'}).join("");zo.innerHTML=P||'<div class="jobs-empty">'+d(r.jobsEmptySteps||"This job has no steps yet.")+"</div>"}}ud(),fd();var Td=document.querySelector('input[name="prompt-source"]:checked');Td&&$r(Td.value),ke&&!ke.value&&(ke.value=va),Or(),Kr(),za(),pd(),so(),ho(),md(""),ki(),pt(),Me(),window.runTask=function(e){o.postMessage({type:"runTask",taskId:e})},window.editTask=function(e){var t=Array.isArray(W)?W:[],a=t.find(function(p){return p&&p.id===e});if(a){Kl(e);var n=document.getElementById("task-name"),i=document.getElementById("prompt-text");n&&(n.value=a.name||""),wt&&(wt.value=Bl(a.labels)),i&&(i.value=typeof a.prompt=="string"?a.prompt:""),Ce&&(Ce.value=a.cronExpression||""),st&&(st.value=""),za(),ge=a.agent||"",be=a.model||"",Z&&(ge&&Ya(Z,ge)?(Z.value=ge,ge=""):ge&&(Z.value="")),Q&&(be&&Ya(Q,be)?(Q.value=be,be=""):be&&(Q.value="")),Ro=a.enabled!==!1;var l=a.scope||"workspace",g=document.querySelector('input[name="scope"][value="'+l+'"]');g&&(g.checked=!0);var c=a.promptSource||"inline",y=document.querySelector('input[name="prompt-source"][value="'+c+'"]');y&&(y.checked=!0),$r(c,!0),we=a.promptPath||"",_&&(we&&Ya(_,we)?(_.value=we,we=""):we&&(_.value="")),At&&(At.value=String(a.jitterSeconds??No));var S=document.getElementById("run-first");S&&(S.checked=!1);var w=document.getElementById("one-time");w&&(w.checked=a.oneTime===!0);var N=document.getElementById("manual-session");N&&(N.checked=a.oneTime===!0?!1:a.manualSession===!0),ke&&(ke.value=a.chatSession==="continue"?"continue":a.chatSession==="new"?"new":va),Or(),pe("create")}},cn&&cn.addEventListener("click",function(){Si(),pe("create");try{var e=document.getElementById("task-name");e&&typeof e.focus=="function"&&e.focus()}catch{}}),window.copyPrompt=function(e){o.postMessage({type:"copyTask",taskId:e})},window.duplicateTask=function(e){o.postMessage({type:"duplicateTask",taskId:e})},window.moveTaskToCurrentWorkspace=function(e){o.postMessage({type:"moveTaskToCurrentWorkspace",taskId:e})},window.toggleTask=function(e){o.postMessage({type:"toggleTask",taskId:e})},window.deleteTask=function(e){var t=W.find(function(a){return a&&a.id===e});t&&o.postMessage({type:"deleteTask",taskId:e})},window.addEventListener("message",function(e){var t=e.data;try{switch(t.type){case"updateTasks":W=Array.isArray(t.tasks)?t.tasks:[],V("updateTasks",{taskCount:W.length,selectedTodoId:B||"",isCreatingJob:Re}),so(),ki(),Ze(t.tasks),pt(),Ul(B?"":xe?xe.value:"");break;case"updateJobs":nt=Array.isArray(t.jobs)?t.jobs:[],so(),Ze(W),pt();break;case"updateJobFolders":Yt=Array.isArray(t.jobFolders)?t.jobFolders:[],pt();break;case"updateCockpitBoard":if(L=t.cockpitBoard||{version:4,sections:[],cards:[],filters:{labels:[],priorities:[],statuses:[],archiveOutcomes:[],flags:[],sortBy:"manual",sortDirection:"asc",viewMode:"board",showArchived:!1,showRecurringTasks:!1},updatedAt:""},Za){var a=qa(L.filters);Xc(a,Za)?Za=null:L=Object.assign({},L,{filters:qa(Object.assign({},a,Za))})}V("updateCockpitBoard",{sectionCount:Array.isArray(L.sections)?L.sections.length:0,cardCount:Array.isArray(L.cards)?L.cards.length:0,selectedTodoId:B||"",draftTitleLength:ie.title.length}),pa&&!L.cards.some(function(m){return m&&m.id===pa})&&Vt(),it&&!L.cards.some(function(m){return m&&m.id===it})&&(it="",Qa=!1),De(),so(),Ze(W),Ga(),qc(),vt(),Ue(),Na();break;case"updateResearchState":Kt=Array.isArray(t.profiles)?t.profiles:[],Ie=t.activeRun||null,Xt=Array.isArray(t.recentRuns)?t.recentRuns:[],Ie&&(!Je||Je===Ie.id)?Je=Ie.id:yd(),$||gd(),fa();break;case"updateTelegramNotification":Ye=t.telegramNotification||{enabled:!1,hasBotToken:!1,hookConfigured:!1},Sl();break;case"updateLogLevel":f=typeof t.logLevel=="string"&&t.logLevel?t.logLevel:"info",ze.setLogLevel(f),ti();break;case"updateStorageSettings":ot=Di(t.storageSettings,ot),kl();break;case"updateExecutionDefaults":ue=t.executionDefaults||{agent:"agent",model:""},V("updateExecutionDefaults",{agent:ue.agent||"",model:ue.model||"",editingTaskId:he||"",pendingAgentValue:ge,pendingModelValue:be}),ao(),he||(Z&&!ge&&!Z.value&&(Z.value=ue.agent||""),Q&&!be&&!Q.value&&(Q.value=ue.model||"")),Ze(W);break;case"updateReviewDefaults":me=t.reviewDefaults||{needsBotReviewCommentTemplate:"",needsBotReviewPromptTemplate:"",needsBotReviewAgent:"agent",needsBotReviewModel:"",needsBotReviewChatSession:"new",readyPromptTemplate:""},ro();break;case"updateAgents":{var n=ge||(Z?Z.value:"");V("updateAgents",{currentAgentValue:n,agentCount:Array.isArray(t.agents)?t.agents.length:0}),$t=Array.isArray(t.agents)?t.agents:[],ud(),ao(),ro(),ho(),Ti(),Z&&n&&(Z.value=n,Z.value===n?ge="":ge=n),Ze(W)}break;case"updateModels":{var i=be||(Q?Q.value:"");V("updateModels",{currentModelValue:i,modelCount:Array.isArray(t.models)?t.models.length:0}),Gt=Array.isArray(t.models)?t.models:[],fd(),ao(),ro(),ho(),Ti(),Q&&i&&(Q.value=i,Q.value===i?be="":be=i),Ze(W)}break;case"updatePromptTemplates":xo=Array.isArray(t.templates)?t.templates:[];{var l=document.querySelector('input[name="prompt-source"]:checked'),g=l?l.value:"inline",c=we||(_?_.value:"");vd(g,c),_&&c&&(_.value===c?we="":we=c),g==="local"||g==="global"?St&&(St.style.display="block"):St&&(St.style.display="none")}break;case"updateSkills":Xa=Array.isArray(t.skills)?t.skills:[],pd();break;case"updateAutoShowOnStartup":Lo=!!t.enabled,Il();break;case"updateScheduleHistory":$a=Array.isArray(t.entries)?t.entries:[],Cl();break;case"promptTemplateLoaded":var y=document.getElementById("prompt-text");y&&(y.value=t.content);break;case"switchToList":if(ma=!1,Ve&&(Ve.disabled=!1),le(),Si(),pe("list"),t.successMessage){var S=document.getElementById("success-toast");if(S){var w=r.webviewSuccessPrefix||"\u2714 ";S.textContent=w+t.successMessage,S.style.display="block",S.style.opacity="1",setTimeout(function(){S.style.opacity="0"},3e3),setTimeout(function(){S.style.display="none",S.style.opacity="1"},3500)}}break;case"switchToTab":t.tab&&pe(t.tab);break;case"focusTask":pe("list"),setTimeout(function(){for(var m=document.querySelectorAll(".task-card"),x=null,D=0;D<m.length;D++){var P=m[D];if(P&&P.getAttribute&&P.getAttribute("data-id")===t.taskId){x=P;break}}x&&x.scrollIntoView({behavior:"smooth"})},100);break;case"focusJob":ee=typeof t.folderId=="string"?t.folderId:"";var N=t.jobId||"";Re=!0,C="",ye(),pt(),pe("jobs"),setTimeout(function(){var m=N?document.querySelector('[data-job-id="'+N+'"]'):null;m&&typeof m.scrollIntoView=="function"&&m.scrollIntoView({behavior:"smooth",block:"nearest"})},50);break;case"focusResearchProfile":pe("research"),t.researchId?ad(t.researchId):(la=!0,$="",Va(null),fa()),setTimeout(function(){var m=t.researchId?'[data-research-id="'+t.researchId+'"]':"#research-name",x=document.querySelector(m);x&&(typeof x.scrollIntoView=="function"&&x.scrollIntoView({behavior:"smooth",block:"nearest"}),!t.researchId&&typeof x.focus=="function"&&x.focus())},50);break;case"focusResearchRun":pe("research"),t.runId&&rd(t.runId),setTimeout(function(){var m=t.runId?document.querySelector('[data-run-id="'+t.runId+'"]'):null;m&&typeof m.scrollIntoView=="function"&&m.scrollIntoView({behavior:"smooth",block:"nearest"})},50);break;case"editTask":t.taskId&&typeof window.editTask=="function"&&window.editTask(t.taskId);break;case"startCreateTask":ma=!1,Ve&&(Ve.disabled=!1),le(),Si(),pe("create"),setTimeout(function(){try{var m=document.getElementById("task-name");m&&typeof m.focus=="function"&&m.focus()}catch{}},0);break;case"startCreateTodo":V("startCreateTodo",{reason:"host"}),ku();break;case"startCreateJob":V("startCreateJob",{reason:"host"}),Iu();break;case"showError":t.text&&(_e(t.text),ma=!1,Ve&&(Ve.disabled=!1));break;case"todoFileUploadResult":t.ok&&t.insertedText?(gc(String(t.insertedText||"")),to(String(t.message||r.boardUploadFilesSuccess||""),"success")):t.cancelled?to(String(t.message||r.boardUploadFilesHint||""),"neutral"):to(String(t.message||r.boardUploadFilesError||""),"error");break}}catch(m){var w=r.webviewClientErrorPrefix||"",p=m&&m.message?m.message:m;p=String(p).split(/\r?\n/)[0],_e(w+ae(p)),ma=!1,Ve&&(Ve.disabled=!1)}}),Ze(W),pe(Bu()),window.addEventListener("scroll",function(){ut&&(pl(ut),ye()),gl(!1)},{passive:!0}),window.addEventListener("resize",Na),document.addEventListener("keydown",function(e){Cu(e),e.key==="Escape"&&(Vt(),hi())}),Na(),setInterval(function(){Ur("list")&&R()},1e3),o.postMessage({type:"webviewReady"})})();})();
>>>>>>> main
