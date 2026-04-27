# Todo Cockpit Current-State Reference

This file documents the current Todo Cockpit feature set as implemented in the extension today.

It is not a roadmap and it is not meant to preserve older behavior. Where README wording, help copy, old notes, or earlier mental models differ from the live implementation, this file treats the implementation and localized UI strings as the source of truth.

Source basis used for this document:

- README.md top-level Copilot Cockpit workflow and MCP guidance
- How To / Help copy in src/i18n.ts and src/cockpitWebviewStrings.ts
- Board defaults, normalization, and semantic validation in src/cockpitBoard.ts
- Todo lifecycle, recurring-task card syncing, and filter persistence in src/cockpitBoardManager.ts
- Todo board/editor UI in src/cockpitWebview.ts and src/cockpitWebviewStrings.ts
- Todo host actions in src/todoCockpitActionHandler.ts
- Routing-card logic in src/cockpitRouting.ts
- MCP tool registration and dispatch in src/server.ts

## 1. What Todo Cockpit Is

Todo Cockpit is the repo-local planning, review, and approval surface inside Copilot Cockpit.

It is intentionally separate from scheduled execution:

- Todo cards are planning and coordination artifacts.
- Scheduled tasks are execution artifacts.
- Jobs are ordered multi-step execution workflows.
- Research profiles are bounded optimization loops.

The intended flow is Todo first, scheduled execution second. Users and agents can capture work on a card, comment on it, label it, move it through review, and only then hand it off into downstream execution.

## 2. Storage, Privacy, and Scope

Todo Cockpit is local-first and repo-scoped.

- Workspace scheduler state lives in `.vscode/scheduler.json` and `.vscode/scheduler.private.json`.
- Todo Cockpit state belongs to the private workspace state, not the shared task file.
- In `copilotCockpit.storageMode=sqlite`, the runtime authority can move into `.vscode/copilot-cockpit.db`, while the extension still keeps compatibility JSON mirrors and a workspace migration journal.
- The extension bootstraps repo-local ignore rules so private cockpit state, prompt backups, uploads, and support files do not leak accidentally.
- The design assumption remains local, repo-scoped, and primarily single-user.

This boundary matters because a todo can outlive a linked task, a task can exist without replacing the todo that produced it, and recurring scheduled work can keep its own persistent board history card.

## 3. Board Model and Default Structure

When the board is first created, it is seeded with named sections.

Default visible working sections:

- Unsorted
- Bugs
- Features
- Ops/DevOps
- Marketing/Growth
- Automation
- Future

System sections:

- Recurring Tasks
- Archive: Completed
- Archive: Rejected

Important structure rules:

- Unsorted is guaranteed to exist.
- The archive sections are guaranteed to exist.
- The Recurring Tasks section is a dedicated system section for recurring scheduled-task history cards.
- Archive sections are protected from normal rename, delete, and reorder flows.
- Recurring-task cards are hidden by default unless the user enables `showRecurringTasks`.
- If a non-archive section is deleted, its cards are reassigned to a fallback section.
- Section order is persisted.
- Section add and rename flows reject names that collide with protected routing flag semantics such as deprecated or protected token names.

## 4. Todo Card Data Model

Each todo card can carry:

- Stable todo ID
- Title
- Optional description
- Section ID
- Manual order within a section
- Priority
- Optional due date/time
- Workflow status
- Labels
- Flags
- Comment history
- Optional linked task ID
- Optional task snapshot for scheduled-task history cards
- Optional GitHub source metadata for imported GitHub issues, pull requests, or security alerts
- Optional session ID
- Archived state
- Optional archive outcome
- Created timestamp
- Updated timestamp
- Approved timestamp
- Completed timestamp
- Rejected timestamp
- Archived timestamp

Comment records carry:

- Comment ID
- Author
- Body
- Optional comment labels
- Source type
- Sequence number
- Created timestamp

Supported comment sources:

- human-form
- bot-mcp
- bot-manual
- system-event

## 5. Labels, Flags, and Routing Semantics

Todo Cockpit distinguishes labels from flags deliberately.

Labels:

- Multi-value
- Categorization and workflow metadata
- Rendered as pill-shaped chips
- Managed through a shared label catalog with optional colors

Flags:

- Routing and review-state markers
- Usually a small explicit set per card
- Rendered as squared chips
- Managed through a shared flag catalog with optional colors

Important behavioral rules:

- Most handoff flows should use one explicit review-state flag such as `needs-user-review` or `needs-bot-review`.
- Live scheduled cards use the built-in `ON-SCHEDULE-LIST` flag.
- `labels`, `flags`, and `comments[].labels` are distinct surfaces.
- Routing-card queries match canonical workflow flags only; actionable user comments remain context, not routing state.
- Deleting a shared label or flag definition also strips it from existing cards.
- Built-in protected flags cannot be deleted.

