import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { easternDate } from './core.mjs';
import { hash } from './model.mjs';
import { simulationConfig, simulateMatchup, outcomes, probabilities } from './simulation.mjs';
import { currentNcaamQuotes, ncaamMarketReads, ncaamReferenceLine } from '../../website/assets/ncaam-markets.mjs';

export function buildSimulationShadow(board, model, scoreArtifact, now = Date.now()) {
  if (model.version !== simulationConfig.version || model.draws !== simulationConfig.draws
    || model.datasetHash !== scoreArtifact.datasetHash || model.scoreArtifactHash !== hash(scoreArtifact)
    || model.residuals?.length !== scoreArtifact.evaluation.training || hash(model.residuals) !== model.residualHash) {
    throw new Error('Simulation artifact does not match the score model');
  }
  const age = now - Date.parse(board.generatedAt);
  if (board.sport !== 'NCAAM' || board.date !== easternDate(new Date(now))
    || !(age >= -1000 && age < 20 * 60_000) || !Array.isArray(board.games)
    || board.model?.status !== 'validated_winner_forecasts' || !board.model?.scoreValidation?.passed) {
    throw new Error('Simulation requires a current NCAAM board with score projections');
  }
  const games = [];
  const skipped = { noScoreProjection: 0 };
  for (const game of board.games) {
    if (game.state !== 'pre' || !(Date.parse(game.kickoff) > now)) continue;
    const score = game.prediction?.score;
    if (score?.version !== scoreArtifact.config.version || !Number.isFinite(score.margin?.mean)
      || !Number.isFinite(score.total?.mean)) {
      skipped.noScoreProjection++;
      continue;
    }
    const sim = simulateMatchup(game.id, score, model.residuals);
    const quotes = currentNcaamQuotes(game, now);
    const spread = ncaamReferenceLine(quotes, 'spread'), total = ncaamReferenceLine(quotes, 'total');
    const spreadCounts = spread ? outcomes(sim.margins, -spread.line) : null;
    const totalCounts = total ? outcomes(sim.totals, total.line) : null;
    games.push({
      id: game.id, kickoff: game.kickoff, away: game.away.name, home: game.home.name,
      averageScore: { away: sim.awayPoints, home: sim.homePoints },
      moneyline: probabilities({ home: sim.homeWins, away: sim.draws-sim.homeWins }, sim.draws),
      spread: spreadCounts ? { homeLine: spread.line,
        ...probabilities({ home: spreadCounts.above, away: spreadCounts.below, push: spreadCounts.push }, sim.draws) } : null,
      total: totalCounts ? { line: total.line,
        ...probabilities({ over: totalCounts.above, under: totalCounts.below, push: totalCounts.push }, sim.draws) } : null,
      currentReads: Object.fromEntries(ncaamMarketReads(game, now).map(read =>
        [read.market, { selection: read.selection, probability: read.probability, line: read.line ?? null }]))
    });
  }
  return {
    schemaVersion: 1, status: 'shadow_only', version: model.version, drawsPerGame: model.draws,
    date: board.date, generatedAt: new Date(now).toISOString(), boardGeneratedAt: board.generatedAt,
    games, skipped
  };
}

async function run() {
  const read = async relative => JSON.parse(await fs.readFile(new URL(relative, import.meta.url), 'utf8'));
  const [board, model, score] = await Promise.all([
    read('../../website/data/ncaam_board.json'), read('./simulation-model.json'), read('./score-model.json')
  ]);
  const result = buildSimulationShadow(board, model, score);
  const target = new URL('../../data/ncaam/simulation-shadow.json', import.meta.url);
  const temp = new URL(target.href + '.' + process.pid + '.tmp');
  await fs.writeFile(temp, JSON.stringify(result) + '\n');
  await fs.rename(temp, target);
  console.log(JSON.stringify({ date: result.date, simulatedGames: result.games.length,
    draws: result.games.length * result.drawsPerGame, skipped: result.skipped }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { await run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
