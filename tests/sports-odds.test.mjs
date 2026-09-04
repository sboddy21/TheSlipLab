import test from 'node:test';
import assert from 'node:assert/strict';
import {rapidQuotes,mainMarkets,bestComparable} from '../scripts/odds/core.mjs';
import {attachCfbOdds} from '../scripts/odds/cfb.mjs';
import {valuePicks} from '../website/assets/cfb-edge.mjs';
import {grade} from '../scripts/cfb/core.mjs';
import {catalogPropEvents} from '../scripts/odds/catalog-to-props.mjs';
import {quoteSides} from '../scripts/mlb/build_market_odds.js';
import {bestPlayerPrice,canonicalRows,playerQuotes,table} from '../website/assets/sports-odds.js';
const now=Date.now(),stamp=new Date(now-1000).toISOString(),kickoff=new Date(now+3600000).toISOString();
const q=(side,extra={})=>({source:'DRAFT_KINGS',marketKey:'market',type:'WIN',participantKey:side,live:false,time:stamp,payout:1.925,modifier:side==='h'?-3.5:3.5,...extra});
const m={key:'market',type:'POINT_SPREAD',segment:'FULL_MATCH',participantKey:null,lastFoundAt:stamp,outcomes:{DRAFT_KINGS:[q('h'),q('a')]}};
const e={key:'event',type:'MATCH',startTime:kickoff,homeParticipantKey:'h',participants:[{key:'h',name:'Home'},{key:'a',name:'Away'}],markets:[m]};
test('RapidAPI requires exact market, participant, source, pregame state and fresh individual timestamps',()=>{
 assert.equal(rapidQuotes(e,[m],now).length,2);
 for(const extra of [{live:true},{time:null},{time:new Date(now-21*60_000).toISOString()},{payout:1},{participantKey:'unknown'},{marketKey:'wrong'},{source:'FAN_DUEL'}])assert.equal(rapidQuotes(e,[{...m,outcomes:{DRAFT_KINGS:[q('h',extra)]}}],now).length,0);
 assert.equal(rapidQuotes({...e,startTime:new Date(now-1).toISOString()},[m],now).length,0);
 assert.equal(rapidQuotes(e,[{...m,segment:'FIRST_HALF'}],now).length,0);
 assert.equal(rapidQuotes(e,[{...m,key:'different'}],now).length,0);
});
test('bulk observations may be displayed but cannot qualify a calibrated NCAAF pick',()=>{
 const quotes=rapidQuotes(e,[m],now,true);
 const game={date:kickoff,timeValid:true,state:'pre',home:{name:'Home'},away:{name:'Away'}};
 const feed={events:[{id:e.key,home:'Home',away:'Away',kickoff}],quotes};
 const attached=attachCfbOdds(game,feed,now);
 assert.equal(attached.market.homeSpread,-3.5);
 assert.equal(valuePicks(attached,{margin:20,total:55},{spread:{intercept:3,slope:0}},now).length,0);
 feed.quotes=rapidQuotes(e,[m],now);
 const picks=valuePicks(attachCfbOdds(game,feed,now),{margin:20,total:55},{spread:{intercept:3,slope:0}},now);
 assert.equal(picks.length,1);assert.equal(picks[0].decimalOdds,1.925);
 assert.equal(grade(picks[0],{completed:true,home:{score:30},away:{score:10}}).units,1.925-1);
});
test('NCAAF keeps paired spread and total lines and rejects mismatched kickoff/teams',()=>{
 const feed={events:[{id:'event',home:'Home',away:'Away',kickoff}],quotes:rapidQuotes(e,[m],now)};
 const game={date:kickoff,state:'pre',home:{name:'Home'},away:{name:'Away'}};
 assert.equal(attachCfbOdds({...game,away:{name:'Other'}},feed,now).market,null);
 assert.equal(attachCfbOdds({...game,date:new Date(now+8*3600000).toISOString()},feed,now).market,null);
 const bad={...m,outcomes:{DRAFT_KINGS:[q('h'),q('a',{modifier:4.5})]}};
 assert.equal(attachCfbOdds(game,{...feed,quotes:rapidQuotes(e,[bad],now)},now).market,null);
});
test('best price compares identical player, market, side, line and event only',()=>{
 const a={providerEventId:'1',player:'A',market:'hits',side:'over',line:0.5,decimalOdds:2,quoteId:'a'};
 const b={...a,decimalOdds:2.1,quoteId:'b'},c={...a,line:1.5,decimalOdds:4,quoteId:'c'};
 assert.deepEqual(bestComparable([a,b,c]).map(q=>q.quoteId),['b','c']);
 assert.equal(mainMarkets({...e,markets:[m,{...m,key:'half',segment:'FIRST_HALF'}]}).length,1);
});
const prop={provider:'PropLine',providerEventId:'p1',providerPlayerId:'mlb:42',player:'José Player',market:'batter_home_runs',side:'over',line:0.5,decimalOdds:4,price:300,book:'Book',bookKey:'book',quotedAt:stamp,kickoff,home:'Home',away:'Away',quoteId:'p1'};
test('player cards reject another doubleheader game, wrong player identity and stale quotes',()=>{
 const games=[{id:1,kickoff,homeNames:['Home'],awayNames:['Away']}];
 const identity={gameId:1,playerId:42,player:'Jose Player'};
 const data={quotes:[prop,{...prop,providerEventId:'p2',kickoff:new Date(now+5*3600000).toISOString()}]};
 assert.equal(playerQuotes(data,games,identity).length,1);
 assert.equal(playerQuotes(data,games,{...identity,gameId:2}).length,0);
 assert.equal(playerQuotes(data,games,{...identity,playerId:43}).length,0);
 assert.equal(playerQuotes({quotes:[{...prop,quotedAt:new Date(now-30*60_000).toISOString()}]},games,identity).length,0);
 // RapidAPI and PropLine event IDs coexist without causing a false ambiguous match.
 assert.equal(playerQuotes({quotes:[...data.quotes,{...prop,player:undefined,providerEventId:'rapid'}]},games,identity).length,1);
});
test('MLB cards show only the best exact HR 0.5 over price',()=>{
 const better={...prop,quoteId:'better',book:'Better Book',decimalOdds:5,price:400};
 const wrongLine={...better,quoteId:'alternate',line:1.5,decimalOdds:12,price:1100};
 const wrongMarket={...better,quoteId:'hits',market:'batter_hits',decimalOdds:8,price:700};
 assert.equal(bestPlayerPrice([prop,better,wrongLine,wrongMarket],'MLB').quoteId,'better');
 assert.equal(bestPlayerPrice([wrongLine,wrongMarket],'MLB'),null);
});
test('canonical game matching accepts the MLB array publication shape',()=>{
 const rows=canonicalRows([{gamePk:1,gameDate:kickoff,homeTeam:'Home',awayTeam:'Away'}]);
 assert.deepEqual(rows,[{id:1,kickoff,homeNames:['Home',undefined],awayNames:['Away',undefined]}]);
 assert.equal(playerQuotes({quotes:[prop]},rows,{gameId:1,playerId:42,player:'Jose Player'}).length,1);
});
test('shared catalog preserves under prices in the HR pipeline and never uses alternate totals',()=>{
 const events=catalogPropEvents({quotes:[prop,{...prop,side:'under',price:-400},{...prop,line:2.5,price:8000}]});
 const quotes=quoteSides(events[0].bookmakers,now);
 assert.equal(quotes.length,1);assert.equal(quotes[0].underPriceAmerican,-400);assert.equal(quotes[0].point,.5);
});
test('price table escapes provider text and explains break-even without inventing a probability',()=>{
 const html=table([{...prop,book:'<img onerror=alert(1)>',timestampKind:'market-observation'}]);
 assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(html.includes('25.0%'));assert.ok(html.includes('Break-even'));assert.ok(html.includes('Market observation'));assert.ok(!html.includes('confidence'));
});

