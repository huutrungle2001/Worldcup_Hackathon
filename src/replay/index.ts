import { txLineClient } from "../txline/api";
import { riskAgent } from "../agent/risk";
import { normalizeScoreEvent, normalizeOddsUpdate } from "../domain/types";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";

export type ReplayState =
  | "IDLE"
  | "LOADING"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED";

export interface ReplayStatus {
  enabled: boolean;
  state: ReplayState;
  activeFixtureId: number | null;
  demoFixtureId: number | null;
  speed: number;
  currentStep: number;
  totalSteps: number;
  message: string;
  error: string | null;
  lastUpdated: string;
}

export interface ReplayActionResult {
  success: boolean;
  status: ReplayStatus;
  error?: string;
  statusCode?: number;
}

export class ReplayEngine {
  private activeFixtureId: number | null = null;
  private state: ReplayState = "IDLE";
  private isPaused = false;
  private speedMultiplier = 1;
  private timeoutId: NodeJS.Timeout | null = null;
  private currentStep = 0;
  private historicalRecords: any[] = [];
  private lastScoreOne = 0;
  private lastScoreTwo = 0;
  private statusMessage = "Replay system idle";
  private errorMessage: string | null = null;
  private lastUpdated: string = new Date().toISOString();
  private replayGeneration = 0;
  private nextStepScheduledAt = 0;
  private nextStepTimeDiff = 0;

  public getDemoFixtureId(): number | null {
    const raw = process.env.DEMO_FIXTURE_ID;
    if (!raw) return null;
    const val = Number(raw);
    return Number.isInteger(val) && val > 0 ? val : null;
  }

  public isEnabled(): boolean {
    return process.env.DEMO_REPLAY_ENABLED === "true";
  }

  public getStatus(): ReplayStatus {
    return {
      enabled: this.isEnabled(),
      state: this.state,
      activeFixtureId: this.activeFixtureId,
      demoFixtureId: this.getDemoFixtureId(),
      speed: this.speedMultiplier,
      currentStep: this.currentStep,
      totalSteps: this.historicalRecords.length,
      message: this.statusMessage,
      error: this.errorMessage,
      lastUpdated: this.lastUpdated,
    };
  }

  private updateStatus(state: ReplayState, message: string, error: string | null = null) {
    this.state = state;
    this.statusMessage = message;
    this.errorMessage = error;
    this.lastUpdated = new Date().toISOString();
    healthMonitor.setReplayMode(state === "RUNNING" || state === "PAUSED" || state === "LOADING");
  }

  public async startReplay(fixtureId: number, speed = 1): Promise<ReplayActionResult> {
    if (!this.isEnabled()) {
      const msg = "Public demo replay is disabled on this server.";
      this.updateStatus("FAILED", "Demo replay disabled", msg);
      return { success: false, status: this.getStatus(), error: msg, statusCode: 403 };
    }

    if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
      const msg = "Fixture ID must be a positive integer.";
      this.updateStatus("FAILED", "Invalid fixture ID", msg);
      return { success: false, status: this.getStatus(), error: msg, statusCode: 400 };
    }

