const state = {
  sport: "mlb",
  market: "home_runs",
  rows: [],
  weather: [],
  parks: [],
  statcastZones: null,
  stacks: null,
  stackIntel: null,
  stackLeverage: null,
  collapseAlerts: null,
  searchQuery: "",
  searchTeam: "all",
  searchGame: "all",
  searchPosition: "all",
  searchSort: "name"
};

const marketFiles = {
  mlb: {
    home_runs: "data/mlb_home_runs.json",
    hits: "data/mlb_hits.json",
    total_bases: "data/mlb_total_bases.json",
    rbis: "data/mlb_rbis.json",
    games: "data/mlb_games_today.json",
    weather: "data/mlb_weather.json",
    results: "data/mlb_results.json",
    stack_lab: "data/team_stack_intelligence_2.json",
    player_search: "data/mlb_player_pool.json"
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













async function loadHotColdAttackRegions() {
  try {
    const response = await fetch(`./data/hot_cold_attack_regions.json?v=${Date.now()}`);

    if (!response.ok) return {};

    return await response.json();
  } catch {
    return {};
  }
}

async function loadPitcherAttackZones() {
  try {
    const response = await fetch(`./data/pitcher_attack_zones.json?v=${Date.now()}`);

    if (!response.ok) return {};

    return await response.json();
  } catch {
    return {};
  }
}

async function loadParkCarryVisuals() {
  try {
    const response = await fetch(`./data/park_carry_visuals.json?v=${Date.now()}`);

    if (!response.ok) return {};

    return await response.json();
  } catch {
    return {};
  }
}

async function loadLaunchAngleClusters() {
  try {
    const response = await fetch(`./data/launch_angle_clusters.json?v=${Date.now()}`);

    if (!response.ok) return {};

    return await response.json();
  } catch {
    return {};
  }
}

async function loadHandednessOverlays() {
  try {
    const response = await fetch(`./data/handedness_overlays.json?v=${Date.now()}`);

    if (!response.ok) return {};

    return await response.json();
  } catch {
    return {};
  }
}

async function loadPitchTypeDamage() {
  try {
    const response = await fetch(`./data/pitch_type_damage.json?v=${Date.now()}`);

    if (!response.ok) return {};

    return await response.json();
  } catch {
    return {};
  }
}

async function loadStatcastZones() {
  return fetchJson("data/statcast_zones.json", null);
}

async function loadTeamStacks() {
  return fetchJson("data/mlb_team_stacks.json", { stacks: [] });
}

async function loadStackIntelligence2() {
  return fetchJson("data/team_stack_intelligence_2.json", { stacks: [] });
}

async function loadStackLeverageProfiles() {
  return fetchJson("data/stack_leverage_profiles.json", { profiles: [] });
}

async function loadCollapseAlerts() {
  return fetchJson("data/collapse_alerts.json", { alerts: [] });
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

function getPlayerZoneData(player, row = null) {
  const zones = state.statcastZones?.players || {};

  if (row?.player && zones[row.player]) return zones[row.player];
  if (player && zones[player]) return zones[player];

  const rowPlayerId = row?.playerId ? String(row.playerId) : "";
  if (rowPlayerId) {
    const byId = Object.values(zones).find(zone => String(zone.playerId || "") === rowPlayerId);
    if (byId) return byId;
  }

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(zones).find(name => name.toLowerCase().trim() === normalized);
    if (key) return zones[key];
  }

  return null;
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

function sprayLaneBreakdown(playerZones, batSide = "") {
  const hr = playerZones?.zones?.hr || [];
  const barrel = playerZones?.zones?.barrel || [];
  const hardHit = playerZones?.zones?.hardHit || [];
  const iso = playerZones?.zones?.iso || [];

  const side = String(batSide || "").toUpperCase();

  const lanes = {
    pull: 0,
    center: 0,
    oppo: 0
  };

  hr.forEach((value, index) => {
    const col = index % 5;
    const rawTotal =
      number(value) * 2.25 +
      number(barrel[index]) * 2 +
      number(hardHit[index]) +
      number(iso[index]);

    let lane = "center";

    if (side === "L") {
      if (col >= 3) lane = "pull";
      else if (col <= 1) lane = "oppo";
    } else {
      if (col <= 1) lane = "pull";
      else if (col >= 3) lane = "oppo";
    }

    if (col === 2) lane = "center";

    lanes[lane] += rawTotal;
  });

  const total = lanes.pull + lanes.center + lanes.oppo || 1;

  return {
    pull: Math.round((lanes.pull / total) * 100),
    center: Math.round((lanes.center / total) * 100),
    oppo: Math.round((lanes.oppo / total) * 100),
    label:
      lanes.pull >= lanes.center && lanes.pull >= lanes.oppo
        ? "PULL SIDE DAMAGE"
        : lanes.center >= lanes.pull && lanes.center >= lanes.oppo
          ? "MIDDLE LANE POWER"
          : "OPPO POWER"
  };
}

function sprayPointStyle(index, playerZones, batSide = "") {
  const hr = number(playerZones?.zones?.hr?.[index]);
  const barrel = number(playerZones?.zones?.barrel?.[index]);
  const hardHit = number(playerZones?.zones?.hardHit?.[index]);
  const iso = number(playerZones?.zones?.iso?.[index]);

  const row = Math.floor(index / 5);
  const col = index % 5;
  const side = String(batSide || "").toUpperCase();

  const xBase = side === "L"
    ? [24, 34, 50, 66, 78][col]
    : [22, 34, 50, 66, 76][col];

  const yBase = [28, 40, 52, 64, 76][row];

  const heat = Math.min(1, (hr * 0.22) + (barrel * 1.25) + (hardHit * 0.72) + (iso * 0.5));
  const size = 10 + Math.round(heat * 26);

  let cls = "spray-dot";
  if (hr >= 2 || heat >= 0.72) cls += " hr";
  else if (barrel >= 0.22 || heat >= 0.52) cls += " barrel";
  else if (hardHit >= 0.35 || heat >= 0.36) cls += " hard";
  else cls += " soft";

  return {
    x: xBase,
    y: yBase,
    size,
    cls,
    label: hr > 0 ? `${Math.round(hr)} HR` : barrel > 0.1 ? `${Math.round(barrel * 100)}% Barrel` : `${Math.round(hardHit * 100)}% Hard`
  };
}

function renderInteractiveSprayChart(playerZones, row = {}) {
  const side = row.batSide || row.batSideDescription || "";
  const lanes = sprayLaneBreakdown(playerZones, side);
  const points = Array.from({ length: 25 }).map((_, index) => sprayPointStyle(index, playerZones, side));

  return `
    <div class="spray-chart-card">
      <div class="spray-chart-head">
        <div>
          <strong>Interactive Spray Chart</strong>
          <span>${lanes.label} • ${clean(side, "B")} bat path</span>
        </div>

        <div class="spray-chart-legend">
          <span><i class="hr"></i> HR lane</span>
          <span><i class="barrel"></i> Barrel lane</span>
          <span><i class="hard"></i> Hard hit</span>
        </div>
      </div>

      <div class="spray-stage" data-spray-stage>
        <div class="spray-field">
          <div class="spray-foul left"></div>
          <div class="spray-foul right"></div>
          <div class="spray-arc outer"></div>
          <div class="spray-arc inner"></div>
          <div class="spray-infield"></div>
          <div class="spray-home"></div>

          <div class="spray-label left">LF</div>
          <div class="spray-label center">CF</div>
          <div class="spray-label right">RF</div>

          ${points.map((point, index) => `
            <button
              type="button"
              class="${point.cls}"
              style="left:${point.x}%; top:${point.y}%; width:${point.size}px; height:${point.size}px;"
              data-spray-zone="${index + 1}"
              title="${point.label}"
            >
              <span>${point.label}</span>
            </button>
          `).join("")}
        </div>
      </div>

      <div class="spray-lanes">
        <div>
          <span>Pull</span>
          <strong>${lanes.pull}%</strong>
          <i><b style="width:${lanes.pull}%"></b></i>
        </div>
        <div>
          <span>Center</span>
          <strong>${lanes.center}%</strong>
          <i><b style="width:${lanes.center}%"></b></i>
        </div>
        <div>
          <span>Oppo</span>
          <strong>${lanes.oppo}%</strong>
          <i><b style="width:${lanes.oppo}%"></b></i>
        </div>
      </div>
    </div>
  `;
}

function renderSprayOverlay(playerZones, row = {}) {
  return renderInteractiveSprayChart(playerZones, row);
}

function renderStatcastZoneLab(row) {
  const playerZones = getPlayerZoneData(row.player, row);

  if (!playerZones || !playerZones.zones) {
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
          <span>${playerZones.rows || 25} powered zones • ${clean(playerZones.source || "Slip Lab model")}</span>
        </div>

        ${renderSprayOverlay(playerZones, row)}

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













function getHotColdAttackRegions(player, row = null) {
  const regions = state.hotColdAttackRegions?.players || {};

  if (row?.player && regions[row.player]) return regions[row.player];
  if (player && regions[player]) return regions[player];

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(regions).find(name => name.toLowerCase().trim() === normalized);
    if (key) return regions[key];
  }

  return null;
}

function hotColdClass(region) {
  if (region === "hot") return "hot";
  if (region === "warm") return "warm";
  if (region === "cold") return "cold";
  return "neutral";
}

function renderHotColdAttackRegions(row) {
  const data = getHotColdAttackRegions(row.player, row);

  if (!data?.regions?.regions) {
    return `
      <div class="hotcold-card">
        <div class="hotcold-head">
          <strong>Hot/Cold Attack Regions</strong>
          <span>No hot/cold region data loaded yet</span>
        </div>
      </div>
    `;
  }

  const regions = data.regions;

  return `
    <div class="hotcold-card">
      <div class="hotcold-head">
        <div>
          <strong>Hot/Cold Attack Regions</strong>
          <span>${clean(regions.read)}</span>
        </div>

        <div class="hotcold-score">
          <strong>${clean(regions.bestScore)}</strong>
          <span>Best Zone ${clean(regions.bestZone)}</span>
        </div>
      </div>

      <div class="hotcold-grid">
        ${regions.regions.map(region => `
          <div class="hotcold-cell ${hotColdClass(region.region)}">
            <span>${region.zone}</span>
            <strong>${region.combined}</strong>
          </div>
        `).join("")}
      </div>

      <div class="hotcold-summary">
        <div><span>Hot Regions</span><strong>${clean(regions.hotRegions)}</strong></div>
        <div><span>Cold Regions</span><strong>${clean(regions.coldRegions)}</strong></div>
        <div><span>Best Lane</span><strong>${clean(regions.bestLane)}</strong></div>
      </div>
    </div>
  `;
}


function getPitcherAttackZones(player, row = null) {
  const zones = state.pitcherAttackZones?.players || {};

  if (row?.player && zones[row.player]) return zones[row.player];
  if (player && zones[player]) return zones[player];

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(zones).find(name => name.toLowerCase().trim() === normalized);
    if (key) return zones[key];
  }

  return null;
}

function attackZoneClass(level) {
  const value = number(level);

  if (value >= 78) return "red";
  if (value >= 62) return "orange";
  if (value >= 44) return "yellow";
  return "blue";
}

function renderPitcherAttackZones(row) {
  const data = getPitcherAttackZones(row.player, row);

  if (!data?.zones?.zones) {
    return `
      <div class="attack-zone-card">
        <div class="attack-zone-head">
          <strong>Pitcher Attack Zones</strong>
          <span>No attack zones loaded yet</span>
        </div>
      </div>
    `;
  }

  const zones = data.zones;

  return `
    <div class="attack-zone-card">
      <div class="attack-zone-head">
        <div>
          <strong>Pitcher Attack Zones</strong>
          <span>Hot attack lanes against this matchup</span>
        </div>

        <div class="attack-zone-summary">
          <strong>${Math.min(99, zones.hitterPower)}</strong>
          <span>Power</span>
        </div>
      </div>

      <div class="attack-zone-grid">
        ${zones.zones.map(zone => `
          <div class="attack-zone-cell ${attackZoneClass(zone.danger)}">
            <span>${zone.zone}</span>
            <strong>${zone.danger}</strong>
          </div>
        `).join("")}
      </div>

      <div class="attack-zone-legend">
        <span><i class="red"></i> HR Kill Zone</span>
        <span><i class="orange"></i> Damage Zone</span>
        <span><i class="yellow"></i> Contact Zone</span>
        <span><i class="blue"></i> Weak Zone</span>
      </div>
    </div>
  `;
}


function getParkCarryVisual(player, row = null) {
  const visuals = state.parkCarryVisuals?.players || {};

  if (row?.player && visuals[row.player]) return visuals[row.player];
  if (player && visuals[player]) return visuals[player];

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(visuals).find(name => name.toLowerCase().trim() === normalized);
    if (key) return visuals[key];
  }

  return null;
}

function carryClass(score) {
  const value = number(score);

  if (value >= 78) return "elite";
  if (value >= 64) return "good";
  if (value <= 38) return "cold";
  return "neutral";
}

function renderParkCarryVisual(row) {
  const data = getParkCarryVisual(row.player, row);

  if (!data?.carry) {
    return `
      <div class="carry-card">
        <div class="carry-head">
          <strong>Live Park Carry</strong>
          <span>No park carry data loaded yet</span>
        </div>
      </div>
    `;
  }

  const carry = data.carry;
  const score = number(carry.carryScore);
  const cls = carryClass(score);

  return `
    <div class="carry-card ${cls}">
      <div class="carry-head">
        <div>
          <strong>Live Park Carry</strong>
          <span>${clean(carry.venue)} • ${clean(carry.label)}</span>
        </div>
        <div class="carry-score">
          <strong>${clean(carry.carryScore)}</strong>
          <span>Carry</span>
        </div>
      </div>

      <div class="carry-field">
        <div class="carry-wall"></div>
        <div class="carry-arc" style="width:${Math.max(20, score)}%;"></div>
        <div class="carry-ball" style="left:${Math.max(12, Math.min(88, score))}%;"></div>
        <div class="carry-home"></div>
      </div>

      <div class="carry-grid">
        <div><span>Temp</span><strong>${clean(carry.temp)}°</strong><small>${clean(carry.tempBoost)} boost</small></div>
        <div><span>Humidity</span><strong>${clean(carry.humidity)}%</strong><small>${clean(carry.humidityBoost)} boost</small></div>
        <div><span>Wind</span><strong>${clean(carry.windSpeed)} MPH</strong><small>${clean(carry.windBoost)} boost</small></div>
        <div><span>Park</span><strong>${clean(carry.parkFactor)}</strong><small>${clean(carry.parkBoost)} boost</small></div>
        <div><span>Roof</span><strong>${clean(carry.roof)}</strong><small>${carry.activeWind ? "Wind active" : "Wind muted"}</small></div>
      </div>
    </div>
  `;
}


function getLaunchAngleProfile(player, row = null) {
  const clusters = state.launchAngleClusters?.players || {};

  if (row?.player && clusters[row.player]) return clusters[row.player];
  if (player && clusters[player]) return clusters[player];

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(clusters).find(name => name.toLowerCase().trim() === normalized);
    if (key) return clusters[key];
  }

  return null;
}

function renderLaunchAngleClusters(row) {
  const data = getLaunchAngleProfile(row.player, row);

  if (!data?.launchProfile) {
    return `
      <div class="launch-card">
        <div class="launch-head">
          <strong>HR Launch Angle Clusters</strong>
          <span>No launch profile loaded yet</span>
        </div>
      </div>
    `;
  }

  const profile = data.launchProfile;

  return `
    <div class="launch-card">
      <div class="launch-head">
        <div>
          <strong>HR Launch Angle Clusters</strong>
          <span>Ideal window ${clean(profile.bestWindow)} degrees • Power arc ${clean(profile.powerArc)}%</span>
        </div>
        <div class="launch-score">
          <strong>${clean(profile.idealAngle)}°</strong>
          <span>Ideal LA</span>
        </div>
      </div>

      <div class="launch-stage">
        <div class="launch-line launch-low"></div>
        <div class="launch-line launch-mid"></div>
        <div class="launch-line launch-high"></div>

        ${profile.clusters.map(cluster => `
          <div class="launch-dot" style="left:${cluster.x}%; top:${cluster.y}%;">
            <span>${cluster.hrFit}%</span>
            <b>${cluster.label}</b>
          </div>
        `).join("")}
      </div>

      <div class="launch-grid">
        ${profile.clusters.map(cluster => `
          <article>
            <span>${cluster.label}</span>
            <strong>${cluster.launchAngle}°</strong>
            <p>${cluster.angleRange}° • ${cluster.exitVelo} MPH • ${cluster.hrFit}% HR fit</p>
            <i><b style="width:${cluster.hrFit}%"></b></i>
          </article>
        `).join("")}
      </div>
    </div>
  `;
}


function getHandednessOverlay(player, row = null) {
  const overlays = state.handednessOverlays?.players || {};

  if (row?.player && overlays[row.player]) return overlays[row.player];
  if (player && overlays[player]) return overlays[player];

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(overlays).find(name => name.toLowerCase().trim() === normalized);
    if (key) return overlays[key];
  }

  return null;
}

