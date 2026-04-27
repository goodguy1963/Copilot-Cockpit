import {
  readSchedulerConfig,
  writeSchedulerConfig,
} from "./cockpitJsonSanitizer";
import {
  createEmptyGitHubInboxSnapshot,
  fetchGitHubInboxSnapshot,
} from "./githubRestClient";
import type {
  GitHubAuthSession,
  GitHubAuthStatus,
  GitHubInboxCounts,
  GitHubInboxLane,
  GitHubInboxSnapshot,
  GitHubIntegrationConfig,
  GitHubIntegrationView,
  GitHubSyncStatus,
  SaveGitHubIntegrationInput,
  SchedulerWorkspaceConfig,
} from "./types";

const LIVE_GITHUB_SYNC_STATUSES = new Set<GitHubSyncStatus>([
  "syncing",
  "stale",
  "rate-limited",
  "error",
]);

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalApiBaseUrl(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.replace(/\/+$/u, "") : undefined;
}

function createEmptyInboxLane(): GitHubInboxLane {
  return {
    items: [],
    itemCount: 0,
  };
}

function normalizeInboxLane(
  lane: GitHubInboxLane | undefined,
): GitHubInboxLane {
  return {
    items: Array.isArray(lane?.items) ? lane.items.slice() : [],
    itemCount: typeof lane?.itemCount === "number" && Number.isFinite(lane.itemCount)
      ? Math.max(0, lane.itemCount)
      : Array.isArray(lane?.items)
        ? lane.items.length
        : 0,
    syncedAt: normalizeOptionalString(lane?.syncedAt),
    error: normalizeOptionalString(lane?.error),
    rateLimited: lane?.rateLimited === true ? true : undefined,
  };
}

function normalizeInboxSnapshot(
  snapshot: GitHubInboxSnapshot | undefined,
): GitHubInboxSnapshot {
  const empty = createEmptyGitHubInboxSnapshot();
  return {
    issues: normalizeInboxLane(snapshot?.issues ?? empty.issues),
    pullRequests: normalizeInboxLane(snapshot?.pullRequests ?? empty.pullRequests),
    securityAlerts: normalizeInboxLane(snapshot?.securityAlerts ?? empty.securityAlerts),
  };
}

function getInboxCounts(snapshot: GitHubInboxSnapshot): GitHubInboxCounts {
  const issues = snapshot.issues.itemCount || 0;
  const pullRequests = snapshot.pullRequests.itemCount || 0;
  const securityAlerts = snapshot.securityAlerts.itemCount || 0;
  return {
    issues,
    pullRequests,
    securityAlerts,
    total: issues + pullRequests + securityAlerts,
  };
}

function hasAnyInboxData(snapshot: GitHubInboxSnapshot | undefined): boolean {
  if (!snapshot) {
    return false;
  }

  const counts = getInboxCounts(snapshot);
  return counts.total > 0;
}

function didRepositoryIdentityChange(
  existing: GitHubIntegrationConfig | undefined,
  next: Pick<GitHubIntegrationConfig, "owner" | "repo" | "apiBaseUrl">,
): boolean {
  return normalizeOptionalString(existing?.owner) !== normalizeOptionalString(next.owner)
    || normalizeOptionalString(existing?.repo) !== normalizeOptionalString(next.repo)
    || normalizeOptionalApiBaseUrl(existing?.apiBaseUrl) !== normalizeOptionalApiBaseUrl(next.apiBaseUrl);
}

function getLatestLaneSyncAt(snapshot: GitHubInboxSnapshot): string | undefined {
  return [
    snapshot.issues.syncedAt,
    snapshot.pullRequests.syncedAt,
    snapshot.securityAlerts.syncedAt,
  ]
    .map((value) => normalizeOptionalString(value))
    .filter((value): value is string => !!value)
    .sort()
    .pop();
}

function mergeLaneCache(
  existing: GitHubInboxLane | undefined,
  next: GitHubInboxLane,
): GitHubInboxLane {
  const normalizedNext = normalizeInboxLane(next);
  if (!normalizedNext.error || normalizedNext.items.length > 0) {
    return normalizedNext;
  }

  const normalizedExisting = normalizeInboxLane(existing ?? createEmptyInboxLane());
  return {
    ...normalizedExisting,
    error: normalizedNext.error,
    rateLimited: normalizedNext.rateLimited,
  };
}

