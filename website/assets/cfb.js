import {fresh as quoteFresh} from './odds-core.mjs';
import { isFresh,mergeLiveGame,MAX_MODEL_AGE_MS } from './cfb-market.mjs';
import { valuePicks, moneylineProjection, implied, payout } from './cfb-edge.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = n => n === null || n === undefined ? '—' : n > 0 ? `+${n}` : `${n}`;
const fmt = n => Number.isFinite(n) ? n.toFixed(1) : '—';
const dateLabel = value => new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const conferences = {'1':'ACC','4':'Big 12','5':'Big Ten','8':'SEC','9':'Pac-12','12':'Conference USA','15':'MAC','17':'Mountain West','18':'FBS Independents','37':'Sun Belt','151':'American'};
const conferenceName = id => conferences[id] || (id ? `Conference ${id}` : 'Other');
let board, snapshot, liveAsOf=null, liveError=true, refreshing=false, market = 'spread';
const fresh = () => !liveError && isFresh(liveAsOf);
const upcoming = game => game.state === 'pre' && game.timeValid && Date.parse(game.date) > Date.now();
function leanLabel(pick,game) {
  return pick.market === 'spread' ? `${game?.[pick.side]?.short || pick.team} ${signed(pick.line)}` : `${pick.side === 'over' ? 'Over' : 'Under'} ${pick.line}`;
}
const pct=value=>Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'—';
function moneylineRead(game,p,m) {
  const projection=moneylineProjection(p,snapshot?.calibration);
  if(!projection)return '';
  const favorite=projection.homeProbability>=.5?'home':'away',team=game[favorite],probability=projection[`${favorite}Probability`],fair=projection[`${favorite}FairPrice`];
  const quote=m?.quoteDetails?.moneyline?.[favorite],price=quote?.price??m?.[`${favorite}ML`];
  const freshQuote=quote&&quoteFresh(quote.quotedAt),marketProbability=freshQuote?implied(price):null,profit=freshQuote?payout(price):null;
  const expectedReturn=profit===null?null:probability*profit-(1-probability),gap=marketProbability===null?null:probability-marketProbability;
  const confidence=probability>=.72?'High':probability>=.62?'Medium':'Lean';
  let says=`The model favors ${team.name} by ${Math.abs(p.margin).toFixed(1)} points with a ${pct(probability)} win projection.`;
  if(expectedReturn!==null&&expectedReturn>=.05)says+=` The current ${signed(price)} price shows ${(expectedReturn*100).toFixed(1)}% estimated return before uncertainty.`;
  else if(freshQuote)says+=' The current price does not clear the model’s 5% value threshold.';
  else says+=' A fresh sportsbook price is needed before evaluating value.';
  return `<div class="ai-read"><div class="ai-read-head"><span>AI says</span><b>${confidence} model confidence</b></div><p>${esc(says)}</p><div class="ml-grid"><div><small>Win projection</small><strong>${esc(team.short)} ${pct(probability)}</strong></div><div><small>Model fair line</small><strong>${signed(fair)}</strong></div><div><small>Sportsbook line</small><strong>${freshQuote?signed(price):'—'}</strong></div><div><small>Model vs market</small><strong>${gap===null?'—':signed((gap*100).toFixed(1))+' pts'}</strong></div></div>${freshQuote?`<small class="price-source">${esc(quote.book)} · quoted ${esc(dateLabel(quote.quotedAt))} ET</small>`:''}</div>`;
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
  return `<article class="game-card" id="game-${esc(game.id)}"><div class="game-meta"><span>${esc(game.timeValid ? dateLabel(game.date)+' ET' : dayKey(game.date)+' · Time TBD')}<br>${esc(game.broadcast)}</span><span>${status}</span></div>${teamRow('away')}${teamRow('home')}<div class="market-note">${note}</div>${p&&upcoming(game)?moneylineRead(game,p,m):''}${m&&game.sportsbookQuotes?.some(q=>quoteFresh(q.quotedAt))?`<details><summary>Compare sportsbook prices</summary><div class="odds-comparison">${game.sportsbookQuotes.filter(q=>q.market===market&&quoteFresh(q.quotedAt)).map(q=>`<p>${esc(q.book)} · ${esc(q.side==='home'?game.home.short:q.side==='away'?game.away.short:q.side)} ${q.line==null?'':esc(signed(q.line))} · <strong>${esc(signed(q.price))}</strong></p>`).join('')||'<p>This market is unavailable.</p>'}</div></details>`:''}<div class="projection"><span>Projected score</span><strong>${p ? `${esc(game.away.short)} ${fmt(p.awayScore)}<br>${esc(game.home.short)} ${fmt(p.homeScore)}` : game.state === 'post' ? 'Final result above' : 'Current projection unavailable'}</strong></div><details><summary>Inside the matchup</summary><p>${esc(game.venue)}${game.neutral ? ' · Neutral site' : ''}${game.weather ? `<br>${esc(game.weather)}` : ''}</p>${p ? `<div class="context-grid">${['away','home'].map(side=>`<div><strong>${esc(game[side].short)}</strong><br>${signed(Number(p[side].offense.toFixed(1)))} offense vs average<br>${signed(Number(p[side].defense.toFixed(1)))} defense (higher is better)<br>${signed(Number(p[side].rating.toFixed(1)))} net rating</div>`).join('')}</div><p>Projected total: ${fmt(p.total)} · Home margin: ${signed(Number(p.margin.toFixed(1)))}</p>` : '<p>A projection is not available for this matchup yet.</p>'}<a href="https://www.espn.com/college-football/game/_/gameId/${encodeURIComponent(game.id)}" target="_blank" rel="noopener noreferrer">View game on ESPN ↗</a></details></article>`;
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
  $('metrics').innerHTML=[[board.games.length,'Games this week'],[board.games.filter(g=>g.home.rank||g.away.rank).length,'Games with ranked teams'],[board.games.filter(g=>g.market).length,'Games with odds'],[active.length,'Model leans']].map(([n,label])=>`<div class="metric"><strong>${n}</strong><span>${label}</span></div>`).join('');
  $('lean-list').innerHTML=active.length?active.slice(0,6).map(({game,pick})=>`<article class="lean"><small>${esc(game.away.short)} @ ${esc(game.home.short)} · ${esc(dateLabel(game.date))} ET</small><h3>${esc(leanLabel(pick,game))}</h3><span class="difference">${(100*pick.probability).toFixed(1)}% model estimate</span><p>${esc(pick.book || game.market.provider)} · ${signed(pick.price)}${pick.quotedAt?` · ${esc(dateLabel(pick.quotedAt))} ET`:''}</p><a href="#game-${esc(game.id)}" data-show-game>Read the matchup ↗</a></article>`).join(''):`<p class="empty">${fresh()?'No model leans available right now.':'Leans will return when live updates resume.'}</p>`;
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
await refreshLive();
setInterval(()=>{if(!document.hidden)refreshLive();},60000);
setInterval(async()=>{if(!document.hidden){await load();await refreshLive();}},300000);
setInterval(()=>{if(board){if(!fresh())renderGames();renderSummary();}},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive();});
