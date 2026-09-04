import {fresh,norm,matchEvent,bestComparable} from './odds-core.mjs';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=p=>p>0?`+${p}`:String(p);
const labels={moneyline:'Moneyline',spread:'Spread',total:'Total',batter_home_runs:'Home runs',batter_hits:'Hits',batter_total_bases:'Total bases',batter_rbis:'RBIs',pitcher_strikeouts:'Strikeouts',player_points:'Points',player_rebounds:'Rebounds',player_assists:'Assists',player_threes:'Threes',player_pass_yds:'Passing yards',player_rush_yds:'Rushing yards',player_reception_yds:'Receiving yards',player_anytime_td:'Anytime touchdown'};
const when=s=>new Date(s).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
const pending=new Map();
const canonicalPending=new Map();
async function json(path){const r=await fetch(path,{cache:'no-store'});if(!r.ok)throw new Error('Unavailable');return r.json();}
async function feed(sport){if(!pending.has(sport))pending.set(sport,json(`./data/odds_${sport.toLowerCase()}.json`).then(d=>d.schemaVersion===1&&Array.isArray(d.quotes)&&Array.isArray(d.events)?d:{quotes:[],events:[],status:'unavailable'}).catch(()=>({quotes:[],events:[],status:'unavailable'})));return pending.get(sport);}
const current=q=>Number.isFinite(q.decimalOdds)&&q.decimalOdds>1&&Number.isFinite(q.price)&&Math.abs(q.price)>=100&&fresh(q.quotedAt)&&Date.parse(q.kickoff)>Date.now();
export function table(quotes){
 const best=new Set(bestComparable(quotes).map(q=>q.quoteId));
 return `<div class="tsl-odds-scroll"><table><thead><tr><th>Market / selection</th><th>Book</th><th>Odds</th><th>Break-even</th><th>Observed</th></tr></thead><tbody>${quotes.map(q=>`<tr><td>${esc(labels[q.market]||q.market)} · ${esc(q.side==='home'?q.home:q.side==='away'?q.away:q.side)}${q.line==null||q.market==='player_anytime_td'?'':` ${esc(q.line)}`}</td><td>${esc(q.book)}</td><td><strong>${esc(price(q.price))}</strong>${best.has(q.quoteId)?'<small>Best listed price at this line</small>':''}</td><td>${(100/q.decimalOdds).toFixed(1)}%</td><td>${esc(when(q.quotedAt))}${q.timestampKind==='market-observation'?'<small>Market observation</small>':''}</td></tr>`).join('')}</tbody></table></div>`;
}
export function playerQuotes(data,games,identity){
 const candidates=games.filter(g=>Date.parse(g.kickoff)>Date.now()&&(!identity.gameId||String(g.id)===String(identity.gameId))&&(!identity.team||[...(g.homeNames||[]),...(g.awayNames||[])].map(norm).includes(norm(identity.team))));
 const events=[...new Map(data.quotes.filter(q=>q.player).map(q=>[q.providerEventId,{id:q.providerEventId,home:q.home,away:q.away,kickoff:q.kickoff}])).values()];
 const ids=new Set(candidates.map(g=>matchEvent(g,events)?.id).filter(Boolean));
 return data.quotes.filter(q=>q.player&&current(q)&&ids.has(q.providerEventId)&&norm(q.player)===norm(identity.player)&&(!q.providerPlayerId||!String(q.providerPlayerId).startsWith('mlb:')||!identity.playerId||q.providerPlayerId===`mlb:${identity.playerId}`));
}
async function canonical(sport){
 const data=await json(`./data/${sport==='NFL'?'nfl_schedule':sport.toLowerCase()+'_games_today'}.json`);
 return canonicalRows(data);
}
export function canonicalRows(data){return (Array.isArray(data)?data:(data.games||[])).map(g=>({id:g.gamePk||g.gameId||g.id,kickoff:g.gameDate||g.gameTimeUTC||g.kickoffUTC||g.date||g.startTime,homeNames:typeof g.homeTeam==='string'?[g.homeTeam,g.homeTeamAbbreviation]:[g.homeTeam?.name,g.homeTeam?.displayName,g.homeTeam?.abbreviation,g.homeTeam?.team,g.homeTeam?.teamName,`${g.homeTeam?.city||''} ${g.homeTeam?.team||''}`.trim()],awayNames:typeof g.awayTeam==='string'?[g.awayTeam,g.awayTeamAbbreviation]:[g.awayTeam?.name,g.awayTeam?.displayName,g.awayTeam?.abbreviation,g.awayTeam?.team,g.awayTeam?.teamName,`${g.awayTeam?.city||''} ${g.awayTeam?.team||''}`.trim()]}));}
function canonicalFeed(sport){if(!canonicalPending.has(sport))canonicalPending.set(sport,canonical(sport));return canonicalPending.get(sport);}
export function bestPlayerPrice(quotes,sport){
 const market={MLB:'batter_home_runs',WNBA:'player_points',NBA:'player_points',NFL:'player_anytime_td'}[sport];
 const eligible=quotes.filter(q=>q.market===market&&(sport==='NFL'?['yes','over'].includes(q.side):q.side==='over')&&(sport!=='MLB'||Number(q.line)===0.5));
 return eligible.sort((a,b)=>b.decimalOdds-a.decimalOdds)[0]||null;
}
function priceSummary(q,sport){const label=sport==='MLB'?'HR':sport==='NFL'?'TD':labels[q.market]||q.market;return `<strong>${esc(label)} ${esc(price(q.price))}</strong><span>${esc(q.book)} · ${esc(when(q.quotedAt))}</span>`;}
export async function mountPlayer(element,identity){
 if(!element)return;element.classList.add('tsl-odds');element.textContent='Loading sportsbook prices…';
 try{const [data,games]=await Promise.all([feed(identity.sport),canonicalFeed(identity.sport)]);const quotes=playerQuotes(data,games,identity);const best=bestPlayerPrice(quotes,identity.sport);
 element.innerHTML=`${quotes.length?`${best?`<div class="tsl-player-price">${priceSummary(best,identity.sport)}<small>Best current listed price</small></div>`:''}<details><summary>Compare all player odds · ${quotes.length} prices</summary>${[...new Set(quotes.map(q=>q.providerEventId))].map(id=>{const group=quotes.filter(q=>q.providerEventId===id);return `<p>${esc(group[0].away)} at ${esc(group[0].home)} · ${esc(when(group[0].kickoff))}</p>${table(group)}`;}).join('')}<p class="tsl-odds-note">Break-even is the win rate needed at this price, not a player prediction. Confirm the line at your sportsbook.</p></details>`:'<h3>Player odds</h3><p>No fresh, exactly matched sportsbook price is available for this player.</p>'}`;
 }catch{element.innerHTML='<h3>Player odds</h3><p>Current player prices are unavailable.</p>';}
}
async function mountCardPrice(element,identity){
 if(element.querySelector(':scope > .tsl-card-price'))return;
 const slot=document.createElement('div');slot.className='tsl-card-price';slot.textContent='Checking current odds…';element.append(slot);
 try{const [data,games]=await Promise.all([feed(identity.sport),canonicalFeed(identity.sport)]);const best=bestPlayerPrice(playerQuotes(data,games,identity),identity.sport);slot.innerHTML=best?priceSummary(best,identity.sport):'<span>No verified current player price</span>';}
 catch{slot.innerHTML='<span>Player odds unavailable</span>';}
}
function sportForPage(){const p=location.pathname;return p.includes('cfb')?'NCAAF':p.includes('wnba')?'WNBA':p.includes('nba')?'NBA':p.includes('nfl')?'NFL':/mlb|full-board|home-run|homer|hits|total-bases|pitcher|rbi|ai-2|quick-target|hr-decision|command-center|heat-check|matchup-lab|power-zones|platoon-edge|player-intelligence|streak-lab|bullpen-collapse|ai-says/.test(p)?'MLB':null;}
async function init(){
 const style=document.createElement('link');style.rel='stylesheet';style.href='./assets/sports-odds.css?v=player-card-prices-20260904';document.head.append(style);
 window.TSLOdds={mountPlayer};window.dispatchEvent(new Event('tsl-odds-ready'));
 const sport=sportForPage();if(!sport)return;
 const host=document.querySelector('main')||document.querySelector('.wrap')||document.querySelector('.container');if(!host)return;
 const section=document.createElement('section');section.className='tsl-odds tsl-odds-board';section.id='sportsbook-odds';section.innerHTML=`<details><summary>Compare ${esc(sport)} sportsbook odds</summary><p>Loading current prices…</p></details>`;host.prepend(section);
 let data=await feed(sport);
 function render(){
  const open=section.querySelector('details')?.open;const query=section.querySelector('input')?.value||'';const category=section.querySelector('select')?.value||'all';
  const all=data.quotes.filter(current);const events=[...new Map(all.map(q=>[`${q.away}|${q.home}|${q.kickoff}`,q])).values()];
  section.innerHTML=`<details ${open?'open':''}><summary>Compare ${esc(sport)} sportsbook odds <span>${events.length} games</span></summary><p class="tsl-odds-note">Compare prices for the same selection and line. Prices are not model picks.</p><label>Markets <select><option value="all">Game lines and player props</option><option value="games" ${category==='games'?'selected':''}>Game lines</option><option value="props" ${category==='props'?'selected':''}>Player props</option></select></label><label>Find a team or player <input type="search" placeholder="Team or player name" value="${esc(query)}"></label><div class="tsl-odds-results"></div></details>`;
  const show=()=>{const search=norm(section.querySelector('input').value);const kind=section.querySelector('select').value;const filtered=all.filter(q=>(kind==='all'||(kind==='props'?q.player:!q.player))&&(!search||norm(`${q.home} ${q.away} ${q.player||''}`).includes(search)));
   const groups=new Map();for(const q of filtered){const k=`${q.away}|${q.home}|${q.kickoff}|${q.player||''}`;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(q);}
   section.querySelector('.tsl-odds-results').innerHTML=groups.size?[...groups.values()].slice(0,30).map(qs=>`<details class="tsl-odds-match"><summary>${esc(qs[0].player||`${qs[0].away} at ${qs[0].home}`)} <small>${esc(when(qs[0].kickoff))}${qs[0].player?` · ${esc(qs[0].away)} at ${esc(qs[0].home)}`:''}</small></summary>${table(qs)}</details>`).join('')+(groups.size>30?'<p>Search to narrow these results; showing the first 30 groups.</p>':''):`<p>${all.length?'No prices match this search.':'No fresh pregame prices available. Prices return when the provider lists current markets.'}</p>`;
  };section.querySelector('input').addEventListener('input',show);section.querySelector('select').addEventListener('change',show);show();
 }
 render();setInterval(async()=>{pending.delete(sport);data=await feed(sport);render();document.querySelectorAll('[data-odds-player]').forEach(el=>{seen.delete(el);mountSlot(el);});},60_000);
 const seen=new WeakSet();function mountSlot(el){if(seen.has(el))return;seen.add(el);mountPlayer(el,{sport:el.dataset.oddsSport||sport,player:el.dataset.oddsPlayer,playerId:el.dataset.oddsPlayerId,gameId:el.dataset.oddsGameId,team:el.dataset.oddsTeam});}
 const scan=()=>{document.querySelectorAll('[data-odds-player]').forEach(mountSlot);if(sport==='MLB')document.querySelectorAll('.player-card[data-player-id],.pick-one-card[data-player-id],.top-target[data-player-id]').forEach(el=>mountCardPrice(el,{sport:'MLB',player:el.dataset.playerName||el.dataset.player,playerId:el.dataset.playerId,gameId:el.dataset.gameId,team:el.dataset.team}));};new MutationObserver(scan).observe(document.body,{childList:true,subtree:true});scan();
}
if(typeof window!=='undefined'&&typeof document!=='undefined')init();
