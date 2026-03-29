import type {
  CockpitBoard,
  TaskAction,
  WebviewToExtensionMessage,
} from "./types";

type OutgoingWebviewMessage = { type: string; [key: string]: unknown };

type TaskActionCallback = ((action: TaskAction) => void) | undefined;

export function createUpdateCockpitBoardMessage(
  cockpitBoard: CockpitBoard,
): OutgoingWebviewMessage {
  return {
    type: "updateCockpitBoard",
    cockpitBoard,
  };
}

export function createStartCreateTodoMessage(): OutgoingWebviewMessage {
  return { type: "startCreateTodo" };
}

export function handleTodoCockpitWebviewMessage(
  message: WebviewToExtensionMessage,
  onTaskActionCallback: TaskActionCallback,
): boolean {
  switch (message.type) {
    case "createTodo":
      onTaskActionCallback?.({
        action: "createTodo",
        taskId: "__todo__",
        todoData: message.data,
      });
      return true;

    case "updateTodo":
      onTaskActionCallback?.({
        action: "updateTodo",
        taskId: "__todo__",
        todoId: message.todoId,
        todoData: message.data,
      });
      return true;

    case "deleteTodo":
      onTaskActionCallback?.({
        action: "deleteTodo",
        taskId: "__todo__",
        todoId: message.todoId,
      });
      return true;

    case "purgeTodo":
      onTaskActionCallback?.({
        action: "purgeTodo",
        taskId: "__todo__",
        todoId: message.todoId,
      });
      return true;

    case "approveTodo":
      onTaskActionCallback?.({
        action: "approveTodo",
        taskId: "__todo__",
        todoId: message.todoId,
      });
      return true;

    case "rejectTodo":
      onTaskActionCallback?.({
        action: "rejectTodo",
        taskId: "__todo__",
        todoId: message.todoId,
      });
      return true;

    case "finalizeTodo":
      onTaskActionCallback?.({
        action: "finalizeTodo",
        taskId: "__todo__",
        todoId: message.todoId,
      });
      return true;

    case "archiveTodo":
      onTaskActionCallback?.({
        action: "archiveTodo",
        taskId: "__todo__",
        todoId: message.todoId,
        todoData: {
          archived: message.archived !== false,
        },
      });
      return true;

    case "moveTodo":
      onTaskActionCallback?.({
        action: "moveTodo",
        taskId: "__todo__",
        todoId: message.todoId,
        targetSectionId: message.sectionId,
        targetOrder: message.targetIndex,
      });
      return true;

    case "addTodoComment":
      onTaskActionCallback?.({
        action: "addTodoComment",
        taskId: "__todo__",
        todoId: message.todoId,
        todoCommentData: message.data,
      });
      return true;

    case "setTodoFilters":
      onTaskActionCallback?.({
        action: "setTodoFilters",
        taskId: "__todo__",
        todoFilters: message.data,
      });
      return true;

    case "saveTodoLabelDefinition":
      onTaskActionCallback?.({
        action: "saveTodoLabelDefinition",
        taskId: "__todo__",
        todoLabelData: message.data,
      });
      return true;

    case "deleteTodoLabelDefinition":
      onTaskActionCallback?.({
        action: "deleteTodoLabelDefinition",
        taskId: "__todo__",
        todoLabelData: { name: message.data.name },
      });
      return true;

    case "saveTodoFlagDefinition":
      onTaskActionCallback?.({
        action: "saveTodoFlagDefinition",
        taskId: "__todo__",
        todoFlagData: message.data,
      });
      return true;

    case "deleteTodoFlagDefinition":
      onTaskActionCallback?.({
        action: "deleteTodoFlagDefinition",
        taskId: "__todo__",
        todoFlagData: { name: message.data.name },
      });
      return true;

    case "linkTodoTask":
      onTaskActionCallback?.({
        action: "linkTodoTask",
        taskId: "__todo__",
        todoId: message.todoId,
        linkedTaskId: message.taskId,
      });
      return true;

    case "createTaskFromTodo":
      onTaskActionCallback?.({
        action: "createTaskFromTodo",
        taskId: "__todo__",
        todoId: message.todoId,
      });
      return true;

    case "addCockpitSection":
      onTaskActionCallback?.({
        action: "addCockpitSection",
        taskId: "__section__",
        sectionTitle: message.title,
      });
      return true;

    case "renameCockpitSection":
      onTaskActionCallback?.({
        action: "renameCockpitSection",
        taskId: "__section__",
        sectionId: message.sectionId,
        sectionTitle: message.title,
      });
      return true;

    case "deleteCockpitSection":
      onTaskActionCallback?.({
        action: "deleteCockpitSection",
        taskId: "__section__",
        sectionId: message.sectionId,
      });
      return true;

    case "moveCockpitSection":
      onTaskActionCallback?.({
        action: "moveCockpitSection",
        taskId: "__section__",
        sectionId: message.sectionId,
        sectionDirection: message.direction,
      });
      return true;

    case "reorderCockpitSection":
      onTaskActionCallback?.({
        action: "reorderCockpitSection",
        taskId: "__section__",
        sectionId: message.sectionId,
        targetIndex: message.targetIndex,
      });
      return true;

    default:
      return false;
  }
}