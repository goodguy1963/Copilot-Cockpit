import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ResearchManager } from "../../researchManager";
import { CopilotExecutor } from "../../copilotExecutor";
import { readWorkspaceResearchStateFromSqlite } from "../../sqliteBootstrap";

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

function setWorkspaceFoldersForTest(root: string): () => void {
  const original = vscode.workspace.workspaceFolders;
  Object.defineProperty(vscode.workspace, "workspaceFolders", {
    configurable: true,
    value: [{ uri: vscode.Uri.file(root), index: 0, name: path.basename(root) }],
  });
  return () => {
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: original,
    });
  };
}

function setWorkspaceStorageModeForTest(mode: "json" | "sqlite"): () => void {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  (vscode.workspace as typeof vscode.workspace & {
    getConfiguration: typeof vscode.workspace.getConfiguration;
  }).getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope) => {
    const original = originalGetConfiguration(section as never, scope as never);
    if (section !== "copilotCockpit") {
      return original;
    }

    return {
      ...original,
      get<T>(key: string, defaultValue?: T): T {
        if (key === "storageMode") {
          return mode as T;
        }
        return original.get<T>(key, defaultValue as T);
      },
      inspect<T>(key: string) {
        if (key === "storageMode") {
          return {
            workspaceFolderValue: mode as T,
          } as ReturnType<typeof original.inspect<T>>;
        }
        return original.inspect<T>(key);
      },
    } as vscode.WorkspaceConfiguration;
  }) as typeof vscode.workspace.getConfiguration;

  return () => {
    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = originalGetConfiguration;
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for research manager state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

suite("ResearchManager", () => {
  test("createProfile persists repo-local research.json", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);

    try {
      const manager = new ResearchManager(
        createMockContext(storageRoot),
        { executePrompt: async () => undefined } as unknown as CopilotExecutor,
      );

      const profile = await manager.createProfile({
        name: "Smoke profile",
        instructions: "Improve the benchmark conservatively.",
        editablePaths: ["src/example.ts"],
        benchmarkCommand: `${JSON.stringify(process.execPath)} -e "console.log('score: 1.5')"`,
        metricPattern: "score:\\s*([0-9.]+)",
        metricDirection: "maximize",
      });

      const configPath = path.join(workspaceRoot, ".vscode", "research.json");
      assert.strictEqual(fs.existsSync(configPath), true);
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert.strictEqual(Array.isArray(parsed.profiles), true);
      assert.strictEqual(parsed.profiles.length, 1);
      assert.strictEqual(parsed.profiles[0].id, profile.id);
      assert.strictEqual(parsed.profiles[0].name, "Smoke profile");
    } finally {
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      fs.rmSync(storageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  test("startRun records a baseline benchmark run", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-run-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-run-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "example.ts"), "export const value = 1;\n", "utf8");
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);

    try {
      const manager = new ResearchManager(
        createMockContext(storageRoot),
        { executePrompt: async () => undefined } as unknown as CopilotExecutor,
      );

      const profile = await manager.createProfile({
        name: "Baseline only",
        instructions: "No-op; max iterations is zero for this test.",
        editablePaths: ["src/example.ts"],
        benchmarkCommand: `${JSON.stringify(process.execPath)} -e "console.log('score: 1.5')"`,
        metricPattern: "score:\\s*([0-9.]+)",
        metricDirection: "maximize",
        maxIterations: 0,
        maxMinutes: 2,
        maxConsecutiveFailures: 1,
        benchmarkTimeoutSeconds: 30,
        editWaitSeconds: 5,
      });

      const started = await manager.startRun(profile.id);
      await waitFor(() => {
        var latest = manager.getRecentRuns(1)[0];
        return !!latest && latest.id === started.id && latest.status !== "running" && latest.status !== "stopping";
      });

      const latest = manager.getRecentRuns(1)[0];
      assert.ok(latest);
      assert.strictEqual(latest.id, started.id);
      assert.strictEqual(latest.status, "completed");
      assert.strictEqual(latest.baselineScore, 1.5);
      assert.strictEqual(latest.bestScore, 1.5);
      assert.strictEqual(latest.completedIterations, 0);
      assert.strictEqual(Array.isArray(latest.attempts), true);
      assert.strictEqual(latest.attempts.length, 1);
      assert.strictEqual(latest.attempts[0].outcome, "baseline");

      const runPath = path.join(workspaceRoot, ".vscode", "research-history", started.id, "run.json");
      assert.strictEqual(fs.existsSync(runPath), true);
    } finally {
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      fs.rmSync(storageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });

  test("sqlite mode mirrors research state and rehydrates it over stale json", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-sqlite-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-sqlite-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const restoreMode = setWorkspaceStorageModeForTest("sqlite");

    try {
      const manager = new ResearchManager(
        createMockContext(storageRoot),
        { executePrompt: async () => undefined } as unknown as CopilotExecutor,
      );

      const profile = await manager.createProfile({
        name: "SQLite research profile",
        instructions: "Preserve through sqlite hydration.",
        editablePaths: ["src/example.ts"],
        benchmarkCommand: `${JSON.stringify(process.execPath)} -e "console.log('score: 1.5')"`,
        metricPattern: "score:\\s*([0-9.]+)",
        metricDirection: "maximize",
      });

      const sqliteState = await readWorkspaceResearchStateFromSqlite(workspaceRoot);
      const sqliteProfiles = sqliteState.profiles as Array<{ id: string; name: string }>;
      assert.ok(sqliteProfiles.some((entry) => entry.id === profile.id && entry.name === "SQLite research profile"));

      const configPath = path.join(workspaceRoot, ".vscode", "research.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ version: 1, profiles: [], runs: [] }, null, 2),
        "utf8",
      );

      const reloadedManager = new ResearchManager(
        createMockContext(storageRoot),
        { executePrompt: async () => undefined } as unknown as CopilotExecutor,
      );
      await waitFor(() => reloadedManager.getAllProfiles().some((entry) => entry.id === profile.id));

      assert.strictEqual(reloadedManager.getAllProfiles().some((entry) => entry.id === profile.id), true);
    } finally {
      restoreMode();
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
      fs.rmSync(storageRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    }
  });
});