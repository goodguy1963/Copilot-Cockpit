import type * as vscode from "vscode";

export const COCKPIT_CONFIG_NAMESPACE = "copilotCockpit";
export const LEGACY_SCHEDULER_CONFIG_NAMESPACE = "copilotScheduler";

export const COCKPIT_VIEW_CONTAINER_ID = "copilotCockpit";
export const COCKPIT_TASKS_VIEW_ID = "copilotCockpitTasks";

export const SCHEDULER_COMMAND_NAMES = [
  "createTask",
  "createTaskGui",
  "listTasks",
  "openCockpit",
  "deleteTask",
  "toggleTask",
  "enableTask",
  "disableTask",
  "runNow",
  "copyPrompt",
  "editTask",
  "duplicateTask",
  "moveToCurrentWorkspace",
  "openSettings",
  "showVersion",
  "setupMcp",
  "syncBundledSkills",
] as const;

export type SchedulerCommandName = (typeof SCHEDULER_COMMAND_NAMES)[number];

type ConfigurationInspection<T> = {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
};

function getOptionalVscode(): typeof import("vscode") | undefined {
  try {
    return require("vscode") as typeof import("vscode");
  } catch {
    return undefined;
  }
}

function hasExplicitConfigValue<T>(
  configuration: vscode.WorkspaceConfiguration,
  key: string,
): boolean {
  const inspected = configuration.inspect<T>(key) as
    | ConfigurationInspection<T>
    | undefined;

  return Boolean(
    inspected &&
      (inspected.globalValue !== undefined ||
        inspected.workspaceValue !== undefined ||
        inspected.workspaceFolderValue !== undefined ||
        inspected.globalLanguageValue !== undefined ||
        inspected.workspaceLanguageValue !== undefined ||
        inspected.workspaceFolderLanguageValue !== undefined),
  );
}

function isUnknownConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /not a registered configuration|unknown configuration/i.test(
    error.message,
  );
}

export function getCockpitConfiguration(
  scope?: vscode.ConfigurationScope,
): vscode.WorkspaceConfiguration {
  const vscodeApi = getOptionalVscode();
  if (!vscodeApi) {
    return {
      get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
      has: () => false,
      inspect: () => undefined,
      update: async () => undefined,
    } as unknown as vscode.WorkspaceConfiguration;
  }

  return vscodeApi.workspace.getConfiguration(COCKPIT_CONFIG_NAMESPACE, scope);
}

export function getCompatibleConfigurationValue<T>(
  key: string,
  defaultValue: T,
  scope?: vscode.ConfigurationScope,
): T {
  const vscodeApi = getOptionalVscode();
  if (!vscodeApi) {
    return defaultValue;
  }

  const cockpitConfiguration = getCockpitConfiguration(scope);
  if (hasExplicitConfigValue<T>(cockpitConfiguration, key)) {
    return cockpitConfiguration.get<T>(key, defaultValue);
  }

  const legacyConfiguration = vscodeApi.workspace.getConfiguration(
    LEGACY_SCHEDULER_CONFIG_NAMESPACE,
    scope,
  );
  if (hasExplicitConfigValue<T>(legacyConfiguration, key)) {
    return legacyConfiguration.get<T>(key, defaultValue);
  }

  return cockpitConfiguration.get<T>(key, defaultValue);
}

export async function updateCompatibleConfigurationValue(
  key: string,
  value: unknown,
  target: vscode.ConfigurationTarget,
  scope?: vscode.ConfigurationScope,
): Promise<void> {
  const vscodeApi = getOptionalVscode();
  if (!vscodeApi) {
    return;
  }

  await getCockpitConfiguration(scope).update(key, value, target);

  const legacyConfiguration = vscodeApi.workspace.getConfiguration(
    LEGACY_SCHEDULER_CONFIG_NAMESPACE,
    scope,
  );
  if (hasExplicitConfigValue(legacyConfiguration, key)) {
    try {
      await legacyConfiguration.update(key, value, target);
    } catch (error) {
      if (!isUnknownConfigurationError(error)) {
        throw error;
      }
    }
  }
}

export function affectsCompatibleConfiguration(
  event: vscode.ConfigurationChangeEvent,
  key: string,
): boolean {
  return (
    event.affectsConfiguration(`${COCKPIT_CONFIG_NAMESPACE}.${key}`) ||
    event.affectsConfiguration(`${LEGACY_SCHEDULER_CONFIG_NAMESPACE}.${key}`)
  );
}

export function getCockpitCommandId(name: SchedulerCommandName): string {
  return `${COCKPIT_CONFIG_NAMESPACE}.${name}`;
}

export function getLegacySchedulerCommandId(name: SchedulerCommandName): string {
  return `${LEGACY_SCHEDULER_CONFIG_NAMESPACE}.${name}`;
}