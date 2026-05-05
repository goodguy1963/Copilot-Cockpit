# Changelog

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