function mergeInboxCache(
  existing: GitHubInboxSnapshot | undefined,
  next: GitHubInboxSnapshot,
): GitHubInboxSnapshot {
  return {
    issues: mergeLaneCache(existing?.issues, next.issues),
    pullRequests: mergeLaneCache(existing?.pullRequests, next.pullRequests),
    securityAlerts: mergeLaneCache(existing?.securityAlerts, next.securityAlerts),
  };
}

function buildSyncStatusMessage(snapshot: GitHubInboxSnapshot): {
  syncStatus: GitHubSyncStatus;
  statusMessage: string;
} {
  const laneFailures = [
    snapshot.issues.error ? `Issues: ${snapshot.issues.error}` : undefined,
    snapshot.pullRequests.error ? `Pull Requests: ${snapshot.pullRequests.error}` : undefined,
    snapshot.securityAlerts.error ? `Security Alerts: ${snapshot.securityAlerts.error}` : undefined,
  ].filter((value): value is string => !!value);
  const laneSuccessCount = [
    snapshot.issues.syncedAt,
    snapshot.pullRequests.syncedAt,
    snapshot.securityAlerts.syncedAt,
  ].filter((value) => !!normalizeOptionalString(value)).length;
  const counts = getInboxCounts(snapshot);
  const anyRateLimited = [
    snapshot.issues.rateLimited,
    snapshot.pullRequests.rateLimited,
    snapshot.securityAlerts.rateLimited,
  ].some((value) => value === true);

  if (laneFailures.length === 0) {
    return {
      syncStatus: "ready",
      statusMessage: `GitHub inbox synced: ${counts.issues} issues, ${counts.pullRequests} pull requests, ${counts.securityAlerts} security alerts.`,
    };
  }

  if (laneSuccessCount === 0) {
    return {
      syncStatus: anyRateLimited ? "rate-limited" : "error",
      statusMessage: anyRateLimited
        ? `${laneFailures.join(" ")} Showing cached GitHub inbox data where available.`
        : `${laneFailures.join(" ")} Showing cached GitHub inbox data where available.`,
    };
  }

  return {
    syncStatus: anyRateLimited ? "rate-limited" : "stale",
    statusMessage: `GitHub inbox refreshed with partial results. ${laneFailures.join(" ")}`,
  };
}

function hasRequiredRepositoryFields(
  config: Pick<GitHubIntegrationConfig, "owner" | "repo"> | undefined,
): boolean {
  return !!normalizeOptionalString(config?.owner)
    && !!normalizeOptionalString(config?.repo);
}

function deriveSyncStatus(
  config: GitHubIntegrationConfig | undefined,
  authStatus?: GitHubAuthStatus,
): GitHubSyncStatus {
  if (!config?.enabled) {
    return "disabled";
  }

  if (config.syncStatus && LIVE_GITHUB_SYNC_STATUSES.has(config.syncStatus)) {
    return config.syncStatus;
  }

  if (!hasRequiredRepositoryFields(config)) {
    return "partial";
  }

  return authStatus?.hasConnection === false ? "partial" : "ready";
}

function buildStatusMessage(
  status: GitHubSyncStatus,
  config: GitHubIntegrationConfig | undefined,
  authStatus?: GitHubAuthStatus,
): string {
  const explicit = normalizeOptionalString(config?.statusMessage);
  if (explicit && explicit !== "Add the repository owner, repository name, and token to finish setup.") {
    return explicit;
  }

  const authMessage = normalizeOptionalString(authStatus?.authStatusText);
  const missingRepositoryFields = !hasRequiredRepositoryFields(config);

  switch (status) {
    case "disabled":
      return "GitHub integration is disabled.";
    case "ready":
      if (authMessage && !hasAnyInboxData(config?.inbox)) {
        return authMessage;
      }
      return hasAnyInboxData(config?.inbox)
        ? "GitHub inbox is ready."
        : "GitHub configuration is ready. Refresh to load inbox items.";
    case "syncing":
      return "GitHub sync is in progress.";
    case "stale":
      return "GitHub inbox has partial or stale data and needs a refresh.";
    case "rate-limited":
      return "GitHub requests are currently rate-limited.";
    case "error":
      return "GitHub integration needs attention before syncing.";
    default:
      if (missingRepositoryFields) {
        return "Add the repository owner and repository name to finish setup.";
      }

      return authMessage
        ?? "Connect GitHub in VS Code to refresh the inbox.";
  }
}

