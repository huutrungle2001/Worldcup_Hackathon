process.env.TEST_MODE = "true";

import {
  normalizeFixture,
  normalizeScoreEvent,
  normalizeOddsUpdate,
} from "../src/domain/types";
import { Logger } from "../src/utils/logger";
import { marketManager } from "../src/agent/market";
import { RiskAgent } from "../src/agent/risk";
import { logger } from "../src/utils/logger";
import {
  buildV2Strategy,
  validateProofIdentity,
  validateExpectedStatsPrecheck,
  receiptStore,
  ExpectedStat,
} from "../src/solana/validation";

/**
 * Robust assertion helper for functions expected to throw an error.
 * Cannot swallow its own assertion errors because verification occurs outside the try/catch block.
 */
function expectThrow(fn: () => void, expectedKeyword: string) {
  let threw = false;
  let caughtError = "";

  try {
    fn();
  } catch (err: any) {
    threw = true;
    caughtError = String(err?.message ?? err);
  }

  if (!threw) {
    throw new Error(
      `Assertion failed: Expected function to throw an error containing "${expectedKeyword}", but it executed without throwing.`
    );
  }
  if (
    !caughtError.toLowerCase().includes(expectedKeyword.toLowerCase())
  ) {
    throw new Error(
      `Assertion failed: Expected error message to contain "${expectedKeyword}", but got: "${caughtError}"`
    );
  }
}

function testFixtureNormalization() {
  logger.info("Running fixture normalization tests...");

  // 1. Real-shape fixture with Participant1, Participant2, Competition, StartTime
  const rawFixture = {
    FixtureId: 123,
    Participant1: "Team A",
    Participant2: "Team B",
    Competition: "World Cup 2026",
    CompetitionId: 456,
    StartTime: 1790348400000,
    Ts: 1790340000000,
  };

  const norm = normalizeFixture(rawFixture);
  if (norm.fixtureId !== 123) {
    throw new Error(`Expected fixtureId 123, got ${norm.fixtureId}`);
  }
  if (norm.participantOneName !== "Team A") {
    throw new Error(
      `Expected Participant1 "Team A", got "${norm.participantOneName}"`
    );
  }
  if (norm.participantTwoName !== "Team B") {
    throw new Error(
      `Expected Participant2 "Team B", got "${norm.participantTwoName}"`
    );
  }
  if (norm.competitionName !== "World Cup 2026") {
    throw new Error(
      `Expected Competition "World Cup 2026", got "${norm.competitionName}"`
    );
  }
  if (norm.startTime !== new Date(1790348400000).toISOString()) {
    throw new Error(`StartTime ISO mismatch: got ${norm.startTime}`);
  }

  // Missing or invalid StartTime throws error
  expectThrow(
    () =>
      normalizeFixture({ FixtureId: 123, Participant1: "A", Participant2: "B" }),
    "StartTime"
  );

  logger.info("✓ Fixture normalization tests passed.");
}

