import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { __testOnly } from "../../cockpitWebviewRenderContext";

suite("cockpitWebviewRenderContext", () => {
  test("script cache token changes when the generated cockpit bundle changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-webview-cache-token-"));
    const generatedDir = path.join(root, "media", "generated");
    fs.mkdirSync(generatedDir, { recursive: true });

    const loaderPath = path.join(generatedDir, "cockpitWebview.loader.js");
    const bundlePath = path.join(generatedDir, "cockpitWebview.js");

    fs.writeFileSync(loaderPath, 'import("../cockpitWebview.js");\n', "utf8");
    fs.writeFileSync(bundlePath, "console.log('v1');\n", "utf8");

    const extensionUri = vscode.Uri.file(root);
    const initialToken = __testOnly.buildWebviewScriptCacheToken(extensionUri);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(bundlePath, "console.log('v2 bundle changed');\n", "utf8");

    const updatedToken = __testOnly.buildWebviewScriptCacheToken(extensionUri);

    assert.notStrictEqual(initialToken, "static");
    assert.notStrictEqual(updatedToken, "static");
    assert.notStrictEqual(updatedToken, initialToken);
    assert.ok(updatedToken.includes("cockpitWebview.loader.js:"));
    assert.ok(updatedToken.includes("cockpitWebview.js:"));

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("script cache token changes when a runtime source media module changes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "cockpit-webview-cache-token-source-"));
    const generatedDir = path.join(root, "media", "generated");
    const mediaDir = path.join(root, "media");
    fs.mkdirSync(generatedDir, { recursive: true });

    const loaderPath = path.join(generatedDir, "cockpitWebview.loader.js");
    const generatedBundlePath = path.join(generatedDir, "cockpitWebview.js");
    const sourceEntryPath = path.join(mediaDir, "cockpitWebview.js");
    const boardStatePath = path.join(mediaDir, "cockpitWebviewBoardState.js");
    const boardInteractionsPath = path.join(mediaDir, "cockpitWebviewBoardInteractions.js");

    fs.writeFileSync(loaderPath, 'import("../cockpitWebview.js");\n', "utf8");
    fs.writeFileSync(generatedBundlePath, "console.log('generated bundle');\n", "utf8");
    fs.writeFileSync(
      sourceEntryPath,
      [
        'import "./cockpitWebviewBoardState.js";',
        'import "./cockpitWebviewBoardInteractions.js";',
      ].join("\n"),
      "utf8",
    );
    fs.writeFileSync(boardStatePath, "export const boardStateVersion = 'v1';\n", "utf8");
    fs.writeFileSync(boardInteractionsPath, "export const boardInteractionsVersion = 'v1';\n", "utf8");

    const extensionUri = vscode.Uri.file(root);
    const initialToken = __testOnly.buildWebviewScriptCacheToken(extensionUri);

    await new Promise((resolve) => setTimeout(resolve, 20));
    fs.writeFileSync(boardStatePath, "export const boardStateVersion = 'v2';\n", "utf8");

    const updatedToken = __testOnly.buildWebviewScriptCacheToken(extensionUri);

    assert.notStrictEqual(initialToken, "static");
    assert.notStrictEqual(updatedToken, "static");
    assert.notStrictEqual(updatedToken, initialToken);
    assert.ok(updatedToken.includes("cockpitWebview.loader.js:"));
    assert.ok(updatedToken.includes("cockpitWebview.js:"));
    assert.ok(updatedToken.includes("cockpitWebviewBoardState.js:"));
    assert.ok(updatedToken.includes("cockpitWebviewBoardInteractions.js:"));

    fs.rmSync(root, { recursive: true, force: true });
  });
});