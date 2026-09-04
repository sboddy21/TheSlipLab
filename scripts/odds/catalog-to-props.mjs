export function catalogPropEvents(catalog){
 const events=new Map();
 for(const q of catalog.quotes||[]){if(q.provider!=='PropLine'||!q.player)continue;
  if(!events.has(q.providerEventId))events.set(q.providerEventId,{id:q.providerEventId,commence_time:q.kickoff,home_team:q.home,away_team:q.away,live:false,bookmakers:[]});
  const e=events.get(q.providerEventId);let b=e.bookmakers.find(b=>b.key===q.bookKey);if(!b){b={key:q.bookKey,title:q.book,markets:[]};e.bookmakers.push(b);}
  b.markets.push({key:q.market,last_update:q.quotedAt,outcomes:[{name:q.side==='over'?'Over':q.side==='under'?'Under':q.side==='yes'?'Yes':'No',point:q.line,description:q.player,price:q.price}]});
 }
 // Group complementary sides at identical line and timestamp so no-vig pairs remain valid.
 for(const e of events.values())for(const b of e.bookmakers){const groups=new Map();for(const m of b.markets){const o=m.outcomes[0],key=[m.key,m.last_update,o.description,o.point].join('|');if(!groups.has(key))groups.set(key,{...m,outcomes:[]});groups.get(key).outcomes.push(o);}b.markets=[...groups.values()];}
 return [...events.values()];
}
