const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const n = value => Number.isFinite(Number(value)) ? Number(value) : null;
const fmt = value => n(value) === null ? "—" : Number(value).toFixed(1);
const et = value => new Date(value).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const image = id => `https://a.espncdn.com/i/headshots/nba/players/full/${encodeURIComponent(id)}.png`;
const configs = {
  points: { label: "Points", lean: "pointsLean", score: "pointsScore", season: "seasonPoints", last5: "last5Points", role: "scoringRole" },
  rebounds: { label: "Rebounds", lean: "reboundsLean", score: "reboundsScore", season: "seasonRebounds", last5: "last5Rebounds", role: "reboundRole" },
  assists: { label: "Assists", lean: "assistsLean", score: "assistsScore", season: "seasonAssists", last5: "last5Assists", role: "assistRole" },
  threes: { label: "3-Pointers", lean: "threesLean", score: "threesScore", season: "seasonThrees", last5: "last5Threes", role: "threesRole" }
};
const descriptions = {
  dashboard: ["NBA Slate Dashboard", "One command center for the schedule, strongest model signals, rotations, and verified market availability."],
  games: ["Game Sheets", "Matchup-by-matchup context with game time, arena, player pool, model leaders, and availability."],
  points: ["Points Model", "Scoring projections ranked by model strength, expected minutes, usage, matchup, and current availability."],
  rebounds: ["Rebounds Model", "Rebound projections ranked by role, minutes, recent baseline, matchup, and model strength."],
  assists: ["Assists Model", "Assist projections ranked by playmaking role, usage, minutes, matchup, and model strength."],
  threes: ["3-Pointers Model", "Made-three projections ranked by shooting role, volume profile, minutes, and model strength."],
  matchups: ["Best Matchups", "The slate’s strongest player environments, ranked by matchup score and contextual model signals."],
  availability: ["Availability", "Reported injury information for today’s teams. Unlisted never means confirmed active."]
};
const savedStars = JSON.parse(localStorage.getItem("tsl-nba-stars") || "[]");
const state = { data: null, view: "dashboard", query: "", team: "", game: "all", grade: "all", status: "all", sort: "score", direction: -1, starred: false, stars: new Set(savedStars) };

