<!-- markdownlint-disable-next-line MD033 -->
<h1><img src="images/icon.png" alt="Copilot Cockpit icon" width="32"> Copilot Cockpit</h1>

Copilot Cockpit is a local orchestration layer for AI agents in VS Code, positioned as a controlled alternative to OpenClaw's autonomous systems and Paperclip's external coordination tools.

- Workflow-based execution instead of agent-driven autonomy
- Timeline scheduling with interruption and editing capabilities
- Human-in-the-loop as a core constraint, not a fallback

It is a control system for AI task execution, not just an agent runner.

## 🧠 Mental Model

Copilot Cockpit separates planning from execution so work can be shaped before it runs:

This model is not limited to software tasks. It can be used by a single agent, a team of agents, or a human-led team to handle the full chain of work in almost any company or role: planning, communication, approval, execution, multi-step operations, improvement loops, and tool-driven orchestration.

The structure is generic. The same workflow can be handled by different agents, teams, models, or tools without changing the planning logic.

Every layer in Copilot Cockpit can be used directly by a person, by AI working through the plugin, or by a mixed human-and-AI workflow. The point is not to hide work inside agents, but to keep the user-facing overview in one place while AI handles planning support, execution, iteration, and orchestration.

- Todos = planning, communication, approval, and handoff layer
- Tasks = scheduled execution units for concrete work steps
- Jobs = multi-step workflows with pauses, reviews, and bundling
- Research = bounded improvement loops with a benchmark
- MCP = tool surface for agent and team orchestration

## ✨ What Copilot Cockpit Adds

This is the high-level overview of how a user and an AI can work through the same system:

| Surface | User Overview | How AI Can Use It |
| --- | --- | --- |
| `Todo Cockpit` | Repo-local planning board with comments, labels, flags, approvals, and task handoff | AI can read planning context, update linked work, move execution outcomes back into review, and keep the user-facing overview current. |
| `Tasks` | Scheduled prompts with repo-scoped storage, agent/model defaults, and overdue review | AI can run one concrete scheduled execution step, either directly or as part of a larger workflow. |
| `Jobs` | Multi-step workflows with pause checkpoints, reusable tasks, and compile-to-task flow | AI can follow ordered steps, stop at review points, and continue only inside the defined workflow structure. |
| `Research` | Bounded benchmark-driven iteration with editable-path allowlists | AI can iterate toward a measured goal while staying inside explicit limits for files, time, and failures. |
| `MCP` | Embedded server plus guided workspace setup for scheduler, jobs, research, and todo tools | AI can inspect state, create or update items, and trigger allowed operations through tool calls instead of hidden side effects. |
| `Settings` | Repo-scoped defaults for execution, notifications, Telegram, and startup behavior | AI inherits the execution rules and defaults the user sets, rather than inventing its own environment. |

## ⚡ Quick Start

1. Open Copilot Cockpit from the activity bar or with `Copilot Cockpit: Create Scheduled Prompt (GUI)`.
2. Start in `How To Use`, then move into `Todo Cockpit` to capture work and approvals.
3. Create a scheduled `Task` when the work is ready to run on its own.
4. Use `Jobs` when the work needs multiple ordered steps or pause checkpoints.
5. Use `Research` when the goal is iterative improvement against a benchmark instead of one direct run.
6. Open `Settings` to choose repo-scoped defaults for notifications, agent/model behavior, and startup.

## 📹 Demo

<img src="images/DEMO.gif" alt="Copilot Cockpit demo" width="100%" />

If the embedded image does not render in your viewer, open the demo directly at [images/DEMO.gif](images/DEMO.gif).

## 📦 Installation

### 🚀 From a GitHub Release

