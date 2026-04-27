import * as assert from "assert";
import * as path from "path";
import * as vm from "vm";
import { renderWorkspaceExternalAgentLauncherScript } from "../../externalAgentLauncherScript";

type MockChild = {
  killed: boolean;
  killCalls: string[];
  on: (event: string, handler: (...args: any[]) => void) => MockChild;
  kill: (signal: string) => void;
  emit: (event: string, ...args: any[]) => void;
};

type MockSocket = {
  destroyed: boolean;
  writes: string[];
  encoding?: string;
  on: (event: string, handler: (...args: any[]) => void) => MockSocket;
  write: (value: string) => void;
  destroy: () => void;
  setEncoding: (encoding: string) => void;
  emit: (event: string, ...args: any[]) => void;
};

function createMockChild(): MockChild {
  const handlers = new Map<string, (...args: any[]) => void>();
  const child: MockChild = {
    killed: false,
    killCalls: [],
    on(event: string, handler: (...args: any[]) => void): MockChild {
      handlers.set(event, handler);
      return child;
    },
    kill(signal: string): void {
      child.killed = true;
      child.killCalls.push(signal);
    },
    emit(event: string, ...args: any[]): void {
      handlers.get(event)?.(...args);
    },
  };
  return child;
}

function createMockSocket(): MockSocket {
  const handlers = new Map<string, (...args: any[]) => void>();
  const socket: MockSocket = {
    destroyed: false,
    writes: [],
    on(event: string, handler: (...args: any[]) => void): MockSocket {
      handlers.set(event, handler);
      return socket;
    },
    write(value: string): void {
      socket.writes.push(value);
    },
    destroy(): void {
      socket.destroyed = true;
    },
    setEncoding(encoding: string): void {
      socket.encoding = encoding;
    },
    emit(event: string, ...args: any[]): void {
      handlers.get(event)?.(...args);
    },
  };
  return socket;
}

function loadExternalLauncher(options?: {
  state?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
}) {
  const statePath = path.join("/support/external-agent", "state.json");
  const mockChild = createMockChild();
  const mockSocket = createMockSocket();
  const signalHandlers = new Map<string, () => void>();
  const exits: number[] = [];
  const spawns: Array<{ command: string; args: string[]; stdio: string }> = [];
  const intervalCallbacks: Array<() => void> = [];

  const script = renderWorkspaceExternalAgentLauncherScript().replace(
    /main\(\);\s*$/,
    "module.exports = { readState, main };\n",
  );

  const sandbox = {
    __dirname: "/support/external-agent",
    module: { exports: {} as Record<string, unknown> },
    exports: {},
    console: {
      error() {
      },
    },
    setInterval(callback: () => void) {
      intervalCallbacks.push(callback);
      return {
        unref() {
        },
      };
    },
    clearInterval() {
    },
    process: {
      env: options?.env ?? {},
      execPath: "node",
      pid: 4242,
      on(signal: string, handler: () => void) {
        signalHandlers.set(signal, handler);
      },
      exit(code: number) {
        exits.push(code);
      },
    },
    require(name: string) {
      if (name === "fs") {
        return {
          readFileSync(filePath: string) {
            if (filePath === statePath) {
              return JSON.stringify(options?.state ?? {});
            }
            throw new Error(`Unexpected read: ${filePath}`);
          },
        };
      }

      if (name === "path") {
        return path;
      }

      if (name === "net") {
        return {
          createConnection(socketPath: string) {
            assert.strictEqual(socketPath, options?.state?.controlSocketPath);
            return mockSocket;
          },
        };
      }

      if (name === "child_process") {
        return {
          spawn(command: string, args: string[], spawnOptions: { stdio: string }) {
            spawns.push({ command, args, stdio: spawnOptions.stdio });
            return mockChild;
          },
        };
      }

      throw new Error(`Unexpected require: ${name}`);
    },
  };

  vm.runInNewContext(script, sandbox, { filename: "external-launcher.js" });

  return {
    exports: sandbox.module.exports as {
      main: () => void;
    },
    exits,
    intervalCallbacks,
    mockChild,
    mockSocket,
    signalHandlers,
    spawns,
  };
}

suite("External Agent Launcher Script Tests", () => {
  const state = {
    repoId: "repo-alpha",
    controlSocketPath: "\\\\.\\pipe\\copilot-cockpit-alpha",
    innerLauncherPath: "/workspace/.vscode/copilot-cockpit-support/mcp/launcher.js",
    keyEnvVarName: "COPILOT_COCKPIT_EXTERNAL_AGENT_KEY",
    repoIdEnvVarName: "COPILOT_COCKPIT_EXTERNAL_AGENT_REPO_ID",
    heartbeatIntervalMs: 1200,
  };

  test("authenticates before spawning the inner MCP launcher", () => {
    const launcher = loadExternalLauncher({
      state,
      env: {
        COPILOT_COCKPIT_EXTERNAL_AGENT_KEY: "secret-key",
        COPILOT_COCKPIT_EXTERNAL_AGENT_REPO_ID: "repo-alpha",
      },
    });

    launcher.exports.main();

    assert.strictEqual(launcher.spawns.length, 0);
    assert.strictEqual(launcher.mockSocket.encoding, "utf8");
    assert.strictEqual(launcher.mockSocket.writes.length, 1);
    assert.deepStrictEqual(
      JSON.parse(launcher.mockSocket.writes[0] ?? "{}"),
      {
        type: "auth",
        repoId: "repo-alpha",
        key: "secret-key",
        pid: 4242,
      },
    );

    launcher.mockSocket.emit("data", '{"type":"auth-ok"}\n');

    assert.strictEqual(launcher.spawns.length, 1);
    assert.strictEqual(launcher.spawns[0]?.command, "node");
    assert.deepStrictEqual(
      Array.from(launcher.spawns[0]?.args ?? []),
      [state.innerLauncherPath],
    );
    assert.strictEqual(launcher.spawns[0]?.stdio, "inherit");
    assert.strictEqual(launcher.intervalCallbacks.length, 1);

    launcher.intervalCallbacks[0]?.();
    assert.deepStrictEqual(
      JSON.parse(launcher.mockSocket.writes[1] ?? "{}"),
      {
        type: "heartbeat",
        repoId: "repo-alpha",
      },
    );
  });

  test("does not spawn when auth is rejected", () => {
    const launcher = loadExternalLauncher({
      state,
      env: {
        COPILOT_COCKPIT_EXTERNAL_AGENT_KEY: "wrong-key",
      },
    });

    launcher.exports.main();
    launcher.mockSocket.emit("data", '{"type":"auth-denied","error":"invalid key"}\n');

    assert.strictEqual(launcher.spawns.length, 0);
    assert.deepStrictEqual(launcher.exits, [1]);
  });

  test("kills the spawned MCP launcher when access is revoked", () => {
    const launcher = loadExternalLauncher({
      state,
      env: {
        COPILOT_COCKPIT_EXTERNAL_AGENT_KEY: "secret-key",
      },
    });

    launcher.exports.main();
    launcher.mockSocket.emit("data", '{"type":"auth-ok"}\n');

    assert.strictEqual(launcher.spawns.length, 1);

    launcher.mockSocket.emit("data", '{"type":"revoked","error":"workspace disabled"}\n');

    assert.deepStrictEqual(launcher.mockChild.killCalls, ["SIGTERM"]);
    assert.deepStrictEqual(launcher.exits, [1]);
  });
});