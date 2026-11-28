import test from 'node:test';
import assert from 'node:assert/strict';
import { updateNhlResults, collectNhlFinals } from '../scripts/nhl/results.mjs';
const now=Date.parse('2026-11-28T15:00Z');
const board={date:'2026-11-28',games:[{gameId:123,state:'FUT',startTimeUTC:'2026-11-28T22:00Z'}],players:[{gameId:123,playerId:1,playerName:'Player',team:'BOS',shotsProjection:3,pointsProjection:1,assistsProjection:.5,goalProbability:30}]};
const box={id:123,gameState:'OFF',playerByGameStats:{homeTeam:{forwards:[{playerId:1,goals:1,assists:2,sog:4}]}}};
test('NHL forecasts freeze before kickoff, survive date rollover, and grade exact final identities',()=>{
 const frozen=updateNhlResults(null,board,[],now);
 const changed=structuredClone(board);changed.players[0].shotsProjection=9;
 assert.equal(updateNhlResults(frozen,changed,[],now+1000).snapshots[0].projections.shots,3);
 const graded=updateNhlResults(frozen,{date:'2026-11-29',games:[],players:[]},[box],now+86400000);
 assert.equal(graded.counts.graded,1);assert.equal(graded.metrics.shots.mae,1);assert.equal(graded.metrics.points.mae,2);assert.ok(Math.abs(graded.metrics.goalProbability.brier-.49)<.00001);
 assert.equal(frozen.snapshots[0].status,'pending');
});
test('missing, incomplete, wrong-game and non-final NHL evidence stays pending',()=>{
 const frozen=updateNhlResults(null,board,[],now);
 for(const value of [{...box,id:124},{...box,gameState:'LIVE'},{...box,playerByGameStats:{}},{...box,playerByGameStats:{homeTeam:{forwards:[{playerId:1,goals:1,assists:null,sog:4}]}}}]) assert.equal(updateNhlResults(frozen,board,[value],now+86400000).counts.graded,0);
 assert.equal(updateNhlResults(null,board,[],now+86400000).counts.captured,0);
 const invalid=structuredClone(board);invalid.games[0].startTimeUTC='bad';assert.equal(updateNhlResults(null,invalid,[],now).counts.captured,0);
});
test('NHL final collector retains failed identities and reports provider errors',async()=>{
 const history=updateNhlResults(null,board,[],now);
 const wrong=await collectNhlFinals(history,{now:now+86400000,fetcher:async()=>({ok:true,json:async()=>({...box,id:999})})});
 assert.equal(wrong.boxes.length,0);assert.equal(wrong.errors.length,1);
 const right=await collectNhlFinals(history,{now:now+86400000,fetcher:async()=>({ok:true,json:async()=>box})});assert.equal(right.boxes.length,1);
});
