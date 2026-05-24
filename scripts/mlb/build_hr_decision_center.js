import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const OUTFILE = path.join(DATA_DIR, "hr_decision_center.json");

function readRawJson(name) {
  try {
    const file = path.join(DATA_DIR, name);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
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

function num(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(String(value).replace("%", "").replace("+", "").replace("N/A", "").trim());
  return Number.isFinite(n) ? n : fallback;
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

function round(value) {
  return Math.round(num(value) * 100) / 100;
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

function uniqueRows(rows) {
  const map = new Map();

  for (const row of rows) {
    const player = playerName(row);
    if (!player) continue;

    const key = `${norm(player)}|${norm(teamName(row))}|${norm(gameName(row))}`;
    map.set(key, { ...(map.get(key) || {}), ...row });
  }

  return Array.from(map.values());
}

const hrRows = readRows("mlb_home_runs.json");
const weatherRows = readRows("mlb_weather.json");
const pitchRows = readRows("pitch_type_damage.json");
const attackRows = readRows("pitcher_attack_zones.json");
const statcastRows = readRows("statcast_zones.json");
const bullpenRows = readRows("bullpen_collapse_engine.json");

const pitchMap = makePlayerMap(pitchRows);
const attackMap = makePlayerMap(attackRows);
const statcastMap = makePlayerMap(statcastRows);
const bullpenMap = makeTeamMap(bullpenRows);

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

function statcastZoneProfile(player) {
  const row = statcastMap.get(norm(player));
  const zones = row?.zones || {};

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

function zoneProfile(player) {
  const row = attackMap.get(norm(player));
  const zones = row?.zones || {};
  const zoneRows = Array.isArray(zones.zones) ? zones.zones : [];

  const hitterPower = num(zones.hitterPower);
  const pitcherLeak = num(zones.pitcherLeak);

  let hotZoneCount = 0;
  let overlapTotal = 0;

  const zoneCells = zoneRows.slice(0, 25).map((zone, index) => {
    const danger = num(zone.danger);
    const hitter = danger || hitterPower;
    const pitcher = danger || pitcherLeak;
    const overlap = danger || Math.min(hitter, pitcher);

    if (overlap >= 65) hotZoneCount += 1;
    overlapTotal += overlap;

    return {
      index,
      hitter: round(hitter),
      pitcher: round(pitcher),
      overlap: round(overlap)
    };
  });

  while (zoneCells.length < 25) {
    zoneCells.push({
      index: zoneCells.length,
      hitter: 0,
      pitcher: 0,
      overlap: 0
    });
  }

  const avgOverlap = zoneRows.length ? overlapTotal / zoneRows.length : 0;

  const zoneOverlap = round(
    hitterPower * 0.34 +
    pitcherLeak * 0.34 +
    avgOverlap * 0.22 +
    hotZoneCount * 1.8
  );

  return {
    zoneOverlap,
    hitterZonePower: round(hitterPower),
    pitcherLeak: round(pitcherLeak),
    hotZoneCount,
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

function buildCard(row) {
  const player = playerName(row);
  const team = teamName(row);
  const opponent = text(pick(row, ["opponent", "opp", "opposing_team"]));
  const game = gameName(row);

  const pitchProfile = bestPitchProfile(pitchMap.get(norm(player)) || {});
  const zone = zoneProfile(player);
  const statcast = statcastZoneProfile(player);

  const powerScore = round(num(pick(row, ["score", "hr_score", "modelScore", "final_score"])) || 50);
  const hardHit = round(num(pick(row, ["hard_hit", "hardHit", "hard_hit_rate"])));
  const barrel = round(num(pick(row, ["barrel", "barrel_rate", "barrel_pct"])));
  const iso = round(num(pick(row, ["iso", "ISO"])));

  const pitchEdge = round(pitchProfile.score);
  const pitcherRisk = round(zone.zoneOverlap);
  const weather = round(weatherScore());
  const bullpen = round(bullpenScore(opponent));

  const due = round(hardHit * 0.24 + barrel * 0.28 + iso * 20 + powerScore * 0.18);

  const hrConfidence = round(
    powerScore * 0.30 +
    pitchEdge * 0.22 +
    pitcherRisk * 0.18 +
    due * 0.12 +
    weather * 0.08 +
    bullpen * 0.10
  );

  const card = {
    player,
    team,
    opponent,
    game,

    hrConfidence,
    powerScore,
    pitchEdge,
    pitcherRisk,
    weather,
    bullpen,
    due,

    bestPitch: pitchProfile.pitch,
    tier: tier(hrConfidence),
    reasons: reasonsFor(powerScore, pitchEdge, pitcherRisk, weather, due),

    zoneOverlap: zone.zoneOverlap,
    hitterZonePower: zone.hitterZonePower,
    pitcherLeak: zone.pitcherLeak,
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
      const key = norm(row.player);
      if (used.has(key)) return false;
      used.add(key);
      return true;
    })
    .slice(0, limit);
}

const cards = uniqueRows(hrRows).map(buildCard).filter(row => row.player);

const output = {
  updatedAt: new Date().toISOString(),
  totalPlayers: cards.length,
  sections: {
    bestPicks: topUnique(cards, "hrConfidence"),
    safestPlays: topUnique(cards, "powerScore"),
    lottoBombs: topUnique(cards, "due"),
    pitchTypeEdges: topUnique(cards, "pitchEdge"),
    weatherCarry: topUnique(cards, "weather"),
    bullpenBoosts: topUnique(cards, "bullpen")
  },
  allPlayers: cards
};

fs.writeFileSync(OUTFILE, JSON.stringify(output, null, 2));

console.log("HR DECISION CENTER COMPLETE");
console.log("Players:", cards.length);
console.log("Statcast rows:", statcastRows.length);
console.log("Saved:", OUTFILE);
