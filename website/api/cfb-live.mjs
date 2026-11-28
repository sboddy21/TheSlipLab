import fs from 'node:fs/promises';
import { attachCfbOdds } from '../../scripts/odds/cfb.mjs';
import { normalize } from '../../scripts/cfb/core.mjs';
import { fetchScoreboard } from '../../scripts/cfb/scoreboard.mjs';
export async function fetchLive(fetcher=fetch,now=Date.now()) {
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
  const start=new Date(`${today}T12:00Z`);start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);
  const end=new Date(start);end.setUTCDate(end.getUTCDate()+6);
  const events=await fetchScoreboard(start,end,fetcher);
  let odds={events:[],quotes:[]};
  try {odds=JSON.parse(await fs.readFile(new URL('../data/odds_ncaaf.json',import.meta.url),'utf8'));}catch{}
  const normalized=events.map(normalize);
  if(normalized.some(game=>!game))throw new Error('Incomplete college football feed: a scheduled game could not be loaded');
  const games=normalized.map(g=>attachCfbOdds(g,odds,now));
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
