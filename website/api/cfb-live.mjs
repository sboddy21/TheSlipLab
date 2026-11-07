import { createPublishedDataReader } from '../lib/published-data.mjs';
import { attachCfbOdds, espnCfbQuotes } from '../../scripts/odds/cfb.mjs';
import { normalize } from '../../scripts/cfb/core.mjs';
import { fetchScoreboardRange } from '../../scripts/cfb/espn-scoreboard.mjs';
export async function fetchLive(fetcher=fetch,now=Date.now(),readOdds=()=>createPublishedDataReader()('odds_ncaaf.json')) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const start=new Date(`${today}T12:00Z`);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
  const observations=new Map();
  const [events,odds]=await Promise.all([
    fetchScoreboardRange(start,end,{fetchImpl:fetcher,retries:2,timeoutMs:4000,strict:true,onEvents(rows,headers){
      const date=Date.parse(headers?.get('date'));
      const age=Number(headers?.get('age'));
      const observedAt=new Date(Math.min(now,Number.isFinite(date)?date:now,age>0?now-age*1000:now)).toISOString();
      for(const row of rows)observations.set(String(row.id),observedAt);
    }}),
    Promise.resolve().then(readOdds).catch(()=>null)
  ]);
  const games=events.map(event=>{
    const game=normalize(event);
    if(!game)throw new Error('Incomplete scoreboard: invalid game');
    return attachCfbOdds(game,odds,now,espnCfbQuotes(game,event,observations.get(game.id),now));
  });
  return {schemaVersion:1,retrievedAt:new Date(now).toISOString(),weekStart:start.toISOString().slice(0,10),weekEnd:end.toISOString().slice(0,10),
    source:'ESPN scores · RapidAPI and ESPN sportsbook prices',quoteTimestampAvailable:games.some(game=>game.sportsbookQuotes.some(quote=>quote.timestampKind==='quote')),games};
}
async function publishedModel(){
  const board=await createPublishedDataReader()('cfb_board.json');
  if(board?.schemaVersion!==1||!Array.isArray(board.games)||!Number.isFinite(Date.parse(board.generatedAt)))throw Error('Invalid published model');
  const {schemaVersion,generatedAt,weekStart,weekEnd,calibration,games}=board;
  return {schemaVersion,generatedAt,weekStart,weekEnd,calibration,games:games.map(game=>({...game,sportsbookQuotes:undefined,market:null,leans:[]}))};
}
export function createLiveHandler(fetcher=fetch,clock=Date.now) {
let cached=null,pending=null;
return async function handler(request,response) {
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('Cache-Control','no-store');
  if(request.method!=='GET') {response.setHeader('Allow','GET');return response.status(405).json({error:'Method not allowed'});}
  if(request.query?.view==='model'){
    try{
      const model=await publishedModel();
      response.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=30');
      return response.status(200).json(model);
    }catch{return response.status(503).json({error:'Current college football model unavailable'});}
  }
  try {
    if(!cached||clock()-Date.parse(cached.retrievedAt)>30000) {
      pending??=fetchLive(fetcher,clock()).then(value=>{cached=value;return value;}).finally(()=>{pending=null;});
      await pending;
    }
    response.setHeader('Vercel-CDN-Cache-Control','public, s-maxage=30');
    return response.status(200).json(cached);
  } catch {
    // Never relabel an old cache as a fresh response after an upstream failure.
    return response.status(503).json({error:'Live college football data unavailable',lastSuccess:cached?.retrievedAt??null});
  }
}

}
export default createLiveHandler();
