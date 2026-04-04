import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

type DocExpectation = {
  relativePath: string;
  required?: string[];
  forbidden?: RegExp[];
};

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, relativePath), "utf8");
}

suite("Cockpit Semantics Docs Contract Tests", () => {
  const expectations: DocExpectation[] = [
    {
      relativePath: ".github/skills/cockpit-scheduler-router/SKILL.md",
      required: [
        "needs-user-review",
        "Linked scheduled task",
        "ON-SCHEDULE-LIST",
      ],
      forbidden: [
        /FINAL-USER-CHECK/,
        /final-user-check state/i,
      ],
    },
    {
      relativePath: ".github/skills/cockpit-todo-agent/SKILL.md",
      required: [
        "needs-user-review",
        "Linked scheduled task",
        "ON-SCHEDULE-LIST",
      ],
      forbidden: [
        /only the first value will survive/i,
        /only one flag per card is kept/i,
      ],
    },
    {
      relativePath: ".github/prompts/cockpit-scheduler-router.prompt.md",
      required: [
        "needs-user-review",
        "Treat labels, flags, and comment labels as separate routing signals.",
      ],
      forbidden: [
        /FINAL-USER-CHECK/,
        /final-user-check/i,
      ],
    },
    {
      relativePath: "README.md",
      required: [
        "live scheduled cards may intentionally keep the built-in pair",
      ],
      forbidden: [
        /Do not try to preserve multiple active flags on one card\./,
      ],
    },
    {
      relativePath: "TODO_COCKPIT_FEATURES.md",
      required: [
        "Live scheduled cards may intentionally keep the built-in pair",
        "needs-user-review",
      ],
      forbidden: [
        /Only one flag is kept per card\./,
        /If multiple flags are provided through MCP or updates, only the first is retained\./,
        /Only one is retained on a card at a time/,
      ],
    },
  ];

  for (const expectation of expectations) {
    test(`keeps ${expectation.relativePath} aligned with the live Cockpit semantics`, () => {
      const contents = readWorkspaceFile(expectation.relativePath);

      for (const requiredText of expectation.required ?? []) {
        assert.ok(
          contents.includes(requiredText),
          `Expected ${expectation.relativePath} to include: ${requiredText}`,
        );
      }

      for (const forbiddenPattern of expectation.forbidden ?? []) {
        assert.strictEqual(
          forbiddenPattern.test(contents),
          false,
          `Did not expect ${expectation.relativePath} to match ${forbiddenPattern}`,
        );
      }
    });
  }
});