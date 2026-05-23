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

function readJsonRows(name) {
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

  const cleaned = String(value)
    .replace("%", "")
    .replace("+", "")
    .replace("N/A", "")
    .trim();

  const n = Number(cleaned);

  return Number.isFinite(n) ? n : fallback;
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    if (
      row[key] !== undefined &&
      row[key] !== null &&
      String(row[key]).trim() !== ""
    ) {
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
  return text(
    pick(row, [
      "player",
      "name",
      "batter",
      "player_name",
      "hitter"
    ])
  );
}

function teamName(row) {
  return text(
    pick(row, [
      "team",
      "player_team",
      "batter_team"
    ])
  );
}

function gameName(row) {
  return text(
    pick(row, [
      "game",
      "matchup"
    ])
  );
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
    const team = text(
      pick(row, [
        "team",
        "Team",
        "opponent"
      ])
    );

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

    const key =
      `${norm(player)}|${norm(teamName(row))}|${norm(gameName(row))}`;

    const existing = map.get(key) || {};

    map.set(key, {
      ...existing,
      ...row
    });
  }

  return Array.from(map.values());
}

const hrRows = readJsonRows("mlb_home_runs.json");
const weatherRows = readJsonRows("mlb_weather.json");
const pitchRows = readJsonRows("pitch_type_damage.json");
const attackRows = readJsonRows("pitcher_attack_zones.json");
const bullpenRows = readJsonRows("bullpen_collapse_engine.json");

const pitchMap = makePlayerMap(pitchRows);
const attackMap = makePlayerMap(attackRows);
const bullpenMap = makeTeamMap(bullpenRows);

function bestPitchProfile(row) {
  const pitchDamage = row?.pitchDamage;

  if (!pitchDamage || typeof pitchDamage !== "object") {
    return {
      score: 0,
      pitch: "",
      crush: 0
    };
  }

  let best = {
    score: 0,
    pitch: "",
    crush: 0
  };

  for (const [pitch, profile] of Object.entries(pitchDamage)) {
    const crush = num(profile.crush);
    const barrel = num(profile.barrel) * 100;
    const hardHit = num(profile.hardHit) * 100;
    const slg = num(profile.slg) * 100;

    const score =
      crush * 0.45 +
      barrel * 0.22 +
      hardHit * 0.18 +
      slg * 0.15;

    if (score > best.score) {
      best = {
        score: round(score),
        pitch: text(profile.label, pitch),
        crush: round(crush)
      };
    }
  }

  return best;
}

function weatherScore() {
  if (!weatherRows.length) return 0;

  const avg =
    weatherRows.reduce((sum, row) => {
      const wind = num(row.windSpeed);
      const temp = num(row.temp);

      let score = 0;

      score += wind * 1.8;

      if (temp > 65) {
        score += (temp - 65) * 0.7;
      }

      return sum + score;
    }, 0) / weatherRows.length;

  return round(avg);
}

function bullpenScore(opponent) {
  const row = bullpenMap.get(norm(opponent));

  if (!row) return 0;

  return round(
    num(
      pick(row, [
        "collapseScore",
        "dangerScore",
        "hrRiskScore"
      ])
    )
  );
}

function zoneProfileFor(player) {
  const row = attackMap.get(norm(player));

  const zones = row?.zones || {};

  const hitterPower = num(zones.hitterPower);
  const pitcherLeak = num(zones.pitcherLeak);
  const zoneRows = Array.isArray(zones.zones) ? zones.zones : [];

  let hotZoneCount = 0;
  let overlapTotal = 0;

  for (const zone of zoneRows) {
    const hitter = num(zone.hitterPower || zone.hitter || zone.power);
    const pitcher = num(zone.pitcherLeak || zone.pitcher || zone.leak);
    const overlap = num(zone.overlap || zone.score || Math.min(hitter, pitcher));

    if (overlap >= 55) hotZoneCount += 1;

    overlapTotal += overlap;
  }

  const avgZoneOverlap = zoneRows.length
    ? overlapTotal / zoneRows.length
    : 0;

  const zoneOverlap = round(
    hitterPower * 0.36 +
    pitcherLeak * 0.36 +
    avgZoneOverlap * 0.18 +
    hotZoneCount * 2.5
  );

  const zoneCells = zoneRows.map((zone, index) => {
    const danger = num(zone.danger);
    const hitter = num(zone.hitterPower || zone.hitter || zone.power || zone.batter || zone.value || danger);
    const pitcher = num(zone.pitcherLeak || zone.pitcher || zone.leak || zone.vuln || zone.risk || danger);
    const overlap = num(zone.overlap || zone.score || danger || Math.min(hitter, pitcher));

    return {
      index,
      hitter: round(hitter),
      pitcher: round(pitcher),
      overlap: round(overlap)
    };
  });

  return {
    zoneOverlap,
    hitterZonePower: round(hitterPower),
    pitcherLeak: round(pitcherLeak),
    hotZoneCount,
    zoneCells
  };
}

