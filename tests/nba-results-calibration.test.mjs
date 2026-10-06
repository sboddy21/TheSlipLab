import assert from "node:assert/strict";
import test from "node:test";
import { buildCalibration, buildResults, updateTracking } from "../scripts/nba/build_nba_results_calibration.mjs";

const now = Date.parse("2026-10-20T20:00:00Z");
const basePlayer = { gameId: "g1", gameTimeUTC: "2026-10-20T23:00:00Z", playerId: "p1", player: "Test Player", team: "BOS", opponent: "DET", publicationEligible: true, expectedMinutes: 34, minutesConfidence: 90 };
const boards = {
  points: { players: [{ ...basePlayer, pointsLean: 22, pointsScore: 80 }] },
  rebounds: { players: [{ ...basePlayer, reboundsLean: 7, reboundsScore: 75 }] },
  assists: { players: [{ ...basePlayer, assistsLean: 5, assistsScore: 72 }] },
  threes: { players: [{ ...basePlayer, threesLean: 2, threesScore: 70 }] }
};
const pregame = { date: "2026-10-20", games: [{ gameId: "g1", gameStatus: 1, gameTimeUTC: basePlayer.gameTimeUTC }] };

test("NBA pregame projections freeze once and settle only from final box scores", () => {
  const captured = updateTracking({ games: pregame, pool: { players: [] }, ...boards, lines: { lines: [] }, history: { sport: "NBA", snapshots: [] } }, now);
  assert.equal(captured.snapshots.length, 1);
  assert.equal(captured.snapshots[0].projections.points, 22);
  assert.equal(captured.snapshots[0].status, "pending");

  const changed = { ...boards, points: { players: [{ ...basePlayer, pointsLean: 30, pointsScore: 90 }] } };
  const frozen = updateTracking({ games: pregame, pool: { players: [] }, ...changed, lines: { lines: [] }, history: captured }, now + 60_000);
  assert.equal(frozen.snapshots.length, 1);
  assert.equal(frozen.snapshots[0].projections.points, 22);

  const finalGames = { ...pregame, games: [{ ...pregame.games[0], gameStatus: 3 }] };
  const pool = { players: [{ gameId: "g1", playerId: "p1", played: true, boxScore: { points: 25, rebounds: 8, assists: 4, threesMade: 3, minutes: "PT34M" } }] };
  const settled = updateTracking({ games: finalGames, pool, ...changed, lines: { lines: [] }, history: frozen }, now + 4 * 3600_000);
  assert.equal(settled.snapshots[0].status, "graded");
  assert.equal(settled.snapshots[0].errors.points, 3);
  assert.equal(settled.snapshots[0].signedErrors.points, -3);

  const calibration = buildCalibration(settled, pregame.date, now + 4 * 3600_000);
  assert.equal(calibration.gradedPlayers, 1);
  assert.equal(calibration.markets.points.mae, 3);
  assert.equal(calibration.markets.points.projectionPassing, false);
  assert.equal(calibration.pricedStrategyStatus, "locked_unvalidated");
  const results = buildResults(settled, calibration, pregame.date, now + 4 * 3600_000);
  assert.equal(results.gradedPlayers, 1);
  assert.equal(results.slates[0].players[0].actual.points, 25);
});

test("NBA DNPs are recorded but excluded from calibration", () => {
  const captured = updateTracking({ games: pregame, pool: { players: [] }, ...boards, lines: { lines: [] }, history: { sport: "NBA", snapshots: [] } }, now);
  const finalGames = { ...pregame, games: [{ ...pregame.games[0], gameStatus: 3 }] };
  const settled = updateTracking({ games: finalGames, pool: { players: [{ gameId: "g1", playerId: "p1", played: false }] }, ...boards, lines: { lines: [] }, history: captured }, now + 4 * 3600_000);
  assert.equal(settled.snapshots[0].status, "dnp");
  assert.equal(buildCalibration(settled, pregame.date).gradedPlayers, 0);
});
