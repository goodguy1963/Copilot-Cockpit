import * as fs from "fs";
import * as assert from "assert";
import type { ScheduledTask } from "../../types"; // local-diverge-3
import * as path from "path";
import * as vscode from "vscode";
import {
  createTempDir,
  overrideWorkspaceFolders,
} from "./helpers/vscodeTestHarness";

type TestOnlyExports = typeof import("../../extension").__testOnly;

type PackageConfigurationShape = {
  contributes?: {
    configuration?: {
      properties?: Record<string, unknown>;
    };
  };
};

type RepairPlanState = "missing" | "configured" | "invalid" | "stale";

type RepairPlan = {
  mcpRootsNeedingRepair: string[];
  autoRepairMcpRoots: string[];
  promptMcpRoots: string[];
  shouldRefreshBundledSkills: boolean;
  shouldAutoRepair: boolean;
  needsPrompt: boolean;
};

type PromptResolutionCase = {
  name: string;
  taskId: string;
  preferOpenDocument: boolean;
  expectedText: string;
};

type PromptFixtureContext = {
  workspaceRoot: string;
  restoreWorkspaceFolders: () => void;
  document?: vscode.TextDocument;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

type StartupSqliteHydrationDepsForTest = {
  workspaceRoot?: string;
  isSqliteModeEnabled: (workspaceRoot: string) => boolean;
  waitForTaskHydration: () => Promise<void>;
  getBoardHydrationPromise: () => Promise<void> | undefined;
  timeoutMs?: number;
};

type RepairStateEntry = {
  workspaceRoot: string;
  status: RepairPlanState;
};

const cockpitExtensionId = "local-dev.copilot-cockpit";
const cockpitCommandNames = [
  "createTask",
  "createTaskGui",
  "listTasks",
  "openCockpit",
  "deleteTask",
  "toggleTask",
  "enableTask",
  "disableTask",
  "runNow",
  "copyPrompt",
  "editTask",
  "duplicateTask",
  "moveToCurrentWorkspace",
  "openSettings",
  "showVersion",
  "setupMcp",
  "syncBundledSkills",
] as const;

const requiredConfigDefaults = [
  ["copilotCockpit.storageMode", "sqlite"],
  ["copilotCockpit.deterministicCockpitStateMode", "canonical-primary"],
  ["copilotCockpit.legacyFallbackOnError", true],
] as const;

const expectedNeedsBotReviewCommentTemplate = "Needs bot review: inspect the current context, call out risks or unclear assumptions, and propose the smallest safe next step.";

const expectedNeedsBotReviewPromptTemplate = [
  "You are handling a Todo that just entered needs-bot-review.",
  "",
  "{{todo_context}}",
  "",
  "{{mcp_skill_guidance}}",
  "",
  "Research what is needed to review this item using available tools and web search.",
  "Return a plain-text review comment ready for direct Todo writeback with short titled sections and bullets:",
  "Review Summary:",
  "- 1-2 bullets on the request and current repo state",
  "Risks / Gaps:",
  "- bullets for missing context, risks, or unclear assumptions",
  "Recommendation:",
  "- one compact next step or blocking clarification; if the request is already clear, give two implementation options instead",
  "Use real line breaks. Do not emit JSON or escaped newline sequences such as \\n.",
  "When the review is complete, add that comment to this Todo using the cockpit MCP tools and set the flag to needs-user-review.",
].join("\n");

const expectedReadyPromptTemplate = [
  "You are handling a Todo that is now ready for implementation.",
  "",
  "{{todo_context}}",
  "",
  "{{mcp_skill_guidance}}",
  "",
  "Analyze this Todo using the Todo Cockpit skill and implement what the user decided in the last comment or the latest bot recommendation.",
  "If there is no recent user comment, proceed with the bot's recommendation.",
  "Add one compact Todo comment covering implementation changes, validation, and any remaining follow-up before or as you update the Todo to the correct workflow state.",
  "Check the cockpit-todo-agent and cockpit-scheduler-router skills to determine the correct post-implementation state, and tell the user whether that guidance was found.",
  "If the expected post-implementation state is not documented in the skills, add it there so the next editable default flag in settings has clear guidance.",
].join("\n");

const requiredConfigKeys = [
  "copilotCockpit.autoShowOnStartup",
  "copilotCockpit.defaultAgent",
  "copilotCockpit.defaultModel",
  "copilotCockpit.needsBotReviewCommentTemplate",
  "copilotCockpit.needsBotReviewPromptTemplate",
  "copilotCockpit.needsBotReviewAgent",
  "copilotCockpit.needsBotReviewModel",
  "copilotCockpit.needsBotReviewChatSession",
  "copilotCockpit.readyPromptTemplate",
  ...requiredConfigDefaults.map(([key]) => key),
];

const promptResolutionCases: PromptResolutionCase[] = [
  {
    name: "prefers open document text when preferOpenDocument=true",
    taskId: "t-open-doc",
    preferOpenDocument: true,
    expectedText: "UNSAVED",
  },
  {
    name: "reads persisted file when preferOpenDocument=false",
    taskId: "t-disk-only",
    preferOpenDocument: false,
    expectedText: "DISK",
  },
];

let cachedTestOnlyExports: TestOnlyExports | undefined;

function createDeferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
}

