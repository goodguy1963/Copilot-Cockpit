# Changelog

All notable changes to the "Copilot Scheduler" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Improved

- **Cockpit routing toolchain**: Added a compact `cockpit_list_routing_cards` MCP read tool plus dispatcher skill/prompt guidance so agents can route Todo Cockpit cards without scanning the full board payload.
- **Routing semantics**: Documented the distinction between `labels`, `flags`, and comment labels; `GO` is now treated explicitly as a flag signal in the dispatcher docs.

## [1.0.13] - 2026-02-25

### Security

- **Error log sanitization**: Added `errorSanitizer` module to strip absolute filesystem paths from error messages before logging, preventing accidental exposure of local directory structures in logs.
- Applied path sanitization across `scheduleManager`, `extension`, `promptResolver`, `copilotExecutor`, and `schedulerWebview`.

### Tests

- Expanded unit tests for `extension`, `promptResolver`, `templateValidation`, and `schedulerWebview` modules.
- Added `schedulerWebview.test.ts` covering webview message handling and serialization edge cases.

## [1.0.12] - 2026-02-25

### Fixed

- **Template prompt execution**: When a template file is open in the editor, task execution now prefers in-memory document text (supports unsaved edits).
- **Webview validation**: For `promptSource=local/global`, saving is blocked when no template is selected, with a localized error.
- **Create task UX**: The TreeView "+" action now always starts in "create new task" mode.

## [1.0.10] - 2026-02-24

### Fixed

- **Minimum interval warning**: `checkMinimumInterval()` now falls back to local time when the configured timezone is invalid, so short-interval cron warnings still work.

### Tests

- Added unit tests covering the invalid-timezone fallback behavior.

## [1.0.11] - 2026-02-24

### Fixed

- **Template prompt refresh on execution**: Healed legacy tasks where `promptPath` existed but `promptSource` was missing/incorrect, so template edits are reflected when tasks execute.

### Tests

- Added regression tests for promptSource migration from `promptPath`.

## [1.0.9] - 2026-02-24

### Fixed

- **Command error handling**: Wrapped remaining command handlers with consistent try/catch to avoid unhandled failures.
- **Template safety**: Prevented `.agent.md` files from being treated/loaded as prompt templates.
- **Path normalization edge cases**: Preserved filesystem root handling during normalization (avoids collapsing `/` to empty) and tightened containment checks.

### Improved

- **Webview consistency**: Added case-insensitive path compare support on Windows and localized success-toast prefix.
- **Resilience**: Healed corrupted/invalid persisted Date fields to avoid JSON serialization breakage.
- **Tooltip robustness**: Avoided Markdown code fence breakage when user content contains ```.

## [1.0.8] - 2026-02-24

### Fixed

- **Config change duplicate recalculation**: Consolidated timezone / enabled recalculation to avoid duplicate `recalculateAllNextRuns()` when both change in a single event (U22/U24).
- **Agent ID normalization**: AGENTS.md agents now use `@`-prefixed IDs consistent with `.agent.md` agents (U32).
- **Log safety**: Prompt text is no longer logged; only prompt length is shown to prevent secret exposure.

### Improved

- **i18n consolidation**: Moved all hard-coded agent/model descriptions in `copilotExecutor.ts` to `i18n.ts` messages (agentNoneName, agentModeDesc, modelDefaultName, etc.).
- **Dead code removal**: Removed unused `fs` imports, redundant `openingSettings` / `agentNone` / `agentAgent` messages, and consolidated duplicate notification guards.
- **Webview lifecycle**: Added explicit `SchedulerWebview.dispose()` in `deactivate()` for clean shutdown; promptSyncInterval cleanup via disposable.
- **Task copy suffix**: Duplicate-task name suffix now uses i18n (`taskCopySuffix`).
- **Review learnings**: Updated `.github/review-learnings.md` with new entries.

## [1.0.7] - 2026-02-24

### Fixed

- **Prompt placeholder safety**: Template variables (`{{workspace}}`, `{{file}}`, `{{filepath}}`) now use function replacers to prevent `$&`/`$'`/`` $` `` patterns in workspace/file names from corrupting prompt text.
- **Last run accuracy**: `lastRun` is now recorded only on successful execution; previously it was set even on failure, misleading users into thinking the task ran normally.
- **Cross-platform NLS**: Settings descriptions for `globalPromptsPath` / `globalAgentsPath` now list default paths for Windows, macOS, and Linux (was Windows-only).

