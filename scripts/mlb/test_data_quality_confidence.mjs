import assert from "node:assert/strict";
import { applyDataQualityPenalty, buildDataQualityConfidence, normalizeModelConfidence } from "./lib/data_quality_confidence.js";

const strong = buildDataQualityConfidence({ lineupStatus: "CONFIRMED", confirmedLineup: true, lineupSpot: 2, pitcherConfirmed: true, zoneSignalAvailable: true, statcastReliability: 1, bullpenConfidence: "HIGH", marketFeedAvailable: true, marketAvailable: true, marketAgeMinutes: 4 });
assert.equal(strong.grade, "A");
assert.equal(strong.penaltyFactor, 1);
assert.equal(applyDataQualityPenalty(72, strong), 72);

const uncertain = buildDataQualityConfidence({ lineupStatus: "PROJECTED", confirmedLineup: false, pitcherConfirmed: false, zoneSignalAvailable: false, statcastReliability: 0.1, bullpenConfidence: "LOW", marketFeedAvailable: true, marketAvailable: false, marketAgeMinutes: 20 });
assert(uncertain.score < strong.score);
assert(uncertain.flags.includes("LINEUP_UNCONFIRMED"));
assert(applyDataQualityPenalty(72, uncertain) < 72);
assert(applyDataQualityPenalty(72, uncertain) >= 61.2);

const tinyRawConfidence = normalizeModelConfidence(0.06);
assert.equal(tinyRawConfidence, 0.1);
assert(applyDataQualityPenalty(tinyRawConfidence, uncertain) <= tinyRawConfidence);
assert.equal(normalizeModelConfidence(-0.04), 0);
assert.equal(applyDataQualityPenalty(-0.04, uncertain), 0);

const out = buildDataQualityConfidence({ lineupStatus: "NOT IN LINEUP" });
assert.equal(out.grade, "OUT");
assert.equal(applyDataQualityPenalty(72, out), 0);

console.log("Data quality confidence tests passed");