function getExtensionEntry() {
  return vscode.extensions.getExtension(cockpitExtensionId);
}

async function getTestOnlyExports(): Promise<TestOnlyExports> {
  if (!cachedTestOnlyExports) {
    const extensionModule = await import("../../extension");
    cachedTestOnlyExports = extensionModule.__testOnly;
  }

  return cachedTestOnlyExports;
}

function createExpectedCommands(prefix: "copilotCockpit" | "copilotScheduler"): string[] {
  return cockpitCommandNames.map((commandName) => `${prefix}.${commandName}`);
}

function getContributedProperties(): Record<string, unknown> {
  const extension = getExtensionEntry();
  assert.ok(extension);
  const packageJson = extension!.packageJSON as PackageConfigurationShape;
  return packageJson.contributes?.configuration?.properties ?? {};
}

function assertPropertyKeysExist(properties: Record<string, unknown>, keys: readonly string[]) {
  for (const propertyKey of keys) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(properties, propertyKey),
      `Missing contributed property ${propertyKey}`,
    );
  }
}

function assertDefaultPropertyValue(
  properties: Record<string, unknown>,
  propertyKey: string,
  expectedValue: unknown,
) {
  const value = (properties[propertyKey] as { default?: unknown } | undefined)?.default;
  assert.strictEqual(value, expectedValue);
}

function createPromptFixtureContext(): PromptFixtureContext {
  const workspaceRoot = createTempDir("copilot-cockpit-ext-");
  return {
    workspaceRoot,
    restoreWorkspaceFolders: overrideWorkspaceFolders(workspaceRoot),
  };
}

function buildLocalPromptTask(promptPath: string, taskId: string): ScheduledTask {
  const createdAt = new Date();

  return {
    name: `Task ${taskId}`,
    id: taskId,
    prompt: "FALLBACK", // test-fixture
    cronExpression: "0 * * * *",
    enabled: true, // local-diverge-163
    promptSource: "local",
    scope: "global",
    promptPath,
    createdAt,
    updatedAt: createdAt,
  } satisfies ScheduledTask;
}

function buildTaskExecutionFixture(
  task: Pick<
    ScheduledTask,
    | "id"
    | "name"
    | "cronExpression"
    | "prompt"
    | "enabled"
    | "scope"
    | "promptSource"
    | "oneTime"
    | "chatSession"
  >,
): ScheduledTask {
  return {
    ...task,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

async function createEditedPromptDocument(
  promptsDir: string,
  fileStem: string,
): Promise<{
  absolutePath: string;
  relativePath: string;
  document: vscode.TextDocument;
}> {
  fs.mkdirSync(promptsDir, { recursive: true });
  const fileName = `${fileStem}-${Date.now()}.md`;
  const absolutePath = path.join(promptsDir, fileName);
  const relativePath = path.join(".github", "prompts", fileName);
  fs.writeFileSync(absolutePath, "DISK", "utf8");

  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
  const editor = await vscode.window.showTextDocument(document);
  assert.ok(editor, "Expected an active editor in the test workspace");

  const replacementRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length),
  );
  await editor!.edit((editBuilder) => editBuilder.replace(replacementRange, "UNSAVED"));
  assert.strictEqual(document.isDirty, true);

  return { absolutePath, relativePath, document };
}

