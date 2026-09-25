import fs from 'node:fs/promises';
import { attachCfbOdds } from '../../scripts/odds/cfb.mjs';
import { normalize } from '../../scripts/cfb/core.mjs';
import { fetchScoreboardRange } from '../../scripts/cfb/espn-scoreboard.mjs';
export async function fetchLive(fetcher=fetch,now=Date.now()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const start=new Date(`${today}T12:00Z`);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
  // ESPN rejects multi-day date ranges intermittently. The refresh pipeline
  // already uses reliable one-day requests; the live endpoint must do the same.
  let failedDays=0;
  const dayCount=Math.floor((end-start)/86400000)+1;
  const events=await fetchScoreboardRange(start,end,{fetchImpl:fetcher,retries:2,timeoutMs:8000,onWarning:()=>{failedDays++;}});
  if(failedDays===dayCount)throw new Error('Live scoreboard unavailable');
  let odds={events:[],quotes:[]};
  try {odds=JSON.parse(await fs.readFile(new URL('../data/odds_ncaaf.json',import.meta.url),'utf8'));}catch{}
  const games=events.map(normalize).filter(Boolean).map(g=>attachCfbOdds(g,odds,now));
  return {schemaVersion:1,retrievedAt:new Date(now).toISOString(),weekStart:start.toISOString().slice(0,10),weekEnd:end.toISOString().slice(0,10),
    source:'ESPN scores · RapidAPI odds',quoteTimestampAvailable:true,games};
}
export function createLiveHandler(fetcher=fetch,clock=Date.now) {
let cached=null,pending=null;
return async function handler(request,response) {
  response.setHeader('Content-Type','application/json; charset=utf-8');
  response.setHeader('Cache-Control','no-store');
  if(request.method!=='GET') {response.setHeader('Allow','GET');return response.status(405).json({error:'Method not allowed'});}
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