1. Download the latest `copilot-cockpit-X.X.X.vsix` from the [Releases page](https://github.com/goodguy1963/Copilot-Cockpit/releases).
2. Run **Extensions: Install from VSIX…** in VS Code.
3. Select the VSIX, reload VS Code, and disable or uninstall `yamapan.copilot-scheduler` if it is installed.
4. After that reload, Copilot Cockpit will create or repair its repo-local support files such as `.vscode/mcp.json` for the current workspace.
5. MCP launcher entries now point at a stable repo-local launcher under `.vscode/copilot-cockpit-support/`, so other open VS Code windows can keep starting MCP services even before they reload to the new extension version.

### 🛠️ From Source

1. Build the package with `npm run package:vsix`.
2. Install it with one of these scripts:

   ```text
   npm run install:vsix
   npm run install:vsix:insiders
   npm run install:vsix:both
   ```

3. If the VS Code shell command is unavailable, use **Extensions: Install from VSIX…** and select the generated package manually.
4. Reload VS Code and disable or uninstall `yamapan.copilot-scheduler` if it is installed.
5. After that reload, Copilot Cockpit will create or repair its repo-local support files such as `.vscode/mcp.json` for the current workspace.
6. MCP launcher entries now point at a stable repo-local launcher under `.vscode/copilot-cockpit-support/`, so other open VS Code windows can keep starting MCP services even before they reload to the new extension version.

## 🗂️ Repo-Local Storage And Boundaries

- Workspace scheduler data lives in `.vscode/scheduler.json` and `.vscode/scheduler.private.json`, and can also be mirrored into `.vscode/copilot-cockpit.db` when `copilotCockpit.storageMode` is set to `sqlite`.
- Todo Cockpit state, local planning notes, Telegram secrets, and approvals stay in `.vscode/scheduler.private.json`.
- Backup history is stored in `.vscode/scheduler-history`, and inline prompt backups are stored in `.vscode/cockpit-prompt-backups`.
- Nested repos no longer inherit scheduler data from a parent workspace.
- The extension bootstraps `.vscode/.gitignore` so private cockpit state does not leak accidentally.
- The design remains intentionally local-first, single-user, and repo-scoped.

## 🧭 Core Workflows

Each workflow below can be driven manually, by AI, or by both together. Todo Cockpit is the overview layer; tasks, jobs, research, and MCP are the execution and orchestration layers under that overview.

### ✅ Todo Cockpit

- `Todo Cockpit` is the repo-local communication and approval layer.
- Seeded sections start with `Unsorted`, then `Bugs`, `Features`, `Ops/DevOps`, `Marketing/Growth`, `Automation`, and `Future`.
- Todos move through `active`, `ready`, `completed`, and `rejected` states.
- `Approve` marks a todo as `ready`, `Final Accept` or `Complete & Archive` archives it as `completed-successfully`, and `Delete` lets you reject/archive or remove it permanently.
- Cards support comments, due dates, labels, flags, task links, archive review, drag-drop between sections, and a collapsible filter bar.
- Existing scheduled tasks can be surfaced into `Unsorted` when they are not already linked to a planning todo.
- Use MCP tools or the extension UI to mutate Cockpit state. Direct edits to `.vscode/scheduler.private.json` should stay a last-resort recovery path because they bypass the normal validation and closeout flow.

### 🗓 Tasks

- Tasks are the core Copilot Scheduler execution unit and remain the foundation underneath Copilot Cockpit.
- A task is one scheduled prompt run, either one-time or recurring, with repo-scoped storage and optional agent/model selection.
- Tasks can be created directly for simple execution, linked back to a planning todo, or reused inside jobs.
- Overdue tasks are reviewed on startup, and one-time tasks can be run immediately or rescheduled.
- If you need one direct scheduled run without a multi-step workflow, use a task.

### ⛓ Jobs

- Jobs are repo-local workflows with one cron schedule and an ordered step list.
- Steps can be reordered, paused, edited, and built from reusable existing tasks.
- `Add Existing Task` can be used more than once; Copilot Cockpit creates a safe reusable copy when needed.
- Deleting a job step now asks whether to remove it only from the workflow or delete the underlying task entirely.
- `Compile To Task` merges the workflow into one bundled prompt task and keeps the source job in `Bundled Jobs` for later edits.
- Pausing a job suppresses downstream execution without mutating each child task's enabled flag.

### 🔬 Research

- Research profiles are stored in `.vscode/research.json` with history under `.vscode/research-history`; SQLite mode also imports and mirrors that state into `.vscode/copilot-cockpit.db` during bootstrap.
- Each profile defines a benchmark command, metric extraction regex, optimization direction, run budget, and editable-path allowlist.
- Runs are bounded by iteration count, elapsed time, benchmark timeout, and consecutive failure limits.
- This is a benchmark-driven iteration surface, not an unrestricted autonomous code editor.

## 🤖 Execution Behavior

- Recurring tasks can override `copilotCockpit.chatSession` with `continue` or `new`; one-time tasks do not store that override.
- If a task specifies an agent or model, Copilot Cockpit prefers a fresh chat context rather than silently reusing the current one.
- If a task leaves agent or model empty, it inherits the repo-scoped defaults from `Settings`.
- Overdue recurring tasks are reviewed on startup one by one, and overdue one-time tasks can be run immediately or rescheduled.
- If you need one direct scheduled prompt, use a task. If you need multiple ordered steps, use a job. If you need bounded benchmark iteration, use research.

## 🔌 MCP And Skills

- The extension bundles an embedded MCP server at `out/server.js`.
- Use `Set Up MCP` from `How To Use` or `Copilot Cockpit: Set Up Workspace MCP` to create or merge `.vscode/mcp.json` safely.
- `Set Up MCP` only inserts or repairs the local `scheduler` launcher entry. It preserves other MCP servers that are already in `.vscode/mcp.json`.
- The generated `scheduler` entry points to a stable repo-local launcher in `.vscode/copilot-cockpit-support/mcp/launcher.js`, which then resolves the currently installed Copilot Cockpit runtime.
- Because that launcher path stays stable across extension updates, unreloaded VS Code windows can keep starting MCP services until they reload onto the new extension host version.
- Do not store live third-party API keys or tokens directly in `.vscode/mcp.json`. Use top-level `inputs` with `"type": "promptString"` and `"password": true`, then reference them with `${input:NAME}` placeholders.
- MCP exposure is powerful and high-risk: once tools are visible to Copilot, they can inspect state, modify saved items, and trigger runs.
- The MCP surface includes scheduler, jobs, research, and Todo Cockpit tools.
- MCP tool semantics stay the same in JSON and SQLite modes. In SQLite mode the extension still keeps compatibility JSON mirrors and a workspace migration journal at `.vscode/copilot-cockpit.db-migration.json`.
- Repo-local skills live in `.github/skills/cockpit-scheduler-agent/SKILL.md` and `.github/skills/cockpit-todo-agent/SKILL.md`.
- For remediation or dispatcher work, start with a preflight: confirm the active workspace owns the referenced repo paths, then confirm the required MCP tool exists before mutating state.
- Dispatcher agents should use `cockpit_list_routing_cards` first. It returns case-insensitive matches across labels, flags, and actionable comment labels so agents do not have to scan the full board payload.
- In Todo Cockpit, `labels`, `flags`, and `comments[].labels` are distinct. `GO` is a flag here, not a label.
- `flags` are routing and review-state markers. Most handoff flows should use one explicit review-state flag, but live scheduled cards may intentionally keep the built-in pair `Linked scheduled task` and `ON-SCHEDULE-LIST`. `labels` remain the multi-value categorization surface.
- Prefer `cockpit_closeout_todo` for verified implementation handoff. It can keep the card active for review, add one summary comment, respect missing sections, and clear stale linked task IDs.
- Skill files are available in this workspace, but they are only applied when explicitly inserted or referenced in prompts.

Manual `.vscode/mcp.json` example:

```json
{
  "inputs": [
    {
      "id": "PERPLEXITY_API_KEY",
      "type": "promptString",
      "password": true,
      "description": "Perplexity API Key"
    }
  ],
  "servers": {
    "scheduler": {
      "type": "stdio",
      "command": "node",
      "args": [
        "<absolute path to your installed extension>/out/server.js"
      ]
    },
    "perplexity": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@perplexity-ai/mcp-server"
      ],
      "env": {
        "PERPLEXITY_API_KEY": "${input:PERPLEXITY_API_KEY}"
      }
    }
  }
}
```

If a routed one-time execution card no longer has a real linked scheduler task, clear the stale `taskId` on the Cockpit card instead of leaving a broken link behind.

## 📣 Telegram Notifications (experimental)

- Telegram configuration is handled in `Settings`.
- The bot token is stored only in `.vscode/scheduler.private.json`.
- `Send Test Message` verifies outbound delivery.
- Stop-hook files are generated under `.github/hooks/` and read secrets from the private scheduler file.
- Outbound notifications are implemented; inbound reply-driven continuation still depends on a future relay/webhook bridge.

## 🧱 Core Foundation

This repository is the active Copilot Cockpit codebase. Copilot Cockpit is built on top of the original Copilot Scheduler project by [aktsmm](https://github.com/aktsmm). The scheduler remains the execution foundation; Copilot Cockpit adds a repo-local planning, approval, workflow, research, and orchestration layer around it.It builds on the original Copilot Scheduler and ships the Cockpit-focused VSIX for local, repo-scoped AI orchestration. The original upstream README is preserved below; this top section only covers what is specific to Copilot Cockpit.

### 🧩 Core Principles

| Principle | Meaning |
| --- | --- |
| No Heartbeat Architecture | No always-running loops. Agents only execute when triggered and approved. |
| Human-in-the-Loop by Default | Every task can be reviewed, paused, edited, and refined before and during execution. |
| Workflow Over Autonomy | Tasks are structured into timelines and workflows rather than handed off to autonomous agents. |
| Local And Integrated | Runs entirely inside VS Code with no external coordination layer like Paperclip. |
| Iterative Execution | Inspired by approaches like Andrej Karpathy's iterative style: small experiments, continuous refinement, and better outcomes over time. |

### 🎯 What This Means

Copilot Cockpit is not trying to replace developers with autonomous agents.

- You define the plan.
- You approve execution.
- You can intervene at any time.
- The system helps orchestrate rather than decide.

## 🔎 Notes For This Fork

- VSIX/package name: `copilot-cockpit`
- Local build extension ID: `local-dev.copilot-cockpit`
- Repo-local schedules and private cockpit state under `.vscode`
- Embedded MCP server and guided workspace MCP setup
- Repo-scoped startup behavior, overdue review, and workflow-oriented UI surfaces

## 📜 Original Upstream README

The original upstream README is preserved below for reference.

---

## ⏰ Copilot Scheduler

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/yamapan.copilot-scheduler?label=VS%20Code%20Marketplace&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/yamapan.copilot-scheduler?label=Installs&logo=visual-studio-code)](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)
[![License CC BY-NC-SA 4.0](https://img.shields.io/badge/License-CC%20BY--NC--SA%204.0-lightgrey.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](https://github.com/aktsmm/vscode-copilot-scheduler)
[![GitHub Stars](https://img.shields.io/github/stars/aktsmm/vscode-copilot-scheduler?style=social)](https://github.com/aktsmm/vscode-copilot-scheduler)

Schedule automatic AI prompts with cron expressions in VS Code.

[**📥 Install from VS Code Marketplace**](https://marketplace.visualstudio.com/items?itemName=yamapan.copilot-scheduler)

[Japanese / 日本語版はこちら](README_ja.md)

## 🎬 Demo

![Copilot Scheduler Demo](images/demo-static.png)

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

Changed for renaming of the plugin for this repo.

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

Changed for renaming of the plugin for this repo.

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

## 🚦 Dispatcher Routing

For local dispatcher agents that operate on Todo Cockpit cards:

- Validate that the active workspace matches the referenced repo before touching Cockpit or scheduler state.
- Check that the needed MCP tools are available before planning around them.
- Use `cockpit_list_routing_cards` to find routed cards quickly.
- Treat `labels`, `flags`, and comment labels as separate sources of truth.
- Use the latest actionable user comment for intent, schedule overrides, and handoff decisions.
- Do not rely on the raw board payload unless you are debugging the router itself.
- Do not repair `.vscode/scheduler.json` or `.vscode/scheduler.private.json` directly after partial MCP mutations unless the user explicitly approves a last-resort recovery step.

## 📋 Requirements

- VS Code 1.80.0 or higher
- GitHub Copilot with access to the integrated GitHub Copilot Chat in VS Code
- An active Copilot subscription for the chat/model surface you want to use
- Optional: OpenRouter-backed tools or models exposed in your VS Code chat environment

## ⚠️ Known Issues

- Copilot Chat API is still evolving; some features may require updates as the API stabilizes
- Model selection may not work in all configurations

**Disclaimer:** This extension automates Copilot Chat. GitHub's [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies#4-spam-and-inauthentic-activity-on-github) prohibit "excessive automated bulk activity", the [Terms of Service § H (API Terms)](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms) allow account suspension for excessive API usage, and the [GitHub Copilot Additional Product Terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#github-copilot) apply these policies directly to Copilot. Use at your own risk; your account could be rate-limited or restricted. Configure jitter/daily limits/longer intervals to reduce risk, but there is no guarantee.

Note: There are [reports](https://github.com/orgs/community/discussions/160013) of Copilot access being restricted even without using automation tools. These mitigations reduce obvious automation patterns but cannot eliminate that risk.

🐛 [Report a bug](https://github.com/aktsmm/vscode-copilot-scheduler/issues)

## 📦 Release Notes

### 🏷️ 0.1.0

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
