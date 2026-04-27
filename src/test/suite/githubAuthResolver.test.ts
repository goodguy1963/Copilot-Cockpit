import * as assert from "assert";
import * as vscode from "vscode";
import {
  deriveGitHubEnterpriseServerUri,
  resolveGitHubAuthentication,
  selectGitHubAuthProvider,
} from "../../githubAuthResolver";

suite("GitHub auth resolver behavior", () => {
  test("derives enterprise roots from common API base URL forms", () => {
    assert.strictEqual(
      deriveGitHubEnterpriseServerUri("https://api.github.example.com"),
      "https://github.example.com",
    );
    assert.strictEqual(
      deriveGitHubEnterpriseServerUri("https://github.example.com/api/v3/"),
      "https://github.example.com",
    );
    assert.strictEqual(
      deriveGitHubEnterpriseServerUri("https://github.example.com"),
      "https://github.example.com",
    );

    assert.deepStrictEqual(
      selectGitHubAuthProvider({ apiBaseUrl: "https://api.github.example.com" }),
      {
        apiBaseUrl: "https://api.github.example.com",
        providerId: "github-enterprise",
        enterpriseUri: "https://github.example.com",
      },
    );
    assert.deepStrictEqual(
      selectGitHubAuthProvider({ apiBaseUrl: "https://api.github.com/" }),
      {
        apiBaseUrl: "https://api.github.com",
        providerId: "github",
      },
    );
  });

  test("uses github-enterprise auth and syncs the enterprise URI before requesting a session", async () => {
    const updateCalls: Array<{ key: string; value: unknown; target: vscode.ConfigurationTarget }> = [];
    const getSessionCalls: Array<{
      providerId: string;
      scopes: string[];
      createIfNone: boolean | undefined;
      silent: boolean | undefined;
    }> = [];
    const configurationScope = vscode.Uri.file("f:/HBG Webserver/extensions/source-scheduler");
    const workspaceFolder: vscode.WorkspaceFolder = {
      uri: configurationScope,
      name: "source-scheduler",
      index: 0,
    };

    const result = await resolveGitHubAuthentication(
      {
        apiBaseUrl: "https://api.github.example.com/",
        configurationScope,
        configurationTarget: vscode.ConfigurationTarget.WorkspaceFolder,
      },
      {
        authentication: {
          async getSession(providerId, scopes, options) {
            const normalizedScopes = Array.isArray(scopes) ? [...scopes] : [];
            getSessionCalls.push({
              providerId,
              scopes: normalizedScopes,
              createIfNone: options?.createIfNone === true,
              silent: options?.silent,
            });
            return {
              accessToken: "enterprise-runtime-token",
              account: { label: "octocat" },
            } as vscode.AuthenticationSession;
          },
        },
        workspace: {
          workspaceFolders: [workspaceFolder],
          getConfiguration(section, scope) {
            assert.strictEqual(section, "github-enterprise");
            assert.strictEqual(scope, configurationScope);
            return {
              get<T>() {
                return undefined as T;
              },
              async update(key: string, value: unknown, target: vscode.ConfigurationTarget) {
                updateCalls.push({ key, value, target });
              },
            } as unknown as vscode.WorkspaceConfiguration;
          },
        },
      },
    );

    assert.strictEqual(result.hasConnection, true);
    assert.strictEqual(result.accessToken, "enterprise-runtime-token");
    assert.strictEqual(
      result.authStatusText,
      "Connected via VS Code GitHub Enterprise authentication as octocat for https://github.example.com.",
    );
    assert.deepStrictEqual(updateCalls, [
      {
        key: "uri",
        value: "https://github.example.com",
        target: vscode.ConfigurationTarget.WorkspaceFolder,
      },
    ]);
    assert.deepStrictEqual(getSessionCalls, [
      {
        providerId: "github-enterprise",
        scopes: ["repo"],
        createIfNone: false,
        silent: true,
      },
    ]);
  });
});