function pitcherAttackScore(player) {
  const zoneProfile = zoneProfileFor(player);

  return round(zoneProfile.zoneOverlap);
}

function decisionTier(score) {
  if (score >= 72) return "Nuclear";
  if (score >= 62) return "Elite";
  if (score >= 52) return "Strong";
  if (score >= 42) return "Live Longshot";
  return "Watchlist";
}

function buildReasons({
  powerScore,
  pitchScore,
  pitcherRisk,
  weather,
  due
}) {
  const reasons = [];

  if (powerScore >= 60) {
    reasons.push("elite power profile");
  }

  if (pitchScore >= 55) {
    reasons.push("crushes this pitch mix");
  }

  if (pitcherRisk >= 55) {
    reasons.push("pitcher attack zone vulnerability");
  }

  if (weather >= 20) {
    reasons.push("good HR weather conditions");
  }

  if (due >= 45) {
    reasons.push("hard contact trending up");
  }

  return reasons.slice(0, 3);
}

function buildCard(row) {
  const player = playerName(row);

  const team = teamName(row);

  const opponent = text(
    pick(row, [
      "opponent",
      "opp",
      "opposing_team"
    ])
  );

  const game = gameName(row);

  const pitchData =
    pitchMap.get(norm(player)) || {};

  const pitchProfile =
    bestPitchProfile(pitchData);

  const powerScore = round(
    num(
      pick(row, [
        "score",
        "hr_score",
        "modelScore",
        "final_score"
      ])
    ) || 50
  );

  const hardHit = round(
    num(
      pick(row, [
        "hard_hit",
        "hardHit",
        "hard_hit_rate"
      ])
    )
  );

  const barrel = round(
    num(
      pick(row, [
        "barrel",
        "barrel_rate",
        "barrel_pct"
      ])
    )
  );

  const iso = round(
    num(
      pick(row, [
        "iso",
        "ISO"
      ])
    )
  );

  const pitchEdge = round(
    pitchProfile.score
  );

  const zoneProfile = zoneProfileFor(player);

  const pitcherRisk = round(
    pitcherAttackScore(player)
  );

  const weather = round(
    weatherScore()
  );

  const bullpen = round(
    bullpenScore(opponent)
  );

  const due = round(
    hardHit * 0.24 +
    barrel * 0.28 +
    iso * 20 +
    powerScore * 0.18
  );

  const hrConfidence = round(
    powerScore * 0.34 +
    pitchEdge * 0.22 +
    pitcherRisk * 0.16 +
    due * 0.12 +
    weather * 0.08 +
    bullpen * 0.08
  );

  const reasons = buildReasons({
    powerScore,
    pitchScore: pitchEdge,
    pitcherRisk,
    zoneOverlap: zoneProfile.zoneOverlap,
    hitterZonePower: zoneProfile.hitterZonePower,
    pitcherLeak: zoneProfile.pitcherLeak,
    hotZoneCount: zoneProfile.hotZoneCount,
    zoneCells: zoneProfile.zoneCells,
    weather,
    due
  });

  return {
    player,
    team,
    opponent,
    game,

    hrConfidence,

    powerScore,
    pitchEdge,
    pitcherRisk,
    zoneOverlap: zoneProfile.zoneOverlap,
    hitterZonePower: zoneProfile.hitterZonePower,
    pitcherLeak: zoneProfile.pitcherLeak,
    hotZoneCount: zoneProfile.hotZoneCount,
    zoneCells: zoneProfile.zoneCells,
    weather,
    bullpen,
    due,

    bestPitch: pitchProfile.pitch,

    tier: decisionTier(hrConfidence),

    reasons,

    lineupStatus: text(
      pick(row, [
        "lineup_status",
        "lineupStatus"
      ], "Projected")
    )
  };
}

function topUnique(rows, scoreKey, limit = 12) {
  const used = new Set();

  return [...rows]
    .sort((a, b) => b[scoreKey] - a[scoreKey])
    .filter(row => {
      const key = norm(row.player);

      if (used.has(key)) return false;

      used.add(key);

      return true;
    })
    .slice(0, limit);
}

const cards = uniqueRows(hrRows)
  .map(buildCard)
  .filter(row => row.player);

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

fs.writeFileSync(
  OUTFILE,
  JSON.stringify(output, null, 2)
);

console.log("HR DECISION CENTER COMPLETE");
console.log("Players:", cards.length);
console.log("Saved:", OUTFILE);
