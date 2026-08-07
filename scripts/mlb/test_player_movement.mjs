import assert from "node:assert/strict";
import { explainPlayerMovement } from "./lib/player_movement.js";

const previous = { lineupStatus: "PROJECTED", lineupSpot: 7, pitcher: "Pitcher A", weather: 40, bullpen: 45, pitchEdge: 50, dataQuality: { score: 62 }, marketAvailable: false, hrConfidence: 50 };
const current = { lineupStatus: "CONFIRMED", confirmedLineup: true, lineupSpot: 2, pitcher: "Pitcher B", weather: 46, bullpen: 45, pitchEdge: 55, dataQuality: { score: 84 }, marketAvailable: true, hrConfidence: 56 };
const movement = explainPlayerMovement(current, previous);

assert.equal(movement.direction, "UP");
assert.equal(movement.confidenceDelta, 6);
assert(movement.reasons.some(reason => reason.key === "lineup_spot"));
assert(movement.reasons.some(reason => reason.key === "probable_pitcher"));
assert(movement.reasons.some(reason => reason.key === "data_quality"));
assert(movement.reasons.some(reason => reason.key === "market_coverage"));

const stable = explainPlayerMovement({ ...previous }, previous);
assert.equal(stable.status, "STABLE");
assert.equal(stable.direction, "UNCHANGED");
assert.deepEqual(stable.reasons, []);

const initial = explainPlayerMovement(current, null);
assert.equal(initial.status, "INITIAL_SNAPSHOT");
assert.equal(initial.direction, "NEW");

const roundedEndpoints = explainPlayerMovement({ hrConfidence: 50.06 }, { hrConfidence: 50.04 });
assert.equal(roundedEndpoints.previousConfidence, 50);
assert.equal(roundedEndpoints.currentConfidence, 50.1);
assert.equal(roundedEndpoints.confidenceDelta, 0.1);

console.log("Player movement tests passed");
