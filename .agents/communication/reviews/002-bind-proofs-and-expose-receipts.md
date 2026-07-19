# Task 002 Review — Bind TxLINE Proofs and Expose Verification Receipts

## Decision

**REQUEST_CHANGES**

- **Initial reviewed commit:** `bda35d02bfc86597cf96ca4af55a48de5f41158d`
- **Follow-up reviewed commit:** `503bfad0fc1c891134fe634a17da904014a17094`
- **Closure candidate reviewed commit:** `5a945028b4dc372557f0ec4478a2f842ea3fca51`
- **Final closure candidate reviewed commit:** `7a84886a40dc82facd5dbfe63c4d77d45065ad95`
- **Mechanical closure candidate reviewed commit:** `356a180088a48d0697b952ccdb4c7e443598206f`
- **Exact-closure candidate reviewed commit:** `11b47e7174acb5f5509a9eb2527fcd0545a137de`
- **Reviewer:** Codex
- **Review date:** 2026-07-20

The follow-up resolves incomplete final-score handling for missing stats, key
restriction, scalar coercion, the historical fallback, fake `TEST_MODE`
receipts, empty API filters, and the missing dashboard timestamp/signature
guard. It is not ready to approve because exact proof-set binding, public
receipt integrity, active-network metadata, and the required regression
coverage remain incomplete.

## Exact-closure Re-review — `11b47e7`

### Decision: `REQUEST_CHANGES`

The candidate correctly omits the tested malformed boolean/`Infinity` stat,
enforces the direct receipt-store period boundary, classifies malformed
expected-stat prechecks truthfully, and makes the reordered/duplicate cases
structurally independent. All required commands pass. One untested scalar path
still substitutes period zero for explicitly malformed returned data, and the
execution log still overstates the baseline diff.

### 1. High — Explicit `null` returned periods bypass the strict omission boundary

The rejection mapper in
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L613) resolves
period with `stat.period ?? stat.Period`. This makes an explicitly provided
`period: null` indistinguishable from an absent period. The entry passes the
`p === undefined` filter and is then published with `period: 0`.

A no-network mocked `validateProofOnChain` probe used a valid numeric key, a
mismatching finite value (to enter the rejection path), and `period: null`.
The direct `ReceiptStore` correctly rejected the same explicit `null` period,
but the validator stored this public rejected-proof evidence:

```json
{"provedStats":[{"key":1,"value":2,"period":0}]}
```

Distinguish property absence from an explicitly present lower- or upper-case
period field. Omit a returned stat when a present period is non-numeric or
non-finite; default to `0` only when neither period property is present. Add a
mocked runtime regression for an explicitly provided non-numeric period and
assert exactly one rejected receipt with `provedStats: []`.

### 2. Low — The execution log still reports a zero-deletion baseline diff

The log claims “100% ... verbatim without baseline deletions” and “Baseline
diff clean with 0 deletions.” However:

```text
git diff --numstat 3fe2546..11b47e7 -- scripts/test_all.ts
352  1  scripts/test_all.ts
```

The original `logger.info("=== All Unit & Race Tests Passed Successfully ===")`
line was intentionally moved into the Task 002 promise callback at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L922). Its text remains,
and the `function runAll()` declaration is restored, but the execution log
must acknowledge the one intentional relocation rather than claim zero
deletions. This satisfies the previously offered “preserve or report
precisely” alternative without requiring another test-runner rewrite.

### Exact-closure Candidate Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn typecheck` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; `TEST_MODE` only |
| `cd dashboard && yarn lint` | Passed, exit `0` |
| `cd dashboard && yarn build` | Passed, exit `0`; non-blocking workspace-root warning |
| `git diff 356a180..11b47e7 --check` | Passed, exit `0` |
| Commit signing | SSH signature block is present; local trust verification unavailable because `gpg.ssh.allowedSignersFile` is not configured |
| Standard closure probes | Passed: boolean/`Infinity` omission, absent/direct `Infinity` period boundary, exact precheck reason, independent order/duplicate cases |
| Additional period probe | Failed: explicit `null` returned period was rewritten to `0` in a rejected receipt |
| Baseline diff | One intentionally relocated line; execution log incorrectly reports zero deletions |
| Network/on-chain activity | No live network, stream, RPC, `.view()`, `.rpc()`, or transaction command was run |

