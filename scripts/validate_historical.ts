import { txLineClient } from "../src/txline/api";
import { solanaValidator, ExpectedStat } from "../src/solana/validation";
import { logger } from "../src/utils/logger";

async function run() {
  logger.info("Starting dynamic historical validation check on devnet...");

  let targetFixtureId = 0;
  let targetSeq = 0;
  let targetScoreValue = 0;

  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const checkTime = new Date(now.getTime() - i * 3600 * 1000);
    const epochDay = Math.floor(checkTime.getTime() / 86400000);
    const hourOfDay = checkTime.getUTCHours();
    const interval = Math.floor(checkTime.getUTCMinutes() / 5);

    try {
      logger.info(
        `Checking updates for EpochDay: ${epochDay}, Hour: ${hourOfDay}, Interval: ${interval}...`
      );
      const updates = await txLineClient.request<any[]>({
        url: `/scores/updates/${epochDay}/${hourOfDay}/${interval}`,
      });

      if (updates && updates.length > 0) {
        const record = updates.find((r) => (r.Seq ?? r.seq) > 0);
        if (record) {
          targetFixtureId = record.FixtureId ?? record.fixtureId;
          targetSeq = record.Seq ?? record.seq;
          targetScoreValue = Number(
            record.Stats?.["1"] ?? record.scoreOne ?? record.ScoreOne ?? 0
          );
          logger.info(
            `✓ Found active update! Fixture: ${targetFixtureId}, Seq: ${targetSeq}, ScoreVal: ${targetScoreValue}`
          );
          break;
        }
      }
    } catch (err) {
      // Keep checking
    }
  }

  if (targetFixtureId === 0) {
    logger.warn(
      "No recent score updates found. Checking active fixtures snapshots..."
    );
    try {
      const fixtures = await txLineClient.getFixtures();
      for (const f of fixtures) {
        const snapshot = await txLineClient.getScoresSnapshot(f.fixtureId);
        if (
          snapshot &&
          snapshot.scoreRecords &&
          snapshot.scoreRecords.length > 0
        ) {
          const record = snapshot.scoreRecords.find((r: any) => r.seq > 0);
          if (record) {
            targetFixtureId = f.fixtureId;
            targetSeq = record.seq;
            targetScoreValue = Number(
              record.Stats?.["1"] ?? record.scoreOne ?? record.ScoreOne ?? 0
            );
            logger.info(
              `✓ Found score record in snapshot! Fixture: ${targetFixtureId}, Seq: ${targetSeq}, ScoreVal: ${targetScoreValue}`
            );
            break;
          }
        }
      }
    } catch (err: any) {
      logger.error("Failed to fetch snapshots:", err);
    }
  }

  if (targetFixtureId === 0) {
    targetFixtureId = 18175981;
    targetSeq = 991;
    targetScoreValue = 0;
    logger.info(
      `No live fixtures found. Using fallback historical fixture: ${targetFixtureId}, Seq: ${targetSeq}`
    );
  }

  const expectedStats: ExpectedStat[] = [
    { key: 1, value: targetScoreValue },
  ];

  try {
    logger.info(`Running Merkle proof validation on Solana devnet...`);
    const result = await solanaValidator.validateProofOnChain(
      targetFixtureId,
      targetSeq,
      expectedStats,
      true
    );
    if (result.success) {
      logger.info(
        `✓ Verification process complete! Signature: ${result.signature || "SIMULATED"}`
      );
    } else {
      logger.error("Verification process returned false.");
    }
  } catch (err: any) {
    logger.error("Verification process failed:", err);
  }
}

run();
