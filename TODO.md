# ProofGuard Implementation TODO

This checklist implements [PLAN.md](./PLAN.md). Do not begin source-code implementation until the Architecture Approval Gate in the plan is accepted by the project owner.

## Progress Legend

- `[x]` Complete and verified
- `[ ]` Not complete
- Tasks labeled **Gate** must pass before dependent work begins
- Tasks labeled **Stretch** are not required for the MVP

## Progress Summary

| Milestone | Status | Exit condition |
|---|---|---|
| M0 — Architecture gate | Complete | Owner approves MVP and network decisions |
| M1 — Foundation | Complete | Local build, lint, typecheck, and tests pass |
| M2 — TxLINE connection | Complete | Snapshots and both SSE streams remain healthy |
| M3 — Autonomous agent | Complete | Goal event halts the market exactly once |
| M4 — Verification | Complete | Real proof passes `validateStatV2` on devnet |
| M5 — Product UI | Not started | Live/replay end-to-end flow is visible |
| M6 — Hardening and release | Not started | Public build and submission materials are ready |

## M0 — Architecture and Environment Gate

- [x] **PG-001:** Select ProofGuard as the primary project concept.
- [x] **PG-002:** Select Trading Tools & Agents as the primary track.
- [x] **PG-003:** Define the MVP as a virtual market circuit breaker with no real funds.
- [x] **PG-004:** Review the local TxLINE activation, streaming, validation, network, and soccer-stat documentation.
- [x] **PG-005:** Define the goal and finalisation state-machine flow in `PLAN.md`.
- [x] **PG-006 — Gate:** Obtain owner approval for `PLAN.md`.
- [x] **PG-007 — Gate:** Confirm devnet as the implementation network.
- [x] **PG-008 — Gate:** Obtain a matching official devnet IDL and generated TypeScript type; do not reuse the mainnet-addressed root IDL without verification.
- [x] **PG-009 — Gate:** Confirm the devnet API host, program ID, TxL mint, RPC URL, IDL address, and wallet network all match.
- [x] **PG-010 — Gate:** Verify the configured wallet public key and devnet SOL balance without printing private key material.
- [ ] **PG-011:** Select one recent or upcoming covered fixture for live and historical testing.
- [ ] **PG-012:** Record the chosen network and public identifiers in the README architecture section.

### M0 Acceptance

- [x] The owner has approved the six decisions listed under the Architecture Approval Gate.
- [x] The wallet has enough devnet SOL for subscription, activation-related transactions, and validation receipts.
- [x] No mainnet value appears in a devnet runtime profile except as an explicitly documented alternative.

## M1 — Project Foundation

### Scaffold

- [x] **PG-101:** Create a Node.js 20+ TypeScript project.
- [x] **PG-102:** Keep application source under `src/` and runnable helpers under `scripts/`.
- [x] **PG-103:** Add separate modules for config, TxLINE, domain, agent, Solana, replay, server, and web UI.
- [x] **PG-104:** Add `package.json` scripts for development, build, start, lint, typecheck, unit tests, and integration tests.
- [x] **PG-105:** Add strict TypeScript configuration.
- [x] **PG-106:** Add formatting and linting with deterministic CI commands.
- [x] **PG-107:** Add a test runner and coverage command.

### Configuration and Secrets

- [x] **PG-108:** Create typed network profiles for devnet and mainnet.
- [x] **PG-109:** Validate all required environment variables during startup and fail with actionable messages.
- [x] **PG-110:** Add `.env.example` containing placeholders only.
- [x] **PG-111:** Verify `.env`, `.env.*`, `_keys/`, wallet JSON files, logs, and runtime data are ignored.
- [x] **PG-112:** Reject startup when the loaded IDL program address differs from the selected network program ID.
- [x] **PG-113:** Reject startup when the API host and RPC network do not match the selected network.
- [x] **PG-114:** Ensure JWTs, API tokens, signatures, and wallet paths are redacted from structured logs.

### Observability

