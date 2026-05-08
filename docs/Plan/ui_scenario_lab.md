# UI Scenario Lab

## Purpose
The UI Lab is a dev-only scenario preview surface for rendering critical Araf Protocol frontend states without creating real trades, connecting a wallet, calling backend APIs, or submitting contract transactions.

It reuses the real app screens and panels with deterministic fixtures so designers and developers can inspect copy, layout, priority ordering, and action visibility safely.

## Production guard
The lab is gated by `frontend/src/dev/ui-lab/isUiLabEnabled.js`.

- Enabled when `import.meta.env.DEV` is true.
- Enabled when `VITE_ENABLE_UI_LAB="true"` is set.
- Hidden otherwise, so production builds do not expose the lab entry or render the lab page.

## Covered screens
The current registry covers:

- Trade Room: LOCKED / PAID / CHALLENGED maker and taker variants, wrong chain, paused, unauthenticated, payment proof, burn-expired, and timer scenarios.
- Operations Center: settlement action required, pending backend sync, challenged, paid, settlement waiting, locked, empty, and mixed priority queue scenarios.
- Profile Active Trades: all active states and empty state scenarios with local filter state.
- Admin Panel: healthy, degraded, missing config, feedback, challenged trades, settlement proposals, unauthorized, expired session, and empty data scenarios.

## No real backend or contract calls
UI Lab fixtures and mocks are deliberately local-only:

- Trade Room actions are no-op callbacks that append to the UI Lab action log.
- Operations/Profile navigation setters are mock setters that append to the action log.
- Admin `authenticatedFetch` is replaced by `createMockAdminFetch`, which returns stable in-memory responses by URL.
- No wallet connection is required.

## Adding a scenario
1. Add fixture data under `frontend/src/dev/fixtures/`.
2. Add the scenario object to the matching exported scenario list.
3. Ensure `frontend/src/dev/ui-lab/scenarioRegistry.js` exposes the scenario through the correct category.
4. If the scenario needs an action, use `frontend/src/dev/mocks/mockActions.js` so clicks remain no-op and visible in the action log.
5. Add or update Vitest coverage under `frontend/src/test/` for registry presence and behavior.

## Usage flow
1. Start the frontend dev server.
2. Open the app in a dev environment or set `VITE_ENABLE_UI_LAB=true`.
3. Click the `🧪 UI Lab` rail/mobile navigation entry, or visit `/dev/ui-lab` in dev.
4. Select a category and scenario from the left selector.
5. Switch `EN` / `TR` from the lab header as needed.
6. Click available actions to verify action visibility; the action log records mock action keys and timestamps only.
