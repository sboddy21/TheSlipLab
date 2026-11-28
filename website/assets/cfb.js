import {fresh as quoteFresh} from './odds-core.mjs';
import { isFresh,mergeLiveGame,MAX_MODEL_AGE_MS } from './cfb-market.mjs';
import { valuePicks, moneylineProjection, implied, payout, estimate } from './cfb-edge.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = n => n === null || n === undefined ? '—' : n > 0 ? `+${n}` : `${n}`;
const fmt = n => Number.isFinite(n) ? n.toFixed(1) : '—';
const dateLabel = value => new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const conferences = {'1':'ACC','4':'Big 12','5':'Big Ten','8':'SEC','9':'Pac-12','12':'Conference USA','15':'MAC','17':'Mountain West','18':'FBS Independents','37':'Sun Belt','151':'American'};
const conferenceName = id => conferences[id] || (id ? `Conference ${id}` : 'Other');
let board, snapshot, liveAsOf=null, liveError=true, refreshing=false, market = 'spread', aiByGame=new Map(), aiState='loading';
const fresh = () => !liveError && isFresh(liveAsOf);
const upcoming = game => game.state === 'pre' && game.timeValid && Date.parse(game.date) > Date.now();
function leanLabel(pick,game) {
  return pick.market === 'spread' ? `${game?.[pick.side]?.short || pick.team} ${signed(pick.line)}` : `${pick.side === 'over' ? 'Over' : 'Under'} ${pick.line}`;
}
const pct=value=>Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'—';
const qualityLabel=p=>p.dataQuality==='full'?'Full team-history model':p.dataQuality==='limited'?'Limited-history model':'National-prior baseline';
function gameAiRead(game,p,m) {
  const generated=aiByGame.get(String(game.id));
  const projection=moneylineProjection(p,snapshot?.calibration);
  if(!projection)return '';
  const favorite=projection.homeProbability>=.5?'home':'away',team=game[favorite],probability=projection[`${favorite}Probability`],fair=projection[`${favorite}FairPrice`];
  const quote=m?.quoteDetails?.moneyline?.[favorite],price=quote?.price??m?.[`${favorite}ML`];
  const freshQuote=quote&&quoteFresh(quote.quotedAt),marketProbability=freshQuote?implied(price):null,profit=freshQuote?payout(price):null;
  const expectedReturn=profit===null?null:probability*profit-(1-probability),gap=marketProbability===null?null:probability-marketProbability;
  const confidence=probability>=.72?'High':probability>=.62?'Medium':'Lean';
  const spreadSide=p.margin>=0?'home':'away',fairSpread=-Math.abs(p.margin),projectedTotal=p.total;
  const spreadEstimate=m?.homeSpread==null?null:estimate(p,m,snapshot?.calibration,'spread');
  const spreadPick=spreadEstimate===null?spreadSide:(spreadEstimate>=.5?'home':'away');
  const spreadProbability=spreadEstimate===null?null:Math.max(spreadEstimate,1-spreadEstimate);
  const totalEstimate=m?.total==null?null:estimate(p,m,snapshot?.calibration,'total');
  const totalSide=totalEstimate===null?null:(totalEstimate>=.5?'over':'under');
  const totalProbability=totalEstimate===null?null:Math.max(totalEstimate,1-totalEstimate);
  let says=generated?.overview||`The model favors ${team.name} by ${Math.abs(p.margin).toFixed(1)} points with a ${pct(probability)} win projection and projects ${projectedTotal.toFixed(1)} total points.`;
  if(!generated){if(expectedReturn!==null&&expectedReturn>=.05)says+=` The current ${signed(price)} price shows ${(expectedReturn*100).toFixed(1)}% estimated return before uncertainty.`;else if(freshQuote)says+=' The current price does not clear the model’s 5% value threshold.';else says+=' A fresh sportsbook price is needed before evaluating value.';}
  const source=generated?`OpenAI-generated · ${esc(generated.headline)}`:aiState==='loading'?'OpenAI analysis loading…':'Statistical model view · OpenAI temporarily unavailable';
  return `<div class="ai-read"><div class="ai-read-head"><span>AI says</span><b>${confidence} confidence · ${esc(qualityLabel(p))}</b></div><small class="ai-source-label">${source}</small><p>${esc(says)}</p><div class="ml-grid ai-category-grid"><div><small>Moneyline</small><strong>${esc(team.short)} ${pct(probability)}</strong><em>${esc(generated?.moneyline||`Fair price ${signed(fair)}${freshQuote?` · ${quote.book} ${signed(price)}`:' · market unavailable'}`)}</em></div><div><small>Spread</small><strong>${esc(game[spreadPick].short)} ${m?.homeSpread==null?signed(fairSpread):signed(spreadPick==='home'?m.homeSpread:-m.homeSpread)}</strong><em>${esc(generated?.spread||(spreadProbability===null?`Model fair spread · ${game[spreadSide].short} ${signed(fairSpread)}`:`${pct(spreadProbability)} cover projection`))}</em></div><div><small>Over / Under</small><strong>${totalSide?`${totalSide==='over'?'Over':'Under'} ${m.total}`:`Model total ${projectedTotal.toFixed(1)}`}</strong><em>${esc(generated?.total||(totalProbability===null?'Sportsbook total unavailable':`${pct(totalProbability)} projection`))}</em></div></div>${generated?.risks?.length?`<p class="ai-risk"><strong>AI risk check:</strong> ${esc(generated.risks.join(' · '))}</p>`:''}${freshQuote?`<small class="price-source">Moneyline: ${esc(quote.book)} · verified ${esc(dateLabel(quote.quotedAt))} ET</small>`:'<small class="price-source">Model numbers shown for every category; sportsbook comparisons require a verified current line.</small>'}</div>`;
}

