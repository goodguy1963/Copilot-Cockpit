# Copilot Cockpit

<!-- markdownlint-disable-next-line MD033 -->
<img src="images/icon.png" alt="Copilot Cockpit icon" width="84">

> Plan before you run. Copilot Cockpit is a local-first orchestration workspace for AI tasks, approvals, workflows, and iterative execution inside VS Code.

This repository is the active Copilot Cockpit codebase. It builds on the original scheduler foundation and is shipped here as the current Cockpit-focused VSIX for local, repo-scoped AI orchestration.

## What Copilot Cockpit Adds

Copilot Cockpit keeps the original scheduler foundation, but this repo is about the Cockpit layer on top of it: planning before execution, repo-local control, workflow editing, approvals, research loops, and optional MCP-driven orchestration.

Use it when the work is more than “run this prompt on cron”:

- capture work as todos before turning it into execution
- review and approve tasks before they run
- build multi-step jobs with pauses and branching checkpoints
- iterate on benchmarked research runs instead of doing blind automation
- keep scheduler state, private notes, and workspace behavior local to the current repo

## 🧱 Original Source

Copilot Cockpit is built on top of the original Copilot Scheduler project by [aktsmm](https://github.com/aktsmm). The original upstream README is preserved unchanged later in this document; the section above it focuses only on the Cockpit-specific behavior in this repo.

## Mental Model

At a high level, Copilot Cockpit models the way real work gets done:

- Todos = planning, communication, and approval layer
- Tasks = scheduled units of work
- Jobs = multi-step workflows
- Research = bounded iteration with measurement
- Agents = workers executing or refining the work
- Scheduler/orchestrator = management layer

## Cockpit Surfaces

| Surface | Purpose |
| --- | --- |
| `Todo Cockpit` | Planning, comments, approvals, flags, labels, and execution handoff |
| `Tasks` | Scheduled prompts and repeatable execution units |
| `Jobs` | Ordered workflows with pause checkpoints and compile-to-task flow |
| `Research` | Benchmark-driven iteration with guardrails |
| `Settings` | Repo-scoped runtime defaults and notification behavior |
| `MCP` | Optional tool exposure for agent-driven orchestration in the current repo |

## What Is Different In This Repo

- strict per-repo scheduling, with workspace state stored under `.vscode`
- repo-local Todo Cockpit for approvals and communication
- repo-local Jobs board for workflow composition
- repo-local Research profiles and run history
- embedded MCP server plus guided workspace MCP setup
- backup and recovery history for workspace scheduler state
- repo-scoped startup behavior and safer agent/model execution rules
- a built-in `How To Use` tab that opens first

## 📦 Installation

### From a GitHub Release

Recommended for collaborators and normal use.

1. Go to the [Releases page](https://github.com/goodguy1963/source-scheduler-private/releases) and download the latest `copilot-cockpit-X.X.X.vsix` file.
2. In VS Code, open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and run **Extensions: Install from VSIX…**.
3. Select the downloaded VSIX.
4. Reload VS Code when prompted.
5. Disable or uninstall `yamapan.copilot-scheduler` if it is installed so Copilot Cockpit remains the active implementation.

### From Source

Copilot Cockpit is packaged as a normal VSIX and is intended to install on Windows, macOS, and Linux.

1. Build the VSIX with `npm run package:vsix`.
2. Install it with one of these scripts:

  ```text
  npm run install:vsix
  npm run install:vsix:insiders
  npm run install:vsix:both
  ```

1. If the VS Code shell command is unavailable on the machine, use **Extensions: Install from VSIX…** inside VS Code or VS Code Insiders and select the generated VSIX manually.
2. Reload VS Code.
3. Disable or uninstall `yamapan.copilot-scheduler` if it is installed so Copilot Cockpit remains the active implementation.

Notes:

- the `code` and `code-insiders` shell commands use the same names on Windows, macOS, and Linux, but they must be installed locally first
- `npm run compile` builds both the extension bundle and the embedded MCP server bundle

## ⚡ Quick Start

1. Open the cockpit from the activity bar, from `Copilot Cockpit: Create Scheduled Prompt (GUI)`, or from the activation notification.
2. Start in the `How To Use` tab to see the current flow across Todo Cockpit, Tasks, Jobs, Research, MCP, and Settings.
3. Capture work in `Todo Cockpit` first when it needs discussion, comments, labels, due dates, approval, or rejection.
4. Turn ready work into scheduled `Tasks` when it should run on its own.
5. Use `Jobs` when the work is multi-step, needs pauses, or should later be bundled into one compiled task.
6. Use `Research` when you want bounded iteration against a benchmark or score.
7. Configure `Settings` and optional `MCP` setup for repo-specific execution behavior.

## Cockpit-Specific Details

### Prompt Sources

- Inline text stored directly in the task.
- Local templates from `.github/prompts/*.md` in the current repo.
- Global templates from the VS Code prompts folder or the configured global prompts path.
- Skill references can be inserted into the prompt with one click from discovered workspace/global skill markdown files such as `SKILL.md`.

### ⛓ Jobs Board

- Jobs are repo-local workflows stored next to the workspace scheduler files.
- A job owns one cron schedule and an ordered list of workflow items, so you can build it as columns of chained tasks with dedicated pause checkpoints between segments.
- Jobs can be dragged from the Jobs list into sidebar folders, including back to `All jobs`.
- The sidebar now shows the current folder explicitly and highlights the active folder more clearly.
- Each step has a default 30-minute window that can be edited per node.
- Drag-drop reordering updates the workflow timeline and the derived next-run order.
- Dedicated pause checkpoints block all downstream steps until you approve the previous result. Rejecting a waiting pause opens the previous task in the editor so it can be changed.
- `Compile To Task` merges the full workflow into one combined prompt task, then moves the source job into the `Bundled Jobs` folder in an inactive state so it can still be edited or duplicated later.
- Deleting a step from Jobs now asks whether it should be removed only from the workflow or whether the underlying task should also be deleted from the Task List.
- `Add Existing Task` can be used more than once in the same workflow. When needed, Copilot Cockpit creates a reusable copy so repeated steps stay unambiguous at runtime.
- Pausing a job suppresses all child-task executions without changing each task's own enabled flag.
- Effective labels combine manual task labels with the owning job name, so the Task List can be filtered by workflow.

### ✅ Todo (Cockpit) - Communication Hub

- The `Todo Cockpit` tab is the central communication hub between the user and the AI agent, replacing the old external Todoist coordination flow.
- The seeded sections now start with `Unsorted`, followed by `Bugs`, `Features`, `Ops/DevOps`, `Marketing/Growth`, `Automation`, and `Future`.
- Todos are the planning and communication layer. Scheduled tasks are separate execution artifacts that can be created from an approved todo but do not replace it.
- Existing scheduled tasks now surface in Todo Cockpit under `Unsorted` when they are not already linked to a planning todo.
- Todo Cockpit cards are stored only in `.vscode/scheduler.private.json`, so comments, due dates, local planning notes, and task links do not leak into the public scheduler file.
- Todos now move through explicit states: `active`, `ready`, `completed`, and `rejected`.
- In the current Cockpit UI, `Approve` archives a todo as `completed-successfully`, `Final Accept` remains available for items already in `ready`, and `Delete` now opens a chooser so you can archive as `rejected` or remove the todo permanently.
- Archived cards stay in `.vscode/scheduler.private.json` under outcome buckets so accepted and rejected work can still be reviewed later.
- Comments now preserve ordering plus provenance such as `human-form`, `bot-mcp`, `bot-manual`, and `system-event`.
- Labels use a shared repo-local palette so the same chip color can be reused across cards and filters, while flags provide a single active agent-state marker per card.
- The current UI supports creating and editing todos, adding comments, setting due dates, filtering by label/priority/status/archive outcome, collapsing the filter bar, drag-drop movement between sections, linking tasks, and creating scheduled task drafts from approved todos.
- The `How To` tab now starts with Todo Cockpit as step 1 and includes quick-switch buttons so users can jump directly to the board, task editor, task list, jobs, research, or settings from the help view.
- The repo-local Todo skill at `.github/skills/cockpit-todo-agent/SKILL.md` teaches agents to treat this board as the source of truth for communication, approvals, labels, flags, and execution handoff.

### Research Tab

- Research profiles are stored repo-locally in `.vscode/research.json` with run history under `.vscode/research-history`.
- Each profile defines the benchmark command, a numeric metric regex, whether to maximize or minimize it, a run budget, and an allowlisted set of editable files.
- Runs are bounded by max iterations, max minutes, benchmark timeout, and max consecutive failures.
- The UI keeps recent runs, attempt outcomes, scores, changed files, and benchmark output so you can decide whether to keep or reject a result.
- This is intentionally a bounded benchmark-command researcher, not an unrestricted autonomous code editor.

### Repo Storage Model

- Workspace tasks are stored in `.vscode/scheduler.json` and `.vscode/scheduler.private.json` inside the repo that is actually open in VS Code.
- The internal Todo Cockpit board is stored only in `.vscode/scheduler.private.json`.
- The last 100 workspace schedule changes are stored in `.vscode/scheduler-history` so you can restore an older repo-local version from the UI.
- Recurring inline workspace prompts also get backup-only markdown copies in `.vscode/scheduler-prompt-backups`; this is separate from `.vscode/scheduler-history`, which stores full scheduler snapshots.
- Nested repos no longer inherit tasks from a parent folder.
- Global tasks still exist in extension storage, but repo schedules are authoritative in the repo's `.vscode` files.
- The extension now bootstraps `.vscode/.gitignore` so `scheduler.private.json` is ignored even when the repo root `.gitignore` does not already cover it.

### Session Behavior

The global setting `copilotCockpit.chatSession` still provides the default scheduler behavior, and recurring tasks can now override it directly in the Create/Edit UI.

- Recurring tasks can choose `continue` or `new` per task.
- One-time tasks do not store a task-level chat session mode.
- `continue` keeps using the currently active Copilot chat flow.
- `new` tries to open a new Copilot chat session before sending the scheduled prompt.
- Use `new` with absolute care. One scheduled AI run can intentionally open another AI session, which means an AI-driven chain can continue further than a single message.
- VS Code does not currently expose a supported extension API to reopen a specific old Copilot conversation by saved session ID, so Copilot Cockpit can persist the recurring task mode but cannot force-restore an exact prior Copilot thread.
- MCP is a different launch path, but it can still trigger new sessions indirectly. Once the scheduler MCP tools are exposed to Copilot, a model can create, modify, or run tasks that use `new` chat-session mode, so one LLM can open another.

### Agent and Model Selection

- If a task specifies a dedicated agent or model, the extension now prefers a fresh Copilot chat context so that it does not silently reuse the currently active chat state.
- If a task leaves agent or model empty, the run inherits the repo-scoped default agent/model from the `Settings` tab. The shipped default agent is `agent`; the default model is empty until you choose one.
- If VS Code cannot honor a task-specific model in the fallback chat path, the run fails explicitly instead of pretending the active model was used correctly.
- The Test Run path uses the same executor behavior as scheduled and manual runs.

### Skill Insertion

- The Create/Edit form includes a skill dropdown plus `Insert Skill` button.
- Choosing a skill inserts a sentence such as `Use path/to/SKILL.md to know how things must be done.` into the prompt.
- Inserting a skill switches the prompt to inline mode so the added instruction is preserved even if you started from a template.
- The scheduler MCP skill is repo-local at `.github/skills/cockpit-scheduler-agent/SKILL.md`, so it is available when this workspace is open; installing the extension alone does not add it to other repos.
- The Todo Cockpit skill is repo-local at `.github/skills/cockpit-todo-agent/SKILL.md` and explains how agents should use the internal planning board instead of external Todoist state.
- On startup, the extension now creates that repo-local skill file in each open workspace root if it is missing.
- The skill file being present in the repo does not make agents use it automatically. You still need to add it to the agent prompt with `Insert Skill`, mention the skill path in your instructions, or call the skill explicitly when you want it applied.
- The skill is meant for agents that need a concept map for tasks, jobs, job folders, pause checkpoints, bundled jobs, or research profiles.

Example:

```json
{
  "copilotCockpit.chatSession": "new"
}
```

### Overdue Tasks

If VS Code was closed and tasks became overdue:

- Recurring tasks are reviewed one by one on startup and can either run now or wait for the next cycle.
- One-time tasks are reviewed one by one on startup and can either run now or be rescheduled by choosing how many minutes from now they should run.
- Remaining overdue tasks are not silently auto-executed after you dismiss the review.

### One-time vs recurring tasks

- Use a one-time task when you want a single execution that should delete itself after success.
- Use a recurring task when you want the same prompt to keep running on cron until you disable or delete it.
- One-time tasks are best for ad hoc cleanup, migration, or one-off follow-up actions.
- Recurring tasks are best for daily dispatchers, weekly reviews, and other repeatable automation.
- Recurring tasks can store a per-task chat-session mode (`new` or `continue`); one-time tasks do not store that setting.
- If you are building a workflow with multiple steps, pause checkpoints, or a bundled output task, use a job instead of a plain task.

### Choosing the right concept

- Use a **task** for one scheduled prompt.
- Use a **one-time task** when that prompt should run once and then disappear.
- Use a **recurring task** when that prompt should stay scheduled on cron.
- Use a **job** when the user wants multiple steps, pause checkpoints, or a bundled output.
- Use a **research profile** when the user wants a bounded benchmark loop with editable paths and a score command.
- The `cockpit-scheduler-agent` skill is repo-local in `.github/skills/cockpit-scheduler-agent/SKILL.md`, so it is available when this workspace is open; installing the extension alone does not add it to other repos.
- The skill explains which MCP tool to use for each concept so agents can choose between tasks, jobs, folders, pauses, bundled-task compilation, and research without guessing.

### Auto-Open On Startup

The setting `copilotCockpit.autoShowOnStartup` is repo-scoped.

- Turn it on in `.vscode/settings.json` for repos where you want the scheduler to open automatically.
- Or toggle it directly from the `Task List` toolbar inside the scheduler UI.

Example:

```json
{
  "copilotCockpit.autoShowOnStartup": true
}
```

### MCP Status

Yes, MCP is set up in the plugin itself.

- The extension includes an embedded MCP server implemented in `src/server.ts` and packaged as `out/server.js`.
- Treat MCP exposure as high risk. Once Copilot can see these tools, it can inspect scheduler state, modify saved tasks, and trigger runs that may open additional AI sessions.
- `scheduler_list_tasks` and `scheduler_get_task` inspect current scheduler state and single saved tasks.
- `scheduler_add_task`, `scheduler_update_task`, `scheduler_duplicate_task`, `scheduler_remove_task`, and `scheduler_toggle_task` create or change saved tasks.
- `scheduler_run_task` triggers a task, while `scheduler_list_history`, `scheduler_restore_snapshot`, and `scheduler_get_overdue_tasks` inspect recovery state and due work.
- The MCP surface also includes job tools for workflow composition, bundled-task compilation, and research profile tools for benchmark setup and run inspection.
- The MCP surface now also includes Todo Cockpit tools for inspection and mutation: `cockpit_get_board`, `cockpit_list_todos`, `cockpit_get_todo`, `cockpit_create_todo`, `cockpit_add_todo_comment`, `cockpit_update_todo`, `cockpit_delete_todo`, `cockpit_approve_todo`, `cockpit_finalize_todo`, `cockpit_reject_todo`, `cockpit_move_todo`, `cockpit_set_filters`, `cockpit_seed_todos_from_tasks`, `cockpit_save_label_definition`, `cockpit_delete_label_definition`, `cockpit_save_flag_definition`, and `cockpit_delete_flag_definition`.
- The `cockpit-scheduler-agent` skill documents which tool to use for each concept so an agent can choose between tasks, jobs, folders, pauses, and research without guessing.
- The `cockpit-todo-agent` skill documents when to use the internal board tools for repo-local coordination.
- Installing the extension does not register scheduler MCP tools globally. A workspace still needs an MCP launcher entry such as `.vscode/mcp.json` that starts the installed scheduler server.
- In short: the server is bundled with the plugin, but the workspace still decides how to launch it.

### Telegram Setup

- Open the `Settings` tab.
- Enable Telegram notifications.
- Paste the bot token. It is stored only in `.vscode/scheduler.private.json`.
- Enter the target chat ID and optional message prefix.
- Save the settings, then use `Send Test Message` to verify delivery.
- The extension generates the Stop-hook files under `.github/hooks/` and those files read the secret from `.vscode/scheduler.private.json` instead of embedding it directly.
- Outbound Telegram notifications are implemented now. Inbound reply-to-continue and attached-message-to-start-new-session behavior is planned to use an external relay/webhook bridge and is not complete in this slice.

### MCP Setup

Use the built-in `Set Up MCP` action from the How To tab or the `Copilot Cockpit: Set Up Workspace MCP` command if you want Copilot Chat to see the scheduler MCP tools.

What the setup flow does:

- Creates `.vscode/mcp.json` if it does not exist.
- Merges the `scheduler` server entry into an existing `.vscode/mcp.json` without deleting unrelated MCP servers.
- Writes the correct `out/server.js` path for the currently installed extension.
- Reports invalid JSON instead of overwriting it blindly.

Manual example for reference:

Development checkout example:

```json
{
  "servers": {
    "scheduler": {
      "type": "stdio",
      "command": "node",
      "args": [
        "F:/HBG Webserver/extensions/source-scheduler/out/server.js"
      ]
    }
  }
}
```

Installed VSIX example:

```json
{
  "servers": {
    "scheduler": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<absolute path to your installed extension>/out/server.js"
      ]
    }
  }
}
```

Notes:

- The automatic setup flow writes the same structure into `.vscode/mcp.json` in the repo where you want the scheduler MCP tools available.
- On stable VS Code installs, the extension usually lives under `~/.vscode/extensions` on macOS/Linux or `%USERPROFILE%/.vscode/extensions` on Windows.
- On VS Code Insiders, use the `.vscode-insiders/extensions` install root instead.
- Replace the versioned extension folder name with the exact installed version of Copilot Cockpit, for example `local-dev.copilot-cockpit-99.0.11`.
- Reload the window after adding or changing `.vscode/mcp.json`.

### Cross-Platform Readiness

- The packaged VSIX is platform-neutral and the extension/runtime code already resolves paths for Windows, macOS, and Linux where needed.
- The new package/install scripts are platform-neutral Node scripts, so you do not need PowerShell-specific commands just to build or install the extension.
- The remaining limitation is validation coverage: this repository is being edited from Windows, so Linux/macOS installation was made ready in code and docs here, but actual runtime still needs to be exercised on those operating systems to fully certify them.

### Key Differences From Upstream

- VSIX/package name: `copilot-cockpit`
- Local build extension ID: `local-dev.copilot-cockpit`
- Private repo and local VSIX packaging flow
- Embedded MCP server
- Repo-local `.vscode` schedule files
- Strict per-repo workspace isolation
- Repo-scoped startup auto-open
- Startup overdue-task review and one-time rescheduling
- Compact task list with larger countdown units
- Windows test-host workaround for paths with spaces

## Original Upstream README

The original upstream README is preserved below for reference.

---

## ⏰ Copilot Cockpit

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yamapan.copilot-scheduler?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yamapan.copilot-scheduler?label=Installs&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/aktsmm/vscode-copilot-scheduler)
[![GitHub Stars](https://img.shields.io/github/stars/aktsmm/vscode-copilot-scheduler?style=social)](https://github.com/aktsmm/vscode-copilot-scheduler)

Schedule automatic AI prompts with cron expressions in VS Code.

[**📥 Install from VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)

[Japanese / 日本語版はこちら](README_ja.md)

## 🎬 Demo

![Copilot Cockpit Demo](images/demo-static.png)

## ✨ Features

🗓️ **Cron Scheduling** - Schedule prompts to run at specific times using cron expressions

🤖 **Agent & Model Selection** - Choose from built-in agents (@workspace, @terminal) and AI models (GPT-4o, Claude Sonnet 4)

🌐 **Multi-language Support** - English and Japanese UI with auto-detection

📊 **Sidebar TreeView** - Manage all your scheduled tasks from the sidebar

🖥️ **Webview GUI** - Easy-to-use graphical interface for creating and editing tasks

## ⏰ Cron Expression Examples

| Expression     | Description             |
| -------------- | ----------------------- |
| `0 9 * * 1-5`  | Weekdays at 9:00 AM     |
| `0 18 * * 1-5` | Weekdays at 6:00 PM     |
| `0 9 * * *`    | Every day at 9:00 AM    |
| `0 9 * * 1`    | Every Monday at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes        |
| `0 * * * *`    | Every hour              |

## 📋 Commands

| Command | Description |
| --- | --- |
| `Copilot Cockpit: Create Scheduled Prompt` | Create a new task (CLI) |
| `Copilot Cockpit: Create Scheduled Prompt (GUI)` | Create a new task (GUI) |
| `Copilot Cockpit: List Scheduled Tasks` | View all tasks |
| `Copilot Cockpit: Edit Task` | Edit an existing task |
| `Copilot Cockpit: Delete Task` | Delete a task |
| `Copilot Cockpit: Toggle Task (Enable/Disable)` | Enable/disable a task |
| `Copilot Cockpit: Enable Task` | Enable a task |
| `Copilot Cockpit: Disable Task` | Disable a task |
| `Copilot Cockpit: Run Now` | Execute a task immediately |
| `Copilot Cockpit: Copy Prompt to Clipboard` | Copy prompt to clipboard |
| `Copilot Cockpit: Duplicate Task` | Duplicate a task |
| `Copilot Cockpit: Move Task to Current Workspace` | Move a workspace task here |
| `Copilot Cockpit: Open Settings` | Open extension settings |
| `Copilot Cockpit: Show Version` | Show extension version |

## ⚙️ Settings

| Setting | Default | Description |
| --- | --- | --- |
| `copilotCockpit.enabled` | `true` | Enable/disable scheduled execution |
| `copilotCockpit.showNotifications` | `true` | Show notifications when tasks are executed |
| `copilotCockpit.notificationMode` | `sound` | Notification mode (sound/silentToast/silentStatus) |
| `copilotCockpit.logLevel` | `info` | Log level (none/error/info/debug) |
| `copilotCockpit.language` | `auto` | UI language (auto/en/ja) |
| `copilotCockpit.timezone` | `""` | Timezone for scheduling |
| `copilotCockpit.chatSession` | `new` | Chat session (new/continue) |
| `copilotCockpit.defaultScope` | `workspace` | Default scope |
| `copilotCockpit.globalPromptsPath` | `""` | Custom global prompts folder path (default: VS Code user prompts folder) |
| `copilotCockpit.globalAgentsPath` | `""` | Custom global agents folder path |
| `copilotCockpit.jitterSeconds` | `600` | Max random delay (seconds) before execution (0–1800, 0 = off). Each task can override it. |
| `copilotCockpit.maxDailyExecutions` | `24` | Daily execution limit across all tasks (0 = unlimited, 1–100). ⚠️ Unlimited may risk API rate-limiting. |
| `copilotCockpit.minimumIntervalWarning` | `true` | Warn when cron interval is shorter than 30 minutes |

## 📝 Prompt Placeholders

Use these placeholders in your prompts:

| Placeholder     | Description           |
| --------------- | --------------------- |
| `{{date}}`      | Current date          |
| `{{time}}`      | Current time          |
| `{{datetime}}`  | Current date and time |
| `{{workspace}}` | Workspace name        |
| `{{file}}`      | Current file name     |
| `{{filepath}}`  | Current file path     |

## 📂 Task Scope

- **Global**: Task runs in all workspaces
- **Workspace**: Task runs only in the specific workspace where it was created

## 📄 Prompt Templates

Store prompt templates for reuse:

- **Local**: `.github/prompts/*.md` in your workspace
- **Global**: VS Code user prompts folder (or the folder set in `copilotCockpit.globalPromptsPath`)

## 📋 Requirements

- VS Code 1.80.0 or higher
- GitHub Copilot extension

## ⚠️ Known Issues

- Copilot Chat API is still evolving; some features may require updates as the API stabilizes
- Model selection may not work in all configurations

**Disclaimer:** This extension automates Copilot Chat. GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) prohibit "excessive automated bulk activity", the [Terms of Service § H (API Terms)](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms) allow account suspension for excessive API usage, and the [GitHub Copilot Additional Product Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot) apply these policies directly to Copilot. Use at your own risk; your account could be rate-limited or restricted. Configure jitter/daily limits/longer intervals to reduce risk, but there is no guarantee.

Note: There are [reports](https://github.com/orgs/community/discussions/160013) of Copilot access being restricted even without using automation tools. These mitigations reduce obvious automation patterns but cannot eliminate that risk.

🐛 [Report a bug](https://github.com/aktsmm/vscode-copilot-scheduler/issues)

## 📦 Release Notes

### 0.1.0

Initial release:

- Cron-based task scheduling
- Agent and model selection
- English/Japanese localization
- Sidebar TreeView
- Webview GUI for task management
- Prompt template support

## 📄 License

[CC-BY-NC-SA-4.0](LICENSE) © [aktsmm](https://github.com/aktsmm)

---

**Enjoy scheduling your Copilot prompts!** 🚀
