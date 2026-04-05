import * as vscode from "vscode";
import type { WebviewToExtensionMessage } from "./types";

type CreateSchedulerWebviewPanelParams = {
  extensionUri: vscode.Uri;
  title: string;
  renderHtml: (webview: vscode.Webview) => string;
  onDidReceiveMessage: (message: WebviewToExtensionMessage) => void | Promise<void>;
  onDidDispose: () => void;
};

export function createSchedulerWebviewPanel(
  params: CreateSchedulerWebviewPanelParams,
): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "copilotScheduler",
    params.title,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(params.extensionUri, "media"),
        vscode.Uri.joinPath(params.extensionUri, "images"),
      ],
    },
  );

  panel.iconPath = {
    light: vscode.Uri.joinPath(params.extensionUri, "images", "icon.svg"),
    dark: vscode.Uri.joinPath(params.extensionUri, "images", "icon.svg"),
  };

  panel.webview.onDidReceiveMessage(params.onDidReceiveMessage);
  panel.webview.html = params.renderHtml(panel.webview);
  panel.onDidDispose(params.onDidDispose);
  return panel;
}
