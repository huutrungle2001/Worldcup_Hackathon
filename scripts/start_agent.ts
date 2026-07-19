import { startServer } from "../src/server";
import { txLineStream } from "../src/txline/stream";
import { riskAgent } from "../src/agent/risk";
import { normalizeScoreEvent, normalizeOddsUpdate } from "../src/domain/types";
import { logger } from "../src/utils/logger";

async function main() {
  logger.info("=== Starting ProofGuard Risk Agent ===");

  const shutdown = () => {
    logger.info("Shutdown signal received. Gracefully closing streams...");
    txLineStream.disconnectAll();
    logger.info("✓ Streams closed. Exit.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception detected:", err);
    shutdown();
  });

  startServer();

  logger.info("Connecting to TxLINE SSE streams...");

  txLineStream.connectStream("scores", (event, data) => {
    try {
      if (data && (data.FixtureId || data.fixtureId)) {
        const normalized = normalizeScoreEvent(data);
        riskAgent.handleScoreEvent(normalized);
      }
    } catch (err: any) {
      logger.error("Error processing scores stream event:", err, {
        event,
        data,
      });
    }
  });

  txLineStream.connectStream("odds", (event, data) => {
    try {
      if (data && (data.FixtureId || data.fixtureId)) {
        const normalized = normalizeOddsUpdate(data);
        if (normalized) {
          riskAgent.handleOddsUpdate(normalized);
        }
      }
    } catch (err: any) {
      logger.error("Error processing odds stream event:", err, { event, data });
    }
  });

  logger.info("ProofGuard Risk Agent fully started. Press Ctrl+C to stop.");
}

main();
