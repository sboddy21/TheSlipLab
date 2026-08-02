(function(){
  const mode=document.body.dataset.trackerMode||"homeRuns";
  const configs={
    homeRuns:{title:"Home Run Tracker",kicker:"Live MLB results",description:"Every verified MLB home run from today’s live and completed games.",key:"homeRuns",empty:"No home runs have been recorded yet today."},
    nearHomeRuns:{title:"Near Home Run Tracker",kicker:"Deep drives that stayed in",description:"Non-home-run batted balls traveling at least 350 feet, using verified Statcast distance.",key:"nearHomeRuns",empty:"No qualifying near home runs have been recorded yet today."},
    extraBaseHits:{title:"Extra Bases Tracker",kicker:"Live MLB results",description:"Every verified double, triple, and home run from today’s live and completed games.",key:"extraBaseHits",empty:"No extra-base hits have been recorded yet today."},
    hardHitBalls:{title:"Hard-Hit Tracker",kicker:"Verified contact quality",description:"Every batted ball at 95 mph or harder from today’s live and completed games.",key:"hardHitBalls",empty:"No qualifying hard-hit balls have been recorded yet today."}
  };
  const config=configs[mode]||configs.homeRuns;
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const show=(value,suffix="")=>value===null||value===undefined||value===""?"—":`${esc(value)}${suffix}`;
  function eventMarkup(row){
    const result=String(row.event||row.category||"Batted ball").replaceAll("_"," ");
    return `<article class="tracker-event"><div class="tracker-player"><label>Player</label><strong>${esc(row.player||row.batter||"Unknown")}</strong><span>${esc(row.team||"")} · ${esc(row.game||"")}</span></div><div class="tracker-detail"><label>Result</label><strong>${esc(result)}</strong><span>${esc(row.inning||"")} · ${esc(row.status||"")} · ${esc(row.score||"")}</span></div><div class="tracker-metric"><label>Exit velocity</label><strong>${show(row.exitVelocity," mph")}</strong></div><div class="tracker-metric"><label>Distance</label><strong>${show(row.distance," ft")}</strong></div><div class="tracker-metric"><label>Launch angle</label><strong>${show(row.launchAngle,"°")}</strong></div></article>`;
  }
  async function load(){
    const response=await fetch(`./data/mlb_results.json?v=${Date.now()}`,{cache:"no-store"});
    if(!response.ok)throw new Error("Live results unavailable");
    const data=await response.json();
    let rows=Array.isArray(data[config.key])?data[config.key]:[];
    if(!rows.length&&config.key==="nearHomeRuns")rows=(data.playerEvents||[]).filter(row=>row.category!=="home_run"&&row.isCloseCall);
    if(!rows.length&&config.key==="extraBaseHits")rows=(data.playerEvents||[]).filter(row=>["double","triple","home_run"].includes(row.category));
    if(!rows.length&&config.key==="hardHitBalls")rows=(data.playerEvents||[]).filter(row=>Number(row.exitVelocity)>=95);
    document.getElementById("trackerDate").textContent=data.date||"Today";
    document.getElementById("trackerCount").textContent=rows.length.toLocaleString();
    document.getElementById("trackerGames").textContent=Number(data.checkedGames||0).toLocaleString();
    document.getElementById("trackerLive").textContent=Number(data.liveGames||0).toLocaleString();
    const updated=new Date(data.updatedAt||"");
    document.getElementById("trackerUpdated").textContent=Number.isNaN(updated.getTime())?"Update unavailable":`Updated ${updated.toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`;
    document.getElementById("trackerFeed").innerHTML=rows.length?rows.map(eventMarkup).join(""):`<div class="tracker-empty"><strong>${esc(config.empty)}</strong><span>This page refreshes automatically as verified events arrive.</span></div>`;
  }
  document.getElementById("trackerKicker").textContent=config.kicker;
  document.getElementById("trackerTitle").textContent=config.title;
  document.getElementById("trackerDescription").textContent=config.description;
  load().catch(error=>{document.getElementById("trackerFeed").innerHTML=`<div class="tracker-empty"><strong>Live data is temporarily unavailable.</strong><span>${esc(error.message)}</span></div>`});
  window.setInterval(load,60000);
})();