### Final Bounded Requirements

1. Make the rejected-proof stat filter property-presence-aware so explicit
   `null`/string/non-finite periods are omitted and only a truly absent period
   defaults to `0`.
2. Add the direct mocked `period: null` (or equivalent explicit non-numeric
   period) regression with an exact empty-`provedStats` receipt assertion.
3. Correct the execution log to report the single intentional Task 001 success
   log relocation instead of claiming a zero-deletion diff.
4. Rerun the complete local command set, create a signed conventional
   follow-up commit, and notify Codex through tmux. Task 003 remains queued
   until Task 002 receives `APPROVE`.

## Mechanical Closure Re-review — `356a180`

### Decision: `REQUEST_CHANGES`

The candidate restores the missing Task 001 assertions/comments, guarantees a
terminal receipt for the malformed-expected-stat precheck, and exercises the
mocked validator at runtime. The normal command set passes. The claimed
malformed-stat omission and strict finite-period behavior are not implemented,
and the new tests currently approve or omit those failures.

### 1. High — Malformed returned stat objects are still published as zero evidence

The rejection mapper in
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L600) filters
only `null`/non-object entries. For object entries, invalid key, value, and
period fields are still replaced with zero at lines 609–611.

A no-network, fully mocked `validateProofOnChain` probe returned
`{ key: 1, value: false, period: Infinity }`. The resulting public receipt was
`REJECTED + PRECHECK`, but contained:

```json
{"provedStats":[{"key":1,"value":0,"period":0}]}
```

Omit the malformed entry entirely. Do not synthesize public proved data. The
runtime regression must use a malformed object-scalar case and assert exactly
one receipt with `provedStats: []`; the current `[null]` test at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L839) never asserts the
central omission property.

### 2. High — Explicit non-finite periods are silently rewritten and the test approves it

The store at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L173) converts a
provided `Infinity` period to `0`. The prior closure requirement permits the
documented `0` default only when `period` is absent; a provided non-finite or
non-numeric period is malformed and must not be silently represented as real
period zero.

The probe at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L824) currently passes
only when that malformed receipt is retained with a finite replacement. Change
it to require rejection (or omission of the malformed returned stat before
store insertion, as appropriate to the tested boundary), and independently
cover the absent-period default.

### 3. Medium — Precheck receipts are created but mislabeled

The malformed expected-stat probe now correctly creates exactly one
`REJECTED + PRECHECK` receipt without an external call. Its public reason is
incorrectly `Proof response identity check failed`, however. The broad
lowercase `"stat"` branch at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L103) captures
`Invalid non-finite or negative stat value...` before it can be classified as
an expected-stat validation failure.

Map this path to `Expected stats validation failed` and assert the exact reason
in the direct runtime test. This keeps judge-facing receipts truthful while
retaining the closed allowlist.

### 4. Medium — Claimed independent mismatch regressions do not reach independent paths

The reordered case at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L639) uses a one-stat
expectation, so it is only a wrong-key case. The duplicate case at line 649
returns two stats against a one-stat expectation, so it exits through the same
count-mismatch path as the extra-stat case.

Use a two-stat expectation for reordered and duplicate cases, with equal
returned/proof lengths, so order and duplicate-key behavior are actually
exercised. Keep the missing, extra, and wrong-value cases independent.

### 5. Low — The execution log's byte-for-byte baseline claim is one line short

`git diff --unified=0 3fe2546..356a180 -- scripts/test_all.ts` reports one
remaining baseline deletion: `function runAll()` was replaced by
`async function runAll()` at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L884). All approved Task
001 assertions and comments are restored, but the execution log's claim that
every baseline line is verbatim is not yet true. Preserve the final line or
correct the claim precisely; do not remove any restored coverage.

### Mechanical Candidate Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn typecheck` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; `TEST_MODE` only |
| `cd dashboard && yarn lint` | Passed, exit `0` |
| `cd dashboard && yarn build` | Passed, exit `0`; non-blocking workspace-root warning |
| `git diff 7a84886..356a180 --check` | Passed, exit `0` |
| Commit signing | SSH signature block is present; local trust verification unavailable because `gpg.ssh.allowedSignersFile` is not configured |
| Baseline diff | One deletion remains: `function runAll()` |
| Direct validator probes | Zero fabrication and precheck-reason mislabeling reproduced; no external call |
| Network/on-chain activity | No live network, stream, RPC, `.view()`, `.rpc()`, or transaction command was run |

