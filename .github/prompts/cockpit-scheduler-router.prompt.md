---
description: "Dispatcher prompt for routing Cockpit Todo cards with the compact routing MCP tool."
---

[AGENT]
Task Source:
- Cockpit Todo ID: [COCKPIT_TODO_ID]
- Title: [COCKPIT_TITLE]
- Description: [SYNTHESIZED_FINAL_PLAN]

Execution Goal:
- Inspect Cockpit cards, not external tracker tasks.
- Use `cockpit_list_routing_cards` first, then `cockpit_get_todo` only for matching cards.
- Use `needs_review_mode=plan-only`.
- Apply mutations deterministically.
- Prefer the latest actionable user comment for intent and cron overrides.
- Use flags for single review-state handoff and labels for multi-value topic or routing tags.
- When the card references a scheduled task, verify task lifecycle with scheduler MCP tools instead of inferring it from comments alone.
- Prefer `cockpit_closeout_todo` for final execution handoff so comment, review-state update, section fallback, and stale task-link cleanup stay atomic.

Required Output:
- What was changed
- Files touched
- Validation performed
- Remaining risks or follow-ups

Completion Update:
- Add a Cockpit comment summarizing the result.
- Update flags, labels, linked `taskId`, and section to match the final outcome.
- If the linked scheduler task was removed or no longer exists, clear the stale `taskId`.

Notes:
- Treat canonical workflow flags as the routing state. Use labels for categorization and treat comment labels as context only.
- Ignore `Scheduled as ...`, `Done`, label-maintenance notes, dispatcher status comments, and scheduler status comments.
- Prefer existing review-state flags such as `needs-user-review` or `FINAL-USER-CHECK` over inventing new label-only review markers.
- Return only the compact execution summary requested by the dispatcher.