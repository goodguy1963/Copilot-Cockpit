---
name: cockpit-scheduler-agent
description: "Use when an agent needs to manage scheduler tasks, Jobs workflows, job folders, pause checkpoints, compile-to-task, or research profiles through the scheduler MCP tools."
copilotCockpitSkillType: operational
copilotCockpitToolNamespaces: [scheduler, research]
copilotCockpitWorkflowIntents: [needs-bot-review, ready]
copilotCockpitApprovalSensitive: true
copilotCockpitPromptSummary: "Use scheduler_ and research_ MCP tools for task, job, pause, and research mutations instead of editing repo-local scheduler files by hand."
copilotCockpitReadyWorkflowFlags: [ready, ON-SCHEDULE-LIST]
copilotCockpitCloseoutWorkflowFlags: [needs-user-review, FINAL-USER-CHECK]
---

# Cockpit Scheduler Agent Skill

Use this skill when you want an agent to work with the scheduler MCP surface in a concept-first way instead of guessing tool names.

---

> **CRITICAL DISTINCTION — Tasks vs. Todo Cockpit cards**
>
> | Concept | What it is | Where it lives | Tool prefix |
> |---|---|---|---|
> | **Task** | A scheduled prompt execution entry | Workspace scheduler store, mirrored to `.vscode/scheduler.json` | `scheduler_` |
> | **Todo Cockpit card** | A planning / communication card on the board | Workspace Cockpit store, mirrored to `.vscode/scheduler.private.json` | `cockpit_` |
>
> **These are completely separate artifacts with entirely separate tool sets.**
> A task runs code on a schedule. A Cockpit card tracks intent, review state, and conversation.
> Creating a task does NOT create a card. Creating a card does NOT schedule execution.
> Never conflate the two. Never use `scheduler_` tools to manage board cards, and never use `cockpit_` tools to manage scheduled execution.

---

## Mental Model

- **Task** = one scheduled prompt execution entry in the workspace scheduler store
- **Job** = a workflow made of task nodes and pause checkpoints in the workspace scheduler store
- **Job folder** = organization only, no execution logic
- **Research profile** = a repo-local benchmark plan in the workspace research store
- **Research run** = a recorded benchmark execution result and history entry
- JSON mode uses `.vscode/scheduler.json`, `.vscode/scheduler.private.json`, and `.vscode/research.json` as the primary files.
- When the workspace setting `copilotCockpit.storageMode` is `sqlite`, the extension uses `.vscode/copilot-cockpit.db` as the primary runtime store, keeps compatibility JSON mirrors, and writes `.vscode/copilot-cockpit.db-migration.json`. MCP tool semantics stay the same.

## Required Preflight

Before mutating scheduler state, verify all of the following:

- The active workspace is the repo that actually owns the task or job being discussed.
- Any repo paths or production-chain references mentioned in the request exist in the current workspace.
- The required MCP tool exists in the current session before you plan around it.

If any of those checks fail, stop and report the blocker instead of mutating the repo-local scheduler/Cockpit mirrors or recreating records by hand.

## Mandatory MCP Capability Gate

This skill is MCP-dependent. Do not try to "work around" missing scheduler or research MCP tools.

- If the current agent cannot access the required `scheduler_` or `research_` MCP tool, do not solve the task by editing `.vscode` JSON files directly, inventing results, or pretending the mutation succeeded.
- First prefer a handoff or subagent path only when that target agent actually has the required MCP tools and is allowed to perform the mutation.
- Do not hand off a scheduler mutation to a read-only exploration agent or any agent that still lacks the required MCP surface.
- If no MCP-capable handoff target is available, tell the user plainly that the active agent lacks the required MCP tools and that they must switch to an MCP-enabled agent or grant the needed tool permissions.
- Only continue without MCP when the user explicitly wants analysis, documentation, or a plan instead of a live scheduler mutation.

## Task Modes

Use this distinction when deciding whether a user wants a one-time task or a recurring task.

### One-time task

- Runs once and then deletes itself automatically after a successful execution.
- Best for ad hoc actions, one-off cleanup, migration work, or a single AI-assisted response.
- Does not keep a recurring chat-session mode at the task level.
- Should be used when the user wants a single future execution rather than an ongoing schedule.
- **Todo Cockpit relationship:** A one-time task is almost always spawned from an approved todo card. That card is the planning record — do NOT create a new Cockpit card for the task itself. Use `scheduler_update_task` when the task needs changes. Use `cockpit_finalize_todo` on the originating card when the task completes.

### Recurring task

- Runs repeatedly on the cron schedule until the user disables or deletes it.
- Best for daily dispatchers, weekly checks, maintenance loops, and other repeatable automation.
- Can use the task-level chat session choice (`new` or `continue`).
- Manual runs should honor that same chat-session choice. `new` means start a fresh Copilot chat before execution. `continue` means reuse the current chat session instead of silently opening a new one.
- Can be reviewed on startup as an overdue task and either run now or wait for the next cycle.
- **Todo Cockpit relationship:** Every recurring task has one permanent card in the `Recurring Tasks` section of Cockpit. That card is never finalized. It is a living change log. When the task changes — prompt, schedule, model, or behavior — update the task with `scheduler_update_task` AND add a comment to its Cockpit card documenting what changed and why. Do NOT create a new card for each change.

