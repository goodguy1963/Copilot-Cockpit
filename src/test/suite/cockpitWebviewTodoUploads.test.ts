import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  handleTodoFileUploadRequest,
  MAX_TODO_UPLOAD_BYTES,
} from "../../cockpitWebviewTodoUploads";

suite("Todo Cockpit file uploads", () => {
  test("rejects oversized selected files before copying into the workspace", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "todo-upload-"));
    const sourcePath = path.join(workspaceRoot, "large.txt");
    const messages: Array<{ type: string; [key: string]: unknown }> = [];
    const originalShowOpenDialog = vscode.window.showOpenDialog;

    try {
      fs.writeFileSync(sourcePath, "");
      fs.truncateSync(sourcePath, MAX_TODO_UPLOAD_BYTES + 1);
      (vscode.window as any).showOpenDialog = async () => [
        vscode.Uri.file(sourcePath),
      ];

      await handleTodoFileUploadRequest({
        workspaceRoot,
        uploadsFolderName: "cockpit-input-uploads",
        strings: {},
        postMessage: (message) => messages.push(message),
        ensurePrivateConfigIgnoredForWorkspaceRoot: () => undefined,
        logError: () => undefined,
      });

      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0]?.type, "todoFileUploadResult");
      assert.strictEqual(messages[0]?.ok, false);
      assert.match(String(messages[0]?.message ?? ""), /too large/i);
      assert.strictEqual(
        fs.existsSync(path.join(workspaceRoot, ".vscode", "cockpit-input-uploads")),
        false,
      );
    } finally {
      (vscode.window as any).showOpenDialog = originalShowOpenDialog;
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
