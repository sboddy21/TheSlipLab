import test from "node:test";
import assert from "node:assert/strict";
import { selectWeekGames } from "../scripts/nfl/week_schedule.js";

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

