# Task 003 — Make Replay Observable and Add Automated UI Tests

## Status

**READY — TASK 002 APPROVED; START IMMEDIATELY**

## Assignment

- **Implementer:** Agy
- **Reviewer:** Codex
- **Priority:** Deadline-critical / recordable judge demo usability
- **Primary framework:** Playwright with Chromium
- **Dependency:** Task 002 closure review must be `APPROVE`

## Objective

Make ProofGuard understandable to a first-time judge within 30 seconds and make
the historical replay control truthfully observable. Clicking the primary demo
action must always produce visible loading, running, completed, or actionable
failure feedback. Add deterministic Playwright tests for the complete browser
journey without calling TxLINE, Solana RPC, or any external service.

The deliverable must be usable as the single, repeatable path for recording the
submission demo video: open the page, understand the product, run the
historical demo, observe market/proof transitions, and inspect the receipt.

The current failure is concrete:

- The browser silently returns for an empty fixture.
- Replay actions ignore `response.ok` and response bodies.
- The server returns `success` before historical data has loaded.
- No-record and fetch failures happen after the response and appear only in
  server logs.
- Replay state is only a boolean, so the UI cannot show progress or errors.
- A first-time judge is shown raw fixture IDs, enum states, and stat keys before
  being told what ProofGuard does.

## Required Reading

Before editing:

1. Read the root `AGENTS.md` in full.
2. Read `dashboard/AGENTS.md` in full.
3. Read these bundled Next.js 16 guides in full:
   - `dashboard/node_modules/next/dist/docs/01-app/02-guides/testing/index.md`
   - `dashboard/node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md`
   - `dashboard/node_modules/next/dist/docs/01-app/02-guides/environment-variables.md`
4. Read `PLAN.md` sections 2, 5, 6, and 12 for the intended judge journey.

## Allowed Files

- `src/replay/index.ts`
- `src/server/index.ts`
- `src/utils/health.ts` only if replay status belongs in the health contract
- `.env.example`
- `dashboard/src/app/page.tsx`
- `dashboard/src/app/globals.css` only for small responsive, focus, or
  reduced-motion additions
- `dashboard/package.json`
- `dashboard/yarn.lock`
- `dashboard/playwright.config.ts` (new)
- `dashboard/e2e/proofguard.spec.ts` (new)
- Additional files under `dashboard/e2e/` only for small deterministic mock
  fixtures/helpers shared by the Playwright tests
- `.agents/communication/execution_logs/003-make-replay-observable-and-add-ui-e2e.md`

Do not edit Task 002 proof code or `scripts/test_all.ts` in this task. If one
additional production file is strictly required, stop and record why before
changing it.

## Requirements

### 1. Add a truthful server-authoritative replay status

Expose a sanitized replay status with these states:

- `IDLE`
- `LOADING`
- `RUNNING`
- `PAUSED`
- `COMPLETED`
- `FAILED`

The public shape must contain only:

- Whether demo replay controls are enabled
- State
- Active fixture ID or `null`
- Configured demo fixture ID or `null`
- Speed
- Current step
- Total steps
- A short controlled public message
- A short controlled public error code/message when failed
- Last update timestamp

Add read-only `GET /api/replay/status`. It must never expose tokens, raw TxLINE
responses, request headers, wallet paths, or arbitrary exception messages.

Every replay transition must update this status consistently. `COMPLETED` and
`FAILED` must persist until a new start or explicit stop; do not collapse them
immediately to an ambiguous `replayMode: false`.

### 2. Make replay start truthful

- `ReplayEngine.startReplay` must report whether historical records actually
  loaded and replay execution was scheduled.
- `POST /api/replay/start` must not return success before loading is known to
  have succeeded.
- Return a non-2xx response with a controlled message when:
  - Replay is disabled
  - Fixture ID or speed is invalid
  - No historical records exist
  - TxLINE history retrieval fails
- Do not leak the caught exception.
- Starting a new replay cancels the previous replay's timers and state.
- Stop/cancel during `LOADING` must prevent a late history response from
  starting the cancelled replay.
- Pause, resume, stop, and speed endpoints must return the resulting replay
  status and reject invalid state transitions with controlled `409` responses.

### 3. Remove the fake browser admin secret

- Remove the hardcoded shared fallback secret from backend and dashboard.
- Do not introduce any `NEXT_PUBLIC_*` secret; those values are included in the
  browser bundle.
- Gate public judge replay controls with explicit server configuration such as
  `DEMO_REPLAY_ENABLED=true`.
- When public demo replay is enabled, protect state-changing replay endpoints
  with a small in-memory per-client rate limit suitable for the single-process
  MVP.
- When disabled, return a visible controlled `403` response.
- Document `DEMO_REPLAY_ENABLED` and positive-integer `DEMO_FIXTURE_ID` in
  `.env.example`. The configured demo fixture ID is public data.

Do not build user accounts, OAuth, sessions, or a general authorization system.

### 4. Explain ProofGuard above the fold

Show this meaning, using concise equivalent copy:

> ProofGuard automatically halts a virtual market when a goal arrives, verifies
> the score using TxLINE's Solana proof, and reopens only after fresh odds
> arrive.

Directly communicate:

- Historical demo
- Simulated virtual market
- No wallet or funds required for the judge
- Replay provenance: historical TxLINE score records plus simulated repricing
  odds

Add a compact journey strip:

