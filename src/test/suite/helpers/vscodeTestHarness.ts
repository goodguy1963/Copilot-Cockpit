import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";

const TEST_CLEANUP_OPTIONS = {
  force: true,
  recursive: true,
  retryDelay: 50,
  maxRetries: 3,
} as const;

type WorkspaceFolderShape = Array<{ uri: vscode.Uri }> | undefined;

function defineWorkspaceFolders(folders: WorkspaceFolderShape): void {
  Object.defineProperty(vscode.workspace, "workspaceFolders", {
    configurable: true,
    value: folders,
  });
}

function buildMemoryMemento(
  seedEntries: Iterable<readonly [string, unknown]>,
): vscode.Memento {
  const state = new Map<string, unknown>(seedEntries);
  return {
    keys(): readonly string[] {
      return Array.from(state.keys());
    },
    get<T>(key: string, defaultValue?: T): T | undefined {
      return state.has(key) ? (state.get(key) as T) : defaultValue;
    },
    update(key: string, value: unknown): Thenable<void> {
      state.set(key, value);
      return Promise.resolve();
    },
  } as vscode.Memento;
}

export function createMockContext(
  storageRoot: string,
  scheduledTasks: unknown[] = [],
): vscode.ExtensionContext {
  const seedEntries =
    scheduledTasks.length > 0
      ? ([["scheduledTasks", scheduledTasks]] as const)
      : [];

  return {
    globalState: buildMemoryMemento(seedEntries),
    globalStorageUri: vscode.Uri.file(storageRoot),
  } as unknown as vscode.ExtensionContext;
}

export function setWorkspaceStorageModeForTest(
  mode: "json" | "sqlite",
): () => void {
  const original = vscode.workspace.getConfiguration;

  (vscode.workspace as typeof vscode.workspace & {
    getConfiguration: typeof vscode.workspace.getConfiguration;
  }).getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope) => {
    const configuration = original(section as never, scope as never);
    if (section !== "copilotCockpit") {
      return configuration;
    }

    return {
      ...configuration,
      get<T>(key: string, defaultValue?: T): T {
        return key === "storageMode"
          ? (mode as T)
          : configuration.get<T>(key, defaultValue as T);
      },
      inspect<T>(key: string) {
        if (key !== "storageMode") {
          return configuration.inspect<T>(key);
        }

        return {
          workspaceFolderValue: mode as T,
        } as ReturnType<typeof configuration.inspect<T>>;
      },
    } as vscode.WorkspaceConfiguration;
  }) as typeof vscode.workspace.getConfiguration;

  return () => {
    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = original;
  };
}

export function createTempDir(prefix: string): string {
  const sanitizedPrefix = prefix
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return fs.mkdtempSync(path.join(os.tmpdir(), sanitizedPrefix));
}

export function removeTestPath(targetPath: string): void {
  try {
    fs.rmSync(targetPath, TEST_CLEANUP_OPTIONS);
  } catch (_error) {
    // Ignore temp fixture cleanup failures in tests.
  }
}

export function removeTestPaths(...targetPaths: string[]): void {
  for (const targetPath of targetPaths) {
    removeTestPath(targetPath);
  }
}

export function overrideWorkspaceFolders(...roots: string[]): () => void {
  const workspaceState = vscode.workspace as typeof vscode.workspace & {
    workspaceFolders?: Array<{ uri: vscode.Uri }>;
  };
  const previousFolders = workspaceState.workspaceFolders;

  try {
    defineWorkspaceFolders(roots.map((root) => ({ uri: vscode.Uri.file(root) })));
  } catch (_error) {
    // Some VS Code test hosts reject this override; callers will surface failures.
  }

  return () => {
    try {
      defineWorkspaceFolders(previousFolders);
    } catch (_error) {
      // Ignore cleanup failures in tests.
    }
  };
}
