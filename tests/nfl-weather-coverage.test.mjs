import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NFL_OUTDOOR_VENUES, missingOutdoorVenues } from '../scripts/nfl/weather_venues.js';

const schedule = JSON.parse(await readFile(new URL('../website/data/nfl_schedule.json', import.meta.url), 'utf8'));

test('every outdoor venue in the full NFL schedule has weather coordinates', () => {
  assert.deepEqual(missingOutdoorVenues(schedule.games), []);
  for (const game of schedule.games.filter(row => !row.indoor)) {
    const coordinates = NFL_OUTDOOR_VENUES[game.venue];
    assert.equal(coordinates.length, 2, game.venue);
    assert.ok(coordinates.every(Number.isFinite), game.venue);
  }
});

test('weather availability is advisory instead of a product-wide launch blocker', async () => {
  const audit = await readFile(new URL('../scripts/nfl/build_nfl_launch_audit.js', import.meta.url), 'utf8');
  const client = await readFile(new URL('../website/assets/nfl-lab.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../website/nfl.html', import.meta.url), 'utf8');
  assert.doesNotMatch(audit, /games lack kickoff-hour weather/);
  assert.match(audit, /weather context pending/);
  assert.doesNotMatch(client, /integrity gates remain/);
  assert.match(html, /id="globalNotice"[^>]*hidden/);
});
