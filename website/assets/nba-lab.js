const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const stat = value => Number.isFinite(value) ? Number(value).toFixed(1) : "—";
const time = value => new Date(value).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const state = { data: null, view: "dashboard", market: "all", query: "", team: "", loading: false, detailRequest: 0 };
const descriptions = {
  dashboard: ["Dashboard", "Today’s games, current rosters, injury reports, and real player game logs."],
  games: ["Game Lab", "Every matchup and score on today’s NBA slate. Times are Eastern."],
  players: ["Player Board", "Current rosters for today’s slate. Open a player for current-season stats and recent game logs."],
  availability: ["Availability", "Reported injuries for today’s teams. An unlisted player is not confirmed active."]
};
const markets = { points: ["Points", "pointsPerGame"], rebounds: ["Rebounds", "reboundsPerGame"], assists: ["Assists", "assistsPerGame"] };

async function getJSON(file) {
  const response = await fetch(`./data/${file}?v=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(25000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || "The NBA feed could not be reached."), { status: response.status });
  return payload;
}

function stats() {
  const data = state.data;
  return `<div class="stat-strip"><div class="stat"><span>Games today</span><strong>${data.games.length}</strong><small>${esc(data.date)}</small></div><div class="stat"><span>Live now</span><strong>${data.games.filter(game => game.state === "in").length}</strong><small>Current scoreboard</small></div><div class="stat"><span>Players</span><strong>${data.players.length}</strong><small>Current team rosters</small></div><div class="stat"><span>Injury reports</span><strong>${data.panels.injuries === "current" ? data.injuries.length : "—"}</strong><small>${data.panels.injuries === "current" ? "Today’s teams" : "Feed unavailable"}</small></div></div>`;
}

function teamMarkup(team, home = false) {
  return `<div class="team ${home ? "home" : ""}">${team.logo ? `<img src="${esc(team.logo)}" alt="" loading="lazy">` : ""}<div><strong>${esc(team.name)}</strong><small>${esc(team.record || "Record pending")}</small></div></div>`;
}

function gameCard(game) {
  const reportCount = state.data.injuries.filter(injury => [game.home.name, game.away.name].includes(injury.team)).length;
  return `<article class="game-card"><div class="game-top"><span>${esc(game.venue)}</span><b class="${game.state === "in" ? "live" : ""}">${esc(game.state === "pre" ? `${time(game.date)} ET` : game.status)}</b></div><div class="matchup">${teamMarkup(game.away)}<div class="score">${game.state === "pre" ? "@" : `${game.away.score ?? "—"}–${game.home.score ?? "—"}`}</div>${teamMarkup(game.home, true)}</div><div class="game-meta"><div><b>Availability</b>${state.data.panels.injuries === "current" ? `${reportCount} reported ${reportCount === 1 ? "injury" : "injuries"}` : "Injury feed unavailable"}</div><div><b>Game status</b>${esc(game.status)}</div></div></article>`;
}

function gamesSection(limit = Infinity) {
  return `<div class="section-bar"><h2>Today’s NBA slate</h2><p>${state.data.games.length} games · Eastern time</p></div><div class="game-grid">${state.data.games.length ? state.data.games.slice(0, limit).map(gameCard).join("") : '<div class="empty">The current date-specific schedule has no NBA games today.</div>'}</div>`;
}

function dashboard() {
  const leaders = Object.entries(markets).map(([, [label, key]]) => {
    const row = state.data.players.filter(player => Number.isFinite(player.leaderStats[key])).sort((a, b) => b.leaderStats[key] - a.leaderStats[key])[0];
    return row ? `<article class="leader"><div class="leader-label"><span>Season ${esc(label.toLowerCase())} / game</span><span>${esc(row.team)}</span></div><div class="leader-main"><button class="player-open" data-player="${esc(row.id)}">${esc(row.player)}</button><b>${stat(row.leaderStats[key])}</b></div><small>Among current team leaders on today’s slate · season average</small></article>` : "";
  }).join("");
  return `${stats()}<div class="dashboard-grid"><article class="spotlight"><div class="kicker">TODAY / NBA INTELLIGENCE</div><h2>${state.data.games.length ? `${state.data.games.length} matchups.<br><em>One clean read.</em>` : "No games today.<br><em>Stay ready.</em>"}</h2><p>Explore the slate, check player availability, and open current-season game logs. Season averages are labeled as history, not betting projections.</p><button class="spotlight-link" type="button" data-jump="games">Open the game lab ↗</button></article><div class="leaders">${leaders || '<div class="empty">Current team leaders are not available.</div>'}</div></div>${gamesSection(4)}`;
}

function playerBoard() {
  const teams = [...new Set(state.data.players.map(player => player.team))].sort();
  return `${stats()}<div class="section-bar"><h2>Today’s players</h2><p>Open a player for complete current-season history</p></div><div class="market-tabs" role="group" aria-label="Player view"><button class="${state.market === "all" ? "active" : ""}" data-market="all">All players</button>${Object.entries(markets).map(([key, [label]]) => `<button class="${state.market === key ? "active" : ""}" data-market="${key}">${label} leaders</button>`).join("")}</div><p class="nba-count">Leader averages come from the current scoreboard. Other averages appear in each player’s game log.</p><div class="table-tools"><input id="playerSearch" type="search" aria-label="Search players" placeholder="Search player or team" value="${esc(state.query)}"><select id="teamFilter" class="nba-team-filter" aria-label="Filter team"><option value="">All teams</option>${teams.map(team => `<option ${state.team === team ? "selected" : ""}>${esc(team)}</option>`).join("")}</select></div><div class="table-wrap"><table><caption class="sr-only">Current NBA rosters and team leader averages</caption><thead><tr><th>Player</th><th>Matchup</th><th>Position</th><th>Availability</th><th>PPG</th><th>RPG</th><th>APG</th></tr></thead><tbody id="playerRows"></tbody></table></div>`;
}

function renderPlayerRows() {
  let rows = state.data.players.filter(player => (!state.team || player.team === state.team) && (!state.query || `${player.player} ${player.team}`.toLowerCase().includes(state.query.toLowerCase())));
  if (markets[state.market]) { const key = markets[state.market][1]; rows = rows.filter(player => Number.isFinite(player.leaderStats[key])).sort((a, b) => b.leaderStats[key] - a.leaderStats[key]); }
  else rows.sort((a, b) => a.player.localeCompare(b.player));
  $("#playerRows").innerHTML = rows.length ? rows.map(player => `<tr><td><button class="player-open" data-player="${esc(player.id)}">${esc(player.player)}</button><small>${esc(player.team)}</small></td><td>${esc(player.team)} vs ${esc(player.opponent)}</td><td>${esc(player.position || "—")}</td><td>${esc(player.availability)}</td><td>${stat(player.leaderStats.pointsPerGame)}</td><td>${stat(player.leaderStats.reboundsPerGame)}</td><td>${stat(player.leaderStats.assistsPerGame)}</td></tr>`).join("") : '<tr><td colspan="7">No players match this filter.</td></tr>';
}

function availability() {
  return `${stats()}<div class="section-bar"><h2>Availability watch</h2><p>Current reports for today’s teams</p></div><div class="availability-grid">${state.data.panels.injuries !== "current" ? '<div class="empty">The injury provider is unavailable. The game slate and player board remain available.</div>' : state.data.injuries.length ? state.data.injuries.map(injury => `<article class="availability-card"><b>${esc(injury.player)} · ${esc(injury.team)}</b><span><strong>${esc(injury.status)}</strong>${injury.detail ? ` — ${esc(injury.detail)}` : ""}</span></article>`).join("") : '<div class="empty">No injury reports were returned for today’s teams. Game availability remains unconfirmed.</div>'}</div>`;
}

function render() {
  const [title, description] = descriptions[state.view];
  $("#viewTitle").textContent = title;
  $("#viewDescription").textContent = description;
  $("#mobileView").value = state.view;
  document.querySelectorAll("[data-view]").forEach(button => button.classList.toggle("active", button.dataset.view === state.view));
  document.querySelectorAll('.tsl-nba-header a[href*="nba.html#"]').forEach(link => link.classList.toggle("active", new URL(link.href).hash === `#${state.view}`));
  if (!state.data) return;
  $("#viewRoot").innerHTML = state.view === "dashboard" ? dashboard() : state.view === "games" ? `${stats()}${gamesSection()}` : state.view === "players" ? playerBoard() : availability();
  if (state.view === "players") {
    renderPlayerRows();
    $("#playerSearch").addEventListener("input", event => { state.query = event.target.value; renderPlayerRows(); });
    $("#teamFilter").addEventListener("change", event => { state.team = event.target.value; renderPlayerRows(); });
  }
}

function changeView(view) {
  state.view = descriptions[view] ? view : "dashboard";
  window.scrollTo({ top: 0, behavior: "smooth" });
  render();
}

function fromHash() {
  const value = location.hash.slice(1);
  if (markets[value]) { state.market = value; changeView("players"); }
  else { if (value === "players") state.market = "all"; changeView(value); }
}

async function showPlayer(id) {
  const player = state.data?.players.find(row => row.id === id);
  if (!player) return;
  const dialog = $("#playerDialog"), request = ++state.detailRequest;
  const header = `<div class="nba-profile-head">${player.headshot ? `<img src="${esc(player.headshot)}" alt="">` : ""}<div><h2 id="playerDialogTitle">${esc(player.player)}</h2><p>${esc(player.team)} · ${esc(player.position)} · ${esc(player.availability)}</p></div></div>`;
  $("#playerDetail").innerHTML = `${header}<p class="nba-player-note" role="status">Loading current-season game logs…</p>`;
  if (!dialog.open) dialog.showModal();
  try {
    const data = await getJSON(`nba_player_${id}.json`);
    if (request !== state.detailRequest) return;
    $("#playerDetail").innerHTML = `${header}<p class="nba-player-note">${esc(state.data.season)} regular season · ${data.gamesPlayed} completed games. Last 5 includes ${data.last5?.games || 0} actual games; no prior-season substitution.</p>${data.season ? `<div class="stat-strip nba-dialog-stats">${["points", "rebounds", "assists", "threes"].map(key => `<div class="stat"><span>${esc(key)} / game</span><strong>${stat(data.season[key])}</strong><small>Last ${data.last5.games}: ${stat(data.last5[key])}</small></div>`).join("")}</div><div class="table-wrap"><table><caption class="sr-only">Recent regular-season game logs</caption><thead><tr><th>Date</th><th>Opponent</th><th>MIN</th><th>PTS</th><th>REB</th><th>AST</th><th>3PM</th></tr></thead><tbody>${data.recentGames.map(game => `<tr><td>${esc(new Date(game.date).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }))}</td><td>${esc(game.opponent)}</td>${["minutes", "points", "rebounds", "assists", "threes"].map(key => `<td>${stat(game[key])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : '<div class="empty">No completed regular-season game logs were returned for this player this season.</div>'}<p class="nba-source">${esc(data.source)} · checked ${time(data.fetchedAt)} ET. Historical averages are not predicted outcomes.</p>`;
  } catch {
    if (request === state.detailRequest) $("#playerDetail").innerHTML = `${header}<div class="empty">Current-season logs are temporarily unavailable for this player.</div><button class="nba-refresh nba-retry" data-player="${esc(id)}">Try again</button>`;
  }
}

async function load() {
  if (state.loading) return;
  state.loading = true;
  try {
    const data = await getJSON("nba_workspace.json");
    const age = Date.now() - Date.parse(data.fetchedAt);
    if (!Array.isArray(data.games) || !Array.isArray(data.players) || !Number.isFinite(age) || age < -60000 || age > 120000) throw new Error("Current NBA source time could not be verified");
    state.data = data;
    $("#slateDate").textContent = data.date;
    $("#slateState").textContent = data.season || "Current slate";
    $("#sideUpdated").textContent = `Checked ${time(data.fetchedAt)} ET`;
    $("#headerState").textContent = `TODAY · ${data.games.length} GAMES`;
    $("#globalNotice").className = `notice ${data.warnings.length ? "warn" : "good"}`;
    $("#globalNotice").textContent = `Current NBA feed · checked ${time(data.fetchedAt)} ET${data.warnings.length ? ` · ${data.warnings.join(" ")}` : " · refreshes every minute"}`;
    render();
  } catch (error) {
    // Clear old data after a failed refresh; keep navigation usable and finish all loading states.
    state.data = null;
    $("#slateDate").textContent = "Unavailable";
    $("#slateState").textContent = "Retry available";
    $("#sideUpdated").textContent = "Current feed unavailable";
    $("#headerState").textContent = "NBA · FEED UNAVAILABLE";
    $("#globalNotice").className = "notice warn";
    $("#globalNotice").textContent = error.status === 401 || error.status === 403 ? "Sign in with an active membership to load the NBA workspace." : "The current NBA source is temporarily unavailable. Try refreshing the feed.";
    $("#viewRoot").innerHTML = `<div class="empty"><strong>${error.status === 401 || error.status === 403 ? 'Open <a href="./account.html">My Account</a> to sign in.' : "Current NBA data could not be loaded."}</strong><p>Use Retry current feed to reconnect.</p><button class="nba-refresh" data-retry>Retry current feed</button></div>`;
  } finally { state.loading = false; }
}

document.addEventListener("click", event => {
  const view = event.target.closest("[data-view],[data-jump]");
  if (view) location.hash = view.dataset.view || view.dataset.jump;
  const market = event.target.closest("[data-market]");
  if (market) { state.market = market.dataset.market; render(); }
  const player = event.target.closest("[data-player]");
  if (player) showPlayer(player.dataset.player);
  if (event.target.closest("[data-retry]")) load();
});
$("#mobileView").addEventListener("change", event => { location.hash = event.target.value; });
$("#closePlayer").addEventListener("click", () => { state.detailRequest++; $("#playerDialog").close(); });
$("#playerDialog").addEventListener("cancel", () => { state.detailRequest++; });
window.addEventListener("hashchange", fromHash);
document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
fromHash();
load();
setInterval(() => { if (!document.hidden) load(); }, 60000);
