import * as vscode from "vscode";
import { messages } from "./i18n";

type DisclaimerScheduleManager = {
  isDisclaimerAccepted: () => boolean;
  setDisclaimerAccepted: (accepted: boolean) => Promise<void>;
};

type CronWarningScheduleManager = {
  checkMinimumInterval: (cronExpression: string) => string | undefined;
};

type NotificationMode = "sound" | "silentToast" | "silentStatus";

export async function maybeWarnCronInterval(options: {
  cronExpression?: string;
  scheduleManager: CronWarningScheduleManager;
  getSetting: <T>(key: string, defaultValue: T) => T;
}): Promise<void> {
  if (!options.cronExpression) {
    return;
  }

  const enabled = options.getSetting<boolean>("minimumIntervalWarning", true);
  if (!enabled) {
    return;
  }

  const warning = options.scheduleManager.checkMinimumInterval(options.cronExpression);
  if (warning) {
    void vscode.window.showInformationMessage(warning);
  }
}

export async function maybeShowDisclaimerOnce(options: {
  task: { enabled: boolean };
  scheduleManager: DisclaimerScheduleManager;
}): Promise<void> {
  if (!options.task.enabled) {
    return;
  }
  if (options.scheduleManager.isDisclaimerAccepted()) {
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    messages.disclaimerMessage(),
    messages.disclaimerAccept(),
    messages.disclaimerDecline(),
  );
  if (choice !== messages.disclaimerAccept()) {
    return;
  }

  await options.scheduleManager.setDisclaimerAccepted(true);
}

export function maybePromptReloadAfterUpdate(
  currentVersion: string,
  lastVersion: string | undefined,
): void {
  if (!lastVersion || lastVersion === currentVersion) {
    return;
  }

  void vscode.window
    .showInformationMessage(
      messages.reloadAfterUpdate(currentVersion),
      messages.reloadNow(),
    )
    .then((choice) => {
      if (choice === messages.reloadNow()) {
        void vscode.commands.executeCommand("workbench.action.reloadWindow");
      }
    });
}

export function notifyInfo(options: {
  message: string;
  timeoutMs?: number;
  shouldNotify: boolean;
  mode: NotificationMode;
}): void {
  if (!options.shouldNotify) {
    return;
  }

  const timeoutMs = options.timeoutMs ?? 4000;
  switch (options.mode) {
    case "silentStatus":
      vscode.window.setStatusBarMessage(options.message, timeoutMs);
      break;
    case "silentToast":
      void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: options.message },
        () => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      );
      break;
    default:
      void vscode.window.showInformationMessage(options.message);
  }
}

export function notifyError(options: {
  message: string;
  timeoutMs?: number;
  mode: NotificationMode;
  sanitizeErrorDetailsForLog: (message: string) => string;
  fallbackMessage: string;
  logError: (...args: unknown[]) => void;
}): void {
  const timeoutMs = options.timeoutMs ?? 6000;
  const safeMessage = options.sanitizeErrorDetailsForLog(options.message);
  const displayMessage = safeMessage || options.fallbackMessage || "";

  if (options.mode === "silentStatus") {
    vscode.window.setStatusBarMessage(`⚠ ${displayMessage}`, timeoutMs);
    options.logError(displayMessage);
    return;
  }

  if (options.mode === "silentToast") {
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `⚠ ${displayMessage}`,
      },
      () => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    );
    options.logError(displayMessage);
    return;
  }

  void vscode.window.showErrorMessage(displayMessage);
}
