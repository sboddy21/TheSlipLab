import assert from "node:assert/strict";
import test from "node:test";
import { buildCurrentUsageProfiles, parseNflUsageGame, receivingBacktest } from "../scripts/nfl/current_usage.mjs";

test("parses NFL box-score usage by named keys", () => {
  const summary = { boxscore: { players: [{ team: { abbreviation: "BAL" }, statistics: [{ keys: ["receivingTargets", "receptions", "receivingYards", "receivingTouchdowns"], athletes: [{ athlete: { id: "1", displayName: "Receiver" }, stats: ["9", "6", "84", "1"] }] }] }] } };
  const result = parseNflUsageGame(summary, { id: "g1", date: "2026-09-01", competitors: [{ abbreviation: "BAL" }, { abbreviation: "BUF" }] });
  assert.equal(result.players[0].targets, 9);
  assert.equal(result.players[0].receivingYards, 84);
  assert.equal(result.players[0].opponent, "BUF");
});

test("aggregates current season and recent windows", () => {
  const games = [20, 40, 80].map((receivingYards, index) => ({ gameId: String(index), gameDate: `2026-09-0${index + 1}`, players: [{ playerId: "1", name: "Receiver", team: "BAL", receivingYards, targets: index + 5 }] }));
  const [profile] = buildCurrentUsageProfiles(games, [{ id: "1", position: "WR" }]);
  assert.equal(profile.gamesPlayed, 3);
  assert.equal(profile.season.receivingYards, 46.667);
  assert.equal(profile.last3.targets, 6);
  assert.equal(receivingBacktest([profile]).samples, 1);
});