## 6. Status and Workflow Model

Supported todo statuses:

- active
- completed
- rejected

Supported active workflow flags:

- new
- needs-bot-review
- needs-user-review
- ready
- ON-SCHEDULE-LIST
- FINAL-USER-CHECK

Supported archive outcomes:

- completed-successfully
- rejected

The current workflow is:

1. A new card normally starts as `active`.
2. The live handoff state is represented by one canonical workflow flag on active cards.
3. `Approve` moves the card to the `ready` workflow flag and stamps `approvedAt`.
4. Creating or linking a live scheduled task moves the card to `ON-SCHEDULE-LIST`.
5. `Final Accept` or `Complete & Archive` archives the card as `completed-successfully`.
6. A final review handoff can use `FINAL-USER-CHECK` before archival.
7. `Decline` or the archive path of `Delete` archives the card as `rejected`.
8. `Restore` can reopen an archived card.
9. Permanent purge is a separate destructive removal path.

Workflow side effects include:

- System-event comments are appended for important transitions.
- Finalized cards move to `Archive: Completed`.
- Rejected cards move to `Archive: Rejected`.
- Archived cards become review-oriented instead of normal active-edit items.

Examples of system-generated workflow comments:

- Approved and marked ready for follow-up.
- Completed and moved to the completed archive.
- Rejected and moved to the rejected archive.

## 7. Priority Model

Supported priorities:

- none
- low
- medium
- high
- urgent

Priority is both metadata and a visual signal.

For scheduled-task history cards, priority can be derived automatically from the next execution time:

- urgent when due very soon
- high when due within a few hours
- medium when due within roughly a day
- low otherwise

## 8. Board UI Features

Todo Cockpit supports both management and review directly in the board surface.

### 8.1 View modes

The board can render in:

- Board view
- List view

Board view emphasizes sections as columns. List view emphasizes compact scanning of grouped cards. The selected view mode is persisted in board filters.

### 8.2 Filters and search

The board has a persisted filter state with a collapsible filter bar.

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
- Show recurring tasks
- Hide card details

Search intent is broad discovery across:

- Title
- Description
- Labels
- Comments

### 8.3 Sorting

Supported sort keys:

- manual
- dueAt
- priority
- updatedAt
- createdAt

Supported sort directions:

- asc
- desc

### 8.4 Visibility controls

Archived cards are hidden by default.

Users can enable archived visibility to:

- Review completed work
- Review rejected work
- Inspect history and outcomes

Recurring scheduled-task history cards are also hidden by default and are revealed with the `showRecurringTasks` toggle.

The `hideCardDetails` toggle suppresses longer previews such as descriptions and latest comments for denser scanning.

### 8.5 Section management

The board supports:

- Add section
- Rename section
- Delete section
- Move section left
- Move section right
- Drag-reorder section
- Collapse section
- Expand section

Archive sections stay protected from normal destructive or reorder flows.

### 8.6 Drag and drop

The board supports pointer-driven drag behavior for cards and sections.

Supported drag behaviors:

- Reorder cards within a section
- Move cards across sections
- Reorder sections

Notable implementation characteristics:

- Cards use custom drag-start handling instead of raw browser drag behavior.
- Interactive controls are excluded from drag start.
- Pointer drag state suppresses accidental text selection while dragging.

### 8.7 Layout and summary affordances

The board includes:

- Per-section collapse state
- A column-width slider
- Board summary and count information
- Per-section card counts

This makes the board both a work surface and a lightweight dashboard.

### 8.8 GitHub inbox and imports

When the optional repo-local GitHub integration is configured, the board adds a cached GitHub inbox above the normal sections.

Current behavior:

- The inbox is collapsible.
- It exposes three lanes: `Issues`, `Pull Requests`, and `Security Alerts`.
- Security alerts currently aggregate the supported code scanning and Dependabot alert reads.
- Refresh is manual and uses cached repo-local state rather than live push updates.
- Each inbox row can `Create Todo` or `Create Todo + Review`.
- Imported cards persist structured GitHub source metadata so later imports reuse and refresh the same Todo when the source item matches instead of creating duplicates.

## 9. Card Presentation Features

Cards surface compact metadata in both board and list renderers.

Displayed cues include:

- Title
- Priority label
- Status label
- Due date when present
- Archive outcome when archived
- Flag chips
- A subset of label chips for compact display
- Description preview
- Latest comment preview
- Linked-task indication
- Missing-linked-task warning when the referenced task no longer exists in the task list

