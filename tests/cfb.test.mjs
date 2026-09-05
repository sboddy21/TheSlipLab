import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, baselineProject as project, candidates, grade, number } from '../scripts/cfb/core.mjs';
import { fitRatings,predictRatings,weekCutoff,trainingGames } from '../scripts/cfb/ratings.mjs';
import { closingMarket } from '../scripts/cfb/historical-odds.mjs';
import { walkForward,summarizePicks } from '../scripts/cfb/evaluation.mjs';
import { isFresh,mergeLiveGame } from '../website/assets/cfb-market.mjs';
import { valuePicks,implied,moneylineProjection,americanFromProbability } from '../website/assets/cfb-edge.mjs';
import { qualification,fitCalibration } from '../scripts/cfb/calibration.mjs';
import { createLiveHandler } from '../website/api/cfb-live.mjs';
const now = Date.parse('2026-09-04T12:00Z');
const game = { id:'next',date:'2026-09-05T16:00Z',state:'pre',timeValid:true,home:{id:'h',score:null},away:{id:'a',score:null},
  market:{homeSpread:-3,total:50,homePrice:-110,awayPrice:-105,overPrice:-110,underPrice:-110} };
test('missing market values remain absent; side-specific spreads win over ambiguous legacy data',()=>{
  assert.equal(number(''),null); assert.equal(number(null),null); assert.equal(number('0'),0);
  const result = normalize({id:'1',competitions:[{competitors:[{homeAway:'home',team:{id:'h'}},{homeAway:'away',team:{id:'a'}}],odds:[{spread:7,pointSpread:{home:{close:{line:'+7'}},away:{close:{line:'-7'}}}}]}]});
  assert.equal(result.market.homeSpread,7); assert.equal(result.market.total,null); assert.equal(result.market.homeML,null);
});
test('projection excludes future games, incomplete games and own result; requires four games per team',()=>{
  const history = Array.from({length:4},(_,i)=>({id:String(i),date:`2026-08-${10+i}T16:00Z`,completed:true,home:{id:'h',score:30},away:{id:'a',score:20}}));
  const expected = project(game,history,now);
  assert.ok(expected); assert.equal(expected.home.games,4);
  assert.equal(project(game,history.slice(1),now),null);
  const contaminants = [ {...history[0],id:'future',date:'2026-09-07T16:00Z'}, {...history[0],id:'live',completed:false}, {...history[0],id:game.id} ];
  assert.deepEqual(project(game,[...history,...contaminants],now),expected);
  const neutral = project({...game,neutral:true},history,now);
  assert.equal(Number((expected.margin-neutral.margin).toFixed(2)),2.5);
});
test('spread direction, total threshold, and price gates',()=>{
  const picks = candidates(game,{margin:10,total:60},now);
  assert.deepEqual(picks.map(p=>[p.market,p.side,p.line,p.edge]),[['spread','home',-3,7],['total','over',50,10]]);
  assert.equal(candidates(game,{margin:-3,total:50},now)[0].side,'away');
  assert.equal(candidates({...game,market:{...game.market,homePrice:null,overPrice:null}},{margin:10,total:60},now).length,0);
  assert.equal(candidates(game,{margin:3,total:50},now).length,0);
});
test('no recommendations for started, canceled, invalid-time or unpriced games',()=>{
  for (const patch of [{state:'in'},{date:'2026-09-04T12:00Z'},{date:'invalid'},{timeValid:false},{canceled:true},{market:null}]) {
    assert.deepEqual(candidates({...game,...patch},{margin:10,total:60},now),[]);
  }
});
test('settlement respects final gate, spread pushes and actual American prices',()=>{
  const final = {...game,completed:true,home:{score:30},away:{score:27}};
  assert.deepEqual(grade({market:'spread',side:'home',line:-3,price:-110},final),{result:'push',units:0});
  assert.equal(grade({market:'spread',side:'away',line:4,price:120},final).units,1.2);
  assert.equal(grade({market:'total',side:'under',line:56.5,price:-110},final).units,-1);
  assert.equal(grade({market:'total',side:'over',line:56.5,price:-110},final).units,100/110);
  assert.equal(grade({}, {...final,completed:false}).result,'pending');
  assert.equal(grade({}, {...final,canceled:true}).result,'void');
});