function testScoreNormalization() {
  logger.info("Running score normalization tests...");

  // 2. Real-shape goal record with Stats["1"] = 1, Stats["2"] = 0, Participant = 1
  const rawScore = {
    FixtureId: 123,
    Seq: 10,
    Ts: 1790348500000,
    Action: "goal",
    Participant: 1,
    StatusId: 2,
    GameState: "scheduled",
    Stats: {
      "1": 1,
      "2": 0,
    },
  };

  const norm = normalizeScoreEvent(rawScore);
  if (norm.fixtureId !== 123) throw new Error("FixtureId mismatch");
  if (norm.seq !== 10) throw new Error("Seq mismatch");
  if (norm.scoreOne !== 1 || norm.scoreTwo !== 0) {
    throw new Error(
      `Expected score 1-0, got ${norm.scoreOne}-${norm.scoreTwo}`
    );
  }
  if (norm.participantId !== 1) throw new Error("ParticipantId mismatch");
  if (norm.ts !== 1790348500000) throw new Error("Timestamp mismatch");
  if (norm.statusId !== 2) throw new Error("StatusId mismatch");
  if (norm.eventKey !== "123:10:goal") throw new Error("EventKey mismatch");

  // Action canonicalization (trimmed & lowercased) and stable event key
  const rawPaddedAction = {
    FixtureId: 123,
    Seq: 10,
    Ts: 1790348500000,
    Action: " GAME_FINALISED ",
    Stats: { "1": 2, "2": 1 },
  };
  const normPadded = normalizeScoreEvent(rawPaddedAction);
  if (normPadded.action !== "game_finalised") {
    throw new Error(
      `Expected action "game_finalised", got "${normPadded.action}"`
    );
  }
  if (normPadded.eventKey !== "123:10:game_finalised") {
    throw new Error(
      `Expected eventKey "123:10:game_finalised", got "${normPadded.eventKey}"`
    );
  }

  // Preserved string GameState
  const normStrState = normalizeScoreEvent({
    FixtureId: 123,
    Seq: 1,
    Ts: 1000,
    GameState: "scheduled",
  });
  if (normStrState.gameState !== "scheduled") {
    throw new Error(
      `Expected string GameState "scheduled", got ${normStrState.gameState}`
    );
  }

  // 3. Lowercase / synthetic score aliases remain supported
  const rawSynthetic = {
    fixtureId: 101,
    seq: 5,
    ts: 10000,
    action: "Goal",
    scoreOne: 2,
    scoreTwo: 1,
  };
  const normSynth = normalizeScoreEvent(rawSynthetic);
  if (normSynth.scoreOne !== 2 || normSynth.scoreTwo !== 1) {
    throw new Error(
      `Synthetic score alias failed: got ${normSynth.scoreOne}-${normSynth.scoreTwo}`
    );
  }

  // 4. Missing as well as zero score sequence rejected
  expectThrow(
    () => normalizeScoreEvent({ FixtureId: 123, Ts: 10000 }),
    "sequence"
  );
  expectThrow(
    () => normalizeScoreEvent({ FixtureId: 123, Seq: 0, Ts: 10000 }),
    "sequence"
  );

  // 5. Missing score timestamp rejected
  expectThrow(
    () => normalizeScoreEvent({ FixtureId: 123, Seq: 5 }),
    "timestamp"
  );

  logger.info("✓ Score normalization tests passed.");
}

function testOddsNormalization() {
  logger.info("Running odds normalization & routing tests...");

  // 6. Actual-shape full-match 1X2 odds message
  const rawOdds = {
    FixtureId: 123,
    MessageId: "synthetic-msg-123",
    Ts: 1790348501000,
    SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [2000, 3000, 4000],
  };

  const norm = normalizeOddsUpdate(rawOdds);
  if (!norm) throw new Error("Expected non-null normalized odds");
  if (
    norm.oddsOne !== 2000 ||
    norm.oddsDraw !== 3000 ||
    norm.oddsTwo !== 4000
  ) {
    throw new Error(
      `Odds price mismatch: got ${norm.oddsOne}/${norm.oddsDraw}/${norm.oddsTwo}`
    );
  }
  if (norm.messageId !== "synthetic-msg-123")
    throw new Error("MessageId mismatch");
  if (norm.ts !== 1790348501000) throw new Error("Odds TS mismatch");

  // 7. Shuffled PriceNames still map correctly
  const rawShuffled = {
    FixtureId: 123,
    Ts: 1790348501000,
    SuperOddsType: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["draw", "part2", "part1"],
    Prices: [3100, 4100, 2100],
  };
  const normShuffled = normalizeOddsUpdate(rawShuffled);
  if (!normShuffled) throw new Error("Expected non-null shuffled odds");
  if (
    normShuffled.oddsOne !== 2100 ||
    normShuffled.oddsDraw !== 3100 ||
    normShuffled.oddsTwo !== 4100
  ) {
    throw new Error(
      `Shuffled odds mismatch: got ${normShuffled.oddsOne}/${normShuffled.oddsDraw}/${normShuffled.oddsTwo}`
    );
  }

  // 8. Handicap or over/under message is ignored (returns null)
  const rawOverUnder = {
    FixtureId: 123,
    Ts: 1790348501000,
    SuperOddsType: "OVER_UNDER_GOALS",
    PriceNames: ["over", "under"],
    Prices: [1800, 2000],
  };
  if (normalizeOddsUpdate(rawOverUnder) !== null) {
    throw new Error("Handicap/Over-Under market should return null");
  }

  // 9. Extra-time or other non-full-match 1X2 message is ignored (returns null)
  const rawExtraTime = {
    FixtureId: 123,
    Ts: 1790348501000,
    SuperOddsType: "1X2_PARTICIPANT_RESULT",
    MarketPeriod: "ET1",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [2000, 3000, 4000],
  };
  if (normalizeOddsUpdate(rawExtraTime) !== null) {
    throw new Error("Extra-time market should return null");
  }

  // Untyped named-price payload (missing SuperOddsType) must return null
  const rawUntypedNamed = {
    FixtureId: 123,
    Ts: 1790348501000,
    PriceNames: ["part1", "draw", "part2"],
    Prices: [1000, 2000, 3000],
  };
  if (normalizeOddsUpdate(rawUntypedNamed) !== null) {
    throw new Error("Untyped named-price payload must return null");
  }

  // Unrelated market without Ts returns null instead of throwing an exception
  const rawUnrelatedNoTs = {
    FixtureId: 123,
    SuperOddsType: "HANDICAP",
  };
  if (normalizeOddsUpdate(rawUnrelatedNoTs) !== null) {
    throw new Error("Unrelated market without timestamp should return null");
  }

  // 10. Missing, zero, negative, NaN, and infinite 1X2 prices are rejected
  expectThrow(
    () =>
      normalizeOddsUpdate({
        FixtureId: 123,
        Ts: 1790348501000,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        PriceNames: ["part1", "draw", "part2"],
        Prices: [2000, 3000], // Missing one required price value
      }),
    "prices"
  );

  expectThrow(
    () =>
      normalizeOddsUpdate({
        FixtureId: 123,
        Ts: 1790348501000,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        PriceNames: ["part1", "draw", "part2"],
        Prices: [0, 3000, 4000],
      }),
    "prices"
  );

  expectThrow(
    () =>
      normalizeOddsUpdate({
        FixtureId: 123,
        Ts: 1790348501000,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        PriceNames: ["part1", "draw", "part2"],
        Prices: [-100, 3000, 4000],
      }),
    "prices"
  );

  expectThrow(
    () =>
      normalizeOddsUpdate({
        FixtureId: 123,
        Ts: 1790348501000,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        PriceNames: ["part1", "draw", "part2"],
        Prices: [NaN, 3000, 4000],
      }),
    "prices"
  );

  expectThrow(
    () =>
      normalizeOddsUpdate({
        FixtureId: 123,
        Ts: 1790348501000,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        PriceNames: ["part1", "draw", "part2"],
        Prices: [Infinity, 3000, 4000],
      }),
    "prices"
  );

  logger.info("✓ Odds normalization & routing tests passed.");
}