The board also exposes compact actions such as edit, delete, decline, restore, and completion-oriented controls depending on state.

## 10. Todo Editor Features

Todo Cockpit has a dedicated editor flow for both create and edit operations.

### 10.1 Main fields

The editor supports:

- Title
- Description
- Due date
- Priority
- Section
- Linked task
- Labels
- Flags

### 10.2 Comments

The editor includes a comment history panel and inline add-comment flow.

Comment capabilities:

- View existing comments in sequence order
- Add a new comment
- Preserve provenance through author and source fields
- Attach labels to comments when needed

Comments are the coordination log for feedback, approvals, bot notes, and workflow transitions.

### 10.3 Upload files

The editor includes an `Upload Files` flow.

Current behavior:

- Opens a file picker from the host side
- Copies selected files into `.vscode/cockpit-input-uploads`
- Ensures the private config ignore rules cover that folder
- Inserts workspace-local relative paths back into the todo description

This keeps the todo self-contained without storing outside absolute file paths.

### 10.4 Linked-task support

Each card can reference a linked scheduled task.

Linked-task capabilities:

- Select a task from the current task list
- Clear the link
- Show when no task is linked yet
- Warn when the linked task is missing from the current task list

### 10.5 Label catalog

Label capabilities in the editor include:

- Add labels by typing
- Add labels with Enter or the add button
- Show label chips on the card
- Suggest reusable labels
- Save shared label definitions with color
- Edit shared label definitions
- Delete shared label definitions

Todo label suggestions merge board-owned label knowledge with reusable task-derived labels surfaced in the UI.

### 10.6 Flag catalog

Flag capabilities in the editor include:

- Set the current card flags
- Clear flags
- Add a new flag definition
- Save shared flag definitions with color
- Edit shared flag definitions
- Delete shared flag definitions when not protected
- Pick from the saved flag palette

### 10.7 Editor actions

Available actions vary by card state, but the editor and board flow together expose:

- Create Todo
- Save Todo
- Add Comment
- Create Task Draft
- Approve
- Final Accept
- Complete & Archive
- Decline
- Restore
- Delete Todo
- Back to Cockpit

Important behavior:

- Archived cards are not normal active-edit records.
- `Restore` is the supported reopen path.
- `Delete` in the normal board flow presents archive-reject versus permanent-delete choices rather than silently hard-deleting.

## 11. Todo Creation Behavior

Creating a todo can include more than a title.

A new card may include:

- Title
- Description
- Section
- Priority
- Labels
- Flags
- Optional GitHub source metadata
- Initial comment
- Initial comment author
- Initial comment source
- Initial workflow status
- Linked task ID
- Session ID

Creation behavior:

- Blank titles normalize to `Untitled todo` in the lower-level board API.
- Creating a card directly in `ready` stamps `approvedAt` immediately.
- Creating a card from the GitHub inbox can reuse and update an existing GitHub-sourced card instead of creating a second one.
- If the new card would be hidden by the current filters, the action handler can reveal it by clearing conflicting filters.
- After create, the board UI refreshes and returns to the board tab.

## 12. Workflow Actions in Detail

### 12.1 Approve

Approve moves a non-archived card from `active` to `ready`.

Side effects:

- `status` becomes `ready`
- `approvedAt` is set
- A system comment is appended

### 12.2 Final Accept / Complete & Archive

Finalize archives the card as `completed-successfully`.

Side effects:

- `archived` becomes true
- `archiveOutcome` becomes `completed-successfully`
- `status` becomes `completed`
- `completedAt` and `archivedAt` are stamped
- The card moves to `Archive: Completed`
- A system comment is appended

### 12.3 Decline / Reject

Decline archives the card as `rejected`.

Side effects:

- `archived` becomes true
- `archiveOutcome` becomes `rejected`
- `status` becomes `rejected`
- `rejectedAt` and `archivedAt` are stamped
- The card moves to `Archive: Rejected`
- A system comment is appended

### 12.4 Delete versus purge

Delete is not the same as permanent removal.

- The normal delete flow can reject and archive the card.
- Permanent purge removes the card from the board entirely.
- Purge is the only fully destructive removal path.
- Tombstones are retained so stale writes cannot resurrect a purged card.

### 12.5 Restore

Restore reopens an archived card instead of creating a replacement card.

This matters because the board preserves the same card identity and history instead of duplicating work during closeout or review loops.

## 13. Scheduled-Task Integration Inside Todo Cockpit

Todo Cockpit is aware of scheduled tasks, but it does not collapse them into the same artifact model.

### 13.1 Recurring-task history cards

