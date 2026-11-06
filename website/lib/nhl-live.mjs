import { buildBoard } from '../../scripts/nhl/refresh.mjs';
import { easternDate } from '../../scripts/nhl/core.mjs';
let cached;
export async function loadNhlLiveBoard({ now=Date.now(), build=buildBoard }={}) {
  const date=easternDate(new Date(now));
  if(cached && cached.date===date && now>=cached.at && now-cached.at<60000)return cached.promise;
  const entry={date,at:now,promise:build({date})};cached=entry;
  try{return await entry.promise;}catch(error){if(cached===entry)cached=null;throw error;}
}
