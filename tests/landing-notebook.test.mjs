import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const landing = await readFile(new URL("../website/index.html", import.meta.url), "utf8");
const styles = await readFile(new URL("../website/assets/landing-notebook.css", import.meta.url), "utf8");

test("landing page uses the notebook redesign", () => {
  assert.match(landing, /class="landing-notebook"/);
  assert.match(landing, /landing-notebook\.css/);
  assert.match(styles, /repeating-linear-gradient/);
  assert.match(styles, /--landing-margin/);
  assert.match(styles, /body\.landing-notebook \.scoreboard/);
});

test("landing sports selector keeps offseason sports non-clickable", () => {
  assert.match(landing, /class="league offseason" aria-disabled="true"[^>]+data-sport="mlb"/);
  assert.match(landing, /class="league offseason" aria-disabled="true"[^>]+data-sport="wnba"/);
  assert.match(landing, /landing-seasons\.js/);
});
