export interface NormalizedFixture {
  fixtureId: number;
  participantOneName: string;
  participantTwoName: string;
  gameStateId: number;
  gameStateName: string;
  sportId: number;
  sportName: string;
  competitionId: number;
  competitionName: string;
  startTime: string;
}

export interface NormalizedScoreEvent {
  fixtureId: number;
  seq: number;
  ts: number;
  gameState: number | string;
  period: number;
  statusId: number;
  action: string;
  scoreOne: number;
  scoreTwo: number;
  statKey?: number;
  statValue?: number;
  participantId?: number;
  ingestedAt: string;
  eventKey: string;
}

export interface NormalizedOddsUpdate {
  fixtureId: number;
  seq: number;
  ts: number;
  oddsOne: number;
  oddsDraw: number;
  oddsTwo: number;
  oddsType: string;
  messageId?: string;
  ingestedAt: string;
}

export function normalizeFixture(raw: any): NormalizedFixture {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid raw fixture object");
  }

  const rawFixtureId = raw.fixtureId ?? raw.FixtureId;
  const fixtureId = Number(rawFixtureId);
  if (
    rawFixtureId === undefined ||
    rawFixtureId === null ||
    !Number.isFinite(fixtureId) ||
    fixtureId <= 0 ||
    !Number.isInteger(fixtureId)
  ) {
    throw new Error(`Invalid fixture ID: ${rawFixtureId}`);
  }

  const participantOneName =
    raw.Participant1 ?? raw.participantOneName ?? raw.ParticipantOneName ?? "";
  const participantTwoName =
    raw.Participant2 ?? raw.participantTwoName ?? raw.ParticipantTwoName ?? "";

  const competitionName =
    raw.Competition ?? raw.competitionName ?? raw.CompetitionName ?? "";

  const rawStartTime = raw.startTime ?? raw.StartTime;
  if (rawStartTime === undefined || rawStartTime === null) {
    throw new Error(`Missing or invalid StartTime: ${rawStartTime}`);
  }

  let startTimeIso: string;
  if (
    typeof rawStartTime === "number" &&
    Number.isFinite(rawStartTime) &&
    rawStartTime > 0
  ) {
    startTimeIso = new Date(rawStartTime).toISOString();
  } else if (
    typeof rawStartTime === "string" &&
    rawStartTime.trim() !== "" &&
    !isNaN(Date.parse(rawStartTime))
  ) {
    startTimeIso = new Date(rawStartTime).toISOString();
  } else {
    throw new Error(`Invalid StartTime format: ${rawStartTime}`);
  }

  const rawGameState =
    raw.gameStateId ?? raw.GameStateId ?? raw.gameState ?? raw.GameState ?? 1;
  const gameStateId = Number(rawGameState);

  return {
    fixtureId,
    participantOneName,
    participantTwoName,
    gameStateId: Number.isFinite(gameStateId) ? gameStateId : 1,
    gameStateName: raw.gameStateName ?? raw.GameStateName ?? "Scheduled",
    sportId: Number(raw.sportId ?? raw.SportId ?? 1),
    sportName: raw.sportName ?? raw.SportName ?? "Soccer",
    competitionId: Number(raw.competitionId ?? raw.CompetitionId ?? 0),
    competitionName,
    startTime: startTimeIso,
  };
}

export function normalizeScoreEvent(raw: any): NormalizedScoreEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid raw score event object");
  }

  const rawFixtureId = raw.fixtureId ?? raw.FixtureId;
  const fixtureId = Number(rawFixtureId);
  if (
    rawFixtureId === undefined ||
    rawFixtureId === null ||
    !Number.isFinite(fixtureId) ||
    fixtureId <= 0 ||
    !Number.isInteger(fixtureId)
  ) {
    throw new Error(`Invalid fixture ID: ${rawFixtureId}`);
  }

  const rawSeq = raw.seq ?? raw.Seq;
  const seq = Number(rawSeq);
  if (
    rawSeq === undefined ||
    rawSeq === null ||
    !Number.isFinite(seq) ||
    seq <= 0 ||
    !Number.isInteger(seq)
  ) {
    throw new Error(`Invalid or missing score sequence: ${rawSeq}`);
  }

  const rawTs = raw.ts ?? raw.Ts;
  const ts = Number(rawTs);
  if (
    rawTs === undefined ||
    rawTs === null ||
    !Number.isFinite(ts) ||
    ts <= 0
  ) {
    throw new Error(`Invalid or missing score timestamp: ${rawTs}`);
  }

  const action = String(raw.action ?? raw.Action ?? "");
  const eventKey = `${fixtureId}:${seq}:${action}`;

  // Read score totals from Stats dictionary or direct fields
  const stats = raw.Stats ?? raw.stats ?? {};
  const getStatValue = (key: string): number | undefined => {
    const entry = stats[key];
    if (entry === undefined || entry === null) return undefined;
    if (typeof entry === "object") {
      const val = entry.value ?? entry.Value;
      return val !== undefined ? Number(val) : undefined;
    }
    return Number(entry);
  };

  const stat1 = getStatValue("1");
  const stat2 = getStatValue("2");

  const scoreOne =
    stat1 !== undefined ? stat1 : Number(raw.scoreOne ?? raw.ScoreOne ?? 0);

  const scoreTwo =
    stat2 !== undefined ? stat2 : Number(raw.scoreTwo ?? raw.ScoreTwo ?? 0);

  if (!Number.isFinite(scoreOne) || scoreOne < 0) {
    throw new Error(`Invalid scoreOne: ${scoreOne}`);
  }
  if (!Number.isFinite(scoreTwo) || scoreTwo < 0) {
    throw new Error(`Invalid scoreTwo: ${scoreTwo}`);
  }

  const rawGameState = raw.gameState ?? raw.GameState ?? 0;
  const gameState =
    typeof rawGameState === "number" ||
    (typeof rawGameState === "string" &&
      rawGameState.trim() !== "" &&
      !isNaN(Number(rawGameState)))
      ? Number(rawGameState)
      : String(rawGameState);

  const rawParticipant = raw.Participant ?? raw.participantId;
  const participantId =
    rawParticipant !== undefined && rawParticipant !== null
      ? Number(rawParticipant)
      : undefined;

  return {
    fixtureId,
    seq,
    ts,
    gameState,
    period: Number(raw.period ?? raw.Period ?? 0),
    statusId: Number(raw.statusId ?? raw.StatusId ?? 0),
    action,
    scoreOne,
    scoreTwo,
    statKey: raw.statKey !== undefined ? Number(raw.statKey) : undefined,
    statValue: raw.statValue !== undefined ? Number(raw.statValue) : undefined,
    participantId,
    ingestedAt: new Date().toISOString(),
    eventKey,
  };
}

