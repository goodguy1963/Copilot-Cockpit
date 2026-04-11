---
name: cockpit-scheduler-router
description: "Use when an agent needs to route and dispatch Cockpit Todo cards from the workspace-local Cockpit store, including sqlite mode with compatibility mirrors."
copilotCockpitSkillType: operational
copilotCockpitToolNamespaces: [cockpit, scheduler]
copilotCockpitWorkflowIntents: [needs-bot-review, ready]
copilotCockpitApprovalSensitive: true
copilotCockpitPromptSummary: "Route through canonical workflow flags, preserve approval checkpoints, and verify linked scheduler state before changing live scheduled cards."
copilotCockpitReadyWorkflowFlags: [ready, ON-SCHEDULE-LIST]
copilotCockpitCloseoutWorkflowFlags: [needs-user-review, FINAL-USER-CHECK]
---

# Cockpit Scheduler Router Skill

Use this skill when a dispatcher should inspect Cockpit cards and decide whether to schedule, reject, or ask for clarification.

When `copilotCockpit.storageMode` is `sqlite`, treat the workspace Cockpit store as SQLite-primary with `.vscode/scheduler.private.json` kept as a compatibility mirror. MCP tool behavior stays the same.

## Core Rule

Cockpit routing state is not a single label bucket.

- `labels` are multi-value user categorization tags.
- `flags` carry the live workflow state for active cards.
- `comments[].labels` are comment metadata, not routing signals.
- Legacy `GO` is normalized to the built-in `ready` flag.
- `scheduled-task` is a label in this repo, not a flag.
- Do not collapse `ON-SCHEDULE-LIST` into a label or a comment-only signal.

## Mandatory MCP Capability Gate

This router skill is MCP-dependent. It must not attempt live routing or scheduler/card mutation without the required Cockpit and scheduler tool surfaces.

- If the current agent cannot access the required `cockpit_` and `scheduler_` MCP tools, do not try to emulate routing by editing repo-local JSON files, inventing state transitions, or claiming dispatch succeeded.
- First prefer a handoff or subagent path only when the destination agent actually has the required MCP tools and can perform the intended mutation.
- Do not send live routing work to a read-only exploration agent or any agent that still lacks the required MCP tools.
- If no MCP-capable handoff target is available, stop and tell the user that the current agent cannot fulfill the routing task until they switch to an MCP-enabled agent or grant the necessary tool permissions.
- Only continue in analysis-only mode when the user explicitly wants a review, diagnosis, or plan instead of live Cockpit/scheduler updates.

## Recommended Read Flow

1. Call `cockpit_list_routing_cards` first.
2. Use the returned `latestActionableUserComment` for intent and cron overrides.
3. If you need full card context, call `cockpit_get_todo` for only the matching cards.

## Routing Semantics

- Match routing signals case-insensitively.
- Treat `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK` as the canonical routing signals. Legacy `go` normalizes to `ready`.
- Ignore non-actionable comments such as `Scheduled as ...`, `Done`, label-maintenance notes, dispatcher status comments, and scheduler status comments.
- Sort comments newest-first by sequence, then by created time if needed.

## Action Policy

- `FINAL-USER-CHECK` → finalize/archive the card only when the implementation is actually accepted.
- `needs-bot-review` → plan-only handling with exactly one clarification or two implementation options, depending on clarity.
- `ready` → create or reuse the linked scheduler task only when the latest actionable user comment is specific enough.
- `ON-SCHEDULE-LIST` → manage the linked scheduler job lifecycle for live scheduled cards.
- `needs-user-review` or `new` → keep the card active and route it for follow-up instead of scheduling immediately.

## Example Set Requests

When the user asks for a demo/example set across surfaces, route it as separate artifacts instead of collapsing everything into scheduled tasks.

- Keep one active planning card in Cockpit.
- Keep one standalone task in the task list.
- Keep one job as a workflow artifact.
- Keep one research profile when research is part of the request.

Do not treat recurring task mirrors or job child tasks as a full cross-surface example set on their own.

## Rule Block: Workflow Outcomes

- `ON-SCHEDULE-LIST` + completed implementation:
	- remove the scheduler job if it exists
	- clear stale `taskId` when the linked task is gone
	- replace the scheduled-card workflow flag with `needs-user-review` or `FINAL-USER-CHECK`, depending on the requested handoff
- `ON-SCHEDULE-LIST` + incomplete implementation:
	- verify the linked task by `taskId` first
	- keep and reuse the existing scheduler task when it still exists and still matches intent
	- recreate it only if the linked task is missing or stale and the card is still valid for scheduling
