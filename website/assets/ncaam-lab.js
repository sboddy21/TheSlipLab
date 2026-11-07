import { fresh, bestComparable, decimal } from './odds-core.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = n => n > 0 ? `+${n}` : String(n);
const dateKey = date => new Intl.DateTimeFormat('en-CA', {timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
const time = date => new Date(date).toLocaleString('en-US', {timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});
let board = null, loading = false, failed = false;
const currentQuotes = game => !failed && game.state === 'pre' && Date.parse(game.kickoff) > Date.now() ? (game.quotes || []).filter(q => fresh(q.quotedAt) && decimal(q.price) && q.decimalOdds > 1) : [];
const selection = q => `${q.market === 'moneyline' ? 'Moneyline' : q.market === 'spread' ? 'Spread' : 'Total'} · ${q.side === 'home' ? q.home : q.side === 'away' ? q.away : q.side}${q.line == null ? '' : ` ${q.market === 'total' ? q.line : signed(q.line)}`}`;
function prices(quotes) {
  const best = new Set(bestComparable(quotes).map(q => q.quoteId));
  return `<div class="table-wrap"><table class="price-table"><thead><tr><th>Selection</th><th>Book</th><th>Price</th><th>Break-even</th><th>Observed</th></tr></thead><tbody>${quotes.map(q => `<tr><td>${esc(selection(q))}</td><td>${esc(q.book)}</td><td>${esc(signed(q.price))}${best.has(q.quoteId)?' ★':''}</td><td>${(100/q.decimalOdds).toFixed(1)}%</td><td>${esc(time(q.quotedAt))}</td></tr>`).join('')}</tbody></table></div><p class="muted">★ Best listed price for this selection and line. Break-even is implied by the price.</p>`;
}
function teamRow(team, showScore) { return `<div class="team-row">${team.rank?`<span class="rank">#${team.rank}</span>`:''}<strong>${esc(team.name)}</strong><span class="record">${esc(team.record)}</span>${showScore?`<b>${esc(team.score ?? '—')}</b>`:''}</div>`; }
function stats(team) { const s = team.stats || {}; return `<div><strong>${esc(team.shortName || team.abbreviation)}</strong>${s.avgPoints == null?'Scoring average unavailable':`${esc(s.avgPoints)} PPG`}${s.fieldGoalPct == null?'':` · ${esc(s.fieldGoalPct)}% FG`}</div>`; }
function gameCard(g) {
  const quotes = currentQuotes(g), pastTip = g.state === 'pre' && Date.parse(g.kickoff) <= Date.now();
  return `<article class="game-card" id="game-${esc(g.id)}"><div class="game-meta"><span class="${g.state==='in'?'live-tag':''}">${esc(pastTip?'Awaiting status update':g.state==='pre'?time(g.kickoff):g.status)}</span><span>${g.neutral?'NEUTRAL COURT':g.conferenceGame?'CONFERENCE':'NON-CONFERENCE'}</span></div>${teamRow(g.away,g.state==='in'||g.completed)}${teamRow(g.home,g.state==='in'||g.completed)}<div class="stats-row">${stats(g.away)}${stats(g.home)}</div><div class="market-note">${esc(g.venue)}${g.broadcast?` · ${esc(g.broadcast)}`:''}${g.neutral?' · No home-court designation':''}</div>${quotes.length?`<details><summary>Compare game lines · ${quotes.length} prices</summary>${prices(quotes)}</details>`:`<p class="muted">${g.state==='pre'?'No fresh pregame prices available.':'Pregame markets closed.'}</p>`}</article>`;
}
function renderGames() {
  if (!board) return;
  const search = $('teamSearch').value.trim().toLowerCase(), state = $('statusFilter').value;
  const games = board.games.filter(g => (state==='all'||g.state===state) && `${g.home.name} ${g.away.name} ${g.venue}`.toLowerCase().includes(search));
  $('gamesRoot').innerHTML = games.length ? games.map(gameCard).join('') : '<p class="empty">No games match these filters.</p>';
}
function render() {
  if (!board) return;
  const games=board.games, stale = Date.now()-Date.parse(board.generatedAt)>20*60_000 || dateKey(new Date())!==board.date;
  $('feedStatus').textContent = `${board.date} · ${games.length} games · Last successful update ${time(board.generatedAt)}${failed?' · Refresh failed; prices hidden.':stale?' · Feed is delayed; check status before using.':''}`;
  const counts = [['Games on slate',games.length],['Live now',stale||failed?'—':games.filter(g=>g.state==='in').length],['Pregame prices',games.reduce((n,g)=>n+currentQuotes(g).length,0)],['Final scores',games.filter(g=>g.completed).length]];
  $('summary').innerHTML = counts.map(([label,value])=>`<div class="stat"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const watch=games.filter(g=>g.state==='pre'&&Date.parse(g.kickoff)>Date.now()&&(g.home.rank||g.away.rank)).sort((a,b)=>Math.min(a.home.rank||99,a.away.rank||99)-Math.min(b.home.rank||99,b.away.rank||99)).slice(0,6);
  $('watchlistRoot').innerHTML=watch.length?watch.map(g=>`<article class="game-card watch-card"><p>${esc(time(g.kickoff))}</p><h3>${g.away.rank?`#${g.away.rank} `:''}${esc(g.away.shortName)} at ${g.home.rank?`#${g.home.rank} `:''}${esc(g.home.shortName)}</h3><p>${g.neutral?'Neutral court':esc(g.venue)}</p><a href="#game-${esc(g.id)}">View matchup →</a></article>`).join(''):'<p class="empty">No upcoming ranked matchups on this slate. Explore the full Game Lab below.</p>';
  renderGames(); renderPicks(); renderAiChoices();
}
function upcomingForecasts() {
  const now = Date.now();
  if (failed || board?.model?.status !== 'validated_winner_forecasts'
    || now - Date.parse(board.generatedAt) >= 20 * 60_000 || dateKey(now) !== board.date) return [];
  return board.games.filter(game => game.state === 'pre' && Date.parse(game.kickoff) > now && game.prediction?.eligible)
    .sort((a, b) => b.prediction.probability - a.prediction.probability);
}

let aiContextKey = '', aiPending = false;

function renderAiChoices() {
  const games = upcomingForecasts();
  const select = $('aiGame');
  const ids = games.map(game => String(game.id));
  if (select.dataset.ids !== ids.join(',')) {
    const selected = select.value;
    select.innerHTML = games.length ? games.map(game =>
      `<option value="${esc(game.id)}">${esc(game.away.name)} at ${esc(game.home.name)}</option>`
    ).join('') : '<option value="">No qualifying pregame forecasts</option>';
    if (ids.includes(selected)) select.value = selected;
    select.dataset.ids = ids.join(',');
  }
  select.disabled = games.length === 0;
  const game = games.find(row => String(row.id) === select.value);
  const pick = game?.prediction;
  const contextKey = game ? JSON.stringify([game.id, game.kickoff, pick]) : '';
  if (contextKey !== aiContextKey) {
    aiContextKey = contextKey;
    $('aiRead').replaceChildren();
    $('aiStatus').textContent = '';
  }
  $('aiGenerate').disabled = !game || aiPending;
  if (!game) {
    $('aiMarket').textContent = 'AI reads open when today’s pregame winner forecasts are available.';
    return;
  }
  const quote = currentQuotes(game).filter(row => row.market === 'moneyline' && row.side === pick.side)
    .sort((a, b) => decimal(b.price) - decimal(a.price))[0];
  const probability = (100 * pick.probability).toFixed(1);
  const market = quote ? `${signed(quote.price)} at ${quote.book} · ${(100 / decimal(quote.price)).toFixed(1)}% break-even · Observed ${time(quote.quotedAt)}`
    : 'No current moneyline for this selection.';
  $('aiMarket').textContent = `Model pick: ${game[pick.side].name} · ${probability}% win estimate. ${market}`;
}

$('aiGame').addEventListener('change', renderAiChoices);
$('aiForm').addEventListener('submit', async event => {
  event.preventDefault();
  const gameId = $('aiGame').value;
  const game = upcomingForecasts().find(row => String(row.id) === gameId);
  if (aiPending || !game) return;
  const contextKey = aiContextKey;
  aiPending = true;
  $('aiGenerate').disabled = true;
  $('aiRead').replaceChildren();
  $('aiStatus').textContent = 'Writing the matchup read…';
  try {
    await window.TSLAccount?.ready;
    const token = await window.TSLAccount?.accessToken();
    if (!token) throw new Error('Sign in to use AI Says.');
    const response = await fetch('./api/ncaam-ai-analysis', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId }),
      signal: AbortSignal.timeout(45_000)
    });
    const analysis = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(analysis.error || 'The AI read is temporarily unavailable.');
    if (contextKey !== aiContextKey || Date.parse(game.kickoff) <= Date.now()) return;
    if (analysis.probability !== game.prediction.probability || analysis.selection !== game[game.prediction.side].name) {
      throw new Error('The forecast has changed. Refresh the slate to see the latest read.');
    }
    for (const [label, copy] of [['Why the model favors this team', analysis.rationale], ['What could change the outcome', analysis.uncertainty]]) {
      const card = document.createElement('article');
      card.className = 'method-note';
      const title = document.createElement('strong');
      title.textContent = label;
      const paragraph = document.createElement('p');
      paragraph.textContent = copy;
      card.append(title, paragraph);
      $('aiRead').append(card);
    }
    $('aiStatus').textContent = '';
  } catch (error) {
    if (contextKey === aiContextKey) $('aiStatus').textContent = error.message;
  } finally {
    aiPending = false;
    renderAiChoices();
  }
});

function renderPicks() {
  const model=board?.model;
  const validated=model?.status==='validated_winner_forecasts';
  const v=model?.validation;
  $('modelEvidence').innerHTML=validated?`Historical test: <strong>${(v.accuracy*100).toFixed(1)}% correct</strong> across ${v.picks.toLocaleString()} qualifying forecasts in 2025–26. Brier score ${v.brier.toFixed(3)} vs ${v.baselineBrier.toFixed(3)} baseline (lower is better). <a href="#validationRoot">Review evidence ↓</a>${board.forecastGeneratedAt ? ` · Forecasts published ${esc(time(board.forecastGeneratedAt))}` : ''}`:'Winner forecasts are temporarily unavailable because model integrity or current data could not be verified.';
  const upcoming = upcomingForecasts();
  if (!upcoming.length) {
    $('picksRoot').innerHTML = '<p class="empty">No qualifying pregame forecasts available right now.</p>';
    return;
  }
  const rows = upcoming.map(game => {
    const prediction = game.prediction;
    return `<tr>
      <td><strong>${esc(game.away.shortName)} at ${esc(game.home.shortName)}</strong><small>${esc(time(game.kickoff))}</small></td>
      <td>${esc(game[prediction.side].name)}</td>
      <td><strong>${(prediction.probability * 100).toFixed(0)}%</strong></td>
      <td>${prediction.earlySeason ? 'Early-season carryover' : 'Current season'}</td>
      <td><a href="#game-${esc(game.id)}">View matchup</a></td>
    </tr>`;
  }).join('');
  $('picksRoot').innerHTML = `<div class="props-table-wrap"><table class="props-table">
    <caption class="sr-only">Men’s college basketball winner forecasts</caption>
    <thead><tr><th>Matchup</th><th>Model pick</th><th>Win estimate</th><th>Ratings</th><th>Details</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}
function renderValidation(report) {
  $('validationRoot').innerHTML=`<p>${esc(report.method)}</p><p>Training: ${report.training.toLocaleString()} games. Holdout: ${report.holdout.toLocaleString()} games. Qualifying forecasts: ${report.picks.toLocaleString()} (${report.wins.toLocaleString()} wins, ${report.losses.toLocaleString()} losses).</p><p>Accuracy: ${(report.accuracy*100).toFixed(1)}%; nominal 95% interval ${(report.accuracy95[0]*100).toFixed(1)}–${(report.accuracy95[1]*100).toFixed(1)}%. Average calibration error: ${(report.calibrationError*100).toFixed(1)} percentage points. The model was generally conservative in this test.</p><p>Predeclared pass criteria: at least ${report.config.acceptance.minimumHoldoutPicks} forecasts, calibration error ≤10 percentage points, and a positive lower 95% bound on Brier improvement over the training-derived home/neutral baseline.</p><p>${report.limitations.map(esc).join(' ')}</p><p>Model version: ${esc(report.modelVersion)} · Data fingerprint: ${esc(report.datasetHash.slice(0,16))}</p>`;
}
async function json(file) { const r=await fetch(`./data/${file}?t=${Date.now()}`,{cache:'no-store'}); if(!r.ok)throw new Error('Feed unavailable'); return r.json(); }
async function load() {
  if(loading)return; loading=true; $('refreshBoard').disabled=true;
  try {
    const data=await json('ncaam_board.json');
    if(data.sport!=='NCAAM'||!Array.isArray(data.games)||!Number.isFinite(Date.parse(data.generatedAt)))throw new Error('Invalid board');
    board=data;failed=false;
    render();
    try {
      renderValidation(await json('ncaam_validation.json'));
    } catch {
      $('validationRoot').textContent = 'Validation report unavailable.';
    }
  } catch { failed=true; if(board)render();else{renderAiChoices();$('feedStatus').textContent='College basketball feed unavailable. Try refreshing shortly.';$('gamesRoot').innerHTML='<p class="empty">The slate could not be loaded.</p>';} }
  finally {loading=false;$('refreshBoard').disabled=false;}
}
$('teamSearch').addEventListener('input',renderGames);$('statusFilter').addEventListener('change',renderGames);$('refreshBoard').addEventListener('click',load);
load();setInterval(load,60_000);setInterval(()=>{const open=[...document.querySelectorAll('.game-card details[open]')].map(el=>el.closest('article').id);render();for(const id of open)document.getElementById(id)?.querySelector('details')?.setAttribute('open','');},30_000);
