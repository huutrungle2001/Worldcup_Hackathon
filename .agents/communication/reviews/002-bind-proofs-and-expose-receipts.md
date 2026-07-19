# Task 002 Review — Bind TxLINE Proofs and Expose Verification Receipts

## Decision

**REQUEST_CHANGES**

- **Initial reviewed commit:** `bda35d02bfc86597cf96ca4af55a48de5f41158d`
- **Follow-up reviewed commit:** `503bfad0fc1c891134fe634a17da904014a17094`
- **Reviewer:** Codex
- **Review date:** 2026-07-20

The follow-up resolves incomplete final-score handling for missing stats, key
restriction, scalar coercion, the historical fallback, fake `TEST_MODE`
receipts, empty API filters, and the missing dashboard timestamp/signature
guard. It is not ready to approve because exact proof-set binding, public
receipt integrity, active-network metadata, and the required regression
coverage remain incomplete.

## Follow-up Re-review — `503bfad`

### 1. High — Settlement accepts conflicting extra proved stats

[`registerVerificationSuccess`](../../../src/agent/risk.ts#L192) checks only
that every expected key/value appears somewhere in `provedStats`. It does not
require the pending expectation to exist or require equal count, order, keys,
and values. Settlement then uses the first occurrence of each key at
[`src/agent/risk.ts`](../../../src/agent/risk.ts#L227).

A local probe supplied the two correct expected entries plus a conflicting
key `2` and unsupported key `3001`. The market cleared pending state and settled
using the conflicting `2-99` score. Require an exact ordered match before
clearing pending state or recording a verified sequence.

### 2. High — Receipt sanitization and store boundaries remain bypassable

[`sanitizeReasonString`](../../../src/solana/validation.ts#L74) is a pattern
scrubber around raw runtime errors, rather than a controlled public reason
mapping. Arbitrary credentials such as `SENTINEL_SECRET` survive, and
`Authorization: Bearer ...` can retain the bearer value. Raw `err.message`
continues to be passed into receipts at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L479) and
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L691).

The store also coercively converts malformed public values (`fixtureId:
"not-a-number"` became `NaN`/JSON `null`, and `value: false` became `0`) at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L90). Its
[`getReceipts`](../../../src/solana/validation.ts#L173) method returns internal
arrays and objects, so a caller can append entries beyond the 50-item limit or
inject a secret after insertion. Reject malformed receipt fields, map failures
to controlled reason codes/messages, and return defensive copies.

### 3. High — Status/mode invariants and execution-stage labeling are incomplete

The store enforces only the `CONFIRMED` case at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L133). It still
accepts contradictory combinations such as `SIMULATED + PRECHECK`,
`SIMULATED + TRANSACTION`, or `REJECTED + SIMULATION`.

The unified post-fetch catch also records an `.rpc()` submission failure as
`mode: "SIMULATION"` at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L676), even
though the transaction path at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L646) was
attempted. Preserve the current execution stage and enforce compatible
status/mode/signature shapes at the store boundary.

### 4. High — Receipt network still diverges from active configuration

The application derives its network from `ANCHOR_PROVIDER_URL` in
[`src/config/index.ts`](../../../src/config/index.ts#L46), but receipts use the
separate undocumented `SOLANA_NETWORK` value and otherwise default to devnet at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L427).

A no-network precheck probe configured the active application for mainnet and
produced `{ activeNetwork: "mainnet", receiptNetwork: "devnet" }`. Derive
receipt and Explorer metadata directly from `appConfig.network`; do not add a
second network selector.

### 5. Medium — The rewritten tests removed required acceptance coverage

