import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pages = ["mlb", "wnba", "nfl", "cfb", "nba", "nhl"];

test("every primary sport hub loads the shared notebook workspace", () => {
  for (const sport of pages) {
    const html = fs.readFileSync(`website/${sport}.html`, "utf8");
    assert.match(html, /sports-notebook\.css/);
    assert.match(html, /sports-notebook\.js/);
  }
});

test("notebook navigation links active sports and disables MLB and WNBA", () => {
  const script = fs.readFileSync("website/assets/sports-notebook.js", "utf8");
  for (const sport of ["nfl", "cfb", "nba", "nhl"]) assert.match(script, new RegExp(`\\["${sport.toUpperCase() === "CFB" ? "CFB" : sport.toUpperCase()}", "${sport}\\.html", true\\]`));
  assert.match(script, /\["MLB", "mlb\.html", false\]/);
  assert.match(script, /\["WNBA", "wnba\.html", false\]/);
  assert.match(script, /aria-disabled="true"/);
  assert.match(script, /aria-current="page"/);
});

test("NBA navigation omits retired workspace links", () => {
  const header = fs.readFileSync("website/assets/site-header.js", "utf8");
  const nbaBlock = header.slice(header.indexOf("const nbaItems"), header.indexOf("const nhlItems"));
  assert.doesNotMatch(nbaBlock, /Game Lab|Availability|Player Board/);
  assert.doesNotMatch(header, /\[\["NBA Home"[^\n]+Game Lab/);
});

test("notebook theme preserves readable data typography and responsive paper", () => {
  const styles = fs.readFileSync("website/assets/sports-notebook.css", "utf8");
  assert.match(styles, /repeating-linear-gradient/);
  assert.match(styles, /notebook-margin/);
  assert.match(styles, /body\.sports-notebook table/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.doesNotMatch(styles, /body\.sports-notebook table[^}]+font-family:\s*"?(?:Noteworthy|Bradley Hand)/);
});
