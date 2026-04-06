# Getting Started

## Quick Start

1. Open Copilot Cockpit from the activity bar or with `Copilot Cockpit: Create Scheduled Prompt (GUI)`.
2. Start in `How To Use`, then capture or refine work in `Todo Cockpit`.
3. Move approved work into a task draft when the item is `ready`.
4. Use `Jobs` for ordered multi-step execution.
5. Use `Research` for benchmark-driven iteration.
6. Open `Settings` to configure repo-local defaults and integrations.

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

The demo GIF lives at `images/DEMO.gif`.

[Back to README](../README.md)
