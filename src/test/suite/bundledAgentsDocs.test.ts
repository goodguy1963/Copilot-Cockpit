import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

type DocExpectation = {
  relativePath: string;
  required: string[];
};

const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

function readWorkspaceFile(relativePath: string): string {
  return fs.readFileSync(path.join(WORKSPACE_ROOT, relativePath), "utf8");
}

suite("Bundled Starter Agent Docs Contract Tests", () => {
  const expectations: DocExpectation[] = [
    {
      relativePath: ".github/agents/ceo.agent.md",
      required: [
        ".github/agents/CEO-WORKFLOW-GUIDE.md",
        ".github/agents/knowledge/session-management.md",
        "Remediation Implementer",
        "Documentation Specialist",
        "Implement the approved bounded fix",
        "## Delegation Standard",
      ],
    },
    {
      relativePath: ".github/agents/planner.agent.md",
      required: [
        "execution-ready plans",
        "## Planning Workflow",
        "## Handoff Packet",
      ],
    },
    {
      relativePath: ".github/agents/custom-agent-foundry.agent.md",
      required: [
        ".github/agents/knowledge/knowledge-base-guidelines.md",
        "## Design Workflow",
        "## Required Contract For New Agents",
      ],
    },
    {
      relativePath: ".github/agents/remediation-implementer.agent.md",
      required: [
        "## Mandatory First Step",
        "## Escalation Boundary",
        "## Working Rules",
      ],
    },
    {
      relativePath: ".github/agents/documentation-specialist.agent.md",
      required: [
        "## Mandatory First Step",
        "## Accuracy Boundaries",
        "## Operating Workflow",
      ],
    },
    {
      relativePath: ".github/agents/cockpit-todo-expert.agent.md",
      required: [
        "## Anti-Duplicate Rule",
        "## Workflow State Rules",
        "one canonical active workflow flag",
      ],
    },
    {
      relativePath: ".github/agents/README.md",
      required: [
        "AGENT-SYSTEM-MAINTENANCE.md",
        "knowledge/",
        "Source-of-truth rules",
      ],
    },
    {
      relativePath: ".github/agents/TEAM-RULES.md",
      required: [
        "## Handoff Standard",
        "## Knowledge Base Discipline",
        "## Session Discipline",
      ],
    },
    {
      relativePath: ".github/agents/AGENT-SYSTEM-MAINTENANCE.md",
      required: [
        "## Source Of Truth",
        "## Safe Update Workflow",
        "## Sync Boundary",
      ],
    },
    {
      relativePath: ".github/agents/CEO-WORKFLOW-GUIDE.md",
      required: [
        "## Phase 3: Choose The Route",
        "## Phase 5: Integrate Results",
        "## Good CEO Output",
      ],
    },
    {
      relativePath: ".github/agents/knowledge/knowledge-base-guidelines.md",
      required: [
        "## What Belongs In Shared Knowledge",
        "## Writing Rules",
        "## Maintenance Triggers",
      ],
    },
    {
      relativePath: ".github/agents/knowledge/remediation-patterns.md",
      required: [
        "bounded implementation work",
        "narrowest meaningful validation",
        "Escalate",
      ],
    },
    {
      relativePath: ".github/agents/knowledge/documentation.md",
      required: [
        "source-of-truth files",
        "smallest necessary set of docs",
        "reusable documentation lessons",
      ],
    },
    {
      relativePath: ".github/agents/knowledge/session-management.md",
      required: [
        "## When Session Discipline Matters",
        "## Session Metadata To Preserve",
        "## Cleanup Rules",
      ],
    },
    {
      relativePath: ".github/agents/knowledge/session-memory.md",
      required: [
        "## Checkpoint Trigger",
        "## What A Good Checkpoint Includes",
        "## Compression Rules",
      ],
    },
  ];

  for (const expectation of expectations) {
    test(`keeps ${expectation.relativePath} in the richer bundled starter pack`, () => {
      const contents = readWorkspaceFile(expectation.relativePath);

      for (const requiredText of expectation.required) {
        assert.ok(
          contents.includes(requiredText),
          `Expected ${expectation.relativePath} to include: ${requiredText}`,
        );
      }
    });
  }
});