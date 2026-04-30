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
          value: "tavily",
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
            searchProvider: "tavily",
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

  test("setApprovalMode normalizes invalid values and writes the global setting", async () => {
    const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
    const updateCalls: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];

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
        { type: "setApprovalMode", approvalMode: "not-valid" } as any,
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(updateCalls, [
        {
          key: "approvalMode",
          value: "default",
          target: vscode.ConfigurationTarget.Global,
        },
      ]);
    } finally {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = originalUpdate;
    }
  });

  test("setApprovalMode accepts yolo and writes the global setting", async () => {
    const originalUpdate = extensionCompat.updateCompatibleConfigurationValue;
    const updateCalls: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];

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
        { type: "setApprovalMode", approvalMode: "yolo" },
        {
          postMessage: () => {},
          launchHelpChat: async () => {},
          backupGithubFolder: async () => undefined,
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(updateCalls, [
        {
          key: "approvalMode",
          value: "yolo",
          target: vscode.ConfigurationTarget.Global,
        },
      ]);
    } finally {
      (extensionCompat as typeof extensionCompat & {
        updateCompatibleConfigurationValue: typeof extensionCompat.updateCompatibleConfigurationValue;
      }).updateCompatibleConfigurationValue = originalUpdate;
    }
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
          };
        }

        return {
          tagName: "v2.0.61-edge.1",
          version: "2.0.61-edge.1",
          htmlUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.61-edge.1",
          isDraft: false,
          isPrerelease: true,
          publishedAt: "2026-04-30T00:00:00.000Z",
        };
      }) as typeof githubReleases.fetchLatestReleaseInfo;
      (extensionCompat as typeof extensionCompat & {
        getCompatibleConfigurationValue: typeof extensionCompat.getCompatibleConfigurationValue;
      }).getCompatibleConfigurationValue = ((key: string, fallback?: unknown) => {
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
          latestEdgeVersion: "2.0.61-edge.1",
          lastCheckedAt: String((postedMessages[0].versionUpdate as { lastCheckedAt: string }).lastCheckedAt),
          track: "edge",
          stableDownloadUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.60",
          edgeDownloadUrl: "https://github.com/goodguy1963/Copilot-Cockpit/releases/tag/v2.0.61-edge.1",
          stableHasNewVersion: true,
          edgeHasNewVersion: true,
          hasNewVersion: true,
        },
      });
      assert.ok(
        typeof (postedMessages[0].versionUpdate as { lastCheckedAt: string }).lastCheckedAt === "string"
          && (postedMessages[0].versionUpdate as { lastCheckedAt: string }).lastCheckedAt.length > 0,
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

  test("openChatPermissionPicker dispatches the native permission picker command", async () => {
    const originalExecute = vscode.commands.executeCommand;
    const executeCalls: unknown[][] = [];

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
        },
      );

      assert.strictEqual(handled, true);
      assert.deepStrictEqual(executeCalls, [
        ["workbench.action.chat.openPermissionPicker"],
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
