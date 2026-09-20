import test from "node:test";
import assert from "node:assert/strict";
import { currentScheduleWeek, selectWeekGames } from "../scripts/nfl/week_schedule.js";

const game = (gameId, home, away, state, completed = false) => ({
  gameId,
  week: 1,
  seasonType: 2,
  state,
  completed,
  homeTeam: { abbreviation: home },
  awayTeam: { abbreviation: away }
});

test("week assignments survive pregame, live, and completed lifecycle states", () => {
  const schedule = {
    games: [
      game("pre", "SEA", "NE", "pre"),
      game("live", "LAR", "SF", "in"),
      game("final", "PHI", "DAL", "post", true)
    ]
  };
  assert.deepEqual(selectWeekGames(schedule, 1).map(row => row.gameId), ["pre", "live", "final"]);
});

test("week assignments fail closed on duplicate teams", () => {
  const schedule = { games: [game("one", "SEA", "NE", "pre"), game("two", "SEA", "SF", "pre")] };
  assert.throws(() => selectWeekGames(schedule, 1), /assigns a team to multiple games/);
});

test("current week rolls forward after the prior slate ends", () => {
  const schedule = { games: [
    {...game("w1", "SEA", "NE", "post", true), kickoffUTC: "2026-09-10T00:20:00Z"},
    {...game("w2", "LAR", "SF", "pre"), week: 2, kickoffUTC: "2026-09-21T00:20:00Z"},
    {...game("w3", "PHI", "DAL", "pre"), week: 3, kickoffUTC: "2026-09-28T00:20:00Z"}
  ]};
  assert.equal(currentScheduleWeek(schedule, Date.parse("2026-09-20T12:00:00Z")), 2);
  assert.equal(currentScheduleWeek(schedule, Date.parse("2026-09-22T12:00:00Z")), 3);
});
