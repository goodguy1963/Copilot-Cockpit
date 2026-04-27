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
6. Open `Settings` to configure repo-local defaults and integrations. Use the top-bar `Plan Integration` button only when you want optional control-plane extensions such as MCP, skills, starter agents, or the GitHub inbox flow.

## Optional: Enable GitHub Inbox Triage

If you want GitHub intake to land directly in `Todo Cockpit`, the shortest path is:

1. Open `Settings` and enable `GitHub Integration`.
2. Fill in `Owner`, `Repository`, and keep the default API base URL for GitHub.com unless you intentionally need a different endpoint.
3. Make sure VS Code is already signed in to GitHub, or to GitHub Enterprise when you use a non-default API base URL.
4. Save the settings, then use `Refresh GitHub Inbox`.
5. Switch to `Todo Cockpit` and use `Create Todo` or `Create Todo + Review` from the cached inbox at the top of the board.

The GitHub inbox is repo-local, uses cached manual refreshes, and resolves credentials from VS Code's built-in GitHub authentication providers when you refresh. New saves no longer store or reuse a GitHub token in workspace config. For the full behavior and limits, see [GitHub Integration](./github-integration.md).

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

`Onboarding Example Coverage Research` is the simplest version of that pattern: log the onboarding gap in Todo Cockpit, use Research to gather examples or benchmark the docs, then turn the approved next step into Tasks for a direct doc pass or Jobs for a staged follow-up. Use it when you want a real onboarding loop that still stops at a review checkpoint before autonomy expands.

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
