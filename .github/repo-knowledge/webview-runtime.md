# Webview Runtime

## Todo Board Drag/Drop Live Updates

- Persistence success plus a later `updateCockpitBoard` refresh does not prove the open Todo Cockpit webview updates immediately.
- For Todo board drag/drop, mutate local `cockpitBoard` state optimistically at the browser drop boundary, request a board render, then still post `moveTodo` to the host.
- Keep `updateCockpitBoard` as the reconciliation channel after host persistence; do not rely on that host round-trip alone for immediate UX.
- Reject invalid optimistic moves with the same guard as the drop handler: archive targets stay blocked, and section-scoped cards such as recurring/pinned-style reorder-only cards stay in their source section.
- Keep regression coverage for immediate local board movement in `src/test/suite/cockpitWebview.test.ts`, alongside the same-section drag guard for recurring linked todos.

## Source Anchors

- `media/cockpitWebviewBoardInteractions.js`: valid todo drops call `options.optimisticallyMoveTodo(...)` before posting `moveTodo`.
- `media/cockpitWebview.js`: `optimisticallyMoveTodo` mutates local board state, requests render, and `updateCockpitBoard` remains the host reconciliation path.
- `src/test/suite/cockpitWebview.test.ts`: runtime and interaction tests cover optimistic local movement and same-section-only recurring drag/drop.