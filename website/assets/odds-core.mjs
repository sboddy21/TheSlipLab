export const MAX_AGE_MS = 20 * 60_000;
export const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const fresh = (stamp, now = Date.now()) => Number.isFinite(Date.parse(stamp)) && now-Date.parse(stamp)>=-60_000 && now-Date.parse(stamp)<=MAX_AGE_MS;
export const decimal = p => p != null && p !== '' && Number.isFinite(Number(p)) && Math.abs(Number(p))>=100 ? (Number(p)>0?1+Number(p)/100:1+100/-Number(p)):null;
export const american = d => Number.isFinite(d)&&d>1 ? Math.round(d>=2?(d-1)*100:-100/(d-1)):null;
export const BOOKS = {DRAFT_KINGS:'DraftKings',FAN_DUEL:'FanDuel',BET_MGM:'BetMGM',BET_RIVERS:'BetRivers',FANATICS:'Fanatics',CAESARS:'Caesars',BET_PARX:'betPARX',ESPN_BET:'ESPN BET',HARD_ROCK:'Hard Rock',CIRCA:'Circa',PINNACLE:'Pinnacle',BOVADA:'Bovada'};
export function rapidQuotes(event, markets, now=Date.now(), observationOnly=false) {
 const out=[];
 if(event.type!=='MATCH'||Date.parse(event.startTime)<=now||!Number.isFinite(Date.parse(event.startTime))||event.participants?.length!==2)return out;
 const home=event.participants.find(p=>p.key===event.homeParticipantKey),away=event.participants.find(p=>p.key!==event.homeParticipantKey);if(!home||!away)return out;
 const expected=new Map((event.markets||[]).map(m=>[m.key,m]));
 for(const m of markets){
  const original=expected.get(m.key);
  if(!original||m.type!==original.type||m.segment!=='FULL_MATCH'||m.participantKey||!['MONEYLINE','POINT_SPREAD','POINT_TOTAL'].includes(m.type))continue;
  for(const [source, outcomes]of Object.entries(m.outcomes||{})){
   if(!BOOKS[source])continue;
   for(const q of outcomes){
    const stamp=observationOnly?m.lastFoundAt:q.time;
    if(q.source!==source||q.marketKey!==m.key||q.live!==false||!fresh(stamp,now)||!Number.isFinite(q.payout)||q.payout<=1)continue;
    const market={MONEYLINE:'moneyline',POINT_SPREAD:'spread',POINT_TOTAL:'total'}[m.type];
    const side=market==='total'?({OVER:'over',UNDER:'under'}[q.type]):q.type==='WIN'?(q.participantKey===home.key?'home':q.participantKey===away.key?'away':null):null;
    if(!side||(market==='total'&&q.participantKey))continue;
    if(market!=='moneyline'&&(!Number.isFinite(q.modifier)||(market==='total'&&q.modifier<=0)))continue;
    out.push({provider:'RapidAPI Sportsbook',providerEventId:event.key,quoteId:`${event.key}|${m.key}|${source}|${side}|${q.modifier}`,market,side,line:market==='moneyline'?null:q.modifier,decimalOdds:q.payout,price:american(q.payout),book:BOOKS[source],bookKey:source,quotedAt:stamp,timestampKind:observationOnly?'market-observation':'quote',kickoff:event.startTime,home:home.name,away:away.name});
   }
  }
 }
 return out;
}
// Main markets only; keep the market with widest traditional sportsbook coverage for each type.
export function mainMarkets(event){
 const groups=new Map();for(const m of event.markets||[]){if(m.segment!=='FULL_MATCH'||m.participantKey||!['MONEYLINE','POINT_SPREAD','POINT_TOTAL'].includes(m.type))continue;const count=Object.keys(m.outcomes||{}).filter(k=>BOOKS[k]).length;if(count>0&&(!groups.has(m.type)||count>groups.get(m.type).count))groups.set(m.type,{market:m,count});}return [...groups.values()].map(x=>x.market);
}
export function bestComparable(quotes){
 const best=new Map();for(const q of quotes){const key=[q.providerEventId,q.playerId||q.player||'',q.market,q.side,q.line].join('|');if(!best.has(key)||q.decimalOdds>best.get(key).decimalOdds)best.set(key,q);}return [...best.values()];
}
// Exact normalized names/known aliases and kickoff; never substring or fuzzy team matching.
export function matchEvent(game,events){
 const home=new Set((game.homeNames||[game.home]).filter(Boolean).map(norm)),away=new Set((game.awayNames||[game.away]).filter(Boolean).map(norm));
 const found=events.filter(e=>Math.abs(Date.parse(e.kickoff)-Date.parse(game.kickoff))<=5*60_000&&[e.home,e.homeShort].some(n=>n&&home.has(norm(n)))&&[e.away,e.awayShort].some(n=>n&&away.has(norm(n))));
 return found.length===1?found[0]:null;
}
