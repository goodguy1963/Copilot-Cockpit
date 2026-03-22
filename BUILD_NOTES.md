# Custom Build Notes: Copilot Scheduler (Local Fork)

## Current fork status

- Private repo target: `goodguy1963/source-scheduler-private`
- Current local fork version: `99.0.11`

## Changes made on 2026-03-22

1. Workspace root resolution
    - Workspace scheduler tasks now resolve the authoritative root by walking up from the open folder until `.vscode/scheduler.json` or `.vscode/scheduler.private.json` is found.
    - This fixes the HBG layout where the extension folder is opened directly but the scheduler config lives in the parent project root.
    - Workspace task reads, writes, prompt backups, prompt template discovery, and workspace ownership checks now use the same resolved root.

2. Test runner hardening
    - The Windows integration test runner now creates a temporary no-space junction path before launching the VS Code test host.
    - This avoids the local `Cannot find module 'f:\HBG'` startup failure caused by the workspace path containing spaces.

## Existing fork customizations retained

1. Renamed Extension
    - Changed `name` to `copilot-scheduler-local`.
    - Changed `publisher` to `local-dev`.
    - Changed `displayName` to `Copilot Scheduler (Local Fork)`.
    - Bumped the local fork onto the `99.0.x` version track to prevent auto-updates.

2. MCP Integration
    - Embedded Model Context Protocol server (`server.ts` -> `out/server.js`).
    - Added `stdio` transport for MCP communication.

3. Hybrid Storage
    - Modified `scheduleManager.ts` to sync between internal `globalState` and `.vscode/scheduler.json`.
    - Workspace-scoped tasks are now visible/editable in `.vscode/scheduler.json`.

## Installation Instructions

1. Run `code --install-extension copilot-scheduler-local-99.0.11.vsix` after packaging the updated build.
2. If you see the original marketplace extension in your extensions list, disable or uninstall it to avoid conflicts.
3. Reload Window.