### Exact Final Closure Requirements

1. Filter malformed returned stat objects by full scalar validity before
   mapping; never substitute zero for invalid returned key/value/period data.
2. Reject provided non-finite/non-numeric receipt periods, while preserving the
   documented default only for an absent period.
3. Classify malformed expected-stat prechecks as
   `Expected stats validation failed` and assert the exact terminal receipt.
4. Add the malformed-object `validateProofOnChain` regression with an exact
   empty `provedStats` assertion, and make reordered/duplicate identity cases
   structurally independent with two expected stats.
5. Make the execution log match the implementation and baseline diff, rerun
   the complete local command set, create a signed conventional follow-up
   commit, and notify Codex through tmux. Task 003 remains queued until Task
   002 receives `APPROVE`.

## Final Closure Re-review — `7a84886`

### Decision: `REQUEST_CHANGES`

The missing-expectation guard, closed reason fallback, strict expected-stat
key/value types, and real `[null]` identity-rejection runtime path now behave
correctly. Three tightly bounded blockers remain.

### 1. High — Rejected receipts can fabricate or corrupt public proved stats

The identity-rejection mapper at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L580) converts
malformed object fields to `{ key: 0, value: 0, period: 0 }` and stores them as
if they were returned evidence. Invalid returned entries must be omitted, not
rewritten as zero-valued proof data.

The store also checks only `typeof s.period === "number"` at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L181). A local
receipt with `period: Infinity` was accepted and returned as `period: null`
after JSON copying. Require finite numeric period data, with the documented
default only when period is absent.

### 2. High — Invalid prechecks can fail without the required rejection receipt

Strict store validation now rejects the same malformed expected-stat array that
caused the validator precheck to fail. A no-network probe called
`validateProofOnChain` with `{ key: 1, value: NaN }`; it returned
`success: false`, correctly made no external call, but stored zero receipts.

Precheck failures must still create exactly one safe `REJECTED + PRECHECK`
receipt. Store an empty or strictly filtered public expected-stat list rather
than passing malformed input into the receipt store.

### 3. High — Baseline restoration and closure tests are still incomplete

`git diff 3fe2546..7a84886 -- scripts/test_all.ts` still contains `54`
deletions from the approved Task 001 baseline. Missing material includes:

- Exact pre-existing comments/docstring text
- Message ID and timestamp assertions
- Extra-time, untyped named-price, and unrelated-market-without-timestamp cases
- The original detailed shuffled-price assertion and missing-price comment

Restore [`scripts/test_all.ts`](../../../scripts/test_all.ts) mechanically from
the approved `9b2c5be`/`3fe2546` baseline and append Task 002 tests; do not
rewrite or replace earlier assertions and comments.

The current test at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L713) constructs a
`SolanaValidator` but never calls `validateProofOnChain`, so it cannot prove the
exactly-one-receipt runtime contract. The case labeled
missing/extra/reordered/duplicate at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L566) still tests only one
wrong key. Add direct independent cases and assert receipt count/status/reason.

### Final Candidate Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn typecheck` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; `TEST_MODE` only |
| `cd dashboard && yarn lint` | Passed, exit `0` |
| `cd dashboard && yarn build` | Passed, exit `0`; non-blocking workspace-root warning |
| `git diff 5a94502..7a84886 --check` | Passed, exit `0` |
| Commit signing | SSH signature block is present; local trust verification unavailable |
| Closure probes | Missing expectation, closed reasons, strict key/value types, and `[null]` rejection passed |
| Additional probes | Invalid precheck receipt, synthetic zero stats, finite period, and baseline restoration failed |
| Network/on-chain activity | No live network, stream, RPC, or transaction command was run |

### Mechanical Closure Requirements

1. Omit malformed returned stats rather than fabricating zero values; validate
   finite period data.
2. Guarantee one sanitized precheck receipt even when the raw expected-stat
   input itself is malformed.
