# To-Do-Cockpit Audit And Migration Plan

Date: 2026-03-29

## Scope

This audit treats the repository as the source of truth for the current To-Do-Cockpit behavior. The goal is to preserve shipped behavior, identify fragile seams, and define a staged migration path without silent feature loss.

## Current Architecture Assessment

The current extension already has a useful separation between persisted board data and the extension host, but the UI layer is still too monolithic.

- Extension host entry and command wiring live in `src/extension.ts`.
- Webview lifecycle and host-side message routing live in `src/schedulerWebview.ts`.
- Todo board schema normalization and legacy migration live in `src/cockpitBoard.ts`.
- Todo board mutations and persistence orchestration live in `src/cockpitBoardManager.ts`.
- Workspace-local persistence is split correctly between public and private scheduler files in `src/schedulerJsonSanitizer.ts`.
- The webview runtime is still a large DOM-oriented implementation in `media/schedulerWebview.js` plus a separate drag layer in `media/schedulerWebviewBoardInteractions.js`.
- Styling for the To-Do-Cockpit is still injected from the main scheduler webview shell in `src/schedulerWebview.ts`, so the feature is not yet isolated from the rest of the panel.

### Assessment Summary

The data model and persistence layer are already strong enough to preserve and extend. The main architectural bottlenecks are:

- the monolithic webview runtime
- inline and shared CSS ownership inside the larger scheduler panel
- duplicated workflow semantics between host and webview
- bespoke pointer-based drag and drop that depends on DOM details
- a large todo message surface embedded inside the broader scheduler webview controller

## Deep Feature Inventory

### 1. Confirmed Existing Features Already Implemented

- A dedicated To-Do-Cockpit tab exists as the second high-level tab in the scheduler webview.
- The first todo tab is a shared create or edit screen whose label changes between create and edit mode.
- Board view and list view both render from the same persisted `cockpitBoard.cards` data.
- Todo sections are persisted with explicit ordering.
- Archive sections are always present and normalized as `archive-completed` and `archive-rejected`.
- Todo cards support `id`, `title`, `description`, `sectionId`, `order`, `priority`, `dueAt`, `status`, `labels`, `flags`, `comments`, `taskId`, `sessionId`, timestamps, archive fields, and approval fields.
- Todo comments support author, source, sequence, labels, created and edited timestamps.
- Label and flag catalogs are persisted separately from cards and support colors.
- Filters persist `searchText`, `labels`, `priorities`, `statuses`, `archiveOutcomes`, `flags`, `sectionId`, `sortBy`, `sortDirection`, `viewMode`, and `showArchived`.
- Users can create, edit, reject, purge, move, comment on, and link todos.
- Users can create scheduled task drafts from todos.
- Existing scheduled tasks can be surfaced as Todo Cockpit items under `Unsorted`.
- Delete confirmation already supports `archive as rejected` versus `delete permanently`.
- Archive sections remain visible when archived items are shown.
- Section add, rename, delete, reorder, and collapse behavior already exists.
- Drag and drop exists for both cards and sections.
- Archive section rename and delete are blocked in the manager layer.
- Board data stays local-only by living in `.vscode/scheduler.private.json`.
- Legacy archive buckets are normalized into archive cards automatically.

### 2. Confirmed Existing Features Implemented But Fragile Or Previously Broken

- Approval and final acceptance existed in the model and strings, but the host and manager previously collapsed both into immediate archive completion.
- The webview exposed a completion control, but the runtime did not honor the staged `ready -> final accept` workflow.
- Manual drag and drop was already present, but document-level drag-state protection against text selection was missing.
- The To-Do-Cockpit styling lives inside the larger scheduler webview stylesheet, so CSS ownership is still fragile.
- The webview runtime still relies on large render functions with direct DOM string generation.
- The extension host action handling for todos still lives inside the broader `extension.ts` action switch.

### 3. Partially Implemented Features

