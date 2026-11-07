import { createHash } from 'node:crypto';

export const simulationConfig = Object.freeze({ version: 'ncaam-joint-residual-v1', draws: 2500 });

function randomFor(key) {
  let seed = createHash('sha256').update(`${simulationConfig.version}:${key}`).digest().readUInt32LE();
  // Mulberry32, seeded by matchup for stable comparisons between refreshes.
  return () => {
    seed = (seed + 0x6D2B79F5) >>> 0;
    let z = Math.imul(seed ^ (seed >>> 15), seed | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  };
}

export function simulateMatchup(key, score, residuals) {
  if (!Number.isFinite(score?.margin?.mean) || !Number.isFinite(score?.total?.mean) || !residuals.length) {
    throw new Error('Simulation requires score projections and a fitted residual bank');
  }
  const random = randomFor(key), margins = new Map(), totals = new Map();
  let homeWins = 0, homePoints = 0, awayPoints = 0;
  for (let i = 0; i < simulationConfig.draws; i++) {
    // Sample a historical margin and total error together to preserve their dependence.
    const [marginError, totalError] = residuals[Math.floor(random() * residuals.length)];
    const margin = score.margin.mean + marginError, total = score.total.mean + totalError;
    let home = Math.max(0, Math.round((total + margin) / 2));
    let away = Math.max(0, Math.round((total - margin) / 2));
    // Residuals come from finals; rounding can create ties. Resolve them symmetrically.
    if (home === away) { if (random() < .5) home++; else away++; }
    if (home > away) homeWins++;
    homePoints += home; awayPoints += away;
    margins.set(home - away, (margins.get(home - away) || 0) + 1);
    totals.set(home + away, (totals.get(home + away) || 0) + 1);
  }
  const draws = simulationConfig.draws;
  return { draws, homeWins, homePoints: homePoints / draws, awayPoints: awayPoints / draws, margins, totals };
}

export function outcomes(histogram, line) {
  const counts = { below: 0, push: 0, above: 0 };
  for (const [score, count] of histogram) counts[score < line ? 'below' : score > line ? 'above' : 'push'] += count;
  return counts;
}

export function probabilities(counts, draws) {
  return Object.fromEntries(Object.entries(counts).map(([outcome, count]) => [outcome, count / draws]));
}