### Practical rule

- If the user says "do this once", "one-off", "single run", or "run it one time", use a one-time task.
- If the user says "every day", "daily", "weekly", "keep running", or "recurring", use a recurring task.
- If the user wants a workflow with multiple steps, pauses, or a bundled output, use a job instead of a task.

## Tool Map

### Tasks
Use these when the goal is to create or manage one scheduled prompt.

Use task tools for both task modes, but pick the right behavior:

- one-time task -> create a task that should run once, delete itself automatically after success, and leave the originating todo card as the planning record
- recurring task -> create a task that should remain scheduled over time

- `scheduler_list_tasks` - inspect saved tasks
- `scheduler_get_task` - inspect one task
- `scheduler_add_task` - create a new task
- `scheduler_update_task` - edit a task in place
- `scheduler_duplicate_task` - make a disabled copy
- `scheduler_remove_task` - delete a task
- `scheduler_run_task` - trigger a task on the next tick
- `scheduler_toggle_task` - enable or disable a task
- `scheduler_list_history` - inspect scheduler snapshots
- `scheduler_restore_snapshot` - restore a saved scheduler snapshot
- `scheduler_get_overdue_tasks` - find due or missed tasks

### Jobs
Use these when the goal is a workflow made of multiple steps, pause checkpoints, or bundled execution.

- `scheduler_list_jobs` - inspect all jobs and folders
- `scheduler_get_job` - inspect one job with node summaries
- `scheduler_create_job` - create a new workflow shell
- `scheduler_update_job` - rename or reconfigure a job
- `scheduler_delete_job` - delete a job and detach its tasks
- `scheduler_duplicate_job` - clone a job workflow
- `scheduler_list_job_folders` - inspect job folders
- `scheduler_create_job_folder` - create a job folder
- `scheduler_update_job_folder` - rename or reparent a folder
- `scheduler_delete_job_folder` - delete an empty folder
- `scheduler_add_job_task` - attach an existing task to a job
- `scheduler_remove_job_task` - remove a task node from a job
- `scheduler_create_job_pause` - insert a manual checkpoint
- `scheduler_update_job_pause` - rename a pause checkpoint
- `scheduler_delete_job_pause` - remove a pause checkpoint
- `scheduler_update_job_node_window` - change a node window length
- `scheduler_reorder_job_node` - move a node in the workflow order
- `scheduler_compile_job_to_task` - bundle the whole job into one task and park the source job in Bundled Jobs

### Todo Cockpit (agent-state catalog management)
Use these when the goal is to manage the flag or label palette used by Todo Cockpit cards.

