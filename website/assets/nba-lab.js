import { MARKETS, baselineFor, classifyLastFive, gameValue } from "./nba-prop-trends.mjs";

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = value => number(value) === null ? "—" : Number(value).toFixed(1);
const et = value => new Date(value).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const image = id => `https://a.espncdn.com/i/headshots/nba/players/full/${encodeURIComponent(id)}.png`;
const state = { data: null, market: "points", game: "all", tier: "all", query: "" };

async function getJSON(file) {
  const response = await fetch(`./data/${file}?v=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${file} unavailable`);
  return response.json();
}
async function load() {
  try {
    const files = ["nba_games_today.json", "nba_player_cards.json", "nba_points.json", "nba_rebounds.json", "nba_assists.json", "nba_threes.json", "nba_first_basket.json"];
    const [games, cards, points, rebounds, assists, threes, firstBasket] = await Promise.all(files.map(getJSON));
    const markets = { lines: [], status: "not_loaded" };
    Object.assign(markets, await getJSON("nba_market_lines.json").catch(() => ({})));
    state.data = { games: games.games || [], date: games.date, fetchedAt: points.fetchedAt, cards: cards.players || [], firstBasket, markets, models: { points: points.players || [], rebounds: rebounds.players || [], assists: assists.players || [], threes: threes.players || [] } };
    state.data.cardMap = new Map(state.data.cards.map(card => [String(card.playerId), card]));
    state.data.modelMaps = Object.fromEntries(Object.entries(state.data.models).map(([market, rows]) => [market, new Map(rows.map(row => [String(row.playerId), row]))]));
    state.data.lineMap = new Map((markets.lines || []).map(line => [`${line.playerId}:${line.market}`, line]));
    $("#headerState").textContent = `TODAY · ${state.data.games.length} GAMES`;
    $("#globalNotice").className = "notice good";
    $("#globalNotice").innerHTML = `<strong>${state.data.cards.length} players loaded.</strong> ${(markets.lines || []).length ? `${markets.lines.length} verified paired sportsbook lines.` : "No authorized matching sportsbook lines are available, so no prices are being invented."}`;
    render();
  } catch (error) {
    $("#globalNotice").className = "notice warn";
    $("#globalNotice").textContent = `NBA data unavailable: ${error.message}`;
    $("#viewRoot").innerHTML = '<div class="empty">The board will not substitute stale or fabricated player data.</div>';
  }
}

