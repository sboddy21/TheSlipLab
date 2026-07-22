import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const OUTFILE = path.join(DATA_DIR, "hr_decision_center.json");

const TEAM_ALIASES = {
  "arizona dbacks": "arizona diamondbacks",
  "az diamondbacks": "arizona diamondbacks",
  "chi white sox": "chicago white sox",
  "cws": "chicago white sox",
  "sf giants": "san francisco giants",
  "sd padres": "san diego padres",
  "kc royals": "kansas city royals",
  "la dodgers": "los angeles dodgers",
  "ny yankees": "new york yankees",
  "ny mets": "new york mets",
  "tb rays": "tampa bay rays",
  "was nationals": "washington nationals"
};

function readRawJson(name) {
  try {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const lineupImpactPayload = readRawJson("lineup_impact_engine.json") || {};
const lineupImpactMap = new Map(Object.entries(lineupImpactPayload.byPlayer || {}));
const playerPoolPayload = readRawJson("mlb_player_pool.json") || {};
const playerPoolRows = Array.isArray(playerPoolPayload.players) ? playerPoolPayload.players : [];
const playerPoolLineupMap = new Map();

for (const row of playerPoolRows) {
  const keys = [
    norm(row.player),
    String(row.playerId || ""),
    String(row.player || "").toLowerCase().replace(/[^a-z0-9]/g, "")
  ].filter(Boolean);

  for (const key of keys) {
    playerPoolLineupMap.set(key, {
      lineupSpot: row.lineupSpot || null,
      lineupStatus: row.lineupStatus || "",
      lineupSource: row.lineupSource || "",
      confirmedLineup: Boolean(row.confirmedLineup)
    });
  }
}

function readRows(name) {
  const parsed = readRawJson(name);
  if (!parsed) return [];
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.rows)) return parsed.rows;
  if (Array.isArray(parsed.data)) return parsed.data;
  if (Array.isArray(parsed.players)) return parsed.players;
  if (Array.isArray(parsed.weather)) return parsed.weather;

  if (parsed.players && typeof parsed.players === "object") {
    return Object.entries(parsed.players).map(([player, value]) => ({
      player,
      ...value
    }));
  }

  return [];
}

function text(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value).trim();
}

function clean(value) {
  return text(value);
}

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace("%", "").replace("+", "").replace("N/A", "").trim());
  return Number.isFinite(n) ? n : fallback;
}

function weightedScore(terms) {
  const available = terms.filter(([value]) => value !== null && value !== undefined && Number.isFinite(Number(value)));
  const weight = available.reduce((sum, [, termWeight]) => sum + termWeight, 0);
  if (!weight) return null;
  return available.reduce((sum, [value, termWeight]) => sum + Number(value) * termWeight, 0) / weight;
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return row[key];
    }
  }
  return fallback;
}

function norm(value) {
  return text(value).toLowerCase();
}

