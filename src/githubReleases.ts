import * as https from "https";
import { logError } from "./logger";

const GITHUB_API_VERSION = "2022-11-28";
const GITHUB_USER_AGENT = "source-scheduler-github-releases";

type RequestJsonFn = <T>(requestUrl: URL, token?: string) => Promise<T>;

export interface GitHubReleaseInfo {
  tagName: string;
  version: string;
  htmlUrl: string;
  isDraft: boolean;
  isPrerelease: boolean;
  publishedAt: string;
  updatedAt: string;
  displayDate: string;
}

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function parseRepoFromPackageJson(
  packageJson: { repository?: { url?: unknown } | undefined },
): { owner: string; repo: string } | null {
  const repoUrl = normalizeOptionalString(packageJson.repository?.url);
  if (!repoUrl) {
    return null;
  }
  // Handle git+https://github.com/owner/repo.git or https://github.com/owner/repo
  const match = repoUrl.match(/github\.com[/:]([^/]+)\/([^/.]+)/u);
  if (!match) {
    return null;
  }
  return { owner: match[1], repo: match[2].replace(/\.git$/u, "") };
}

export function buildGitHubRequestHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": GITHUB_USER_AGENT,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
  };
  const normalizedToken = normalizeOptionalString(token);
  if (normalizedToken) {
    headers.Authorization = `Bearer ${normalizedToken}`;
  }
  return headers;
}

function requestJson<T>(requestUrl: URL, token?: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      requestUrl,
      {
        method: "GET",
        headers: buildGitHubRequestHeaders(token),
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
            const bodyMessage = normalizeOptionalString(
              (parsedBody as { message?: unknown })?.message,
            );
            reject(
              new Error(
                bodyMessage
                  ? `GitHub request failed (${statusCode}): ${bodyMessage}`
                  : `GitHub request failed with status ${statusCode}.`,
              ),
            );
            return;
          }

          resolve(parsedBody as T);
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

interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string;
  updated_at?: string;
}

function toReleaseInfo(
  release: GitHubRelease | undefined,
  track: "stable" | "edge",
): GitHubReleaseInfo | null {
  if (!release) {
    return null;
  }

  const publishedAt = normalizeOptionalString(release.published_at) ?? "";
  const updatedAt = normalizeOptionalString(release.updated_at) ?? "";
  const displayDate = track === "edge"
    ? updatedAt || publishedAt
    : publishedAt || updatedAt;

  return {
    tagName: normalizeOptionalString(release.tag_name) ?? "",
    version: normalizeOptionalString(release.tag_name)?.replace(/^v/u, "") ?? "",
    htmlUrl: normalizeOptionalString(release.html_url) ?? "",
    isDraft: Boolean(release.draft),
    isPrerelease: Boolean(release.prerelease),
    publishedAt,
    updatedAt,
    displayDate,
  };
}

type FetchLatestReleaseInfoDeps = {
  requestJson?: RequestJsonFn;
};

/**
 * Fetches the latest stable release info from GitHub.
 * Returns null on error (network, rate limit, etc.)
 */
export async function fetchLatestReleaseInfo(
  context: { extension: { packageJSON?: { version?: string; repository?: { url?: unknown } } } },
  track: "stable" | "edge",
  deps: FetchLatestReleaseInfoDeps = {},
): Promise<GitHubReleaseInfo | null> {
  const repo = parseRepoFromPackageJson(context.extension.packageJSON ?? {});
  if (!repo) {
    logError("[GitHubReleases] Could not parse repo from package.json repository URL.");
    return null;
  }

  const { owner, repo: repoName } = repo;
  const token = ""; // Public API, no token required
  const requestJsonImpl = deps.requestJson ?? requestJson;

  try {
    if (track === "stable") {
      const url = new URL(
        `https://api.github.com/repos/${owner}/${repoName}/releases/latest`,
      );
      const release = await requestJsonImpl<GitHubRelease>(url, token);
      return toReleaseInfo(release, "stable");
    }

    try {
      const edgeUrl = new URL(
        `https://api.github.com/repos/${owner}/${repoName}/releases/tags/edge`,
      );
      const edgeRelease = await requestJsonImpl<GitHubRelease>(edgeUrl, token);
      const edgeReleaseInfo = toReleaseInfo(edgeRelease, "edge");
      if (edgeReleaseInfo) {
        return edgeReleaseInfo;
      }
    } catch {
      // Fallback below retains compatibility if the dedicated rolling edge release is absent.
    }

    const url = new URL(
      `https://api.github.com/repos/${owner}/${repoName}/releases?per_page=30`,
    );
    const releases = await requestJsonImpl<GitHubRelease[]>(url, token);
    return toReleaseInfo(releases.find((r) => r.prerelease) ?? releases[0], "edge");
  } catch (error) {
    logError("[GitHubReleases] Failed to fetch release info:", error);
    return null;
  }
}
