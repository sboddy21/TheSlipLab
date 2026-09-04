import { fitRatings,predictRatings,trainingGames,weekCutoff } from './ratings.mjs';
import { baselineProject,candidates,grade } from './core.mjs';

export function walkForward(history,season,config) {
  const targets=history.filter(g=>g.season===season && g.completed && !g.canceled && Number.isFinite(g.home.score) && Number.isFinite(g.away.score));
  const folds=new Map();
  for(const g of targets) {const cutoff=(config.cadence === "daily" ? Date.parse(g.date.slice(0,10)+"T00:00:00Z") : weekCutoff(g.date));if(!folds.has(cutoff))folds.set(cutoff,[]);folds.get(cutoff).push(g);}
  const rows=[],skipped=[];
  for(const [cutoff,games] of [...folds].sort((a,b)=>a[0]-b[0])) {
    const fit=fitRatings(history,cutoff,config);
    const training=trainingGames(history,cutoff,config);
    for(const game of games) {
      const p=predictRatings(game,fit);
      if(!p) {skipped.push({id:game.id,reason:'Insufficient history or unconverged fit'});continue;}
      const baseline=baselineProject(game,training,cutoff);
      const margin=game.home.score-game.away.score,total=game.home.score+game.away.score;
      const replay={...game,state:'pre',completed:false};
      const picks=candidates(replay,p,cutoff).map(pick=>({...pick,...grade(pick,game)}));
      const baselinePicks=baseline?candidates(replay,baseline,cutoff).map(pick=>({...pick,...grade(pick,game)})):[];
      rows.push({id:game.id,season,date:game.date,matchup:`${game.away.short} @ ${game.home.short}`,fold:new Date(weekCutoff(game.date)).toISOString(),
        latestTrainingGame:fit.latestTrainingGame,trainingGames:fit.trainingCount,trainingCutoff:p.trainingCutoff,
        homeScore:game.home.score,awayScore:game.away.score,actualMargin:margin,actualTotal:total,
        predictedHome:p.homeScore,predictedAway:p.awayScore,predictedMargin:p.margin,predictedTotal:p.total,
        baselineMargin:baseline?.margin??null,baselineTotal:baseline?.total??null,
        market:game.market,oddsSource:game.oddsSource||null,picks,baselinePicks});
    }
  }
  return {season,eligibleGames:targets.length,rows,skipped};
}
function errors(rows,pred,actual) {
  const selected=rows.filter(r=>Number.isFinite(r[pred]) && Number.isFinite(r[actual]));
  if(!selected.length)return {games:0,mae:null,rmse:null,bias:null};
  const diff=selected.map(r=>r[pred]-r[actual]);
  return {games:selected.length,mae:diff.reduce((s,x)=>s+Math.abs(x),0)/diff.length,
    rmse:Math.sqrt(diff.reduce((s,x)=>s+x*x,0)/diff.length),bias:diff.reduce((s,x)=>s+x,0)/diff.length};
}
function winner(rows,pred) {
  const selected=rows.filter(r=>Number.isFinite(r[pred])&&r.actualMargin!==0);
  const correct=selected.filter(r=>Math.sign(r[pred])===Math.sign(r.actualMargin)).length;
  return {games:selected.length,correct,accuracy:selected.length?correct/selected.length:null};
}
function wilson(wins,n) {
  if(!n)return null;
  const z=1.96,p=wins/n,denom=1+z*z/n,center=(p+z*z/(2*n))/denom;
  const radius=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/denom;
  return [center-radius,center+radius];
}
export function summarizePicks(picks) {
  const count=result=>picks.filter(p=>p.result===result).length;
  const wins=count('win'),losses=count('loss'),pushes=count('push'),risked=wins+losses+pushes;
  const units=picks.reduce((s,p)=>s+(p.units??0),0);
  return {bets:risked,wins,losses,pushes,winRate:wins+losses?wins/(wins+losses):null,
    winRate95:wilson(wins,wins+losses),units,roi:risked?units/risked:null};
}
// Resample whole weeks, preserving within-week dependence for paired MAE comparisons.
export function pairedInterval(rows,pred,comparison,actual) {
  const groups=new Map();
  for(const r of rows) {
    if(!Number.isFinite(r[pred])||!Number.isFinite(r[comparison]))continue;
    const values=groups.get(r.fold)||[];
    values.push(Math.abs(r[pred]-r[actual])-Math.abs(r[comparison]-r[actual]));groups.set(r.fold,values);
  }
  const weeks=[...groups.values()];
  if(weeks.length<2)return null;
  let seed=20250904;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  const samples=[];
  for(let b=0;b<2000;b++) {
    let sum=0,n=0;
    for(let j=0;j<weeks.length;j++){const week=weeks[Math.floor(random()*weeks.length)];for(const d of week){sum+=d;n++;}}
    samples.push(sum/n);
  }
  samples.sort((a,b)=>a-b);
  const values=weeks.flat();
  return {games:values.length,weeks:weeks.length,meanDifference:values.reduce((s,x)=>s+x,0)/values.length,
    interval95:[samples[50],samples[1949]],definition:'Adjusted model MAE minus comparator MAE; negative favors adjusted model. 2,000 whole-week bootstrap samples.'};
}
export function summarize(evaluation) {
  const {rows,eligibleGames,skipped}=evaluation;
  const spreads=rows.filter(r=>Number.isFinite(r.market?.homeSpread)).map(r=>({...r,bookMargin:-r.market.homeSpread}));
  const totals=rows.filter(r=>Number.isFinite(r.market?.total)).map(r=>({...r,bookTotal:r.market.total}));
  const matched=rows.filter(r=>r.baselineMargin!==null);
  function marketAccuracy(sample,kind) {
    const actual=kind==='spread'?'actualMargin':'actualTotal',book=kind==='spread'?'bookMargin':'bookTotal',pred=kind==='spread'?'predictedMargin':'predictedTotal';
    let wins=0,losses=0,pushes=0,passes=0;
    for(const r of sample) {const edge=r[pred]-r[book];if(edge===0){passes++;continue;}const delta=(r[actual]-r[book])*Math.sign(edge);if(delta===0)pushes++;else if(delta>0)wins++;else losses++;}
    return {games:sample.length,wins,losses,pushes,passes,winRate:wins+losses?wins/(wins+losses):null,winRate95:wilson(wins,wins+losses)};
  }
  return {eligibleGames,predictedGames:rows.length,skippedGames:skipped.length,
    margin:errors(rows,'predictedMargin','actualMargin'),total:errors(rows,'predictedTotal','actualTotal'),winner:winner(rows,'predictedMargin'),
    baselineComparison:{games:matched.length,modelMargin:errors(matched,'predictedMargin','actualMargin'),baselineMargin:errors(matched,'baselineMargin','actualMargin'),
      modelTotal:errors(matched,'predictedTotal','actualTotal'),baselineTotal:errors(matched,'baselineTotal','actualTotal'),marginDifference:pairedInterval(matched,'predictedMargin','baselineMargin','actualMargin')},
    sportsbook:{spreadGames:spreads.length,totalGames:totals.length,modelMargin:errors(spreads,'predictedMargin','actualMargin'),bookMargin:errors(spreads,'bookMargin','actualMargin'),
      modelTotal:errors(totals,'predictedTotal','actualTotal'),bookTotal:errors(totals,'bookTotal','actualTotal'),modelWinner:winner(spreads,'predictedMargin'),bookWinner:winner(spreads,'bookMargin'),
      marginDifference:pairedInterval(spreads,'predictedMargin','bookMargin','actualMargin'),totalDifference:pairedInterval(totals,'predictedTotal','bookTotal','actualTotal'),
      againstSpread:marketAccuracy(spreads,'spread'),againstTotal:marketAccuracy(totals,'total')},
    strategy:{spread:summarizePicks(rows.flatMap(r=>r.picks.filter(p=>p.market==='spread'))),total:summarizePicks(rows.flatMap(r=>r.picks.filter(p=>p.market==='total'))),
      combined:summarizePicks(rows.flatMap(r=>r.picks)),baseline:summarizePicks(matched.flatMap(r=>r.baselinePicks)),modelOnBaselineGames:summarizePicks(matched.flatMap(r=>r.picks))}};
}
