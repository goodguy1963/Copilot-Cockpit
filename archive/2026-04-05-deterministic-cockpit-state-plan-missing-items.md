# Deterministic Cockpit State Plan: Remaining Gaps

Date: 2026-04-05

I re-checked the implementation against `archive/2026-04-05-deterministic-cockpit-state-plan.md` after the follow-up pass.

Result: the code-side implementation is substantially closer, but the plan should still not be marked fully complete yet.

## Remaining Items

1. Manual installed-extension verification has not been completed here.
- `npm test` now passes after the rollout, observability, help-copy, and lifecycle-sync changes, but the plan also required manual verification in the installed extension for:
  - flag presets
  - explicit task-draft creation flow
  - deterministic `ON-SCHEDULE-LIST` syncing
  - `FINAL-USER-CHECK` waiting behavior
  - linked-task closeout behavior
  - README/help alignment in the running UI

## Completed In The Follow-Up Pass

The following gaps from the earlier audit are now implemented and validated:
- rollout controls via `deterministicCockpitStateMode` and `legacyFallbackOnError`
- reconciliation logging for board normalization and routing mismatches under `.copilot-cockpit-logs`
- `src/i18n.ts` help-copy alignment for the deterministic Todo workflow
- one-time linked-task lifecycle sync back into `ready`, `ON-SCHEDULE-LIST`, and `FINAL-USER-CHECK`
- focused coverage in `src/test/suite/cockpitRouting.test.ts`, `src/test/suite/cockpitBoardManager.test.ts`, `src/test/suite/scheduleManager.test.ts`, `src/test/suite/schedulerWebviewCockpitBridge.test.ts`, `src/test/suite/schedulerWebviewTaskHandler.test.ts`, and `src/test/suite/todoCockpitActionHandler.test.ts`
- full suite validation with `npm test`

## Recommendation

Do not mark the original plan as fully done yet.

The remaining work is now a narrow follow-up focused on:
- manual installed-extension verification
