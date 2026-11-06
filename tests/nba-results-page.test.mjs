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

test("NBA workspace does not make optional market lines a critical dependency", async () => {
  const { loadNbaBoardData } = await import("../website/assets/nba-board-data.mjs");
  const data = await loadNbaBoardData(async file => {
    if (file === "nba_market_lines.json") throw Error("Provider offline");
    if (file === "nba_games_today.json") return { games: [], date: "2026-11-06" };
    return { players: [] };
  });
  assert.deepEqual(data.markets.lines, []);
  assert.deepEqual(data.games, []);
  assert.ok(data.missing.includes("nba_market_lines.json"));
});
