import test from "node:test";
import assert from "node:assert/strict";
import { isActiveRoster, depthMatchesPlayer, hasCurrentOfficialReport } from "../scripts/nfl/launch_safety.js";

const player = { playerId: "42", team: "SEA", position: "WR", status: "active" };
test("only explicit active-roster statuses are eligible", () => {
  assert.equal(isActiveRoster(player), true);
  assert.equal(isActiveRoster({status:"day-to-day"}), true);
  for (const status of ["practice-squad", "news", "injured-reserve", "", null]) assert.equal(isActiveRoster({status}), false);
});
test("depth entries must match current ID, team and position", () => {
  assert.equal(depthMatchesPlayer(player, player), true);
  assert.equal(depthMatchesPlayer({...player, team:"LAR"}, player), false);
  assert.equal(depthMatchesPlayer({...player, position:"RB"}, player), false);
});
test("another player's report, stale reports and roster-feed injuries cannot confirm roles", () => {
  const now = Date.parse("2026-09-04T14:00:00Z");
  const report = {...player, week:1, sourceCoverage:"official_weekly_practice_report", reportedAt:"2026-09-04T10:00:00Z"};
  assert.equal(hasCurrentOfficialReport(report, player, 1, now), true);
  for (const change of [{playerId:"43"}, {team:"LAR"}, {week:2}, {reportedAt:"2026-09-02T10:00:00Z"}, {sourceCoverage:"team_roster_feed"}]) {
    assert.equal(hasCurrentOfficialReport({...report,...change}, player, 1, now), false);
  }
});