async function getJSON(file) {
  const response = await fetch(`./data/${file}?v=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
  if (!response.ok) throw new Error(`${file} unavailable`);
  return response.json();
}

async function load() {
  try {
    const files = ["nba_games_today.json", "nba_player_cards.json", "nba_points.json", "nba_rebounds.json", "nba_assists.json", "nba_threes.json", "nba_matchup_engine.json", "nba_decision_center.json", "nba_availability.json", "nba_market_lines.json"];
    const [games, cards, points, rebounds, assists, threes, matchups, decisions, availability, markets] = await Promise.all(files.map(getJSON));
    state.data = {
      games: games.games, date: games.date, fetchedAt: points.fetchedAt, season: points.season, decisions, availability, markets,
      cardMap: new Map(cards.players.map(row => [String(row.playerId), row])),
      matchupMap: new Map(matchups.players.map(row => [String(row.playerId), row])),
      models: { points: points.players, rebounds: rebounds.players, assists: assists.players, threes: threes.players }
    };
    $("#slateDate").textContent = games.date;
    $("#slateState").textContent = `${games.games.length} games · ${points.players.length} players`;
    $("#sideUpdated").textContent = `Checked ${et(points.fetchedAt)} ET`;
    $("#headerState").textContent = `TODAY · ${games.games.length} GAMES`;
    $("#globalNotice").className = "notice good";
    $("#globalNotice").innerHTML = `<strong>Model workspace live.</strong> ${points.players.length} players across ${games.games.length} games · market lines ${markets.lines.length ? "verified" : "withheld because no authorized matching quotes were found"}.`;
    render();
  } catch (error) {
    $("#globalNotice").className = "notice warn";
    $("#globalNotice").textContent = "The NBA model workspace could not load all required datasets.";
    $("#viewRoot").innerHTML = `<div class="empty"><strong>NBA data unavailable.</strong><p>${esc(error.message)}</p><button class="nba-refresh" data-retry>Retry</button></div>`;
  }
}

const gameLabel = game => `${game.awayTeam.abbreviation} @ ${game.homeTeam.abbreviation}`;
const gameFor = id => state.data.games.find(game => String(game.gameId) === String(id));
const grade = score => score >= 80 ? ["A+", "elite"] : score >= 72 ? ["A", "strong"] : score >= 64 ? ["B", "good"] : score >= 55 ? ["C", "watch"] : ["D", "low"];
function trend(row, config) {
  const delta = (n(row[config.last5]) || 0) - (n(row[config.season]) || 0);
  return delta > .35 ? ["Rising", "up"] : delta < -.35 ? ["Cooling", "down"] : ["Stable", "flat"];
}

function slateChips() {
  return `<div class="slate-chips"><button class="${state.game === "all" ? "active" : ""}" data-game="all">All ${state.data.games.length}</button>${state.data.games.map(game => `<button class="${state.game === String(game.gameId) ? "active" : ""}" data-game="${esc(game.gameId)}"><b>${esc(gameLabel(game))}</b><span>${et(game.gameTimeUTC)} ET</span></button>`).join("")}</div>`;
}

function filteredRows(market) {
  const config = configs[market];
  let rows = state.data.models[market].filter(row =>
    (!state.query || `${row.player} ${row.team} ${row.opponent}`.toLowerCase().includes(state.query.toLowerCase())) &&
    (!state.team || row.team === state.team) && (state.game === "all" || String(row.gameId) === state.game) &&
    (state.status === "all" || row.availabilityStatus === state.status) && (!state.starred || state.stars.has(String(row.playerId)))
  );
  if (state.grade !== "all") rows = rows.filter(row => grade(n(row[config.score]) || 0)[0].startsWith(state.grade));
  const field = state.sort === "projection" ? config.lean : state.sort === "minutes" ? "expectedMinutes" : state.sort === "player" ? "player" : config.score;
  return rows.sort((a, b) => typeof a[field] === "string" ? state.direction * a[field].localeCompare(b[field]) : state.direction * ((n(a[field]) || 0) - (n(b[field]) || 0)));
}

function filters(market) {
  const teams = [...new Set(state.data.models[market].map(row => row.team))].sort();
  return `<div class="model-controls"><label>Player<input id="playerSearch" type="search" value="${esc(state.query)}" placeholder="Search player…"></label><label>Grade<select id="gradeFilter"><option value="all">All Grades</option>${["A","B","C","D"].map(value => `<option ${state.grade === value ? "selected" : ""}>${value}</option>`).join("")}</select></label><label>Status<select id="statusFilter"><option value="all">All Statuses</option><option value="ROSTER_ACTIVE" ${state.status === "ROSTER_ACTIVE" ? "selected" : ""}>Roster Active</option><option value="UNKNOWN" ${state.status === "UNKNOWN" ? "selected" : ""}>Unconfirmed</option></select></label><label>Team<select id="teamFilter"><option value="">All Teams</option>${teams.map(team => `<option ${state.team === team ? "selected" : ""}>${team}</option>`).join("")}</select></label><button class="star-filter ${state.starred ? "active" : ""}" data-star-filter>★ Starred</button></div>`;
}

function modelRow(row, config) {
  const score = n(row[config.score]) || 0;
  const [letter, tone] = grade(score), [movement, movementTone] = trend(row, config);
  return `<tr><td><button class="star ${state.stars.has(String(row.playerId)) ? "active" : ""}" data-star="${esc(row.playerId)}" aria-label="Star ${esc(row.player)}">★</button></td><td><button class="player-cell" data-player="${esc(row.playerId)}"><img src="${image(row.playerId)}" alt="" loading="lazy"><span><strong>${esc(row.player)}</strong><small>${esc(row.team)} · ${esc(row.position || "—")}</small></span></button></td><td><b>${row.homeAway === "AWAY" ? "@" : "vs"} ${esc(row.opponent)}</b><small>${esc(row.gameStatusText || "")}</small></td><td class="projection">${fmt(row[config.lean])}<small>${esc(config.label)}</small></td><td><span class="trend ${movementTone}">${movement}</span><small>L5 vs season</small></td><td>${fmt(row.expectedMinutes)}<small>${esc(row.minutesRole || "Role pending")}</small></td><td>${esc(row[config.role] || row.usageTier || "Profile")}</td><td><strong>${fmt(score)}</strong><div class="scorebar"><i style="width:${Math.min(100, score)}%"></i></div></td><td><span class="grade ${tone}">${letter}</span><small>${esc(row.confidence || "")}</small></td><td><span class="no-line">Not verified</span></td></tr>`;
}

function modelTable(market) {
  const config = configs[market], rows = filteredRows(market);
  return `${slateChips()}${filters(market)}<div class="board-meta"><div><strong>${rows.length}</strong> players</div><div class="market-gate"><i></i>${state.data.markets.lines.length ? `${state.data.markets.lines.length} verified lines` : "Projection mode · no verified lines"}</div></div><div class="model-table-wrap"><table class="model-table"><thead><tr><th></th><th data-sort="player">Player</th><th>Matchup</th><th data-sort="projection">Projection</th><th>Trend</th><th data-sort="minutes">Minutes</th><th>Role</th><th data-sort="score">Model Score</th><th>Grade</th><th>Market Line</th></tr></thead><tbody>${rows.map(row => modelRow(row, config)).join("") || '<tr><td colspan="10" class="empty">No players match these filters.</td></tr>'}</tbody></table></div>`;
}

function gameGrid() {
  return `<div class="game-grid">${state.data.games.map(game => {
    const rows = state.data.models.points.filter(row => String(row.gameId) === String(game.gameId));
    const best = [...rows].sort((a, b) => b.pointsScore - a.pointsScore)[0];
    return `<article class="game-card"><div class="game-top"><span>${esc(game.arena || "Arena pending")}</span><b>${et(game.gameTimeUTC)} ET</b></div><div class="matchup"><div class="team"><strong>${esc(game.awayTeam.abbreviation)}</strong><small>${esc(game.awayTeam.team)}</small></div><div class="score">@</div><div class="team home"><strong>${esc(game.homeTeam.abbreviation)}</strong><small>${esc(game.homeTeam.team)}</small></div></div><div class="game-insights"><span>Player pool <b>${rows.length}</b></span><span>Top signal <b>${best ? esc(best.player) : "Pending"}</b></span></div><button data-open-game="${esc(game.gameId)}">Open game sheet →</button></article>`;
  }).join("")}</div>`;
}

function dashboard() {
  const top = state.data.decisions.sections.topOverallPlays || [];
  const strong = state.data.models.points.filter(row => row.pointsScore >= 72).length;
  return `<section class="hero-grid"><article class="command-card"><div class="kicker">TODAY / NBA COMMAND CENTER</div><h2>${state.data.games.length} games.<br><em>Every signal in one place.</em></h2><p>Move from slate to matchup to player projection without losing context. No invented odds, no hidden stale lines.</p><div class="hero-actions"><button data-jump="points">Open model board</button><button data-jump="games">View game sheets</button></div></article><div class="pulse-grid"><article><span>Players modeled</span><strong>${state.data.models.points.length}</strong><small>Four projection markets</small></article><article><span>Publication eligible</span><strong>${state.data.models.points.filter(row => row.publicationEligible).length}</strong><small>Current availability rules</small></article><article><span>Strong signals</span><strong>${strong}</strong><small>Points score ≥ 72</small></article><article><span>Verified lines</span><strong>${state.data.markets.lines.length}</strong><small>${state.data.markets.lines.length ? "Authorized matches" : "Market gate closed"}</small></article></div></section>${slateChips()}<div class="section-bar"><h2>Top model signals</h2><p>Cross-market ranking · projections are not sportsbook lines</p></div><div class="signal-grid">${top.slice(0, 6).map((row, index) => `<article><span class="rank">0${index + 1}</span><img src="${image(row.playerId)}" alt=""><div><b>${esc(row.player)}</b><small>${esc(row.team)} ${row.homeAway === "AWAY" ? "@" : "vs"} ${esc(row.opponent)}</small></div><strong>${fmt(row.bestMarketProjection)} <small>${esc(row.bestMarket)}</small></strong><span class="grade ${grade(row.bestMarketScore)[1]}">${grade(row.bestMarketScore)[0]}</span></article>`).join("")}</div><div class="section-bar"><h2>Game runway</h2><p>Eastern time · open any sheet for its player pool</p></div>${gameGrid()}`;
}

function gameDetail(id) {
  const game = gameFor(id); if (!game) return "";
  const all = state.data.models.points.filter(row => String(row.gameId) === String(id));
  const rows = [...all].sort((a, b) => b.pointsScore - a.pointsScore).slice(0, 8);
  return `<section class="game-detail"><div><span>GAME SHEET</span><h2>${esc(gameLabel(game))}</h2><p>${et(game.gameTimeUTC)} ET · ${esc(game.arena || "Arena pending")} · ${all.length} modeled players</p></div><div class="game-leaders">${rows.map(row => `<button data-player="${esc(row.playerId)}"><img src="${image(row.playerId)}" alt=""><span><b>${esc(row.player)}</b><small>${fmt(row.pointsLean)} PTS · ${fmt(row.expectedMinutes)} MIN</small></span><strong>${grade(row.pointsScore)[0]}</strong></button>`).join("")}</div></section>`;
}
function gamesView() { return `${slateChips()}<div class="section-bar"><h2>Today’s game sheets</h2><p>Schedule, model leaders, player count, and injury context</p></div>${gameGrid()}${state.game !== "all" ? gameDetail(state.game) : ""}`; }

function matchupView() {
  const rows = [...state.data.matchupMap.values()].filter(row => row.publicationEligible).sort((a, b) => (b.matchupScore || 0) - (a.matchupScore || 0));
  return `${slateChips()}<div class="section-bar"><h2>Best player environments</h2><p>Matchup score, contextual signals, minutes, and role</p></div><div class="matchup-board">${rows.slice(0, 30).map(row => `<article><span class="grade ${grade(row.matchupScore)[1]}">${grade(row.matchupScore)[0]}</span><img src="${image(row.playerId)}" alt=""><div><b>${esc(row.player)}</b><small>${esc(row.team)} ${row.homeAway === "AWAY" ? "@" : "vs"} ${esc(row.opponent)} · ${esc(row.position)}</small><p>${esc(row.matchupTier)} · ${esc(row.minutesRole)} · ${esc(row.scoringRole || "Role profile")}</p></div><strong>${fmt(row.matchupScore)}<small>matchup</small></strong></article>`).join("")}</div>`;
}
function availabilityView() {
  const rows = state.data.availability.players || [];
  const flagged = rows.filter(row => row.injury || row.availabilityStatus !== "ROSTER_ACTIVE");
  return `<div class="section-bar"><h2>Availability watch</h2><p>${state.data.availability.reportedInjuryCount || 0} reports · missing report never means active</p></div><div class="availability-grid">${flagged.map(row => `<article class="availability-card"><b>${esc(row.player)} · ${esc(row.team)}</b><span><strong>${esc(row.availabilityStatus)}</strong>${row.injury?.status ? ` · ${esc(row.injury.status)}` : " · game status unconfirmed"}</span></article>`).join("") || '<div class="empty">No matched injury reports. Game availability remains unconfirmed until official reporting.</div>'}</div>`;
}

function showPlayer(id) {
  const card = state.data.cardMap.get(String(id)); if (!card) return;
  $("#playerDetail").innerHTML = `<div class="nba-profile-head"><img src="${image(id)}" alt=""><div><div class="kicker">${esc(card.team)} · ${esc(card.position)} · ${esc(card.homeAway)}</div><h2 id="playerDialogTitle">${esc(card.player)}</h2><p>${esc(card.team)} vs ${esc(card.opponent)} · ${esc(card.gameStatusText)}</p></div></div><div class="profile-metrics">${[["Points", card.production.seasonPoints], ["Rebounds", card.production.seasonRebounds], ["Assists", card.production.seasonAssists], ["Threes", card.production.seasonThrees], ["Expected MIN", card.minutes.expected], ["Matchup", card.matchup.matchupScore]].map(([label, value]) => `<div><span>${label}</span><strong>${fmt(value)}</strong></div>`).join("")}</div><div class="profile-columns"><div><h3>Model read</h3><p>${esc(card.headline.scoringRole)} · ${esc(card.minutes.role)} · ${esc(card.usage.tier)}</p><div class="tag-row">${card.tags.map(tag => `<span>${esc(tag)}</span>`).join("")}</div></div><div><h3>Data status</h3><p>Current schedule, roster, season baseline, minutes, usage, and matchup engines. Sportsbook lines appear only after authorized identity matching.</p></div></div>`;
  $("#playerDialog").showModal();
}

function bindControls() {
  $("#playerSearch")?.addEventListener("input", event => { state.query = event.target.value; render(); const input = $("#playerSearch"); input.focus(); input.setSelectionRange(state.query.length, state.query.length); });
  $("#teamFilter")?.addEventListener("change", event => { state.team = event.target.value; render(); });
  $("#gradeFilter")?.addEventListener("change", event => { state.grade = event.target.value; render(); });
  $("#statusFilter")?.addEventListener("change", event => { state.status = event.target.value; render(); });
}
function render() {
  if (!state.data) return;
  const [title, description] = descriptions[state.view] || descriptions.dashboard;
  $("#viewTitle").textContent = title; $("#viewDescription").textContent = description; $("#mobileView").value = state.view;
  document.querySelectorAll("[data-view]").forEach(el => el.classList.toggle("active", el.dataset.view === state.view));
  $("#viewRoot").innerHTML = state.view === "dashboard" ? dashboard() : state.view === "games" ? gamesView() : configs[state.view] ? modelTable(state.view) : state.view === "matchups" ? matchupView() : availabilityView();
  bindControls();
}
function changeView(view) { state.view = descriptions[view] ? view : "dashboard"; state.game = "all"; window.scrollTo({ top: 0, behavior: "smooth" }); render(); }
function fromHash() { changeView(location.hash.slice(1) || "dashboard"); }

document.addEventListener("click", event => {
  const nav = event.target.closest("[data-view],[data-jump]"); if (nav) location.hash = nav.dataset.view || nav.dataset.jump;
  const game = event.target.closest("[data-game]"); if (game) { state.game = game.dataset.game; render(); }
  const openGame = event.target.closest("[data-open-game]"); if (openGame) { state.game = openGame.dataset.openGame; state.view = "games"; render(); document.querySelector(".game-detail")?.scrollIntoView({ behavior: "smooth" }); }
  const star = event.target.closest("[data-star]"); if (star) { const id = star.dataset.star; state.stars.has(id) ? state.stars.delete(id) : state.stars.add(id); localStorage.setItem("tsl-nba-stars", JSON.stringify([...state.stars])); render(); }
  if (event.target.closest("[data-star-filter]")) { state.starred = !state.starred; render(); }
  const sort = event.target.closest("[data-sort]"); if (sort) { if (state.sort === sort.dataset.sort) state.direction *= -1; else { state.sort = sort.dataset.sort; state.direction = state.sort === "player" ? 1 : -1; } render(); }
  const player = event.target.closest("[data-player]"); if (player) showPlayer(player.dataset.player);
  if (event.target.closest("[data-retry]")) load();
});
$("#mobileView").addEventListener("change", event => { location.hash = event.target.value; });
$("#closePlayer").addEventListener("click", () => $("#playerDialog").close());
window.addEventListener("hashchange", fromHash);
fromHash();
load();
