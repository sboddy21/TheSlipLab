import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSportPipeline,pipelines} from '../scripts/validate-sport-pipeline.mjs';
const now=Date.parse('2026-11-28T16:00Z');
test('pipeline gate rejects stale schedules and duplicate canonical games',async()=>{
 const results={slates:[],marketMetrics:{}};
 const load=async file=>file==='nba_results.json'?results:{sport:'NBA',date:'2026-11-28',fetchedAt:'2026-11-28T15:59Z',games:[{gameId:1},{gameId:1}]};
 assert.ok((await validateSportPipeline('nba',{load,now})).errors.includes('duplicate_game_identity'));
 const stale=async file=>file==='nba_results.json'?results:{sport:'NBA',date:'2026-11-28',fetchedAt:'2026-11-27T15:59Z',games:[]};
 assert.ok((await validateSportPipeline('nba',{load:stale,now})).errors.includes('schedule_not_current'));
});
test('verified no-game schedules pass without fabricating projections or settled samples',async()=>{
 for(const sport of Object.keys(pipelines)){
  const config=pipelines[sport];
  const board={sport:sport.toUpperCase(),date:'2026-11-28',season:sport==='nhl'?20262027:2026,generatedAt:'2026-11-28T15:59Z',games:[],archive:[]};
  const results={snapshots:[],slates:[],marketMetrics:{},methodology:{snapshotRequiredBeforeKickoff:true},markets:{},games:[],days:[]};
  const receipt=await validateSportPipeline(sport,{now,load:async file=>file===config.board?board:results});
  assert.equal(receipt.status,'passed',sport+JSON.stringify(receipt.errors));assert.equal(receipt.schedule.games,0);
 }
});
