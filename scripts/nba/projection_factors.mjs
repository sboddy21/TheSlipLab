const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round1 = value => Math.round(num(value) * 10) / 10;

const marketConfig = {
  points: { history: "points", rank: "rankPointsAllowed", absence: "fieldGoalAttempts", cap: 0.1 },
  rebounds: { history: "rebounds", rank: "rankReboundsAllowed", absence: "rebounds", cap: 0.08 },
  assists: { history: "assists", rank: "rankAssistsAllowed", absence: "assists", cap: 0.1 },
  threes: { history: "threesMade", rank: "rankThreesAllowed", absence: "threesAttempted", cap: 0.1 }
};

function standardDeviation(values) {
  const rows = values.map(num).filter(value => value >= 0);
  if (rows.length < 2) return 0;
  const mean = rows.reduce((sum, value) => sum + value, 0) / rows.length;
  return Math.sqrt(rows.reduce((sum, value) => sum + (value - mean) ** 2, 0) / rows.length);
}

export function buildTeamAbsenceContext(players) {
  const context = new Map();
  for (const player of players || []) {
    const status = String(player.minutes?.availabilityStatus || player.status || "").toUpperCase();
    if (!["OUT", "DOUBTFUL"].includes(status)) continue;
    const team = String(player.teamAbbr || player.team || "");
    const season = player.history?.season || {};
    if (!context.has(team)) context.set(team, { players: [], fieldGoalAttempts: 0, rebounds: 0, assists: 0, threesAttempted: 0 });
    const row = context.get(team);
    row.players.push(player.player);
    for (const field of ["fieldGoalAttempts", "rebounds", "assists", "threesAttempted"]) row[field] += num(season[field]);
  }
  return context;
}

export function projectMarket({ market, base, player, defense, pace, absenceContext, minutesConfidence = 0 }) {
  const config = marketConfig[market];
  const seasonMinutes = num(player.history?.season?.minutes || player.profile?.seasonMinutes);
  const expectedMinutes = num(player.minutes?.expected || player.expectedMinutes || seasonMinutes);
  const minutesFactor = seasonMinutes > 0 ? clamp(expectedMinutes / seasonMinutes, 0.82, 1.18) : 1;
  const rank = num(defense?.[config.rank]);
  const defenseFactor = rank >= 26 ? 1.04 : rank >= 21 ? 1.025 : rank > 0 && rank <= 5 ? 0.96 : rank > 0 && rank <= 10 ? 0.975 : 1;
  const paceRank = num(pace?.rankPace);
  const paceFactor = paceRank > 0 && paceRank <= 5 ? 1.025 : paceRank <= 10 && paceRank > 0 ? 1.015 : paceRank >= 26 ? 0.975 : paceRank >= 21 ? 0.985 : 1;
  const recentGames = player.history?.recentGames || [];
  const lastGame = recentGames[0]?.gameDate ? Date.parse(recentGames[0].gameDate) : NaN;
  const gameTime = player.gameTimeUTC ? Date.parse(player.gameTimeUTC) : NaN;
  const restDays = Number.isFinite(lastGame) && Number.isFinite(gameTime) ? Math.max(0, Math.floor((gameTime - lastGame) / 86400000) - 1) : null;
  const restFactor = restDays === 0 ? 0.98 : restDays >= 3 ? 1.01 : 1;
  const missing = absenceContext?.get(String(player.teamAbbr || player.team || "")) || null;
  const missingVolume = num(missing?.[config.absence]);
  const absenceBoost = clamp(missingVolume * 0.0025, 0, config.cap);
  const totalFactor = clamp(minutesFactor * defenseFactor * paceFactor * restFactor * (1 + absenceBoost), 0.78, 1.22);
  const projection = round1(num(base) * totalFactor);
  const volatility = standardDeviation(recentGames.slice(0, 10).map(game => game[config.history]));
  const confidenceWidth = 1 + clamp((100 - num(minutesConfidence)) / 100, 0, 0.65);
  const rangeWidth = Math.max(market === "points" ? 2 : 0.8, volatility * confidenceWidth);
  return {
    projection,
    floor: round1(Math.max(0, projection - rangeWidth)),
    ceiling: round1(projection + rangeWidth),
    volatility: round1(volatility),
    minutesFactor: round1(minutesFactor),
    defenseFactor: round1(defenseFactor),
    paceFactor: round1(paceFactor),
    restFactor: round1(restFactor),
    restDays,
    backToBack: restDays === 0,
    absenceBoostPct: round1(absenceBoost * 100),
    absentTeammates: missing?.players || [],
    totalAdjustment: round1(projection - num(base))
  };
}