Recurring scheduled tasks can keep one persistent history card in the dedicated `Recurring Tasks` section.

Current behavior:

- `cockpit_seed_todos_from_tasks` and the board sync logic ensure recurring tasks have linked history cards.
- The created recurring card uses the recurring system section rather than `Unsorted`.
- The card stores a task snapshot and records future schedule, prompt, model, and label changes through system comments.
- The card is labeled with `scheduled-task` and `recurring-task`.
- The card keeps the built-in system flag `ON-SCHEDULE-LIST`.
- The card can include a system comment for an existing task error.

### 13.2 One-time task behavior

One-time tasks do not stay in the recurring history section.

When a linked recurring task becomes one-time:

- The card is moved out of `Recurring Tasks`
- The card is kept as the linked planning record
- The `recurring-task` label is dropped
- The scheduled-task flag pair is preserved as appropriate for the live scheduled item
- A system comment explains the transition

### 13.3 Existing task linkage versus todo-first planning

The board can surface scheduled-task context without treating scheduled tasks as replacements for todos.

The practical split is:

- Todo stays the planning and approval record.
- The scheduled task stays the execution record.
- Recurring tasks get persistent history cards.
- One-time work usually stays linked to its originating todo.

## 14. Create Task Draft From Todo

Todo Cockpit can generate a downstream scheduled task draft directly from a card.

Current `Create Task Draft` behavior:

- Uses the todo title as the task name
- Uses the todo description as the task description
- Builds an inline prompt from the todo content
- Includes recent coordination comments in the generated prompt
- Preserves GitHub context for GitHub-sourced todos and carries it into the generated prompt
- Uses the default cron expression `0 9 * * 1-5`
- Creates the task disabled by default
- Creates the task as one-time by default
- Preserves existing todo labels and adds `from-todo-cockpit`
- Writes the created task ID back to the todo
- Switches the UI to the task list and focuses the new task

Generated prompt structure currently includes:

- A task goal line
- An optional context block from the description
- A recent coordination block from recent comments
- GitHub context, the saved GitHub automation prompt, and PR branch/security preflight for GitHub-sourced todos
- A final instruction to produce the approved execution artifact and keep unresolved questions explicit

## 15. Create Task Tab In The Downstream Workflow

The Create Task tab is downstream from Todo Cockpit, not a replacement for it.

It is used when the user already knows the execution unit they want to schedule.

Relevant Create Task capabilities include:

- Task name and labels
- Prompt source selection
- Inline prompt editing or template selection
- Skill insertion
- Cron preset and raw cron editing
- Friendly schedule builder
- Agent and model selection
- Scope, jitter, Run First, One-Time, and chat session options
- Create, Save, New, and Test Prompt actions

The built-in help still positions the intended order as Todo first, Create Task second.

## 16. How To And README Alignment

The help surface and README already capture the broad mental model correctly:

- Todo Cockpit is the communication and approval hub.
- Tasks are downstream execution units.
- Jobs and research are separate orchestration surfaces.
- MCP is optional but powerful.
- Storage stays repo-local and private by default.

Implementation-aligned clarifications that matter here:

- The current workflow is `Approve -> ready -> Final Accept / Complete & Archive -> completed-successfully archive`.
- `Decline` and the reject branch of `Delete` archive a card as rejected.
- `Restore` is a first-class reopen path.
- Recurring scheduled work is represented through a dedicated hidden recurring section, not only by seeding cards into `Unsorted`.

## 17. MCP Integration Overview

Copilot Cockpit bundles an embedded MCP server, but Todo Cockpit MCP tools are opt-in per workspace.

Important facts:

- The runtime server is bundled with the extension.
- Workspace MCP setup does not point directly at the installed extension every time.
- The workspace entry points to a stable repo-local launcher in `.vscode/copilot-cockpit-support/mcp/launcher.js`.
- That launcher resolves the currently installed Copilot Cockpit runtime.
- This stable launcher path allows unreloaded VS Code windows to keep starting MCP services across extension updates.

## 18. MCP Setup And Validation

Recommended setup path:

1. Open the workspace in VS Code.
2. Open Copilot Cockpit.
3. Go to `How To Use`.
4. Click `Set Up MCP`.

Alternative path:

1. Run `Copilot Cockpit: Set Up Workspace MCP`.

What setup does:

- Ensures `.vscode` exists
- Ensures the repo-local MCP support directory exists
- Writes or refreshes `.vscode/copilot-cockpit-support/mcp/launcher.js`
- Writes or refreshes the corresponding launcher state file
- Creates `.vscode/mcp.json` if missing
- Merges or repairs the `scheduler` server entry if the file already exists
- Preserves unrelated MCP server entries already present in the file
- Backs up invalid JSON before repairing it

