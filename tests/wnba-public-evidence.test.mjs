import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
async function render({stale=false,view='full-board'}={}) {
 const now=Date.now(),mount={innerHTML:''},status={innerHTML:''};
 const row={gameId:'g1',playerId:'p1',player:'Test Player',team:'A',opponent:'B',gameTimeUTC:new Date(now+3600000).toISOString(),confidence:85,roleScore:80,expectedMinutes:32,role:'Starter',context:{},projections:Object.fromEntries(['points','rebounds','assists','threes'].map(k=>[k,{value:20,floor:15,ceiling:25}]))};
 const payloads={'wnba_live_snapshot.json':{date:'2026-09-04',generatedAt:new Date(now).toISOString(),dataAsOf:new Date(now-(stale?86400000:0)).toISOString(),stale,projections:[row]},'wnba_player_baselines.json':{players:[{playerId:'p1',season:{minutes:32,points:20}}]}};
 const context={document:{body:{dataset:{wnbaView:view}},getElementById:id=>id==='wnbaTool'?mount:status},Date,Map,Set,Promise,console,localStorage:{getItem:()=>null},window:{TSLAccount:{ready:Promise.resolve(),accessToken:async()=>null}},fetch:async url=>({ok:true,json:async()=>payloads[url.split('/').at(-1).split('?')[0]]||{}})};
 vm.runInNewContext(fs.readFileSync('website/assets/wnba-tools.js','utf8'),context);
 await new Promise(resolve=>setImmediate(resolve));
 return {html:mount.innerHTML,status:status.innerHTML};
}
test('public page suppresses fresh-looking projections with stale source inputs',async()=>{
 const result=await render({stale:true});assert.match(result.status,/unavailable/);assert.doesNotMatch(result.html,/Test Player/);
});
test('role heuristic is a score, not a win probability',async()=>{
 const result=await render();assert.match(result.html,/85\/100/);assert.doesNotMatch(result.html,/85%/);
});
test('AI fallback cannot create best-play betting advice from unpriced projections',async()=>{
 const result=await render({view:'ai-says'});assert.match(result.html,/Test Player/);assert.doesNotMatch(result.html,/Best play|Play at|High confidence/);
});
