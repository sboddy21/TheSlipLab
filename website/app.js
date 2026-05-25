const state = { rows: [], profiles: [], games: [] };

const FILES = {
  homeRuns: "data/mlb_home_runs.json",
  profiles: "data/player_card_profiles.json",
  matchups: "data/game_pitcher_matchups.json",
  fallbackGames: "data/mlb_games_today.json"
};

function clean(value, fallback = "--") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function html(value) {
  return clean(value, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function norm(value) {
  return clean(value, "").toLowerCase().trim();
}

async function getJSON(file, fallback) {
  try {
    const response = await fetch(file + "?v=" + Date.now());
    if (!response.ok) throw new Error(file + " failed");
    return await response.json();
  } catch (error) {
    return fallback;
  }
}

function list(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload) return [];
  return payload.matchups || payload.games || payload.players || payload.rows || payload.data || [];
}

function pitcherFrom(game, side) {
  const isAway = side === "away";
  const existing = isAway ? game.awayPitcher : game.homePitcher;
  if (existing && (existing.name || existing.pitcher)) return existing;
  return {
    name: isAway ? game.awayProbablePitcher : game.homeProbablePitcher,
    id: isAway ? game.awayProbablePitcherId : game.homeProbablePitcherId,
    side: isAway ? game.awayPitcherHand || game.awayProbablePitcherHand : game.homePitcherHand || game.homeProbablePitcherHand
  };
}

function hittersFor(team, opponent) {
  const teamKey = norm(team);
  const opponentKey = norm(opponent);
  return state.rows
    .filter(row => norm(row.team) === teamKey && (!opponentKey || norm(row.opponent) === opponentKey || norm(row.game).includes(opponentKey)))
    .sort((a, b) => Number(b.score || b.hrConfidence || b.powerScore || 0) - Number(a.score || a.hrConfidence || a.powerScore || 0))
    .slice(0, 13);
}

function normalizeGame(game) {
  const awayPitcher = pitcherFrom(game, "away");
  const homePitcher = pitcherFrom(game, "home");
  const awayHitters = game.hitters && game.hitters.away && game.hitters.away.length ? game.hitters.away : hittersFor(game.awayTeam, game.homeTeam);
  const homeHitters = game.hitters && game.hitters.home && game.hitters.home.length ? game.hitters.home : hittersFor(game.homeTeam, game.awayTeam);

  return {
    ...game,
    awayPitcher,
    homePitcher,
    hitters: { away: awayHitters, home: homeHitters },
    awayBattingOrder: game.awayBattingOrder || [],
    homeBattingOrder: game.homeBattingOrder || []
  };
}

async function boot() {
  const homeRuns = await getJSON(FILES.homeRuns, []);
  const profiles = await getJSON(FILES.profiles, { players: [] });
  const matchups = await getJSON(FILES.matchups, null);
  const fallbackGames = await getJSON(FILES.fallbackGames, null);

  state.rows = list(homeRuns);
  state.profiles = list(profiles);

  const primary = list(matchups).map(normalizeGame);
  const fallback = list(fallbackGames).map(normalizeGame);
  state.games = primary.length ? primary : fallback;

  renderHomeRuns();
}

function teamCode(team) {
  return clean(team).split(" ").map(part => part[0]).join("").slice(0, 3).toUpperCase();
}

function gameTime(game) {
  if (!game.gameDate) return "";
  const date = new Date(game.gameDate);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function stat(label, value) {
  return '<div class="stat"><div class="stat-label">' + html(label) + '</div><div class="stat-value">' + html(value) + '</div></div>';
}

function renderHomeRuns() {
  const board = document.getElementById("board");
  board.innerHTML = '<div class="hero"><h1>Home Run Targets</h1><p>' + state.games.length + ' games loaded today • ' + state.rows.length + ' hitter cards</p></div>' +
    '<div class="game-tabs"><button class="game-tab active" data-game-index="all">All Games<small>' + state.rows.length + ' bats</small></button>' +
    state.games.map((game, index) => '<button class="game-tab" data-game-index="' + index + '">' + html(teamCode(game.awayTeam)) + ' at ' + html(teamCode(game.homeTeam)) + '<small>' + html(gameTime(game)) + '</small></button>').join("") +
    '</div><div id="games-board" class="games-wrap">' + state.games.map(renderGame).join("") + '</div>';

  installGameTabs();
  installCardEvents();
}

function renderGame(game, index) {
  return '<section class="game-card daily-game" data-game-index="' + index + '">' +
    '<div class="game-head"><div><h3>' + html(game.awayTeam) + ' at ' + html(game.homeTeam) + '</h3><p>' + html(gameTime(game)) + (game.venue ? ' • ' + html(game.venue) : '') + (game.status ? ' • ' + html(game.status) : '') + '</p></div><div class="lineup-pill">' + html(game.lineupLockStatus || 'Lineups Updating') + '</div></div>' +
    '<div class="pitcher-grid matchup-grid">' + renderSide(game, "away") + renderSide(game, "home") + '</div>' + renderWeather(game.weather) + '</section>';
}

function renderSide(game, side) {
  const isAway = side === "away";
  const team = isAway ? game.awayTeam : game.homeTeam;
  const opponent = isAway ? game.homeTeam : game.awayTeam;
  const pitcher = isAway ? game.awayPitcher : game.homePitcher;
  const lineup = isAway ? game.awayBattingOrder : game.homeBattingOrder;
  const hitters = isAway ? game.hitters.away : game.hitters.home;
  const pitcherName = pitcher.name || pitcher.pitcher || "TBD";
  const pitcherSide = pitcher.side || pitcher.throws || "";

  return '<article class="pitcher-card matchup-side"><div class="card-top"><div><div class="pitcher-name">' + html(pitcherName) + '</div><div class="pitcher-team">' + html(teamCode(team)) + (pitcherSide ? ' • ' + html(pitcherSide) : '') + ' • vs ' + html(teamCode(opponent)) + '</div></div><div class="score-pill">' + html((hitters[0] && (hitters[0].score || hitters[0].hrConfidence || hitters[0].powerScore)) || hitters.length) + '</div></div>' +
    '<div class="stats-grid">' + stat('Team', teamCode(team)) + stat('Bats', hitters.length) + stat('Lineup', lineup.length ? lineup.length + '/9' : 'Pending') + stat('SP', pitcherName) + '</div>' +
    '<div class="danger-head"><span>Danger Bats</span><strong>' + hitters.length + ' bats</strong></div><div class="threats">' + (hitters.slice(0, 8).map(renderThreat).join("") || '<div class="empty-box">No hitter data yet for ' + html(team) + '</div>') + '</div></article>';
}

function renderThreat(row, index) {
  const score = row.score || row.hrConfidence || row.powerScore || "--";
  const edge = row.edge || row.tier || "Watch";
  const note = Array.isArray(row.reasons) ? row.reasons.join(" • ") : row.note || "";
  return '<button class="threat-row player-card" data-player-name="' + html(row.player) + '" type="button"><div><strong>#' + html(row.rank || index + 1) + ' ' + html(row.player) + '</strong><small>' + html(edge) + (row.batSide ? ' • ' + html(row.batSide) : '') + (row.opposingPitcher ? ' • vs ' + html(row.opposingPitcher) : '') + '</small><em>' + html(note) + '</em></div><span>' + html(score) + '</span></button>';
}

function renderWeather(weather) {
  if (!weather) return "";
  return '<div class="weather-strip"><strong>Weather</strong><span>' + html(weather.temp) + '°F</span><span>' + html(weather.windSpeed) + ' mph ' + html(weather.windCompass) + '</span><span>' + html(weather.humidity) + '% humidity</span><span>' + html(weather.status || 'live') + '</span></div>';
}

function installGameTabs() {
  document.querySelectorAll(".game-tab").forEach(button => {
    button.addEventListener("click", () => {
      const selected = button.dataset.gameIndex;
      document.querySelectorAll(".game-tab").forEach(tab => tab.classList.toggle("active", tab === button));
      document.querySelectorAll(".daily-game").forEach(game => {
        game.style.display = selected === "all" || game.dataset.gameIndex === selected ? "" : "none";
      });
    });
  });
}

function installCardEvents() {
  document.querySelectorAll(".player-card").forEach(card => {
    card.addEventListener("click", () => {
      const name = card.dataset.playerName;
      const row = state.rows.find(item => item.player === name) || state.games.flatMap(game => [...(game.hitters.away || []), ...(game.hitters.home || [])]).find(item => item.player === name);
      if (row) openProfile(row);
    });
  });
}

function profileFor(row) {
  return state.profiles.find(profile => String(profile.playerId) === String(row.playerId)) || state.profiles.find(profile => profile.player === row.player) || null;
}

function openProfile(row) {
  const profile = profileFor(row) || row;
  const modal = document.getElementById("profile-modal");
  const body = document.getElementById("profile-body");
  if (!modal || !body) return;
  body.innerHTML = '<div class="profile-wrap"><div class="profile-head"><div><h2>' + html(profile.player) + '</h2><p>' + html(profile.team) + ' vs ' + html(profile.opponent) + '</p></div><div class="profile-score">' + html(profile.score || profile.hrConfidence || profile.powerScore) + '</div></div><div class="stats-grid">' + stat('HR', profile.hitterStats?.hr || profile.stats?.hitter?.hr) + stat('AVG', profile.hitterStats?.avg || profile.stats?.hitter?.avg) + stat('OBP', profile.hitterStats?.obp || profile.stats?.hitter?.obp) + stat('SLG', profile.hitterStats?.slg || profile.stats?.hitter?.slg) + stat('OPS', profile.hitterStats?.ops || profile.stats?.hitter?.ops) + stat('Pitcher', profile.opposingPitcher || profile.pitcher) + stat('Edge', profile.edge || profile.tier) + stat('Pitch Matchup', profile.pitchMatchup?.bestPitch || profile.bestPitch) + '</div></div>';
  modal.classList.add("show");
}

document.addEventListener("click", event => {
  if (event.target.id === "profile-modal") event.target.classList.remove("show");
});

boot().catch(error => {
  console.error(error);
  document.getElementById("board").innerHTML = '<div class="error-box">' + html(error.message) + '</div>';
});