`Goal detected → Market halted → Solana proof checked → Fresh odds reopen market`

Keep technical details available, but translate primary UI labels:

- `OPEN` — Market accepting virtual trades
- `HALTED` — Goal detected; market paused
- `PROOF_PENDING` — Proof passed; waiting for newer odds
- `FINAL_PROOF_PENDING` — Match ended; final proof pending
- `SETTLED` — Final score verified; market settled
- Stat key `1` — Participant 1 goals
- Stat key `2` — Participant 2 goals

### 5. Make the primary demo action obvious and observable

- The primary action is `Run historical demo` using the server-configured demo
  fixture. Manual fixture ID and speed belong under visibly secondary
  `Advanced controls`.
- If no demo fixture is configured, disable the primary action and show the
  exact setup requirement. Never make the button silently do nothing.
- Validate manual fixture IDs as positive integers before sending a request.
- On every action, check `response.ok`, parse the controlled response, and show
  the result in the page rather than only `console.error`.
- Render one prominent live status sentence using `aria-live="polite"`.
- Render failures with `role="alert"` and a retry path.
- Show fixture, progress (`currentStep / totalSteps`), speed, and current replay
  state.
- Automatically select the active replay fixture when it appears so the market,
  audit trail, and receipt describe the same fixture.
- Disable Start/Pause/Resume/Stop controls when the corresponding action is not
  valid. Disabled controls must not issue requests.
- A backend polling failure must switch the UI to an explicit disconnected
  state instead of leaving stale green indicators onscreen.

### 6. Minimum accessibility and responsive behavior

- Use native labels and numeric input semantics for fixture ID.
- Use native buttons for selectable market cards; preserve keyboard selection.
- Speed choices expose pressed/radio semantics.
- Every interactive control has a visible `focus-visible` style.
- State meaning is conveyed with text, not color alone.
- Respect `prefers-reduced-motion` for pulsing/animated status UI.
- At a 390px viewport, the current replay decision and a clear path to the
  selected market receipt are visible.
- Keyboard-only use can start, pause, resume, inspect a market, and reach a
  confirmed Explorer link.

Do not redesign unrelated dashboard sections or add charts/team metadata in
this task.

### 7. Add deterministic Playwright browser tests

Use the official `@playwright/test` package and a minimal Chromium-only setup.
The Playwright configuration must start the dashboard with `webServer` and use
a fixed local test port.

Intercept `/api/*` requests inside Playwright. Tests must not start the real
backend and must not call TxLINE, Solana RPC, external URLs, or transaction
methods. Mock only sanitized API response shapes.

Add at least these scenarios:

1. Above-the-fold copy explains the product, demo provenance, no-wallet promise,
   and four-step journey.
2. Missing demo fixture disables the primary action with an actionable setup
   message.
3. Invalid manual fixture input shows inline validation and sends no request.
4. Successful start shows `LOADING`, then `RUNNING`, fixture ID, and progress.
5. A newly returned market is automatically selected and its plain-language
   state plus audit trail are visible.
6. A confirmed receipt renders `Confirmed on Solana` and an Explorer link;
   simulated/rejected/failed shapes retain their truthful labels.
7. No-history, disabled-demo, unauthorized/rate-limited, and server-error
   responses are visibly reported and never claim replay started.
8. Pause, resume, stop, and speed controls are enabled only in valid states and
   send the correct request once.
9. Backend polling failure renders a disconnected alert and does not leave
   stale healthy status as current truth.
10. The primary journey works at a 390px viewport and the core controls are
    keyboard reachable.

Use role/label/text selectors. Avoid selectors coupled to Tailwind class names,
large snapshots, arbitrary sleeps, or external fixtures.

## Non-Goals

- No live TxLINE or Solana test
- No real transaction
- No browser wallet
- No user-account/authentication system
- No SSE conversion; polling may remain for this task
- No new market rules, charts, team metadata, database, or deployment manifest
- No changes to Task 002 validation logic or tests

## Verification Commands

Run all of the following:

```bash
yarn test
yarn typecheck
yarn ts-node scripts/test_agent.ts
git diff --check
git status --short
cd dashboard && yarn lint
cd dashboard && yarn build
cd dashboard && yarn test:e2e
```

Install the pinned Playwright Chromium browser locally if needed. Record that
setup separately from the repeatable test command. Browser tests must pass with
the real backend stopped.

## Acceptance Criteria

- Clicking the primary demo action can never fail silently.
- A success response means historical records loaded and replay actually
  started.
- A no-history or backend failure is immediately visible and actionable.
- A judge understands the product and demo provenance without reading README or
  raw audit enums.
- Replay progress and control availability come from server state.
- No browser-visible admin secret remains.
- Playwright deterministically covers the complete judge journey without live
  dependencies.
- Root checks, dashboard lint/build, and Playwright all pass.

## Required Execution Log

Create:

`.agents/communication/execution_logs/003-make-replay-observable-and-add-ui-e2e.md`

Include:

- Summary and exact files changed
- Replay status state-transition table
- HTTP status/error contract for every replay endpoint
- UI copy and control-gating behavior
- Playwright scenario-to-acceptance mapping
- Every verification command with exit code
- Confirmation that the real backend was stopped for Playwright and no TxLINE,
  Solana RPC, stream, or transaction request occurred
- Remaining ambiguity, including whether `DEMO_FIXTURE_ID` has been verified to
  contain eligible historical records
