import { NormalizedScoreEvent, NormalizedOddsUpdate } from "../domain/types";
import { marketManager, VirtualMarket } from "./market";
import { logger } from "../utils/logger";
import { healthMonitor } from "../utils/health";
import { solanaValidator, ProvedStat, ExpectedStat } from "../solana/validation";

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

      const expectedStats: ExpectedStat[] = [
        { key: 1, value: event.scoreOne },
        { key: 2, value: event.scoreTwo },
      ];

      market.pendingVerificationSeq = event.seq;
      market.pendingVerificationType = "FINAL";
      market.pendingVerificationExpectedStats = expectedStats;

      marketManager.transitionTo(
        market,
        "FINAL_PROOF_PENDING",
        "GAME_FINALISED",
        event.eventKey,
        `Final match result finalisation observed. Score: ${event.scoreOne}-${event.scoreTwo}.`
      );
      this.triggerOnChainValidation(event, expectedStats);
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

      const keyToVerify =
        event.scoreOne > oldScoreOne
          ? 1
          : event.scoreTwo > oldScoreTwo
          ? 2
          : event.participantId === 2
          ? 2
          : 1;
      const valueToVerify = keyToVerify === 1 ? event.scoreOne : event.scoreTwo;

      const expectedStats: ExpectedStat[] = [
        { key: keyToVerify, value: valueToVerify },
      ];

      market.pendingVerificationSeq = event.seq;
      market.pendingVerificationType = "GOAL";
      market.pendingVerificationExpectedStats = expectedStats;

      this.haltTriggers.set(event.fixtureId, event);
      marketManager.transitionTo(
        market,
        "HALTED",
        "GOAL_DETECTED",
        event.eventKey,
        `Goal detected. Action: ${event.action}. Score changed to ${event.scoreOne}-${event.scoreTwo}.`
      );

      this.triggerOnChainValidation(event, expectedStats);
    }
  }

  public handleOddsUpdate(update: NormalizedOddsUpdate) {
    // Only allow intended 1X2 market odds (Finding 5)
    if (update.oddsType !== "1X2_PARTICIPANT_RESULT") {
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

    const market = marketManager.getOrCreateMarket(fixtureId);

    // 1. Bind proof completion to its exact pending transition
    if (market.pendingVerificationSeq !== seq) {
      logger.warn(
        `Received verification success for seq ${seq}, but market for fixture ${fixtureId} is expecting seq ${market.pendingVerificationSeq}. Ignoring.`
      );
      return;
    }

    // 2. Closure Finding 1: Pending expected stats MUST exist and match provedStats exactly
    const expected = market.pendingVerificationExpectedStats;
    if (!expected || !Array.isArray(expected) || expected.length === 0) {
      logger.warn(
        `Received verification success for seq ${seq}, but market for fixture ${fixtureId} has no pending expected stats array. Ignoring and keeping market pending.`
      );
      return;
    }

    if (provedStats.length !== expected.length) {
      logger.warn(
        `Received verification success for seq ${seq}, but provedStats length (${provedStats.length}) does not match expected length (${expected.length}). Ignoring.`
      );
      return;
    }
    for (let i = 0; i < expected.length; i++) {
      if (
        !provedStats[i] ||
        provedStats[i].key !== expected[i].key ||
        provedStats[i].value !== expected[i].value
      ) {
        logger.warn(
          `Received verification success for seq ${seq}, but proved stat at index ${i} does not match expected (key ${expected[i].key}, val ${expected[i].value}). Ignoring.`
        );
        return;
      }
    }

    if (!this.verifiedSequences.has(fixtureId)) {
      this.verifiedSequences.set(fixtureId, new Set());
    }
    this.verifiedSequences.get(fixtureId)!.add(seq);

    const verificationType = market.pendingVerificationType;
    market.pendingVerificationSeq = undefined;
    market.pendingVerificationType = undefined;
    market.pendingVerificationExpectedStats = undefined;

    if (verificationType === "GOAL") {
      marketManager.transitionTo(
        market,
        "PROOF_PENDING",
        "PROOF_VALIDATED_ON_CHAIN",
        undefined,
        `On-chain validation succeeded for seq ${seq}. Awaiting newer repriced odds...`
      );
    } else if (verificationType === "FINAL") {
      // Follow-up Finding 1: Exact ordered proved stats for final settlement (index 0 = key 1, index 1 = key 2)
      if (
        provedStats.length !== 2 ||
        provedStats[0].key !== 1 ||
        provedStats[1].key !== 2
      ) {
        logger.error(
          `Incomplete or misordered proved stats for final settlement of fixture ${fixtureId}. Market remains pending.`
        );
        return;
      }

      const scoreOneProved = provedStats[0].value;
      const scoreTwoProved = provedStats[1].value;

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
    expectedStats: ExpectedStat[]
  ) {
    const statKeys = expectedStats.map((s) => String(s.key));
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
        const mockProvedStats: ProvedStat[] = expectedStats.map((s) => ({
          key: s.key,
          value: s.value,
          period: 0,
        }));
        // NOTE: In TEST_MODE, we simulate the callback internally for state machine tests,
        // but do NOT add a public receipt labeled SIMULATED.
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
        expectedStats,
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
