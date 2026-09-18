const DAY_MS=86400000;
const compact=date=>date.toISOString().slice(0,10).replaceAll('-','');
const easternDay=value=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function scoreboardUrl(date){
  return `https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?dates=${compact(date)}&groups=80&limit=1000`;
}

export async function fetchScoreboardDay(date,{fetchImpl=fetch,retries=3,timeoutMs=30000,sleepImpl=sleep}={}){
  const url=scoreboardUrl(date);
  let lastError;
  for(let attempt=1;attempt<=retries;attempt++){
    try{
      const response=await fetchImpl(url,{headers:{Accept:'application/json','User-Agent':'TheSlipLab-CFB-Refresh/1.0'},signal:AbortSignal.timeout(timeoutMs)});
      if(!response.ok){
        const error=new Error(`ESPN returned ${response.status} for ${compact(date)}`);
        error.status=response.status;
        if(response.status<500&&response.status!==429)throw error;
        lastError=error;
      }else{
        const data=await response.json();
        if(!Array.isArray(data.events)||data.events.length>=1000)throw new Error(`Missing or truncated ESPN events for ${compact(date)}`);
        return data.events;
      }
    }catch(error){
      lastError=error;
      if(error.status&&error.status<500&&error.status!==429)throw error;
    }
    if(attempt<retries)await sleepImpl(500*2**(attempt-1));
  }
  throw lastError||new Error(`ESPN request failed for ${compact(date)}`);
}

export async function fetchScoreboardRange(start,finish,{fallback=[],concurrency=4,onWarning=console.warn,...options}={}){
  const days=[];
  for(let cursor=new Date(start);cursor<=finish;cursor=new Date(cursor.getTime()+DAY_MS))days.push(cursor);
  const results=[];
  for(let index=0;index<days.length;index+=concurrency){
    const batch=days.slice(index,index+concurrency);
    const settled=await Promise.allSettled(batch.map(day=>fetchScoreboardDay(day,options)));
    settled.forEach((result,offset)=>{
      const day=batch[offset],key=day.toISOString().slice(0,10);
      if(result.status==='fulfilled')results.push(...result.value);
      else{
        const cached=fallback.filter(game=>easternDay(game.date)===key);
        results.push(...cached);
        onWarning(`[cfb-refresh] ESPN ${key} failed: ${result.reason?.message||result.reason}. Reused ${cached.length} cached games.`);
      }
    });
  }
  return [...new Map(results.map(event=>[String(event.id),event])).values()];
}
