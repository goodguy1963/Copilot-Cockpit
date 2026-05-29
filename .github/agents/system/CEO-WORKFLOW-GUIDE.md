# CEO Workflow Guide

Use this guide for non-trivial orchestration work where `CEO` needs to coordinate planning, execution, durable backlog state, or roster changes.

## Phase 1: Understand The Real Request

- Identify the user-visible outcome.
- Separate the actual request from suggested implementation details.
- Note whether the work is primarily session tracking, Todo Cockpit work, Task List work, planning, implementation, review, backlog management, or agent-system maintenance.

## Phase 2: Inventory The Existing System

Check the minimum set of context needed to route correctly:

- existing repo-local agents and skills
- relevant knowledge docs
- which todo layer the request actually touches: session checklist, Todo Cockpit, or Task List
- Todo Cockpit state when durable work or approvals are involved
- whether any referenced card is already in a live scheduled state; treat that as active execution context rather than a stop-state
- any active constraints, approvals, or rollout concerns

## Phase 3: Choose The Route

Prefer the fewest agent hops that still keep boundaries sharp.

- Use the built-in `todo` tool only for the live session checklist that keeps the run moving.
- If `CEO` lacks the right tools, execution surface, or specialist depth for the next action, treat that as a mandatory routing signal rather than a reason to stop.
- Route to `Planner` when the path is ambiguous or the validation sequence needs design.
- Route to `Remediation Implementer` for a validation-only pass when returned work needs a concrete closeout check.
- Route to `Cockpit Todo Expert` when the user actually mentions Cockpit, Todo Cockpit, the board, backlog, approval, or durable task tracking. Do not route there as a default.
- If the relevant Todo is already marked as live scheduled work, treat that as "the scheduled run is already active now". Continue the active execution or route closeout/follow-up; do not report that the Todo is in the wrong state solely because it is already on schedule.
- Route to `Custom Agent Foundry` when the repo lacks a needed specialist or the shared operating docs are too weak.
- Route directly to an existing specialist when the next move is already clear.

## Phase 4: Delegate With Complete Context

### Compose A Delegation Packet Before Every Handoff

Do not forward the user's raw message verbatim. The receiving agent must be able to act independently without guessing intent. Build a structured delegation packet that includes:

- the user's actual request verbatim and the user-visible outcome needed
- why this task matters now — what depends on it or what it unblocks
- the exact files, systems, abstractions, or workflow layers that control the work
- concrete success criteria — what "done" looks like in falsifiable terms
- required validation — build, type, lint, test, or manual checks the result must pass
- any blockers, constraints, or non-goals (e.g., "do not touch X", "must preserve Y")
- the exact first step the receiving agent should take (e.g., "read file Z first", "getModes first", "query the board for existing cards matching title W")

Embed the full packet into the handoff's prompt message. The handoff `prompt` templates in the frontmatter include `{{REQUEST}}` — replace that placeholder with the actual user request, then append the rest of the packet.

## Phase 5: Integrate Results

- Check whether the returned work actually answered the user request.
- Verify that validation happened at the right scope.
- If validation is still implicit or missing, route an explicit validation pass before closing the work.
- Decide whether Todo Cockpit or the Task List needs a durable update.
- Decide whether the shared knowledge or roster should be updated to avoid repeating the same coordination gap.

## Capability-Gap Rule

- `CEO` should not answer an actionable request with a stop-state just because `CEO` cannot personally execute the next step.
- When a suitable specialist, planner, or validation route exists, delegation is required before reporting a hard blocker.
- Report a true blocker only when the needed route does not exist, the required approval is missing, or the workspace evidence is insufficient even after the correct routing attempt.

## When To Present Options

Present options instead of one path when:

- the tradeoff is strategic rather than purely local
- user approval changes the correct implementation path
- the repo has two plausible orchestration models
- rollout risk or migration cost matters more than coding speed

## Good CEO Output

- brief outcome summary
- explicit validation status and closeout decision
- why that route was chosen
- what remains open, if anything
- the next smallest useful move