function toView(
  config: GitHubIntegrationConfig | undefined,
  authStatus?: GitHubAuthStatus,
): GitHubIntegrationView {
  const syncStatus = deriveSyncStatus(config, authStatus);
  const inbox = normalizeInboxSnapshot(config?.inbox);
  return {
    enabled: config?.enabled === true,
    owner: normalizeOptionalString(config?.owner),
    repo: normalizeOptionalString(config?.repo),
    apiBaseUrl: normalizeOptionalApiBaseUrl(config?.apiBaseUrl),
    automationPromptTemplate: normalizeOptionalString(config?.automationPromptTemplate),
    hasConnection: authStatus?.hasConnection === true,
    authStatusText: normalizeOptionalString(authStatus?.authStatusText),
    syncStatus,
    statusMessage: buildStatusMessage(syncStatus, config, authStatus),
    lastSyncAt: normalizeOptionalString(config?.lastSyncAt),
    inbox,
    inboxCounts: getInboxCounts(inbox),
    updatedAt: normalizeOptionalString(config?.updatedAt),
  };
}

function readWorkspaceConfig(workspaceRoot: string): SchedulerWorkspaceConfig {
  return readSchedulerConfig(workspaceRoot);
}

function getMergedConfig(
  existing: GitHubIntegrationConfig | undefined,
  input: SaveGitHubIntegrationInput,
): GitHubIntegrationConfig | undefined {
  const enabled = input.enabled === true;
  const owner = normalizeOptionalString(input.owner)
    ?? normalizeOptionalString(existing?.owner);
  const repo = normalizeOptionalString(input.repo)
    ?? normalizeOptionalString(existing?.repo);
  const apiBaseUrl = normalizeOptionalApiBaseUrl(input.apiBaseUrl)
    ?? normalizeOptionalApiBaseUrl(existing?.apiBaseUrl);
  const automationPromptTemplate = normalizeOptionalString(input.automationPromptTemplate)
    ?? normalizeOptionalString(existing?.automationPromptTemplate);

  if (!enabled && !owner && !repo && !apiBaseUrl && !automationPromptTemplate && !existing) {
    return undefined;
  }

  const repositoryChanged = didRepositoryIdentityChange(existing, {
    owner,
    repo,
    apiBaseUrl,
  });
  const preservedInbox = !repositoryChanged
    ? normalizeInboxSnapshot(existing?.inbox)
    : undefined;
  const preservedStatusMessage = !repositoryChanged
    ? normalizeOptionalString(existing?.statusMessage)
    : undefined;
  const preservedLastSyncAt = !repositoryChanged
    ? normalizeOptionalString(existing?.lastSyncAt)
    : undefined;
  const preservedSyncStatus = !repositoryChanged
    ? existing?.syncStatus
    : undefined;

  const draft: GitHubIntegrationConfig = {
    enabled,
    owner,
    repo,
    apiBaseUrl,
    automationPromptTemplate,
    syncStatus: "disabled",
    updatedAt: new Date().toISOString(),
  };

  if (enabled && hasRequiredRepositoryFields(draft) && preservedInbox) {
    draft.inbox = preservedInbox;
  }

  if (enabled && hasRequiredRepositoryFields(draft) && preservedSyncStatus && LIVE_GITHUB_SYNC_STATUSES.has(preservedSyncStatus)) {
    draft.syncStatus = preservedSyncStatus;
  } else {
    draft.syncStatus = deriveSyncStatus(draft);
  }

  draft.statusMessage = preservedStatusMessage;
  draft.lastSyncAt = preservedLastSyncAt;

  return draft;
}

export function getGitHubIntegrationView(
  workspaceRoot: string,
  authStatus?: GitHubAuthStatus,
): GitHubIntegrationView {
  const config = readWorkspaceConfig(workspaceRoot);
  return toView(config.githubIntegration, authStatus);
}

