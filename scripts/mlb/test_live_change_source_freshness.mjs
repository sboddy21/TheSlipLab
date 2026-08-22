import assert from "node:assert/strict";
import { validateSourceFreshness } from "./build_live_change_alerts.js";

const minute = 60 * 1000;
const now = Date.parse("2026-08-22T14:00:00.000Z");
const scheduleTime = now - 2 * minute;
const iso = value => new Date(value).toISOString();

const pulseSources = {
  "mlb_games_today.json": iso(scheduleTime),
  "mlb_player_pool.json": iso(scheduleTime + 1000),
  "game_pitcher_matchups.json": iso(now - 45 * minute),
  "player_card_data.json": iso(now - minute),
  "hr_probability_tracking.json": iso(now - 45 * minute),
  "pitcher_vulnerability.json": iso(now - 45 * minute)
};

assert.doesNotThrow(
  () => validateSourceFreshness({ scheduleTime, sourceTimes: pulseSources, now }),
  "a valid pulse must accept same-slate model artifacts older than its live preflight"
);

assert.throws(
  () => validateSourceFreshness({
    scheduleTime,
    sourceTimes: { ...pulseSources, "game_pitcher_matchups.json": iso(now - 71 * minute) },
    now
  }),
  /game_pitcher_matchups\.json exceeded its model refresh window/
);

assert.throws(
  () => validateSourceFreshness({
    scheduleTime,
    sourceTimes: { ...pulseSources, "mlb_player_pool.json": iso(scheduleTime - 3000) },
    now
  }),
  /mlb_player_pool\.json predates the current live refresh/
);

console.log("MLB LIVE CHANGE SOURCE FRESHNESS TEST PASSED");
