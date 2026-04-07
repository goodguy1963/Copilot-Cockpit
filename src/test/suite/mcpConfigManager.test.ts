import * as fs from "fs";
import * as assert from "assert";
import * as os from "os";
import type { SchedulerMcpSetupState } from "../../mcpConfigManager";
import * as path from "path";
import {
  buildSchedulerMcpServerEntry,
  getSchedulerMcpSetupState,
  getWorkspaceMcpConfigPath,
  getWorkspaceMcpLauncherPath,
  getWorkspaceMcpLauncherStatePath,
  resolveNodeLaunchCommand,
  upsertSchedulerMcpConfig,
} from "../../mcpConfigManager";

function expectSetupState(
  workspaceRoot: string,
  extensionRoot: string,
): SchedulerMcpSetupState {
  return getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
}

suite("MCP Config Manager Tests", () => {
  test("creates .vscode/mcp.json when missing", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-create-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "out", "server.js"), "", "utf8");

    try {
      const stateBefore = expectSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateBefore.status, "missing");

      const result = upsertSchedulerMcpConfig(workspaceRoot, extensionRoot);
      assert.strictEqual(result.createdFile, true);
      const expectedEntry = buildSchedulerMcpServerEntry(workspaceRoot);

      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
      assert.strictEqual(fs.existsSync(configPath), true);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { command?: string; args?: string[] }>;
      };
      assert.strictEqual(saved.servers?.scheduler?.command, expectedEntry.command);
      assert.strictEqual(
        fs.existsSync(getWorkspaceMcpLauncherPath(workspaceRoot)),
        true,
      );
      assert.strictEqual(
        fs.existsSync(getWorkspaceMcpLauncherStatePath(workspaceRoot)),
        true,
      );
      assert.strictEqual(
        saved.servers?.scheduler?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );

      const stateAfter = expectSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateAfter.status, "configured");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("merges scheduler server into existing mcp config without dropping other servers", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-merge-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "out", "server.js"), "", "utf8");
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          servers: {
            existing: {
              type: "stdio",
              command: "node",
              args: ["existing-server.js"],
            },
          },
          metadata: {
            owner: "tests",
          },
        },
        null,
        4,
      ),
      "utf8",
    );

    try {
      const result = upsertSchedulerMcpConfig(workspaceRoot, extensionRoot);
      assert.strictEqual(result.createdFile, false);
      const expectedEntry = buildSchedulerMcpServerEntry(workspaceRoot);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { command?: string; args?: string[] }>;
        metadata?: { owner?: string };
      };
      assert.strictEqual(saved.metadata?.owner, "tests");
      assert.strictEqual(saved.servers?.existing?.args?.[0], "existing-server.js");
      assert.strictEqual(saved.servers?.scheduler?.command, expectedEntry.command);
      assert.strictEqual(
        saved.servers?.scheduler?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("keeps the stable launcher path configured across extension version changes", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-version-change-"),
    );
    const extensionRootA = path.join(workspaceRoot, "local-dev.copilot-cockpit-99.0.71");
    const extensionRootB = path.join(workspaceRoot, "local-dev.copilot-cockpit-99.0.72");
    fs.mkdirSync(path.join(extensionRootA, "out"), { recursive: true });
    fs.mkdirSync(path.join(extensionRootB, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRootA, "out", "server.js"), "", "utf8");
    fs.writeFileSync(path.join(extensionRootB, "out", "server.js"), "", "utf8");

    try {
      upsertSchedulerMcpConfig(workspaceRoot, extensionRootA);
      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
      const initial = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { args?: string[] }>;
      };

      const stateDuringUpdate = getSchedulerMcpSetupState(workspaceRoot, extensionRootB);
      assert.strictEqual(stateDuringUpdate.status, "configured");

      upsertSchedulerMcpConfig(workspaceRoot, extensionRootB);

      const updated = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { args?: string[] }>;
      };
      assert.strictEqual(
        initial.servers?.scheduler?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );
      assert.strictEqual(
        updated.servers?.scheduler?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );

      const stateFile = JSON.parse(
        fs.readFileSync(getWorkspaceMcpLauncherStatePath(workspaceRoot), "utf8"),
      ) as { lastKnownExtensionRoot?: string };
      assert.strictEqual(stateFile.lastKnownExtensionRoot, extensionRootB);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("marks a mismatched scheduler server entry as stale", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-stale-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "out", "server.js"), "", "utf8");
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
    fs.writeFileSync(
      configPath,
      JSON.stringify(
        {
          servers: {
            scheduler: {
              type: "stdio",
              command: "node",
              args: [path.join(workspaceRoot, "old-extension", "out", "server.js")],
            },
          },
        },
        null,
        4,
      ),
      "utf8",
    );

    try {
      const state = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(state.status, "stale");
      if (state.status === "stale") {
        assert.ok(state.reason.includes("Scheduler MCP entry points to"));
      }
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("repairs invalid mcp config by backing it up and rewriting a valid scheduler entry", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-repair-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "out", "server.js"), "", "utf8");
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
    fs.writeFileSync(
      configPath,
      '{\n  "servers": {\n    "broken": {\n      "type": "stdio"\n    },\n  }\n}\n',
      "utf8",
    );

    try {
      const stateBefore = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateBefore.status, "invalid");

      const result = upsertSchedulerMcpConfig(workspaceRoot, extensionRoot);
      assert.strictEqual(result.createdFile, false);
      assert.strictEqual(result.repairedInvalidFile, true);
      assert.ok(result.backupPath);
      assert.strictEqual(fs.existsSync(result.backupPath!), true);
      const expectedEntry = buildSchedulerMcpServerEntry(workspaceRoot);

      const repaired = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { command?: string; args?: string[] }>;
      };
      assert.strictEqual(repaired.servers?.scheduler?.command, expectedEntry.command);
      assert.strictEqual(
        repaired.servers?.scheduler?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );

      const stateAfter = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateAfter.status, "configured");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("falls back to a login shell on macOS when node is not directly discoverable", () => {
    const launch = resolveNodeLaunchCommand({
      platform: "darwin",
      execPath: "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
      env: {
        PATH: "",
      },
      fileExists: (filePath: string) => filePath === "/bin/bash",
    });

    assert.strictEqual(launch.command, "/bin/bash");
    assert.deepStrictEqual(launch.argsPrefix, ["-lc"]);
  });

  test("prefers an absolute node executable when one is available on macOS", () => {
    const launch = resolveNodeLaunchCommand({
      platform: "darwin",
      execPath: "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
      env: {
        PATH: "/opt/homebrew/bin:/usr/bin",
      },
      fileExists: (filePath: string) => filePath === "/opt/homebrew/bin/node",
    });

    assert.strictEqual(launch.command, "/opt/homebrew/bin/node");
    assert.deepStrictEqual(launch.argsPrefix, []);
  });
});