### Improved

- **Code review hardening**: Tooltip markdown escaping (P4), duplicate field copy (P5), test command coverage (P6), CSS class definitions (P7), cross-platform path resolution (P8) — all addressed per review learnings.
- **Review learnings**: Added U14 (replace special patterns) and U15 (failed operation timestamps) to `.github/review-learnings.md`.

## [1.0.6] - 2026-02-24

### Fixed

- **Webview localization**: Localized the initial HTML select placeholders (Agent/Model/Template) to avoid hard-coded English in Japanese UI.
- **Template load validation**: Normalized resolved paths during allowlist checks to avoid Windows case-sensitivity mismatches.
- **Timezone resilience**: Invalid `copilotScheduler.timezone` now falls back to local time instead of breaking cron validation/next-run calculation.

### Changed

- **Jitter setting**: `copilotScheduler.jitterSeconds` minimum is now 0 (0 = off), aligned across schema and docs.
- **Lint ergonomics**: Added a minimal ESLint config so `npm run lint` is runnable.

## [1.0.5] - 2026-02-24

### Fixed

- **Missed executions after reload**: Preserve persisted `nextRun` on startup; compute it only when missing/invalid so tasks don't appear to "not run" after a window reload.
- **Manual run rescheduling**: Manual "Run Now" updates both `lastRun` and `nextRun` so `*/N * * * *` tasks count from the manual execution time.

### Changed

- **First run delay option**: "Run first execution" now schedules the first run in 3 minutes (was 1 minute).

## [1.0.3] - 2026-02-24

### Improved

- **Dead code removal**: Removed ~400 lines of unused code — `cronBuilder.ts` (entire file), `TaskExecutionResult` / `ExtensionConfig` types, `getAgentDisplayInfo()`, and `logInfo()`.
- **Prompt resolution**: Consolidated `getGlobalPromptsRoot` logic into `promptResolver.ts`, eliminating duplication between `extension.ts` and `schedulerWebview.ts`.
- **Webview message safety**: All Webview `postMessage` calls now go through the ready-check queue wrapper.

## [1.0.4] - 2026-02-24

### Improved

- **Workspace task clarity**: Workspace-scoped tasks are grouped into "This workspace" / "Other workspaces" in the TreeView for easier scanning.
- **Safety**: Workspace-scoped tasks that belong to a different workspace can no longer be deleted from the current workspace (TreeView + Webview + command guard).

## [1.0.2] - 2026-02-23

### Added

- **Reload prompt after update**: A notification with a "Reload Now" button is shown when the extension version changes, guiding users to reload VS Code.

## [1.0.1] - 2026-02-23

### Fixed

- **VSIX contents**: Excluded dev-only `research/` artifacts from the packaged extension.

## [1.0.0] - 2026-02-23

### Improved

- **Webview performance & maintainability**: Moved the large webview script to `media/schedulerWebview.js`.
- **Webview security**: Tightened CSP and restricted `localResourceRoots` to extension `media/` and `images/` only.
- **Prompt resolution consistency**: Local prompts are now resolved consistently in multi-root workspaces, restricted to `.github/prompts/*.md`.
- **Task persistence robustness**: Centralized revision-based store selection and healing behavior.

### Added

- **Regression tests** for template load validation, prompt path resolution, and task-store selection.

## [0.9.13] - 2026-02-23

### Fixed

- **Edit navigation on Windows**: Replaced unsafe `querySelector('option[value="..."]')` with a safe option-iteration helper (`selectHasOptionValue`) so that editing tasks with Windows-style template paths no longer breaks tab switching or form population.
- **Type alignment**: Added `editTask`, `showError`, and `switchToList.successMessage` to `ExtensionToWebviewMessage` union to match the actual messages sent from the extension host.