function schedule() {
  const rows=[];
  for(let i=0;i<6;i++) for(const [h,a,hs,as] of [['A','weak',30,20],['B','strong',30,20],['strong','weak',40,10]]) {
    rows.push({id:`${h}-${a}-${i}`,season:2024,date:`2024-10-${String(1+i).padStart(2,'0')}T12:00Z`,completed:true,neutral:true,
      home:{id:h,score:hs,short:h},away:{id:a,score:as,short:a}});
  }
  return rows;
}
test('opponent adjustment distinguishes identical raw scores against different schedules',()=>{
  const fit=fitRatings(schedule(),Date.parse('2024-10-14T00:00Z'));
  assert.equal(fit.converged,true);
  assert.ok(fit.teams.B.rating>fit.teams.A.rating);
  const prediction=predictRatings({date:'2024-10-19T12:00Z',neutral:true,home:{id:'A'},away:{id:'B'}},fit);
  assert.ok(prediction.awayScore>prediction.homeScore);
});
test('weekly training excludes same-week outcomes and prior-day games, regardless of final status',()=>{
  const cutoff=weekCutoff('2024-10-19T12:00Z');
  assert.equal(new Date(cutoff).toISOString(),'2024-10-14T00:00:00.000Z');
  const training=schedule();
  const future=[...training.map(g=>({...g,id:`future-${g.id}`,date:'2024-10-19T12:00Z',home:{...g.home,score:99}})),
    {...training[0],id:'sunday',date:'2024-10-13T00:00Z'}];
  assert.deepEqual(fitRatings([...training,...future],cutoff),fitRatings(training,cutoff));
  assert.equal(trainingGames([...training,...future],cutoff).length,training.length);
});
test('held-out target score and market changes do not alter its prediction',()=>{
  const target={id:'target',season:2025,date:'2025-08-30T16:00Z',completed:true,neutral:true,timeValid:true,
    home:{id:'A',short:'A',score:21},away:{id:'B',short:'B',score:35},market:game.market};
  const original=walkForward([...schedule(),target],2025,{}).rows[0];
  const changed=walkForward([...schedule(),{...target,home:{...target.home,score:100},market:{...game.market,homeSpread:-100}}],2025,{}).rows[0];
  assert.ok(original);
  assert.equal(original.predictedMargin,changed.predictedMargin);
  assert.equal(original.predictedTotal,changed.predictedTotal);
  assert.notEqual(original.actualMargin,changed.actualMargin);
});
test('closing odds reject live providers, missing close fields, mismatched teams, and inconsistent sides',()=>{
  const book={provider:{id:'58',name:'ESPN BET'},homeTeamOdds:{close:{pointSpread:{american:'-3'},spread:{american:'-105'}}},
    awayTeamOdds:{close:{pointSpread:{american:'+3'},spread:{american:'-115'}}},close:{total:{american:'50.5'}}};
  assert.equal(closingMarket({items:[book]},game).homeSpread,-3);
  assert.equal(closingMarket({items:[{...book,provider:{id:'59',name:'Live Odds'}}]},game),null);
  assert.equal(closingMarket({items:[{provider:book.provider,current:book.close}]},game),null);
  assert.equal(closingMarket({items:[{...book,homeTeamOdds:{...book.homeTeamOdds,team:{$ref:'https://example.com/teams/999'}}}]},game),null);
  const bad={...book,awayTeamOdds:{close:{pointSpread:{american:'-3'}}}};
  assert.equal(closingMarket({items:[bad]},game).homeSpread,null);
  assert.equal(closingMarket({items:[book]},game).overPrice,null);
});
test('simulation ROI uses one unit risked per priced pick including pushes',()=>{
  const s=summarizePicks([{result:'win',units:100/110},{result:'loss',units:-1},{result:'push',units:0}]);
  assert.equal(s.bets,3);assert.equal(s.winRate,0.5);assert.equal(s.roi,(100/110-1)/3);
});