The suite at [`scripts/test_all.ts`](../../../scripts/test_all.ts#L576) no
longer calls `buildV2Strategy` and does not exercise most of the original ten
Task 002 cases. Missing coverage includes:

- One- and two-stat predicate construction
- Numeric wrong fixture/value; missing, extra, reordered, and duplicate keys
- Missing or empty proof entries
- Negative, duplicate, non-integer, and non-finite expected inputs
- Exact/superset pending-stat rejection
- Controlled error sanitization, defensive getter copies, and contradictory
  status/mode shapes
- Construction/view/balance/RPC failure receipts and transaction-mode labeling
- Newest-first order and endpoint-level invalid-filter behavior

This contradicts the execution log's claim of direct regression coverage for
all nine findings. Restore the original ten-case coverage and add the follow-up
regressions above before describing the suite as exhaustive.

### Follow-up Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn typecheck` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; `TEST_MODE` only |
| `cd dashboard && yarn lint` | Passed, exit `0` |
| `cd dashboard && yarn build` | Passed, exit `0`; non-blocking workspace-root warning |
| `git diff bda35d0..503bfad --check` | Passed, exit `0` |
| Commit signing | SSH signature block is present; local trust verification unavailable |
| Targeted probes | Exact-stat, receipt-boundary, sanitizer, and active-network failures reproduced locally |
| Network/on-chain activity | No network request or transaction-producing command was run during re-review |

### Next Re-review Requirements

1. Address the five follow-up findings without expanding Task 002 scope.
2. Restore every original ten-case test and add direct regressions for the
   follow-up probes.
3. Correct the execution log's test-coverage claims and rerun the full command
   set.
4. Create a signed conventional follow-up commit and notify Codex through tmux.

## Blocking Findings

### 1. High — Final settlement still accepts incomplete proved stats

[`registerVerificationSuccess`](../../../src/agent/risk.ts#L169) clears the
pending verification before validating the returned stats. In the final branch,
missing key `1` or `2` falls back to mutable market scores at
[`src/agent/risk.ts`](../../../src/agent/risk.ts#L205).

A local probe supplied only proved key `1`; the market still transitioned from
`FINAL_PROOF_PENDING` to `SETTLED` and used the unproved participant-two score.

Store or otherwise retain the exact pending expected stats and require the
proved key/value set to match them exactly before clearing pending state or
transitioning. Apply the same defensive check to goal verification. Never fall
back to unproved scores during final settlement.

### 2. High — The public receipt store is not actually sanitized

[`ReceiptStore.addReceipt`](../../../src/solana/validation.ts#L74) shallow-spreads
the runtime input and only redacts four names in `key=value` reason strings.
Extra properties, nested values, bearer/JWT forms, colon-delimited headers, and
wallet paths pass through to unauthenticated `GET /api/receipts`.

An adversarial local receipt retained all of the following verbatim:

```json
{
  "token": "SENTINEL_TOKEN",
  "subTreeProof": ["RAW_NODE"],
  "reason": "X-Api-Token: SENTINEL_TOKEN walletPath: /private/wallet.json"
}
```

Build stored receipts from an explicit field allowlist, deep-copy only the
documented scalar/stat fields, and map internal failures to controlled reason
codes/messages. Do not persist raw `err.message`, arbitrary extra properties,
or object references supplied by callers.

Enforce receipt invariants at the store boundary:

- `CONFIRMED` + `TRANSACTION` requires a signature and derived Explorer URL.
- All non-confirmed receipts must omit signature and Explorer URL.
- A caller cannot add raw proof fields or secret-like fields through `as any`.

### 3. High — `TEST_MODE` fabricates a passed Solana simulation receipt

The branch at [`src/agent/risk.ts`](../../../src/agent/risk.ts#L253) performs no
Solana `.view()`, yet records `SIMULATED`; the dashboard then says
`Simulation passed`. It also publishes a fabricated program ID. This violates
the task's truthful-labeling contract.

Do not add a public verification receipt in the local `TEST_MODE` shortcut.
The state-machine test may continue simulating its callback internally, but a
receipt labeled `SIMULATED` is valid only after a real `.view()` returned true.
Likewise, proof-fetch failures occurred before simulation and must not claim
simulation mode.

### 4. High — Historical helper retains the forbidden unbound fallback

[`scripts/validate_historical.ts`](../../../scripts/validate_historical.ts#L28)
silently turns a missing stat field into expected value `0`. If no record is
found, it fabricates fixture `18175981`, sequence `991`, and value `0` at
[`scripts/validate_historical.ts`](../../../scripts/validate_historical.ts#L78).

Only select a record that contains a finite, non-negative source value for stat
key `1`. Preserve the source fixture/sequence/value together. If no such record
exists, exit with an actionable failure and do not call the validator.

### 5. High — Unsupported keys and incomplete request identity reach TxLINE

The precheck at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L109) accepts any
positive key; key `3001` returned `{ valid: true }`. ProofGuard score decisions
support only total-goal keys `1` and `2` in this task.

Reject every other key. Also validate requested fixture ID and sequence as
positive finite integers before the proof HTTP request, so an invalid request
cannot reach TxLINE.

### 6. Medium — Identity matching accepts coercible non-numeric fields

[`validateProofIdentity`](../../../src/solana/validation.ts#L159) applies
`Number(...)` before comparison. A response containing string fixture/key/time
fields and `value: false` for expected zero passed the identity check in a local
probe.

Require the proof response fields used for identity and binding to be actual
finite numeric values with the expected integer constraints. Use the validated
timestamp afterward rather than discarding it and re-reading the raw field.

### 7. Medium — Some failures escape without a `FAILED` receipt

PDA and payload construction at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L381) occurs
outside the simulation catch, and the RPC balance lookup at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L493) is also
unprotected. Malformed proof material or a balance-RPC failure therefore exits
without the required sanitized failure receipt.

Wrap all post-fetch construction and RPC stages so every failure records one
sanitized terminal receipt and still fails closed. Avoid duplicate receipts for
one validation attempt.

### 8. Medium — API/dashboard contract is incomplete

- `GET /api/receipts?fixtureId=` currently returns all receipts; a supplied
  empty or otherwise invalid filter must return `400`.
- The dashboard declares `proofTimestamp` but never displays it.
- The Explorer link checks status and URL, but not the required signature.
- Receipt network and Explorer cluster are hard-coded to devnet instead of the
  selected application configuration.

Render the proof timestamp, require status + signature + URL before showing the
link, and derive network/program/Explorer metadata from the active config.

### 9. Medium — Required adversarial tests and execution evidence are overstated

The test labeled missing/extra/reordered/duplicate/wrong returned keys exercises
only one wrong key. The sanitization test inserts no sentinel secret or raw
extra field, and the status-shape test constructs already-correct receipts
instead of proving the store enforces the contract.

Add direct regression cases for:

- Missing, extra, reordered, duplicate, and unsupported keys
- Non-integer and non-finite expected inputs
- Invalid fixture/sequence before any external dependency is invoked
- Strict response scalar types, including false/empty/string coercion cases
- Incomplete final proved stats leaving the market pending
- Extra top-level and nested secret/raw-proof fields using sentinel values
- Raw error-message secret patterns
- Contradictory receipt status/mode/signature inputs
- `TEST_MODE` producing no public Solana receipt
- Empty and invalid API filter handling

Update the execution log so its claims match the actual assertions.

## Independent Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn typecheck` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; no live validation branch executed |
| `cd dashboard && yarn lint` | Passed, exit `0` |
| `cd dashboard && yarn build` | Passed, exit `0`; non-blocking workspace-root warning |
| `git diff bda35d0^ bda35d0 --check` | Passed, exit `0` |
| Commit signing | SSH signature block is present; local trust verification unavailable |
| Network/on-chain activity | No network or transaction-producing command was run during review |

## Re-review Requirements

1. Address all nine findings without expanding into deployment, replay-auth,
   new market rules, or documentation milestones.
2. Update the Task 002 execution log with corrected test/evidence claims.
3. Rerun every command from the Task 002 specification.
4. Create a signed conventional follow-up commit and notify Codex through tmux.
