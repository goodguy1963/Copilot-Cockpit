<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
    <img src="images/icon.png" alt="Copilot Cockpit icon" width="128">
</p>
<h1 align="center">Copilot Cockpit</h1>
<!-- markdownlint-enable MD033 MD041 -->

Copilot Cockpit helps you plan AI work, approve it, and then run it with visible checkpoints instead of handing your repo to a blind autonomous loop.

The strongest demo is not claiming the repo can run itself. It is showing bounded recurring work that a person would actually keep: scouting opportunities, checking delivery risk, packaging knowledge, and then stopping for review.

## 🎬 Demo

![Copilot Cockpit demo](images/DEMO.gif)

This GIF is a fast overview of the product surface. Use the feature tour below for the slower tab-by-tab explanation.

For the step-by-step walkthrough, open [docs/feature-tour.md](docs/feature-tour.md).

If the embedded image does not render in your viewer, open [images/DEMO.gif](images/DEMO.gif) directly.

## Why It Exists

Most AI automation demos jump straight to execution. That looks impressive until the model burns tokens, edits files too early, or drifts away from the real goal.

Copilot Cockpit separates planning, approval, execution, and review so autonomy is earned step by step instead of assumed from the start.

In practice, the LLM is the native execution chat surface, while Copilot Cockpit is the orchestration and review layer around it. It gives a human or AI decision-maker a place to capture work, review it, research it, discuss it, and hand it off safely.

The point is not to reject automation. The point is to make automation accountable and keep humans in charge until the workflow has proven it deserves more autonomy.

That matters most when the repo keeps producing more work than any one person can hold in memory: bugs, feature ideas, follow-up changes, security updates, web findings, pricing checks, customer tasks, or research that should turn into implementation later. Copilot Cockpit turns those discoveries into a visible queue so work can be found again and handled properly instead of getting lost between chat sessions.

## 🧠 The Core Loop

Think of Copilot Cockpit as a local control system for structured AI work:

1. Capture and discuss work in `Todo Cockpit`.
2. Research and refine it until the user is happy with the direction.
3. Move approved work into `ready`.
4. Turn that work into a `Task`, `Job`, or `Research` run.
5. Review outcomes before granting more autonomy.

This keeps the relationship collaborative: you work with the LLM, not under a black-box agent that guesses what should happen next.

## ✨ Feature Tour

### Todo Cockpit

`Todo Cockpit` is the planning and approval hub. Use it to capture work, add comments, apply labels and flags, and hand approved work into execution.

### Tasks

`Tasks` are the simplest execution unit: one prompt, one scheduled action, one concrete piece of work. Use them for one-time runs or recurring execution.

That includes recurring tasks such as security research, market checks, feature scouting, maintenance prompts, prompt refinement, repo upkeep, or any other repeated work that should run on a schedule and return to review.

### Jobs

`Jobs` are ordered multi-step workflows built from multiple steps with reusable actions and pause checkpoints. Use them when the work should not run as one uninterrupted chain.

Think of `Jobs` as deeper agentic workflows inside VS Code: research, decision support, implementation steps, maintenance steps, MCP calls, or external-tool sequences that should be inspected at explicit checkpoints instead of left to one opaque run.

### Research

`Research` profiles are bounded benchmark-driven iteration loops. Use them when you need repeated attempts at improvement against a metric instead of one direct execution.

Research is especially useful when the work should pull in fresher outside knowledge first, through web search, Perplexity, scrapers, or other tooling, and then return that material for user review before implementation begins.

### Model And Agent Choice

Copilot Cockpit is designed for mixed-model work. Sometimes one model is better for planning, another for implementation, and another for research or code review. The goal is not to crown one universal expert, but to let specialized agents and model choices work together under one controlled workflow.

That also creates a control layer for cost: GitHub Copilot or OpenRouter can use different models with different pricing, and tasks can be routed to different agents depending on the importance, difficulty, or budget of the work. Expensive models can be reserved for the hard parts, while cheaper models handle routine research, monitoring, or maintenance.

### Settings

`Settings` configure workspace defaults, integrations, storage mode, and execution preferences so the cockpit matches the repo you are operating in.

### How To Use

`How To Use` is the built-in onboarding tab. Start there if you want a guided explanation of the operating model before you schedule anything.

## Common Workflows

### Approval-First Work

Capture work in `Todo Cockpit`, discuss it, move it into `ready`, and only then prepare the execution unit.

### Research-First Collaboration

Use `Research`, web search, or tool-assisted discovery to gather current information first. Review that output with the user, discuss changes, and only then convert the result into scheduled implementation work.

### Scheduled Execution

Use `Tasks` when one piece of work should run once or on a recurring schedule.

### Multi-Step Or Measured Work

Use `Jobs` when work needs ordered stages and review points. Use `Research` when the goal is measured improvement over time.

### Controlled Parallel Work

Run non-conflicting work in parallel, but keep conflicting work visible and scheduled in a controlled way. Copilot Cockpit helps decide what can safely run side by side and what should wait for review or sequencing.

That includes deciding which agent or model should do which task, so quality, speed, and wallet impact stay under user control instead of being hidden inside one opaque automation path.

### Continuous Company Memory

Archive completed work, rejected ideas, and reviewed research so the repo gains project-specific intelligence over time instead of starting from scratch on every new chat.

## Example Loops

### Small Project Delivery Loop

