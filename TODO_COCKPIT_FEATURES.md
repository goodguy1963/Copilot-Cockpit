# Todo Cockpit Feature Reference

This file documents the current Todo Cockpit feature set in detail, including the Create Task tab, the How To guidance, README guidance, and the current MCP setup/check workflow.

Source basis used for this document:

- README.md top-level Copilot Cockpit guidance
- How To / Help tab copy in src/i18n.ts and src/schedulerWebviewStrings.ts
- Todo Cockpit board model and defaults in src/cockpitBoard.ts
- Todo mutation and persistence logic in src/cockpitBoardManager.ts and src/todoCockpitActionHandler.ts
- Todo UI and Create Task UI in src/schedulerWebview.ts and media/schedulerWebviewBoardRendering.js
- MCP tool registration and MCP config handling in src/server.ts and src/mcpConfigManager.ts

Where README/help wording and implementation differ, this file treats the implementation as the current source of truth.

## 1. What Todo Cockpit Is

Todo Cockpit is the repo-local planning, approval, and coordination surface inside Copilot Cockpit.

It is intentionally separate from scheduled task execution:

- Todos are planning and coordination artifacts.
- Tasks are execution artifacts.
- Jobs are multi-step execution workflows.
- Research profiles are bounded optimization loops.

Todo Cockpit is the place where work is first captured, clarified, reviewed, approved, commented on, and optionally converted into downstream execution artifacts.

## 2. Storage, Privacy, and Scope

Todo Cockpit data is local-first and repo-scoped.

- Todo Cockpit state is stored in .vscode/scheduler.private.json.
- It is not intended to be shared through git.
- Scheduled tasks live separately in .vscode/scheduler.json.
- The extension bootstraps private storage boundaries so planning data and secrets do not leak accidentally.
- The design assumption is a local, single-user, repo-specific planning surface.

This split matters because a todo can survive independently from its linked task, and a task can exist without replacing the planning card that led to it.

## 3. Default Board Structure

When the board is first created, it is seeded with named sections.

Default working sections:

- Unsorted
- Bugs
- Features
- Ops/DevOps
- Marketing/Growth
- Automation
- Future

Default archive sections:

- Archive: Completed
- Archive: Rejected

Important board structure rules:

- Unsorted is guaranteed to exist.
- Archive sections are also guaranteed to exist.
- Archive sections are special-purpose system sections.
- Archive sections are protected from normal section rename/delete/reorder flows.
- If a non-archive section is deleted, its cards are reassigned to a fallback section.
- If Unsorted itself is deleted, cards are reassigned to the first remaining non-deleted section.
- Section order is persisted.

## 4. Todo Data Model

Each todo card can store the following fields:

- Stable todo ID
- Title
- Description
- Section ID
- Manual order within a section
- Priority
- Due date/time
- Workflow status
- Labels
- Flag
- Comment history
- Linked scheduled task ID
- Optional session ID
- Archived state
- Archive outcome
- Created timestamp
- Updated timestamp
- Approved timestamp
- Completed timestamp
- Rejected timestamp
- Archived timestamp

The card also supports comment metadata:

- Comment ID
- Author: user or system
- Comment body
- Optional labels attached to the comment
- Source type
- Sequence number
- Created timestamp

Supported comment source values:

- human-form
- bot-mcp
- bot-manual
- system-event

## 5. Status and Workflow Model

Supported todo statuses:

- active
- ready
- completed
- rejected

Supported archive outcomes:

- completed-successfully
- rejected

Current implementation workflow:

1. New cards usually start as active.
2. Approve changes the card to ready.
3. Final Accept / Complete archives the card as completed-successfully.
4. Reject / Delete archives the card as rejected unless the user chooses permanent purge.

Workflow side effects:

- Approving stamps approvedAt.
- Finalizing stamps completedAt and archivedAt.
- Rejecting stamps rejectedAt and archivedAt.
- Archive actions move the card into the matching archive section.
- System-event comments are added for workflow transitions.

Examples of system-generated workflow comments:

- Approved and marked ready for follow-up.
- Completed and moved to the completed archive.
- Rejected and moved to the rejected archive.

## 6. Priority Model

Supported priorities:

- none
- low
- medium
- high
- urgent

Priority is used both as metadata and as a visual signal in list/board rendering.

When existing scheduled tasks are seeded into the board, their priority is derived automatically from the next execution time:

- urgent if due very soon
- high if due within a few hours
- medium if due within roughly a day
- low otherwise

## 7. Core Board Features

Todo Cockpit supports both management and review workflows directly in the main board tab.

### 7.1 Board and list views

