# Team Rules

These starter agents follow the same operating rules across repositories.

## Required First Step

- Check `.github/agents/knowledge/` before starting non-trivial work.
- Reuse documented patterns before inventing a new workflow.

## Orchestration Boundary

- `CEO` is the orchestrator and decision layer.
- `Cockpit Todo Expert` owns Todo Cockpit persistence and approval-state mutations.
- Implementation specialists should not mutate Cockpit board state directly unless that is their explicit role.

## Sync Boundary

- Bundled starter agents are copied into the repo only through manual sync.
- If a workspace copy diverges from the last managed version, future syncs skip it instead of overwriting it.

## Delivery Standard

- Prefer small, reviewable changes over wide speculative rewrites.
- After code changes, run the narrowest meaningful validation step, then widen only when that passes.
- Record reusable patterns in `.github/agents/knowledge/`.

## Todo Cockpit

- Use Todo Cockpit as the long-lived approval and communication surface.
- Use transient session todo tracking only for live execution status, not as the durable backlog.