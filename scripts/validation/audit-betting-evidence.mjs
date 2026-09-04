import fs from 'node:fs';
import path from 'node:path';
const data=path.resolve('website/data');
const read=n=>JSON.parse(fs.readFileSync(path.join(data,n+'.json'),'utf8'));
const logistic=x=>1/(1+Math.exp(-x));
const logit=p=>Math.log(p/(1-p));
const clamp=p=>Math.max(.0001,Math.min(.9999,p));
const round=n=>Number(n.toFixed(6));
function metrics(rows,predict){
  if(!rows.length)return null;
  let brier=0,loss=0,expected=0,hits=0;
  for(const r of rows){const p=clamp(predict(r));brier+=(p-r.y)**2;loss-=r.y*Math.log(p)+(1-r.y)*Math.log(1-p);expected+=p;hits+=r.y;}
  return {samples:rows.length,hits,hitRate:round(hits/rows.length),meanProbability:round(expected/rows.length),brier:round(brier/rows.length),logLoss:round(loss/rows.length)};
}
// Two-parameter logistic recalibration, fit on the earlier dates only.
function fit(rows){
  let a=0,b=1;
  for(let i=0;i<4000;i++){
    let da=0,db=0;
    for(const r of rows){const x=logit(clamp(r.p)),e=logistic(a+b*x)-r.y;da+=e;db+=e*x;}
    a-=.08*da/rows.length;b-=.08*db/rows.length;
  }
  return {intercept:a,slope:b};
}
const history=read('hr_ai_history'),results=read('hr_results_history');
const days=new Map(results.days.filter(d=>d.status==='final').map(d=>[d.date,d]));
const exclusions={unverified:0,invalidTiming:0,invalidProbability:0,unsettled:0,duplicate:0};
const unique=new Map();
for(const r of Object.values(history.history).flat()){
  if(!r.verifiedPregame){exclusions.unverified++;continue;}
  const t=Date.parse(r.snapshotAt||r.timestamp),start=Date.parse(r.gameStartTime);
  if(!Number.isFinite(t)||!Number.isFinite(start)||t>=start||!r.gamePk||!r.playerId){exclusions.invalidTiming++;continue;}
  if(r.probability==null||r.probability===''||!Number.isFinite(Number(r.probability))||r.probability<0||r.probability>100){exclusions.invalidProbability++;continue;}
  const d=days.get(r.slateDate);if(!d){exclusions.unsettled++;continue;}
  const key=`${r.gamePk}:${r.playerId}`;
  if(unique.has(key)){exclusions.duplicate++;if(Date.parse(unique.get(key).snapshotAt)>=t)continue;}
  unique.set(key,{...r,p:Number(r.probability)/100,y:Number(d.homeRuns.some(h=>String(h.gamePk)===String(r.gamePk)&&String(h.playerId)===String(r.playerId)))});
}
const rows=[...unique.values()].sort((a,b)=>a.slateDate.localeCompare(b.slateDate));
const dates=[...new Set(rows.map(r=>r.slateDate))];
const split=dates[Math.floor(dates.length*.7)];
const train=rows.filter(r=>r.slateDate<split),test=rows.filter(r=>r.slateDate>=split);
const params=train.length?fit(train):null;
const predict=r=>logistic(params.intercept+params.slope*logit(clamp(r.p)));
const byDate=Object.fromEntries([...new Set(test.map(r=>r.slateDate))].map(date=>{
 const subset=test.filter(r=>r.slateDate===date);return [date,{raw:metrics(subset,r=>r.p),candidate:metrics(subset,predict)}];
}));
const wnba=read('wnba_calibration'),players=read('wnba_player_baselines'),lines=read('wnba_market_lines');
const cfb=read('cfb_daily_evaluation');
const out={generatedAt:new Date().toISOString(),status:'no_sport_has_demonstrated_a_reliable_betting_edge',
 mlb:{sourceUpdatedAt:history.updatedAt,exclusions,settledReceipts:rows.length,receiptsWithRecordedPrices:rows.filter(r=>r.marketQuotes?.length).length,
  raw:metrics(rows,r=>r.p),highProbability:metrics(rows.filter(r=>r.p>=.2),r=>r.p),
  chronologicalDiagnostic:{splitDate:split,trainDates:[dates[0],dates[dates.indexOf(split)-1]],testDates:[split,dates.at(-1)],trainingSamples:train.length,
   parameters:params,raw:metrics(test,r=>r.p),candidate:params?metrics(test,predict):null,byDate,
   status:'research_only_not_promoted',limitations:['This archive was previously inspected in aggregate; the split is chronological but not a pristine unseen holdout.','No archived sportsbook prices: betting ROI cannot be established.','A non-HR receipt is a prediction outcome, not proof the wager would settle; participation and book void rules need separate settlement.','Rows sharing a game are correlated. Prediction counts are not independent betting samples.']},
  marketFix:'Only explicit over 0.5 HR prices can be compared with the one-or-more-HR model. Alternate thresholds rejected.'},
 wnba:{gradedProjections:wnba.gradedProjections,markets:wnba.markets,baselinesAsOf:players.dataAsOf||players.generatedAt,stale:Boolean(players.stale),authorizedLineSources:lines.authorizedSources,
  blockers:['No validated probability model or priced out-of-sample betting strategy.','MAE is projection accuracy, not betting ROI.',...(lines.authorizedSources.length?[]:['No authorized player prop feed configured.']),...(players.stale?['Upstream baseline refresh failed; fallback is stale.']:[])]},
 ncaaf:{reportGeneratedAt:cfb.generatedAt,conclusion:cfb.conclusion,prospective:cfb.prospective},
 policy:'Do not label research estimates high-confidence bets. Promotion requires a prespecified strategy, immutable pregame prices and probabilities, actual settlement, independent future evaluation, and uncertainty accounting for correlated bets.'};
fs.mkdirSync('docs',{recursive:true});fs.writeFileSync('docs/betting-evidence-audit.json',JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({mlb:out.mlb.chronologicalDiagnostic,wnba:out.wnba,ncaaf:out.ncaaf},null,2));
