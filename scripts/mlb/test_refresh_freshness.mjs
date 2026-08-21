import assert from "node:assert/strict";
import { belongsToRefresh, isFreshForRefresh } from "./refresh_freshness.mjs";

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

console.log("MLB REFRESH FRESHNESS TEST PASSED");
