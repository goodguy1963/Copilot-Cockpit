import * as vscode from "vscode";
import type { GitHubAuthSession } from "./types";

const DEFAULT_GITHUB_API_BASE_URL = "https://api.github.com";
const GITHUB_AUTH_PROVIDER_ID = "github";
const GITHUB_ENTERPRISE_AUTH_PROVIDER_ID = "github-enterprise";
const GITHUB_AUTH_SCOPES = ["repo"];
const GITHUB_ENTERPRISE_CONFIGURATION_SECTION = "github-enterprise";
const GITHUB_ENTERPRISE_URI_SETTING_KEY = "uri";

type GitHubAuthProviderId = typeof GITHUB_AUTH_PROVIDER_ID | typeof GITHUB_ENTERPRISE_AUTH_PROVIDER_ID;

type GitHubAuthResolverOptions = {
  apiBaseUrl?: string;
  configurationScope?: vscode.ConfigurationScope;
  configurationTarget?: vscode.ConfigurationTarget;
};

type GitHubAuthResolverDependencies = {
  authentication: Pick<typeof vscode.authentication, "getSession">;
  workspace: Pick<typeof vscode.workspace, "getConfiguration" | "workspaceFolders">;
};

export type GitHubAuthProviderSelection = {
  apiBaseUrl?: string;
  providerId: GitHubAuthProviderId;
  enterpriseUri?: string;
};

function normalizeOptionalString(value: unknown): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? trimmed : undefined;
}

function normalizeApiBaseUrl(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);
  return normalized ? normalized.replace(/\/+$/u, "") : undefined;
}

function trimPathSegments(value: string): string[] {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => !!segment);
}

function buildUrlFromParts(origin: string, segments: string[]): string {
  return segments.length > 0 ? `${origin}/${segments.join("/")}` : origin;
}

export function deriveGitHubEnterpriseServerUri(apiBaseUrl: string | undefined): string | undefined {
  const normalizedApiBaseUrl = normalizeApiBaseUrl(apiBaseUrl);
  if (!normalizedApiBaseUrl || normalizedApiBaseUrl === DEFAULT_GITHUB_API_BASE_URL) {
    return undefined;
  }

  try {
    const parsedUrl = new URL(normalizedApiBaseUrl);
    const pathSegments = trimPathSegments(parsedUrl.pathname);
    const trimmedSegments = [...pathSegments];

    if (
      trimmedSegments.length >= 2
      && trimmedSegments[trimmedSegments.length - 2]?.toLowerCase() === "api"
      && trimmedSegments[trimmedSegments.length - 1]?.toLowerCase() === "v3"
    ) {
      trimmedSegments.splice(trimmedSegments.length - 2, 2);
    }

    const hostname = parsedUrl.hostname.toLowerCase().startsWith("api.")
      ? parsedUrl.hostname.slice(4)
      : parsedUrl.hostname;

    return buildUrlFromParts(`${parsedUrl.protocol}//${hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ""}`, trimmedSegments);
  } catch {
    return undefined;
  }
}

export function selectGitHubAuthProvider(
  options: Pick<GitHubAuthResolverOptions, "apiBaseUrl"> = {},
): GitHubAuthProviderSelection {
  const apiBaseUrl = normalizeApiBaseUrl(options.apiBaseUrl);
  if (!apiBaseUrl || apiBaseUrl === DEFAULT_GITHUB_API_BASE_URL) {
    return {
      apiBaseUrl,
      providerId: GITHUB_AUTH_PROVIDER_ID,
    };
  }

  return {
    apiBaseUrl,
    providerId: GITHUB_ENTERPRISE_AUTH_PROVIDER_ID,
    enterpriseUri: deriveGitHubEnterpriseServerUri(apiBaseUrl),
  };
}

function buildProviderDisplayName(providerId: GitHubAuthProviderId): string {
  return providerId === GITHUB_ENTERPRISE_AUTH_PROVIDER_ID
    ? "GitHub Enterprise"
    : "GitHub";
}

function buildProviderScopeText(selection: GitHubAuthProviderSelection): string {
  if (selection.providerId !== GITHUB_ENTERPRISE_AUTH_PROVIDER_ID || !selection.enterpriseUri) {
    return "";
  }

  return ` for ${selection.enterpriseUri}`;
}