function testLogRedaction() {
  logger.info("Running log redaction tests...");

  const testLogger = new Logger();
  let output = "";

  // Temporarily redirect console.log to inspect output
  const originalLog = console.log;
  console.log = (msg: string) => {
    output = msg;
  };

  try {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZXMiOltdfQ.signature";
    testLogger.info(`Connected with token: ${jwt}`);
    if (output.includes(jwt) || !output.includes("[REDACTED JWT]")) {
      throw new Error(
        `Failed to redact JWT from log string. Output: ${output}`
      );
    }

    const secretCtx = {
      token: "secret123",
      otherField: "public_value",
    };
    testLogger.info("Log with context object", secretCtx);
    if (output.includes("secret123") || !output.includes("[REDACTED]")) {
      throw new Error(`Failed to redact context secret. Output: ${output}`);
    }
  } finally {
    console.log = originalLog;
  }

  logger.info("✓ Log redaction tests passed.");
}

function testStateTransitions() {
  logger.info("Running state machine tests...");

  const fixtureId = 555;
  const market = marketManager.getOrCreateMarket(fixtureId);

  // Initial OPEN
  if ((market.state as string) !== "OPEN") {
    throw new Error(`Expected OPEN state, got ${market.state}`);
  }

  // Transition to HALTED
  marketManager.transitionTo(market, "HALTED", "TEST_HALT");
  if ((market.state as string) !== "HALTED" || !market.haltedAt) {
    throw new Error(`Expected HALTED state, got ${market.state}`);
  }

  // Idempotent transition check (should return false and not add new audit logs)
  const lenBefore = market.auditTrail.length;
  const result = marketManager.transitionTo(market, "HALTED", "TEST_HALT");
  if (result || market.auditTrail.length !== lenBefore) {
    throw new Error("Halt transition should be idempotent");
  }

  logger.info("✓ State machine tests passed.");
}

