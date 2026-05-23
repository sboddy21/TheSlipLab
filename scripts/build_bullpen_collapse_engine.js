import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "data");
const WEBSITE_DATA = path.join(ROOT, "website/data");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(DATA_DIR);
ensureDir(WEBSITE_DATA);

function readJSON(filePath, fallback = []) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function toArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.games)) return payload.games;
  if (Array.isArray(payload.teams)) return payload.teams;
  if (Array.isArray(payload.stacks)) return payload.stacks;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.pitchers)) return payload.pitchers;
  if (Array.isArray(payload.zones)) return payload.zones;
  if (Array.isArray(payload.parks)) return payload.parks;
  if (Array.isArray(payload.weather)) return payload.weather;
  return [];
}

function writeCSV(filePath, rows) {
  if (!rows.length) {
    fs.writeFileSync(filePath, "");
    return;
  }

  const headers = Object.keys(rows[0]);

  const csv = [
    headers.join(","),
    ...rows.map(row =>
      headers.map(header => {
        const value = row[header] ?? "";
        return `"${String(value).replace(/"/g, '""')}"`;
      }).join(",")
    )
  ].join("\n");

  fs.writeFileSync(filePath, csv);
}

function norm(value = "") {
  return String(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function grade(score) {
  if (score >= 90) return "EXTREME COLLAPSE RISK";
  if (score >= 75) return "COLLAPSE RISK";
  if (score >= 60) return "DANGER";
  if (score >= 45) return "WATCHLIST";
  if (score >= 30) return "STABLE";
  return "ELITE STABLE";
}

console.log("THE SLIP LAB BULLPEN COLLAPSE ENGINE");
console.log("===================================");

const games = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_games_today.json"), [])
);

const stacks = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_team_stacks.json"), [])
);

const pitcherZones = toArray(
  readJSON(path.join(WEBSITE_DATA, "pitcher_attack_zones.json"), [])
);

const weatherRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_weather.json"), [])
);

const parkRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_park_factors.json"), [])
);

const teamSet = new Map();

for (const game of games) {
  const home = game.home_team || game.homeTeam || game.home || game.homeTeamName || "";
  const away = game.away_team || game.awayTeam || game.away || game.awayTeamName || "";

  if (home) teamSet.set(norm(home), home);
  if (away) teamSet.set(norm(away), away);
}

for (const stack of stacks) {
  const team = stack.team || stack.Team || stack.stackTeam || stack.offense || "";
  const opponent = stack.opponent || stack.Opponent || stack.pitchingTeam || stack.against || "";

  if (team) teamSet.set(norm(team), team);
  if (opponent) teamSet.set(norm(opponent), opponent);
}

const opponentStackPressure = {};

for (const stack of stacks) {
  const team = stack.team || stack.Team || stack.stackTeam || stack.offense || "";
  const opponent = stack.opponent || stack.Opponent || stack.pitchingTeam || stack.against || "";

  if (!opponent) continue;

  const score =
    num(stack.stackScore) ||
    num(stack.score) ||
    num(stack.teamStackScore) ||
    num(stack.totalScore) ||
    50;

  const key = norm(opponent);

  opponentStackPressure[key] = Math.max(
    opponentStackPressure[key] || 0,
    score
  );
}

const pitcherRiskByTeam = {};

for (const row of pitcherZones) {
  const team =
    row.team ||
    row.Team ||
    row.pitcherTeam ||
    row.pitchingTeam ||
    row.opponent ||
    "";

  if (!team) continue;

  const score =
    num(row.attackScore) ||
    num(row.pitcherAttackScore) ||
    num(row.dangerScore) ||
    num(row.hrRiskScore) ||
    num(row.score) ||
    num(row.zoneScore) ||
    45;

  const key = norm(team);

  if (!pitcherRiskByTeam[key]) {
    pitcherRiskByTeam[key] = [];
  }

  pitcherRiskByTeam[key].push(score);
}

