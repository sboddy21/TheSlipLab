import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createMemberDataHandler } from "../website/api/member-data.mjs";
import { createPublishedDataReader } from "../website/lib/published-data.mjs";
const handler = createMemberDataHandler({ readerFactory: () => createPublishedDataReader({remote:false}) });

test("public API withholds stale data, including HEAD, and serves current data without changing shape", async () => {
  const original = process.cwd();
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "slip-freshness-"));
  await fs.mkdir(path.join(directory, "website/data"), { recursive: true });
  function response() {
    return { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, end() { return this; } };
  }
  try {
    process.chdir(directory);
    for (const file of ["nba_workspace.json", "nba_player_4396971.json"]) {
      const denied = response();
      await handler({ method: "GET", query: { file }, headers: {} }, denied);
      assert.equal(denied.code, 401, "Live NBA datasets keep membership authorization");
    }
    const file = path.join(directory, "website/data/nba_availability.json");
    await fs.writeFile(file, JSON.stringify({ fetchedAt: "2020-01-01T00:00:00Z", players: [] }));
    for (const method of ["GET", "HEAD"]) {
      const stale = response();
      await handler({ method, query: { file: "nba_availability.json" }, headers: {} }, stale);
      assert.equal(stale.code, 503);
      assert.equal(stale.body.error, "current_data_unavailable");
      assert.match(stale.headers["Cache-Control"], /no-store/);
      assert.equal(stale.headers["Retry-After"], "60");
    }
    const payload = { fetchedAt: new Date().toISOString(), players: [] };
    await fs.writeFile(file, JSON.stringify(payload));
    const fresh = response();
    await handler({ method: "GET", query: { file: "nba_availability.json" }, headers: {} }, fresh);
    assert.equal(fresh.code, 200);
    assert.deepEqual(JSON.parse(fresh.body), payload);
    await fs.writeFile(path.join(directory, "website/data/nba_results.json"), JSON.stringify({ date: "2020-01-01", slates: [] }));
    const archive = response();
    await handler({ method: "GET", query: { file: "nba_results.json" }, headers: {} }, archive);
    assert.equal(archive.code, 200);
  } finally {
    process.chdir(original);
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("member API serves a delayed but usable NFL board instead of returning a site-wide outage", async () => {
  const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  const generatedAt = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
  const payload = { sport: "NFL", schemaVersion: "1.0", season: 2026, week: 9, generatedAt, rows: [{ playerId: "1", playerName: "Verified Player" }] };
  const delayedHandler = createMemberDataHandler({ readerFactory: () => async () => payload });
  const delayed = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, end() { return this; } };
  try {
    await delayedHandler({ method: "GET", query: { file: "nfl_td_decision_center.json" }, headers: { "x-member-data-service-key": "test-service-key" } }, delayed);
    assert.equal(delayed.code, 200);
    assert.equal(delayed.headers["X-Data-Freshness"], "delayed");
    assert.match(delayed.headers.Warning, /last verified NFL data/);
    assert.deepEqual(JSON.parse(delayed.body), payload);
  } finally {
    if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
  }
});
