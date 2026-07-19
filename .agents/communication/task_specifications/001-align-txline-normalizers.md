# Task 001 — Align Domain Normalizers with TxLINE Payloads

## Status

**READY**

## Assignment

- **Implementer:** Agy
- **Reviewer:** Codex
- **Priority:** Critical
- **Type:** Correctness repair with focused regression tests

## Objective

Correct the fixture, score, and odds normalization boundary so ProofGuard can
consume the payload shapes returned by the current TxLINE devnet API without
producing empty team names, zero scores, zero odds, or an incorrect goal-team
mapping.

This task must stop at the normalization and ingestion boundary. Do not change
proof orchestration, market transitions, deployment, or dashboard design in
this task.

## Context

Read-only smoke checks against the current devnet API showed these relevant
payload shapes. The examples below are deliberately minimal and synthetic;
do not commit captured TxLINE match data.

### Fixture shape

```typescript
{
  FixtureId: 123,
  Participant1: "Team A",
  Participant2: "Team B",
  Competition: "Competition Name",
  CompetitionId: 456,
  StartTime: 1790348400000,
  Ts: 1790340000000
}
```

### Score shape

```typescript
{
  FixtureId: 123,
  Seq: 10,
  Ts: 1790348500000,
  Action: "goal",
  Participant: 1,
  StatusId: 2,
  GameState: "scheduled",
  Stats: {
    "1": 1,
    "2": 0
  }
}
```

For soccer, full-game participant goal totals use stat keys `1` and `2`.

### Odds shape

```typescript
{
  FixtureId: 123,
  MessageId: "synthetic-message-id",
  Ts: 1790348501000,
  SuperOddsType: "1X2_PARTICIPANT_RESULT",
  MarketPeriod: null,
  MarketParameters: null,
  InRunning: true,
  PriceNames: ["part1", "draw", "part2"],
  Prices: [2000, 3000, 4000]
}
```

The live odds stream contains many other market types. ProofGuard's current
virtual market represents the full-match 1X2 market, so unrelated handicap,
over/under, and extra-time markets must not overwrite it.

## Allowed Files

Keep changes surgical. Modify only these files unless a compile error makes an
additional change strictly necessary:

- `src/domain/types.ts`
- `scripts/start_agent.ts`
- `scripts/test_all.ts`

If another file is required, stop and document the reason in the execution log
before changing it.

## Requirements

### 1. Fixture normalization

- Map `FixtureId`/`fixtureId` to a positive finite `fixtureId`.
- Map participant names from the actual `Participant1` and `Participant2`
  fields while preserving compatibility with the existing synthetic aliases.
- Map `Competition` to `competitionName`.
- Convert numeric millisecond `StartTime` values to a valid ISO-8601 string.
- Do not substitute the current time when a required fixture timestamp is
  malformed.

### 2. Score normalization

- Map `FixtureId`, `Seq`, `Ts`, `Action`, `StatusId`, `Period`, `GameState`, and
  `Participant` from either documented uppercase or supported lowercase
  variants.
- Read participant goal totals from `Stats["1"]` and `Stats["2"]`.
- Preserve backward compatibility with the existing synthetic `scoreOne` and
  `scoreTwo` fields used by local tests.
- Map `Participant` to `participantId`.
- Represent `GameState` without coercing a real string value into `NaN`; update
  the normalized type if necessary.
- Normalize `action` consistently for comparisons and stable event keys.
- Reject missing, zero, non-integer, or non-finite fixture IDs and sequences.
- Reject a missing or non-finite source timestamp instead of using
  `Date.now()`.
- Reject non-finite or negative score totals.

### 3. Odds normalization and routing

- Parse real prices by pairing `PriceNames` with `Prices`.
- For `1X2_PARTICIPANT_RESULT`, map `part1`, `draw`, and `part2` to
  `oddsOne`, `oddsDraw`, and `oddsTwo` regardless of array order.
- Accept only the full-match 1X2 market for delivery to `RiskAgent`. A message
  with another `SuperOddsType` or a non-null/non-empty `MarketPeriod` must be
  ignored without logging it as a processing error.
- It is acceptable for `normalizeOddsUpdate` to return `null` for ignored
  markets. If so, update `scripts/start_agent.ts` to guard the call to
  `riskAgent.handleOddsUpdate`.
- Preserve compatibility with existing synthetic updates that provide direct
  `oddsOne`, `oddsDraw`, and `oddsTwo` values and omit `SuperOddsType`.
- Capture `MessageId` in the normalized representation if needed for stable
  identification. Do not pretend it is a TxLINE score sequence.
- Reject a missing or non-finite source timestamp instead of using
  `Date.now()`.
- Reject missing, non-finite, zero, or negative 1X2 prices.

### 4. Tests

Extend `scripts/test_all.ts` with assertions covering at least:

1. An actual-shape fixture maps both team names, competition, and start time.
2. An actual-shape goal record maps score `1-0`, participant `1`, source
   timestamp, status, and a stable normalized event key.
3. Lowercase/synthetic score aliases remain supported.
4. A missing or zero score sequence is rejected.
5. A missing score timestamp is rejected.
6. An actual-shape full-match 1X2 odds message maps `[part1, draw, part2]`
   prices correctly.
7. Shuffled `PriceNames` still map to the correct outcomes.
8. A handicap or over/under message is ignored.
9. An extra-time or other non-full-match 1X2 message is ignored.
10. Missing, zero, negative, or non-finite 1X2 prices are rejected.

Tests must use minimal synthetic objects. Do not add raw API responses or match
data to the repository.

## Non-Goals

- Do not change the market state machine.
- Do not change Solana proof validation.
- Do not add fixture snapshot bootstrapping.
- Do not add odds suspension or freshness policy beyond filtering to the
  intended full-match 1X2 market.
- Do not modify the dashboard.
- Do not edit `TODO.md` or mark milestones complete.
- Do not run subscription, activation, airdrop, validation receipt, or any
  other transaction-producing script.

## Verification Commands

Run these read-only/local commands after implementation:

```bash
yarn test
yarn ts-node scripts/test_agent.ts
git diff --check
git status --short
```

`scripts/test_agent.ts` uses `TEST_MODE` and must not submit a transaction.
Before running it, verify from the implementation that the test-mode branch is
selected before any Solana validation call.

Do not run `scripts/start_agent.ts` as part of this task because a live goal
could trigger a receipt transaction.

## Acceptance Criteria

The task is ready for review when:

- All ten regression cases above pass.
- A real-shape fixture no longer produces blank participant names.
- A real-shape score record no longer produces a false `0-0` score.
- A participant-one goal maps to score stat key `1` through the existing risk
  logic, and a participant-two goal maps to key `2`.
- A real full-match 1X2 odds record produces its three nonzero prices.
- Unrelated odds markets cannot reach `RiskAgent.handleOddsUpdate`.
- Missing timestamps are not silently replaced with local wall-clock time.
- Existing synthetic agent test behavior remains intact.
- No secrets, wallet material, raw TxLINE data, or unrelated edits appear in
  the diff.

## Required Execution Log

After implementation, create:

`/.agents/communication/execution_logs/001-align-txline-normalizers.md`

The log must include:

- Summary of the implementation
- Exact files changed
- Verification commands and exit codes
- Test-case summary
- `git diff --check` result
- Any remaining ambiguity or follow-up needed
- Explicit confirmation that no on-chain transaction was attempted

Do not claim completion in `TODO.md`; Codex will review the diff and record the
formal decision under `/.agents/communication/reviews/`.