- `cockpit_save_flag_definition` - upsert a flag entry in the flag palette (name + optional hex color); flags are squared chips and the active workflow is normalized to one canonical workflow flag such as `new`, `needs-bot-review`, `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, or `FINAL-USER-CHECK`
- `cockpit_delete_flag_definition` - remove a flag from the flag palette by name
- `cockpit_save_label_definition` - upsert a label entry in the label palette (name + optional hex color); labels are **multi-value** pill chips used for user-facing categorization, not agent action routing
- `cockpit_delete_label_definition` - remove a label from the label palette by name

Closeout shorthand:

- `scheduled-task` belongs in `labels`, not `flags`
- do not suggest more than one active workflow flag in a closeout update
- if the user still needs review, prefer one review-state flag such as `needs-user-review`
- treat `ON-SCHEDULE-LIST` as the canonical scheduled workflow flag, not as a second review flag to stack onto a handoff

### Research
Use these when the goal is to configure or inspect a bounded benchmark profile.

- `research_list_profiles` - inspect all research profiles
- `research_get_profile` - inspect one research profile
- `research_create_profile` - create a research profile
- `research_update_profile` - update a research profile
- `research_delete_profile` - delete a research profile
- `research_duplicate_profile` - clone a research profile
- `research_list_runs` - inspect recent runs
- `research_get_run` - inspect one recorded run

## Conceptual Guidance

### When to use tasks vs jobs
- Use a **task** when the user wants one scheduled prompt with agent, model, labels, prompt source, and cron.
- Use a **one-time task** for a single execution that should delete itself automatically after success.
- Use a **recurring task** when the user wants the same prompt to keep running on a schedule.
- Use a **job** when the user wants a workflow with multiple steps, optional pause checkpoints, or a bundled execution flow.
- Use **compile job to task** when the user wants the whole workflow collapsed into one standalone prompt task.

### Cockpit card relationship per task mode

| Task mode | Cockpit card? | What to do when task changes |
|---|---|---|
| **One-time** | Reuse the originating todo card (no new card) | `scheduler_update_task` only; no new card or comment needed unless scope changes |
| **Recurring** | One permanent card in `Recurring Tasks` section (never archived) | `scheduler_update_task` + `cockpit_add_todo_comment` on its card to record the change |

- The `Recurring Tasks` section in Cockpit is collapsible like Archive, but holds **alive, long-running items** — not completed ones.
- Never create a new Cockpit card every time a recurring task is modified. One card per task, with comments as the history.
- When a one-time task finishes and the user still needs to review the outcome, prefer `cockpit_closeout_todo` on the originating card over manual multi-step card repair.
- When describing that closeout, phrase it as one flag plus optional labels, not as multiple flags. Example: `Set flag to needs-user-review` and `Add label scheduled-task`.

### When to use job folders
- Use folders only for organization.
- Do not treat folders as execution units.
- Use folders to group related jobs like campaigns, recurring maintenance, experiments, or backlog bundles.

### When to use research profiles
- Use research profiles when the user wants repeatable benchmark-driven iteration.
- A research profile is not the same as a scheduled task.
- Research focuses on instructions, editable paths, benchmark command, metric regex, and agent/model choices.
- Start and stop research runs in the app UI when run execution is needed; use MCP for profile setup and run inspection.

## How This Plugin Is Commonly Used

Look at the repo-local scheduler store and its compatibility mirrors as the live example set for this repository. Typical patterns include:

- recurring automation tasks that dispatch work to Todo Cockpit or other services
- daily research/market scans that collect ideas and create follow-up tasks
- maintenance jobs that run on a schedule and bundle multiple steps
- repo-specific workflow jobs that combine task steps, pause checkpoints, and a bundled output task
- research profiles that benchmark a change against a local command and a metric regex

## Practical Examples

### 1. Create a recurring task
Use `scheduler_add_task` when the user wants a simple scheduled prompt.

Example:
- "Create a daily market research task that uses GPT-5.3-Codex and runs at 9:17."

### 1a. Create a one-time task
Use `scheduler_add_task` with `oneTime: true` when the user wants a single future execution.

Example:
- "Create a one-time task to send the migration summary tomorrow morning and then auto-delete itself after the successful run."

### 2. Update an existing task
Use `scheduler_update_task` when the cron, prompt, model, or labels should change but the task should stay the same record.

Example:
- "Adjust the dispatcher cron and keep the same task ID."

If the task is recurring, you can also update its chat-session behavior:
- `new` for a fresh chat session before sending the prompt
- `continue` for the current chat flow when the environment supports it

When the task is run manually or by schedule, the agent should treat that field as execution behavior, not just metadata. Do not describe a `continue` task run as creating a new chat session.

### 3. Build a job workflow from existing tasks
Use `scheduler_create_job`, then `scheduler_add_job_task`, then `scheduler_create_job_pause`.

Example:
- "Create a job for the weekly content loop with a draft task, a manual review pause, and a publish task."

### 4. Bundle a job into one task
Use `scheduler_compile_job_to_task` when the workflow should become one standalone prompt task.

Example:
- "Compile this job into one Bundled Task and park the source job in Bundled Jobs."

### 5. Organize jobs into folders
Use `scheduler_create_job_folder` and `scheduler_update_job_folder` when the user wants a clearer workflow layout.

Example:
- "Put all launch workflows into a Marketing folder and keep experiments separate."

### 6. Create a research profile
Use `research_create_profile` when the user wants repeatable benchmark iterations.

Example:
- "Create a research profile that edits docs, runs npm test, and scores the result with a regex."

### 7. Inspect research history
Use `research_list_runs` and `research_get_run` when the user wants to review previous benchmark executions before changing the profile.

Example:
- "Show me the last few runs for this benchmark profile and the winning score trend."

## Decision Rules

- Prefer the most specific tool that matches the concept.
- Run the workspace and capability preflight before changing scheduler state for remediation or dispatcher work.
- Do not use a task tool when the user is clearly asking for a job workflow.
- Do not use job tools when the user only needs one scheduled prompt.
- Do not treat one-time and recurring tasks as separate tool categories; they are the same task concept with different lifecycle behavior.
- Use one-time tasks for disposable, single-run work.
- Use recurring tasks for persistent automation.
- Do not use research tools when the user only wants scheduler task edits.
- If a recurring task is configured with `chatSession: continue`, manual `runNow` behavior should stay in the current chat instead of opening a fresh session first.
- If the user asks for a workflow that mixes all three, split it:
- task setup first
- job composition second
- research setup third
- Do not patch repo-local scheduler JSON directly after an MCP failure or partial mutation unless the user explicitly approves a last-resort recovery path.

## Output Expectations For The Agent

When using this skill, the agent should explain:
- which concept it is editing
- which MCP tool category it chose
- what changed in repo-local state
- whether a follow-up UI action is needed for research run execution

## Safety Notes

- Keep edits scoped to the repo-local scheduler and research files.
- Treat direct edits to `.vscode/scheduler.json`, `.vscode/scheduler.private.json`, or `.vscode/research.json` as a last-resort recovery path, not a normal execution path.
- Preserve existing task IDs and job IDs unless the user asks for a rename or duplication.
- For job compilation, keep backward compatibility with older scheduler data.
- If a folder or profile is not safe to delete because it still has children or dependent items, stop and report that instead of forcing removal.