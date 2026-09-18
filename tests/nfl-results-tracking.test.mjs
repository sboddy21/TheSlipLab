import test from "node:test";
import assert from "node:assert/strict";
import { auditSnapshotCoverage } from "../scripts/nfl/results_tracking_integrity.js";

const game = (gameId, kickoffUTC) => ({ gameId, kickoffUTC, seasonType: 2, week: 2 });
const lock = (gameId, snapshotAt, kickoffUTC) => ({ snapshotId: `week-2|game-${gameId}`, week: 2, gameId, snapshotAt, kickoffUTC });
const schedule = { games: [game("early", "2026-09-18T00:15:00Z"), game("future", "2026-09-20T17:00:00Z")] };

test("coverage requires every game that is still pre-kickoff at refresh time", () => {
  const results = { week: 2, generatedAt: "2026-09-18T14:00:00Z", snapshots: [] };
  const audit = auditSnapshotCoverage(results, schedule);
  assert.deepEqual(audit.missingRequiredGameIds, ["future"]);
  assert.deepEqual(audit.missedBeforeRefreshGameIds, ["early"]);
});

test("coverage records a missed past lock without inventing a retroactive snapshot", () => {
  const results = { week: 2, generatedAt: "2026-09-18T14:00:00Z", snapshots: [lock("future", "2026-09-18T14:00:00Z", "2026-09-20T17:00:00Z")] };
  const audit = auditSnapshotCoverage(results, schedule);
  assert.equal(audit.requiredAtRefresh, 1);
  assert.equal(audit.currentWeekLocks, 1);
  assert.deepEqual(audit.missingRequiredGameIds, []);
  assert.deepEqual(audit.missedBeforeRefreshGameIds, ["early"]);
});

test("coverage rejects duplicate and post-kickoff locks", () => {
  const late = lock("future", "2026-09-20T17:00:00Z", "2026-09-20T17:00:00Z");
  const results = { week: 2, generatedAt: "2026-09-18T14:00:00Z", snapshots: [late, { ...late, snapshotId: "duplicate" }] };
  const audit = auditSnapshotCoverage(results, schedule);
  assert.deepEqual(audit.duplicateKeys, ["2|future"]);
  assert.equal(audit.invalidSnapshotIds.length, 2);
});
