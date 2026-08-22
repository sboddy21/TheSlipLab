import assert from "node:assert/strict";
import { buildWnbaChangeFeed } from "./wnba_change_feed_core.js";

const row = (overrides = {}) => ({ playerId: "1", player: "Test Player", team: "NY", opponent: "CON", expectedMinutes: 30, role: "Starter", injury: null, projections: { points: { value: 15 }, rebounds: { value: 5 }, assists: { value: 4 }, threes: { value: 1 } }, ...overrides });
const previous = { date: "2026-08-22", projections: [row()] };
const current = { date: "2026-08-22", generatedAt: "2026-08-22T20:00:00.000Z", projections: [row({ expectedMinutes: 32, role: "Core", injury: { status: "Questionable" }, projections: { points: { value: 17 }, rebounds: { value: 5 }, assists: { value: 4 }, threes: { value: 1 } } })] };
const feed = buildWnbaChangeFeed(previous, current);
assert.equal(feed.status, "ready");
assert.deepEqual(new Set(feed.changes.map(item => item.type)), new Set(["minutes", "projection", "role", "injury"]));
assert.equal(feed.changes.find(item => item.type === "minutes").direction, "up");
assert.equal(feed.changes.find(item => item.type === "projection").market, "points");
assert.equal(buildWnbaChangeFeed(null, current).status, "baseline_established");
assert.equal(buildWnbaChangeFeed(null, current).count, 0);
console.log("WNBA CHANGE FEED TEST PASSED");