- [x] **PG-115:** Add structured logging with fixture ID, sequence, event type, market state, and correlation ID.
- [x] **PG-116:** Add a health model for scores SSE, odds SSE, TxLINE HTTP, Solana RPC, and replay mode.
- [x] **PG-117:** Add process-level handling for uncaught errors and graceful shutdown of streams.

### M1 Acceptance

- [x] Clean install succeeds on Node.js 20+.
- [x] Build, lint, typecheck, and empty test suite pass.
- [x] Invalid or mixed network configuration fails before any API request or transaction.
- [x] A log-redaction test proves secrets are not emitted.

## M2 — TxLINE Subscription, API, and Streaming

### Wallet and Subscription

- [x] **PG-201:** Load the Anchor wallet only from `ANCHOR_WALLET`.
- [x] **PG-202:** Query and display the wallet's public key and network balance.
- [x] **PG-203:** Derive subscription PDAs and token accounts dynamically.
- [x] **PG-204:** Read the on-chain pricing matrix and confirm the selected free service level before subscribing.
- [x] **PG-205:** Simulate the subscription transaction.
- [x] **PG-206:** Submit with `skipPreflight: false` only after balance and network checks pass.
- [x] **PG-207:** Store only the public subscription signature in logs and diagnostics.

### Activation and Credential Lifecycle

- [x] **PG-208:** Request a guest JWT from the selected network host.
- [x] **PG-209:** Construct the exact activation message `${txSig}:${selectedLeagues.join(",")}:${jwt}`.
- [x] **PG-210:** Sign the activation message with the same wallet that subscribed.
- [x] **PG-211:** Base64-encode the detached signature and activate the API token.
- [x] **PG-212:** Keep the activated API token server-side.
- [x] **PG-213:** Renew only the guest JWT on `401`, retaining the activated API token.
- [x] **PG-214:** Surface `403` as a non-retryable network/subscription configuration error.

### HTTP and SSE Clients

- [x] **PG-215:** Implement the authenticated TxLINE HTTP client with timeouts.
- [x] **PG-216:** Implement capped exponential backoff with jitter for `429` and transient `5xx` responses.
- [x] **PG-217:** Fetch the fixtures snapshot and select the configured fixture.
- [x] **PG-218:** Fetch initial score and odds snapshots before opening live streams.
- [x] **PG-219:** Implement standards-compliant SSE parsing, including multi-line data, comments, event IDs, and retry hints.
- [x] **PG-220:** Connect to the scores stream with both authentication headers.
- [x] **PG-221:** Connect to the odds stream with both authentication headers.
- [x] **PG-222:** Add randomized exponential reconnection for dropped streams.
- [x] **PG-223:** Reset the reconnection attempt counter after a healthy interval.
- [x] **PG-224:** Track last message, heartbeat, reconnect count, and error for each stream independently.
- [x] **PG-225:** Add graceful stream cancellation during shutdown.

### Normalization

- [x] **PG-226:** Define normalized fixture, score-event, odds-update, and stream-health types.
- [x] **PG-227:** Map both uppercase and lowercase payload variants such as `Seq`/`seq` and `FixtureId`/`fixtureId`.
- [x] **PG-228:** Reject score records with a missing, non-integer, or zero sequence.
- [x] **PG-229:** Generate a stable deduplication key from fixture ID, sequence, and event/action type.
- [x] **PG-230:** Preserve original timestamps and distinguish source time from ingestion time.

### M2 Acceptance

- [x] The application loads a real fixture and its initial snapshots.
- [x] Both SSE connections remain open and expose independent health.
- [x] A forced disconnect reconnects automatically.
- [x] A mocked `401` renews the JWT and reconnects using the same API token.
- [x] Duplicate score records are delivered to downstream code only once.

## M3 — Deterministic Agent and Virtual Market

### Domain Model

- [x] **PG-301:** Define market states `OPEN`, `HALTED`, `PROOF_PENDING`, `FINAL_PROOF_PENDING`, and `SETTLED`.
- [x] **PG-302:** Define explicit transition reason codes.
- [x] **PG-303:** Define an append-only audit-event schema.
- [x] **PG-304:** Store the current market state and bounded audit history behind a single state-store interface.
- [x] **PG-305:** Make transition commands idempotent using the triggering event key.

