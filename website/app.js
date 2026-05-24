const state = {
  market: "home_runs",
  rows: [],
  profiles: [],
  games: []
};

const FILES = {
  home_runs: "data/mlb_home_runs.json",
  profiles: "data/player_card_profiles.json",
  games: "data/mlb_game_pitcher_matchups.json"
};

function clean(v, fallback="--") {
  if (v === undefined || v === null || v === "") return fallback;
  return String(v);
}

function num(v, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function getJSON(path) {
  const r = await fetch(path + "?v=" + Date.now());

  if (!r.ok) {
    throw new Error(path + " failed");
  }

  return await r.json();
}

async function boot() {
  const [
    hr,
    profiles,
    games
  ] = await Promise.all([
    getJSON(FILES.home_runs),
    getJSON(FILES.profiles),
    getJSON(FILES.games)
  ]);

  state.rows = Array.isArray(hr) ? hr : [];
  state.profiles = Array.isArray(profiles.players)
    ? profiles.players
    : [];

  state.games = Array.isArray(games.games)
    ? games.games
    : [];

  renderHomeRuns();
}

function profileFor(row) {
  return (
    state.profiles.find(
      p =>
        String(p.playerId) === String(row.playerId)
    ) ||
    state.profiles.find(
      p => p.player === row.player
    ) ||
    null
  );
}

function stat(label, value) {
  return `
    <div class="stat">
      <div class="stat-label">${clean(label)}</div>
      <div class="stat-value">${clean(value)}</div>
    </div>
  `;
}

function renderHomeRuns() {
  const board = document.getElementById("board");

  board.innerHTML = `
    <div class="hero">
      <h1>Home Run Targets</h1>
      <p>${state.rows.length} active player cards loaded</p>
    </div>

    <div class="cards">
      ${state.rows.map(renderPlayerCard).join("")}
    </div>

    <div class="games-wrap">
      <h2>Probable Pitchers</h2>

      ${state.games.map(renderGame).join("")}
    </div>
  `;

  installCardEvents();
}

function renderPlayerCard(row, index) {
  return `
    <article class="card player-card" data-player-index="${index}">
      <div class="card-top">
        <div>
          <div class="player-name">
            ${clean(row.player)}
          </div>

          <div class="player-meta">
            ${clean(row.team)} vs ${clean(row.opponent)}
          </div>
        </div>

        <div class="score-pill">
          ${clean(row.score)}
        </div>
      </div>

      <div class="stats-grid">
        ${stat("Odds", row.odds)}
        ${stat("Edge", row.edge)}
        ${stat("Pitcher", row.opposingPitcher)}
        ${stat("Venue", row.venue)}
      </div>
    </article>
  `;
}

function renderGame(game) {
  return `
    <section class="game-card">
      <div class="game-head">
        <h3>
          ${clean(game.awayTeam)}
          at
          ${clean(game.homeTeam)}
        </h3>

        <p>${clean(game.venue)}</p>
      </div>

      <div class="pitcher-grid">
        ${renderPitcher(game.awayPitcher)}
        ${renderPitcher(game.homePitcher)}
      </div>
    </section>
  `;
}

function renderPitcher(p) {
  return `
    <article class="pitcher-card">
      <div class="pitcher-name">
        ${clean(p.pitcher)}
      </div>

      <div class="pitcher-team">
        ${clean(p.team)}
      </div>

      <div class="stats-grid">
        ${stat("ERA", p.era)}
        ${stat("WHIP", p.whip)}
        ${stat("K", p.strikeOuts)}
        ${stat("IP", p.inningsPitched)}
      </div>

      <div class="threats">
        ${
          (p.topThreats || [])
            .slice(0,3)
            .map(
              t => `
                <div class="threat-row">
                  ${clean(t.player)}
                  <strong>${clean(t.score)}</strong>
                </div>
              `
            )
            .join("")
        }
      </div>
    </article>
  `;
}

function installCardEvents() {
  document
    .querySelectorAll(".player-card")
    .forEach(card => {
      card.addEventListener("click", () => {
        const index = Number(
          card.dataset.playerIndex
        );

        openProfile(state.rows[index]);
      });
    });
}

function openProfile(row) {
  const profile = profileFor(row);

  if (!profile) return;

  const modal = document.getElementById("profile-modal");
  const body = document.getElementById("profile-body");

  body.innerHTML = `
    <div class="profile-wrap">
      <div class="profile-head">
        <div>
          <h2>${clean(profile.player)}</h2>
          <p>
            ${clean(profile.team)}
            vs
            ${clean(profile.opponent)}
          </p>
        </div>

        <div class="profile-score">
          ${clean(profile.score)}
        </div>
      </div>

      <div class="stats-grid">
        ${stat("HR", profile.hitterStats?.hr)}
        ${stat("AVG", profile.hitterStats?.avg)}
        ${stat("OBP", profile.hitterStats?.obp)}
        ${stat("SLG", profile.hitterStats?.slg)}
        ${stat("OPS", profile.hitterStats?.ops)}
        ${stat("ERA", profile.pitcherStats?.era)}
        ${stat("WHIP", profile.pitcherStats?.whip)}
        ${stat("Pitch Matchup", profile.pitchMatchup?.bestPitch)}
      </div>
    </div>
  `;

  modal.classList.add("show");
}

document.addEventListener("click", e => {
  if (
    e.target.id === "profile-modal"
  ) {
    e.target.classList.remove("show");
  }
});

boot().catch(error => {
  console.error(error);

  document.getElementById("board").innerHTML = `
    <div class="error-box">
      ${clean(error.message)}
    </div>
  `;
});
