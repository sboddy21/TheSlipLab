import test from 'node:test';import assert from 'node:assert/strict';
import {fetchNhlSeasonSkaters} from '../scripts/nhl/stats.mjs';
test('NHL collection retrieves all reported skaters rather than the first hundred',async()=>{
 const starts=[];const result=await fetchNhlSeasonSkaters(20262027,async url=>{const start=Number(new URL(url).searchParams.get('start'));starts.push(start);return{total:205,data:Array.from({length:Math.min(100,205-start)},(_,i)=>({playerId:start+i+1}))};});
 assert.equal(result.rows.length,205);assert.deepEqual(starts,[0,100,200]);
});
test('NHL pagination fails on truncated or repeated provider pages',async()=>{
 await assert.rejects(fetchNhlSeasonSkaters(20262027,async()=>({total:200,data:[]})),/complete coverage/);
 await assert.rejects(fetchNhlSeasonSkaters(20262027,async()=>({total:200,data:[{playerId:1}]})),/duplicate identities/);
});
