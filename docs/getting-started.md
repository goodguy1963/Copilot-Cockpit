# Getting Started

Copilot Cockpit works best when you treat it as one workflow stack with three layers:

1. Planning and triage in `Todo Cockpit`
2. Execution and scheduling through `Tasks` and `Jobs`
3. Optional tool/control-plane integration through `Research`, `MCP`, and repo-local agent surfaces

The recommended path is: start with a `Todo`, use `Research` when context is missing, then promote approved work into a `Task` or `Job`.

## Quick Start

1. Open Copilot Cockpit from the activity bar or with `Copilot Cockpit: Create Scheduled Prompt (GUI)`.
2. Start in `How To Use` if you are new to the extension, or click the top-bar `Intro Tutorial` button for the same walkthrough.
3. Capture or refine work in `Todo Cockpit`. A `Todo` is the planning artifact and intake surface.
4. Use `Research` if the work still needs exploratory context, outside evidence, or benchmarked iteration.
5. Move approved work into `ready`, then promote it into a `Task` for one executable unit or a `Job` for an orchestrated or scheduled run.
6. Open `Settings` to configure repo-local defaults and integrations. Use the top-bar `Plan Integration` button only when you want optional control-plane extensions such as MCP, skills, or starter agents.

## Stable Primitives

- Use `Todo Cockpit` when the work still needs planning, comments, approval, or triage.
- Use `Tasks` when one prompt and one schedule are enough for one executable unit.
- Use `Jobs` when the work needs ordered stages, orchestration, or pause checkpoints.
- Use `Research` when the work needs exploratory context or measured improvement before execution.

## Optional Extensions

- Add `MCP`, repo-local skills, or starter agents after the default path is working.
- Treat those capabilities as control-plane extensions, not as mandatory setup for first use.

If you want the tab-by-tab walkthrough, continue to [Feature Tour](./feature-tour.md).

## Start With One Real Loop

Skip toy prompts. Start with one recurring loop that would still be worth keeping after the demo.

- For a small project, use an opportunity scout, a delivery-risk watch, and a knowledge packager, then stop at a review checkpoint.
- For a company team, use the same pattern for product signals, security and release readiness, support queues, or operations follow-up.
- If you also want to show the Research surface, add one benchmarked profile that scores onboarding or prompt quality against a simple command before you promote anything into execution.

That keeps the demo honest: the proof is useful output plus explicit review, not a claim that the system should run unchecked.

## Installation From Release

1. Download the latest `copilot-cockpit-X.X.X.vsix` from the GitHub releases page.
2. Run `Extensions: Install from VSIX...` in VS Code.
3. Select the VSIX and reload VS Code.
4. Disable or uninstall `yamapan.copilot-scheduler` if it is still installed.
5. After reload, Copilot Cockpit creates or repairs repo-local support files such as `.vscode/mcp.json` for the current workspace.

## Installation From Source

1. Build the package with `npm run package:vsix`.
2. Install it with one of these commands:

```text
npm run install:vsix
npm run install:vsix:insiders
npm run install:vsix:both
```

1. If the VS Code shell command is unavailable, use `Extensions: Install from VSIX...` and select the generated package manually.
2. Reload VS Code.
3. Disable or uninstall `yamapan.copilot-scheduler` if it is still installed.

## Demo

[![Watch the Copilot Cockpit intro video](../images/DEMO%20v2.gif)](https://www.youtube.com/watch?v=yiJCmwmxEFc)

Use [Feature Tour](./feature-tour.md) for the slower tab-by-tab explanation.

[Back to README](../README.md)
