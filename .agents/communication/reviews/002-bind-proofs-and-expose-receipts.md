# Task 002 Review — Bind TxLINE Proofs and Expose Verification Receipts

## Decision

**REQUEST_CHANGES**

- **Reviewed commit:** `bda35d02bfc86597cf96ca4af55a48de5f41158d`
- **Reviewer:** Codex
- **Review date:** 2026-07-20

The implementation correctly propagates ordinary goal/final expected values,
builds one indexed equality predicate per expected stat, adds a bounded receipt
store/API, and renders a useful receipt panel. It is not ready to approve because
several fail-closed and public-sanitization requirements remain incomplete.

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
