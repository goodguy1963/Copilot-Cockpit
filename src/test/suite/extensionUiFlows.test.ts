import * as assert from "assert";
import * as vscode from "vscode";
import { notifyError } from "../../extensionUiFlows";
import { messages } from "../../i18n";

suite("Extension UI Flows Unit Tests", () => {
  test("disk I/O error notifications offer to reload the VS Code window", async () => {
    const originalShowErrorMessage = vscode.window.showErrorMessage;
    const originalExecuteCommand = vscode.commands.executeCommand;
    const shownActions: string[] = [];
    const executedCommands: string[] = [];

    try {
      (vscode.window as any).showErrorMessage = (async (
        _message: string,
        ...items: string[]
      ) => {
        shownActions.push(...items);
        return messages.reloadNow();
      }) as unknown as typeof vscode.window.showErrorMessage;
      (vscode.commands as any).executeCommand = (async (command: string) => {
        executedCommands.push(command);
      }) as typeof vscode.commands.executeCommand;

      notifyError({
        message: "Failed to save scheduler configuration: disk I/O error",
        mode: "sound",
        redactPathsForLog: (message) => message,
        fallbackMessage: "Unknown error",
        logError: () => undefined,
      });

      await Promise.resolve();

      assert.deepStrictEqual(shownActions, [messages.reloadNow()]);
      assert.deepStrictEqual(executedCommands, ["workbench.action.reloadWindow"]);
    } finally {
      (vscode.window as any).showErrorMessage = originalShowErrorMessage;
      (vscode.commands as any).executeCommand = originalExecuteCommand;
    }
  });
});
