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

test('live board recovers pregame prices independently of scheduled odds publication',async()=>{
  const {fetchLive}=await import('../website/api/cfb-live.mjs');
  const {currentCfbMarket}=await import('../website/assets/cfb-market.mjs');
  const {valuePicks}=await import('../website/assets/cfb-edge.mjs');
  const now=Date.parse('2026-11-07T12:00:00Z');
  const side=(line,odds)=>({close:{line,odds}});
  const odds={
    provider:{name:'DraftKings'},
    pointSpread:{home:side('-4.5','-105'),away:side('+4.5','-115')},
    total:{over:side('o49.5','-110'),under:side('u49.5','-110')},
    moneyline:{home:side(null,'-185'),away:side(null,'+154')}
  };
  const event={id:'1',date:'2026-11-07T17:00:00Z',status:{type:{state:'pre',name:'STATUS_SCHEDULED'}},competitions:[{
    competitors:[{homeAway:'home',team:{id:'h',displayName:'Home'}},{homeAway:'away',team:{id:'a',displayName:'Away'}}],odds:[odds]
  }]};
  const response=(url,age)=>new Response(JSON.stringify({events:url.includes('20261107')?[event]:[]}),{headers:{age:String(age)}});
  const unavailable=()=>{throw Error('Publication unavailable');};
  const {games:[game]}=await fetchLive(async url=>response(url,0),now,unavailable);
  assert.equal(game.market.homeSpread,-4.5);
  assert.equal(game.market.total,49.5);
  assert.equal(game.market.awayML,154);
  assert.equal(game.market.source,'ESPN scoreboard');
  assert.ok(game.sportsbookQuotes.every(quote=>quote.timestampKind==='market-observation'));
  assert.deepEqual(valuePicks(game,{margin:20,total:70},{spread:{intercept:3,slope:0}},now),[]);
  assert.equal(currentCfbMarket(game,now+21*60_000),null);
  const {games:[expired]}=await fetchLive(async url=>response(url,21*60),now,unavailable);
  assert.equal(expired.market,null);
  event.status.type={state:'in',name:'STATUS_IN_PROGRESS'};
  const {games:[started]}=await fetchLive(async url=>response(url,0),now,unavailable);
  assert.equal(started.market,null);
});
