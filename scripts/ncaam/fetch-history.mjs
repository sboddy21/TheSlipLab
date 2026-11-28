import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fetchScoreboard } from './refresh.mjs';
import { normalizeGame } from './core.mjs';
const config=JSON.parse(await fs.readFile(new URL('./model-config.json',import.meta.url),'utf8'));
const root=new URL('../../data/ncaam/',import.meta.url);
await fs.mkdir(new URL('scoreboards/',root),{recursive:true});
const days=[];
for(const [start,end] of [config.trainingWindow,config.holdoutWindow]) for(let value=Date.parse(start+'T12:00:00Z');value<=Date.parse(end+'T12:00:00Z');value+=86400000)days.push(new Date(value).toISOString().slice(0,10));
let cursor=0, done=0;const all=[],failures=[];
await Promise.all(Array.from({length:6},async()=>{
 while(cursor<days.length){
  const day=days[cursor++],path=new URL(`scoreboards/${day}.json`,root);let rows;
  try{rows=JSON.parse(await fs.readFile(path,'utf8'));}catch{}
  if(!Array.isArray(rows))for(let attempt=0;attempt<3;attempt++){try{const events=await fetchScoreboard(day);rows=events.map(normalizeGame).filter(Boolean);await fs.writeFile(path,JSON.stringify(rows)+'\n');break;}catch(error){if(attempt===2)failures.push({day,message:error.message});}}
  if(rows)all.push(...rows);done++;if(done%40===0)console.log(`Historical dates ${done}/${days.length}`);
 }
}));
if(failures.length)throw new Error(JSON.stringify({failures}));
const games=[...new Map(all.map(g=>[g.id,g])).values()].filter(g=>g.completed&&Number.isFinite(g.home.score)&&Number.isFinite(g.away.score)&&g.home.score!==g.away.score).sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.id.localeCompare(b.id));
const serialized=JSON.stringify(games);
await fs.writeFile(new URL('history.json',root),serialized+'\n');
console.log(JSON.stringify({dates:days.length,games:games.length,sha256:createHash('sha256').update(serialized).digest('hex')}));
