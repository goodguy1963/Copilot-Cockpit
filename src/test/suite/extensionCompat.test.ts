import * as assert from "assert";
import * as vscode from "vscode";
import {
  affectsCompatibleConfiguration,
  getCockpitCommandId,
  getCompatibleConfigurationValue,
  getLegacySchedulerCommandId,
  updateCompatibleConfigurationValue,
} from "../../extensionCompat";

type MockInspection<T> = {
  globalValue?: T;
  workspaceValue?: T;
  workspaceFolderValue?: T;
  globalLanguageValue?: T;
  workspaceLanguageValue?: T;
  workspaceFolderLanguageValue?: T;
};

type MockConfiguration = {
  get<T>(key: string, defaultValue?: T): T;
  inspect<T>(key: string): MockInspection<T> | undefined;
  update(key: string, value: unknown, target: vscode.ConfigurationTarget): Promise<void>;
};

function createMockConfiguration(
  values: Record<string, unknown>,
  explicitKeys: string[] = [],
  updateImpl?: (key: string, value: unknown, target: vscode.ConfigurationTarget) => Promise<void>,
): MockConfiguration {
  const updates: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];
  return {
    get<T>(key: string, defaultValue?: T): T {
      return (key in values ? values[key] : defaultValue) as T;
    },
    inspect<T>(key: string): MockInspection<T> | undefined {
      if (!explicitKeys.includes(key)) {
        return undefined;
      }
      return { workspaceValue: values[key] as T };
    },
    async update(key: string, value: unknown, target: vscode.ConfigurationTarget): Promise<void> {
      if (updateImpl) {
        return updateImpl(key, value, target);
      }
      values[key] = value;
      updates.push({ key, value, target });
    },
  };
}

suite("ExtensionCompat Tests", () => {
  const originalGetConfiguration = vscode.workspace.getConfiguration;

  teardown(() => {
    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = originalGetConfiguration;
  });

  test("getCompatibleConfigurationValue prefers explicit cockpit config over legacy config", () => {
    const cockpit = createMockConfiguration({ language: "de" }, ["language"]);
    const legacy = createMockConfiguration({ language: "ja" }, ["language"]);

    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = ((section?: string) => {
      return (section === "copilotCockpit" ? cockpit : legacy) as unknown as vscode.WorkspaceConfiguration;
    }) as typeof vscode.workspace.getConfiguration;

    assert.strictEqual(getCompatibleConfigurationValue("language", "en"), "de");
  });

  test("getCompatibleConfigurationValue falls back to explicit legacy config when cockpit is unset", () => {
    const cockpit = createMockConfiguration({ language: "en" }, []);
    const legacy = createMockConfiguration({ language: "ja" }, ["language"]);

    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = ((section?: string) => {
      return (section === "copilotCockpit" ? cockpit : legacy) as unknown as vscode.WorkspaceConfiguration;
    }) as typeof vscode.workspace.getConfiguration;

    assert.strictEqual(getCompatibleConfigurationValue("language", "en"), "ja");
  });

  test("updateCompatibleConfigurationValue updates cockpit and explicit legacy config", async () => {
    const cockpitValues: Record<string, unknown> = { logLevel: "info" };
    const legacyValues: Record<string, unknown> = { logLevel: "debug" };
    const cockpit = createMockConfiguration(cockpitValues, ["logLevel"]);
    const legacy = createMockConfiguration(legacyValues, ["logLevel"]);

    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = ((section?: string) => {
      return (section === "copilotCockpit" ? cockpit : legacy) as unknown as vscode.WorkspaceConfiguration;
    }) as typeof vscode.workspace.getConfiguration;

    await updateCompatibleConfigurationValue("logLevel", "error", vscode.ConfigurationTarget.Workspace);

    assert.strictEqual(cockpitValues.logLevel, "error");
    assert.strictEqual(legacyValues.logLevel, "error");
  });

  test("updateCompatibleConfigurationValue ignores unknown legacy settings after cockpit update succeeds", async () => {
    const cockpitValues: Record<string, unknown> = { autoShowOnStartup: false };
    const legacyValues: Record<string, unknown> = { autoShowOnStartup: true };
    let legacyUpdateAttempts = 0;
    const cockpit = createMockConfiguration(cockpitValues, ["autoShowOnStartup"]);
    const legacy = createMockConfiguration(
      legacyValues,
      ["autoShowOnStartup"],
      async () => {
        legacyUpdateAttempts += 1;
        throw new Error(
          "Unable to write to Folder Settings because copilotScheduler.autoShowOnStartup is not a registered configuration.",
        );
      },
    );

    (vscode.workspace as typeof vscode.workspace & {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    }).getConfiguration = ((section?: string) => {
      return (section === "copilotCockpit" ? cockpit : legacy) as unknown as vscode.WorkspaceConfiguration;
    }) as typeof vscode.workspace.getConfiguration;

    await assert.doesNotReject(async () => {
      await updateCompatibleConfigurationValue(
        "autoShowOnStartup",
        true,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
    });

    assert.strictEqual(cockpitValues.autoShowOnStartup, true);
    assert.strictEqual(legacyUpdateAttempts, 1);
  });

  test("affectsCompatibleConfiguration checks both cockpit and legacy namespaces", () => {
    const affected = new Set(["copilotScheduler.language"]);
    const event = {
      affectsConfiguration(section: string) {
        return affected.has(section);
      },
    } as vscode.ConfigurationChangeEvent;

    assert.strictEqual(affectsCompatibleConfiguration(event, "language"), true);
    assert.strictEqual(affectsCompatibleConfiguration(event, "timezone"), false);
  });

  test("builds command ids for cockpit and legacy namespaces", () => {
    assert.strictEqual(getCockpitCommandId("createTask"), "copilotCockpit.createTask");
    assert.strictEqual(getLegacySchedulerCommandId("createTask"), "copilotScheduler.createTask");
  });
});