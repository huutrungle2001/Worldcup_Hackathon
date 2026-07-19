# Task 002 — Bind TxLINE Proofs and Expose Verification Receipts

## Status

**READY**

## Assignment

- **Implementer:** Agy
- **Reviewer:** Codex
- **Priority:** Critical / judge-facing correctness
- **Time box:** 75 minutes implementation, 20 minutes verification

## Objective

Bind every TxLINE score proof to the exact fixture, sequence, stat keys, and
score values that triggered ProofGuard's market decision. Then expose a
sanitized verification receipt through the read-only API and dashboard so a
judge can distinguish a confirmed Solana transaction from a successful
read-only simulation or a rejected proof.

This is the highest-value remaining product task because the current validator
builds equality thresholds from values returned by the proof API itself, while
the dashboard exposes no proof receipt at all.

## Required Reading

Before editing:

1. Read the root `AGENTS.md` in full.
2. Read `docs/examples/onchain-validation.mdx`, especially **V2 Multi-Stat
   Validation** and exact stat coverage.
3. Before changing dashboard code, read `dashboard/AGENTS.md` and the relevant
   Next.js 16 guide under `dashboard/node_modules/next/dist/docs/` in full, as
   required by the nested instructions.

## Allowed Files

- `src/solana/validation.ts`
- `src/agent/risk.ts`
- `src/agent/market.ts` only if receipt association belongs on market state
- `src/server/index.ts`
- `scripts/validate_historical.ts`
- `scripts/test_all.ts`
- `dashboard/src/app/page.tsx`
- `dashboard/src/app/globals.css` only if the receipt panel needs a small style
  addition that cannot be expressed with existing classes
- `.agents/communication/execution_logs/002-bind-proofs-and-expose-receipts.md`

If another file is strictly required, stop and document why before changing it.
Do not edit `TODO.md`, `PLAN.md`, README files, deployment configuration, or
submission documents in this task.

## Requirements

### 1. Bind proof requests to triggering event values

- Introduce an explicit expected-stat representation containing integer `key`
  and non-negative finite `value` fields.
- `RiskAgent` must pass expected values derived from the normalized triggering
  event:
  - Goal for participant one: stat key `1`, value `event.scoreOne`
  - Goal for participant two: stat key `2`, value `event.scoreTwo`
  - Finalisation: keys `1` and `2`, values `event.scoreOne` and
    `event.scoreTwo`, in that order
- The validator must request `statKeys` from those expected stats rather than
  accepting an unrelated list with no values.
- Reject duplicate keys, unsupported score keys, non-integer keys, and
  negative/non-finite expected values before any HTTP, Solana view, or
  transaction call.

### 2. Validate TxLINE proof response identity before Solana execution

Before `.view()` or `.rpc()`, require all of the following:

- `summary.fixtureId` exactly matches the requested fixture ID.
- The requested sequence is a positive integer and remains the sequence stored
  in the receipt. Do not invent a sequence from the response.
- `statsToProve` count exactly matches the expected-stat count.
- Returned stat keys match the requested keys in the requested order.
- Each returned stat value exactly matches its event-derived expected value.
- Each returned stat has a corresponding proof entry.
- The proof timestamp is finite and positive before PDA derivation.

Any mismatch must fail closed, never reach `.view()` or `.rpc()`, and be
recorded as a sanitized rejected receipt. The market must remain `HALTED` or
`FINAL_PROOF_PENDING`.

### 3. Build non-tautological equality predicates

- Build `validateStatV2` equality thresholds from event-derived expected
  values, never from unchecked proof-response values.
- Cover every requested stat exactly once.
- For finalisation, use two indexed single-stat equality predicates so both
  final totals are independently bound. Do not use only the difference between
  scores, because equal offsets preserve that difference.
- Preserve requested stat order across `statsToProve`, `statProofs`, and
  predicate indexes.
- Export small pure helpers for response binding and strategy construction if
  that keeps the checks unit-testable without network calls.

### 4. Record sanitized verification receipts

Maintain a bounded in-memory receipt history, newest first, with no more than
50 entries. A receipt may expose only public verification data:

- Stable receipt ID
- Fixture ID and score sequence
- Expected stats and proved stats
- Proof timestamp
- Derived `daily_scores_roots` PDA when available
- Program ID and network
- Result status: `CONFIRMED`, `SIMULATED`, `REJECTED`, or `FAILED`
- Mode: `TRANSACTION`, `SIMULATION`, or `PRECHECK`
- Transaction signature and explorer URL only when a transaction is confirmed
- Sanitized reason code/message for rejection or failure
- Validation timestamp

