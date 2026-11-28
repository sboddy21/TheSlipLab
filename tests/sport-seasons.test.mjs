import test from 'node:test';
import assert from 'node:assert/strict';
import { isSportInSeason } from '../website/lib/sport-seasons.mjs';
const at = day => new Date(`${day}T12:00:00-05:00`);
test('WNBA locks after the season window and reopens next year', () => {
  assert.equal(isSportInSeason('wnba', at('2026-10-31')), true);
  assert.equal(isSportInSeason('wnba', at('2026-11-01')), false);
  assert.equal(isSportInSeason('wnba', at('2027-04-30')), false);
  assert.equal(isSportInSeason('wnba', at('2027-05-01')), true);
});
test('winter seasons remain open across New Year and through playoffs', () => {
  for (const sport of ['nfl', 'cfb', 'nba', 'nhl']) {
    assert.equal(isSportInSeason(sport, at('2027-01-15')), true);
    assert.equal(isSportInSeason(sport, at('2027-07-15')), false);
  }
});
test('uses Eastern date rather than UTC at the boundary', () => {
  assert.equal(isSportInSeason('wnba', new Date('2026-11-01T02:00:00Z')), true);
  assert.equal(isSportInSeason('wnba', new Date('2026-11-01T06:00:00Z')), false);
});
test('exact announced dates override recurring defaults', () => {
  const calendar = { wnba: { start: '05-01', end: '10-31', windows: [{ start: '2027-05-14', end: '2027-10-20' }] } };
  assert.equal(isSportInSeason('wnba', at('2027-05-01'), calendar), false);
  assert.equal(isSportInSeason('wnba', at('2027-05-14'), calendar), true);
  assert.equal(isSportInSeason('wnba', at('2027-10-21'), calendar), false);
});

test('MLB stays closed after the confirmed 2026 season end', () => {
  assert.equal(isSportInSeason('mlb', at('2026-11-01')), false);
  assert.equal(isSportInSeason('mlb', at('2026-11-07')), false);
  assert.equal(isSportInSeason('mlb', at('2027-03-20')), true);
});
