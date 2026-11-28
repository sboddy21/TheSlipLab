import test from 'node:test';import assert from 'node:assert/strict';import {verifiedBoard} from '../scripts/read-current-board.mjs';
const now=Date.parse('2026-11-28T16:00Z');
test('current board reader rejects an old local-style board rather than presenting it as current',async()=>{
 await assert.rejects(verifiedBoard('ncaam',{now,load:async()=>({sport:'NCAAM',date:'2026-11-06',generatedAt:'2026-11-06T20:00Z',games:[]})}),/do not substitute/);
 const result=await verifiedBoard('ncaam',{now,load:async()=>({sport:'NCAAM',date:'2026-11-28',generatedAt:'2026-11-28T15:59Z',games:[]})});assert.equal(result.freshness.available,true);
});

test('expired NCAAM prices cannot hide a current schedule or acquire a new timestamp',async()=>{
 const generatedAt='2026-11-28T15:59Z';const result=await verifiedBoard('ncaam',{now,load:async()=>({sport:'NCAAM',date:'2026-11-28',generatedAt,games:[{id:'1',quotes:[{quotedAt:'2026-11-28T15:00Z'}]}]})});
 assert.equal(result.payload.generatedAt,generatedAt);assert.equal(result.payload.games.length,1);assert.deepEqual(result.payload.games[0].quotes,[]);
});
