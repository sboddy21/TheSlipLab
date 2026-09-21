import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NHL_API, NHL_STATS, easternDate, normalizeGame, projectionFor, isLive, isFinal } from './core.mjs';

const OUT = new URL('../../website/data/nhl_board.json', import.meta.url);
const dateArg = process.argv.find(arg => /^\d{4}-\d{2}-\d{2}$/.test(arg));
const date = dateArg || easternDate();

async function json(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'TheSlipLab/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
  return response.json();
}

async function schedule() {
  const data = await json(`${NHL_API}/schedule/${date}`);
  const day = (data.gameWeek || []).find(item => item.date === date);
  return (day?.games || []).map(normalizeGame);
}

async function priorSkaters() {
  const season = Number(date.slice(0, 4)) - 1;
  const seasonId = `${season}${season + 1}`;
  const query = new URLSearchParams({
    isAggregate: 'false', isGame: 'false', start: '0', limit: '-1',
    sort: JSON.stringify([{ property: 'points', direction: 'DESC' }]),
    factCayenneExp: 'gamesPlayed>=1', cayenneExp: `seasonId=${seasonId} and gameTypeId=2`
  });
  const data = await json(`${NHL_STATS}/skater/summary?${query}`);
  return { seasonId: Number(seasonId), rows: Array.isArray(data.data) ? data.data : [] };
}

async function roster(abbreviation) {
  try {
    const data = await json(`${NHL_API}/roster/${abbreviation}/current`);
    return [...(data.forwards || []), ...(data.defensemen || [])].map(player => ({
      playerId: player.id, playerName: `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim(),
      position: player.positionCode, team: abbreviation
    }));
  } catch { return []; }
}

function goalsFromPlay(play, game) {
  return (play.plays || []).filter(item => item.typeDescKey === 'goal').map(item => ({
    eventId: item.eventId, gameId: game.gameId, period: item.periodDescriptor?.number,
    timeInPeriod: item.timeInPeriod, playerId: item.details?.scoringPlayerId,
    playerName: item.details?.eventOwnerTeamId === game.home.id ? game.home.name : game.away.name,
    teamId: item.details?.eventOwnerTeamId, awayScore: item.details?.awayScore, homeScore: item.details?.homeScore
  }));
}

async function liveDetails(games) {
  const goals = [], leaders = [];
  await Promise.all(games.filter(game => isLive(game.state) || isFinal(game.state)).map(async game => {
    try {
      const [play, box] = await Promise.all([
        json(`${NHL_API}/gamecenter/${game.gameId}/play-by-play`),
        json(`${NHL_API}/gamecenter/${game.gameId}/boxscore`)
      ]);
      goals.push(...goalsFromPlay(play, game));
      for (const side of ['awayTeam', 'homeTeam']) {
        const team = box.playerByGameStats?.[side];
        for (const group of ['forwards', 'defense']) for (const player of team?.[group] || []) {
          leaders.push({ gameId: game.gameId, playerId: player.playerId, playerName: player.name?.default, team: team.abbrev, goals: player.goals || 0, shots: player.sog || 0, assists: player.assists || 0 });
        }
      }
    } catch { /* One game must not invalidate the slate. */ }
  }));
  return { goals: goals.sort((a, b) => b.eventId - a.eventId), leaders: leaders.sort((a, b) => b.shots - a.shots) };
}

export async function buildBoard() {
  const generatedAt = new Date().toISOString();
  const games = await schedule();
  const teams = [...new Set(games.flatMap(game => [game.away.abbreviation, game.home.abbreviation]).filter(Boolean))];
  const [history, rosters, live] = await Promise.all([
    priorSkaters(), Promise.all(teams.map(roster)), liveDetails(games)
  ]);
  const current = new Map(rosters.flat().map(player => [String(player.playerId), player]));
  const players = history.rows.filter(player => Number(player.gamesPlayed) >= 10 && current.has(String(player.playerId))).map(player => {
    const assignment = current.get(String(player.playerId));
    const game = games.find(item => item.home.abbreviation === assignment.team || item.away.abbreviation === assignment.team);
    const opponent = game?.home.abbreviation === assignment.team ? game.away.abbreviation : game?.home.abbreviation;
    return { playerId: player.playerId, playerName: assignment.playerName || player.skaterFullName, position: assignment.position || player.positionCode, team: assignment.team, opponent, gameId: game?.gameId, ...projectionFor(player) };
  }).sort((a, b) => b.shotsProjection - a.shotsProjection);
  const matchups = games.map(game => {
    const aggregate = abbreviation => players.filter(player => player.team === abbreviation).reduce((sum, player) => sum + player.shotsProjection, 0);
    return { ...game, awayProjectedShots: +aggregate(game.away.abbreviation).toFixed(1), homeProjectedShots: +aggregate(game.home.abbreviation).toFixed(1) };
  });
  const names = new Map(players.map(player => [String(player.playerId), player.playerName]));
  live.goals = live.goals.map(goal => ({ ...goal, playerName: names.get(String(goal.playerId)) || goal.playerName }));
  return {
    schemaVersion: 1, sport: 'NHL', date, generatedAt, source: 'NHL public schedule, roster, gamecenter and stats feeds',
    status: games.length ? 'available' : 'no_games', historySeason: history.seasonId,
    freshness: { maxAgeHours: 26, schedule: generatedAt, projections: generatedAt, live: generatedAt },
    counts: { games: games.length, players: players.length, liveGames: games.filter(game => isLive(game.state)).length },
    games: matchups, players, live, errors: []
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const board = await buildBoard();
    if (board.games.length && board.players.length < 20) throw new Error(`Roster/history join produced only ${board.players.length} players`);
    await fs.mkdir(new URL('../../website/data/', import.meta.url), { recursive: true });
    await fs.writeFile(new URL(`${OUT.href}.tmp`), `${JSON.stringify(board, null, 2)}\n`);
    await fs.rename(new URL(`${OUT.href}.tmp`), OUT);
    console.log(JSON.stringify({ date: board.date, status: board.status, ...board.counts }));
  } catch (error) {
    console.error(`NHL refresh failed: ${error.message}`);
    process.exitCode = 1;
  }
}
