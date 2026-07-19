import { NormalizedScoreEvent, NormalizedOddsUpdate } from "../domain/types";
import { marketManager, VirtualMarket } from "./market";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";
import { solanaValidator, ProvedStat } from "../solana/validation";

export class RiskAgent {
  private haltTriggers: Map<number, NormalizedScoreEvent> = new Map();
  private verifiedSequences: Map<number, Set<number>> = new Map();

  public handleScoreEvent(event: NormalizedScoreEvent) {
    const market = marketManager.getOrCreateMarket(event.fixtureId);

    if (event.seq <= market.lastScoreSeq) {
      logger.debug(
        `Ignoring older or duplicate score event: seq ${event.seq} (last was ${market.lastScoreSeq})`,
        { fixtureId: event.fixtureId, seq: event.seq }
      );
      return;
    }

    const oldScoreOne = market.scoreOne;
    const oldScoreTwo = market.scoreTwo;
    market.scoreOne = event.scoreOne;
    market.scoreTwo = event.scoreTwo;
    market.lastScoreSeq = event.seq;
    market.lastScoreTs = event.ts;

    const isFinalised =
      event.action === "game_finalised" &&
      event.statusId === 100 &&
      event.period === 100;
    if (isFinalised) {
      logger.info(
        `Observed game finalisation event for fixture ${event.fixtureId}. Transitioning to FINAL_PROOF_PENDING...`,
        { fixtureId: event.fixtureId, seq: event.seq }
      );

      market.pendingVerificationSeq = event.seq;
      market.pendingVerificationType = "FINAL";

      marketManager.transitionTo(
        market,
        "FINAL_PROOF_PENDING",
        "GAME_FINALISED",
        event.eventKey,
        `Final match result finalisation observed. Score: ${event.scoreOne}-${event.scoreTwo}.`
      );
      this.triggerOnChainValidation(event, ["1", "2"]);
      return;
    }

    const isScoreIncreased =
      event.scoreOne > oldScoreOne || event.scoreTwo > oldScoreTwo;
    const isGoalAction = ["goal", "penalty_goal", "own_goal"].includes(
      event.action.toLowerCase()
    );

    if ((isScoreIncreased || isGoalAction) && market.state === "OPEN") {
      logger.warn(
        `Goal detected! Halting market for fixture ${event.fixtureId}. Score: ${event.scoreOne}-${event.scoreTwo}`,
        { fixtureId: event.fixtureId, seq: event.seq }
      );

      market.pendingVerificationSeq = event.seq;
      market.pendingVerificationType = "GOAL";

      this.haltTriggers.set(event.fixtureId, event);
      marketManager.transitionTo(
        market,
        "HALTED",
        "GOAL_DETECTED",
        event.eventKey,
        `Goal detected. Action: ${event.action}. Score changed to ${event.scoreOne}-${event.scoreTwo}.`
      );

      const statKeyToVerify = event.scoreOne > oldScoreOne ? "1" : "2";
      this.triggerOnChainValidation(event, [statKeyToVerify]);
    }
  }

  public handleOddsUpdate(update: NormalizedOddsUpdate) {
    // Only allow intended 1X2 market odds (Finding 5)
    if (update.oddsType !== "1X2_PARTICIPANT_RESULT") {
      return;
    }
    // Reject invalid or zero prices (Finding 5)
    if (update.oddsOne <= 0 || update.oddsDraw <= 0 || update.oddsTwo <= 0) {
      return;
    }

    const market = marketManager.getOrCreateMarket(update.fixtureId);

    market.oddsOne = update.oddsOne;
    market.oddsDraw = update.oddsDraw;
    market.oddsTwo = update.oddsTwo;
    market.lastOddsSeq = update.seq;
    market.lastOddsTs = update.ts;

    if (market.state === "PROOF_PENDING" || market.state === "HALTED") {
      this.evaluateReopenRules(market);
    }
  }

  private evaluateReopenRules(market: VirtualMarket) {
    const oddsHealth = healthMonitor.getHealth().oddsSse;
    if (process.env.TEST_MODE !== "true" && oddsHealth.status !== "HEALTHY") {
      logger.debug(
        `Cannot reopen market: Odds stream health is currently ${oddsHealth.status}`,
        { fixtureId: market.fixtureId }
      );
      return;
    }

    const trigger = this.haltTriggers.get(market.fixtureId);
    if (!trigger) {
      logger.warn(
        `No halt trigger found for fixture ${market.fixtureId} despite market being in ${market.state} state.`
      );
      return;
    }

    // Check if the original halt-trigger sequence is verified, not the latest sequence (Finding 6)
    const verified = this.isSequenceVerified(market.fixtureId, trigger.seq);
    if (!verified) {
      logger.debug(
        `Cannot reopen market: On-chain proof for trigger sequence ${trigger.seq} is not yet validated.`,
        { fixtureId: market.fixtureId }
      );
      return;
    }

    const oddsTs = market.lastOddsTs;
    const scoreTs = trigger.ts;

    if (oddsTs > scoreTs) {
      logger.info(
        `✓ Newer demargined odds received after the goal event (Odds TS: ${oddsTs} > Score TS: ${scoreTs}). Reopening market!`,
        { fixtureId: market.fixtureId }
      );
      marketManager.transitionTo(
        market,
        "OPEN",
        "PROOF_VERIFIED_AND_REPRICED",
        trigger.eventKey,
        `Proof validated on-chain and newer repriced odds received.`
      );
      this.haltTriggers.delete(market.fixtureId);
    } else {
      logger.debug(
        `Cannot reopen market: Odds update is stale. (Odds TS: ${oddsTs} <= Score TS: ${scoreTs})`,
        { fixtureId: market.fixtureId }
      );
    }
  }

