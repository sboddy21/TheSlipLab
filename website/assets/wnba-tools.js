(function(){
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const mount=document.getElementById("wnbaTool");
  const status=document.getElementById("wnbaToolStatus");
  if(!mount)return;
  const view=document.body.dataset.wnbaView;
  const statNames={points:"PTS",rebounds:"REB",assists:"AST",threes:"3PM"};
  const stats=row=>Object.entries(statNames).map(([key,label])=>`<div class="wnba-stat"><b>${esc(row.projections[key].value)}</b><span>${label} · ${esc(row.projections[key].floor)}–${esc(row.projections[key].ceiling)}</span></div>`).join("");
  const table=rows=>`<div class="wnba-table-wrap"><table class="wnba-table"><thead><tr><th>Player</th><th>Matchup</th><th>Expected MIN</th><th>Points</th><th>Rebounds</th><th>Assists</th><th>Threes</th><th>Confidence</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.player)}<small>${esc(row.team)} · ${esc(row.role)}</small></td><td>${esc(row.team)} vs ${esc(row.opponent)}</td><td>${esc(row.expectedMinutes)}</td>${Object.keys(statNames).map(key=>`<td><span class="wnba-value">${esc(row.projections[key].value)}</span><small>${esc(row.projections[key].floor)}–${esc(row.projections[key].ceiling)}</small></td>`).join("")}<td><span class="wnba-confidence">${esc(row.confidence)}%</span></td></tr>`).join("")}</tbody></table></div>`;
  const strongestMarket=(row,player)=>Object.keys(statNames).sort((a,b)=>{const seasonA=player?.season?.[a==="threes"?"threesMade":a]||1;const seasonB=player?.season?.[b==="threes"?"threesMade":b]||1;return row.projections[b].value/seasonB-row.projections[a].value/seasonA})[0];
  const signalReason=(row,player)=>{
    const reasons=[];
    const minuteDelta=player?.recent?.minutes!=null?player.recent.minutes-player.season.minutes:0;
    const pointDelta=player?.recent?.points!=null?player.recent.points-player.season.points:0;
    if(minuteDelta>=2)reasons.push(`recent minutes are up ${minuteDelta.toFixed(1)} from her season role`);
    if(pointDelta>=2)reasons.push(`recent scoring is up ${pointDelta.toFixed(1)} points`);
    if(row.context?.paceFactor>=1.02)reasons.push("the matchup carries a positive pace adjustment");
    if(row.context?.opponentDefenseFactor>=1.02)reasons.push("the opponent environment raises the scoring projection");
    if(row.roleScore>=75)reasons.push("she owns one of the slate’s strongest established roles");
    return reasons.slice(0,2).join(" and ")||"her minutes and production profile remain stable";
  };
  async function load(){
    try{
      const files=["wnba_projection_board.json","wnba_projection_history.json","wnba_calibration.json","wnba_games_today.json","wnba_player_baselines.json"];
      const responses=await Promise.all(files.map(file=>fetch(`./data/${file}?v=${Date.now()}`,{cache:"no-store"})));
      if(responses.some(response=>!response.ok))throw new Error("WNBA data unavailable");
      const [board,history,calibration,gamesData,playerData]=await Promise.all(responses.map(response=>response.json()));
      const rows=Array.isArray(board.projections)?board.projections:[];
      const playerById=new Map((playerData.players||[]).map(player=>[String(player.playerId),player]));
      status.innerHTML=`<strong>${esc(board.date||"Current slate")}</strong><span>${rows.length} eligible players · Updated automatically</span>`;
      if(view==="full-board") mount.innerHTML=rows.length?table(rows):`<div class="wnba-empty">No pregame player projections are available on the current slate.</div>`;
      if(view==="quick-target"){
        const byConfidence=[...rows].sort((a,b)=>b.confidence-a.confidence||b.roleScore-a.roleScore)[0];
        const byForm=[...rows].sort((a,b)=>{const pa=playerById.get(String(a.playerId)),pb=playerById.get(String(b.playerId));return ((pb?.recent?.points||0)-(pb?.season?.points||0))-((pa?.recent?.points||0)-(pa?.season?.points||0))})[0];
        const byMinutes=[...rows].sort((a,b)=>{const pa=playerById.get(String(a.playerId)),pb=playerById.get(String(b.playerId));return ((pb?.recent?.minutes||0)-(pb?.season?.minutes||0))-((pa?.recent?.minutes||0)-(pa?.season?.minutes||0))})[0];
        const byMatchup=[...rows].sort((a,b)=>(b.context?.paceFactor||0)+(b.context?.opponentDefenseFactor||0)-(a.context?.paceFactor||0)-(a.context?.opponentDefenseFactor||0))[0];
        const candidates=[["Highest confidence",byConfidence],["Hot form",byForm],["Minutes opportunity",byMinutes],["Best matchup",byMatchup],...[...rows].sort((a,b)=>b.confidence-a.confidence||b.roleScore-a.roleScore).slice(0,8).map(row=>["Top profile",row])];
        const seen=new Set();const targets=candidates.filter(([,row])=>row&&!seen.has(String(row.playerId))&&seen.add(String(row.playerId))).slice(0,9);
        mount.className="wnba-grid";
        mount.innerHTML=targets.length?targets.map(([category,row])=>`<article class="wnba-card"><div class="label">${esc(category)}</div><h2>${esc(row.player)}</h2><div class="matchup">${esc(row.team)} vs ${esc(row.opponent)} · ${esc(row.expectedMinutes)} expected minutes</div><div class="lead">${esc(row.confidence)}%</div><div class="label">Model confidence</div><p>${esc(signalReason(row,playerById.get(String(row.playerId))))}.</p><div class="wnba-stat-grid">${stats(row)}</div></article>`).join(""):`<div class="wnba-empty">Quick Targets will populate when the next pregame slate is available.</div>`;
      }
      if(view==="ai-says"){
        const ranked=[...rows].sort((a,b)=>b.confidence-a.confidence||b.roleScore-a.roleScore).slice(0,8);
        mount.innerHTML=ranked.length?ranked.map((row,index)=>{const player=playerById.get(String(row.playerId));const market=strongestMarket(row,player);const projection=row.projections[market];return `<article class="wnba-insight"><div class="wnba-rank">${index+1}</div><div><h2>${esc(row.player)} · ${esc(row.team)}</h2><p><strong>Why she stands out:</strong> ${esc(signalReason(row,player))}. The clearest statistical signal is ${esc(projection.value)} ${esc(statNames[market])} with a ${esc(projection.floor)}–${esc(projection.ceiling)} range across ${esc(row.expectedMinutes)} expected minutes against ${esc(row.opponent)}.</p><div class="wnba-chips"><span class="wnba-chip">${esc(row.confidence)}% confidence</span><span class="wnba-chip">${esc(row.role)}</span><span class="wnba-chip">Defense rank ${esc(row.context?.opponentDefenseRank??"—")}</span><span class="wnba-chip">Pace ${esc(row.context?.paceFactor??"—")}x</span></div></div></article>`}).join(""):`<div class="wnba-empty">WNBA AI Says will populate with the next eligible pregame slate.</div>`;
      }
      if(view==="results"){
        const graded=(history.slates||[]).flatMap(slate=>(slate.projections||[]).filter(row=>row.actual).map(row=>({...row,slateDate:slate.date})));
        const finals=(gamesData.games||[]).filter(game=>game.completed);
        status.innerHTML=`<strong>WNBA results only</strong><span>${finals.length} final games · ${graded.length} player results graded</span>`;
        const finalMarkup=finals.length?`<div class="wnba-finals">${finals.map(game=>`<article class="wnba-final"><div class="wnba-final-date">${esc(gamesData.date)} · Final</div><div class="wnba-final-team"><span>${esc(game.awayTeam.name)}</span><b>${esc(game.awayTeam.score)}</b></div><div class="wnba-final-team"><span>${esc(game.homeTeam.name)}</span><b>${esc(game.homeTeam.score)}</b></div></article>`).join("")}</div>`:"";
        const playerMarkup=graded.length?`<h2 class="wnba-results-heading">Player results</h2><div class="wnba-panel"><div class="wnba-table-wrap"><table class="wnba-table"><thead><tr><th>Date</th><th>Player</th><th>Matchup</th><th>Minutes</th><th>Points</th><th>Rebounds</th><th>Assists</th><th>Threes</th></tr></thead><tbody>${graded.map(row=>`<tr><td>${esc(row.slateDate)}</td><td>${esc(row.player)}<small>${esc(row.team)}</small></td><td>${esc(row.team)} vs ${esc(row.opponent)}</td><td>${esc(row.actual.minutes)}</td>${Object.keys(statNames).map(key=>`<td><span class="wnba-value">${esc(row.actual[key])}</span><small>Proj. ${esc(row.projections[key].value)}</small></td>`).join("")}</tr>`).join("")}</tbody></table></div></div>`:"";
        mount.className="";
        mount.innerHTML=finalMarkup+playerMarkup||`<div class="wnba-panel"><div class="wnba-empty">No WNBA games are final yet. Results will update automatically when today’s games finish.</div></div>`;
      }
    }catch(error){status.innerHTML="<strong>Data unavailable</strong><span>Please check back shortly.</span>";mount.innerHTML=`<div class="wnba-empty">WNBA data is temporarily unavailable.</div>`}
  }
  load();
})();
