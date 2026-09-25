import { moneylineProjection, implied, estimate } from './cfb-edge.mjs';

const finite=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;

export function noVigProbability(homePrice,awayPrice){
  const home=implied(finite(homePrice)),away=implied(finite(awayPrice));
  if(home===null||away===null||!Number.isFinite(home+away)||home+away<=0)return null;
  return {home:home/(home+away),away:away/(home+away)};
}

export function boardRow(game,calibration){
  const p=game.projection,m=game.market,ml=moneylineProjection(p,calibration);
  const marketWin=noVigProbability(m?.homeML,m?.awayML);
  const spreadGap=p&&Number.isFinite(m?.homeSpread)?p.margin+m.homeSpread:null;
  const totalGap=p&&Number.isFinite(m?.total)?p.total-m.total:null;
  const overProbability=p&&m?estimate(p,m,calibration,'total'):null;
  const winGap=ml&&marketWin?(ml.homeProbability-marketWin.home)*100:null;
  const maxGap=Math.max(Math.abs(spreadGap??0),Math.abs(totalGap??0),Math.abs(winGap??0));
  return {game,matchup:`${game.away.short} @ ${game.home.short}`,kickoff:Date.parse(game.date),modelSpread:p?.margin??null,marketSpread:m?.homeSpread??null,spreadGap,modelTotal:p?.total??null,marketTotal:m?.total??null,totalGap,overProbability,modelWin:ml,marketWin,winGap,maxGap};
}

export function boardRows(games,calibration){return games.map(game=>boardRow(game,calibration));}

export function boardHighlights(rows){
  const max=(key)=>rows.filter(row=>Number.isFinite(row[key])).sort((a,b)=>Math.abs(b[key])-Math.abs(a[key]))[0]||null;
  return {spread:max('spreadGap'),total:max('totalGap'),win:max('winGap'),large:rows.filter(row=>row.maxGap>=7).length};
}

export function sortBoard(rows,key,direction='desc'){
  const sign=direction==='asc'?1:-1;
  return [...rows].sort((a,b)=>{
    if(key==='matchup')return sign*a.matchup.localeCompare(b.matchup);
    const av=a[key],bv=b[key];
    if(av===null||av===undefined)return 1;if(bv===null||bv===undefined)return -1;
    return sign*(av-bv);
  });
}
