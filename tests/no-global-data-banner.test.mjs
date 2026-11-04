import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const memberData = await readFile(new URL("../website/assets/member-data.js", import.meta.url), "utf8");

test("member data failures never inject a sitewide unavailable banner", () => {
  assert.doesNotMatch(memberData, /document\.body\.prepend\(notice\)/);
  assert.doesNotMatch(memberData, /Current data is unavailable for this view/);
  assert.doesNotMatch(memberData, /notice\.setAttribute\("role", "alert"\)/);
});

test("member data still retries a transient 503 once", () => {
  assert.match(memberData, /if \(response\.status === 503\)[\s\S]+setTimeout\(resolve, 750\)[\s\S]+nativeFetch/);
});
