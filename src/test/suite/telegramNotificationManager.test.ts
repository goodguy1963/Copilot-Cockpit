import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  REDACTED_TELEGRAM_BOT_TOKEN,
  getPrivateSchedulerConfigPath,
} from "../../schedulerJsonSanitizer";
import {
  getTelegramNotificationView,
  saveTelegramNotificationConfig,
} from "../../telegramNotificationManager";

suite("Telegram Notification Manager Tests", () => {
  function createWorkspaceRoot(): string {
    return fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-telegram-"),
    );
  }

  function cleanup(root: string): void {
    try {
      fs.rmSync(root, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 50,
      });
    } catch {
      // ignore
    }
  }

  test("saves Telegram config privately and redacts the public scheduler file", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const view = saveTelegramNotificationConfig(workspaceRoot, {
        enabled: true,
        botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
        chatId: "-1001234567890",
        messagePrefix: "Scheduler update",
      });

      assert.strictEqual(view.enabled, true);
      assert.strictEqual(view.chatId, "-1001234567890");
      assert.strictEqual(view.messagePrefix, "Scheduler update");
      assert.strictEqual(view.hasBotToken, true);
      assert.strictEqual(view.hookConfigured, true);

      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const privateConfigPath = getPrivateSchedulerConfigPath(publicConfigPath);
      const hookConfigPath = path.join(workspaceRoot, ".github", "hooks", "scheduler-telegram-stop.json");
      const hookScriptPath = path.join(workspaceRoot, ".github", "hooks", "scheduler-telegram-stop.js");

      assert.ok(fs.existsSync(publicConfigPath));
      assert.ok(fs.existsSync(privateConfigPath));
      assert.ok(fs.existsSync(hookConfigPath));
      assert.ok(fs.existsSync(hookScriptPath));

      const publicContent = fs.readFileSync(publicConfigPath, "utf8");
      const privateContent = fs.readFileSync(privateConfigPath, "utf8");

      assert.ok(publicContent.includes(REDACTED_TELEGRAM_BOT_TOKEN));
      assert.ok(!publicContent.includes("123456:abcdefghijklmnopqrstuvwxyzABCDE"));
      assert.ok(privateContent.includes("123456:abcdefghijklmnopqrstuvwxyzABCDE"));

      const persistedView = getTelegramNotificationView(workspaceRoot);
      assert.strictEqual(persistedView.enabled, true);
      assert.strictEqual(persistedView.hasBotToken, true);
      assert.strictEqual(persistedView.hookConfigured, true);
    } finally {
      cleanup(workspaceRoot);
    }
  });

  test("disabling Telegram notifications removes generated hook files", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      saveTelegramNotificationConfig(workspaceRoot, {
        enabled: true,
        botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
        chatId: "123456789",
      });

      const disabledView = saveTelegramNotificationConfig(workspaceRoot, {
        enabled: false,
      });

      const hookConfigPath = path.join(workspaceRoot, ".github", "hooks", "scheduler-telegram-stop.json");
      const hookScriptPath = path.join(workspaceRoot, ".github", "hooks", "scheduler-telegram-stop.js");

      assert.strictEqual(disabledView.enabled, false);
      assert.strictEqual(disabledView.hasBotToken, true);
      assert.strictEqual(disabledView.hookConfigured, false);
      assert.ok(!fs.existsSync(hookConfigPath));
      assert.ok(!fs.existsSync(hookScriptPath));
    } finally {
      cleanup(workspaceRoot);
    }
  });
});