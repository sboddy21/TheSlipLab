import test from "node:test";
import assert from "node:assert/strict";
import { backtestFirstBasketModel, buildFirstBasketProfiles, parseFirstBasketGame, scoreFirstBasketGame } from "../scripts/nba/first_basket_model.mjs";

function summary() {
  const athlete = (id, teamId) => ({ starter: true, didNotPlay: false, athlete: { id, displayName: `Player ${id}`, position: { abbreviation: id.endsWith("5") ? "C" : "G" } }, stats: ["1-2"] });
  return { header: { competitions: [{ id: "game-1", date: "2026-01-01T00:00Z", competitors: [{ id: "A", homeAway: "home", team: { abbreviation: "AAA" } }, { id: "B", homeAway: "away", team: { abbreviation: "BBB" } }] }] }, boxscore: { players: ["A", "B"].map(teamId => ({ team: { id: teamId }, statistics: [{ keys: ["fieldGoalsMade-fieldGoalsAttempted"], athletes: [1,2,3,4,5].map(number => athlete(`${teamId}${number}`, teamId)) }] })) }, plays: [{ period: { number: 1 }, type: { text: "Jumpball" }, team: { id: "A" }, participants: [{ athlete: { id: "A5" } }, { athlete: { id: "B5" } }] }, { period: { number: 1 }, shootingPlay: true, scoringPlay: false, team: { id: "A" }, participants: [{ athlete: { id: "A1" } }] }, { period: { number: 1 }, shootingPlay: true, scoringPlay: true, scoreValue: 2, team: { id: "B" }, clock: { displayValue: "11:22" }, participants: [{ athlete: { id: "B2" } }] }] };
}

test("first basket parser uses verified first made field goal and starters", () => {
  const game = parseFirstBasketGame(summary()); assert.equal(game.firstBasketPlayerId, "B2"); assert.equal(game.openingPossessionTeamId, "A"); assert.equal(game.starters.length, 10); assert.equal(game.firstShotByTeam.A, "A1");
});

test("first basket probabilities normalize and projected lineups cannot publish", () => {
  const historic = parseFirstBasketGame(summary()); const profiles = buildFirstBasketProfiles(Array.from({ length: 15 }, (_, index) => ({ ...historic, gameId: `g${index}` })));
  const candidates = historic.starters.map(player => ({ ...player, team: player.teamId, teamAbbr: player.teamId, opponent: player.teamId === "A" ? "B" : "A", lineupStatus: "CONFIRMED" }));
  const rows = scoreFirstBasketGame({ game: { homeTeam: { teamId: "A" }, awayTeam: { teamId: "B" } }, candidates, profiles });
  assert.equal(rows.length, 10); assert.ok(Math.abs(rows.reduce((sum, row) => sum + row.probability, 0) - 1) < .001); assert.ok(rows.every(row => row.publicationEligible));
  const projected = scoreFirstBasketGame({ game: { homeTeam: { teamId: "A" }, awayTeam: { teamId: "B" } }, candidates: candidates.map(row => ({ ...row, lineupStatus: "PROJECTED" })), profiles });
  assert.ok(projected.every(row => !row.publicationEligible));
});

test("first basket model reports holdout calibration against a uniform baseline", () => {
  const historic = parseFirstBasketGame(summary());
  const games = Array.from({ length: 140 }, (_, index) => ({ ...historic, gameId: `g${index}` }));
  const result = backtestFirstBasketModel(games, 40);
  assert.equal(result.trainingGames, 100);
  assert.equal(result.holdoutGames, 40);
  assert.equal(typeof result.beatsUniformBaseline, "boolean");
});
