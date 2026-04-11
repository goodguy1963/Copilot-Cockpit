import * as assert from "assert";
import * as os from "os";
import * as path from "path"; // local-diverge-3
import * as fs from "fs";
import * as vscode from "vscode";
import { createDefaultCockpitBoard } from "../../cockpitBoard";
import { ensureTaskTodosInBoard } from "../../cockpitBoardManager";
import { ScheduleManager } from "../../cockpitManager";
import { messages } from "../../i18n";
import { getScheduleHistoryRoot } from "../../cockpitHistory";
import { readWorkspaceSchedulerStateFromSqlite } from "../../sqliteBootstrap";
import {
  getPrivateSchedulerConfigPath,
  REDACTED_DISCORD_WEBHOOK_URL,
} from "../../cockpitJsonSanitizer";
import {
  createMockContext,
  createTempDir,
  removeTestPath,
  removeTestPaths,
  overrideWorkspaceFolders,
  setWorkspaceStorageModeForTest,
} from "./helpers/vscodeTestHarness";

function createManagerWithInvalidTimezone(storageRoot: string): ScheduleManager {
  const manager = new ScheduleManager(createMockContext(storageRoot));
  // Prevent real VS Code config writes during tests by stubbing the instance.
  (manager as unknown as { getTimeZone: () => string | undefined }).getTimeZone =
    () => "Invalid/Timezone";
  return manager;
}

function checkMinimumIntervalWithInvalidTimezone(
  storageRoot: string,
  cronExpression: string,
): string | undefined {
  const manager = createManagerWithInvalidTimezone(storageRoot);
  return manager.validateMinimumInterval(cronExpression);
}

suite("ScheduleManager Cron Interval Validation", () => {
  test("validateMinimumInterval falls back to local time when timezone is invalid", () => {
    const tmp = createTempDir("copilot-scheduler-");
    try {
      const warning = checkMinimumIntervalWithInvalidTimezone(tmp, "*/5 * * * *");
      assert.strictEqual(warning, messages.minimumIntervalWarning(), "short interval triggers warning");
    } finally {
      removeTestPath(tmp);
    }
  });

  test("validateMinimumInterval returns undefined for long intervals even with invalid timezone", () => {
    const tmp = createTempDir("copilot-scheduler-");
    try {
      const warning = checkMinimumIntervalWithInvalidTimezone(tmp, "0 * * * *");
      assert.strictEqual(warning, undefined, "long interval is accepted");
    } finally {
      removeTestPath(tmp);
    }
  });
});

