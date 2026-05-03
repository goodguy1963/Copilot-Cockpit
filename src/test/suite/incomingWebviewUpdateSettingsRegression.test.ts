import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as extensionCompat from "../../extensionCompat";
import * as githubReleases from "../../githubReleases";
import { handleSettingsWebviewMessage } from "../../cockpitWebviewSettingsHandler";

function patchWorkspaceFolders(value: Array<{ uri: vscode.Uri }> | undefined): void {
  Object.defineProperty(vscode.workspace, "workspaceFolders", {
    value,
    configurable: true,
  });
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
    try {
      patchWorkspaceFolders(originalFolders);
    } catch {
      // Ignore restoration failures in the test host.
    }
  };
}

suite("incoming webview update settings regression", () => {
  test("setUpdateTrack reaches the settings handler after validator acceptance", async () => {
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

  test("checkForUpdates posts version info for stable and edge tracks", async () => {
    const originalFetchLatestReleaseInfo = githubReleases.fetchLatestReleaseInfo;
    const originalGetCompatibleConfigurationValue = extensionCompat.getCompatibleConfigurationValue;
    const postedMessages: Array<Record<string, unknown>> = [];
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "settings-handler-"));
    const restoreWorkspace = setWorkspaceFoldersForTest(workspaceRoot);

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
      assert.strictEqual(postedMessages[0].type, "updateVersionInfo");
      assert.strictEqual((postedMessages[0].versionUpdate as { currentVersion: string }).currentVersion, "2.0.54");
      assert.strictEqual((postedMessages[0].versionUpdate as { latestStableVersion: string }).latestStableVersion, "2.0.60");
      assert.strictEqual((postedMessages[0].versionUpdate as { latestStablePublishedAt: string }).latestStablePublishedAt, "2026-04-30T00:00:00.000Z");
      assert.strictEqual((postedMessages[0].versionUpdate as { latestStableDisplayDate: string }).latestStableDisplayDate, "2026-04-30T00:00:00.000Z");
      assert.strictEqual((postedMessages[0].versionUpdate as { latestEdgeVersion: string }).latestEdgeVersion, "2.0.61-edge.1");
      assert.strictEqual((postedMessages[0].versionUpdate as { latestEdgePublishedAt: string }).latestEdgePublishedAt, "2026-04-11T00:00:00.000Z");
      assert.strictEqual((postedMessages[0].versionUpdate as { latestEdgeDisplayDate: string }).latestEdgeDisplayDate, "2026-04-30T00:00:00.000Z");
      assert.strictEqual((postedMessages[0].versionUpdate as { currentVersionIsLocalAhead: boolean }).currentVersionIsLocalAhead, false);
      assert.strictEqual((postedMessages[0].versionUpdate as { track: string }).track, "edge");
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

  test("openReleasePage routes the selected release URL", async () => {
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
});