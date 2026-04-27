import * as fs from "fs";
import * as assert from "assert";
import * as path from "path";
import * as os from "os";
import {
  BUNDLED_AGENTS_RELATIVE_PATH,
  BUNDLED_SKILLS_RELATIVE_PATH,
  type BundledSkillSyncState,
  CODEX_AGENTS_RELATIVE_PATH,
  CODEX_SKILLS_RELATIVE_PATH,
  COCKPIT_TODO_SKILL_RELATIVE_PATH,
  ensureCockpitTodoSkillForWorkspaceRoots,
  ensureSchedulerSkillForWorkspaceRoots,
  PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
  resolveBundledAgentsSource,
  SCHEDULER_SKILL_RELATIVE_PATH,
  stageBundledAgentsForWorkspaceRoots,
  STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH,
  STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
  syncBundledAgentsForWorkspaceRoots,
  syncBundledCodexSkillsForWorkspaceRoots,
  syncBundledSkillsForWorkspaceRoots,
} from "../../skillBootstrap";

function cleanupDirs(...dirs: string[]): void {
  for (const dir of dirs) {
    try {
      const cleanupOptions: fs.RmOptions = {};
      cleanupOptions.recursive = true;
      cleanupOptions.force = true;
      cleanupOptions.maxRetries = 3;
      cleanupOptions.retryDelay = 50;
      fs.rmSync(dir, cleanupOptions);
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
        "cockpit-scheduler-agent",
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

  test("syncs bundled skills into repo-local Codex paths and creates AGENTS.md", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-codex-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-codex-"),
    );

    try {
      const schedulerRelativePath = path.join(
        BUNDLED_SKILLS_RELATIVE_PATH,
        "cockpit-scheduler-agent",
        "SKILL.md",
      );
      const schedulerSkillPath = path.join(extensionRoot, schedulerRelativePath);
      fs.mkdirSync(path.dirname(schedulerSkillPath), { recursive: true });
      fs.writeFileSync(
        schedulerSkillPath,
        "---\nname: cockpit-scheduler-agent\ncopilotCockpitSkillType: operational\ncopilotCockpitPromptSummary: orchestrate scheduled work and MCP-backed workflow routing\n---\n\ncodex skill\n",
        "utf8",
      );

      const introRelativePath = path.join(
        BUNDLED_SKILLS_RELATIVE_PATH,
        "copilot-scheduler-intro",
        "SKILL.md",
      );
      const introSkillPath = path.join(extensionRoot, introRelativePath);
      fs.mkdirSync(path.dirname(introSkillPath), { recursive: true });
      fs.writeFileSync(
        introSkillPath,
        "---\nname: copilot-scheduler-intro\ncopilotCockpitSkillType: support\ncopilotCockpitPromptSummary: onboard new contributors before they change scheduler state\n---\n\nsupport skill\n",
        "utf8",
      );

      const prefabRelativePath = path.join(
        BUNDLED_SKILLS_RELATIVE_PATH,
        "prefab-ui",
        "SKILL.md",
      );
      const prefabSkillPath = path.join(extensionRoot, prefabRelativePath);
      fs.mkdirSync(path.dirname(prefabSkillPath), { recursive: true });
      fs.writeFileSync(
        prefabSkillPath,
        "---\nname: prefab-ui\ncopilotCockpitSkillType: operational\ncopilotCockpitPromptSummary: use the live Prefab surface for UI JSON, wire-format rendering, and API-backed view work\n---\n\nprefab skill\n",
        "utf8",
      );

      const legacyPrefabSkillPath = path.join(
        extensionRoot,
        BUNDLED_SKILLS_RELATIVE_PATH,
        "prefab-mcp",
        "SKILL.md",
      );
      fs.mkdirSync(path.dirname(legacyPrefabSkillPath), { recursive: true });
      fs.writeFileSync(
        legacyPrefabSkillPath,
        "legacy prefab skill\n",
        "utf8",
      );

      const prefabAgentPath = path.join(
        extensionRoot,
        PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        "prefab-ui.agent.md",
      );
      fs.mkdirSync(path.dirname(prefabAgentPath), { recursive: true });
      fs.writeFileSync(
        prefabAgentPath,
        "---\nname: Prefab UI Specialist\ndescription: routes Prefab UI and renderer requests through the existing prefab-ui skill and the live Prefab surface\n---\n\nPrefab UI agent\n",
        "utf8",
      );

      const legacyPrefabAgentPath = path.join(
        extensionRoot,
        PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        "prefab.agent.md",
      );
      fs.mkdirSync(path.dirname(legacyPrefabAgentPath), { recursive: true });
      fs.writeFileSync(
        legacyPrefabAgentPath,
        "legacy prefab agent\n",
        "utf8",
      );

      const result = await syncBundledCodexSkillsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      const codexSkillPath = path.join(
        workspaceRoot,
        CODEX_SKILLS_RELATIVE_PATH,
        "cockpit-scheduler-agent",
        "SKILL.md",
      );
      const legacyCodexSkillPath = path.join(
        workspaceRoot,
        CODEX_SKILLS_RELATIVE_PATH,
        "prefab-mcp",
        "SKILL.md",
      );
      const agentsPath = path.join(workspaceRoot, CODEX_AGENTS_RELATIVE_PATH);

      assert.ok(result.createdPaths.includes(codexSkillPath));
      assert.ok(result.createdPaths.includes(agentsPath));
      assert.strictEqual(fs.existsSync(legacyCodexSkillPath), false);
      assert.strictEqual(
        fs.readFileSync(codexSkillPath, "utf8"),
        "---\nname: cockpit-scheduler-agent\ncopilotCockpitSkillType: operational\ncopilotCockpitPromptSummary: orchestrate scheduled work and MCP-backed workflow routing\n---\n\ncodex skill\n",
      );

      const agentsContent = fs.readFileSync(agentsPath, "utf8");
      assert.ok(agentsContent.includes(".agents/skills"));
      assert.ok(agentsContent.includes(".codex/config.toml"));
      assert.ok(agentsContent.includes("Operational skills: cockpit-scheduler-agent (orchestrate scheduled work and MCP-backed workflow routing), prefab-ui (use the live Prefab surface for UI JSON, wire-format rendering, and API-backed view work)."));
      assert.ok(agentsContent.includes("Support skills: copilot-scheduler-intro (onboard new contributors before they change scheduler state)."));
      assert.ok(agentsContent.includes("Repo-local custom agents: `Prefab UI Specialist` in `.github/agents/prefab-ui.agent.md` routes Prefab UI and renderer requests through the existing prefab-ui skill and the live Prefab surface."));
      assert.strictEqual(agentsContent.includes("Prefab Specialist"), false);
      assert.strictEqual(agentsContent.includes("prefab.agent.md"), false);
      assert.ok(agentsContent.includes("cannot start a new session"));
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("syncs bundled agents into repo-local .github/agents paths", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-agents-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-agents-"),
    );

    try {
      const bundledFiles = [
        path.join(BUNDLED_AGENTS_RELATIVE_PATH, "ceo.agent.md"),
        path.join(BUNDLED_AGENTS_RELATIVE_PATH, "README.md"),
        path.join(BUNDLED_AGENTS_RELATIVE_PATH, "knowledge", "planning.md"),
      ];

      for (const relativePath of bundledFiles) {
        const absolutePath = path.join(extensionRoot, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, `content:${relativePath}\n`, "utf8");
      }

      const legacyPrefabAgentPath = path.join(
        extensionRoot,
        BUNDLED_AGENTS_RELATIVE_PATH,
        "prefab.agent.md",
      );
      fs.mkdirSync(path.dirname(legacyPrefabAgentPath), { recursive: true });
      fs.writeFileSync(legacyPrefabAgentPath, "legacy prefab agent\n", "utf8");

      const result = await syncBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(result.createdPaths.length, bundledFiles.length);
      assert.strictEqual(result.updatedPaths.length, 0);
      assert.strictEqual(result.skippedPaths.length, 0);

      for (const relativePath of bundledFiles) {
        const targetPath = path.join(workspaceRoot, relativePath);
        assert.strictEqual(
          fs.readFileSync(targetPath, "utf8"),
          `content:${relativePath}\n`,
        );
        assert.ok(result.nextState[workspaceRoot]?.[relativePath]);
      }

      assert.strictEqual(
        fs.existsSync(path.join(workspaceRoot, BUNDLED_AGENTS_RELATIVE_PATH, "prefab.agent.md")),
        false,
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("stages bundled agents only under the plugin-owned support path", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-agents-stage-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-agents-stage-"),
    );

    try {
      const bundledFiles = [
        path.join(BUNDLED_AGENTS_RELATIVE_PATH, "ceo.agent.md"),
        path.join(BUNDLED_AGENTS_RELATIVE_PATH, "team", "planner.agent.md"),
      ];

      for (const relativePath of bundledFiles) {
        const absolutePath = path.join(extensionRoot, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(absolutePath, `content:${relativePath}\n`, "utf8");
      }

      const liveAgentPath = path.join(
        workspaceRoot,
        BUNDLED_AGENTS_RELATIVE_PATH,
        "ceo.agent.md",
      );
      fs.mkdirSync(path.dirname(liveAgentPath), { recursive: true });
      fs.writeFileSync(liveAgentPath, "workspace-live-agent\n", "utf8");

      const staleStagePath = path.join(
        workspaceRoot,
        STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        "stale.md",
      );
      fs.mkdirSync(path.dirname(staleStagePath), { recursive: true });
      fs.writeFileSync(staleStagePath, "stale\n", "utf8");

      const result = await stageBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(result.stagedRoots.length, 1);
      assert.strictEqual(result.stagedPaths.length, bundledFiles.length);
      assert.strictEqual(
        fs.readFileSync(liveAgentPath, "utf8"),
        "workspace-live-agent\n",
      );
      assert.strictEqual(fs.existsSync(staleStagePath), false);

      for (const relativePath of bundledFiles) {
        const stagedPath = path.join(
          workspaceRoot,
          STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
          path.relative(BUNDLED_AGENTS_RELATIVE_PATH, relativePath),
        );
        assert.strictEqual(
          fs.readFileSync(stagedPath, "utf8"),
          `content:${relativePath}\n`,
        );
      }

      const manifestPath = path.join(
        workspaceRoot,
        STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH,
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        liveAgentsRelativePath: string;
        stagedAgentsRelativePath: string;
        files: Array<{ sourceRelativePath: string }>;
      };

      assert.strictEqual(manifest.liveAgentsRelativePath, BUNDLED_AGENTS_RELATIVE_PATH);
      assert.strictEqual(
        manifest.stagedAgentsRelativePath,
        STAGED_BUNDLED_AGENTS_RELATIVE_PATH,
      );
      assert.deepStrictEqual(
        manifest.files.map((entry) => entry.sourceRelativePath),
        bundledFiles,
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("prefers the packaged bundled agents source when it exists", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-packaged-agents-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-packaged-agents-"),
    );

    try {
      const liveRelativePath = path.join(BUNDLED_AGENTS_RELATIVE_PATH, "ceo.agent.md");
      const packagedRelativePath = path.join(
        PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        "ceo.agent.md",
      );

      fs.mkdirSync(path.dirname(path.join(extensionRoot, liveRelativePath)), { recursive: true });
      fs.writeFileSync(path.join(extensionRoot, liveRelativePath), "live-tree\n", "utf8");
      fs.mkdirSync(path.dirname(path.join(extensionRoot, packagedRelativePath)), { recursive: true });
      fs.writeFileSync(path.join(extensionRoot, packagedRelativePath), "packaged-tree\n", "utf8");

      const resolved = resolveBundledAgentsSource(extensionRoot);
      assert.strictEqual(resolved.relativePath, PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH);

      const syncResult = await syncBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      assert.strictEqual(syncResult.createdPaths.length, 1);
      assert.strictEqual(
        fs.readFileSync(path.join(workspaceRoot, liveRelativePath), "utf8"),
        "packaged-tree\n",
      );

      await stageBundledAgentsForWorkspaceRoots(extensionRoot, [workspaceRoot]);

      const manifestPath = path.join(
        workspaceRoot,
        STAGED_BUNDLED_AGENTS_MANIFEST_RELATIVE_PATH,
      );
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
        sourceAgentsRelativePath: string;
      };
      assert.strictEqual(
        manifest.sourceAgentsRelativePath,
        PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });

  test("updates previously managed bundled agent files when the bundled content changes", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-agents-update-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-agents-update-"),
    );

    try {
      const relativePath = path.join(BUNDLED_AGENTS_RELATIVE_PATH, "ceo.agent.md");
      const bundledAgentPath = path.join(extensionRoot, relativePath);
      fs.mkdirSync(path.dirname(bundledAgentPath), { recursive: true });
      fs.writeFileSync(bundledAgentPath, "version-one\n", "utf8");

      const firstResult = await syncBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      fs.writeFileSync(bundledAgentPath, "version-two\n", "utf8");

      const secondResult = await syncBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
        firstResult.nextState,
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

  test("skips bundled agent files when the workspace copy was customized", async () => {
    const extensionRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-extension-root-agents-protected-"),
    );
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-workspace-agents-protected-"),
    );

    try {
      const relativePath = path.join(BUNDLED_AGENTS_RELATIVE_PATH, "ceo.agent.md");
      const bundledAgentPath = path.join(extensionRoot, relativePath);
      const workspaceAgentPath = path.join(workspaceRoot, relativePath);
      fs.mkdirSync(path.dirname(bundledAgentPath), { recursive: true });
      fs.writeFileSync(bundledAgentPath, "version-one\n", "utf8");

      const firstResult = await syncBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
      );

      fs.writeFileSync(workspaceAgentPath, "workspace-custom\n", "utf8");
      fs.writeFileSync(bundledAgentPath, "version-two\n", "utf8");

      const secondResult = await syncBundledAgentsForWorkspaceRoots(
        extensionRoot,
        [workspaceRoot],
        firstResult.nextState,
      );

      assert.strictEqual(secondResult.createdPaths.length, 0);
      assert.strictEqual(secondResult.updatedPaths.length, 0);
      assert.strictEqual(secondResult.skippedPaths.length, 1);
      assert.strictEqual(
        fs.readFileSync(workspaceAgentPath, "utf8"),
        "workspace-custom\n",
      );
    } finally {
      cleanupDirs(extensionRoot, workspaceRoot);
    }
  });
});
