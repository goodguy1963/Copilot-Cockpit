import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as extensionCompat from "../../extensionCompat";
import {
  getResourceScopedSettingsTarget,
  handleSettingsWebviewMessage,
} from "../../schedulerWebviewSettingsHandler";

suite("Scheduler Webview Settings Handler Tests", () => {
  function setWorkspaceFoldersForTest(root: string): () => void {
    const workspaceAny = vscode.workspace as unknown as {
      workspaceFolders?: Array<{ uri: vscode.Uri }>;
    };
    const original = workspaceAny.workspaceFolders;

    try {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [{ uri: vscode.Uri.file(root) }],
        configurable: true,
      });
    } catch {
      // ignore; the test host may reject patching
    }

    return () => {
      try {
        Object.defineProperty(vscode.workspace, "workspaceFolders", {
          value: original,
          configurable: true,
        });
      } catch {
        // ignore
      }
    };
  }

  test("uses workspace-folder target for resource-scoped settings when a folder is open", () => {
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

  test("setStorageSettings updates storage settings and posts the normalized state", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
    const calls: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];
    const posted: Array<Record<string, unknown>> = [];

    try {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = (async (
        key: string,
        value: unknown,
        target: vscode.ConfigurationTarget,
      ) => {
        calls.push({ key, value, target });
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
          },
        },
        {
          postMessage: (message) => posted.push(message),
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(calls, [
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
      assert.deepStrictEqual(posted, [
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
});