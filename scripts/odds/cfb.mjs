import {matchEvent,fresh} from './core.mjs';
export function attachCfbOdds(game,feed,now=Date.now()){
 if(game.state!=='pre')return game;
 const e=matchEvent({homeNames:[game.home.name,game.home.location,game.home.short],awayNames:[game.away.name,game.away.location,game.away.short],kickoff:game.date},feed?.events||[]);
 const quotes=e?(feed.quotes||[]).filter(q=>!q.player&&q.providerEventId===e.id&&fresh(q.quotedAt,now)):[];
 const market={provider:'Sportsbook API',source:'RapidAPI',homeSpread:null,total:null,homeML:null,awayML:null,homePrice:null,awayPrice:null,overPrice:null,underPrice:null,quoteDetails:{},qualifiedQuoteDetails:{}};
 for(const kind of ['spread','total','moneyline']){
  const aSide=kind==='total'?'over':'home',bSide=kind==='total'?'under':'away';
  const pairs=quotes.filter(q=>q.market===kind&&q.side===aSide).flatMap(a=>{const b=quotes.find(b=>b.market===kind&&b.side===bSide&&b.bookKey===a.bookKey&&(kind==='moneyline'||(kind==='spread'?Math.abs(a.line+b.line)<.001:a.line===b.line)));return b?[{a,b}]:[];});
  // Deterministic reference book. Best prices at this exact line are shown separately.
  pairs.sort((x,y)=>((x.a.bookKey==='DRAFT_KINGS'?0:1)-(y.a.bookKey==='DRAFT_KINGS'?0:1))||x.a.bookKey.localeCompare(y.a.bookKey));
  const pair=pairs[0];if(!pair)continue;
  const best=q=>quotes.filter(x=>x.market===q.market&&x.side===q.side&&x.line===q.line).sort((a,b)=>b.decimalOdds-a.decimalOdds)[0]||q;
  const a=best(pair.a),b=best(pair.b);
  if(kind==='spread'){market.homeSpread=a.line;market.homePrice=a.price;market.awayPrice=b.price;}
  if(kind==='total'){market.total=a.line;market.overPrice=a.price;market.underPrice=b.price;}
  if(kind==='moneyline'){market.homeML=a.price;market.awayML=b.price;}
  market.quoteDetails[kind]={[aSide]:a,[bSide]:b};
  const verified=q=>quotes.filter(x=>x.market===q.market&&x.side===q.side&&x.line===q.line&&x.timestampKind==='quote').sort((a,b)=>b.decimalOdds-a.decimalOdds)[0]||null;
  market.qualifiedQuoteDetails[kind]={[aSide]:verified(a),[bSide]:verified(b)};
 }
 return {...game,market:Object.keys(market.quoteDetails).length?market:null,sportsbookQuotes:quotes,oddsRetrievedAt:feed?.retrievedAt||null};
}
