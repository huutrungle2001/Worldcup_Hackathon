import { riskAgent } from "../src/agent/risk";
import { marketManager } from "../src/agent/market";
import { normalizeScoreEvent, normalizeOddsUpdate } from "../src/domain/types";
import { logger } from "../src/utils/logger";
import { healthMonitor } from "../src/utils/health";

async function runTest() {
  process.env.TEST_MODE = "true";
  logger.info("=== Starting Risk Agent State Machine Test ===");

  const fixtureId = 9999;
  healthMonitor.updateService("oddsSse", "HEALTHY");

  // Get virtual market
  const market = marketManager.getOrCreateMarket(fixtureId);
  logger.info(`Initial state: ${market.state}`);

  // 1. Send first odds update
  logger.info("\n--- Step 1: Sending initial odds update (TS: 1000) ---");
  riskAgent.handleOddsUpdate(
    normalizeOddsUpdate({
      fixtureId,
      seq: 1,
      ts: 1000,
      oddsOne: 1500,
      oddsDraw: 3500,
      oddsTwo: 5000,
    })!
  );
  logger.info(
    `Current state: ${market.state} | Odds: ${market.oddsOne}-${market.oddsDraw}-${market.oddsTwo}`
  );

  // 2. Send score event (Goal!)
  logger.info("\n--- Step 2: Goal detected! (Score TS: 1100, Score 1-0) ---");
  riskAgent.handleScoreEvent(
    normalizeScoreEvent({
      fixtureId,
      seq: 2,
      ts: 1100,
      action: "goal",
      scoreOne: 1,
      scoreTwo: 0,
      gameState: 2,
    })
  );
  logger.info(
    `Current state: ${market.state} | Score: ${market.scoreOne}-${market.scoreTwo}`
  );

  // 3. Send stale odds update (TS: 1050)
  logger.info(
    "\n--- Step 3: Sending stale odds update (TS: 1050 <= Goal TS: 1100) ---"
  );
  riskAgent.handleOddsUpdate(
    normalizeOddsUpdate({
      fixtureId,
      seq: 2,
      ts: 1050,
      oddsOne: 1200,
      oddsDraw: 4000,
      oddsTwo: 7000,
    })!
  );
  logger.info(`Current state: ${market.state} (Expected: HALTED)`);

  // 4. Wait for simulated proof to succeed (timeout is 4 seconds)
  logger.info(
    "\nWaiting 5 seconds for simulated on-chain proof to validate..."
  );
  await new Promise((resolve) => setTimeout(resolve, 5000));
  logger.info(
    `Current state after waiting: ${market.state} (Expected: PROOF_PENDING since odds are still stale)`
  );

  // 5. Send fresh odds update (TS: 1200)
  logger.info(
    "\n--- Step 4: Sending fresh odds update (TS: 1200 > Goal TS: 1100) ---"
  );
  riskAgent.handleOddsUpdate(
    normalizeOddsUpdate({
      fixtureId,
      seq: 3,
      ts: 1200,
      oddsOne: 1250,
      oddsDraw: 4100,
      oddsTwo: 7200,
    })!
  );
  logger.info(`Current state: ${market.state} (Expected: OPEN)`);

  // 6. Send game finalised
  logger.info(
    "\n--- Step 5: Sending game finalisation (Score TS: 6000, Score 1-0) ---"
  );
  riskAgent.handleScoreEvent(
    normalizeScoreEvent({
      fixtureId,
      seq: 4,
      ts: 6000,
      action: "game_finalised",
      scoreOne: 1,
      scoreTwo: 0,
      statusId: 100,
      period: 100,
    })
  );
  logger.info(`Current state: ${market.state} (Expected: FINAL_PROOF_PENDING)`);

  // 7. Wait for finalisation proof success
  logger.info("\nWaiting 5 seconds for final on-chain proof validation...");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  logger.info(
    `Current state: ${market.state} (Expected: SETTLED) | Outcome: ${market.settlementOutcome}`
  );

  logger.info("\n=== Risk Agent State Machine Test Finished ===");
}

runTest();
