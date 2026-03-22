import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ScheduleManager } from "../../scheduleManager";
import { messages } from "../../i18n";
import {
  getPrivateSchedulerConfigPath,
  REDACTED_DISCORD_WEBHOOK_URL,
} from "../../schedulerJsonSanitizer";

class MockMemento implements vscode.Memento {
  private readonly store = new Map<string, unknown>();

  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }

  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (!this.store.has(key)) {
      return defaultValue;
    }
    return this.store.get(key) as T;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.store.set(key, value);
    return Promise.resolve();
  }
}

function createMockContext(storageRoot: string): vscode.ExtensionContext {
  return {
    globalState: new MockMemento(),
    globalStorageUri: vscode.Uri.file(storageRoot),
  } as unknown as vscode.ExtensionContext;
}

function createMockContextWithGlobalTasks(
  storageRoot: string,
  tasks: unknown[],
): vscode.ExtensionContext {
  const memento = new MockMemento();
  // Seed globalState before ScheduleManager constructor runs.
  void memento.update("scheduledTasks", tasks);
  return {
    globalState: memento,
    globalStorageUri: vscode.Uri.file(storageRoot),
  } as unknown as vscode.ExtensionContext;
}

function createManagerWithInvalidTimezone(storageRoot: string): ScheduleManager {
  const manager = new ScheduleManager(createMockContext(storageRoot));
  // Avoid VS Code configuration writes in tests; patch the instance instead.
  (manager as unknown as { getTimeZone: () => string | undefined }).getTimeZone =
    () => "Invalid/Timezone";
  return manager;
}

