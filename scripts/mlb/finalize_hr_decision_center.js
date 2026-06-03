import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const FILE = path.join(DATA_DIR, "hr_decision_center.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clean(v) {
  return v === null || v === undefined ? "" : String(v).trim();
}

function uniqueTop(rows, key, limit = 12) {
  const used = new Set();

  return [...rows]
    .filter(row => row && row.player)
    .sort((a, b) => num(b[key]) - num(a[key]))
    .filter(row => {
      const k = clean(row.player).toLowerCase();
      if (!k || used.has(k)) return false;
      used.add(k);
      return true;
    })
    .slice(0, limit);
}

function pickOneScore(row, type) {
  if (type === "safe") {
    return (
      num(row.safetyScore) * 1.25 +
      num(row.hrConfidence) * 3.0 +
      num(row.powerScore) * 0.18 +
      num(row.pitchEdge) * 0.14 +
      num(row.zoneOverlap) * 0.12
    );
  }

  if (type === "ceiling") {
    return (
      num(row.powerScore) * 0.55 +
      num(row.pitcherRisk) * 0.34 +
      num(row.pitchEdge) * 0.26 +
      num(row.weatherScore || row.weather) * 0.22 +
      num(row.bullpenScore || row.bullpen) * 0.16 +
      num(row.multiHrCeilingScore) * 0.45
    );
  }

  if (type === "weather") {
    return (
      num(row.weatherScore || row.weather) * 0.80 +
      num(row.hrConfidence) * 2.2 +
      num(row.powerScore) * 0.24 +
      num(row.pitcherRisk) * 0.18
    );
  }

  if (type === "pitch") {
    return (
      num(row.pitchTypeScore || row.pitchTypeDestructionScore || row.pitchEdge) * 0.75 +
      num(row.pitchEdge) * 0.35 +
      num(row.zoneOverlap) * 0.30 +
      num(row.hrConfidence) * 2.2
    );
  }

  if (type === "longshot") {
    return (
      num(row.lottoScore) * 1.15 +
      num(row.dueScore || row.due) * 0.65 +
      num(row.powerScore) * 0.24 +
      num(row.pitcherRisk) * 0.22 +
      num(row.pitchEdge) * 0.20 +
      num(row.weatherScore || row.weather) * 0.14 -
      num(row.hrConfidence) * 0.65
    );
  }

  return (
    num(row.decisionScore) * 1.15 +
    num(row.hrConfidence) * 3.0 +
    num(row.powerScore) * 0.25 +
    num(row.pitcherRisk) * 0.22 +
    num(row.pitchEdge) * 0.20 +
    num(row.zoneOverlap) * 0.14 +
    num(row.weatherScore || row.weather) * 0.10 +
    num(row.bullpenScore || row.bullpen) * 0.08
  );
}

function shortPick(row, type, label, description) {
  if (!row) return null;

  return {
    label,
    type,
    description,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    game: row.game,
    hrConfidence: num(row.hrConfidence),
    powerScore: num(row.powerScore),
    pitchEdge: num(row.pitchEdge),
    pitcherRisk: num(row.pitcherRisk),
    weather: num(row.weatherScore || row.weather),
    bullpen: num(row.bullpenScore || row.bullpen),
    due: num(row.dueScore || row.due),
    zoneOverlap: num(row.zoneOverlap),
    bestPitch: row.bestPitch,
    tier: row.tier,
    reasons: row.reasons || [],
    pickOneScore: Number(pickOneScore(row, type).toFixed(1))
  };
}

function topPick(rows, type, used = new Set()) {
  const pick = [...rows]
    .filter(row => row && row.player && !used.has(clean(row.player).toLowerCase()))
    .sort((a, b) => pickOneScore(b, type) - pickOneScore(a, type))[0] || null;

  if (pick?.player) used.add(clean(pick.player).toLowerCase());

  return pick;
}

function buildIfOnlyOne(rows) {
  const usable = rows.filter(row => row && row.player);
  const used = new Set();

  const bestOverall = topPick(usable, "overall", used);
  const safestPlay = topPick(usable, "safe", used);
  const highestCeiling = topPick(usable, "ceiling", used);
  const bestWeatherPlay = topPick(usable, "weather", used);
  const bestPitchMatchup = topPick(usable, "pitch", used);

  const longshotPool = usable.filter(row =>
    num(row.hrConfidence) < 35 ||
    num(row.lottoScore) > 0 ||
    num(row.dueScore || row.due) > 0
  );

  const bestLongshot = topPick(longshotPool.length ? longshotPool : usable, "longshot", used);

  return {
    title: "If I Can Only Pick One",
    updatedAt: new Date().toISOString(),
    picks: {
      bestOverall: shortPick(bestOverall, "overall", "Best Overall HR Pick", "Best blend of power, matchup, zone overlap, pitcher risk, and environment."),
      safestPlay: shortPick(safestPlay, "safe", "Safest HR Look", "Strongest profile when confidence, zones, and matchup stability are weighted heavier."),
      highestCeiling: shortPick(highestCeiling, "ceiling", "Highest Ceiling", "Biggest raw upside profile when power, pitcher vulnerability, and ceiling traits line up."),
      bestWeatherPlay: shortPick(bestWeatherPlay, "weather", "Best Weather Play", "Best HR profile with weather and park carry weighted heavily."),
      bestPitchMatchup: shortPick(bestPitchMatchup, "pitch", "Best Pitch Matchup", "Best hitter versus the projected pitch mix and pitcher attack profile."),
      bestLongshot: shortPick(bestLongshot, "longshot", "Best Longshot", "Lower confidence bat with enough power, pitch edge, zones, or weather to stay live.")
    }
  };
}

const json = readJSON(FILE, null);

if (!json) {
  throw new Error(`Missing ${FILE}`);
}

const rows = Array.isArray(json.allPlayers)
  ? json.allPlayers
  : Array.isArray(json.rows)
    ? json.rows
    : [];

if (!rows.length) {
  throw new Error("No Decision Center rows found");
}

const sections = {
  ...(json.sections || {}),
  ifOnlyOne: buildIfOnlyOne(rows),
  bestValue: Array.isArray(json.sections?.bestValue) && json.sections.bestValue.length
    ? json.sections.bestValue
    : uniqueTop(
        rows
          .map(row => ({
            ...row,
            valueScore:
              num(row.hrConfidence) * 2.2 +
              num(row.hrVolatilityScore) * 4.5 +
              num(row.pitchEdge) * 0.25 +
              num(row.pitcherRisk) * 0.20 +
              num(row.zoneOverlap) * 0.18 +
              num(row.dueScore || row.due) * 0.30 -
              Math.max(0, num(row.powerScore) - 72) * 0.35
          }))
          .filter(row => num(row.hrConfidence) >= 6),
        "valueScore"
      )
};

const output = {
  ...json,
  updatedAt: new Date().toISOString(),
  sections,
  allPlayers: rows
};

writeJSON(FILE, output);

console.log("HR DECISION CENTER FINALIZED");
console.log("Players:", rows.length);
console.log("If Only One picks:", Object.values(sections.ifOnlyOne.picks).filter(Boolean).length);
console.log("Best Value:", sections.bestValue.length);
console.log("Saved:", FILE);
