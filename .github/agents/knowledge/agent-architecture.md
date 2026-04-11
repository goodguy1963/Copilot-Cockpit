# Agent Architecture

Copilot Cockpit ships a small starter-agent layer that is meant to merge into a repository, not replace it.

## Starter Pack

- `CEO`: orchestrator.
- `Planner`: planning specialist.
- `Remediation Implementer`: bounded implementation specialist.
- `Documentation Specialist`: docs and knowledge alignment specialist.
- `Custom Agent Foundry`: creates missing specialists.
- `Cockpit Todo Expert`: owns Todo Cockpit durability and approvals.

## Broadly Reusable Starter Specialists

- `Remediation Implementer`: bounded execution specialist for approved code changes.
- `Documentation Specialist`: keeps README, guides, and shared knowledge aligned with the codebase.

## Operating Layers

- `CEO`: chooses direction, routes work, and keeps the user-facing narrative coherent.
- Specialists: execute within a narrow domain and report back with validation.
- Shared docs: hold reusable process, architecture, and workflow rules that should not be duplicated into every agent file.
- Todo Cockpit: durable approval and backlog surface.
- Session-local trackers: optional short-lived execution tracking only.

## Merge Rules

- Prefer the repo's existing specialists when they already cover the domain.
- If the repo already has an orchestrator, integrate with it instead of forcing a second competing top-level agent.
- Use `Custom Agent Foundry` to bridge missing roles with repo-local agents.
- When the repo has a stronger local convention, the repo wins and the starter pack becomes reference material.

## CEO Routing Pattern

1. Understand the request and the real success condition.
2. Inventory relevant agents, skills, prompts, knowledge, and Cockpit state.
3. Decide whether the next step is direct execution, planning, backlog work, or roster evolution.
4. Delegate with context rich enough that the receiving agent can act independently.
5. Review results for validation quality and durable follow-up state.

## Sync Rules

- Bundled agent sync is manual.
- Missing files are created.
- Previously managed files update only when the local copy still matches the last managed version.
- Customized files are skipped and reported.

## Todo Cockpit Role

- Durable approvals, state transitions, and user/AI communication live in Todo Cockpit.
- Short-lived execution status can live elsewhere, but final approval state belongs on the board.

## When To Create A New Specialist

Create or request a new specialist only when:

- the work recurs often enough to deserve a durable role
- the responsibility boundary can be stated clearly
- existing agents would otherwise become vague generalists
- a shared knowledge doc or skill update would not solve the gap more simply
