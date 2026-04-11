# Agent Architecture

Copilot Cockpit ships a small starter-agent layer that is meant to merge into a repository, not replace it.

## Starter Pack

- `CEO`: orchestrator.
- `Planner`: planning specialist.
- `Custom Agent Foundry`: creates missing specialists.
- `Cockpit Todo Expert`: owns Todo Cockpit durability and approvals.

## Merge Rules

- Prefer the repo's existing specialists when they already cover the domain.
- If the repo already has an orchestrator, integrate with it instead of forcing a second competing top-level agent.
- Use `Custom Agent Foundry` to bridge missing roles with repo-local agents.

## Sync Rules

- Bundled agent sync is manual.
- Missing files are created.
- Previously managed files update only when the local copy still matches the last managed version.
- Customized files are skipped and reported.

## Todo Cockpit Role

- Durable approvals, state transitions, and user/AI communication live in Todo Cockpit.
- Short-lived execution status can live elsewhere, but final approval state belongs on the board.