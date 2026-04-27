import * as https from "https";
import type { IncomingHttpHeaders } from "http";
import type {
  GitHubAuthSession,
  GitHubInboxItem,
  GitHubInboxLane,
  GitHubInboxSnapshot,
} from "./types";

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "source-scheduler-github-inbox";
const MAX_ITEMS_PER_LANE = 50;
const MAX_PAGES_PER_LANE = 2;

type GitHubResponse<T> = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  body: T;
};

type GitHubRequestError = Error & {
  statusCode?: number;
  rateLimited?: boolean;
};

type GitHubSyncConfig = Pick<
  GitHubAuthSession,
  "accessToken"
> & {
  owner?: string;
  repo?: string;
  apiBaseUrl?: string;
};

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function createEmptyLane(): GitHubInboxLane {
  return {
    items: [],
    itemCount: 0,
  };
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.replace(/\/+$/u, "") : DEFAULT_GITHUB_API_BASE_URL;
}

function trimSummary(value: unknown): string | undefined {
  const text = typeof value === "string"
    ? value.replace(/\r\n?/gu, "\n").trim()
    : "";
  if (!text) {
    return undefined;
  }

  const firstLine = text.split(/\n+/u, 1)[0]?.trim() ?? "";
  if (!firstLine) {
    return undefined;
  }

  return firstLine.length > 240
    ? `${firstLine.slice(0, 237).trimEnd()}...`
    : firstLine;
}

function normalizeState(value: unknown): string | undefined {
  return normalizeOptionalString(value)?.toLowerCase();
}

function normalizeSeverity(value: unknown): string | undefined {
  return normalizeOptionalString(value)?.toLowerCase();
}

function toNonEmptyStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeOptionalString(entry))
    .filter((entry): entry is string => !!entry);
}

function getNextPageUrl(linkHeader: string | string[] | undefined): string | undefined {
  const [rawHeader] = toNonEmptyStringArray(
    Array.isArray(linkHeader) ? linkHeader : [linkHeader],
  );
  if (!rawHeader) {
    return undefined;
  }

  const nextLink = rawHeader
    .split(",")
    .map((part) => part.trim())
    .find((part) => /rel="next"/u.test(part));
  if (!nextLink) {
    return undefined;
  }

  const match = nextLink.match(/<([^>]+)>/u);
  return match?.[1];
}

function getRateLimitErrorMessage(
  headers: IncomingHttpHeaders,
): string {
  const resetHeader = normalizeOptionalString(headers["x-ratelimit-reset"]);
  if (!resetHeader) {
    return "GitHub API rate limit exceeded.";
  }

  const resetTimestampMs = Number(resetHeader) * 1000;
  if (!Number.isFinite(resetTimestampMs)) {
    return "GitHub API rate limit exceeded.";
  }

  return `GitHub API rate limit exceeded until ${new Date(resetTimestampMs).toISOString()}.`;
}

function createGitHubRequestError(
  statusCode: number,
  headers: IncomingHttpHeaders,
  body: unknown,
): GitHubRequestError {
  const rateLimited = statusCode === 403
    && (
      normalizeOptionalString(headers["x-ratelimit-remaining"]) === "0"
      || normalizeOptionalString((body as { message?: unknown })?.message)
        ?.toLowerCase()
        .includes("rate limit") === true
    );
  const bodyMessage = normalizeOptionalString((body as { message?: unknown })?.message);
  const message = rateLimited
    ? getRateLimitErrorMessage(headers)
    : bodyMessage
      ? `GitHub request failed (${statusCode}): ${bodyMessage}`
      : `GitHub request failed with status ${statusCode}.`;

  const error = new Error(message) as GitHubRequestError;
  error.statusCode = statusCode;
  error.rateLimited = rateLimited;
  return error;
}

