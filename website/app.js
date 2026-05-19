const state = {
  sport: "mlb",
  market: "home_runs",
  rows: [],
  weather: [],
  parks: [],
  statcastZones: null
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

async function loadStatcastZones() {
  try {
    const res = await fetch("data/statcast_zones.json", {
      cache: "no-store"
    });

    if (!res.ok) return null;

    return await res.json();
  } catch {
    return null;
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

function getPlayerZoneData(player) {
  const zones = state.statcastZones?.players || {};
  return zones[player] || null;
}

function zoneClass(value, metric) {
  const n = Number(value || 0);

  if (metric === "k") {
    if (n >= 0.30) return "hot";
    if (n >= 0.20) return "warm";
    return "neutral";
  }

  if (metric === "hr") {
    if (n >= 2) return "hot";
    if (n >= 1) return "warm";
    return "neutral";
  }

  if (n >= 0.500) return "hot";
  if (n >= 0.300) return "warm";
  return "neutral";
}

function formatZoneValue(value, metric) {
  const n = Number(value || 0);

  if (metric === "hr") return String(Math.round(n));
  if (metric === "k" || metric === "hardHit" || metric === "barrel") return `${Math.round(n * 100)}%`;

  return n.toFixed(3).replace(/^0/, "");
}

function renderZoneMetricGrid(title, metric, playerZones) {
  const values = playerZones?.zones?.[metric] || Array.from({ length: 25 }, () => 0);

  return `
    <div class="metric-zone-card">
      <div class="metric-zone-title">${title}</div>
      <div class="metric-zone-grid">
        ${values.map(value => `
          <div class="metric-zone-cell ${zoneClass(value, metric)}">
            ${formatZoneValue(value, metric)}
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function renderStatcastZoneLab(row) {
  const playerZones = getPlayerZoneData(row.player);

  if (!playerZones || !playerZones.rows) {
    return `
      <div class="zone-lab-wrap">
        <div class="zone-lab-card">
          <div class="zone-lab-head">
            <strong>Statcast Zone Lab</strong>
            <span>No Baseball Savant zone data loaded for this player yet</span>
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="zone-lab-wrap">
      <div class="zone-lab-card">
        <div class="zone-lab-head">
          <strong>Statcast Zone Lab</strong>
          <span>${playerZones.rows} tracked pitches from Baseball Savant</span>
        </div>

        <div class="metric-zone-board">
          ${renderZoneMetricGrid("AVG", "avg", playerZones)}
          ${renderZoneMetricGrid("ISO", "iso", playerZones)}
          ${renderZoneMetricGrid("SLG", "slg", playerZones)}
          ${renderZoneMetricGrid("xwOBA", "xwoba", playerZones)}
          ${renderZoneMetricGrid("HR", "hr", playerZones)}
          ${renderZoneMetricGrid("K%", "k", playerZones)}
          ${renderZoneMetricGrid("Hard Hit", "hardHit", playerZones)}
          ${renderZoneMetricGrid("Barrel", "barrel", playerZones)}
        </div>
      </div>
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
    ${renderStatcastZoneLab(row)}

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


function pitcherKey(row) {
  return String(row.opposingPitcher || row.pitcher || "Unknown Pitcher").trim();
}

function renderTopVulnerabilities(rows) {
  if (!rows || !rows.length || state.market !== "home_runs") return "";

  const pitcherMap = new Map();

  rows.forEach(row => {
    const key = pitcherKey(row);
    if (!pitcherMap.has(key)) {
      pitcherMap.set(key, {
        pitcher: key,
        rows: [],
        score: Number(row.score || 0),
        era: row.stats?.pitcher?.era || "--",
        game: row.game || "",
        venue: row.venue || "",
        opponent: row.opponent || "",
        team: row.team || ""
      });
    }

    const item = pitcherMap.get(key);
    item.rows.push(row);
    item.score = Math.max(item.score, Number(row.score || 0));
  });

  const vulnRows = [...pitcherMap.values()]
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, 6);

  return `
    <section class="top-vuln-strip">
      <div class="top-vuln-header">
        <div>
          <div class="top-vuln-kicker">PROJECTED HRs • HIGH VALUE GAMES</div>
          <h2>TOP VULNERABILITIES</h2>
        </div>
        <div class="top-vuln-toggles">
          <button class="top-vuln-toggle active">VULN</button>
          <button class="top-vuln-toggle">PARK</button>
        </div>
      </div>

      <div class="top-vuln-row">
        ${vulnRows.map((item, index) => `
          <article class="top-vuln-card" data-pitcher-profile="${encodeURIComponent(item.pitcher)}">
            <div class="top-vuln-rank">#${index + 1}</div>
            <div class="top-vuln-score">${clean(item.score || "--")}</div>
            <div class="top-vuln-label">${item.rows.length} BATS</div>
            <div class="top-vuln-pitcher">${clean(item.pitcher)}</div>
            <div class="top-vuln-matchup">${clean(item.game || `${item.team} vs ${item.opponent}`)}</div>
            <div class="top-vuln-era">ERA ${clean(item.era)}</div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function pitcherRiskLabel(pitcher) {
  const era = Number(pitcher?.era || 0);
  const whip = Number(pitcher?.whip || 0);
  const walks = Number(pitcher?.baseOnBalls || 0);
  const innings = Number(pitcher?.inningsPitched || 0);
  const hr = Number(pitcher?.homeRuns || 0);

  if (era >= 6 || whip >= 1.6) return "HIGH LEAK";
  if (era >= 4.5 || whip >= 1.35 || hr >= 8) return "ATTACKABLE";
  if (walks >= 10 && innings <= 25) return "TRAFFIC RISK";
  return "WATCH";
}

function pitcherRiskBullets(pitcher, rows) {
  const bullets = [];
  const topBat = rows[0];
  const era = Number(pitcher?.era || 0);
  const whip = Number(pitcher?.whip || 0);
  const hr = Number(pitcher?.homeRuns || 0);
  const hits = Number(pitcher?.hits || 0);
  const walks = Number(pitcher?.baseOnBalls || 0);
  const innings = Number(pitcher?.inningsPitched || 0);

  if (era >= 6) bullets.push(`ERA is sitting at ${era}, which puts this pitcher in a danger profile.`);
  if (whip >= 1.5) bullets.push(`WHIP is elevated at ${whip}, creating extra traffic before power contact.`);
  if (hr > 0) bullets.push(`${hr} HR allowed already, so the long ball risk is live.`);
  if (hits >= 20) bullets.push(`${hits} hits allowed shows contact leakage.`);
  if (walks >= 8) bullets.push(`${walks} walks allowed means free runners can turn one swing into damage.`);
  if (topBat) bullets.push(`${topBat.player} is the top ranked bat against this pitcher with a ${topBat.score} HR Match Score.`);

  if (!bullets.length) {
    bullets.push("This pitcher is showing up because the board has multiple bats with playable power scores in the same matchup.");
  }

  return bullets;
}

function hitterPowerLabel(row) {
  const hitter = row.stats?.hitter || {};
  const hr = Number(hitter.hr || 0);
  const slg = Number(hitter.slg || 0);
  const ops = Number(hitter.ops || 0);
  const score = Number(row.score || 0);

  if (score >= 70 || hr >= 15 || slg >= 0.55 || ops >= 0.9) return "CORE DANGER";
  if (score >= 58 || hr >= 10 || slg >= 0.48 || ops >= 0.8) return "LIVE POWER";
  return "WATCH BAT";
}

function renderPitcherDangerMeter(pitcher) {
  const era = Number(pitcher?.era || 0);
  const whip = Number(pitcher?.whip || 0);
  const hr = Number(pitcher?.homeRuns || 0);

  const eraScore = Math.min(100, Math.round((era / 8) * 100));
  const whipScore = Math.min(100, Math.round((whip / 2) * 100));
  const hrScore = Math.min(100, Math.round((hr / 15) * 100));

  return `
    <div class="pitcher-danger-meter">
      <div class="danger-meter-row">
        <span>ERA Risk</span>
        <div><i style="width:${eraScore}%"></i></div>
        <strong>${clean(pitcher?.era || "--")}</strong>
      </div>
      <div class="danger-meter-row">
        <span>Traffic</span>
        <div><i style="width:${whipScore}%"></i></div>
        <strong>${clean(pitcher?.whip || "--")}</strong>
      </div>
      <div class="danger-meter-row">
        <span>HR Leak</span>
        <div><i style="width:${hrScore}%"></i></div>
        <strong>${clean(pitcher?.homeRuns || "--")}</strong>
      </div>
    </div>
  `;
}

function openPitcherVulnerabilityProfile(pitcherName) {
  const rows = state.rows
    .filter(row => pitcherKey(row) === pitcherName)
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0));

  if (!rows.length) return;

  const pitcher = rows[0].stats?.pitcher || {};
  const topRows = rows.slice(0, 5);
  const riskLabel = pitcherRiskLabel(pitcher);

  const modal = document.getElementById("profile-modal");
  const body = document.getElementById("profile-body");

  body.innerHTML = `
    <div class="profile-top pitcher-profile-top">
      <div>
        <div class="profile-rank">PITCHER VULNERABILITY</div>
        <h2>${clean(pitcherName)}</h2>
        <p>${clean(rows[0].game || "")}</p>
      </div>
      <div class="profile-score">
        <span>${clean(rows[0].score || "--")}</span>
        <small>Top Bat Score</small>
      </div>
    </div>

    <div class="pitcher-risk-banner">
      <div>
        <span>Risk Grade</span>
        <strong>${riskLabel}</strong>
      </div>
      <p>${rows.length} bats from this matchup are currently showing on the HR board.</p>
    </div>

    <div class="profile-summary">
      <div>
        <span class="profile-label">ERA</span>
        <strong>${clean(pitcher.era || "--")}</strong>
      </div>
      <div>
        <span class="profile-label">WHIP</span>
        <strong>${clean(pitcher.whip || "--")}</strong>
      </div>
      <div>
        <span class="profile-label">HR Allowed</span>
        <strong>${clean(pitcher.homeRuns || "--")}</strong>
      </div>
      <div>
        <span class="profile-label">Attack Pool</span>
        <strong>${rows.length} bats</strong>
      </div>
      <div>
        <span class="profile-label">Hits Allowed</span>
        <strong>${clean(pitcher.hits || "--")}</strong>
      </div>
      <div>
        <span class="profile-label">Walks</span>
        <strong>${clean(pitcher.baseOnBalls || "--")}</strong>
      </div>
      <div>
        <span class="profile-label">Strikeouts</span>
        <strong>${clean(pitcher.strikeOuts || "--")}</strong>
      </div>
      <div>
        <span class="profile-label">IP</span>
        <strong>${clean(pitcher.inningsPitched || "--")}</strong>
      </div>
    </div>

    ${renderPitcherDangerMeter(pitcher)}

    ${renderBallparkWeather(rows[0].venue)}

    <h3>Why This Pitcher Is Vulnerable</h3>
    <div class="profile-explainer">
      <ul class="matchup-read-list">
        ${pitcherRiskBullets(pitcher, rows).map(item => `<li>${item}</li>`).join("")}
      </ul>
    </div>

    <h3>Top Danger Bats</h3>

    <div class="pitcher-batter-board">
      ${topRows.map((row, index) => {
        const hitter = row.stats?.hitter || {};
        return `
          <article class="pitcher-batter-card" data-profile-index="${state.rows.indexOf(row)}">
            <div class="pitcher-batter-topline">
              <div class="pitcher-batter-rank">#${index + 1}</div>
              <div class="pitcher-batter-chip">${hitterPowerLabel(row)}</div>
            </div>

            <div class="pitcher-batter-main">
              <strong>${clean(row.player || "Unknown Player")}</strong>
              <span>${clean(row.team || "")} • ${clean(row.edge || "HR target")}</span>
            </div>

            <div class="pitcher-batter-tags">
              <span>Score ${clean(row.score || "--")}</span>
              <span>Side ${clean(row.batSide || "--")}</span>
              <span>HR ${clean(hitter.hr || "--")}</span>
              <span>SLG ${clean(hitter.slg || "--")}</span>
              <span>OPS ${clean(hitter.ops || "--")}</span>
              <span>AVG ${clean(hitter.avg || "--")}</span>
            </div>

            <p>${clean(row.note || "Model likes this bat based on power profile, matchup context, and pitcher vulnerability.")}</p>
          </article>
        `;
      }).join("")}
    </div>

    ${rows.length > 5 ? `
      <h3>Other Bats In This Pool</h3>
      <div class="pitcher-mini-list">
        ${rows.slice(5).map(row => `
          <button data-profile-index="${state.rows.indexOf(row)}">
            <strong>${clean(row.player)}</strong>
            <span>${clean(row.score)} score • ${clean(row.edge || "Watch")}</span>
          </button>
        `).join("")}
      </div>
    ` : ""}
  `;

  modal.classList.add("show");

  body.querySelectorAll("[data-profile-index]").forEach(card => {
    card.addEventListener("click", event => {
      event.stopPropagation();
      openPlayerProfile(Number(card.dataset.profileIndex));
    });
  });
}



function liveStatusText(row) {
  const raw = String(
    row.status ||
    row.gameStatus ||
    row.detailedState ||
    row.abstractGameState ||
    row.statusCode ||
    ""
  ).trim();

  const inning = row.currentInning || row.inning || "";
  const inningState = row.inningState || row.halfInning || "";

  if (/final/i.test(raw)) return "FINAL";
  if (/delay|postponed|suspended/i.test(raw)) return raw.toUpperCase();
  if (/live|in progress|progress/i.test(raw)) {
    if (inning) {
      const half = String(inningState || "").toUpperCase();
      return `${half ? half + " " : ""}${inning}`;
    }
    return "LIVE";
  }
  if (/preview|scheduled|pre-game|warmup/i.test(raw)) return "SCHEDULED";
  if (row.awayScore != null || row.homeScore != null) return "LIVE";

  return raw ? raw.toUpperCase() : "SCHEDULED";
}

function liveStatusClass(row) {
  const text = liveStatusText(row);

  if (/FINAL/.test(text)) return "status-pill final";
  if (/DELAY|POSTPONED|SUSPENDED/.test(text)) return "status-pill delayed";
  if (/LIVE|TOP|BOT|MID|END|^[0-9]+$/.test(text)) return "status-pill live";
  return "status-pill scheduled";
}

function renderLiveStatusPill(row) {
  return `<span class="${liveStatusClass(row)}">${liveStatusText(row)}</span>`;
}

function groupRowsByGame(rows) {
  const map = new Map();

  rows.forEach(row => {
    const key = row.game || `${row.team || "Unknown"} vs ${row.opponent || "Unknown"}`;

    if (!map.has(key)) {
      map.set(key, {
        game: key,
        venue: row.venue || "",
        rows: []
      });
    }

    map.get(key).rows.push(row);
  });

  return [...map.values()]
    .map(group => ({
      ...group,
      rows: group.rows.sort((a, b) => Number(b.score || 0) - Number(a.score || 0)),
      topScore: Math.max(...group.rows.map(row => Number(row.score || 0)))
    }))
    .sort((a, b) => b.topScore - a.topScore);
}

function renderPlayerBoardCard(row, index) {
  return `
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
  `;
}

function renderGroupedHomeRunBoard(rows) {
  const groups = groupRowsByGame(rows);

  return `
    ${renderTopVulnerabilities(rows)}

    <div class="game-group-board">
      ${groups.map(group => `
        <section class="game-group">
          <div class="game-group-header">
            <div>
              <span>GAME STACK</span>
              <h3>${clean(group.game)}</h3>
              <p>${clean(group.venue || "Venue TBD")} ${renderLiveStatusPill(group.rows[0])}</p>
            </div>

            <div class="game-group-meta">
              <strong>${group.rows.length}</strong>
              <span>Bats</span>
            </div>

            <div class="game-group-meta">
              <strong>${clean(group.topScore)}</strong>
              <span>Top Score</span>
            </div>
          </div>

          <div class="game-group-grid">
            ${group.rows.map(row => renderPlayerBoardCard(row, state.rows.indexOf(row))).join("")}
          </div>
        </section>
      `).join("")}
    </div>
  `;
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

  const [raw, updatedInfo, weatherRows, parkRows, statcastZones] = await Promise.all([
    loadRows(),
    loadLastUpdated(),
    loadWeather(),
    loadParkFactors(),
    loadStatcastZones()
  ]);

  const rows = state.market === "games"
    ? raw.games || []
    : state.market === "weather"
      ? raw.weather || []
      : raw;

  state.rows = rows;
  state.weather = weatherRows;
  state.parks = parkRows;
  state.statcastZones = statcastZones;

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
          ${renderLiveStatusPill(row)}
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

  board.innerHTML = state.market === "home_runs"
    ? renderGroupedHomeRunBoard(rows)
    : `
      <div class="main-board-grid">
        ${rows.map((row, index) => renderPlayerBoardCard(row, index)).join("")}
      </div>
    `;

  document.querySelectorAll("[data-profile-index]").forEach(card => {
    card.addEventListener("click", () => {
      openPlayerProfile(Number(card.dataset.profileIndex));
    });
  });

  document.querySelectorAll("[data-pitcher-profile]").forEach(card => {
    card.addEventListener("click", () => {
      openPitcherVulnerabilityProfile(decodeURIComponent(card.dataset.pitcherProfile));
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
