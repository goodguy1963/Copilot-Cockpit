# Planning Notes

## Core Planning Rules

- Validate the nearest controlling code path, workflow, or durable state boundary before expanding scope.
- Prefer one falsifiable local hypothesis and one cheap discriminating check.
- Keep plans executable: proposed edits, validations, and rollout order should be obvious.
- When repo-local agents already exist, plan the integration around them instead of layering duplicates.

## Planning Workflow

1. Define the user-visible outcome and any approval, migration, or rollout constraints.
2. Anchor the plan to the real execution surface first.
3. Compare the smallest plausible implementation paths and pick the clearest one.
4. Sequence validation so the cheapest falsifiable step happens before broader work.
5. Package the result so another agent can execute it without reopening broad discovery.

## Scheduler And Cockpit Anchors

- For scheduler or plugin work, separate three layers explicitly: server/tool availability, mutation primitives, and higher-level routing workflows.
- Treat direct persistence-file editing as an emergency fallback, not the planned first choice.
- Include idempotency, stale-link cleanup, startup diagnostics, and capability checks when a plan changes workflow automation or durable state.

## Good Plan Output

- clear goal and constraints
- proposed change sequence
- first validation step
- follow-up validations
- open risks and approval points
- handoff packet for the next agent