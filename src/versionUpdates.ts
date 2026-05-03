import { fetchLatestReleaseInfo, type GitHubReleaseInfo } from "./githubReleases";
import type { VersionUpdateView } from "./types";

function parseComparableVersion(version: string): {
  numericParts: number[];
  prerelease: string[];
} | null {
  const normalized = typeof version === "string" ? version.trim().replace(/^v/u, "") : "";
  if (!normalized) {
    return null;
  }

  const match = normalized.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/u);
  if (!match) {
    return null;
  }

  return {
    numericParts: match[1].split(".").map((value) => Number.parseInt(value, 10)),
    prerelease: match[2] ? match[2].split(".") : [],
  };
}

function comparePrereleaseIdentifiers(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined) {
      return -1;
    }
    if (rightValue === undefined) {
      return 1;
    }

    const leftNumber = /^\d+$/u.test(leftValue) ? Number.parseInt(leftValue, 10) : null;
    const rightNumber = /^\d+$/u.test(rightValue) ? Number.parseInt(rightValue, 10) : null;
    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber !== rightNumber) {
        return leftNumber - rightNumber;
      }
      continue;
    }
    if (leftNumber !== null) {
      return -1;
    }
    if (rightNumber !== null) {
      return 1;
    }

    const comparison = leftValue.localeCompare(rightValue);
    if (comparison !== 0) {
      return comparison;
    }
  }

  return 0;
}

export function compareReleaseVersions(left: string, right: string): number {
  const leftParsed = parseComparableVersion(left);
  const rightParsed = parseComparableVersion(right);
  if (!leftParsed || !rightParsed) {
    return left.localeCompare(right);
  }

  const maxLength = Math.max(leftParsed.numericParts.length, rightParsed.numericParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParsed.numericParts[index] ?? 0;
    const rightValue = rightParsed.numericParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return comparePrereleaseIdentifiers(leftParsed.prerelease, rightParsed.prerelease);
}

export function isVersionNewer(candidateVersion: string, currentVersion: string): boolean {
  if (!candidateVersion || !currentVersion) {
    return false;
  }

  return compareReleaseVersions(candidateVersion, currentVersion) > 0;
}

export function buildVersionUpdateView(options: {
  currentVersion: string;
  stable: GitHubReleaseInfo | null;
  edge: GitHubReleaseInfo | null;
  track: VersionUpdateView["track"];
  checkedAt?: string;
}): VersionUpdateView {
  const checkedAt = options.checkedAt ?? new Date().toISOString();
  const latestStableVersion = options.stable?.version?.replace(/^v/u, "") ?? "";
  const latestEdgeVersion = options.edge?.version?.replace(/^v/u, "") ?? "";
  const stableHasNewVersion = isVersionNewer(latestStableVersion, options.currentVersion);
  const edgeHasNewVersion = isVersionNewer(latestEdgeVersion, options.currentVersion);
  const currentVersionIsLocalAhead = Boolean(options.currentVersion)
    && (!latestStableVersion || compareReleaseVersions(options.currentVersion, latestStableVersion) > 0)
    && (!latestEdgeVersion || compareReleaseVersions(options.currentVersion, latestEdgeVersion) > 0);

  return {
    currentVersion: options.currentVersion,
    latestStableVersion,
    latestStablePublishedAt: options.stable?.publishedAt ?? "",
    latestStableDisplayDate: options.stable?.displayDate ?? options.stable?.publishedAt ?? "",
    latestEdgeVersion,
    latestEdgePublishedAt: options.edge?.publishedAt ?? "",
    latestEdgeDisplayDate: options.edge?.displayDate ?? options.edge?.publishedAt ?? "",
    lastCheckedAt: checkedAt,
    track: options.track,
    stableDownloadUrl: options.stable?.htmlUrl ?? "",
    edgeDownloadUrl: options.edge?.htmlUrl ?? "",
    stableHasNewVersion,
    edgeHasNewVersion,
    hasNewVersion: options.track === "edge" ? edgeHasNewVersion : stableHasNewVersion,
    currentVersionIsLocalAhead,
    currentVersionLocalDate: currentVersionIsLocalAhead ? checkedAt : "",
  };
}

export async function fetchVersionUpdateView(
  context: { extension: { packageJSON?: { version?: string; repository?: { url?: unknown } } } },
  track: VersionUpdateView["track"],
): Promise<VersionUpdateView> {
  const [stable, edge] = await Promise.all([
    fetchLatestReleaseInfo(context, "stable"),
    fetchLatestReleaseInfo(context, "edge"),
  ]);

  return buildVersionUpdateView({
    currentVersion: context.extension.packageJSON?.version ?? "",
    stable,
    edge,
    track,
  });
}

export function buildVersionUpdateNotificationKey(
  versionUpdate: VersionUpdateView,
): string | null {
  const targetVersion = versionUpdate.track === "edge"
    ? versionUpdate.latestEdgeVersion
    : versionUpdate.latestStableVersion;
  const targetDate = versionUpdate.track === "edge"
    ? versionUpdate.latestEdgePublishedAt || versionUpdate.latestEdgeDisplayDate
    : versionUpdate.latestStablePublishedAt || versionUpdate.latestStableDisplayDate;
  const targetUrl = versionUpdate.track === "edge"
    ? versionUpdate.edgeDownloadUrl
    : versionUpdate.stableDownloadUrl;

  if (!targetVersion) {
    return null;
  }

  return [versionUpdate.track, targetVersion, targetDate || targetUrl || "unknown"].join(":");
}

export function getVersionUpdateNotificationTarget(
  versionUpdate: VersionUpdateView,
): { version: string; url: string } {
  if (versionUpdate.track === "edge") {
    return {
      version: versionUpdate.latestEdgeVersion,
      url: versionUpdate.edgeDownloadUrl,
    };
  }

  return {
    version: versionUpdate.latestStableVersion,
    url: versionUpdate.stableDownloadUrl,
  };
}