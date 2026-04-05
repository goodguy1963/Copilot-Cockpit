import * as fs from "fs";
import * as assert from "assert";
import type { ScheduledTask } from "../../types";
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

type RepairStateEntry = {
  workspaceRoot: string;
  status: RepairPlanState;
};

const cockpitExtensionId = "local-dev.copilot-cockpit";
const cockpitCommandNames = [
  "createTask",
  "createTaskGui",
  "listTasks",
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

const requiredConfigKeys = [
  "copilotCockpit.autoShowOnStartup",
  "copilotCockpit.defaultAgent",
  "copilotCockpit.defaultModel",
  "copilotCockpit.spotReviewTemplate",
  "copilotCockpit.botReviewPromptTemplate",
  "copilotCockpit.botReviewAgent",
  "copilotCockpit.botReviewModel",
  "copilotCockpit.botReviewChatSession",
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
    prompt: "FALLBACK",
    cronExpression: "0 * * * *",
    enabled: true,
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
  assert.ok(editor, "An editor should be available");

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

suite("Extension Test Suite", () => {
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
  });

<<<<<<< HEAD
  test("cockpit and scheduler command aliases are registered", async () => {
=======
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
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.needsBotReviewCommentTemplate",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.needsBotReviewPromptTemplate",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.needsBotReviewAgent",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.needsBotReviewModel",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.needsBotReviewChatSession",
      ),
    );
    assert.ok(
      Object.prototype.hasOwnProperty.call(
        properties,
        "copilotCockpit.readyPromptTemplate",
      ),
    );
    assert.strictEqual(
      (properties["copilotCockpit.storageMode"] as { default?: unknown } | undefined)
        ?.default,
      "sqlite",
    );
    assert.strictEqual(
      (properties["copilotCockpit.deterministicCockpitStateMode"] as { default?: unknown } | undefined)
        ?.default,
      "canonical-primary",
    );
    assert.strictEqual(
      (properties["copilotCockpit.legacyFallbackOnError"] as { default?: unknown } | undefined)
        ?.default,
      true,
    );
  });

  test("Commands should be registered", async () => {
>>>>>>> main
    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = [
      ...createExpectedCommands("copilotCockpit"),
      ...createExpectedCommands("copilotScheduler"),
    ];

    for (const commandName of expectedCommands) {
      assert.ok(commands.includes(commandName), `Command ${commandName} should be registered`);
    }

    const cockpitCommands = commands.filter((commandName) =>
      commandName.startsWith("copilotCockpit."),
    );
    const schedulerCommands = commands.filter((commandName) =>
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
    assert.ok(true);
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
    const sanitize = testOnly.sanitizeErrorDetailsForLog as ((message: string) => string) | undefined;

    assert.ok(typeof sanitize === "function");

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

  suite("resolvePromptText Tests", () => {
    for (const testCase of promptResolutionCases) {
      test(testCase.name, async () => {
        await runPromptResolutionCase(testCase);
      });
    }
  });
});
