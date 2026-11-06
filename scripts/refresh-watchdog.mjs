import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {isSportInSeason} from '../website/lib/sport-seasons.mjs';

export const targets = [
 ['nba','nba-refresh.yml','nba_points.json',45],
 ['nfl','nfl-refresh.yml','nfl_td_decision_center.json',45],
 ['nhl','nhl-refresh.yml','nhl_board.json',45],
 ['cfb','cfb-refresh.yml','cfb_board.json',30],
 ['mlb','mlb-refresh.yml','mlb_games_today.json',30],
 ['wnba','wnba-refresh.yml','wnba_projection_board.json',30],
 ['odds','sports-odds-refresh.yml','odds_nba.json',15]
];
export function needsRecovery(payload, run, {now=Date.now(),maxAgeMinutes=45}={}) {
 if(run && ['queued','in_progress','waiting','requested','pending'].includes(run.status))return false;
 const lastAttempt=Date.parse(run?.created_at||'');
 // A provider outage must not create an unbounded workflow-dispatch loop.
 if(Number.isFinite(lastAttempt)&&now-lastAttempt<20*60000)return false;
 const timestamp=Date.parse(payload?.dataAsOf||payload?.sourceFetchedAt||payload?.fetchedAt||payload?.retrievedAt||payload?.generatedAt||payload?.updatedAt||'');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return !Number.isFinite(timestamp)||timestamp>now+1000||now-timestamp>=maxAgeMinutes*60000||(payload.date&&payload.date!==today)||payload.stale===true||['unavailable','failed'].includes(payload.status);
}
async function main() {
 const repository=process.env.GITHUB_REPOSITORY,branch=process.env.GITHUB_REF_NAME||'main';
 if(repository!=='sboddy21/TheSlipLab')throw Error('Unexpected watchdog repository');
 for(const [sport,workflow,file,maxAgeMinutes] of targets) {
  if(sport!=='odds'&&!isSportInSeason(sport))continue;
  let payload=null;
  try{payload=JSON.parse(await fs.readFile(`website/data/${file}`,'utf8'));}catch{}
  const result=JSON.parse(execFileSync('gh',['api',`repos/${repository}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&per_page=1`],{encoding:'utf8'}));
  if(!needsRecovery(payload,result.workflow_runs?.[0],{maxAgeMinutes}))continue;
  execFileSync('gh',['workflow','run',workflow,'--repo',repository,'--ref',branch],{stdio:'inherit'});
  console.log(`Requested current ${sport} refresh`);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
