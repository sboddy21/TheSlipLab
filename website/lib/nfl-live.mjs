import { currentSeasonStart } from './current-season.mjs';
import { easternDate } from '../../scripts/nhl/core.mjs';
let cached;
export async function loadNflWorkspace({fetcher=fetch,now=Date.now()}={}) {
 const date=easternDate(new Date(now)),season=currentSeasonStart('nfl',now);
 if(cached&&cached.date===date&&now>=cached.at&&now-cached.at<60000)return cached.promise;
 const entry={date,at:now,promise:(async()=>{
  const response=await fetcher('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Current NFL scoreboard unavailable');
  const data=await response.json();
  if(!data.leagues?.some(league=>league.slug==='nfl')||!Array.isArray(data.events))throw Error('Invalid NFL scoreboard');
  const sourceSeason=Number(data.leagues[0].season?.year);
  const events=sourceSeason===season?data.events:[];
  const games=events.map(event=>{
   const competition=event.competitions?.[0],status=competition?.status||event.status||{};
   const team=side=>{const row=competition?.competitors?.find(item=>item.homeAway===side);if(!row?.team?.id||!row.team.abbreviation)throw Error('Incomplete NFL identity');return{teamId:String(row.team.id),abbreviation:({WAS:'WSH',JAC:'JAX',LA:'LAR'})[row.team.abbreviation]||row.team.abbreviation,displayName:row.team.displayName,logo:row.team.logo,score:row.score??null};};
   if(!event.id||!Number.isFinite(Date.parse(event.date)))throw Error('Invalid NFL game');
   return{gameId:String(event.id),season,seasonType:Number(event.season?.type||data.season?.type||2),week:Number(event.week?.number||data.week?.number||1),kickoffUTC:event.date,homeTeam:team('home'),awayTeam:team('away'),state:status.type?.state||'pre',completed:Boolean(status.type?.completed),status:status.type?.detail||'Scheduled',venue:competition?.venue?.fullName||'Venue pending',broadcasts:(competition?.broadcasts||[]).flatMap(row=>row.names||[])};
  });
  return{sport:'NFL',date,season,sourceSeason,seasonType:games[0]?.seasonType||Number(data.season?.type||2),week:Number(data.week?.number||games[0]?.week||1),generatedAt:new Date(now).toISOString(),status:sourceSeason===season?'current_scoreboard':'current_season_schedule_pending',source:'ESPN current NFL scoreboard',games};
 })()};cached=entry;
 try{return await entry.promise;}catch(error){if(cached===entry)cached=null;throw error;}
}
