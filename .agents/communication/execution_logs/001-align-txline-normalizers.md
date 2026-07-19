# Task 001 Execution Log — Align Domain Normalizers with TxLINE Payloads

## Summary of Implementation & Review Fixes

Addressed all five blocking findings from the Codex review decision (`REQUEST_CHANGES`):
1. **Replay Build Type Safety (Finding 1):** Guarded `riskAgent.handleOddsUpdate` in `src/replay/index.ts` so nullable return type from `normalizeOddsUpdate` compiles cleanly under strict TypeScript typechecking (`yarn typecheck`).
2. **Action Canonicalization & Event Keys (Finding 2):** Trimmed and lowercased raw score action values (`action = rawActionStr.trim().toLowerCase()`) in `normalizeScoreEvent`. Event keys now take the stable form `${fixtureId}:${seq}:${action}` (e.g. `123:10:game_finalised`), ensuring exact string equality matching in `RiskAgent`.
3. **Strict Market Metadata Enforcement (Finding 3):** Updated `normalizeOddsUpdate` to reject untyped `PriceNames`/`Prices` or `outcomes` arrays that omit `SuperOddsType === "1X2_PARTICIPANT_RESULT"`. Only synthetic direct-field updates (`oddsOne`, `oddsDraw`, `oddsTwo`) may omit `SuperOddsType`.
4. **Early Market Filtering (Finding 4):** Reordered `normalizeOddsUpdate` checks to evaluate `super_odds_type` and `marketPeriod` before timestamp and fixture ID validation. Unrelated odds stream events without timestamps return `null` and are silently filtered out rather than throwing processing errors.
5. **Robust Rejection Tests (Finding 5):** Replaced try/catch sentinel assertions in `scripts/test_all.ts` with an unswallowable `expectThrow` helper that verifies error throwing outside the try block. Added regression assertions for string `GameState` preservation, canonicalized actions, untyped named-price rejection, zero/missing sequence rejection, non-finite/negative/NaN/infinity 1X2 prices, and unrelated market filtering without timestamps.

---

## Exact Files Changed

- `src/domain/types.ts`: Canonicalized score actions, reordered odds market filtering, enforced market metadata for named prices.
- `src/replay/index.ts`: Added null guard for `riskAgent.handleOddsUpdate(mockOdds)` to resolve TypeScript compilation error (`yarn typecheck`). *(Justified compile-error exception).*
- `scripts/start_agent.ts`: Preserved null guard around `riskAgent.handleOddsUpdate` for filtered odds updates.
- `scripts/test_all.ts`: Replaced try/catch assertions with `expectThrow`, added regression cases for Findings 2–5.
- `scripts/test_agent.ts`: Preserved non-null assertions on synthetic test updates.

---

## Verification Commands & Exit Codes

| Command | Exit Code | Outcome |
|---|---|---|
| `yarn test` | 0 | All unit, normalization, state machine, and race path tests passed. |
| `yarn ts-node scripts/test_agent.ts` | 0 | Simulated state machine agent test passed in `TEST_MODE`. |
| `yarn typecheck` | 0 | Root TypeScript compiler check passed with zero type errors. |
| `git diff --check` | 0 | Clean diff with zero whitespace issues. |
| `git status --short` | 0 | Expected files modified without stray untracked binaries. |

---

## Test-Case Summary

All required test cases in `scripts/test_all.ts` passed:

1. **Test 1:** Actual-shape fixture maps `Participant1`, `Participant2`, `Competition`, and `StartTime` ISO string.
2. **Test 2:** Actual-shape goal record (`Stats["1"] = 1`, `Stats["2"] = 0`, `Participant = 1`) maps score `1-0`, participant `1`, timestamp, status, and event key.
3. **Test 3:** Action canonicalization trims and lowercases raw actions (`" GAME_FINALISED "` -> `action: "game_finalised"`, `eventKey: "123:10:game_finalised"`).
4. **Test 4:** Preserved string `GameState` (`"scheduled"` remains `"scheduled"`).
5. **Test 5:** Lowercase/synthetic score aliases remain fully supported.
6. **Test 6:** Missing sequence (`Seq` omitted) and zero sequence (`Seq: 0`) are rejected.
7. **Test 7:** Missing score timestamp is rejected.
8. **Test 8:** Actual-shape full-match 1X2 odds message maps `[part1, draw, part2]` prices `[2000, 3000, 4000]`.
9. **Test 9:** Shuffled `PriceNames` (`["draw", "part2", "part1"]`) map to `oddsOne`, `oddsDraw`, `oddsTwo` correctly regardless of order.
10. **Test 10:** Handicap or over/under message (`SuperOddsType: "OVER_UNDER_GOALS"`) returns `null` (ignored).
11. **Test 11:** Extra-time message (`MarketPeriod: "ET1"`) returns `null` (ignored).
12. **Test 12:** Untyped named-price payload (missing `SuperOddsType`) returns `null` (ignored).
13. **Test 13:** Unrelated market without timestamp returns `null` without throwing a processing error.
14. **Test 14:** Zero, negative, `NaN`, and infinite 1X2 prices are rejected.

---

## `git diff --check` Result

```text
(Clean - 0 warnings / 0 errors)
```

---

## Remaining Ambiguity / Follow-up

- None. All review findings are fully resolved and independently verified.

---

## On-Chain Transaction Confirmation

**Explicit Confirmation:** No on-chain transaction (subscription, activation, or proof validation receipt) was executed or attempted during the implementation and verification of Task 001. All test scripts ran in `TEST_MODE` with local simulated validations.
