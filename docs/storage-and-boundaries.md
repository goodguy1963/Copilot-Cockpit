# Storage and Boundaries

## Repo-Local Storage

- Workspace scheduler data lives in `.vscode/scheduler.json` and `.vscode/scheduler.private.json`.
- SQLite mode can mirror state into `.vscode/copilot-cockpit.db`.
- Research profiles live in `.vscode/research.json` and can also be mirrored into SQLite.
- Backup history lives in `.vscode/scheduler-history`.
- Inline prompt backups live in `.vscode/cockpit-prompt-backups`.

## Private vs Public

- Todo Cockpit state, planning notes, Telegram secrets, and sensitive coordination data stay in `.vscode/scheduler.private.json`.
- Legacy GitHub token fields may still be read from older workspace state for compatibility, but current saves do not persist or reuse a GitHub PAT.
- The public scheduler state and the webview only receive safe GitHub integration state plus cached inbox metadata. Runtime GitHub refresh resolves credentials from VS Code's built-in authentication providers instead.
- The extension bootstraps `.vscode/.gitignore` to reduce accidental leaks of private cockpit state.

## Workspace Boundaries

- State is intentionally repo-local.
- Nested repositories do not inherit scheduler state from a parent workspace.
- MCP launcher support files are created under `.vscode/copilot-cockpit-support` for stable repo-local startup.

## Runtime Boundaries

- Repo-local scheduler and research JSON are runtime boundaries, not just TypeScript assumptions.
- Stored workspace state is parsed tolerantly so malformed sibling records can be dropped while valid tasks, profiles, and runs still load.
- Webview -> Extension messages and MCP tool arguments are validated at the boundary before dispatch.
- Those interactive boundaries stay intentionally shallow: validate the discriminant and routing payload shape first, then leave deeper business rules to the owning handlers and managers.
- Plain-Node helpers are preferred for boundary code that is shared with the embedded server or MCP path.

## Storage Mode Notes

- JSON mode and SQLite mode expose the same higher-level workflows.
- SQLite mode still keeps compatibility JSON mirrors and a migration journal at `.vscode/copilot-cockpit.db-migration.json`.

[Back to README](../README.md)
