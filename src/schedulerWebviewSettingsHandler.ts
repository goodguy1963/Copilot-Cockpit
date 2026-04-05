import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { notifyError } from "./extension";
import { setCockpitDisabledSystemFlagKeys } from "./cockpitBoardManager";
import type { StorageSettingsView, WebviewToExtensionMessage } from "./types";
import { messages } from "./i18n";
import { logDebug, logError, revealLogDirectory } from "./logger";
import { updateCompatibleConfigurationValue } from "./extensionCompat";

type OutgoingWebviewMessage = { type: string; [key: string]: unknown };
type PostMessageFn = (message: OutgoingWebviewMessage) => void;
type LaunchHelpChatFn = (prompt: string) => Promise<void>;
type BackupGithubFolderFn = (workspaceRoot: string) => Promise<string | undefined>;

/** Handles settings/help messages that are routed out of the main webview controller. */

export interface SettingsHandlerContext {
  postMessage: PostMessageFn;
  launchHelpChat: LaunchHelpChatFn;
  backupGithubFolder: BackupGithubFolderFn;
  updateStorageSettings?: (settings: StorageSettingsView) => void;
  updateCockpitBoard?: (board: unknown) => void;
  getCurrentStorageSettings?: () => StorageSettingsView;
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
    case "setStorageSettings": {
      const scope = vscode.workspace.workspaceFolders?.[0]?.uri;
      const target = getResourceScopedSettingsTarget();
      const requested = message.data as Partial<StorageSettingsView> | undefined;
      const mode = requested?.mode === "json" ? "json" : "sqlite";
      const sqliteJsonMirror = requested?.sqliteJsonMirror !== false;
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
        "sqliteJsonMirror",
        sqliteJsonMirror,
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
        sqliteJsonMirror,
        disabledSystemFlagKeys: normalizedDisabledSystemFlagKeys,
        appVersion: current?.appVersion ?? "",
        mcpSetupStatus: current?.mcpSetupStatus ?? "workspace-required",
        lastMcpSupportUpdateAt: current?.lastMcpSupportUpdateAt ?? "",
        lastBundledSkillsSyncAt: current?.lastBundledSkillsSyncAt ?? "",
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
          : "Do not create a backup unless I ask for one. When proposing changes, mention that I chose to skip the backup.";
      await ctx.launchHelpChat(
        `Please use the copilot-scheduler-setup skill to evaluate this workspace and plan a structured scheduler integration. Start by summarizing the current .github state, ask 2-3 concrete setup questions plus one Todo Cockpit approval/workflow question, and wait for my answer before proposing a final plan. Workspace root: ${root}. ${backupInstruction}`,
      );
      return true;
    }
    default:
      return false;
  }
}