    if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 1 || speed > 100) {
      const msg = "Replay speed must be a finite number between 1 and 100.";
      this.updateStatus("FAILED", "Invalid replay speed", msg);
      return { success: false, status: this.getStatus(), error: msg, statusCode: 400 };
    }

    // Cancel previous replay and increment generation counter
    this.stopReplayInternal();
    this.replayGeneration++;
    const currentGen = this.replayGeneration;

    this.activeFixtureId = fixtureId;
    this.speedMultiplier = speed;
    this.isPaused = false;
    this.currentStep = 0;
    this.lastScoreOne = 0;
    this.lastScoreTwo = 0;
    this.updateStatus("LOADING", `Loading historical score records for fixture ${fixtureId}...`);

    logger.info(`Starting historical replay fetch for fixture ${fixtureId} at ${speed}x...`);

    try {
      let response = await txLineClient.request<any[]>({
        url: `/scores/historical/${fixtureId}`,
      });

      // Fallback: If no records returned, try scores snapshot endpoint (highly useful for devnet sandboxes)
      if (!response || !Array.isArray(response) || response.length === 0) {
        logger.info(`No historical score records found for fixture ${fixtureId}. Trying scores snapshot...`);
        try {
          response = await txLineClient.getScoresSnapshot(fixtureId);
        } catch (snapErr: any) {
          logger.warn(`Failed to fetch scores snapshot for fixture ${fixtureId}: ${snapErr.message}`);
        }
      }

      // If user stopped or started a new replay during fetch, abort this callback
      if (this.replayGeneration !== currentGen) {
        return { success: false, status: this.getStatus(), error: "Replay attempt cancelled." };
      }

      if (!response || !Array.isArray(response) || response.length === 0) {
        const msg = `No historical score records or snapshot found for fixture ${fixtureId}.`;
        logger.error(msg);
        this.updateStatus("FAILED", `No historical records for fixture ${fixtureId}`, msg);
        return { success: false, status: this.getStatus(), error: msg, statusCode: 400 };
      }

      this.historicalRecords = response
        .filter((item) => {
          const seqVal = item.Seq ?? item.seq;
          if (seqVal === undefined || seqVal === null) return false;
          const num = Number(seqVal);
          return Number.isInteger(num) && num > 0;
        })
        .sort((a, b) => {
          const seqA = a.Seq ?? a.seq ?? 0;
          const seqB = b.Seq ?? b.seq ?? 0;
          return seqA - seqB;
        });

      logger.info(`✓ Loaded ${this.historicalRecords.length} historical updates for replay.`);
      this.updateStatus("RUNNING", `Replaying fixture ${fixtureId} (${this.historicalRecords.length} steps)...`);
      this.executeNextStep();
      return { success: true, status: this.getStatus() };
    } catch (err: any) {
      if (this.replayGeneration !== currentGen) {
        return { success: false, status: this.getStatus(), error: "Replay attempt cancelled." };
      }
      const msg = `Failed to fetch historical replay data for fixture ${fixtureId}.`;
      logger.error(msg, err);
      this.updateStatus("FAILED", `Fetch error for fixture ${fixtureId}`, msg);
      return { success: false, status: this.getStatus(), error: msg, statusCode: 500 };
    }
  }

  private executeNextStep() {
    if (this.isPaused) return;

    if (this.currentStep >= this.historicalRecords.length) {
      logger.info("Replay completed successfully!");
      this.updateStatus("COMPLETED", `Replay completed for fixture ${this.activeFixtureId}.`);
      return;
    }

    const currentRecord = this.historicalRecords[this.currentStep];
    const seqNum = currentRecord.Seq ?? currentRecord.seq;
    this.updateStatus(
      "RUNNING",
      `Replaying step ${this.currentStep + 1}/${this.historicalRecords.length} (Seq ${seqNum})`
    );

    logger.info(
      `Replaying step ${this.currentStep + 1}/${this.historicalRecords.length} | Seq: ${seqNum}`
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
        logger.info(`[REPLAY ENGINE] Synthesizing matching fresh repriced odds to reopen market...`);
        const oddsDelay = Math.max(100, Math.floor(5000 / this.speedMultiplier));
        setTimeout(() => {
          if (this.state === "RUNNING" || this.state === "PAUSED") {
            try {
              const mockOdds = normalizeOddsUpdate({
                fixtureId: normalizedScore.fixtureId,
                seq: normalizedScore.seq + 1000,
                ts: normalizedScore.ts + 5000,
                SuperOddsType: "1X2_PARTICIPANT_RESULT",
                PriceNames: ["part1", "draw", "part2"],
                Prices: [1350, 4200, 8000],
              });
              if (mockOdds) {
                riskAgent.handleOddsUpdate(mockOdds);
              }
            } catch (err) {
              logger.error("Error handling synthesized odds update:", err);
            }
          }
        }, oddsDelay);
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
      // Cap the maximum delay to 1500ms to keep the demo dynamic during large event gaps (e.g. halftime)
      const delay = Math.min(1500, Math.max(50, Math.floor(timeDiff / this.speedMultiplier)));

      this.nextStepScheduledAt = Date.now();
      this.nextStepTimeDiff = timeDiff;

      logger.debug(`Scheduling next replay step in ${delay}ms...`);
      this.timeoutId = setTimeout(() => this.executeNextStep(), delay);
    } else {
      logger.info("Replay reached final step.");
      this.updateStatus("COMPLETED", `Replay completed for fixture ${this.activeFixtureId}.`);
    }
  }

  public setSpeed(speed: number): ReplayActionResult {
    if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 1 || speed > 100) {
      const msg = "Replay speed must be a finite number between 1 and 100.";
      return { success: false, status: this.getStatus(), error: msg, statusCode: 400 };
    }
    logger.info(`Replay speed changed to ${speed}x`);
    this.speedMultiplier = speed;
    this.lastUpdated = new Date().toISOString();

    // Reschedule active timeout on speed changes for snappy user response
    if (this.state === "RUNNING" && this.timeoutId) {
      clearTimeout(this.timeoutId);
      const elapsed = Date.now() - this.nextStepScheduledAt;
      const newTotalDelay = Math.min(1500, Math.max(50, Math.floor(this.nextStepTimeDiff / speed)));
      const remainingDelay = Math.max(50, newTotalDelay - elapsed);
      logger.info(`Rescheduling current replay step to run in ${remainingDelay}ms (speed: ${speed}x).`);
      this.timeoutId = setTimeout(() => this.executeNextStep(), remainingDelay);
    }

    return { success: true, status: this.getStatus() };
  }

  public pause(): ReplayActionResult {
    if (this.state !== "RUNNING") {
      const msg = `Cannot pause replay when state is ${this.state}. Must be RUNNING.`;
      return { success: false, status: this.getStatus(), error: msg, statusCode: 409 };
    }
    logger.info("Replay paused.");
    this.isPaused = true;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.updateStatus("PAUSED", `Replay paused at step ${this.currentStep}/${this.historicalRecords.length}.`);
    return { success: true, status: this.getStatus() };
  }

  public resume(): ReplayActionResult {
    if (this.state !== "PAUSED") {
      const msg = `Cannot resume replay when state is ${this.state}. Must be PAUSED.`;
      return { success: false, status: this.getStatus(), error: msg, statusCode: 409 };
    }
    logger.info("Replay resumed.");
    this.isPaused = false;
    this.updateStatus("RUNNING", `Replay resumed at step ${this.currentStep + 1}/${this.historicalRecords.length}.`);
    this.executeNextStep();
    return { success: true, status: this.getStatus() };
  }

  private stopReplayInternal() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    this.isPaused = false;
  }

  public stopReplay(): ReplayActionResult {
    this.replayGeneration++;
    this.stopReplayInternal();
    this.activeFixtureId = null;
    this.historicalRecords = [];
    this.currentStep = 0;
    this.updateStatus("IDLE", "Replay stopped.");
    logger.info("Replay stopped.");
    return { success: true, status: this.getStatus() };
  }
}

export const replayEngine = new ReplayEngine();
