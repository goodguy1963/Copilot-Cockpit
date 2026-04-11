# Todo Cockpit Notes

## Core Role

- Todo Cockpit is the durable approval and communication surface.
- Do not let transient execution trackers replace the board as the system of record.
- Preserve the board as the user-facing memory of why work exists, where it sits, and what still needs approval.

## Anti-Duplicate Rules

- Avoid duplicate cards; update an existing card when the work is the same thread.
- Search first by title, section, label, or stable marker before creating a new card.
- Prefer stable prefixes or description markers for recurring workflows.

## Labels, Flags, And Comments

- Use labels for categories, ownership hints, and broad reporting.
- Use one canonical active workflow flag for routing.
- Keep implementation detail, user decisions, and approval context in comments when they matter for future approvals.

## State Hygiene

- Preserve the existing section, labels, and comments unless the request explicitly changes them.
- Update due dates, priorities, and routing flags instead of recreating the same work as a new card.
- Link tasks or drafts when execution begins, but keep the card as the durable approval thread.

## Boundaries

- Do not use direct file edits as the normal way to change board state when MCP tools exist.
- Do not treat scheduler links or transient session todo lists as the durable backlog.