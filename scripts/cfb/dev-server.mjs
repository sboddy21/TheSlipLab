import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import live from '../../website/api/cfb-live.mjs';
const root=fileURLToPath(new URL('../../website/',import.meta.url));
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.status=code=>{res.statusCode=code;return res;};res.json=value=>res.end(JSON.stringify(value));
  if(url.pathname==='/api/cfb-live')return live(req,res);
  try {
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
    if(!file.startsWith(root)||file.includes('/api/'))throw new Error('Not public');
    res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.ico':'image/x-icon','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(await fs.readFile(file));
  } catch {res.statusCode=404;res.end('Not found');}
}).listen(8765,'127.0.0.1',()=>console.log('College football development server: http://localhost:8765/cfb.html'));

// Keep the local preview fed while this development server is running.
// Production refreshes are owned by the sports-odds GitHub workflow.
const run=promisify(execFile);
let oddsRefreshing=false;
async function refreshPreviewOdds(){
  if(oddsRefreshing)return;
  try{const cached=JSON.parse(await fs.readFile(path.join(root,'data/odds_mlb.json'),'utf8'));if(Date.now()-Date.parse(cached.retrievedAt)<14*60_000)return;}catch{}
  oddsRefreshing=true;
  try{for(const script of ['scripts/odds/refresh.mjs','scripts/cfb/refresh.mjs','scripts/mlb/build_market_odds.js'])await run(process.execPath,[script],{cwd:path.resolve(root,'..'),timeout:240000,maxBuffer:1024*1024});console.log('Local sportsbook odds refreshed.');}
  catch{console.warn('Local odds refresh incomplete; unavailable or stale prices stay hidden.');}
  finally{oddsRefreshing=false;}
}
refreshPreviewOdds();
setInterval(refreshPreviewOdds,60_000).unref();
