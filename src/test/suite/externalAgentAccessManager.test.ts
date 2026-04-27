import * as assert from "assert";
import { ExternalAgentAccessManager } from "../../externalAgentAccessManager";

type MemoryStore = {
  values: Map<string, unknown>;
  secrets: Map<string, string>;
};

function createMemoryStore(): MemoryStore {
  return {
    values: new Map<string, unknown>(),
    secrets: new Map<string, string>(),
  };
}

function createAccessManager(store: MemoryStore): ExternalAgentAccessManager {
  return new ExternalAgentAccessManager(
    {
      get<T>(key: string, defaultValue?: T): T | undefined {
        return store.values.has(key) ? (store.values.get(key) as T) : defaultValue;
      },
      update(key: string, value: unknown): Thenable<void> {
        store.values.set(key, value);
        return Promise.resolve();
      },
    },
    {
      get(key: string): Thenable<string | undefined> {
        return Promise.resolve(store.secrets.get(key));
      },
      store(key: string, value: string): Thenable<void> {
        store.secrets.set(key, value);
        return Promise.resolve();
      },
      delete(key: string): Thenable<void> {
        store.secrets.delete(key);
        return Promise.resolve();
      },
    },
    {
      createRepoId: (() => {
        let nextId = 1;
        return () => `repo-${nextId++}`;
      })(),
      createKey: (() => {
        let nextKey = 1;
        return () => `key-${nextKey++}`;
      })(),
    },
  );
}

suite("External Agent Access Manager Tests", () => {
  test("enableWorkspaceAccess generates and reuses per-workspace repo ids and keys", async () => {
    const store = createMemoryStore();
    const manager = createAccessManager(store);

    const first = await manager.enableWorkspaceAccess("/workspace/a");
    const second = await manager.enableWorkspaceAccess("/workspace/a");
    const third = await manager.enableWorkspaceAccess("/workspace/b");

    assert.strictEqual(first.repoId, "repo-1");
    assert.strictEqual(first.key, "key-1");
    assert.strictEqual(first.createdRepoId, true);
    assert.strictEqual(first.createdKey, true);
    assert.strictEqual(second.repoId, "repo-1");
    assert.strictEqual(second.key, "key-1");
    assert.strictEqual(second.createdRepoId, false);
    assert.strictEqual(second.createdKey, false);
    assert.strictEqual(third.repoId, "repo-2");
    assert.strictEqual(third.key, "key-2");

    const stateA = await manager.getWorkspaceAccessState("/workspace/a");
    const stateB = await manager.getWorkspaceAccessState("/workspace/b");
    assert.strictEqual(stateA?.enabled, true);
    assert.strictEqual(stateA?.keyPresent, true);
    assert.strictEqual(stateB?.repoId, "repo-2");
  });

  test("disableWorkspaceAccess preserves the repo id but revokes enablement", async () => {
    const store = createMemoryStore();
    const manager = createAccessManager(store);

    const enabled = await manager.enableWorkspaceAccess("/workspace/a");
    const disabled = await manager.disableWorkspaceAccess("/workspace/a");
    const state = await manager.getWorkspaceAccessState("/workspace/a");
    const key = await manager.getWorkspaceKey("/workspace/a");

    assert.strictEqual(disabled, true);
    assert.strictEqual(state?.repoId, enabled.repoId);
    assert.strictEqual(state?.enabled, false);
    assert.strictEqual(key, enabled.key);
  });

  test("rotateWorkspaceKey keeps the repo id and writes a new secret", async () => {
    const store = createMemoryStore();
    const manager = createAccessManager(store);

    const enabled = await manager.enableWorkspaceAccess("/workspace/a");
    const rotated = await manager.rotateWorkspaceKey("/workspace/a");
    const key = await manager.getWorkspaceKey("/workspace/a");

    assert.strictEqual(rotated.repoId, enabled.repoId);
    assert.strictEqual(rotated.key, "key-2");
    assert.notStrictEqual(rotated.key, enabled.key);
    assert.strictEqual(key, rotated.key);
  });
});