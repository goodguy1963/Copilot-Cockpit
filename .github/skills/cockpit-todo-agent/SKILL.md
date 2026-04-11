---
name: cockpit-todo-agent
description: "Use when an agent needs to read or update the internal Cockpit board through cockpit MCP tools instead of an external task tracker."
copilotCockpitSkillType: operational
copilotCockpitToolNamespaces: [cockpit]
copilotCockpitWorkflowIntents: [needs-bot-review, ready]
copilotCockpitApprovalSensitive: true
copilotCockpitPromptSummary: "Treat Todo Cockpit as the local communication hub, keep cards separate from scheduler tasks, and preserve explicit review-state handoff."
copilotCockpitReadyWorkflowFlags: [ready]
copilotCockpitCloseoutWorkflowFlags: [needs-user-review, FINAL-USER-CHECK]
---

# Cockpit Todo Agent Skill

Use this skill when the repo should treat Todo Cockpit as the central local communication hub between the user and the system.

---

> **CRITICAL DISTINCTION — Todo Cockpit cards vs. Tasks**
>
> | Concept | What it is | Where it lives | Tool prefix |
> |---|---|---|---|
> | **Todo Cockpit card** | A planning / communication card on the board | Workspace Cockpit store, mirrored to `.vscode/scheduler.private.json` | `cockpit_` |
> | **Task** | A scheduled prompt execution entry | Workspace scheduler store, mirrored to `.vscode/scheduler.json` | `scheduler_` |
>
> **These are completely separate artifacts with entirely separate tool sets.**
> A Cockpit card tracks intent, discussion, approval state, and review. A task executes a prompt on a schedule.
> Creating a card does NOT schedule anything. Creating a task does NOT create a card.
> Never use `cockpit_` tools to manage scheduled execution. Never use `scheduler_` tools to manage board cards.
> A card must be approved and explicitly handed off before a task is created from it — that hand-off never happens automatically.

---

## Mental Model

- Todo Cockpit lives in the workspace-local Cockpit store and stays local to the workspace.
- In JSON mode, that store is `.vscode/scheduler.private.json`.
- In sqlite mode, `.vscode/copilot-cockpit.db` is primary and `.vscode/scheduler.private.json` is a compatibility mirror.
- The default intake column is `Unsorted`, followed by topic sections such as Bugs, Features, Ops/DevOps, Marketing/Growth, Automation, and Future.
- There is also a **Recurring Tasks** section and an **Archive** section. Both behave like collapsible areas (show/hide). Neither is a normal planning section.
- Cards are internal planning todos. They are not the same thing as scheduled tasks.
- Scheduled tasks are downstream execution artifacts created from todos that have moved into the `ready` workflow flag.
- Cards keep lifecycle statuses such as `active`, `completed`, and `rejected`, while active handoff state is carried by canonical workflow flags such as `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`.
- `Approve` means the card enters the `ready` workflow flag. `Final Accept` means archive it as completed. `Delete` means reject and archive it.
- Comments are the conversation log between user and system and keep provenance such as `human-form`, `bot-mcp`, `bot-manual`, or `system-event`.
- **Labels** are multi-value user-facing categorization tags shown as pill-shaped chips (border-radius: 999px). Multiple labels can be applied to one card simultaneously. Use for: topic tagging, ownership, domain grouping, and other user-visible categorization. Labels have a shared palette (`labelCatalog`). Do not rely on labels for agent action routing.
- **Flags** are squared routing-state indicators shown as bold chips. Final handoff should normally use one explicit review-state flag, while live scheduled cards use the built-in `ON-SCHEDULE-LIST` flag. Flags have their own palette (`flagCatalog`).

## Required Preflight

Before mutating Cockpit state, verify all of the following:

- The active workspace is the repo that owns the Cockpit board you intend to change.
- The target card already exists when the request is a closeout or follow-up on an existing execution.
- The MCP tool you plan to use is actually available in the current session.

