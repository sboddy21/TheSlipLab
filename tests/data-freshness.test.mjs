import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { canServeDelayedDataset, checkDataFreshness, verifyCurrentDataset } from "../website/lib/data-freshness.mjs";
import { historyFromSeasonSummary } from "../scripts/nba/build_nba_history.js";
import { buildRow as buildMinutesRow } from "../scripts/nba/build_minutes_engine.js";
import { validStabilizedPitcherRisk } from "../scripts/mlb/lib/pitcher-risk-validation.mjs";

const now = Date.parse("2026-10-24T16:00:00Z");
const current = { season: 2026, date: "2026-10-24", fetchedAt: "2026-10-24T15:55:00Z" };

test("valid MLB scores at the model floor no longer abort publication", () => {
  // The previous distance-to-baseline test rejected this valid clamped score.
  assert.equal(validStabilizedPitcherRisk(12, 4, 5, 1), true);
  assert.equal(validStabilizedPitcherRisk(98, 100, 99, 1), true);
  assert.equal(validStabilizedPitcherRisk(55, 80, 30, 0.5), true);
  assert.equal(validStabilizedPitcherRisk(80, 80, 30, 0.5), false);
  assert.equal(validStabilizedPitcherRisk(12, NaN, 5, 1), false);
});

test("current feeds are accepted across every sport", () => {
  for (const file of ["nba_points.json", "wnba_projection_board.json", "nfl_foundation.json", "cfb_board.json", "nhl_board.json", "mlb_weather.json"]) {
    assert.equal(checkDataFreshness(file, current, { now }).available, true, file);
  }
});

test("rebuilding a board cannot hide an expired provider timestamp", () => {
  const result = checkDataFreshness("wnba_projection_board.json", { ...current, generatedAt: new Date(now).toISOString(), dataAsOf: "2026-10-23T16:00:00Z" }, { now });
  assert.equal(result.available, false);
  assert.ok(result.reasons.includes("expired_source_timestamp"));
});

test("rejects stale slates, preserved, failed, future, missing and invalid data", () => {
  for (const payload of [
    { ...current, date: "2026-10-23" }, { ...current, stale: true },
    { ...current, errorCount: 1 }, { ...current, availability: "schedule_unavailable" },
    { ...current, fetchedAt: "2026-10-24T17:00:00Z" }, {},
    { ...current, fetchedAt: "bad" }, { ...current, preservedAt: current.fetchedAt }
  ]) assert.equal(checkDataFreshness("nba_points.json", payload, { now }).available, false);
});

test("odds expire after 20 minutes even on the current slate", () => {
  assert.equal(checkDataFreshness("odds_nba.json", { retrievedAt: "2026-10-24T15:40:00Z" }, { now }).available, false);
});

test("analytical boards reject five-hour-old data even when the slate date matches", () => {
  const fiveHoursAgo = new Date(now - 5 * 60 * 60 * 1000).toISOString();
  for (const file of ["nba_points.json", "nhl_board.json", "cfb_board.json"]) {
    assert.equal(checkDataFreshness(file, { date: "2026-10-24", generatedAt: fiveHoursAgo }, { now }).available, false, file);
  }
  assert.equal(checkDataFreshness("nba_points.json", { date: "2026-10-23", generatedAt: fiveHoursAgo }, { now }).available, false);
  assert.equal(checkDataFreshness("odds_nba.json", { retrievedAt: fiveHoursAgo }, { now }).available, false);
  assert.equal(checkDataFreshness("nhl_board.json", { date: "2026-10-24", generatedAt: fiveHoursAgo }, { now: now + 60 * 60 * 1000 }).available, false);
  assert.equal(checkDataFreshness("cfb_board.json", { generatedAt: fiveHoursAgo }, { now: now + 7 * 60 * 60 * 1000 }).available, false);
});