const weatherMap = {};

for (const row of weatherRows) {
  const home = row.home_team || row.homeTeam || row.home || row.homeTeamName || "";
  const away = row.away_team || row.awayTeam || row.away || row.awayTeamName || "";
  const team = row.team || row.Team || "";

  const weatherBoost =
    num(row.weather_boost) +
    num(row.wind_boost) +
    num(row.park_boost) +
    num(row.weatherBoost) +
    num(row.windBoost);

  if (home) weatherMap[norm(home)] = weatherBoost;
  if (away) weatherMap[norm(away)] = weatherBoost;
  if (team) weatherMap[norm(team)] = weatherBoost;
}

const parkMap = {};

for (const row of parkRows) {
  const team =
    row.team ||
    row.Team ||
    row.home_team ||
    row.homeTeam ||
    "";

  const parkFactor =
    num(row.parkFactor) ||
    num(row.hrParkFactor) ||
    num(row.factor) ||
    num(row.homeRunFactor) ||
    100;

  if (team) parkMap[norm(team)] = parkFactor;
}

const output = [];

for (const [key, team] of teamSet.entries()) {
  const pitcherScores = pitcherRiskByTeam[key] || [];

  const pitcherRisk =
    pitcherScores.length
      ? pitcherScores.reduce((a, b) => a + b, 0) / pitcherScores.length
      : 45;

  const stackPressure =
    opponentStackPressure[key] || 50;

  const weatherBoost =
    weatherMap[key] || 0;

  const parkFactor =
    parkMap[key] || 100;

  const fatigueScore = clamp(
    stackPressure * 0.35 + pitcherRisk * 0.35 + weatherBoost * 5,
    0,
    100
  );

  const hrRiskScore = clamp(
    pitcherRisk * 0.55 +
      stackPressure * 0.25 +
      Math.max(0, parkFactor - 100) * 0.6 +
      weatherBoost * 4,
    0,
    100
  );

  const collapseScore = clamp(
    fatigueScore * 0.35 +
      hrRiskScore * 0.45 +
      stackPressure * 0.2,
    0,
    100
  );

  const dangerScore = clamp(
    collapseScore * 0.65 +
      stackPressure * 0.2 +
      weatherBoost * 6 +
      Math.max(0, parkFactor - 100) * 0.5,
    0,
    100
  );

  output.push({
    team,
    fatigueScore: Number(fatigueScore.toFixed(1)),
    hrRiskScore: Number(hrRiskScore.toFixed(1)),
    collapseScore: Number(collapseScore.toFixed(1)),
    dangerScore: Number(dangerScore.toFixed(1)),
    grade: grade(dangerScore),
    usedYesterday: false,
    backToBackArms: 0,
    last3DayPitches: 0,
    bullpenEra: null,
    bullpenHr9: null,
    hardHitAllowed: null,
    barrelAllowed: null,
    xslgAllowed: null,
    weatherBoost,
    parkFactor,
    source: "derived_from_current_repo_files"
  });
}

output.sort((a, b) => num(b.dangerScore) - num(a.dangerScore));

writeCSV(
  path.join(DATA_DIR, "bullpen_collapse_engine.csv"),
  output
);

fs.writeFileSync(
  path.join(WEBSITE_DATA, "bullpen_collapse_engine.json"),
  JSON.stringify(output, null, 2)
);

console.log("");
console.log("BULLPEN COLLAPSE ENGINE COMPLETE");
console.log(`Teams: ${output.length}`);

console.table(
  output.slice(0, 15).map(row => ({
    team: row.team,
    danger: row.dangerScore,
    grade: row.grade,
    fatigue: row.fatigueScore,
    hrRisk: row.hrRiskScore
  }))
);

console.log("");
console.log(`Saved: ${path.join(DATA_DIR, "bullpen_collapse_engine.csv")}`);
console.log(`Saved: ${path.join(WEBSITE_DATA, "bullpen_collapse_engine.json")}`);
