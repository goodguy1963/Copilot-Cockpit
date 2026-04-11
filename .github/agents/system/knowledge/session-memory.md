# Session Memory

Use this guide before compaction, major handoff, or any point where context may be lost.

## Checkpoint Trigger

Write a checkpoint-quality summary when:

- a long task is changing hands
- multiple decisions were made and the reasoning matters
- validation results need to survive a context reset
- the next step depends on nuanced repo state

## What A Good Checkpoint Includes

- the active goal
- what changed
- what was validated and with what result
- unresolved risks or blockers
- exact next action

## Compression Rules

- Keep the summary factual and compact.
- Preserve decisions, not every exploration branch.
- Prefer stable file paths, workflow names, and concrete status over vague prose.
- Store durable project memory in knowledge docs or Todo Cockpit, not only in a transient checkpoint.