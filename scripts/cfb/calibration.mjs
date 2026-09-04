import { logistic,signal,estimate,implied,valuePicks } from '../../website/assets/cfb-edge.mjs';
import { grade } from './core.mjs';
import { summarizePicks } from './evaluation.mjs';

export function fitCalibration(rows,kind) {
  const samples=rows.filter(r=>Number.isFinite(kind==='spread'?r.market?.homeSpread:r.market?.total)).map(r=>{
    const line=kind==='spread'?-r.market.homeSpread:r.market.total,actual=kind==='spread'?r.actualMargin:r.actualTotal,pred=kind==='spread'?r.predictedMargin:r.predictedTotal;
    return {x:signal(pred-line),delta:actual-line};
  }).filter(r=>r.delta!==0);
  if(samples.length<200)return null;
  let a=0,b=0;
  for(let iteration=0;iteration<100;iteration++) {
    let ga=-2*a,gb=-2*b,haa=2,hab=0,hbb=2;
    for(const {x,delta} of samples){const p=logistic(a+b*x),w=p*(1-p),error=(delta>0?1:0)-p;ga+=error;gb+=error*x;haa+=w;hab+=w*x;hbb+=w*x*x;}
    const det=haa*hbb-hab*hab,da=(ga*hbb-gb*hab)/det,db=(gb*haa-ga*hab)/det;
    a+=da;b+=db;if(Math.max(Math.abs(da),Math.abs(db))<1e-8)break;
  }
  return {intercept:a,slope:b,samples:samples.length,trainingSeason:2024};
}
export function roiInterval(picks) {
  const groups=new Map();
  for(const p of picks){if(!['win','loss','push'].includes(p.result))continue;const group=groups.get(p.fold)||[];group.push(p.units);groups.set(p.fold,group);}
  const weeks=[...groups.values()];if(weeks.length<2)return null;
  let seed=5042026;const rnd=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;},samples=[];
  for(let b=0;b<3000;b++){let sum=0,count=0;for(let i=0;i<weeks.length;i++)for(const u of weeks[Math.floor(rnd()*weeks.length)]){sum+=u;count++;}samples.push(sum/count);}
  samples.sort((a,b)=>a-b);return [samples[75],samples[2924]];
}
export function qualification(picks,rules) {
  const settled=picks.filter(p=>['win','loss','push'].includes(p.result)).sort((a,b)=>a.date.localeCompare(b.date));
  const summary=summarizePicks(settled),weeks=new Set(settled.map(p=>p.fold)).size,interval=roiInterval(settled);
  const middle=Math.floor(settled.length/2),first=summarizePicks(settled.slice(0,middle)),second=summarizePicks(settled.slice(middle));
  const reasons=[];
  if(summary.bets<rules.minimumFreshBetsPerMarket)reasons.push(`Needs ${rules.minimumFreshBetsPerMarket} settled forward picks (${summary.bets} available)`);
  if(weeks<rules.minimumFreshWeeks)reasons.push(`Needs ${rules.minimumFreshWeeks} forward weeks (${weeks} available)`);
  if(!interval||interval[0]<=0)reasons.push('The 95% weekly-bootstrap ROI lower bound is not above zero');
  if(!(first.roi>0&&second.roi>0))reasons.push('Positive returns are not demonstrated in both halves');
  return {qualified:reasons.length===0,reasons,weeks,summary,roi95:interval,firstHalfROI:first.roi,secondHalfROI:second.roi};
}
export function evaluateCalibrated(rows,calibration) {
  const all=[];const scores={};
  for(const kind of ['spread','total']) {
    const samples=[];
    for(const r of rows) {
      const projection={margin:r.predictedMargin,total:r.predictedTotal},p=estimate(projection,r.market,calibration,kind);
      if(p===null)continue;
      const delta=kind==='spread'?r.actualMargin+r.market.homeSpread:r.actualTotal-r.market.total;
      if(delta===0)continue;
      const y=delta>0?1:0,pa=implied(kind==='spread'?r.market.homePrice:r.market.overPrice),pb=implied(kind==='spread'?r.market.awayPrice:r.market.underPrice);
      samples.push({p,y,book:pa!==null&&pb!==null?pa/(pa+pb):null});
    }
    const mean=(values)=>values.length?values.reduce((s,x)=>s+x,0)/values.length:null;
    const book=samples.filter(s=>s.book!==null);
    scores[kind]={games:samples.length,brier:mean(samples.map(s=>(s.p-s.y)**2)),logLoss:mean(samples.map(s=>-s.y*Math.log(s.p)-(1-s.y)*Math.log(1-s.p))),
      matchedBookGames:book.length,matchedModelBrier:mean(book.map(s=>(s.p-s.y)**2)),bookBrier:mean(book.map(s=>(s.book-s.y)**2)),
      bins:Array.from({length:5},(_,i)=>{const group=samples.filter(s=>s.p>=i/5&&s.p<(i+1)/5);return {from:i/5,to:(i+1)/5,games:group.length,predicted:mean(group.map(s=>s.p)),observed:mean(group.map(s=>s.y))};})};
  }
  for(const r of rows) {
    const game={date:r.date,state:'pre',timeValid:true,market:r.market,home:{score:r.homeScore},away:{score:r.awayScore},completed:true};
    for(const pick of valuePicks(game,{margin:r.predictedMargin,total:r.predictedTotal},calibration,Date.parse(r.trainingCutoff)-1))
      all.push({...pick,...grade(pick,game),gameId:r.id,date:r.date,fold:r.fold,matchup:r.matchup});
  }
  const strategy={};for(const kind of ['spread','total','combined']){const picks=all.filter(p=>kind==='combined'||p.market===kind);strategy[kind]={...summarizePicks(picks),roi95:roiInterval(picks)};}
  return {probabilityScores:scores,strategy,picks:all};
}