The board can be rendered in two modes:

- Board view
- List view

Board view emphasizes sections as columns.

List view emphasizes compact scanning of cards grouped by section.

The current view mode is persisted in board filters.

### 7.2 Search and filter bar

The board has a persistent filter state with a collapsible filter bar.

Supported filter fields:

- Search text
- Section
- Label
- Flag
- Priority
- Status
- Archive outcome
- Sort by
- Sort direction
- View mode
- Show archived

Search behavior is intended to cover:

- Title
- Description
- Labels
- Flags

The UI placeholder also describes comments as part of search intent, so the board presents search as a broad discovery mechanism.

Filter state is stored in the board record and survives rerenders.

### 7.3 Sort options

Supported sort keys:

- manual
- dueAt
- priority
- updatedAt
- createdAt

Supported sort directions:

- asc
- desc

### 7.4 Archived visibility

Archived cards are hidden by default.

Users can enable archived visibility to:

- Review completed items
- Review rejected items
- Inspect history and outcomes

Archived items are treated as read-only in the editor flow.

### 7.5 Section management

The board supports section management directly from the UI.

Available section actions:

- Add section
- Rename section
- Delete section
- Move section left
- Move section right
- Drag-reorder section
- Collapse section
- Expand section

Section deletion behavior:

- Archive sections cannot be deleted.
- The last remaining section is not removed.
- Cards in the deleted section are reassigned to a fallback section.

Section reordering behavior:

- Archive sections are protected from normal reordering.
- Reorder operations clamp to valid indexes.

### 7.6 Drag and drop

The board supports pointer-driven drag behavior for cards and sections.

Supported drag behaviors:

- Reorder cards within a section
- Move cards across sections
- Reorder sections

Notable implementation details:

- Cards are marked draggable=false and use custom drag-start handling.
- Drag begins from the card body after a movement threshold or from dedicated drag handles.
- Interactive controls are excluded from drag-start logic.
- Pointer drag state suppresses accidental text selection while dragging.

### 7.7 Section collapse

Sections can be collapsed and expanded.

This exists in both board/list rendering layers and is meant to improve scanability for large boards.

### 7.8 Column width control

The board includes a column-width slider so dense boards can be widened or compacted without changing the underlying data.

### 7.9 Summary and counts

The UI shows board summary/count information and per-section card counts.

Cards and sections therefore work as both content containers and lightweight dashboard elements.

## 8. Card Presentation Features

Cards surface compact metadata in both list and board renderers.

Displayed card cues include:

- Title
- Priority label
- Status label
- Due date when present
- Archive outcome when archived
- Flag chip
- Up to a small number of label chips for compact display
- Description preview
- Latest comment preview
- Linked task indication

The renderer also exposes compact action buttons for:

- Edit
- Delete

The list renderer includes completion-oriented affordances and drag handles where appropriate.

## 9. Todo Editor Features

Todo Cockpit has a dedicated editor/create tab for cards.

This editor is used for both:

- Creating a new todo
- Editing an existing todo

### 9.1 Main fields

The editor supports:

- Title
- Description
- Due date
- Priority
- Section
- Linked scheduled task
- Labels
- Flag

### 9.2 Comment history and commenting

The editor includes a comment history panel and an inline add-comment flow.

Commenting capabilities:

- View existing comments in sequence order
- Add a new comment
- Preserve provenance through comment source types
- Store labels implied by a comment

Comments are an important coordination layer because they preserve reasoning, approvals, feedback, and system events without turning the main description into a running log.

### 9.3 Linked task support

Each card can reference a linked scheduled task.

Linked-task features:

- Select a linked scheduled task from the current task list
- Clear the link
- Show a note if no task is linked yet
- Indicate when a linked task cannot be found in the task list anymore

This allows the todo to remain the planning artifact while the task becomes the execution artifact.

### 9.4 Labels

Labels are multi-value workflow tags.

Label capabilities in the editor:

- Add labels by typing
- Add labels with Enter/add button
- Show label chips on the current card
- Suggest reusable labels
- Save shared label definitions with color
- Edit shared label definitions
- Delete shared label definitions
- Display shared label catalog entries

Important label behavior:

- Labels are multi-value.
- Shared label definitions are stored in a board-owned label catalog.
- Deleting a board-owned label definition also strips that label from existing todo cards.
- Todo label suggestions/catalog merge board catalog knowledge with task-derived label reuse in the UI.

### 9.5 Flags

Flags represent a single agent-state indicator.

Flag capabilities in the editor:

