import { easternDate } from './core.mjs';

export const scoreConfig = { version: 'ncaam-score-v1', leaguePoints: 72, priorGames: 8, retention: .5, minimumGames: 8 };
export const newScoreState = () => ({ season: null, teams: {} });

export function enterScoreSeason(state, season) {
  if (state.season === season) return;
  if (state.season !== null && season < state.season) throw new Error('Score model history must be chronological');
  for (const team of Object.values(state.teams)) {
    for (const key of ['scored', 'allowed', 'weight']) team[key] *= scoreConfig.retention;
  }
  state.season = season;
}

export function updateScore(game, state) {
  if (!game.completed || !Number.isFinite(game.home.score) || !Number.isFinite(game.away.score)
    || game.home.score === game.away.score) return;
  enterScoreSeason(state, game.season);
  for (const [team, opponent] of [[game.home, game.away], [game.away, game.home]]) {
    const row = state.teams[team.id] ||= { scored: 0, allowed: 0, weight: 0, games: 0 };
    row.scored += team.score;
    row.allowed += opponent.score;
    row.weight++;
    row.games++;
  }
}

export function scoreInputs(game, state, prediction, eloConfig) {
  const home = state.teams[game.home.id], away = state.teams[game.away.id];
  if (Math.min(home?.games || 0, away?.games || 0) < scoreConfig.minimumGames) return null;
  const teamTotal = team => (team.scored + team.allowed + 2 * scoreConfig.leaguePoints * scoreConfig.priorGames)
    / (team.weight + scoreConfig.priorGames);
  return {
    margin: prediction.homeRating - prediction.awayRating + (game.neutral ? 0 : eloConfig.homeAdvantage),
    total: (teamTotal(home) + teamTotal(away)) / 2
  };
}

export function projectScore(game, state, prediction, eloConfig, artifact) {
  const inputs = scoreInputs(game, state, prediction, eloConfig);
  if (!inputs || !artifact?.evaluation.passed) return null;
  const project = market => {
    const { intercept, slope, sd } = artifact.fits[market];
    return { mean: intercept + slope * inputs[market], sd };
  };
  return { version: scoreConfig.version, margin: project('margin'), total: project('total') };
}

export const scoreDay = game => easternDate(new Date(game.kickoff));
