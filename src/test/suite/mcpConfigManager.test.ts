import * as fs from "fs";
import * as assert from "assert";
import * as os from "os";
import type { SchedulerMcpSetupState } from "../../mcpConfigManager";
import * as path from "path";
import {
  buildNodeShellExecutionCommand,
  buildSchedulerMcpServerEntry,
  getSchedulerMcpSetupState,
  getWorkspaceCodexConfigPath,
  getWorkspaceMcpConfigPath,
  getWorkspaceMcpLauncherPath,
  getWorkspaceMcpLauncherStatePath,
  resolveNodeLaunchCommand,
  upsertSchedulerCodexConfig,
  upsertSchedulerMcpConfig,
  upsertThirdPartyMcpTemplates,
  upsertSingleThirdPartyMcpTemplate,
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
        servers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
      };
      assert.strictEqual(saved.servers?.copilot_cockpit?.command, expectedEntry.command);
      assert.deepStrictEqual(saved.servers?.copilot_cockpit?.env ?? {}, expectedEntry.env ?? {});
      assert.strictEqual(saved.servers?.scheduler, undefined);
      assert.strictEqual(
        fs.existsSync(getWorkspaceMcpLauncherPath(workspaceRoot)),
        true,
      );
      assert.strictEqual(
        fs.existsSync(getWorkspaceMcpLauncherStatePath(workspaceRoot)),
        true,
      );
      assert.strictEqual(
        saved.servers?.copilot_cockpit?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );

      const stateAfter = expectSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateAfter.status, "configured");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("merges copilot_cockpit server into existing mcp config without dropping other servers", () => {
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
        servers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
        metadata?: { owner?: string };
      };
      assert.strictEqual(saved.metadata?.owner, "tests");
      assert.strictEqual(saved.servers?.existing?.args?.[0], "existing-server.js");
      assert.strictEqual(saved.servers?.copilot_cockpit?.command, expectedEntry.command);
      assert.deepStrictEqual(saved.servers?.copilot_cockpit?.env ?? {}, expectedEntry.env ?? {});
      assert.strictEqual(saved.servers?.scheduler, undefined);
      assert.strictEqual(
        saved.servers?.copilot_cockpit?.args?.[0],
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
        initial.servers?.copilot_cockpit?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );
      assert.strictEqual(
        updated.servers?.copilot_cockpit?.args?.[0],
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

  test("marks a mismatched copilot_cockpit server entry as stale", () => {
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
            copilot_cockpit: {
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
        assert.ok(state.reason.includes("copilot_cockpit MCP entry points to"));
      }
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("treats a matching legacy scheduler entry as stale so setup can rename it", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-legacy-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "out", "server.js"), "", "utf8");
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });

    try {
      fs.writeFileSync(
        getWorkspaceMcpConfigPath(workspaceRoot),
        JSON.stringify(
          {
            servers: {
              scheduler: buildSchedulerMcpServerEntry(workspaceRoot),
            },
          },
          null,
          4,
        ),
        "utf8",
      );

      const state = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(state.status, "stale");
      if (state.status === "stale") {
        assert.ok(state.reason.includes("Legacy scheduler MCP entry should be renamed to copilot_cockpit."));
      }
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("repairs invalid mcp config by backing it up and rewriting a valid copilot_cockpit entry", () => {
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
        servers?: Record<string, { command?: string; args?: string[]; env?: Record<string, string> }>;
      };
      assert.strictEqual(repaired.servers?.copilot_cockpit?.command, expectedEntry.command);
      assert.deepStrictEqual(repaired.servers?.copilot_cockpit?.env ?? {}, expectedEntry.env ?? {});
      assert.strictEqual(repaired.servers?.scheduler, undefined);
      assert.strictEqual(
        repaired.servers?.copilot_cockpit?.args?.[0],
        getWorkspaceMcpLauncherPath(workspaceRoot),
      );

      const stateAfter = getSchedulerMcpSetupState(workspaceRoot, extensionRoot);
      assert.strictEqual(stateAfter.status, "configured");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("prefers the VS Code runtime with ELECTRON_RUN_AS_NODE when the extension host is not plain node", () => {
    const launch = resolveNodeLaunchCommand({
      platform: "darwin",
      execPath: "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
      env: {
        PATH: "",
        SHELL: "/bin/zsh",
      },
      fileExists: (filePath: string) => filePath === "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
    });

    assert.strictEqual(launch.command, "/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper");
    assert.deepStrictEqual(launch.argsPrefix, []);
    assert.deepStrictEqual(launch.env ?? {}, { ELECTRON_RUN_AS_NODE: "1" });
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
    assert.strictEqual(launch.env, undefined);
  });

  test("builds a shell command that resolves node before launching the MCP server", () => {
    const command = buildNodeShellExecutionCommand("/workspace/.vscode/copilot-cockpit-support/mcp/launcher.js");

    assert.ok(command.includes('command -v node'));
    assert.ok(command.includes('.nvm/nvm.sh'));
    assert.ok(command.includes('NVM_BIN'));
    assert.ok(command.includes('.asdf/asdf.sh'));
    assert.ok(command.includes('.nvm/versions/node'));
    assert.ok(command.includes('.asdf/installs/nodejs'));
    assert.ok(command.includes('.fnm/node-versions'));
    assert.ok(command.includes('.volta/bin/node'));
    assert.ok(command.includes('exec "$NODE_BIN" "/workspace/.vscode/copilot-cockpit-support/mcp/launcher.js"'));
  });

  test("renames legacy scheduler entries to copilot_cockpit in MCP and Codex configs", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-mcp-rename-"),
    );
    const extensionRoot = path.join(workspaceRoot, "extension-root");
    fs.mkdirSync(path.join(extensionRoot, "out"), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, "out", "server.js"), "", "utf8");
    fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
    fs.mkdirSync(path.join(workspaceRoot, ".codex"), { recursive: true });

    try {
      fs.writeFileSync(
        getWorkspaceMcpConfigPath(workspaceRoot),
        JSON.stringify(
          {
            servers: {
              scheduler: buildSchedulerMcpServerEntry(workspaceRoot),
              existing: {
                type: "stdio",
                command: "node",
                args: ["existing-server.js"],
              },
            },
          },
          null,
          4,
        ),
        "utf8",
      );
      fs.writeFileSync(
        getWorkspaceCodexConfigPath(workspaceRoot),
        [
          "[mcp_servers.scheduler]",
          'command = "node"',
          'args = ["legacy-server.js"]',
          "enabled = true",
          "startup_timeout_sec = 30",
        ].join("\n") + "\n",
        "utf8",
      );

      upsertSchedulerMcpConfig(workspaceRoot, extensionRoot);
      upsertSchedulerCodexConfig(workspaceRoot, extensionRoot);

      const savedMcp = JSON.parse(fs.readFileSync(getWorkspaceMcpConfigPath(workspaceRoot), "utf8")) as {
        servers?: Record<string, { args?: string[] }>;
      };
      const savedCodex = fs.readFileSync(getWorkspaceCodexConfigPath(workspaceRoot), "utf8");

      assert.ok(savedMcp.servers?.copilot_cockpit);
      assert.strictEqual(savedMcp.servers?.scheduler, undefined);
      assert.strictEqual(savedMcp.servers?.existing?.args?.[0], "existing-server.js");
      assert.ok(savedCodex.includes("[mcp_servers.copilot_cockpit]"));
      assert.ok(!savedCodex.includes("[mcp_servers.scheduler]"));
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

suite("Third-Party MCP Templates", () => {
  test("adds Perplexity and Tavily inputs + servers without dropping existing entries", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-3p-mcp-"),
    );

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            servers: {
              copilot_cockpit: {
                type: "stdio",
                command: "node",
                args: ["scheduler-server.js"],
              },
              customTool: {
                type: "stdio",
                command: "python",
                args: ["custom.py"],
              },
            },
            metadata: { owner: "tests" },
          },
          null,
          4,
        ),
        "utf8",
      );

      const result = upsertThirdPartyMcpTemplates(workspaceRoot);
      assert.strictEqual(result.addedInputs, 2, "should add Perplexity + Tavily inputs");
      assert.strictEqual(result.addedServers, 2, "should add perplexity + tavily servers");
      assert.strictEqual(result.updated, true);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        inputs?: Array<{ id: string }>;
        servers?: Record<string, unknown>;
        metadata?: { owner?: string };
      };

      // Preserves existing entries
      assert.strictEqual(saved.metadata?.owner, "tests");
      assert.ok(saved.servers?.copilot_cockpit);
      assert.ok(saved.servers?.customTool);

      // New entries added
      assert.ok(saved.servers?.perplexity, "perplexity server should exist");
      assert.ok(saved.servers?.tavily, "tavily server should exist");

      // No google-grounded server
      assert.strictEqual(saved.servers?.["google-grounded"], undefined, "no google-grounded entry");

      // Inputs present
      assert.ok(saved.inputs?.some((i) => i.id === "PERPLEXITY_API_KEY"));
      assert.ok(saved.inputs?.some((i) => i.id === "TAVILY_API_KEY"));
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("rerun does not duplicate inputs or servers", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-3p-dedup-"),
    );

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);

      // First run
      const first = upsertThirdPartyMcpTemplates(workspaceRoot);
      assert.strictEqual(first.addedInputs, 2);
      assert.strictEqual(first.addedServers, 2);

      // Second run
      const second = upsertThirdPartyMcpTemplates(workspaceRoot);
      assert.strictEqual(second.addedInputs, 0, "no duplicate inputs on rerun");
      assert.strictEqual(second.addedServers, 0, "no duplicate servers on rerun");
      assert.strictEqual(second.updated, false, "no update on rerun");

      // Verify only one of each in the file
      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        inputs?: Array<{ id: string }>;
        servers?: Record<string, unknown>;
      };

      const perplexityInputs = saved.inputs?.filter((i) => i.id === "PERPLEXITY_API_KEY") ?? [];
      assert.strictEqual(perplexityInputs.length, 1, "PERPLEXITY_API_KEY input should appear once");

      const tavilyInputs = saved.inputs?.filter((i) => i.id === "TAVILY_API_KEY") ?? [];
      assert.strictEqual(tavilyInputs.length, 1, "TAVILY_API_KEY input should appear once");

      assert.strictEqual(Object.keys(saved.servers ?? {}).length, 2, "only two servers (perplexity + tavily)");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("upsertSingleThirdPartyMcpTemplate adds one provider at a time", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-3p-single-"),
    );

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);

      // Add Perplexity only
      const result = upsertSingleThirdPartyMcpTemplate(workspaceRoot, "perplexity");
      assert.strictEqual(result.addedInputs, 1, "should add PERPLEXITY_API_KEY input");
      assert.strictEqual(result.addedServers, 1, "should add perplexity server");
      assert.strictEqual(result.updated, true);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        inputs?: Array<{ id: string }>;
        servers?: Record<string, unknown>;
      };
      assert.ok(saved.servers?.perplexity, "perplexity server exists");
      assert.strictEqual(saved.servers?.tavily, undefined, "tavily server should NOT exist yet");
      assert.ok(saved.inputs?.some((i) => i.id === "PERPLEXITY_API_KEY"));
      assert.strictEqual(saved.inputs?.some((i) => i.id === "TAVILY_API_KEY"), false, "TAVILY_API_KEY should NOT exist yet");

      // Add Tavily only
      const result2 = upsertSingleThirdPartyMcpTemplate(workspaceRoot, "tavily");
      assert.strictEqual(result2.addedInputs, 1, "should add TAVILY_API_KEY input");
      assert.strictEqual(result2.addedServers, 1, "should add tavily server");
      assert.strictEqual(result2.updated, true);

      const saved2 = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        inputs?: Array<{ id: string }>;
        servers?: Record<string, unknown>;
      };
      assert.ok(saved2.servers?.tavily, "tavily server now exists");
      assert.ok(saved2.servers?.perplexity, "perplexity server still exists");
      assert.ok(saved2.inputs?.some((i) => i.id === "TAVILY_API_KEY"));
      assert.ok(saved2.inputs?.some((i) => i.id === "PERPLEXITY_API_KEY"));
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("upsertSingleThirdPartyMcpTemplate is idempotent for a single provider", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-3p-single-idem-"),
    );

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);

      const first = upsertSingleThirdPartyMcpTemplate(workspaceRoot, "perplexity");
      assert.strictEqual(first.addedServers, 1);

      const second = upsertSingleThirdPartyMcpTemplate(workspaceRoot, "perplexity");
      assert.strictEqual(second.addedInputs, 0, "no duplicate input");
      assert.strictEqual(second.addedServers, 0, "no duplicate server");
      assert.strictEqual(second.updated, false);

      const saved = JSON.parse(fs.readFileSync(configPath, "utf8")) as {
        inputs?: Array<{ id: string }>;
        servers?: Record<string, unknown>;
      };
      const perplexityInputs = saved.inputs?.filter((i) => i.id === "PERPLEXITY_API_KEY") ?? [];
      assert.strictEqual(perplexityInputs.length, 1, "PERPLEXITY_API_KEY input should appear once");
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("upsertSingleThirdPartyMcpTemplate returns 0/0 for unknown provider", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-3p-unknown-"),
    );

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".vscode"), { recursive: true });
      const result = upsertSingleThirdPartyMcpTemplate(workspaceRoot, "google-grounded");
      assert.strictEqual(result.addedInputs, 0);
      assert.strictEqual(result.addedServers, 0);
      assert.strictEqual(result.updated, false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
