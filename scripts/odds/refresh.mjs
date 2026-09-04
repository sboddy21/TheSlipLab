import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {request} from '../providers/sportsbook-rapidapi.mjs';
import {proplineRequest,proplineSettings,normalizePropLineBooks} from '../providers/propline.mjs';
import {rapidQuotes,mainMarkets,decimal,fresh} from './core.mjs';
const SPORTS={MLB:'baseball_mlb',WNBA:'basketball_wnba',NBA:'basketball_nba',NFL:'americanfootball_nfl',NCAAF:'americanfootball_ncaaf'};
const MARKETS={MLB:'batter_home_runs,batter_hits,batter_total_bases,batter_rbis,pitcher_strikeouts',WNBA:'player_points,player_rebounds,player_assists,player_threes',NBA:'player_points,player_rebounds,player_assists,player_threes',NFL:'player_pass_yds,player_rush_yds,player_reception_yds,player_anytime_td',NCAAF:'player_pass_yds,player_rush_yds,player_reception_yds,player_anytime_td'};
export async function refreshSport(sport,{rapid=request,props=proplineRequest,now=Date.now(),includeProps=true}={}){
 if(!SPORTS[sport])throw new Error('Unsupported sport');
 const out={schemaVersion:1,sport,retrievedAt:new Date(now).toISOString(),events:[],quotes:[],errors:[],coverage:{},maxQuoteAgeMinutes:20};
 try{
  const query=new URLSearchParams({startTimeFrom:new Date(now).toISOString(),startTimeTo:new Date(now+7*86400000).toISOString()});
  const r=await rapid(`/v1/competitions/${sport}/events?${query}`);
  if(!Array.isArray(r.data.events))throw new Error('Invalid event list');
  out.rapidQuota=r.quota;
  const events=r.data.events.filter(e=>e.type==='MATCH'&&Date.parse(e.startTime)>now&&e.participants?.length===2).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
  for(const e of events){const h=e.participants.find(p=>p.key===e.homeParticipantKey),a=e.participants.find(p=>p.key!==e.homeParticipantKey);if(h&&a)out.events.push({id:e.key,home:h.name,away:a.name,homeShort:h.shortName,awayShort:a.shortName,kickoff:e.startTime});}
  // Bulk observations cover all sports with one request each. Individual quote verification
  // is limited to the nearest NCAAF games: 3 requests/run + 5 sport listings <= 1,000/day.
  for(const e of events)out.quotes.push(...rapidQuotes(e,mainMarkets(e),now,true));
  let verifiedRequests=0;
  if(sport==='NCAAF')for(const e of events)for(const m of mainMarkets(e)){
   if(verifiedRequests>=3||(out.rapidQuota?.remaining!=null&&Number(out.rapidQuota.remaining)<50))continue;
   verifiedRequests++;
   await new Promise(resolve=>setTimeout(resolve,350));
   try{const r=await rapid(`/v1/markets/${encodeURIComponent(m.key)}/outcomes/latest`);out.rapidQuota=r.quota;
    if(r.data.market?.key===m.key){const verified=rapidQuotes(e,[r.data.market],now);const ids=new Set(verified.map(q=>q.quoteId));out.quotes=out.quotes.filter(q=>!ids.has(q.quoteId));out.quotes.push(...verified);}
   }catch(error){out.errors.push({provider:'RapidAPI',message:error.message});if(/401|403|429/.test(error.message)){verifiedRequests=3;break;}}
  }
 }catch(error){out.errors.push({provider:'RapidAPI',message:error.message});}
 if(includeProps && (out.errors.length || out.events.some(e=>Date.parse(e.kickoff)<now+12*3600000))){try{
  let previous;
  try{previous=JSON.parse(await fs.readFile(new URL(`../../website/data/odds_${sport.toLowerCase()}.json`,import.meta.url),'utf8'));}catch{}
  const existing=(previous?.quotes||[]).filter(q=>q.provider==='PropLine'&&fresh(q.quotedAt,now)&&now-Date.parse(q.quotedAt)<5*60_000&&Date.parse(q.kickoff)>now);
  out.quotes.push(...existing);
  if(!proplineSettings().key)throw new Error('PropLine key is not configured');
  const r=await props(`/sports/${SPORTS[sport]}/events`);out.quota=r.quota;if(!Array.isArray(r.data))throw new Error('Invalid prop event list');
  // Only near-term props; a seven-day scan per player would exhaust the free quota.
  for(const e of r.data.filter(e=>Date.parse(e.commence_time)>now&&Date.parse(e.commence_time)<now+12*3600000)){
   if(existing.some(q=>q.providerEventId===String(e.id)))continue;
   if(out.quota?.remaining!=null&&Number(out.quota.remaining)<50){out.errors.push({provider:'PropLine',message:'Daily request reserve reached'});break;}
   let r;try{r=await props(`/sports/${SPORTS[sport]}/events/${encodeURIComponent(e.id)}/odds?markets=${MARKETS[sport]}`);}catch(error){out.errors.push({provider:'PropLine',message:error.message});if(/401|403|429/.test(error.message))break;continue;}out.quota=r.quota;
   if(String(r.data.id)!==String(e.id))continue;
   for(const b of normalizePropLineBooks(r.data))for(const m of b.markets){if(!MARKETS[sport].split(',').includes(m.key)||!fresh(m.last_update,now))continue;
    for(const o of m.outcomes){const d=decimal(o.price);if(!d||!o.description||!['Over','Under','Yes','No'].includes(o.name))continue;
     const binary=['player_anytime_td'].includes(m.key)&&o.point==null&&['Yes','No'].includes(o.name);
     if(!binary&&(o.point==null||o.point===''||!Number.isFinite(Number(o.point))))continue;
     out.quotes.push({provider:'PropLine',providerEventId:String(e.id),quoteId:`${e.id}|${b.key}|${m.key}|${o.description}|${o.point}|${o.name}`,market:m.key,side:o.name.toLowerCase(),line:binary?0.5:Number(o.point),decimalOdds:d,price:Number(o.price),book:b.title||b.key,bookKey:b.key,quotedAt:m.last_update,kickoff:e.commence_time,home:e.home_team,away:e.away_team,player:o.description,providerPlayerId:o.player_id||null,timestampKind:'provider-observation'});
    }
   }
  }
 }catch(error){out.errors.push({provider:'PropLine',message:error.message});}}
 out.coverage={events:out.events.length,gameQuotes:out.quotes.filter(q=>!q.player).length,propQuotes:out.quotes.filter(q=>q.player).length};
 out.status=out.quotes.length?'available':out.errors.length?'unavailable':'no_upcoming_markets';return out;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const sports=process.argv.slice(2).filter(s=>SPORTS[s]);
 for(const sport of sports.length?sports:Object.keys(SPORTS)){
  const data=await refreshSport(sport);const path=new URL(`../../website/data/odds_${sport.toLowerCase()}.json`,import.meta.url);await fs.writeFile(new URL(path.href+'.tmp'),JSON.stringify(data)+'\n');await fs.rename(new URL(path.href+'.tmp'),path);console.log(sport,JSON.stringify({status:data.status,...data.coverage,errors:data.errors.length,quota:data.quota}));
 }
}
