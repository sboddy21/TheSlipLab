import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createPublishedDataReader} from '../website/lib/published-data.mjs';
import {verifyCurrentDataset,sourceDependencies} from '../website/lib/data-freshness.mjs';
import {loadNhlLiveBoard} from '../website/lib/nhl-live.mjs';
const now=Date.parse('2026-11-06T16:00:00Z');
test('latest published data replaces an expired deployment without changing source times',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'slip-delivery-'));
 try {
  await fs.writeFile(path.join(dir,'nba_points.json'),JSON.stringify({generatedAt:'2026-11-06T12:00:00Z'}));
  const payload={season:2026,generatedAt:'2026-11-06T15:59:00Z',players:[]};let calls=0;
  const load=createPublishedDataReader({roots:[dir],now:()=>now,fetcher:async url=>{calls++;assert.match(url,/raw\.githubusercontent\.com\/sboddy21\/TheSlipLab\/main\/website\/data\//);return{ok:true,json:async()=>payload};}});
  assert.deepEqual(await load('nba_points.json'),payload);assert.deepEqual(await load('nba_points.json'),payload);assert.equal(calls,1);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('failed published source never relabels an expired local snapshot',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'slip-delivery-'));
 try {
  await fs.writeFile(path.join(dir,'nfl_schedule.json'),JSON.stringify({sport:'NFL',season:2026,generatedAt:'2026-11-05T12:00:00Z'}));
  const load=createPublishedDataReader({roots:[dir],now:()=>now,fetcher:async()=>{throw Error('offline');}});
  const payload=await load('nfl_schedule.json');
  assert.equal((await verifyCurrentDataset('nfl_schedule.json',payload,{now})).available,false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('optional odds and weather do not gate current game and projection displays',()=>{
 assert.ok(!sourceDependencies('cfb_board.json').includes('odds_ncaaf.json'));
 assert.ok(!sourceDependencies('nfl_matchup_context.json').includes('nfl_weather.json'));
 assert.ok(!sourceDependencies('mlb_market_odds.json').includes('odds_mlb.json'));
 assert.ok(sourceDependencies('nba_verified_markets.json').includes('odds_nba.json'));
});
test('NHL live cache rolls over on the Eastern date and retries after provider failure',async()=>{
 let dates=[];const build=async({date})=>{dates.push(date);return{date};};
 await loadNhlLiveBoard({now:Date.parse('2026-11-07T04:59:00Z'),build});
 await loadNhlLiveBoard({now:Date.parse('2026-11-07T05:00:00Z'),build});
 assert.deepEqual(dates,['2026-11-06','2026-11-07']);
 await assert.rejects(loadNhlLiveBoard({now:Date.parse('2026-11-08T12:00:00Z'),build:async()=>{throw Error('provider');}}));
 assert.equal((await loadNhlLiveBoard({now:Date.parse('2026-11-08T12:00:01Z'),build})).date,'2026-11-08');
});

test('settled CFB receipts never expire a fresh board, while current inputs still do',async()=>{
 const payload={sport:'NCAAF',season:2026,generatedAt:'2026-11-06T15:59:00Z',games:[],archive:[{quotedAt:'2025-10-01T12:00:00Z',result:'won'}]};
 assert.equal((await verifyCurrentDataset('cfb_board.json',payload,{now})).available,true);
 assert.equal((await verifyCurrentDataset('cfb_board.json',{...payload,sources:{stats:{sourceFetchedAt:'2026-11-05T00:00:00Z'}}},{now})).available,false);
});
test('expired prices are removed without hiding current CFB games or changing timestamps',async()=>{
 const {prepareCurrentMarkets}=await import('../website/lib/current-markets.mjs');
 const quote={quotedAt:'2026-11-06T15:00:00Z'};
 const payload={generatedAt:'2026-11-06T15:59:00Z',games:[{id:'1',projection:{total:50},market:{quoteDetails:{spread:{home:quote}}},leans:[{side:'home'}],sportsbookQuotes:[quote]}]};
 const result=prepareCurrentMarkets('cfb_board.json',payload,now);
 assert.equal(result.generatedAt,payload.generatedAt);assert.equal(result.games.length,1);assert.equal(result.games[0].market,null);assert.equal(result.games[0].projection.total,50);assert.deepEqual(result.games[0].leans,[]);assert.ok(payload.games[0].market);
});
test('refresh workflows do not share one cancellable pending slot across sports',async()=>{
 const names=['nba','nfl','nhl','wnba','cfb'];
 for(const name of names){const source=await fs.readFile(`.github/workflows/${name}-refresh.yml`,'utf8');assert.ok(!source.includes('production-data-writers'));assert.ok(source.includes('${{ github.workflow }}-${{ github.ref }}'));}
});

test('NBA retains working markets when one projection feed fails',async()=>{
 const {loadNbaBoardData}=await import('../website/assets/nba-board-data.mjs');
 const data=await loadNbaBoardData(async file=>{
  if(file==='nba_threes.json')throw Error('market down');
  if(file==='nba_games_today.json')return{date:'2026-11-06',games:[{gameId:'1'}]};
  return{players:[{playerId:'a',gameId:'1',pointsLean:20}]};
 });
 assert.equal(data.games.length,1);assert.equal(data.models.points[0].pointsLean,20);assert.deepEqual(data.models.threes,[]);assert.ok(data.missing.includes('nba_threes.json'));
});
test('NBA displays a current roster and schedule when the model snapshot expires',async()=>{
 const {loadNbaBoardData}=await import('../website/assets/nba-board-data.mjs');
 const data=await loadNbaBoardData(async file=>{
  if(file!=='nba_workspace.json')throw Error('snapshot expired');
  return{date:'2026-11-06',fetchedAt:'2026-11-06T16:00:00Z',games:[{id:'2',home:{abbreviation:'BOS'},away:{abbreviation:'ATL'}}],players:[{id:'3',player:'Test',gameId:'2',team:'BOS'}]};
 });
 assert.equal(data.games[0].gameId,'2');assert.equal(data.cards[0].playerId,'3');assert.deepEqual(data.cards[0].recentGames,[]);assert.deepEqual(data.models.points,[]);
});
test('NFL direct scoreboard preserves postseason games without using a regular-season snapshot',async()=>{
 const {loadNflWorkspace}=await import('../website/lib/nfl-live.mjs');
 const result=await loadNflWorkspace({now:Date.parse('2027-01-17T16:00:00Z'),fetcher:async()=>({ok:true,json:async()=>({leagues:[{slug:'nfl',season:{year:2026}}],week:{number:2},events:[{id:'g1',date:'2027-01-17T20:00:00Z',season:{type:3},competitions:[{competitors:[{homeAway:'home',team:{id:'1',abbreviation:'KC'}},{homeAway:'away',team:{id:'2',abbreviation:'BUF'}}]}]}]})})});
 assert.equal(result.games.length,1);assert.equal(result.seasonType,3);assert.equal(result.week,2);
});

test('publisher resynchronizes a racing commit without overwriting another sport',async()=>{
 const {publishRefresh}=await import('../scripts/publish-refresh.mjs');
 const commands=[];let pushes=0;
 await publishRefresh({branch:'main',wait:async()=>{},run:args=>{commands.push(args);return args[0]==='push'&&++pushes===1?1:0;}});
 assert.equal(pushes,2);assert.equal(commands.filter(args=>args[0]==='pull').length,2);assert.ok(!commands.flat().some(arg=>arg.includes('force')));
 await assert.rejects(publishRefresh({branch:'main',wait:async()=>{},run:args=>args[0]==='pull'?1:0}),/conflict review/);
});
test('a scheduled NBA slate with no eligible model rows still publishes verified current context',async()=>{
 const {validateNbaPublication}=await import('../scripts/nba/validate_nba_publication.mjs');
 const player={gameId:'1',playerId:'p',player:'Test',teamAbbr:'BOS',opponentAbbr:'ATL'};
 const receipt=validateNbaPublication({slate:{date:'2026-11-06',games:[{gameId:'1'}]},pool:{players:[player],playerCount:1,errors:[],teams:[{},{}]},availability:{players:[{...player,team:'BOS',availabilityStatus:'UNKNOWN'}]},minutes:{players:[{...player,publicationEligible:false,expectedMinutes:0}]},boards:{'nba_points.json':{players:[]}}});
 assert.equal(receipt.projectionStatus,'context_only_no_verified_players');assert.equal(receipt.publicationEligibleCount,0);assert.equal(receipt.status,'passed');
});
