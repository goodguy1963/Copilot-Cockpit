<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
    <img src="images/icon.png" alt="Copilot Cockpit icon" width="128">
</p>
<h1 align="center">Copilot Cockpit</h1>
<!-- markdownlint-enable MD033 MD041 -->

Copilot Cockpit is built around one design decision: keep the human in the loop before an agent turns into an expensive black box that burns tokens, edits files blindly, and drifts away from the goal. 🦀📎

## 🎬 Demo

![Copilot Cockpit demo](images/DEMO.gif)

If the embedded image does not render in your viewer, open [images/DEMO.gif](images/DEMO.gif) directly.

What is a company?
A company is coordinated work, meaning the right task gets done at the right time after the right decision has been made.

That is why the project separates planning, approval, execution, and review so autonomy is earned step by step instead of assumed from the start.

A human or AI can review todos via Todo Cockpit, inspect task drafts in Task List, pause jobs, and gate execution before work runs on its own [ready -> task draft -> run], while reliable workflows can still be automated through recurring tasks, job loops , or benchmark-driven research runs. VS Code is a strong home for this because it already provides two review layers: chat-driven edits can be kept or undone [chat review], and Git adds another approval boundary before changes are committed or pushed [git review].

In practice a LLM is the native execution chat surface, while Copilot Cockpit is the orchestration and review layer around it. A space where a decision maker (human or AI) and an execution agent can communicate and store decisions.

The point is not to reject automation. The point is to make automation accountable and keep humans in charge until the workflow has proven it deserves more autonomy.

## 🧠 Mental Model

- `Todo Cockpit` is the planning and approval layer.
- `Tasks` are concrete scheduled execution units.
- `Jobs` are ordered multi-step workflows.
- `Research` is bounded benchmark-driven iteration.
- `MCP` exposes the controlled tool surface for automation.
- Active review state is carried by canonical workflow flags such as `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`.
- During execution handoff, live scheduled cards use the built-in `ON-SCHEDULE-LIST` flag, and final acceptance handoff can use `FINAL-USER-CHECK`.

Copilot Cockpit is not an always-running autonomous agent loop. It is a local control system for structured AI work.

## ✨ Quick Features

- `Todo Cockpit` is the main repo-local to-do list with sections, labels, flags, comments, due dates, review flow, and handoff into execution.
- `Tasks` are one-time or recurring cron jobs for LLM-driven execution.
- `Jobs` are ordered workflows made from multiple cron-backed steps with different actions, reusable steps, and pause checkpoints.
- `Research` profiles for bounded benchmark-driven iteration instead of blind autonomous loops.
- `MCP` gives AI agents a controlled tool surface to use the plugin inside the workspace.
- Support for Copilot-first workflows, with experimental Codex integration for repo-local coordination.

## ⚡ Quick Start

1. Open Copilot Cockpit from 

    - the activity bar by typing `>Copilot Cockpit: Create Scheduled Prompt (GUI)` or 

    - `F1` + `Copilot Cockpit: Create Scheduled Prompt (GUI)` or 

    - `stgr` + `shift` + `P` + `Copilot Cockpit: Create Scheduled Prompt (GUI)`

2. Capture or refine work in `Todo Cockpit`.
3. Move approved work into `ready` to prepare a task draft.
4. Use `Tasks` for one execution unit, `Jobs` for multi-step flows, and `Research` for benchmark-driven iteration.
5. Open `Settings` to configure repo-local defaults, MCP, Copilot skills, and Codex support files.

## 📚 Documentation

Detailed documentation lives under [docs/index.md](docs/index.md).

- [Getting Started](docs/getting-started.md)
- [Workflows](docs/workflows.md)
- [Integrations](docs/integrations.md)
- [Storage and Boundaries](docs/storage-and-boundaries.md)
- [Architecture and Principles](docs/architecture-and-principles.md)
- [Todo Cockpit Feature Notes](TODO_COCKPIT_FEATURES.md)

## 🛠️ Install

### 📦 From Release

1. Download the latest VSIX from the [GitHub releases page](https://github.com/goodguy1963/Copilot-Cockpit/releases)
2. Run `Extensions: Install from VSIX...` in VS Code.
3. Select the VSIX and reload VS Code.

### 🧪 From Source

```text
npm run package:vsix
npm run install:vsix
npm run install:vsix:insiders
npm run install:vsix:both
```

After installation, the extension creates or repairs repo-local support files for the current workspace.

## 🗂️ Key Files

| Purpose | Copilot / Native Path | Codex Path |
| --- | --- | --- |
| MCP config | `.vscode/mcp.json` | `.codex/config.toml` |
| Skills | `.github/skills` | `.agents/skills` |
| Instructions | prompt and skill references in the repo | `AGENTS.md` |
| Stable MCP launcher | `.vscode/copilot-cockpit-support/mcp/launcher.js` | uses the repo-local Codex config entry |

## 🤝 Support

| Surface | Status | What It Can Do |
| --- | --- | --- |
| GitHub Copilot in VS Code | Primary | Full planning, task scheduling, task execution, jobs, research, and MCP-driven workflows |
| OpenRouter.AI | Supported | Task execution through the extension's native chat/model flow when OpenRouter-backed models are available |
| ChatGPT Codex in VS Code | Experimental | Repo-local MCP, repo-local skills, todo coordination, and task-draft coordination |

### 🚧 Codex Limitation

Codex support is currently limited. It can help create and coordinate todos and task drafts, but scheduled task execution does not run through Codex today. Tasks run through Copilot Chat in VS Code. Scheduling tasks directly through the Codex VS Code extension is not implemented yet.

## 📝 Notes

- The extension bundles an embedded MCP server at `out/server.js`.
- `Set Up MCP` repairs only the local scheduler entry and preserves unrelated MCP servers.
- `Sync Bundled Skills` targets Copilot-style repo-local skills under `.github/skills`.
- `Add Skills To Codex` targets Codex-style repo-local skills under `.agents/skills` and refreshes the managed `AGENTS.md` block.
- The workflow is inspired by the AK TM style of agent-oriented task management and disciplined handoff.
- Copilot Cockpit grew out of the idea of Copilot Scheduler by [aktsmm](https://github.com/aktsmm).

## 📄 License

[MIT](LICENSE) © goodguy1963
