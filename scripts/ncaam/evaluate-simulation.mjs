import fs from 'node:fs/promises';
import { newState, enterSeason, forecast, update, hash } from './model.mjs';
import { newScoreState, enterScoreSeason, scoreInputs, updateScore, scoreDay, scoreConfig } from './score-model.mjs';
import { simulationConfig, simulateMatchup, outcomes, probabilities } from './simulation.mjs';
import { lineProbabilities } from '../../website/assets/ncaam-markets.mjs';

const read = async relative => JSON.parse(await fs.readFile(new URL(relative, import.meta.url), 'utf8'));
const [history, config, scores] = await Promise.all([
  read('../../data/ncaam/history.json'), read('./model-config.json'), read('./score-model.json')
]);
if (scores.datasetHash !== hash(history) || scores.eloConfigHash !== hash(config)
  || scores.configHash !== hash(scoreConfig) || !scores.evaluation.passed) {
  throw new Error('Historical data or score model does not match the validated artifact');
}

const [trainingStart, trainingEnd] = config.trainingWindow;
const [testStart, testEnd] = config.holdoutWindow;
const elo = newState(), scoreState = newScoreState(), residuals = [], holdout = [];
const byDay = Map.groupBy(history.toSorted((a,b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id)), scoreDay);
for (const [day, games] of byDay) {
  const training = day >= trainingStart && day <= trainingEnd;
  const testing = day >= testStart && day <= testEnd;
  if (!training && !testing) continue;
  for (const game of games) {
    enterSeason(elo, game.season, config);
    enterScoreSeason(scoreState, game.season);
    const p = forecast(game, elo, config), inputs = scoreInputs(game, scoreState, p, config);
    if (!inputs || !p.hasTeamHistory) continue;
    const project = key => ({ mean: scores.fits[key].intercept + scores.fits[key].slope * inputs[key], sd: scores.fits[key].sd });
    const score = { margin: project('margin'), total: project('total') };
    const margin = game.home.score - game.away.score, total = game.home.score + game.away.score;
    if (training) residuals.push([margin - score.margin.mean, total - score.total.mean].map(n => Math.round(n * 100) / 100));
    else holdout.push({ day, id: game.id, score, margin, total, homeWin: p.homeProbability });
  }
  // Update only after all forecasts for this day; no same-day finals leak in.
  for (const game of games) { update(game, elo, config); updateScore(game, scoreState); }
}

if (residuals.length !== scores.evaluation.training || holdout.length !== scores.evaluation.holdout) {
  throw new Error('Unexpected training or holdout sample size');
}

const mean = rows => rows.reduce((sum, x) => sum + x, 0) / rows.length;
const brier = (prediction, observed) => Object.entries(prediction)
  .reduce((sum, [k, p]) => sum + (p - Number(k === observed)) ** 2, 0) / 2;
// Fixed synthetic lines around the current model. Include a whole number for pushes.
const testLines = ({mean}) => [Math.floor(mean) - 4.5, Math.round(mean), Math.ceil(mean) + 4.5];
function lineLosses(projected, actual, histogram, draws) {
  const lines = testLines(projected);
  const rows = lines.map(line => {
    const result = actual < line ? 'below' : actual > line ? 'above' : 'push';
    return {
      baseline: brier(lineProbabilities(line, projected), result),
      simulated: brier(probabilities(outcomes(histogram, line), draws), result)
    };
  });
  return { baseline: mean(rows.map(r => r.baseline)), simulated: mean(rows.map(r => r.simulated)) };
}
const comparisons = { moneyline: [], spread: [], total: [] };
for (const game of holdout) {
  const sim = simulateMatchup(game.id, game.score, residuals);
  const result = Number(game.margin > 0);
  comparisons.moneyline.push({ day: game.day,
    baseline: (game.homeWin - result) ** 2, simulated: (sim.homeWins / sim.draws - result) ** 2 });
  comparisons.spread.push({ day: game.day, ...lineLosses(game.score.margin, game.margin, sim.margins, sim.draws) });
  comparisons.total.push({ day: game.day, ...lineLosses(game.score.total, game.total, sim.totals, sim.draws) });
}

function summarize(rows) {
  const currentBrier = mean(rows.map(row => row.baseline)), simulationBrier = mean(rows.map(row => row.simulated));
  const delta = simulationBrier - currentBrier;
  const groups = Map.groupBy(rows, row => row.day);
  const squared = [...groups.values()].reduce((sum, group) => sum
    + group.reduce((x, row) => x + row.simulated - row.baseline - delta, 0) ** 2, 0);
  const half = 1.96 * Math.sqrt(groups.size / (groups.size - 1) * squared) / rows.length;
  return { currentBrier, simulationBrier, delta, approximateDayClustered95: [delta-half, delta+half] };
}
const markets = Object.fromEntries(Object.entries(comparisons).map(([market, rows]) => [market, summarize(rows)]));
const holdoutGatePassed = Object.values(markets).every(row => row.approximateDayClustered95[1] <= 0);
const model = {
  ...simulationConfig, datasetHash: scores.datasetHash, scoreArtifactHash: hash(scores),
  residuals, residualHash: hash(residuals)
};
const report = {
  ...simulationConfig, trainingWindow: config.trainingWindow, holdoutWindow: config.holdoutWindow,
  datasetHash: model.datasetHash, scoreArtifactHash: model.scoreArtifactHash, residualHash: model.residualHash,
  trainingGames: residuals.length, holdoutGames: holdout.length, markets, holdoutGatePassed,
  gate: 'All three upper bounds on paired Brier change must be nonpositive; shadow mode remains manual regardless.',
  limitations: [
    'Spread and total were tested on three synthetic lines per game, including one integer. No historical sportsbook prices or betting returns were evaluated.',
    'Intervals are approximate and cluster by Eastern date. Teams recurring across dates can introduce dependence.',
    'One season of held-out results does not establish future market calibration.'
  ]
};
for (const [relative, value] of [['./simulation-model.json', model], ['../../data/ncaam/simulation-validation.json', report]]) {
  await fs.writeFile(new URL(relative, import.meta.url), JSON.stringify(value, null, relative.includes('validation') ? 2 : 0) + '\n');
}
console.log(JSON.stringify(report, null, 2));