## [0.9.12] - 2026-02-22

### Improved

- **Scope clarity (Tree/Webview)**: Workspace-scoped tasks now show their target workspace and whether they apply to the current workspace.
- **One-click move to current workspace**: Added a move action for workspace-scoped tasks (Webview + TreeView context menu + inline button).
- **Manual run safety**: Running a workspace-scoped task from a different workspace now prompts for confirmation to prevent accidental execution.

## [0.9.11] - 2026-02-22

### Improved

- **Scheduler performance**: Config is now read once per tick instead of 3× in the hot loop, eliminating variable shadowing and redundant I/O.
- **Timer resource leak**: `saveTasksToGlobalState` timeout timer is now cleared on success, preventing a 10 s resource leak per save.
- **Webview panel reveal**: Re-opening the scheduler panel no longer triggers a full background re-scan — cached data is sent instantly for snappier UX.
- **Prompt execution speed**: Hardcoded delays reduced from 600 ms to 300 ms total for faster prompt submission.
- **Dead code removal**: Unused `taskName` variable and orphan `setDefaultScope` message type removed.

### Fixed

- **Integration tests on Windows**: Tests no longer fail with "Code is currently being updated" by patching the downloaded VS Code's `product.json` to disable the Inno Setup mutex check.

## [0.9.10] - 2026-02-22

### Fixed

- **Webview save reliability (Windows paths)**: Avoid unescaped CSS selectors in option restoration and guard the message handler so errors no longer break subsequent UI updates.

## [0.9.9] - 2026-02-22

### Fixed

- **Scheduler stability**: Prevent overlapping scheduler ticks to avoid duplicate executions when a tick runs long.
- **Webview robustness**: Safely restore prompt template selection without CSS selector edge cases.
- **Webview localization**: Localize titles and placeholder strings instead of hard-coded English.
- **Multi-root workspace**: Workspace-scoped tasks now match against any open folder.
- **Extension host responsiveness**: Avoid blocking sync file I/O during agent discovery.
- **Diagnostics**: Improve error logging and show a webview error when message handling fails.

## [0.9.8] - 2026-02-22

### Fixed

- **Task persistence fallback**: Tasks are now persisted to a JSON file under the extension's `globalStorage` as a fallback, so saves still succeed even if `globalState` storage is blocked or stalls.
- **Save responsiveness**: When file persistence succeeds, the UI no longer waits on slow/blocked `globalState.update()` calls (globalState sync is done in the background).

## [0.9.7] - 2026-02-22

### Fixed

- **Edit form: agent/model/template preservation**: Editing a task no longer loses agent, model, or prompt template selections when dropdown options haven't loaded yet (pending-value mechanism).
- **Edit form: enabled state**: Editing a disabled task no longer re-enables it on save.
- **Edit form: workspacePath stability**: Editing a workspace-scoped task from a different workspace no longer overwrites the original `workspacePath`.
- **Manual run (Run Now)**: Now correctly persists `lastRun` and refreshes the tree/webview after execution, without applying jitter or daily limits.

### Added

- **Logger utility** (`src/logger.ts`): All `console.log`/`console.error` output is now gated by the `copilotScheduler.logLevel` setting (`none` / `error` / `info` / `debug`).
- **Settings hot-reload**: Changing `globalPromptsPath` or `globalAgentsPath` now refreshes the agent/model/template caches and updates the webview **without rebuilding the HTML** (preserving form state).
- **Scheduler enabled/disabled toggle**: Changing `copilotScheduler.enabled` now starts or stops the scheduler timer immediately, instead of only checking at each tick.

## [0.9.6] - 2026-02-22

### Fixed

- **Task creation reliability**: Webview task creation no longer resets the form before the extension confirms success; validation errors are shown inline.
- **Windows Server stability**: Webview no longer blocks on agent/model/template refresh; background refresh reduces UI hangs.
- **Jitter runtime error**: Fixed a potential ReferenceError during jitter delay.
- **Tooltip safety**: Prompt preview tooltip no longer uses trusted Markdown.
- **Storage hang safeguard**: Added a timeout when saving tasks to extension storage to avoid indefinite hangs.

