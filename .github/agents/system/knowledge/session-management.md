# Session Management

Use this guide when work spans multiple handoffs, long execution windows, or resumable background sessions.

## When Session Discipline Matters

- long-running implementation work
- multiple delegated specialists on one user request
- background tasks that may outlive the current chat turn
- work that will likely need compaction or resume later

## Session Metadata To Preserve

Capture enough information that another agent can resume without broad rediscovery:

- current objective
- relevant files or systems
- decisions already made
- validations already run
- blockers, risks, or pending approvals
- exact next step

## Good Session Boundaries

- One session should have one dominant goal.
- If the goal changes materially, start a new checkpoint or route.
- Durable backlog belongs in Todo Cockpit, not buried in session notes.

## Cleanup Rules

- Close or summarize stale session work when the outcome is already durable elsewhere.
- Keep only the information needed for a clean resume.
- Do not let session notes become a second long-term backlog.