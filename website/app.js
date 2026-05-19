const state = {
  sport: "mlb",
  market: "home_runs",
  rows: [],
  weather: [],
  parks: []
};

const marketFiles = {
  mlb: {
    home_runs: "data/mlb_home_runs.json",
    hits: "data/mlb_hits.json",
    total_bases: "data/mlb_total_bases.json",
    rbis: "data/mlb_rbis.json",
    games: "data/mlb_games_today.json",
    weather: "data/mlb_weather.json"
  }
};

function titleCase(text) {
  return text.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function clean(value, fallback = "--") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function gameStatusLabel(row) {
  const status = String(row.status || "").toLowerCase();
  const abstractStatus = String(row.abstractStatus || "").toLowerCase();

  if (status.includes("final") || abstractStatus.includes("final")) return "FINAL";
  if (status.includes("delay") || status.includes("postponed")) return "DELAYED";
  if (abstractStatus.includes("live") || status.includes("progress")) return "LIVE";
  if (abstractStatus.includes("preview") || status.includes("scheduled")) return "PRE GAME";

  return String(row.status || "GAME").toUpperCase();
}

function gameStatusClass(row) {
  const label = gameStatusLabel(row);

  if (label === "LIVE") return "status-pill live";
  if (label === "FINAL") return "status-pill final";
  if (label === "DELAYED") return "status-pill delayed";

  return "status-pill";
}

function formatGameTime(iso) {
  if (!iso) return "TBD";

  const date = new Date(iso);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

async function loadRows() {
  const file = marketFiles[state.sport]?.[state.market];

  if (!file) return [];

  try {
    const res = await fetch(file, { cache: "no-store" });

    if (!res.ok) return [];

    return await res.json();
  } catch {
    return [];
  }
}

async function loadWeather() {
  try {
    const res = await fetch("data/mlb_weather.json", {
      cache: "no-store"
    });

    if (!res.ok) return [];

    const data = await res.json();

    return Array.isArray(data.weather) ? data.weather : [];
  } catch {
    return [];
  }
}

function getWeatherForVenue(venue) {
  return state.weather.find(item => item.venue === venue) || null;
}

function renderWeatherMini(venue) {
  const weather = getWeatherForVenue(venue);

  if (!weather) {
    return `<div class="weather-mini weather-missing">Weather loading</div>`;
  }

  return `
    <div class="weather-mini">
      <span>${weather.temp ?? "--"}°F</span>
      <span>${weather.humidity ?? "--"}% Hum</span>
      <span>${weather.windSpeed ?? "--"} MPH ${weather.windCompass || ""}</span>
    </div>
  `;
}

function renderBallparkWeather(venue) {
  const weather = getWeatherForVenue(venue);
  const park = getParkForVenue(venue);
  const isDome = String(park?.roof || "").toLowerCase().includes("dome");

  if (!weather) {
    return `
      <div class="park-weather-card">
        <h3>Ballpark Weather</h3>
        <div class="weather-empty">Weather data loading for this park.</div>
      </div>
    `;
  }

  const arrow = Number.isFinite(Number(weather.arrowDegrees)) ? Number(weather.arrowDegrees) : 0;
  const windText = isDome
    ? "Fixed dome. Wind is not active inside the park."
    : `Wind ${weather.windSpeed ?? "--"} MPH ${weather.windCompass || ""}. Arrow shows live wind flow across the field.`;

  return `
    <div class="park-weather-card">
      <div class="park-weather-head">
        <div>
          <h3>Ballpark Weather</h3>
          <p>${weather.venue} • ${weather.city || ""}</p>
        </div>
        <div class="weather-live-pill">LIVE</div>
      </div>

      <div class="weather-grid">
        <div class="weather-stat">
          <span>Temp</span>
          <strong>${weather.temp ?? "--"}°F</strong>
        </div>
        <div class="weather-stat">
          <span>Humidity</span>
          <strong>${weather.humidity ?? "--"}%</strong>
        </div>
        <div class="weather-stat">
          <span>Wind</span>
          <strong>${isDome ? "Dome" : `${weather.windSpeed ?? "--"} MPH`}</strong>
        </div>
        <div class="weather-stat">
          <span>Direction</span>
          <strong>${isDome ? "Indoor" : weather.windCompass || "--"}</strong>
        </div>
      </div>

      <div class="ballpark-diagram">
        <div class="outfield-arc"></div>
        <div class="infield-diamond"></div>
        <div class="home-plate"></div>
        <div class="base base-first"></div>
        <div class="base base-second"></div>
        <div class="base base-third"></div>
        ${isDome ? `<div class="dome-label">DOME</div>` : `<div class="wind-arrow" style="transform: translate(-50%, -50%) rotate(${arrow}deg);">➜</div>`}
      </div>

      ${renderParkFactors(venue)}

      <div class="wind-read">
        ${windText}
      </div>
    </div>
  `;
}

function renderParkFactors(venue) {
  const park = getParkForVenue(venue);

  if (!park) {
    return `
      <div class="park-factor-missing">
        Park dimensions coming soon for this venue.
      </div>
    `;
  }

  return `
    <div class="park-factor-grid">
      <div class="weather-stat">
        <span>LF</span>
        <strong>${park.lf} FT</strong>
      </div>
      <div class="weather-stat">
        <span>LCF</span>
        <strong>${park.lcf} FT</strong>
      </div>
      <div class="weather-stat">
        <span>CF</span>
        <strong>${park.cf} FT</strong>
      </div>
      <div class="weather-stat">
        <span>RCF</span>
        <strong>${park.rcf} FT</strong>
      </div>
      <div class="weather-stat">
        <span>RF</span>
        <strong>${park.rf} FT</strong>
      </div>
      <div class="weather-stat">
        <span>HR Factor</span>
        <strong>${park.hrFactor}</strong>
      </div>
      <div class="weather-stat">
        <span>LHB Boost</span>
        <strong>${park.leftyBoost}</strong>
      </div>
      <div class="weather-stat">
        <span>RHB Boost</span>
        <strong>${park.rightyBoost}</strong>
      </div>
    </div>

    <div class="park-summary">
      <strong>${park.roof}</strong> • ${park.summary}
    </div>
  `;
}

async function loadParkFactors() {
  try {
    const res = await fetch("data/mlb_park_factors.json", {
      cache: "no-store"
    });

    if (!res.ok) return [];

    const data = await res.json();

    return Array.isArray(data.parks) ? data.parks : [];
  } catch {
    return [];
  }
}

function getParkForVenue(venue) {
  return state.parks.find(item => item.venue === venue) || null;
}

async function loadLastUpdated() {
  try {
    const res = await fetch("data/site_last_updated.json", {
      cache: "no-store"
    });

    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
  }
}

function formatUpdatedTime(iso) {
  if (!iso) return "Unknown";

  const date = new Date(iso);

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function statBlock(label, value) {
  return `
    <div class="profile-stat">
      <div class="profile-stat-label">${label}</div>
      <div class="profile-stat-value">${clean(value)}</div>
    </div>
  `;
}

function buildZoneCell(row, hitter, pitcher, index) {
  const score = Number(row.score || 0);
  const hr = Number(hitter.hr || 0);
  const slg = Number(hitter.slg || 0);
  const ops = Number(hitter.ops || 0);
  const pitcherHr = Number(pitcher.homeRuns || 0);
  const era = Number(pitcher.era || 0);

  const seed = score + hr * 2 + slg * 100 + ops * 30 + pitcherHr * 2 + era * 4 + index * 7;

  const hotSpots = [1, 4, 6];
  const warmSpots = [0, 2, 5, 8];

  let type = "neutral";
  let label = "Stable";

  if (seed >= 88 || hotSpots.includes(index)) {
    type = "hot";
    label = "Attack";
  } else if (seed >= 70 || warmSpots.includes(index)) {
    type = "warm";
    label = "Match";
  }

  return `
    <div class="zone-lab-cell ${type}">
      <span>${label}</span>
    </div>
  `;
}

function buildHrMatchupRead(row, hitter, pitcher) {
  const park = getParkForVenue(row.venue);
  const weather = getWeatherForVenue(row.venue);

  const bullets = [];

  if (Number(hitter.hr) >= 15) {
    bullets.push("Power profile is already showing real HR production.");
  }

  if (Number(hitter.slg) >= 0.500) {
    bullets.push("Slugging profile supports extra base and HR upside.");
  }

  if (Number(hitter.ops) >= 0.850) {
    bullets.push("OPS shows the bat is not just power only. He is getting on base and doing damage.");
  }

  if (Number(pitcher.era) >= 4.50) {
    bullets.push("Opposing pitcher ERA points to run prevention issues.");
  }

  if (Number(pitcher.whip) >= 1.30) {
    bullets.push("Pitcher WHIP suggests traffic on the bases and more damage chances.");
  }

  if (Number(pitcher.homeRuns) >= 3) {
    bullets.push("Pitcher has already allowed HR damage this season.");
  }

  if (park?.hrFactor >= 105) {
    bullets.push(`${park.venue} grades as a favorable HR park in this build.`);
  }

  if (park?.summary) {
    bullets.push(park.summary);
  }

  if (weather && Number(weather.temp) >= 80) {
    bullets.push("Warm temperature can help ball carry.");
  }

  if (weather && Number(weather.windSpeed) >= 10 && !String(park?.roof || "").toLowerCase().includes("dome")) {
    bullets.push(`Wind is active at ${weather.windSpeed} MPH ${weather.windCompass || ""}, which matters for carry and pull side flight.`);
  }

  if (!bullets.length) {
    bullets.push("Model ranking is being driven by the combined power score, pitcher profile, game context, and park setup.");
  }

  return bullets;
}

function openPlayerProfile(index) {
  const row = state.rows[index];

  if (!row) return;

  const hitter = row.stats?.hitter || {};
  const pitcher = row.stats?.pitcher || {};

  const modal = document.getElementById("profile-modal");
  const body = document.getElementById("profile-body");

  body.innerHTML = `
    <div class="profile-top">
      <div>
        <div class="profile-rank">#${clean(row.rank)}</div>
        <h2>${clean(row.player, "Unknown Player")}</h2>
        <p>${clean(row.team)} vs ${clean(row.opponent)}</p>
      </div>
      <div class="profile-score">
        <span>${clean(row.score)}</span>
        <small>HR Match Score</small>
      </div>
    </div>

    <div class="profile-summary">
      <div>
        <span class="profile-label">Game</span>
        <strong>${clean(row.game)}</strong>
      </div>
      <div>
        <span class="profile-label">Venue</span>
        <strong>${clean(row.venue)}</strong>
      </div>
      <div>
        <span class="profile-label">Opposing Pitcher</span>
        <strong>${clean(row.opposingPitcher)}</strong>
      </div>
      <div>
        <span class="profile-label">Model Read</span>
        <strong>${clean(row.edge)}</strong>
      </div>
    </div>

    <div class="profile-note">
      ${clean(row.note, "No matchup note available yet.")}
    </div>

    ${renderBallparkWeather(row.venue)}

    <h3>Why This Bat Fits</h3>
    <div class="profile-grid">
      ${statBlock("HR", hitter.hr)}
      ${statBlock("SLG", hitter.slg)}
      ${statBlock("OPS", hitter.ops)}
      ${statBlock("AVG", hitter.avg)}
      ${statBlock("OBP", hitter.obp)}
      ${statBlock("RBI", hitter.rbi)}
      ${statBlock("Doubles", hitter.doubles)}
      ${statBlock("Strikeouts", hitter.strikeOuts)}
    </div>

    <h3>Pitcher Vulnerability</h3>
    <div class="profile-grid">
      ${statBlock("ERA", pitcher.era)}
      ${statBlock("WHIP", pitcher.whip)}
      ${statBlock("HR Allowed", pitcher.homeRuns)}
      ${statBlock("IP", pitcher.inningsPitched)}
      ${statBlock("Hits Allowed", pitcher.hits)}
      ${statBlock("Walks", pitcher.baseOnBalls)}
      ${statBlock("Strikeouts", pitcher.strikeOuts)}
    </div>

    <h3>Power Zone Map</h3>
    <div class="zone-lab-wrap">
      <div class="zone-lab-card">
        <div class="zone-lab-head">
          <strong>Simulated Power Zones</strong>
          <span>Built from HR score, hitter profile, pitcher risk, venue and weather</span>
        </div>

        <div class="zone-lab-grid">
          ${buildZoneCell(row, hitter, pitcher, 0)}
          ${buildZoneCell(row, hitter, pitcher, 1)}
          ${buildZoneCell(row, hitter, pitcher, 2)}
          ${buildZoneCell(row, hitter, pitcher, 3)}
          ${buildZoneCell(row, hitter, pitcher, 4)}
          ${buildZoneCell(row, hitter, pitcher, 5)}
          ${buildZoneCell(row, hitter, pitcher, 6)}
          ${buildZoneCell(row, hitter, pitcher, 7)}
          ${buildZoneCell(row, hitter, pitcher, 8)}
        </div>

        <div class="zone-lab-legend">
          <span><i class="zone-hot-dot"></i> Attack Zone</span>
          <span><i class="zone-warm-dot"></i> Match Zone</span>
          <span><i class="zone-cold-dot"></i> Neutral Zone</span>
        </div>
      </div>
    </div>

    <div class="profile-explainer">
      <strong>Slip Lab Read:</strong>
      <ul class="matchup-read-list">
        ${buildHrMatchupRead(row, hitter, pitcher).map(item => `<li>${item}</li>`).join("")}
      </ul>
    </div>
  `;

  modal.classList.add("show");
}

function closePlayerProfile() {
  const modal = document.getElementById("profile-modal");

  if (modal) {
    modal.classList.remove("show");
  }
}

async function render() {
  document.querySelectorAll("nav button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sport === state.sport);
  });

  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.market === state.market);
  });

  document.getElementById("page-title").textContent =
    `${state.sport.toUpperCase()} Lab`;

  document.getElementById("page-subtitle").textContent =
    state.sport === "mlb"
      ? "Home Runs, Hits, Total Bases, and RBIs."
      : "Coming soon.";

  const board = document.getElementById("board");
  const boardTitle = document.getElementById("board-title");
  const boardMeta = document.getElementById("board-meta");

  boardTitle.textContent = titleCase(state.market);

  board.innerHTML =
    `<div class="empty">Loading ${state.sport.toUpperCase()} ${titleCase(state.market)} data...</div>`;

  const [raw, updatedInfo, weatherRows, parkRows] = await Promise.all([
    loadRows(),
    loadLastUpdated(),
    loadWeather(),
    loadParkFactors()
  ]);

  const rows = state.market === "games"
    ? raw.games || []
    : state.market === "weather"
      ? raw.weather || []
      : raw;

  state.rows = rows;
  state.weather = weatherRows;
  state.parks = parkRows;

  const updated = formatUpdatedTime(updatedInfo?.updated_at);

  boardMeta.textContent =
    `${rows.length} rows loaded • Last Updated ${updated}`;

  const topUpdated = document.getElementById("top-updated");

  if (topUpdated) {
    topUpdated.textContent = `Last Updated: ${updated}`;
  }

  if (!rows.length) {
    board.innerHTML =
      `<div class="empty">${state.sport.toUpperCase()} ${titleCase(state.market)} data coming soon.</div>`;
    return;
  }

  if (state.market === "weather") {
    board.innerHTML = rows.map(row => `
      <article class="weather-board-card">
        ${renderBallparkWeather(row.venue)}
      </article>
    `).join("");

    return;
  }

  if (state.market === "games") {
    board.innerHTML = rows.map((row, index) => `
      <article class="card game-card">
        <div class="rank">#${index + 1}</div>

        <div>
          <div class="player">${row.matchup || "MLB Game"}</div>
          <div class="meta">${row.venue || ""} • ${formatGameTime(row.gameDate)}</div>
          <div class="${gameStatusClass(row)}">${gameStatusLabel(row)}</div>
          ${renderWeatherMini(row.venue)}
        </div>

        <div class="stat">
          <div class="stat-label">Away SP</div>
          <div class="stat-value">${row.awayProbablePitcher || "TBD"}</div>
        </div>

        <div class="stat">
          <div class="stat-label">Home SP</div>
          <div class="stat-value">${row.homeProbablePitcher || "TBD"}</div>
        </div>

        <div class="stat">
          <div class="stat-label">Score</div>
          <div class="stat-value">${row.awayScore ?? "--"} • ${row.homeScore ?? "--"}</div>
        </div>

        <div class="stat">
          <div class="stat-label">Game ID</div>
          <div class="stat-value">${row.gamePk || "--"}</div>
        </div>
      </article>
    `).join("");

    return;
  }

  board.innerHTML = rows.map((row, index) => `
    <article class="card ${state.market === "home_runs" ? "clickable-card" : ""}" ${state.market === "home_runs" ? `data-profile-index="${index}"` : ""}>
      <div class="rank">#${row.rank || index + 1}</div>

      <div>
        <div class="player">${row.player || "Unknown Player"}</div>
        <div class="meta">${row.team || ""} • ${row.game || ""}</div>
        ${state.market === "home_runs" ? renderWeatherMini(row.venue) : ""}
      </div>

      <div class="stat">
        <div class="stat-label">Score</div>
        <div class="stat-value">${row.score ?? "--"}</div>
      </div>

      ${state.market === "home_runs" ? `
        <div class="stat">
          <div class="stat-label">Profile</div>
          <div class="stat-value">Open</div>
        </div>
      ` : ""}
    </article>
  `).join("");

  document.querySelectorAll("[data-profile-index]").forEach(card => {
    card.addEventListener("click", () => {
      openPlayerProfile(Number(card.dataset.profileIndex));
    });
  });
}

document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.sport = btn.dataset.sport;
    render();
  });
});

document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.market = btn.dataset.market;
    render();
  });
});

document.addEventListener("click", event => {
  if (event.target.matches("[data-close-profile]")) {
    closePlayerProfile();
  }

  if (event.target.id === "profile-modal") {
    closePlayerProfile();
  }
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closePlayerProfile();
  }
});

render();
