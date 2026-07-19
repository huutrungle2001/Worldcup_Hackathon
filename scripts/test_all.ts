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

function testFixtureNormalization() {
  logger.info("Running fixture normalization tests...");

  // Test 1: Real-shape fixture with Participant1, Participant2, Competition, StartTime
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

  // Test 1b: Missing or invalid StartTime throws error
  try {
    normalizeFixture({ FixtureId: 123, Participant1: "A", Participant2: "B" });
    throw new Error("Should have rejected missing StartTime");
  } catch (err: any) {
    if (!err.message.includes("StartTime")) throw err;
  }

  logger.info("✓ Fixture normalization tests passed.");
}

function testScoreNormalization() {
  logger.info("Running score normalization tests...");

  // Test 2: Real-shape goal record with Stats["1"] = 1, Stats["2"] = 0, Participant = 1
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

  // Test 3: Lowercase / synthetic score aliases
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

  // Test 4: Missing or zero score sequence rejected
  try {
    normalizeScoreEvent({ FixtureId: 123, Seq: 0, Ts: 10000 });
    throw new Error("Should have rejected zero sequence");
  } catch (err: any) {
    if (!err.message.includes("sequence")) throw err;
  }

  // Test 5: Missing score timestamp rejected
  try {
    normalizeScoreEvent({ FixtureId: 123, Seq: 5 });
    throw new Error("Should have rejected missing timestamp");
  } catch (err: any) {
    if (!err.message.includes("timestamp")) throw err;
  }

  logger.info("✓ Score normalization tests passed.");
}

function testOddsNormalization() {
  logger.info("Running odds normalization & routing tests...");

  // Test 6: Actual-shape full-match 1X2 odds message
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

  // Test 7: Shuffled PriceNames still map correctly
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

  // Test 8: Handicap or over/under message is ignored (returns null)
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

  // Test 9: Extra-time or other non-full-match 1X2 message is ignored (returns null)
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

  // Test 10: Missing, zero, negative, or non-finite 1X2 prices are rejected
  try {
    normalizeOddsUpdate({
      FixtureId: 123,
      Ts: 1790348501000,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [0, 3000, 4000],
    });
    throw new Error("Should have rejected zero price");
  } catch (err: any) {
    if (!err.message.includes("prices")) throw err;
  }

  try {
    normalizeOddsUpdate({
      FixtureId: 123,
      Ts: 1790348501000,
      SuperOddsType: "1X2_PARTICIPANT_RESULT",
      PriceNames: ["part1", "draw", "part2"],
      Prices: [-100, 3000, 4000],
    });
    throw new Error("Should have rejected negative price");
  } catch (err: any) {
    if (!err.message.includes("prices")) throw err;
  }

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

  if ((market.state as string) !== "OPEN") {
    throw new Error(`Expected OPEN state, got ${market.state}`);
  }

  marketManager.transitionTo(market, "HALTED", "TEST_HALT");
  if ((market.state as string) !== "HALTED" || !market.haltedAt) {
    throw new Error(`Expected HALTED state, got ${market.state}`);
  }

  const lenBefore = market.auditTrail.length;
  const result = marketManager.transitionTo(market, "HALTED", "TEST_HALT");
  if (result || market.auditTrail.length !== lenBefore) {
    throw new Error("Halt transition should be idempotent");
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
  m.lastScoreTs = 0;
  m.oddsOne = 1500;
  m.oddsDraw = 3000;
  m.oddsTwo = 5000;

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
  if (m.pendingVerificationSeq !== 10 || m.pendingVerificationType !== "GOAL") {
    throw new Error("Halt sequence and type not bound correctly");
  }

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

  const goalProvedStats = [{ key: 1, value: 1, period: 0 }];
  riskAgent.registerVerificationSuccess(fixtureId, 10, goalProvedStats);

  if (m.state !== "PROOF_PENDING") {
    throw new Error(`Expected PROOF_PENDING state, got ${m.state}`);
  }

  const staleOdds = normalizeOddsUpdate({
    fixtureId,
    seq: 13,
    ts: 100000,
    super_odds_type: "1X2_PARTICIPANT_RESULT",
    PriceNames: ["part1", "draw", "part2"],
    Prices: [1400, 3200, 6000],
  })!;
  riskAgent.handleOddsUpdate(staleOdds);
  if (m.state !== "PROOF_PENDING") {
    throw new Error("Market reopened by stale odds");
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
  if (
    m.pendingVerificationSeq !== 20 ||
    m.pendingVerificationType !== "FINAL"
  ) {
    throw new Error("Finalisation sequence/type not bound correctly");
  }

  riskAgent.registerVerificationSuccess(fixtureId, 10, goalProvedStats);
  if (m.state !== "FINAL_PROOF_PENDING") {
    throw new Error("Delayed old proof settled the final market");
  }

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

function runAll() {
  logger.info("=== Starting Unit & Race Tests ===");
  testFixtureNormalization();
  testScoreNormalization();
  testOddsNormalization();
  testLogRedaction();
  testStateTransitions();
  testRiskAgentRacePaths();
  logger.info("=== All Unit & Race Tests Passed Successfully ===");
}

runAll();
export {};