- Set the current flag
- Clear the current flag
- Add a new flag name
- Save shared flag definitions with color
- Edit shared flag definitions
- Delete shared flag definitions
- Pick from the saved flag palette

Important flag behavior:

- Only one flag is kept per card.
- If multiple flags are provided through MCP or updates, only the first is retained.
- Deleting a flag definition strips that flag from existing todo cards.

### 9.6 Editor actions

The editor exposes different actions depending on mode and card state.

Available actions include:

- Create Todo
- Save Todo
- Create Task Draft
- Approve
- Complete & Archive
- Final Accept
- Delete Todo
- Back to Cockpit

Archived behavior:

- Archived cards are review-only.
- Archived cards are meant for outcome/history inspection, not active editing.

## 10. Todo Creation Behavior

Creating a todo can include more than a title.

A newly created todo may include:

- Title
- Description
- Section
- Priority
- Labels
- Flag
- Initial comment
- Initial comment author
- Initial comment source
- Initial workflow status
- Linked task ID
- Session ID

Creation-specific behavior:

- Blank or missing titles are normalized to Untitled todo when created through the lower-level board API.
- If the card is created with status ready, approvedAt is stamped immediately.
- If a creation would be hidden by current board filters, the action handler can clear conflicting filters so the new card becomes visible.
- After create, the UI is refreshed and the board view is re-opened.

## 11. Workflow Actions in Detail

### 11.1 Approve

Approve moves a non-archived card from active to ready.

Side effects:

- Status becomes ready.
- approvedAt is set.
- A system comment is appended.

### 11.2 Final Accept / Complete

Finalize archives the card as completed-successfully.

Side effects:

- Card is removed from the active card collection.
- Card is marked archived.
- archiveOutcome becomes completed-successfully.
- Status becomes completed.
- completedAt and archivedAt are stamped.
- Card is moved into Archive: Completed.
- A system comment is appended.

### 11.3 Reject / Delete

Reject archives the card as rejected.

Side effects:

- Card is marked archived.
- archiveOutcome becomes rejected.
- Status becomes rejected.
- rejectedAt and archivedAt are stamped.
- Card is moved into Archive: Rejected.
- A system comment is appended.

UI delete behavior is more nuanced than a simple hard delete:

- Users can reject/archive the card.
- Users can permanently purge the card.

### 11.4 Permanent purge

Permanent purge removes the card from the board entirely instead of archiving it.

This is the only destructive removal path for a todo.

## 12. Existing Scheduled Tasks Surfacing Into Todo Cockpit

Todo Cockpit can surface existing scheduled tasks as task-linked cards under Unsorted.

This feature exists so task execution artifacts are visible in the planning surface when they are not already linked to a planning card.

Seeding behavior:

- Only tasks without an existing linked todo are seeded.
- Seeded items go to Unsorted.
- Seeded items are labeled with scheduled-task.
- Seeded items are linked back to the original task ID.
- If a task has a recorded last error, the seeded todo includes a system comment describing that error.

This lets users review already-existing task drafts in the same approval surface as manually created todos.

## 13. Create Task Draft From Todo

Todo Cockpit can generate a downstream scheduled task draft directly from a todo.

Current behavior of Create Task Draft:

- Uses the todo title as the task name.
- Uses the todo description as task description.
- Builds an inline prompt from the todo content.
- Includes the most recent coordination comments in the generated prompt.
- Adds a default cron expression of 0 9 * * 1-5.
- Creates the task disabled by default.
- Adds a from-todo-cockpit label.
- Preserves existing todo labels on the new task.
- Stores the created task ID back on the todo.
- Switches the UI to the task list and focuses the newly created task.

The generated prompt structure currently includes:

- Task goal line
- Optional context block from description
- Recent coordination block from recent comments
- Final instruction telling the downstream run to produce the approved execution artifact and keep unresolved questions explicit

This reinforces the planning-to-execution handoff model.

## 14. Create Task Tab Features

The Create Task tab is not part of the Todo Cockpit board itself, but it is directly downstream from it and is part of the same user workflow. The How To tab explicitly positions Todo first and Create Task second.

### 14.1 Purpose

The Create Task tab is the compact editor for scheduled execution units.

It is intended for:

- Turning a known prompt into a scheduled run
- Setting runtime defaults and overrides
- Choosing prompt source and reuse strategy
- Testing a prompt before saving it as a task

### 14.2 Prompt and identity fields

The Create Task editor supports:

- Task name
- Task labels
- Prompt source selection
- Prompt body or template selection
- Skill insertion

Supported prompt source modes:

- inline
- local template
- global template

Inline mode:

- User types prompt content directly into the textarea.

Local template mode:

- Loads from repo-local prompt templates.
- README/help describes .github/prompts/ as the local template source.

Global template mode:

- Uses the user/global VS Code prompt template location.

Template management affordances:

- Template select dropdown
- Refresh templates button

Skill affordances:

- Skill select dropdown
- Insert Skill button
- Inline note explaining that skills are appended to prompts, not auto-applied just because the files exist

### 14.3 Schedule configuration

The Create Task tab supports both direct cron editing and a friendly builder.

Direct schedule controls:

- Cron preset dropdown
- Raw cron expression input
- Friendly preview text
- Open in Guru button

Friendly builder supported frequency modes:

- every-n
- hourly
- daily
- weekly
- monthly

Friendly builder supported fields:

- Interval
- Minute
- Hour
- Day of week
- Day of month

Friendly builder action:

- Generate cron expression

### 14.4 Runtime controls

Runtime controls include:

- Agent selection
- Model selection

Behavioral notes:

- Leaving agent/model blank means the task inherits the current VS Code or repo defaults.
- Setting them explicitly locks that task to a specific agent/model combination.
- The webview can refresh cached agent/model lists without rebuilding the entire UI.

### 14.5 Options controls

The Create Task tab includes task-level options for execution behavior.

Available options:

- Scope: workspace or global
- Jitter seconds
- Run First
- One-Time
- Chat session mode

Behavioral notes:

- Run First schedules an initial near-term run after save.
- One-Time causes the task to be deleted after one successful run.
- Chat session override applies to recurring tasks and can choose new or continue.
- Workspace scope and global scope determine where the task is persisted.

### 14.6 Create Task actions

Actions available in the editor:

- Create / Save task
- New task
- Test prompt

This means the tab supports both authoring and quick validation.

## 15. How To Tab Guidance Relevant To Todo Cockpit

The built-in How To tab explains the intended workflow order.

Key workflow guidance from the help surface:

1. Todo comes first as the communication hub.
2. Create Task comes second when work is ready to execute on its own.
3. Jobs are for chained steps.
4. Research is for bounded iteration.

Todo-specific help emphasis:

- Copilot can create cards through MCP.
- Copilot can update labels and flags through MCP.
- Copilot can move cards across sections through MCP.
- Copilot can leave comments through MCP.
- Users should review, give feedback, and approve work on the board before it becomes a scheduled task.

Create-tab help emphasis:

- Enter task name.
- Write prompt.
- Set cron schedule directly or with the friendly builder.
- Choose scope.
- Use Free Input, Local Template, or Global Template.
- Insert a skill when needed.
- Leave agent/model blank to inherit defaults or set them explicitly per task.
- Use Run First and One-Time when that behavior is intended.

## 16. README Alignment Notes

The README already captures the broad mental model correctly:

- Todos are for planning, communication, and approval.
- Tasks are downstream scheduled execution units.
- MCP is optional and powerful.
- Todo Cockpit lives in private repo-local state.

Important implementation-aligned clarification:

- The current implementation uses Approve -> ready.
- Final Accept / Complete performs the completed-successfully archive.
- Reject / Delete performs the rejected archive unless permanently purged.

If any README sentence suggests a different approval-to-archive transition, the code path in src/cockpitBoardManager.ts and src/todoCockpitActionHandler.ts reflects the current behavior.

## 17. MCP Integration: What It Is

Copilot Cockpit includes an embedded MCP server.

Important facts:

- The server is bundled with the extension.
- The server entrypoint is out/server.js inside the installed extension.
- MCP tools are not active by default in a workspace.
- A workspace launcher file such as .vscode/mcp.json must register the server.

README and How To both position MCP as optional because it materially expands what an agent can inspect and change.

## 18. MCP Setup: How To Enable It

Recommended setup path:

1. Open the workspace folder in VS Code.
2. Open Copilot Cockpit.
3. Go to How To Use.
4. Click Set Up MCP.

Alternative setup path:

1. Run the command Copilot Cockpit: Set Up Workspace MCP.

What the automatic setup does:

- Ensures .vscode exists.
- Creates .vscode/mcp.json if missing.
- Merges a scheduler server entry if the file already exists.
- Repairs invalid JSON by backing up the old file and writing a fresh valid config.

Expected generated server entry shape:

```json
{
    "servers": {
        "scheduler": {
            "type": "stdio",
            "command": "node",
            "args": [
                "<installed extension path>/out/server.js"
            ]
        }
    }
}
```

## 19. MCP Check: How To Verify It Is Correct

Use this checklist to verify MCP registration.

### 19.1 Quick user-level check

Confirm that:

- .vscode/mcp.json exists in the workspace
- It contains servers.scheduler
- servers.scheduler.type is stdio
- servers.scheduler.command is node
- servers.scheduler.args points to the installed extension's out/server.js

### 19.2 Extension-side logic check

The extension's MCP config manager treats the workspace as:

- configured when the scheduler entry exactly matches the expected installed-extension path
- missing when the entry is absent or mismatched
- invalid when the JSON file cannot be parsed as a plain JSON object

That means a stale path still counts as missing and should be repaired with Set Up MCP.

### 19.3 Practical recovery check

If MCP looks wrong:

1. Run Set Up MCP again.
2. Re-open .vscode/mcp.json.
3. Confirm the scheduler entry was updated.

If the file was invalid JSON beforehand:

- The extension creates a timestamped backup such as mcp.invalid-<timestamp>.json before rewriting.

### 19.4 Risk check

Before leaving MCP enabled, confirm you actually want agents to have this level of access.

Once visible to Copilot, MCP tools can allow an agent to:

- Read board state
- Read task state
- Modify todos
- Modify tasks
- Trigger executions
- Potentially chain into new AI sessions through downstream task behavior

## 20. Todo Cockpit MCP Tool Surface

Current Todo Cockpit MCP tools exposed by the server include:

- cockpit_get_board
- cockpit_list_todos
- cockpit_get_todo
- cockpit_create_todo
- cockpit_add_todo_comment
- cockpit_approve_todo
- cockpit_finalize_todo
- cockpit_reject_todo
- cockpit_update_todo
- cockpit_delete_todo
- cockpit_move_todo
- cockpit_set_filters
- cockpit_seed_todos_from_tasks
- cockpit_save_label_definition
- cockpit_delete_label_definition
- cockpit_save_flag_definition
- cockpit_delete_flag_definition

What these tools cover:

- Reading the whole board
- Reading filtered card lists
- Reading one card in detail
- Creating cards
- Updating cards
- Rejecting or finalizing cards
- Moving cards
- Appending comments
- Updating persisted filter state
- Seeding task-backed cards into the board
- Managing shared label palette entries
- Managing shared flag palette entries

Important limitation of the current MCP surface:

- Section add/rename/delete/reorder actions exist in the UI and extension action handler, but they are not part of the currently registered MCP tool surface in src/server.ts.

## 21. MCP Semantics For Labels and Flags

Todo MCP distinguishes labels from flags clearly.

Labels:

- Multi-value
- Workflow tags
- Displayed as pill-shaped chips
- Can have shared color definitions

Flags:

- Single-value
- Agent-state indicator
- Displayed as squared chips
- Only one is retained on a card at a time
- Can have shared color definitions

This distinction matters in both the UI and the MCP contract.

## 22. Practical Workflow Summary

A typical implementation-aligned workflow is:

1. Capture work in Todo Cockpit.
2. Add context in the description and comments.
3. Tag with labels and a single state flag.
4. Move it into the right section.
5. Approve it when the plan is good enough.
6. Either final-accept/archive it when complete, or convert it into a task draft if it should run on a schedule.
7. Use the Create Task tab when you need direct scheduled execution authoring instead of todo-first planning.

## 23. Common Mistakes To Avoid

- Do not treat Todo cards and scheduled tasks as interchangeable records. They are separate artifacts with separate MCP tool families.
- Do not assume multiple flags can be preserved on one card. Only one flag is retained at a time; use labels for multi-value categorization.
- Do not use labels as a substitute for agent routing or review-state handoff.
- Do not recreate a missing card as the default closeout behavior for a completed one-time execution. Prefer deterministic closeout on the originating card.
- Do not patch `.vscode/scheduler.private.json` directly after a partial MCP workflow unless you are on an explicit last-resort recovery path.
- Do not assume a requested section exists. Closeout flows should keep the card in its current section when the preferred section is unavailable.
- For verified implementation handoff that still needs user review, prefer `cockpit_closeout_todo` so one summary comment, one review-state flag, and stale task cleanup happen in a single supported path.

## 24. Bottom Line

Todo Cockpit currently provides:

- A repo-local board for planning and approvals
- A dedicated todo editor with comments, labels, flags, due dates, sections, and linked tasks
- Board/list review modes with filters, sorting, archived review, drag-drop, and section controls
- A clear approval/archive workflow
- Downstream handoff into scheduled tasks
- A Create Task tab for direct execution authoring
- An embedded but opt-in MCP surface for agent-driven inspection and mutation

That makes it both a human review surface and an agent coordination surface, while still keeping execution as a separate, explicit downstream step.