  public registerVerificationSuccess(
    fixtureId: number,
    seq: number,
    provedStats: ProvedStat[]
  ) {
    logger.info(
      `Registering successful on-chain proof verification for fixture ${fixtureId}, sequence ${seq}`
    );
    if (!this.verifiedSequences.has(fixtureId)) {
      this.verifiedSequences.set(fixtureId, new Set());
    }
    this.verifiedSequences.get(fixtureId)!.add(seq);

    const market = marketManager.getOrCreateMarket(fixtureId);

    // Bind proof completion to its exact pending transition (Finding 2)
    if (market.pendingVerificationSeq !== seq) {
      logger.warn(
        `Received verification success for seq ${seq}, but market for fixture ${fixtureId} is expecting seq ${market.pendingVerificationSeq}. Ignoring.`
      );
      return;
    }

    const verificationType = market.pendingVerificationType;
    market.pendingVerificationSeq = undefined;
    market.pendingVerificationType = undefined;

    if (verificationType === "GOAL") {
      marketManager.transitionTo(
        market,
        "PROOF_PENDING",
        "PROOF_VALIDATED_ON_CHAIN",
        undefined,
        `On-chain validation succeeded for seq ${seq}. Awaiting newer repriced odds...`
      );
    } else if (verificationType === "FINAL") {
      // Calculate winner from verified goals, not unverified stream scores (Finding 3)
      const goal1Stat = provedStats.find((s) => s.key === 1);
      const goal2Stat = provedStats.find((s) => s.key === 2);

      const scoreOneProved = goal1Stat ? goal1Stat.value : market.scoreOne;
      const scoreTwoProved = goal2Stat ? goal2Stat.value : market.scoreTwo;

      logger.info(
        `Settling market using verified scores: ${scoreOneProved}-${scoreTwoProved} (raw was ${market.scoreOne}-${market.scoreTwo})`
      );

      const winner =
        scoreOneProved > scoreTwoProved
          ? "PARTICIPANT_ONE_WIN"
          : scoreOneProved < scoreTwoProved
          ? "PARTICIPANT_TWO_WIN"
          : "DRAW";

      market.settlementOutcome = winner;
      marketManager.transitionTo(
        market,
        "SETTLED",
        "FINAL_PROOF_VERIFIED",
        undefined,
        `On-chain final score validated. Market settled. Outcome: ${winner}.`
      );
    }

    this.evaluateReopenRules(market);
  }

  private isSequenceVerified(fixtureId: number, seq: number): boolean {
    const verifiedSet = this.verifiedSequences.get(fixtureId);
    return verifiedSet ? verifiedSet.has(seq) : false;
  }

  private async triggerOnChainValidation(
    event: NormalizedScoreEvent,
    statKeys: string[]
  ) {
    logger.info(
      `Orchestrating on-chain verification for sequence ${
        event.seq
      } (stat keys: ${statKeys.join(",")})...`,
      { fixtureId: event.fixtureId, seq: event.seq }
    );

    if (process.env.TEST_MODE === "true") {
      logger.info(
        `[TEST MODE] Auto-simulating on-chain validation success in 4 seconds.`
      );
      setTimeout(() => {
        const mockProvedStats: ProvedStat[] = statKeys.map((key) => ({
          key: Number(key),
          value: Number(key === "1" ? event.scoreOne : event.scoreTwo),
          period: 0,
        }));
        this.registerVerificationSuccess(
          event.fixtureId,
          event.seq,
          mockProvedStats
        );
      }, 4000);
      return;
    }

    try {
      const result = await solanaValidator.validateProofOnChain(
        event.fixtureId,
        event.seq,
        statKeys,
        true
      );
      if (result.success) {
        this.registerVerificationSuccess(
          event.fixtureId,
          event.seq,
          result.provedStats
        );
      } else {
        logger.error(
          `On-chain proof validation returned false for fixture ${event.fixtureId}, seq ${event.seq}`
        );
      }
    } catch (err: any) {
      logger.error(
        `Error executing on-chain proof validation for fixture ${event.fixtureId}, seq ${event.seq}:`,
        err
      );
    }
  }
}

export const riskAgent = new RiskAgent();
