import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://raw.githubusercontent.com/sboddy21/TheSlipLab/main/website/data/';
const cache = new Map();
const observed = payload => Math.max(...['dataAsOf','sourceFetchedAt','fetchedAt','retrievedAt','updatedAt','updated_at','generatedAt'].map(key=>Date.parse(payload?.[key] || '')).filter(Number.isFinite), 0);

// Read current published data independently of the last website build. Keep
// original source timestamps; the caller still enforces source freshness.
export function createPublishedDataReader({fetcher=fetch, now=Date.now, roots=[path.resolve(process.cwd(),'website/data'),path.resolve(process.cwd(),'data')], remote=true}={}) {
  const request = new Map();
  async function read(file) {
    if (!/^[A-Za-z0-9_./-]+\.json$/.test(file) || file.split('/').includes('..') || file.startsWith('/')) throw Error('Invalid dataset');
    if (request.has(file)) return request.get(file);
    const pending = (async()=>{
      let local;
      for(const root of roots) {
        try {local=JSON.parse(await fs.readFile(path.join(root,file),'utf8'));break;}
        catch(error){if(error.code!=='ENOENT')throw error;}
      }
      // Archives are intentionally served from the release; a request for a live
      // dataset must not download a multi-year archive to find current data.
      if(!remote || /(?:^|_)(backtest|calibration|results|projection_history)(?:_|\.)|^hr_ai_(history|hof)\./.test(file)) {
        if(local===undefined)throw Error('Data file not found');return local;
      }
      const key=file, time=now();
      let entry=cache.get(key);
      if(!entry || time-entry.at>=30000 || time<entry.at) {
        const promise=(async()=>{
          const response=await fetcher(`${ORIGIN}${file}?current=${Math.floor(time/30000)}`,{headers:{Accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(8000),redirect:'error'});
          if(!response.ok)throw Error('Published source unavailable');
          return response.json();
        })();
        entry={at:time,promise};cache.set(key,entry);
        if(cache.size>256)cache.delete(cache.keys().next().value);
        promise.catch(()=>{if(cache.get(key)===entry)cache.delete(key);});
      }
      try {
        const published=await entry.promise;
        return local!==undefined && observed(local)>observed(published) ? local : published;
      } catch {if(local!==undefined)return local;throw Error('Current published data unavailable');}
    })();
    request.set(file,pending);return pending;
  }
  return read;
}
