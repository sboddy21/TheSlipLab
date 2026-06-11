import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const OUT = path.join(DATA, "health_status.json");

function readJson(file, fallback = null) {
  try {
    const p = path.join(DATA, file);
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
}

function count(data, keys = []) {
  if (Array.isArray(data)) return data.length;
  if (!data || typeof data !== "object") return 0;
  for (const key of keys) {
    if (Array.isArray(data[key])) return data[key].length;
    if (data[key] && typeof data[key] === "object") return Object.keys(data[key]).length;
  }
  return 0;
}

const stampData = readJson("site_last_updated.json", {});
const games = readJson("mlb_games_today.json", {});
const playerPool = readJson("mlb_player_pool.json", {});
const hrBoard = readJson("mlb_home_runs.json", {});
const matchups = readJson("game_pitcher_matchups.json", {});
const decision = readJson("hr_decision_center.json", {});
const weather = readJson("mlb_weather.json", {});
const results = readJson("mlb_results.json", {});

const updatedAt = stampData.updatedAt || stampData.updated_at || new Date().toISOString();

const payload = {
  sport: "MLB",
  status: "healthy",
  label: "LIVE",
  updatedAt,
  generatedAt: new Date().toISOString(),
  source: stampData.source || "unknown",
  checks: {
    games: count(games, ["games"]),
    players: count(playerPool, ["players"]),
    hrBoard: count(hrBoard, ["players", "rows"]),
    matchups: count(matchups, ["games"]),
    decisionCenter: count(decision, ["allPlayers"]),
    weather: count(weather, ["games", "weather"]),
    results: count(results, ["homeRuns", "results"])
  },
  sections: {},
  errors: []
};

const sections = decision.sections || {};
for (const [key, value] of Object.entries(sections)) {
  payload.sections[key] = Array.isArray(value)
    ? value.length
    : value && typeof value === "object"
      ? "loaded"
      : 0;
}

if (payload.checks.games <= 0) payload.errors.push("No MLB games loaded");
if (payload.checks.players <= 0) payload.errors.push("No player pool loaded");
if (payload.checks.hrBoard <= 0) payload.errors.push("No HR board loaded");
if (payload.checks.matchups <= 0) payload.errors.push("No matchup data loaded");
if (payload.checks.decisionCenter <= 0) payload.errors.push("Decision Center empty");

if (payload.errors.length) {
  payload.status = "error";
  payload.label = "CHECK";
}

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log("MLB health status built:", OUT);
console.log(payload.status.toUpperCase(), payload.checks);
