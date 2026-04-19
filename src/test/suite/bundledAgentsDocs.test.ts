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
        ".github/agents/system/CEO-WORKFLOW-GUIDE.md",
        ".github/agents/system/knowledge/session-management.md",
        ".github/repo-knowledge/README.md",
        "Remediation Implementer",
        "Validate Run",
        "Documentation Specialist",
        "Implement the approved bounded fix",
        "closeout is justified",
        "## Delegation Standard",
      ],
    },
    {
      relativePath: ".github/agents/planner.agent.md",
      required: [
        ".github/repo-knowledge/README.md",
        "execution-ready plans",
        "## Tooling Strategy",
        "VS Code search tools",
        "browser tools",
        "Evidence map",
        "## Planning Workflow",
        "## Handoff Packet",
      ],
    },
    {
      relativePath: ".github/agents/system/knowledge/planning.md",
      required: [
        "## Research And Evidence Rules",
        "local codebase evidence first",
        "compact evidence map",
        "first validation step",
      ],
    },
    {
      relativePath: ".github/agents/custom-agent-foundry.agent.md",
      required: [
        ".github/agents/system/knowledge/knowledge-base-guidelines.md",
        ".github/repo-knowledge/README.md",
        "## Design Workflow",
        "## Required Contract For New Agents",
        "## Roster Change Checklist",
        "tool, discovery, packaging, or regression-test surfaces",
      ],
    },
    {
      relativePath: ".github/agents/remediation-implementer.agent.md",
      required: [
        ".github/repo-knowledge/README.md",
        "## Mandatory First Step",
        "## Escalation Boundary",
        "## Working Rules",
      ],
    },
    {
      relativePath: ".github/agents/documentation-specialist.agent.md",
      required: [
        ".github/repo-knowledge/README.md",
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
      relativePath: ".github/agents/system/README.md",
      required: [
        "system/AGENT-SYSTEM-MAINTENANCE.md",
        "system/knowledge/",
        ".github/repo-knowledge/",
        "Source-of-truth rules",
      ],
    },
    {
      relativePath: ".github/agents/system/TEAM-RULES.md",
      required: [
        ".github/repo-knowledge/",
        "## Handoff Standard",
        "## Knowledge Base Discipline",
        "## Session Discipline",
      ],
    },
    {
      relativePath: ".github/agents/system/AGENT-SYSTEM-MAINTENANCE.md",
      required: [
        ".github/repo-knowledge/",
        "## Source Of Truth",
        "## Roster Change Surfaces",
        "## Safe Update Workflow",
        "## Sync Boundary",
      ],
    },
    {
      relativePath: ".github/agents/system/CEO-WORKFLOW-GUIDE.md",
      required: [
        "## Phase 3: Choose The Route",
        "## Phase 5: Integrate Results",
        "validation-only pass",
        "## Good CEO Output",
      ],
    },
    {
      relativePath: ".github/agents/system/knowledge/knowledge-base-guidelines.md",
      required: [
        ".github/agents/system/knowledge/",
        "## What Belongs In Shared Knowledge",
        "## Writing Rules",
        "## Maintenance Triggers",
      ],
    },
    {
      relativePath: ".github/agents/system/knowledge/remediation-patterns.md",
      required: [
        "bounded implementation work",
        "narrowest meaningful validation",
        "Escalate",
      ],
    },
    {
      relativePath: ".github/agents/system/knowledge/documentation.md",
      required: [
        "source-of-truth files",
        "smallest necessary set of docs",
        "reusable documentation lessons",
      ],
    },
    {
      relativePath: ".github/agents/system/knowledge/session-management.md",
      required: [
        "## When Session Discipline Matters",
        "## Session Metadata To Preserve",
        "## Cleanup Rules",
      ],
    },
    {
      relativePath: ".github/agents/system/knowledge/session-memory.md",
      required: [
        "## Checkpoint Trigger",
        "## What A Good Checkpoint Includes",
        "## Compression Rules",
      ],
    },
    {
      relativePath: ".github/repo-knowledge/README.md",
      required: [
        ".github/agents/system/knowledge/",
        "output_sessions/knowledge-candidates/",
        "repo-specific durable memory",
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