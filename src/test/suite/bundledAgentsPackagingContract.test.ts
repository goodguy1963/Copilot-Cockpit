import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const bundledAgentsPackager = require("../../../scripts/prepare-bundled-agents.js") as {
  PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH: string;
  PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH: string;
  prepareBundledAgents: (workspaceRoot: string) => {
    fileCount: number;
  };
};

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, relativePath), "utf8");
}

suite("Bundled Agents Packaging Contract Tests", () => {
  test("packages a sanitized bundled agents tree instead of the live repo tree", () => {
    const vscodeIgnore = readWorkspaceFile(".vscodeignore");
    assert.strictEqual(vscodeIgnore.includes("!.github/agents/**"), false);
    assert.ok(vscodeIgnore.includes("!out/bundled-agents/**"));
  });

  test("keeps only runtime images and excludes non-runtime docs from the VSIX contract", () => {
    const vscodeIgnore = readWorkspaceFile(".vscodeignore");

    for (const expectedEntry of [
      "docs/**",
      "scripts/**",
      "hort --format=-h -ad -s",
      "hort --oneline --decorate",
      "PROVENANCE.md",
      "release-notes.md",
      "TODO_COCKPIT_FEATURES.md",
      "!images/icon.png",
      "!images/activity-todo-list.svg",
      "!images/activity-todo-list-command-light.svg",
      "!images/activity-todo-list-command-dark.svg",
    ]) {
      assert.ok(vscodeIgnore.includes(expectedEntry), `Expected .vscodeignore to include ${expectedEntry}.`);
    }

    for (const forbiddenEntry of [
      "!images/copilot-cockpit-demo.gif",
      "!images/DEMO.gif",
      "!images/DEMO v2.gif",
    ]) {
      assert.strictEqual(
        vscodeIgnore.includes(forbiddenEntry),
        false,
        `Expected .vscodeignore to exclude ${forbiddenEntry}.`,
      );
    }
  });

  test("README externalizes non-runtime docs and demo media references", () => {
    const readme = readWorkspaceFile("README.md");

    assert.ok(readme.includes('<img src="images/icon.png" alt="Copilot Cockpit icon" width="128">'));
    assert.ok(
      readme.includes(
        "(https://raw.githubusercontent.com/goodguy1963/Copilot-Cockpit/main/images/DEMO%20v2.gif)",
      ),
    );
    assert.ok(
      readme.includes(
        "(https://raw.githubusercontent.com/goodguy1963/Copilot-Cockpit/main/images/TEAM.png)",
      ),
    );
    assert.strictEqual(/\]\(docs\//.test(readme), false);
    assert.strictEqual(readme.includes("images/copilot-cockpit-demo.gif"), false);
    assert.strictEqual(readme.includes("(images/DEMO%20v2.gif)"), false);
    assert.strictEqual(readme.includes("(images/TEAM.png)"), false);
  });

  test("prepareBundledAgents keeps repo-knowledge references in docs and ships only the neutral scaffold", () => {
    const workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "copilot-scheduler-bundled-agents-package-"),
    );

    try {
      const liveAgentPath = path.join(
        workspaceRoot,
        ".github",
        "agents",
        "ceo.agent.md",
      );
      fs.mkdirSync(path.dirname(liveAgentPath), { recursive: true });
      fs.writeFileSync(
        liveAgentPath,
        [
          "# CEO",
          "",
          "- Read .github/repo-knowledge/README.md before planning.",
          "- Keep repo-specific durable memory in .github/repo-knowledge/ when available.",
          "- Keep shared starter-pack guidance in .github/agents/system/knowledge/.",
          "",
        ].join("\n"),
        "utf8",
      );

      const liveRepoKnowledgePath = path.join(
        workspaceRoot,
        ".github",
        "repo-knowledge",
        "agent-system.md",
      );
      fs.mkdirSync(path.dirname(liveRepoKnowledgePath), { recursive: true });
      fs.writeFileSync(liveRepoKnowledgePath, "live repo-specific knowledge\n", "utf8");

      const repoKnowledgeTemplatePath = path.join(
        workspaceRoot,
        ".github",
        "agents",
        "system",
        "repo-knowledge-template",
        "README.md",
      );
      fs.mkdirSync(path.dirname(repoKnowledgeTemplatePath), { recursive: true });
      fs.writeFileSync(repoKnowledgeTemplatePath, "neutral repo scaffold\n", "utf8");

      const repoKnowledgeTestingTemplatePath = path.join(
        workspaceRoot,
        ".github",
        "agents",
        "system",
        "repo-knowledge-template",
        "testing.md",
      );
      fs.writeFileSync(repoKnowledgeTestingTemplatePath, "neutral testing scaffold\n", "utf8");

      const legacyPrefabAgentPath = path.join(
        workspaceRoot,
        ".github",
        "agents",
        "prefab.agent.md",
      );
      fs.writeFileSync(legacyPrefabAgentPath, "legacy prefab agent\n", "utf8");

      const result = bundledAgentsPackager.prepareBundledAgents(workspaceRoot);
      assert.strictEqual(result.fileCount, 3);

      const packagedPath = path.join(
        workspaceRoot,
        bundledAgentsPackager.PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        "ceo.agent.md",
      );
      const packagedRepoKnowledgePath = path.join(
        workspaceRoot,
        bundledAgentsPackager.PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
        "README.md",
      );
      const packagedRepoKnowledgeTestingPath = path.join(
        workspaceRoot,
        bundledAgentsPackager.PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
        "testing.md",
      );
      const packagedContent = fs.readFileSync(packagedPath, "utf8").toLowerCase();
      assert.ok(packagedContent.includes("shared starter-pack guidance"));
      assert.ok(packagedContent.includes(".github/repo-knowledge/readme.md"));
      assert.ok(packagedContent.includes("repo-specific durable memory"));
      assert.strictEqual(
        fs.existsSync(
          path.join(
            workspaceRoot,
            bundledAgentsPackager.PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
            "prefab.agent.md",
          ),
        ),
        false,
      );
      assert.strictEqual(
        fs.readFileSync(packagedRepoKnowledgePath, "utf8"),
        "neutral repo scaffold\n",
      );
      assert.strictEqual(
        fs.readFileSync(packagedRepoKnowledgeTestingPath, "utf8"),
        "neutral testing scaffold\n",
      );
      assert.strictEqual(
        fs.existsSync(
          path.join(
            workspaceRoot,
            bundledAgentsPackager.PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
            "system",
            "repo-knowledge-template",
            "README.md",
          ),
        ),
        false,
      );
      assert.strictEqual(
        fs.existsSync(
          path.join(
            workspaceRoot,
            bundledAgentsPackager.PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
            "system",
            "repo-knowledge-template",
            "testing.md",
          ),
        ),
        false,
      );
      assert.strictEqual(
        fs.existsSync(
          path.join(
            workspaceRoot,
            bundledAgentsPackager.PACKAGED_BUNDLED_REPO_KNOWLEDGE_RELATIVE_PATH,
            "agent-system.md",
          ),
        ),
        false,
      );
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});