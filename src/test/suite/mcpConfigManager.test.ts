import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getSchedulerMcpSetupState,
  getWorkspaceMcpConfigPath,
  upsertSchedulerMcpConfig,
} from "../../mcpConfigManager";

suite("MCP Config Manager Tests", () => {
  test("creates .vscode/mcp.json when missing", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-create-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });

    try {
      const stateBefore = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateBefore.status, "missing");

      const result = upsertSchedulerMcpConfig(workspaceRoot, extensionRoot);
      assert.strictEqual(result.createdFile, true);

      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
      assert.strictEqual(fs.existsSync(configPath), true);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { command?: string; args?: string[] }>;
      };
      assert.strictEqual(saved.servers?.scheduler?.command, "node");
      assert.strictEqual(
        saved.servers?.scheduler?.args?.[0],
        path.join(extensionRoot, "out", "server.js"),
      );

      const stateAfter = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
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

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        servers?: Record<string, { args?: string[] }>;
        metadata?: { owner?: string };
      };
      assert.strictEqual(saved.metadata?.owner, "tests");
      assert.strictEqual(saved.servers?.existing?.args?.[0], "existing-server.js");
      assert.strictEqual(
        saved.servers?.scheduler?.args?.[0],
        path.join(extensionRoot, "out", "server.js"),
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});