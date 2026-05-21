const FILES = {
  homeRuns: "./data/mlb_home_runs.json",
  games: "./data/mlb_games_today.json",
  weather: "./data/mlb_weather.json",
  results: "./data/mlb_results.json",
  updated: "./data/site_last_updated.json"
};

const STATE = {
  activeTab: "homeRuns",
  selectedPlayer: null,
  data: {
    homeRuns: [],
    games: [],
    weather: [],
    results: [],
    updated: null
  }
};

const TABS = [
  { id: "homeRuns", label: "Home Runs" },
  { id: "games", label: "Today's Games" },
  { id: "weather", label: "Weather" },
  { id: "results", label: "Results" }
];

function appRoot() {
  return document.getElementById("app");
}

function clean(value, fallback = "N/A") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function numberValue(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scoreValue(row) {
  return clean(
    row.score ??
    row.hr_score ??
    row.final_score ??
    row.model_score ??
    row.total_score ??
    row.rating ??
    "N/A"
  );
}

function playerName(row) {
  return clean(row.player ?? row.name ?? row.batter ?? row.player_name ?? "Unknown Player");
}

function teamName(row) {
  return clean(row.team ?? row.player_team ?? row.batter_team ?? row.abbr ?? "");
}

function gameText(row) {
  return clean(
    row.game ??
    row.matchup ??
    row.game_name ??
    row.away_home ??
    `${clean(row.away_team ?? row.awayTeam ?? row.away, "")} at ${clean(row.home_team ?? row.homeTeam ?? row.home, "")}`,
    ""
  ).trim();
}

function formatTime(value) {
  if (!value) return "TBD";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "TBD";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatUpdated(value) {
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

function normalizePayload(payload, keys = []) {
  if (Array.isArray(payload)) return payload;

  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }

  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;

  return [];
}

async function loadJson(path, fallback) {
  try {
    const response = await fetch(`${path}?v=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return fallback;
    return await response.json();
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

  STATE.data.homeRuns = normalizePayload(homeRuns, ["players", "homeRuns", "home_runs", "board"]);
  STATE.data.games = normalizePayload(games, ["games", "slate"]);
  STATE.data.weather = normalizePayload(weather, ["weather", "venues", "parks"]);
  STATE.data.results = normalizePayload(results, ["results", "homeRuns", "home_runs"]);
  STATE.data.updated = updated;

  render();
}

function setTab(tabId) {
  STATE.activeTab = tabId;
  STATE.selectedPlayer = null;
  render();
}

function openPlayer(index) {
  STATE.selectedPlayer = STATE.data.homeRuns[index] || null;
  renderModal();
}

function closePlayer() {
  STATE.selectedPlayer = null;
  renderModal();
}

function render() {
  const root = appRoot();
  if (!root) return;

  root.innerHTML = `
    <header class="site-header">
      <div class="site-header-inner">
        <div>
          <p class="kicker">The Slip Lab</p>
          <h1>MLB Lab</h1>
          <p class="subtitle">HR focused matchup intelligence powered by live MLB data.</p>
        </div>
        <div class="updated-pill">Updated ${formatUpdated(STATE.data.updated?.updated_at ?? STATE.data.updated?.last_updated ?? STATE.data.updated?.updatedAt)}</div>
      </div>
    </header>

    <main class="shell">
      <nav class="tabs" aria-label="MLB sections">
        ${TABS.map(tab => `
          <button class="tab-button ${STATE.activeTab === tab.id ? "active" : ""}" type="button" data-tab="${tab.id}">
            ${tab.label}
          </button>
        `).join("")}
      </nav>

      <section class="content-panel">
        ${renderActiveTab()}
      </section>
    </main>

    <div id="player-modal" class="modal"></div>
  `;

  root.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => setTab(button.dataset.tab));
  });

  root.querySelectorAll("[data-player-index]").forEach(card => {
    card.addEventListener("click", () => openPlayer(Number(card.dataset.playerIndex)));
  });

  renderModal();
}

function renderActiveTab() {
  if (STATE.activeTab === "games") return renderGames();
  if (STATE.activeTab === "weather") return renderWeather();
  if (STATE.activeTab === "results") return renderResults();
  return renderHomeRuns();
}

function renderHomeRuns() {
  const rows = STATE.data.homeRuns.slice(0, 60);

  if (!rows.length) {
    return renderEmpty("Home Runs", "Loading board data...");
  }

  return `
    <div class="section-head">
      <div>
        <h2>Home Runs</h2>
        <p>${rows.length} bats loaded</p>
      </div>
    </div>

    <div class="player-grid">
      ${rows.map((row, index) => `
        <article class="player-card" data-player-index="${index}">
          <div class="rank-badge">#${index + 1}</div>
          <div class="player-main">
            <h3>${playerName(row)}</h3>
            <p>${teamName(row)} ${gameText(row) ? "vs " + gameText(row).replace(" at ", " at ") : ""}</p>
          </div>
          <div class="score-box">
            <span>${scoreValue(row)}</span>
            <small>HR Score</small>
          </div>
          <div class="metric-row">
            <span>Power ${clean(row.power_score ?? row.power ?? row.barrel_score)}</span>
            <span>Pitcher ${clean(row.pitcher_attack_score ?? row.pitcher_score ?? row.attack_score)}</span>
            <span>Park ${clean(row.park_score ?? row.park_boost ?? row.park_factor)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderGames() {
  const rows = STATE.data.games;

  if (!rows.length) {
    return renderEmpty("Today's Games", "Loading today's MLB slate...");
  }

  return `
    <div class="section-head">
      <div>
        <h2>Today's Games</h2>
        <p>${rows.length} games loaded</p>
      </div>
    </div>

    <div class="list-grid">
      ${rows.map(game => {
        const away = clean(game.away_team ?? game.awayTeam ?? game.away);
        const home = clean(game.home_team ?? game.homeTeam ?? game.home);
        const venue = clean(game.venue ?? game.ballpark ?? game.stadium ?? game.park);
        const status = clean(game.status ?? game.game_status ?? game.abstractGameState ?? "");
        const time = formatTime(game.commence_time ?? game.game_time ?? game.startTime ?? game.gameDate);

        return `
          <article class="list-card">
            <div>
              <h3>${away} at ${home}</h3>
              <p>${venue}</p>
            </div>
            <div class="right-stack">
              <strong>${time}</strong>
              ${status ? `<span>${status}</span>` : ""}
            </div>
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function renderWeather() {
  const rows = STATE.data.weather;

  if (!rows.length) {
    return renderEmpty("Weather", "Loading weather board...");
  }

  return `
    <div class="section-head">
      <div>
        <h2>Weather</h2>
        <p>${rows.length} venues loaded</p>
      </div>
    </div>

    <div class="weather-grid">
      ${rows.map(row => `
        <article class="weather-card">
          <div>
            <h3>${clean(row.venue ?? row.ballpark ?? row.stadium ?? row.park)}</h3>
            <p>${clean(row.game ?? row.matchup ?? "")}</p>
          </div>
          <div class="weather-metrics">
            <span>${clean(row.temp ?? row.temperature)}°</span>
            <span>${clean(row.wind_text ?? row.wind ?? row.wind_speed)}</span>
            <span>${clean(row.weather_label ?? row.condition ?? row.summary ?? row.roof_flag)}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderResults() {
  const rows = STATE.data.results;

  if (!rows.length) {
    return renderEmpty("Results", "Loading HR results...");
  }

  return `
    <div class="section-head">
      <div>
        <h2>Results</h2>
        <p>${rows.length} HR results loaded</p>
      </div>
    </div>

    <div class="list-grid">
      ${rows.map(row => `
        <article class="list-card">
          <div>
            <h3>${playerName(row)}</h3>
            <p>${teamName(row)} ${gameText(row)}</p>
          </div>
          <div class="right-stack">
            <strong>${clean(row.result ?? row.hr ?? row.home_runs ?? "HR")}</strong>
            <span>${clean(row.model_flag ?? row.flag ?? row.tag ?? "")}</span>
          </div>
        </article>
      `).join("")}
    </div>
  `;
}

function renderEmpty(title, message) {
  return `
    <div class="empty-card">
      <h2>${title}</h2>
      <p>${message}</p>
    </div>
  `;
}

function renderModal() {
  const modal = document.getElementById("player-modal");
  if (!modal) return;

  const row = STATE.selectedPlayer;

  if (!row) {
    modal.className = "modal";
    modal.innerHTML = "";
    return;
  }

  modal.className = "modal show";
  modal.innerHTML = `
    <div class="modal-panel">
      <button class="close-button" type="button" data-close-modal>Close</button>

      <div class="modal-top">
        <div>
          <p class="kicker">Player Profile</p>
          <h2>${playerName(row)}</h2>
          <p>${teamName(row)} ${gameText(row)}</p>
        </div>
        <div class="modal-score">
          <span>${scoreValue(row)}</span>
          <small>HR Score</small>
        </div>
      </div>

      <div class="modal-grid">
        ${modalStat("Power", row.power_score ?? row.power ?? row.barrel_score)}
        ${modalStat("Pitcher", row.pitcher_attack_score ?? row.pitcher_score ?? row.attack_score)}
        ${modalStat("Park", row.park_score ?? row.park_boost ?? row.park_factor)}
        ${modalStat("Weather", row.weather_score ?? row.weather_boost ?? row.weather)}
        ${modalStat("Barrel", row.barrel_pct ?? row.barrel_rate ?? row.barrel)}
        ${modalStat("Hard Hit", row.hard_hit_pct ?? row.hardhit_pct ?? row.hard_hit)}
        ${modalStat("ISO", row.iso ?? row.ISO)}
        ${modalStat("Recent Form", row.trend_score ?? row.recent_score ?? row.form)}
      </div>
    </div>
  `;

  modal.querySelector("[data-close-modal]").addEventListener("click", closePlayer);
  modal.addEventListener("click", event => {
    if (event.target === modal) closePlayer();
  });
}

function modalStat(label, value) {
  return `
    <div class="modal-stat">
      <span>${label}</span>
      <strong>${clean(value)}</strong>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", () => {
  render();
  loadData();
  setInterval(loadData, 300000);
});
