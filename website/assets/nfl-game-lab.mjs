export const clampProbability = value => Math.max(0.08, Math.min(0.92, value));
export const logistic = value => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, value))));

export function projectGame(homeContext, awayContext, market = {}) {
  if (!homeContext?.scoringEnvironment || !awayContext?.scoringEnvironment) return null;
  const homeTd = Number(homeContext.scoringEnvironment.projectedTeamTouchdownsBaseline);
  const awayTd = Number(awayContext.scoringEnvironment.projectedTeamTouchdownsBaseline);
  const pace = (Number(homeContext.scoringEnvironment.paceIndex) + Number(awayContext.scoringEnvironment.paceIndex)) / 200;
  if (![homeTd, awayTd, pace].every(Number.isFinite)) return null;
  const homePoints = homeTd * 6.7 + 5.1;
  const awayPoints = awayTd * 6.7 + 5.1;
  const margin = homePoints - awayPoints;
  const total = (homePoints + awayPoints) * Math.max(0.9, Math.min(1.1, pace));
  const homeWinProbability = clampProbability(logistic(margin / 8));
  const hasSpread = market.homeSpread !== null && market.homeSpread !== undefined && Number.isFinite(Number(market.homeSpread));
  const hasTotal = market.total !== null && market.total !== undefined && Number.isFinite(Number(market.total));
  const homeCoverProbability = hasSpread ? clampProbability(logistic((margin + Number(market.homeSpread)) / 6.5)) : null;
  const overProbability = hasTotal ? clampProbability(logistic((total - Number(market.total)) / 8.5)) : null;
  return {
    homePoints, awayPoints, margin, total,
    homeWinProbability, awayWinProbability: 1 - homeWinProbability,
    homeCoverProbability, awayCoverProbability: homeCoverProbability === null ? null : 1 - homeCoverProbability,
    overProbability, underProbability: overProbability === null ? null : 1 - overProbability
  };
}

export function playerOverProbability(projection, line, market) {
  const scale = market === "player_pass_yds" ? 28 : market === "player_rush_yds" ? 13 : 14;
  if (line === null || line === undefined || !Number.isFinite(Number(projection)) || !Number.isFinite(Number(line))) return null;
  return clampProbability(logistic((Number(projection) - Number(line)) / scale));
}