function normTeam(value) {
  const x = clean(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return TEAM_ALIASES[x] || x;
}

function round(value) {
  return Math.round(num(value) * 100) / 100;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function todayEastern() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const y = parts.find(p => p.type === "year").value;
  const m = parts.find(p => p.type === "month").value;
  const d = parts.find(p => p.type === "day").value;

  return `${y}-${m}-${d}`;
}

async function getSchedule(date) {
  const url =
    `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}` +
    `&hydrate=probablePitcher`;

  const res = await fetch(url, {
    headers: {
      "user-agent": "TheSlipLab/1.0",
      "accept": "application/json"
    }
  });

  if (!res.ok) {
    throw new Error(`MLB schedule failed ${res.status}`);
  }

  return await res.json();
}

function buildPitcherMaps(schedule) {
  const gameMap = new Map();
  const opponentMap = new Map();
  const games = schedule?.dates?.flatMap(d => d.games || []) || [];

  for (const game of games) {
    const away = clean(game?.teams?.away?.team?.name);
    const home = clean(game?.teams?.home?.team?.name);

    const awayPitcher =
      clean(game?.teams?.away?.probablePitcher?.fullName) ||
      clean(game?.teams?.away?.probablePitcher?.name) ||
      "TBD";

    const homePitcher =
      clean(game?.teams?.home?.probablePitcher?.fullName) ||
      clean(game?.teams?.home?.probablePitcher?.name) ||
      "TBD";

    if (!away || !home) continue;

    const awayKey = normTeam(away);
    const homeKey = normTeam(home);

    gameMap.set(`${awayKey}|${homeKey}`, { away, home, awayPitcher, homePitcher });
    gameMap.set(`${homeKey}|${awayKey}`, { away, home, awayPitcher, homePitcher });

    opponentMap.set(`${awayKey}|${homeKey}`, homePitcher);
    opponentMap.set(`${homeKey}|${awayKey}`, awayPitcher);
  }

  return { gameMap, opponentMap, games };
}

function playerName(row) {
  return text(pick(row, ["player", "name", "batter", "hitter", "player_name"]));
}

function teamName(row) {
  return text(pick(row, ["team", "player_team", "batter_team"]));
}

function gameName(row) {
  return text(pick(row, ["game", "matchup"]));
}

function makePlayerMap(rows) {
  const map = new Map();

  for (const row of rows) {
    const player = playerName(row);
    if (!player) continue;
    map.set(norm(player), row);
    const playerId = text(pick(row, ["playerId", "mlbId", "id"]));
    if (playerId) map.set(playerId, row);
  }

  return map;
}

function makeTeamMap(rows) {
  const map = new Map();

  for (const row of rows) {
    const team = text(pick(row, ["team", "Team", "opponent"]));
    if (!team) continue;
    map.set(norm(team), row);
  }

  return map;
}

function makeBullpenRiskMap(rows) {
  const map = new Map();

  for (const row of rows) {
    const team = text(pick(row, ["team", "Team", "opponent"]));
    if (!team) continue;

    const teamKey = norm(team);
    const risk = num(pick(row, ["hrRiskScore", "collapseScore", "dangerScore"]));
    const current = map.get(teamKey);

    if (!current || risk > num(pick(current, ["hrRiskScore", "collapseScore", "dangerScore"]))) {
      map.set(teamKey, row);
    }
  }

  return map;
}

function uniqueRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const player = playerName(row);
    if (!player) continue;

    const playerId = text(pick(row, ["playerId", "mlbId", "id"]));
    const key = playerId || `${norm(player)}|${norm(teamName(row))}|${norm(gameName(row))}`;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }

  return Array.from(map.values());
}

const hrRows = readRows("mlb_home_runs.json");
const weatherRows = readRows("mlb_weather.json");
const pitchRows = readRows("pitch_type_damage.json");
const attackRows = readRows("pitcher_attack_zones.json");
const statcastRows = readRows("statcast_zones.json");
const bullpenRows = readRows("bullpen_relievers.json");

const pitchMap = makePlayerMap(pitchRows);
const attackMap = makePlayerMap(attackRows);
const statcastMap = makePlayerMap(statcastRows);
const bullpenMap = makeBullpenRiskMap(bullpenRows);

function bestPitchProfile(row) {
  const pitchDamage = row?.pitchDamage;

  if (!pitchDamage || typeof pitchDamage !== "object") {
    return { score: 0, pitch: "", crush: 0 };
  }

  let best = { score: 0, pitch: "", crush: 0 };

  for (const [pitch, profile] of Object.entries(pitchDamage)) {
    const crush = num(profile.crush);
    const barrel = num(profile.barrel) * 100;
    const hardHit = num(profile.hardHit) * 100;
    const slg = num(profile.slg) * 100;

    const score = round(crush * 0.45 + barrel * 0.22 + hardHit * 0.18 + slg * 0.15);

    if (score > best.score) {
      best = {
        score,
        pitch: text(profile.label, pitch),
        crush: round(crush)
      };
    }
  }

  return best;
}

