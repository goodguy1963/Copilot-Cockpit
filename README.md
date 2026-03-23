# Copilot Scheduler (Local Fork)

## Local Fork Guide

This repository is the maintained private fork used in the HBG workspace. It is intentionally separated from the upstream marketplace extension and is packaged as `local-dev.copilot-scheduler-local` on the `99.0.x` version line so it does not collide with upstream installs.

### What This Fork Adds

- Strict per-repo workspace scheduling. Each repo keeps its own schedule in its own `.vscode` folder.
- Embedded MCP server support bundled with the extension.
- Hybrid task storage, where workspace tasks live in repo files and global tasks remain in extension storage.
- Repo-local schedule backup history with the last 100 changes stored under `.vscode/scheduler-history`.
- Repo-scoped auto-open on startup.
- Optional new-chat-session execution mode for scheduled runs.
- Startup review for overdue tasks instead of silent catch-up execution.
- A more compact task list and larger countdown units.
- An in-app `How To Use` tab inside the scheduler UI.

### Installation

1. Package this repo into a VSIX.
2. Install `copilot-scheduler-local-99.0.11.vsix` into `code` and/or `code-insiders`.
3. Reload VS Code.
4. Disable or uninstall `yamapan.copilot-scheduler` if it is installed, so this fork remains the active implementation.

### Basic Workflow

1. Open the scheduler from the activity bar, from `Copilot Scheduler: Create Scheduled Prompt (GUI)`, or from the activation notification's `Open Scheduler` button.
2. Create tasks in the `Create Task` tab by choosing the task name, prompt source, cron schedule, scope, and optional agent/model.
3. Manage tasks in the `Task List` tab: run, edit, duplicate, copy, enable, disable, delete, or move tasks.
4. Use the toolbar in the `Task List` tab to refresh data, toggle repo-scoped startup auto-open, and restore older repo-local schedule backups.
5. Use the `How To Use` tab inside the UI for the quick in-app reference.

### Prompt Sources

- Inline text stored directly in the task.
- Local templates from `.github/prompts/*.md` in the current repo.
- Global templates from the VS Code prompts folder or the configured global prompts path.

### Repo Storage Model

- Workspace tasks are stored in `.vscode/scheduler.json` and `.vscode/scheduler.private.json` inside the repo that is actually open in VS Code.
- The last 100 workspace schedule changes are stored in `.vscode/scheduler-history` so you can restore an older repo-local version from the UI.
- Nested repos no longer inherit tasks from a parent folder.
- Global tasks still exist in extension storage, but repo schedules are authoritative in the repo's `.vscode` files.

### Session Behavior

The setting `copilotScheduler.chatSession` controls whether a scheduled run continues in the current Copilot chat or starts a brand-new one first.

- `continue` keeps using the current chat flow.
- `new` tries to open a new Copilot chat session before sending the scheduled prompt.
- Use `new` with absolute care. One scheduled AI run can intentionally open another AI session, which means an AI-driven chain can continue further than a single message.
- This setting is separate from MCP. New chat sessions are a scheduler execution behavior, while MCP tools still depend on workspace MCP launch configuration.

Example:

```json
{
  "copilotScheduler.chatSession": "new"
}
```

### Overdue Tasks

If VS Code was closed and tasks became overdue:

- Recurring tasks are reviewed one by one on startup and can either run now or wait for the next cycle.
- One-time tasks are reviewed one by one on startup and can either run now or be rescheduled by choosing how many minutes from now they should run.
- Remaining overdue tasks are not silently auto-executed after you dismiss the review.

### Auto-Open On Startup

The setting `copilotScheduler.autoShowOnStartup` is repo-scoped.

- Turn it on in `.vscode/settings.json` for repos where you want the scheduler to open automatically.
- Or toggle it directly from the `Task List` toolbar inside the scheduler UI.

Example:

```json
{
  "copilotScheduler.autoShowOnStartup": true
}
```

### MCP Status

Yes, MCP is set up in the plugin itself.

- The extension includes an embedded MCP server implemented in `src/server.ts` and packaged as `out/server.js`.
- The embedded server exposes `scheduler_list_tasks`, `scheduler_add_task`, `scheduler_remove_task`, `scheduler_run_task`, and `scheduler_toggle_task`.
- Installing the extension does not register scheduler MCP tools globally. A workspace still needs an MCP launcher entry such as `.vscode/mcp.json` that starts the installed scheduler server.
- In short: the server is bundled with the plugin, but the workspace still decides how to launch it.

### Key Differences From Upstream

- Extension identity: `local-dev.copilot-scheduler-local`
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

| Command                                             | Description                |
| --------------------------------------------------- | -------------------------- |
| `Copilot Scheduler: Create Scheduled Prompt`        | Create a new task (CLI)    |
| `Copilot Scheduler: Create Scheduled Prompt (GUI)`  | Create a new task (GUI)    |
| `Copilot Scheduler: List Scheduled Tasks`           | View all tasks             |
| `Copilot Scheduler: Edit Task`                      | Edit an existing task      |
| `Copilot Scheduler: Delete Task`                    | Delete a task              |
| `Copilot Scheduler: Toggle Task (Enable/Disable)`   | Enable/disable a task      |
| `Copilot Scheduler: Enable Task`                    | Enable a task              |
| `Copilot Scheduler: Disable Task`                   | Disable a task             |
| `Copilot Scheduler: Run Now`                        | Execute a task immediately |
| `Copilot Scheduler: Copy Prompt to Clipboard`       | Copy prompt to clipboard   |
| `Copilot Scheduler: Duplicate Task`                 | Duplicate a task           |
| `Copilot Scheduler: Move Task to Current Workspace` | Move a workspace task here |
| `Copilot Scheduler: Open Settings`                  | Open extension settings    |
| `Copilot Scheduler: Show Version`                   | Show extension version     |

## ⚙️ Settings

| Setting                                   | Default     | Description                                                                                             |
| ----------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------- |
| `copilotScheduler.enabled`                | `true`      | Enable/disable scheduled execution                                                                      |
| `copilotScheduler.showNotifications`      | `true`      | Show notifications when tasks are executed                                                              |
| `copilotScheduler.notificationMode`       | `sound`     | Notification mode (sound/silentToast/silentStatus)                                                      |
| `copilotScheduler.logLevel`               | `info`      | Log level (none/error/info/debug)                                                                       |
| `copilotScheduler.language`               | `auto`      | UI language (auto/en/ja)                                                                                |
| `copilotScheduler.timezone`               | `""`        | Timezone for scheduling                                                                                 |
| `copilotScheduler.chatSession`            | `new`       | Chat session (new/continue)                                                                             |
| `copilotScheduler.defaultScope`           | `workspace` | Default scope                                                                                           |
| `copilotScheduler.globalPromptsPath`      | `""`        | Custom global prompts folder path (default: VS Code user prompts folder)                                |
| `copilotScheduler.globalAgentsPath`       | `""`        | Custom global agents folder path                                                                        |
| `copilotScheduler.jitterSeconds`          | `600`       | Max random delay (seconds) before execution (0–1800, 0 = off). Each task can override it.               |
| `copilotScheduler.maxDailyExecutions`     | `24`        | Daily execution limit across all tasks (0 = unlimited, 1–100). ⚠️ Unlimited may risk API rate-limiting. |
| `copilotScheduler.minimumIntervalWarning` | `true`      | Warn when cron interval is shorter than 30 minutes                                                      |

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
- **Global**: VS Code user prompts folder (or the folder set in `copilotScheduler.globalPromptsPath`)

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