test('NCAAF refresh bounds detailed requests and stops after a rate limit',async()=>{
 const {refreshSport}=await import('../scripts/odds/refresh.mjs');let calls=0;
 const rapid=async endpoint=>{calls++;if(endpoint.includes('/competitions/'))return {data:{events:Array.from({length:20},(_,i)=>({...e,key:String(i)}))},quota:{remaining:900}};throw new Error('Sportsbook HTTP 429');};
 const result=await refreshSport('NCAAF',{rapid,includeProps:false,now});
 assert.equal(calls,2);assert.ok(result.errors.some(e=>e.message.includes('429')));assert.ok(result.quotes.every(q=>q.timestampKind==='market-observation'));
});

test('an observed better price cannot replace a verified price in a model receipt',()=>{
 const verified=rapidQuotes(e,[m],now);const observed={...verified[0],book:'Other book',bookKey:'OTHER',decimalOdds:3,price:200,timestampKind:'market-observation',quoteId:'observed'};
 const game={date:kickoff,timeValid:true,state:'pre',home:{name:'Home'},away:{name:'Away'}};
 const attached=attachCfbOdds(game,{events:[{id:e.key,home:'Home',away:'Away',kickoff}],quotes:[...verified,observed]},now);
 assert.equal(attached.market.homePrice,200);
 const pick=valuePicks(attached,{margin:20,total:55},{spread:{intercept:3,slope:0}},now)[0];
 assert.equal(pick.decimalOdds,1.925);assert.equal(pick.price,verified[0].price);assert.equal(pick.book,'DraftKings');
});
