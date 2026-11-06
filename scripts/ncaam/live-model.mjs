import fs from 'node:fs/promises';
import { forecast, update, enterSeason, hash } from './model.mjs';
import { normalizeGame, easternDate } from './core.mjs';
const config=JSON.parse(await fs.readFile(new URL('./model-config.json',import.meta.url),'utf8'));
const dir=new URL('../../website/data/',import.meta.url),historyFile=new URL('../../data/ncaam/current-history.json',import.meta.url);
export async function modelForSlate(games, date, fetchScoreboard, now=Date.now()) {
 const [report,artifact]=await Promise.all(['ncaam_validation.json','ncaam_model.json'].map(async name=>JSON.parse(await fs.readFile(new URL(name,dir),'utf8'))));
 if(!report.passed||report.configHash!==hash(config)||artifact.configHash!==report.configHash||artifact.datasetHash!==report.datasetHash||hash(artifact.state)!==report.modelStateHash)throw new Error('Model validation or artifact integrity check failed');
 if(Date.parse(date+'T00:00:00Z')<=Date.parse(report.config.holdoutWindow[1]+'T23:59:59Z'))throw new Error('Live forecasts must follow the held-out evaluation window');
 let cached={days:[],games:[]};try{cached=JSON.parse(await fs.readFile(historyFile,'utf8'));}catch{}
 const state=structuredClone(artifact.state),season=games[0]?.season || Number(date.slice(0,4))+(Number(date.slice(5,7))>=7?1:0);
 const seasonStart=`${season-1}-11-01`,days=[];
 for(let day=Date.parse(seasonStart+'T12:00:00Z');day<Date.parse(date+'T12:00:00Z');day+=86400000){const key=new Date(day).toISOString().slice(0,10);if(!cached.days.includes(key)||Date.parse(key+'T12:00:00Z')>Date.parse(date+'T12:00:00Z')-3*86400000)days.push(key);}
 const gathered=[];let cursor=0;
 await Promise.all(Array.from({length:4},async()=>{while(cursor<days.length){const day=days[cursor++];const rows=(await fetchScoreboard(day)).map(normalizeGame).filter(Boolean);gathered.push(...rows);}}));
 const history=[...new Map([...cached.games,...gathered,...games].filter(g=>g.season===season).map(g=>[g.id,g])).values()].filter(g=>g.completed&&Date.parse(g.kickoff)<now).sort((a,b)=>a.kickoff.localeCompare(b.kickoff)||a.id.localeCompare(b.id));
 // Rebuild from the fixed historical artifact each time; never double-count completed games.
 enterSeason(state,season,config);for(const game of history)update(game,state,config);
 await fs.mkdir(new URL('../../data/ncaam/',import.meta.url),{recursive:true});
 await fs.writeFile(historyFile,JSON.stringify({season,days:[...new Set([...cached.days,...days])],games:history})+'\n');
 return {report,model:{version:config.version,status:'validated_winner_forecasts',validatedThrough:report.config.holdoutWindow[1],scope:report.scope,validation:{picks:report.picks,accuracy:report.accuracy,brier:report.brier,baselineBrier:report.baselineBrier,calibrationError:report.calibrationError}},forecasts:new Map(games.map(g=>[g.id,forecast(g,state,config)]))};
}
export function archivePicks(previous, games, now=Date.now()) {
 const rows=new Map((previous?.picks||[]).map(p=>[p.gameId,p]));
 for(const game of games){
  let pick=rows.get(game.id);
  if(!pick&&game.state==='pre'&&Date.parse(game.kickoff)>now&&game.prediction?.eligible){const p=game.prediction;pick={gameId:game.id,kickoff:game.kickoff,home:game.home.name,away:game.away.name,side:p.side,selection:game[p.side].name,probability:p.probability,modelVersion:p.modelVersion,publishedAt:new Date(now).toISOString(),result:'pending'};}
  if(pick){if(game.completed&&Number.isFinite(game.home.score)&&Number.isFinite(game.away.score)){const margin=game.home.score-game.away.score;pick={...pick,homeScore:game.home.score,awayScore:game.away.score,result:margin===0?'push':(pick.side==='home'?margin>0:margin<0)?'win':'loss'};}rows.set(game.id,pick);}
 }
 return {schemaVersion:1,sport:'NCAAM',generatedAt:new Date(now).toISOString(),description:'Forward published straight-up winner forecasts. First pregame publication is frozen; historical validation results are separate.',picks:[...rows.values()].sort((a,b)=>b.kickoff.localeCompare(a.kickoff))};
}
