import * as path from "path";
import { randomBytes, randomUUID } from "crypto";

export type ExternalAgentWorkspaceAccessEntry = {
  repoId: string;
  enabled: boolean;
};

export type ExternalAgentWorkspaceAccessState = {
  workspaceRoot: string;
  repoId: string;
  enabled: boolean;
  keyPresent: boolean;
};

type WorkspaceAccessMap = Record<string, ExternalAgentWorkspaceAccessEntry>;

type MementoLike = {
  get<T>(key: string, defaultValue?: T): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
};

type SecretStorageLike = {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
};

type RandomRuntime = {
  createRepoId: () => string;
  createKey: () => string;
};

const WORKSPACE_ACCESS_STATE_KEY = "externalAgentWorkspaceAccessByRoot";
const SECRET_KEY_PREFIX = "externalAgentRepoKey:";

function createRandomRuntime(): RandomRuntime {
  return {
    createRepoId: () => randomUUID(),
    createKey: () => randomBytes(32).toString("hex"),
  };
}

function normalizeWorkspaceRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot);
}

function buildSecretStorageKey(repoId: string): string {
  return `${SECRET_KEY_PREFIX}${repoId}`;
}

export class ExternalAgentAccessManager {
  constructor(
    private readonly state: MementoLike,
    private readonly secrets: SecretStorageLike,
    private readonly randomRuntime: RandomRuntime = createRandomRuntime(),
  ) {
  }

  private readWorkspaceMap(): WorkspaceAccessMap {
    return this.state.get<WorkspaceAccessMap>(WORKSPACE_ACCESS_STATE_KEY, {}) ?? {};
  }

  private async writeWorkspaceMap(nextState: WorkspaceAccessMap): Promise<void> {
    await this.state.update(WORKSPACE_ACCESS_STATE_KEY, nextState);
  }

  async getWorkspaceAccessState(
    workspaceRoot: string,
  ): Promise<ExternalAgentWorkspaceAccessState | undefined> {
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    const current = this.readWorkspaceMap()[normalizedWorkspaceRoot];
    if (!current) {
      return undefined;
    }

    const storedKey = await this.secrets.get(buildSecretStorageKey(current.repoId));
    return {
      workspaceRoot: normalizedWorkspaceRoot,
      repoId: current.repoId,
      enabled: current.enabled === true,
      keyPresent: typeof storedKey === "string" && storedKey.length > 0,
    };
  }

  getAllWorkspaceAccessEntries(): Record<string, ExternalAgentWorkspaceAccessEntry> {
    return {
      ...this.readWorkspaceMap(),
    };
  }

  async getWorkspaceKey(workspaceRoot: string): Promise<string | undefined> {
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    const current = this.readWorkspaceMap()[normalizedWorkspaceRoot];
    if (!current) {
      return undefined;
    }

    return this.secrets.get(buildSecretStorageKey(current.repoId));
  }

  async enableWorkspaceAccess(workspaceRoot: string): Promise<{
    workspaceRoot: string;
    repoId: string;
    key: string;
    createdRepoId: boolean;
    createdKey: boolean;
  }> {
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    const workspaceMap = this.readWorkspaceMap();
    const existing = workspaceMap[normalizedWorkspaceRoot];
    const repoId = existing?.repoId ?? this.randomRuntime.createRepoId();
    const secretStorageKey = buildSecretStorageKey(repoId);
    const existingKey = await this.secrets.get(secretStorageKey);
    const key = existingKey && existingKey.length > 0
      ? existingKey
      : this.randomRuntime.createKey();

    if (key !== existingKey) {
      await this.secrets.store(secretStorageKey, key);
    }

    workspaceMap[normalizedWorkspaceRoot] = {
      repoId,
      enabled: true,
    };
    await this.writeWorkspaceMap(workspaceMap);

    return {
      workspaceRoot: normalizedWorkspaceRoot,
      repoId,
      key,
      createdRepoId: !existing?.repoId,
      createdKey: key !== existingKey,
    };
  }

  async disableWorkspaceAccess(workspaceRoot: string): Promise<boolean> {
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    const workspaceMap = this.readWorkspaceMap();
    const existing = workspaceMap[normalizedWorkspaceRoot];
    if (!existing || existing.enabled !== true) {
      return false;
    }

    workspaceMap[normalizedWorkspaceRoot] = {
      ...existing,
      enabled: false,
    };
    await this.writeWorkspaceMap(workspaceMap);
    return true;
  }

  async rotateWorkspaceKey(workspaceRoot: string): Promise<{
    workspaceRoot: string;
    repoId: string;
    key: string;
    enabled: boolean;
    createdRepoId: boolean;
  }> {
    const normalizedWorkspaceRoot = normalizeWorkspaceRoot(workspaceRoot);
    const workspaceMap = this.readWorkspaceMap();
    const existing = workspaceMap[normalizedWorkspaceRoot];
    const repoId = existing?.repoId ?? this.randomRuntime.createRepoId();
    const key = this.randomRuntime.createKey();

    workspaceMap[normalizedWorkspaceRoot] = {
      repoId,
      enabled: existing?.enabled === true,
    };

    await this.secrets.store(buildSecretStorageKey(repoId), key);
    await this.writeWorkspaceMap(workspaceMap);

    return {
      workspaceRoot: normalizedWorkspaceRoot,
      repoId,
      key,
      enabled: workspaceMap[normalizedWorkspaceRoot].enabled === true,
      createdRepoId: !existing?.repoId,
    };
  }
}