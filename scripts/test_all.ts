import { normalizeScoreEvent, normalizeOddsUpdate } from "../src/domain/types";
import { Logger } from "../src/utils/logger";
import { marketManager } from "../src/agent/market";
import { logger } from "../src/utils/logger";

function testNormalization() {
  logger.info("Running normalization tests...");

  // 1. Lowercase/Uppercase property mapping
  const scoreRaw1 = { FixtureId: 101, Seq: 5, Action: "Goal", ScoreOne: 1, ScoreTwo: 0 };
  const scoreRaw2 = { fixtureId: 101, seq: 5, action: "Goal", scoreOne: 1, scoreTwo: 0 };
  
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
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzY29wZXMiOltdfQ.signature";
    testLogger.info(`Connected with token: ${jwt}`);
    if (output.includes(jwt) || !output.includes("[REDACTED JWT]")) {
      throw new Error(`Failed to redact JWT from log string. Output: ${output}`);
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

function runAll() {
  logger.info("=== Starting Unit Tests ===");
  testNormalization();
  testLogRedaction();
  testStateTransitions();
  logger.info("=== All Unit Tests Passed Successfully ===");
}

runAll();
export {};
