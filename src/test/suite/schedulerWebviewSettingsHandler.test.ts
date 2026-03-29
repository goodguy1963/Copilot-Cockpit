import * as assert from "assert";
import * as vscode from "vscode";
import { getResourceScopedSettingsTarget } from "../../schedulerWebviewSettingsHandler";

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
});