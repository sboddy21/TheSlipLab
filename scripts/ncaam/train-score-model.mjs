import fs from 'node:fs/promises';
import { newState, enterSeason, forecast, update, hash } from './model.mjs';
import { newScoreState, enterScoreSeason, scoreInputs, updateScore, scoreDay, scoreConfig } from './score-model.mjs';

const path = process.argv[2] || new URL('../../data/ncaam/history.json', import.meta.url);
const history = JSON.parse(await fs.readFile(path, 'utf8'));
const eloConfig = JSON.parse(await fs.readFile(new URL('./model-config.json', import.meta.url), 'utf8'));
const elo = newState(), state = newScoreState(), training = [], holdout = [];
const byDay = Map.groupBy(history.toSorted((a, b) => a.kickoff.localeCompare(b.kickoff) || a.id.localeCompare(b.id)), scoreDay);
for (const [day, games] of byDay) {
  if (day < eloConfig.trainingWindow[0] || day > eloConfig.holdoutWindow[1]) continue;
  const rows = day <= eloConfig.trainingWindow[1] ? training : day >= eloConfig.holdoutWindow[0] ? holdout : null;
  if (!rows) continue;
  for (const game of games) {
    enterSeason(elo, game.season, eloConfig);
    enterScoreSeason(state, game.season);
    const inputs = scoreInputs(game, state, forecast(game, elo, eloConfig), eloConfig);
    if (inputs) rows.push({ inputs, neutral: game.neutral,
      margin: game.home.score - game.away.score, total: game.home.score + game.away.score });
  }
  // No game on the slate sees another result from the same Eastern calendar day.
  for (const game of games) { update(game, elo, eloConfig); updateScore(game, state); }
}
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
function fit(key) {
  const x = mean(training.map(row => row.inputs[key])), y = mean(training.map(row => row[key]));
  const slope = mean(training.map(row => (row.inputs[key] - x) * (row[key] - y)))
    / mean(training.map(row => (row.inputs[key] - x) ** 2));
  const intercept = y - slope * x, predict = row => intercept + slope * row.inputs[key];
  const sd = Math.sqrt(mean(training.map(row => (row[key] - predict(row)) ** 2)));
  const baseline = key === 'margin'
    ? mean(training.filter(row => !row.neutral).map(row => row.margin)) : y;
  const mae = mean(holdout.map(row => Math.abs(row[key] - predict(row))));
  const baselineMae = mean(holdout.map(row => Math.abs(row[key] - (key === 'margin' && row.neutral ? 0 : baseline))));
  const withinOneSd = mean(holdout.map(row => Number(Math.abs(row[key] - predict(row)) <= sd)));
  return { fit: { intercept, slope, sd }, evaluation: { mae, baselineMae, withinOneSd } };
}
const { fit: margin, evaluation: marginTest } = fit('margin');
const { fit: total, evaluation: totalTest } = fit('total');
const passed = holdout.length >= 1000 && [marginTest, totalTest].every(result =>
  result.mae < result.baselineMae && Math.abs(result.withinOneSd - .683) <= .10);
if (!passed) throw new Error('NCAAM score projections failed held-out error or interval coverage checks');
const artifact = {
  config: scoreConfig, configHash: hash(scoreConfig), eloConfigHash: hash(eloConfig),
  datasetHash: hash(history), state, fits: { margin, total },
  evaluation: { passed, training: training.length, holdout: holdout.length, margin: marginTest, total: totalTest }
};
await fs.writeFile(new URL('./score-model.json', import.meta.url), JSON.stringify(artifact) + '\n');
console.log(JSON.stringify(artifact.evaluation, null, 2));
