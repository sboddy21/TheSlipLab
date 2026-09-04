import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { normalize } from './core.mjs';
import { closingMarket } from './historical-odds.mjs';
const root = fileURLToPath(new URL('../../',import.meta.url));
const cache = `${root}logs/cfb-history-cache`;
await fs.mkdir(cache,{recursive:true}); await fs.mkdir(`${root}data/cfb`,{recursive:true});
async function get(url,name) {
  try { return JSON.parse(await fs.readFile(`${cache}/${name}.json`,'utf8')); } catch(e) {if(e.code!=='ENOENT')throw e;}
  let last;
  for(let attempt=0;attempt<3;attempt++) {
    try {
      const response = await fetch(url,{signal:AbortSignal.timeout(25000)});
      if(response.status===404) {const value={missing:true};await fs.writeFile(`${cache}/${name}.json`,JSON.stringify(value));return value;}
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const value=await response.json();
      await fs.writeFile(`${cache}/${name}.json`,JSON.stringify(value));return value;
    } catch(e) {last=e;}
  }
  throw new Error(`${url}: ${last.message}`);
}
const games=[];
for(let start=new Date('2023-08-01T00:00Z');start<new Date('2026-02-01T00:00Z');) {
  const end=new Date(Math.min(start.getTime()+59*86400000,Date.parse('2026-01-31T00:00Z')));
  const compact=d=>d.toISOString().slice(0,10).replaceAll('-','');
  const key=`${compact(start)}-${compact(end)}`;
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${key}&groups=80&limit=1000`;
  const data=await get(url,`scores-${key}`);
  if(!Array.isArray(data.events)||data.events.length>=1000)throw new Error(`Invalid or truncated scoreboard ${key}`);
  games.push(...data.events.map(e=>({...normalize(e),season:e.season?.year})).filter(g=>g.id));
  start=new Date(end.getTime()+86400000);
}
const unique=[...new Map(games.map(g=>[g.id,g])).values()].sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
const targets=unique.filter(g=>g.completed && (g.season===2024 || g.season===2025));
console.log(`${unique.length} historical games; retrieving closing odds for ${targets.length} evaluation games.`);
let cursor=0,done=0;
await Promise.all(Array.from({length:6},async()=>{
  while(cursor<targets.length) {
    const game=targets[cursor++];
    const url=`https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/events/${game.id}/competitions/${game.id}/odds`;
    const data=await get(url,`odds-${game.id}`);
    game.market=closingMarket(data,game);game.oddsSource=url;
    if(++done%200===0)console.log(`Closing odds: ${done}/${targets.length}`);
  }
}));
const artifact={schemaVersion:1,retrievedAt:new Date().toISOString(),source:'ESPN scoreboard and core archived closing odds',
  oddsPolicy:'DraftKings (100), then ESPN BET (58); explicit close fields only. No live/current/open fallbacks. Closing quotes have no independently verified pregame timestamp.',
  games:unique};
await fs.writeFile(`${root}data/cfb/history.json.tmp`,JSON.stringify(artifact)+'\n');
await fs.rename(`${root}data/cfb/history.json.tmp`,`${root}data/cfb/history.json`);
console.log(`Saved history; ${targets.filter(g=>g.market).length}/${targets.length} with archived closing markets.`);
