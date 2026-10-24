import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { checkDataFreshness, verifyCurrentDataset } from "../website/lib/data-freshness.mjs";
import { historyFromSeasonSummary } from "../scripts/nba/build_nba_history.js";
import { buildRow as buildMinutesRow } from "../scripts/nba/build_minutes_engine.js";
import { validStabilizedPitcherRisk } from "../scripts/mlb/lib/pitcher-risk-validation.mjs";

const now = Date.parse("2026-10-24T16:00:00Z");
const current = { date: "2026-10-24", fetchedAt: "2026-10-24T15:55:00Z" };

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

test("season averages cannot impersonate last-five and last-ten game logs", () => {
  const result = historyFromSeasonSummary({ games: 60, points: 25 });
  assert.equal(result.seasonSummary.points, 25);
  assert.equal(result.last5, null);
  assert.equal(result.last10, null);
  assert.equal(result.recentFormAvailable, false);
  const player = { playerId: "1", starter: true, starterKnown: true };
  const availability = { publicationEligible: true, publicationStatus: "eligible" };
  const row = buildMinutesRow(player, result, availability);
  assert.equal(row.publicationEligible, false);
  assert.equal(row.publicationStatus, "context_only_missing_game_logs");
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

test("sports refresh commits deploy immediately through the ignore command", () => {
  for (const subject of ["Refresh NBA data", "Refresh MLB data", "Refresh NFL data", "Refresh WNBA data", "Refresh college football board", "Refresh sportsbook prices across sports", "Update HR results"]) {
    assert.equal(spawnSync(process.execPath, ["scripts/vercel-ignore-build.mjs"], { env: { ...process.env, VERCEL_GIT_COMMIT_MESSAGE: subject } }).status, 1, subject);
  }
  assert.equal(spawnSync(process.execPath, ["scripts/vercel-ignore-build.mjs"], { env: { ...process.env, VERCEL_GIT_COMMIT_MESSAGE: "Automated X posting update" } }).status, 0);
});
