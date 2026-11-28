import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyCurrentDataset} from '../website/lib/data-freshness.mjs';
import {prepareCurrentMarkets} from '../website/lib/current-markets.mjs';

export const boardFiles={nba:'nba_points.json',nfl:'nfl_td_decision_center.json',nhl:'nhl_board.json',cfb:'cfb_board.json',ncaam:'ncaam_board.json',wnba:'wnba_projection_board.json',mlb:'mlb_games_today.json'};
export async function verifiedBoard(sport,{load,now=Date.now()}={}) {
 const file=boardFiles[sport];if(!file)throw Error('Choose nba, nfl, nhl, cfb, ncaam, wnba or mlb');
 const read=async name=>prepareCurrentMarkets(name,await load(name),now);
 const payload=await read(file);
 const freshness=await verifyCurrentDataset(file,payload,{load:read,now});
 if(!freshness.available)throw Error(`${sport}: current board cannot be verified (${freshness.reasons.join(', ')}); do not substitute a saved local board`);
 return {sport,file,payload,freshness};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 try {
  const remote=execFileSync('git',['remote','get-url','origin'],{encoding:'utf8'}).trim();
  if(!/github\.com[:/]sboddy21\/TheSlipLab(?:\.git)?$/.test(remote))throw Error('Unexpected production repository');
  // Fetch must succeed: an old tracking ref is not a substitute for current data.
  execFileSync('git',['fetch','origin','main'],{stdio:['ignore','ignore','inherit']});
  const commit=execFileSync('git',['rev-parse','origin/main'],{encoding:'utf8'}).trim();
  const load=async file=>JSON.parse(execFileSync('git',['show',`${commit}:website/data/${file}`],{encoding:'utf8',maxBuffer:100*1024*1024}));
  const sports=process.argv[2]&&process.argv[2]!=='--all'?[process.argv[2]]:Object.keys(boardFiles);
  let failed=false;
  for(const sport of sports){try{const result=await verifiedBoard(sport,{load});const d=result.payload;console.log(JSON.stringify({sport,file:result.file,source:'production main',commit,current:true,date:d.date||d.slateDate||null,observedAt:d.dataAsOf||d.fetchedAt||d.generatedAt||d.updatedAt,...(process.argv.includes('--json')?{board:d}:{})}));}catch(error){failed=true;console.error(error.message);}}
  if(failed)process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
