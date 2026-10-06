import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(new URL("../website/nba-results.html", import.meta.url), "utf8");

test("NBA results page exposes transparent calibration and settlement states", () => {
  assert.match(page, /nba_results\.json/);
  assert.match(page, /nba_calibration\.json/);
  assert.match(page, /Graded players/);
  assert.match(page, /DNP excluded/);
  assert.match(page, /Priced strategy/);
  assert.match(page, /Proj \/ Actual \/ Bias/);
  assert.match(page, /No graded NBA projections yet/);
});

test("NBA hub links to the results page", () => {
  const hub = fs.readFileSync(new URL("../website/nba.html", import.meta.url), "utf8");
  assert.match(hub, /href="\.\/nba-results\.html">Results<\/a>/);
  assert.match(hub, /href="\.\/nba-results\.html">Open Results<\/a>/);
});
