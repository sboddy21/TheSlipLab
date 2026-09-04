export const MAX_ODDS_AGE_MS=180000;
export const MAX_MODEL_AGE_MS=36*3600000;
export function isFresh(stamp,now=Date.now(),maxAge=MAX_ODDS_AGE_MS) {
  const age=now-Date.parse(stamp);
  return Number.isFinite(age)&&age>=-60000&&age<=maxAge;
}
export function candidates(game,projection,now=Date.now()) {
  if(!projection||!game.market||game.canceled||game.state!=='pre'||!game.timeValid||!Number.isFinite(Date.parse(game.date))||Date.parse(game.date)<=now)return [];
  const m=game.market,picks=[];
  if(Number.isFinite(m.homeSpread)) {
    const edge=projection.margin+m.homeSpread,side=edge>0?'home':'away',price=side==='home'?m.homePrice:m.awayPrice;
    if(Math.abs(edge)>=4&&Number.isFinite(price)&&Math.abs(price)>=100)picks.push({market:'spread',side,line:side==='home'?m.homeSpread:-m.homeSpread,price,edge:Math.abs(edge)});
  }
  if(Number.isFinite(m.total)&&m.total>0) {
    const edge=projection.total-m.total,side=edge>0?'over':'under',price=side==='over'?m.overPrice:m.underPrice;
    if(Math.abs(edge)>=6&&Number.isFinite(price)&&Math.abs(price)>=100)picks.push({market:'total',side,line:m.total,price,edge:Math.abs(edge)});
  }
  return picks;
}
export function mergeLiveGame(live,snapshot,asOf,now=Date.now()) {
  const compatible=snapshot&&snapshot.home.id===live.home.id&&snapshot.away.id===live.away.id&&snapshot.neutral===live.neutral;
  const projection=compatible&&isFresh(snapshot.projection?.trainingCutoff,now,MAX_MODEL_AGE_MS)?snapshot.projection:null;
  return {...live,projection,oddsRetrievedAt:asOf,leans:projection&&isFresh(asOf,now)?candidates(live,projection,now):[]};
}
