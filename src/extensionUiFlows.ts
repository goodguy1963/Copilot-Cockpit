import * as vscode from "vscode";
import { messages } from "./i18n";

type DisclaimerScheduleManager = {
  hasAcceptedDisclaimer: () => boolean;
  storeDisclaimerAcceptance: (accepted: boolean) => Promise<void>;
};

type CronWarningScheduleManager = {
  validateMinimumInterval: (cronExpression: string) => string | undefined;
};

type NotificationMode = "sound" | "silentToast" | "silentStatus";

export async function warnIfCronTooFrequent(options: {
  cronExpression?: string;
  cockpitManager: CronWarningScheduleManager;
  getSetting: <T>(key: string, defaultValue: T) => T;
}): Promise<void> {
  if (!options.cronExpression) {
    return;
  }

  const enabled = options.getSetting<boolean>("minimumIntervalWarning", true);
  if (!enabled) {
    return;
  }

  const warning = options.cockpitManager.validateMinimumInterval(options.cronExpression);
  if (warning) {
    void vscode.window.showInformationMessage(warning);
  }
}

export async function maybeShowDisclaimerOnce(options: {
  task: { enabled: boolean };
  cockpitManager: DisclaimerScheduleManager;
}): Promise<void> {
  if (!options.task.enabled) {
    return;
  }
  if (options.cockpitManager.hasAcceptedDisclaimer()) {
    return;
  }

  const disclaimerOptions = [
    messages.disclaimerAccept(),
    messages.disclaimerDecline(),
  ] as const;
  const choice = await vscode.window.showInformationMessage(messages.disclaimerMessage(), ...disclaimerOptions);
  if (choice !== messages.disclaimerAccept()) {
    return;
  }

  await options.cockpitManager.storeDisclaimerAcceptance(true);
}

export function maybePromptReloadAfterUpdate(
  currentVersion: string,
  lastVersion: string | undefined,
): void {
  if (!lastVersion || lastVersion === currentVersion) {
    return;
  }

  void vscode.window
    .showInformationMessage(messages.reloadAfterUpdate(currentVersion), messages.reloadNow())
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
      return void vscode.window.setStatusBarMessage(options.message, timeoutMs);
    case "silentToast":
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: options.message,
        },
        () => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
      );
      return;
    default:
      void vscode.window.showInformationMessage(options.message);
  }
}

export function notifyError(options: {
  message: string;
  timeoutMs?: number;
  mode: NotificationMode;
  redactPathsForLog: (message: string) => string;
  fallbackMessage: string;
  logError: (...args: unknown[]) => void;
}): void {
  const timeoutMs = options.timeoutMs ?? 6000;
  const safeMessage = options.redactPathsForLog(options.message);
  const displayMessage = safeMessage || options.fallbackMessage || "";

  if (options.mode === "silentStatus") {
    vscode.window.setStatusBarMessage(`⚠ ${displayMessage}`, timeoutMs);
    options.logError(displayMessage);
    return;
  }

  if (options.mode === "silentToast") {
    void vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `⚠ ${displayMessage}` },
      () => new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    );
    options.logError(displayMessage);
    return;
  }

  void vscode.window.showErrorMessage(displayMessage);
}
