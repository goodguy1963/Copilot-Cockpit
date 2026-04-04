import * as assert from "assert";
import * as path from "path";
import * as vm from "vm";
import { renderWorkspaceMcpLauncherScript } from "../../mcpLauncherScript";

type DirEntryLike = {
  name: string;
  isDirectory: () => boolean;
};

type MockChild = {
  killed: boolean;
  on: (event: string, handler: (...args: any[]) => void) => MockChild;
  kill: (signal: string) => void;
  emit: (event: string, ...args: any[]) => void;
  killCalls: string[];
};

function createDirEntry(name: string): DirEntryLike {
  return {
    name,
    isDirectory: () => true,
  };
}

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

function loadLauncher(options?: {
  state?: Record<string, unknown>;
  existingPaths?: string[];
  directoryEntries?: Record<string, DirEntryLike[]>;
  env?: Record<string, string | undefined>;
}) {
  const existingPaths = new Set(options?.existingPaths ?? []);
  const directoryEntries = options?.directoryEntries ?? {};
  const statePath = path.join("/support/mcp", "state.json");
  const mockChild = createMockChild();
  const signalHandlers = new Map<string, () => void>();
  const exits: number[] = [];
  const spawns: Array<{ command: string; args: string[]; stdio: string }> = [];

  existingPaths.add(statePath);
  const script = renderWorkspaceMcpLauncherScript().replace(
    /main\(\);\s*$/,
    "module.exports = { readState, uniquePaths, getDefaultExtensionRoots, parseVersionParts, compareVersionParts, listVersionedCandidates, resolveServerPath, main };\n",
  );

  const sandbox = {
    __dirname: "/support/mcp",
    module: { exports: {} as Record<string, unknown> },
    exports: {},
    console,
    process: {
      env: options?.env ?? {},
      execPath: "node",
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
          existsSync(filePath: string) {
            return existingPaths.has(filePath);
          },
          readdirSync(dirPath: string) {
            return directoryEntries[dirPath] ?? [];
          },
        };
      }

      if (name === "path") {
        return path;
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

  vm.runInNewContext(script, sandbox, { filename: "launcher.js" });

  return {
    exports: sandbox.module.exports as {
      resolveServerPath: () => string;
      main: () => void;
      listVersionedCandidates: (searchRoot: string, prefix: string) => Array<{ serverPath: string }>;
    },
    mockChild,
    signalHandlers,
    exits,
    spawns,
  };
}

suite("MCP Launcher Script Tests", () => {
  test("resolveServerPath selects the newest installed extension runtime", () => {
    const root = path.resolve("mock-extensions-root");
    const latestRoot = path.join(root, "local-dev.copilot-cockpit-99.0.89");
    const oldRoot = path.join(root, "local-dev.copilot-cockpit-99.0.88");
    const latestServer = path.join(latestRoot, "out", "server.js");
    const oldServer = path.join(oldRoot, "out", "server.js");

    const launcher = loadLauncher({
      state: {
        preferredExtensionDir: root,
        extensionIdPrefix: "local-dev.copilot-cockpit-",
      },
      existingPaths: [root, latestServer, oldServer],
      directoryEntries: {
        [root]: [
          createDirEntry("local-dev.copilot-cockpit-99.0.88"),
          createDirEntry("local-dev.copilot-cockpit-99.0.89"),
        ],
      },
    });

    assert.strictEqual(launcher.exports.resolveServerPath(), latestServer);
  });

  test("resolveServerPath falls back to the last known server when no versioned candidate exists", () => {
    const fallbackRoot = path.resolve("mock-fallback-extension");
    const fallbackServer = path.join(fallbackRoot, "out", "server.js");

    const launcher = loadLauncher({
      state: {
        extensionIdPrefix: "local-dev.copilot-cockpit-",
        lastKnownExtensionRoot: fallbackRoot,
      },
      existingPaths: [fallbackServer],
    });

    assert.strictEqual(launcher.exports.resolveServerPath(), fallbackServer);
  });

  test("resolveServerPath throws a repairable error when no runtime can be found", () => {
    const launcher = loadLauncher({
      state: {
        extensionIdPrefix: "local-dev.copilot-cockpit-",
      },
    });

    assert.throws(
      () => launcher.exports.resolveServerPath(),
      /could not find an installed server runtime\. Reload VS Code or run Setup MCP to refresh support files\./,
    );
  });

  test("main spawns the resolved server and forwards process signals", () => {
    const root = path.resolve("mock-launcher-main-root");
    const extensionRoot = path.join(root, "local-dev.copilot-cockpit-99.0.89");
    const serverPath = path.join(extensionRoot, "out", "server.js");

    const launcher = loadLauncher({
      state: {
        preferredExtensionDir: root,
        extensionIdPrefix: "local-dev.copilot-cockpit-",
      },
      existingPaths: [root, serverPath],
      directoryEntries: {
        [root]: [createDirEntry("local-dev.copilot-cockpit-99.0.89")],
      },
    });

    launcher.exports.main();

    assert.strictEqual(launcher.spawns.length, 1);
    assert.strictEqual(launcher.spawns[0]?.command, "node");
    assert.deepStrictEqual(Array.from(launcher.spawns[0]?.args ?? []), [serverPath]);
    assert.strictEqual(launcher.spawns[0]?.stdio, "inherit");
    assert.ok(launcher.signalHandlers.has("SIGINT"));
    assert.ok(launcher.signalHandlers.has("SIGTERM"));
    assert.ok(launcher.signalHandlers.has("SIGHUP"));
    assert.ok(launcher.signalHandlers.has("SIGBREAK"));

    launcher.signalHandlers.get("SIGTERM")?.();
    assert.deepStrictEqual(launcher.mockChild.killCalls, ["SIGTERM"]);

    launcher.mockChild.emit("exit", 0);
    assert.deepStrictEqual(launcher.exits, [0]);
  });

  test("listVersionedCandidates returns empty array for a directory with no matching entries", () => {
    const root = path.resolve("mock-empty-extensions-root");

    const launcher = loadLauncher({
      state: {},
      existingPaths: [],
      directoryEntries: {
        [root]: [
          createDirEntry("other-extension-1.0.0"),
          createDirEntry("completely-different-publisher.some-plugin-3.2.1"),
        ],
      },
    });

    const candidates = launcher.exports.listVersionedCandidates(root, "local-dev.copilot-cockpit-");

    assert.strictEqual(candidates.length, 0);
  });

  test("main forwards SIGINT and SIGHUP to the child process", () => {
    const root = path.resolve("mock-launcher-signals-root");
    const extensionRoot = path.join(root, "local-dev.copilot-cockpit-99.0.90");
    const serverPath = path.join(extensionRoot, "out", "server.js");

    const launcher = loadLauncher({
      state: {
        preferredExtensionDir: root,
        extensionIdPrefix: "local-dev.copilot-cockpit-",
      },
      existingPaths: [root, serverPath],
      directoryEntries: {
        [root]: [createDirEntry("local-dev.copilot-cockpit-99.0.90")],
      },
    });

    launcher.exports.main();

    launcher.signalHandlers.get("SIGINT")?.();
    assert.ok(launcher.mockChild.killCalls.includes("SIGINT"), "Expected SIGINT to be forwarded");

    launcher.mockChild.emit("exit", 1);
    assert.deepStrictEqual(launcher.exits, [1]);
  });

  test("main exits with the child process exit code on non-zero exit", () => {
    const root = path.resolve("mock-launcher-exit-root");
    const extensionRoot = path.join(root, "local-dev.copilot-cockpit-99.0.90");
    const serverPath = path.join(extensionRoot, "out", "server.js");

    const launcher = loadLauncher({
      state: {
        preferredExtensionDir: root,
        extensionIdPrefix: "local-dev.copilot-cockpit-",
      },
      existingPaths: [root, serverPath],
      directoryEntries: {
        [root]: [createDirEntry("local-dev.copilot-cockpit-99.0.90")],
      },
    });

    launcher.exports.main();

    launcher.mockChild.emit("exit", 42);
    assert.deepStrictEqual(launcher.exits, [42]);
  });

  test("resolveServerPath prefers the version with the greater patch number", () => {
    const root = path.resolve("mock-patch-comparison-root");

    const make = (ver: string) => {
      const base = path.join(root, `local-dev.copilot-cockpit-${ver}`);
      return { dir: base, server: path.join(base, "out", "server.js") };
    };

    const v88 = make("99.0.88");
    const v100 = make("99.0.100");
    const v90 = make("99.0.90");

    const launcher = loadLauncher({
      state: {
        preferredExtensionDir: root,
        extensionIdPrefix: "local-dev.copilot-cockpit-",
      },
      existingPaths: [root, v88.server, v100.server, v90.server],
      directoryEntries: {
        [root]: [
          createDirEntry("local-dev.copilot-cockpit-99.0.88"),
          createDirEntry("local-dev.copilot-cockpit-99.0.100"),
          createDirEntry("local-dev.copilot-cockpit-99.0.90"),
        ],
      },
    });

    // 99.0.100 > 99.0.90 > 99.0.88 by version parts
    assert.strictEqual(launcher.exports.resolveServerPath(), v100.server);
  });
});