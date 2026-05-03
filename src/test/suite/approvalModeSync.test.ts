import * as assert from "assert";

type TestOnlyExports = typeof import("../../extension").__testOnly;

let cachedTestOnlyExports: TestOnlyExports | undefined;

async function getTestOnlyExports(): Promise<TestOnlyExports> {
  if (!cachedTestOnlyExports) {
    const extensionModule = await import("../../extension");
    cachedTestOnlyExports = extensionModule.__testOnly;
  }

  return cachedTestOnlyExports;
}

suite("Approval mode sync behavior", () => {
  test("routes configured changes into the native chat sync target", async () => {
    const testOnly = await getTestOnlyExports();
    const bootstrapModes: string[] = [];
    const nativeSyncModes: string[] = [];

    await testOnly.syncApprovalModeForMode(
      "autopilot",
      { applyToCurrentSession: true },
      {
        setApprovalBootstrapMode: (mode: string) => {
          bootstrapModes.push(mode);
        },
        syncNativeApprovalMode: async (mode: string) => {
          nativeSyncModes.push(mode);
        },
      },
    );

    assert.deepStrictEqual(bootstrapModes, ["autopilot"]);
    assert.deepStrictEqual(nativeSyncModes, ["autopilot"]);
  });

  test("auto-approve defers native session changes while preserving future bootstrap", async () => {
    const testOnly = await getTestOnlyExports();
    const bootstrapModes: string[] = [];
    const nativeSyncModes: string[] = [];

    await testOnly.syncApprovalModeForMode(
      "auto-approve",
      { applyToCurrentSession: true },
      {
        setApprovalBootstrapMode: (mode: string) => {
          bootstrapModes.push(mode);
        },
        syncNativeApprovalMode: async (mode: string) => {
          nativeSyncModes.push(mode);
        },
      },
    );

    assert.deepStrictEqual(bootstrapModes, ["auto-approve"]);
    assert.deepStrictEqual(nativeSyncModes, []);
  });

  test("config sync preserves configured bootstrap mode without forcing native picker state", async () => {
    const testOnly = await getTestOnlyExports();
    const bootstrapModes: string[] = [];
    const nativeSyncModes: string[] = [];

    await testOnly.syncApprovalMode(
      () => "autopilot",
      {
        setApprovalBootstrapMode: (mode: string) => {
          bootstrapModes.push(mode);
        },
        syncNativeApprovalMode: async (mode: string) => {
          nativeSyncModes.push(mode);
        },
      },
    );

    assert.deepStrictEqual(bootstrapModes, ["autopilot"]);
    assert.deepStrictEqual(nativeSyncModes, []);
  });
});