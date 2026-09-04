import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteSides } from '../scripts/mlb/build_market_odds.js';
const now = Date.parse('2026-09-04T15:00:00Z');
const outcome = (name, point, price) => ({description:'Test Batter', name, point, price});
function quotes(outcomes, timestamp = '2026-09-04T14:59:00Z') {
  return quoteSides([{key:'test',title:'Test',markets:[{key:'batter_home_runs',last_update:timestamp,outcomes}]}],now);
}
test('alternate HR thresholds cannot replace the one-HR market or its opposite side', () => {
  const rows = quotes([outcome('Over',.5,400),outcome('Under',.5,-600),outcome('Over',2.5,19900),outcome('Under',2.5,-50000)]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].point,.5);
  assert.equal(rows[0].overPriceAmerican,400);
  assert.equal(rows[0].underPriceAmerican,-600);
});
test('reject missing thresholds, invalid prices and stale quotes', () => {
  for (const point of [null,undefined,'',1.5,2.5]) assert.equal(quotes([outcome('Over',point,400)]).length,0);
  assert.equal(quotes([outcome('Over',.5,0)]).length,0);
  assert.equal(quotes([outcome('Over',.5,400)],'2026-09-04T13:00:00Z').length,0);
});
