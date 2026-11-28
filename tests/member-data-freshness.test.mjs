import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import handler from "../website/api/member-data.mjs";

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