If the workspace is wrong, the card is missing unexpectedly, or the required tool is unavailable, stop and report the blocker before attempting card recreation or JSON repair.

## Mandatory MCP Capability Gate

This skill is MCP-dependent. Do not try to manage Cockpit state without the proper `cockpit_` tools.

- If the active agent cannot access the required `cockpit_` MCP tool, do not mutate `.vscode/scheduler.private.json`, do not recreate board state by hand, and do not imply that the requested card action was completed.
- First prefer a handoff or subagent path only when that target agent actually has the required Cockpit MCP tools and is allowed to perform the update.
- Do not route Cockpit mutations through a read-only exploration agent or any agent that still lacks MCP write tools.
- If no MCP-capable handoff target exists, tell the user directly that the current agent cannot complete the Cockpit task until they switch to an MCP-enabled agent or grant the required tool permissions.
- Only continue without MCP when the user explicitly wants inspection, analysis, or planning rather than a live Cockpit mutation.

## Recurring Tasks Section vs. One-Time Tasks

This is one of the most important distinctions in the Cockpit workflow:

### Recurring task cards (live in the `Recurring Tasks` section)

- Every recurring scheduled task gets **one permanent card** in the `Recurring Tasks` section.
- This card is **never finalized or archived** as long as the task is active. It is a living history log.
- When something changes about the recurring task — prompt update, schedule change, model swap, behavior note, deviation from expected output — **add a comment to its card**. Do not create a new card.
- The comment is the change log entry. Use `bot-mcp` or `system-event` provenance for automated notes; use `human-form` for user-reported changes.
- The linked scheduled task in the workspace scheduler store is updated via `scheduler_update_task`. The Cockpit card itself is only ever updated with a new comment and optionally a flag change — never replaced.
- Think of the `Recurring Tasks` section as the equivalent of the `Archive` section in terms of UI (collapsible, hidden by default) but with the opposite semantic: it holds **alive, long-running items**, not completed ones.

### One-time task cards (no card needed — the todo IS the origin)

- A one-time task is almost always created **from an existing todo card** that has been approved.
- When the one-time task is created, the originating todo card gets the scheduled task linked to it via `cockpit_update_todo`.
- **Do NOT create a new Cockpit card for the one-time task itself.** The planning card that spawned it is the record.
- When the user wants to update a one-time task (prompt change, timing change, etc.), use `scheduler_update_task` directly — no new card, no new card comment needed unless the user's intent changes fundamentally.
- When the one-time task executes successfully, it deletes itself automatically. Finalize the originating todo card with `cockpit_finalize_todo`.

## Example Data Rule

When the user asks for demo data, example data, or screenshot seed content, `Recurring Tasks` cards do not automatically satisfy "something in Cockpit" by themselves.

- A recurring-task card is the history record for a scheduled task.
- A Cockpit planning example should usually be a separate active card in `Unsorted` or another normal planning section.
- Only skip that extra planning card when the user explicitly asks for scheduled-only examples.

If the goal is to showcase the Cockpit surface, prefer one clear unscheduled planning card with a human-review state over relying only on scheduled-task mirrors.

## Closeout Recipe For Routed Execution Work

- Prefer `cockpit_closeout_todo` when implementation is complete but the user still needs to review it. Keep the card active, move it to the repo's final-review section only if that section actually exists, and use an explicit review-state flag such as `needs-user-review`.
- Use labels for user categorization only, not as a substitute for action routing or single review-state handoff.
- Prefer the built-in summary support on `cockpit_closeout_todo` over separate manual comment plus update sequences when the goal is deterministic execution handoff.
- If a linked one-time task was removed, self-deleted, or is missing according to `scheduler_get_task` or `scheduler_remove_task`, let `cockpit_closeout_todo` clear the stale `taskId` when possible.
- Do not assume a `Scheduled as ...` comment means the linked task still exists; comments are history, not the source of truth for scheduler state.
- Do not recreate a missing card as a normal closeout strategy. Recreate only under an explicit recovery path approved by the user.

