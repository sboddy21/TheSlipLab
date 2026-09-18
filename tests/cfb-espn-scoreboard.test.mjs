import test from 'node:test';
import assert from 'node:assert/strict';
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