- A staged workflow is partially implemented through `status: ready`, `approvedAt`, `boardFinalizeTodo`, and `boardReadyForTask`, but the runtime had not fully honored it before this pass.
- The drag layer is separated into `media/schedulerWebviewBoardInteractions.js`, but it still depends on the board DOM structure instead of a dedicated component boundary.
- The tab label switching behavior is implemented, but the surrounding todo runtime is still embedded in the larger scheduler webview runtime.

### 4. Intended Features Inferred From Code And UI Structure

- `ready` is intended to mean an approved planning item that can either become a task draft or be finally accepted into the completed archive.
- `Final Accept` is intended to remain distinct from `Approve` because both strings and the ready-state note already exist.
- Archive sections are intended to be reviewable history surfaces, not hidden graveyards.
- The Todo Cockpit is intended to remain repo-local and separate from executable scheduled task artifacts.

### 5. Missing But Required Features From Product Requirements

- A more isolated To-Do-Cockpit host controller or bridge module is still missing.
- A dedicated, scoped frontend boundary for the To-Do-Cockpit is still missing.
- The current runtime still needs a deeper modular split before a full frontend migration can happen safely.
- CSS ownership is improved by drag-state hardening in this pass, but not yet fully isolated.

### 6. Features That Affect Architecture Outside The Todo Subsystem

- Scheduled task seeding and linking tie the cockpit board to the scheduler task model.
- Private config persistence ties the cockpit board to the scheduler config writer and history snapshots.
- The shared scheduler webview panel means any todo refactor must respect the rest of the tabbed panel.
- MCP server behavior mirrors many Todo Cockpit mutations through `src/server.ts` and must stay aligned with host semantics.

## Preservation And Migration Matrix

| Feature | Current Status | Source Files | Decision | Migration Notes |
| --- | --- | --- | --- | --- |
| Create or Edit tab label switching | Implemented and preserved | `src/schedulerWebview.ts`, `media/schedulerWebview.js` | Keep | Do not replace until a new frontend preserves dynamic tab labeling. |
| Board view | Implemented, fragile UI | `media/schedulerWebview.js`, `media/schedulerWebviewBoardInteractions.js` | Keep and redesign incrementally | Preserve section and card semantics while isolating rendering later. |
| List view | Implemented | `media/schedulerWebview.js` | Keep | Must continue to reflect the same underlying card model as board view. |
| Local-only persistence | Implemented | `src/schedulerJsonSanitizer.ts` | Keep | Remains repo-local in `.vscode/scheduler.private.json`. |
| Legacy archive migration | Implemented | `src/cockpitBoard.ts` | Keep | Must remain until older stored boards are no longer supported. |
| Archive sections | Implemented | `src/cockpitBoard.ts`, `src/cockpitBoardManager.ts` | Keep | Archive sections remain visible and immutable. |
| Reject versus purge delete flow | Implemented | `media/schedulerWebview.js`, `src/extension.ts`, `src/cockpitBoardManager.ts` | Keep | Already matches product intent and must remain. |
| Approve versus final accept workflow | Partially implemented, fixed in this pass | `src/cockpitBoardManager.ts`, `src/extension.ts`, `media/schedulerWebview.js`, `media/schedulerWebviewBoardInteractions.js` | Keep | Approval now maps to `ready`; final acceptance maps to completed archive. |
| Comments and system event history | Implemented | `src/cockpitBoard.ts`, `src/cockpitBoardManager.ts`, `media/schedulerWebview.js` | Keep | Preserve for auditability and workflow context. |
| Labels and flags catalogs | Implemented | `src/cockpitBoard.ts`, `src/cockpitBoardManager.ts`, `media/schedulerWebview.js` | Keep | Preserve color metadata and deleted-key suppression behavior. |
| Section drag and card drag | Implemented, fragile | `media/schedulerWebviewBoardInteractions.js` | Keep and harden | This pass adds document drag-state protection; deeper replacement can come later. |
| Task seeding into Unsorted | Implemented | `src/cockpitBoardManager.ts`, `src/extension.ts` | Keep | This is a key integration behavior, not incidental coupling. |
| Link todo to scheduled task | Implemented | `src/extension.ts`, `src/cockpitBoardManager.ts` | Keep | Needed for the planning-to-execution bridge. |
| Create task draft from todo | Implemented | `src/extension.ts`, `media/schedulerWebview.js` | Keep | Remains an important workflow shortcut. |
| MCP mirrored todo operations | Implemented | `src/server.ts` | Keep | Server-side semantics must stay aligned with host semantics. |
| Shared scheduler webview shell | Implemented, limiting | `src/schedulerWebview.ts` | Redesign later | Replace only after the Todo Cockpit has its own stable frontend boundary. |

