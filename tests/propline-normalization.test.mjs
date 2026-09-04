import test from 'node:test';import assert from 'node:assert/strict';
import {normalizePropLineBooks} from '../scripts/providers/propline.mjs';
import {quoteSides} from '../scripts/mlb/build_market_odds.js';
const now=Date.now();
const market=(player,overrides={})=>({key:'batter_home_runs',last_update:new Date(now-1000).toISOString(),outcomes:[{name:'Yes',description:player,price:400,point:null}],...overrides});
const event=markets=>({commence_time:new Date(now+3600000).toISOString(),live:false,bookmakers:[{key:'draftkings',title:'DraftKings',markets}]});
test('PropLine binary HR props map to one-or-more, and every player market is read',()=>{
 const quotes=quoteSides(normalizePropLineBooks(event([market('A'),market('B')])),now);
 assert.equal(quotes.length,2);assert.ok(quotes.every(q=>q.point===.5));
});
test('reject suspended markets, DFS sources, live events and alternate HR totals',()=>{
 const e=event([market('A',{suspended_at:new Date(now).toISOString()}),market('B',{outcomes:[{name:'Over',description:'B',price:400,point:2.5}]})]);
 assert.equal(quoteSides(normalizePropLineBooks(e),now).length,0);
 e.bookmakers[0].key='prizepicks';assert.equal(normalizePropLineBooks(e).length,0);
 assert.equal(normalizePropLineBooks({...event([]),live:true}).length,0);
});
