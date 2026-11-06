import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DATA = "website/data";
const MARKETS = {
  points: { field: "points", weights: [0.40, 0.38, 0.22], cap: 4 },
  rebounds: { field: "rebounds", weights: [0.42, 0.36, 0.22], cap: 2 },
  assists: { field: "assists", weights: [0.42, 0.36, 0.22], cap: 1.5 },
  threes: { field: "threesMade", weights: [0.42, 0.36, 0.22], cap: 0.75 }
};
const MIN_PRIOR_GAMES = 3;
const MIN_TRAINING_SAMPLES = 100;
const MIN_TEST_SAMPLES = 40;

const round = value => Math.round(Number(value) * 10) / 10;
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
const mae = rows => rows.length ? mean(rows.map(row => Math.abs(row.prediction - row.actual))) : null;

function prediction(prior, field, weights) {
  const season = mean(prior.map(row => Number(row[field]) || 0));
  const last5 = mean(prior.slice(-5).map(row => Number(row[field]) || 0));
  const last10 = mean(prior.slice(-10).map(row => Number(row[field]) || 0));
  return season * weights[0] + last5 * weights[1] + last10 * weights[2];
}

export function buildNbaModelBacktest(history, date, now = Date.now()) {
  const samples = Object.fromEntries(Object.keys(MARKETS).map(market => [market, []]));
  for (const player of history.players || []) {
    const games = [...(player.recentGames || [])].sort((a, b) => String(a.gameDate).localeCompare(String(b.gameDate)));
    for (let index = MIN_PRIOR_GAMES; index < games.length; index += 1) {
      const prior = games.slice(0, index).filter(game => String(game.gameDate).slice(0, 10) < String(games[index].gameDate).slice(0, 10));
      if (prior.length < MIN_PRIOR_GAMES) continue;
      for (const [market, config] of Object.entries(MARKETS)) {
        if (games[index][config.field] == null || !Number.isFinite(Number(games[index][config.field])) || prior.some(game => game[config.field] == null || !Number.isFinite(Number(game[config.field])))) continue;
        samples[market].push({
          date: games[index].gameDate,
          playerId: player.playerId,
          baseline: mean(prior.map(game => Number(game[config.field]))),
          prediction: prediction(prior, config.field, config.weights),
          actual: Number(games[index][config.field]) || 0
        });
      }
    }
  }

  const markets = {};
  for (const [market, rows] of Object.entries(samples)) {
    rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.playerId).localeCompare(String(b.playerId)));
    const dates = [...new Set(rows.map(row => String(row.date).slice(0, 10)))];
    const splitDate = dates[Math.floor(dates.length * 0.7)];
    const training = rows.filter(row => String(row.date).slice(0, 10) < splitDate);
    const test = rows.filter(row => String(row.date).slice(0, 10) >= splitDate);
    const baselineTestMae = test.length ? mean(test.map(row => Math.abs(row.baseline - row.actual))) : null;
    const trainingBias = training.length ? mean(training.map(row => row.prediction - row.actual)) : 0;
    const candidateCorrection = Math.max(-MARKETS[market].cap, Math.min(MARKETS[market].cap, -trainingBias));
    const rawTestMae = mae(test);
    const calibratedTest = test.map(row => ({ ...row, prediction: Math.max(0, row.prediction + candidateCorrection) }));
    const calibratedTestMae = mae(calibratedTest);
    const adequate = training.length >= MIN_TRAINING_SAMPLES && test.length >= MIN_TEST_SAMPLES;
    const improves = adequate && calibratedTestMae < rawTestMae * 0.98 && calibratedTestMae < baselineTestMae * 0.98;
    markets[market] = {
      samples: rows.length,
      trainingSamples: training.length,
      testSamples: test.length,
      trainingThrough: training.at(-1)?.date || null,
      testFrom: test[0]?.date || null,
      testDates: new Set(test.map(row => String(row.date).slice(0, 10))).size,
      baselineTestMae: baselineTestMae == null ? null : round(baselineTestMae),
      evaluatedModel: 'walk_forward_rate_baseline',
      validatesLiveProjectionPipeline: false,
      rawTestMae: rawTestMae == null ? null : round(rawTestMae),
      calibratedTestMae: calibratedTestMae == null ? null : round(calibratedTestMae),
      trainingBias: training.length ? round(trainingBias) : null,
      candidateCorrection: round(candidateCorrection),
      candidateImprovement: improves,
      correction: 0,
      correctionApplied: false,
      status: improves ? "candidate_improvement_research_only" : adequate ? "no_improvement" : "insufficient_samples"
    };
  }

  return {
    sport: "NBA",
    version: "1.0",
    date,
    historyAsOf: history.dataAsOf || history.fetchedAt || history.generatedAt || null,
    historySeason: history.season || null,
    generatedAt: new Date(now).toISOString(),
    method: "chronological_walk_forward_70_30_holdout",
    minimumPriorGames: MIN_PRIOR_GAMES,
    minimumTrainingSamples: MIN_TRAINING_SAMPLES,
    minimumTestSamples: MIN_TEST_SAMPLES,
    markets,
    notes: [
      "Each prediction uses only games from dates before the target game; dates never cross the training/test split.",
      "This diagnostic tests a rate baseline, not the full live projection pipeline or a priced betting strategy.",
      "Corrections are learned on the chronological training split and must improve held-out MAE over both the raw model and season-mean baseline by at least 2%.",
      "Correction magnitude is capped by market to reduce overfitting."
    ]
  };
}

export function applyNbaCalibration(value, market, backtest) {
  const correction = backtest?.markets?.[market]?.validatesLiveProjectionPipeline === true && backtest?.markets?.[market]?.correctionApplied ? Number(backtest.markets[market].correction) || 0 : 0;
  return { value: round(Math.max(0, Number(value) + correction)), correction, applied: correction !== 0 };
}

function main() {
  const history = JSON.parse(fs.readFileSync(path.join(DATA, "nba_history.json"), "utf8"));
  const output = buildNbaModelBacktest(history, history.date);
  fs.writeFileSync(path.join(DATA, "nba_model_backtest.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log("NBA MODEL BACKTEST COMPLETE");
  for (const [market, result] of Object.entries(output.markets)) console.log(`${market}: ${result.status}; ${result.samples} samples; test MAE ${result.calibratedTestMae ?? "n/a"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
