import * as assert from "assert";
import * as vscode from "vscode";
import { CopilotExecutor } from "../../copilotExecutor";

const mutableWorkspace = vscode.workspace as {
  getConfiguration: typeof vscode.workspace.getConfiguration;
};

const mutableCommands = vscode.commands as {
  executeCommand: typeof vscode.commands.executeCommand;
};

const mutableWindow = vscode.window as {
  showWarningMessage: typeof vscode.window.showWarningMessage;
};

suite("CopilotExecutor Test Suite", () => {
  test("hourly new-chat cap blocks a second fresh chat but allows continue-mode", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const originalGetConfiguration = vscode.workspace.getConfiguration;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    const warningMessages: string[] = [];
    const state = new Map<string, unknown>();

    executor.delay = async () => {};
    (CopilotExecutor as any).recentPromptExecutionStarts = [];

    try {
      CopilotExecutor.configure({
        globalState: {
          get<T>(key: string, defaultValue?: T) {
            return (state.has(key) ? state.get(key) : defaultValue) as T;
          },
          async update(key: string, value: unknown) {
            state.set(key, value);
          },
        },
      } as unknown as vscode.ExtensionContext);

      mutableWorkspace.getConfiguration = ((section?: string) => {
        if (section === "copilotCockpit") {
          return {
            get<T>(key: string, defaultValue?: T) {
              if (key === "maxNewChatSessionsPerHour") {
                return 1 as T;
              }

              return defaultValue as T;
            },
            inspect() {
              return undefined;
            },
          } as unknown as vscode.WorkspaceConfiguration;
        }

        return originalGetConfiguration(section);
      }) as typeof vscode.workspace.getConfiguration;

      mutableCommands.executeCommand = (async (id: string, ...args: unknown[]) => {
        commandCalls.push({ id, args });

        if (
          id === "workbench.action.chat.newChat"
          || id === "workbench.action.chat.open"
          || id === "workbench.action.chat.submit"
        ) {
          return undefined;
        }

        throw new Error(`Unexpected command: ${id}`);
      }) as typeof vscode.commands.executeCommand;

      mutableWindow.showWarningMessage = (async (message: string) => {
        warningMessages.push(message);
        return undefined;
      }) as typeof vscode.window.showWarningMessage;

      await executor.executePrompt("First", {
        agent: "agent",
        model: "gpt-4o",
        chatSession: "new",
      });

      await assert.rejects(
        executor.executePrompt("Second", {
          agent: "agent",
          model: "gpt-4o",
          chatSession: "new",
        }),
        /Hourly new chat session limit/,
      );

      await executor.executePrompt("Continue", {
        agent: "agent",
        model: "gpt-4o",
        chatSession: "continue",
      });

      assert.strictEqual(
        commandCalls.filter((call) => call.id === "workbench.action.chat.newChat").length,
        1,
      );
      assert.strictEqual(
        commandCalls.filter((call) => call.id === "workbench.action.chat.open").length,
        2,
      );
      assert.strictEqual(
        warningMessages.filter((message) => /Hourly new chat session limit/.test(message)).length,
        1,
      );
      assert.strictEqual(
        warningMessages.filter((message) => /copy it to clipboard/i.test(message)).length,
        0,
      );
    } finally {
      mutableCommands.executeCommand = originalExecuteCommand;
      mutableWindow.showWarningMessage = originalShowWarningMessage;
      mutableWorkspace.getConfiguration = originalGetConfiguration;
      (CopilotExecutor as any).recentPromptExecutionStarts = [];
      CopilotExecutor.configure();
    }
  });

  test("prompt execution rate limit blocks the sixth start within one minute", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    const warningMessages: string[] = [];
    const state = new Map<string, unknown>();

    executor.delay = async () => {};
    (CopilotExecutor as any).recentPromptExecutionStarts = [];

    try {
      CopilotExecutor.configure({
        globalState: {
          get<T>(key: string, defaultValue?: T) {
            return (state.has(key) ? state.get(key) : defaultValue) as T;
          },
          async update(key: string, value: unknown) {
            state.set(key, value);
          },
        },
      } as unknown as vscode.ExtensionContext);

      mutableCommands.executeCommand = (async (id: string, ...args: unknown[]) => {
        commandCalls.push({ id, args });

        if (
          id === "workbench.action.chat.open"
          || id === "workbench.action.chat.submit"
        ) {
          return undefined;
        }

        throw new Error(`Unexpected command: ${id}`);
      }) as typeof vscode.commands.executeCommand;

      mutableWindow.showWarningMessage = (async (message: string) => {
        warningMessages.push(message);
        return undefined;
      }) as typeof vscode.window.showWarningMessage;

      for (let attempt = 0; attempt < 5; attempt += 1) {
        await executor.executePrompt(`Prompt ${attempt + 1}`, {
          agent: "agent",
          chatSession: "continue",
        });
      }

      await assert.rejects(
        executor.executePrompt("Prompt 6", {
          agent: "agent",
          chatSession: "continue",
        }),
        /Prompt execution rate limit reached/,
      );

      assert.strictEqual(
        commandCalls.filter((call) => call.id === "workbench.action.chat.open").length,
        5,
      );
      assert.strictEqual(
        warningMessages.filter((message) => /Prompt execution rate limit reached/.test(message)).length,
        1,
      );
    } finally {
      mutableCommands.executeCommand = originalExecuteCommand;
      mutableWindow.showWarningMessage = originalShowWarningMessage;
      (CopilotExecutor as any).recentPromptExecutionStarts = [];
      CopilotExecutor.configure();
    }
  });

  test("continue-mode execution does not create a new chat session", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    let warningShown = false;

    executor.delay = async () => {};
    (CopilotExecutor as any).recentPromptExecutionStarts = [];

    try {
      mutableCommands.executeCommand = (async (id: string, ...args: unknown[]) => {
        commandCalls.push({ id, args });

        if (
          id === "workbench.action.chat.open"
          || id === "workbench.action.chat.submit"
        ) {
          return undefined;
        }

        throw new Error(`Unexpected command: ${id}`);
      }) as typeof vscode.commands.executeCommand;

      mutableWindow.showWarningMessage = (async () => {
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
      mutableCommands.executeCommand = originalExecuteCommand;
      mutableWindow.showWarningMessage = originalShowWarningMessage;
      (CopilotExecutor as any).recentPromptExecutionStarts = [];
    }
  });

  test("open-chat execution fails when submit command is unavailable", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    const warningMessages: string[] = [];

    executor.delay = async () => {};
    (CopilotExecutor as any).recentPromptExecutionStarts = [];

    try {
      mutableCommands.executeCommand = (async (id: string, ...args: unknown[]) => {
        commandCalls.push({ id, args });

        if (id === "workbench.action.chat.open") {
          return undefined;
        }

        throw new Error(`Unexpected command: ${id}`);
      }) as typeof vscode.commands.executeCommand;

      mutableWindow.showWarningMessage = (async (message: string) => {
        warningMessages.push(message);
        return undefined;
      }) as typeof vscode.window.showWarningMessage;

      await assert.rejects(
        executor.executePrompt("Ping", {
          agent: "agent",
          chatSession: "continue",
        }),
        /chat submit command unavailable/,
      );

      assert.strictEqual(
        commandCalls.filter((call) => call.id === "workbench.action.chat.open").length,
        1,
      );
      assert.strictEqual(warningMessages.length, 1);
    } finally {
      mutableCommands.executeCommand = originalExecuteCommand;
      mutableWindow.showWarningMessage = originalShowWarningMessage;
      (CopilotExecutor as any).recentPromptExecutionStarts = [];
    }
  });

  test("manual fallback still executes when model pinning is unsupported", async () => {
    const executor = new CopilotExecutor() as any;

    const originalExecuteCommand = vscode.commands.executeCommand;
    const originalShowWarningMessage = vscode.window.showWarningMessage;
    const commandCalls: Array<{ id: string; args: unknown[] }> = [];
    let warningShown = false;

    executor.delay = async () => {};
    (CopilotExecutor as any).recentPromptExecutionStarts = [];

    try {
      mutableCommands.executeCommand = (async (id: string, ...args: unknown[]) => {
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

      mutableWindow.showWarningMessage = (async () => {
        warningShown = true;
        return undefined;
      }) as typeof vscode.window.showWarningMessage;

      await executor.executePrompt("Ping", { model: "gpt-4o" });

      assert.strictEqual(warningShown, false);

      const typedCall = commandCalls.find((call) => call.id === "type");
      assert.ok(typedCall, "Expected manual type fallback to run");
      assert.deepStrictEqual(typedCall?.args[0], { text: "/agent Ping" });
    } finally {
      mutableCommands.executeCommand = originalExecuteCommand;
      mutableWindow.showWarningMessage = originalShowWarningMessage;
      (CopilotExecutor as any).recentPromptExecutionStarts = [];
    }
  });
});