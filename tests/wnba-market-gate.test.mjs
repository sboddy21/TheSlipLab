import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMarkets } from '../scripts/wnba/build_wnba_verified_markets.js';
const now = Date.parse('2026-09-04T15:00:00Z');
const board = {date:'2026-09-04',generatedAt:new Date(now).toISOString(),dataAsOf:new Date(now).toISOString(),projections:[{gameId:'g1',playerId:'p1',gameTimeUTC:'2026-09-04T19:00:00Z',confidence:85,projections:{points:{value:25}}}]};
const calibration = {minimumSamples:150,markets:{points:{samples:1000,mae:3,passing:true}}};
const line = {gameId:'g1',playerId:'p1',market:'points',line:20.5,overOdds:-110,underOdds:-110,source:'test',fetchedAt:new Date(now).toISOString()};
const evaluate = (change={},b=board) => evaluateMarkets(b,calibration,{date:board.date,authorizedSources:['test'],lines:[{...line,...change}]},now);
test('low projection MAE cannot unlock an unvalidated betting strategy', () => {
  const result=evaluate(); assert.equal(result.locked,true); assert.equal(result.recommendations.length,0);
  assert.equal(result.gateSummary[0].projectionPassing,true); assert.equal(result.gateSummary[0].passing,false);
});
test('reject cross-game matches, missing prices and null lines', () => {
  assert.ok(evaluate({gameId:'g2'}).rejectedLines[0].reasons.includes('missing_live_projection'));
  assert.ok(evaluate({overOdds:null}).rejectedLines[0].reasons.includes('missing_or_invalid_prices'));
  assert.ok(evaluate({line:null}).rejectedLines[0].reasons.includes('invalid_line'));
});
test('reject started games and recently regenerated boards with stale inputs', () => {
  assert.ok(evaluate({}, {...board,projections:[{...board.projections[0],gameTimeUTC:new Date(now).toISOString()}]}).rejectedLines[0].reasons.includes('game_not_pregame'));
  assert.ok(evaluate({}, {...board,dataAsOf:'2026-09-03T15:00:00Z'}).rejectedLines[0].reasons.includes('stale_inputs'));
});
