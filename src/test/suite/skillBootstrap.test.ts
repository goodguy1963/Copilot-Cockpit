import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  BUNDLED_SKILLS_RELATIVE_PATH,
  type BundledSkillSyncState,
  COCKPIT_TODO_SKILL_RELATIVE_PATH,
  ensureCockpitTodoSkillForWorkspaceRoots,
  ensureSchedulerSkillForWorkspaceRoots,
  SCHEDULER_SKILL_RELATIVE_PATH,
  syncBundledSkillsForWorkspaceRoots,
} from "../../skillBootstrap";

function cleanupDirs(...dirs: string[]): void {
  for (const dir of dirs) {
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
        "---\nname: cockpit-scheduler-agent\n---\n\ncontent\n",
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
        "---\nname: cockpit-scheduler-agent\n---\n\ncontent\n",
      );
      assert.strictEqual(
        fs.readFileSync(
          path.join(workspaceRootB, SCHEDULER_SKILL_RELATIVE_PATH),
          "utf8",
        ),
        "---\nname: cockpit-scheduler-agent\n---\n\ncontent\n",
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRootA, workspaceRootB);
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
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("creates the cockpit todo skill in each workspace root when missing", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-cockpit-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-cockpit-"),
    );

    try {
      const bundledSkillPath = path.join(
        extensionRoot,
        COCKPIT_TODO_SKILL_RELATIVE_PATH,
      );
      fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true });
      fs.writeFileSync(
        bundledSkillPath,
        "---\nname: cockpit-todo-agent\n---\n\nboard skill\n",
        "utf8",
      );

      const created = await ensureCockpitTodoSkillForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(created.length, 1);
      assert.strictEqual(
        fs.readFileSync(
          path.join(workspaceRoot, COCKPIT_TODO_SKILL_RELATIVE_PATH),
          "utf8",
        ),
        "---\nname: cockpit-todo-agent\n---\n\nboard skill\n",
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("syncs every bundled skill file under .github/skills recursively", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-bundled-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-bundled-"),
    );

    try {
      const bundledFiles = [
        path.join(
          BUNDLED_SKILLS_RELATIVE_PATH,
          "copilot-scheduler-intro",
          "SKILL.md",
        ),
        path.join(
          BUNDLED_SKILLS_RELATIVE_PATH,
          "copilot-scheduler-setup",
          "SKILL.md",
        ),
        path.join(
          BUNDLED_SKILLS_RELATIVE_PATH,
          "copilot-scheduler-setup",
          "references",
          "guide.md",
        ),
      ];

      for (const relativePath of bundledFiles) {
        const absolutePath = path.join(extensionRoot, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, `content:${relativePath}\n`, "utf8");
      }

      const result = await syncBundledSkillsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(result.createdPaths.length, bundledFiles.length);
      assert.strictEqual(result.updatedPaths.length, 0);
      assert.strictEqual(result.skippedPaths.length, 0);
      assert.strictEqual(result.unchangedPaths.length, 0);

      for (const relativePath of bundledFiles) {
        assert.strictEqual(
          fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8"),
          `content:${relativePath}\n`,
        );
        assert.ok(result.nextState[workspaceRoot]?.[relativePath]);
      }
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("updates previously managed bundled skill files when the bundled content changes", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-update-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-update-"),
    );

    try {
      const relativePath = path.join(
        BUNDLED_SKILLS_RELATIVE_PATH,
        "scheduler-mcp-agent",
        "SKILL.md",
      );
      const bundledSkillPath = path.join(extensionRoot, relativePath);
      fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true });
      fs.writeFileSync(bundledSkillPath, "version-one\n", "utf8");

      const firstResult = await syncBundledSkillsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );
      const syncState: BundledSkillSyncState = firstResult.nextState;

      fs.writeFileSync(bundledSkillPath, "version-two\n", "utf8");

      const secondResult = await syncBundledSkillsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
        syncState,
      );

      assert.strictEqual(secondResult.createdPaths.length, 0);
      assert.strictEqual(secondResult.updatedPaths.length, 1);
      assert.strictEqual(secondResult.skippedPaths.length, 0);
      assert.strictEqual(
        fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8"),
        "version-two\n",
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("updates existing bundled skill files when they are not explicitly marked as customized", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-skip-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-skip-"),
    );

    try {
      const relativePath = path.join(
        BUNDLED_SKILLS_RELATIVE_PATH,
        "copilot-scheduler-intro",
        "SKILL.md",
      );
      const bundledSkillPath = path.join(extensionRoot, relativePath);
      const workspaceSkillPath = path.join(workspaceRoot, relativePath);
      fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true });
      fs.writeFileSync(bundledSkillPath, "bundled\n", "utf8");
      fs.mkdirSync(path.dirname(workspaceSkillPath), { recursive: true });
      fs.writeFileSync(workspaceSkillPath, "workspace-custom\n", "utf8");

      const result = await syncBundledSkillsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(result.createdPaths.length, 0);
      assert.strictEqual(result.updatedPaths.length, 1);
      assert.strictEqual(result.skippedPaths.length, 0);
      assert.strictEqual(
        fs.readFileSync(workspaceSkillPath, "utf8"),
        "bundled\n",
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("does not overwrite bundled skill files explicitly marked as customized", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-protected-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-protected-"),
    );

    try {
      const relativePath = path.join(
        BUNDLED_SKILLS_RELATIVE_PATH,
        "copilot-scheduler-intro",
        "SKILL.md",
      );
      const bundledSkillPath = path.join(extensionRoot, relativePath);
      const workspaceSkillPath = path.join(workspaceRoot, relativePath);
      fs.mkdirSync(path.dirname(bundledSkillPath), { recursive: true });
      fs.writeFileSync(bundledSkillPath, "---\nname: copilot-scheduler-intro\n---\n\nbundled\n", "utf8");
      fs.mkdirSync(path.dirname(workspaceSkillPath), { recursive: true });
      fs.writeFileSync(
        workspaceSkillPath,
        "---\nname: copilot-scheduler-intro\ncopilotCockpitCustomize: true\n---\n\nworkspace-custom\n",
        "utf8",
      );

      const result = await syncBundledSkillsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(result.createdPaths.length, 0);
      assert.strictEqual(result.updatedPaths.length, 0);
      assert.strictEqual(result.skippedPaths.length, 1);
      assert.strictEqual(
        fs.readFileSync(workspaceSkillPath, "utf8"),
        "---\nname: copilot-scheduler-intro\ncopilotCockpitCustomize: true\n---\n\nworkspace-custom\n",
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });
});