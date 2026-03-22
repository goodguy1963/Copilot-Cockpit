import * as assert from "assert";
import { selectTaskStore } from "../../taskStoreSelection";

type T = { id: string };

suite("Task Store Selection (revision) Tests", () => {
  test("Chooses file when file revision is newer", () => {
    const res = selectTaskStore<T>(
      {
        kind: "globalState",
        exists: true,
        ok: true,
        tasks: [{ id: "g1" }],
        revision: 1,
      },
      {
        kind: "file",
        exists: true,
        ok: true,
        tasks: [{ id: "f2" }],
        revision: 2,
      },
    );

    assert.strictEqual(res.chosenKind, "file");
    assert.strictEqual(res.chosenRevision, 2);
    assert.deepStrictEqual(res.chosenTasks, [{ id: "f2" }]);
    assert.strictEqual(res.shouldHealGlobalState, true);
  });

  test("Chooses globalState when globalState revision is newer", () => {
    const res = selectTaskStore<T>(
      {
        kind: "globalState",
        exists: true,
        ok: true,
        tasks: [{ id: "g2" }],
        revision: 2,
      },
      {
        kind: "file",
        exists: true,
        ok: true,
        tasks: [{ id: "f1" }],
        revision: 1,
      },
    );

    assert.strictEqual(res.chosenKind, "globalState");
    assert.strictEqual(res.chosenRevision, 2);
    assert.deepStrictEqual(res.chosenTasks, [{ id: "g2" }]);
    assert.strictEqual(res.shouldHealFile, true);
  });

  test("Prefers file when revisions are equal and file is ok", () => {
    const res = selectTaskStore<T>(
      {
        kind: "globalState",
        exists: true,
        ok: true,
        tasks: [{ id: "g1" }],
        revision: 3,
      },
      {
        kind: "file",
        exists: true,
        ok: true,
        tasks: [{ id: "f1" }],
        revision: 3,
      },
    );
    assert.strictEqual(res.chosenKind, "file");
    assert.strictEqual(res.chosenRevision, 3);
    assert.deepStrictEqual(res.chosenTasks, [{ id: "f1" }]);
  });

  test("Prefers globalState when revisions are equal but file is invalid", () => {
    const res = selectTaskStore<T>(
      {
        kind: "globalState",
        exists: true,
        ok: true,
        tasks: [{ id: "g1" }],
        revision: 3,
      },
      {
        kind: "file",
        exists: true,
        ok: false,
        tasks: [{ id: "corrupt" }],
        revision: 3,
      },
    );
    assert.strictEqual(res.chosenKind, "globalState");
    assert.strictEqual(res.chosenRevision, 3);
    assert.deepStrictEqual(res.chosenTasks, [{ id: "g1" }]);
  });

  test("Invalid file store never wins against an existing globalState store", () => {
    const res = selectTaskStore<T>(
      {
        kind: "globalState",
        exists: true,
        ok: true,
        tasks: [{ id: "g9" }],
        revision: 9,
      },
      {
        kind: "file",
        exists: true,
        ok: false,
        tasks: [],
        revision: 10,
      },
    );

    assert.strictEqual(res.chosenKind, "globalState");
    assert.strictEqual(res.chosenRevision, 9);
    assert.deepStrictEqual(res.chosenTasks, [{ id: "g9" }]);
    assert.strictEqual(res.shouldHealFile, true);
    assert.strictEqual(res.shouldHealGlobalState, false);
  });

  test("Does not plan healing globalState from an invalid file store", () => {
    const res = selectTaskStore<T>(
      {
        kind: "globalState",
        exists: false,
        ok: true,
        tasks: [],
        revision: 0,
      },
      {
        kind: "file",
        exists: true,
        ok: false,
        tasks: [],
        revision: 7,
      },
    );
    assert.strictEqual(res.chosenKind, "file");
    assert.strictEqual(res.shouldHealGlobalState, false);
  });
});