function cellsFromArray(values) {
  if (!Array.isArray(values)) {
    return Array.from({ length: 25 }, (_, index) => ({ index, value: 0 }));
  }

  return values.slice(0, 25).map((value, index) => ({
    index,
    value: round(value)
  }));
}

function statcastZoneProfile(row) {
  const player = playerName(row);
  const playerId = text(pick(row, ["playerId", "mlbId", "id"]));
  const statcastRow = statcastMap.get(playerId) || statcastMap.get(norm(player));
  const zones = statcastRow?.zones || {};

  return {
    avgZones: cellsFromArray(zones.avg),
    isoZones: cellsFromArray(zones.iso),
    slgZones: cellsFromArray(zones.slg),
    hrZones: cellsFromArray(zones.hr),
    kZones: cellsFromArray(zones.k),
    hardHitZones: cellsFromArray(zones.hardHit),
    barrelZones: cellsFromArray(zones.barrel)
  };
}

function zoneProfile(row) {
  const player = playerName(row);
  const playerId = text(pick(row, ["playerId", "mlbId", "id"]));
  const attackRow = attackMap.get(playerId) || attackMap.get(norm(player));
  const zones = attackRow?.zones || {};
  const zoneRows = Array.isArray(zones.zones) ? zones.zones : [];

  const hitterPower = zones.hitterPower === null || zones.hitterPower === undefined ? null : num(zones.hitterPower);
  const pitcherLeak = num(zones.pitcherLeak);

  let hotZoneCount = 0;
  let overlapTotal = 0;
  let qualifiedZoneCount = 0;

  const zoneCells = zoneRows.slice(0, 25).map((zone, index) => {
    const qualified = zone.qualified === true && zone.danger !== null && zone.danger !== undefined;
    const hitter = qualified ? num(zone.hitterXwoba) * 100 : 0;
    const pitcher = qualified ? num(zone.pitcherXwobaAllowed) * 100 : 0;
    const overlap = qualified ? num(zone.danger) : 0;

    if (qualified) {
      if (overlap >= 65) hotZoneCount += 1;
      overlapTotal += overlap;
      qualifiedZoneCount += 1;
    }

    return {
      index,
      hitter: round(hitter),
      pitcher: round(pitcher),
      overlap: round(overlap),
      qualified
    };
  });

  while (zoneCells.length < 25) {
    zoneCells.push({
      index: zoneCells.length,
      hitter: 0,
      pitcher: 0,
      overlap: 0,
      qualified: false
    });
  }

  const avgOverlap = qualifiedZoneCount ? overlapTotal / qualifiedZoneCount : null;
  const zoneOverlap = qualifiedZoneCount
    ? round(clamp(hitterPower * 0.34 + pitcherLeak * 0.34 + avgOverlap * 0.22 + hotZoneCount * 1.8, 0, 100))
    : null;

  return {
    zoneOverlap,
    hitterZonePower: hitterPower === null ? null : round(hitterPower),
    pitcherLeak: round(pitcherLeak),
    zoneSignalAvailable: qualifiedZoneCount > 0,
    hotZoneCount,
    qualifiedZoneCount,
    zoneCells
  };
}

function weatherScore() {
  if (!weatherRows.length) return 0;

  const avg = weatherRows.reduce((sum, row) => {
    const wind = num(row.windSpeed || row.wind_speed);
    const temp = num(row.temp || row.temperature);

    let score = wind * 1.8;
    if (temp > 65) score += (temp - 65) * 0.7;

    return sum + score;
  }, 0) / weatherRows.length;

  return round(avg);
}

