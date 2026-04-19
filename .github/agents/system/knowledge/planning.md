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

## Research And Evidence Rules

- Use local codebase evidence first: search for the owning files, usages, tests, and recent changes before widening scope.
- Use browser tools when the plan depends on an interactive flow, rendered UI, or state that source files alone cannot confirm.
- Use web fetch for stable external docs and API references; use broader web search only when discovery or recency materially changes the plan.
- Stop once the controlling surface, smallest viable change, first validation step, and main risks are clear.
- Keep the output lean: include the evidence that changes the plan, not a research transcript.

## Scheduler And Cockpit Anchors

- For scheduler or plugin work, separate three layers explicitly: server/tool availability, mutation primitives, and higher-level routing workflows.
- Treat direct persistence-file editing as an emergency fallback, not the planned first choice.
- Include idempotency, stale-link cleanup, startup diagnostics, and capability checks when a plan changes workflow automation or durable state.

## Good Plan Output

- clear goal and constraints
- compact evidence map
- proposed change sequence
- first validation step
- follow-up validations
- open risks and approval points
- handoff packet for the next agent