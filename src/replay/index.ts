import { txLineClient } from "../txline/api";
import { riskAgent } from "../agent/risk";
import { normalizeScoreEvent, normalizeOddsUpdate } from "../domain/types";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";

export class ReplayEngine {
  private activeFixtureId: number | null = null;
  private isPaused = false;
  private speedMultiplier = 1;
  private timeoutId: NodeJS.Timeout | null = null;
  private currentStep = 0;
  private historicalRecords: any[] = [];
  private lastScoreOne = 0;
  private lastScoreTwo = 0;

  public async startReplay(fixtureId: number, speed = 1) {
    this.stopReplay();

    this.activeFixtureId = fixtureId;
    this.speedMultiplier = speed;
    this.isPaused = false;
    this.currentStep = 0;
    this.lastScoreOne = 0;
    this.lastScoreTwo = 0;
    healthMonitor.setReplayMode(true);

    logger.info(
      `Starting historical replay for fixture ${fixtureId} with speed ${speed}x...`
    );

    try {
      logger.info(
        `Fetching historical score records for fixture ${fixtureId}...`
      );
      const response = await txLineClient.request<any[]>({
        url: `/scores/historical/${fixtureId}`,
      });

      if (!response || response.length === 0) {
        logger.error(
          `No historical score records found for fixture ${fixtureId}`
        );
        healthMonitor.setReplayMode(false);
        return;
      }

      this.historicalRecords = response.sort((a, b) => {
        const seqA = a.Seq ?? a.seq ?? 0;
        const seqB = b.Seq ?? b.seq ?? 0;
        return seqA - seqB;
      });

      logger.info(
        `✓ Loaded ${this.historicalRecords.length} historical updates for replay.`
      );
      this.executeNextStep();
    } catch (err: any) {
      logger.error(`Failed to fetch historical replay data:`, err);
      healthMonitor.setReplayMode(false);
    }
  }

  private executeNextStep() {
    if (this.isPaused || this.currentStep >= this.historicalRecords.length) {
      if (this.currentStep >= this.historicalRecords.length) {
        logger.info("Replay completed successfully!");
        healthMonitor.setReplayMode(false);
      }
      return;
    }

    const currentRecord = this.historicalRecords[this.currentStep];
    logger.info(
      `Replaying step ${this.currentStep + 1}/${
        this.historicalRecords.length
      } | Seq: ${currentRecord.Seq ?? currentRecord.seq}`
    );

    try {
      const normalizedScore = normalizeScoreEvent(currentRecord);
      const isGoal =
        normalizedScore.scoreOne > this.lastScoreOne ||
        normalizedScore.scoreTwo > this.lastScoreTwo;
      this.lastScoreOne = normalizedScore.scoreOne;
      this.lastScoreTwo = normalizedScore.scoreTwo;

      riskAgent.handleScoreEvent(normalizedScore);

      if (isGoal) {
        logger.info(
          `[REPLAY ENGINE] Synthesizing matching fresh repriced odds to reopen market...`
        );
        setTimeout(() => {
          try {
            const mockOdds = normalizeOddsUpdate({
              fixtureId: normalizedScore.fixtureId,
              seq: normalizedScore.seq + 1000,
              ts: normalizedScore.ts + 5000,
              SuperOddsType: "1X2_PARTICIPANT_RESULT",
              PriceNames: ["part1", "draw", "part2"],
              Prices: [1350, 4200, 8000],
            });
            riskAgent.handleOddsUpdate(mockOdds);
          } catch (err) {
            logger.error("Error handling synthesized odds update:", err);
          }
        }, 5000 / this.speedMultiplier);
      }
    } catch (err) {
      logger.error("Error replaying score update:", err);
    }

    this.currentStep++;
    if (this.currentStep < this.historicalRecords.length) {
      const nextRecord = this.historicalRecords[this.currentStep];
      const currentTs = currentRecord.Ts ?? currentRecord.ts ?? Date.now();
      const nextTs = nextRecord.Ts ?? nextRecord.ts ?? Date.now();

      const timeDiff = Math.max(0, nextTs - currentTs);
      const delay = timeDiff / this.speedMultiplier;

      logger.debug(`Scheduling next replay step in ${delay}ms...`);
      this.timeoutId = setTimeout(() => this.executeNextStep(), delay);
    } else {
      this.executeNextStep();
    }
  }

  public setSpeed(speed: number) {
    logger.info(`Replay speed changed to ${speed}x`);
    this.speedMultiplier = speed;
  }

  public pause() {
    logger.info("Replay paused.");
    this.isPaused = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  public resume() {
    if (this.isPaused) {
      logger.info("Replay resumed.");
      this.isPaused = false;
      this.executeNextStep();
    }
  }

  public stopReplay() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.activeFixtureId = null;
    this.historicalRecords = [];
    this.currentStep = 0;
    healthMonitor.setReplayMode(false);
    logger.info("Replay stopped.");
  }
}

export const replayEngine = new ReplayEngine();