function renderHandednessOverlay(row) {
  const data = getHandednessOverlay(row.player, row);

  if (!data?.overlay) {
    return `
      <div class="handedness-card">
        <div class="handedness-head">
          <strong>Handedness Overlay</strong>
          <span>No handedness overlay loaded yet</span>
        </div>
      </div>
    `;
  }

  const overlay = data.overlay;

  return `
    <div class="handedness-card">
      <div class="handedness-head">
        <div>
          <strong>Handedness Overlay</strong>
          <span>${clean(overlay.matchupSide)} • ${clean(overlay.read)}</span>
        </div>
        <div class="handedness-score">
          <strong>${clean(overlay.splitAdvantage)}</strong>
          <span>Split Fit</span>
        </div>
      </div>

      <div class="handedness-grid">
        <div>
          <span>Hitter Power</span>
          <strong>${clean(overlay.hitterPower)}%</strong>
          <i><b style="width:${overlay.hitterPower}%"></b></i>
        </div>

        <div>
          <span>Pitcher Leak</span>
          <strong>${clean(overlay.pitcherLeak)}%</strong>
          <i><b style="width:${overlay.pitcherLeak}%"></b></i>
        </div>

        <div>
          <span>Pull Lane</span>
          <strong>${clean(overlay.pull)}%</strong>
          <i><b style="width:${overlay.pull}%"></b></i>
        </div>

        <div>
          <span>Center Lane</span>
          <strong>${clean(overlay.center)}%</strong>
          <i><b style="width:${overlay.center}%"></b></i>
        </div>

        <div>
          <span>Oppo Lane</span>
          <strong>${clean(overlay.oppo)}%</strong>
          <i><b style="width:${overlay.oppo}%"></b></i>
        </div>

        <div>
          <span>Bat Side</span>
          <strong>${clean(overlay.batSide)}</strong>
          <i><b style="width:${overlay.splitAdvantage}%"></b></i>
        </div>
      </div>
    </div>
  `;
}