export function normalizeOddsUpdate(raw: any): NormalizedOddsUpdate | null {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid raw odds update object");
  }

  const rawFixtureId = raw.fixtureId ?? raw.FixtureId;
  const fixtureId = Number(rawFixtureId);
  if (
    rawFixtureId === undefined ||
    rawFixtureId === null ||
    !Number.isFinite(fixtureId) ||
    fixtureId <= 0 ||
    !Number.isInteger(fixtureId)
  ) {
    throw new Error(`Invalid fixture ID: ${rawFixtureId}`);
  }

  const rawTs = raw.ts ?? raw.Ts;
  const ts = Number(rawTs);
  if (
    rawTs === undefined ||
    rawTs === null ||
    !Number.isFinite(ts) ||
    ts <= 0
  ) {
    throw new Error(`Invalid or missing odds timestamp: ${rawTs}`);
  }

  const superOddsType =
    raw.super_odds_type ?? raw.superOddsType ?? raw.SuperOddsType;
  const marketPeriod = raw.marketPeriod ?? raw.MarketPeriod;

  // Filter market type: accept only full-match 1X2_PARTICIPANT_RESULT
  if (
    superOddsType !== undefined &&
    superOddsType !== null &&
    superOddsType !== ""
  ) {
    if (superOddsType !== "1X2_PARTICIPANT_RESULT") {
      return null;
    }
  }
  if (
    marketPeriod !== undefined &&
    marketPeriod !== null &&
    marketPeriod !== ""
  ) {
    return null;
  }

  const oddsType = superOddsType ?? "1X2_PARTICIPANT_RESULT";
  const seq = Number(raw.seq ?? raw.Seq ?? 0);
  const messageId = raw.MessageId ?? raw.messageId;

  let oddsOne = 0;
  let oddsDraw = 0;
  let oddsTwo = 0;

  const priceNames = raw.PriceNames ?? raw.priceNames ?? [];
  const prices = raw.Prices ?? raw.prices ?? [];

  if (priceNames.length > 0 && prices.length > 0) {
    const idx1 = priceNames.findIndex(
      (name: string) => name === "part1" || name === "1" || name === "home"
    );
    const idxDraw = priceNames.findIndex(
      (name: string) => name === "draw" || name === "X"
    );
    const idx2 = priceNames.findIndex(
      (name: string) => name === "part2" || name === "2" || name === "away"
    );

    if (idx1 !== -1 && idx1 < prices.length) oddsOne = Number(prices[idx1]);
    if (idxDraw !== -1 && idxDraw < prices.length)
      oddsDraw = Number(prices[idxDraw]);
    if (idx2 !== -1 && idx2 < prices.length) oddsTwo = Number(prices[idx2]);
  } else if (raw.outcomes) {
    const o1 = raw.outcomes.find(
      (o: any) => o.type === 1 || o.outcomeType === 1
    );
    const oX = raw.outcomes.find(
      (o: any) =>
        o.type === 2 ||
        o.outcomeType === 2 ||
        o.type === "X" ||
        o.outcomeType === "X"
    );
    const o2 = raw.outcomes.find(
      (o: any) => o.type === 3 || o.outcomeType === 3
    );

    oddsOne = o1 ? Number(o1.odds ?? o1.price ?? 0) : 0;
    oddsDraw = oX ? Number(oX.odds ?? oX.price ?? 0) : 0;
    oddsTwo = o2 ? Number(o2.odds ?? o2.price ?? 0) : 0;
  } else {
    oddsOne = Number(raw.oddsOne ?? raw.priceOne ?? 0);
    oddsDraw = Number(raw.oddsDraw ?? raw.priceDraw ?? 0);
    oddsTwo = Number(raw.oddsTwo ?? raw.priceTwo ?? 0);
  }

  if (
    !Number.isFinite(oddsOne) ||
    oddsOne <= 0 ||
    !Number.isFinite(oddsDraw) ||
    oddsDraw <= 0 ||
    !Number.isFinite(oddsTwo) ||
    oddsTwo <= 0
  ) {
    throw new Error(
      `Invalid, missing, zero, or negative 1X2 prices: oddsOne=${oddsOne}, oddsDraw=${oddsDraw}, oddsTwo=${oddsTwo}`
    );
  }

  return {
    fixtureId,
    seq,
    ts,
    oddsOne,
    oddsDraw,
    oddsTwo,
    oddsType,
    messageId,
    ingestedAt: new Date().toISOString(),
  };
}
