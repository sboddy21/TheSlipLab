import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const js = await readFile(new URL('website/assets/nfl-lab.js', root), 'utf8');
const css = await readFile(new URL('website/assets/nfl-lab.css', root), 'utf8');
const html = await readFile(new URL('website/nfl.html', root), 'utf8');

test('every NFL player board renders clickable cards', () => {
  assert.match(js, /cardGrid\(rows,'td'\)/);
  assert.match(js, /cardGrid\(rows,kind\)/);
  assert.match(js, /cardGrid\(rows,'receiving'\)/);
  assert.match(js, /class="nfl-player-card" data-player-id=/);
  assert.match(js, /class="compact-player" data-player-id=/);
});

test('player profiles join role, matchup, weather, availability and headshot data', () => {
  for (const source of ['nfl_matchup_context', 'nfl_player_pool', 'nfl_weather', 'nfl_practice_reports']) {
    assert.ok(js.includes(`get('${source}')`), `missing ${source}`);
  }
  for (const label of ['WEEK PROJECTION', 'FORM COMPARISON', 'MATCHUP', 'GAME CONDITIONS', 'WHY THIS PLAYER']) {
    assert.ok(js.includes(label), `missing ${label}`);
  }
  assert.match(js, /base\*\.65\+recent\*\.35/);
  assert.match(js, /not sportsbook lines or guaranteed outcomes/);
});

test('cards and profile sheet include responsive premium styling', () => {
  for (const selector of ['.player-card-grid', '.nfl-player-card', '.player-modal', '.player-sheet', '.profile-columns']) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }
  assert.match(css, /@media\(max-width:720px\).*\.player-card-grid\{grid-template-columns:1fr\}/s);
});

test('position-aware cards and profiles expose actionable volume and scoring data', () => {
  for (const label of ['Pass attempts', 'Completions', 'Completion rate', 'Passing TDs', 'Rush attempts', 'Receptions', 'Catch rate']) {
    assert.ok(js.includes(label), `missing ${label}`);
  }
  for (const metric of ['passAttempts', 'completions', 'passingTds', 'carries', 'receptions', 'targets']) {
    assert.ok(js.includes(`projection(role,'${metric}')`), `missing projection for ${metric}`);
  }
  assert.match(js, /WEEK PROJECTION/);
  assert.match(js, /WEIGHTED BASELINE/);
  assert.match(js, /RECENT SIX/);
  assert.match(css, /\.card-stats\{display:grid;grid-template-columns:repeat\(4,1fr\)/);
});

test('NFL market boards use a contained scrolling workspace and multi-game filters', () => {
  assert.match(js, /state=\{view:"dashboard",query:"",team:"all",games:\[\]/);
  assert.match(js, /function marketWorkspace/);
  assert.match(js, /class="market-results-scroll"/);
  assert.match(js, /state\.games\.includes\(id\)/);
  assert.match(js, /\[\.\.\.state\.games,id\]/);
  assert.match(css, /\.market-workspace\{height:clamp\(/);
  assert.match(css, /\.market-results-scroll\{[^}]*overflow-y:auto/);
  assert.match(css, /@media\(max-width:720px\).*\.market-workspace\{height:auto/s);
});

test('NFL page cache-busts the card release assets', () => {
  assert.match(html, /nfl-lab\.css\?v=20260910-gamelab1/);
  assert.match(html, /nfl-lab\.js\?v=20260910-gamelab1/);
});