suite("ScheduleManager Minimum Interval Tests", () => {
  test("checkMinimumInterval falls back to local time when timezone is invalid", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-"));
    try {
      const manager = createManagerWithInvalidTimezone(tmp);
      const warning = manager.checkMinimumInterval("*/5 * * * *");
      assert.strictEqual(warning, messages.minimumIntervalWarning());
    } finally {
      try {
        fs.rmSync(tmp, {
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

  test("checkMinimumInterval returns undefined for long intervals even with invalid timezone", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-"));
    try {
      const manager = createManagerWithInvalidTimezone(tmp);
      const warning = manager.checkMinimumInterval("0 * * * *");
      assert.strictEqual(warning, undefined);
    } finally {
      try {
        fs.rmSync(tmp, {
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

suite("ScheduleManager Prompt Source Migration Tests", () => {
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
      // Best-effort: some VS Code versions may not allow redefining; leave as-is.
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

  test("migrates missing promptSource to local when promptPath is under .github/prompts", () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-ws-"));
    const restoreWs = setWorkspaceFoldersForTest(wsRoot);
    const promptsDir = path.join(wsRoot, ".github", "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });

    const templatePath = path.join(promptsDir, "__test_prompt_source_migration__.md");

    try {
      fs.writeFileSync(templatePath, "hello", "utf8");

      const now = new Date();
      const rawTask = {
        id: "t-migrate-missing",
        name: "t",
        prompt: "OLD",
        cronExpression: "0 * * * *",
        enabled: false,
        scope: "global",
        promptPath: templatePath,
        // promptSource intentionally missing
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-"));
      try {
        const manager = new ScheduleManager(
          createMockContextWithGlobalTasks(tmp, [rawTask]),
        );
        const loaded = manager.getTask(rawTask.id);
        assert.ok(loaded);
        assert.strictEqual(loaded?.promptSource, "local");
        assert.strictEqual(loaded?.promptPath, templatePath);
      } finally {
        try {
          fs.rmSync(tmp, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    } finally {
      restoreWs();
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

  test("heals inline promptSource to local when promptPath exists under .github/prompts", () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-ws-"));
    const restoreWs = setWorkspaceFoldersForTest(wsRoot);
    const promptsDir = path.join(wsRoot, ".github", "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });

    const templatePath = path.join(promptsDir, "__test_prompt_source_heal__.md");

    try {
      fs.writeFileSync(templatePath, "hello", "utf8");

      const now = new Date();
      const rawTask = {
        id: "t-migrate-inline",
        name: "t",
        prompt: "OLD",
        cronExpression: "0 * * * *",
        enabled: false,
        scope: "global",
        promptSource: "inline",
        promptPath: templatePath,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };

      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-"));
      try {
        const manager = new ScheduleManager(
          createMockContextWithGlobalTasks(tmp, [rawTask]),
        );
        const loaded = manager.getTask(rawTask.id);
        assert.ok(loaded);
        assert.strictEqual(loaded?.promptSource, "local");
        assert.strictEqual(loaded?.promptPath, templatePath);
      } finally {
        try {
          fs.rmSync(tmp, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    } finally {
      restoreWs();
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

suite("ScheduleManager Workspace JSON Sanitization Tests", () => {
  function setWorkspaceFoldersForTest(root: string): () => void {
    const original = vscode.workspace.workspaceFolders;
    try {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [{ uri: vscode.Uri.file(root) }],
        configurable: true,
      });
    } catch {
      // ignore
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

  test("redacts Discord webhook URLs when persisting workspace scheduler JSON", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));
    const liveWebhookUrl =
      "https://discord.com/api/webhooks/0000000000000000000/FAKE_WEBHOOK_TOKEN_FOR_TEST_SANITIZER_1234567890";
    const prompt = `Use webhook ${liveWebhookUrl} for notifications.`;

    try {
      const task = await manager.createTask({
        name: "Sanitize persisted webhook",
        cronExpression: "0 * * * *",
        prompt,
        enabled: false,
        scope: "workspace",
      });

      const schedulerJsonPath = path.join(
        workspaceRoot,
        ".vscode",
        "scheduler.json",
      );
      const privateSchedulerJsonPath = getPrivateSchedulerConfigPath(
        schedulerJsonPath,
      );
      const savedConfig = JSON.parse(
        fs.readFileSync(schedulerJsonPath, "utf8"),
      ) as {
        tasks: Array<{ prompt: string }>;
      };
      const privateSavedConfig = JSON.parse(
        fs.readFileSync(privateSchedulerJsonPath, "utf8"),
      ) as {
        tasks: Array<{ prompt: string }>;
      };

      assert.ok(Array.isArray(savedConfig.tasks));
      assert.strictEqual(savedConfig.tasks[0]?.prompt.includes(liveWebhookUrl), false);
      assert.strictEqual(
        savedConfig.tasks[0]?.prompt.includes(REDACTED_DISCORD_WEBHOOK_URL),
        true,
      );
      assert.strictEqual(privateSavedConfig.tasks[0]?.prompt, prompt);
      assert.strictEqual(manager.getTask(task.id)?.prompt, prompt);
    } finally {
      restoreWs();
      try {
        fs.rmSync(workspaceRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(storageRoot, {
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

suite("ScheduleManager Nested Workspace Root Tests", () => {
  function normalizePathForAssert(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === "win32"
      ? normalized.toLowerCase()
      : normalized;
  }

  function setWorkspaceFoldersForTest(root: string): () => void {
    const original = vscode.workspace.workspaceFolders;
    try {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [{ uri: vscode.Uri.file(root) }],
        configurable: true,
      });
    } catch {
      // ignore
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

  test("loads and saves workspace tasks using the ancestor scheduler root", async () => {
    const parentRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-parent-root-"),
    );
    const childWorkspace = path.join(parentRoot, "extensions", "source-scheduler");
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    fs.mkdirSync(path.join(parentRoot, ".vscode"), { recursive: true });
    fs.mkdirSync(childWorkspace, { recursive: true });

    const existingTask = {
      id: "nested-parent-task",
      name: "Parent-root task",
      cron: "0 * * * *",
      prompt: "from parent root",
      enabled: false,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    };

    fs.writeFileSync(
      path.join(parentRoot, ".vscode", "scheduler.json"),
      JSON.stringify({ tasks: [existingTask] }, null, 2),
      "utf8",
    );

    const restoreWs = setWorkspaceFoldersForTest(childWorkspace);

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));

      const loadedTask = manager.getTask(existingTask.id);
      assert.ok(loadedTask);
      assert.strictEqual(
        normalizePathForAssert(loadedTask?.workspacePath || ""),
        normalizePathForAssert(parentRoot),
      );
      assert.strictEqual(manager.shouldTaskRunInCurrentWorkspace(loadedTask!), true);

      const createdTask = await manager.createTask({
        name: "Created from child workspace",
        cronExpression: "15 * * * *",
        prompt: "persist at parent root",
        enabled: false,
        scope: "workspace",
      });

      assert.strictEqual(
        normalizePathForAssert(createdTask.workspacePath || ""),
        normalizePathForAssert(parentRoot),
      );
      assert.strictEqual(
        fs.existsSync(path.join(childWorkspace, ".vscode", "scheduler.json")),
        false,
      );

      const savedConfig = JSON.parse(
        fs.readFileSync(path.join(parentRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ id: string; workspacePath?: string }>;
      };

      assert.ok(Array.isArray(savedConfig.tasks));
      assert.ok(savedConfig.tasks.some((task) => task.id === existingTask.id));
      assert.ok(savedConfig.tasks.some((task) => task.id === createdTask.id));
      assert.strictEqual(
        normalizePathForAssert(
          savedConfig.tasks.find((task) => task.id === createdTask.id)
            ?.workspacePath || "",
        ),
        normalizePathForAssert(parentRoot),
      );
    } finally {
      restoreWs();
      try {
        fs.rmSync(parentRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(storageRoot, {
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

suite("ScheduleManager Prompt Backup Tests", () => {
  function setWorkspaceFoldersForTest(root: string): () => void {
    const original = vscode.workspace.workspaceFolders;
    try {
      Object.defineProperty(vscode.workspace, "workspaceFolders", {
        value: [{ uri: vscode.Uri.file(root) }],
        configurable: true,
      });
    } catch {
      // ignore
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

  test("keeps inline promptSource when only backup metadata is present", () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-ws-"));
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(wsRoot);
    const now = new Date("2026-03-15T12:00:00.000Z");

    const rawTask = {
      id: "t-inline-backup-only",
      name: "Inline backup",
      prompt: "INLINE",
      cronExpression: "0 * * * *",
      enabled: false,
      scope: "global",
      promptSource: "inline",
      promptBackupPath: ".github/scheduler-prompt-backups/t-inline-backup-only.prompt.md",
      promptBackupUpdatedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };

    try {
      const manager = new ScheduleManager(
        createMockContextWithGlobalTasks(storageRoot, [rawTask]),
      );
      const loaded = manager.getTask(rawTask.id);

      assert.ok(loaded);
      assert.strictEqual(loaded?.promptSource, "inline");
      assert.strictEqual(loaded?.promptPath, undefined);
      assert.strictEqual(loaded?.promptBackupPath, rawTask.promptBackupPath);
      assert.ok(loaded?.promptBackupUpdatedAt instanceof Date);
    } finally {
      restoreWs();
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
      try {
        fs.rmSync(storageRoot, {
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

  test("writes backup-only prompt files for recurring inline workspace tasks", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const recurringTask = await manager.createTask({
        name: "Back up recurring prompt",
        cronExpression: "0 * * * *",
        prompt: "Recurring backup body",
        enabled: false,
        scope: "workspace",
      });
      const oneTimeTask = await manager.createTask({
        name: "Skip one-time prompt backup",
        cronExpression: "0 * * * *",
        prompt: "One-time body",
        enabled: false,
        scope: "workspace",
        oneTime: true,
      });

      const savedRecurring = manager.getTask(recurringTask.id);
      const savedOneTime = manager.getTask(oneTimeTask.id);
      const recurringBackupPath = savedRecurring?.promptBackupPath
        ? path.join(workspaceRoot, savedRecurring.promptBackupPath)
        : undefined;

      assert.ok(recurringBackupPath);
      assert.ok(fs.existsSync(recurringBackupPath!));
      assert.strictEqual(savedRecurring?.promptSource, "inline");
      assert.ok(savedRecurring?.promptBackupUpdatedAt instanceof Date);
      assert.strictEqual(savedOneTime?.promptBackupPath, undefined);

      const backupContent = fs.readFileSync(recurringBackupPath!, "utf8");
      assert.ok(backupContent.includes("backupOnly: true"));
      assert.ok(
        backupContent.includes('authoritativeSource: ".vscode/scheduler.json"'),
      );
      assert.ok(
        /lastUpdated: "\d{4}-\d{2}-\d{2}"/.test(backupContent),
      );
      assert.ok(backupContent.endsWith("Recurring backup body\n"));
    } finally {
      restoreWs();
      try {
        fs.rmSync(workspaceRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
      } catch {
        // ignore
      }
      try {
        fs.rmSync(storageRoot, {
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
