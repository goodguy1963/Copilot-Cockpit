# Custom Build Notes: Copilot Cockpit

## Current fork status

- Private repo target: `goodguy1963/source-scheduler-private`
- Current local fork version: `99.0.78`

## Changes made on 2026-03-23

1. Workspace schedule isolation
    - Workspace-scoped tasks are now stored only in the `.vscode` folder of the repo that is actually open in VS Code.
    - Nested subprojects no longer inherit or execute tasks from a parent repo's scheduler files.
    - MCP reads and writes now stay inside the launched repo instead of walking upward to an ancestor config.
    - Added a repo-scoped `copilotScheduler.autoShowOnStartup` setting to open the scheduler webview automatically for selected repos.
    - Overdue tasks are now reviewed at startup one by one instead of auto-running after downtime; recurring tasks can skip to the next cycle and one-time tasks can be rescheduled by minutes.
    - The webview task sections were compacted and the two-column layout now stays side by side at smaller widths.
    - Workspace scheduler writes now keep the last 100 repo-local schedule snapshots under `.vscode/scheduler-history`, and the Task List toolbar can restore an older snapshot.
    - The embedded MCP server now exposes task get/update/duplicate/history/restore/overdue tools in addition to the original list/add/remove/run/toggle surface.
    - Added cross-platform Node scripts to package and install the VSIX on Windows, macOS, and Linux without relying on PowerShell commands.

## Changes made on 2026-03-22

1. Workspace root resolution
    - Workspace scheduler tasks were temporarily changed to resolve an ancestor root by walking up until `.vscode/scheduler.json` or `.vscode/scheduler.private.json` was found.
    - That behavior has been superseded by the 2026-03-23 per-repo isolation fix above.

2. Test runner hardening
    - The Windows integration test runner now creates a temporary no-space junction path before launching the VS Code test host.
    - This avoids the local `Cannot find module 'f:\HBG'` startup failure caused by the workspace path containing spaces.

## Existing fork customizations retained

1. Renamed Extension
    - Changed `name` to `copilot-cockpit`.
    - Changed `publisher` to `local-dev`.
    - Changed `displayName` to `Copilot Cockpit`.
    - Bumped the local fork onto the `99.0.x` version track to prevent auto-updates.

2. MCP Integration
    - Embedded Model Context Protocol server (`server.ts` -> `out/server.js`).
    - Added `stdio` transport for MCP communication.

3. Hybrid Storage
    - Modified `scheduleManager.ts` to sync between internal `globalState` and `.vscode/scheduler.json`.
    - Workspace-scoped tasks are now visible/editable in `.vscode/scheduler.json`.

## Installation Instructions

1. Run `npm run package:vsix`.
2. Install with `npm run install:vsix`, `npm run install:vsix:insiders`, or `npm run install:vsix:both`.
3. If the VS Code shell command is unavailable, use `Extensions: Install from VSIX...` in the editor and pick the generated VSIX manually.
4. If you see the original marketplace extension in your extensions list, disable or uninstall it to avoid conflicts.
5. Reload Window.