### Goal Rule

- [x] **PG-306:** Identify confirmed goal score records using documented soccer-feed semantics.
- [x] **PG-307:** Map the scoring participant to full-game stat key `1` or `2`.
- [x] **PG-308:** On a new confirmed goal, transition `OPEN` to `HALTED` immediately.
- [x] **PG-309:** Record event-to-halt latency using monotonic local timing where possible.
- [x] **PG-310:** Start proof orchestration automatically after the halt.
- [x] **PG-311:** Keep the market halted when a goal arrives while another proof is pending.

### Odds Correlation and Reopening

- [x] **PG-312:** Track the latest odds timestamp and market suspension state for the selected fixture.
- [x] **PG-313:** Detect whether a newer odds update arrived after the goal event.
- [x] **PG-314:** Calculate score-event-to-odds-update latency.
- [x] **PG-315:** Reopen only when the goal proof is valid and a newer usable odds update exists.
- [x] **PG-316:** Keep the market halted if the odds stream is stale or disconnected.

### Finalisation Rule

- [x] **PG-317:** Detect `action=game_finalised` records.
- [x] **PG-318:** Require `statusId=100` and `period=100` for final settlement.
- [x] **PG-319:** Transition to `FINAL_PROOF_PENDING` and request both total-goal stat keys `1,2`.
- [x] **PG-320:** Determine participant-one win, participant-two win, or draw only from validated goal values.
- [x] **PG-321:** Transition to `SETTLED` exactly once after successful validation.
- [x] **PG-322:** Reject reopening and later mutation of a settled market.

### M3 Acceptance

- [x] A goal halts an open market without operator input.
- [x] Replaying the same sequence cannot halt twice.
- [x] A newer unverified odds update cannot reopen the market by itself.
- [x] Disconnected or stale odds keep the market halted.
- [x] A valid finalised event can settle only once.

## M4 — Proof Retrieval and Solana Validation

### Proof Request

- [x] **PG-401:** Request `/api/scores/stat-validation` using the observed fixture ID and sequence.
- [x] **PG-402:** Request `statKeys=1` or `2` for a goal and `statKeys=1,2` for finalisation.
- [x] **PG-403:** Retry proof-not-ready responses with capped backoff while keeping the market halted.
- [x] **PG-404:** Validate the response shape before constructing Anchor arguments.
- [x] **PG-405:** Decode every proof hash to exactly 32 bytes.
- [x] **PG-406:** Preserve `statKeys` order when mapping `statsToProve`, proofs, and strategy indexes.

### PDA and Payload

- [x] **PG-407:** Derive the proof timestamp from `summary.updateStats.minTimestamp`.
- [x] **PG-408:** Compute `epochDay = floor(proofTimestamp / 86400000)` and validate it fits u16.
- [x] **PG-409:** Derive `daily_scores_roots` dynamically using u16 little-endian encoding.
- [x] **PG-410:** Build the `StatValidationInput` payload without mutating proof values.
- [x] **PG-411:** Build a single-stat equality strategy for goal validation.
- [x] **PG-412:** Build a two-stat fully covered strategy for final-goal validation.
- [x] **PG-413:** Reject any V2 strategy that leaves a stat uncovered or reuses an index incorrectly.

### Execution and Receipt

- [x] **PG-414:** Add a compute-budget instruction appropriate for proof validation.
- [x] **PG-415:** Run `.view()` first and require a `true` validation result.
- [x] **PG-416:** Keep the market halted when simulation returns false or throws.
- [x] **PG-417:** Check wallet balance before submitting a validation receipt transaction.
- [x] **PG-418:** Submit with preflight enabled and confirmed commitment.
- [x] **PG-419:** Record the public transaction signature, program ID, PDA, fixture ID, sequence, stat keys, and validation time.
- [x] **PG-420:** Add Solana RPC `429` retry handling without blindly resubmitting an unknown transaction outcome.
- [x] **PG-421:** Expose a read-only simulation fallback when receipt submission is unavailable.

