import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { notifyError } from "./extension";
import { setCockpitDisabledSystemFlagKeys } from "./cockpitBoardManager";
import { AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY } from "./privateConfigIgnore";
import { resolveProviderSettings } from "./providerSettings";
import { fetchLatestReleaseInfo } from "./githubReleases";
import type { ApprovalMode, StorageSettingsView, VersionUpdateView, WebviewToExtensionMessage } from "./types";
import { messages } from "./i18n";
import { logDebug, logError, revealLogDirectory } from "./logger";
import { getCompatibleConfigurationValue, updateCompatibleConfigurationValue } from "./extensionCompat";

const UPDATE_TRACK_SETTING_KEY = "updateTrack";

function parseVersionParts(version: string): number[] | undefined {
  const normalizedVersion = String(version ?? "").trim().replace(/^v/, "").split("-")[0] ?? "";
  if (!/^\d+(\.\d+)*$/.test(normalizedVersion)) {
    return undefined;
  }

  return normalizedVersion.split(".").map((value) => Number.parseInt(value, 10));
}

function compareVersionParts(left: number[], right: number[]): number {
  const maxLength = Math.max(left.length, right.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

function isNewerVersion(candidateVersion: string, currentVersion: string): boolean {
  const candidateParts = parseVersionParts(candidateVersion);
  const currentParts = parseVersionParts(currentVersion);
  if (!candidateParts || !currentParts) {
    return false;
  }

  return compareVersionParts(candidateParts, currentParts) > 0;
}

type OutgoingWebviewMessage = { type: string; [key: string]: unknown };
type PostMessageFn = (message: OutgoingWebviewMessage) => void;
type LaunchHelpChatFn = (prompt: string) => Promise<void>;
type BackupGithubFolderFn = (workspaceRoot: string) => Promise<string | undefined>;

const cockpitExtensionId = "local-dev.copilot-cockpit";
const cockpitExtensionSettingsQuery = `@ext:${cockpitExtensionId}`;
const copilotSettingsQuery = "@feature:chat";

/** Handles settings/help messages that are routed out of the main webview controller. */

export interface SettingsHandlerContext {
  postMessage: PostMessageFn;
  launchHelpChat: LaunchHelpChatFn;
  backupGithubFolder: BackupGithubFolderFn;
  openExternalUrl?: (url: string) => Promise<boolean>;
  updateStorageSettings?: (settings: StorageSettingsView) => void;
  updateCockpitBoard?: (board: unknown) => void;
  getCurrentStorageSettings?: () => StorageSettingsView;
  extensionContext?: vscode.ExtensionContext;
  schedulerWebview?: {
    activePanel?: vscode.WebviewPanel;
    extensionUri?: vscode.Uri;
  };
}

export function getResourceScopedSettingsTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : vscode.ConfigurationTarget.Global;
}

/**
 * Handle settings / help messages.
 * Returns `true` if the message was handled, `false` otherwise.
 */
export async function handleSettingsWebviewMessage(
  message: WebviewToExtensionMessage,
  ctx: SettingsHandlerContext,
): Promise<boolean> {
  switch (message.type) {
    case "setLanguage": {
      const scope = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = getResourceScopedSettingsTarget();
      await updateCompatibleConfigurationValue(
        "language",
        message.language,
        target,
        scope,
      );
      return true;
    }
    case "setLogLevel": {
      const scope = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = getResourceScopedSettingsTarget();
      await updateCompatibleConfigurationValue(
        "logLevel",
        message.logLevel,
        target,
        scope,
      );
      ctx.postMessage({
        type: "updateLogLevel",
        logLevel: message.logLevel,
      });
      return true;
    }
    case "setApprovalMode": {
      const approvalMode = typeof message.approvalMode === "string"
        ? message.approvalMode
        : "default";
      const validModes: ApprovalMode[] = ["default", "auto-approve", "autopilot", "yolo"];
      const safeMode = validModes.includes(approvalMode as ApprovalMode)
        ? approvalMode as ApprovalMode
        : "default";
      await updateCompatibleConfigurationValue(
        "approvalMode",
        safeMode,
        vscode.ConfigurationTarget.Global,
      );
      return true;
    }
    case "setStorageSettings": {
      const scope = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = getResourceScopedSettingsTarget();
      const requested = message.data as Partial<StorageSettingsView> | undefined;
      const mode = requested?.mode === "json" ? "json" : "sqlite";
      const { searchProvider, researchProvider } = resolveProviderSettings({
        searchProvider: requested?.searchProvider,
        researchProvider: requested?.researchProvider,
        hasExplicitResearchProvider: !!requested
          && Object.prototype.hasOwnProperty.call(requested, "researchProvider"),
      });
      const sqliteJsonMirror = requested?.sqliteJsonMirror !== false;
      const autoIgnorePrivateFiles = requested?.autoIgnorePrivateFiles !== false;
      const disabledSystemFlagKeys = Array.isArray(requested?.disabledSystemFlagKeys)
        ? requested!.disabledSystemFlagKeys
        : [];
      await updateCompatibleConfigurationValue(
        "storageMode",
        mode,
        target,
        scope,
      );
      await updateCompatibleConfigurationValue(
        "searchProvider",
        searchProvider,
        target,
        scope,
      );
      await updateCompatibleConfigurationValue(
        "researchProvider",
        researchProvider,
        target,
        scope,
      );
      await updateCompatibleConfigurationValue(
        "sqliteJsonMirror",
        sqliteJsonMirror,
        target,
        scope,
      );
      await updateCompatibleConfigurationValue(
        AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY,
        autoIgnorePrivateFiles,
        target,
        scope,
      );
      let updatedBoard: unknown;
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceRoot) {
        updatedBoard = setCockpitDisabledSystemFlagKeys(
          workspaceRoot,
          disabledSystemFlagKeys,
        );
      }
      const normalizedDisabledSystemFlagKeys = updatedBoard
        && typeof updatedBoard === "object"
        && Array.isArray((updatedBoard as { disabledSystemFlagKeys?: string[] }).disabledSystemFlagKeys)
        ? (updatedBoard as { disabledSystemFlagKeys: string[] }).disabledSystemFlagKeys.slice()
        : disabledSystemFlagKeys;
      const current = ctx.getCurrentStorageSettings?.();
      const nextSettings: StorageSettingsView = {
        mode,
        searchProvider,
        researchProvider,
        sqliteJsonMirror,
        autoIgnorePrivateFiles,
        disabledSystemFlagKeys: normalizedDisabledSystemFlagKeys,
        appVersion: current?.appVersion ?? "",
        mcpSetupStatus: current?.mcpSetupStatus ?? "workspace-required",
        lastMcpSupportUpdateAt: current?.lastMcpSupportUpdateAt ?? "",
        lastBundledSkillsSyncAt: current?.lastBundledSkillsSyncAt ?? "",
        bundledSkillsStatus: current?.bundledSkillsStatus ?? "workspace-required",
        lastBundledAgentsSyncAt: current?.lastBundledAgentsSyncAt ?? "",
      };
      if (updatedBoard && ctx.updateCockpitBoard) {
        ctx.updateCockpitBoard(updatedBoard);
      }
      if (ctx.updateStorageSettings) {
        ctx.updateStorageSettings(nextSettings);
      } else {
        ctx.postMessage({
          type: "updateStorageSettings",
          storageSettings: nextSettings,
        });
      }
      return true;
    }
    case "openLogFolder": {
      await revealLogDirectory();
      return true;
    }
    case "openExtensionSettings": {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        cockpitExtensionSettingsQuery,
      );
      return true;
    }
    case "openCopilotSettings": {
      await vscode.commands.executeCommand(
        "workbench.action.openSettings",
        copilotSettingsQuery,
      );
      return true;
    }
    case "openChatPermissionPicker": {
      await vscode.commands.executeCommand("workbench.action.chat.openPermissionPicker");
      return true;
    }
    case "introTutorial": {
      await ctx.launchHelpChat(
        "Please use the copilot-scheduler-intro skill to give me a guided tour of how this plugin works.",
      );
      return true;
    }
    case "debugWebview": {
      logDebug("[SchedulerWebviewDebug]", message.event, message.detail);
      return true;
    }
    case "planIntegration": {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!root) {
        vscode.window.showErrorMessage("Please open a workspace folder first.");
        return true;
      }

      const answer = await vscode.window.showInformationMessage(
        "Before starting the agent integration planner, would you like to build a backup of your .github folder?",
        "Yes, Backup",
        "No",
      );

      let backupPath: string | undefined;
      if (answer === "Yes, Backup") {
        try {
          backupPath = await ctx.backupGithubFolder(root);
          if (backupPath) {
            vscode.window.showInformationMessage(
              `Backed up .github to ${path.relative(root, backupPath)}`,
            );
          } else {
            vscode.window.showWarningMessage(
              "No .github folder was found to back up.",
            );
          }
        } catch (error) {
          logError(
            "[SchedulerWebview] Failed to create a .github backup before planning integration.",
            error,
          );
          notifyError(
            "Failed to create a .github backup before planning integration.",
          );
          return true;
        }
      }

      const backupInstruction = backupPath
        ? `A backup of .github was created at ${path.relative(root, backupPath)}.`
        : answer === "Yes, Backup"
          ? "No .github folder existed to back up."
          : "No upfront .github backup was created. Planning can continue. Before any implementation changes, create or use a .github backup first when available.";
      await ctx.launchHelpChat(
        `Please use the copilot-scheduler-setup skill to evaluate this workspace and plan a structured scheduler integration. Start by summarizing the current repo-local agent-system surfaces, ask 2-3 concrete setup questions plus one Todo Cockpit approval/workflow question, and wait for my answer before proposing a final plan. Treat any existing repo-local agent systems as user-owned. Do not install or sync bundled agents until I explicitly approve it. If I later approve implementation, create or use a .github backup first when available and then carry out the agreed setup safely. Workspace root: ${root}. ${backupInstruction}`,
      );
      return true;
    }
    case "checkForUpdates": {
      const extCtx = ctx.extensionContext;
      if (!extCtx) {
        return true;
      }
      const configuredTrack = getCompatibleConfigurationValue<string>(UPDATE_TRACK_SETTING_KEY, "stable");
      const track = configuredTrack === "edge" ? "edge" : "stable";
      const [stable, edge] = await Promise.all([
        fetchLatestReleaseInfo(extCtx, "stable"),
        fetchLatestReleaseInfo(extCtx, "edge"),
      ]);
      const currentVersion = extCtx.extension.packageJSON?.version ?? "";
      const latestStableVersion = stable?.version?.replace(/^v/, "") ?? "";
      const latestEdgeVersion = edge?.version?.replace(/^v/, "") ?? "";
      const stableHasNewVersion = isNewerVersion(latestStableVersion, currentVersion);
      const edgeHasNewVersion = isNewerVersion(latestEdgeVersion, currentVersion);
      const versionUpdate: VersionUpdateView = {
        currentVersion,
        latestStableVersion,
        latestEdgeVersion,
        lastCheckedAt: new Date().toISOString(),
        track,
        stableDownloadUrl: stable?.htmlUrl ?? "",
        edgeDownloadUrl: edge?.htmlUrl ?? "",
        stableHasNewVersion,
        edgeHasNewVersion,
        hasNewVersion: track === "edge" ? edgeHasNewVersion : stableHasNewVersion,
      };
      ctx.postMessage({ type: "updateVersionInfo", versionUpdate });
      return true;
    }
    case "openReleasePage": {
      const releaseUrl = typeof message.url === "string" ? message.url.trim() : "";
      if (!releaseUrl) {
        return true;
      }
      const openExternalUrl = ctx.openExternalUrl
        ?? ((url: string) => vscode.env.openExternal(vscode.Uri.parse(url)));
      await openExternalUrl(releaseUrl);
      return true;
    }
    case "setUpdateTrack": {
      const newTrack = typeof message.track === "string" ? message.track : "stable";
      const validTracks = ["stable", "edge"];
      const safeTrack = validTracks.includes(newTrack) ? newTrack : "stable";
      await updateCompatibleConfigurationValue(
        UPDATE_TRACK_SETTING_KEY,
        safeTrack,
        vscode.ConfigurationTarget.Global,
      );
      return true;
    }
    default:
      return false;
  }
}
