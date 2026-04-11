import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import * as extensionCompat from "../../extensionCompat";
import {
  handleSettingsWebviewMessage,
  getResourceScopedSettingsTarget,
} from "../../cockpitWebviewSettingsHandler";

function patchWorkspaceFolders(value: Array<{ uri: vscode.Uri }> | undefined): void {
  const descriptor = { value, configurable: true };
  Object.defineProperty(vscode.workspace, "workspaceFolders", descriptor);
}

function setWorkspaceFoldersForTest(root: string): () => void {
  const workspaceAny = vscode.workspace as unknown as {
    workspaceFolders?: Array<{ uri: vscode.Uri }>;
  };
  const originalFolders = workspaceAny.workspaceFolders;

  try {
    patchWorkspaceFolders([{ uri: vscode.Uri.file(root) }]);
  } catch {
    // The host may reject patching in some environments.
  }

  return () => {
    const restoreFolders = originalFolders;
    try {
      patchWorkspaceFolders(restoreFolders);
    } catch {
      // Ignore restoration failures in the test host.
    }
  };
}

suite("Scheduler webview settings handler behavior", () => {
  test("uses a workspace-folder target when a folder is open", () => {
    const restoreWorkspace = setWorkspaceFoldersForTest(__dirname);

    try {
      assert.strictEqual(
        getResourceScopedSettingsTarget(),
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    } finally {
      restoreWorkspace();
    }
  });

  test("setStorageSettings normalizes state and posts it back to the webview", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
    const updateCalls: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];
    const postedMessages: Array<Record<string, unknown>> = [];

    try {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = (async (
        key: string,
        value: unknown,
        target: vscode.ConfigurationTarget,
      ) => {
        updateCalls.push({ key, value, target });
      }) as typeof extensionCompat.updateCompatibleConfigurationValue;

      const handled = await handleSettingsWebviewMessage(
        {
          type: "setStorageSettings",
          data: {
            mode: "sqlite",
            sqliteJsonMirror: false,
            disabledSystemFlagKeys: ["go", "final-user-check"],
            appVersion: "99.0.78",
            mcpSetupStatus: "configured",
            lastMcpSupportUpdateAt: "",
            lastBundledSkillsSyncAt: "",
            lastBundledAgentsSyncAt: "",
          },
        },
        {
          postMessage: (message) => postedMessages.push(message),
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(updateCalls, [
        {
          key: "storageMode",
          value: "sqlite",
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
        {
          key: "sqliteJsonMirror",
          value: false,
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
      ]);
      assert.deepStrictEqual(postedMessages, [
        {
          type: "updateStorageSettings",
          storageSettings: {
            mode: "sqlite",
            sqliteJsonMirror: false,
            disabledSystemFlagKeys: ["ready", "final-user-check"],
            appVersion: "",
            mcpSetupStatus: "workspace-required",
            lastMcpSupportUpdateAt: "",
            lastBundledSkillsSyncAt: "",
            lastBundledAgentsSyncAt: "",
          },
        },
      ]);
    } finally {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = originalUpdate;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("opens extension settings from the settings webview action", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (...args: unknown[]) => {
        executeCalls.push(args);
      }) as typeof vscode.commands.executeCommand;

      const handled = await handleSettingsWebviewMessage(
        { type: "openExtensionSettings" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(executeCalls, [
        ["workbench.action.openSettings", "@ext:local-dev.copilot-cockpit"],
      ]);
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecute;
    }
  });

  test("opens Copilot settings from the settings webview action", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (...args: unknown[]) => {
        executeCalls.push(args);
      }) as typeof vscode.commands.executeCommand;

      const handled = await handleSettingsWebviewMessage(
        { type: "openCopilotSettings" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(executeCalls, [
        ["workbench.action.openSettings", "@feature:chat @ext:github.copilot-chat @ext:github.copilot mcp agent model"],
      ]);
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecute;
    }
  });
});