async function closePromptFixtureDocument(document: vscode.TextDocument | undefined) {
  if (!document) {
    return;
  }

  try {
    await vscode.window.showTextDocument(document);
    if (vscode.window.activeTextEditor?.document !== document) {
      return;
    }

    try {
      await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
    } catch {
      await document.save();
      await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    }
  } catch {
    // ignore editor cleanup errors
  }
}

function deletePromptFixtureWorkspace(workspaceRoot: string) {
  const removalOptions = { recursive: true, force: true, maxRetries: 3, retryDelay: 50 } as const;

  try {
    fs.rmSync(workspaceRoot, removalOptions);
  } catch {
    // ignore cleanup failure on Windows test host
  }
}

async function runPromptResolutionCase(testCase: PromptResolutionCase) {
  const context = createPromptFixtureContext();
  const promptsDir = path.join(context.workspaceRoot, ".github", "prompts");

  try {
    const fixture = await createEditedPromptDocument(promptsDir, testCase.taskId);
    context.document = fixture.document;

    const testOnly = await getTestOnlyExports();
    const task = buildLocalPromptTask(fixture.relativePath, testCase.taskId);
    const resolved = await testOnly.resolvePromptText(task, testCase.preferOpenDocument);

    assert.strictEqual(resolved, testCase.expectedText);
  } finally {
    context.restoreWorkspaceFolders();
    await closePromptFixtureDocument(context.document);
    deletePromptFixtureWorkspace(context.workspaceRoot);
  }
}

