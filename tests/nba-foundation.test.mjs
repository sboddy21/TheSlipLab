import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validateGeneratedNbaPublication, validateNbaPublication } from "../scripts/nba/validate_nba_publication.mjs";

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
  const unknownPlayers = availability.players.filter(player => player.availabilityStatus === "UNKNOWN");
  assert.ok(unknownPlayers.every(player => !player.publicationEligible));
});

test("unknown starters keep historical minutes with an unconfirmed-role label", () => {
  const minutes = readJson("website/data/nba_minutes_engine.json");
  const unknownHighMinutes = minutes.players.filter(player => !player.starterKnown && player.expectedMinutes > 28);
  assert.ok(unknownHighMinutes.every(player => player.publicationStatus !== "eligible"));
});

test("NBA history uses one league-wide game-log request", () => {
  const source = fs.readFileSync("scripts/nba/build_nba_history.js", "utf8");
  assert.match(source, /stats\/leaguegamelog/);
  assert.match(source, /parseEspnGameLog/);
  assert.match(source, /previous_season_preseason/);
  assert.match(source, /verified_core_history_cache/);
  assert.match(source, /retainedHistoryCount/);
});

test("NBA core compares trends with the season summary", () => {
  const source = fs.readFileSync("scripts/nba/build_nba_core.js", "utf8");
  assert.match(source, /const season = history\?\.seasonSummary \|\| \{\};/);
});

test("NBA points projections include capped transparent matchup context", async () => {
  const { pointsMatchupAdjustment } = await import("../scripts/nba/build_points_board.js");
  assert.equal(pointsMatchupAdjustment({ rankPointsAllowed: 30 }, { rankPace: 1 }), 0.06);
  assert.equal(pointsMatchupAdjustment({ rankPointsAllowed: 1 }, { rankPace: 30 }), -0.06);
  assert.equal(pointsMatchupAdjustment({ rankPointsAllowed: 15 }, { rankPace: 15 }), 0);
  assert.equal(pointsMatchupAdjustment(null, null), 0);
  const source = fs.readFileSync("website/assets/nba-lab.js", "utf8");
  assert.match(source, /Projection breakdown/);
  assert.match(source, /Opponent matchup/);
  assert.match(source, /Recent scoring evidence/);
});

test("NBA team defense has a verified ESPN standings fallback", async () => {
  const { parseEspnStandingsDefense } = await import("../scripts/nba/build_team_defense.js");
  const teams = parseEspnStandingsDefense({ children: [{ standings: { entries: [{ team: { id: "1", abbreviation: "BOS", displayName: "Boston Celtics" }, stats: [{ name: "wins", value: 4 }, { name: "losses", value: 1 }, { name: "avgPointsAgainst", value: 105.4 }] }] } }] });
  assert.deepEqual(teams.map(team => ({ team: team.teamAbbr, games: team.games, pointsAllowed: team.pointsAllowed })), [{ team: "BOS", games: 5, pointsAllowed: 105.4 }]);
});

test("NBA market projections apply opportunity factors and uncertainty ranges", async () => {
  const { buildTeamAbsenceContext, projectMarket } = await import("../scripts/nba/projection_factors.mjs");
  const players = [{ player: "Out Teammate", teamAbbr: "BOS", minutes: { availabilityStatus: "OUT" }, history: { season: { fieldGoalAttempts: 20, rebounds: 8, assists: 6, threesAttempted: 7 } } }];
  const absences = buildTeamAbsenceContext(players);
  const result = projectMarket({ market: "points", base: 20, player: { teamAbbr: "BOS", gameTimeUTC: "2026-11-01T20:00:00Z", minutes: { expected: 36 }, history: { season: { minutes: 32 }, recentGames: [{ gameDate: "2026-10-31T20:00:00Z", points: 18 }, { gameDate: "2026-10-29T20:00:00Z", points: 24 }] } }, defense: { rankPointsAllowed: 30 }, pace: { rankPace: 1 }, absenceContext: absences, minutesConfidence: 70 });
  assert.ok(result.projection > 20);
  assert.ok(result.floor < result.projection && result.ceiling > result.projection);
  assert.equal(result.backToBack, true);
  assert.deepEqual(result.absentTeammates, ["Out Teammate"]);
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

test("NBA publication gate accepts the generated verified boards", () => {
  const receipt = validateGeneratedNbaPublication();
  assert.equal(receipt.status, "passed");
  assert.ok(receipt.publicationEligibleCount > 0);
  assert.ok(Object.values(receipt.boardCounts).every(count => count === receipt.publicationEligibleCount));
});

test("NBA publication gate rejects a mismatched opponent", () => {
  const slate = readJson("website/data/nba_games_today.json");
  const pool = readJson("website/data/nba_player_pool.json");
  const availability = readJson("website/data/nba_availability.json");
  const minutes = readJson("website/data/nba_minutes_engine.json");
  const points = readJson("website/data/nba_points.json");
  const altered = structuredClone(points);
  altered.players[0].opponent = "INVALID";

  assert.throws(() => validateNbaPublication({
    slate,
    pool,
    availability,
    minutes,
    boards: { "nba_points.json": altered }
  }), /conflicting opponent/);
});