Truthful labeling is mandatory:

- `CONFIRMED` only when `.rpc()` returns a signature.
- `SIMULATED` when `.view()` passed but no receipt transaction was submitted,
  including low-balance fallback or `submitReceipt=false`.
- `REJECTED` for fixture/stat/value/order/precheck mismatches.
- `FAILED` for false simulation or execution failure.

Do not store or expose raw proof hashes, Merkle nodes, JWTs, API tokens, wallet
paths, wallet secret material, request headers, or unsanitized error objects.

### 5. Expose a read-only receipt API

- Add `GET /api/receipts`.
- Support an optional positive-integer `fixtureId` query filter.
- Invalid filters return `400`.
- Return sanitized receipts newest first.
- This endpoint must not require the replay admin token and must not mutate
  state.

### 6. Add a judge-visible dashboard receipt panel

- Fetch receipts alongside current health and market data.
- Display the latest receipt for the selected fixture; with no selection,
  display the newest receipt or a clear empty state.
- Show fixture, sequence, expected/proved stats, proof timestamp, PDA, program,
  network, result, mode, and validation time when present.
- Render a Solana Explorer link only for `CONFIRMED` receipts with a signature.
- Use these exact user-facing labels:
  - `Confirmed on Solana`
  - `Simulation passed`
  - `Proof rejected`
  - `Validation failed`
- Never label a simulation as on-chain confirmation.
- Preserve the current dark, responsive visual style and existing behavior.

### 7. Keep the historical helper honest and compilable

- Update `scripts/validate_historical.ts` for the expected-stat contract.
- Derive expected values from an actual selected score record; do not derive
  the expected threshold from `statsToProve` after requesting a proof.
- If no record with an expected stat is available, fail with an actionable
  message rather than performing an unbound fallback validation.
- Check `result.success` explicitly. Do not report completion merely because a
  result object is truthy.

## Tests

Extend local tests with minimal synthetic objects. At minimum prove:

1. One expected stat creates one single equality predicate with its expected
   value.
2. Two final stats create two single equality predicates at indexes `0` and `1`.
3. Wrong proof fixture ID is rejected.
4. Missing, extra, reordered, duplicate, or wrong returned stat keys are
   rejected.
5. A returned stat value different from the triggering value is rejected.
6. A missing corresponding stat proof is rejected.
7. Invalid expected values or keys fail before any external operation.
8. Simulated and confirmed receipt shapes are labeled distinctly, and a
   simulated receipt has no explorer link.
9. Receipt history is bounded and fixture filtering returns only matches.
10. Receipt serialization contains no `jwt`, `token`, `secret`, `walletPath`,
    raw proof nodes, or test sentinel secrets.

Tests must not call TxLINE, Solana RPC, `.view()`, `.rpc()`, or live streams. Do
not add captured API payloads.

## Non-Goals

- No deployment work
- No replay-auth or hardcoded-admin-secret work; that is Task 003
- No new market rules, red cards, VAR, LLM, multi-fixture support, or database
- No transaction submission or activation
- No raw proof-data endpoint
- No transition changes beyond failing closed on a binding mismatch

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
```

Before `scripts/test_agent.ts`, confirm `TEST_MODE` is set before any risk-agent
call. Do not run `scripts/start_agent.ts`, `scripts/validate_historical.ts`, or
any transaction-producing script as verification.

## Acceptance Criteria

- A proof with the right Merkle structure but wrong fixture/stat/value cannot
  reopen or settle a market.
- Final validation independently binds both team totals.
- Thresholds come from the triggering normalized event.
- The latest sanitized receipt is accessible from the API and visible in the
  dashboard.
- Transactions, simulations, rejections, and failures are labeled truthfully
  and cannot leak secrets.
- Root tests/typecheck and dashboard lint/build pass.
- No network request or on-chain transaction occurs during verification.

## Required Execution Log

Create:

`.agents/communication/execution_logs/002-bind-proofs-and-expose-receipts.md`

Include:

- Summary and exact files changed
- Expected-event-stat propagation and proof-response binding rules
- Receipt schema, bounded-store behavior, API, and dashboard behavior
- Test-case mapping to the ten requirements above
- Every verification command with exit code
- Confirmation that no network request or on-chain transaction was attempted
- Remaining ambiguity or follow-up work
