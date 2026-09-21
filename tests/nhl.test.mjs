import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGame, projectionFor } from '../scripts/nhl/core.mjs';

test('NHL projections stay finite and bounded', () => {
  const row = projectionFor({ gamesPlayed: 82, shots: 246, goals: 41, assists: 50, timeOnIcePerGame: 1200 });
  assert.equal(row.shotsProjection, 2.82);
  assert.ok(row.goalProbability > 0 && row.goalProbability < 100);
  assert.ok(row.pointsProjection > row.assistsProjection);
});

test('NHL schedule normalization keeps canonical identity', () => {
  const game = normalizeGame({ id: 12, gameType: 2, season: 20262027, startTimeUTC: '2026-09-29T23:00:00Z', gameState: 'FUT', awayTeam: { id: 1, abbrev: 'NJD', placeName: { default: 'New Jersey' }, commonName: { default: 'Devils' } }, homeTeam: { id: 3, abbrev: 'NYR', placeName: { default: 'New York' }, commonName: { default: 'Rangers' } } });
  assert.equal(game.gameId, 12);
  assert.equal(game.away.name, 'New Jersey Devils');
  assert.equal(game.home.abbreviation, 'NYR');
});