function requestJson<T>(
  requestUrl: URL,
  token: string,
): Promise<GitHubResponse<T>> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      requestUrl,
      {
        method: "GET",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": GITHUB_USER_AGENT,
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
        },
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8").trim();
          let parsedBody: unknown = null;

          if (rawBody) {
            try {
              parsedBody = JSON.parse(rawBody);
            } catch {
              parsedBody = { message: rawBody };
            }
          }

          const statusCode = response.statusCode ?? 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(createGitHubRequestError(statusCode, response.headers, parsedBody));
            return;
          }

          resolve({
            statusCode,
            headers: response.headers,
            body: parsedBody as T,
          });
        });

        response.on("error", reject);
      },
    );

    request.on("error", (error) => {
      reject(new Error(`GitHub request failed: ${error.message}`));
    });
    request.end();
  });
}

async function fetchPaginatedArray<T>(
  config: GitHubSyncConfig,
  relativePath: string,
): Promise<T[]> {
  const owner = normalizeOptionalString(config.owner);
  const repo = normalizeOptionalString(config.repo);
  const accessToken = normalizeOptionalString(config.accessToken);
  if (!owner || !repo || !accessToken) {
    return [];
  }

  const items: T[] = [];
  const baseUrl = `${normalizeApiBaseUrl(config.apiBaseUrl)}/`;
  let nextPageUrl: string | undefined = new URL(relativePath, baseUrl).toString();
  let pageCount = 0;

  while (nextPageUrl && pageCount < MAX_PAGES_PER_LANE && items.length < MAX_ITEMS_PER_LANE) {
    const response = await requestJson<T[]>(new URL(nextPageUrl), accessToken);
    if (Array.isArray(response.body)) {
      items.push(...response.body);
    }
    nextPageUrl = getNextPageUrl(response.headers.link);
    pageCount += 1;
  }

  return items.slice(0, MAX_ITEMS_PER_LANE);
}

function toIssueItem(value: Record<string, unknown>): GitHubInboxItem | undefined {
  if (value.pull_request && typeof value.pull_request === "object") {
    return undefined;
  }

  const number = typeof value.number === "number" && Number.isFinite(value.number)
    ? value.number
    : undefined;
  const title = normalizeOptionalString(value.title);
  const url = normalizeOptionalString(value.html_url);
  if (!title || !url) {
    return undefined;
  }

  return {
    id: `issue:${number ?? normalizeOptionalString(value.id) ?? title}`,
    lane: "issues",
    kind: "issue",
    number,
    title,
    summary: trimSummary(value.body),
    url,
    state: normalizeState(value.state),
    updatedAt: normalizeOptionalString(value.updated_at),
  };
}

function toPullRequestItem(value: Record<string, unknown>): GitHubInboxItem | undefined {
  const number = typeof value.number === "number" && Number.isFinite(value.number)
    ? value.number
    : undefined;
  const title = normalizeOptionalString(value.title);
  const url = normalizeOptionalString(value.html_url);
  if (!title || !url) {
    return undefined;
  }

  const draft = value.draft === true;
  const baseRef = normalizeOptionalString((value.base as { ref?: unknown } | undefined)?.ref);
  const headRef = normalizeOptionalString((value.head as { ref?: unknown } | undefined)?.ref);

  return {
    id: `pull-request:${number ?? normalizeOptionalString(value.id) ?? title}`,
    lane: "pullRequests",
    kind: "pullRequest",
    number,
    title,
    summary: trimSummary(value.body),
    url,
    state: draft ? "draft" : normalizeState(value.state),
    updatedAt: normalizeOptionalString(value.updated_at),
    baseRef,
    headRef,
  };
}

