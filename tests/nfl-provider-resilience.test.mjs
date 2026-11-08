import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fetchText } from "../scripts/nfl/fetch_nfl_availability.js";

test("NFL provider fetch retries transient gateway failures with exponential backoff", async () => {
  const statuses = [504, 503, 200];
  const waits = [];
  let calls = 0;
  const result = await fetchText("https://provider.example/depth.csv", 5, async () => {
    const status = statuses[calls++];
    return { ok: status === 200, status, text: async () => "verified-depth-snapshot" };
  }, async delay => waits.push(delay));
  assert.equal(result, "verified-depth-snapshot");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test("NFL refresh and delivery retain explicit cached and delayed-data safeguards", () => {
  const fetcher = fs.readFileSync("scripts/nfl/fetch_nfl_availability.js", "utf8");
  const validator = fs.readFileSync("scripts/nfl/validate_nfl_foundation.js", "utf8");
  const delivery = fs.readFileSync("website/api/member-data.mjs", "utf8");
  assert.match(fetcher, /preserving last verified snapshot/);
  assert.match(fetcher, /available_cached/);
  assert.match(validator, /available_cached/);
  assert.match(delivery, /canServeDelayedDataset/);
  assert.match(delivery, /X-Data-Freshness/);
});
