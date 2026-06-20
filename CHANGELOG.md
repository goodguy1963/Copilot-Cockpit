# Changelog

## [2.1.26] - 2026-06-20

### Fixed

- **Dependency security** — Updated the Dependabot Hono lockfile resolution to 4.12.26, covering the Lambda, Lambda@Edge, CORS, and Windows `serve-static` advisories reported for 4.12.23.
- **Transitive audit cleanup** — Updated `js-yaml` to 4.2.0 through the lockfile so the repository audit no longer reports the merge-key denial-of-service advisory.

## [2.1.25] - 2026-06-14

### Fixed

- **SQLite save reliability** — Workspace SQLite commits are now marked as internal writes so the file watcher no longer reloads against its own save cycle, preventing the disk I/O error loop that could block further saves until a VS Code reload.
- **Recovery affordance** — Disk I/O and `SQLITE_IOERR` save notifications now offer a **Reload Now** action as a last-resort recovery path for unexpected storage edge cases.
- **Dependency security** — Merged the Hono Dependabot update and refreshed vulnerable build/test dependencies, including patched `esbuild` and `brace-expansion` versions.

## [2.1.23] - 2026-05-29

### Changed

- **One-time task editor** — Editing an active one-time task now shows the remaining countdown instead of the original full delay, so the form reflects the real in-flight timer.
- **Release resilience** — Tag builds now continue through GitHub release creation when Open VSX is temporarily read-only instead of aborting after the Open VSX publish step.

### Fixed

- **One-time task updates** — Saving an unchanged one-time task no longer restarts its countdown from the beginning; existing `nextRun` timing is preserved unless the timer settings actually change.
- **VSIX packaging hygiene** — Scratch logs and temp scripts are excluded from packaged releases, and packaging now fails fast if they leak back into the archive.

## [2.1.22] - 2026-05-29

### Changed

- **MCP setup guidance** — Help-tab onboarding now treats the third-party MCP prompt as optional follow-up work so the main workspace setup can complete independently.
- **MCP server naming** — Workspace MCP configs, starter-agent tool grants, and setup guidance now use the clearer server key `copilot_cockpit` while preserving existing scheduler/cockpit tool-family wording where appropriate.
- **Private-file ignore coverage** — Automatic ignore handling now protects additional local-only `.vscode` state and generated `.github` artifacts without sweeping up shipped starter-agent content.

### Fixed

- **Stale extension windows** — After an update, unreloaded VS Code windows now keep hydrating tasks and cockpit board state from authoritative SQLite while still suppressing stale writes until reload.
- **Starter-agent setup metadata** — Bundled agent and knowledge surfaces now stay aligned with the MCP rename and current onboarding flow.

## [2.1.4] - 2026-05-05

### Added

- **Threaded comment modal** — Full-screen comment preview now includes up/down navigation, a position indicator ("3 / 8"), and an inline reply composer that stays synced with the side editor draft.
- **Review defaults recommendations** — The Settings tab tracks current vs. recommended review prompt templates separately, with a status pill and "Use recommended" button for each prompt field.
- **Read-only archived state** — Archived todos show a disabled composer and a clear read-only indicator in both the side editor and the full-screen modal.
- **Cockpit board modal sync** — After a reply is posted from the modal, the board refresh moves the modal to the latest comment automatically.
- **Shared comment draft** — The editor and modal reply composer share the same draft value, so switching between views or navigating comments preserves unsaved input.

### Changed

- **Approval modes** — `ApprovalBootstrapMode` expanded to include `"default"`, `"auto-approve"`, and `"autopilot"`. Native chat permissions now map directly to VS Code configuration.
- **GitHub integration** — Experimental notice added to the GitHub integration tab in the webview.
- **ESLint guard** — Disabled `@typescript-eslint/no-unused-vars` across test suites to reduce noise on test helpers.

### Fixed

- **Comment modal architecture** — The modal now opens by `(todoId, commentIndex)` instead of a raw comment object, enabling stable navigation and future-proof thread support.
- **Draft persistence** — Navigating between comments in the modal no longer clears the reply draft.
- **Source-shape tests** — Updated `cockpitWebview.test.ts` expectations to match the new threaded modal helpers and shared submit flow.

### Removed

- **Safe-staging workflow** — Removed the experimental `safe-staging.yml` GitHub Actions workflow.
