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
 ['ncaam','ncaam-refresh.yml','ncaam_board.json',45],
 ['odds','sports-odds-refresh.yml','odds_nba.json',15]
];
// Watch the boards members actually consume, not just one successful output.
export const recoveryFiles = {
 nba: ['nba_games_today.json','nba_points.json','nba_rebounds.json','nba_assists.json','nba_threes.json','nba_player_cards.json'],
 nfl: ['nfl_schedule.json','nfl_td_decision_center.json','nfl_receiving_yards_board.json'],
 nhl: ['nhl_board.json'], cfb: ['cfb_board.json'],
 mlb: ['mlb_games_today.json','health_status.json'],
 wnba: ['wnba_games_today.json','wnba_projection_board.json','wnba_live_snapshot.json'],
 ncaam: ['ncaam_board.json'],
 odds: ['odds_nba.json','odds_nfl.json','odds_ncaaf.json','odds_mlb.json','odds_wnba.json']
};
export function needsRecovery(payload, run, {now=Date.now(),maxAgeMinutes=45}={}) {
 if(run && ['queued','in_progress','waiting','requested','pending'].includes(run.status))return false;
 const lastAttempt=Date.parse(run?.created_at||'');
 // A provider outage must not create an unbounded workflow-dispatch loop.
 if(Number.isFinite(lastAttempt)&&now>=lastAttempt&&now-lastAttempt<20*60000)return false;
 const evidence=['dataAsOf','sourceFetchedAt','fetchedAt','retrievedAt','generatedAt','updatedAt'].map(key=>Date.parse(payload?.[key]||'')).filter(Number.isFinite);
 const timestamp=evidence.length?Math.min(...evidence):NaN;
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return !Number.isFinite(timestamp)||timestamp>now+1000||now-timestamp>=maxAgeMinutes*60000||(payload.date&&payload.date!==today)||payload.stale===true||['unavailable','failed'].includes(payload.status);
}
export function needsBoardRecovery(sport, payloads, run, options={}) {
 const files=recoveryFiles[sport];
 if(!files)throw Error('Unknown recovery sport');
 return files.some(file=>needsRecovery(payloads[file],run,options));
}
export function recoveryAgeMinutes(sport, inSeasonMinutes, now = new Date()) {
 return sport === 'odds' || isSportInSeason(sport, now) ? inSeasonMinutes : 24 * 60;
}
async function main() {
 const repository=process.env.GITHUB_REPOSITORY,branch=process.env.GITHUB_REF_NAME||'main';
 if(repository!=='sboddy21/TheSlipLab')throw Error('Unexpected watchdog repository');
 for(const [sport,workflow,file,maxAgeMinutes] of targets) {
  const payloads={};
  for(const name of recoveryFiles[sport]) {
   try{payloads[name]=JSON.parse(await fs.readFile(`website/data/${name}`,'utf8'));}catch{payloads[name]=null;}
  }
  const result=JSON.parse(execFileSync('gh',['api',`repos/${repository}/actions/workflows/${workflow}/runs?branch=${encodeURIComponent(branch)}&per_page=1`],{encoding:'utf8'}));
  if(!needsBoardRecovery(sport,payloads,result.workflow_runs?.[0],{maxAgeMinutes:recoveryAgeMinutes(sport,maxAgeMinutes)}))continue;
  execFileSync('gh',['workflow','run',workflow,'--repo',repository,'--ref',branch],{stdio:'inherit'});
  console.log(`Requested current ${sport} refresh`);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(error.message);process.exitCode=1;});
