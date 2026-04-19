import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { CopilotExecutor } from "../../copilotExecutor";
import { ResearchManager } from "../../researchManager";
import { readWorkspaceResearchStateFromSqlite } from "../../sqliteBootstrap";

class MemoryMemento implements vscode.Memento {
  private readonly values = new Map<string, unknown>();

  keys(): readonly string[] {
    return [...this.values.keys()];
  }

  get<T>(key: string, defaultValue: T): T;
  get<T>(key: string): T | undefined;
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.values.has(key)
      ? (this.values.get(key) as T)
      : defaultValue;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.values.set(key, value);
    return Promise.resolve();
  }
}

function createExtensionContext(storageRoot: string): vscode.ExtensionContext {
  return {
    globalState: new MemoryMemento(),
    globalStorageUri: vscode.Uri.file(storageRoot),
  } as unknown as vscode.ExtensionContext;
}

function patchWorkspaceFoldersForTest(rootDir: string): () => void {
  const originalFolders = vscode.workspace.workspaceFolders;
  Object.defineProperty(vscode.workspace, "workspaceFolders", {
    configurable: true,
    value: [{ uri: vscode.Uri.file(rootDir), index: 0, name: path.basename(rootDir) }],
  });

  return () => {
    Object.defineProperty(vscode.workspace, "workspaceFolders", {
      configurable: true,
      value: originalFolders,
    });
  };
}

function patchStorageModeForTest(mode: "json" | "sqlite"): () => void {
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  (vscode.workspace as typeof vscode.workspace & {
    getConfiguration: typeof vscode.workspace.getConfiguration;
  }).getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope) => {
    const baseConfiguration = originalGetConfiguration(section as never, scope as never);
    if (section !== "copilotCockpit") {
      return baseConfiguration;
    }

    return {
      ...baseConfiguration,
      get<T>(key: string, defaultValue?: T): T {
        return key === "storageMode"
          ? (mode as T)
          : baseConfiguration.get<T>(key, defaultValue as T);
      },
      inspect<T>(key: string) {
        return key === "storageMode"
          ? ({ workspaceFolderValue: mode as T } as ReturnType<typeof baseConfiguration.inspect<T>>)
          : baseConfiguration.inspect<T>(key);
      },
    } as vscode.WorkspaceConfiguration;
  }) as typeof vscode.workspace.getConfiguration;

  return () => {
    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = originalGetConfiguration;
  };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for research manager state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function createNoopExecutor(): CopilotExecutor {
  return { executePrompt: async () => undefined } as unknown as CopilotExecutor;
}

function benchmarkCommand(score: number): string {
  return `${JSON.stringify(process.execPath)} -e "console.log('score: ${score}')"`; 
}

function cleanupTempDirectories(...roots: string[]): void {
  for (const root of roots) {
    try {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    } catch {
      // Temp cleanup only.
    }
  }
}

