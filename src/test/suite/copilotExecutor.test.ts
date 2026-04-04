import * as assert from "assert";
import * as vscode from "vscode";
import { CopilotExecutor } from "../../copilotExecutor";

suite("CopilotExecutor Test Suite", () => {
  test("continue-mode execution does not create a new chat session", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    let warningShown = false;

    executor.delay = async () => {};

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (id: string, ...args: unknown[]) => {
        commandCalls.push({ id, args });

        if (
          id === "workbench.action.chat.open"
          || id === "workbench.action.chat.submit"
        ) {
          return undefined;
        }

        throw new Error(`Unexpected command: ${id}`);
      }) as typeof vscode.commands.executeCommand;

      (vscode.window as typeof vscode.window & {
        showWarningMessage: typeof vscode.window.showWarningMessage;
      }).showWarningMessage = (async () => {
        warningShown = true;
        return undefined;
      }) as typeof vscode.window.showWarningMessage;

      await executor.executePrompt("Ping", {
        agent: "agent",
        model: "gpt-4o",
        chatSession: "continue",
      });

      assert.strictEqual(warningShown, false);
      assert.ok(
        !commandCalls.some((call) => call.id === "workbench.action.chat.newChat"),
        "Expected continue-mode execution to avoid creating a new chat session",
      );
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecuteCommand;
      (vscode.window as typeof vscode.window & {
        showWarningMessage: typeof vscode.window.showWarningMessage;
      }).showWarningMessage = originalShowWarningMessage;
    }
  });

  test("manual fallback still executes when model pinning is unsupported", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    let warningShown = false;

    executor.delay = async () => {};

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (id: string, ...args: unknown[]) => {
        commandCalls.push({ id, args });

        if (id === "workbench.action.chat.open") {
          throw new Error("chat.open options unsupported");
        }

        if (id === "workbench.panel.chat.view.copilot.focus") {
          return undefined;
        }

        if (id === "type") {
          return undefined;
        }

        if (id === "workbench.action.chat.submit") {
          return undefined;
        }

        throw new Error(`Unexpected command: ${id}`);
      }) as typeof vscode.commands.executeCommand;

      (vscode.window as typeof vscode.window & {
        showWarningMessage: typeof vscode.window.showWarningMessage;
      }).showWarningMessage = (async () => {
        warningShown = true;
        return undefined;
      }) as typeof vscode.window.showWarningMessage;

      await executor.executePrompt("Ping", { model: "gpt-4o" });

      assert.strictEqual(warningShown, false);

      const typedCall = commandCalls.find((call) => call.id === "type");
      assert.ok(typedCall, "Expected manual type fallback to run");
      assert.deepStrictEqual(typedCall?.args[0], { text: "/agent Ping" });
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecuteCommand;
      (vscode.window as typeof vscode.window & {
        showWarningMessage: typeof vscode.window.showWarningMessage;
      }).showWarningMessage = originalShowWarningMessage;
    }
  });
});