### M4 Acceptance

- [x] One real historical or live score record validates successfully on devnet.
- [x] The derived PDA is based on the proof timestamp, not `Date.now()`.
- [x] An intentionally altered hash or sequence fails safely.
- [x] The application never reopens or settles after a false or failed validation.
- [x] At least one proof receipt is publicly inspectable through a Solana explorer or diagnostic view.

## M5 — Replay, Server API, and Dashboard

### Replay

- [ ] **PG-501:** Fetch historical score records only for fixtures within TxLINE's supported historical window.
- [ ] **PG-502:** Replay historical records in sequence order through the same ingestion boundary used by live SSE.
- [ ] **PG-503:** Provide adjustable replay speed without changing source timestamps.
- [ ] **PG-504:** Label historical mode clearly in the UI.
- [ ] **PG-505:** Create schema-compatible synthetic events for unit tests and UI demos only.
- [ ] **PG-506:** Label synthetic mode and disable claims of real proof validation for synthetic records.
- [ ] **PG-507:** Do not commit raw TxLINE match data or private runtime captures to the repository.

### Server API

- [ ] **PG-508:** Add a public health endpoint with no secrets.
- [ ] **PG-509:** Add endpoints for current fixture, market state, recent audit events, and proof receipts.
- [ ] **PG-510:** Stream state and audit updates to the browser over server-sent events.
- [ ] **PG-511:** Add a controlled endpoint or script to start and stop historical replay.
- [ ] **PG-512:** Validate inputs and rate-limit state-changing demo controls.
- [ ] **PG-513:** Ensure no browser payload contains JWTs, API tokens, wallet paths, or private keys.

### Dashboard

- [ ] **PG-514:** Build a responsive dark-mode shell with accessible contrast.
- [ ] **PG-515:** Add match header with teams, score, phase, and source freshness.
- [ ] **PG-516:** Add a prominent market-state card with transition reason.
- [ ] **PG-517:** Add score and odds timeline visualization.
- [ ] **PG-518:** Add an agent audit timeline with rule, input, decision, and latency.
- [ ] **PG-519:** Add independent connection indicators for scores, odds, TxLINE HTTP, Solana RPC, and browser stream.
- [ ] **PG-520:** Add a proof receipt panel with fixture ID, sequence, stat keys, timestamp, PDA, result, network, and explorer link.
- [ ] **PG-521:** Add safe loading, empty, stale, disconnected, and error states.
- [ ] **PG-522:** Make live, historical, and synthetic modes visually unambiguous.
- [ ] **PG-523:** Verify mobile layout and keyboard navigation.

### M5 Acceptance

- [ ] A judge can open the public dashboard without connecting a wallet.
- [ ] The complete goal-to-halt-to-proof-to-reopen flow is visible.
- [ ] The finalisation-to-settlement flow is visible.
- [ ] All connection and failure states are understandable without reading server logs.
- [ ] The dashboard exposes public verification identifiers but no secrets.

## M6 — Testing, Deployment, and Submission

### Unit and Integration Tests

- [ ] **PG-601:** Test uppercase/lowercase payload normalization.
- [ ] **PG-602:** Test invalid and zero score sequences.
- [ ] **PG-603:** Test duplicate and out-of-order score records.
- [ ] **PG-604:** Test every allowed and rejected state transition.
- [ ] **PG-605:** Test goal-to-stat-key participant mapping.
- [ ] **PG-606:** Test proof timestamp and u16 little-endian epoch-day derivation.
- [ ] **PG-607:** Test bytes32 decoding for hex, base64, arrays, and invalid lengths.
- [ ] **PG-608:** Test V2 stat ordering and complete strategy coverage.
- [ ] **PG-609:** Test JWT renewal on `401`.
- [ ] **PG-610:** Test non-retryable handling on `403`.
- [ ] **PG-611:** Test backoff on `429`, transient `5xx`, and SSE disconnects.
- [ ] **PG-612:** Test delayed, false, malformed, and altered proof responses.
- [ ] **PG-613:** Test that missing proof and stale odds fail closed.
- [ ] **PG-614:** Test one-time final settlement.
- [ ] **PG-615:** Test that log and API serializers redact all secrets.