suite("ScheduleManager Recurring Chat Session Tests", () => {
  test("persists chatSession only for recurring tasks", async () => {
    const workspaceRoot = createTempDir("copilot-scheduler-chat-session-ws-");
    const storageRoot = createTempDir("copilot-scheduler-chat-session-storage-");
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("clears chatSession when a task becomes one-time", async () => {
    const storageRoot = createTempDir("copilot-scheduler-chat-session-update-");

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const task = await manager.createTask({ // local-diverge-114
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
      removeTestPath(storageRoot);
    }
  });

  test("allows updating a local template task without resubmitting inline prompt text", async () => {
    const storageRoot = createTempDir("copilot-scheduler-template-task-update-");

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const task = await manager.createTask({ // local-diverge-139
        name: "Template task",
        cronExpression: "0 * * * *",
        prompt: "stored fallback prompt",
        enabled: false,
        scope: "global",
        promptSource: "local",
        promptPath: ".github/prompts/template.md",
      });

      const updated = await manager.updateTask(task.id, {
        name: "Template task updated",
        prompt: "",
        promptSource: "local",
        promptPath: ".github/prompts/template.md",
      });

      assert.strictEqual(updated?.name, "Template task updated");
      assert.strictEqual(updated?.promptSource, "local");
      assert.strictEqual(updated?.promptPath, ".github/prompts/template.md");
      assert.strictEqual(updated?.prompt, "");
    } finally {
      removeTestPath(storageRoot);
    }
  });

  test("persists manualSession separately from recurring and clears it for one-time tasks", async () => {
    const workspaceRoot = createTempDir("copilot-scheduler-manual-session-workspace-");
    const storageRoot = createTempDir("copilot-scheduler-manual-session-storage-");
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const manualTask = await manager.createTask({
        name: "Manual session task",
        cronExpression: "0 * * * *",
        prompt: "manual prompt",
        enabled: false,
        scope: "workspace",
        manualSession: true,
        chatSession: "continue",
      });

      assert.strictEqual(manager.getTask(manualTask.id)?.manualSession, true);

      const updated = await manager.updateTask(manualTask.id, {
        oneTime: true,
      });

      assert.strictEqual(updated?.oneTime, true);
      assert.strictEqual(updated?.manualSession, undefined);

      const liveSchedulerJson = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as {
        tasks: Array<{ id: string; manualSession?: boolean }>;
      };

      const manualJson = liveSchedulerJson.tasks.find((task) => task.id === manualTask.id);
      assert.strictEqual(manualJson?.manualSession, undefined);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});

suite("ScheduleManager Todo Lifecycle Sync Tests", () => {
  test("linked one-time tasks move from ready to ON-SCHEDULE-LIST and then FINAL-USER-CHECK", async () => {
    const workspaceRoot = createTempDir("copilot-scheduler-todo-sync-ws-");
    const storageRoot = createTempDir("copilot-scheduler-todo-sync-storage-");
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const manager = new ScheduleManager(createMockContext(storageRoot));

    try {
      const task = await manager.createTask({
        name: "Todo linked draft",
        cronExpression: "0 9 * * 1-5",
        prompt: "Do the work",
        enabled: false,
        oneTime: true,
        scope: "workspace",
        promptSource: "inline",
      });
      const board = createDefaultCockpitBoard("2026-03-28T10:00:00.000Z");
      board.cards.push({
        id: "todo-sync",
        title: "Todo linked draft",
        sectionId: "unsorted",
        order: 0,
        priority: "medium",
        status: "active",
        labels: [],
        flags: ["ready"],
        comments: [],
        taskId: task.id,
        archived: false,
        createdAt: "2026-03-28T10:00:00.000Z",
        updatedAt: "2026-03-28T10:00:00.000Z",
      });

      const draftBoard = ensureTaskTodosInBoard(board, manager.getAllTasks()).board;
      assert.deepStrictEqual(draftBoard.cards[0]?.flags, ["ready"]);

      await manager.updateTask(task.id, {
        enabled: true,
      });
      const activeBoard = ensureTaskTodosInBoard(draftBoard, manager.getAllTasks()).board;
      assert.deepStrictEqual(activeBoard.cards[0]?.flags, ["ON-SCHEDULE-LIST"]);

      await manager.deleteTask(task.id);
      const finishedBoard = ensureTaskTodosInBoard(activeBoard, manager.getAllTasks()).board;
      assert.deepStrictEqual(finishedBoard.cards[0]?.flags, ["FINAL-USER-CHECK"]);
      assert.strictEqual(finishedBoard.cards[0]?.taskId, undefined);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});

suite("ScheduleManager Jobs Tests", () => {
  test("persists jobs and folders in workspace scheduler config", async () => {
    const workspaceRoot = createTempDir("copilot-scheduler-jobs-ws-");
    const storageRoot = createTempDir("copilot-scheduler-jobs-storage-");
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("deleting a job detaches child tasks instead of deleting them", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-jobs-delete-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-jobs-delete-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("deleting a job step removes the task from the task list too", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-delete-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-delete-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("attaching an existing job task again creates a reusable copy for the workflow", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-repeat-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-step-repeat-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("pause checkpoints block downstream steps until approval", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("pause checkpoints can be renamed and deleted", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-edit-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-pause-edit-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("compiling a job creates one combined task and archives the source job", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-compile-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-job-compile-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});

suite("ScheduleManager PromptSource Upgrade", () => {
  type PromptSourceMigrationCase = {
    name: string;
    taskId: string;
    promptPathName: string;
    promptSource?: "inline";
  };

  function runPromptSourceMigrationCase({
    name,
    promptPathName,
    promptSource,
    taskId,
  }: PromptSourceMigrationCase): void {
    const wsRoot = createTempDir("copilot-scheduler-ws-");
    const restoreWs = overrideWorkspaceFolders(wsRoot);
    const promptsDir = path.join(wsRoot, ".github", "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });
    const templatePath = path.join(promptsDir, promptPathName);

    const timestamp = new Date().toISOString();

    try {
      fs.writeFileSync(templatePath, "hello world", "utf8");

      const rawTask: {
        cronExpression: string;
        createdAt: string;
        enabled: boolean;
        id: string;
        name: string;
        prompt: string;
        promptPath: string;
        promptSource?: "inline";
        scope: string;
        updatedAt: string;
      } = {
        cronExpression: "0 * * * *",
        createdAt: timestamp,
        id: taskId,
        enabled: false,
        name: "t", // local-diverge-647
        prompt: "OLD", // legacy-value
        promptPath: templatePath, // override
        scope: "global", // local-diverge-650
        updatedAt: timestamp,
      };
      if (promptSource) {
        rawTask.promptSource = promptSource;
      }

      const tmp = createTempDir(`copilot-scheduler-${name}-`);
      try {
        const manager = new ScheduleManager(
          createMockContext(tmp, [rawTask]),
        );
        const loadedTask = manager.getTask(rawTask.id);
        assert.ok(loadedTask);
        assert.deepStrictEqual(
          {
            promptPath: loadedTask?.promptPath,
            promptSource: loadedTask?.promptSource,
          },
          {
            promptPath: templatePath, // fixture
            promptSource: "local",
          },
        );
      } finally {
        removeTestPath(tmp);
      }
    } finally {
      restoreWs();
      removeTestPath(wsRoot);
    }
  }

  [
    {
      name: "migrates missing promptSource to local when promptPath is under .github/prompts",
      taskId: "t-migrate-missing",
      promptPathName: "__test_prompt_source_migration__.md",
    },
    {
      name: "heals inline promptSource to local when promptPath exists under .github/prompts",
      taskId: "t-migrate-inline",
      promptPathName: "__test_prompt_source_heal__.md",
      promptSource: "inline" as const,
    },
  ].forEach((testCase) => {
    test(testCase.name, () => {
      runPromptSourceMigrationCase(testCase);
    });
  });
});

suite("ScheduleManager Workspace JSON Sanitization Tests", () => {
  test("redacts Discord webhook URLs when persisting workspace scheduler JSON", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
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

    const restoreWs = overrideWorkspaceFolders(childWorkspace);

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
      removeTestPaths(parentRoot, storageRoot);
    }
  });

  test("mirrors workspace tasks into sqlite and hydrates them when sqlite mode is enabled", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-sqlite-workspace-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-sqlite-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const restoreMode = setWorkspaceStorageModeForTest("sqlite");

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const created = await manager.createTask({
        name: "SQLite workspace task",
        cronExpression: "0 * * * *",
        prompt: "sqlite prompt",
        enabled: false,
        scope: "workspace",
      });

      const sqliteState = await readWorkspaceSchedulerStateFromSqlite(workspaceRoot);
      const sqliteTasks = sqliteState.tasks as Array<{ id: string; name: string }>;
      assert.ok(sqliteTasks.some((task) => task.id === created.id && task.name === "SQLite workspace task"));

      const schedulerJsonPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const schedulerJson = JSON.parse(fs.readFileSync(schedulerJsonPath, "utf8")) as {
        tasks: Array<Record<string, unknown>>;
      };
      schedulerJson.tasks = [{
        id: created.id,
        name: "json stale name",
        cron: "0 * * * *",
        prompt: "stale json",
        enabled: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }];
      fs.writeFileSync(schedulerJsonPath, JSON.stringify(schedulerJson, null, 2), "utf8");

      manager.reloadTasks();
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(manager.getTask(created.id)?.name, "SQLite workspace task");
      assert.strictEqual(manager.getTask(created.id)?.prompt, "sqlite prompt");
    } finally {
      restoreMode();
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("hydrates jobs and folders from sqlite when sqlite mode is enabled", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-sqlite-jobs-workspace-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-sqlite-jobs-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const restoreMode = setWorkspaceStorageModeForTest("sqlite");

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const folder = await manager.createJobFolder({ name: "SQLite Folder" });
      const job = await manager.createJob({
        name: "SQLite Job",
        cronExpression: "0 9 * * 1-5",
        folderId: folder.id,
      });

      const sqliteState = await readWorkspaceSchedulerStateFromSqlite(workspaceRoot);
      const sqliteJobs = sqliteState.jobs as Array<{ id: string; name: string; folderId?: string }>;
      const sqliteFolders = sqliteState.jobFolders as Array<{ id: string; name: string }>;
      assert.ok(sqliteJobs.some((entry) => entry.id === job.id && entry.folderId === folder.id));
      assert.ok(sqliteFolders.some((entry) => entry.id === folder.id && entry.name === "SQLite Folder"));

      const schedulerJsonPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const schedulerJson = JSON.parse(fs.readFileSync(schedulerJsonPath, "utf8")) as {
        tasks: Array<Record<string, unknown>>;
        jobs: Array<Record<string, unknown>>;
        jobFolders: Array<Record<string, unknown>>;
      };
      schedulerJson.jobs = [];
      schedulerJson.jobFolders = [];
      fs.writeFileSync(schedulerJsonPath, JSON.stringify(schedulerJson, null, 2), "utf8");

      manager.reloadTasks();
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(manager.getAllJobs().some((entry) => entry.id === job.id), true);
      assert.strictEqual(manager.getAllJobFolders().some((entry) => entry.id === folder.id), true);
    } finally {
      restoreMode();
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});

suite("ScheduleManager Prompt Backup Tests", () => {
  test("keeps inline promptSource when only backup metadata is present", () => {
    const wsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-scheduler-ws-"));
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(wsRoot);
    const now = new Date("2026-03-15T12:00:00.000Z");

    const rawTask = {
      enabled: false,
      cronExpression: "0 * * * *", // local-diverge-960
      id: "t-inline-backup-only",
      name: "Inline backup",
      prompt: "INLINE",
      createdAt: now.toISOString(),
      promptBackupPath: ".github/scheduler-prompt-backups/t-inline-backup-only.prompt.md",
      promptBackupUpdatedAt: now.toISOString(),
      promptSource: "inline",
      scope: "global",
      updatedAt: now.toISOString(), // local-diverge-969
    };

    try {
      const manager = new ScheduleManager(
        createMockContext(storageRoot, [rawTask]),
      );
      const loaded = manager.getTask(rawTask.id);

      assert.ok(loaded);
      assert.strictEqual(loaded?.promptSource, "inline");
      assert.strictEqual(loaded?.promptPath, undefined);
      assert.strictEqual(loaded?.promptBackupPath, rawTask.promptBackupPath);
      assert.ok(loaded?.promptBackupUpdatedAt instanceof Date);
    } finally {
      restoreWs();
      removeTestPaths(wsRoot, storageRoot);
    }
  });

  test("writes backup-only prompt files for recurring inline workspace tasks", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("migrates legacy recurring prompt backups into .vscode", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-migrate-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-migrate-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);

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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("reload canonicalizes legacy workspace prompt backup paths in sqlite mode", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-sqlite-legacy-backup-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-sqlite-legacy-backup-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const restoreMode = setWorkspaceStorageModeForTest("sqlite");

    try {
      const manager = new ScheduleManager(createMockContext(storageRoot));
      const createdTask = await manager.createTask({
        name: "SQLite legacy backup path",
        cronExpression: "0 * * * *",
        prompt: "Recurring backup body",
        enabled: false,
        scope: "workspace",
      });

      const canonicalPath = manager.getTask(createdTask.id)?.promptBackupPath;
      assert.ok(canonicalPath);

      const legacyPath = `.vscode/scheduler-prompt-backups/${canonicalPath}`;
      const schedulerJsonPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const schedulerPrivatePath = getPrivateSchedulerConfigPath(schedulerJsonPath);

      for (const filePath of [schedulerJsonPath, schedulerPrivatePath]) {
        const config = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
          tasks: Array<Record<string, unknown>>;
        };
        const savedTask = config.tasks.find((task) => task.id === createdTask.id);
        assert.ok(savedTask);
        savedTask!.promptBackupPath = legacyPath;
        fs.writeFileSync(filePath, JSON.stringify(config, null, 2), "utf8");
      }

      manager.reloadTasks();

      assert.strictEqual(manager.getTask(createdTask.id)?.promptBackupPath, canonicalPath);

      await (manager as unknown as {
        persistTasks: (options?: { bumpRevision?: boolean }) => Promise<void>;
      }).persistTasks({ bumpRevision: false });

      for (const filePath of [schedulerJsonPath, schedulerPrivatePath]) {
        const config = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
          tasks: Array<Record<string, unknown>>;
        };
        const savedTask = config.tasks.find((task) => task.id === createdTask.id);
        assert.strictEqual(savedTask?.promptBackupPath, canonicalPath);
      }
    } finally {
      restoreMode();
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});

suite("ScheduleManager Overdue Task Tests", () => {
  test("lists overdue tasks only for the current workspace", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-overdue-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const now = new Date("2026-03-23T10:20:00.000Z");

    const overdueWorkspaceTask = {
      id: "overdue-workspace",
      name: "Overdue workspace",
      prompt: "run me",
      enabled: true,
      promptSource: "inline",
      scope: "global", // local-diverge-1123
      cronExpression: "*/5 * * * *",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(), // local-diverge-1126
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
        createMockContext(storageRoot, [
          futureWorkspaceTask,
        ]),
      );

      const overdue = manager.getOverdueTasks(now).map((task) => task.id);
      assert.deepStrictEqual(overdue, ["overdue-workspace"]);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("can defer recurring overdue tasks and reschedule one-time overdue tasks", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-overdue-actions-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const now = new Date("2026-03-23T10:20:00.000Z");

    const recurringTask = {
      id: "overdue-recurring",
      name: "Recurring overdue",
      prompt: "run me later",
      cronExpression: "*/5 * * * *",
      enabled: true,
      createdAt: now.toISOString(), // local-diverge-1191
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("manual run removes a one-time overdue task from persisted state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-manual-one-time-run-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-manual-one-time-run-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const taskId = "overdue-one-time-manual-run";
    const now = new Date("2026-03-23T10:20:00.000Z");

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: taskId,
                name: "One-time overdue",
                cron: "*/5 * * * *",
                prompt: "run me once",
                enabled: true,
                oneTime: true,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                nextRun: "2026-03-23T10:15:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(createMockContext(storageRoot));
      manager.setOnExecuteCallback(async () => undefined);
      let changedCount = 0;
      manager.setOnTasksChangedCallback(() => { // listen
        changedCount += 1;
      });

      const executed = await manager.runTaskNow(taskId);
      assert.strictEqual(executed, true);
      assert.strictEqual(manager.getTask(taskId), undefined);
      assert.deepStrictEqual(manager.getAllTasks().map((task) => task.id), []);
      assert.strictEqual(changedCount, 1);

      const persisted = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as { tasks?: Array<{ id: string }> };
      assert.deepStrictEqual(
        (persisted.tasks ?? []).map((task) => task.id),
        [],
      );

      const deleted = await manager.deleteTask(taskId);
      assert.strictEqual(deleted, false);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("reload does not resurrect a manually run one-time overdue task", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-manual-one-time-reload-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-manual-one-time-reload-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const taskId = "overdue-one-time-reload";
    const now = new Date("2026-03-23T10:20:00.000Z");

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: taskId,
                name: "One-time overdue reload",
                cron: "*/5 * * * *",
                prompt: "run me once",
                enabled: true,
                oneTime: true,
                createdAt: now.toISOString(),
                updatedAt: now.toISOString(),
                nextRun: "2026-03-23T10:15:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(createMockContext(storageRoot));
      manager.setOnExecuteCallback(async () => undefined);

      const executed = await manager.runTaskNow(taskId);
      assert.strictEqual(executed, true);
      manager.reloadTasks();

      assert.strictEqual(manager.getTask(taskId), undefined);
      assert.deepStrictEqual(manager.getAllTasks().map((task) => task.id), []);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("scheduler tick does not execute disabled tasks", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-disabled-due-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-disabled-due-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    let executeCount = 0;

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: "disabled-due-task",
                name: "Disabled due task",
                cron: "*/5 * * * *",
                prompt: "do not run",
                enabled: false,
                createdAt: "2026-03-23T10:00:00.000Z",
                updatedAt: "2026-03-23T10:00:00.000Z",
                nextRun: "2026-03-23T10:05:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(createMockContext(storageRoot));
      manager.setOnExecuteCallback(async () => {
        executeCount += 1;
      });

      await (manager as unknown as { evaluateAndRunDueTasks: () => Promise<void> }).evaluateAndRunDueTasks();

      assert.strictEqual(executeCount, 0);
      assert.strictEqual(manager.getTask("disabled-due-task")?.enabled, false);
      assert.strictEqual(manager.getTask("disabled-due-task")?.nextRun, undefined);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("scheduler tick removes a successful one-time due task from persisted state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-tick-one-time-success-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-tick-one-time-success-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    let executeCount = 0;

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: "tick-one-time-success",
                name: "Tick one-time success",
                cron: "*/5 * * * *",
                prompt: "run me once",
                enabled: true,
                oneTime: true,
                createdAt: "2026-03-23T10:00:00.000Z",
                updatedAt: "2026-03-23T10:00:00.000Z",
                nextRun: "2026-03-23T10:05:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(createMockContext(storageRoot));
      manager.setOnExecuteCallback(async () => {
        executeCount += 1;
      });

      await (manager as unknown as { evaluateAndRunDueTasks: () => Promise<void> }).evaluateAndRunDueTasks();

      assert.strictEqual(executeCount, 1);
      assert.strictEqual(manager.getTask("tick-one-time-success"), undefined);

      const persisted = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as { tasks?: Array<{ id: string }> };
      assert.deepStrictEqual(persisted.tasks ?? [], []);
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("scheduler tick keeps a failing one-time due task and schedules a retry", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-ws-tick-one-time-failure-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-storage-tick-one-time-failure-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
    const beforeTick = new Date();

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "scheduler.json"),
        JSON.stringify(
          {
            tasks: [
              {
                id: "tick-one-time-failure",
                name: "Tick one-time failure",
                cron: "*/5 * * * *",
                prompt: "run me once",
                enabled: true,
                oneTime: true,
                createdAt: "2026-03-23T10:00:00.000Z",
                updatedAt: "2026-03-23T10:00:00.000Z",
                nextRun: "2026-03-23T10:05:00.000Z",
              },
            ],
          },
          null,
          2,
        ),
        "utf8",
      );

      const manager = new ScheduleManager(createMockContext(storageRoot));
      manager.setOnExecuteCallback(async () => {
        throw new Error("tick failure");
      });

      await (manager as unknown as { evaluateAndRunDueTasks: () => Promise<void> }).evaluateAndRunDueTasks();

      const task = manager.getTask("tick-one-time-failure");
      assert.ok(task);
      assert.strictEqual(task?.lastError, "tick failure");
      assert.ok(task?.lastErrorAt instanceof Date);
      assert.ok(task?.nextRun instanceof Date);
      assert.ok((task?.nextRun?.getTime() ?? 0) >= beforeTick.getTime());

      const persisted = JSON.parse(
        fs.readFileSync(path.join(workspaceRoot, ".vscode", "scheduler.json"), "utf8"),
      ) as { tasks?: Array<{ id: string; lastError?: string }> };
      assert.deepStrictEqual((persisted.tasks ?? []).map((task) => task.id), ["tick-one-time-failure"]);
      assert.strictEqual(persisted.tasks?.[0]?.lastError, "tick failure");
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});

suite("ScheduleManager History Snapshot Tests", () => {
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
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
        assert.ok(updated, "task should exist after update");
      }

      const historyEntries = manager.getWorkspaceScheduleHistory();
      assert.strictEqual(historyEntries.length, 100);
      assert.ok(fs.existsSync(getScheduleHistoryRoot(workspaceRoot)));
    } finally {
      restoreWs();
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });

  test("restores a previous workspace schedule snapshot and snapshots the pre-restore state", async () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-history-restore-ws-"),
    );
    const storageRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-history-restore-storage-"),
    );
    const restoreWs = overrideWorkspaceFolders(workspaceRoot);
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
      removeTestPaths(workspaceRoot, storageRoot);
    }
  });
});
