import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const header = fs.readFileSync("website/assets/site-header.js", "utf8");
const router = fs.readFileSync("website/assets/nfl-lab.js", "utf8");

test("every NFL market header link targets a registered view", () => {
  const expected = {
    "Anytime TD": "touchdowns",
    "Rec Yds": "receiving",
    "Rush Yds": "rushing",
    "Pass Yds": "passing"
  };
  for (const [label, view] of Object.entries(expected)) {
    assert.match(header, new RegExp(`\\["${label}","\\./nfl\\.html#${view}"`));
    assert.match(router, new RegExp(`${view}:\\[`));
  }
});

test("same-page NFL header navigation reacts to hash changes", () => {
  assert.match(router, /addEventListener\("hashchange",\(\)=>setView\(location\.hash\.slice\(1\)\|\|"dashboard"\)\)/);
});
