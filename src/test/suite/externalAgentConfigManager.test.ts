import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  buildWorkspaceExternalAgentLauncherState,
  ensureWorkspaceExternalAgentSupportFiles,
  EXTERNAL_AGENT_KEY_ENV_VAR,
  EXTERNAL_AGENT_REPO_ID_ENV_VAR,
  getWorkspaceExternalAgentLauncherPath,
  getWorkspaceExternalAgentStatePath,
} from "../../externalAgentConfigManager";
import { getWorkspaceMcpLauncherPath } from "../../mcpConfigManager";

suite("External Agent Config Manager Tests", () => {
  test("writes repo-local external-agent support files without persisting the repo key", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-cockpit-external-agent-"),
    );

    try {
      const writeResult = ensureWorkspaceExternalAgentSupportFiles({
        workspaceRoot,
        repoId: "repo-alpha",
        controlSocketPath: "\\\\.\\pipe\\copilot-cockpit-alpha",
        heartbeatIntervalMs: 1500,
      });

      assert.strictEqual(writeResult.createdDirectory, true);
      assert.strictEqual(fs.existsSync(writeResult.launcherPath), true);
      assert.strictEqual(fs.existsSync(writeResult.statePath), true);

      const launcherContent = fs.readFileSync(getWorkspaceExternalAgentLauncherPath(workspaceRoot), "utf8");
      assert.ok(launcherContent.includes("external-agent auth failed"));

      const stateContent = fs.readFileSync(getWorkspaceExternalAgentStatePath(workspaceRoot), "utf8");
      const state = JSON.parse(stateContent) as ReturnType<typeof buildWorkspaceExternalAgentLauncherState>;
      assert.strictEqual(state.repoId, "repo-alpha");
      assert.strictEqual(state.controlSocketPath, "\\\\.\\pipe\\copilot-cockpit-alpha");
      assert.strictEqual(state.innerLauncherPath, getWorkspaceMcpLauncherPath(workspaceRoot));
      assert.strictEqual(state.keyEnvVarName, EXTERNAL_AGENT_KEY_ENV_VAR);
      assert.strictEqual(state.repoIdEnvVarName, EXTERNAL_AGENT_REPO_ID_ENV_VAR);
      assert.strictEqual(state.heartbeatIntervalMs, 1500);
      assert.strictEqual(stateContent.includes("secret-value"), false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  test("builds distinct per-workspace launcher state", () => {
    const workspaceRootA = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-cockpit-external-agent-a-"),
    );
    const workspaceRootB = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-cockpit-external-agent-b-"),
    );

    try {
      const stateA = buildWorkspaceExternalAgentLauncherState({
        workspaceRoot: workspaceRootA,
        repoId: "repo-a",
        controlSocketPath: "socket-a",
      });
      const stateB = buildWorkspaceExternalAgentLauncherState({
        workspaceRoot: workspaceRootB,
        repoId: "repo-b",
        controlSocketPath: "socket-b",
      });

      assert.notStrictEqual(stateA.repoId, stateB.repoId);
      assert.notStrictEqual(stateA.workspaceRoot, stateB.workspaceRoot);
      assert.notStrictEqual(stateA.controlSocketPath, stateB.controlSocketPath);
      assert.notStrictEqual(stateA.innerLauncherPath, stateB.innerLauncherPath);
    } finally {
      fs.rmSync(workspaceRootA, { recursive: true, force: true });
      fs.rmSync(workspaceRootB, { recursive: true, force: true });
    }
  });
});