function getPitchDamage(player, row = null) {
  const damage = state.pitchTypeDamage?.players || {};

  if (row?.player && damage[row.player]) return damage[row.player];
  if (player && damage[player]) return damage[player];

  const normalized = String(player || row?.player || "").toLowerCase().trim();

  if (normalized) {
    const key = Object.keys(damage).find(name => name.toLowerCase().trim() == normalized);
    if (key) return damage[key];
  }

  return null;
}

function pitchDamageClass(value) {
  const n = number(value);

  if (n >= 75) return "elite";
  if (n >= 55) return "strong";
  if (n >= 35) return "solid";
  return "weak";
}

function renderPitchTypeDamageMap(row) {
  const data = getPitchDamage(row.player, row);

  if (!data?.pitchDamage) {
    return `
      <div class="pitch-damage-card">
        <div class="pitch-damage-head">
          <strong>Pitch Type Damage Map</strong>
          <span>No pitch type data loaded yet</span>
        </div>
      </div>
    `;
  }

  const pitches = Object.values(data.pitchDamage);

  return `
    <div class="pitch-damage-card">
      <div class="pitch-damage-head">
        <div>
          <strong>Pitch Type Damage Map</strong>
          <span>Whiff vs crush profile by pitch type</span>
        </div>
      </div>

      <div class="pitch-damage-grid">
        ${pitches.map(pitch => `
          <article class="pitch-damage-tile ${pitchDamageClass(pitch.crush)}">
            <div class="pitch-damage-top">
              <strong>${pitch.label}</strong>
              <span>${pitch.crush}% Crush</span>
            </div>

            <div class="pitch-damage-bars">
              <div>
                <label>SLG</label>
                <b>${pitch.slg}</b>
              </div>

              <div>
                <label>HR</label>
                <b>${pitch.hr}</b>
              </div>

              <div>
                <label>Barrel</label>
                <b>${Math.round(pitch.barrel * 100)}%</b>
              </div>

              <div>
                <label>Hard Hit</label>
                <b>${Math.round(pitch.hardHit * 100)}%</b>
              </div>

              <div>
                <label>Whiff</label>
                <b>${Math.round(pitch.whiff * 100)}%</b>
              </div>
            </div>
          </article>
        `).join("")}
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


function findPlayerStackIntelligence(row) {
  const player = clean(row.player, "");
  const team = clean(row.team, "");

  const stacks = state.stackIntel?.stacks || [];
  const leverage = state.stackLeverage?.profiles || [];
  const alerts = state.collapseAlerts?.alerts || [];

  const playerStacks = stacks
    .filter(stack =>
      clean(stack.team, "") === team &&
      clean(stack.players, "").toLowerCase().includes(player.toLowerCase())
    )
    .sort((a, b) => number(b.finalStackScore) - number(a.finalStackScore));

  const playerLeverage = leverage
    .filter(profile =>
      clean(profile.team, "") === team &&
      clean(profile.players, "").toLowerCase().includes(player.toLowerCase())
    )
    .sort((a, b) => number(b.leverageScore) - number(a.leverageScore));

  const collapse = alerts.find(alert =>
    clean(alert.team, "") === team &&
    clean(alert.game, "") === clean(row.game, "")
  );

  return {
    topStack: playerStacks[0] || null,
    stacks: playerStacks,
    leverage: playerLeverage[0] || null,
    collapse: collapse || null
  };
}

function renderPlayerStackIntelligence(row) {
  const intel = findPlayerStackIntelligence(row);
  const stack = intel.topStack;
  const leverage = intel.leverage;
  const collapse = intel.collapse;

  if (!stack && !leverage && !collapse) {
    return `
      <div class="profile-note">
        No Stack Intelligence 2.0 match found for this player yet.
      </div>
    `;
  }

  return `
    <div class="player-intel-card">
      <div class="player-intel-head">
        <div>
          <strong>Stack Intelligence 2.0</strong>
          <span>Player level stack, leverage, collapse, and chain reaction read</span>
        </div>

        <div class="player-intel-grade">
          ${clean(stack?.stackGrade || leverage?.leverageProfile || collapse?.collapseLabel || "WATCH")}
        </div>
      </div>

      <div class="player-intel-grid">
        <div><span>Stack Score</span><strong>${clean(stack?.finalStackScore)}</strong></div>
        <div><span>Stack Size</span><strong>${stack?.stackSize ? stack.stackSize + " Man" : "--"}</strong></div>
        <div><span>Chain Reaction</span><strong>${clean(stack?.hrChainReactionProbability)}</strong></div>
        <div><span>Volatility</span><strong>${clean(stack?.volatilityMeter)}</strong></div>
        <div><span>Leverage</span><strong>${clean(leverage?.leverageScore || stack?.leverageScore)}</strong></div>
        <div><span>Pitcher Collapse</span><strong>${clean(collapse?.pitcherCollapseProbability || stack?.pitcherCollapseProbability)}</strong></div>
        <div><span>Bullpen Collapse</span><strong>${clean(collapse?.bullpenCollapseScore || stack?.bullpenCollapseScore)}</strong></div>
        <div><span>Lane</span><strong>${clean(stack?.correlatedHrLane)}</strong></div>
      </div>

      <div class="player-intel-read">
        ${stack
          ? `${clean(row.player)} is part of a ${clean(stack.stackSize)} man ${clean(stack.correlatedHrLane)} with ${clean(stack.hrChainReactionProbability)} chain reaction probability.`
          : `Stack read is still developing for this player.`
        }
      </div>
    </div>
  `;
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

    <h3>Stack Intelligence 2.0</h3>
    ${renderPlayerStackIntelligence(row)}

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

    <h3>Pitch Type Damage</h3>
    ${renderPitchTypeDamageMap(row)}

    <h3>Handedness Overlay</h3>
    ${renderHandednessOverlay(row)}

    <h3>HR Launch Angle Clusters</h3>
    ${renderLaunchAngleClusters(row)}

    <h3>Live Park Carry</h3>
    ${renderParkCarryVisual(row)}

    <h3>Pitcher Attack Zones</h3>
    ${renderPitcherAttackZones(row)}

    <h3>Hot/Cold Attack Regions</h3>
    ${renderHotColdAttackRegions(row)}

    <div class="profile-explainer">
      <strong>Slip Lab Read:</strong>
      <ul class="matchup-read-list">
        ${buildHrMatchupRead(row, hitter, pitcher).map(item => `<li>${item}</li>`).join("")}
      </ul>
    </div>
  `;

  openActiveProfileModal();
}

