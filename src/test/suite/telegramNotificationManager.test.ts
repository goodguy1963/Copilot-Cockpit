import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import { getPrivateSchedulerConfigPath } from "../../cockpitJsonSanitizer";
import {
  getTelegramNotificationView,
  saveTelegramNotificationConfig,
} from "../../telegramNotificationManager";

class MemorySecrets {
  readonly values = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.values.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

function createWorkspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cockpit-telegram-"));
}

function cleanupWorkspace(root: string): void {
  try {
    const cleanupOptions: fs.RmOptions = {};
    cleanupOptions.recursive = true;
    cleanupOptions.force = true;
    cleanupOptions.maxRetries = 3;
    cleanupOptions.retryDelay = 50;
    fs.rmSync(root, cleanupOptions);
  } catch {
    // Temp cleanup only.
  }
}

suite("Telegram notification manager behavior", () => {
  test("stores Telegram bot tokens in SecretStorage instead of scheduler files", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const secrets = new MemorySecrets();

    try {
      const savedView = await saveTelegramNotificationConfig(secrets, workspaceRoot, {
        enabled: true,
        botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
        chatId: "-1001234567890",
        messagePrefix: "Scheduler update",
      });

      assert.strictEqual(savedView.enabled, true);
      assert.strictEqual(savedView.chatId, "-1001234567890");
      assert.strictEqual(savedView.messagePrefix, "Scheduler update");
      assert.strictEqual(savedView.hasBotToken, true);
      assert.strictEqual(savedView.hookConfigured, false);

      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const privateConfigPath = getPrivateSchedulerConfigPath(publicConfigPath);
      const hookConfigPath = path.join(workspaceRoot, ".github", "hooks", "scheduler-telegram-stop.json");
      const hookScriptPath = path.join(workspaceRoot, ".github", "hooks", "scheduler-telegram-stop.js");

      assert.ok(fs.existsSync(publicConfigPath));
      assert.ok(fs.existsSync(privateConfigPath));
      assert.ok(!fs.existsSync(hookConfigPath));
      assert.ok(!fs.existsSync(hookScriptPath));

      const publicContent = fs.readFileSync(publicConfigPath, "utf8");
      const privateContent = fs.readFileSync(privateConfigPath, "utf8");
      assert.ok(!publicContent.includes("123456:abcdefghijklmnopqrstuvwxyzABCDE"));
      assert.ok(!privateContent.includes("123456:abcdefghijklmnopqrstuvwxyzABCDE"));
      assert.ok(privateContent.includes("\"hasBotToken\": true"));
      assert.ok(Array.from(secrets.values.values()).some((value) =>
        value.includes("123456:abcdefghijklmnopqrstuvwxyzABCDE"),
      ));

      const reloadedView = getTelegramNotificationView(workspaceRoot);
      assert.strictEqual(reloadedView.enabled, true);
      assert.strictEqual(reloadedView.hasBotToken, true);
      assert.strictEqual(reloadedView.hookConfigured, false);
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });

  test("turning Telegram notifications off preserves the SecretStorage token marker", async () => {
    const workspaceRoot = createWorkspaceRoot();
    const secrets = new MemorySecrets();

    try {
      await saveTelegramNotificationConfig(secrets, workspaceRoot, {
        enabled: true,
        botToken: "123456:abcdefghijklmnopqrstuvwxyzABCDE",
        chatId: "123456789",
      });

      const disabledView = await saveTelegramNotificationConfig(secrets, workspaceRoot, {
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
      cleanupWorkspace(workspaceRoot);
    }
  });
});
