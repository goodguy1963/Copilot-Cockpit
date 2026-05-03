import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import * as extensionCompat from "../../extensionCompat";
import * as githubReleases from "../../githubReleases";
import {
  handleSettingsWebviewMessage,
  getResourceScopedSettingsTarget,
} from "../../cockpitWebviewSettingsHandler";
import { AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY } from "../../privateConfigIgnore";
import { getWorkspaceMcpConfigPath } from "../../mcpConfigManager";

function patchWorkspaceFolders(value: Array<{ uri: vscode.Uri }> | undefined): void {
  const descriptor = { value, configurable: true };
  Object.defineProperty(vscode.workspace, "workspaceFolders", descriptor);
}

function setWorkspaceFoldersForTest(root: string): () => void {
  const workspaceAny = vscode.workspace as unknown as {
    workspaceFolders?: Array<{ uri: vscode.Uri }>;
  };
  const originalFolders = workspaceAny.workspaceFolders;

  try {
    patchWorkspaceFolders([{ uri: vscode.Uri.file(root) }]);
  } catch {
    // The host may reject patching in some environments.
  }

  return () => {
    const restoreFolders = originalFolders;
    try {
      patchWorkspaceFolders(restoreFolders);
    } catch {
      // Ignore restoration failures in the test host.
    }
  };
}

type ConfigurationUpdateCall = {
  key: string;
  value: unknown;
  target: vscode.ConfigurationTarget;
};

async function captureSetApprovalModeUpdates(approvalMode: unknown): Promise<{
  handled: boolean;
  extensionUpdateCalls: ConfigurationUpdateCall[];
  nativeUpdateCalls: ConfigurationUpdateCall[];
}> {
  const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
  const originalGetConfiguration = vscode.workspace.getConfiguration;
  const extensionUpdateCalls: ConfigurationUpdateCall[] = [];
  const nativeUpdateCalls: ConfigurationUpdateCall[] = [];

  try {
    (extensionCompat as typeof extensionCompat & {
      updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
    }).updateCompatibleConfigurationValue = (async (
      key: string,
      value: unknown,
      target: vscode.ConfigurationTarget,
    ) => {
      extensionUpdateCalls.push({ key, value, target });
    }) as typeof extensionCompat.updateCompatibleConfigurationValue;

    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = ((section?: string, scope?: vscode.ConfigurationScope) => {
      if (section !== undefined) {
        return originalGetConfiguration(section as never, scope as never);
      }

      return {
        get<T>(_key: string, defaultValue?: T): T {
          return defaultValue as T;
        },
        has(): boolean {
          return false;
        },
        inspect(): undefined {
          return undefined;
        },
        update: async (key: string, value: unknown, target: vscode.ConfigurationTarget) => {
          nativeUpdateCalls.push({ key, value, target });
        },
      } as unknown as vscode.WorkspaceConfiguration;
    }) as typeof vscode.workspace.getConfiguration;

    const handled = await handleSettingsWebviewMessage(
      { type: "setApprovalMode", approvalMode } as any,
      {
        postMessage: () => {},
        launchHelpChat: async () => {},
        backupGithubFolder: async () => undefined,
      },
    );

    return {
      handled,
      extensionUpdateCalls,
      nativeUpdateCalls,
    };
  } finally {
    (extensionCompat as typeof extensionCompat & {
      updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
    }).updateCompatibleConfigurationValue = originalUpdate;
    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = originalGetConfiguration;
  }
}

