import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { parseSkillMetadataFromContent } from "../../skillMetadata";

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, relativePath), "utf8");
}

suite("Skill Metadata Contract Tests", () => {
  test("ships the bundled skills tree and no legacy scheduler alias", () => {
    const vscodeIgnore = readWorkspaceFile(".vscodeignore");
    assert.ok(vscodeIgnore.includes("!.github/skills/**"));
    assert.strictEqual(vscodeIgnore.includes("scheduler-mcp-agent"), false);
  });

  test("operational and support skill docs declare the required metadata contract", () => {
    const expectations = [
      {
        relativePath: ".github/skills/cockpit-scheduler-agent/SKILL.md",
        type: "operational",
        requiresTodoWorkflowContract: true,
        readyFlag: "ON-SCHEDULE-LIST",
      },
      {
        relativePath: ".github/skills/cockpit-scheduler-router/SKILL.md",
        type: "operational",
        requiresTodoWorkflowContract: true,
        readyFlag: "ON-SCHEDULE-LIST",
      },
      {
        relativePath: ".github/skills/cockpit-todo-agent/SKILL.md",
        type: "operational",
        requiresTodoWorkflowContract: true,
        readyFlag: "ready",
      },
      {
        relativePath: ".github/skills/prefab-ui/SKILL.md",
        type: "operational",
        requiresTodoWorkflowContract: false,
        readyFlag: "",
      },
      {
        relativePath: ".github/skills/copilot-scheduler-intro/SKILL.md",
        type: "support",
        requiresTodoWorkflowContract: false,
        readyFlag: "",
      },
      {
        relativePath: ".github/skills/copilot-scheduler-setup/SKILL.md",
        type: "support",
        requiresTodoWorkflowContract: false,
        readyFlag: "",
      },
    ] as const;

    for (const expectation of expectations) {
      const metadata = parseSkillMetadataFromContent(readWorkspaceFile(expectation.relativePath));
      assert.ok(metadata, `Expected ${expectation.relativePath} to expose parseable skill metadata.`);
      assert.strictEqual(metadata?.type, expectation.type);
      assert.ok(Array.isArray(metadata?.toolNamespaces));
      assert.ok(Array.isArray(metadata?.workflowIntents));
      assert.ok(Array.isArray(metadata?.readyWorkflowFlags));
      assert.ok(Array.isArray(metadata?.closeoutWorkflowFlags));

      if (expectation.type === "operational") {
        assert.strictEqual(metadata?.approvalSensitive, true);
        if (expectation.requiresTodoWorkflowContract) {
          assert.ok(metadata?.workflowIntents.includes("needs-bot-review"));
          assert.ok(metadata?.workflowIntents.includes("ready"));
          assert.ok(metadata?.closeoutWorkflowFlags.includes("needs-user-review"));
          assert.ok(metadata?.closeoutWorkflowFlags.includes("FINAL-USER-CHECK"));
        } else {
          assert.strictEqual(metadata?.workflowIntents.length, 0);
          assert.strictEqual(metadata?.readyWorkflowFlags.length, 0);
          assert.strictEqual(metadata?.closeoutWorkflowFlags.length, 0);
        }
        assert.ok(
          expectation.readyFlag.length === 0 || metadata?.readyWorkflowFlags.includes(expectation.readyFlag),
        );
      } else {
        assert.strictEqual(metadata?.approvalSensitive, false);
      }
    }
  });

  test("integration docs mention metadata-backed skill guidance", () => {
    const integrationsDoc = readWorkspaceFile("docs/integrations.md");
    assert.ok(integrationsDoc.includes("Bundled skills carry frontmatter metadata"));
    assert.ok(integrationsDoc.includes("ready/closeout flag compatibility"));
  });
});