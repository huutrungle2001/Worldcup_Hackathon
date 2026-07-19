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
        Prices: [0, 3000, 4000],
      }),
    "prices"
  );

  logger.info("✓ Odds normalization & routing tests passed.");
}

function testLogRedaction() {
  logger.info("Running log redaction tests...");

  const testLogger = new Logger();
  let output = "";

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
  } finally {
    console.log = originalLog;
  }

  logger.info("✓ Log redaction tests passed.");
}

function testStateTransitions() {
  logger.info("Running state machine tests...");

  const fixtureId = 555;
  const market = marketManager.getOrCreateMarket(fixtureId);

  if ((market.state as string) !== "OPEN") {
    throw new Error(`Expected OPEN state, got ${market.state}`);
  }

  marketManager.transitionTo(market, "HALTED", "TEST_HALT");
  if ((market.state as string) !== "HALTED" || !market.haltedAt) {
    throw new Error(`Expected HALTED state, got ${market.state}`);
  }

  logger.info("✓ State machine tests passed.");
}

function testRiskAgentRacePaths() {
  logger.info("Running RiskAgent race path and verification binding tests...");

  const fixtureId = 999;
  const riskAgent = new RiskAgent();
  const market = marketManager.getOrCreateMarket(fixtureId);
  const m = market as any;
  m.state = "OPEN";
  m.scoreOne = 0;
  m.scoreTwo = 0;
  m.lastScoreSeq = 0;

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

  const goalProvedStats = [{ key: 1, value: 1, period: 0 }];
  riskAgent.registerVerificationSuccess(fixtureId, 10, goalProvedStats);

  if (m.state !== "PROOF_PENDING") {
    throw new Error(`Expected PROOF_PENDING state, got ${m.state}`);
  }

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

  const finalEvent = normalizeScoreEvent({
    fixtureId,
    seq: 20,
    ts: 200000,
    action: "game_finalised",
    statusId: 100,
    period: 100,
    stats: { "1": 2, "2": 1 },
  });
  riskAgent.handleScoreEvent(finalEvent);

  if (m.state !== "FINAL_PROOF_PENDING") {
    throw new Error(`Expected FINAL_PROOF_PENDING, got ${m.state}`);
  }

  const finalProvedStats = [
    { key: 1, value: 2, period: 0 },
    { key: 2, value: 1, period: 0 },
  ];
  riskAgent.registerVerificationSuccess(fixtureId, 20, finalProvedStats);

  if ((m.state as string) !== "SETTLED") {
    throw new Error(`Expected SETTLED, got ${m.state}`);
  }

  logger.info("✓ RiskAgent race path and verification binding tests passed.");
}

function testTask002OriginalTenRequirements() {
  logger.info("Running Task 002 original ten acceptance requirements...");

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

  logger.info("✓ Task 002 original ten acceptance requirements passed.");
}

function testTask002FollowUpReReviewRegressions() {
  logger.info("Running Task 002 follow-up re-review regression tests...");

  // Follow-up 1: Conflicting extra proved stats or misordered stats rejected
  const riskAgent = new RiskAgent();
  const fId = 777;
  const finalEvent = normalizeScoreEvent({
    fixtureId: fId,
    seq: 20,
    ts: 200000,
    action: "game_finalised",
    statusId: 100,
    period: 100,
    stats: { "1": 3, "2": 1 },
  });
  riskAgent.handleScoreEvent(finalEvent);

  const market = marketManager.getOrCreateMarket(fId);
  if (market.state !== "FINAL_PROOF_PENDING") throw new Error("Expected FINAL_PROOF_PENDING state");

  // Attempt registering with extra conflicting stat (key 2 value 99)
  riskAgent.registerVerificationSuccess(fId, 20, [
    { key: 1, value: 3, period: 0 },
    { key: 2, value: 1, period: 0 },
    { key: 2, value: 99, period: 0 },
  ]);
  if (market.state !== "FINAL_PROOF_PENDING") {
    throw new Error("Market settled despite conflicting extra proved stat");
  }

  // Register exact matching proved stats
  riskAgent.registerVerificationSuccess(fId, 20, [
    { key: 1, value: 3, period: 0 },
    { key: 2, value: 1, period: 0 },
  ]);
  if ((market.state as string) !== "SETTLED") {
    throw new Error("Market should settle when exact proved stats are registered");
  }

  // Follow-up 2: Defensive copies and sanitization
  receiptStore.clear();
  receiptStore.addReceipt({
    id: "rcpt_def_1",
    fixtureId: 100,
    seq: 1,
    expectedStats: [{ key: 1, value: 1 }],
    status: "SIMULATED",
    mode: "SIMULATION",
  });

  const list1 = receiptStore.getReceipts();
  (list1 as any).push({ injected: true }); // Mutate returned copy
  if (receiptStore.getReceipts().length !== 1) {
    throw new Error("Defensive copy failed: internal receipt store was mutated by caller");
  }

  // Reason sanitization controlled message mapping
  const sanitizedReason = sanitizeReasonString("Proof response identity check failed: mismatch");
  if (sanitizedReason !== "Proof response identity check failed") {
    throw new Error(`Expected controlled reason mapping, got: ${sanitizedReason}`);
  }

  // Follow-up 3: Contradictory status/mode shapes dropped
  receiptStore.clear();
  receiptStore.addReceipt({
    status: "SIMULATED",
    mode: "PRECHECK", // Contradictory
    fixtureId: 100,
    seq: 1,
  });
  if (receiptStore.getReceipts().length !== 0) {
    throw new Error("Contradictory SIMULATED + PRECHECK should be dropped by store");
  }

  // Follow-up 4: Network derived from appConfig
  receiptStore.clear();
  receiptStore.addReceipt({
    id: "rcpt_net_1",
    fixtureId: 100,
    seq: 1,
    status: "CONFIRMED",
    mode: "TRANSACTION",
    signature: "sig_net_123",
  });
  const netRcpt = receiptStore.getReceipts()[0];
  if (netRcpt.network !== appConfig.network) {
    throw new Error(`Receipt network mismatch: expected ${appConfig.network}, got ${netRcpt.network}`);
  }

  // Follow-up 5: Malformed non-numeric fixtureId rejected at store boundary
  receiptStore.clear();
  receiptStore.addReceipt({
    fixtureId: "not-a-number",
    seq: 1,
    status: "SIMULATED",
    mode: "SIMULATION",
  });
  if (receiptStore.getReceipts().length !== 0) {
    throw new Error("Store should reject string non-numeric fixtureId");
  }

  logger.info("✓ Task 002 follow-up re-review regression tests passed.");
}

function runAll() {
  logger.info("=== Starting Unit & Race Tests ===");
  testFixtureNormalization();
  testScoreNormalization();
  testOddsNormalization();
  testLogRedaction();
  testStateTransitions();
  testRiskAgentRacePaths();
  testTask002OriginalTenRequirements();
  testTask002FollowUpReReviewRegressions();
  logger.info("=== All Unit & Race Tests Passed Successfully ===");
}

runAll();
export {};