function pickOneScore(row, type) {
  const hr = num(row.hrConfidence);
  const power = num(row.powerScore);
  const pitch = num(row.pitchEdge);
  const pitcher = num(row.pitcherRisk);
  const weather = num(row.weather);
  const bullpen = num(row.bullpen);
  const zones = row.zoneSignalAvailable === false ? null : num(row.zoneOverlap);
  const due = num(row.due);
  const ceiling = num(row.multiHrCeilingScore || row.ceiling || row.powerScore);

  if (type === "overall") {
    return weightedScore([[hr, 0.34], [power, 0.22], [pitch, 0.16], [zones, 0.14], [pitcher, 0.08], [weather, 0.04], [bullpen, 0.02]]);
  }

  if (type === "safe") {
    return weightedScore([[hr, 0.45], [zones, 0.24], [power, 0.14], [pitch, 0.10], [pitcher, 0.07]]);
  }

  if (type === "ceiling") {
    return weightedScore([[ceiling, 0.28], [power, 0.25], [pitcher, 0.18], [pitch, 0.14], [zones, 0.10], [bullpen, 0.05]]);
  }

  if (type === "weather") {
    return weightedScore([[weather, 0.50], [power, 0.18], [hr, 0.14], [zones, 0.10], [pitch, 0.08]]);
  }

  if (type === "pitch") {
    return weightedScore([[pitch, 0.46], [pitcher, 0.22], [zones, 0.16], [power, 0.10], [hr, 0.06]]);
  }

  if (type === "longshot") {
    return weightedScore([[power, 0.25], [pitch, 0.23], [zones, 0.20], [pitcher, 0.16], [weather, 0.10], [due, 0.06]]);
  }

  return hr;
}

function shortPlayerCard(row, type, label, description) {
  if (!row) return null;

  return {
    label,
    type,
    description,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    game: row.game,
    pitcher: row.pitcher,
    opposingPitcher: row.opposingPitcher,
    probablePitcher: row.probablePitcher,
    pitcherStatus: row.pitcherStatus,
    hrConfidence: round(row.hrConfidence),
    powerScore: round(row.powerScore),
    pitchEdge: round(row.pitchEdge),
    pitcherRisk: round(row.pitcherRisk),
    weather: round(row.weather),
    bullpen: round(row.bullpen),
    due: round(row.due),
    zoneOverlap: row.zoneOverlap === null ? null : round(row.zoneOverlap),
    hitterZonePower: row.hitterZonePower === null ? null : round(row.hitterZonePower),
    zoneSignalAvailable: row.zoneSignalAvailable,
    pitcherLeak: round(row.pitcherLeak),
    hotZoneCount: row.hotZoneCount,
    seasonHr: row.seasonHr,
    bestPitch: row.bestPitch,
    tier: row.tier,
    reasons: row.reasons || [],
    pickOneScore: round(pickOneScore(row, type))
  };
}

function topPick(rows, type) {
  return rows
    .slice()
    .sort((a, b) => pickOneScore(b, type) - pickOneScore(a, type))[0] || null;
}

function buildIfOnlyOne(rows) {
  const usable = rows.filter(row => row && row.player);

  return {
    title: "If I Can Only Pick One",
    updatedAt: new Date().toISOString(),
    picks: {
      bestOverall: shortPlayerCard(
        topPick(usable, "overall"),
        "overall",
        "Best Overall HR Pick",
        "Best blend of power, matchup, zone overlap, pitcher risk, and environment."
      ),
      safestPlay: shortPlayerCard(
        topPick(usable, "safe"),
        "safe",
        "Safest HR Look",
        "Strongest profile when confidence, zones, and matchup stability are weighted heavier."
      ),
      highestCeiling: shortPlayerCard(
        topPick(usable, "ceiling"),
        "ceiling",
        "Highest Ceiling",
        "Biggest raw upside profile when power, pitcher vulnerability, and ceiling traits line up."
      ),
      bestWeatherPlay: shortPlayerCard(
        topPick(usable, "weather"),
        "weather",
        "Best Weather Play",
        "Best HR profile with weather and park carry weighted heavily."
      ),
      bestPitchMatchup: shortPlayerCard(
        topPick(usable, "pitch"),
        "pitch",
        "Best Pitch Matchup",
        "Best hitter versus the projected pitch mix and pitcher attack profile."
      ),
      bestLongshot: shortPlayerCard(
        topPick(usable.filter(row => num(row.hrConfidence) < 17), "longshot") || topPick(usable, "longshot"),
        "longshot",
        "Best Longshot",
        "Lower confidence bat with enough power, pitch edge, zones, or weather to stay live."
      )
    }
  };
}

