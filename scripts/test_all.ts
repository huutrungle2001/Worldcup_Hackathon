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
  validateProofRequestParams,
  receiptStore,
  ExpectedStat,
  sanitizeReasonString,
  SolanaValidator,
} from "../src/solana/validation";
import { appConfig } from "../src/config";

/**
 * Robust assertion helper for functions expected to throw an error.
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

  expectThrow(
    () =>
      normalizeFixture({ FixtureId: 123, Participant1: "A", Participant2: "B" }),
    "StartTime"
  );

  logger.info("✓ Fixture normalization tests passed.");
}

function testScoreNormalization() {
  logger.info("Running score normalization tests...");

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

  expectThrow(
    () => normalizeScoreEvent({ FixtureId: 123, Ts: 10000 }),
    "sequence"
  );
  expectThrow(
    () => normalizeScoreEvent({ FixtureId: 123, Seq: 0, Ts: 10000 }),
    "sequence"
  );

  expectThrow(
    () => normalizeScoreEvent({ FixtureId: 123, Seq: 5 }),
    "timestamp"
  );

  logger.info("✓ Score normalization tests passed.");
}

function testOddsNormalization() {
  logger.info("Running odds normalization & routing tests...");

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
    throw new Error("Shuffled price routing failed");
  }

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

  expectThrow(
    () =>
      normalizeOddsUpdate({
        FixtureId: 123,
        Ts: 1790348501000,
        SuperOddsType: "1X2_PARTICIPANT_RESULT",
        PriceNames: ["part1", "draw", "part2"],
        Prices: [2000, 3000],
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

function testTask002FullTenRequirementsAndRegressions() {
  logger.info("Running Task 002 full requirements and closure regressions...");

  // 1. One expected stat creates one single equality predicate with expected value
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
  if (validateProofIdentity(123, 10, expStats, wrongFixtureResp).valid) {
    throw new Error("Failed to reject wrong fixture ID in proof response");
  }

  // 4. Missing, extra, reordered, duplicate, or wrong returned stat keys are rejected
  const wrongKeyResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 2, value: 1 }],
    statProofs: [[]],
  };
  if (validateProofIdentity(123, 10, expStats, wrongKeyResp).valid) {
    throw new Error("Failed to reject wrong stat key in proof response");
  }

  // 5. Returned stat value different from triggering value is rejected
  const wrongValResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 1, value: 5 }],
    statProofs: [[]],
  };
  if (validateProofIdentity(123, 10, expStats, wrongValResp).valid) {
    throw new Error("Failed to reject wrong stat value in proof response");
  }

  // 6. Missing or empty corresponding stat proof is rejected
  const missingProofResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [{ key: 1, value: 1 }],
    statProofs: [],
  };
  if (validateProofIdentity(123, 10, expStats, missingProofResp).valid) {
    throw new Error("Failed to reject missing stat proof in response");
  }

  // 7. Invalid expected values or keys fail before any external operation
  if (validateExpectedStatsPrecheck([{ key: -1, value: 1 }]).valid) {
    throw new Error("Should reject negative key in precheck");
  }
  if (validateExpectedStatsPrecheck([{ key: 3001, value: 1 }]).valid) {
    throw new Error("Should reject key 3001 in precheck");
  }
  if (validateProofRequestParams(-1, 10, [{ key: 1, value: 1 }]).valid) {
    throw new Error("Should reject negative fixtureId in request params check");
  }

  // 8. Simulated and confirmed receipt shapes are labeled distinctly, simulated receipt has no explorer link
  receiptStore.clear();
  receiptStore.addReceipt({
    id: "rcpt_sim_1",
    fixtureId: 123,
    seq: 1,
    expectedStats: [{ key: 1, value: 1 }],
    provedStats: [{ key: 1, value: 1, period: 0 }],
    proofTimestamp: 1000,
    programId: appConfig.programId.toBase58(),
    network: appConfig.network,
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
    programId: appConfig.programId.toBase58(),
    network: appConfig.network,
    status: "CONFIRMED",
    mode: "TRANSACTION",
    signature: "sig_abc_123",
    validatedAt: new Date().toISOString(),
  });

  const allReceipts = receiptStore.getReceipts();
  const simReceipt = allReceipts.find((r) => r.status === "SIMULATED");
  const confReceipt = allReceipts.find((r) => r.status === "CONFIRMED");

  if (!simReceipt || simReceipt.explorerUrl || simReceipt.signature) {
    throw new Error("Simulated receipt must not have signature or explorer link");
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
      programId: appConfig.programId.toBase58(),
      network: appConfig.network,
      status: "SIMULATED",
      mode: "SIMULATION",
      validatedAt: new Date().toISOString(),
    });
  }

  if (receiptStore.getReceipts().length !== 50) {
    throw new Error(`Receipt store max 50 violated: got ${receiptStore.getReceipts().length}`);
  }
  if (receiptStore.getReceipts(200).some((r) => r.fixtureId !== 200)) {
    throw new Error("Fixture filtering returned non-matching fixture IDs");
  }

  // 10. Receipt serialization contains no secrets or raw proof nodes
  const serialized = JSON.stringify(receiptStore.getReceipts());
  const forbiddenKeywords = ["jwt", "token", "secret", "walletPath", "subTreeProof", "mainTreeProof", "eventStatRoot"];
  for (const keyword of forbiddenKeywords) {
    if (serialized.includes(`"${keyword}"`)) {
      throw new Error(`Receipt serialization contained forbidden keyword: ${keyword}`);
    }
  }

  // --- CLOSURE PROBES ---

  // Closure Probe 1: Missing pending expected-stat array skips verification and fails closed
  const riskAgent = new RiskAgent();
  const fId = 888;
  const market = marketManager.getOrCreateMarket(fId);
  const m = market as any;
  m.state = "FINAL_PROOF_PENDING";
  m.pendingVerificationSeq = 9;
  m.pendingVerificationType = "FINAL";
  m.pendingVerificationExpectedStats = undefined; // Missing expected stats array

  riskAgent.registerVerificationSuccess(fId, 9, [
    { key: 1, value: 2, period: 0 },
    { key: 2, value: 1, period: 0 },
  ]);

  if (m.state !== "FINAL_PROOF_PENDING") {
    throw new Error("Closure Probe 1 failed: missing pending expectation bypassed proof binding!");
  }

  // Closure Probe 2: Closed reason allowlist strips unknown credentials
  const sanitizedCredential = sanitizeReasonString("Authorization: [REDACTED] AUTH_SENTINEL SENTINEL_SECRET") ?? "";
  if (sanitizedCredential.includes("AUTH_SENTINEL") || sanitizedCredential.includes("SENTINEL_SECRET")) {
    throw new Error(`Closure Probe 2 failed: arbitrary secret survived in reason string: ${sanitizedCredential}`);
  }
  if (sanitizedCredential !== "Proof validation failed") {
    throw new Error(`Closure Probe 2 failed: expected "Proof validation failed", got "${sanitizedCredential}"`);
  }

  // Closure Probe 3: Malformed rejected proof with statsToProve: [null]
  receiptStore.clear();
  const validator = new SolanaValidator();
  const malformedResp = {
    summary: { fixtureId: 123, updateStats: { minTimestamp: 1000 } },
    statsToProve: [null], // Malformed array containing null
    statProofs: [[]],
  };
  const identityResult = validateProofIdentity(123, 10, [{ key: 1, value: 1 }], malformedResp);
  if (identityResult.valid) {
    throw new Error("Closure Probe 3 failed: expected identity check to fail for malformed statsToProve");
  }

  // Closure Probe 4: Strict stat scalar types in store boundary
  receiptStore.clear();
  receiptStore.addReceipt({
    id: "rcpt_coercion_test",
    fixtureId: 100,
    seq: 1,
    expectedStats: [{ key: "1", value: false }], // Coercible string key and boolean value
    status: "SIMULATED",
    mode: "SIMULATION",
  });
  if (receiptStore.getReceipts().length !== 0) {
    throw new Error("Closure Probe 4 failed: receipt store allowed coercible non-numeric stat scalar types!");
  }

  logger.info("✓ Task 002 full requirements and closure regressions passed.");
}

function runAll() {
  logger.info("=== Starting Unit & Race Tests ===");
  testFixtureNormalization();
  testScoreNormalization();
  testOddsNormalization();
  testLogRedaction();
  testStateTransitions();
  testRiskAgentRacePaths();
  testTask002FullTenRequirementsAndRegressions();
  logger.info("=== All Unit & Race Tests Passed Successfully ===");
}

runAll();
export {};
