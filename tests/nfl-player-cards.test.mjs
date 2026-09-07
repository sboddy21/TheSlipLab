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
  for (const label of ['OPPORTUNITY', 'MATCHUP', 'GAME CONDITIONS', 'WHY THIS PLAYER']) {
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

test('NFL page cache-busts the card release assets', () => {
  assert.match(html, /nfl-lab\.css\?v=20260907-cards1/);
  assert.match(html, /nfl-lab\.js\?v=20260907-cards1/);
});
