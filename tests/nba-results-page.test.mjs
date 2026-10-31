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
  const resultsLink = hub.match(
    /<a[^>]+href="\.\/nba-results\.html"[^>]*>([\s\S]*?)<\/a>/,
  );

  assert.ok(resultsLink, "expected the NBA hub to link to the results page");
  assert.match(resultsLink[1].replace(/<[^>]+>/g, "").trim(), /Results$/);
});

test("NBA workspace does not make optional market lines a critical dependency", () => {
  const source = fs.readFileSync("website/assets/nba-lab.js", "utf8");
  const requiredFiles = source.match(/const files = \[(.*?)\];/s)?.[1] || "";
  assert.doesNotMatch(requiredFiles, /nba_market_lines\.json/);
  assert.match(source, /const markets = \{ lines: \[\], status: "not_loaded" \}/);
});
