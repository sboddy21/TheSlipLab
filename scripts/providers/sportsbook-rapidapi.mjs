import fs from 'node:fs';
import dotenv from 'dotenv';
export const HOST = 'sportsbook-api2.p.rapidapi.com';
export function settings() {
  const local = fs.existsSync('.env') ? dotenv.parse(fs.readFileSync('.env')) : {};
  const key = process.env.RAPIDAPI_KEY || local.RAPIDAPI_KEY;
  const host = process.env.RAPIDAPI_HOST || local.RAPIDAPI_HOST;
  if (!key || host !== HOST) throw new Error('RapidAPI key or sportsbook host is not configured');
  return {key,host};
}
export async function request(endpoint, {fetcher=fetch}={}) {
  if (!/^\/v[01]\//.test(endpoint) || endpoint.includes('..')) throw new Error('Invalid sportsbook endpoint');
  const {key,host}=settings();
  let response;
  try {response=await fetcher(`https://${HOST}${endpoint}`,{headers:{'X-RapidAPI-Host':host,'X-RapidAPI-Key':key,Accept:'application/json'},signal:AbortSignal.timeout(20000),redirect:'error'});}
  catch {throw new Error('Sportsbook connection failed');}
  if (!response.ok) throw new Error(`Sportsbook HTTP ${response.status}`);
  const data=await response.json();
  return {retrievedAt:new Date().toISOString(),data,quota:{limit:response.headers.get('x-ratelimit-requests-limit'),remaining:response.headers.get('x-ratelimit-requests-remaining'),reset:response.headers.get('x-ratelimit-requests-reset')}};
}