function testRiskAgentRacePaths() {
  logger.info("Running RiskAgent race path and verification binding tests...");

  // Reset/clean market
  const fixtureId = 999;
  const riskAgent = new RiskAgent();
  const market = marketManager.getOrCreateMarket(fixtureId);
  const m = market as any;
  m.state = "OPEN";
  m.scoreOne = 0;
  m.scoreTwo = 0;
  m.lastScoreSeq = 0;
  m.lastScoreTs = 0;
  m.oddsOne = 1500;
  m.oddsDraw = 3000;
  m.oddsTwo = 5000;

  // 1. Goal Event - Halts market
  const goalEvent = normalizeScoreEvent({
    fixtureId,
    seq: 10,
    ts: 100000,
    action: "goal",
    stats: { "1": 1, "2": 0 },
  });
  riskAgent.handleScoreEvent(goalEvent);

  if (m.state !== "HALTED") {
    throw new Error(`Expected state HALTED, got ${m.state}`);
  }
  if (
    m.pendingVerificationSeq !== 10 ||
    m.pendingVerificationType !== "GOAL"
  ) {
    throw new Error("Halt sequence and type not bound correctly");
  }

  // 2. Finding 6: Normal post-goal event (e.g. card) advances lastScoreSeq but does not break reopening
  const cardEvent = normalizeScoreEvent({
    fixtureId,
    seq: 11,
    ts: 102000,
    action: "yellow_card",
    stats: { "1": 1, "2": 0 },
  });
  riskAgent.handleScoreEvent(cardEvent);

  if (m.state !== "HALTED") {
    throw new Error("Market was unhalted prematurely by non-goal event");
  }
  if (m.lastScoreSeq !== 11) {
    throw new Error(
      `Expected lastScoreSeq to advance to 11, got ${m.lastScoreSeq}`
    );
  }

  // 3. Finding 5: Unrelated odds are ignored
  const extraOdds = normalizeOddsUpdate({
    fixtureId,
    seq: 12,
    ts: 105000,
    super_odds_type: "OVER_UNDER_GOALS",
    PriceNames: ["over", "under"],
    Prices: [1800, 2000],
  });
  if (extraOdds !== null) {
    riskAgent.handleOddsUpdate(extraOdds);
  }
  if (m.state !== "HALTED") {
    throw new Error("Market reopened by unrelated odds type");
  }

  // 4. Verify original goal proof success
  const goalProvedStats = [{ key: 1, value: 1, period: 0 }];
  riskAgent.registerVerificationSuccess(fixtureId, 10, goalProvedStats);

  if (m.state !== "PROOF_PENDING") {
    throw new Error(`Expected PROOF_PENDING state, got ${m.state}`);
  }

  // 5. Finding 5: Stale odds (Odds TS <= Goal TS) do not reopen
  const staleOdds = normalizeOddsUpdate({
    fixtureId,
    seq: 13,
    ts: 100000, // Equal to goal event TS
    super_odds_type: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [1400, 3200, 6000],
  })!;
  riskAgent.handleOddsUpdate(staleOdds);
  if (m.state !== "PROOF_PENDING") {
    throw new Error("Market reopened by stale odds");
  }

  // 6. Fresh odds (Odds TS > Goal TS) reopens market
  const freshOdds = normalizeOddsUpdate({
    fixtureId,
    seq: 14,
    ts: 106000,
    super_odds_type: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [1450, 3100, 5800],
  })!;
  riskAgent.handleOddsUpdate(freshOdds);
  if (m.state !== "OPEN") {
    throw new Error(`Expected market to reopen, got state: ${m.state}`);
  }

  // 7. Finalisation Event - Transitions to FINAL_PROOF_PENDING
  const finalEvent = normalizeScoreEvent({
    fixtureId,
    seq: 20,
    ts: 200000,
    action: "game_finalised",
    statusId: 100,
    period: 100,
    stats: { "1": 2, "2": 1 }, // Final Score 2-1
  });
  riskAgent.handleScoreEvent(finalEvent);

  if (m.state !== "FINAL_PROOF_PENDING") {
    throw new Error(`Expected FINAL_PROOF_PENDING, got ${m.state}`);
  }
  if (
    m.pendingVerificationSeq !== 20 ||
    m.pendingVerificationType !== "FINAL"
  ) {
    throw new Error("Finalisation sequence/type not bound correctly");
  }

  // 8. Finding 2: Delayed old goal proof (seq 10) completing after finalisation began does not settle the market
  riskAgent.registerVerificationSuccess(fixtureId, 10, goalProvedStats);
  if (m.state !== "FINAL_PROOF_PENDING") {
    throw new Error("Delayed old proof settled the final market");
  }

  // 9. Finding 3: Settle the market using proved goals (total goals 2-1), verifying winner calculation
  // Let's modify the raw stream scores to be tampered (e.g. 0-0) to prove it uses verified stats!
  m.scoreOne = 0;
  m.scoreTwo = 0;

  const finalProvedStats = [
    { key: 1, value: 2, period: 0 },
    { key: 2, value: 1, period: 0 },
  ];
  riskAgent.registerVerificationSuccess(fixtureId, 20, finalProvedStats);

  if (m.state !== "SETTLED") {
    throw new Error(`Expected SETTLED, got ${m.state}`);
  }
  if (m.settlementOutcome !== "PARTICIPANT_ONE_WIN") {
    throw new Error(
      `Expected PARTICIPANT_ONE_WIN winner, got ${m.settlementOutcome}`
    );
  }

  logger.info("✓ RiskAgent race path and verification binding tests passed.");
}