### Devnet Verification

- [ ] **PG-616:** Run subscription and activation against devnet.
- [ ] **PG-617:** Run a sustained scores and odds stream smoke test.
- [ ] **PG-618:** Verify wallet balance immediately before validation submission.
- [ ] **PG-619:** Simulate a real `validateStatV2` proof.
- [ ] **PG-620:** Submit and confirm a real validation receipt with preflight enabled.
- [ ] **PG-621:** Capture only public transaction and account identifiers for documentation.

### Deployment

- [ ] **PG-622:** Choose a host that supports a persistent Node process and long-lived outbound SSE connections.
- [ ] **PG-623:** Configure production secrets in the host's secret manager.
- [ ] **PG-624:** Deploy backend worker and frontend as one versioned release.
- [ ] **PG-625:** Confirm HTTPS, health checks, graceful restart, and stream reconnection.
- [ ] **PG-626:** Confirm the public app works in a fresh browser without local credentials.
- [ ] **PG-627:** Add basic request throttling and error monitoring.

### Documentation and Submission

- [ ] **PG-628:** Write README sections for problem, solution, architecture, setup, network, and security.
- [ ] **PG-629:** List every TxLINE endpoint and Solana instruction used.
- [ ] **PG-630:** Document live, historical, and synthetic modes accurately.
- [ ] **PG-631:** Document known limitations and non-goals.
- [ ] **PG-632:** Add test and deployment instructions.
- [ ] **PG-633:** Record honest TxLINE API feedback, including strengths and friction.
- [ ] **PG-634:** Verify the repository is public and contains no secrets or raw licensed data.
- [ ] **PG-635:** Prepare a five-minute-or-shorter demo script.
- [ ] **PG-636:** Record the end-to-end goal and finalisation flows.
- [ ] **PG-637:** Publish the demo video and confirm anonymous access.
- [ ] **PG-638:** Confirm the deployed app and API remain accessible without payment.
- [ ] **PG-639:** Complete and submit the Superteam entry.

### M6 Acceptance

- [ ] All required CI checks pass from a clean checkout.
- [ ] The deployed app passes the end-to-end demo test.
- [ ] The public repository contains no private keys, JWTs, API tokens, wallet JSON, or raw TxLINE data.
- [ ] README, working URL, demo video, technical integration list, and API feedback are complete.

## Post-MVP Stretch Tasks

- [ ] **PG-S01 — Stretch:** Add red-card rules using full-game stat keys `5` and `6`.
- [ ] **PG-S02 — Stretch:** Add VAR start/end handling and overturned-event reconciliation.
- [ ] **PG-S03 — Stretch:** Monitor multiple fixtures concurrently.
- [ ] **PG-S04 — Stretch:** Add a persistent PostgreSQL audit store.
- [ ] **PG-S05 — Stretch:** Add signed outbound operator webhooks.
- [ ] **PG-S06 — Stretch:** Add Telegram alerts and acknowledgment tracking.
- [ ] **PG-S07 — Stretch:** Add configurable latency thresholds per market type.
- [ ] **PG-S08 — Stretch:** Add an odds-staleness anomaly score with an explainable statistical model.
- [ ] **PG-S09 — Stretch:** Add an LLM-generated plain-language explanation that cannot affect agent decisions.
- [ ] **PG-S10 — Stretch:** Add a separately reviewed mainnet deployment profile.
- [ ] **PG-S11 — Stretch:** Design a custom Anchor market program only after the virtual-market MVP is stable.

## Current Next Actions

1. Approve or amend [PLAN.md](./PLAN.md).
2. Confirm devnet and provide a funded wallet through `ANCHOR_WALLET`.
3. Obtain and verify the official devnet IDL/types.
4. Select a covered fixture for the first live or historical validation.
5. Start M1 only after the architecture gate passes.

