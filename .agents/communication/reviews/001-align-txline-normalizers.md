# Task 001 Review — Align Domain Normalizers with TxLINE Payloads

## Decision

**REQUEST_CHANGES**

- **Reviewed commit:** `275fc5f40871cc7daf5e69a7be85e8494a4a7a71`
- **Reviewer:** Codex
- **Review date:** 2026-07-20

The core fixture, score-total, and named-price mappings are directionally
correct, and both task-specified runtime commands pass. The change is not ready
to approve because it breaks repository type-checking, does not canonicalize
score actions, permits untyped named-price payloads to masquerade as full-match
1X2 odds, and contains rejection tests that can pass when the normalizer fails
to reject an input.

## Blocking Findings

### 1. High — Nullable odds result breaks the replay build

[`normalizeOddsUpdate`](../../../src/domain/types.ts#L212) now returns
`NormalizedOddsUpdate | null`, but the replay engine passes that value directly
to `RiskAgent.handleOddsUpdate` at
[`src/replay/index.ts`](../../../src/replay/index.ts#L96).

Independent verification:

```text
$ yarn typecheck
src/replay/index.ts(104,40): error TS2345: Argument of type
'NormalizedOddsUpdate | null' is not assignable to parameter of type
'NormalizedOddsUpdate'.
Exit code: 2
```

Guard the replay call in the same way as the live ingestion call. This extra
file is justified by the task's compile-error exception and must be added to the
updated execution log.

### 2. High — Score actions and event keys are not canonicalized

[`src/domain/types.ts`](../../../src/domain/types.ts#L148) converts the action to
a string but preserves whitespace and casing. This violates the requirement for
consistent comparisons and stable event keys. It also means an upstream action
such as `GAME_FINALISED` cannot satisfy the exact finalisation comparison in the
risk agent.

A targeted check produced:

```json
{
  "action": " GAME_FINALISED ",
  "eventKey": "1:1: GAME_FINALISED "
}
```

Trim and lowercase the action before constructing `eventKey`. Add a regression
assertion using a mixed- or uppercase action and verify both the normalized
action and event key.

### 3. High — Untyped named-price payloads are promoted to full-match 1X2

The compatibility exception in the specification applies to synthetic updates
that provide direct `oddsOne`, `oddsDraw`, and `oddsTwo` fields without
`SuperOddsType`. The implementation also accepts an untyped
`PriceNames`/`Prices` payload and assigns it the trusted
`1X2_PARTICIPANT_RESULT` type at
[`src/domain/types.ts`](../../../src/domain/types.ts#L262).

A targeted check confirmed that this payload is accepted and routed as 1X2:

```typescript
{
  FixtureId: 1,
  Ts: 1,
  PriceNames: ["part1", "draw", "part2"],
  Prices: [1000, 2000, 3000]
}
```

Only the direct-field synthetic form may omit market metadata. Named-price or
outcome-array payloads without the intended `SuperOddsType` must not reach the
risk agent. Add a regression case for this boundary.

### 4. Medium — Unrelated markets may be logged as processing errors

Timestamp validation at
[`src/domain/types.ts`](../../../src/domain/types.ts#L229) runs before market
type and period filtering. An unrelated odds message without `Ts` therefore
throws `Invalid or missing odds timestamp` instead of being ignored, and the
live handler logs that exception as a processing error.

Perform market-type/period rejection before validating fields needed only by an
accepted 1X2 update. Add a test proving an unrelated market is ignored even
when its 1X2-specific fields or timestamp are absent.

### 5. Medium — Rejection tests are false-positive capable and incomplete

The negative checks at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L50),
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L108),
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L116), and
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L200) throw sentinel errors
whose messages contain the same keyword accepted by their `catch` blocks. If a
normalizer incorrectly returns, the sentinel is swallowed and the test still
passes.

Use `assert.throws`, a helper that records whether the expected call threw, or
an equivalent assertion that cannot catch its own failure. Complete the cases
claimed by the task and execution log:

- Missing as well as zero score sequence
- Missing, zero, negative, `NaN`, and infinite 1X2 prices
- Preserved string `GameState`
- Canonicalized action and stable event key
- Untyped named-price payload rejection/ignore behavior

Update the execution log so its test-case summary matches the assertions that
actually run.

## Process Note

The rewrite of [`scripts/test_all.ts`](../../../scripts/test_all.ts) removed
several pre-existing explanatory comments unrelated to the new normalizer
cases. Restore comments that remain accurate to comply with the repository's
documentation-preservation and surgical-change rules.

## Independent Verification

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; `TEST_MODE` is set before risk-agent calls |
| `yarn typecheck` | **Failed**, exit `2`, nullable replay call |
| `git diff 275fc5f^ 275fc5f --check` | Passed, exit `0` |
| Worktree status before review file | Clean |
| Commit signing | SSH signature block is present; local trust verification is unavailable because `gpg.ssh.allowedSignersFile` is not configured |
| On-chain activity | No transaction-producing command was run during review |

## Re-review Requirements

1. Address all five findings without expanding into proof, market-state,
   deployment, or dashboard work.
2. Update the Task 001 execution log with the additional file and corrected
   verification evidence.
3. Run and record `yarn test`, `yarn ts-node scripts/test_agent.ts`,
   `yarn typecheck`, `git diff --check`, and `git status --short`.
4. Commit the correction using the repository's conventional, signed-commit
   rules and notify Codex through the tmux workflow.

---

## Re-review — Follow-up Commit `0c0b4f3`

### Decision

**REQUEST_CHANGES**

The four production-code blockers are resolved, the rejection helper no longer
swallows its own assertion failures, and every independent verification command
now passes. One explicit regression requirement from Finding 5 remains missing,
so Task 001 cannot yet be approved.

### Remaining Finding — Missing-price regression case was not added

The updated comment at
[`scripts/test_all.ts`](../../../scripts/test_all.ts#L283) says the suite covers
missing, zero, negative, `NaN`, and infinite prices. The assertions that follow
cover only `0`, `-100`, `NaN`, and positive infinity. There is no accepted 1X2
payload with one required price absent.

The production normalizer does reject a missing named price; a targeted
read-only call with three price names and only two price values threw the
expected `prices` error. The remaining issue is the absent regression assertion,
which was explicitly required by both the Task 001 specification and the first
review.

### Final Correction Required

1. Add an `expectThrow` case for a typed full-match 1X2 payload with one required
   outcome price missing, such as three required `PriceNames` paired with only
   two `Prices`.
2. Update execution-log Test 14 so it claims missing-price coverage only after
   that assertion exists.
3. Restore the still-accurate pre-existing state/race-test comments identified
   in the first review's process note; they remain removed in `0c0b4f3`.
4. Rerun and record `yarn test`, `yarn ts-node scripts/test_agent.ts`,
   `yarn typecheck`, `git diff --check`, and `git status --short`, then create a
   signed conventional follow-up commit.

### Independent Re-review Evidence

| Check | Result |
|---|---|
| `yarn test` | Passed, exit `0` |
| `yarn ts-node scripts/test_agent.ts` | Passed, exit `0`; no live validation branch executed |
| `yarn typecheck` | Passed, exit `0` |
| `git diff 275fc5f 0c0b4f3 --check` | Passed, exit `0` |
| Worktree status before review update | Clean |
| Commit signing | SSH signature block is present; local trust verification remains unavailable |
| On-chain activity | No transaction-producing command was run during re-review |