suite("Scheduler webview settings handler behavior", () => {
  test("uses a workspace-folder target when a folder is open", () => {
    const restoreWorkspace = setWorkspaceFoldersForTest(__dirname);

    try {
      assert.strictEqual(
        getResourceScopedSettingsTarget(),
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    } finally {
      restoreWorkspace();
    }
  });

  test("setStorageSettings normalizes state and posts it back to the webview", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
    const updateCalls: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];
    const postedMessages: Array<Record<string, unknown>> = [];

    try {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = (async (
        key: string,
        value: unknown,
        target: vscode.ConfigurationTarget,
      ) => {
        updateCalls.push({ key, value, target });
      }) as typeof extensionCompat.updateCompatibleConfigurationValue;

      const handled = await handleSettingsWebviewMessage(
        {
          type: "setStorageSettings",
          data: {
            mode: "sqlite",
            searchProvider: "tavily",
            researchProvider: "google-grounded",
            sqliteJsonMirror: false,
            autoIgnorePrivateFiles: false,
            disabledSystemFlagKeys: ["go", "final-user-check"],
            appVersion: "99.0.78",
            mcpSetupStatus: "configured",
            lastMcpSupportUpdateAt: "",
            lastBundledSkillsSyncAt: "",
            bundledSkillsStatus: "workspace-required",
            lastBundledAgentsSyncAt: "",
          },
        },
        {
          postMessage: (message) => postedMessages.push(message),
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(updateCalls, [
        {
          key: "storageMode",
          value: "sqlite",
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
        {
          key: "searchProvider",
          value: "built-in",
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
        {
          key: "researchProvider",
          value: "google-grounded",
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
        {
          key: "sqliteJsonMirror",
          value: false,
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
        {
          key: AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY,
          value: false,
          target: vscode.ConfigurationTarget.WorkspaceFolder,
        },
      ]);
      assert.deepStrictEqual(postedMessages, [
        {
          type: "updateStorageSettings",
          storageSettings: {
            mode: "sqlite",
            searchProvider: "built-in",
            researchProvider: "google-grounded",
            sqliteJsonMirror: false,
            autoIgnorePrivateFiles: false,
            disabledSystemFlagKeys: ["ready", "final-user-check"],
            appVersion: "",
            mcpSetupStatus: "workspace-required",
            lastMcpSupportUpdateAt: "",
            lastBundledSkillsSyncAt: "",
            bundledSkillsStatus: "workspace-required",
            lastBundledAgentsSyncAt: "",
          },
        },
      ]);
    } finally {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = originalUpdate;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("setUpdateTrack uses the repo-local configuration target when a workspace folder is open", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
    const updateCalls: Array<{
      key: string;
      value: unknown;
      target: vscode.ConfigurationTarget;
      scope?: vscode.ConfigurationScope;
    }> = [];

    try {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = (async (
        key: string,
        value: unknown,
        target: vscode.ConfigurationTarget,
        scope?: vscode.ConfigurationScope,
      ) => {
        updateCalls.push({ key, value, target, scope });
      }) as typeof extensionCompat.updateCompatibleConfigurationValue;

      const handled = await handleSettingsWebviewMessage(
        { type: "setUpdateTrack", track: "edge" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(updateCalls, [
        {
          key: "updateTrack",
          value: "edge",
          target: vscode.ConfigurationTarget.WorkspaceFolder,
          scope: vscode.workspace.workspaceFolders?.[0]?.uri,
        },
      ]);
    } finally {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = originalUpdate;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("opens extension settings from the settings webview action", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (...args: unknown[]) => {
        executeCalls.push(args);
      }) as typeof vscode.commands.executeCommand;

      const handled = await handleSettingsWebviewMessage(
        { type: "openExtensionSettings" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(executeCalls, [
        ["workbench.action.openSettings", "@ext:local-dev.copilot-cockpit"],
      ]);
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecute;
    }
  });

  test("openWorkspaceMcpConfig creates a minimal workspace MCP file and opens it", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-mcp-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const originalOpenTextDocument = vscode.workspace.openTextDocument;
    const originalShowTextDocument = vscode.window.showTextDocument;
    const openedPaths: string[] = [];
    const shownDocumentPaths: string[] = [];

    try {
      (vscode.workspace as typeof vscode.workspace & {
        openTextDocument: typeof vscode.workspace.openTextDocument;
      }).openTextDocument = (async (uri: vscode.Uri) => {
        openedPaths.push(uri.fsPath);
        return {
          uri,
          getText: () => fs.readFileSync(uri.fsPath, "utf8"),
        } as unknown as vscode.TextDocument;
      }) as unknown as typeof vscode.workspace.openTextDocument;

      (vscode.window as typeof vscode.window & {
        showTextDocument: typeof vscode.window.showTextDocument;
      }).showTextDocument = (async (document: vscode.TextDocument) => {
        shownDocumentPaths.push(document.uri.fsPath);
        return {} as vscode.TextEditor;
      }) as unknown as typeof vscode.window.showTextDocument;

      const handled = await handleSettingsWebviewMessage(
        { type: "openWorkspaceMcpConfig" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
      const expectedFsPath = vscode.Uri.file(configPath).fsPath;
      assert.strictEqual(handled, true);
      assert.strictEqual(fs.existsSync(configPath), true);
      assert.strictEqual(
        fs.readFileSync(configPath, "utf8"),
        '{\n  "servers": {}\n}\n',
      );
      assert.deepStrictEqual(openedPaths, [expectedFsPath]);
      assert.deepStrictEqual(shownDocumentPaths, [expectedFsPath]);
    } finally {
      (vscode.workspace as typeof vscode.workspace & {
        openTextDocument: typeof vscode.workspace.openTextDocument;
      }).openTextDocument = originalOpenTextDocument;
      (vscode.window as typeof vscode.window & {
        showTextDocument: typeof vscode.window.showTextDocument;
      }).showTextDocument = originalShowTextDocument;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("setApprovalMode normalizes invalid values and writes the native default setting", async () => {
    const {
      handled,
      extensionUpdateCalls,
      nativeUpdateCalls,
    } = await captureSetApprovalModeUpdates("not-valid");

    assert.strictEqual(handled, true);
    assert.deepStrictEqual(extensionUpdateCalls, [
      {
        key: "approvalMode",
        value: "default",
        target: vscode.ConfigurationTarget.Global,
      },
    ]);
    assert.deepStrictEqual(nativeUpdateCalls, [
      {
        key: "chat.permissions.default",
        value: "default",
        target: vscode.ConfigurationTarget.Global,
      },
    ]);
  });

  test("setApprovalMode preserves yolo for the extension setting and collapses it for the native setting", async () => {
    const {
      handled,
      extensionUpdateCalls,
      nativeUpdateCalls,
    } = await captureSetApprovalModeUpdates("yolo");

    assert.strictEqual(handled, true);
    assert.deepStrictEqual(extensionUpdateCalls, [
      {
        key: "approvalMode",
        value: "yolo",
        target: vscode.ConfigurationTarget.Global,
      },
    ]);
    assert.deepStrictEqual(nativeUpdateCalls, [
      {
        key: "chat.permissions.default",
        value: "autoApprove",
        target: vscode.ConfigurationTarget.Global,
      },
    ]);
  });

  test("setApprovalMode writes autopilot through to the native setting", async () => {
    const {
      handled,
      extensionUpdateCalls,
      nativeUpdateCalls,
    } = await captureSetApprovalModeUpdates("autopilot");

    assert.strictEqual(handled, true);
    assert.deepStrictEqual(extensionUpdateCalls, [
      {
        key: "approvalMode",
        value: "autopilot",
        target: vscode.ConfigurationTarget.Global,
      },
    ]);
    assert.deepStrictEqual(nativeUpdateCalls, [
      {
        key: "chat.permissions.default",
        value: "autopilot",
        target: vscode.ConfigurationTarget.Global,
      },
    ]);
  });

  test("opens Copilot settings to the chat feature filter", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (...args: unknown[]) => {
        executeCalls.push(args);
      }) as typeof vscode.commands.executeCommand;

      const handled = await handleSettingsWebviewMessage(
        { type: "openCopilotSettings" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(executeCalls, [
        ["workbench.action.openSettings", "@feature:chat"],
      ]);
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecute;
    }
  });

  test("checkForUpdates posts current, stable, and edge version info when release lookup succeeds", async () => {
    const originalFetchLatestReleaseInfo = githubReleases.fetchLatestReleaseInfo;
    const originalGetCompatibleConfigurationValue = extensionCompat.getCompatibleConfigurationValue;
    const postedMessages: Array<Record<string, unknown>> = [];
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const configReads: Array<{ key: string; fallback: unknown; scope?: vscode.ConfigurationScope }> = [];

    try {
      (githubReleases as typeof githubReleases & {
        fetchLatestReleaseInfo: typeof githubReleases.fetchLatestReleaseInfo;
      }).fetchLatestReleaseInfo = (async (_context, track) => {
        if (track === "stable") {
          return {
            tagName: "v2.0.60",
            version: "2.0.60",
            htmlUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
            isDraft: false,
            isPrerelease: false,
            publishedAt: "2026-04-30T00:00:00.000Z",
            updatedAt: "2026-04-30T02:00:00.000Z",
            displayDate: "2026-04-30T00:00:00.000Z",
          };
        }

        return {
          tagName: "v2.0.61-edge.1",
          version: "2.0.61-edge.1",
          htmlUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.61-edge.1",
          isDraft: false,
          isPrerelease: true,
          publishedAt: "2026-04-11T00:00:00.000Z",
          updatedAt: "2026-04-30T00:00:00.000Z",
          displayDate: "2026-04-30T00:00:00.000Z",
        };
      }) as typeof githubReleases.fetchLatestReleaseInfo;
      (extensionCompat as typeof extensionCompat & {
        getCompatibleConfigurationValue: typeof extensionCompat.getCompatibleConfigurationValue;
      }).getCompatibleConfigurationValue = ((key: string, fallback?: unknown, scope?: vscode.ConfigurationScope) => {
        configReads.push({ key, fallback, scope });
        if (key === "updateTrack") {
          return "edge";
        }
        return fallback;
      }) as typeof extensionCompat.getCompatibleConfigurationValue;

      const handled = await handleSettingsWebviewMessage(
        { type: "checkForUpdates" },
        {
          postMessage: (message) => postedMessages.push(message),
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
          extensionContext: {
            extension: {
              packageJSON: {
                version: "2.0.54",
              },
            },
          } as unknown as vscode.ExtensionContext,
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(postedMessages.length, 1);
      assert.deepStrictEqual(postedMessages[0], {
        type: "updateVersionInfo",
        versionUpdate: {
          currentVersion: "2.0.54",
          latestStableVersion: "2.0.60",
          latestStablePublishedAt: "2026-04-30T00:00:00.000Z",
          latestStableDisplayDate: "2026-04-30T00:00:00.000Z",
          latestEdgeVersion: "2.0.61-edge.1",
          latestEdgePublishedAt: "2026-04-11T00:00:00.000Z",
          latestEdgeDisplayDate: "2026-04-30T00:00:00.000Z",
          lastCheckedAt: String((postedMessages[0].versionUpdate as { lastCheckedAt: string }).lastCheckedAt),
          track: "edge",
          stableDownloadUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
          edgeDownloadUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.61-edge.1",
          stableHasNewVersion: true,
          edgeHasNewVersion: true,
          hasNewVersion: true,
          currentVersionIsLocalAhead: false,
          currentVersionLocalDate: "",
        },
      });
      assert.ok(
        typeof (postedMessages[0].versionUpdate as { lastCheckedAt: string }).lastCheckedAt === "string"
          && (postedMessages[0].versionUpdate as { lastCheckedAt: string }).lastCheckedAt.length > 0,
      );
      assert.strictEqual(
        (postedMessages[0].versionUpdate as { currentVersionIsLocalAhead: boolean }).currentVersionIsLocalAhead,
        false,
      );
      assert.deepStrictEqual(configReads, [
        {
          key: "updateTrack",
          fallback: "stable",
          scope: vscode.workspace.workspaceFolders?.[0]?.uri,
        },
      ]);
    } finally {
      (githubReleases as typeof githubReleases & {
        fetchLatestReleaseInfo: typeof githubReleases.fetchLatestReleaseInfo;
      }).fetchLatestReleaseInfo = originalFetchLatestReleaseInfo;
      (extensionCompat as typeof extensionCompat & {
        getCompatibleConfigurationValue: typeof extensionCompat.getCompatibleConfigurationValue;
      }).getCompatibleConfigurationValue = originalGetCompatibleConfigurationValue;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("checkForUpdates marks a current version newer than GitHub as local", async () => {
    const originalFetchLatestReleaseInfo = githubReleases.fetchLatestReleaseInfo;
    const originalGetCompatibleConfigurationValue = extensionCompat.getCompatibleConfigurationValue;
    const postedMessages: Array<Record<string, unknown>> = [];

    try {
      (githubReleases as typeof githubReleases & {
        fetchLatestReleaseInfo: typeof githubReleases.fetchLatestReleaseInfo;
      }).fetchLatestReleaseInfo = (async (_context, track) => ({
        tagName: track === "stable" ? "v2.0.60" : "v2.0.61-edge.1",
        version: track === "stable" ? "2.0.60" : "2.0.61-edge.1",
        htmlUrl: `https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/${track === "stable" ? "v2.0.60" : "v2.0.61-edge.1"}`,
        isDraft: false,
        isPrerelease: track === "edge",
        publishedAt: "2026-04-30T00:00:00.000Z",
        updatedAt: "2026-04-30T01:00:00.000Z",
        displayDate: track === "stable" ? "2026-04-30T00:00:00.000Z" : "2026-04-30T01:00:00.000Z",
      })) as typeof githubReleases.fetchLatestReleaseInfo;
      (extensionCompat as typeof extensionCompat & {
        getCompatibleConfigurationValue: typeof extensionCompat.getCompatibleConfigurationValue;
      }).getCompatibleConfigurationValue = (
        (key: string, fallback?: unknown) => key === "updateTrack" ? "stable" : fallback
      ) as typeof extensionCompat.getCompatibleConfigurationValue;

      const handled = await handleSettingsWebviewMessage(
        { type: "checkForUpdates" },
        {
          postMessage: (message) => postedMessages.push(message),
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
          extensionContext: {
            extension: {
              packageJSON: {
                version: "2.0.66",
              },
            },
          } as unknown as vscode.ExtensionContext,
        },
      );

      assert.strictEqual(handled, true);
      assert.strictEqual(postedMessages.length, 1);
      assert.strictEqual(
        (postedMessages[0].versionUpdate as { currentVersionIsLocalAhead: boolean }).currentVersionIsLocalAhead,
        true,
      );
      assert.ok(
        typeof (postedMessages[0].versionUpdate as { currentVersionLocalDate: string }).currentVersionLocalDate === "string"
          && (postedMessages[0].versionUpdate as { currentVersionLocalDate: string }).currentVersionLocalDate.length > 0,
      );
      assert.strictEqual(
        (postedMessages[0].versionUpdate as { stableHasNewVersion: boolean }).stableHasNewVersion,
        false,
      );
      assert.strictEqual(
        (postedMessages[0].versionUpdate as { edgeHasNewVersion: boolean }).edgeHasNewVersion,
        false,
      );
    } finally {
      (githubReleases as typeof githubReleases & {
        fetchLatestReleaseInfo: typeof githubReleases.fetchLatestReleaseInfo;
      }).fetchLatestReleaseInfo = originalFetchLatestReleaseInfo;
      (extensionCompat as typeof extensionCompat & {
        getCompatibleConfigurationValue: typeof extensionCompat.getCompatibleConfigurationValue;
      }).getCompatibleConfigurationValue = originalGetCompatibleConfigurationValue;
    }
  });

  test("openReleasePage routes the selected release URL through the extension host", async () => {
    const openedUrls: string[] = [];

    const handled = await handleSettingsWebviewMessage(
      {
        type: "openReleasePage",
        track: "stable",
        url: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
      },
      {
        postMessage: () => {},
        launchHelpChat: async () => {},
        backupGithubFolder: async () => undefined,
        openExternalUrl: async (url) => {
          openedUrls.push(url);
          return true;
        },
      },
    );

    assert.strictEqual(handled, true);
    assert.deepStrictEqual(openedUrls, [
      "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
    ]);
  });

  test("openChatPermissionPicker opens the native chat permissions setting with a settings URI when available", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];
    const openedUris: string[] = [];

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (...args: unknown[]) => {
        executeCalls.push(args);
      }) as typeof vscode.commands.executeCommand;

      const handled = await handleSettingsWebviewMessage(
        { type: "openChatPermissionPicker" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
          openExternalUri: async (uri) => {
            openedUris.push(uri.toString());
            return true;
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(openedUris, [
        `${vscode.env.uriScheme}://settings/chat.permissions.default`,
      ]);
      assert.deepStrictEqual(executeCalls, []);
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecute;
    }
  });

  test("openChatPermissionPicker falls back to a direct settings search when the settings URI is unavailable", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];
    const openedUris: string[] = [];

    try {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = (async (...args: unknown[]) => {
        executeCalls.push(args);
      }) as typeof vscode.commands.executeCommand;

      const handled = await handleSettingsWebviewMessage(
        { type: "openChatPermissionPicker" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
          openExternalUri: async (uri) => {
            openedUris.push(uri.toString());
            return false;
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(openedUris, [
        `${vscode.env.uriScheme}://settings/chat.permissions.default`,
      ]);
      assert.deepStrictEqual(executeCalls, [
        ["workbench.action.openSettings", "chat.permissions.default"],
      ]);
    } finally {
      (vscode.commands as typeof vscode.commands & {
        executeCommand: typeof vscode.commands.executeCommand;
      }).executeCommand = originalExecute;
    }
  });

  test("planIntegration launches a safe planning prompt without backing up when skipped", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-plan-skip-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const originalShowInformationMessage = (vscode.window as any).showInformationMessage;
    const launchedPrompts: string[] = [];
    const backupCalls: string[] = [];
    const infoCalls: unknown[][] = [];

    try {
      (vscode.window as any).showInformationMessage = async (...args: unknown[]) => {
        infoCalls.push(args);
        return infoCalls.length === 1 ? "No" : undefined;
      };

      const handled = await handleSettingsWebviewMessage(
        { type: "planIntegration" },
        {
          postMessage: () => {},
          launchHelpChat: async (prompt) => {
            launchedPrompts.push(prompt);
          },
          backupGithubFolder: async (root) => {
            backupCalls.push(root);
            return undefined;
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(backupCalls, []);
      assert.strictEqual(infoCalls.length, 1);
      assert.strictEqual(launchedPrompts.length, 1);
      assert.ok(launchedPrompts[0].includes("Treat any existing repo-local agent systems as user-owned."));
      assert.ok(launchedPrompts[0].includes("Do not install or sync bundled agents until I explicitly approve it."));
      assert.ok(launchedPrompts[0].includes("If I later approve implementation, create or use a .github backup first when available and then carry out the agreed setup safely."));
      assert.ok(launchedPrompts[0].includes("No upfront .github backup was created. Planning can continue. Before any implementation changes, create or use a .github backup first when available."));
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("planIntegration creates a .github backup before launching the planner when requested", async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-plan-backup-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);
    const normalizedWorkspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? workspaceRoot;
    const originalShowInformationMessage = (vscode.window as any).showInformationMessage;
    const launchedPrompts: string[] = [];
    const backupCalls: string[] = [];
    const infoCalls: unknown[][] = [];
    const backupPath = path.join(workspaceRoot, ".github-scheduler-backups", "snap-1");
    const relativeBackupPath = path.relative(normalizedWorkspaceRoot, backupPath);

    try {
      (vscode.window as any).showInformationMessage = async (...args: unknown[]) => {
        infoCalls.push(args);
        return infoCalls.length === 1 ? "Yes, Backup" : undefined;
      };

      const handled = await handleSettingsWebviewMessage(
        { type: "planIntegration" },
        {
          postMessage: () => {},
          launchHelpChat: async (prompt) => {
            launchedPrompts.push(prompt);
          },
          backupGithubFolder: async (root) => {
            backupCalls.push(root);
            return backupPath;
          },
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(backupCalls, [normalizedWorkspaceRoot]);
      assert.strictEqual(infoCalls.length, 2);
      assert.strictEqual(String(infoCalls[1][0]), `Backed up .github to ${relativeBackupPath}`);
      assert.strictEqual(launchedPrompts.length, 1);
      assert.ok(launchedPrompts[0].includes(`A backup of .github was created at ${relativeBackupPath}.`));
    } finally {
      (vscode.window as any).showInformationMessage = originalShowInformationMessage;
      restoreWorkspace();
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
