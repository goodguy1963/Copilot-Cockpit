# Copilot Cockpit Dispatcher Plugin Improvement Plan

## Overview

This plan covers how to make Copilot Cockpit handle workspace-local dispatcher runs like the one completed today with much less manual recovery. The target workflow is a Cockpit-native dispatcher that can inspect routing cards, create or clean up linked scheduler tasks, and close out cards deterministically through the plugin's MCP surface without forcing the agent to patch `.vscode/scheduler.private.json` directly.

The main friction observed in the current run was not routing logic itself. The hard part was that the embedded MCP server did not start, so the automation session could not use the server's advertised Cockpit and scheduler tool surface even though the extension already implements several of the needed primitives.

## What Was Easy

- The board model was understandable once the local state file was inspected. `cockpitBoard.cards`, comments, `taskId`, labels, and flags were all recoverable from `.vscode/scheduler.private.json`.
- The server already contains the right building blocks for this class of workflow: `cockpit_list_routing_cards`, `cockpit_get_board`, `cockpit_get_todo`, `scheduler_add_task`, `scheduler_update_task`, `scheduler_remove_task`, and `cockpit_closeout_todo` in `extensions/source-scheduler/src/server.ts`.
- The routing data model is already mature enough for dispatcher use. `CockpitRoutingCard` includes sorted comments, matched signals, and `latestActionableUserComment` in `extensions/source-scheduler/src/types.ts`.
- The repo-local storage model is clear and local-first. The extension already treats `.vscode/scheduler.private.json` as the private source of truth and `.vscode/mcp.json` as the MCP launch surface.

## What Was Not Easy

- The biggest blocker was MCP availability. The session could not call `cockpit_get_board` or scheduler tools because the MCP server process exited before serving requests.
- The tool surface exposed to the agent did not fully match the tool surface advertised by the server implementation. In practice, the agent session did not have direct access to `scheduler_add_task` or `cockpit_list_routing_cards` even though the server code exports them.
- The workflow still required too much client-side orchestration. Even with the existing low-level tools, a dispatcher has to coordinate discovery, latest actionable comment resolution, slot selection, scheduler creation, stale-link cleanup, and board mutation sequencing itself.
- There is no first-class dispatcher transaction or routing-run primitive. That makes idempotency, rollback ordering, and compact reporting harder than necessary.
- Failure diagnostics are too weak. When the MCP server failed to start, the session only saw a generic startup error and no actionable reason or self-healing fallback.

## Requirements

1. Make the embedded MCP server reliably start and expose the same tool surface the extension advertises.
2. Give agents a single high-level dispatcher workflow tool so they do not need to orchestrate many low-level Cockpit and scheduler calls.
3. Preserve deterministic and idempotent mutation behavior.
4. Keep direct editing of `.vscode/scheduler.private.json` as a last-resort fallback with explicit guardrails.
5. Improve visibility when MCP setup is broken, stale, or pointing at the wrong build output.
6. Ensure the dispatcher can handle stale linked `taskId` values cleanly.
7. Support compact execution summaries for agent workflows.

## Implementation Steps

### 1. Fix MCP startup reliability first

Target files:

- `extensions/source-scheduler/src/server.ts`
- `extensions/source-scheduler/src/mcpConfigManager.ts`
- `extensions/source-scheduler/src/extension.ts`
- `extensions/source-scheduler/src/test/suite/server.test.ts`
- `extensions/source-scheduler/src/test/suite/mcpConfigManager.test.ts`

Changes planned:

- Add explicit startup diagnostics before `server.connect`, including resolved workspace root, resolved scheduler private config path, and any parse or path errors.
- Replace bare fatal exits with structured stderr output that identifies whether failure came from workspace discovery, config parsing, missing files, or runtime import issues.
- Add a lightweight self-test command in the extension that launches the bundled `out/server.js`, runs a list-tools handshake, and reports the result in the UI.
- Extend MCP setup validation so the extension can detect stale `.vscode/mcp.json` entries that point at an old extension build or incompatible launcher path.
- Add a visible “MCP health” indicator in the webview or command output that distinguishes “configured”, “launchable”, and “responding”.

Why this comes first:

- Until the server is reliably launchable, any higher-level dispatcher UX remains brittle.

### 2. Align the exposed tool contract with the implemented server contract

Target files:

- `extensions/source-scheduler/src/server.ts`
- Any tool registration/manifest surfaces that bridge MCP tools into the agent environment
- Relevant docs in `extensions/source-scheduler/README.md`

Changes planned:

- Audit the effective tool surface available to Copilot against `MCP_TOOL_DEFINITIONS`.
- Ensure `scheduler_add_task`, `scheduler_duplicate_task`, `cockpit_list_routing_cards`, and `cockpit_closeout_todo` are actually exposed wherever the extension claims they are available.
- Version the tool contract explicitly so clients can verify capability presence instead of assuming it.
- Add one diagnostic tool or metadata response such as `scheduler_get_capabilities` so an agent can inspect feature availability before mutating state.

Acceptance criteria:

- A live agent session can call every tool exported in `MCP_TOOL_DEFINITIONS`, or the plugin clearly reports which subset is intentionally unavailable.

### 3. Add a first-class dispatcher routing tool

Target files:

- `extensions/source-scheduler/src/server.ts`
- `extensions/source-scheduler/src/cockpitRouting.ts`
- `extensions/source-scheduler/src/types.ts`
- New tests in `extensions/source-scheduler/src/test/suite/server.test.ts`

Changes planned:

- Introduce a high-level MCP tool such as `cockpit_dispatch_routing_cards` or `cockpit_apply_dispatcher_plan`.
- Tool input should support:
  - routing signals
  - `needs_review_mode`
  - execution defaults for agent/model
  - optional cron override parsing
  - dry-run false by default, with optional preview mode