suite("ResearchManager behavior", () => {
  test("loadState keeps valid research entries and stops active runs from disk", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-load-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-load-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".vscode", "research.json"),
      JSON.stringify(
        {
          version: 7,
          profiles: [
            {
              id: "profile-valid",
              name: "Alpha",
              instructions: "Keep the valid profile.",
              editablePaths: ["README.md"],
              benchmarkCommand: benchmarkCommand(1.5),
              metricPattern: "score:\\s*([0-9.]+)",
              metricDirection: "maximize",
              maxIterations: 2,
              maxMinutes: 10,
              maxConsecutiveFailures: 2,
              benchmarkTimeoutSeconds: 60,
              editWaitSeconds: 10,
              createdAt: "2026-04-19T10:00:00.000Z",
              updatedAt: "2026-04-19T10:00:00.000Z",
            },
            {
              id: "profile-normalized",
              name: 42,
              instructions: "Still salvageable.",
              editablePaths: ["src/example.ts", 99],
              benchmarkCommand: benchmarkCommand(2),
              metricPattern: "score:\\s*([0-9.]+)",
              metricDirection: "maximize",
              maxIterations: "3",
              maxMinutes: "15",
              maxConsecutiveFailures: 2,
              benchmarkTimeoutSeconds: 60,
              editWaitSeconds: 10,
            },
            { name: "Missing id" },
            "bad-profile",
          ],
          runs: [
            {
              id: "run-active",
              profileId: "profile-valid",
              profileName: "Alpha",
              status: "running",
              startedAt: "2026-04-19T12:00:00.000Z",
              completedIterations: 1,
              attempts: [
                {
                  id: "attempt-1",
                  iteration: 0,
                  startedAt: "2026-04-19T12:00:00.000Z",
                  outcome: "baseline",
                },
              ],
            },
            {
              id: "run-normalized",
              profileId: "profile-normalized",
              profileName: "Normalized",
              status: "completed",
              startedAt: 12345,
              completedIterations: "2",
              attempts: ["bad-attempt"],
            },
            { profileId: "profile-valid", status: "failed" },
            "bad-run",
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    const restoreWorkspace = patchWorkspaceFoldersForTest(workspaceRoot);

    try {
      const manager = new ResearchManager(
        createExtensionContext(storageRoot),
        createNoopExecutor(),
      );

      const profiles = manager.getAllProfiles();
      const runs = manager.getRecentRuns(10);
      const activeRun = runs.find((entry) => entry.id === "run-active");
      const normalizedProfile = profiles.find((entry) => entry.id === "profile-normalized");
      const normalizedRun = runs.find((entry) => entry.id === "run-normalized");

      assert.strictEqual(profiles.length, 2);
      assert.ok(profiles.every((entry) => typeof entry.name === "string"));
      assert.strictEqual(normalizedProfile?.name, "Untitled Research Profile");

      assert.strictEqual(runs.length, 2);
      assert.ok(activeRun);
      assert.strictEqual(activeRun?.status, "stopped");
      assert.ok(activeRun?.finishedAt);
      assert.strictEqual(activeRun?.stopReason, "VS Code restarted during the run.");
      assert.strictEqual(typeof normalizedRun?.startedAt, "string");
      assert.strictEqual(normalizedRun?.attempts.length, 0);
    } finally {
      restoreWorkspace();
      cleanupTempDirectories(workspaceRoot, storageRoot);
    }
  });

  test("createProfile writes a repo-local research.json file", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const restoreWorkspace = patchWorkspaceFoldersForTest(workspaceRoot);

    try {
      const manager = new ResearchManager(
        createExtensionContext(storageRoot),
        createNoopExecutor(),
      );

      const profile = await manager.createProfile({
        name: "Smoke profile",
        instructions: "Improve the benchmark conservatively.",
        editablePaths: ["src/example.ts"],
        benchmarkCommand: benchmarkCommand(1.5),
        metricPattern: "score:\\s*([0-9.]+)",
        metricDirection: "maximize",
      });

      const configPath = path.join(workspaceRoot, ".vscode", "research.json");
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      assert.strictEqual(fs.existsSync(configPath), true);
      assert.strictEqual(Array.isArray(parsed.profiles), true);
      assert.strictEqual(parsed.profiles.length, 1);
      assert.strictEqual(parsed.profiles[0].id, profile.id);
      assert.strictEqual(parsed.profiles[0].name, "Smoke profile");
    } finally {
      restoreWorkspace();
      cleanupTempDirectories(workspaceRoot, storageRoot);
    }
  });

  test("startRun records a baseline-only benchmark result", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-run-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-run-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(workspaceRoot, "src", "example.ts"), "export const value = 1;\n", "utf8");
    const restoreWorkspace = patchWorkspaceFoldersForTest(workspaceRoot);

    try {
      const manager = new ResearchManager(
        createExtensionContext(storageRoot),
        createNoopExecutor(),
      );

      const profile = await manager.createProfile({
        name: "Baseline only",
        instructions: "No-op; max iterations is zero for this test.",
        editablePaths: ["src/example.ts"],
        benchmarkCommand: benchmarkCommand(1.5),
        metricPattern: "score:\\s*([0-9.]+)",
        metricDirection: "maximize",
        maxIterations: 0,
        maxMinutes: 2,
        maxConsecutiveFailures: 1,
        benchmarkTimeoutSeconds: 30,
        editWaitSeconds: 5,
      });

      const startedRun = await manager.startRun(profile.id);
      await waitUntil(() => {
        const latestRun = manager.getRecentRuns(1)[0];
        return !!latestRun
          && latestRun.id === startedRun.id
          && latestRun.status !== "running"
          && latestRun.status !== "stopping";
      });

      const latestRun = manager.getRecentRuns(1)[0];
      assert.ok(latestRun);
      assert.strictEqual(latestRun.id, startedRun.id);
      assert.strictEqual(latestRun.status, "completed");
      assert.strictEqual(latestRun.baselineScore, 1.5);
      assert.strictEqual(latestRun.bestScore, 1.5);
      assert.strictEqual(latestRun.completedIterations, 0);
      assert.strictEqual(Array.isArray(latestRun.attempts), true);
      assert.strictEqual(latestRun.attempts.length, 1);
      assert.strictEqual(latestRun.attempts[0].outcome, "baseline");

      const historyPath = path.join(workspaceRoot, ".vscode", "research-history", startedRun.id, "run.json");
      assert.strictEqual(fs.existsSync(historyPath), true);
    } finally {
      restoreWorkspace();
      cleanupTempDirectories(workspaceRoot, storageRoot);
    }
  });

  test("sqlite mode rehydrates research state instead of trusting stale json", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-sqlite-"));
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-research-sqlite-storage-"));
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const restoreWorkspace = patchWorkspaceFoldersForTest(workspaceRoot);
    const restoreMode = patchStorageModeForTest("sqlite");

    try {
      const manager = new ResearchManager(
        createExtensionContext(storageRoot),
        createNoopExecutor(),
      );

      const profile = await manager.createProfile({
        name: "SQLite research profile",
        instructions: "Preserve through sqlite hydration.",
        editablePaths: ["src/example.ts"],
        benchmarkCommand: benchmarkCommand(1.5),
        metricPattern: "score:\\s*([0-9.]+)",
        metricDirection: "maximize",
      });

      const sqliteState = await readWorkspaceResearchStateFromSqlite(workspaceRoot);
      const sqliteProfiles = sqliteState.profiles as Array<{ id: string; name: string }>;
      assert.ok(
        sqliteProfiles.some((entry) =>
          entry.id === profile.id && entry.name === "SQLite research profile"),
      );

      fs.writeFileSync(
        path.join(workspaceRoot, ".vscode", "research.json"),
        JSON.stringify({ version: 1, profiles: [], runs: [] }, null, 2),
        "utf8",
      );

      const reloadedManager = new ResearchManager(
        createExtensionContext(storageRoot),
        createNoopExecutor(),
      );
      await waitUntil(() =>
        reloadedManager.getAllProfiles().some((entry) => entry.id === profile.id));

      assert.strictEqual(
        reloadedManager.getAllProfiles().some((entry) => entry.id === profile.id),
        true,
      );
    } finally {
      restoreMode();
      restoreWorkspace();
      cleanupTempDirectories(workspaceRoot, storageRoot);
    }
  });
});