## Tool Map

- `cockpit_get_board` - fetch the full board with sections and summarized cards
- `cockpit_list_todos` - inspect cards, optionally filtered by section or label
- `cockpit_get_todo` - inspect one card in detail
- `cockpit_create_todo` - create a new card in a section
- `cockpit_add_todo_comment` - append a user/system comment to a card
- `cockpit_update_todo` - update title, description, section, due date, labels, flags, task links, or archive state
- `cockpit_closeout_todo` - apply a deterministic execution closeout update, optionally add one summary comment, and clear a stale linked task when needed
- `cockpit_delete_todo` - reject and archive a card through the compatibility delete path
- `cockpit_approve_todo` - move a card into the `ready` workflow flag
- `cockpit_finalize_todo` - archive a card as completed successfully
- `cockpit_reject_todo` - archive a card as rejected
- `cockpit_move_todo` - move a card between sections or reorder it
- `cockpit_set_filters` - persist Todo Cockpit filter and sort state
- `cockpit_seed_todos_from_tasks` - surface existing scheduled tasks inside Todo Cockpit under Unsorted
- `cockpit_save_label_definition` - upsert a label entry in the label palette (name + optional hex color); labels are multi-value pill chips
- `cockpit_delete_label_definition` - remove a label from the label palette by name
- `cockpit_save_flag_definition` - upsert a flag entry in the flag palette (name + optional hex color); flags are single-value squared chips
- `cockpit_delete_flag_definition` - remove a flag from the flag palette by name

## Decision Rules

- Prefer Todo Cockpit tools over external task-tracker tooling when the task is repo-local coordination.
- Run the workspace and capability preflight before changing Cockpit state for remediation or dispatcher work.
- Use comments to capture instructions, feedback, approvals, and implementation context.
- Prefer `cockpit_approve_todo`, `cockpit_finalize_todo`, and `cockpit_reject_todo` over inventing custom label-only workflow transitions when the intent is explicit.
- Use flags to encode agent action state and review handoff; use labels to preserve user-facing categorization without turning them into control signals.
- If the user asks to track future work, create or update a Todo Cockpit card instead of creating an external task by default.
- Only create or link a scheduled task when the todo has moved into an approval-ready execution state.
- If a scheduled task already exists but no planning todo does, seed or update a Todo Cockpit card under `Unsorted` instead of pretending the task itself is the planning object.
- **Recurring task changed?** Add a comment to its existing `Recurring Tasks` card. Update the scheduled task with `scheduler_update_task`. Do NOT create a new card.
- **One-time task needs updating?** Use `scheduler_update_task` directly. Do NOT create a new Cockpit card. Update the originating card only if the user's intent or scope changes.
- **One-time task completed?** The task should already have auto-deleted itself after success. Finalize the originating card with `cockpit_finalize_todo`.
- **New recurring task being set up?** Create the scheduled task first, then create (or move) a card into the `Recurring Tasks` section and link the task to it.
- **One-time task missing during closeout?** Verify with scheduler MCP tools, then clear the stale `taskId` on the card instead of leaving a broken task link.
- **Implementation complete but user review still needed?** Prefer `cockpit_closeout_todo` with one review-state flag and the intended section if it exists.

For closeout wording and tool payloads, be explicit:

- keep exactly one canonical workflow flag on the active card unless you are only preserving non-workflow metadata flags alongside it
- keep `scheduled-task` in labels, not flags
- do not suggest `Add flags:` with arbitrary custom combinations; active routing should stay deterministic

## Output Expectations

When using this skill, the agent should explain:

- which Todo Cockpit section it chose
- which labels or flags were added or preserved
- whether it created a new card or updated an existing one
- whether a scheduled task was linked, seeded into Unsorted, or intentionally left separate
- what follow-up review state is expected from the user