- Tool output should include:
  - scheduled count
  - skipped count with reasons
  - `cardId -> schedulerTaskId` mapping
  - per-card routing decision
- Internally the tool should:
  - use `cockpit_list_routing_cards`
  - resolve the latest actionable user comment
  - ignore system/status noise
  - create scheduler tasks before mutating card links
  - use a single ordered transaction per card
  - avoid duplicate comments, labels, flags, and scheduler jobs

Why this matters:

- The current workflow pushes too much business logic into the agent prompt. This should live in the plugin, where the board model and scheduler semantics already exist.

### 4. Add a built-in one-time execution task builder

Target files:

- `extensions/source-scheduler/src/server.ts`
- Shared scheduler task normalization helpers
- Test coverage in `extensions/source-scheduler/src/test/suite/server.test.ts`

Changes planned:

- Add a helper for execution-task creation that owns:
  - `exec-[todoId]-[yyyymmddhhmm]` id generation
  - next free 30-minute slot selection
  - collision avoidance against existing tasks
  - default `enabled`, `oneTime`, `agent`, and `model`
  - standardized prompt template generation
- Expose that helper either directly through the new dispatcher tool or as a dedicated tool such as `scheduler_create_exec_task_for_todo`.

Acceptance criteria:

- Agents no longer have to synthesize one-time task objects manually.

### 5. Strengthen closeout and stale-link cleanup

Target files:

- `extensions/source-scheduler/src/server.ts`
- `extensions/source-scheduler/src/cockpitBoardManager.ts`
- `extensions/source-scheduler/src/test/suite/server.test.ts`

Changes planned:

- Expand `cockpit_closeout_todo` so it fully covers the common dispatcher cleanup paths:
  - remove stale `taskId` when the linked task is gone
  - swap `on-schedule-list` to `final-user-check`
  - optionally add one compact summary comment
  - optionally move section if and only if the target exists
- Add an explicit closeout mode for completed execution cards already sitting in `final-user-check` so a dispatcher can clean stale schedule links without recreating tasks.
- Normalize label and flag behavior so routing markers are consistently stored and compared case-insensitively.

Why this matters:

- In the run today, three cards needed cleanup, not recreation. The plugin should make that a single safe operation.

### 6. Add safe file-level fallback inside the extension, not in the agent

Target files:

- `extensions/source-scheduler/src/server.ts`
- `extensions/source-scheduler/src/schedulerJsonSanitizer.ts`
- Potential new helper module for emergency fallback mutation

Changes planned:

- If MCP transport is healthy but a higher-level board action fails, keep mutation within the extension's own config read/write path rather than forcing clients to patch JSON manually.
- Add internal transaction helpers that operate on `readConfig` and `writeConfig` with optimistic validation and snapshot creation before mutation.
- Emit a structured fallback warning when the extension had to use this path.

Guardrail:

- External agents should never be expected to hand-edit the scheduler JSON for routine dispatcher work.

### 7. Improve docs and operator UX

Target files:

- `extensions/source-scheduler/README.md`
- `extensions/source-scheduler/TODO_COCKPIT_FEATURES.md`
- Possibly a new troubleshooting doc under `extensions/source-scheduler/archive/` or `docs/`

Changes planned:

- Document the preferred dispatcher flow as:
  1. `cockpit_list_routing_cards`
  2. per-card inspect only if needed
  3. high-level dispatcher tool for mutation
- Add an MCP troubleshooting section covering stale `mcp.json`, broken build output, and how to run a server health check.
- Document the distinction between labels, flags, and comment labels more explicitly, since mixed routing state is a common source of confusion.

## Testing

1. Add unit tests for MCP startup diagnostics and invalid workspace/config handling.
2. Add server tests that verify the runtime tool registry includes every dispatcher-critical tool.
3. Add end-to-end server tests for the new dispatcher tool covering:
   - `GO` card with concrete actionable comment
   - `GO` card with vague comment
   - `needs-bot-review` in `plan-only` mode
   - `abgelehnt` rejection path
   - `on-schedule-list` card with live linked task
   - `on-schedule-list` card with stale linked task in `final-user-check`
4. Add idempotency tests to verify rerunning the same dispatcher operation does not create duplicate tasks, comments, labels, or links.
5. Add a test for capability discovery so clients can detect whether dispatcher-specific tools are present.
6. Add one manual validation checklist for the extension UI:
   - run `Set Up MCP`
   - verify server health
   - call `cockpit_get_board`
   - call the high-level dispatcher tool
   - confirm Cockpit and scheduler state change as expected

## Dependencies

1. MCP startup diagnostics and health checks
2. Tool contract alignment and capability discovery
3. High-level dispatcher tool
4. Built-in exec-task helper
5. Closeout/stale-link cleanup improvements
6. Internal safe fallback path
7. Docs and operator guidance

## Recommended Rollout

### Phase 1

- Fix startup reliability and add capability discovery.

### Phase 2

- Implement the high-level dispatcher tool and exec-task helper.

### Phase 3

- Expand closeout cleanup and add internal fallback transactions.

### Phase 4

- Update docs, add troubleshooting guidance, and validate the operator workflow end to end.

## Acceptance Criteria

- A dispatcher run like today's can be completed through MCP without manual JSON edits.
- The plugin can clearly explain why MCP is unavailable when startup fails.
- Agents can discover routing candidates in one call and apply deterministic routing in one high-level mutation call.
- The plugin cleans stale linked `taskId` values safely.
- The dispatcher workflow is idempotent across reruns.