function bullpenScore(opponent) {
  const row = bullpenMap.get(norm(opponent));
  if (!row) return 0;

  return round(num(pick(row, ["collapseScore", "dangerScore", "hrRiskScore"])));
}

function tier(score) {
  if (score >= 72) return "Nuclear";
  if (score >= 62) return "Elite";
  if (score >= 52) return "Strong";
  if (score >= 42) return "Live Longshot";
  return "Watchlist";
}

function tagsFor(card) {
  const tags = [];

  if (card.hrConfidence >= 62) tags.push("ELITE");
  else if (card.hrConfidence >= 52) tags.push("STRONG");
  else if (card.hrConfidence >= 42) tags.push("MODERATE");

  if (card.pitcherRisk >= 55) tags.push("DANGER");
  if (card.pitchEdge >= 55) tags.push("PITCH EDGE");
  if (card.weather >= 20) tags.push("WEATHER");
  if (card.bullpen >= 55) tags.push("BULLPEN");
  if (card.due >= 40) tags.push("DUE");
  if (card.hotZoneCount >= 5) tags.push("ZONE 5+");
  if (card.hitterZonePower >= 60) tags.push("POWER ZONE");
  if (card.pitcherLeak >= 70) tags.push("LEAK");
  if (card.zoneOverlap >= 55) tags.push("OVERLAP");
  if (card.powerScore >= 60) tags.push("POWER");
  if (num(card.lineupBoost) >= 8) tags.push("LINEUP BOOST");
  if (card.confirmedLineup) tags.push("CONFIRMED");

  return tags.slice(0, 6);
}

function reasonsFor(powerScore, pitchEdge, pitcherRisk, weather, due) {
  const reasons = [];

  if (powerScore >= 55) reasons.push("strong power profile");
  if (pitchEdge >= 55) reasons.push("crushes this pitch mix");
  if (pitcherRisk >= 55) reasons.push("pitcher attack zone vulnerability");
  if (weather >= 20) reasons.push("good HR weather conditions");
  if (due >= 40) reasons.push("hard contact trend support");

  return reasons.slice(0, 3);
}

function enrichPitcher(card, opponentMap) {
  const team = normTeam(card.team);
  const opponent = normTeam(card.opponent);

  const pitcher =
    opponentMap.get(`${team}|${opponent}`) ||
    opponentMap.get(`${opponent}|${team}`) ||
    clean(card.pitcher) ||
    clean(card.opposingPitcher) ||
    "TBD";

  return {
    ...card,
    pitcher,
    opposingPitcher: pitcher,
    probablePitcher: pitcher,
    pitcherStatus: pitcher === "TBD" ? "TBD" : "Probable"
  };
}

