import * as assert from "assert";
import { messages } from "../../i18n";
import { handleIncomingSchedulerWebviewMessage } from "../../cockpitWebviewPanelLifecycle";
import { parseIncomingWebviewMessage } from "../../validation/incomingWebviewMessage";
import type { WebviewToExtensionMessage } from "../../types";

suite("cockpitWebviewPanelLifecycle", () => {
  test("invalid payload is rejected before dispatch", async () => {
    const handledMessages: WebviewToExtensionMessage[] = [];
    const shownErrors: string[] = [];

    await handleIncomingSchedulerWebviewMessage({
      rawMessage: {
        type: "updateTask",
        taskId: 42,
        data: {},
      },
      handleMessage: async (message) => {
        handledMessages.push(message);
      },
      redactPathsForDisplay: (message) => message,
      showError: (message) => {
        shownErrors.push(message);
      },
    });

    assert.deepStrictEqual(handledMessages, []);
    assert.deepStrictEqual(shownErrors, [
      messages.webviewMessageHandlingFailed("updateTask"),
    ]);
  });

  test("valid payload still reaches dispatch", async () => {
    const handledMessages: WebviewToExtensionMessage[] = [];
    const shownErrors: string[] = [];
    const payload = {
      type: "updateTask",
      taskId: "task-1",
      data: { name: "Updated task" },
    } satisfies WebviewToExtensionMessage;

    await handleIncomingSchedulerWebviewMessage({
      rawMessage: payload,
      handleMessage: async (message) => {
        handledMessages.push(message);
      },
      redactPathsForDisplay: (message) => message,
      showError: (message) => {
        shownErrors.push(message);
      },
    });

    assert.deepStrictEqual(handledMessages, [payload]);
    assert.deepStrictEqual(shownErrors, []);
  });

  test("parser keeps object-root payload validation narrow", () => {
    const result = parseIncomingWebviewMessage({
      type: "createTask",
      data: {
        name: "Task title",
        cronExpression: "* * * * *",
        extraBoundaryField: true,
      },
    });

    assert.strictEqual(result.success, true);
  });
});