function closePlayerProfile() {
  const modal = document.getElementById("profile-modal");

  if (modal) modal.classList.remove("show");
}


function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function pitcherStats(row) {
  return row?.stats?.pitcher || row?.pitcherStats || {};
}

function hitterStats(row) {
  return row?.stats?.hitter || row?.hitterStats || {};
}

function pitcherAttackScore(row) {
  const p = pitcherStats(row);
  let score = 0;

  const era = number(p.era);
  const whip = number(p.whip);
  const hr = number(p.homeRuns);
  const hits = number(p.hits);
  const walks = number(p.baseOnBalls);
  const ip = number(p.inningsPitched);

  if (era >= 6) score += 30;
  else if (era >= 4.75) score += 22;
  else if (era >= 4) score += 14;

  if (whip >= 1.6) score += 25;
  else if (whip >= 1.35) score += 17;
  else if (whip >= 1.2) score += 9;

  if (hr >= 12) score += 22;
  else if (hr >= 7) score += 15;
  else if (hr >= 3) score += 8;

  if (ip > 0 && hits / ip >= 1.15) score += 12;
  if (ip > 0 && walks / ip >= 0.45) score += 9;

  score += Math.min(20, Math.max(0, number(row.score) / 5));

  return Math.round(score);
}

function pitcherAttackGradeFromScore(score) {
  if (score >= 80) return { label: "Priority Attack", className: "green" };
  if (score >= 60) return { label: "Strong Attack", className: "yellow" };
  if (score >= 40) return { label: "Watch Spot", className: "gray" };
  return { label: "Low Priority", className: "red" };
}

