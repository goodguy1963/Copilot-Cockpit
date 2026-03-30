import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ScheduleManager } from "../../scheduleManager";
import { messages } from "../../i18n";
import { getScheduleHistoryRoot } from "../../scheduleHistory";
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

suite("ScheduleManager Recurring Chat Session Tests", () => {
  function setWorkspaceFoldersForRecurringTest(root: string): () => void {
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

  test("persists chatSession only for recurring tasks", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-chat-session-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-chat-session-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForRecurringTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const recurringTask = await manager.createTask({
        name: "Recurring chat",
        cronExpression: "0 * * * *",
        prompt: "recurring prompt",
        enabled: false,
        scope: "workspace",
        chatSession: "continue",
      });
      const oneTimeTask = await manager.createTask({
        name: "One-time chat",
        cronExpression: "0 * * * *",
        prompt: "one-time prompt",
        enabled: false,
        scope: "workspace",
        oneTime: true,
        chatSession: "continue",
      });

      assert.strictEqual(manager.getTask(recurringTask.id)?.chatSession, "continue");
      assert.strictEqual(manager.getTask(oneTimeTask.id)?.chatSession, undefined);

      const liveSchedulerJson = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ id: string; chatSession?: string }>;
      };

      const recurringJson = liveSchedulerJson.tasks.find((task) => task.id === recurringTask.id);
      const oneTimeJson = liveSchedulerJson.tasks.find((task) => task.id === oneTimeTask.id);

      assert.strictEqual(recurringJson?.chatSession, "continue");
      assert.strictEqual(oneTimeJson?.chatSession, undefined);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("clears chatSession when a task becomes one-time", async () => {
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-chat-session-update-"),
    );

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const task = await manager.createTask({
        name: "Recurring task",
        cronExpression: "0 * * * *",
        prompt: "prompt",
        enabled: false,
        scope: "global",
        chatSession: "continue",
      });

      const updated = await manager.updateTask(task.id, {
        oneTime: true,
      });

      assert.strictEqual(updated?.oneTime, true);
      assert.strictEqual(updated?.chatSession, undefined);
    } finally {
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

suite("ScheduleManager Jobs Tests", () => {
  function setWorkspaceFoldersForJobTest(root: string): () => void {
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

  test("persists jobs and folders in workspace scheduler config", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-jobs-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-jobs-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const folder = await manager.createJobFolder({ name: "Marketing" });
      const job = await manager.createJob({
        name: "Morning pipeline",
        cronExpression: "0 9 * * 1-5",
        folderId: folder.id,
      });
      const step = await manager.createTaskInJob(
        job.id,
        {
          name: "Draft newsletter",
          cronExpression: "0 9 * * 1-5",
          prompt: "Write the newsletter draft.",
          enabled: true,
          scope: "workspace",
          labels: ["email", "weekly"],
        },
        45,
      );

      assert.ok(step);
      assert.strictEqual(step?.jobId, job.id);
      assert.strictEqual(manager.getAllJobs().length, 1);
      assert.strictEqual(manager.getAllJobFolders().length, 1);

      const liveSchedulerJson = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ id: string; jobId?: string; labels?: string[] }>;
        jobs: Array<{ id: string; folderId?: string; nodes?: Array<{ taskId: string; windowMinutes: number }> }>;
        jobFolders: Array<{ id: string; name: string }>;
      };

      assert.strictEqual(liveSchedulerJson.jobs.length, 1);
      assert.strictEqual(liveSchedulerJson.jobFolders.length, 1);
      assert.strictEqual(liveSchedulerJson.jobs[0]?.folderId, folder.id);
      assert.strictEqual(liveSchedulerJson.jobs[0]?.nodes?.[0]?.taskId, step?.id);
      assert.strictEqual(liveSchedulerJson.jobs[0]?.nodes?.[0]?.windowMinutes, 45);
      assert.strictEqual(
        liveSchedulerJson.tasks.find((task) => task.id === step?.id)?.jobId,
        job.id,
      );
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("deleting a job detaches child tasks instead of deleting them", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-jobs-delete-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-jobs-delete-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const job = await manager.createJob({
        name: "Review flow",
        cronExpression: "0 10 * * *",
      });
      const step = await manager.createTaskInJob(job.id, {
        name: "Review prompt",
        cronExpression: "0 10 * * *",
        prompt: "Review the generated output.",
        enabled: true,
        scope: "workspace",
      });

      assert.ok(step);
      assert.strictEqual(step?.jobId, job.id);

      const deleted = await manager.deleteJob(job.id);
      assert.strictEqual(deleted, true);
      assert.strictEqual(manager.getAllJobs().length, 0);

      const detachedTask = manager.getTask(step?.id || "");
      assert.ok(detachedTask);
      assert.strictEqual(detachedTask?.jobId, undefined);
      assert.strictEqual(detachedTask?.jobNodeId, undefined);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("deleting a job step removes the task from the task list too", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-delete-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-delete-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const job = await manager.createJob({
        name: "Cleanup flow",
        cronExpression: "0 10 * * *",
      });
      const step = await manager.createTaskInJob(job.id, {
        name: "Cleanup prompt",
        cronExpression: "0 10 * * *",
        prompt: "Delete stale items.",
        enabled: true,
        scope: "workspace",
      });

      assert.ok(step);
      const nodeId = manager.getJob(job.id)?.nodes[0]?.id;
      assert.ok(nodeId);

      const updatedJob = await manager.deleteTaskFromJob(job.id, nodeId || "");
      assert.ok(updatedJob);
      assert.strictEqual(updatedJob?.nodes.length, 0);
      assert.strictEqual(manager.getTask(step?.id || ""), undefined);
      assert.strictEqual(
        manager.getAllTasks().some((task) => task.id === step?.id),
        false,
      );
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("attaching an existing job task again creates a reusable copy for the workflow", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-repeat-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-repeat-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const job = await manager.createJob({
        name: "Repeatable flow",
        cronExpression: "0 10 * * *",
      });
      const step = await manager.createTaskInJob(job.id, {
        name: "Review prompt",
        cronExpression: "0 10 * * *",
        prompt: "Review the generated output.",
        enabled: true,
        scope: "workspace",
      });

      assert.ok(step);

      const updatedJob = await manager.attachTaskToJob(job.id, step?.id || "", 45);
      assert.ok(updatedJob);
      assert.strictEqual(updatedJob?.nodes.length, 2);

      const firstNode = updatedJob?.nodes[0];
      const secondNode = updatedJob?.nodes[1];
      assert.ok(firstNode && secondNode && "taskId" in firstNode && "taskId" in secondNode);
      assert.notStrictEqual((firstNode as any).taskId, (secondNode as any).taskId);

      const clonedTask = manager.getTask((secondNode as any).taskId);
      assert.ok(clonedTask);
      assert.strictEqual(clonedTask?.name, step?.name);
      assert.strictEqual(clonedTask?.jobId, job.id);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("pause checkpoints block downstream steps until approval", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));
    manager.setOnExecuteCallback(async () => undefined);

    try {
      const job = await manager.createJob({
        name: "Approval flow",
        cronExpression: "0 10 * * *",
      });
      const firstStep = await manager.createTaskInJob(job.id, {
        name: "Draft step",
        cronExpression: "0 10 * * *",
        prompt: "Draft the output.",
        enabled: true,
        scope: "workspace",
      });
      await manager.createPauseInJob(job.id, { title: "Review checkpoint" });
      const secondStep = await manager.createTaskInJob(job.id, {
        name: "Publish step",
        cronExpression: "0 10 * * *",
        prompt: "Publish the approved result.",
        enabled: true,
        scope: "workspace",
      });

      const liveJob = manager.getJob(job.id);
      const pauseNode = liveJob?.nodes.find((node) => (node as { type?: string }).type === "pause");

      assert.ok(firstStep);
      assert.ok(secondStep);
      assert.ok(pauseNode);
      assert.ok(manager.getTask(firstStep?.id || "")?.nextRun);
      assert.strictEqual(manager.getTask(secondStep?.id || "")?.nextRun, undefined);

      const executed = await manager.runTaskNow(firstStep?.id || "");
      assert.strictEqual(executed, true);
      assert.strictEqual(
        manager.getJob(job.id)?.runtime?.waitingPause?.nodeId,
        pauseNode?.id,
      );

      const rejection = await manager.rejectJobPause(job.id, pauseNode?.id || "");
      assert.strictEqual(rejection?.previousTaskId, firstStep?.id);
      assert.strictEqual(manager.getTask(secondStep?.id || "")?.nextRun, undefined);

      const approved = await manager.approveJobPause(job.id, pauseNode?.id || "");
      assert.ok(approved);
      assert.strictEqual(approved?.runtime?.waitingPause, undefined);
      assert.ok(manager.getTask(secondStep?.id || "")?.nextRun);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("pause checkpoints can be renamed and deleted", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-edit-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-edit-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const job = await manager.createJob({
        name: "Pause edit flow",
        cronExpression: "0 10 * * *",
      });
      const firstStep = await manager.createTaskInJob(job.id, {
        name: "Draft step",
        cronExpression: "0 10 * * *",
        prompt: "Draft.",
        enabled: true,
        scope: "workspace",
      });
      await manager.createPauseInJob(job.id, { title: "Review checkpoint" });

      const pauseNodeId = manager.getJob(job.id)?.nodes.find((node) => (node as { type?: string }).type === "pause")?.id || "";
      assert.ok(firstStep);
      assert.ok(pauseNodeId);

      const renamed = await manager.updateJobPause(job.id, pauseNodeId, { title: "Updated review" });
      assert.ok(renamed);
      const renamedPauseNode = renamed?.nodes.find((node) => node.id === pauseNodeId) as
        | { id: string; type: "pause"; title: string }
        | undefined;
      assert.strictEqual(
        renamedPauseNode?.title,
        "Updated review",
      );

      const deleted = await manager.deleteJobPause(job.id, pauseNodeId);
      assert.ok(deleted);
      assert.strictEqual(
        deleted?.nodes.some((node) => node.id === pauseNodeId),
        false,
      );
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("compiling a job creates one combined task and archives the source job", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-compile-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-compile-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForJobTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const job = await manager.createJob({
        name: "Campaign flow",
        cronExpression: "0 9 * * 1-5",
      });
      await manager.createTaskInJob(job.id, {
        name: "Draft brief",
        cronExpression: "0 9 * * 1-5",
        prompt: "Write the campaign brief.",
        enabled: true,
        scope: "workspace",
      });
      await manager.createPauseInJob(job.id, { title: "Manager review" });
      await manager.createTaskInJob(job.id, {
        name: "Publish brief",
        cronExpression: "0 9 * * 1-5",
        prompt: "Publish the approved brief.",
        enabled: true,
        scope: "workspace",
      });

      const compiled = await manager.compileJobToTask(job.id);
      const archivedJob = manager.getJob(job.id);
      const archiveFolder = archivedJob?.folderId
        ? manager.getJobFolder(archivedJob.folderId)
        : undefined;

      assert.ok(compiled);
      assert.strictEqual(compiled?.task.name, "Bundled Task");
      assert.ok(compiled?.task.prompt.includes("Draft brief"));
      assert.ok(compiled?.task.prompt.includes("Checkpoint 1: Manager review"));
      assert.ok(compiled?.task.prompt.includes("Publish brief"));
      assert.strictEqual(compiled?.task.jobId, undefined);
      assert.strictEqual(archivedJob?.paused, true);
      assert.strictEqual(archivedJob?.archived, true);
      assert.strictEqual(archiveFolder?.name, "Bundled Jobs");
      assert.strictEqual(archivedJob?.lastCompiledTaskId, compiled?.task.id);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
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

  test("keeps workspace tasks isolated to the opened workspace root", async () => {
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
      assert.strictEqual(loadedTask, undefined);

      const createdTask = await manager.createTask({
        name: "Created from child workspace",
        cronExpression: "15 * * * *",
        prompt: "persist at parent root",
        enabled: false,
        scope: "workspace",
      });

      assert.strictEqual(
        normalizePathForAssert(createdTask.workspacePath || ""),
        normalizePathForAssert(childWorkspace),
      );
      assert.strictEqual(
        fs.existsSync(path.join(childWorkspace, ".vscode", "scheduler.json")),
        true,
      );

      const childConfig = JSON.parse(
        fs.readFileSync(path.join(childWorkspace, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ id: string; workspacePath?: string }>;
      };

      assert.ok(Array.isArray(childConfig.tasks));
      assert.ok(childConfig.tasks.some((task) => task.id === createdTask.id));
      assert.strictEqual(
        normalizePathForAssert(
          childConfig.tasks.find((task) => task.id === createdTask.id)
            ?.workspacePath || "",
        ),
        normalizePathForAssert(childWorkspace),
      );

      const savedConfig = JSON.parse(
        fs.readFileSync(path.join(parentRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ id: string; workspacePath?: string }>;
      };

      assert.ok(Array.isArray(savedConfig.tasks));
      assert.ok(savedConfig.tasks.some((task) => task.id === existingTask.id));
      assert.ok(savedConfig.tasks.every((task) => task.id !== createdTask.id));
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
      assert.ok(
        recurringBackupPath?.includes(
          path.join(".vscode", "cockpit-prompt-backups"),
        ),
      );
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

  test("migrates legacy recurring prompt backups into .vscode", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-migrate-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-migrate-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const createdTask = await manager.createTask({
        name: "Legacy inline backup",
        cronExpression: "0 * * * *",
        prompt: "Recurring backup body",
        enabled: false,
        scope: "workspace",
      });

      const liveTask = manager.getTask(createdTask.id);
      const currentRelativePath = liveTask?.promptBackupPath;
      assert.ok(currentRelativePath);

      const currentBackupPath = path.join(workspaceRoot, currentRelativePath!);
      const legacyRelativePath = currentRelativePath!.replace(
        ".vscode/",
        ".github/",
      );
      const nextRelativePath = currentRelativePath!;
      const legacyBackupPath = path.join(workspaceRoot, legacyRelativePath);

      fs.mkdirSync(path.dirname(legacyBackupPath), { recursive: true });
      fs.renameSync(currentBackupPath, legacyBackupPath);

      liveTask!.promptBackupPath = legacyRelativePath;

      const changed = await manager.ensureRecurringPromptBackups();
      const stabilized = await manager.ensureRecurringPromptBackups();
      const migratedTask = manager.getTask(createdTask.id);
      const nextBackupPath = path.join(workspaceRoot, nextRelativePath);

      assert.ok(changed > 0);
      assert.strictEqual(stabilized, 0);
      assert.strictEqual(migratedTask?.promptBackupPath, nextRelativePath);
      assert.ok(fs.existsSync(nextBackupPath));
      assert.strictEqual(fs.existsSync(legacyBackupPath), false);
      assert.ok(
        fs
          .readFileSync(nextBackupPath, "utf8")
          .endsWith("Recurring backup body\n"),
      );
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

suite("ScheduleManager Overdue Task Tests", () => {
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

  test("lists overdue tasks only for the current workspace", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-overdue-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);
    const now = new Date("2026-03-23T10:20:00.000Z");

    const overdueWorkspaceTask = {
      id: "overdue-workspace",
      name: "Overdue workspace",
      prompt: "run me",
      cronExpression: "*/5 * * * *",
      enabled: true,
      scope: "global",
      promptSource: "inline",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRun: "2026-03-23T10:15:00.000Z",
    };

    const futureWorkspaceTask = {
      ...overdueWorkspaceTask,
      id: "future-workspace",
      nextRun: "2026-03-23T10:25:00.000Z",
    };

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: overdueWorkspaceTask.id,
                name: overdueWorkspaceTask.name,
                cron: overdueWorkspaceTask.cronExpression,
                prompt: overdueWorkspaceTask.prompt,
                enabled: overdueWorkspaceTask.enabled,
                createdAt: overdueWorkspaceTask.createdAt,
                updatedAt: overdueWorkspaceTask.updatedAt,
                nextRun: overdueWorkspaceTask.nextRun,
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(
        createMockContextWithGlobalTasks(storageRoot, [
          futureWorkspaceTask,
        ]),
      );

      const overdue = manager.getOverdueTasks(now).map((task) => task.id);
      assert.deepStrictEqual(overdue, ["overdue-workspace"]);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("can defer recurring overdue tasks and reschedule one-time overdue tasks", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-overdue-actions-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);
    const now = new Date("2026-03-23T10:20:00.000Z");

    const recurringTask = {
      id: "overdue-recurring",
      name: "Recurring overdue",
      prompt: "run me later",
      cronExpression: "*/5 * * * *",
      enabled: true,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextRun: "2026-03-23T10:15:00.000Z",
    };

    const oneTimeTask = {
      ...recurringTask,
      id: "overdue-one-time",
      name: "One-time overdue",
      oneTime: true,
    };

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: recurringTask.id,
                name: recurringTask.name,
                cron: recurringTask.cronExpression,
                prompt: recurringTask.prompt,
                enabled: recurringTask.enabled,
                createdAt: recurringTask.createdAt,
                updatedAt: recurringTask.updatedAt,
                nextRun: recurringTask.nextRun,
              },
              {
                id: oneTimeTask.id,
                name: oneTimeTask.name,
                cron: oneTimeTask.cronExpression,
                prompt: oneTimeTask.prompt,
                enabled: oneTimeTask.enabled,
                oneTime: true,
                createdAt: oneTimeTask.createdAt,
                updatedAt: oneTimeTask.updatedAt,
                nextRun: oneTimeTask.nextRun,
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(
        createMockContext(storageRoot),
      );

      const deferred = await manager.deferTaskToNextCycle(recurringTask.id, now);
      assert.strictEqual(deferred, true);

      const updatedRecurring = manager.getTask(recurringTask.id);
      assert.ok(updatedRecurring?.nextRun);
      assert.ok(updatedRecurring!.nextRun!.getTime() > now.getTime());

      const rescheduled = await manager.rescheduleTaskInMinutes(
        oneTimeTask.id,
        12,
        now,
      );
      assert.strictEqual(rescheduled, true);

      const updatedOneTime = manager.getTask(oneTimeTask.id);
      assert.ok(updatedOneTime?.nextRun);
      assert.strictEqual(
        updatedOneTime!.nextRun!.toISOString(),
        new Date("2026-03-23T10:32:00.000Z").toISOString(),
      );
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });
});

suite("ScheduleManager History Snapshot Tests", () => {
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

  function getHistoryFilePaths(workspaceRoot: string, snapshotId: string): {
    publicPath: string;
    privatePath: string;
  } {
    const historyRoot = getScheduleHistoryRoot(workspaceRoot);
    return {
      publicPath: path.join(historyRoot, `scheduler-${snapshotId}.json`),
      privatePath: path.join(historyRoot, `scheduler-${snapshotId}.private.json`),
    };
  }

  test("stores sanitized public history, private history, and trims to 100 snapshots", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-history-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-history-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));
    const liveWebhookUrl =
      "https://discord.com/api/webhooks/0000000000000000000/FAKE_HISTORY_TOKEN_1234567890";

    try {
      const task = await manager.createTask({
        name: "Snapshot task",
        cronExpression: "0 * * * *",
        prompt: `History prompt ${liveWebhookUrl}`,
        enabled: false,
        scope: "workspace",
      });

      const firstEntry = manager.getWorkspaceScheduleHistory()[0];
      assert.ok(firstEntry);

      const firstFiles = getHistoryFilePaths(workspaceRoot, firstEntry.id);
      const publicSnapshot = JSON.parse(
        fs.readFileSync(firstFiles.publicPath, "utf8"),
      ) as {
        tasks: Array<{ prompt: string }>;
      };
      const privateSnapshot = JSON.parse(
        fs.readFileSync(firstFiles.privatePath, "utf8"),
      ) as {
        tasks: Array<{ prompt: string }>;
      };

      assert.strictEqual(
        publicSnapshot.tasks[0]?.prompt.includes(liveWebhookUrl),
        false,
      );
      assert.strictEqual(
        publicSnapshot.tasks[0]?.prompt.includes(REDACTED_DISCORD_WEBHOOK_URL),
        true,
      );
      assert.strictEqual(
        privateSnapshot.tasks[0]?.prompt.includes(liveWebhookUrl),
        true,
      );

      for (let index = 0; index < 105; index += 1) {
        const updated = await manager.updateTask(task.id, {
          description: `revision-${index}`,
        });
        assert.ok(updated);
      }

      const historyEntries = manager.getWorkspaceScheduleHistory();
      assert.strictEqual(historyEntries.length, 100);
      assert.ok(fs.existsSync(getScheduleHistoryRoot(workspaceRoot)));
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("restores a previous workspace schedule snapshot and snapshots the pre-restore state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-history-restore-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-history-restore-storage-"),
    );
    const restoreWs = setWorkspaceFoldersForTest(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const task = await manager.createTask({
        name: "Restore task",
        cronExpression: "0 * * * *",
        prompt: "prompt version A",
        enabled: false,
        scope: "workspace",
      });

      const createdSnapshotId = manager.getWorkspaceScheduleHistory()[0]?.id;
      assert.ok(createdSnapshotId);

      await manager.updateTask(task.id, {
        prompt: "prompt version B",
      });

      const beforeRestore = manager.getWorkspaceScheduleHistory();
      assert.strictEqual(beforeRestore.length >= 2, true);

      const restored = await manager.restoreWorkspaceScheduleHistory(
        createdSnapshotId!,
      );
      assert.strictEqual(restored, true);

      const restoredTask = manager.getTask(task.id);
      assert.strictEqual(restoredTask?.prompt, "prompt version A");

      const liveSchedulerJson = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ prompt: string }>;
      };
      const livePrivateJson = JSON.parse(
        fs.readFileSync(
          getPrivateSchedulerConfigPath(
            path.join(workspaceRoot, ".vscode", "scheduler.json"),
          ),
          "utf8",
        ),
      ) as {
        tasks: Array<{ prompt: string }>;
      };

      assert.strictEqual(liveSchedulerJson.tasks[0]?.prompt, "prompt version A");
      assert.strictEqual(livePrivateJson.tasks[0]?.prompt, "prompt version A");

      const afterRestore = manager.getWorkspaceScheduleHistory();
      assert.ok(afterRestore.length >= beforeRestore.length + 1);
    } finally {
      restoreWs();
      for (const dir of [workspaceRoot, storageRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });
});
