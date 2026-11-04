export const MARKETS = [
  ["points", "Points"], ["rebounds", "Rebounds"], ["assists", "Assists"], ["threes", "Threes"],
  ["pra", "PRA"], ["pointsRebounds", "Pts+Reb"], ["reboundsAssists", "Reb+Assist"],
  ["firstBasket", "First Basket"], ["doubleDouble", "Double Double"], ["tripleDouble", "Triple Double"]
];

export function gameValue(game, market) {
  const points = Number(game?.points) || 0;
  const rebounds = Number(game?.rebounds) || 0;
  const assists = Number(game?.assists) || 0;
  if (market === "points") return points;
  if (market === "rebounds") return rebounds;
  if (market === "assists") return assists;
  if (market === "threes") return Number(game?.threesMade) || 0;
  if (market === "pra") return points + rebounds + assists;
  if (market === "pointsRebounds") return points + rebounds;
  if (market === "reboundsAssists") return rebounds + assists;
  const doubleDigitCategories = [points, rebounds, assists].filter(value => value >= 10).length;
  if (market === "doubleDouble") return Number(doubleDigitCategories >= 2);
  if (market === "tripleDouble") return Number(doubleDigitCategories === 3);
  return null;
}

export function classifyLastFive(values, baseline, { binary = false } = {}) {
  const sample = values.slice(0, 5).map(Number).filter(Number.isFinite);
  if (sample.length < 5) return { key: "unrated", label: "Needs 5 games", hitCount: null, average: null };
  if (binary) {
    const hits = sample.reduce((sum, value) => sum + Number(value > 0), 0);
    const recentHit = sample.slice(0, 2).some(Boolean);
    if (hits >= 4) return { key: "hot", label: "Hot look", hitCount: hits, average: hits / 5 };
    if (hits === 3) return { key: "good", label: "Good chance", hitCount: hits, average: hits / 5 };
    if (hits >= 1 && recentHit) return { key: "sleeper", label: "Sleeper", hitCount: hits, average: hits / 5 };
    return { key: "cold", label: "Cold", hitCount: hits, average: hits / 5 };
  }
  const target = Number(baseline);
  if (!Number.isFinite(target) || target <= 0) return { key: "unrated", label: "No baseline", hitCount: null, average: null };
  const average = sample.reduce((sum, value) => sum + value, 0) / 5;
  const hits = sample.filter(value => value >= target).length;
  const recentAverage = (sample[0] + sample[1]) / 2;
  const earlierAverage = (sample[2] + sample[3] + sample[4]) / 3;
  if (hits >= 4 && average >= target * 1.1) return { key: "hot", label: "Hot look", hitCount: hits, average };
  if (hits >= 3 && average >= target) return { key: "good", label: "Good chance", hitCount: hits, average };
  if (hits >= 2 && recentAverage >= target && recentAverage >= earlierAverage * 1.1) return { key: "sleeper", label: "Sleeper", hitCount: hits, average };
  return { key: "cold", label: "Cold", hitCount: hits, average };
}

export function baselineFor(card, market) {
  const production = card?.production || {};
  if (market === "points") return production.seasonPoints;
  if (market === "rebounds") return production.seasonRebounds;
  if (market === "assists") return production.seasonAssists;
  if (market === "threes") return production.seasonThrees;
  if (market === "pra") return Number(production.seasonPoints) + Number(production.seasonRebounds) + Number(production.seasonAssists);
  if (market === "pointsRebounds") return Number(production.seasonPoints) + Number(production.seasonRebounds);
  if (market === "reboundsAssists") return Number(production.seasonRebounds) + Number(production.seasonAssists);
  return null;
}
