import * as assert from "assert";
import * as path from "path";
import * as fs from "fs";

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
        "ON-SCHEDULE-LIST",
        "FINAL-USER-CHECK",
      ],
      forbidden: [
        /Linked scheduled task/,
        /comments\[\]\.labels are comment-implied routing hints/i,
        /Treat `go`, `GO`, `rejected`, `Rejected`/,
      ],
    },
    {
      relativePath: ".github/skills/cockpit-todo-agent/SKILL.md",
      required: [
        "needs-user-review",
        "ON-SCHEDULE-LIST",
        "FINAL-USER-CHECK",
      ],
      forbidden: [
        /Linked scheduled task/,
        /only the first value will survive/i,
        /Cards move through explicit workflow states: `active`, `ready`, `completed`, and `rejected`\./,
      ],
    },
    {
      relativePath: ".github/prompts/cockpit-scheduler-router.prompt.md",
      required: [
        "needs-user-review",
        "Treat canonical workflow flags as the routing state.",
        "FINAL-USER-CHECK",
      ],
      forbidden: [
        /Treat labels, flags, and comment labels as separate routing signals\./,
      ],
    },
    {
      relativePath: "README.md",
      required: [
        "live scheduled cards use the built-in `ON-SCHEDULE-LIST` flag",
        "FINAL-USER-CHECK",
      ],
      forbidden: [
        /Linked scheduled task/,
        /returns case-insensitive matches across labels, flags, and actionable comment labels/i,
      ],
    },
    {
      relativePath: "TODO_COCKPIT_FEATURES.md",
      required: [
        "Live scheduled cards use the built-in `ON-SCHEDULE-LIST` flag",
        "needs-user-review",
        "FINAL-USER-CHECK",
      ],
      forbidden: [
        /Linked scheduled task/,
        /Only one flag is kept per card\./,
        /If multiple flags are provided through MCP or updates, only the first is retained\./,
        /Routing-card queries can match labels, flags, and actionable comment labels\./,
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
