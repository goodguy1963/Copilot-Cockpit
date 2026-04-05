export function createBoardRenderState() {
  return {
    draggingTodoId: null,
    isBoardDragging: false,
    pendingBoardRender: false,
    scheduledBoardRenderFrame: 0,
  };
}

export function requestBoardRender(state, requestAnimationFrameImpl, renderBoard) {
  if (state.isBoardDragging) {
    state.pendingBoardRender = true;
    return;
  }

  if (state.scheduledBoardRenderFrame) {
    return;
  }

  state.scheduledBoardRenderFrame = requestAnimationFrameImpl(function () {
    state.scheduledBoardRenderFrame = 0;
    if (state.isBoardDragging) {
      state.pendingBoardRender = true;
      return;
    }
    renderBoard();
  });
}

export function finishBoardDrag(state, resetSectionDragState, requestRender) {
  state.draggingTodoId = null;
  resetSectionDragState();
  state.isBoardDragging = false;
  if (!state.pendingBoardRender) {
    return;
  }

  state.pendingBoardRender = false;
  requestRender();
}