test("archives and park geometry remain readable as historical reference", () => {
  for (const file of ["nba_results.json", "nba_calibration.json", "nba_projection_history.json", "cfb_backtest.json", "hr_results_history.json", "mlb_park_shapes.json"]) {
    assert.equal(checkDataFreshness(file, {}, { now }).status, "reference_or_history");
  }
});

test("legacy arrays require a current successful health receipt", () => {
  const health = { status: "healthy", slateDate: "2026-10-24", monitoring: { freshUntil: "2026-10-24T16:10:00Z" }, artifacts: { hr: { file: "mlb_home_runs.json", freshness: "current", timestamp: current.fetchedAt } } };
  assert.equal(checkDataFreshness("mlb_home_runs.json", [], { now, health }).available, true);
  assert.equal(checkDataFreshness("mlb_home_runs.json", [], { now }).available, false);
  assert.equal(checkDataFreshness("mlb_home_runs.json", [], { now: now + 600000, health }).available, false);
});

test("season averages remain labeled and can provide a conservative baseline", () => {
  const result = historyFromSeasonSummary({ games: 60, minutes: 32, points: 25 });
  assert.equal(result.seasonSummary.points, 25);
  assert.equal(result.last5, null);
  assert.equal(result.last10, null);
  assert.equal(result.recentFormAvailable, false);
  const player = { playerId: "1", starter: true, starterKnown: true };
  const availability = { publicationEligible: true, publicationStatus: "eligible" };
  const row = buildMinutesRow(player, result, availability);
  assert.equal(row.publicationEligible, true);
  assert.equal(row.publicationStatus, "eligible_season_baseline_unconfirmed_role");
  assert.equal(row.expectedMinutes, result.seasonSummary.minutes || 0);
  assert.equal(buildMinutesRow(player, { ...result, recentGames: [{ points: 25 }] }, availability).publicationEligible, true);
});

test("fresh board timestamps cannot conceal stale or missing upstream feeds", async () => {
  const stale = await verifyCurrentDataset("nba_points.json", current, { now, load: async file => file === "nba_availability.json" ? { ...current, fetchedAt: "2026-10-23T15:55:00Z" } : current });
  assert.equal(stale.available, false);
  assert.equal(stale.reasons[0], "upstream_data_unavailable");
  const missing = await verifyCurrentDataset("nba_points.json", current, { now, load: async () => { throw new Error("missing"); } });
  assert.equal(missing.available, false);
  const fresh = await verifyCurrentDataset("nba_points.json", current, { now, load: async () => current });
  assert.equal(fresh.available, true);
});

test("unavailable NBA history cannot publish generated boards", async () => {
  const history = {
    ...current,
    availability: "history_unavailable",
    errorCount: 1,
    errors: [{ source: "NBA league game log", message: "This operation was aborted" }],
    espnSummaryCount: 0,
    espnGameLogCount: 0,
    retainedHistoryCount: 1,
    players: [{ playerId: "1", gamesPlayed: 5, seasonSummary: { games: 5, points: 20 } }]
  };
  const result = await verifyCurrentDataset("nba_points.json", current, {
    now,
    load: async file => file === "nba_history.json" ? history : current
  });
  assert.equal(result.available, false);
  assert.equal(result.dependencies.find(row => row.file === "nba_history.json").status, "unavailable");
  assert.equal(checkDataFreshness("nba_history.json", { ...history, players: [] }, { now }).available, false);
  assert.equal(checkDataFreshness("nba_history.json", { ...history, retainedHistoryCount: 0, players: [{ gamesPlayed: 0 }] }, { now }).available, false);
  assert.equal(checkDataFreshness("nba_history.json", { ...history, date: "2026-10-23" }, { now }).available, false);
});