function testTask002ProofBindingAndReceipts() {
  logger.info("Running Task 002 proof binding & sanitized receipts tests...");

  // 1. One expected stat creates one single equality predicate with its expected value
  const strat1 = buildV2Strategy([{ key: 1, value: 3 }]);
  if (
    strat1.discretePredicates.length !== 1 ||
    strat1.discretePredicates[0].single.index !== 0 ||
    strat1.discretePredicates[0].single.predicate.threshold !== 3
  ) {
    throw new Error("Single stat strategy predicate construction failed");
  }

  // 2. Two final stats create two single equality predicates at indexes 0 and 1
  const strat2 = buildV2Strategy([
    { key: 1, value: 2 },
    { key: 2, value: 1 },
  ]);
  if (
    strat2.discretePredicates.length !== 2 ||
    strat2.discretePredicates[0].single.index !== 0 ||
    strat2.discretePredicates[0].single.predicate.threshold !== 2 ||
    strat2.discretePredicates[1].single.index !== 1 ||
    strat2.discretePredicates[1].single.predicate.threshold !== 1
  ) {
    throw new Error("Two-stat strategy predicate construction failed");
  }

  // 3. Wrong proof fixture ID is rejected
  const expStats: ExpectedStat[] = [{ key: 1, value: 1 }];
  const wrongFixtureResp = {
    summary: { fixtureId: 999, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 1, value: 1 }],
    statProofs: [[]],
  };
  const checkWrongId = validateProofIdentity(
    123,
    10,
    expStats,
    wrongFixtureResp
  );
  if (
    checkWrongId.valid ||
    !checkWrongId.reason?.includes("Fixture ID mismatch")
  ) {
    throw new Error("Failed to reject wrong fixture ID in proof response");
  }

  // 4. Missing, extra, reordered, duplicate, or wrong returned stat keys are rejected
  const wrongKeyResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 2, value: 1 }],
    statProofs: [[]],
  };
  const checkWrongKey = validateProofIdentity(123, 10, expStats, wrongKeyResp);
  if (
    checkWrongKey.valid ||
    !checkWrongKey.reason?.includes("Stat key mismatch")
  ) {
    throw new Error("Failed to reject wrong stat key in proof response");
  }

  // 5. Returned stat value different from triggering value is rejected
  const wrongValResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 1, value: 5 }],
    statProofs: [[]],
  };
  const checkWrongVal = validateProofIdentity(123, 10, expStats, wrongValResp);
  if (
    checkWrongVal.valid ||
    !checkWrongVal.reason?.includes("Stat value mismatch")
  ) {
    throw new Error("Failed to reject wrong stat value in proof response");
  }

  // 6. Missing corresponding stat proof is rejected
  const missingProofResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 1, value: 1 }],
    statProofs: [],
  };
  const checkMissingProof = validateProofIdentity(
    123,
    10,
    expStats,
    missingProofResp
  );
  if (
    checkMissingProof.valid ||
    !checkMissingProof.reason?.includes("Stat proof count mismatch")
  ) {
    throw new Error("Failed to reject missing stat proof in response");
  }

  // 7. Invalid expected values or keys fail before any external operation
  const invalidKeyPrecheck = validateExpectedStatsPrecheck([
    { key: -1, value: 1 },
  ]);
  if (invalidKeyPrecheck.valid)
    throw new Error("Should reject negative key in precheck");

  const invalidValPrecheck = validateExpectedStatsPrecheck([
    { key: 1, value: -2 },
  ]);
  if (invalidValPrecheck.valid)
    throw new Error("Should reject negative value in precheck");

  const dupKeyPrecheck = validateExpectedStatsPrecheck([
    { key: 1, value: 1 },
    { key: 1, value: 2 },
  ]);
  if (dupKeyPrecheck.valid)
    throw new Error("Should reject duplicate key in precheck");

  // 8. Simulated and confirmed receipt shapes are labeled distinctly, simulated receipt has no explorer link
  receiptStore.clear();
  receiptStore.addReceipt({
    id: "rcpt_sim_1",
    fixtureId: 123,
    seq: 1,
    expectedStats: [{ key: 1, value: 1 }],
    provedStats: [{ key: 1, value: 1, period: 0 }],
    proofTimestamp: 1000,
    programId: "Prog1",
    network: "devnet",
    status: "SIMULATED",
    mode: "SIMULATION",
    validatedAt: new Date().toISOString(),
  });

  receiptStore.addReceipt({
    id: "rcpt_conf_1",
    fixtureId: 123,
    seq: 2,
    expectedStats: [{ key: 1, value: 2 }],
    provedStats: [{ key: 1, value: 2, period: 0 }],
    proofTimestamp: 2000,
    programId: "Prog1",
    network: "devnet",
    status: "CONFIRMED",
    mode: "TRANSACTION",
    signature: "sig_abc_123",
    explorerUrl: "https://explorer.solana.com/tx/sig_abc_123?cluster=devnet",
    validatedAt: new Date().toISOString(),
  });

  const allReceipts = receiptStore.getReceipts();
  const simReceipt = allReceipts.find((r) => r.status === "SIMULATED");
  const confReceipt = allReceipts.find((r) => r.status === "CONFIRMED");

  if (!simReceipt || simReceipt.explorerUrl || simReceipt.signature) {
    throw new Error(
      "Simulated receipt must not have signature or explorer link"
    );
  }

  if (!confReceipt || !confReceipt.explorerUrl || !confReceipt.signature) {
    throw new Error("Confirmed receipt must have signature and explorer link");
  }

  // 9. Receipt history is bounded (max 50) and fixture filtering returns only matches
  receiptStore.clear();
  for (let i = 1; i <= 60; i++) {
    receiptStore.addReceipt({
      id: `rcpt_${i}`,
      fixtureId: i % 2 === 0 ? 200 : 300,
      seq: i,
      expectedStats: [{ key: 1, value: 1 }],
      provedStats: [{ key: 1, value: 1, period: 0 }],
      proofTimestamp: 1000,
      programId: "Prog1",
      network: "devnet",
      status: "SIMULATED",
      mode: "SIMULATION",
      validatedAt: new Date().toISOString(),
    });
  }

  const storeCount = receiptStore.getReceipts().length;
  if (storeCount !== 50) {
    throw new Error(`Expected receipt store max 50 items, got ${storeCount}`);
  }

  const filtered200 = receiptStore.getReceipts(200);
  if (filtered200.some((r) => r.fixtureId !== 200)) {
    throw new Error("Fixture filtering returned non-matching fixture IDs");
  }

  // 10. Receipt serialization contains no secrets or raw proof nodes
  const serialized = JSON.stringify(receiptStore.getReceipts());
  const forbiddenKeywords = [
    "jwt",
    "token",
    "secret",
    "walletPath",
    "subTreeProof",
    "mainTreeProof",
    "eventStatRoot",
  ];
  for (const keyword of forbiddenKeywords) {
    if (serialized.includes(`"${keyword}"`)) {
      throw new Error(
        `Receipt serialization contained forbidden keyword: ${keyword}`
      );
    }
  }

  logger.info("✓ Task 002 proof binding & sanitized receipts tests passed.");
}

function runAll() {
  logger.info("=== Starting Unit & Race Tests ===");
  testFixtureNormalization();
  testScoreNormalization();
  testOddsNormalization();
  testLogRedaction();
  testStateTransitions();
  testRiskAgentRacePaths();
  testTask002ProofBindingAndReceipts();
  logger.info("=== All Unit & Race Tests Passed Successfully ===");
}

runAll();
export {};
