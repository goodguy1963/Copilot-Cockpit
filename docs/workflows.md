# Workflows

Copilot Cockpit is one workflow stack with three layers: planning and triage, execution and scheduling, and optional tool/control-plane integration.

The default path is: start with a `Todo`, use `Research` when context is missing, then promote approved work into a `Task` or `Job`.

## Todo Cockpit

- Repo-local planning, intake, communication, approval, and handoff surface.
- A `Todo` is a planning artifact, not an execution artifact.
- Cards support comments, due dates, labels, flags, task links, archive review, drag and drop, and filters.
- Optional GitHub inbox rows can be imported into Todo Cockpit as plain Todo intake or as immediate `needs-bot-review` handoffs.
- GitHub-sourced cards persist source metadata so repeat imports reuse and refresh the same Todo instead of creating duplicates.
- Built-in workflow flags include `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`.
- Saving a todo into `ready` can create or reopen its linked task draft so execution prep stays adjacent to the approval step.

## GitHub Triage Loop

1. Refresh the GitHub inbox manually when you want current GitHub items.
2. Use `Create Todo` for normal backlog intake or `Create Todo + Review` when the item should immediately enter `needs-bot-review`.
3. Review and refine the card in `Todo Cockpit`.
4. Move approved GitHub-sourced work into `ready` so the task draft keeps the GitHub context and pull-request preflight guidance.

For the exact setup and current limitations, see [GitHub Integration](./github-integration.md).

## Tasks

- One executable unit, either one-time or recurring.
- A `Task` is the direct execution artifact for one prompt and one schedule.
- Repo-scoped storage with optional agent and model selection.
- Best for one direct execution step without workflow branching.
- Overdue tasks are reviewed on startup.

## Jobs

- Ordered multi-step workflows with one schedule.
- A `Job` is an orchestrated or scheduled run built from multiple steps.
- Steps can be reused, reordered, paused, edited, and compiled into a bundled task.
- Best when work must pass through explicit checkpoints or pauses.

## Research

- Exploratory context-building artifact with bounded iteration against a benchmark.
- Profiles define benchmark commands, score extraction, optimization direction, failure limits, and editable path allowlists.
- Best when the goal is better context or improvement over multiple measured runs before one direct execution.

## Stable Workflow Primitives

- `Todo`, `Task`, and `Job` are the stable workflow primitives for the default path.
- `Research` supports that path when context is missing before execution begins.

## Experimental And Advanced Playground Capabilities

- `MCP`, repo-local skills, starter agents, and related integrations extend the workflow as optional control-plane capabilities.
- They should stay discoverable, but they are not mandatory for onboarding or first execution.

## Execution Guidance

- Use a todo when the work still needs planning, comments, approval, or triage.
- Use research when the work needs exploratory context or evidence before execution.
- Use a task when the work is ready for one concrete executable step.
- Use a job when the work needs multiple ordered steps or pause checkpoints.

[Back to README](../README.md)
