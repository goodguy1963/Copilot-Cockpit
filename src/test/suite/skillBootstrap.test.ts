import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  ensureSchedulerSkillForWorkspaceRoots,
  SCHEDULER_SKILL_RELATIVE_PATH,
} from "../../skillBootstrap";

suite("Skill Bootstrap Tests", () => {
  test("creates the scheduler skill in each workspace root when missing", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-"),
    );
    const workspaceRootA = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-a-"),
    );
    const workspaceRootB = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-b-"),
    );

    try {
      const bundledSkillPath = path.join(
        extensionRoot,
        SCHEDULER_SKILL_RELATIVE_PATH,
      );
      fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true });
      fs.writeFileSync(
        bundledSkillPath,
        "---\nname: scheduler-mcp-agent\n---\n\ncontent\n",
        "utf8",
      );

      const created = await ensureSchedulerSkillForWorkspaceRoots(
        extensionRoot,
        [workspaceRootA, workspaceRootB],
      );

      assert.strictEqual(created.length, 2);
      assert.strictEqual(
        fs.readFileSync(
          path.join(workspaceRootA, SCHEDULER_SKILL_RELATIVE_PATH),
          "utf8",
        ),
        "---\nname: scheduler-mcp-agent\n---\n\ncontent\n",
      );
      assert.strictEqual(
        fs.readFileSync(
          path.join(workspaceRootB, SCHEDULER_SKILL_RELATIVE_PATH),
          "utf8",
        ),
        "---\nname: scheduler-mcp-agent\n---\n\ncontent\n",
      );
    } finally {
      for (const dir of [extensionRoot, workspaceRootA, workspaceRootB]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });

  test("does not overwrite an existing workspace skill", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-existing-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-existing-"),
    );

    try {
      const bundledSkillPath = path.join(
        extensionRoot,
        SCHEDULER_SKILL_RELATIVE_PATH,
      );
      const workspaceSkillPath = path.join(
        workspaceRoot,
        SCHEDULER_SKILL_RELATIVE_PATH,
      );
      fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true });
      fs.writeFileSync(bundledSkillPath, "bundled\n", "utf8");
      fs.mkdirSync(path.dirname(workspaceSkillPath), { recursive: true });
      fs.writeFileSync(workspaceSkillPath, "workspace-custom\n", "utf8");

      const created = await ensureSchedulerSkillForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.deepStrictEqual(created, []);
      assert.strictEqual(
        fs.readFileSync(workspaceSkillPath, "utf8"),
        "workspace-custom\n",
      );
    } finally {
      for (const dir of [extensionRoot, workspaceRoot]) {
        try {
          fs.rmSync(dir, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 50,
          });
        } catch {
          // ignore
        }
      }
    }
  });
});