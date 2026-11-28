import {fresh} from './odds-core.mjs';
export const logistic=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export const signal=x=>Math.max(-5,Math.min(5,x/10));
export const payout=price=>Number.isFinite(price)&&Math.abs(price)>=100?(price>0?price/100:100/-price):null;
export const implied=price=>{const profit=payout(price);return profit===null?null:1/(1+profit);};
export const americanFromProbability=probability=>{
  if(!Number.isFinite(probability)||probability<=0||probability>=1)return null;
  return Math.round(probability>=0.5?-100*probability/(1-probability):100*(1-probability)/probability);
};
export function estimate(projection,market,calibration,kind) {
  const c=calibration?.[kind],line=kind==='spread'?market?.homeSpread:market?.total;
  if(!c||!Number.isFinite(line))return null;
  const edge=kind==='spread'?projection.margin+line:projection.total-line;
  return logistic(c.intercept+c.slope*signal(edge));
}
export function moneylineProjection(projection,calibration) {
  if(!projection)return null;
  const c=calibration?.spread;
  if(!c||!Number.isFinite(c.intercept)||!Number.isFinite(c.slope))return null;
  const homeProbability=logistic(c.intercept+c.slope*signal(projection.margin));
  return {homeProbability,awayProbability:1-homeProbability,homeFairPrice:americanFromProbability(homeProbability),awayFairPrice:americanFromProbability(1-homeProbability)};
}
export function valuePicks(game,projection,calibration,now=Date.now(),minimumReturn=0.05) {
  if(!projection||!game.market||game.canceled||game.state!=='pre'||(game.statusName&&game.statusName!=='STATUS_SCHEDULED')||!game.timeValid||!Number.isFinite(Date.parse(game.date))||Date.parse(game.date)<=now)return [];
  const out=[];
  for(const market of ['spread','total']) {
    const probability=estimate(projection,game.market,calibration,market);
    if(probability===null)continue;
    const sides=market==='spread'?['home','away']:['over','under'];
    const choices=sides.map((side,i)=>{
      const quote=game.market.qualifiedQuoteDetails?.[market]?.[side] || game.market.quoteDetails?.[market]?.[side];
      const price=quote?.price ?? game.market[`${side}Price`],profit=quote ? (quote.timestampKind==='quote'&&fresh(quote.quotedAt,now)?quote.decimalOdds-1:null) : payout(price),p=i===0?probability:1-probability;
      return {market,side,price,...(quote?{decimalOdds:quote.decimalOdds,book:quote.book,quoteId:quote.quoteId,quotedAt:quote.quotedAt}:{}),probability:p,breakEven:implied(price),expectedReturn:profit===null?-Infinity:p*profit-(1-p),
        line:market==='spread'?(side==='home'?game.market.homeSpread:-game.market.homeSpread):game.market.total,
        edge:market==='spread'?Math.abs(projection.margin+game.market.homeSpread):Math.abs(projection.total-game.market.total)};
    }).sort((a,b)=>b.expectedReturn-a.expectedReturn);
    if(choices[0].expectedReturn>=minimumReturn)out.push(choices[0]);
  }
  return out;
}
