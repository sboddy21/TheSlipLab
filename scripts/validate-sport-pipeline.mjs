import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { prepareCurrentMarkets } from '../website/lib/current-markets.mjs';
import { verifyCurrentDataset } from '../website/lib/data-freshness.mjs';

export const pipelines = {
  nba: { board: 'nba_games_today.json', rows: 'games', identity: 'gameId', results: 'nba_results.json' },
  nfl: { board: 'nfl_schedule.json', rows: 'games', identity: 'gameId', results: 'nfl_results_tracking.json' },
  nhl: { board: 'nhl_board.json', rows: 'games', identity: 'gameId', results: 'nhl_results.json' },
  cfb: { board: 'cfb_board.json', rows: 'games', identity: 'id', results: 'cfb_board.json' },
  ncaam: { board: 'ncaam_board.json', rows: 'games', identity: 'id', results: 'ncaam_results.json' },
  wnba: { board: 'wnba_games_today.json', rows: 'games', identity: 'gameId', results: 'wnba_calibration.json' },
  mlb: { board: 'mlb_games_today.json', rows: 'games', identity: 'gamePk', results: 'hr_results_history.json' }
};

export async function validateSportPipeline(sport, { load, now = Date.now() } = {}) {
  const config = pipelines[sport];
  if (!config) throw Error('Unknown sport');
  const board = prepareCurrentMarkets(config.board, await load(config.board), now), errors = [];
  const freshness = await verifyCurrentDataset(config.board, board, { now, load });
  if (!freshness.available) errors.push('schedule_not_current');
  const rows = Array.isArray(board) ? board : board[config.rows];
  if (!Array.isArray(rows)) errors.push('missing_schedule_rows');
  const ids = (rows || []).map(row => row[config.identity] ?? row.id ?? row.gameId ?? row.gamePk);
  if (ids.some(id => id == null || String(id) === '')) errors.push('missing_game_identity');
  if (new Set(ids.map(String)).size !== ids.length) errors.push('duplicate_game_identity');
  const results = await load(config.results);
  if (!results || typeof results !== 'object') errors.push('missing_results_artifact');
  if (sport === 'cfb' && !Array.isArray(results.archive)) errors.push('missing_frozen_results_archive');
  if (sport === 'nhl' && !Array.isArray(results.snapshots)) errors.push('missing_frozen_results_archive');
  if (sport === 'nba' && (!Array.isArray(results.slates) || !results.marketMetrics)) errors.push('missing_graded_results');
  if (sport === 'nfl' && (!Array.isArray(results.snapshots) || !results.methodology?.snapshotRequiredBeforeKickoff)) errors.push('missing_frozen_results_archive');
  if (sport === 'wnba' && !results.markets) errors.push('missing_calibration_metrics');
  if (sport === 'ncaam' && !Array.isArray(results.games)) errors.push('missing_results_archive');
  if (sport === 'mlb' && !Array.isArray(results.days)) errors.push('missing_results_archive');
  return { sport, checkedAt: new Date(now).toISOString(), status: errors.length ? 'failed' : 'passed', schedule: { file: config.board, games: rows?.length ?? 0, freshness }, results: { file: config.results, generatedAt: results.generatedAt || results.updatedAt || null }, errors, scope: 'Schedule freshness, canonical game uniqueness, and persisted results structure. Provider/model accuracy and optional enrichments require separate evidence.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sport = process.argv[2];
  try {
    const load = async file => JSON.parse(await fs.readFile(new URL(`../website/data/${file}`, import.meta.url), 'utf8'));
    const receipt = await validateSportPipeline(sport, { load });
    console.log(JSON.stringify(receipt, null, 2));
    if (receipt.status !== 'passed') process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