function pitcherWeaknessNotes(rows) {
  const first = rows[0] || {};
  const p = pitcherStats(first);
  const notes = [];

  if (number(p.era) >= 5) notes.push(`Elevated ERA profile at ${clean(p.era)}.`);
  if (number(p.whip) >= 1.35) notes.push(`Traffic risk is live with a ${clean(p.whip)} WHIP.`);
  if (number(p.homeRuns) >= 5) notes.push(`${clean(p.homeRuns)} HR allowed creates long ball vulnerability.`);
  if (number(p.hits) > 0) notes.push(`${clean(p.hits)} hits allowed adds contact risk.`);
  if (rows.length >= 3) notes.push(`${rows.length} bats from this matchup are grading into the HR pool.`);

  if (!notes.length) {
    notes.push("Pitcher vulnerability is being driven by matchup score, hitter power, park context, and available pitcher profile.");
  }

  return notes;
}

function dangerBatCard(row, index) {
  const hitter = hitterStats(row);
  const realIndex = state.rows.indexOf(row);

  return `
    <article class="pitcher-batter-card" data-profile-index="${realIndex}">
      <div class="pitcher-batter-topline">
        <div class="pitcher-batter-rank">#${index + 1}</div>
        <div class="pitcher-batter-chip">DANGER BAT</div>
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

      <p>${clean(row.note || "Model likes this bat based on power profile, pitcher vulnerability, park fit, and game environment.")}</p>
    </article>
  `;
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
        score: 0,
        game: row.game || "",
        team: row.team || "",
        opponent: row.opponent || ""
      });
    }

    const item = map.get(key);
    item.rows.push(row);
    item.score = Math.max(item.score, pitcherAttackScore(row));
  });

  const vulnRows = [...map.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);

  return `
    <section class="top-vuln-strip">
      <div class="top-vuln-header">
        <div>
          <div class="top-vuln-kicker">HR MATCHUP INTELLIGENCE</div>
          <h2>Pitcher Vulnerability Lab</h2>
        </div>
      </div>

      <div class="top-vuln-row">
        ${vulnRows.map((item, index) => {
          const first = item.rows[0] || {};
          const p = pitcherStats(first);
          const grade = pitcherAttackGradeFromScore(item.score);

          return `
            <article class="top-vuln-card" data-pitcher-profile="${encodeURIComponent(item.pitcher)}">
              <div class="top-vuln-rank">#${index + 1}</div>
              <div class="top-vuln-score">${clean(item.score)}</div>
              <div class="top-vuln-label">ATTACK SCORE</div>
              <div class="top-vuln-pitcher">${clean(item.pitcher)}</div>
              <div class="top-vuln-matchup">${clean(item.game || `${item.team} vs ${item.opponent}`)}</div>
              <div class="top-vuln-era">ERA ${clean(p.era)} • WHIP ${clean(p.whip)} • HR ${clean(p.homeRuns)}</div>
              <div class="top-vuln-attack ${grade.className}">${grade.label}</div>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function openPitcherVulnerabilityProfile(pitcherName) {
  const rows = state.rows
    .filter(row => pitcherKey(row) === pitcherName)
    .sort((a, b) => number(b.score) - number(a.score));

  if (!rows.length) return;

  const first = rows[0];
  const pitcher = pitcherStats(first);
  const attackScore = Math.max(...rows.map(row => pitcherAttackScore(row)));
  const grade = pitcherAttackGradeFromScore(attackScore);

  const modal = document.getElementById("profile-modal");
  const body = document.getElementById("profile-body");

  if (!modal || !body) return;

  body.innerHTML = `
    <div class="profile-top pitcher-profile-top">
      <div>
        <div class="profile-rank">PITCHER VULNERABILITY</div>
        <h2>${clean(pitcherName)}</h2>
        <p>${clean(first.game)}</p>
      </div>
      <div class="profile-score">
        <span>${clean(attackScore)}</span>
        <small>${grade.label}</small>
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

    ${renderBallparkWeather(first.venue)}

    <h3>Pitcher Weakness Read</h3>
    <div class="profile-explainer">
      <ul class="matchup-read-list">
        ${pitcherWeaknessNotes(rows).map(item => `<li>${item}</li>`).join("")}
      </ul>
    </div>

    <h3>Top Danger Bats</h3>
    <div class="pitcher-batter-board">
      ${rows.slice(0, 8).map((row, index) => dangerBatCard(row, index)).join("")}
    </div>
  `;

  openActiveProfileModal();
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

function rowSearchText(row) {
  return [
    row.player,
    row.team,
    row.opponent,
    row.game,
    row.venue,
    row.opposingPitcher,
    row.opposingProbablePitcher,
    row.position,
    row.positionType
  ].map(value => clean(value, "")).join(" ").toLowerCase();
}

function uniqueValues(rows, getter) {
  return [...new Set(rows.map(getter).map(value => clean(value, "")).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function sortSearchRows(rows) {
  const sorted = [...rows];

  if (state.searchSort === "team") {
    sorted.sort((a, b) =>
      clean(a.team, "").localeCompare(clean(b.team, "")) ||
      clean(a.player, "").localeCompare(clean(b.player, ""))
    );
  } else if (state.searchSort === "game") {
    sorted.sort((a, b) =>
      new Date(a.gameDate || 0) - new Date(b.gameDate || 0) ||
      clean(a.game, "").localeCompare(clean(b.game, ""))
    );
  } else if (state.searchSort === "position") {
    sorted.sort((a, b) =>
      clean(a.position || a.positionType, "").localeCompare(clean(b.position || b.positionType, "")) ||
      clean(a.player, "").localeCompare(clean(b.player, ""))
    );
  } else {
    sorted.sort((a, b) =>
      clean(a.player, "").localeCompare(clean(b.player, ""))
    );
  }

  return sorted;
}

function filterRowsBySearch(rows) {
  const query = clean(state.searchQuery, "").toLowerCase().trim();

  let filtered = rows;

  if (query) {
    filtered = filtered.filter(row => rowSearchText(row).includes(query));
  }

  if (state.searchTeam !== "all") {
    filtered = filtered.filter(row => clean(row.team, "") === state.searchTeam);
  }

  if (state.searchGame !== "all") {
    filtered = filtered.filter(row => clean(row.game, "") === state.searchGame);
  }

  if (state.searchPosition !== "all") {
    filtered = filtered.filter(row => clean(row.position || row.positionType, "") === state.searchPosition);
  }

  return sortSearchRows(filtered);
}

function optionList(values, activeValue) {
  return values.map(value => `
    <option value="${clean(value)}" ${value === activeValue ? "selected" : ""}>
      ${clean(value)}
    </option>
  `).join("");
}

function renderSearchBar(label = "Search players, teams, games, or pitchers", rows = state.rows) {
  const teams = uniqueValues(rows, row => row.team);
  const games = uniqueValues(rows, row => row.game);
  const positions = uniqueValues(rows, row => row.position || row.positionType);

  return `
    <section class="player-search-control-panel">
      <div class="player-search-bar">
        <input
          id="player-search-input"
          type="search"
          value="${clean(state.searchQuery, "")}"
          placeholder="${label}"
          autocomplete="off"
        />

        <button type="button" id="player-search-clear">
          Clear
        </button>
      </div>

      <div class="player-filter-grid">
        <label>
          <span>Team</span>
          <select id="player-filter-team">
            <option value="all">All Teams</option>
            ${optionList(teams, state.searchTeam)}
          </select>
        </label>

        <label>
          <span>Game</span>
          <select id="player-filter-game">
            <option value="all">All Games</option>
            ${optionList(games, state.searchGame)}
          </select>
        </label>

        <label>
          <span>Position</span>
          <select id="player-filter-position">
            <option value="all">All Positions</option>
            ${optionList(positions, state.searchPosition)}
          </select>
        </label>

        <label>
          <span>Sort</span>
          <select id="player-filter-sort">
            <option value="name" ${state.searchSort === "name" ? "selected" : ""}>Name</option>
            <option value="team" ${state.searchSort === "team" ? "selected" : ""}>Team</option>
            <option value="game" ${state.searchSort === "game" ? "selected" : ""}>Game Time</option>
            <option value="position" ${state.searchSort === "position" ? "selected" : ""}>Position</option>
          </select>
        </label>
      </div>
    </section>
  `;
}

function renderPlayerDirectoryCard(row, index) {
  return `
    <article class="card clickable-card" data-profile-index="${index}">
      <div class="rank">#${index + 1}</div>

      <div>
        <div class="player">${clean(row.player)}</div>
        <div class="meta">${clean(row.team)} • ${clean(row.position || row.positionType || "Hitter")}</div>
        <div class="meta">${clean(row.game)} • ${formatGameTime(row.gameDate)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Opponent</div>
        <div class="stat-value">${clean(row.opponent)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Pitcher</div>
        <div class="stat-value">${clean(row.opposingProbablePitcher || row.opposingPitcher || "TBD")}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Side</div>
        <div class="stat-value">${clean(row.homeAway)}</div>
      </div>

      <div class="stat">
        <div class="stat-label">Player ID</div>
        <div class="stat-value">${clean(row.playerId)}</div>
      </div>
    </article>
  `;
}

function renderPlayerSearchBoard(rows) {
  const filtered = filterRowsBySearch(rows);

  return `
    ${renderSearchBar("Search all MLB players", rows)}

    <div class="board-header player-directory-header">
      <div>
        <h3>Player Directory</h3>
        <p>${filtered.length} of ${rows.length} players shown</p>
      </div>
    </div>

    <div class="main-board-grid">
      ${filtered.length
        ? filtered.map((row, index) => renderPlayerDirectoryCard(row, state.rows.indexOf(row))).join("")
        : `<div class="empty">No players match that search.</div>`}
    </div>
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


function stackIntelGradeClass(grade = "") {
  const g = String(grade || "").toLowerCase();

  if (g.includes("nuke")) return "grade-nuke";
  if (g.includes("elite")) return "grade-elite";
  if (g.includes("attack")) return "grade-attack";
  if (g.includes("live")) return "grade-live";

  return "grade-watch";
}

function stackIntelVolClass(label = "") {
  const v = String(label || "").toLowerCase();

  if (v.includes("nuclear")) return "vol-nuclear";
  if (v.includes("chaotic")) return "vol-chaotic";
  if (v.includes("aggressive")) return "vol-aggressive";
  if (v.includes("stable")) return "vol-stable";

  return "vol-safe";
}

function renderStackIntelligenceCard(stack) {
  return `
    <article class="stack-card ${stackIntelGradeClass(stack.stackGrade)}">
      <div class="stack-top">
        <div>
          <div class="stack-team">${clean(stack.team)}</div>
          <div class="stack-game">vs ${clean(stack.opponent)} • ${clean(stack.stackSize)} Man</div>
        </div>

        <div class="stack-grade">${clean(stack.stackGrade)}</div>
      </div>

      <div class="stack-players">${clean(stack.players)}</div>

      <div class="stack-grid">
        <div class="metric"><span>FINAL</span><strong>${clean(stack.finalStackScore)}</strong></div>
        <div class="metric"><span>CHAIN</span><strong>${clean(stack.hrChainReactionProbability)}</strong></div>
        <div class="metric"><span>LEVERAGE</span><strong>${clean(stack.leverageScore)}</strong></div>
        <div class="metric"><span>CORRELATION</span><strong>${clean(stack.correlationScore)}</strong></div>
      </div>

      <div class="volatility ${stackIntelVolClass(stack.volatilityMeter)}">
        ${clean(stack.volatilityMeter)}
      </div>

      <div class="stack-footer">
        <div><span>Pitcher Collapse</span><strong>${clean(stack.pitcherCollapseProbability)}</strong></div>
        <div><span>Bullpen Collapse</span><strong>${clean(stack.bullpenCollapseScore)}</strong></div>
      </div>

      <div class="lane">
        ${clean(stack.correlatedHrLane)} • ${clean(stack.sprayDistribution)}
      </div>
    </article>
  `;
}

function renderCollapseAlertCard(alert) {
  return `
    <article class="collapse-card">
      <div class="collapse-top">
        <div>
          <h3>${clean(alert.opposingPitcher)}</h3>
          <p>${clean(alert.team)} offense • ${clean(alert.venue)}</p>
        </div>

        <div class="collapse-label">${clean(alert.collapseLabel)}</div>
      </div>

      <div class="collapse-grid">
        <div><span>Pitcher</span><strong>${clean(alert.pitcherCollapseProbability)}</strong></div>
        <div><span>Bullpen</span><strong>${clean(alert.bullpenCollapseScore)}</strong></div>
        <div><span>Weather</span><strong>${clean(alert.weatherBoost)}</strong></div>
      </div>
    </article>
  `;
}

function renderLeverageProfileCard(profile) {
  return `
    <article class="leverage-card">
      <div class="lev-top">
        <div>
          <h3>${clean(profile.team)}</h3>
          <p>${clean(profile.players)}</p>
        </div>

        <div class="lev-grade">${clean(profile.leverageProfile)}</div>
      </div>

      <div class="lev-score">${clean(profile.leverageScore)}</div>

      <div class="lev-reason">${clean(profile.reason)}</div>
    </article>
  `;
}

function renderStackIntelligence2() {
  const stacks = state.stackIntel?.stacks || [];
  const alerts = state.collapseAlerts?.alerts || [];
  const leverage = state.stackLeverage?.profiles || [];

  return `
    <section class="results-lab">
      <div class="results-hero">
        <div>
          <span>TEAM STACK INTELLIGENCE 2.0</span>
          <h2>Stack Lab</h2>
          <p>Correlated HR lanes, collapse probability, leverage profiles, volatility, and HR chain reaction scoring.</p>
        </div>

        <div class="results-scorebox"><strong>${stacks.length}</strong><span>Stacks</span></div>
        <div class="results-scorebox"><strong>${alerts.length}</strong><span>Collapse Alerts</span></div>
      </div>

      <div class="section-title">Top Stack Intelligence</div>
      <div class="stack-board">
        ${stacks.slice(0, 24).map(renderStackIntelligenceCard).join("") || `<div class="empty">No Stack Intelligence 2.0 data found.</div>`}
      </div>

      <div class="section-title" style="margin-top: 20px;">Pitcher Collapse Alerts</div>
      <div class="collapse-board">
        ${alerts.slice(0, 12).map(renderCollapseAlertCard).join("") || `<div class="empty">No collapse alerts found.</div>`}
      </div>

      <div class="section-title" style="margin-top: 20px;">Stack Leverage Profiles</div>
      <div class="leverage-board">
        ${leverage.slice(0, 12).map(renderLeverageProfileCard).join("") || `<div class="empty">No leverage profiles found.</div>`}
      </div>
    </section>
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
  function ensureExtraTabs() {
  const tabs = document.querySelector(".tabs");

  if (!tabs) return;

  if (!tabs.querySelector('[data-market="stack_lab"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "stack_lab";
    button.textContent = "Stack Lab";
    tabs.appendChild(button);
  }

  if (!tabs.querySelector('[data-market="player_search"]')) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.market = "player_search";
    button.textContent = "Player Search";
    tabs.appendChild(button);
  }
}

let searchRenderTimer = null;

function attachSearchEvents() {
  const input = document.getElementById("player-search-input");
  const clear = document.getElementById("player-search-clear");
  const team = document.getElementById("player-filter-team");
  const game = document.getElementById("player-filter-game");
  const position = document.getElementById("player-filter-position");
  const sort = document.getElementById("player-filter-sort");

  if (input && !input.dataset.bound) {
    input.dataset.bound = "true";

    input.addEventListener("input", event => {
      state.searchQuery = event.target.value;

      clearTimeout(searchRenderTimer);

      searchRenderTimer = setTimeout(() => {
        render().then(() => {
          const nextInput = document.getElementById("player-search-input");

          if (nextInput) {
            nextInput.focus();
            nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
          }
        }).catch(showAppError);
      }, 350);
    });
  }

  if (clear && !clear.dataset.bound) {
    clear.dataset.bound = "true";

    clear.addEventListener("click", () => {
      state.searchQuery = "";
      state.searchTeam = "all";
      state.searchGame = "all";
      state.searchPosition = "all";
      state.searchSort = "name";
      render().catch(showAppError);
    });
  }

  if (team && !team.dataset.bound) {
    team.dataset.bound = "true";
    team.addEventListener("change", event => {
      state.searchTeam = event.target.value;
      render().catch(showAppError);
    });
  }

  if (game && !game.dataset.bound) {
    game.dataset.bound = "true";
    game.addEventListener("change", event => {
      state.searchGame = event.target.value;
      render().catch(showAppError);
    });
  }

  if (position && !position.dataset.bound) {
    position.dataset.bound = "true";
    position.addEventListener("change", event => {
      state.searchPosition = event.target.value;
      render().catch(showAppError);
    });
  }

  if (sort && !sort.dataset.bound) {
    sort.dataset.bound = "true";
    sort.addEventListener("change", event => {
      state.searchSort = event.target.value;
      render().catch(showAppError);
    });
  }
}

ensureExtraTabs();

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

  const [raw, updatedInfo, weatherRows, parkRows, statcastZones, pitchTypeDamage, handednessOverlays, launchAngleClusters, parkCarryVisuals, pitcherAttackZones, hotColdAttackRegions, stackRows, stackIntelRows, stackLeverageRows, collapseAlertRows] = await Promise.all([
    loadRows(),
    loadLastUpdated(),
    loadWeather(),
    loadParkFactors(),
    loadStatcastZones(),
    loadPitchTypeDamage(),
    loadHandednessOverlays(),
    loadLaunchAngleClusters(),
    loadParkCarryVisuals(),
    loadPitcherAttackZones(),
    loadHotColdAttackRegions(),
    loadTeamStacks(),
    loadStackIntelligence2(),
    loadStackLeverageProfiles(),
    loadCollapseAlerts()
  ]);

  const rows = state.market === "games"
    ? raw.games || []
    : state.market === "weather"
      ? raw.weather || []
      : state.market === "results"
        ? raw.results || []
        : state.market === "player_search"
          ? raw.players || []
          : Array.isArray(raw)
            ? raw
            : [];

  state.rows = rows;
  state.weather = weatherRows;
  state.parks = parkRows;
  state.statcastZones = statcastZones;
  state.pitchTypeDamage = pitchTypeDamage;
  state.handednessOverlays = handednessOverlays;
  state.launchAngleClusters = launchAngleClusters;
  state.parkCarryVisuals = parkCarryVisuals;
  state.pitcherAttackZones = pitcherAttackZones;
  state.hotColdAttackRegions = hotColdAttackRegions;
  state.stacks = stackRows;
  state.stackIntel = stackIntelRows;
  state.stackLeverage = stackLeverageRows;
  state.collapseAlerts = collapseAlertRows;

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

  if (state.market === "stack_lab") {
    board.innerHTML = renderStackIntelligence2();
    return;
  }

  if (state.market === "player_search") {
    board.innerHTML = renderPlayerSearchBoard(rows);
    attachSearchEvents();
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

  const filteredRows = filterRowsBySearch(rows);

  board.innerHTML = `
    ${renderSearchBar("Search players, teams, games, or pitchers", rows)}
    ${state.market === "home_runs"
      ? renderGroupedHomeRunBoard(filteredRows)
      : `
        <div class="main-board-grid">
          ${filteredRows.map((row, index) => renderPlayerBoardCard(row, state.rows.indexOf(row))).join("")}
        </div>
      `}
  `;

  attachSearchEvents();
}

document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    state.sport = btn.dataset.sport;
    render().catch(showAppError);
  });
});

document.addEventListener("click", event => {
  const tabButton = event.target.closest(".tabs button");

  if (!tabButton) return;

  state.market = tabButton.dataset.market;
  render().catch(showAppError);
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

/* SLIP LAB MODAL CONTROLLER START */
function getProfileModalParts() {
  return {
    modal: document.getElementById("profile-modal"),
    body: document.getElementById("profile-body")
  };
}

function openActiveProfileModal() {
  const { modal } = getProfileModalParts();

  if (!modal) return;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closePlayerProfile() {
  const { modal, body } = getProfileModalParts();

  if (!modal) return;

  modal.classList.remove("show");
  modal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");

  if (body) body.innerHTML = "";
}

function installSlipLabModalController() {
  const { modal } = getProfileModalParts();

  if (!modal || modal.dataset.modalControllerReady === "true") return;

  modal.dataset.modalControllerReady = "true";
  modal.setAttribute("aria-hidden", "true");

  document.addEventListener("click", event => {
    const closeButton = event.target.closest("[data-close-profile], .profile-close");

    if (closeButton) {
      event.preventDefault();
      closePlayerProfile();
      return;
    }

    const pitcherCard = event.target.closest("[data-pitcher-profile]");

    if (pitcherCard) {
      event.preventDefault();
      openPitcherVulnerabilityProfile(decodeURIComponent(pitcherCard.dataset.pitcherProfile || ""));
      return;
    }

    const playerCard = event.target.closest("[data-profile-index]");

    if (playerCard) {
      event.preventDefault();
      openPlayerProfile(Number(playerCard.dataset.profileIndex));
    }
  });

  modal.addEventListener("click", event => {
    if (event.target === modal) closePlayerProfile();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal.classList.contains("show")) {
      closePlayerProfile();
    }
  });
}

document.addEventListener("DOMContentLoaded", installSlipLabModalController);
installSlipLabModalController();
/* SLIP LAB MODAL CONTROLLER END */