const gameLabel = game => `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
const modelFor = (playerId, market) => state.data.modelMaps[market]?.get(String(playerId));
function projectionFor(card, market) {
  const points = number(modelFor(card.playerId, "points")?.pointsLean);
  const rebounds = number(modelFor(card.playerId, "rebounds")?.reboundsLean);
  const assists = number(modelFor(card.playerId, "assists")?.assistsLean);
  const threes = number(modelFor(card.playerId, "threes")?.threesLean);
  if (market === "points") return points;
  if (market === "rebounds") return rebounds;
  if (market === "assists") return assists;
  if (market === "threes") return threes;
  if (market === "pra" && [points, rebounds, assists].every(value => value !== null)) return points + rebounds + assists;
  if (market === "pointsRebounds" && [points, rebounds].every(value => value !== null)) return points + rebounds;
  if (market === "reboundsAssists" && [rebounds, assists].every(value => value !== null)) return rebounds + assists;
  return null;
}
function tierFor(card, market) {
  const values = (card.recentGames || []).slice(0, 5).map(game => gameValue(game, market));
  return classifyLastFive(values, baselineFor(card, market), { binary: market === "doubleDouble" || market === "tripleDouble" });
}
function lineFor(card, market) {
  const supported = { points: "points", rebounds: "rebounds", assists: "assists", threes: "threes" }[market];
  return supported ? state.data.lineMap.get(`${card.playerId}:${supported}`) : null;
}
function playerRows() {
  return state.data.cards.map(card => {
    const tier = tierFor(card, state.market);
    return { card, tier, values: (card.recentGames || []).slice(0, 5).map(game => gameValue(game, state.market)), projection: projectionFor(card, state.market), line: lineFor(card, state.market) };
  }).filter(row => (state.game === "all" || String(row.card.gameId) === state.game) && (state.tier === "all" || row.tier.key === state.tier) && (!state.query || `${row.card.player} ${row.card.team} ${row.card.opponent}`.toLowerCase().includes(state.query.toLowerCase()))).sort((a, b) => {
    const order = { hot: 4, good: 3, sleeper: 2, cold: 1, unrated: 0 };
    return order[b.tier.key] - order[a.tier.key] || (b.tier.average || 0) - (a.tier.average || 0);
  });
}

function gameChips() {
  return `<div class="props-games"><button class="${state.game === "all" ? "active" : ""}" data-game="all"><b>All games</b><span>${state.data.games.length} matchups</span></button>${state.data.games.map(game => `<button class="${state.game === String(game.gameId) ? "active" : ""}" data-game="${esc(game.gameId)}"><b>${esc(gameLabel(game))}</b><span>${et(game.gameTimeUTC)} ET</span></button>`).join("")}</div>`;
}
function marketTabs() {
  return `<div class="props-markets" role="tablist">${MARKETS.map(([key, label]) => `<button role="tab" aria-selected="${state.market === key}" class="${state.market === key ? "active" : ""}" data-market="${key}">${label}</button>`).join("")}</div>`;
}
function controls() {
  return `<div class="props-controls"><label>Find a player<input id="playerSearch" type="search" value="${esc(state.query)}" placeholder="Search player or team"></label><label>Trend tier<select id="tierFilter"><option value="all">All tiers</option>${[["hot","Hot look"],["good","Good chance"],["sleeper","Sleeper"],["cold","Cold"],["unrated","Needs 5 games"]].map(([key,label]) => `<option value="${key}" ${state.tier === key ? "selected" : ""}>${label}</option>`).join("")}</select></label></div>`;
}
function recentCells(row) {
  if (row.values.length < 5 || row.values.some(value => value === null)) return '<span class="sample-missing">Fewer than 5</span>';
  const binary = state.market === "doubleDouble" || state.market === "tripleDouble";
  return `<div class="last-five">${row.values.map(value => `<span>${binary ? (value ? "✓" : "—") : fmt(value)}</span>`).join("")}</div>`;
}
function priceCell(row) {
  if (!row.line) return '<span class="no-line">No verified line</span>';
  return `<b>${fmt(row.line.line)}</b><small>${esc(row.line.book)} · O ${row.line.overOdds > 0 ? "+" : ""}${row.line.overOdds}</small>`;
}
function bestPlayerAngle(card) {
  return MARKETS.filter(([market]) => !["firstBasket", "doubleDouble", "tripleDouble"].includes(market)).map(([market, label]) => {
    const tier = tierFor(card, market), baseline = baselineFor(card, market);
    const values = (card.recentGames || []).slice(0, 5).map(game => gameValue(game, market));
    const average = values.length === 5 && values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) / 5 : null;
    const score = ({ hot: 4, good: 3, sleeper: 2, cold: 1, unrated: 0 }[tier.key] || 0) * 100 + (average !== null && number(baseline) !== null ? average - Number(baseline) : 0);
    return { label, tier, average, score };
  }).sort((a, b) => b.score - a.score)[0];
}
function teamPickBoards() {
  const cardsByGame = new Map();
  state.data.cards.forEach(card => cardsByGame.set(String(card.gameId), [...(cardsByGame.get(String(card.gameId)) || []), card]));
  return `<section class="team-picks"><div class="feature-heading"><div><span>Best picks by matchup</span><h2>Five to look at</h2></div><p>Each player appears once with his strongest last-five category. Form evidence, not a promise.</p></div><div class="team-pick-grid">${state.data.games.map(game => { const picks = (cardsByGame.get(String(game.gameId)) || []).map(card => ({ card, angle: bestPlayerAngle(card) })).filter(row => row.angle?.tier.key !== "unrated").sort((a, b) => b.angle.score - a.angle.score).slice(0, 5); return `<article class="team-pick-card"><header><div><span>Five to look at</span><h3>${esc(gameLabel(game))}</h3></div><small>${et(game.gameTimeUTC)} ET</small></header><ol>${picks.map((row, index) => `<li class="${row.angle.tier.key}"><b>${index + 1}</b><div><strong>${esc(row.card.player)}</strong><small>${esc(row.card.team)} · ${esc(row.angle.label)} · L5 avg ${fmt(row.angle.average)}</small></div><span>${esc(row.angle.tier.label)}</span></li>`).join("") || '<li class="empty-pick">Waiting for five verified games.</li>'}</ol></article>`; }).join("")}</div></section>`;
}
function vulnerableDefenses() {
  const defenses = [...new Map(state.data.cards.map(card => [card.opponent, card.matchup?.defense]).filter(([, defense]) => defense && number(defense.pointsAllowed) !== null)).values()].sort((a, b) => Number(b.rankPointsAllowed || 0) - Number(a.rankPointsAllowed || 0)).slice(0, 5);
  return `<section class="vulnerability-board"><div class="feature-heading"><div><span>Defense targets</span><h2>Most vulnerable defenses</h2></div><p>Ranked by verified points allowed on today’s slate.</p></div><div class="vulnerability-grid">${defenses.map((defense, index) => `<article><b>${String(index + 1).padStart(2, "0")}</b><div><strong>${esc(defense.opponent)}</strong><span>${fmt(defense.pointsAllowed)} points allowed</span><small>NBA rank ${esc(defense.rankPointsAllowed)} · ${esc(defense.defensiveTier)}</small></div></article>`).join("") || '<div class="empty">Defense context is not available for this slate.</div>'}</div></section>`;
}
function standardBoard() {
  const rows = playerRows();
  const binary = state.market === "doubleDouble" || state.market === "tripleDouble";
  return `${controls()}<div class="board-summary"><strong>${rows.length} players</strong><span>${binary ? "Last-five occurrence rate" : "Form compared with season baseline"}</span></div><div class="props-table-wrap"><table class="props-table"><thead><tr><th>Player / matchup</th><th>Trend</th><th>Last 5</th><th>${binary ? "L5 rate" : "L5 avg"}</th><th>${binary ? "Season model" : "Model"}</th><th>Verified line</th></tr></thead><tbody>${rows.map(row => `<tr class="tier-row ${row.tier.key}"><td><button class="player-cell" data-player="${esc(row.card.playerId)}"><img src="${image(row.card.playerId)}" alt="" loading="lazy"><span><strong>${esc(row.card.player)}</strong><small>${esc(row.card.team)} ${row.card.homeAway === "AWAY" ? "@" : "vs"} ${esc(row.card.opponent)} · ${et(row.card.gameTimeUTC)} ET</small></span></button></td><td><span class="tier-badge ${row.tier.key}">${esc(row.tier.label)}</span><small>${row.tier.hitCount === null ? "Sample incomplete" : `${row.tier.hitCount}/5 at or above baseline`}</small></td><td>${recentCells(row)}</td><td><b>${binary && row.tier.average !== null ? `${Math.round(row.tier.average * 100)}%` : fmt(row.tier.average)}</b><small>${binary ? "verified outcomes" : `season ${fmt(baselineFor(row.card, state.market))}`}</small></td><td><b>${binary ? "—" : fmt(row.projection)}</b><small>${binary ? "No fabricated probability" : "projection"}</small></td><td>${priceCell(row)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No players match these filters.</td></tr>'}</tbody></table></div>`;
}
function firstBasketBoard() {
  const rows = (state.data.firstBasket.games || []).flatMap(game => game.players.map(player => ({ ...player, gameId: game.gameId, matchup: game.matchup, gameTimeUTC: game.gameTimeUTC }))).map(player => ({ player, tier: classifyLastFive(player.lastFive?.results || [], null, { binary: true }) })).filter(row => (state.game === "all" || String(row.player.gameId) === state.game) && (state.tier === "all" || row.tier.key === state.tier) && (!state.query || `${row.player.player} ${row.player.team}`.toLowerCase().includes(state.query.toLowerCase()))).sort((a,b) => b.player.probability - a.player.probability);
  return `${controls()}<div class="first-basket-note"><strong>First made field goal only.</strong> Trend colors use each player’s last five verified starts; probability still uses the validated full-history model and confirmed-lineup gate.</div><div class="props-table-wrap"><table class="props-table"><thead><tr><th>Player / matchup</th><th>Trend</th><th>Last 5 starts</th><th>Model probability</th><th>Fair odds</th><th>Lineup status</th></tr></thead><tbody>${rows.map(row => `<tr class="tier-row ${row.tier.key}"><td><span class="player-cell"><img src="${image(row.player.playerId)}" alt="" loading="lazy"><span><strong>${esc(row.player.player)}</strong><small>${esc(row.player.team)} · ${esc(row.player.matchup)} · ${et(row.player.gameTimeUTC)} ET</small></span></span></td><td><span class="tier-badge ${row.tier.key}">${esc(row.tier.label)}</span></td><td><div class="last-five">${(row.player.lastFive?.results || []).map(value => `<span>${value ? "✓" : "—"}</span>`).join("") || '<span>—</span>'}</div></td><td><b>${fmt(row.player.probabilityPct)}%</b><small>${row.player.evidence.firstBaskets}/${row.player.evidence.starterGames} career evidence</small></td><td><b>${row.player.fairAmericanOdds > 0 ? "+" : ""}${row.player.fairAmericanOdds}</b><small>model fair price</small></td><td><span class="${row.player.publicationEligible ? "publish-ready" : "no-line"}">${esc(row.player.publicationEligible ? row.player.confidence : "CONTEXT ONLY")}</span></td></tr>`).join("") || '<tr><td colspan="6" class="empty">No verified first-basket candidates match these filters.</td></tr>'}</tbody></table></div>`;
}
function showPlayer(id) {
  const card = state.data.cardMap.get(String(id)); if (!card) return;
  const games = (card.recentGames || []).slice(0, 5).map(game => `<tr><td>${new Date(game.date).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" })}</td><td>${esc(game.matchup)}</td><td>${fmt(game.points)}</td><td>${fmt(game.rebounds)}</td><td>${fmt(game.assists)}</td><td>${fmt(game.threesMade)}</td></tr>`).join("");
  $("#playerDetail").innerHTML = `<div class="nba-profile-head"><img src="${image(id)}" alt=""><div><div class="kicker">${esc(card.team)} · ${esc(card.position || "—")}</div><h2 id="playerDialogTitle">${esc(card.player)}</h2><p>${esc(card.team)} ${card.homeAway === "AWAY" ? "@" : "vs"} ${esc(card.opponent)} · ${esc(card.gameStatusText)}</p></div></div><h3 class="recent-title">Projection breakdown</h3><div class="profile-metrics"><div><span>Points</span><strong>${fmt(projectionFor(card, "points"))}</strong></div><div><span>Rebounds</span><strong>${fmt(projectionFor(card, "rebounds"))}</strong></div><div><span>Assists</span><strong>${fmt(projectionFor(card, "assists"))}</strong></div><div><span>Threes</span><strong>${fmt(projectionFor(card, "threes"))}</strong></div></div><h3 class="recent-title">Opponent matchup</h3><p class="nba-player-note">${esc(card.matchup?.opponentContext || "Opponent context pending")} · ${esc(card.matchup?.paceContext || "Pace context pending")}</p><h3 class="recent-title">Recent scoring evidence · verified last five games</h3><div class="recent-table"><table><thead><tr><th>Date</th><th>Matchup</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th></tr></thead><tbody>${games || '<tr><td colspan="6">No verified recent games.</td></tr>'}</tbody></table></div>`;
  $("#playerDialog").showModal();
}
function render() {
  if (!state.data) return;
  $("#viewRoot").innerHTML = `<div class="slate-heading"><div><span>Today (ET)</span><strong>${esc(state.data.date)}</strong></div><small>Updated ${et(state.data.fetchedAt)} ET</small></div>${teamPickBoards()}${vulnerableDefenses()}${gameChips()}${marketTabs()}${state.market === "firstBasket" ? firstBasketBoard() : standardBoard()}`;
  $("#playerSearch")?.addEventListener("input", event => { state.query = event.target.value; render(); const input = $("#playerSearch"); input.focus(); input.setSelectionRange(state.query.length, state.query.length); });
  $("#tierFilter")?.addEventListener("change", event => { state.tier = event.target.value; render(); });
}
document.addEventListener("click", event => {
  const game = event.target.closest("[data-game]"); if (game) { state.game = game.dataset.game; render(); }
  const market = event.target.closest("[data-market]"); if (market) { state.market = market.dataset.market; state.tier = "all"; render(); }
  const player = event.target.closest("[data-player]"); if (player) showPlayer(player.dataset.player);
  if (event.target.closest("[data-retry]")) load();
});
$("#closePlayer").addEventListener("click", () => $("#playerDialog").close());
load();
