import test from 'node:test';
import assert from 'node:assert/strict';
import { completeSlate } from '../website/assets/cfb-market.mjs';
import { scoreboardUrl,fetchScoreboardDay,fetchScoreboardRange } from '../scripts/cfb/espn-scoreboard.mjs';

test('ESPN requests one calendar day instead of the rejected range format',()=>{
  const url=scoreboardUrl(new Date('2026-09-18T12:00:00Z'));
  assert.match(url,/dates=20260918&/);
  assert.doesNotMatch(url,/dates=\d{8}-\d{8}/);
});

test('daily fetch retries transient failures and returns events',async()=>{
  let calls=0;
  const events=await fetchScoreboardDay(new Date('2026-09-18T12:00:00Z'),{fetchImpl:async()=>++calls<3?{ok:false,status:503}:{ok:true,status:200,json:async()=>({events:[{id:'1'}]})},sleepImpl:async()=>{}});
  assert.equal(calls,3);
  assert.deepEqual(events,[{id:'1'}]);
});

test('range refresh reuses cached games only for a failed day',async()=>{
  const warnings=[];
  const events=await fetchScoreboardRange(new Date('2026-09-18T12:00:00Z'),new Date('2026-09-19T12:00:00Z'),{
    fallback:[{id:'cached',date:'2026-09-18T17:00:00Z',home:{},away:{}}],retries:1,onWarning:message=>warnings.push(message),
    fetchImpl:async url=>url.includes('20260918')?{ok:false,status:500}:{ok:true,status:200,json:async()=>({events:[{id:'fresh'}]})}
  });
  assert.deepEqual(events.map(row=>row.id).sort(),['cached','fresh']);
  assert.equal(warnings.length,1);
});


test('ESPN uses a supported page size and retains all 47 Saturday games',async()=>{
  assert.equal(new URL(scoreboardUrl(new Date('2026-10-31T12:00Z'))).searchParams.get('limit'),'200');
  const events=Array.from({length:47},(_,i)=>({id:String(i)}));
  assert.deepEqual(await fetchScoreboardDay(new Date('2026-10-31T12:00Z'),{fetchImpl:async()=>new Response(JSON.stringify({events}))}),events);
});

test('strict refresh rejects a partial week',async()=>{
  await assert.rejects(fetchScoreboardRange(new Date('2026-10-30T12:00Z'),new Date('2026-10-31T12:00Z'),{
    strict:true,retries:1,fetchImpl:async url=>url.includes('20261031')?new Response('',{status:503}):new Response(JSON.stringify({events:[{id:'friday'}]}))
  }),/Incomplete scoreboard/);
});

test('live slate includes new games without projections or odds and keeps saved games',()=>{
  const saved=[{id:'early',projection:{total:50}},{id:'saved-only'}];
  const live=[{id:'early',state:'post'},{id:'evening',state:'pre'}];
  const games=completeSlate(saved,live);
  assert.deepEqual(games.map(g=>g.id),['early','saved-only','evening']);
  assert.equal(games[0].state,'post');
  assert.equal(games[2].projection,undefined);
});