## [0.9.5] - 2026-02-21

### Changed

- **Allow unlimited daily executions**: `maxDailyExecutions` now accepts 0 (unlimited) again, with a warning that excessive usage may risk API rate-limiting. Use at your own risk.
- **Default raised to 24**: `maxDailyExecutions` default changed from 12 to 24.
- **Hard cap raised to 100**: `maxDailyExecutions` range changed from 1–48 to 0–100 (0 = unlimited).
- **Unlimited warning**: A warning message is shown when setting `maxDailyExecutions` to 0.

## [0.9.4] - 2026-02-17

### Changed

- **Jitter max raised**: `jitterSeconds` maximum raised from 600 to 1800 (30 min), allowing users to add more randomization.

## [0.9.3] - 2026-02-17

### Changed

- **Remove unlimited bypass**: `maxDailyExecutions` no longer accepts 0 (unlimited). Enforced range: 1–48 (default: 12).
- **Hard cap raised**: `maxDailyExecutions` hard cap changed from 24 to 48 for flexibility.

## [0.9.2] - 2026-02-17

### Changed

- **Safety-first defaults**: `jitterSeconds` default changed from 0 to 600 (10 min max random delay enabled by default).
- **Jitter hard minimum**: `jitterSeconds` minimum raised from 0 to 60 seconds.
- **Daily execution limit tightened**: `maxDailyExecutions` default changed from 50 to 12, with a hard cap of 24/day.

## [0.9.1] - 2026-02-17

### Documentation

- Added primary source URLs to disclaimer sections (AUP §4, ToS §H, Copilot Additional Terms, Community Discussion #160013)

## [0.9.0] - 2026-02-17

### Added

- **Per-task jitter (random delay)**: Each task can set a max random delay (0–600s) before execution to reduce machine-like patterns. A global default is also available via `copilotScheduler.jitterSeconds`.
- **Daily execution limit**: Configurable cap on scheduled executions per day (default: 50, `copilotScheduler.maxDailyExecutions`). A one-time notification is shown when the limit is reached.
- **Minimum cron interval warning**: Warns when a cron expression runs more often than every 30 minutes. Can be toggled via `copilotScheduler.minimumIntervalWarning`.
- **Disclaimer notification**: A one-time informational message about GitHub ToS/AUP risks is shown when the first enabled task is created or activated.
- **Prompt template sync**: Tasks using local/global prompt templates now have their cached prompt text synced at startup and once daily, so UI displays stay up to date.

### Changed

- Daily execution counter now uses local date instead of UTC.
- README settings table fixed from `copilotSchedule.*` to correct `copilotScheduler.*` prefix.

### Documentation

- Added disclaimer about GitHub Acceptable Use Policies and automation risks to README (EN/JA).
- Documented new settings: `jitterSeconds`, `maxDailyExecutions`, `minimumIntervalWarning`.

## [0.1.0] - 2026-02-01

### Added

- Initial release of Copilot Scheduler
- Cron-based scheduling for Copilot prompts
- Support for built-in agents (@workspace, @terminal, @vscode, agent, ask, edit)
- Support for multiple AI models (GPT-4o, Claude Sonnet 4, etc.)
- English and Japanese localization with auto-detection
- Sidebar TreeView for task management
- Webview GUI for creating and editing tasks
- Task scoping (global vs workspace-specific)
- Prompt template support (local and global)
- Prompt placeholders ({{date}}, {{time}}, {{workspace}}, etc.)
- Commands:
  - Create task (CLI and GUI)
  - List tasks
  - Edit task
  - Delete task
  - Toggle task (enable/disable)
  - Run now
  - Copy prompt
  - Duplicate task
  - Open settings
  - Show version
- Configuration options:
  - Enable/disable scheduling
  - Notification settings
  - Log level
  - Language preference
  - Timezone settings
  - Chat session behavior
  - Default scope
  - Global prompts path

### Security

- Webview CSP with nonce for script protection
- Path traversal prevention for prompt templates
- No sensitive data stored in globalState
