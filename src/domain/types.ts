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
  gameState: number;
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
  ingestedAt: string;
}

export function normalizeFixture(raw: any): NormalizedFixture {
  return {
    fixtureId: Number(raw.fixtureId ?? raw.FixtureId),
    participantOneName:
      raw.Participant1 ??
      raw.participantOneName ??
      raw.ParticipantOneName ??
      "",
    participantTwoName:
      raw.Participant2 ??
      raw.participantTwoName ??
      raw.ParticipantTwoName ??
      "",
    gameStateId: Number(raw.gameState ?? raw.GameState ?? 1),
    gameStateName: raw.gameStateName ?? raw.GameStateName ?? "Scheduled",
    sportId: Number(raw.sportId ?? raw.SportId ?? 1),
    sportName: raw.sportName ?? raw.SportName ?? "Soccer",
    competitionId: Number(raw.competitionId ?? raw.CompetitionId ?? 0),
    competitionName: raw.competitionName ?? raw.CompetitionName ?? "",
    startTime: raw.startTime ?? raw.StartTime ?? new Date().toISOString(),
  };
}

export function normalizeScoreEvent(raw: any): NormalizedScoreEvent {
  const fixtureId = Number(raw.fixtureId ?? raw.FixtureId);
  const seq = Number(raw.seq ?? raw.Seq);

  if (isNaN(fixtureId) || fixtureId <= 0) {
    throw new Error(`Invalid fixture ID: ${raw.fixtureId}`);
  }
  if (isNaN(seq) || seq <= 0) {
    throw new Error(`Invalid or missing score sequence: ${raw.seq}`);
  }

  const action = raw.action ?? raw.Action ?? "";
  const eventKey = `${fixtureId}:${seq}:${action}`;

  // Robustly extract goals from Stats dictionary (Finding 1)
  const stats = raw.Stats ?? raw.stats ?? {};
  const getStatValue = (key: string): number => {
    const entry = stats[key];
    if (entry === undefined || entry === null) return 0;
    if (typeof entry === "object") {
      return Number(entry.value ?? entry.Value ?? 0);
    }
    return Number(entry);
  };

  const scoreOne =
    getStatValue("1") || Number(raw.scoreOne ?? raw.ScoreOne ?? 0);
  const scoreTwo =
    getStatValue("2") || Number(raw.scoreTwo ?? raw.ScoreTwo ?? 0);

  return {
    fixtureId,
    seq,
    ts: Number(raw.ts ?? raw.Ts ?? Date.now()),
    gameState: Number(raw.gameState ?? raw.GameState ?? 0),
    period: Number(raw.period ?? raw.Period ?? 0),
    statusId: Number(raw.statusId ?? raw.StatusId ?? 0),
    action,
    scoreOne,
    scoreTwo,
    statKey: raw.statKey !== undefined ? Number(raw.statKey) : undefined,
    statValue: raw.statValue !== undefined ? Number(raw.statValue) : undefined,
    participantId:
      raw.participantId !== undefined ? Number(raw.participantId) : undefined,
    ingestedAt: new Date().toISOString(),
    eventKey,
  };
}

export function normalizeOddsUpdate(raw: any): NormalizedOddsUpdate {
  const fixtureId = Number(raw.fixtureId ?? raw.FixtureId);
  const seq = Number(raw.seq ?? raw.Seq ?? 0);

  if (isNaN(fixtureId) || fixtureId <= 0) {
    throw new Error(`Invalid fixture ID: ${raw.fixtureId}`);
  }

  const oddsType =
    raw.super_odds_type ?? raw.superOddsType ?? raw.SuperOddsType ?? "";

  let oddsOne = 0;
  let oddsDraw = 0;
  let oddsTwo = 0;

  // Extract from PriceNames/Prices (Finding 1)
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

    if (idx1 !== -1) oddsOne = Number(prices[idx1]);
    if (idxDraw !== -1) oddsDraw = Number(prices[idxDraw]);
    if (idx2 !== -1) oddsTwo = Number(prices[idx2]);
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

  return {
    fixtureId,
    seq,
    ts: Number(raw.ts ?? raw.Ts ?? Date.now()),
    oddsOne,
    oddsDraw,
    oddsTwo,
    oddsType,
    ingestedAt: new Date().toISOString(),
  };
}
