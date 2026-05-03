import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { notifyError } from "./extension";
import { setCockpitDisabledSystemFlagKeys } from "./cockpitBoardManager";
import { AUTO_IGNORE_PRIVATE_FILES_SETTING_KEY } from "./privateConfigIgnore";
import { resolveProviderSettings } from "./providerSettings";
import type { ApprovalMode, StorageSettingsView, VersionUpdateView, WebviewToExtensionMessage } from "./types";
import { messages } from "./i18n";
import { logDebug, logError, revealLogDirectory } from "./logger";
import { getCompatibleConfigurationValue, updateCompatibleConfigurationValue } from "./extensionCompat";
import { fetchVersionUpdateView } from "./versionUpdates";
import { getWorkspaceMcpConfigPath } from "./mcpConfigManager";

const UPDATE_TRACK_SETTING_KEY = "updateTrack";

type OutgoingWebviewMessage = { type: string; [key: string]: unknown };
type PostMessageFn = (message: OutgoingWebviewMessage) => void;
type LaunchHelpChatFn = (prompt: string) => Promise<void>;
type BackupGithubFolderFn = (workspaceRoot: string) => Promise<string | undefined>;

const cockpitExtensionId = "local-dev.copilot-cockpit";
const cockpitExtensionSettingsQuery = `@ext:${cockpitExtensionId}`;
const chatFeatureSettingsQuery = "@feature:chat";
const chatPermissionsSettingKey = "chat.permissions.default";

type NativeChatPermissionsValue = "default" | "autoApprove" | "autopilot";

function toNativeChatPermissionsValue(
  approvalMode: ApprovalMode,
): NativeChatPermissionsValue {
  switch (approvalMode) {
    case "auto-approve":
    case "yolo":
      return "autoApprove";
    case "autopilot":
      return "autopilot";
    case "default":
    default:
      return "default";
  }
}

/** Handles settings/help messages that are routed out of the main webview controller. */

export interface SettingsHandlerContext {
  postMessage: PostMessageFn;
  launchHelpChat: LaunchHelpChatFn;
  backupGithubFolder: BackupGithubFolderFn;
  openExternalUrl?: (url: string) => Thenable<boolean>;
  openExternalUri?: (uri: vscode.Uri) => Thenable<boolean>;
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

function buildVsCodeSettingUri(
  settingKey: string,
  uriScheme = vscode.env.uriScheme,
): vscode.Uri {
  return vscode.Uri.parse(`${uriScheme}://settings/${settingKey}`);
}

const MINIMAL_WORKSPACE_MCP_CONFIG = [
  "{",
  '  "servers": {}',
  "}",
  "",
].join("\n");

async function ensureWorkspaceMcpConfigFile(workspaceRoot: string): Promise<string> {
  const configPath = getWorkspaceMcpConfigPath(workspaceRoot);
  const configDir = path.dirname(configPath);

  if (!fs.existsSync(configDir)) {
    await fs.promises.mkdir(configDir, { recursive: true });
  }

  if (!fs.existsSync(configPath)) {
    await fs.promises.writeFile(configPath, MINIMAL_WORKSPACE_MCP_CONFIG, "utf8");
  }

  return configPath;
}

async function openWorkspaceMcpConfigFile(workspaceRoot: string): Promise<void> {
  const configPath = await ensureWorkspaceMcpConfigFile(workspaceRoot);
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(configPath));
  await vscode.window.showTextDocument(document);
}

async function openVsCodeSetting(
  settingKey: string,
  ctx: Pick<SettingsHandlerContext, "openExternalUri">,
): Promise<void> {
  try {
    const openExternalUri = ctx.openExternalUri ?? ((uri: vscode.Uri) => vscode.env.openExternal(uri));
    const opened = await openExternalUri(buildVsCodeSettingUri(settingKey));
    if (opened) {
      return;
    }
  } catch {
    // Fall back to the command-based settings search below.
  }

  await vscode.commands.executeCommand(
    "workbench.action.openSettings",
    settingKey,
  );
}

/**
 * Handle settings / help messages.
 * Returns `true` if the message was handled, `false` otherwise.
 */
export async function handleSettingsWebviewMessage(
  message: WebviewToExtensionMessage,
  ctx: SettingsHandlerContext,
): Promise<boolean> {
  const scope = vscode.workspace.workspaceFolders?.[0]?.uri;

  switch (message.type) {
    case "setLanguage": {
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
      const nativeApprovalMode = toNativeChatPermissionsValue(safeMode);
      await updateCompatibleConfigurationValue(
        "approvalMode",
        safeMode,
        vscode.ConfigurationTarget.Global,
      );
      await vscode.workspace.getConfiguration().update(
        chatPermissionsSettingKey,
        nativeApprovalMode,
        vscode.ConfigurationTarget.Global,
      );
      return true;
    }
    case "setStorageSettings": {
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
        chatFeatureSettingsQuery,
      );
      return true;
    }
    case "openWorkspaceMcpConfig": {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage("Please open a workspace folder first.");
        return true;
      }

      try {
        await openWorkspaceMcpConfigFile(workspaceRoot);
      } catch (error) {
        logError("[SchedulerWebview] Failed to open workspace MCP config.", error);
        notifyError("Failed to open workspace MCP config.");
      }
      return true;
    }
    case "openChatPermissionPicker": {
      await openVsCodeSetting(chatPermissionsSettingKey, ctx);
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
      const track = getCompatibleConfigurationValue<string>(
        UPDATE_TRACK_SETTING_KEY,
        "stable",
        scope,
      );
      const versionUpdate: VersionUpdateView = await fetchVersionUpdateView(
        extCtx,
        track as "stable" | "edge",
      );
      ctx.postMessage({ type: "updateVersionInfo", versionUpdate });
      return true;
    }
    case "openReleasePage": {
      const releaseUrl = typeof message.url === "string" ? message.url.trim() : "";
      if (!releaseUrl) {
        return true;
      }
      if (ctx.openExternalUrl) {
        await ctx.openExternalUrl(releaseUrl);
      } else {
        await vscode.env.openExternal(vscode.Uri.parse(releaseUrl));
      }
      return true;
    }
    case "setUpdateTrack": {
      const newTrack = typeof message.track === "string" ? message.track : "stable";
      const validTracks = ["stable", "edge"];
      const safeTrack = validTracks.includes(newTrack) ? newTrack : "stable";
      await updateCompatibleConfigurationValue(
        UPDATE_TRACK_SETTING_KEY,
        safeTrack,
        getResourceScopedSettingsTarget(),
        scope,
      );
      return true;
    }
    default:
      return false;
  }
}
