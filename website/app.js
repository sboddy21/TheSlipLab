const state = {
  sport: "mlb",
  market: "home_runs",
  rows: [],
  weather: [],
  parks: [],
  statcastZones: null,
  stacks: null
};

const marketFiles = {
  mlb: {
    home_runs: "data/mlb_home_runs.json",
    hits: "data/mlb_hits.json",
    total_bases: "data/mlb_total_bases.json",
    rbis: "data/mlb_rbis.json",
    games: "data/mlb_games_today.json",
    weather: "data/mlb_weather.json",
    results: "data/mlb_results.json"
  }
};

function clean(value, fallback = "--") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function titleCase(text) {
  return String(text || "").replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
}

function showAppError(error) {
  const board = document.getElementById("board");
  const meta = document.getElementById("board-meta");

  if (meta) meta.textContent = "App error detected";

  if (board) {
    board.innerHTML = `
      <div class="empty">
        <strong>Site error:</strong><br>
        ${clean(error?.message || error)}
      </div>
    `;
  }

  console.error(error);
}

function formatUpdatedTime(iso) {
  if (!iso) return "Loading...";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "Loading...";

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function formatGameTime(iso) {
  if (!iso) return "TBD";

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) return "TBD";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

async function fetchJson(file, fallback) {
  try {
    const res = await fetch(file, { cache: "no-store" });

    if (!res.ok) return fallback;

    return await res.json();
  } catch (error) {
    console.error(error);
    return fallback;
  }
}

async function loadRows() {
  const file = marketFiles[state.sport]?.[state.market];

  if (!file) return [];

  return fetchJson(file, []);
}

async function loadLastUpdated() {
  return fetchJson("data/site_last_updated.json", null);
}

async function loadWeather() {
  const data = await fetchJson("data/mlb_weather.json", { weather: [] });
  return data.weather || data.rows || [];
}

async function loadParkFactors() {
  const data = await fetchJson("data/mlb_park_factors.json", { parks: [] });
  return data.parks || data.rows || [];
}

async function loadStatcastZones() {
  return fetchJson("data/statcast_zones.json", null);
}

async function loadTeamStacks() {
  return fetchJson("data/mlb_team_stacks.json", { stacks: [] });
}

function getWeatherForVenue(venue) {
  if (!venue || !Array.isArray(state.weather)) return null;

  return state.weather.find(row =>
    String(row.venue || "").toLowerCase() === String(venue || "").toLowerCase()
  ) || null;
}

function getParkForVenue(venue) {
  if (!venue || !Array.isArray(state.parks)) return null;

  return state.parks.find(row =>
    String(row.venue || "").toLowerCase() === String(venue || "").toLowerCase()
  ) || null;
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

function parkHrGrade(park) {
  const factor = number(park?.hrFactor, 100);

  if (factor >= 112) return { label: "ELITE HR PARK", className: "elite" };
  if (factor >= 104) return { label: "HR FRIENDLY", className: "good" };
  if (factor >= 96) return { label: "NEUTRAL", className: "neutral" };

  return { label: "SUPPRESSED", className: "cold" };
}

function renderParkDimensionDiagram(park, weather, isDome) {
  const arrow = Number.isFinite(Number(weather?.arrowDegrees)) ? Number(weather.arrowDegrees) : 0;

  return `
    <div class="park-dimension-diagram">
      <div class="park-wall park-wall-lf"><span>LF</span><strong>${clean(park?.lf)}</strong></div>
      <div class="park-wall park-wall-lcf"><span>LCF</span><strong>${clean(park?.lcf)}</strong></div>
      <div class="park-wall park-wall-cf"><span>CF</span><strong>${clean(park?.cf)}</strong></div>
      <div class="park-wall park-wall-rcf"><span>RCF</span><strong>${clean(park?.rcf)}</strong></div>
      <div class="park-wall park-wall-rf"><span>RF</span><strong>${clean(park?.rf)}</strong></div>

      <div class="field-arc"></div>
      <div class="field-grass"></div>
      <div class="field-diamond"></div>
      <div class="field-home"></div>

      ${isDome
        ? `<div class="field-center-badge">ROOF</div>`
        : `<div class="wind-arrow wind-arrow-park" style="transform: translate(-50%, -50%) rotate(${arrow}deg);">➜</div>`
      }
    </div>
  `;
}

function renderParkAttackPanel(park) {
  if (!park) {
    return `
      <div class="park-attack-panel">
        <div class="park-attack-empty">Park dimension data is not loaded for this venue yet.</div>
      </div>
    `;
  }

  const grade = parkHrGrade(park);
  const factor = number(park.hrFactor, 100);
  const meter = Math.max(0, Math.min(100, Math.round((factor / 125) * 100)));

  return `
    <div class="park-attack-panel">
      <div class="park-attack-grade ${grade.className}">
        <span>HR Park Grade</span>
        <strong>${grade.label}</strong>
        <small>${clean(park.hrFactor)} HR factor</small>
      </div>

      <div class="park-hr-meter">
        <div>
          <span>HR Carry</span>
          <strong>${clean(park.hrFactor)}</strong>
        </div>
        <i><b style="width:${meter}%"></b></i>
      </div>

      <div class="park-fit-grid">
        <div><span>Lefty Pull Fit</span><strong>${clean(park.leftyBoost || "Neutral")}</strong></div>
        <div><span>Righty Pull Fit</span><strong>${clean(park.rightyBoost || "Neutral")}</strong></div>
        <div><span>Roof</span><strong>${clean(park.roof || "Open Air")}</strong></div>
      </div>

      <div class="park-summary">
        ${clean(park.summary || "Park profile loaded.")}
      </div>
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
        <h3>Ballpark Environment</h3>
        <div class="weather-empty">Weather data loading for this park.</div>
        ${renderParkAttackPanel(park)}
      </div>
    `;
  }

  const windText = isDome
    ? "Fixed roof or dome environment. Wind is not treated as active inside the park."
    : `Wind ${weather.windSpeed ?? "--"} MPH ${weather.windCompass || ""}. Arrow shows live wind flow across the field.`;

  return `
    <div class="park-weather-card">
      <div class="park-weather-head">
        <div>
          <h3>Ballpark Environment</h3>
          <p>${clean(weather.venue)} • ${clean(weather.city, "")}</p>
        </div>
        <div class="weather-live-pill">LIVE</div>
      </div>

      <div class="weather-grid">
        <div class="weather-stat"><span>Temp</span><strong>${weather.temp ?? "--"}°F</strong></div>
        <div class="weather-stat"><span>Humidity</span><strong>${weather.humidity ?? "--"}%</strong></div>
        <div class="weather-stat"><span>Wind</span><strong>${isDome ? "Roof" : `${weather.windSpeed ?? "--"} MPH`}</strong></div>
        <div class="weather-stat"><span>Direction</span><strong>${isDome ? "Indoor" : weather.windCompass || "--"}</strong></div>
      </div>

      ${renderParkDimensionDiagram(park, weather, isDome)}
      ${renderParkAttackPanel(park)}

      <div class="wind-read">${windText}</div>
    </div>
  `;
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
  const n = number(value);

  if (metric === "k") {
    if (n >= 0.3) return "hot";
    if (n >= 0.2) return "warm";
    return "neutral";
  }

  if (metric === "hr") {
    if (n >= 2) return "hot";
    if (n >= 1) return "warm";
    return "neutral";
  }

  if (n >= 0.5) return "hot";
  if (n >= 0.3) return "warm";

  return "neutral";
}

function formatZoneValue(value, metric) {
  const n = number(value);

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

function strongestZones(values, count = 3) {
  return values
    .map((value, index) => ({ value: number(value), index }))
    .sort((a, b) => b.value - a.value)
    .slice(0, count);
}

function sprayDirectionSummary(playerZones) {
  const hr = playerZones?.zones?.hr || [];
  const barrel = playerZones?.zones?.barrel || [];
  const iso = playerZones?.zones?.iso || [];

  let pull = 0;
  let middle = 0;
  let oppo = 0;

  hr.forEach((value, index) => {
    const col = index % 5;
    const total = number(value) + number(barrel[index]) + number(iso[index]);

    if (col <= 1) pull += total;
    else if (col === 2) middle += total;
    else oppo += total;
  });

  if (pull >= middle && pull >= oppo) return "PULL SIDE DAMAGE";
  if (middle >= pull && middle >= oppo) return "MIDDLE LANE POWER";

  return "OPPO POWER";
}

function renderSprayOverlay(playerZones) {
  const hr = playerZones?.zones?.hr || [];
  const barrel = playerZones?.zones?.barrel || [];
  const hardHit = playerZones?.zones?.hardHit || [];
  const iso = playerZones?.zones?.iso || [];

  const topHr = strongestZones(hr, 4);
  const topBarrel = strongestZones(barrel, 4);

  return `
    <div class="spray-overlay-card">
      <div class="spray-overlay-header">
        <div>
          <strong>Power Spray Overlay</strong>
          <span>${sprayDirectionSummary(playerZones)}</span>
        </div>

        <div class="spray-overlay-legend">
          <div><i class="hr"></i> HR</div>
          <div><i class="barrel"></i> Barrel</div>
          <div><i class="hard"></i> Hard Hit</div>
        </div>
      </div>

      <div class="spray-overlay-grid">
        ${Array.from({ length: 25 }).map((_, index) => {
          const hrVal = number(hr[index]);
          const barrelVal = number(barrel[index]);
          const hardVal = number(hardHit[index]);
          const isoVal = number(iso[index]);
          const isHrHot = topHr.some(zone => zone.index === index && zone.value > 0);
          const isBarrelHot = topBarrel.some(zone => zone.index === index && zone.value > 0);

          let cls = "neutral";

          if (isHrHot) cls = "hr-hot";
          else if (isBarrelHot) cls = "barrel-hot";
          else if (hardVal >= 0.35 || isoVal >= 0.35) cls = "hard-hot";

          return `<div class="spray-zone ${cls}"><span>${hrVal > 0 ? Math.round(hrVal) : ""}</span></div>`;
        }).join("")}
      </div>

      <div class="spray-overlay-summary">
        <div><strong>${topHr.filter(zone => zone.value > 0).length}</strong><span>HR Lanes</span></div>
        <div><strong>${topBarrel.filter(zone => zone.value > 0).length}</strong><span>Barrel Lanes</span></div>
        <div><strong>${clean(playerZones.rows)}</strong><span>Tracked Pitches</span></div>
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

        ${renderSprayOverlay(playerZones)}

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
  const bullets = [];

  if (number(hitter.hr) >= 10) bullets.push(`${row.player} has live season power with ${hitter.hr} HR.`);
  if (number(hitter.slg) >= 0.5) bullets.push(`Slugging profile is strong at ${hitter.slg}.`);
  if (number(hitter.ops) >= 0.85) bullets.push(`OPS profile supports the power read at ${hitter.ops}.`);
  if (number(pitcher.era) >= 5) bullets.push(`Opposing pitcher has an elevated ERA at ${pitcher.era}.`);
  if (number(pitcher.whip) >= 1.4) bullets.push(`Traffic risk is live with a ${pitcher.whip} WHIP.`);
  if (number(pitcher.homeRuns) >= 5) bullets.push(`${pitcher.homeRuns} HR allowed creates long ball vulnerability.`);

  if (!bullets.length) {
    bullets.push("Model ranking is driven by combined power score, pitcher profile, game context, and park setup.");
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

  if (!modal || !body) return;

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
      <div><span class="profile-label">Game</span><strong>${clean(row.game)}</strong></div>
      <div><span class="profile-label">Venue</span><strong>${clean(row.venue)}</strong></div>
      <div><span class="profile-label">Opposing Pitcher</span><strong>${clean(row.opposingPitcher)}</strong></div>
      <div><span class="profile-label">Model Read</span><strong>${clean(row.edge)}</strong></div>
    </div>

    <div class="profile-note">${clean(row.note, "No matchup note available yet.")}</div>

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

  if (modal) modal.classList.remove("show");
}

function pitcherKey(row) {
  return String(row.opposingPitcher || row.pitcher || "Unknown Pitcher").trim();
}

function pitcherAttackGrade(pitcher) {
  const era = number(pitcher?.era);
  const whip = number(pitcher?.whip);
  const hr = number(pitcher?.homeRuns);
  const hits = number(pitcher?.hits);
  const walks = number(pitcher?.baseOnBalls);
  const innings = number(pitcher?.inningsPitched);

  let score = 0;

  if (era >= 6) score += 30;
  else if (era >= 4.5) score += 20;
  else if (era >= 3.8) score += 10;

  if (whip >= 1.6) score += 25;
  else if (whip >= 1.35) score += 16;
  else if (whip >= 1.2) score += 8;

  if (hr >= 10) score += 18;
  else if (hr >= 5) score += 12;
  else if (hr >= 1) score += 6;

  if (innings > 0 && hits / innings >= 1.15) score += 12;
  if (innings > 0 && walks / innings >= 0.45) score += 10;

  if (score >= 70) return { label: "GREEN ATTACK", className: "green", score };
  if (score >= 45) return { label: "PLAYABLE ATTACK", className: "yellow", score };
  if (score >= 25) return { label: "WATCH ONLY", className: "gray", score };

  return { label: "RED AVOID", className: "red", score };
}

function renderTopVulnerabilities(rows) {
  if (!rows || !rows.length || state.market !== "home_runs") return "";

  const map = new Map();

  rows.forEach(row => {
    const key = pitcherKey(row);

    if (!map.has(key)) {
      map.set(key, {
        pitcher: key,
        rows: [],
        score: number(row.score),
        era: row.stats?.pitcher?.era || "--",
        game: row.game || "",
        team: row.team || "",
        opponent: row.opponent || ""
      });
    }

    const item = map.get(key);
    item.rows.push(row);
    item.score = Math.max(item.score, number(row.score));
  });

  const vulnRows = [...map.values()]
    .sort((a, b) => b.score - a.score)
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
            <div class="top-vuln-score">${clean(item.score)}</div>
            <div class="top-vuln-label">${item.rows.length} BATS</div>
            <div class="top-vuln-pitcher">${clean(item.pitcher)}</div>
            <div class="top-vuln-matchup">${clean(item.game || `${item.team} vs ${item.opponent}`)}</div>
            <div class="top-vuln-era">ERA ${clean(item.era)}</div>
            <div class="top-vuln-attack">${pitcherAttackGrade(item.rows[0]?.stats?.pitcher || {}).label}</div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function openPitcherVulnerabilityProfile(pitcherName) {
  const rows = state.rows
    .filter(row => pitcherKey(row) === pitcherName)
    .sort((a, b) => number(b.score) - number(a.score));

  if (!rows.length) return;

  const pitcher = rows[0].stats?.pitcher || {};
  const modal = document.getElementById("profile-modal");
  const body = document.getElementById("profile-body");

  if (!modal || !body) return;

  body.innerHTML = `
    <div class="profile-top pitcher-profile-top">
      <div>
        <div class="profile-rank">PITCHER VULNERABILITY</div>
        <h2>${clean(pitcherName)}</h2>
        <p>${clean(rows[0].game)}</p>
      </div>
      <div class="profile-score">
        <span>${clean(rows[0].score)}</span>
        <small>Top Bat Score</small>
      </div>
    </div>

    <div class="profile-summary">
      <div><span class="profile-label">ERA</span><strong>${clean(pitcher.era)}</strong></div>
      <div><span class="profile-label">WHIP</span><strong>${clean(pitcher.whip)}</strong></div>
      <div><span class="profile-label">HR Allowed</span><strong>${clean(pitcher.homeRuns)}</strong></div>
      <div><span class="profile-label">Attack Pool</span><strong>${rows.length} bats</strong></div>
      <div><span class="profile-label">Hits Allowed</span><strong>${clean(pitcher.hits)}</strong></div>
      <div><span class="profile-label">Walks</span><strong>${clean(pitcher.baseOnBalls)}</strong></div>
      <div><span class="profile-label">Strikeouts</span><strong>${clean(pitcher.strikeOuts)}</strong></div>
      <div><span class="profile-label">IP</span><strong>${clean(pitcher.inningsPitched)}</strong></div>
    </div>

    ${renderBallparkWeather(rows[0].venue)}

    <h3>Top Danger Bats</h3>

    <div class="pitcher-batter-board">
      ${rows.slice(0, 6).map((row, index) => {
        const hitter = row.stats?.hitter || {};
        const realIndex = state.rows.indexOf(row);

        return `
          <article class="pitcher-batter-card" data-profile-index="${realIndex}">
            <div class="pitcher-batter-topline">
              <div class="pitcher-batter-rank">#${index + 1}</div>
              <div class="pitcher-batter-chip">LIVE POWER</div>
            </div>

            <div class="pitcher-batter-main">
              <strong>${clean(row.player)}</strong>
              <span>${clean(row.team)} • ${clean(row.edge || "HR target")}</span>
            </div>

            <div class="pitcher-batter-tags">
              <span>Score ${clean(row.score)}</span>
              <span>Side ${clean(row.batSide)}</span>
              <span>HR ${clean(hitter.hr)}</span>
              <span>SLG ${clean(hitter.slg)}</span>
              <span>OPS ${clean(hitter.ops)}</span>
              <span>AVG ${clean(hitter.avg)}</span>
            </div>

            <p>${clean(row.note || "Model likes this bat based on power profile, matchup context, and pitcher vulnerability.")}</p>
          </article>
        `;
      }).join("")}
    </div>
  `;

  modal.classList.add("show");
}

function liveStatusText(row) {
  const raw = String(row.status || row.gameStatus || row.detailedState || row.abstractGameState || "").trim();
  const inning = row.currentInning || row.inning || "";
  const inningState = row.inningState || row.halfInning || "";

  if (/final|game over/i.test(raw)) return "FINAL";
  if (/delay|postponed|suspended/i.test(raw)) return raw.toUpperCase();
  if (/live|in progress|progress/i.test(raw)) {
    if (inning) return `${String(inningState || "").toUpperCase()} ${inning}`.trim();
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

function lineupStatusClass(status) {
  const value = String(status || "").toUpperCase();

  if (value.includes("BOTH CONFIRMED") || value === "CONFIRMED") return "lineup-pill confirmed";
  if (value.includes("PARTIAL")) return "lineup-pill partial";

  return "lineup-pill pending";
}

function renderLineupStatus(row) {
  return `
    <div class="lineup-lock-row">
      <span class="${lineupStatusClass(row.lineupLockStatus)}">${clean(row.lineupLockStatus || "NOT POSTED")}</span>
      <span>${clean(row.awayLineupCount || 0)}/9 ${clean(row.awayTeam || "Away")}</span>
      <span>${clean(row.homeLineupCount || 0)}/9 ${clean(row.homeTeam || "Home")}</span>
    </div>
  `;
}

function renderTeamLineup(teamName, status, lineup) {
  const rows = Array.isArray(lineup) ? lineup : [];

  return `
    <div class="team-lineup-block">
      <div class="team-lineup-head">
        <strong>${clean(teamName)}</strong>
        <span class="${lineupStatusClass(status)}">${clean(status || "NOT POSTED")}</span>
      </div>

      <div class="lineup-order-list">
        ${rows.length ? rows.map(player => `
          <div class="lineup-order-row">
            <span>${clean(player.order)}</span>
            <strong>${clean(player.player)}</strong>
            <em>${clean(player.position || "--")}</em>
          </div>
        `).join("") : `<div class="lineup-empty">Lineup has not been posted yet.</div>`}
      </div>
    </div>
  `;
}

function renderGameLineups(row) {
  return `
    <div class="game-lineup-panel">
      ${renderTeamLineup(row.awayTeam, row.awayLineupStatus, row.awayBattingOrder)}
      ${renderTeamLineup(row.homeTeam, row.homeLineupStatus, row.homeBattingOrder)}
    </div>
  `;
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
      rows: group.rows.sort((a, b) => number(b.score) - number(a.score)),
      topScore: Math.max(...group.rows.map(row => number(row.score)))
    }))
    .sort((a, b) => b.topScore - a.topScore);
}

function renderPlayerBoardCard(row, index) {
  return `
    <article class="card clickable-card" data-profile-index="${index}">
      <div class="rank">#${clean(row.rank || index + 1)}</div>

      <div>
        <div class="player">${clean(row.player || "Unknown Player")}</div>
        <div class="meta">${clean(row.team || "")} • ${clean(row.game || "")}</div>
        ${state.market === "home_runs" ? renderWeatherMini(row.venue) : ""}
      </div>

      <div class="stat">
        <div class="stat-label">Score</div>
        <div class="stat-value">${clean(row.score)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Profile</div>
        <div class="stat-value">Open</div>
      </div>
    </article>
  `;
}

function renderTeamStackStrip() {
  const stacks = state.stacks?.stacks || [];

  if (!stacks.length || state.market !== "home_runs") return "";

  return `
    <section class="stack-strip">
      <div class="stack-strip-head">
        <div>
          <span>TEAM STACK INTELLIGENCE</span>
          <h2>Top Stack Spots</h2>
        </div>
      </div>

      <div class="stack-strip-grid">
        ${stacks.slice(0, 5).map(stack => `
          <article class="stack-card">
            <div class="stack-card-top">
              <strong>${clean(stack.team)}</strong>
              <span>${clean(stack.grade)}</span>
            </div>

            <div class="stack-score">${clean(stack.stackScore)}</div>

            <div class="stack-meta">
              <span>${clean(stack.bats)} bats</span>
              <span>vs ${clean(stack.opposingPitcher)}</span>
              <span>Park ${clean(stack.parkFactor || "--")}</span>
            </div>

            <div class="stack-hitters">
              ${(stack.hitters || []).slice(0, 4).map(hitter => `
                <div>
                  <strong>${clean(hitter.player)}</strong>
                  <span>Score ${clean(hitter.score)} • HR ${clean(hitter.hr || "--")}</span>
                </div>
              `).join("")}
            </div>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderGroupedHomeRunBoard(rows) {
  const groups = groupRowsByGame(rows);

  return `
    ${renderTopVulnerabilities(rows)}
    ${renderTeamStackStrip()}

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

function renderResultsBoard(data) {
  const rows = data?.results || [];
  const total = data?.totalHomeRuns || rows.length || 0;
  const flagged = data?.modelFlaggedHomeRuns || 0;
  const rate = data?.modelFlagRate || 0;

  return `
    <section class="results-lab">
      <div class="results-hero">
        <div>
          <span>MODEL VALIDATION</span>
          <h2>HR Results</h2>
          <p>Every home run from the live MLB feed matched against The Slip Lab board.</p>
        </div>

        <div class="results-scorebox"><strong>${flagged}/${total}</strong><span>Model flagged HRs</span></div>
        <div class="results-scorebox"><strong>${rate}%</strong><span>Flag rate</span></div>
      </div>

      <div class="results-table">
        <div class="results-row results-head">
          <div>#</div>
          <div>Batter</div>
          <div>Team</div>
          <div>Pitcher</div>
          <div>Score</div>
          <div>Model</div>
          <div>Tags</div>
        </div>

        ${rows.length ? rows.map(row => `
          <div class="results-row">
            <div>${clean(row.rank)}</div>
            <div><strong>${clean(row.player)}</strong><span>${clean(row.description || "Home run")}</span></div>
            <div>${clean(row.team)}</div>
            <div><strong>${clean(row.pitcher || "Unknown")}</strong><span>ERA ${clean(row.opposingPitcherEra || "--")}</span></div>
            <div class="result-score">${clean(row.modelScore || "--")}</div>
            <div><span class="${row.wasOnBoard ? "result-flag yes" : "result-flag no"}">${row.wasOnBoard ? "FLAGGED" : "NOT FLAGGED"}</span></div>
            <div class="result-tags">${(row.tags || []).map(tag => `<span>${clean(tag)}</span>`).join("")}</div>
          </div>
        `).join("") : `<div class="results-empty">No HR results found yet.</div>`}
      </div>
    </section>
  `;
}

async function render() {
  document.querySelectorAll("nav button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.sport === state.sport);
  });

  document.querySelectorAll(".tabs button").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.market === state.market);
  });

  const pageTitle = document.getElementById("page-title");
  const pageSubtitle = document.getElementById("page-subtitle");
  const board = document.getElementById("board");
  const boardTitle = document.getElementById("board-title");
  const boardMeta = document.getElementById("board-meta");

  if (!board || !boardTitle || !boardMeta) return;

  if (pageTitle) pageTitle.textContent = `${state.sport.toUpperCase()} Lab`;
  if (pageSubtitle) {
    pageSubtitle.textContent =
      state.sport === "mlb"
        ? "Home Runs, Hits, Total Bases, and RBIs."
        : "Coming soon.";
  }

  boardTitle.textContent = titleCase(state.market);
  board.innerHTML = `<div class="empty">Loading ${state.sport.toUpperCase()} ${titleCase(state.market)} data...</div>`;

  const [raw, updatedInfo, weatherRows, parkRows, statcastZones, stackRows] = await Promise.all([
    loadRows(),
    loadLastUpdated(),
    loadWeather(),
    loadParkFactors(),
    loadStatcastZones(),
    loadTeamStacks()
  ]);

  const rows = state.market === "games"
    ? raw.games || []
    : state.market === "weather"
      ? raw.weather || []
      : state.market === "results"
        ? raw.results || []
        : Array.isArray(raw)
          ? raw
          : [];

  state.rows = rows;
  state.weather = weatherRows;
  state.parks = parkRows;
  state.statcastZones = statcastZones;
  state.stacks = stackRows;

  const updated = formatUpdatedTime(updatedInfo?.updated_at || updatedInfo?.updatedAt);

  boardMeta.textContent = `${rows.length} rows loaded • Last Updated ${updated}`;

  const topUpdated = document.getElementById("top-updated");

  if (topUpdated) {
    topUpdated.textContent = `Last Updated: ${updated}`;
  }

  if (state.market === "results") {
    board.innerHTML = renderResultsBoard(raw);
    return;
  }

  if (!rows.length) {
    board.innerHTML = `<div class="empty">${state.sport.toUpperCase()} ${titleCase(state.market)} data coming soon.</div>`;
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
          <div class="player">${clean(row.matchup || "MLB Game")}</div>
          <div class="meta">${clean(row.venue || "")} • ${formatGameTime(row.gameDate)}</div>
          ${renderLiveStatusPill(row)}
          ${renderLineupStatus(row)}
          ${renderWeatherMini(row.venue)}
        </div>

        <div class="stat"><div class="stat-label">Away SP</div><div class="stat-value">${clean(row.awayProbablePitcher || "TBD")}</div></div>
        <div class="stat"><div class="stat-label">Home SP</div><div class="stat-value">${clean(row.homeProbablePitcher || "TBD")}</div></div>
        <div class="stat"><div class="stat-label">Score</div><div class="stat-value">${row.awayScore ?? "--"} • ${row.homeScore ?? "--"}</div></div>
        <div class="stat"><div class="stat-label">Game ID</div><div class="stat-value">${clean(row.gamePk)}</div></div>

        ${renderGameLineups(row)}
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
}

document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.sport = btn.dataset.sport;
    render().catch(showAppError);
  });
});

document.querySelectorAll(".tabs button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.market = btn.dataset.market;
    render().catch(showAppError);
  });
});

document.addEventListener("click", event => {
  const playerCard = event.target.closest("[data-profile-index]");

  if (playerCard) {
    event.preventDefault();
    openPlayerProfile(Number(playerCard.dataset.profileIndex));
    return;
  }

  const pitcherCard = event.target.closest("[data-pitcher-profile]");

  if (pitcherCard) {
    event.preventDefault();
    openPitcherVulnerabilityProfile(decodeURIComponent(pitcherCard.dataset.pitcherProfile));
  }
});

const profileClose = document.getElementById("profile-close");

if (profileClose) {
  profileClose.addEventListener("click", closePlayerProfile);
}

render().catch(showAppError);
