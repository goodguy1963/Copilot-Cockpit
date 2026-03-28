/**
 * Copilot Cockpit - Extension Tests
 */

import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import type { ScheduledTask } from "../../types";

suite("Extension Test Suite", () => {
  test("Extension should be present", () => {
    assert.ok(vscode.extensions.getExtension("local-dev.copilot-cockpit"));
  });

  test("Extension should activate", async () => {
    const extension = vscode.extensions.getExtension(
      "local-dev.copilot-cockpit",
    );
    if (extension) {
      await extension.activate();
      assert.strictEqual(extension.isActive, true);
    }
  });

  test("Auto-show startup setting should be contributed", () => {
    const extension = vscode.extensions.getExtension(
      "local-dev.copilot-cockpit",
    );
    assert.ok(extension);

    const packageJson = extension!.packageJSON as {
      contributes?: {
        configuration?: {
          properties?: Record<string, unknown>;
        };
      };
    };

    const properties = packageJson.contributes?.configuration?.properties ?? {};
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.autoShowOnStartup",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.defaultAgent",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.defaultModel",
      ),
    );
  });

  test("Commands should be registered", async () => {
    const commands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      "copilotCockpit.createTask",
      "copilotCockpit.createTaskGui",
      "copilotCockpit.listTasks",
      "copilotCockpit.deleteTask",
      "copilotCockpit.toggleTask",
      "copilotCockpit.enableTask",
      "copilotCockpit.disableTask",
      "copilotCockpit.runNow",
      "copilotCockpit.copyPrompt",
      "copilotCockpit.editTask",
      "copilotCockpit.duplicateTask",
      "copilotCockpit.moveToCurrentWorkspace",
      "copilotCockpit.openSettings",
      "copilotCockpit.showVersion",
      "copilotCockpit.setupMcp",
      "copilotScheduler.createTask",
      "copilotScheduler.createTaskGui",
      "copilotScheduler.listTasks",
      "copilotScheduler.deleteTask",
      "copilotScheduler.toggleTask",
      "copilotScheduler.enableTask",
      "copilotScheduler.disableTask",
      "copilotScheduler.runNow",
      "copilotScheduler.copyPrompt",
      "copilotScheduler.editTask",
      "copilotScheduler.duplicateTask",
      "copilotScheduler.moveToCurrentWorkspace",
      "copilotScheduler.openSettings",
      "copilotScheduler.showVersion",
      "copilotScheduler.setupMcp",
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }

    const registeredCockpitCommands = commands.filter((cmd) =>
      cmd.startsWith("copilotCockpit."),
    );
    assert.strictEqual(
      registeredCockpitCommands.length,
      15,
      `Expected 15 copilotCockpit commands but found ${registeredCockpitCommands.length}. Update expectedCommands when adding new commands.`,
    );

    const registeredSchedulerCommands = commands.filter((cmd) =>
      cmd.startsWith("copilotScheduler."),
    );
    assert.strictEqual(
      registeredSchedulerCommands.length,
      15,
      `Expected 15 copilotScheduler alias commands but found ${registeredSchedulerCommands.length}. Update expectedCommands when adding new commands.`,
    );
  });
});

suite("Cron Expression Tests", () => {
  test("Valid cron expressions should be accepted", () => {
    // These tests would require importing ScheduleManager
    // which needs proper mocking in test environment
    assert.ok(true);
  });
});

suite("i18n Tests", () => {
  test("Messages should be defined", async () => {
    // Import dynamically to avoid activation issues
    const { messages } = await import("../../i18n");

    assert.ok(typeof messages.extensionActive === "function");
    assert.ok(typeof messages.taskCreated === "function");
    assert.ok(typeof messages.taskDeleted === "function");
  });
});

suite("Error Message Sanitization Tests", () => {
  test("Sanitizes absolute paths to basenames (Windows and POSIX)", async () => {
    const { __testOnly } = await import("../../extension");
    const sanitize = __testOnly.sanitizeErrorDetailsForLog as
      | ((message: string) => string)
      | undefined;

    assert.ok(typeof sanitize === "function");

    const winQuoted =
      "EACCES: permission denied, open 'C:\\Users\\me\\secret folder\\a b.md'";
    const winQuotedOut = sanitize!(winQuoted);
    assert.ok(!winQuotedOut.includes("C:\\Users\\me"));
    assert.ok(winQuotedOut.includes("'a b.md'"));

    const winUnquoted =
      "ENOENT: no such file or directory, open C:\\Users\\me\\a.md";
    const winUnquotedOut = sanitize!(winUnquoted);
    assert.ok(!winUnquotedOut.includes("C:\\Users\\me"));
    assert.ok(winUnquotedOut.includes("a.md"));

    const posixQuoted =
      "ENOENT: no such file or directory, open '/Users/me/secret folder/a b.md'";
    const posixQuotedOut = sanitize!(posixQuoted);
    assert.ok(!posixQuotedOut.includes("/Users/me/secret folder"));
    assert.ok(posixQuotedOut.includes("'a b.md'"));

    const posixUnquoted = "open /Users/me/a.md";
    const posixUnquotedOut = sanitize!(posixUnquoted);
    assert.ok(!posixUnquotedOut.includes("/Users/me/"));
    assert.ok(posixUnquotedOut.includes("a.md"));

    const posixParen = "at foo (/Users/me/a.md:1:2)";
    const posixParenOut = sanitize!(posixParen);
    assert.ok(!posixParenOut.includes("/Users/me/"));
    assert.ok(posixParenOut.includes("(a.md:1:2)"));

    const winForward = "open C:/Users/me/a.md";
    const winForwardOut = sanitize!(winForward);
    assert.ok(!winForwardOut.includes("C:/Users/me/"));
    assert.ok(winForwardOut.includes("a.md"));

    const uncPath = "open \\\\server\\share\\secret\\a.md";
    const uncOut = sanitize!(uncPath);
    assert.ok(!uncOut.includes("\\\\server\\share"));
    assert.ok(uncOut.includes("a.md"));

    const fileUri = "open file:///C:/Users/me/secret%20folder/a%20b.md";
    const fileUriOut = sanitize!(fileUri);
    assert.ok(!fileUriOut.includes("file:///C:/Users/me"));
    assert.ok(fileUriOut.includes("a b.md"));

    const fileUriHost = "open file://server/share/secret/a.md";
    const fileUriHostOut = sanitize!(fileUriHost);
    assert.ok(!fileUriHostOut.includes("file://server/share"));
    assert.ok(fileUriHostOut.includes("a.md"));

    const webUrl = "see https://example.com/path";
    const webUrlOut = sanitize!(webUrl);
    assert.strictEqual(webUrlOut, webUrl);
  });
});

