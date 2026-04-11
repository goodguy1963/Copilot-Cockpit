# Team Rules

These starter agents follow the same operating rules across repositories.

## Required First Step

- Check `.github/agents/system/knowledge/` before starting non-trivial work.
- Reuse documented patterns before inventing a new workflow.
- Read only the sections that actually control the current task, not every knowledge file.

## Operating Model

- `CEO` is the orchestration and decision layer.
- `Planner` turns ambiguous requests into execution-ready plans and validation sequences.
- `Remediation Implementer` handles approved bounded code changes and validates the touched slice.
- `Documentation Specialist` keeps docs, guides, and shared knowledge aligned with the live system.
- `Cockpit Todo Expert` owns Todo Cockpit persistence, approvals, routing state, and backlog hygiene.
- `Custom Agent Foundry` evolves the roster, skills, and shared operating guidance.
- Existing repo-local agents outrank starter defaults when the repo has already specialized them.

## Orchestration Boundary

- `CEO` is the orchestrator and decision layer.
- `Documentation Specialist` owns doc accuracy and shared knowledge hygiene.
- `Cockpit Todo Expert` owns Todo Cockpit persistence and approval-state mutations.
- Implementation specialists other than `Cockpit Todo Expert` should not mutate Cockpit board state directly unless that is their explicit role.

## Planning And Validation Standard

- Start from the nearest controlling code path, workflow, or durable state boundary.
- Prefer one falsifiable local hypothesis and one cheap discriminating check before widening scope.
- After code changes, run the narrowest meaningful validation step first, then widen only when that passes.
- Do not close work while the touched slice still has unresolved build, type, lint, or behavior failures.

## Handoff Standard

Every meaningful handoff should include:

- the goal and why it matters
- the files, systems, or abstractions that control the work
- constraints and non-goals
- acceptance criteria
- required validation
- blockers, risks, or open decisions
- the exact first step for the receiving agent

## Knowledge Base Discipline

- Keep knowledge concise, searchable, and pattern-oriented.
- Record reusable decisions, anti-patterns, and recurring fixes, not routine implementation noise.
- Prefer examples over long prose.
- Use `.github/agents/system/knowledge/knowledge-base-guidelines.md` when adding or restructuring shared knowledge.

## Session Discipline

- For long-running or multi-handoff work, follow `.github/agents/system/knowledge/session-management.md`.
- Before compaction, handoff, or background execution, capture a checkpoint-quality summary using `.github/agents/system/knowledge/session-memory.md`.

## Sync Boundary

- Bundled starter agents are copied into the repo only through manual sync.
- If a workspace copy diverges from the last managed version, future syncs skip it instead of overwriting it.

## Delivery Standard

- Prefer small, reviewable changes over wide speculative rewrites.
- Record reusable patterns in `.github/agents/system/knowledge/`.
- Update adjacent agent docs and `.github/agents/system/` docs when a roster or workflow change would otherwise leave the starter pack inconsistent.

## Todo Cockpit

- Use Todo Cockpit as the long-lived approval and communication surface.
- Use transient session todo tracking only for live execution status, not as the durable backlog.
- Use labels for categorization and one canonical active workflow flag for routing.