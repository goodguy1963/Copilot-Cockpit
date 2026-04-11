import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  inspectBundledAgentSyncWorkspace,
  summarizeBundledAgentSystemSignals,
} from "../../bundledAgentSyncPreflight";

suite("Bundled agent sync preflight", () => {
  test("detects existing agent-system surfaces conservatively", () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "bundled-agent-preflight-"));

    try {
      fs.mkdirSync(path.join(workspaceRoot, ".github", "agents"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, ".github", "prompts"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, ".agents", "skills"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, "docs"), { recursive: true });
      fs.mkdirSync(path.join(workspaceRoot, "node_modules", "ignored"), { recursive: true });
      fs.writeFileSync(path.join(workspaceRoot, "AGENTS.md"), "# Agents\n");
      fs.writeFileSync(path.join(workspaceRoot, "team.instructions.md"), "Use care.\n");
      fs.writeFileSync(path.join(workspaceRoot, "docs", "review.agent.md"), "Review helper.\n");
      fs.writeFileSync(path.join(workspaceRoot, ".github", "agents", "ceo.agent.md"), "Should be summarized by the directory.\n");
      fs.writeFileSync(path.join(workspaceRoot, "node_modules", "ignored", "skip.instructions.md"), "Ignored.\n");

      const inspection = inspectBundledAgentSyncWorkspace(workspaceRoot);

      assert.strictEqual(inspection.hasGithubFolder, true);
      assert.deepStrictEqual(inspection.detectedSignals, [
        ".agents",
        ".github/agents",
        ".github/prompts",
        "AGENTS.md",
        "docs/review.agent.md",
        "team.instructions.md",
      ]);

      const summary = summarizeBundledAgentSystemSignals([inspection]);
      assert.ok(summary.includes(".github/agents"));
      assert.ok(summary.includes("docs/review.agent.md"));
      assert.strictEqual(summary.includes("ceo.agent.md"), false);
      assert.strictEqual(summary.includes("skip.instructions.md"), false);
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});