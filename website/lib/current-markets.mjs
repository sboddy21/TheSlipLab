const current = (time, now) => Number.isFinite(Date.parse(time)) && Date.parse(time)<=now+1000 && now-Date.parse(time)<1200000;
export function prepareCurrentMarkets(file, payload, now=Date.now()) {
  if(!payload || Array.isArray(payload) || typeof payload!=='object')return payload;
  if(/^odds_/.test(file) && Array.isArray(payload.quotes)) {
    const quotes=payload.quotes.filter(row=>current(row.quotedAt,now));
    return {...payload,quotes,expiredQuotesRemoved:payload.quotes.length-quotes.length};
  }
  if(/market_lines\.json$/.test(file) && Array.isArray(payload.lines)) {
    return {...payload,lines:payload.lines.filter(row=>current(row.quotedAt||row.fetchedAt,now))};
  }
  if(file==='cfb_board.json' && Array.isArray(payload.games)) {
    return {...payload,games:payload.games.map(game=>{
      const sportsbookQuotes=(game.sportsbookQuotes||[]).filter(row=>current(row.quotedAt,now));
      const details=Object.values(game.market?.quoteDetails||{}).flatMap(value=>Object.values(value||{}));
      const marketCurrent=details.length && details.every(quote=>quote && current(quote.quotedAt,now));
      return {...game,sportsbookQuotes,...(game.market&&!marketCurrent?{market:null,leans:[]}: {})};
    })};
  }
  return payload;
}
