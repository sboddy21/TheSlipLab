const test = require("node:test");
const assert = require("node:assert/strict");
const { exactGameFromModelSources } = require("./pregame_game_identity.cjs");

test("uses the model gamePk to distinguish games in a doubleheader", () => {
  const games = [
    { gamePk: 823596, gameDate: "2026-07-29T17:10:00Z" },
    { gamePk: 823598, gameDate: "2026-07-29T23:10:00Z" }
  ];

  const selected = exactGameFromModelSources(
    games,
    { player: "Example Player" },
    { gamePk: 823596 }
  );

  assert.equal(selected.gamePk, 823596);
});

test("falls through invalid or unavailable model identities", () => {
  const games = [{ gamePk: 823598 }];
  assert.equal(
    exactGameFromModelSources(games, { gamePk: 999999 }, { gamePk: 823598 })?.gamePk,
    823598
  );
  assert.equal(exactGameFromModelSources(games, {}, null), null);
});
