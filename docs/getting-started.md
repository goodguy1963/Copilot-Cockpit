# Getting Started

Copilot Cockpit works best when you think of it as a simple loop:

1. Plan the work.
2. Approve the handoff.
3. Run the right execution unit.
4. Review the result before granting more autonomy.

## Quick Start

1. Open Copilot Cockpit from the activity bar or with `Copilot Cockpit: Create Scheduled Prompt (GUI)`.
2. Start in `How To Use` if you are new to the extension.
3. Capture or refine work in `Todo Cockpit`.
4. Move approved work into a task draft when the item is `ready`.
5. Use `Tasks` for one execution unit, `Jobs` for ordered multi-step execution, and `Research` for benchmark-driven iteration.
6. Open `Settings` to configure repo-local defaults and integrations.

## Choose The Right Surface

- Use `Todo Cockpit` when the work still needs planning, comments, or approval.
- Use `Tasks` when one prompt and one schedule are enough.
- Use `Jobs` when the work needs ordered stages or pause checkpoints.
- Use `Research` when the goal is measured improvement against a benchmark.

If you want the tab-by-tab walkthrough, continue to [Feature Tour](./feature-tour.md).

## Start With One Real Loop

Skip toy prompts. Start with one recurring loop that would still be worth keeping after the demo.

- For a small project, use an opportunity scout, a delivery-risk watch, and a knowledge packager, then stop at a review checkpoint.
- For a company team, use the same pattern for product signals, security and release readiness, support queues, or operations follow-up.
- If you also want to show the Research surface, add one benchmarked profile that scores onboarding or prompt quality against a simple command.

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

The demo GIF lives at `images/DEMO.gif`. It is a quick overview, so use the README feature tour for the slower tab-by-tab explanation.

[Back to README](../README.md)
