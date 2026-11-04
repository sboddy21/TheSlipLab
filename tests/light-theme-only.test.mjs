import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const headerScript = await readFile(new URL("../website/assets/site-header.js", import.meta.url), "utf8");
const headerStyles = await readFile(new URL("../website/assets/site-header.css", import.meta.url), "utf8");

test("the shared header permanently enforces light mode", () => {
  assert.match(headerScript, /dataset\.theme = "light"/);
  assert.match(headerScript, /style\.colorScheme = "light"/);
  assert.match(headerScript, /localStorage\.removeItem\(THEME_KEY\)/);
  assert.doesNotMatch(headerScript, /localStorage\.setItem\(THEME_KEY/);
});

test("the shared header no longer creates a theme control", () => {
  assert.doesNotMatch(headerScript, /createElement\("button"\)[\s\S]{0,300}tsl-theme-toggle/);
  assert.doesNotMatch(headerScript, /Switch to .* mode/);
  assert.match(headerStyles, /\.tsl-theme-toggle,\[data-tsl-theme-toggle\]\{display:none!important\}/);
});
