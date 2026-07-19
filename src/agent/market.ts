import { logger } from "../utils/logger";

export type MarketState =
  | "OPEN"
  | "HALTED"
  | "PROOF_PENDING"
  | "FINAL_PROOF_PENDING"
  | "SETTLED";

export interface AuditEvent {
  timestamp: string;
  fromState: MarketState;
  toState: MarketState;
  reasonCode: string;
  triggerEventKey?: string;
  message: string;
}

export interface VirtualMarket {
  fixtureId: number;
  state: MarketState;
  scoreOne: number;
  scoreTwo: number;
  lastScoreSeq: number;
  lastScoreTs: number;
  lastOddsSeq: number;
  lastOddsTs: number;
  oddsOne: number;
  oddsDraw: number;
  oddsTwo: number;
  haltedAt?: string;
  reopenedAt?: string;
  settledAt?: string;
  settlementOutcome?:
    | "PARTICIPANT_ONE_WIN"
    | "PARTICIPANT_TWO_WIN"
    | "DRAW"
    | "UNKNOWN";
  pendingVerificationSeq?: number;
  pendingVerificationType?: "GOAL" | "FINAL";
  pendingVerificationExpectedStats?: Array<{ key: number; value: number }>;
  auditTrail: AuditEvent[];
}

export class MarketManager {
  private markets: Map<number, VirtualMarket> = new Map();

  public getOrCreateMarket(fixtureId: number): VirtualMarket {
    if (!this.markets.has(fixtureId)) {
      const market: VirtualMarket = {
        fixtureId,
        state: "OPEN",
        scoreOne: 0,
        scoreTwo: 0,
        lastScoreSeq: 0,
        lastScoreTs: 0,
        lastOddsSeq: 0,
        lastOddsTs: 0,
        oddsOne: 0,
        oddsDraw: 0,
        oddsTwo: 0,
        auditTrail: [],
      };
      this.addAuditEntry(
        market,
        "OPEN",
        "OPEN",
        "INIT",
        undefined,
        "Virtual market initialized in OPEN state."
      );
      this.markets.set(fixtureId, market);
    }
    return this.markets.get(fixtureId)!;
  }

  public getMarket(fixtureId: number): VirtualMarket | undefined {
    return this.markets.get(fixtureId);
  }

  public getAllMarkets(): VirtualMarket[] {
    return Array.from(this.markets.values());
  }

  public addAuditEntry(
    market: VirtualMarket,
    fromState: MarketState,
    toState: MarketState,
    reasonCode: string,
    triggerEventKey?: string,
    message = ""
  ) {
    const entry: AuditEvent = {
      timestamp: new Date().toISOString(),
      fromState,
      toState,
      reasonCode,
      triggerEventKey,
      message,
    };
    market.auditTrail.push(entry);
    if (market.auditTrail.length > 100) {
      market.auditTrail.shift();
    }
    logger.info(
      `[MARKET STATE CHANGE] Fixture ${market.fixtureId}: ${fromState} -> ${toState} | Reason: ${reasonCode} | ${message}`
    );
  }

  public transitionTo(
    market: VirtualMarket,
    newState: MarketState,
    reasonCode: string,
    triggerEventKey?: string,
    message = ""
  ): boolean {
    const oldState = market.state;
    if (oldState === newState) {
      return false;
    }

    if (oldState === "SETTLED") {
      logger.warn(
        `Rejected state transition from SETTLED to ${newState} for fixture ${market.fixtureId}. Settled markets are immutable.`
      );
      return false;
    }

    market.state = newState;
    if (newState === "HALTED") {
      market.haltedAt = new Date().toISOString();
    } else if (
      newState === "OPEN" &&
      (oldState === "PROOF_PENDING" || oldState === "HALTED")
    ) {
      market.reopenedAt = new Date().toISOString();
    } else if (newState === "SETTLED") {
      market.settledAt = new Date().toISOString();
    }

    this.addAuditEntry(
      market,
      oldState,
      newState,
      reasonCode,
      triggerEventKey,
      message
    );
    return true;
  }
}

export const marketManager = new MarketManager();