Start with one recurring loop that produces useful work instead of toy output.

- `Small Project Opportunity Scout (Daily)` turns repo signals into a short list of next-step proposals.
- `Delivery Risk and Security Watch (Daily)` looks for shipping, trust, and operational blind spots.
- `Knowledge and Shipping Packager (Daily)` turns recent work into reusable docs, memory, and release material.
- `Project Intelligence and Delivery Prep` runs those steps in sequence and stops at a review checkpoint before anything turns into real execution.
- `Onboarding Example Coverage Research` benchmarks whether the docs still explain Cockpit, Tasks, Jobs, and Research with explicit review checkpoints.

This is a good fit for a solo product, an internal tool, a small SaaS, or an actively maintained extension like this repo.

### Company-Scale Examples

The same operating model scales by giving each team its own bounded loops, models, and review checkpoints.

- Product and marketing teams can triage customer signals, monitor competitors, prepare launch briefs, and keep content pipelines moving.
- Engineering and security teams can watch dependencies, review release readiness, monitor operational drift, and stage migration or maintenance work.
- Operations and support teams can cluster recurring requests, maintain SOPs, monitor vendors or accounts, and convert findings into visible follow-up queues.

The point is not to overclaim autonomy. The point is to show recurring, inspectable work that is useful at small scale and still makes sense when the organization gets larger.

## ⚡ Quick Start

1. Open Copilot Cockpit from the activity bar or run `Copilot Cockpit: Create Scheduled Prompt (GUI)` from the command palette.
2. Start in `How To Use` if you are new to the extension.
3. Capture or refine work in `Todo Cockpit`.
4. Move approved work into `ready` to prepare a task draft.
5. Use `Tasks` for one execution unit, `Jobs` for multi-step flows, and `Research` for benchmark-driven iteration.
6. Open `Settings` to configure repo-local defaults, MCP, Copilot skills, and Codex support files.

## 📚 Documentation

Detailed documentation lives under [docs/index.md](docs/index.md).

- [Getting Started](docs/getting-started.md)
- [Feature Tour](docs/feature-tour.md)
- [Workflows](docs/workflows.md)
- [Integrations](docs/integrations.md)
- [Storage and Boundaries](docs/storage-and-boundaries.md)
- [Architecture and Principles](docs/architecture-and-principles.md)
- [Todo Cockpit Feature Notes](TODO_COCKPIT_FEATURES.md)

## Advanced Capabilities

- `MCP` gives AI agents a controlled tool surface to use the plugin inside the workspace.
- Support for Copilot-first workflows, with experimental Codex integration for repo-local coordination.
- Specialized agents, skills, prompts, hooks, memories, and tool connections can be maintained as part of the same controlled workflow.
- External systems such as email handling, web data collection, price checks, or other connected tools can feed into scheduled work when exposed through MCP or related integration layers.
- Active review state is carried by canonical workflow flags such as `needs-user-review`, `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`.
- During execution handoff, live scheduled cards use the built-in `ON-SCHEDULE-LIST` flag, and final acceptance handoff can use `FINAL-USER-CHECK`.

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

## 🤝 Supported Models
Bring your own LLM via:

| Surface | Status | What It Can Do |
| --- | --- | --- |
| [GitHub Copilot in VS Code](https://github.com/features/copilot/plans) | Primary | Full planning, task scheduling, task execution, jobs, research, and MCP-driven workflows |
| [OpenRouter.ai](https://openrouter.ai/) | Supported | Full planning, task scheduling, task execution, jobs, research, and MCP-driven workflows |
| ChatGPT Codex in VS Code | Experimental | Repo-local MCP, repo-local skills, todo coordination, and task-draft coordination |

### 🚧 Codex Limitation

Codex support is currently limited. It can help create and coordinate todos and task drafts, but scheduled task execution does not run through Codex today. Tasks run through Copilot Chat in VS Code. Scheduling tasks directly through the Codex VS Code extension is not implemented yet.

## 📝 Notes

- The extension bundles an embedded MCP server at `out/server.js`.
- `Set Up MCP` repairs only the local scheduler entry and preserves unrelated MCP servers.
- `Sync Bundled Skills` targets Copilot-style repo-local skills under `.github/skills`.
- `Add Skills To Codex` targets Codex-style repo-local skills under `.agents/skills` and refreshes the managed `AGENTS.md` block.
- The workflow is inspired by the AK TM style of agent-oriented task management and disciplined handoff.

## 🤝 Attribution and Provenance

Copilot Cockpit is built upon [vscode-copilot-scheduler by aktsmm](https://github.com/aktsmm/vscode-copilot-scheduler).

This repository contains a mix of:

- derived or adapted portions that originate from `vscode-copilot-scheduler` and remain subject to `CC BY-NC-SA 4.0`
- later original additions in this repository, including major Cockpit-specific surfaces such as Todo Cockpit, Research Manager, SQLite-backed storage support, Jobs workflows, Codex coordination support, and newer MCP-oriented orchestration layers

The top-level license notice and a more detailed breakdown live in [LICENSE](LICENSE) and [PROVENANCE.md](PROVENANCE.md).

## 📄 License

See [LICENSE](LICENSE) for the mixed-license notice covering derived `CC BY-NC-SA 4.0` portions and later original additions in this repository. See [PROVENANCE.md](PROVENANCE.md) for a brief derived-vs-original breakdown.
