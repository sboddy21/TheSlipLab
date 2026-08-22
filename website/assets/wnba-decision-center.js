(function(){
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const markets={points:"Points",rebounds:"Rebounds",assists:"Assists",threes:"Threes"};
  const seasonKey={points:"points",rebounds:"rebounds",assists:"assists",threes:"threesMade"};
  const state={market:"points",query:"",team:"",sort:"signal",rows:[],players:new Map(),games:[],verified:null};
  const fmt=value=>Number.isFinite(Number(value))?Number(value).toFixed(1).replace(/\.0$/,""):"—";
  const delta=(row,player,market)=>Number((Number(row.projections[market]?.value||0)-Number(player?.season?.[seasonKey[market]]||0)).toFixed(1));
  function signal(row,player,market){
    const recent=Number(player?.recent?.[seasonKey[market]]);
    const season=Number(player?.season?.[seasonKey[market]]);
    const form=Number.isFinite(recent)&&Number.isFinite(season)?Math.max(-6,Math.min(6,(recent-season)*2)):0;
    const context=((Number(row.context?.paceFactor||1)-1)+(Number(row.context?.opponentDefenseFactor||1)-1))*100;
    return Math.max(1,Math.min(99,Math.round(row.confidence*.52+row.roleScore*.31+Math.min(row.expectedMinutes,36)*.3+form+context)));
  }
  function enriched(){return state.rows.map(row=>{const player=state.players.get(String(row.playerId));return {...row,playerData:player,signal:signal(row,player,state.market),marketValue:Number(row.projections[state.market]?.value||0)}})}
  function render(){
    let rows=enriched().filter(row=>(!state.team||row.team===state.team)&&(!state.query||`${row.player} ${row.team} ${row.opponent}`.toLowerCase().includes(state.query)));
    const sorters={signal:(a,b)=>b.signal-a.signal||b.confidence-a.confidence,projection:(a,b)=>b.marketValue-a.marketValue,confidence:(a,b)=>b.confidence-a.confidence||b.signal-a.signal,minutes:(a,b)=>b.expectedMinutes-a.expectedMinutes};
    rows.sort(sorters[state.sort]);
    $("#wdcStatus").textContent=`${rows.length} players · ${markets[state.market]} model signals · Select a player for full context`;
    $("#wdcBoard").innerHTML=rows.length?rows.map((row,index)=>{
      const projection=row.projections[state.market];const player=row.playerData;const d=delta(row,player,state.market);
      const flags=[row.role,row.context?.opponentDefenseRank?`Defense #${row.context.opponentDefenseRank}`:"",player?.injury?.status||""].filter(Boolean);
      return `<button class="wdc-row" type="button" data-player-id="${esc(row.playerId)}"><span class="wdc-rank">${index+1}</span><span class="wdc-player"><strong>${esc(row.player)}</strong><span>${esc(row.team)} vs ${esc(row.opponent)} · ${esc(row.role)}</span></span><span class="wdc-cell wdc-signal"><span>Signal score</span><strong>${row.signal}</strong></span><span class="wdc-cell"><span>${esc(markets[state.market])} projection</span><strong>${fmt(projection.value)}</strong></span><span class="wdc-cell"><span>Expected minutes</span><strong>${fmt(row.expectedMinutes)}</strong></span><span class="wdc-cell wdc-range"><span>Projection range</span><strong>${fmt(projection.floor)}–${fmt(projection.ceiling)}</strong><small>${d>=0?"+":""}${fmt(d)} vs season</small></span><span class="wdc-flags">${flags.map((flag,i)=>`<span class="wdc-flag ${i===flags.length-1&&player?.injury?"alert":""}">${esc(flag)}</span>`).join("")}</span></button>`;
    }).join(""):`<div class="wdc-empty">No players match the selected filters.</div>`;
  }
  function openPlayer(id){
    const row=state.rows.find(item=>String(item.playerId)===String(id));if(!row)return;const player=state.players.get(String(id))||{};const market=state.market;const projection=row.projections[market];const logs=player.recent?.gameLog||[];
    const evidence=[`${fmt(row.expectedMinutes)} expected minutes compared with ${fmt(player.season?.minutes)} this season`,`${fmt(player.recent?.[seasonKey[market]])} recent ${markets[market].toLowerCase()} compared with ${fmt(player.season?.[seasonKey[market]])} this season`,`Opponent defense rank: ${row.context?.opponentDefenseRank??"unavailable"}`,player.injury?`${player.injury.status}${player.injury.detail?`: ${player.injury.detail}`:""}`:`No active injury report in the current player pool`];
    $("#wdcDialogBody").innerHTML=`<div class="wdc-detail-head">${player.headshot?`<img class="wdc-headshot" src="${esc(player.headshot)}" alt="${esc(row.player)}">`:`<div class="wdc-headshot"></div>`}<div><h2 id="wdcDialogTitle">${esc(row.player)}</h2><p>${esc(row.team)} vs ${esc(row.opponent)} · ${esc(player.position||row.role)} · ${esc(row.role)} role</p></div></div><div class="wdc-detail-grid"><div class="wdc-detail-stat"><span>Signal score</span><strong>${signal(row,player,market)}</strong></div><div class="wdc-detail-stat"><span>${esc(markets[market])} projection</span><strong>${fmt(projection.value)}</strong></div><div class="wdc-detail-stat"><span>Floor–ceiling</span><strong>${fmt(projection.floor)}–${fmt(projection.ceiling)}</strong></div><div class="wdc-detail-stat"><span>Model confidence</span><strong>${fmt(row.confidence)}%</strong></div></div><section class="wdc-detail-section"><h3>Why this player</h3><div class="wdc-evidence">${evidence.map(item=>`<div>${esc(item)}</div>`).join("")}</div></section><section class="wdc-detail-section"><h3>Recent game log</h3><div class="wdc-log-wrap"><table class="wdc-log"><thead><tr><th>Date</th><th>Opponent</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th></tr></thead><tbody>${logs.slice(0,5).map(game=>`<tr><td>${esc(new Date(game.date).toLocaleDateString([], {month:"short",day:"numeric"}))}</td><td>${esc(game.opponent)}</td><td>${fmt(game.minutes)}</td><td>${fmt(game.points)}</td><td>${fmt(game.rebounds)}</td><td>${fmt(game.assists)}</td><td>${fmt(game.threes)}</td></tr>`).join("")||`<tr><td colspan="7">Recent game log unavailable.</td></tr>`}</tbody></table></div></section><div class="wdc-disclaimer">Model signals are projection context, not verified market recommendations. Verified plays appear only after calibration and authorized market-data gates pass.</div>`;
    $("#wdcDialog").showModal();
  }
  async function load(){
    try{
      const files=["wnba_projection_board.json","wnba_player_baselines.json","wnba_games_today.json","wnba_verified_markets.json"];
      const responses=await Promise.all(files.map(file=>fetch(`./data/${file}?v=${Date.now()}`,{cache:"no-store"})));
      if(responses.some(response=>!response.ok))throw new Error("One or more WNBA data files are unavailable.");
      const [board,players,games,verified]=await Promise.all(responses.map(response=>response.json()));
      state.rows=Array.isArray(board.projections)?board.projections:[];state.players=new Map((players.players||[]).map(player=>[String(player.playerId),player]));state.games=games.games||[];state.verified=verified;
      $("#wdcPlayerCount").textContent=state.rows.length;$("#wdcGameCount").textContent=state.games.length;$("#wdcTopConfidence").textContent=state.rows.length?`${Math.max(...state.rows.map(row=>Number(row.confidence)||0))}%`:"—";$("#wdcUpdated").textContent=board.generatedAt?`Updated ${new Date(board.generatedAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`:"Current slate";
      const teams=[...new Set(state.rows.map(row=>row.team))].sort();$("#wdcTeam").insertAdjacentHTML("beforeend",teams.map(team=>`<option value="${esc(team)}">${esc(team)}</option>`).join(""));
      const unlocked=!verified.locked&&(verified.recommendations||[]).length>0;$("#wdcGate").classList.toggle("unlocked",unlocked);$("#wdcGate").innerHTML=unlocked?`<strong>Verified markets available</strong><span>${verified.recommendations.length} recommendations passed calibration, freshness, and minimum-edge gates.</span>`:`<strong>Model-signal mode</strong><span>Authorized market lines are not currently available, so this board ranks projection evidence without presenting unverified betting edges.</span>`;
      render();
    }catch(error){$("#wdcStatus").textContent=error.message;$("#wdcBoard").innerHTML=`<div class="wdc-empty">WNBA Decision Center is temporarily unavailable. Existing site data remains unchanged.</div>`}
  }
  $("#wdcTabs").addEventListener("click",event=>{const button=event.target.closest("button[data-market]");if(!button)return;state.market=button.dataset.market;document.querySelectorAll("#wdcTabs button").forEach(item=>item.setAttribute("aria-selected",String(item===button)));render()});
  $("#wdcSearch").addEventListener("input",event=>{state.query=event.target.value.trim().toLowerCase();render()});$("#wdcTeam").addEventListener("change",event=>{state.team=event.target.value;render()});$("#wdcSort").addEventListener("change",event=>{state.sort=event.target.value;render()});$("#wdcBoard").addEventListener("click",event=>{const row=event.target.closest("[data-player-id]");if(row)openPlayer(row.dataset.playerId)});$("#wdcClose").addEventListener("click",()=>$("#wdcDialog").close());$("#wdcDialog").addEventListener("click",event=>{if(event.target===$("#wdcDialog"))$("#wdcDialog").close()});
  load();
})();
