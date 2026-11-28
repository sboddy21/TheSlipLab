import test from 'node:test';
import assert from 'node:assert/strict';
import { currentSeasonStart } from '../website/lib/current-season.mjs';
import { checkDataFreshness } from '../website/lib/data-freshness.mjs';
const now = Date.parse('2026-11-06T16:00:00Z');
const fresh = { fetchedAt: new Date(now).toISOString() };
test('freshly rebuilt old-season data is rejected for every sport', () => {
  for (const sport of ['mlb','nba','wnba','nfl','cfb','nhl']) {
    const expected = currentSeasonStart(sport, now);
    assert.equal(checkDataFreshness(`${sport}_board.json`, {...fresh, sport, season: expected - 1}, {now}).available, false, sport);
    assert.equal(checkDataFreshness(`${sport}_board.json`, {...fresh, sport, season: expected}, {now}).available, true, sport);
  }
});
test('mixed historical NFL seasons and old NHL composite seasons are rejected', () => {
  assert.ok(checkDataFreshness('nfl_usage_baselines.json', {...fresh, seasons:[2025,2026]}, {now}).reasons.includes('non_current_season'));
  assert.ok(checkDataFreshness('nhl_board.json', {...fresh, historySeason:20252026}, {now}).reasons.includes('non_current_season'));
  assert.equal(checkDataFreshness('nhl_board.json', {...fresh, historySeason:20262027}, {now}).available, true);
});
test('statistical feeds require season evidence', () => {
  assert.ok(checkDataFreshness('nba_history.json', fresh, {now}).reasons.includes('missing_season_evidence'));
});
test('winter seasons retain their current season through January', () => {
  for (const sport of ['nba','nhl','nfl','cfb']) assert.equal(currentSeasonStart(sport, '2027-01-15T12:00:00Z'), 2026);
});
