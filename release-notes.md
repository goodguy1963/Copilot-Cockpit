# Release Notes

## 2026-04-29

### Refreshed Product Tagline

- Updated `package.json` and `README.md` to the new tagline: **"The AI control layer for GitHub Copilot — a persistent AI workflow cockpit inside VS Code with planning, review gates, and an agent crew for the heavy lifting."**

### CEO Agent — Terminal Prohibition

- Clarified that `CEO` must never use the terminal, run tasks, or execute code directly. Any missing tool or execution surface is a mandatory routing signal to a suitable specialist — not a reason to improvise.
- Strengthened non-goals and decision rules to reinforce that `CEO` delegates all execution work and does not attempt terminal commands, script execution, or direct file edits.

## 2026-04-27

### GitHub Inbox Integration For Todo Cockpit

- Added optional repo-local GitHub settings in the `Settings` tab, with new saves and refresh resolving credentials through VS Code's built-in `github` or `github-enterprise` authentication providers instead of storing a new PAT.
- Added manual `Refresh GitHub Inbox` support plus sync status reporting and cached inbox lanes for `Issues`, `Pull Requests`, and `Security Alerts`.
- Added `Create Todo` and `Create Todo + Review` import paths on GitHub inbox rows.
- GitHub-sourced Todo cards now keep structured source metadata so repeat imports reuse and update the existing card instead of creating duplicates.
- The saved GitHub automation prompt is now reused for GitHub-sourced `needs-bot-review` launches and `ready` task drafts.
- Pull-request sourced handoffs add security-first review guidance and branch preflight using the current local branch when VS Code's built-in Git extension can provide it.

### Prefab Starter-Agent Routing

- Updated the shipped Prefab starter-agent path to prefer live rendering through `prefab/render_ui` when the renderer is available.
- Raw Prefab wire-format JSON is now the fallback path for renderer-unavailable or explicitly JSON-only requests instead of the default end state.

See [GitHub Integration](./docs/github-integration.md) for the user-facing setup and workflow details.
