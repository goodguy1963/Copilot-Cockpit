# Storage and Boundaries

## Repo-Local Storage

- Workspace scheduler data lives in `.vscode/scheduler.json` and `.vscode/scheduler.private.json`.
- SQLite mode can mirror state into `.vscode/copilot-cockpit.db`.
- Research profiles live in `.vscode/research.json` and can also be mirrored into SQLite.
- Backup history lives in `.vscode/scheduler-history`.
- Inline prompt backups live in `.vscode/cockpit-prompt-backups`.

## Private vs Public

- Todo Cockpit state, planning notes, Telegram secrets, and sensitive coordination data stay in `.vscode/scheduler.private.json`.
- The extension bootstraps `.vscode/.gitignore` to reduce accidental leaks of private cockpit state.

## Workspace Boundaries

- State is intentionally repo-local.
- Nested repositories do not inherit scheduler state from a parent workspace.
- MCP launcher support files are created under `.vscode/copilot-cockpit-support` for stable repo-local startup.

## Storage Mode Notes

- JSON mode and SQLite mode expose the same higher-level workflows.
- SQLite mode still keeps compatibility JSON mirrors and a migration journal at `.vscode/copilot-cockpit.db-migration.json`.

[Back to README](../README.md)