function toCodeScanningAlertItem(value: Record<string, unknown>): GitHubInboxItem | undefined {
  const number = typeof value.number === "number" && Number.isFinite(value.number)
    ? value.number
    : undefined;
  const rule = typeof value.rule === "object" && value.rule
    ? value.rule as Record<string, unknown>
    : undefined;
  const mostRecentInstance = typeof value.most_recent_instance === "object" && value.most_recent_instance
    ? value.most_recent_instance as Record<string, unknown>
    : undefined;
  const instanceMessage = typeof mostRecentInstance?.message === "object" && mostRecentInstance.message
    ? mostRecentInstance.message as Record<string, unknown>
    : undefined;
  const title = normalizeOptionalString(rule?.description)
    ?? normalizeOptionalString(rule?.name)
    ?? normalizeOptionalString(instanceMessage?.text);
  const url = normalizeOptionalString(value.html_url);
  if (!title || !url) {
    return undefined;
  }

  return {
    id: `code-scanning:${number ?? normalizeOptionalString(value.id) ?? title}`,
    lane: "securityAlerts",
    kind: "securityAlert",
    subtype: "code-scanning",
    number,
    title,
    summary: trimSummary(instanceMessage?.text) ?? trimSummary(rule?.description),
    url,
    state: normalizeState(value.state),
    severity: normalizeSeverity(rule?.severity) ?? normalizeSeverity(rule?.security_severity_level),
    updatedAt: normalizeOptionalString(value.updated_at),
  };
}

function toDependabotAlertItem(value: Record<string, unknown>): GitHubInboxItem | undefined {
  const number = typeof value.number === "number" && Number.isFinite(value.number)
    ? value.number
    : undefined;
  const securityVulnerability = typeof value.security_vulnerability === "object" && value.security_vulnerability
    ? value.security_vulnerability as Record<string, unknown>
    : undefined;
  const securityAdvisory = typeof value.security_advisory === "object" && value.security_advisory
    ? value.security_advisory as Record<string, unknown>
    : undefined;
  const dependency = typeof value.dependency === "object" && value.dependency
    ? value.dependency as Record<string, unknown>
    : undefined;
  const packageInfo = typeof dependency?.package === "object" && dependency.package
    ? dependency.package as Record<string, unknown>
    : undefined;
  const packageName = normalizeOptionalString(packageInfo?.name);
  const title = packageName
    ? `Dependabot: ${packageName}`
    : normalizeOptionalString(securityAdvisory?.summary)
      ?? normalizeOptionalString(securityVulnerability?.summary);
  const url = normalizeOptionalString(value.html_url);
  if (!title || !url) {
    return undefined;
  }

  return {
    id: `dependabot:${number ?? normalizeOptionalString(value.id) ?? title}`,
    lane: "securityAlerts",
    kind: "securityAlert",
    subtype: "dependabot",
    number,
    title,
    summary: trimSummary(securityVulnerability?.summary) ?? trimSummary(securityAdvisory?.summary),
    url,
    state: normalizeState(value.state),
    severity: normalizeSeverity(securityVulnerability?.severity),
    updatedAt: normalizeOptionalString(value.updated_at),
  };
}

function sortInboxItemsByUpdatedAt(items: GitHubInboxItem[]): GitHubInboxItem[] {
  return items.slice().sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt || "") || 0;
    const rightTime = Date.parse(right.updatedAt || "") || 0;
    return rightTime - leftTime;
  });
}

function buildErrorLane(error: unknown): GitHubInboxLane {
  const message = error instanceof Error ? error.message : String(error ?? "GitHub request failed.");
  return {
    items: [],
    itemCount: 0,
    error: message,
    rateLimited: error instanceof Error && (error as GitHubRequestError).rateLimited === true,
  };
}

async function fetchIssuesLane(config: GitHubSyncConfig): Promise<GitHubInboxLane> {
  try {
    const owner = encodeURIComponent(normalizeOptionalString(config.owner) ?? "");
    const repo = encodeURIComponent(normalizeOptionalString(config.repo) ?? "");
    const values = await fetchPaginatedArray<Record<string, unknown>>(
      config,
      `repos/${owner}/${repo}/issues?state=open&sort=updated&direction=desc&per_page=${MAX_ITEMS_PER_LANE}`,
    );
    const items = sortInboxItemsByUpdatedAt(
      values
        .map((value) => toIssueItem(value))
        .filter((value): value is GitHubInboxItem => !!value),
    ).slice(0, MAX_ITEMS_PER_LANE);
    return {
      items,
      itemCount: items.length,
      syncedAt: new Date().toISOString(),
    };
  } catch (error) {
    return buildErrorLane(error);
  }
}

