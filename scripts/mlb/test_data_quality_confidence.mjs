import assert from "node:assert/strict";
import { applyDataQualityPenalty, buildDataQualityConfidence, dataQualityPenaltyIssue, normalizeModelConfidence } from "./lib/data_quality_confidence.js";

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

for (let hundredths = -100; hundredths <= 10100; hundredths += 1) {
  const input = hundredths / 100;
  const raw = normalizeModelConfidence(input);
  const adjusted = applyDataQualityPenalty(input, uncertain);
  assert.equal(dataQualityPenaltyIssue(raw, adjusted, uncertain), "", `unsafe penalty for input ${input}`);
}

assert.equal(dataQualityPenaltyIssue(Number.NaN, 1, uncertain), "invalid raw confidence");
assert.equal(dataQualityPenaltyIssue(1, Number.NaN, uncertain), "invalid adjusted confidence");
assert.equal(dataQualityPenaltyIssue(1, 1, { ...uncertain, penaltyFactor: Number.NaN }), "penalty factor outside 0.85-1.00");
assert.equal(dataQualityPenaltyIssue(1, 1.1, uncertain), "adjusted confidence exceeds raw confidence");

const out = buildDataQualityConfidence({ lineupStatus: "NOT IN LINEUP" });
assert.equal(out.grade, "OUT");
assert.equal(applyDataQualityPenalty(72, out), 0);
assert.equal(dataQualityPenaltyIssue(72, 0, out), "");
assert.equal(dataQualityPenaltyIssue(72, 1, out), "out player retained adjusted confidence");

console.log("Data quality confidence tests passed");