function buildCard(row) {
  const player = playerName(row);
  const playerId = text(pick(row, ["playerId", "mlbId", "id"]));
  const team = teamName(row);
  const opponent = text(pick(row, ["opponent", "opp", "opposing_team"]));
  const game = gameName(row);

  const pitchProfile = bestPitchProfile(
    pitchMap.get(text(pick(row, ["playerId", "mlbId", "id"]))) ||
    pitchMap.get(norm(player)) ||
    {}
  );
  const zone = zoneProfile(row);
  const statcast = statcastZoneProfile(row);

  const powerScore = round(num(pick(row, ["score", "hr_score", "modelScore", "final_score"])) || 50);
  const hardHit = round(num(pick(row, ["hard_hit", "hardHit", "hard_hit_rate"])));
  const barrel = round(num(pick(row, ["barrel", "barrel_rate", "barrel_pct"])));
  const iso = round(num(pick(row, ["iso", "ISO"])));

  const pitchEdge = round(pitchProfile.score);
  const pitcherRisk = round(zone.zoneSignalAvailable ? zone.zoneOverlap : zone.pitcherLeak);
  const weather = round(weatherScore());
  const bullpen = round(bullpenScore(opponent));

  const due = round(hardHit * 0.24 + barrel * 0.28 + iso * 20 + powerScore * 0.18);
  const seasonHr = round(num(row?.stats?.hitter?.hr ?? pick(row, ["hr", "HR", "hrs", "homeRuns", "home_runs", "seasonHr", "season_hr"], 0)));

  const compactPlayerKey = String(player || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const liveLineup =
    playerPoolLineupMap.get(String(row.playerId || "")) ||
    playerPoolLineupMap.get(norm(player)) ||
    playerPoolLineupMap.get(compactPlayerKey) ||
    {};

  const lineupImpact =
    lineupImpactMap.get(norm(player)) ||
    lineupImpactMap.get(compactPlayerKey) ||
    {};

  const hasLiveLineup = Boolean(liveLineup.lineupStatus || liveLineup.lineupSource || liveLineup.lineupSpot);

  const lineupStatus = liveLineup.lineupStatus || (lineupImpact.confirmedLineup ? "CONFIRMED" : "PROJECTED");
  const lineupSource = liveLineup.lineupSource || lineupImpact.lineupSource || "";
  const confirmedLineup = hasLiveLineup
    ? Boolean(liveLineup.confirmedLineup)
    : Boolean(lineupImpact.confirmedLineup);

  const lineupSpot = lineupStatus === "NOT IN LINEUP"
    ? null
    : (liveLineup.lineupSpot || lineupImpact.lineupSpot || null);

  const lineupBoost = round(num(lineupImpact.lineupBoost));
  const lineupImpactScore = round(num(lineupImpact.lineupImpactScore));
  const projectedPlateAppearances = round(num(lineupImpact.projectedPlateAppearances));
  const protectionScore = round(num(lineupImpact.protectionScore));

  const baseHrConfidence = round(weightedScore([
    [powerScore, 0.30],
    [pitchEdge, 0.22],
    [pitcherRisk, 0.18],
    [due, 0.12],
    [weather, 0.08],
    [bullpen, 0.10]
  ]));

  const hrConfidence = round(
    baseHrConfidence +
    lineupBoost * 0.18 +
    Math.max(0, lineupImpactScore - 65) * 0.035 +
    Math.max(0, protectionScore - 60) * 0.025
  );

  const card = {
    player,
    playerId: playerId ? Number(playerId) : null,
    mlbId: playerId ? Number(playerId) : null,
    team,
    opponent,
    game,

    hrConfidence,
    baseHrConfidence,
    lineupBoost,
    lineupImpactScore,
    lineupRole: lineupImpact.lineupRole || "",
    lineupSpot,
    lineupStatus,
    lineupSource,
    confirmedLineup,
    projectedPlateAppearances,
    protectionScore,
    hitterBefore: lineupImpact.hitterBefore || "",
    hitterAfter: lineupImpact.hitterAfter || "",
    powerScore,
    pitchEdge,
    pitcherRisk,
    weather,
    bullpen,
    due,
    seasonHr,

    ceilingScore: round(weightedScore([
      [powerScore, 0.26],
      [pitchEdge, 0.22],
      [pitcherRisk, 0.18],
      [zone.zoneOverlap, 0.14],
      [bullpen, 0.10],
      [weather, 0.06],
      [due, 0.04]
    ])),
    volatilityScore: round(
      Math.max(0, due - hrConfidence) * 0.30 +
      Math.max(0, powerScore - hrConfidence) * 0.20 +
      Math.max(0, pitchEdge - hrConfidence) * 0.18 +
      Math.max(0, pitcherRisk - hrConfidence) * 0.16 +
      Math.max(0, bullpen - hrConfidence) * 0.10 +
      Math.max(0, weather - 20) * 0.06
    ),

    bestPitch: pitchProfile.pitch,
    tier: tier(hrConfidence),
    reasons: [
      ...reasonsFor(powerScore, pitchEdge, pitcherRisk, weather, due),
      ...(lineupImpact.lineupRole ? ["Lineup role: " + lineupImpact.lineupRole] : []),
      ...(lineupBoost >= 8 ? ["strong lineup slot boost"] : []),
      ...(protectionScore >= 75 ? ["protection boost"] : [])
    ],

    zoneOverlap: zone.zoneOverlap,
    hitterZonePower: zone.hitterZonePower,
    pitcherLeak: zone.pitcherLeak,
    zoneSignalAvailable: zone.zoneSignalAvailable,
    hotZoneCount: zone.hotZoneCount,
    zoneCells: zone.zoneCells,

    avgZones: statcast.avgZones,
    isoZones: statcast.isoZones,
    slgZones: statcast.slgZones,
    hrZones: statcast.hrZones,
    kZones: statcast.kZones,
    hardHitZones: statcast.hardHitZones,
    barrelZones: statcast.barrelZones
  };

  card.tags = tagsFor(card);

  return card;
}

function topUnique(rows, scoreKey, limit = 12) {
  const used = new Set();

  return [...rows]
    .sort((a, b) => num(b[scoreKey]) - num(a[scoreKey]))
    .filter(row => {
      const key = row.playerId ? String(row.playerId) : norm(row.player);
      if (used.has(key)) return false;
      used.add(key);
      return true;
    })
    .slice(0, limit);
}

async function main() {
  const pitcherDate = todayEastern();

  if (
    playerPoolPayload?.availability === "no_games_scheduled" &&
    playerPoolPayload?.date === pitcherDate &&
    !playerPoolRows.length &&
    !hrRows.length
  ) {
    const output = {
      updatedAt: new Date().toISOString(),
      availability: "no_games_scheduled",
      totalPlayers: 0,
      pitcherSource: "MLB Stats API probablePitcher",
      pitcherDate,
      pitcherDebug: {
        scheduleGames: 0,
        pitcherPairs: 0,
        players: 0,
        withPitchers: 0,
        tbd: 0
      },
      sections: {
        ifOnlyOne: {},
        bestPicks: [],
        safestPlays: [],
        bestValue: [],
        lottoBombs: [],
        pitchTypeEdges: [],
        weatherCarry: [],
        bullpenBoosts: []
      },
      allPlayers: []
    };

    fs.writeFileSync(OUTFILE, JSON.stringify(output, null, 2));
    console.log("HR DECISION CENTER COMPLETE");
    console.log("Availability: no games scheduled");
    console.log("Players: 0");
    console.log("Saved:", OUTFILE);
    return;
  }

  const schedule = await getSchedule(pitcherDate);
  const { opponentMap, games } = buildPitcherMaps(schedule);

  const cards = uniqueRows(hrRows)
    .map(buildCard)
    .filter(row => row.player)
    .map(card => enrichPitcher(card, opponentMap));

  const output = {
    updatedAt: new Date().toISOString(),
    totalPlayers: cards.length,
    pitcherSource: "MLB Stats API probablePitcher",
    pitcherDate,
    pitcherDebug: {
      scheduleGames: games.length,
      pitcherPairs: opponentMap.size,
      players: cards.length,
      withPitchers: cards.filter(x => x.pitcher && x.pitcher !== "TBD").length,
      tbd: cards.filter(x => !x.pitcher || x.pitcher === "TBD").length
    },
    sections: {
      ifOnlyOne: buildIfOnlyOne(cards),

      bestPicks: topUnique(
        cards.map(card => ({
          ...card,
          decisionScore: weightedScore([
            [card.hrConfidence, 0.30], [card.powerScore, 0.18], [card.pitchEdge, 0.16],
            [card.pitcherRisk, 0.14], [card.zoneOverlap, 0.12], [card.bullpen, 0.05],
            [card.weather, 0.03], [card.due, 0.02]
          ])
        })),
        "decisionScore"
      ),

      safestPlays: topUnique(
        cards.map(card => ({
          ...card,
          safetyScore: weightedScore([
            [card.hrConfidence, 0.36], [card.powerScore, 0.22], [card.zoneOverlap, 0.18],
            [card.pitchEdge, 0.14], [card.pitcherRisk, 0.10]
          ]) - num(card.volatilityScore) * 0.10
        })),
        "safetyScore"
      ),

      bestValue: topUnique(
        cards.map(card => ({
          ...card,
          valueScore: weightedScore([
            [card.pitchEdge, 0.28], [card.pitcherRisk, 0.22], [card.zoneOverlap, 0.18],
            [card.bullpen, 0.10], [card.weather, 0.08], [card.due, 0.08], [card.ceilingScore, 0.06]
          ]) -
            num(card.seasonHr) * 2.0 -
            Math.max(0, num(card.hrConfidence) - 54) * 1.4 -
            Math.max(0, num(card.powerScore) - 62) * 1.1
        }))
        .filter(card =>
          num(card.seasonHr) <= 10 &&
          num(card.pitchEdge) >= 35 &&
          num(card.pitcherRisk) >= 35 &&
          num(card.hrConfidence) <= 56 &&
          num(card.powerScore) <= 64
        ),
        "valueScore"
      ),

      lottoBombs: topUnique(
        cards.map(card => ({
          ...card,
          lottoScore:
            num(card.ceilingScore) * 0.32 +
            num(card.due) * 0.24 +
            num(card.powerScore) * 0.18 +
            num(card.pitchEdge) * 0.12 +
            num(card.pitcherRisk) * 0.08 +
            num(card.bullpen) * 0.06
        })),
        "lottoScore"
      ),

      pitchTypeEdges: topUnique(
        cards.map(card => ({
          ...card,
          pitchTypeScore: weightedScore([
            [card.pitchEdge, 0.38], [card.pitcherRisk, 0.24], [card.zoneOverlap, 0.18],
            [card.powerScore, 0.12], [card.hrConfidence, 0.08]
          ])
        })),
        "pitchTypeScore"
      ),

      weatherCarry: topUnique(
        cards.map(card => ({
          ...card,
          weatherCarryScore: weightedScore([
            [card.weather, 0.40], [card.powerScore, 0.20], [card.zoneOverlap, 0.14],
            [card.pitchEdge, 0.10], [card.pitcherRisk, 0.08], [card.hrConfidence, 0.08]
          ])
        })),
        "weatherCarryScore"
      ),

      bullpenBoosts: topUnique(
        cards.map(card => ({
          ...card,
          bullpenBoostScore: weightedScore([
            [card.bullpen, 0.40], [card.powerScore, 0.18], [card.pitchEdge, 0.16],
            [card.zoneOverlap, 0.12], [card.pitcherRisk, 0.08], [card.hrConfidence, 0.06]
          ])
        })),
        "bullpenBoostScore"
      )
    },
    allPlayers: cards
  };

  if (!output.sections.ifOnlyOne) {
    output.sections.ifOnlyOne = buildIfOnlyOne(cards);
  }

  if (!Array.isArray(output.sections.bestValue) || output.sections.bestValue.length === 0) {
    output.sections.bestValue = topUnique(
      cards.map(card => ({
        ...card,
        valueScore: weightedScore([
          [card.pitchEdge, 0.30], [card.pitcherRisk, 0.24], [card.zoneOverlap, 0.18],
          [card.powerScore, 0.12], [card.weather, 0.08], [card.bullpen, 0.08]
        ])
      })),
      "valueScore"
    );
  }

  fs.writeFileSync(OUTFILE, JSON.stringify(output, null, 2));

  console.log("HR DECISION CENTER COMPLETE");
  console.log("Players:", cards.length);
  console.log("Statcast rows:", statcastRows.length);
  console.log("Pitcher debug:", output.pitcherDebug);
  console.log("Saved:", OUTFILE);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
