import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));

test("NBA preseason player pool has an official roster path", () => {
  const source = fs.readFileSync("scripts/nba/build_nba_player_pool.js", "utf8");
  assert.match(source, /commonteamroster/);
  assert.match(source, /rosterFallbackCount/);
  assert.match(source, /status: "UNKNOWN"/);
  assert.match(source, /starterKnown: false/);
});

test("NBA availability never treats a missing injury report as clearance", () => {
  const availability = readJson("website/data/nba_availability.json");
  assert.equal(availability.freshnessPolicy.missingReportMeaning, "No injury report was matched; this is not a confirmed healthy designation.");
  assert.ok(availability.players.some(player => player.availabilityStatus === "UNKNOWN" && !player.publicationEligible));
});

test("unknown starters keep historical minutes without becoming recommendations", () => {
  const minutes = readJson("website/data/nba_minutes_engine.json");
  const unknownHighMinutes = minutes.players.filter(player => !player.starterKnown && player.expectedMinutes > 28);
  assert.ok(unknownHighMinutes.length > 0);
  assert.ok(unknownHighMinutes.every(player => !player.publicationEligible));
});

test("NBA history uses one league-wide game-log request", () => {
  const source = fs.readFileSync("scripts/nba/build_nba_history.js", "utf8");
  assert.match(source, /stats\/leaguegamelog/);
  assert.match(source, /previous_season_preseason/);
});

test("NBA core compares trends with the season summary", () => {
  const source = fs.readFileSync("scripts/nba/build_nba_core.js", "utf8");
  assert.match(source, /const season = history\?\.seasonSummary \|\| \{\};/);
});

test("landing page opens the live NBA Decision Center", () => {
  const landing = fs.readFileSync("website/index.html", "utf8");
  assert.match(landing, /<a class="league(?: live)?" href="\.\/nba\.html"[^>]*><strong>NBA<\/strong>/);
  assert.doesNotMatch(landing, /<strong>NBA<\/strong><span>Not in season<\/span>/);
});

test("generated NBA artifacts remain internally consistent", () => {
  const slate = readJson("website/data/nba_games_today.json");
  const pool = readJson("website/data/nba_player_pool.json");
  const history = readJson("website/data/nba_history.json");
  const points = readJson("website/data/nba_points.json");
  const decision = readJson("website/data/nba_decision_center.json");

  assert.equal(pool.gameCount, slate.games.length);
  assert.equal(pool.playerCount, pool.players.length);
  assert.equal(history.playerCount, history.players.length);

  const playerKeys = pool.players.map(player => `${player.gameId}:${player.playerId}`);
  assert.equal(new Set(playerKeys).size, playerKeys.length);

  if (slate.games.length > 0) {
    assert.ok(pool.players.length > 0);
    assert.equal(pool.errors.length, 0);
  }

  if (pool.players.length > 0 && pool.players.every(player => String(player.gameId).startsWith("001"))) {
    assert.equal(history.baselineMode, "previous_season_preseason");
  }

  const decisionRows = Object.values(decision.sections || {}).flat().filter(row => row?.playerId);
  const eligibleIds = new Set(points.players.filter(player => player.publicationEligible).map(player => String(player.playerId)));
  assert.ok(decisionRows.every(row => eligibleIds.has(String(row.playerId))));
});