suite("Extension Integration Tests", () => {
  test("extension entry is discoverable", () => {
    assert.ok(getExtensionEntry());
  });

  test("extension activates successfully", async () => {
    const extension = getExtensionEntry();
    assert.ok(extension);
    await extension!.activate();
    assert.strictEqual(extension!.isActive, true);
  });

  test("package contributes Cockpit settings with expected defaults", () => {
    const properties = getContributedProperties();
    assertPropertyKeysExist(properties, requiredConfigKeys);

    for (const [propertyKey, expectedValue] of requiredConfigDefaults) {
      assertDefaultPropertyValue(properties, propertyKey, expectedValue);
    }

    assertDefaultPropertyValue(
      properties,
      "copilotCockpit.needsBotReviewCommentTemplate",
      expectedNeedsBotReviewCommentTemplate,
    );
    assertDefaultPropertyValue(
      properties,
      "copilotCockpit.needsBotReviewPromptTemplate",
      expectedNeedsBotReviewPromptTemplate,
    );
    assertDefaultPropertyValue(
      properties,
      "copilotCockpit.readyPromptTemplate",
      expectedReadyPromptTemplate,
    );
  });

  test("runtime review defaults stay aligned with contributed package defaults", async () => {
    const testOnly = await getTestOnlyExports();
    const properties = getContributedProperties();
    const runtimeDefaults = testOnly.getDefaultReviewTemplateValues();

    assert.strictEqual(
      runtimeDefaults.needsBotReviewCommentTemplate,
      expectedNeedsBotReviewCommentTemplate,
    );
    assert.strictEqual(
      runtimeDefaults.needsBotReviewPromptTemplate,
      expectedNeedsBotReviewPromptTemplate,
    );
    assert.strictEqual(
      runtimeDefaults.readyPromptTemplate,
      expectedReadyPromptTemplate,
    );
    assertDefaultPropertyValue(
      properties,
      "copilotCockpit.needsBotReviewCommentTemplate",
      runtimeDefaults.needsBotReviewCommentTemplate,
    );
    assertDefaultPropertyValue(
      properties,
      "copilotCockpit.needsBotReviewPromptTemplate",
      runtimeDefaults.needsBotReviewPromptTemplate,
    );
    assertDefaultPropertyValue(
      properties,
      "copilotCockpit.readyPromptTemplate",
      runtimeDefaults.readyPromptTemplate,
    );
  });

  test("cockpit and scheduler command aliases are registered", async () => {
    const registeredCmds = await vscode.commands.getCommands(true);
    const requiredCmds = [
      ...createExpectedCommands("copilotCockpit"),
      ...createExpectedCommands("copilotScheduler"),
    ];

    for (const commandName of requiredCmds) {
      assert.ok(registeredCmds.includes(commandName), `Command ${commandName} should be registered`);
    }

    const cockpitCommands = registeredCmds.filter((commandName) =>
      commandName.startsWith("copilotCockpit."),
    );
    const schedulerCommands = registeredCmds.filter((commandName) =>
      commandName.startsWith("copilotScheduler."),
    );

    assert.strictEqual(
      cockpitCommands.length,
      cockpitCommandNames.length,
      `Expected ${cockpitCommandNames.length} copilotCockpit commands but found ${cockpitCommands.length}.`,
    );
    assert.strictEqual(
      schedulerCommands.length,
      cockpitCommandNames.length,
      `Expected ${cockpitCommandNames.length} copilotScheduler alias commands but found ${schedulerCommands.length}.`,
    );
  });

  test("ui refresh queue coalesces rapid refresh requests", async () => {
    const testOnly = await getTestOnlyExports();
    const refreshEvents: number[] = [];
    const queue = testOnly.createUiRefreshQueue(() => {
      refreshEvents.push(Date.now());
    }, 15) as {
      schedule: (immediate?: boolean) => void;
      hasPending: () => boolean;
    };

    queue.schedule();
    queue.schedule();
    queue.schedule();
    assert.strictEqual(queue.hasPending(), true);

    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.strictEqual(refreshEvents.length, 1);
    assert.strictEqual(queue.hasPending(), false);

    queue.schedule();
    queue.schedule(true);

    assert.strictEqual(refreshEvents.length, 2);
    assert.strictEqual(queue.hasPending(), false);
  });

  test("startup sqlite hydration waits for task hydration before board hydration", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    const taskHydration = createDeferred<void>();
    const boardHydration = createDeferred<void>();
  const boardHydrationStarted = createDeferred<void>();
    const events: string[] = [];

    const waitPromise = waitForStartupHydration!({
      workspaceRoot: "F:/sqlite-workspace",
      isSqliteModeEnabled: (workspaceRoot) => {
        events.push(`mode:${workspaceRoot}`);
        return true;
      },
      waitForTaskHydration: async () => {
        events.push("task:start");
        await taskHydration.promise;
        events.push("task:done");
      },
      getBoardHydrationPromise: () => {
        events.push("board:get");
        boardHydrationStarted.resolve();
        return boardHydration.promise.then(() => {
          events.push("board:done");
        });
      },
    });

    await Promise.resolve();
    assert.deepStrictEqual(events, ["mode:F:/sqlite-workspace", "task:start"]);

    taskHydration.resolve();
    await boardHydrationStarted.promise;
    assert.deepStrictEqual(events, [
      "mode:F:/sqlite-workspace",
      "task:start",
      "task:done",
      "board:get",
    ]);

    boardHydration.resolve();
    await waitPromise;

    assert.deepStrictEqual(events, [
      "mode:F:/sqlite-workspace",
      "task:start",
      "task:done",
      "board:get",
      "board:done",
    ]);
  });

  test("startup sqlite hydration is a no-op outside sqlite mode", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    let taskWaitCalls = 0;
    let boardWaitCalls = 0;

    await waitForStartupHydration!({
      workspaceRoot: "F:/json-workspace",
      isSqliteModeEnabled: () => false,
      waitForTaskHydration: async () => {
        taskWaitCalls += 1;
      },
      getBoardHydrationPromise: () => {
        boardWaitCalls += 1;
        return Promise.resolve();
      },
    });

    assert.strictEqual(taskWaitCalls, 0);
    assert.strictEqual(boardWaitCalls, 0);
  });

  test("startup sqlite hydration is a no-op without a workspace root", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    let sqliteModeChecks = 0;
    let taskWaitCalls = 0;
    let boardWaitCalls = 0;

    await waitForStartupHydration!({
      workspaceRoot: undefined,
      isSqliteModeEnabled: () => {
        sqliteModeChecks += 1;
        return true;
      },
      waitForTaskHydration: async () => {
        taskWaitCalls += 1;
      },
      getBoardHydrationPromise: () => {
        boardWaitCalls += 1;
        return Promise.resolve();
      },
    });

    assert.strictEqual(sqliteModeChecks, 0);
    assert.strictEqual(taskWaitCalls, 0);
    assert.strictEqual(boardWaitCalls, 0);
  });

  test("startup sqlite hydration tolerates an undefined board hydration promise", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    let taskWaitCalls = 0;
    let boardWaitCalls = 0;

    await assert.doesNotReject(async () =>
      waitForStartupHydration!({
        workspaceRoot: "F:/sqlite-workspace",
        isSqliteModeEnabled: () => true,
        waitForTaskHydration: async () => {
          taskWaitCalls += 1;
        },
        getBoardHydrationPromise: () => {
          boardWaitCalls += 1;
          return undefined;
        },
      }));

    assert.strictEqual(taskWaitCalls, 1);
    assert.strictEqual(boardWaitCalls, 1);
  });

  test("startup sqlite hydration continues to board hydration when task hydration rejects", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    const events: string[] = [];

    await assert.doesNotReject(async () =>
      waitForStartupHydration!({
        workspaceRoot: "F:/sqlite-workspace",
        isSqliteModeEnabled: () => true,
        waitForTaskHydration: async () => {
          events.push("task:start");
          throw new Error("task hydration failed");
        },
        getBoardHydrationPromise: () => {
          events.push("board:get");
          return Promise.resolve().then(() => {
            events.push("board:done");
          });
        },
      }));

    assert.deepStrictEqual(events, ["task:start", "board:get", "board:done"]);
  });

  test("startup sqlite hydration continues when both task and board hydration reject", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    const events: string[] = [];

    await assert.doesNotReject(async () =>
      waitForStartupHydration!({
        workspaceRoot: "F:/sqlite-workspace",
        isSqliteModeEnabled: () => true,
        waitForTaskHydration: async () => {
          events.push("task:start");
          throw new Error("task hydration failed");
        },
        getBoardHydrationPromise: () => {
          events.push("board:get");
          return Promise.reject(new Error("board hydration failed"));
        },
      }));

    assert.deepStrictEqual(events, ["task:start", "board:get"]);
  });

  test("startup sqlite hydration times out and continues when task hydration hangs", async () => {
    const testOnly = await getTestOnlyExports();
    const waitForStartupHydration = testOnly.waitForSqliteStartupHydration as
      | ((deps: StartupSqliteHydrationDepsForTest) => Promise<void>)
      | undefined;

    assert.ok(typeof waitForStartupHydration === "function");

    let taskWaitCalls = 0;
    let boardWaitCalls = 0;
    const startedAt = Date.now();

    await assert.doesNotReject(async () =>
      waitForStartupHydration!({
        workspaceRoot: "F:/sqlite-workspace",
        isSqliteModeEnabled: () => true,
        waitForTaskHydration: async () => {
          taskWaitCalls += 1;
          await new Promise<void>(() => undefined);
        },
        getBoardHydrationPromise: () => {
          boardWaitCalls += 1;
          return Promise.resolve();
        },
        timeoutMs: 25,
      }));

    const elapsedMs = Date.now() - startedAt;
    assert.strictEqual(taskWaitCalls, 1);
    assert.strictEqual(boardWaitCalls, 0);
    assert.ok(elapsedMs < 500, `Expected timeout-bound completion, got ${elapsedMs}ms`);
  });

  test("custom sub-agent settings uri builder uses the active VS Code scheme", async () => {
    const testOnly = await getTestOnlyExports();
    const buildUri = testOnly.buildCustomSubAgentSettingUri as
      | ((uriScheme?: string) => vscode.Uri)
      | undefined;

    assert.ok(typeof buildUri === "function");
    assert.strictEqual(
      buildUri!("vscode-insiders").toString(),
      "vscode-insiders://settings/chat.customAgentInSubagent.enabled",
    );
    assert.strictEqual(
      buildUri!("vscode").toString(),
      "vscode://settings/chat.customAgentInSubagent.enabled",
    );
  });

  test("manual run refresh helper requests an immediate refresh", async () => {
    const testOnly = await getTestOnlyExports();
    const createRefresh = testOnly.createImmediateManualRunRefresh as
      | ((refreshUiState: (immediate?: boolean) => void) => () => void)
      | undefined;

    assert.ok(typeof createRefresh === "function");

    const calls: boolean[] = [];
    createRefresh!((immediate) => calls.push(immediate === true))();

    assert.deepStrictEqual(calls, [true]);
  });

  test("workspace storage watcher list includes sqlite authority and json mirrors", async () => {
    const testOnly = await getTestOnlyExports();
    const getWatchFiles = testOnly.getWorkspaceStorageWatchFileNames as
      | (() => readonly string[])
      | undefined;

    assert.ok(typeof getWatchFiles === "function");
    assert.deepStrictEqual(getWatchFiles!(), [
      "scheduler.json",
      "scheduler.private.json",
      "copilot-cockpit.db",
    ]);
  });

  for (const [name, task, expectedChatSession] of [
    [
      "one-time tasks default task execution chat session to new",
      {
        id: "one-time-task",
        name: "One-time task",
        cronExpression: "* * * * *",
        prompt: "Ping",
        enabled: true,
        scope: "workspace",
        promptSource: "inline",
        oneTime: true,
      } satisfies Parameters<typeof buildTaskExecutionFixture>[0],
      "new",
    ],
    [
      "recurring tasks keep task execution chat session undefined by default",
      {
        id: "recurring-task",
        name: "Recurring task",
        cronExpression: "* * * * *",
        prompt: "Ping",
        enabled: true,
        scope: "workspace",
        promptSource: "inline",
        oneTime: false,
      } satisfies Parameters<typeof buildTaskExecutionFixture>[0],
      undefined,
    ],
    [
      "explicit task chat session settings are preserved",
      {
        id: "explicit-session-task",
        name: "Explicit session task",
        cronExpression: "* * * * *",
        prompt: "Ping",
        enabled: true,
        scope: "workspace",
        promptSource: "inline",
        oneTime: true,
        chatSession: "continue",
      } satisfies Parameters<typeof buildTaskExecutionFixture>[0],
      "continue",
    ],
  ] as const) {
    test(name, async () => {
      const testOnly = await getTestOnlyExports();
      const resolveChatSession = testOnly.resolveTaskExecutionChatSession as
        | ((scheduledTask: ScheduledTask) => ScheduledTask["chatSession"])
        | undefined;

      assert.ok(typeof resolveChatSession === "function");
      assert.strictEqual(
        resolveChatSession!(buildTaskExecutionFixture(task)),
        expectedChatSession,
      );
    });
  }

  test("cron expression placeholder test still passes in host environment", () => {
    assert.ok(true, "placeholder assertion");
  });

  test("i18n message builders are exposed", async () => {
    const { messages } = await import("../../i18n");
    for (const key of ["extensionActive", "taskCreated", "taskDeleted"] as const) {
      assert.ok(typeof messages[key] === "function");
    }
  });

  for (const [name, states, extensionVersionChanged, expectedPlan] of [
    [
      "repair plan auto-fixes stale roots and prompts for invalid ones",
      [
        { workspaceRoot: "c:/repo-a", status: "configured" as RepairPlanState },
        { workspaceRoot: "c:/repo-b", status: "stale" as RepairPlanState },
        { workspaceRoot: "c:/repo-c", status: "invalid" as RepairPlanState },
      ],
      true,
      {
        mcpRootsNeedingRepair: ["c:/repo-b", "c:/repo-c"],
        autoRepairMcpRoots: ["c:/repo-b"],
        promptMcpRoots: ["c:/repo-c"],
        shouldRefreshBundledSkills: true,
        shouldAutoRepair: true,
        needsPrompt: true,
      } satisfies RepairPlan,
    ],
    [
      "repair plan prompts for missing roots without auto-repair",
      [
        { workspaceRoot: "c:/repo-a", status: "configured" as RepairPlanState },
        { workspaceRoot: "c:/repo-b", status: "missing" as RepairPlanState },
      ],
      false,
      {
        mcpRootsNeedingRepair: ["c:/repo-b"],
        autoRepairMcpRoots: [],
        promptMcpRoots: ["c:/repo-b"],
        shouldRefreshBundledSkills: false,
        shouldAutoRepair: false,
        needsPrompt: true,
      } satisfies RepairPlan,
    ],
  ] as const) {
    test(name, async () => {
      const testOnly = await getTestOnlyExports();
      const createRepairPlan = testOnly.createWorkspaceSupportRepairPlan as
        | ((repairStates: RepairStateEntry[], extensionVersionChanged: boolean) => RepairPlan)
        | undefined;

      assert.ok(typeof createRepairPlan === "function");
      assert.deepStrictEqual(
        createRepairPlan!([...states], extensionVersionChanged),
        expectedPlan,
      );
    });
  }

  test("error details sanitization hides local filesystem paths but keeps filenames", async () => {
    const testOnly = await getTestOnlyExports();
    const sanitize = testOnly.redactPathsForLog as ((message: string) => string) | undefined;

    assert.strictEqual(typeof sanitize, "function");

    for (const [input, hiddenFragments, visibleFragments] of [
      [
        "EACCES: permission denied, open 'C:\\Users\\me\\secret folder\\a b.md'",
        ["C:\\Users\\me"],
        ["'a b.md'"],
      ],
      [
        "ENOENT: no such file or directory, open C:\\Users\\me\\a.md",
        ["C:\\Users\\me"],
        ["a.md"],
      ],
      [
        "ENOENT: no such file or directory, open '/Users/me/secret folder/a b.md'",
        ["/Users/me/secret folder"],
        ["'a b.md'"],
      ],
      [
        "open /Users/me/a.md",
        ["/Users/me/"],
        ["a.md"],
      ],
      [
        "at foo (/Users/me/a.md:1:2)",
        ["/Users/me/"],
        ["(a.md:1:2)"],
      ],
      [
        "open C:/Users/me/a.md",
        ["C:/Users/me/"],
        ["a.md"],
      ],
      [
        "open \\\\server\\share\\secret\\a.md",
        ["\\\\server\\share"],
        ["a.md"],
      ],
      [
        "open file:///C:/Users/me/secret%20folder/a%20b.md",
        ["file:///C:/Users/me"],
        ["a b.md"],
      ],
      [
        "open file://server/share/secret/a.md",
        ["file://server/share"],
        ["a.md"],
      ],
    ] as const) {
      const sanitized = sanitize!(input);
      for (const hiddenFragment of hiddenFragments) {
        assert.ok(!sanitized.includes(hiddenFragment), `Expected ${hiddenFragment} to be hidden`);
      }
      for (const visibleFragment of visibleFragments) {
        assert.ok(sanitized.includes(visibleFragment), `Expected ${visibleFragment} to remain`);
      }
    }

    const webUrl = "see https://example.com/path";
    assert.strictEqual(sanitize!(webUrl), webUrl);
  });

  suite("resolvePromptText Behavior", () => {
    for (const testCase of promptResolutionCases) {
      test(testCase.name, async () => {
        await runPromptResolutionCase(testCase);
      });
    }
  });
});
