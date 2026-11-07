import { wholeScoreText } from './cfb-score-display.mjs';
import {fresh as quoteFresh} from './odds-core.mjs';
import { isFresh,mergeLiveGame,MAX_MODEL_AGE_MS,completeSlate,currentCfbMarket } from './cfb-market.mjs?v=20261107-current-quotes';
import { moneylineProjection, implied, payout, estimate } from './cfb-edge.mjs';
import { boardRows, boardHighlights, sortBoard } from './cfb-board.mjs';
const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const signed = n => n === null || n === undefined ? '—' : n > 0 ? `+${n}` : `${n}`;
const fmt = n => Number.isFinite(n) ? n.toFixed(1) : '—';
const score = n => Number.isFinite(n) ? String(Math.round(n)) : '—';
const dateLabel = value => new Date(value).toLocaleString('en-US',{timeZone:'America/New_York',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const dayKey = value => new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const conferences = {'1':'ACC','4':'Big 12','5':'Big Ten','8':'SEC','9':'Pac-12','12':'Conference USA','15':'MAC','17':'Mountain West','18':'FBS Independents','37':'Sun Belt','151':'American'};
const conferenceName = id => conferences[id] || (id ? `Conference ${id}` : 'Other');
let board, snapshot, latestLive, liveAsOf=null, liveError=true, refreshing=false, market = 'spread', aiByGame=new Map(), aiState='idle', slateAi=null, boardSort={key:'kickoff',direction:'asc'};
const fresh = () => !liveError && isFresh(liveAsOf);
const upcoming = game => game.state === 'pre' && !game.canceled && game.timeValid && Date.parse(game.date) > Date.now() && (!game.statusName || game.statusName==='STATUS_SCHEDULED');
const currentGames = () => (board?.games||[]).map(game=>({...game,market:currentCfbMarket(game),projection:isFresh(game.projection?.trainingCutoff,Date.now(),MAX_MODEL_AGE_MS)?game.projection:null}));
const pct=value=>Number.isFinite(value)?`${(value*100).toFixed(1)}%`:'—';
const qualityLabel=p=>p.dataQuality==='full'?'Full team-history model':p.dataQuality==='limited'?'Limited-history model':'National-prior baseline';
function gameAiRead(game,p,m) {
  const generated=generatedRead(game);
  const projection=moneylineProjection(p,snapshot?.calibration);
  if(!projection)return '';
  const favorite=projection.homeProbability>=.5?'home':'away',team=game[favorite],probability=projection[`${favorite}Probability`],fair=projection[`${favorite}FairPrice`];
  const quote=m?.quoteDetails?.moneyline?.[favorite],price=quote?.price??m?.[`${favorite}ML`];
  const freshQuote=quote&&quoteFresh(quote.quotedAt),marketProbability=freshQuote?implied(price):null,profit=freshQuote?payout(price):null;
  const expectedReturn=profit===null?null:probability*profit-(1-probability),gap=marketProbability===null?null:probability-marketProbability;
  const confidence=probability>=.72?'High':probability>=.62?'Medium':'Lean';
  const spreadSide=p.margin>=0?'home':'away',fairSpread=Number((-Math.abs(p.margin)).toFixed(1)),projectedTotal=p.total;
  const spreadEstimate=m?.homeSpread==null?null:estimate(p,m,snapshot?.calibration,'spread');
  const spreadPick=spreadEstimate===null?spreadSide:(spreadEstimate>=.5?'home':'away');
  const spreadProbability=spreadEstimate===null?null:Math.max(spreadEstimate,1-spreadEstimate);
  const totalEstimate=m?.total==null?null:estimate(p,m,snapshot?.calibration,'total');
  const totalSide=totalEstimate===null?null:(totalEstimate>=.5?'over':'under');
  const totalProbability=totalEstimate===null?null:Math.max(totalEstimate,1-totalEstimate);
  let says=generated?.overview||`Projected score ${game.away.short} ${score(p.awayScore)}–${score(p.homeScore)} ${game.home.short}. The model favors ${team.name} by ${Math.abs(p.margin).toFixed(1)} points with a ${pct(probability)} win projection and projects ${projectedTotal.toFixed(1)} total points.`;
  if(!generated){if(quote?.timestampKind==='quote'&&expectedReturn!==null&&expectedReturn>=.05)says+=` The current ${signed(price)} price shows ${(expectedReturn*100).toFixed(1)}% estimated return before uncertainty.`;else if(freshQuote)says+=' The displayed sportsbook price is for comparison.';else says+=' A fresh sportsbook price is needed before evaluating value.';}
  const source=generated?`OpenAI-generated · ${esc(generated.headline)}`:aiState==='loading'?'OpenAI analysis loading…':'Statistical model view · OpenAI temporarily unavailable';
  return `<div class="ai-read"><div class="ai-read-head"><span>AI says</span><b>${confidence} confidence · ${esc(qualityLabel(p))}</b></div><small class="ai-source-label">${source}</small><p>${esc(wholeScoreText(says))}</p><div class="ml-grid ai-category-grid"><div><small>Moneyline</small><strong>${esc(team.short)} ${pct(probability)}</strong><em>${esc(generated?.moneyline||`Fair price ${signed(fair)}${freshQuote?` · ${quote.book} ${signed(price)}`:' · market unavailable'}`)}</em></div><div><small>Spread</small><strong>${esc(game[spreadPick].short)} ${m?.homeSpread==null?signed(fairSpread):signed(spreadPick==='home'?m.homeSpread:-m.homeSpread)}</strong><em>${esc(generated?.spread||(spreadProbability===null?`Model fair spread · ${game[spreadSide].short} ${signed(fairSpread)}`:`${pct(spreadProbability)} cover projection`))}</em></div><div><small>Over / Under</small><strong>${totalSide?`${totalSide==='over'?'Over':'Under'} ${m.total}`:`Model total ${projectedTotal.toFixed(1)}`}</strong><em>${esc(generated?.total||(totalProbability===null?'Sportsbook total unavailable':`${pct(totalProbability)} projection`))}</em></div></div>${generated?.risks?.length?`<p class="ai-risk"><strong>AI risk check:</strong> ${esc(generated.risks.join(' · '))}</p>`:''}${freshQuote?`<small class="price-source">Moneyline: ${esc(quote.book)} · ${quote.timestampKind==='quote'?'verified':'observed'} ${esc(dateLabel(quote.quotedAt))} ET</small>`:'<small class="price-source">Model numbers shown for every category; sportsbook comparisons require a verified current line.</small>'}</div>`;
}

async function accountToken(){
  for(let i=0;i<60&&!window.TSLAccount;i++)await new Promise(r=>setTimeout(r,100));
  if(!window.TSLAccount)throw Error('Account session unavailable');
  await window.TSLAccount.ready;
  const token=await window.TSLAccount.accessToken();
  if(!token)throw Error('Sign in to use NCAAF AI Says');
  return token;
}
function aiPayload(g){
  const p=g.projection,ml=moneylineProjection(p,snapshot?.calibration),m=g.market;
  return {gameId:g.id,kickoff:g.date,away:g.away.name,home:g.home.name,venue:g.venue,neutral:g.neutral,dataQuality:p.dataQuality,
    projection:{awayScore:Math.round(p.awayScore),homeScore:Math.round(p.homeScore),homeMargin:p.margin,total:p.total,awayWinProbability:ml?.awayProbability,homeWinProbability:ml?.homeProbability,awayOffense:p.away.offense,awayDefense:p.away.defense,homeOffense:p.home.offense,homeDefense:p.home.defense},
    market:m?{homeSpread:m.homeSpread,total:m.total,homeMoneyline:m.homeML,awayMoneyline:m.awayML,provider:m.provider}:null};
}
const aiKey=game=>JSON.stringify(aiPayload(game));
function generatedRead(game){
  const entry=aiByGame.get(String(game.id));
  return entry&&upcoming(game)&&game.projection&&entry.key===aiKey(game)?entry.read:null;
}
async function requestAi(token,mode,games){
  const response=await fetch('/api/cfb-ai-analysis',{method:'POST',signal:AbortSignal.timeout(58000),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({mode,games})});
  if(!response.ok)throw Error(`NCAAF AI analysis returned ${response.status}`);
  return response.json();
}
let aiRunning=false;
async function loadGenuineAi(){
  if(aiRunning)return;
  const games=currentGames().filter(game=>upcoming(game)&&game.projection);
  if(!games.length)return;
  const signal=boardRows(games,snapshot?.calibration).sort((a,b)=>b.maxGap-a.maxGap).slice(0,6).map(row=>row.game);
  const pending=games.filter(game=>!generatedRead(game));
  if(!pending.length&&currentSlateAi())return;
  aiRunning=true;
  aiState='loading';
  const render=()=>{renderGames();renderIntelligenceBoard();};
  try{
    const token=await Promise.race([accountToken(),new Promise((_,reject)=>setTimeout(()=>reject(Error('Account verification timed out')),8000))]);
    const slateInputs=signal.map(aiPayload);
    const weekly=currentSlateAi()?Promise.resolve():requestAi(token,'slate',slateInputs).then(read=>{
      slateAi={read,inputs:slateInputs};
      render();
    });
    const matchups=(async()=>{
      for(let i=0;i<pending.length;i+=8){
        const inputs=pending.slice(i,i+8).map(aiPayload);
        const result=await requestAi(token,'games',inputs);
        const keys=new Map(inputs.map(game=>[String(game.gameId),JSON.stringify(game)]));
        for(const read of result.games||[]){
          const id=String(read.gameId);
          if(keys.has(id))aiByGame.set(id,{key:keys.get(id),read});
        }
        render();
      }
    })();
    const results=await Promise.allSettled([weekly,matchups]);
    aiState=results.some(result=>result.status==='rejected')?'error':'ready';
  }catch{aiState='error';}
  finally{aiRunning=false;render();}
}
function currentSlateAi(){
  if(!slateAi)return null;
  const games=new Map(currentGames().filter(game=>upcoming(game)&&game.projection).map(game=>[String(game.id),game]));
  return slateAi.inputs.every(input=>{
    const game=games.get(String(input.gameId));
    return game&&JSON.stringify(input)===aiKey(game);
  })?slateAi.read:null;
}
function currentQuote(game,marketName,side) {
  const quote=game.market?.quoteDetails?.[marketName]?.[side];
  return quote&&quoteFresh(quote.quotedAt)?quote:null;
}
function rankedMarketReads(kind) {
  if(!board)return [];
  const reads=[];
  for(const game of currentGames().filter(upcoming)) {
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
        reads.push({game,probability,edge:hasLine?Math.abs(p.total-m.total):Math.abs(p.total-55),label:side?`${side==='over'?'Over':'Under'} ${m.total}`:`Model total ${p.total.toFixed(1)}`,detail:hasLine?`${pct(probability)} projection · model total ${p.total.toFixed(1)}`:`Projected score ${game.away.short} ${score(p.awayScore)}, ${game.home.short} ${score(p.homeScore)} · ${qualityLabel(p)}`,quote});
      }
    }
  }
  return reads.sort((a,b)=>b.edge-a.edge).slice(0,5);
}
function aiMarketColumn(kind,title) {
  const rows=rankedMarketReads(kind);
  return `<section class="ai-market"><div class="ai-market-title"><span>${esc(title)}</span><small>Top model reads</small></div>${rows.length?rows.map((r,index)=>`<article class="ai-pick"><b>${index+1}</b><div><small>${esc(r.game.away.short)} @ ${esc(r.game.home.short)} · ${esc(dateLabel(r.game.date))} ET</small><h3>${esc(r.label)}</h3><p>${esc(r.detail)}</p>${r.quote?`<span class="ai-price">${esc(r.quote.book)} ${signed(r.quote.price)} · verified ${esc(dateLabel(r.quote.quotedAt))} ET</span>`:'<span class="ai-price waiting">Fresh sportsbook price unavailable</span>'}</div><a href="#game-${esc(r.game.id)}" data-show-game aria-label="Open ${esc(r.game.away.short)} at ${esc(r.game.home.short)} matchup">↗</a></article>`).join(''):'<p class="ai-market-empty">No eligible projections in this market.</p>'}</section>`;
}
const one=n=>Number.isFinite(n)?n.toFixed(1):'—';
const spreadText=row=>{if(!row.game.projection)return '—';const side=row.modelSpread>=0?'home':'away';return `${row.game[side].short} ${signed(Number((-Math.abs(row.modelSpread)).toFixed(1)))}`};
const quoteText=(quote,label)=>quote?`<strong>${esc(label)} ${quote.line==null?'':esc(label==='O'||label==='U'?quote.line:signed(quote.line))}</strong><small>${esc(signed(quote.price))} · ${esc(quote.book)}</small>`:'—';
function marketWinText(row){return row.marketWin?`${row.game.away.short} ${pct(row.marketWin.away)}<br>${row.game.home.short} ${pct(row.marketWin.home)}`:'—'}
function modelWinText(row){return row.modelWin?`${row.game.away.short} ${pct(row.modelWin.awayProbability)}<br>${row.game.home.short} ${pct(row.modelWin.homeProbability)}`:'—'}
function boardAiCell(row){
  const ai=generatedRead(row.game);
  if(ai)return `<button class="ai-open" type="button" data-open-game="${esc(row.game.id)}"><strong>${esc(wholeScoreText(ai.headline))}</strong><span>${esc(wholeScoreText(ai.overview))}</span></button>`;
  return `<button class="ai-open" type="button" data-open-game="${esc(row.game.id)}"><strong>${row.game.projection?'Model read':'Game details'}</strong><span>${esc(row.game.projection?`${row.game.away.short} ${score(row.game.projection.awayScore)}–${score(row.game.projection.homeScore)} ${row.game.home.short} · ${spreadText(row)}`:'Projection unavailable')}</span></button>`;
}
function boardTableRow(row){
  const g=row.game,m=g.market,q=m?.quoteDetails||{},spreadSide=row.spreadGap===null?(m?.homeSpread>0?'away':'home'):(row.spreadGap>=0?'home':'away'),totalSide=row.totalGap===null?'over':(row.totalGap>=0?'over':'under'),mlSide=row.modelWin?(row.modelWin.homeProbability>=row.modelWin.awayProbability?'home':'away'):(row.marketWin?.away>row.marketWin?.home?'away':'home');
  const spreadQuote=spreadSide?q.spread?.[spreadSide]:null,totalQuote=totalSide?q.total?.[totalSide]:null,mlQuote=mlSide?q.moneyline?.[mlSide]:null;
  const bestOver=totalSide==='over'&&Number.isFinite(row.overProbability)&&row.overProbability>=.55;
  const bestUnder=totalSide==='under'&&Number.isFinite(row.totalGap)&&row.totalGap<=-5;
  const totalCell=`${quoteText(totalQuote,totalSide==='over'?'O':'U')}${bestOver?`<span class="total-chance">${pct(row.overProbability)} model over chance</span>`:bestUnder?`<span class="total-chance">Model ${one(Math.abs(row.totalGap))} below total</span>`:''}`;
  const status=g.completed?'Final':g.state==='in'?'Live':upcoming(g)?'Scheduled':'Awaiting update';
  return `<tr id="board-game-${esc(g.id)}" data-game-id="${esc(g.id)}"><td class="matchup-cell"><strong>${g.away.rank?`#${g.away.rank} `:''}${esc(g.away.name)}</strong><span>@</span><strong>${g.home.rank?`#${g.home.rank} `:''}${esc(g.home.name)}</strong></td><td>${esc(dateLabel(g.date))} ET</td><td><span class="status-dot ${g.state}"></span>${status}</td><td>${g.state==='post'?`${g.away.score}–${g.home.score}`:'—'}</td><td>${esc(spreadText(row))}</td><td>${quoteText(spreadQuote,spreadSide?g[spreadSide].short:'')}</td><td class="gap ${Math.abs(row.spreadGap??0)>=7?'hot':''}">${row.spreadGap===null?'—':`${row.spreadGap>=0?g.home.short:g.away.short} ${one(Math.abs(row.spreadGap))}`}</td><td>${one(row.modelTotal)}</td><td class="${bestOver?'best-total-over':bestUnder?'best-total-under':''}">${totalCell}</td><td class="gap ${Math.abs(row.totalGap??0)>=7?'hot':''}">${row.totalGap===null?'—':`${row.totalGap>=0?'OVER':'UNDER'} ${one(Math.abs(row.totalGap))}`}</td><td>${modelWinText(row)}</td><td>${marketWinText(row)}</td><td class="gap ${Math.abs(row.winGap??0)>=7?'hot':''}">${row.winGap===null?'—':`${row.winGap>=0?g.home.short:g.away.short} ${one(Math.abs(row.winGap))}%`}</td><td>${quoteText(mlQuote,mlSide?g[mlSide].short:'')}</td><td class="ai-cell">${boardAiCell(row)}</td></tr>`;
}
function filteredBoardRows(){
  const search=$('board-search')?.value.trim().toLowerCase()||'',status=$('board-status')?.value||'all',tier=$('board-tier')?.value||'all',conference=$('board-conference')?.value||'all',ranked=$('board-ranked')?.value||'all';
  let rows=boardRows(currentGames(),snapshot?.calibration).filter(row=>{const g=row.game;return (!search||`${g.home.name} ${g.home.short} ${g.away.name} ${g.away.short}`.toLowerCase().includes(search))&&(status==='all'||g.state===status)&&(tier==='all'||row.maxGap>=(tier==='strong'?7:3))&&(conference==='all'||g.home.conference===conference||g.away.conference===conference)&&(ranked==='all'||g.home.rank||g.away.rank)});
  return sortBoard(rows,boardSort.key,boardSort.direction);
}
function renderIntelligenceBoard(){
  if(!board)return;
  $('week-label').textContent=`${board.weekStart} — ${board.weekEnd}`;
  const weekly=currentSlateAi();
  const allRows=boardRows(currentGames(),snapshot?.calibration),rows=filteredBoardRows(),highlights=boardHighlights(allRows);
  $('matchup-pills').innerHTML=allRows.map(row=>`<button type="button" data-jump-game="${esc(row.game.id)}"><i></i>${esc(row.matchup)} <small>${row.game.completed?'FINAL':row.game.timeValid?new Date(row.game.date).toLocaleTimeString('en-US',{timeZone:'America/New_York',hour:'numeric',minute:'2-digit'}):'TBD'}</small></button>`).join('');
  const kpi=(label,row,key,suffix='')=>`<article><small>${label}</small><strong>${row?one(Math.abs(row[key]))+suffix:'—'}</strong><span>${row?esc(row.matchup):'No verified market'}</span></article>`;
  $('board-kpis').innerHTML=kpi('Largest spread gap',highlights.spread,'spreadGap')+kpi('Largest total gap',highlights.total,'totalGap')+kpi('Largest win-probability gap',highlights.win,'winGap','%')+`<article><small>Games with a large gap</small><strong>${highlights.large}</strong><span>7+ points or probability points</span></article>`;
  $('model-board-body').innerHTML=rows.length?rows.map(boardTableRow).join(''):'<tr><td colspan="15">No games match these filters.</td></tr>';
  $('week-ai-status').textContent=weekly?.overview?'Generated by OpenAI · grounded in current model + market data':aiState==='loading'?'Model and sportsbook comparison · AI analysis in progress':'Current model and sportsbook comparison';
  $('week-ai-copy').textContent=wholeScoreText(weekly?.overview)||`This board compares all ${board.games.length} matchups. OpenAI analysis appears here after account verification; sortable model and sportsbook numbers remain available below.`;
  $('week-ai-takeaways').innerHTML=weekly?.takeaways?.map(item=>`<button type="button" data-jump-game="${esc(item.gameId)}"><strong>${esc(wholeScoreText(item.label))}</strong><span>${esc(wholeScoreText(item.detail))}</span></button>`).join('')||'';
}
function card(game) {
  const m = game.state==='pre'?game.market:null, p = game.projection;
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
  const newest=times.at(-1),isCurrent=newest&&quoteFresh(newest);
  const note = isCurrent ? `${esc(Object.values(details)[0].provider)} · Observed ${esc(dateLabel(newest))} ET` : upcoming(game) ? 'No current sportsbook price for this market' : 'Pregame prices closed';
  return `<article class="game-card" id="game-${esc(game.id)}"><div class="game-meta"><span>${esc(game.timeValid ? dateLabel(game.date)+' ET' : dayKey(game.date)+' · Time TBD')}<br>${esc(game.broadcast)}</span><span>${status}</span></div>${teamRow('away')}${teamRow('home')}<div class="market-note">${note}</div>${p&&upcoming(game)?gameAiRead(game,p,m):''}${m&&game.sportsbookQuotes?.some(q=>quoteFresh(q.quotedAt))?`<details><summary>Compare sportsbook prices</summary><div class="odds-comparison">${game.sportsbookQuotes.filter(q=>q.market===market&&quoteFresh(q.quotedAt)).map(q=>`<p>${esc(q.book)} · ${esc(q.side==='home'?game.home.short:q.side==='away'?game.away.short:q.side)} ${q.line==null?'':esc(signed(q.line))} · <strong>${esc(signed(q.price))}</strong></p>`).join('')||'<p>This market is unavailable.</p>'}</div></details>`:''}<div class="projection"><span>Projected score</span><strong>${p ? `${esc(game.away.short)} ${score(p.awayScore)}<br>${esc(game.home.short)} ${score(p.homeScore)}` : game.state === 'post' ? 'Final result above' : 'Current projection unavailable'}</strong></div><details><summary>Inside the matchup</summary><p>${esc(game.venue)}${game.neutral ? ' · Neutral site' : ''}${game.weather ? `<br>${esc(game.weather)}` : ''}</p>${p ? `<div class="context-grid">${['away','home'].map(side=>`<div><strong>${esc(game[side].short)}</strong><br>${signed(Number(p[side].offense.toFixed(1)))} offense vs average<br>${signed(Number(p[side].defense.toFixed(1)))} defense (higher is better)<br>${signed(Number(p[side].rating.toFixed(1)))} net rating</div>`).join('')}</div><p>Projected total: ${fmt(p.total)} · Home margin: ${signed(Number(p.margin.toFixed(1)))}</p>` : '<p>A projection is not available for this matchup yet.</p>'}<a href="https://www.espn.com/college-football/game/_/gameId/${encodeURIComponent(game.id)}" target="_blank" rel="noopener noreferrer">View game on ESPN ↗</a></details></article>`;
}
function renderGames() {
  if (!board) return;
  const expanded=new Set([...document.querySelectorAll('.game-card details[open]')].map(d=>d.closest('.game-card').id));
  const search = $('search').value.trim().toLowerCase(), conference = $('conference').value, day = $('day').value, status = $('status').value;
  const games = currentGames().filter(g => (!search || `${g.home.name} ${g.home.short} ${g.away.name} ${g.away.short}`.toLowerCase().includes(search)) &&
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
  const modelReady=board.games.some(g=>g.projection&&isFresh(g.projection.trainingCutoff,Date.now(),MAX_MODEL_AGE_MS));
  $('health').classList.toggle('warning',!fresh()||!modelReady);
  $('health').textContent=fresh()?`ESPN scores · Sportsbook prices · Checked ${dateLabel(liveAsOf)} ET${modelReady?"":" · Projections unavailable"}`:`Live updates unavailable. Leans paused. Last update: ${liveAsOf?dateLabel(liveAsOf)+' ET':'not yet available'}.`;
  const rankedReadCount=modelReady&&fresh()?['moneyline','spread','total'].reduce((sum,kind)=>sum+rankedMarketReads(kind).length,0):0;
  $('metrics').innerHTML=[[board.games.length,'Games this week'],[board.games.filter(g=>g.home.rank||g.away.rank).length,'Games with ranked teams'],[currentGames().filter(g=>g.market).length,'Games with odds'],[rankedReadCount,'Ranked AI reads']].map(([n,label])=>`<div class="metric"><strong>${n}</strong><span>${label}</span></div>`).join('');
  renderIntelligenceBoard();
}
function updateBoard(){
  if(!latestLive&&!snapshot)return;
  if(latestLive){
    const {weekStart,weekEnd,games}=latestLive;
    const saved=snapshot?.weekStart===weekStart?snapshot.games:[];
    const savedById=new Map(saved.map(game=>[String(game.id),game]));
    const liveById=new Map(games.map(game=>[String(game.id),game]));
    board={weekStart,weekEnd,games:completeSlate(saved,games).map(game=>{
      const live=liveById.get(String(game.id));
      if(!live)return {...game,market:null,sportsbookQuotes:[],leans:[]};
      return mergeLiveGame(live,savedById.get(String(game.id)),liveAsOf);
    })};
  }else board=snapshot;
  $('edition-date').textContent=`${board.weekStart} — ${board.weekEnd}`;
  const addOptions=(id,rows)=>{
    const element=$(id),value=element.value;
    element.length=1;
    rows.forEach(([key,label])=>element.add(new Option(label,key)));
    element.value=[...element.options].some(o=>o.value===value)?value:'all';
  };
  const conferencesOnBoard=[...new Set(board.games.flatMap(g=>[g.home.conference,g.away.conference]))]
    .filter(id=>conferences[id]).map(id=>[id,conferenceName(id)]).sort((a,b)=>a[1].localeCompare(b[1]));
  addOptions('conference',conferencesOnBoard.concat([['other','Other / FCS conferences']]));
  addOptions('board-conference',conferencesOnBoard);
  addOptions('day',[...new Set(board.games.map(g=>dayKey(g.date)))].sort().map(day=>[
    day,new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US',{timeZone:'America/New_York',weekday:'short',month:'short',day:'numeric'})
  ]));
  renderGames();
  renderSummary();
}
async function refreshLive() {
  if(refreshing)return;
  refreshing=true;
  $('refresh-now').disabled=true;
  $('refresh-now').textContent='Updating…';
  try {
    const response=await fetch('./api/cfb-live',{cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(!response.ok)throw Error('Live feed failed');
    const live=await response.json();
    if(live.schemaVersion!==1||!Array.isArray(live.games)||!isFresh(live.retrievedAt))throw Error('Stale or invalid live feed');
    latestLive=live;
    liveAsOf=live.retrievedAt;
    liveError=false;
    updateBoard();
  }catch{
    liveError=true;
    if(board)renderSummary();
  }finally{
    refreshing=false;
    $('refresh-now').disabled=false;
    $('refresh-now').textContent='Refresh now ↻';
  }
}
async function load(){
  for(const path of ['./api/cfb-live?view=model','./data/cfb_board.json']){
    try {
      const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(data.schemaVersion!==1||!Array.isArray(data.games)||!Number.isFinite(Date.parse(data.generatedAt)))throw Error('Invalid board');
      if(snapshot&&Date.parse(snapshot.generatedAt)>=Date.parse(data.generatedAt))return;
      snapshot=data;
      updateBoard();
      return;
    }catch{}
  }
  if(!board)$('health').textContent='Checking the current scoreboard. Model projections are temporarily unavailable.';
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
$('board-filters').addEventListener('submit',event=>event.preventDefault());
$('board-filters').addEventListener('input',renderIntelligenceBoard);
$('board-filters').addEventListener('change',renderIntelligenceBoard);
$('board-filters').addEventListener('reset',()=>setTimeout(renderIntelligenceBoard,0));
$('leans').addEventListener('click',event=>{
  const sort=event.target.closest('[data-board-sort]');if(sort){const key=sort.dataset.boardSort;boardSort=boardSort.key===key?{key,direction:boardSort.direction==='asc'?'desc':'asc'}:{key,direction:key==='kickoff'||key==='matchup'?'asc':'desc'};renderIntelligenceBoard();return}
  const target=event.target.closest('[data-jump-game],[data-open-game]');if(!target)return;const id=target.dataset.jumpGame||target.dataset.openGame,row=document.getElementById(`board-game-${id}`);if(row){row.scrollIntoView({behavior:'smooth',block:'center'});row.classList.remove('pulse');requestAnimationFrame(()=>row.classList.add('pulse'))}
  if(target.matches('[data-open-game]')){const detail=document.getElementById(`game-${id}`);if(detail){detail.scrollIntoView({behavior:'smooth',block:'start'});detail.querySelector('details:last-of-type')?.setAttribute('open','')}}
});
$('refresh-now').addEventListener('click',()=>refreshLive());
await Promise.all([load(),refreshLive()]);
void loadGenuineAi();
setInterval(()=>{if(!document.hidden)refreshLive();},60000);
setInterval(async()=>{if(!document.hidden){await load();void loadGenuineAi();}},300000);
setInterval(()=>{if(board){if(!fresh())renderGames();renderSummary();}},10000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshLive();});
