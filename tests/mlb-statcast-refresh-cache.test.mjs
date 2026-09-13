import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("current-run Statcast cache rejects stale or mismatched identities", async () => {
  const previousCwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "sliplab-statcast-cache-"));
  process.chdir(directory);

  try {
    const moduleUrl = new URL(`../scripts/mlb/lib/statcast_refresh_cache.js?test=${Date.now()}`, import.meta.url);
    const { readStatcastRefreshRows, writeStatcastRefreshRows } = await import(moduleUrl);
    const identity = {
      slateDate: "2026-09-13",
      season: 2026,
      playerType: "batter",
      playerId: 123
    };
    const rows = [{ pitch_type: "FF", plate_x: "0.2" }];

    writeStatcastRefreshRows({ ...identity, rows });
    assert.deepEqual(readStatcastRefreshRows(identity), rows);
    assert.equal(readStatcastRefreshRows({ ...identity, slateDate: "2026-09-14" }), null);
    assert.equal(readStatcastRefreshRows({ ...identity, playerType: "pitcher" }), null);
    assert.equal(readStatcastRefreshRows({ ...identity, playerId: 456 }), null);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("MLB refresh keeps bounded parallel Statcast fetching and a defensive timeout margin", () => {
  const root = path.resolve(new URL("..", import.meta.url).pathname);
  const pitchDamage = fs.readFileSync(path.join(root, "scripts/mlb/build_pitch_type_damage.js"), "utf8");
  const zones = fs.readFileSync(path.join(root, "scripts/statcast_zone_engine.js"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/mlb-refresh.yml"), "utf8");

  assert.match(pitchDamage, /Math\.min\(12, Math\.max\(1, Number\(process\.env\.MLB_STATCAST_CONCURRENCY\) \|\| 8\)\)/);
  assert.match(zones, /readStatcastRefreshRows/);
  assert.match(pitchDamage, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.match(zones, /AbortSignal\.timeout\(REQUEST_TIMEOUT_MS\)/);
  assert.match(workflow, /timeout-minutes: 28/);
});
