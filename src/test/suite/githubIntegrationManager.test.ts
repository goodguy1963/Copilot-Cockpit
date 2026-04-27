import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  getPrivateSchedulerConfigPath,
} from "../../cockpitJsonSanitizer";
import {
  getGitHubIntegrationView,
  saveGitHubIntegrationConfig,
  syncGitHubIntegrationInbox,
} from "../../githubIntegrationManager";
import { createEmptyGitHubInboxSnapshot } from "../../githubRestClient";

function createWorkspaceRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "copilot-cockpit-github-"));
}

function cleanupWorkspace(root: string): void {
  try {
    const cleanupOptions: fs.RmOptions = {};
    cleanupOptions.recursive = true;
    cleanupOptions.force = true;
    cleanupOptions.maxRetries = 3;
    cleanupOptions.retryDelay = 50;
    fs.rmSync(root, cleanupOptions);
  } catch {
    // Temp cleanup only.
  }
}

suite("GitHub integration manager behavior", () => {
  test("saves repository settings without persisting a PAT and reports auth-backed readiness", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const savedView = saveGitHubIntegrationConfig(workspaceRoot, {
        enabled: true,
        owner: "octocat",
        repo: "hello-world",
        apiBaseUrl: "https://api.github.com/",
        token: "github_pat_1234567890abcdefghijklmnopqrstuvwxyz",
        automationPromptTemplate: "Summarize {{github_item}}",
      }, {
        hasConnection: true,
        authStatusText: "Connected via VS Code GitHub authentication.",
      });

      assert.strictEqual(savedView.enabled, true);
      assert.strictEqual(savedView.owner, "octocat");
      assert.strictEqual(savedView.repo, "hello-world");
      assert.strictEqual(savedView.apiBaseUrl, "https://api.github.com");
      assert.strictEqual(savedView.automationPromptTemplate, "Summarize {{github_item}}");
      assert.strictEqual(savedView.hasConnection, true);
      assert.strictEqual(savedView.syncStatus, "ready");

      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const privateConfigPath = getPrivateSchedulerConfigPath(publicConfigPath);

      assert.ok(fs.existsSync(publicConfigPath));

      const publicContent = fs.readFileSync(publicConfigPath, "utf8");
      const privateContent = fs.existsSync(privateConfigPath)
        ? fs.readFileSync(privateConfigPath, "utf8")
        : "";
      assert.ok(!publicContent.includes("github_pat_1234567890abcdefghijklmnopqrstuvwxyz"));
      assert.ok(!privateContent.includes("github_pat_1234567890abcdefghijklmnopqrstuvwxyz"));

      const reloadedView = getGitHubIntegrationView(workspaceRoot, {
        hasConnection: true,
        authStatusText: "Connected via VS Code GitHub authentication.",
      });
      assert.strictEqual(reloadedView.enabled, true);
      assert.strictEqual(reloadedView.hasConnection, true);
      assert.strictEqual(reloadedView.syncStatus, "ready");
      assert.strictEqual(reloadedView.owner, "octocat");
      assert.strictEqual(reloadedView.repo, "hello-world");
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });

  test("drops a legacy stored token on later saves", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      fs.mkdirSync(path.dirname(publicConfigPath), { recursive: true });
      fs.writeFileSync(publicConfigPath, JSON.stringify({
        version: 1,
        tasks: [],
        jobs: [],
        jobFolders: [],
        githubIntegration: {
          enabled: true,
          owner: "octocat",
          repo: "hello-world",
          token: "legacy_pat_should_be_removed",
          updatedAt: "2026-04-27T09:00:00.000Z",
        },
      }, null, 2));

      saveGitHubIntegrationConfig(workspaceRoot, {
        enabled: true,
        automationPromptTemplate: "Summarize {{github_item}}",
      });

      const savedContent = fs.readFileSync(publicConfigPath, "utf8");
      assert.ok(!savedContent.includes("legacy_pat_should_be_removed"));

      const savedConfig = JSON.parse(savedContent) as {
        githubIntegration?: {
          token?: string;
          owner?: string;
          repo?: string;
          automationPromptTemplate?: string;
        };
      };
      assert.strictEqual(savedConfig.githubIntegration?.token, undefined);
      assert.strictEqual(savedConfig.githubIntegration?.owner, "octocat");
      assert.strictEqual(savedConfig.githubIntegration?.repo, "hello-world");
      assert.strictEqual(savedConfig.githubIntegration?.automationPromptTemplate, "Summarize {{github_item}}");
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });

  test("keeps incomplete enabled settings and reports a partial status", () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      const savedView = saveGitHubIntegrationConfig(workspaceRoot, {
        enabled: true,
        owner: "octocat",
      }, {
        hasConnection: false,
        authStatusText: "No VS Code GitHub connection is available.",
      });

      assert.strictEqual(savedView.enabled, true);
      assert.strictEqual(savedView.owner, "octocat");
      assert.strictEqual(savedView.repo, undefined);
      assert.strictEqual(savedView.hasConnection, false);
      assert.strictEqual(savedView.syncStatus, "partial");

      const reloadedView = getGitHubIntegrationView(workspaceRoot, {
        hasConnection: false,
        authStatusText: "No VS Code GitHub connection is available.",
      });
      assert.strictEqual(reloadedView.syncStatus, "partial");
      assert.strictEqual(reloadedView.statusMessage, "Add the repository owner and repository name to finish setup.");
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });

  test("syncs and persists safe cached inbox data using a runtime access token", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      saveGitHubIntegrationConfig(workspaceRoot, {
        enabled: true,
        owner: "octocat",
        repo: "hello-world",
      });

      const syncedView = await syncGitHubIntegrationInbox(workspaceRoot, {
        resolveAuth: async () => ({
          hasConnection: true,
          authStatusText: "Connected via VS Code GitHub authentication.",
          accessToken: "runtime-access-token",
        }),
        syncClient: async (config) => {
          assert.strictEqual(config.accessToken, "runtime-access-token");
          return {
          issues: {
            items: [
              {
                id: "issue:42",
                lane: "issues",
                kind: "issue",
                number: 42,
                title: "Bug in sync",
                summary: "Investigate cached inbox handling.",
                url: "https://github.com/octocat/hello-world/issues/42",
                state: "open",
                updatedAt: "2026-04-27T10:00:00.000Z",
              },
            ],
            itemCount: 1,
            syncedAt: "2026-04-27T10:00:00.000Z",
          },
          pullRequests: {
            items: [
              {
                id: "pull-request:7",
                lane: "pullRequests",
                kind: "pullRequest",
                number: 7,
                title: "Tighten inbox rendering",
                summary: "Adds compact GitHub inbox rendering.",
                url: "https://github.com/octocat/hello-world/pull/7",
                state: "open",
                updatedAt: "2026-04-27T11:00:00.000Z",
                baseRef: "main",
                headRef: "feature/github-inbox",
              },
            ],
            itemCount: 1,
            syncedAt: "2026-04-27T11:00:00.000Z",
          },
          securityAlerts: {
            items: [
              {
                id: "dependabot:9",
                lane: "securityAlerts",
                kind: "securityAlert",
                subtype: "dependabot",
                number: 9,
                title: "Dependabot: axios",
                summary: "Moderate severity vulnerability",
                url: "https://github.com/octocat/hello-world/security/dependabot/9",
                state: "open",
                severity: "moderate",
                updatedAt: "2026-04-27T12:00:00.000Z",
              },
            ],
            itemCount: 1,
            syncedAt: "2026-04-27T12:00:00.000Z",
          },
          };
        },
      });

      assert.strictEqual(syncedView.syncStatus, "ready");
      assert.strictEqual(syncedView.inboxCounts.total, 3);
      assert.strictEqual(syncedView.inbox.issues.itemCount, 1);
      assert.strictEqual(syncedView.inbox.pullRequests.itemCount, 1);
      assert.strictEqual(syncedView.inbox.securityAlerts.itemCount, 1);
      assert.strictEqual(syncedView.lastSyncAt, "2026-04-27T12:00:00.000Z");

      const publicConfigPath = path.join(workspaceRoot, ".vscode", "scheduler.json");
      const publicContent = fs.readFileSync(publicConfigPath, "utf8");
      assert.ok(publicContent.includes("\"inbox\""));
      assert.ok(!publicContent.includes("github_pat_1234567890abcdefghijklmnopqrstuvwxyz"));

      const reloadedView = getGitHubIntegrationView(workspaceRoot, {
        hasConnection: true,
        authStatusText: "Connected via VS Code GitHub authentication.",
      });
      assert.strictEqual(reloadedView.inboxCounts.total, 3);
      assert.strictEqual(reloadedView.inbox.pullRequests.items[0]?.headRef, "feature/github-inbox");
      assert.strictEqual(reloadedView.inbox.securityAlerts.items[0]?.subtype, "dependabot");
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });

  test("syncs a GitHub Enterprise inbox using a runtime enterprise auth session", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      saveGitHubIntegrationConfig(workspaceRoot, {
        enabled: true,
        owner: "octocat",
        repo: "hello-world",
        apiBaseUrl: "https://github.example.com/api/v3/",
      });

      const syncedView = await syncGitHubIntegrationInbox(workspaceRoot, {
        resolveAuth: async ({ apiBaseUrl }) => {
          assert.strictEqual(apiBaseUrl, "https://github.example.com/api/v3");
          return {
            hasConnection: true,
            authStatusText: "Connected via VS Code GitHub Enterprise authentication as octocat for https://github.example.com.",
            accessToken: "enterprise-runtime-token",
          };
        },
        syncClient: async (config) => {
          assert.strictEqual(config.apiBaseUrl, "https://github.example.com/api/v3");
          assert.strictEqual(config.accessToken, "enterprise-runtime-token");
          return createEmptyGitHubInboxSnapshot();
        },
      });

      assert.strictEqual(syncedView.hasConnection, true);
      assert.strictEqual(syncedView.apiBaseUrl, "https://github.example.com/api/v3");
      assert.strictEqual(syncedView.syncStatus, "ready");
      assert.strictEqual(
        syncedView.authStatusText,
        "Connected via VS Code GitHub Enterprise authentication as octocat for https://github.example.com.",
      );
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });

  test("preserves cached successful lanes when a later sync partially fails", async () => {
    const workspaceRoot = createWorkspaceRoot();

    try {
      saveGitHubIntegrationConfig(workspaceRoot, {
        enabled: true,
        owner: "octocat",
        repo: "hello-world",
      });

      await syncGitHubIntegrationInbox(workspaceRoot, {
        resolveAuth: async () => ({
          hasConnection: true,
          authStatusText: "Connected via VS Code GitHub authentication.",
          accessToken: "runtime-access-token",
        }),
        syncClient: async () => ({
          issues: {
            items: [
              {
                id: "issue:1",
                lane: "issues",
                kind: "issue",
                number: 1,
                title: "Existing issue",
                url: "https://github.com/octocat/hello-world/issues/1",
                updatedAt: "2026-04-27T09:00:00.000Z",
              },
            ],
            itemCount: 1,
            syncedAt: "2026-04-27T09:00:00.000Z",
          },
          pullRequests: {
            items: [
              {
                id: "pull-request:2",
                lane: "pullRequests",
                kind: "pullRequest",
                number: 2,
                title: "Existing PR",
                url: "https://github.com/octocat/hello-world/pull/2",
                updatedAt: "2026-04-27T09:10:00.000Z",
              },
            ],
            itemCount: 1,
            syncedAt: "2026-04-27T09:10:00.000Z",
          },
          securityAlerts: {
            items: [],
            itemCount: 0,
            syncedAt: "2026-04-27T09:20:00.000Z",
          },
        }),
      });

      const syncedView = await syncGitHubIntegrationInbox(workspaceRoot, {
        resolveAuth: async () => ({
          hasConnection: true,
          authStatusText: "Connected via VS Code GitHub authentication.",
          accessToken: "runtime-access-token",
        }),
        syncClient: async () => ({
          issues: {
            items: [],
            itemCount: 0,
            error: "Issues: upstream request failed.",
          },
          pullRequests: {
            items: [
              {
                id: "pull-request:3",
                lane: "pullRequests",
                kind: "pullRequest",
                number: 3,
                title: "Updated PR",
                url: "https://github.com/octocat/hello-world/pull/3",
                updatedAt: "2026-04-27T10:00:00.000Z",
              },
            ],
            itemCount: 1,
            syncedAt: "2026-04-27T10:00:00.000Z",
          },
          securityAlerts: {
            items: [],
            itemCount: 0,
            error: "Security Alerts: GitHub API rate limit exceeded.",
            rateLimited: true,
          },
        }),
      });

      assert.strictEqual(syncedView.syncStatus, "rate-limited");
      assert.strictEqual(syncedView.inbox.issues.itemCount, 1);
      assert.strictEqual(syncedView.inbox.issues.items[0]?.id, "issue:1");
      assert.strictEqual(syncedView.inbox.pullRequests.items[0]?.id, "pull-request:3");
      assert.strictEqual(syncedView.inbox.securityAlerts.itemCount, 0);
      assert.ok(String(syncedView.statusMessage || "").includes("partial results"));
    } finally {
      cleanupWorkspace(workspaceRoot);
    }
  });
});