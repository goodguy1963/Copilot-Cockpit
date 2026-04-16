# CEO Workflow Guide

Use this guide for non-trivial orchestration work where `CEO` needs to coordinate planning, execution, durable backlog state, or roster changes.

## Phase 1: Understand The Real Request

- Identify the user-visible outcome.
- Separate the actual request from suggested implementation details.
- Note whether the work is primarily planning, implementation, review, backlog management, or agent-system maintenance.

## Phase 2: Inventory The Existing System

Check the minimum set of context needed to route correctly:

- existing repo-local agents and skills
- relevant knowledge docs
- Todo Cockpit state when durable work or approvals are involved
- any active constraints, approvals, or rollout concerns

## Phase 3: Choose The Route

Prefer the fewest agent hops that still keep boundaries sharp.

- If `CEO` lacks the right tools, execution surface, or specialist depth for the next action, treat that as a mandatory routing signal rather than a reason to stop.
- Route to `Planner` when the path is ambiguous or the validation sequence needs design.
- Route to `Remediation Implementer` for a validation-only pass when returned work needs a concrete closeout check.
- Route to `Cockpit Todo Expert` when durable board state, approvals, sections, or routing flags need work.
- Route to `Custom Agent Foundry` when the repo lacks a needed specialist or the shared operating docs are too weak.
- Route directly to an existing specialist when the next move is already clear.

## Phase 4: Delegate With Complete Context

Every meaningful handoff should include:

- the goal
- why it matters now
- the controlling files, systems, or workflow layers
- constraints and non-goals
- required validation
- the exact first step

## Phase 5: Integrate Results

- Check whether the returned work actually answered the user request.
- Verify that validation happened at the right scope.
- If validation is still implicit or missing, route an explicit validation pass before closing the work.
- Decide whether Todo Cockpit needs a durable update.
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