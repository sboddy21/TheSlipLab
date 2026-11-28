import { NHL_API } from './core.mjs';

const finite = value => value !== null && value !== '' && Number.isFinite(Number(value));
export function updateNhlResults(history, board, boxes = [], now = Date.now()) {
  const out = structuredClone(history || { sport: 'NHL', schemaVersion: 1, snapshots: [] });
  const existing = new Set(out.snapshots.map(row => `${row.gameId}:${row.playerId}`));
  const games = new Map(board.games.map(game => [String(game.gameId), game]));
  for (const player of board.players) {
    const game = games.get(String(player.gameId)), key = `${player.gameId}:${player.playerId}`;
    if (!game || existing.has(key) || game.state !== 'FUT' || !Number.isFinite(Date.parse(game.startTimeUTC)) || Date.parse(game.startTimeUTC) <= now) continue;
    if (![player.shotsProjection, player.pointsProjection, player.assistsProjection, player.goalProbability].every(finite)) continue;
    out.snapshots.push({ gameId: player.gameId, playerId: player.playerId, player: player.playerName, team: player.team, date: board.date, kickoff: game.startTimeUTC, capturedAt: new Date(now).toISOString(), status: 'pending', projections: { shots: player.shotsProjection, points: player.pointsProjection, assists: player.assistsProjection, goalProbability: player.goalProbability / 100 } });
    existing.add(key);
  }
  const finals = new Map(boxes.filter(box => ['FINAL', 'OFF'].includes(box.gameState)).map(box => [String(box.id), box]));
  for (const row of out.snapshots) {
    if (row.status !== 'pending' || !Number.isFinite(Date.parse(row.capturedAt)) || !Number.isFinite(Date.parse(row.kickoff)) || Date.parse(row.capturedAt) >= Date.parse(row.kickoff)) continue;
    const box = finals.get(String(row.gameId));
    if (!box) continue;
    const players = ['awayTeam', 'homeTeam'].flatMap(side => ['forwards', 'defense'].flatMap(group => box.playerByGameStats?.[side]?.[group] || []));
    const matches = players.filter(player => String(player.playerId) === String(row.playerId));
    if (matches.length !== 1) continue; // Missing participation is not a DNP.
    const player = matches[0];
    if (![player.goals, player.assists, player.sog].every(finite)) continue;
    row.actual = { shots: Number(player.sog), assists: Number(player.assists), points: Number(player.goals) + Number(player.assists), scored: Number(player.goals) > 0 ? 1 : 0 };
    row.status = 'graded'; row.settledAt = new Date(now).toISOString(); row.actualSource = `${NHL_API}/gamecenter/${row.gameId}/boxscore`;
  }
  out.generatedAt = new Date(now).toISOString();
  const graded = out.snapshots.filter(row => row.status === 'graded');
  out.counts = { captured: out.snapshots.length, graded: graded.length, pending: out.snapshots.filter(row => row.status === 'pending').length };
  out.metrics = Object.fromEntries(['shots', 'points', 'assists'].map(key => [key, { samples: graded.length, mae: graded.length ? graded.reduce((sum, row) => sum + Math.abs(row.projections[key] - row.actual[key]), 0) / graded.length : null }]));
  out.metrics.goalProbability = { samples: graded.length, brier: graded.length ? graded.reduce((sum, row) => sum + (row.projections.goalProbability - row.actual.scored) ** 2, 0) / graded.length : null };
  out.pricedStrategyValidated = false;
  return out;
}

export async function collectNhlFinals(history, { fetcher = fetch, now = Date.now(), limit = 40 } = {}) {
  const ids = [...new Set((history.snapshots || []).filter(row => row.status === 'pending' && Date.parse(row.kickoff) < now).map(row => String(row.gameId)))].slice(0, limit);
  const boxes = [], errors = [];
  for (let index = 0; index < ids.length; index += 4) {
    await Promise.all(ids.slice(index, index + 4).map(async id => {
      try {
        if (!/^\d+$/.test(id)) throw Error('Invalid NHL game ID');
        const response = await fetcher(`${NHL_API}/gamecenter/${id}/boxscore`, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        const box = await response.json();
        if (String(box.id) !== id) throw Error('Box-score identity mismatch');
        boxes.push(box);
      } catch (error) { errors.push({ gameId: id, message: error.message }); }
    }));
  }
  return { boxes, errors };
}