test('freshness rejects expired/future timestamps, old ratings and changed neutral venues',()=>{
  assert.equal(isFresh(new Date(now-181000).toISOString(),now),false);
  assert.equal(isFresh(new Date(now+120000).toISOString(),now),false);
  const live={...game,neutral:false};
  const snapshot={...live,projection:{margin:10,total:60,trainingCutoff:new Date(now-3600000).toISOString()}};
  assert.ok(mergeLiveGame(live,snapshot,new Date(now).toISOString(),now).projection);
  assert.equal(mergeLiveGame({...live,neutral:true},snapshot,new Date(now).toISOString(),now).projection,null);
  assert.equal(mergeLiveGame(live,{...snapshot,projection:{...snapshot.projection,trainingCutoff:new Date(now-37*3600000).toISOString()}},new Date(now).toISOString(),now).projection,null);
  assert.equal(mergeLiveGame(live,snapshot,new Date(now-181000).toISOString(),now).leans.length,0);
});
test('price-aware picks require positive estimated return, valid price and scheduled status',()=>{
  const calibration={spread:{intercept:0,slope:1},total:{intercept:0,slope:1}};
  assert.equal(implied(-110),110/210);
  const picks=valuePicks(game,{margin:10,total:50},calibration,now);
  assert.equal(picks.length,1);assert.equal(picks[0].side,'home');assert.ok(picks[0].expectedReturn>=0.05);
  assert.equal(valuePicks({...game,statusName:'STATUS_POSTPONED'},{margin:10,total:50},calibration,now).length,0);
  assert.equal(valuePicks({...game,market:{...game.market,homePrice:null}},{margin:10,total:50},calibration,now).length,0);
});
test('moneyline projection derives calibrated win probability and internally consistent fair prices',()=>{
  const read=moneylineProjection({margin:10},{spread:{intercept:0,slope:1}});
  assert.ok(read.homeProbability>.5);
  assert.equal(Number((read.homeProbability+read.awayProbability).toFixed(10)),1);
  assert.equal(read.homeFairPrice,americanFromProbability(read.homeProbability));
  assert.equal(implied(read.homeFairPrice).toFixed(2),read.homeProbability.toFixed(2));
  assert.equal(moneylineProjection(null,{spread:{intercept:0,slope:1}}),null);
});
test('qualification cannot turn a tiny winning sample or a losing strategy into a proven edge',()=>{
  const rules={minimumFreshBetsPerMarket:200,minimumFreshWeeks:8};
  const tiny=[{date:'2026-09-05',fold:'week1',result:'win',units:1}];
  assert.equal(qualification(tiny,rules).qualified,false);
  const losing=Array.from({length:240},(_,i)=>({date:`2026-${String(i).padStart(3,'0')}`,fold:`week${i%10}`,result:'loss',units:-1}));
  assert.equal(qualification(losing,rules).qualified,false);
  assert.equal(qualification(losing.map(p=>({...p,result:'win',units:1})),rules).qualified,true);
});
test('daily walk-forward fit is before its target and calibration needs adequate data',()=>{
  const target={id:'daily-target',season:2025,date:'2025-08-30T16:00Z',completed:true,neutral:true,timeValid:true,
    home:{id:'A',short:'A',score:21},away:{id:'B',short:'B',score:35},market:game.market};
  const row=walkForward([...schedule(),target],2025,{cadence:'daily'}).rows[0];
  assert.equal(row.trainingCutoff,'2025-08-30T00:00:00.000Z');
  assert.ok(Date.parse(row.latestTrainingGame)<Date.parse(row.trainingCutoff)-86400000);
  assert.equal(fitCalibration([row],'spread'),null);
});
test('live endpoint fails closed after source failure rather than retimestamping its old cache',async()=>{
  let time=now,fail=false;
  const handler=createLiveHandler(async()=>{if(fail)throw new Error('upstream failed');return {ok:true,json:async()=>({events:[]})};},()=>time);
  const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.code=c;return this;},json(v){this.body=v;return this;}});
  const first=response();await handler({method:'GET'},first);assert.equal(first.code,200);
  fail=true;time+=31000;
  const second=response();await handler({method:'GET'},second);assert.equal(second.code,503);assert.equal(second.body.lastSuccess,new Date(now).toISOString());
  const mutation=response();await handler({method:'POST'},mutation);assert.equal(mutation.code,405);
});
