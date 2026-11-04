import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MARKETS, classifyLastFive, gameValue } from "../website/assets/nba-prop-trends.mjs";

test("NBA prop workspace exposes every requested market", () => {
  assert.deepEqual(MARKETS.map(([, label]) => label), ["Points", "Rebounds", "Assists", "Threes", "PRA", "Pts+Reb", "Reb+Assist", "First Basket", "Double Double", "Triple Double"]);
});

test("combo and double-double values derive from verified box-score fields", () => {
  const game = { points: 24, rebounds: 11, assists: 10, threesMade: 4 };
  assert.equal(gameValue(game, "pra"), 45);
  assert.equal(gameValue(game, "pointsRebounds"), 35);
  assert.equal(gameValue(game, "reboundsAssists"), 21);
  assert.equal(gameValue(game, "doubleDouble"), 1);
  assert.equal(gameValue(game, "tripleDouble"), 1);
});

test("last-five tiers are deterministic and never rate short samples", () => {
  assert.equal(classifyLastFive([15, 14, 13, 12, 8], 10).key, "hot");
  assert.equal(classifyLastFive([11, 10, 12, 9, 8], 10).key, "good");
  assert.equal(classifyLastFive([13, 12, 8, 7, 6], 10).key, "sleeper");
  assert.equal(classifyLastFive([9, 8, 7, 6, 5], 10).key, "cold");
  assert.equal(classifyLastFive([15, 14, 13], 10).key, "unrated");
});

test("binary markets use occurrence counts and recent sleeper evidence", () => {
  assert.equal(classifyLastFive([1, 1, 1, 1, 0], null, { binary: true }).key, "hot");
  assert.equal(classifyLastFive([1, 0, 1, 0, 0], null, { binary: true }).key, "sleeper");
  assert.equal(classifyLastFive([0, 0, 0, 0, 0], null, { binary: true }).key, "cold");
});

test("NBA page includes the four user-facing trend colors and no fabricated line language", () => {
  const html = fs.readFileSync("website/nba.html", "utf8");
  const styles = fs.readFileSync("website/assets/nba-lab.css", "utf8");
  const script = fs.readFileSync("website/assets/nba-lab.js", "utf8");
  for (const tier of ["hot", "good", "sleeper", "cold"]) assert.match(html, new RegExp(`class="${tier}"`));
  assert.match(styles, /tier-row\.hot/);
  assert.match(styles, /tier-row\.cold/);
  assert.match(script, /No verified line/);
  assert.match(script, /No fabricated probability/);
});
