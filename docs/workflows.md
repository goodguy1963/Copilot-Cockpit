# Workflows

Copilot Cockpit separates planning from execution so users can review work before it runs.

## Todo Cockpit

- Repo-local planning, communication, approval, and handoff surface.
- Cards support comments, due dates, labels, flags, task links, archive review, drag and drop, and filters.
- Built-in workflow flags include `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`.
- Saving a todo into `ready` can create or reopen its linked task draft so execution prep stays adjacent to the approval step.

## Tasks

- One scheduled execution unit, either one-time or recurring.
- Repo-scoped storage with optional agent and model selection.
- Best for one direct execution step without workflow branching.
- Overdue tasks are reviewed on startup.

## Jobs

- Ordered multi-step workflows with one schedule.
- Steps can be reused, reordered, paused, edited, and compiled into a bundled task.
- Best when work must pass through explicit checkpoints or pauses.

## Research

- Bounded iteration against a benchmark.
- Profiles define benchmark commands, score extraction, optimization direction, failure limits, and editable path allowlists.
- Best when the goal is improvement over multiple measured runs instead of one direct execution.

## Execution Guidance

- Use a todo when the work still needs planning, comments, or approval.
- Use a task when the work is ready for one concrete execution step.
- Use a job when the work needs multiple ordered steps or pause checkpoints.
- Use research when the work needs repeated benchmark-driven refinement.

[Back to README](../README.md)
