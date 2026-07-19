import { txLineStream } from "../src/txline/stream";
import { txLineClient } from "../src/txline/api";
import { logger } from "../src/utils/logger";

async function run() {
  logger.info("Starting stream test...");

  try {
    const fixtures = await txLineClient.getFixtures();
    console.log(`\nActive Fixtures (Total: ${fixtures.length}):`);
    fixtures.slice(0, 5).forEach((f: any) => {
      console.log(`- ID: ${f.fixtureId} | Match: ${f.participantOneName} vs ${f.participantTwoName} | Phase: ${f.gameStateName}`);
    });
    console.log();
  } catch (err: any) {
    logger.error("Failed to fetch fixtures:", err);
  }

  txLineStream.connectStream("scores", (event, data) => {
    logger.info(`[SCORES STREAM EVENT] Event: ${event}`, { data });
  });

  txLineStream.connectStream("odds", (event, data) => {
    logger.info(`[ODDS STREAM EVENT] Event: ${event}`, { data });
  });

  logger.info("Streams connected. Running for 15 seconds...");
  setTimeout(() => {
    logger.info("15 seconds elapsed. Stopping streams...");
    txLineStream.disconnectAll();
    logger.info("✓ Streams stopped. Test complete.");
    process.exit(0);
  }, 15000);
}

run();