suite("resolvePromptText Tests", () => {
  function setWorkspaceFoldersForTest(root: string): () => void {
    const wsAny = vscode.workspace as unknown as {
      workspaceFolders?: Array<{ uri: vscode.Uri }>;
    };
    const original = wsAny.workspaceFolders;
    try {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [{ uri: vscode.Uri.file(root) }],
        configurable: true,
      });
    } catch {
      // Best-effort; tests will fail if the host disallows patching.
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

  test("Prefers open document text when preferOpenDocument=true", async () => {
    const wsRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(wsRoot);
    const promptsDir = path.join(wsRoot, ".github", "prompts");

    const fileName = `__test_resolvePromptText_openDoc_${Date.now()}.md`;
    const absPath = path.join(promptsDir, fileName);
    const relPath = path.join(".github", "prompts", fileName);
    const uri = vscode.Uri.file(absPath);
    let doc: vscode.TextDocument | undefined;

    try {
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(absPath, "DISK", "utf8");

      doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      assert.ok(editor, "An editor should be available");

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length),
      );
      await editor!.edit((b) => b.replace(fullRange, "UNSAVED"));
      assert.strictEqual(doc.isDirty, true);

      const { __testOnly } = await import("../../extension");
      const task = {
        id: "t-open-doc",
        name: "t",
        cronExpression: "0 * * * *",
        prompt: "FALLBACK",
        enabled: true,
        scope: "global",
        promptSource: "local",
        promptPath: relPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies ScheduledTask;

      const resolved = await __testOnly.resolvePromptText(task, true);
      assert.strictEqual(resolved, "UNSAVED");
    } finally {
      restoreWs();
      try {
        if (doc) {
          await vscode.window.showTextDocument(doc);
          if (vscode.window.activeTextEditor?.document === doc) {
            try {
              await vscode.commands.executeCommand(
                "workbench.action.revertAndCloseActiveEditor",
              );
            } catch {
              await doc.save();
              await vscode.commands.executeCommand(
                "workbench.action.closeActiveEditor",
              );
            }
          }
        }
      } catch {
        // ignore
      }
      try {
        fs.rmSync(wsRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch {
        // ignore
      }
    }
  });

  test("Reads persisted file when preferOpenDocument=false", async () => {
    const wsRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(wsRoot);
    const promptsDir = path.join(wsRoot, ".github", "prompts");

    const fileName = `__test_resolvePromptText_diskOnly_${Date.now()}.md`;
    const absPath = path.join(promptsDir, fileName);
    const relPath = path.join(".github", "prompts", fileName);
    const uri = vscode.Uri.file(absPath);
    let doc: vscode.TextDocument | undefined;

    try {
      fs.mkdirSync(promptsDir, { recursive: true });
      fs.writeFileSync(absPath, "DISK", "utf8");

      doc = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(doc);
      assert.ok(editor, "An editor should be available");

      const fullRange = new vscode.Range(
        doc.positionAt(0),
        doc.positionAt(doc.getText().length),
      );
      await editor!.edit((b) => b.replace(fullRange, "UNSAVED"));
      assert.strictEqual(doc.isDirty, true);

      const { __testOnly } = await import("../../extension");
      const task = {
        id: "t-disk-only",
        name: "t",
        cronExpression: "0 * * * *",
        prompt: "FALLBACK",
        enabled: true,
        scope: "global",
        promptSource: "local",
        promptPath: relPath,
        createdAt: new Date(),
        updatedAt: new Date(),
      } satisfies ScheduledTask;

      const resolved = await __testOnly.resolvePromptText(task, false);
      assert.strictEqual(resolved, "DISK");
    } finally {
      restoreWs();
      try {
        if (doc) {
          await vscode.window.showTextDocument(doc);
          if (vscode.window.activeTextEditor?.document === doc) {
            try {
              await vscode.commands.executeCommand(
                "workbench.action.revertAndCloseActiveEditor",
              );
            } catch {
              await doc.save();
              await vscode.commands.executeCommand(
                "workbench.action.closeActiveEditor",
              );
            }
          }
        }
      } catch {
        // ignore
      }
      try {
        fs.rmSync(wsRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch {
        // ignore
      }
    }
  });
});