async function fetchPullRequestsLane(config: GitHubSyncConfig): Promise<GitHubInboxLane> {
  try {
    const owner = encodeURIComponent(normalizeOptionalString(config.owner) ?? "");
    const repo = encodeURIComponent(normalizeOptionalString(config.repo) ?? "");
    const values = await fetchPaginatedArray<Record<string, unknown>>(
      config,
      `repos/${owner}/${repo}/pulls?state=open&sort=updated&direction=desc&per_page=${MAX_ITEMS_PER_LANE}`,
    );
    const items = sortInboxItemsByUpdatedAt(
      values
        .map((value) => toPullRequestItem(value))
        .filter((value): value is GitHubInboxItem => !!value),
    ).slice(0, MAX_ITEMS_PER_LANE);
    return {
      items,
      itemCount: items.length,
      syncedAt: new Date().toISOString(),
    };
  } catch (error) {
    return buildErrorLane(error);
  }
}

async function fetchSecurityAlertsLane(config: GitHubSyncConfig): Promise<GitHubInboxLane> {
  const owner = encodeURIComponent(normalizeOptionalString(config.owner) ?? "");
  const repo = encodeURIComponent(normalizeOptionalString(config.repo) ?? "");
  const [codeScanningResult, dependabotResult] = await Promise.allSettled([
    fetchPaginatedArray<Record<string, unknown>>(
      config,
      `repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=${MAX_ITEMS_PER_LANE}`,
    ),
    fetchPaginatedArray<Record<string, unknown>>(
      config,
      `repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=${MAX_ITEMS_PER_LANE}`,
    ),
  ]);

  const items = sortInboxItemsByUpdatedAt([
    ...(codeScanningResult.status === "fulfilled"
      ? codeScanningResult.value
        .map((value) => toCodeScanningAlertItem(value))
        .filter((value): value is GitHubInboxItem => !!value)
      : []),
    ...(dependabotResult.status === "fulfilled"
      ? dependabotResult.value
        .map((value) => toDependabotAlertItem(value))
        .filter((value): value is GitHubInboxItem => !!value)
      : []),
  ]).slice(0, MAX_ITEMS_PER_LANE);

  const errors = [
    codeScanningResult.status === "rejected"
      ? `Code scanning alerts: ${codeScanningResult.reason instanceof Error ? codeScanningResult.reason.message : String(codeScanningResult.reason ?? "GitHub request failed.")}`
      : undefined,
    dependabotResult.status === "rejected"
      ? `Dependabot alerts: ${dependabotResult.reason instanceof Error ? dependabotResult.reason.message : String(dependabotResult.reason ?? "GitHub request failed.")}`
      : undefined,
  ].filter((value): value is string => !!value);

  if (errors.length > 0 && items.length === 0) {
    return {
      ...createEmptyLane(),
      error: errors.join(" "),
      rateLimited: [codeScanningResult, dependabotResult].some((result) =>
        result.status === "rejected"
        && result.reason instanceof Error
        && (result.reason as GitHubRequestError).rateLimited === true,
      ),
    };
  }

  return {
    items,
    itemCount: items.length,
    syncedAt: items.length > 0 || errors.length === 0
      ? new Date().toISOString()
      : undefined,
    error: errors.length > 0 ? errors.join(" ") : undefined,
    rateLimited: errors.length > 0
      ? [codeScanningResult, dependabotResult].some((result) =>
        result.status === "rejected"
        && result.reason instanceof Error
        && (result.reason as GitHubRequestError).rateLimited === true,
      )
      : undefined,
  };
}

export function createEmptyGitHubInboxSnapshot(): GitHubInboxSnapshot {
  return {
    issues: createEmptyLane(),
    pullRequests: createEmptyLane(),
    securityAlerts: createEmptyLane(),
  };
}

export async function fetchGitHubInboxSnapshot(
  config: GitHubSyncConfig,
): Promise<GitHubInboxSnapshot> {
  const [issues, pullRequests, securityAlerts] = await Promise.all([
    fetchIssuesLane(config),
    fetchPullRequestsLane(config),
    fetchSecurityAlertsLane(config),
  ]);

  return {
    issues,
    pullRequests,
    securityAlerts,
  };
}