## Target Architecture Recommendation

### Keep

- `src/cockpitBoard.ts` as the authoritative domain normalization and migration boundary.
- `src/cockpitBoardManager.ts` as the authoritative mutation and persistence orchestration layer.
- `.vscode/scheduler.private.json` as the local-only persistence target.

### Add Or Split Next

1. A dedicated Todo Cockpit host controller module.
2. A shared workflow helper module for staged status transitions and action labels.
3. A dedicated Todo Cockpit webview runtime boundary with scoped styling ownership.
4. An explicit host or webview message contract for todo-only actions.

### Frontend Direction

The long-term frontend target can still be React plus TypeScript, but the safe path in this repository is staged migration rather than destructive replacement.

Recommended path:

1. Keep the current board data and persistence model.
2. Move the Todo Cockpit runtime into its own TS-focused module boundary first.
3. Preserve message names and stored schema while adding adapters.
4. Replace manual DOM rendering slice by slice once the adapter boundary is stable.

## Safe Migration Plan

### Phase 0 - Audit

Completed in this pass.

### Phase 1 - Preservation Strategy

Completed in this pass through explicit inventory and preservation matrix.

### Phase 2 - Target Architecture Definition

Completed at a planning level in this document.

### Phase 3 - Minimal Stable Core

Started in this pass.

Implemented now:

- approval is distinct from final acceptance again
- the webview honors staged completion semantics
- drag now enters an explicit document drag-state to prevent selection conflicts

### Phase 4 - Feature Migration

Next recommended steps:

1. Extract todo-only host action handling from `src/extension.ts`.
2. Introduce a dedicated todo runtime module or TS bundle boundary.
3. Migrate board and list rendering behind that boundary without changing storage.

### Phase 5 - Drag And Drop Stabilization

Started in this pass through drag-state hardening.

Next recommended steps:

1. replace DOM-order-derived target calculations with explicit drop indicator state
2. isolate drag CSS from the rest of the panel
3. consider a library-backed drag layer only after the current feature map is fully covered

### Phase 6 - Cleanup

Deferred until feature parity is confirmed.

## Legacy Code Notes

### Must Remain For Compatibility Now

- `src/cockpitBoard.ts` legacy archive normalization
- `src/cockpitBoardManager.ts` mutation helpers and persisted schema compatibility
- `src/schedulerJsonSanitizer.ts` private config persistence behavior
- current message names used by `src/schedulerWebview.ts`, `media/schedulerWebview.js`, and `src/server.ts`

### Can Be Replaced Later After Feature-Parity Validation

- large todo rendering blocks in `media/schedulerWebview.js`
- inline todo-related styles embedded in `src/schedulerWebview.ts`
- parts of `media/schedulerWebviewBoardInteractions.js` once a more isolated drag layer exists
- todo-related action cases currently embedded in `src/extension.ts`

## Changes Completed In This Pass

- Restored staged workflow semantics so approval moves a todo to `ready` and final acceptance archives it as completed.
- Updated the webview completion controls to honor `approve` versus `finalize` based on the card state.
- Added document drag-state protection so drag interactions suppress text selection and use a consistent grabbing cursor.
- Added focused tests for the updated board manager workflow and board interaction completion behavior.
