import * as assert from "assert";
import { selectTaskStore } from "../../taskStoreSelection";

type SampleTask = { id: string };

function snapshot(kind: "file" | "globalState", revision: number, taskId: string, overrides?: Partial<{
  exists: boolean;
  ok: boolean;
  tasks: SampleTask[];
}>) {
  return {
    kind,
    revision,
    exists: overrides?.exists ?? true,
    ok: overrides?.ok ?? true,
    tasks: overrides?.tasks ?? [{ id: taskId }],
  };
}

suite("Task store selection behavior", () => {
  test("prefers the newest healthy source and plans healing for the older copy", () => {
    const fromFile = selectTaskStore<SampleTask>(
      snapshot("globalState", 1, "global-old"),
      snapshot("file", 2, "file-new"),
    );
    assert.strictEqual(fromFile.chosenKind, "file");
    assert.strictEqual(fromFile.chosenRevision, 2);
    assert.deepStrictEqual(fromFile.chosenTasks, [{ id: "file-new" }]);
    assert.strictEqual(fromFile.shouldHealGlobalState, true);

    const fromGlobal = selectTaskStore<SampleTask>(
      snapshot("globalState", 3, "global-new"),
      snapshot("file", 2, "file-old"),
    );
    assert.strictEqual(fromGlobal.chosenKind, "globalState");
    assert.strictEqual(fromGlobal.chosenRevision, 3);
    assert.deepStrictEqual(fromGlobal.chosenTasks, [{ id: "global-new" }]);
    assert.strictEqual(fromGlobal.shouldHealFile, true);
  });

  test("prefers the file when revisions match and the file is valid", () => {
    const result = selectTaskStore<SampleTask>(
      snapshot("globalState", 7, "global"),
      snapshot("file", 7, "file"),
    );

    assert.strictEqual(result.chosenKind, "file");
    assert.strictEqual(result.chosenRevision, 7);
    assert.deepStrictEqual(result.chosenTasks, [{ id: "file" }]);
  });

  test("falls back to global state when a same-revision file is invalid", () => {
    const result = selectTaskStore<SampleTask>(
      snapshot("globalState", 4, "global"),
      snapshot("file", 4, "corrupt", { ok: false }),
    );

    assert.strictEqual(result.chosenKind, "globalState");
    assert.strictEqual(result.chosenRevision, 4);
    assert.deepStrictEqual(result.chosenTasks, [{ id: "global" }]);
  });

  test("never heals global state from a broken file snapshot", () => {
    const result = selectTaskStore<SampleTask>(
      snapshot("globalState", 0, "empty", { exists: false, tasks: [] }),
      snapshot("file", 7, "broken", { ok: false, tasks: [] }),
    );

    assert.strictEqual(result.chosenKind, "file");
    assert.strictEqual(result.shouldHealGlobalState, false);
  });

  test("an invalid file never beats an existing global snapshot", () => {
    const result = selectTaskStore<SampleTask>(
      snapshot("globalState", 9, "global-good"),
      snapshot("file", 10, "ignored", { ok: false, tasks: [] }),
    );

    assert.strictEqual(result.chosenKind, "globalState");
    assert.strictEqual(result.chosenRevision, 9);
    assert.deepStrictEqual(result.chosenTasks, [{ id: "global-good" }]);
    assert.strictEqual(result.shouldHealFile, true);
    assert.strictEqual(result.shouldHealGlobalState, false);
  });
});
