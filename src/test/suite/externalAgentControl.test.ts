import * as assert from "assert";
import {
  buildExternalAgentControlSocketPath,
  evaluateExternalAgentAuthorization,
} from "../../externalAgentControl";

suite("External Agent Control Tests", () => {
  test("evaluateExternalAgentAuthorization accepts a matching auth request", () => {
    const result = evaluateExternalAgentAuthorization({
      request: {
        type: "auth",
        repoId: "repo-alpha",
        key: "secret-key",
      },
      expectedRepoId: "repo-alpha",
      expectedKey: "secret-key",
      workspaceOpen: true,
      cockpitActivated: true,
      externalAgentEnabled: true,
      extensionEnabled: true,
    });

    assert.deepStrictEqual(result, { ok: true });
  });

  test("evaluateExternalAgentAuthorization rejects wrong keys and disabled workspaces", () => {
    const wrongKey = evaluateExternalAgentAuthorization({
      request: {
        type: "auth",
        repoId: "repo-alpha",
        key: "wrong-key",
      },
      expectedRepoId: "repo-alpha",
      expectedKey: "secret-key",
      workspaceOpen: true,
      cockpitActivated: true,
      externalAgentEnabled: true,
      extensionEnabled: true,
    });
    const disabledWorkspace = evaluateExternalAgentAuthorization({
      request: {
        type: "auth",
        repoId: "repo-alpha",
        key: "secret-key",
      },
      expectedRepoId: "repo-alpha",
      expectedKey: "secret-key",
      workspaceOpen: true,
      cockpitActivated: true,
      externalAgentEnabled: false,
      extensionEnabled: true,
    });

    assert.strictEqual(wrongKey.ok, false);
    assert.strictEqual(wrongKey.error, "invalid repo key");
    assert.strictEqual(disabledWorkspace.ok, false);
    assert.strictEqual(disabledWorkspace.error, "external-agent access is disabled for this workspace");
  });

  test("buildExternalAgentControlSocketPath uses named pipes on Windows and uds elsewhere", () => {
    const windowsPath = buildExternalAgentControlSocketPath({
      repoId: "repo-alpha",
      sessionId: "session-alpha",
      platform: "win32",
    });
    const unixPath = buildExternalAgentControlSocketPath({
      repoId: "repo-alpha",
      sessionId: "session-alpha",
      platform: "linux",
      tempDir: "/tmp",
    });

    assert.strictEqual(
      windowsPath,
      "\\\\.\\pipe\\copilot-cockpit-external-agent-session-alpha-repo-alpha",
    );
    assert.strictEqual(
      unixPath,
      "/tmp/copilot-cockpit-external-agent-session-alpha-repo-alpha.sock",
    );
  });
});