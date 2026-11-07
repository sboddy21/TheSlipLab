import {matchEvent,fresh,decimal} from './core.mjs';
export function preserveLastCfbOdds(game,previous){
 if(game.market||game.state!=='pre'||!previous?.market)return game;
 const compatible=String(game.id)===String(previous.id)&&game.home?.id===previous.home?.id&&game.away?.id===previous.away?.id&&game.neutral===previous.neutral;
 if(!compatible)return game;
 return {...game,market:previous.market,sportsbookQuotes:previous.sportsbookQuotes||[],oddsRetrievedAt:previous.oddsRetrievedAt||null};
}
// ESPN's current pregame prices are observations, never verified quote timestamps.
export function espnCfbQuotes(game, event, observedAt, now) {
 if (!fresh(observedAt,now)) return [];
 return (event.competitions?.[0]?.odds || []).flatMap(odds => {
  const book=odds.provider?.name;
  if (!book) return [];
  const line=(row,prefix='')=>{
   const raw=String(row?.line??'').trim();
   const numeric=prefix&&raw[0]?.toLowerCase()===prefix?raw.slice(1):raw;
   return /^[+-]?\d+(?:\.\d+)?$/.test(numeric)?Number(numeric):null;
  };
  return [['spread',odds.pointSpread,'home','away'],['total',odds.total,'over','under'],['moneyline',odds.moneyline,'home','away']].flatMap(([market,rows,a,b])=>{
   const left=rows?.[a]?.close,right=rows?.[b]?.close;
   if (!decimal(left?.odds)||!decimal(right?.odds)) return [];
   const aLine=line(left,market==='total'?'o':''),bLine=line(right,market==='total'?'u':'');
   if (market==='spread'&&(aLine===null||bLine===null||aLine!==-bLine)) return [];
   if (market==='total'&&!(aLine>0&&aLine===bLine)) return [];
   return [[a,left,aLine],[b,right,bLine]].map(([side,row,priceLine])=>({
    provider:'ESPN scoreboard',providerEventId:game.id,quoteId:`espn|${game.id}|${book}|${market}|${side}`,
    market,side,line:market==='moneyline'?null:priceLine,price:Number(row.odds),decimalOdds:decimal(row.odds),
    book,bookKey:book,quotedAt:observedAt,timestampKind:'market-observation',kickoff:game.date
   }));
  });
 });
}
export function attachCfbOdds(game,feed,now=Date.now(),observations=[]){
 if(game.state!=='pre'||game.canceled||!game.timeValid||!(Date.parse(game.date)>now)||(game.statusName&&game.statusName!=='STATUS_SCHEDULED')){
  return {...game,market:null,sportsbookQuotes:[],oddsRetrievedAt:null};
 }
 const e=matchEvent({homeNames:[game.home.name,game.home.location,game.home.short],awayNames:[game.away.name,game.away.location,game.away.short],kickoff:game.date},feed?.events||[]);
 const quotes=e?(feed.quotes||[]).filter(q=>!q.player&&q.providerEventId===e.id&&fresh(q.quotedAt,now)):[];
 const market={provider:'Sportsbook API',source:'RapidAPI',homeSpread:null,total:null,homeML:null,awayML:null,homePrice:null,awayPrice:null,overPrice:null,underPrice:null,quoteDetails:{},qualifiedQuoteDetails:{}};
 for(const kind of ['spread','total','moneyline']){
  const aSide=kind==='total'?'over':'home',bSide=kind==='total'?'under':'away';
  const pairs=quotes.filter(q=>q.market===kind&&q.side===aSide).flatMap(a=>{const b=quotes.find(b=>b.market===kind&&b.side===bSide&&b.bookKey===a.bookKey&&(kind==='moneyline'||(kind==='spread'?Math.abs(a.line+b.line)<.001:a.line===b.line)));return b?[{a,b}]:[];});
  // Deterministic reference book. Best prices at this exact line are shown separately.
  pairs.sort((x,y)=>((x.a.bookKey==='DRAFT_KINGS'?0:1)-(y.a.bookKey==='DRAFT_KINGS'?0:1))||x.a.bookKey.localeCompare(y.a.bookKey));
  if(!pairs.length)quotes.push(...observations.filter(q=>q.market===kind));
  const pair=pairs[0]||(()=>{
   const a=quotes.find(q=>q.market===kind&&q.side===aSide&&q.provider==='ESPN scoreboard');
   const b=a&&quotes.find(q=>q.market===kind&&q.side===bSide&&q.provider===a.provider&&q.bookKey===a.bookKey);
   return b?{a,b}:null;
  })();
  if(!pair)continue;
  const best=q=>quotes.filter(x=>x.market===q.market&&x.side===q.side&&x.line===q.line&&x.provider===q.provider).sort((a,b)=>b.decimalOdds-a.decimalOdds)[0]||q;
  const a=best(pair.a),b=best(pair.b);
  if(kind==='spread'){market.homeSpread=a.line;market.homePrice=a.price;market.awayPrice=b.price;}
  if(kind==='total'){market.total=a.line;market.overPrice=a.price;market.underPrice=b.price;}
  if(kind==='moneyline'){market.homeML=a.price;market.awayML=b.price;}
  market.quoteDetails[kind]={[aSide]:a,[bSide]:b};
  const verified=q=>quotes.filter(x=>x.market===q.market&&x.side===q.side&&x.line===q.line&&x.provider===q.provider&&x.timestampKind==='quote').sort((a,b)=>b.decimalOdds-a.decimalOdds)[0]||null;
  market.qualifiedQuoteDetails[kind]={[aSide]:verified(a),[bSide]:verified(b)};
 }
 const sources=new Set(Object.values(market.quoteDetails).flatMap(pair=>Object.values(pair).map(q=>q.provider)));
 if(sources.has('ESPN scoreboard')){
  market.source=sources.size>1?'RapidAPI + ESPN scoreboard':'ESPN scoreboard';
  market.provider=sources.size>1?'Sportsbook API and ESPN scoreboard':'ESPN scoreboard';
 }
 return {...game,market:Object.keys(market.quoteDetails).length?market:null,sportsbookQuotes:quotes,oddsRetrievedAt:feed?.retrievedAt||null};
}
