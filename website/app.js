const DATA = {
  homeRuns: [],
  games: [],
  weather: [],
  results: [],
  updated: null
};

const STATE = {
  tab: "home-runs"
};

const FILES = {
  homeRuns: "./data/mlb_home_runs.json",
  games: "./data/mlb_games_today.json",
  weather: "./data/mlb_weather.json",
  results: "./data/mlb_results.json",
  updated: "./data/site_last_updated.json"
};

const root = document.getElementById("app");

function clean(value) {
  if (value === null || value === undefined || value === "") return "N/A";
  return String(value);
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  const n = num(value, null);
  if (n === null) return "N/A";
  return `${n.toFixed(1)}%`;
}

function formatTime(value) {
  if (!value) return "TBD";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "TBD";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "Updating live";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Updating live";
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function loadJson(url, fallback) {
  try {
    const res = await fetch(`${url}?v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

async function loadData() {
  const [homeRuns, games, weather, results, updated] = await Promise.all([
    loadJson(FILES.homeRuns, []),
    loadJson(FILES.games, []),
    loadJson(FILES.weather, []),
    loadJson(FILES.results, []),
    loadJson(FILES.updated, null)
  ]);

  DATA.homeRuns = Array.isArray(homeRuns) ? homeRuns : homeRuns.players || homeRuns.rows || [];
  DATA.games = Array.isArray(games) ? games : games.games || games.rows || [];
  DATA.weather = Array.isArray(weather) ? weather : weather.weather || weather.venues || weather.rows || [];
  DATA.results = Array.isArray(results) ? results : results.results || results.homeRuns || results.rows || [];
  DATA.updated = updated;

  render();
}

function setTab(tab) {
  STATE.tab = tab;
  render();
}

function render() {
  root.innerHTML = `
    <main class="shell">
      <section class="hero">
        <div>
          <p class="eyebrow">The Slip Lab</p>
          <h1>MLB Lab</h1>
          <p class="subline">HR focused matchup intelligence powered by live MLB data.</p>
        </div>
        <div class="update-pill">Updated ${formatDateTime(DATA.updated?.updated_at || DATA.updated?.last_updated || DATA.updated?.updatedAt)}</div>
      </section>

      <nav class="tabs">
        ${tabButton("home-runs", "Home Runs")}
        ${tabButton("games", "Today's Games")}
        ${tabButton("weather", "Weather")}
        ${tabButton("results", "Results")}
      </nav>

      <section class="panel">
        ${renderActiveTab()}
      </section>
    </main>
  `;

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });
}

function tabButton(id, label) {
  return `<button class="tab ${STATE.tab === id ? "active" : ""}" data-tab="${id}" type="button">${label}</button>`;
}

function renderActiveTab() {
  if (STATE.tab === "games") return renderGames();
  if (STATE.tab === "weather") return renderWeather();
  if (STATE.tab === "results") return renderResults();
  return renderHomeRuns();
}

function renderHomeRuns() {
  const rows = DATA.homeRuns.slice(0, 60);

  if (!rows.length) {
    return emptyState("Home Runs", "Loading board data...");
  }

  return `
    <div class="panel-head">
      <div>
        <h2>Home Runs</h2>
        <p>${rows.length} bats loaded</p>
      </div>
    </div>

    <div class="card-grid">
      ${rows.map((row, index) => `
        <article class="player-card">
          <div class="rank">#${index + 1}</div>
          <div class="card-main">
            <h3>${clean(row.player || row.name || row.batter)}</h3>
            <p>${clean(row.team)} ${clean(row.opponent ? `vs ${row.opponent}` : row.game || "")}</p>
          </div>
          <div class="score">${clean(row.score || row.hr_score || row.model_score || row.final_score)}</div>
          <div class="metrics">
            <span>Power ${clean(row.power_score || row.power || row.barrel_score)}</span>
            <span>Pitcher ${clean(row.pitcher_attack_score || row.pitcher_score || row.attack_score)}</span>
            <span>Park ${clean(row.park_score || row.park_boost || row.park_factor)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderGames() {
  const rows = DATA.games;

  if (!rows.length) {
    return emptyState("Today's Games", "Loading today's MLB slate...");
  }

  return `
    <div class="panel-head">
      <div>
        <h2>Today's Games</h2>
        <p>${rows.length} games loaded</p>
      </div>
    </div>

    <div class="list">
      ${rows.map(game => `
        <article class="game-row">
          <div>
            <h3>${clean(game.away_team || game.awayTeam || game.away)} at ${clean(game.home_team || game.homeTeam || game.home)}</h3>
            <p>${clean(game.venue || game.ballpark || game.stadium)}</p>
          </div>
          <strong>${formatTime(game.commence_time || game.game_time || game.startTime || game.gameDate)}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function renderWeather() {
  const rows = DATA.weather;

  if (!rows.length) {
    return emptyState("Weather", "Loading weather board...");
  }

  return `
    <div class="panel-head">
      <div>
        <h2>Weather</h2>
        <p>${rows.length} venues loaded</p>
      </div>
    </div>

    <div class="card-grid">
      ${rows.map(row => `
        <article class="weather-card">
          <h3>${clean(row.venue || row.ballpark || row.stadium)}</h3>
          <p>${clean(row.game || `${clean(row.away_team)} at ${clean(row.home_team)}`)}</p>
          <div class="metrics">
            <span>${clean(row.temp || row.temperature)}°</span>
            <span>${clean(row.wind_text || row.wind || row.wind_speed)}</span>
            <span>${clean(row.weather_label || row.condition || row.summary)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderResults() {
  const rows = DATA.results;

  if (!rows.length) {
    return emptyState("Results", "Loading HR results...");
  }

  return `
    <div class="panel-head">
      <div>
        <h2>Results</h2>
        <p>${rows.length} HR results loaded</p>
      </div>
    </div>

    <div class="list">
      ${rows.map(row => `
        <article class="result-row">
          <div>
            <h3>${clean(row.player || row.name || row.batter)}</h3>
            <p>${clean(row.team)} ${clean(row.game || "")}</p>
          </div>
          <strong>${clean(row.result || row.hr || row.home_runs || "HR")}</strong>
        </article>
      `).join("")}
    </div>
  `;
}

function emptyState(title, message) {
  return `
    <div class="empty">
      <h2>${title}</h2>
      <p>${message}</p>
    </div>
  `;
}

loadData();
setInterval(loadData, 300000);