async function accountToken(){for(let i=0;i<60&&!window.TSLAccount;i++)await new Promise(r=>setTimeout(r,100));if(!window.TSLAccount)throw Error('Account session unavailable');await window.TSLAccount.ready;const token=await window.TSLAccount.accessToken();if(!token)throw Error('Sign in to use NCAAF AI Says');return token}
async function loadGenuineAi(){
  const games=(snapshot?.games||[]).filter(upcoming).filter(g=>g.projection);if(!games.length)return;
  aiState='loading';renderGames();
  try{const token=await accountToken(),version=snapshot.generatedAt||'current';for(let i=0;i<games.length;i+=8){const rows=games.slice(i,i+8),key=`tsl_cfb_ai_v1_${version}_${i}`;let result=JSON.parse(localStorage.getItem(key)||'null');if(!result?.games?.length){const payload=rows.map(g=>{const ml=moneylineProjection(g.projection,snapshot.calibration);return {gameId:g.id,kickoff:g.date,away:g.away.name,home:g.home.name,venue:g.venue,neutral:g.neutral,dataQuality:g.projection.dataQuality,projection:{awayScore:g.projection.awayScore,homeScore:g.projection.homeScore,homeMargin:g.projection.margin,total:g.projection.total,awayWinProbability:ml?.awayProbability,homeWinProbability:ml?.homeProbability,awayOffense:g.projection.away.offense,awayDefense:g.projection.away.defense,homeOffense:g.projection.home.offense,homeDefense:g.projection.home.defense},market:g.market?{homeSpread:g.market.homeSpread,total:g.market.total,homeMoneyline:g.market.homeML,awayMoneyline:g.market.awayML,provider:g.market.provider}:null}});const response=await fetch('/api/cfb-ai-analysis',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({games:payload})});result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'NCAAF AI analysis unavailable');localStorage.setItem(key,JSON.stringify(result))}for(const row of result.games)aiByGame.set(String(row.gameId),row);renderGames()}
    aiState='ready';renderGames();
  }catch(error){console.error('NCAAF OpenAI:',error);aiState='error';renderGames()}
}
function currentQuote(game,marketName,side) {
  const quote=game.market?.quoteDetails?.[marketName]?.[side];
  return quote&&quoteFresh(quote.quotedAt)?quote:null;
}
function rankedMarketReads(kind) {
  if(!board)return [];
  const reads=[];
  for(const game of board.games.filter(upcoming)) {
    const p=game.projection,m=game.market;if(!p)continue;
    if(kind==='moneyline') {
      const ml=moneylineProjection(p,snapshot?.calibration);if(!ml)continue;
      const side=ml.homeProbability>=ml.awayProbability?'home':'away',probability=ml[`${side}Probability`],quote=currentQuote(game,'moneyline',side);
      reads.push({game,probability,edge:probability-.5,label:game[side].short,detail:`Win projection ${pct(probability)} · fair ${signed(ml[`${side}FairPrice`])}`,quote});
    } else {
      const hasLine=kind==='spread'?Number.isFinite(m?.homeSpread):Number.isFinite(m?.total);
      const base=hasLine?estimate(p,m,snapshot?.calibration,kind):null;
      if(kind==='spread') {
        const fairSide=p.margin>=0?'home':'away',side=base===null?fairSide:(base>=.5?'home':'away');
        const probability=base===null?moneylineProjection(p,snapshot?.calibration)?.[`${fairSide}Probability`]:Math.max(base,1-base);
        const line=hasLine?(side==='home'?m.homeSpread:-m.homeSpread):-Math.abs(p.margin);
        const quote=hasLine?currentQuote(game,'spread',side):null;
        reads.push({game,probability,edge:hasLine?Math.abs(p.margin+m.homeSpread):Math.abs(p.margin),label:`${game[side].short} ${signed(Number(line.toFixed(1)))}`,detail:hasLine?`${pct(probability)} cover projection · model margin ${signed(Number(p.margin.toFixed(1)))}`:`Model fair spread · projected margin ${signed(Number(p.margin.toFixed(1)))} · ${qualityLabel(p)}`,quote});
      } else {
        const side=base===null?null:(base>=.5?'over':'under'),probability=base===null?null:Math.max(base,1-base),quote=side?currentQuote(game,'total',side):null;
        reads.push({game,probability,edge:hasLine?Math.abs(p.total-m.total):Math.abs(p.total-55),label:side?`${side==='over'?'Over':'Under'} ${m.total}`:`Model total ${p.total.toFixed(1)}`,detail:hasLine?`${pct(probability)} projection · model total ${p.total.toFixed(1)}`:`Projected score ${game.away.short} ${p.awayScore.toFixed(1)}, ${game.home.short} ${p.homeScore.toFixed(1)} · ${qualityLabel(p)}`,quote});
      }
    }
  }
  return reads.sort((a,b)=>b.edge-a.edge).slice(0,5);
}
function aiMarketColumn(kind,title) {
  const rows=rankedMarketReads(kind);
  return `<section class="ai-market"><div class="ai-market-title"><span>${esc(title)}</span><small>Top model reads</small></div>${rows.length?rows.map((r,index)=>`<article class="ai-pick"><b>${index+1}</b><div><small>${esc(r.game.away.short)} @ ${esc(r.game.home.short)} · ${esc(dateLabel(r.game.date))} ET</small><h3>${esc(r.label)}</h3><p>${esc(r.detail)}</p>${r.quote?`<span class="ai-price">${esc(r.quote.book)} ${signed(r.quote.price)} · verified ${esc(dateLabel(r.quote.quotedAt))} ET</span>`:'<span class="ai-price waiting">Fresh sportsbook price unavailable</span>'}</div><a href="#game-${esc(r.game.id)}" data-show-game aria-label="Open ${esc(r.game.away.short)} at ${esc(r.game.home.short)} matchup">↗</a></article>`).join(''):'<p class="ai-market-empty">No eligible projections in this market.</p>'}</section>`;
}
function card(game) {
  const m = game.state==='pre'&&(!upcoming(game)||(game.market?.source==='RapidAPI'&&!Object.values(game.market.quoteDetails||{}).flatMap(Object.values).some(q=>quoteFresh(q.quotedAt))))?null:game.market, p = game.projection;
  const details=m?.quoteDetails?.[market];
  const teamRow = side => {
    const t = game[side];
    let value = '—';
    if (market === 'spread') value = m?.homeSpread == null ? '—' : signed(side === 'home' ? m.homeSpread : -m.homeSpread);
    if (market === 'moneyline') value = signed(m?.[`${side}ML`]);
    if (market === 'total') value = m?.total == null ? '—' : `${side === 'away' ? 'O' : 'U'} ${m.total}`;
    const quote=details?.[market==='total'?(side==='away'?'over':'under'):side];
    if(quote&&market!=='moneyline')value+=` (${signed(quote.price)})`;
    return `<div class="team"><div><strong>${t.rank ? `#${t.rank} ` : ''}${esc(t.name)}</strong><small>${side === 'home' ? (game.neutral ? 'Neutral site' : 'Home') : 'Away'} · ${esc(t.record)}${game.state !== 'pre' && t.score !== null ? ` · Score: ${t.score}` : ''}</small></div><span class="line">${esc(value)}${quote?`<small>${esc(quote.book)}</small>`:''}</span></div>`;
  };
  const status = game.canceled ? 'CANCELED' : game.statusName && !['STATUS_SCHEDULED','STATUS_FINAL','STATUS_IN_PROGRESS','STATUS_HALFTIME','STATUS_END_PERIOD'].includes(game.statusName) ? esc(game.status) : game.completed ? 'FINAL' : game.state === 'in' ? 'IN PROGRESS' : !game.timeValid ? 'TIME TBD' : !upcoming(game) ? 'AWAITING UPDATE' : 'PREGAME';
  const times=Object.values(details||{}).map(q=>q.quotedAt).sort();
  const note = m ? m.source==='RapidAPI' ? `Sportsbook API · ${times.length?'Observed '+esc(dateLabel(times[0]))+' ET':'This market is unavailable'}` : `${esc(m.provider)} · Archived ESPN line` : 'No fresh sportsbook line available';
  return `<article class="game-card" id="game-${esc(game.id)}"><div class="game-meta"><span>${esc(game.timeValid ? dateLabel(game.date)+' ET' : dayKey(game.date)+' · Time TBD')}<br>${esc(game.broadcast)}</span><span>${status}</span></div>${teamRow('away')}${teamRow('home')}<div class="market-note">${note}</div>${p&&upcoming(game)?gameAiRead(game,p,m):''}${m&&game.sportsbookQuotes?.some(q=>quoteFresh(q.quotedAt))?`<details><summary>Compare sportsbook prices</summary><div class="odds-comparison">${game.sportsbookQuotes.filter(q=>q.market===market&&quoteFresh(q.quotedAt)).map(q=>`<p>${esc(q.book)} · ${esc(q.side==='home'?game.home.short:q.side==='away'?game.away.short:q.side)} ${q.line==null?'':esc(signed(q.line))} · <strong>${esc(signed(q.price))}</strong></p>`).join('')||'<p>This market is unavailable.</p>'}</div></details>`:''}<div class="projection"><span>Projected score</span><strong>${p ? `${esc(game.away.short)} ${fmt(p.awayScore)}<br>${esc(game.home.short)} ${fmt(p.homeScore)}` : game.state === 'post' ? 'Final result above' : 'Current projection unavailable'}</strong></div><details><summary>Inside the matchup</summary><p>${esc(game.venue)}${game.neutral ? ' · Neutral site' : ''}${game.weather ? `<br>${esc(game.weather)}` : ''}</p>${p ? `<div class="context-grid">${['away','home'].map(side=>`<div><strong>${esc(game[side].short)}</strong><br>${signed(Number(p[side].offense.toFixed(1)))} offense vs average<br>${signed(Number(p[side].defense.toFixed(1)))} defense (higher is better)<br>${signed(Number(p[side].rating.toFixed(1)))} net rating</div>`).join('')}</div><p>Projected total: ${fmt(p.total)} · Home margin: ${signed(Number(p.margin.toFixed(1)))}</p>` : '<p>A projection is not available for this matchup yet.</p>'}<a href="https://www.espn.com/college-football/game/_/gameId/${encodeURIComponent(game.id)}" target="_blank" rel="noopener noreferrer">View game on ESPN ↗</a></details></article>`;
}
function renderGames() {
  if (!board) return;
  const expanded=new Set([...document.querySelectorAll('.game-card details[open]')].map(d=>d.closest('.game-card').id));
  const search = $('search').value.trim().toLowerCase(), conference = $('conference').value, day = $('day').value, status = $('status').value;
  const games = board.games.filter(g => (!search || `${g.home.name} ${g.home.short} ${g.away.name} ${g.away.short}`.toLowerCase().includes(search)) &&
    (conference === 'all' || (conference === 'other' ? !conferences[g.home.conference] || !conferences[g.away.conference] : g.home.conference === conference || g.away.conference === conference)) &&
    (day === 'all' || dayKey(g.date) === day) &&
    (status === 'all' || (status === 'ranked' ? g.home.rank || g.away.rank : status === 'post' ? g.completed : g.state === status)))
    .sort((a,b)=>Date.parse(a.date)-Date.parse(b.date));
  $('game-count').textContent = `${games.length} of ${board.games.length} games · All times ET`;
  $('games').innerHTML = games.length ? games.map(card).join('') : '<p class="empty">No games match these filters. Try another team, conference, or day.</p>';
  for(const id of expanded)document.getElementById(id)?.querySelector('details')?.setAttribute('open','');
}
function renderSummary() {
  if(!board)return;
  const active=fresh()?board.games.filter(upcoming).flatMap(game=>(game.leans||[]).map(pick=>({game,pick}))).sort((a,b)=>b.pick.expectedReturn-a.pick.expectedReturn):[];
  const modelReady=board.games.some(g=>g.projection&&isFresh(g.projection.trainingCutoff,Date.now(),MAX_MODEL_AGE_MS));
  $('health').classList.toggle('warning',!fresh()||!modelReady);
  $('health').textContent=fresh()?`ESPN scores · RapidAPI odds · Checked ${dateLabel(liveAsOf)} ET${modelReady?"":" · Projections unavailable"}`:`Live updates unavailable. Leans paused. Last update: ${liveAsOf?dateLabel(liveAsOf)+' ET':'not yet available'}.`;
  const rankedReadCount=modelReady&&fresh()?['moneyline','spread','total'].reduce((sum,kind)=>sum+rankedMarketReads(kind).length,0):0;
  $('metrics').innerHTML=[[board.games.length,'Games this week'],[board.games.filter(g=>g.home.rank||g.away.rank).length,'Games with ranked teams'],[board.games.filter(g=>g.market).length,'Games with odds'],[rankedReadCount,'Ranked AI reads']].map(([n,label])=>`<div class="metric"><strong>${n}</strong><span>${label}</span></div>`).join('');
  $('lean-list').innerHTML=modelReady&&fresh()?[aiMarketColumn('moneyline','Best Moneylines'),aiMarketColumn('spread','Best Spreads'),aiMarketColumn('total','Best Over / Unders')].join(''):`<p class="empty">${fresh()?'Model projections are unavailable for this slate.':'AI rankings will return when live updates resume.'}</p>`;
  const archive=(board.archive||[]).filter(p=>p.model===board.model),settled=archive.filter(p=>p.model===board.model&&['win','loss','push'].includes(p.result));
  const count=result=>settled.filter(p=>p.result===result).length;
  $('record').textContent=settled.length?`${count('win')}–${count('loss')}–${count('push')} · ${signed(Number(settled.reduce((s,p)=>s+(p.units||0),0).toFixed(2)))}u`:'Awaiting results';
  $('ledger').innerHTML=archive.length?[...archive].sort((a,b)=>Date.parse(b.recordedAt)-Date.parse(a.recordedAt)).map(p=>`<tr><td>${esc(p.matchup)}</td><td>${esc(leanLabel(p))}</td><td>${signed(p.price)}<br><small>${esc(p.book || p.provider)}</small></td><td>${esc(dateLabel(p.recordedAt))}</td><td>${esc(p.result)}</td><td>${p.units===null?'—':signed(Number(p.units.toFixed(2)))}</td></tr>`).join(''):'<tr><td colspan="6">No recorded pregame calls yet.</td></tr>';
}
async function refreshLive() {
  if(refreshing)return;refreshing=true;$('refresh-now').disabled=true;$('refresh-now').textContent='Updating…';
  try {
    const response=await fetch('./api/cfb-live',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw new Error('Live feed failed');
    const live=await response.json();
    if(live.schemaVersion!==1||!Array.isArray(live.games)||!isFresh(live.retrievedAt))throw new Error('Stale or invalid live feed');
    liveAsOf=live.retrievedAt;liveError=false;
    if(snapshot){board={...snapshot,weekStart:live.weekStart,weekEnd:live.weekEnd,games:live.games.map(game=>{
      const merged=mergeLiveGame(game,snapshot.games.find(g=>g.id===game.id),liveAsOf);
      merged.leans=merged.projection?valuePicks(merged,merged.projection,snapshot.calibration):[];return merged;
    })};$('edition-date').textContent=`${board.weekStart} — ${board.weekEnd}`;}
  } catch {liveError=true;}
  finally {refreshing=false;$('refresh-now').disabled=false;$('refresh-now').textContent='Refresh now ↻';if(board){renderGames();renderSummary();}}
}
async function load() {
  try {
    const response = await fetch('./data/cfb_board.json',{cache:'no-store'});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schemaVersion !== 1 || !Array.isArray(data.games) || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error('Invalid board');
    snapshot = data; board = data; liveError = true;
    $('edition-date').textContent = `${board.weekStart} — ${board.weekEnd}`;
    const addOptions = (id, rows) => { const element = $(id), value = element.value; element.length = 1; rows.forEach(([key,label])=>element.add(new Option(label,key))); element.value = [...element.options].some(o=>o.value===value) ? value : 'all'; };
    addOptions('conference',[...new Set(board.games.flatMap(g=>[g.home.conference,g.away.conference]))].filter(id=>conferences[id]).map(id=>[id,conferenceName(id)]).concat([['other','Other / FCS conferences']]).sort((a,b)=>a[1].localeCompare(b[1])));
    addOptions('day',[...new Set(board.games.map(g=>dayKey(g.date)))].sort().map(day=>[day,new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'})]));
    renderGames(); renderSummary();
  } catch (error) {
    $('health').classList.add('warning');
    $('health').textContent = 'The college football snapshot could not be loaded. Please reload to try again.';
    $('games').innerHTML = '<p class="empty">The weekly board is temporarily unavailable.</p>';
    $('lean-list').innerHTML = '<p class="empty">Current leans are unavailable.</p>';
    $('ledger').innerHTML = '<tr><td colspan="6">Results could not be loaded.</td></tr>';
    console.error('College football board:',error);
  }
}
$('filters').addEventListener('submit',event=>event.preventDefault());
$('filters').addEventListener('input',renderGames);
$('filters').addEventListener('change',renderGames);
$('filters').addEventListener('reset',()=>setTimeout(renderGames,0));
document.querySelectorAll('[data-market]').forEach(button=>button.addEventListener('click',()=>{
  market = button.dataset.market;
  document.querySelectorAll('[data-market]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
  renderGames();
}));
$('lean-list').addEventListener('click',event=>{if(event.target.closest('[data-show-game]')) { $('filters').reset(); renderGames(); }});
$('refresh-now').addEventListener('click',()=>refreshLive());
await load();
await loadGenuineAi();
await refreshLive();
setInterval(()=>{if(!document.hidden)refreshLive();},60000);
setInterval(async()=>{if(!document.hidden){await load();await refreshLive();}},300000);
setInterval(()=>{if(board){if(!fresh())renderGames();renderSummary();}},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive();});
