import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=process.cwd();
test('new receipts retain only matching fresh one-HR prices and shadow version',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sliplab-receipt-'));
 try {
  const data=path.join(temp,'website/data');fs.mkdirSync(data,{recursive:true});
  fs.mkdirSync(path.join(temp,'scripts/mlb'),{recursive:true});
  fs.copyFileSync(path.join(root,'scripts/mlb/hr-calibration-candidate.json'),path.join(temp,'scripts/mlb/hr-calibration-candidate.json'));
  const now=Date.now(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date(now));
  const write=(name,payload)=>fs.writeFileSync(path.join(data,name+'.json'),JSON.stringify(payload));
  write('hr_ai_breakdowns',{players:{Test:{playerId:1,player:'Test',team:'Home',opponent:'Away'}}});
  write('mlb_games_today',{date,games:[{gamePk:10,gameDate:new Date(now+3600000).toISOString(),homeTeam:'Home',awayTeam:'Away'}]});
  write('hr_probability_tracking',{players:[{playerId:1,player:'Test',team:'Home',realHrProbability:20}]});
  const quote={gamePk:10,playerId:1,market:'batter_home_runs',point:.5,date,overPriceAmerican:400,providerLastUpdate:new Date(now-60000).toISOString(),bookmakerKey:'test',quoteId:'valid'};
  write('mlb_market_odds',{prices:[quote,{...quote,point:2.5},{...quote,gamePk:11},{...quote,playerId:2},{...quote,providerLastUpdate:new Date(now-3600000).toISOString()}]});
  const run=spawnSync(process.execPath,[path.join(root,'scripts/build_hr_ai_history.cjs')],{cwd:temp,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  const receipt=JSON.parse(fs.readFileSync(path.join(data,'hr_ai_history.json'))).history.Test[0];
  assert.equal(receipt.marketQuotes.length,1);assert.equal(receipt.marketQuotes[0].quoteId,'valid');
  assert.equal(receipt.shadowCalibration.version,'hr-logistic-shadow-v1');
  assert.equal(receipt.probability,20);assert.ok(receipt.shadowCalibration.probability>0&&receipt.shadowCalibration.probability<1);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