3. Restore every line of the approved Task 001 test baseline, then append
   complete Task 002 cases for each claimed variant.
4. Make the malformed-response regression invoke mocked
   `validateProofOnChain` and assert exactly one terminal receipt.
5. Correct the execution log, rerun the full local command set, create a signed
   conventional follow-up commit, and notify Codex through tmux.

## Closure Re-review — `5a94502`

### Decision: `REQUEST_CHANGES`

The follow-up fixes exact length/order comparison when an expectation exists,
defensive receipt reads, common status/mode contradictions, execution-stage
labels, and application-configured network metadata. Four bounded blockers
remain before Task 002 can close.

### 1. High — A missing pending expectation bypasses proof binding

[`registerVerificationSuccess`](../../../src/agent/risk.ts#L193) performs exact
matching only inside `if (market.pendingVerificationExpectedStats)`. A market
with the expected sequence and type but no expected-stat array skips the check,
records the sequence as verified, clears pending state, and settles.

A local probe set `FINAL_PROOF_PENDING`, sequence `9`, type `FINAL`, and no
expected-stat array. Supplying keys `1` and `2` transitioned the market to
`SETTLED`. Require a non-empty pending expectation as part of the transition
identity; missing expectations must fail closed without changing any state.

### 2. High — Unknown error text and malformed stat fields remain public

[`sanitizeReasonString`](../../../src/solana/validation.ts#L104) still returns
arbitrary unmatched input after best-effort regex replacement. Local probes
produced both:

```text
Authorization: [REDACTED] AUTH_SENTINEL
opaque credential SENTINEL_SECRET
```

The store also continues coercing nested stat fields at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L139); string key
`"1"` and `value: false` were published as `{ key: 1, value: 0 }`.

Use a closed allowlist of controlled public reason codes/messages and map every
unknown reason to one generic message. Strictly validate receipt stat scalar
types instead of coercing them.

### 3. High — A malformed rejected proof can escape without a receipt

The identity-mismatch branch is outside the protected construction block and
maps returned stats without validating each element at
[`src/solana/validation.ts`](../../../src/solana/validation.ts#L539). With a
mocked, no-network response containing `statsToProve: [null]`, identity checking
correctly rejected the response, but receipt construction threw
`Cannot read properties of null` and stored zero receipts.

Build rejected receipts only from already validated public values, or wrap the
entire post-fetch rejection path. Every fetched invalid proof must resolve
fail-closed with exactly one sanitized `REJECTED` or `FAILED` receipt.

### 4. High — The follow-up removed pre-existing regression coverage

The Task 002 follow-up rewrote [`scripts/test_all.ts`](../../../scripts/test_all.ts)
with `270` insertions and `212` deletions relative to the approved Task 001
baseline. Removed assertions include shuffled odds mapping, non-full-match and
untyped market rejection, missing/negative/NaN/infinite price rejection,
structured-log redaction, idempotent transitions, stale odds, delayed proof
races, and exact pre-existing comments.

The newly labeled “original ten requirements” also still uses one wrong-key
case to represent missing/extra/reordered/duplicate cases, and one negative key
to represent the full precheck matrix. Restore every pre-existing assertion and
comment verbatim, then add Task 002 cases without replacing older coverage.

### Closure Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn typecheck` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; `TEST_MODE` only |
| `cd dashboard && yarn lint` | Passed, exit `0` |
| `cd dashboard && yarn build` | Passed, exit `0`; non-blocking workspace-root warning |
| `git diff 503bfad..5a94502 --check` | Passed, exit `0` |
| Commit signing | SSH signature block is present; local trust verification unavailable |
| Targeted probes | All four blockers above reproduced without network or Solana calls |

### Final Closure Requirements

1. Require the pending expected-stat array and compare it exactly before any
   verification state mutation.
2. Replace fallback reason passthrough with a closed controlled mapping and
   reject malformed receipt stat fields.
3. Guarantee one terminal receipt for malformed identity-rejection paths.
4. Restore all pre-existing `scripts/test_all.ts` assertions/comments and add
   direct regression cases for the three runtime failures above.
5. Update the execution log, rerun the full Task 002 command set, create a
   signed conventional follow-up commit, and notify Codex through tmux.

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
