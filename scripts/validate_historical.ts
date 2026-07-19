import { txLineClient } from "../src/txline/api";
import { solanaValidator, ExpectedStat } from "../src/solana/validation";
import { logger } from "../src/utils/logger";

function extractStat1Value(record: any): number | null {
  if (!record || typeof record !== "object") return null;
  const raw = record.Stats?.["1"] ?? record.scoreOne ?? record.ScoreOne;
  if (raw !== undefined && raw !== null && typeof raw === "number" && Number.isFinite(raw) && raw >= 0) {
    return raw;
  }
  return null;
}

async function run() {
  logger.info("Starting dynamic historical validation check on devnet...");

  let targetFixtureId = 0;
  let targetSeq = 0;
  let targetScoreValue: number | null = null;

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
        const record = updates.find((r) => {
          const s = r.Seq ?? r.seq;
          const stat1 = extractStat1Value(r);
          return Number.isInteger(s) && s > 0 && stat1 !== null;
        });

        if (record) {
          targetFixtureId = record.FixtureId ?? record.fixtureId;
          targetSeq = record.Seq ?? record.seq;
          targetScoreValue = extractStat1Value(record);
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
          const record = snapshot.scoreRecords.find((r: any) => {
            const s = r.seq ?? r.Seq;
            const stat1 = extractStat1Value(r);
            return Number.isInteger(s) && s > 0 && stat1 !== null;
          });
          if (record) {
            targetFixtureId = f.fixtureId;
            targetSeq = record.seq ?? record.Seq;
            targetScoreValue = extractStat1Value(record);
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

  if (targetFixtureId === 0 || targetSeq === 0 || targetScoreValue === null) {
    logger.error(
      "No active score record with a valid finite, non-negative stat key 1 value found on devnet. Exiting historical validation check."
    );
    process.exit(1);
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
