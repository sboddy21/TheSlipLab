import assert from "node:assert/strict";
import test from "node:test";

import {
  WNBA_PRESENTATION_MAX_AGE_MS,
  teamScoringLeaderText,
  wnbaSlateFreshness
} from "../website/assets/wnba-slate-core.js";

const NOW = Date.parse("2026-09-22T23:04:00Z");

test("same-day WNBA projections remain visible between delayed refreshes", () => {
  const result = wnbaSlateFreshness({
    projectionData: { date: "2026-09-22", dataAsOf: "2026-09-22T22:14:46Z", stale: false },
    slateDate: "2026-09-22",
    now: NOW
  });
  assert.equal(WNBA_PRESENTATION_MAX_AGE_MS, 6 * 60 * 60_000);
  assert.equal(result.usable, true);
  assert.equal(result.delayed, true);
});

test("WNBA presentation gate rejects stale, future, wrong-slate, and expired inputs", () => {
  const base = { date: "2026-09-22", dataAsOf: "2026-09-22T22:14:46Z", stale: false };
  assert.equal(wnbaSlateFreshness({ projectionData: { ...base, stale: true }, slateDate: base.date, now: NOW }).usable, false);
  assert.equal(wnbaSlateFreshness({ projectionData: { ...base, dataAsOf: "2026-09-23T00:00:00Z" }, slateDate: base.date, now: NOW }).usable, false);
  assert.equal(wnbaSlateFreshness({ projectionData: base, slateDate: "2026-09-21", now: NOW }).usable, false);
  assert.equal(wnbaSlateFreshness({ projectionData: { ...base, dataAsOf: "2026-09-22T16:00:00Z" }, slateDate: base.date, now: NOW }).usable, false);
});

test("season scoring leader comes from current player baselines", () => {
  const players = [
    { player: "Player A", teamAbbreviation: "CHI", season: { points: 14.2 } },
    { player: "Player B", teamAbbreviation: "CHI", season: { points: 19.75 } },
    { player: "Player C", teamAbbreviation: "TOR", season: { points: 22.1 } }
  ];
  assert.equal(teamScoringLeaderText("CHI", players), "Player B · 19.8 PPG");
  assert.equal(teamScoringLeaderText("LV", players), "Leader data unavailable");
});
