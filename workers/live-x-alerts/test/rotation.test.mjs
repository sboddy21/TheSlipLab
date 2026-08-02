import assert from "node:assert/strict";
import { selectGamesForRun } from "../src/index.js";

const games = Array.from({ length: 15 }, (_, index) => ({ gamePk: 1000 + index }));
const start = new Date("2026-08-02T16:00:00Z");
const selected = [];

for (let offset = 0; offset < games.length; offset += 1) {
  selected.push(...selectGamesForRun(games, new Date(start.getTime() + offset * 60000), 1));
}

assert.equal(selected.length, games.length);
assert.deepEqual(
  [...new Set(selected.map(game => game.gamePk))].sort((a, b) => a - b),
  games.map(game => game.gamePk)
);
assert.deepEqual(selectGamesForRun([], start, 1), []);
assert.equal(selectGamesForRun(games, start, 2).length, 2);

console.log("rotation coverage passed");
