import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCurrentDataset, checkDataFreshness } from '../website/lib/data-freshness.mjs';
import { buildNbaModelBacktest, applyNbaCalibration } from '../scripts/nba/build_nba_model_backtest.mjs';
import { buildCalibration } from '../scripts/nba/build_nba_results_calibration.mjs';
const now = Date.parse('2026-11-06T16:00:00Z');
const current = { season: 2026, fetchedAt: new Date(now).toISOString() };
test('fresh NBA board and market wrappers cannot hide expired underlying odds', async () => {
  const result = await verifyCurrentDataset('nba_verified_markets.json', current, {now, load: async file => file === 'odds_nba.json' ? {...current, fetchedAt:'2026-11-06T15:00:00Z'} : current});
  assert.equal(result.available, false);
  assert.ok(result.dependencies.find(row=>row.file==='nba_market_lines.json').dependencies.some(row=>!row.available));
});
test('MLB and NFL fresh boards fail closed on missing current inputs', async () => {
  for (const file of ['mlb_home_runs.json','nfl_td_decision_center.json']) {
    const result = await verifyCurrentDataset(file,current,{now,load:async dependency=>{if(['mlb_weather.json','nfl_current_usage.json'].includes(dependency))throw Error('missing');return current;}});
    assert.equal(result.available,false,file);
  }
});
test('nested provider times and old quotes survive new wrapper timestamps', () => {
  for (const field of ['sourceFetchedAt','quotedAt','dataAsOf']) {
    const result=checkDataFreshness('nba_market_lines.json',{...current,quotes:[{[field]:'2026-11-06T15:00:00Z'}]},{now});
    assert.equal(result.available,false,field);
  }
});
test('backtest holds entire dates apart and does not invent zero-valued missing stats', () => {
  const recentGames=Array.from({length:12},(_,index)=>({gameId:`g${index}`,gameDate:`2026-10-${String(index+1).padStart(2,'0')}`,points:10+index,rebounds:5,assists:4,threesMade:2}));
  const result=buildNbaModelBacktest({players:Array.from({length:30},(_,i)=>({playerId:String(i),recentGames}))},'2026-11-06',now);
  for(const row of Object.values(result.markets)) {
    assert.ok(row.trainingThrough<row.testFrom);
    assert.equal(row.validatesLiveProjectionPipeline,false);
    assert.ok(Number.isFinite(row.baselineTestMae));
  }
  const missing=buildNbaModelBacktest({players:[{playerId:'1',recentGames:recentGames.map(row=>({...row,points:null}))}]},'2026-11-06',now);
  assert.equal(missing.markets.points.samples,0);
});
test('missing metrics and a rate-baseline diagnostic cannot validate live NBA predictions',()=>{
  for(const evidence of [{testSamples:100,calibratedTestMae:null},{testSamples:100,calibratedTestMae:1,rawTestMae:1,baselineTestMae:2,validatesLiveProjectionPipeline:false}]) {
    const result=buildCalibration({snapshots:[]},'2026-11-06',now,{markets:{points:evidence}});
    assert.equal(result.markets.points.walkForward.passing,false);
    assert.equal(result.markets.points.pricedStrategyValidated,false);
  }
});

test('unvalidated baseline corrections cannot change live projection values', () => {
  const result = applyNbaCalibration(20, 'points', {markets:{points:{correctionApplied:true,correction:4,validatesLiveProjectionPipeline:false}}});
  assert.equal(result.value,20);
  assert.equal(result.applied,false);
});
test('CFB sport aliases cannot bypass season checks and nested quotes expire at twenty minutes', () => {
  assert.equal(checkDataFreshness('cfb_board.json',{...current,sport:'NCAAF',season:2025},{now}).available,false);
  assert.equal(checkDataFreshness('nba_points.json',{...current,prices:[{quotedAt:'2026-11-06T15:39:00Z'}]},{now}).available,false);
});
