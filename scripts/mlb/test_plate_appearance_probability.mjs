import assert from "node:assert/strict";
import {
  adjustProbabilityForPlateAppearances,
  lineupConfidence
} from "./lib/plate_appearance_probability.js";

const base = 12;
const leadoff = adjustProbabilityForPlateAppearances(base, 4.75);
const cleanup = adjustProbabilityForPlateAppearances(base, 4.45);
const ninth = adjustProbabilityForPlateAppearances(base, 3.7);

assert(leadoff > cleanup, "leadoff volume should exceed cleanup volume");
assert(cleanup > ninth, "cleanup volume should exceed ninth-place volume");
assert(Math.abs(adjustProbabilityForPlateAppearances(base, 4.3) - base) < 1e-9);
assert.equal(adjustProbabilityForPlateAppearances(base, 4.75, { lineupStatus: "NOT IN LINEUP" }), 0);
assert.equal(lineupConfidence({ lineupStatus: "CONFIRMED", confirmedLineup: true, lineupSpot: 3 }), "HIGH");
assert.equal(lineupConfidence({ lineupStatus: "PROJECTED", lineupSpot: 7 }), "MEDIUM");
assert.equal(lineupConfidence({ lineupStatus: "PROJECTED" }), "LOW");
assert.equal(lineupConfidence({ lineupStatus: "NOT IN LINEUP" }), "OUT");

console.log("Expected plate appearance probability tests passed");
