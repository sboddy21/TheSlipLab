import fs from 'node:fs/promises';
import { normalize } from './core.mjs';
import { closingMarket } from './historical-odds.mjs';
// Refuse to fetch the new evaluation cohort until the calibration has been frozen.
await fs.access(new URL('./daily-model.json',import.meta.url));
const today=new Date().toISOString().slice(0,10).replaceAll('-','');
async function get(url) {const r=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error(`HTTP ${r.status}: ${url}`);return r.json();}
const source=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=20260201-${today}&groups=80&limit=1000`;
const data=await get(source);
if(!Array.isArray(data.events)||data.events.length>=1000)throw new Error('Missing or truncated current-season events');
const games=data.events.filter(e=>e.status?.type?.completed).map(e=>({...normalize(e),season:e.season?.year})).filter(g=>g.season===2026);
let cursor=0;
await Promise.all(Array.from({length:4},async()=>{while(cursor<games.length){const g=games[cursor++];g.oddsSource=`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${g.id}/competitions/${g.id}/odds`;g.market=closingMarket(await get(g.oddsSource),g);}}));
await fs.writeFile(new URL('../../data/cfb/current-season.json',import.meta.url),JSON.stringify({retrievedAt:new Date().toISOString(),source,games})+'\n');
console.log(`2026 new evaluation cohort: ${games.length} final games; ${games.filter(g=>g.market).length} archived markets.`);