export function saveGitHubIntegrationConfig(
  workspaceRoot: string,
  input: SaveGitHubIntegrationInput,
  authStatus?: GitHubAuthStatus,
): GitHubIntegrationView {
  const config = readWorkspaceConfig(workspaceRoot);
  const nextGitHubConfig = getMergedConfig(config.githubIntegration, input);
  const nextConfig: SchedulerWorkspaceConfig = {
    ...config,
    tasks: Array.isArray(config.tasks) ? config.tasks : [],
    jobs: Array.isArray(config.jobs) ? config.jobs : [],
    jobFolders: Array.isArray(config.jobFolders) ? config.jobFolders : [],
    githubIntegration: nextGitHubConfig,
  };

  writeSchedulerConfig(workspaceRoot, nextConfig);
  return toView(nextGitHubConfig, authStatus);
}

type ResolveGitHubAuth = (config: Pick<GitHubIntegrationConfig, "apiBaseUrl">) => Promise<GitHubAuthSession>;

type GitHubInboxSyncClient = (config: {
  owner?: string;
  repo?: string;
  apiBaseUrl?: string;
  accessToken?: string;
}) => Promise<GitHubInboxSnapshot>;

export async function syncGitHubIntegrationInbox(
  workspaceRoot: string,
  options: {
    resolveAuth?: ResolveGitHubAuth;
    syncClient?: GitHubInboxSyncClient;
  } = {},
): Promise<GitHubIntegrationView> {
  const workspaceConfig = readWorkspaceConfig(workspaceRoot);
  const currentConfig = workspaceConfig.githubIntegration;
  if (!currentConfig) {
    return toView(currentConfig);
  }

  const authSession = options.resolveAuth
    ? await options.resolveAuth({ apiBaseUrl: currentConfig.apiBaseUrl })
    : undefined;

  if (!currentConfig.enabled || !hasRequiredRepositoryFields(currentConfig) || !authSession?.hasConnection || !normalizeOptionalString(authSession.accessToken)) {
    const fallbackStatus = deriveSyncStatus(currentConfig, authSession);
    const fallbackConfig: GitHubIntegrationConfig = {
      ...currentConfig,
      syncStatus: fallbackStatus,
      statusMessage: buildStatusMessage(fallbackStatus, currentConfig, authSession),
      updatedAt: new Date().toISOString(),
    };
    writeSchedulerConfig(workspaceRoot, {
      ...workspaceConfig,
      tasks: Array.isArray(workspaceConfig.tasks) ? workspaceConfig.tasks : [],
      jobs: Array.isArray(workspaceConfig.jobs) ? workspaceConfig.jobs : [],
      jobFolders: Array.isArray(workspaceConfig.jobFolders) ? workspaceConfig.jobFolders : [],
      githubIntegration: fallbackConfig,
    });
    return toView(fallbackConfig, authSession);
  }

  const syncClient = options.syncClient ?? fetchGitHubInboxSnapshot;
  const fetchedInbox = await syncClient({
    owner: currentConfig.owner,
    repo: currentConfig.repo,
    apiBaseUrl: currentConfig.apiBaseUrl,
    accessToken: authSession.accessToken,
  });
  const mergedInbox = mergeInboxCache(currentConfig.inbox, fetchedInbox);
  const syncResult = buildSyncStatusMessage(fetchedInbox);
  const nextConfig: GitHubIntegrationConfig = {
    ...currentConfig,
    inbox: mergedInbox,
    syncStatus: syncResult.syncStatus,
    statusMessage: syncResult.statusMessage,
    lastSyncAt: getLatestLaneSyncAt(mergedInbox) ?? normalizeOptionalString(currentConfig.lastSyncAt),
    updatedAt: new Date().toISOString(),
  };

  writeSchedulerConfig(workspaceRoot, {
    ...workspaceConfig,
    tasks: Array.isArray(workspaceConfig.tasks) ? workspaceConfig.tasks : [],
    jobs: Array.isArray(workspaceConfig.jobs) ? workspaceConfig.jobs : [],
    jobFolders: Array.isArray(workspaceConfig.jobFolders) ? workspaceConfig.jobFolders : [],
    githubIntegration: nextConfig,
  });
  return toView(nextConfig, authSession);
}