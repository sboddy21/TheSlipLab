(function(){
  const $=selector=>document.querySelector(selector);
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[char]));
  const markets={points:"Points",rebounds:"Rebounds",assists:"Assists",threes:"Threes"};
  const seasonKey={points:"points",rebounds:"rebounds",assists:"assists",threes:"threesMade"};
  const params=new URLSearchParams(window.location.search),requestedView=params.get("view");
  const state={view:["top","full","saved"].includes(requestedView)?requestedView:"top",game:params.get("game")||"",market:"points",query:"",team:"",sort:"signal",compared:new Set(),favorites:[],accountReady:false,rows:[],players:new Map(),games:[],verified:null};
  const fmt=value=>Number.isFinite(Number(value))?Number(value).toFixed(1).replace(/\.0$/,""):"—";
  const changeText=item=>{
    if(item.type==="minutes")return `Expected minutes moved ${item.direction} from ${fmt(item.previousValue)} to ${fmt(item.currentValue)}`;
    if(item.type==="projection")return `${markets[item.market]} projection moved ${item.direction} from ${fmt(item.previousValue)} to ${fmt(item.currentValue)}`;
    if(item.type==="role")return `Role changed from ${item.previousValue} to ${item.currentValue}`;
    if(item.type==="injury")return `Availability changed from ${item.previousValue} to ${item.currentValue}`;
    if(item.type==="board_entry")return "Entered the active projection board";
    return "Left the active projection board";
  };
  function renderChanges(feed){
    const changes=feed?.changes||[];
    $("#wdcChangesMeta").textContent=feed?.status==="baseline_established"?"Baseline captured—movement will appear after the next refresh":`${changes.length} material change${changes.length===1?"":"s"} · Updated ${feed?.generatedAt?new Date(feed.generatedAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):"now"}`;
    $("#wdcChanges").innerHTML=changes.length?changes.slice(0,9).map(item=>`<article class="wdc-change ${esc(item.direction)} ${esc(item.type)}"><strong>${esc(item.player)} · ${esc(item.team)}</strong><span>${esc(changeText(item))}</span></article>`).join(""):`<div class="wdc-change-empty">No material projection, minutes, role, or availability changes since the previous refresh.</div>`;
  }
  const delta=(row,player,market)=>Number((Number(row.projections[market]?.value||0)-Number(player?.season?.[seasonKey[market]]||0)).toFixed(1));
  function signal(row,player,market){
    const recent=Number(player?.recent?.[seasonKey[market]]);
    const season=Number(player?.season?.[seasonKey[market]]);
    const form=Number.isFinite(recent)&&Number.isFinite(season)?Math.max(-6,Math.min(6,(recent-season)*2)):0;
    const context=((Number(row.context?.paceFactor||1)-1)+(Number(row.context?.opponentDefenseFactor||1)-1))*100;
    return Math.max(1,Math.min(99,Math.round(row.confidence*.52+row.roleScore*.31+Math.min(row.expectedMinutes,36)*.3+form+context)));
  }
  function enriched(){return state.rows.map(row=>{const player=state.players.get(String(row.playerId));return {...row,playerData:player,signal:signal(row,player,state.market),marketValue:Number(row.projections[state.market]?.value||0)}})}
  function setView(view){
    if(view==="saved"&&state.accountReady&&!window.TSLAccount?.session){window.location.href="./account.html";return}
    state.view=view;
    document.querySelectorAll("#wdcViews [data-view]").forEach(button=>button.setAttribute("aria-selected",String(button.dataset.view===view)));
    const url=new URL(window.location.href);url.searchParams.set("view",view);window.history.replaceState({},"",url);
    render();
  }
  function renderMatchups(){
    const all=enriched(),activeGames=state.games.filter(game=>all.some(row=>String(row.gameId)===String(game.gameId)));
    const cards=[`<button class="wdc-matchup-card" type="button" data-game="" aria-pressed="${!state.game}"><small>Complete slate</small><strong>All matchups</strong><span class="wdc-matchup-meta">${activeGames.length} games · ${all.length} players</span><span class="wdc-matchup-signal">Highest signal ${all.length?Math.max(...all.map(row=>row.signal)):"—"}</span></button>`];
    for(const game of activeGames){
      const rows=all.filter(row=>String(row.gameId)===String(game.gameId)),top=rows.length?Math.max(...rows.map(row=>row.signal)):"—",pace=rows.length?rows.reduce((sum,row)=>sum+Number(row.context?.paceFactor||1),0)/rows.length:1;
      const time=game.gameTimeUTC?new Date(game.gameTimeUTC).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}):game.statusDetail||"Time pending";
      cards.push(`<button class="wdc-matchup-card" type="button" data-game="${esc(game.gameId)}" aria-pressed="${String(state.game)===String(game.gameId)}"><small>${esc(time)} · ${esc(game.status||"Scheduled")}</small><strong>${esc(game.awayTeam?.abbreviation||"Away")} @ ${esc(game.homeTeam?.abbreviation||"Home")}</strong><span class="wdc-matchup-meta">${rows.length} players · ${pace>1.01?"Faster":pace<.99?"Slower":"Neutral"} projected pace<br>${esc(game.venue||game.city||"Venue pending")}</span><span class="wdc-matchup-signal">Top ${esc(markets[state.market].toLowerCase())} signal ${top}</span></button>`);
    }
    $("#wdcMatchups").innerHTML=cards.join("");
  }
  function setGame(gameId){
    state.game=String(gameId||"");state.team="";$("#wdcTeam").value="";
    const url=new URL(window.location.href);if(state.game)url.searchParams.set("game",state.game);else url.searchParams.delete("game");window.history.replaceState({},"",url);render();
  }
  function render(){
    let rows=enriched().filter(row=>(!state.game||String(row.gameId)===state.game)&&(!state.team||row.team===state.team)&&(!state.query||`${row.player} ${row.team} ${row.opponent}`.toLowerCase().includes(state.query)));
    if(state.view==="saved")rows=window.TSLWnbaPersonalization.filterRows(rows,state.favorites);
    const sorters={signal:(a,b)=>b.signal-a.signal||b.confidence-a.confidence,projection:(a,b)=>b.marketValue-a.marketValue,confidence:(a,b)=>b.confidence-a.confidence||b.signal-a.signal,minutes:(a,b)=>b.expectedMinutes-a.expectedMinutes};
    rows.sort(sorters[state.sort]);
    const total=rows.length;if(state.view==="top")rows=rows.slice(0,12);
    const viewLabel=state.view==="top"?`Top ${rows.length} of ${total}`:state.view==="saved"?`${rows.length} saved`:`${rows.length}`;
    $("#wdcStatus").textContent=`${viewLabel} players · ${markets[state.market]} model signals · Select a player for full context`;
    $("#wdcBoard").innerHTML=rows.length?rows.map((row,index)=>{
      const projection=row.projections[state.market];const player=row.playerData;const d=delta(row,player,state.market);
      const flags=[row.role,row.context?.opponentDefenseRank?`Defense #${row.context.opponentDefenseRank}`:"",player?.injury?.status||""].filter(Boolean);
      const selected=state.compared.has(String(row.playerId));
      return `<article class="wdc-row" data-player-id="${esc(row.playerId)}"><span class="wdc-rank">${index+1}</span><span class="wdc-player"><button class="wdc-player-open" type="button" data-open-player="${esc(row.playerId)}">${esc(row.player)}</button><span>${esc(row.team)} vs ${esc(row.opponent)} · ${esc(row.role)}</span></span><span class="wdc-cell wdc-signal"><span>Signal score</span><strong>${row.signal}</strong></span><span class="wdc-cell"><span>${esc(markets[state.market])} projection</span><strong>${fmt(projection.value)}</strong></span><span class="wdc-cell"><span>Expected minutes</span><strong>${fmt(row.expectedMinutes)}</strong></span><span class="wdc-cell wdc-range"><span>Projection range</span><strong>${fmt(projection.floor)}–${fmt(projection.ceiling)}</strong><small>${d>=0?"+":""}${fmt(d)} vs season</small></span><span class="wdc-flags">${flags.map((flag,i)=>`<span class="wdc-flag ${i===flags.length-1&&player?.injury?"alert":""}">${esc(flag)}</span>`).join("")}<button class="wdc-compare-toggle ${selected?"selected":""}" type="button" data-compare-player="${esc(row.playerId)}" aria-pressed="${selected}">${selected?"✓ Comparing":"＋ Compare"}</button></span></article>`;
    }).join(""):`<div class="wdc-empty">${state.view==="saved"?"No saved WNBA players or teams are active on this slate.":"No players match the selected filters."}</div>`;
    renderMatchups();
    renderCompareDock();
  }
  function selectedRows(){return [...state.compared].map(id=>state.rows.find(row=>String(row.playerId)===id)).filter(Boolean)}
  function renderCompareDock(){
    const rows=selectedRows(),dock=$("#wdcCompareDock");dock.hidden=!rows.length;
    if(!rows.length){dock.innerHTML="";return}
    dock.innerHTML=`<div class="wdc-compare-list"><strong>Compare ${rows.length}/3</strong>${rows.map(row=>`<span class="wdc-compare-chip">${esc(row.player)}</span>`).join("")}</div><div class="wdc-compare-actions"><button type="button" data-clear-compare>Clear</button><button type="button" data-open-compare ${rows.length<2?"disabled":""}>Compare players</button></div>`;
  }
  function toggleComparison(id){
    id=String(id);
    if(state.compared.has(id))state.compared.delete(id);else if(state.compared.size<3)state.compared.add(id);else{$("#wdcStatus").textContent="You can compare up to three players at once.";return}
    render();
  }
  function openComparison(){
    const rows=selectedRows();if(rows.length<2)return;
    $("#wdcCompareBody").innerHTML=`<div class="wdc-compare-head"><h2 id="wdcCompareTitle">Player comparison</h2><p>Current projections, role, form, and matchup context shown side by side.</p></div><div class="wdc-compare-grid">${rows.map(row=>{const player=state.players.get(String(row.playerId))||{};const recent=player.recent?.[seasonKey[state.market]],season=player.season?.[seasonKey[state.market]];return `<article class="wdc-compare-card"><h3>${esc(row.player)}</h3><p>${esc(row.team)} vs ${esc(row.opponent)} · ${esc(row.role)}</p><div class="wdc-compare-stat primary"><span>Signal</span><strong>${signal(row,player,state.market)}</strong></div><div class="wdc-compare-stat"><span>${esc(markets[state.market])}</span><strong>${fmt(row.projections[state.market]?.value)} (${fmt(row.projections[state.market]?.floor)}–${fmt(row.projections[state.market]?.ceiling)})</strong></div><div class="wdc-compare-stat"><span>Expected minutes</span><strong>${fmt(row.expectedMinutes)}</strong></div><div class="wdc-compare-stat"><span>Confidence</span><strong>${fmt(row.confidence)}%</strong></div><div class="wdc-compare-stat"><span>Role score</span><strong>${fmt(row.roleScore)}</strong></div><div class="wdc-compare-stat"><span>Recent / season</span><strong>${fmt(recent)} / ${fmt(season)}</strong></div><div class="wdc-compare-stat"><span>Opponent defense</span><strong>${row.context?.opponentDefenseRank?`#${esc(row.context.opponentDefenseRank)}`:"—"}</strong></div><div class="wdc-compare-stat"><span>All projections</span><strong>${fmt(row.projections.points?.value)} PTS · ${fmt(row.projections.rebounds?.value)} REB · ${fmt(row.projections.assists?.value)} AST · ${fmt(row.projections.threes?.value)} 3PM</strong></div></article>`}).join("")}</div>`;
    if(!$("#wdcCompareDialog").open)$("#wdcCompareDialog").showModal();
  }
  const favoriteFor=(type,id)=>window.TSLWnbaPersonalization.find(state.favorites,type,id);
  const saveActions=row=>{const playerSaved=favoriteFor("player",row.playerId),teamSaved=favoriteFor("team",row.team);return `<div class="wdc-save-actions"><button type="button" class="${playerSaved?"saved":""}" data-save-type="player" data-save-id="${esc(row.playerId)}">${playerSaved?"★ Player saved":"☆ Save player"}</button><button type="button" class="${teamSaved?"saved":""}" data-save-type="team" data-save-id="${esc(row.team)}">${teamSaved?"★ Team followed":"☆ Follow team"}</button></div>`};
  function openPlayer(id){
    const row=state.rows.find(item=>String(item.playerId)===String(id));if(!row)return;const player=state.players.get(String(id))||{};const market=state.market;const projection=row.projections[market];const logs=player.recent?.gameLog||[];
    const evidence=[`${fmt(row.expectedMinutes)} expected minutes compared with ${fmt(player.season?.minutes)} this season`,`${fmt(player.recent?.[seasonKey[market]])} recent ${markets[market].toLowerCase()} compared with ${fmt(player.season?.[seasonKey[market]])} this season`,`Opponent defense rank: ${row.context?.opponentDefenseRank??"unavailable"}`,player.injury?`${player.injury.status}${player.injury.detail?`: ${player.injury.detail}`:""}`:`No active injury report in the current player pool`];
    $("#wdcDialogBody").innerHTML=`<div class="wdc-detail-head">${player.headshot?`<img class="wdc-headshot" src="${esc(player.headshot)}" alt="${esc(row.player)}">`:`<div class="wdc-headshot"></div>`}<div><h2 id="wdcDialogTitle">${esc(row.player)}</h2><p>${esc(row.team)} vs ${esc(row.opponent)} · ${esc(player.position||row.role)} · ${esc(row.role)} role</p>${state.accountReady&&window.TSLAccount?.session?saveActions(row):`<div class="wdc-save-actions"><button type="button" data-sign-in>Sign in to save</button></div>`}</div></div><div class="wdc-detail-grid"><div class="wdc-detail-stat"><span>Signal score</span><strong>${signal(row,player,market)}</strong></div><div class="wdc-detail-stat"><span>${esc(markets[market])} projection</span><strong>${fmt(projection.value)}</strong></div><div class="wdc-detail-stat"><span>Floor–ceiling</span><strong>${fmt(projection.floor)}–${fmt(projection.ceiling)}</strong></div><div class="wdc-detail-stat"><span>Model confidence</span><strong>${fmt(row.confidence)}%</strong></div></div><section class="wdc-detail-section"><h3>Why this player</h3><div class="wdc-evidence">${evidence.map(item=>`<div>${esc(item)}</div>`).join("")}</div></section><section class="wdc-detail-section"><h3>Recent game log</h3><div class="wdc-log-wrap"><table class="wdc-log"><thead><tr><th>Date</th><th>Opponent</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th></tr></thead><tbody>${logs.slice(0,5).map(game=>`<tr><td>${esc(new Date(game.date).toLocaleDateString([], {month:"short",day:"numeric"}))}</td><td>${esc(game.opponent)}</td><td>${fmt(game.minutes)}</td><td>${fmt(game.points)}</td><td>${fmt(game.rebounds)}</td><td>${fmt(game.assists)}</td><td>${fmt(game.threes)}</td></tr>`).join("")||`<tr><td colspan="7">Recent game log unavailable.</td></tr>`}</tbody></table></div></section><div class="wdc-personal-message" id="wdcPersonalMessage">Saved players and followed teams appear in My WNBA Slate.</div><div class="wdc-disclaimer">Model signals are projection context, not verified market recommendations. Verified plays appear only after calibration and authorized market-data gates pass.</div>`;
    if(!$("#wdcDialog").open)$("#wdcDialog").showModal();
  }
  async function waitForAccount(){for(let attempt=0;attempt<60&&!window.TSLAccount;attempt++)await new Promise(resolve=>setTimeout(resolve,100));return window.TSLAccount||null}
  async function loadPersonalization(){
    const account=await waitForAccount();state.accountReady=true;
    try{await account?.ready;state.favorites=account?.session?await account.listFavorites():[]}catch(error){state.favorites=[];$("#wdcPersonalNote").textContent="Saved WNBA slate is temporarily unavailable."}
    const count=state.favorites.filter(item=>item.sport==="WNBA").length;$("#wdcPersonalNote").innerHTML=account?.session?`${count} saved WNBA favorite${count===1?"":"s"} · Open a player to save or follow.`:`<a href="./account.html">Sign in</a> to save WNBA players and teams.`;render();
  }
  async function toggleFavorite(type,id){
    const account=window.TSLAccount;if(!account?.session){window.location.href="./account.html";return}
    const existing=favoriteFor(type,id);const row=state.rows.find(item=>type==="player"?String(item.playerId)===String(id):item.team===id);
    try{if(existing)await account.removeFavorite(existing.id);else await account.addFavorite({sport:"WNBA",entityType:type,externalId:id,displayName:type==="player"?row?.player:id,teamName:type==="player"?row?.team:id});state.favorites=await account.listFavorites();const message=existing?`${type==="player"?"Player":"Team"} removed from My WNBA Slate.`:`${type==="player"?"Player saved":"Team followed"}.`;if(row)openPlayer(row.playerId);$("#wdcPersonalMessage").textContent=message;render();loadPersonalization()}catch(error){$("#wdcPersonalMessage").textContent=error.message||"Unable to update this favorite."}
  }
  async function load(){
    try{
      const files=["wnba_projection_board.json","wnba_player_baselines.json","wnba_games_today.json","wnba_verified_markets.json","wnba_change_feed.json"];
      const responses=await Promise.all(files.map(file=>fetch(`./data/${file}?v=${Date.now()}`,{cache:"no-store"})));
      if(responses.some(response=>!response.ok))throw new Error("One or more WNBA data files are unavailable.");
      const [board,players,games,verified,changeFeed]=await Promise.all(responses.map(response=>response.json()));
      state.rows=Array.isArray(board.projections)?board.projections:[];state.players=new Map((players.players||[]).map(player=>[String(player.playerId),player]));state.games=games.games||[];state.verified=verified;
      if(state.game&&!state.rows.some(row=>String(row.gameId)===state.game)){state.game="";const url=new URL(window.location.href);url.searchParams.delete("game");window.history.replaceState({},"",url)}
      $("#wdcPlayerCount").textContent=state.rows.length;$("#wdcGameCount").textContent=state.games.length;$("#wdcTopConfidence").textContent=state.rows.length?`${Math.max(...state.rows.map(row=>Number(row.confidence)||0))}%`:"—";$("#wdcUpdated").textContent=board.generatedAt?`Updated ${new Date(board.generatedAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}`:"Current slate";
      const teams=[...new Set(state.rows.map(row=>row.team))].sort();$("#wdcTeam").insertAdjacentHTML("beforeend",teams.map(team=>`<option value="${esc(team)}">${esc(team)}</option>`).join(""));
      const unlocked=!verified.locked&&(verified.recommendations||[]).length>0;$("#wdcGate").classList.toggle("unlocked",unlocked);$("#wdcGate").innerHTML=unlocked?`<strong>Verified markets available</strong><span>${verified.recommendations.length} recommendations passed calibration, freshness, and minimum-edge gates.</span>`:`<strong>Model-signal mode</strong><span>Authorized market lines are not currently available, so this board ranks projection evidence without presenting unverified betting edges.</span>`;
      renderChanges(changeFeed);
      render();
    }catch(error){$("#wdcStatus").textContent=error.message;$("#wdcBoard").innerHTML=`<div class="wdc-empty">WNBA Decision Center is temporarily unavailable. Existing site data remains unchanged.</div>`}
  }
  $("#wdcTabs").addEventListener("click",event=>{const button=event.target.closest("button[data-market]");if(!button)return;state.market=button.dataset.market;document.querySelectorAll("#wdcTabs button").forEach(item=>item.setAttribute("aria-selected",String(item===button)));render()});
  $("#wdcViews").addEventListener("click",event=>{const button=event.target.closest("button[data-view]");if(button)setView(button.dataset.view)});
  $("#wdcMatchups").addEventListener("click",event=>{const button=event.target.closest("[data-game]");if(button)setGame(button.dataset.game)});
  $("#wdcSearch").addEventListener("input",event=>{state.query=event.target.value.trim().toLowerCase();render()});$("#wdcTeam").addEventListener("change",event=>{state.team=event.target.value;render()});$("#wdcSort").addEventListener("change",event=>{state.sort=event.target.value;render()});$("#wdcBoard").addEventListener("click",event=>{const compare=event.target.closest("[data-compare-player]");if(compare){toggleComparison(compare.dataset.comparePlayer);return}const open=event.target.closest("[data-open-player]");if(open)openPlayer(open.dataset.openPlayer)});$("#wdcCompareDock").addEventListener("click",event=>{if(event.target.closest("[data-clear-compare]")){state.compared.clear();render()}else if(event.target.closest("[data-open-compare]"))openComparison()});$("#wdcClose").addEventListener("click",()=>$("#wdcDialog").close());$("#wdcDialog").addEventListener("click",event=>{if(event.target===$("#wdcDialog"))$("#wdcDialog").close()});$("#wdcCompareClose").addEventListener("click",()=>$("#wdcCompareDialog").close());$("#wdcCompareDialog").addEventListener("click",event=>{if(event.target===$("#wdcCompareDialog"))$("#wdcCompareDialog").close()});
  $("#wdcDialogBody").addEventListener("click",event=>{if(event.target.closest("[data-sign-in]")){window.location.href="./account.html";return}const button=event.target.closest("[data-save-type]");if(button)toggleFavorite(button.dataset.saveType,button.dataset.saveId)});window.addEventListener("tsl-account-changed",loadPersonalization);
  setView(state.view);
  load();
  loadPersonalization();
})();
