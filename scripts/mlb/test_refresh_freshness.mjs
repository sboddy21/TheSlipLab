import assert from "node:assert/strict";
import { belongsToRefresh, isFreshForRefresh, validHealthFreshnessWindow } from "./refresh_freshness.mjs";

const minute = 60 * 1000;
const generatedAt = Date.parse("2026-08-21T13:48:15.000Z");
const refreshStartedAt = generatedAt - (16 * minute + 15 * 1000);
const sameRunPreflight = refreshStartedAt + 2 * 1000;
const previousRunArtifact = refreshStartedAt - 2 * 1000;

assert.equal(belongsToRefresh(sameRunPreflight, refreshStartedAt), true);
assert.equal(isFreshForRefresh({
  timestamp: sameRunPreflight,
  generatedAt,
  maxAgeMs: 15 * minute,
  refreshStartedAt
}), true, "same-run preflight must remain valid when the workflow runs longer than 15 minutes");

assert.equal(belongsToRefresh(previousRunArtifact, refreshStartedAt), false);
assert.equal(isFreshForRefresh({
  timestamp: previousRunArtifact,
  generatedAt,
  maxAgeMs: 15 * minute,
  refreshStartedAt
}), false, "an equally old artifact from before the current run must remain stale");

assert.equal(isFreshForRefresh({
  timestamp: generatedAt - 31 * minute,
  generatedAt,
  maxAgeMs: 15 * minute,
  refreshStartedAt: generatedAt - 31 * minute
}), false, "an implausibly old refresh start must not exempt stale data");

const sourceDeadline = generatedAt + 9 * minute;
assert.equal(validHealthFreshnessWindow({
  generatedAt,
  freshUntil: sourceDeadline,
  refreshWindowMs: 15 * minute,
  artifactDeadlines: [sourceDeadline, generatedAt + 70 * minute]
}), true, "health may expire before the nominal window when a required source expires first");
assert.equal(validHealthFreshnessWindow({
  generatedAt,
  freshUntil: generatedAt + 15 * minute,
  refreshWindowMs: 15 * minute,
  artifactDeadlines: [sourceDeadline]
}), false, "health must not outlive its earliest required source");

console.log("MLB REFRESH FRESHNESS TEST PASSED");