test("sports refresh commits deploy immediately through the ignore command", () => {
  for (const subject of ["Refresh NBA data", "Refresh MLB data", "Refresh NFL data", "Refresh WNBA data", "Refresh college football board", "Refresh sportsbook prices across sports", "Update HR results"]) {
    assert.equal(spawnSync(process.execPath, ["scripts/vercel-ignore-build.mjs"], { env: { ...process.env, VERCEL_GIT_COMMIT_MESSAGE: subject } }).status, 1, subject);
  }
  assert.equal(spawnSync(process.execPath, ["scripts/vercel-ignore-build.mjs"], { env: { ...process.env, VERCEL_GIT_COMMIT_MESSAGE: "Automated X posting update" } }).status, 0);
});

test("landing page does not depend on protected prediction feeds or display a global data outage", () => {
  const source = fs.readFileSync("website/assets/landing-seasons.js", "utf8");
  assert.match(source, /isSportInSeason/);
  assert.doesNotMatch(source, /nba_decision_center|odds_nfl|current_data_unavailable/);
});

test("landing page updates season navigation across date changes", () => {
  const source = fs.readFileSync("website/assets/landing-seasons.js", "utf8");
  assert.match(source, /Offseason/);
  assert.match(source, /In season/);
  assert.match(source, /removeAttribute\('href'\)/);
  assert.match(source, /aria-disabled/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /setInterval/);
});

test("NHL refresh runs at least hourly in season and every 15 minutes overnight", () => {
  const workflow = fs.readFileSync(".github/workflows/nhl-refresh.yml", "utf8");
  const refresh = fs.readFileSync("scripts/nhl/refresh.mjs", "utf8");
  assert.match(workflow, /17 7-21 \* 9-12,1-6 \*/);
  assert.match(workflow, /2,17,32,47 22-23,0-6 \* 9-12,1-6 \*/);
  assert.match(refresh, /maxAgeHours: 1/);
  assert.match(refresh, /refreshCadenceMinutes: 60/);
  assert.match(refresh, /liveRefreshCadenceMinutes: 15/);
});

test("NBA refresh validates the newly generated slate instead of yesterday's checkout", () => {
  const workflow = fs.readFileSync(".github/workflows/nba-refresh.yml", "utf8");
  assert.ok(workflow.indexOf("Run NBA refresh only") < workflow.indexOf("Validate refreshed NBA foundation"));
});

test("NFL refresh targets thirty minutes and expires delayed analytical feeds", () => {
  const workflow = fs.readFileSync(".github/workflows/nfl-refresh.yml", "utf8");
  assert.match(workflow, /cron:\s*"\*\/30 \* \* 1-2,8-12 \*"/);
  const generatedAt = new Date(now - 5 * 60 * 60 * 1000).toISOString();
  assert.equal(checkDataFreshness("nfl_td_decision_center.json", { generatedAt }, { now }).available, false);
  assert.equal(checkDataFreshness("nfl_td_decision_center.json", { generatedAt }, { now: now + 60 * 60 * 1000 }).available, false);
  assert.equal(checkDataFreshness("odds_nfl.json", { retrievedAt: new Date(now - 21 * 60 * 1000).toISOString() }, { now }).available, false);
});

test("NFL keeps a usable same-week board readable during a provider delay without declaring it fresh", () => {
  const generatedAt = new Date(now - 5 * 60 * 60 * 1000).toISOString();
  const payload = { sport: "NFL", season: 2026, week: 8, generatedAt, rows: [{ playerId: "1", playerName: "Verified Player" }] };
  const freshness = checkDataFreshness("nfl_td_decision_center.json", payload, { now });
  assert.equal(freshness.available, false);
  assert.equal(canServeDelayedDataset("nfl_td_decision_center.json", payload, freshness, { now }), true);
  assert.equal(canServeDelayedDataset("nfl_td_decision_center.json", { ...payload, rows: [] }, freshness, { now }), false);
  assert.equal(canServeDelayedDataset("nba_points.json", payload, freshness, { now }), false);
  assert.equal(canServeDelayedDataset("nfl_td_decision_center.json", { ...payload, generatedAt: new Date(now - 8 * 86400 * 1000).toISOString() }, freshness, { now }), false);
});