Expected generated scheduler entry shape:

```json
{
    "servers": {
        "scheduler": {
            "type": "stdio",
            "command": "node",
            "args": [
                "<absolute workspace path>/.vscode/copilot-cockpit-support/mcp/launcher.js"
            ]
        }
    }
}
```

Practical checks:

- `.vscode/mcp.json` exists
- `servers.scheduler` exists
- `type` is `stdio`
- `command` is `node`
- `args[0]` points at the repo-local launcher path
- The launcher and launcher state files actually exist

Secret-handling guidance:

- Do not put live third-party secrets directly into `.vscode/mcp.json`
- Use top-level `inputs` with `promptString` and `password: true`
- Reference them via `${input:NAME}` placeholders

## 19. Todo Cockpit MCP Tool Surface

The current Todo Cockpit MCP tools exposed by the server are:

- `cockpit_get_board`
- `cockpit_list_todos`
- `cockpit_get_todo`
- `cockpit_list_routing_cards`
- `cockpit_create_todo`
- `cockpit_add_todo_comment`
- `cockpit_approve_todo`
- `cockpit_finalize_todo`
- `cockpit_reject_todo`
- `cockpit_update_todo`
- `cockpit_closeout_todo`
- `cockpit_delete_todo`
- `cockpit_move_todo`
- `cockpit_set_filters`
- `cockpit_seed_todos_from_tasks`
- `cockpit_save_label_definition`
- `cockpit_delete_label_definition`
- `cockpit_save_flag_definition`
- `cockpit_delete_flag_definition`

What these cover:

- Reading the full board
- Reading cards by list or detail
- Reading routing-relevant cards without scanning the full board payload
- Creating cards
- Updating cards
- Appending comments
- Moving cards
- Approving, finalizing, rejecting, and closeout flows
- Updating persisted filters
- Seeding recurring-task history cards from tasks
- Managing shared label and flag palettes

Important limitation of the current MCP surface:

- Section add, rename, delete, and reorder flows exist in the UI and host action layer, but they are not part of the currently registered Todo Cockpit MCP tools.

## 20. MCP Semantics That Matter In Practice

Several semantics are easy to misuse if you treat the tool names too casually.

- `cockpit_delete_todo` archives a card via the reject path in the MCP server. It is not the permanent purge path.
- `cockpit_closeout_todo` is the deterministic handoff helper for execution results. It can update status and flags, add one summary comment, respect missing sections, and clear stale linked task IDs when the scheduler task no longer exists.
- `cockpit_list_routing_cards` is the preferred routing preflight surface because it matches labels, flags, and actionable user-comment labels case-insensitively.
- Requested closeout sections are validated. If the preferred section does not exist, the card stays where it is and the response reports that fact.
- Closeout does not recreate missing cards.

## 21. Practical Workflow Summary

An implementation-aligned workflow looks like this:

1. Capture work in Todo Cockpit.
2. Add context in the description, comments, and uploaded workspace-local inputs if needed.
3. Categorize with labels and set an explicit review-state flag when handoff matters.
4. Move the card into the appropriate section.
5. Approve it when the plan is ready.
6. Either create a downstream task draft, keep it active for more review, or finalize it into the completed archive.
7. Use deterministic MCP closeout when execution has happened elsewhere and the board needs a verified summary update.

## 22. Common Mistakes To Avoid

- Do not treat todo cards and scheduled tasks as interchangeable records.
- Do not assume all task-linked cards live under `Unsorted`; recurring scheduled work has a dedicated hidden section.
- Do not use labels as a substitute for review-state or routing flags.
- Do not collapse `labels`, `flags`, and `comments[].labels` into one bucket.
- Do not assume `cockpit_delete_todo` is a hard delete.
- Do not recreate a missing card during closeout; use the existing originating card or stop.
- Do not patch `.vscode/scheduler.private.json` directly unless you are on an explicit last-resort recovery path.

## 23. Bottom Line

Todo Cockpit currently provides:

- A repo-local board for planning, review, and approval
- A dedicated todo editor with comments, uploads, labels, flags, due dates, sections, and task links
- Board and list views with filters, sorting, visibility toggles, counts, drag-drop, and section controls
- A staged approval and archive workflow with restore and purge distinctions
- Persistent recurring-task history cards for recurring scheduled work
- Downstream task-draft generation from approved planning context
- An opt-in MCP surface for agent-driven inspection, routing, closeout, and mutation

That makes Todo Cockpit the human-and-agent coordination layer, while scheduled execution remains a separate downstream step by design.