function buildMissingConnectionMessage(selection: GitHubAuthProviderSelection): string {
  const providerDisplayName = buildProviderDisplayName(selection.providerId);
  return `No VS Code ${providerDisplayName} connection is available${buildProviderScopeText(selection)}. Sign in with the built-in ${providerDisplayName} authentication provider to enable refresh.`;
}

function buildConnectedMessage(
  selection: GitHubAuthProviderSelection,
  accountLabel: string | undefined,
): string {
  const providerDisplayName = buildProviderDisplayName(selection.providerId);
  const scopeText = buildProviderScopeText(selection);
  if (!accountLabel) {
    return `Connected via VS Code ${providerDisplayName} authentication${scopeText}.`;
  }

  return `Connected via VS Code ${providerDisplayName} authentication as ${accountLabel}${scopeText}.`;
}

function buildAccessErrorMessage(
  selection: GitHubAuthProviderSelection,
  error: unknown,
): string {
  const providerDisplayName = buildProviderDisplayName(selection.providerId);
  const scopeText = buildProviderScopeText(selection);
  const detail = error instanceof Error && error.message
    ? ` ${error.message}`
    : "";
  return `Unable to access VS Code ${providerDisplayName} authentication${scopeText}.${detail}`;
}

function getConfigurationScope(
  options: GitHubAuthResolverOptions,
  dependencies: GitHubAuthResolverDependencies,
): vscode.ConfigurationScope | undefined {
  if (options.configurationScope) {
    return options.configurationScope;
  }

  return dependencies.workspace.workspaceFolders?.[0]?.uri;
}

function getConfigurationTarget(
  options: GitHubAuthResolverOptions,
  configurationScope: vscode.ConfigurationScope | undefined,
): vscode.ConfigurationTarget {
  if (options.configurationTarget !== undefined) {
    return options.configurationTarget;
  }

  if (configurationScope) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }

  return vscode.ConfigurationTarget.Global;
}

async function syncGitHubEnterpriseUriSetting(
  selection: GitHubAuthProviderSelection,
  options: GitHubAuthResolverOptions,
  dependencies: GitHubAuthResolverDependencies,
): Promise<void> {
  if (selection.providerId !== GITHUB_ENTERPRISE_AUTH_PROVIDER_ID || !selection.enterpriseUri) {
    return;
  }

  const configurationScope = getConfigurationScope(options, dependencies);
  const configurationTarget = getConfigurationTarget(options, configurationScope);
  const configuration = dependencies.workspace.getConfiguration(
    GITHUB_ENTERPRISE_CONFIGURATION_SECTION,
    configurationScope,
  );
  const currentUri = normalizeOptionalString(
    configuration.get<string>(GITHUB_ENTERPRISE_URI_SETTING_KEY),
  );
  if (currentUri === selection.enterpriseUri) {
    return;
  }

  await configuration.update(
    GITHUB_ENTERPRISE_URI_SETTING_KEY,
    selection.enterpriseUri,
    configurationTarget,
  );
}

export async function resolveGitHubAuthentication(
  options: GitHubAuthResolverOptions = {},
  dependencies: GitHubAuthResolverDependencies = {
    authentication: vscode.authentication,
    workspace: vscode.workspace,
  },
): Promise<GitHubAuthSession> {
  const selection = selectGitHubAuthProvider(options);
  if (
    selection.providerId === GITHUB_ENTERPRISE_AUTH_PROVIDER_ID
    && !selection.enterpriseUri
  ) {
    return {
      hasConnection: false,
      authStatusText: "The configured GitHub Enterprise API base URL could not be mapped to a VS Code GitHub Enterprise server URI.",
    };
  }

  try {
    await syncGitHubEnterpriseUriSetting(selection, options, dependencies);

    const session = await dependencies.authentication.getSession(
      selection.providerId,
      GITHUB_AUTH_SCOPES,
      {
        createIfNone: false,
        silent: true,
      },
    );
    const accessToken = normalizeOptionalString(session?.accessToken);
    if (!accessToken) {
      return {
        hasConnection: false,
        authStatusText: buildMissingConnectionMessage(selection),
      };
    }

    const accountLabel = normalizeOptionalString(session?.account?.label);
    return {
      hasConnection: true,
      authStatusText: buildConnectedMessage(selection, accountLabel),
      accessToken,
    };
  } catch (error) {
    return {
      hasConnection: false,
      authStatusText: buildAccessErrorMessage(selection, error),
    };
  }
}