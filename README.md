# Copilot Scheduler (Local Fork)

## What Changed In This Fork

- This fork is maintained as a private local variant and is no longer intended to track or publish back to the original upstream repository.
- The extension identity is pinned to `local-dev.copilot-scheduler-local` and the version is kept on the `99.0.x` track to avoid Marketplace collisions and accidental upstream replacement.
- Workspace task loading now resolves the authoritative scheduler root by walking up from the open folder until it finds `.vscode/scheduler.json` or `.vscode/scheduler.private.json`. This fixes the local HBG layout where the extension is opened from a child folder but the real scheduler config lives in the parent workspace.
- Workspace task persistence, prompt backup sync, prompt template discovery, and workspace ownership checks now use that same resolved scheduler root so the UI, execution path, and JSON writes stay aligned.
- The Windows test runner now creates a temporary no-space junction path before launching the VS Code test host, which avoids the local path-with-spaces startup failure on this machine.
- The embedded MCP server and hybrid workspace JSON storage remain part of the fork.

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
