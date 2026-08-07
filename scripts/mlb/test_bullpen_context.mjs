import assert from "node:assert/strict";
import {
  isRelieverProfile,
  projectPitchingExposure,
  sampleAdjustedRelieverRisk,
  summarizeBullpen
} from "./lib/bullpen_context.js";

assert(sampleAdjustedRelieverRisk(100, 1) < 50, "one-inning samples must shrink toward neutral");
assert(sampleAdjustedRelieverRisk(80, 30) > 75, "established samples should retain most of their signal");
assert.equal(isRelieverProfile({ gamesPitched: 50, gamesStarted: 1 }), true);
assert.equal(isRelieverProfile({ gamesPitched: 25, gamesStarted: 20 }), false);

const summary = summarizeBullpen("Test Club", [
  { playerId: 1, pitcher: "Tiny Sample", hand: "R", gamesPitched: 2, gamesStarted: 0, inningsPitched: 1, hrRiskScore: 100 },
  { playerId: 2, pitcher: "Established", hand: "L", gamesPitched: 45, gamesStarted: 0, inningsPitched: 42, hrRiskScore: 65, saves: 12 },
  { playerId: 3, pitcher: "Starter", hand: "R", gamesPitched: 24, gamesStarted: 24, inningsPitched: 130, hrRiskScore: 90 }
]);
assert.equal(summary.relieverCount, 2);
assert(summary.bullpenRiskScore < 70, "one extreme reliever must not define the entire bullpen");
assert.equal(summary.leftHandedRelievers, 1);

const exposure = projectPitchingExposure(4.5, 70, 40);
assert.equal(exposure.starterPlateAppearances + exposure.bullpenPlateAppearances, 4.5);
assert(exposure.blendedPitchingRisk < 70 && exposure.blendedPitchingRisk > 40);
assert.deepEqual(projectPitchingExposure(0, 70, 40), {
  starterPlateAppearances: 0,
  bullpenPlateAppearances: 0,
  starterShare: 0,
  bullpenShare: 0,
  starterRisk: 70,
  bullpenRisk: 40,
  blendedPitchingRisk: 0
});

console.log("Bullpen context tests passed");
