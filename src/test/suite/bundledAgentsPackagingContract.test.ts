import * as assert from "assert";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const bundledAgentsPackager = require("../../../scripts/prepare-bundled-agents.js") as {
  FORBIDDEN_BUNDLED_AGENT_TEXT: string[];
  PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH: string;
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

  test("prepareBundledAgents strips repo-local knowledge references from markdown payloads", () => {
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

      const result = bundledAgentsPackager.prepareBundledAgents(workspaceRoot);
      assert.strictEqual(result.fileCount, 1);

      const packagedPath = path.join(
        workspaceRoot,
        bundledAgentsPackager.PACKAGED_BUNDLED_AGENTS_RELATIVE_PATH,
        "ceo.agent.md",
      );
      const packagedContent = fs.readFileSync(packagedPath, "utf8").toLowerCase();
      assert.ok(packagedContent.includes("shared starter-pack guidance"));
      for (const forbiddenText of bundledAgentsPackager.FORBIDDEN_BUNDLED_AGENT_TEXT) {
        assert.strictEqual(packagedContent.includes(forbiddenText), false);
      }
    } finally {
      fs.rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});