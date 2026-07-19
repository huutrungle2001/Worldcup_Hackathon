process.env.TEST_MODE = "true";

import { normalizeScoreEvent, normalizeOddsUpdate } from "../src/domain/types";
import { Logger } from "../src/utils/logger";
import { marketManager } from "../src/agent/market";
import { RiskAgent } from "../src/agent/risk";
import { logger } from "../src/utils/logger";

function testNormalization() {
  logger.info("Running normalization tests...");

  // 1. Lowercase/Uppercase property mapping
  const scoreRaw1 = {
    FixtureId: 101,
    Seq: 5,
    Action: "Goal",
    Stats: { "1": 1, "2": 0 },
  };
  const scoreRaw2 = {
    fixtureId: 101,
    seq: 5,
    action: "Goal",
    stats: { "1": 1, "2": 0 },
  };

  const norm1 = normalizeScoreEvent(scoreRaw1);
  const norm2 = normalizeScoreEvent(scoreRaw2);

  if (norm1.fixtureId !== 101 || norm1.seq !== 5 || norm1.scoreOne !== 1) {
    throw new Error("Failed to normalize uppercase score keys");
  }
  if (norm2.fixtureId !== 101 || norm2.seq !== 5 || norm2.scoreOne !== 1) {
    throw new Error("Failed to normalize lowercase score keys");
  }

  // 2. Invalid sequences
  try {
    normalizeScoreEvent({ fixtureId: 101, seq: 0 });
    throw new Error("Should have rejected zero sequence");
  } catch (err: any) {
    if (!err.message.includes("sequence")) {
      throw err;
    }
  }

  // 3. Stable deduplication key
  if (norm1.eventKey !== "101:5:Goal") {
    throw new Error(`Deduplication key mismatch: ${norm1.eventKey}`);
  }

  logger.info("✓ Normalization tests passed.");
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
  if (m.pendingVerificationSeq !== 10 || m.pendingVerificationType !== "GOAL") {
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
  riskAgent.handleOddsUpdate(extraOdds);
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
  });
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
  });
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

function runAll() {
  logger.info("=== Starting Unit & Race Tests ===");
  testNormalization();
  testLogRedaction();
  testStateTransitions();
  testRiskAgentRacePaths();
  logger.info("=== All Unit & Race Tests Passed Successfully ===");
}

runAll();
export {};