- `ready`:
	- if intent is concrete, first check whether a linked `taskId` already points to a live scheduler task that matches intent, and reuse or update that task instead of creating a duplicate
	- only create a new scheduler task when the linked `taskId` is missing or stale
	- then swap `ready` for `ON-SCHEDULE-LIST` and add the schedule comment
	- if intent is vague, request clarification and add `needs-user-review`

## Rule Block: `needs-bot-review` Ambiguity Handling

The current live dispatcher source contains two different `needs-bot-review` behaviors: one scheduling-oriented and one plan/comment-oriented.

- Do not silently collapse those branches during support-only extraction.
- Require the caller to choose `needs_review_mode`, or use `mirror-live-source` when the goal is documentation rather than mutation.
- If the branch remains ambiguous during a live review, document the ambiguity and avoid repointing behavior in the same task.

## Rule Block: Scheduler Creation

- Prefer create-scheduler-first ordering so label changes do not outpace scheduler creation.
- Preserve and reuse an existing linked `taskId` before any create path when the linked scheduler task still exists and still matches intent.
- For `ready` cards, check `taskId` first and only create a new scheduler task when the link is missing or stale.
- For `ON-SCHEDULE-LIST` incomplete cards, verify the linked task by `taskId` before recreating anything.
- Use idempotent behavior:
	- no duplicate scheduler jobs
	- no duplicate comments
	- no duplicate labels
- Derive cron from the latest actionable user comment when it includes `Cron: ...`.
- Otherwise select the next available scheduling slot.
- Allow the same 30-minute bucket for clearly disjoint tasks.
- Require a 30-minute gap only when the new task and an existing scheduled task could plausibly overlap in touched files, components, or feature area, or when overlap is uncertain.
- Base the overlap check on the card title, description, latest actionable user comment, and the existing scheduled task prompt or summary when available.
- Preserve the current live execution defaults unless the caller explicitly overrides them.

## Rule Block: Delete Tombstones

- When a scheduler task is deleted, treat `deletedTaskIds` or scheduler tombstones as authoritative so stale reads or stale writes do not resurrect the task.
- When a Cockpit todo is purged, treat `deletedCardIds` or cockpit card tombstones as authoritative so stale board writes do not recreate the card.
- Clear stale `taskId` links instead of leaving a card pointed at a deleted scheduler task.
- Do not recommend recreate-on-refresh behavior for deleted tasks or purged todos unless the caller explicitly asks to recreate them.
- If a task or todo was intentionally deleted, the router should prefer documenting the tombstone-preserving state over trying to restore it.

## Closeout Discipline

- Do not treat comment text such as `Scheduled as ...` as proof that the linked scheduler task still exists. Use scheduler MCP tools to confirm the real task state.
- Prefer `cockpit_closeout_todo` for final execution handoff so the comment, review-state update, requested section move, and stale task-link cleanup happen in one deterministic write.
- If `scheduler_remove_task` or `scheduler_get_task` shows that the linked task is already gone, clear the Cockpit card's `taskId` instead of leaving a stale link behind.
- Use flags for routing and review-state handoff. Keep the built-in `ON-SCHEDULE-LIST` flag when the card still represents a live scheduled item.
- When implementation is complete but the user still needs to review the result, prefer an existing review-state flag such as `needs-user-review`, and move the card only if the requested review section actually exists.
- Add one compact Cockpit comment that covers changes, validation, and remaining follow-up instead of scattering multiple status comments.

## Suggested Update Format

When you propose a deterministic card update, keep flags and labels separate in the wording.

- Use `Set flag to:` when the live state intentionally keeps `ON-SCHEDULE-LIST` on the card.
- Use `Set flag to:` for a single review-state flag when no paired scheduling state is needed.
- Use `Add label:` or `Add labels:` for multi-value categorization such as `scheduled-task`.
- Use `Remove flag:` or `Remove flags:` only for state chips that should no longer remain on the card.

Correct example for a scheduled implementation that now needs user review:

- `Remove flag: GO`
- `Set flag to: ON-SCHEDULE-LIST`
- `Add label: scheduled-task`
- `Set linked taskId to: <task-id>`
- `Add schedule comment: Scheduled as <task-id>`

Correct example for scheduled work that is finished and now needs final review:

- `Remove flag: ON-SCHEDULE-LIST`
- `Set flag to: needs-user-review`
- `Remove scheduler task: <task-id>` if it still exists
- `Keep linked taskId cleared when the task is gone`

Avoid output such as `Add flags: on-schedule-list, scheduled-task` because it mixes a routing flag with a label.

## Output Expectations

Return only the compact execution summary requested by the dispatcher flow. Avoid board dumps and avoid re-deriving routing state from the full board payload when `cockpit_list_routing_cards` already gives the candidate set.