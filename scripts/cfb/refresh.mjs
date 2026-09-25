import { attachCfbOdds,preserveLastCfbOdds } from '../odds/cfb.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { normalize, grade, MODEL } from './core.mjs';
import { fitRatings,predictRatings,dayCutoff } from './ratings.mjs';

import { valuePicks } from '../../website/assets/cfb-edge.mjs';
import { qualification } from './calibration.mjs';
import { weekCutoff } from './ratings.mjs';
import { fetchScoreboardRange } from './espn-scoreboard.mjs';

const output = fileURLToPath(new URL('../../website/data/cfb_board.json', import.meta.url));
const configText=await fs.readFile(new URL('./daily-model.json',import.meta.url),'utf8');
const {config,calibration,protocol,frozenAt}=JSON.parse(configText);
const configSha256=crypto.createHash('sha256').update(configText).digest('hex');
const now = new Date();
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year:'numeric',month:'2-digit',day:'2-digit' }).format(now);
const monday = new Date(`${today}T12:00:00Z`);
monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay()+6)%7);
const end = new Date(monday); end.setUTCDate(end.getUTCDate()+6);
const iso = d => d.toISOString().slice(0,10);
let previous = { archive: [] };
try { previous = JSON.parse(await fs.readFile(output,'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
// Persist the score history; fetch only recent games on frequent refreshes.
const historyPath=new URL('../../data/cfb/live-history.json',import.meta.url);
let cached;
try {cached=JSON.parse(await fs.readFile(historyPath,'utf8'));}
catch(error) {if(error.code!=='ENOENT')throw error;cached=JSON.parse(await fs.readFile(new URL('../../data/cfb/history.json',import.meta.url),'utf8'));}
const horizon=now.getTime()-(config.windowDays+3)*86400000;
const history=cached.games.filter(g=>Date.parse(g.date)>=horizon);
const latest=history.reduce((n,g)=>Math.max(n,Date.parse(g.date)),horizon);
const recentStart=new Date(Math.max(horizon,Math.min(latest,now.getTime())-14*86400000));
const fetchedHistory=await fetchScoreboardRange(recentStart,end,{fallback:history});
history.push(...fetchedHistory.map(event=>event.home&&event.away?event:normalize(event)).filter(Boolean));
let odds={events:[],quotes:[]};
try{odds=JSON.parse(await fs.readFile(new URL('../../website/data/odds_ncaaf.json',import.meta.url),'utf8'));}catch{}
const slateFallback=[...(previous.games||[]),...history];
const slateEvents=await fetchScoreboardRange(monday,end,{fallback:slateFallback});
const previousById=new Map((previous.games||[]).map(game=>[String(game.id),game]));
const slate=slateEvents.map(event=>event.home&&event.away?event:normalize(event)).filter(Boolean).map(g=>preserveLastCfbOdds(attachCfbOdds(g,odds,now.getTime()),previousById.get(String(g.id))));
if(!slate.length)throw new Error('No current-week games available from ESPN or the last-known-good board');
const all = [...new Map([...history,...slate].map(g => [g.id,g])).values()];
const marketPolicy='rapidapi-best-same-line-v1';
const archive = previous.archive || [];
const keys = new Set(archive.map(p => `${p.model}:${p.marketPolicy || 'legacy'}:${p.gameId}:${p.market}`));
const fits=new Map();
const games = slate.map(game => {
  const cutoff=Math.min(dayCutoff(now),dayCutoff(game.date));
  if(!fits.has(cutoff))fits.set(cutoff,fitRatings(all,cutoff,config));
  const projection = predictRatings(game,fits.get(cutoff));
  const leans = valuePicks(game,projection,calibration,now.getTime());
  for (const pick of leans) {
    const key = `${MODEL}:${marketPolicy}:${game.id}:${pick.market}`;
    if (!keys.has(key)) {
      archive.push({ ...pick, marketPolicy, gameId:game.id, matchup:`${game.away.short} @ ${game.home.short}`, team:game[pick.side]?.short || pick.side,
        kickoff:game.date, recordedAt:now.toISOString(), provider:pick.book || game.market.provider, model:MODEL, configSha256, trainingCutoff:projection.trainingCutoff, oddsRetrievedAt:pick.quotedAt || now.toISOString(), result:'pending', units:null });
      keys.add(key);
    }
  }
  return { ...game, projection, leans };
});
for (const pick of archive) {
  if (pick.result !== 'pending') continue;
  Object.assign(pick,grade(pick,all.find(g => g.id === pick.gameId)));
}
const prospective=archive.filter(p=>p.model===MODEL && p.marketPolicy===marketPolicy && p.configSha256===configSha256 && p.trainingCutoff && Date.parse(p.trainingCutoff)<=Date.parse(p.recordedAt) && Date.parse(p.recordedAt)>=Date.parse(frozenAt) && Date.parse(p.recordedAt)<Date.parse(p.kickoff)).map(p=>({...p,date:p.kickoff,fold:new Date(weekCutoff(p.kickoff)).toISOString()}));
const edgeStatus=Object.fromEntries(["spread","total"].map(kind=>[kind,qualification(prospective.filter(p=>p.market===kind),protocol.promotion)]));
const board = { schemaVersion:1, generatedAt:now.toISOString(), weekStart:iso(monday), weekEnd:iso(end),
  source:'ESPN scores · RapidAPI odds', marketPolicy, model:MODEL, configSha256, config, calibration, edgeStatus, ratingsGeneratedAt:now.toISOString(), games, archive };
await fs.writeFile(historyPath,JSON.stringify({updatedAt:now.toISOString(),games:all})+"\n");
await fs.writeFile(`${output}.tmp`,JSON.stringify(board,null,2)+'\n');
await fs.rename(`${output}.tmp`,output);
console.log(`College football: ${games.length} games, ${games.filter(g=>g.market).length} with odds, ${archive.length} tracked leans.`);
