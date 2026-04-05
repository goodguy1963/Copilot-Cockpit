export function handleTaskListClick(params) {
  var event = params.event;
  var taskList = params.taskList;
  var getTaskList = params.getTaskList;
  var readyTodoOpenTarget = params.getClosestEventTarget(
    event.target,
    "[data-ready-todo-open]",
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
