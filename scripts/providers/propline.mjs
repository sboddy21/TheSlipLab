import fs from 'node:fs';
import dotenv from 'dotenv';
const BASE='https://api.prop-line.com/v1';
export function proplineSettings(){
 const local=fs.existsSync('.env')?dotenv.parse(fs.readFileSync('.env')):{};
 const key=process.env.PROPLINE_API_KEY||local.PROPLINE_API_KEY;
 const base=process.env.PROPLINE_BASE_URL||local.PROPLINE_BASE_URL||BASE;
 if(base!==BASE)throw new Error('Unsupported PropLine host');
 return {key,base};
}
export async function proplineRequest(endpoint,{fetcher=fetch}={}){
 if(!endpoint.startsWith('/')||endpoint.includes('..'))throw new Error('Invalid PropLine endpoint');
 const {key,base}=proplineSettings();if(!key)throw new Error('PropLine key is not configured');
 let response;try{response=await fetcher(base+endpoint,{headers:{'X-API-Key':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw new Error('PropLine connection failed');}
 if(!response.ok)throw new Error(`PropLine HTTP ${response.status}`);
 return {data:await response.json(),retrievedAt:new Date().toISOString(),quota:{limit:response.headers.get('x-daily-limit'),used:response.headers.get('x-daily-used'),remaining:response.headers.get('x-daily-remaining')}};
}

// Only standard sportsbook payouts; DFS and exchange settlement differ.
export const PROPLINE_BOOKS=new Set(['bovada','draftkings','fanduel','betmgm','betrivers','pinnacle','fanatics','betonlineag','betus','lowvig','mybookieag']);
export function normalizePropLineBooks(event){
 if(event.live===true||!Number.isFinite(Date.parse(event.commence_time))||Date.parse(event.commence_time)<=Date.now())return [];
 return (event.bookmakers||[]).filter(book=>PROPLINE_BOOKS.has(book.key)).map(book=>({...book,markets:(book.markets||[]).filter(m=>!m.suspended_at&&!m.period).map(m=>({...m,outcomes:(m.outcomes||[]).filter(o=>!o.dfs_odds_type&&(o.payout_multiplier==null||o.payout_multiplier===1)).map(o=>{
 // PropLine's Yes/No batter_home_runs market means at least one HR.
 const binary=m.key==='batter_home_runs'&&(o.point==null||o.point===0.5)&&['Yes','No'].includes(o.name);
 return {...o,point:binary?0.5:o.point,name:binary?(o.name==='Yes'?'Over':'Under'):o.name};
 })}))}));
}
