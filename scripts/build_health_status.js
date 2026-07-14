import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const OUT = path.join(DATA, "health_status.json");
const MAX_REFRESH_AGE_MS = 15 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 1000;

function todayEastern() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function readArtifact(file) {
  const fullPath = path.join(DATA, file);

  try {
    if (!fs.existsSync(fullPath)) {
      return { file, data: null, mtimeMs: NaN, error: `${file} is missing` };
    }

    return {
      file,
      data: JSON.parse(fs.readFileSync(fullPath, "utf8")),
      mtimeMs: fs.statSync(fullPath).mtimeMs,
      error: null
    };
  } catch (error) {
    return { file, data: null, mtimeMs: NaN, error: `${file} could not be read: ${error.message}` };
  }
}

function embeddedTimestamp(artifact, fields) {
  if (!fields.length) return artifact.mtimeMs;

  for (const field of fields) {
    const value = artifact.data?.[field];
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }

  return NaN;
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

const artifacts = {
  games: readArtifact("mlb_games_today.json"),
  playerPool: readArtifact("mlb_player_pool.json"),
  hrBoard: readArtifact("mlb_home_runs.json"),
  matchups: readArtifact("game_pitcher_matchups.json"),
  decision: readArtifact("hr_decision_center.json"),
  weather: readArtifact("mlb_weather.json"),
  results: readArtifact("mlb_results.json")
};

const games = artifacts.games.data || {};
const playerPool = artifacts.playerPool.data || {};
const hrBoard = artifacts.hrBoard.data || {};
const matchups = artifacts.matchups.data || {};
const decision = artifacts.decision.data || {};
const weather = artifacts.weather.data || {};
const results = artifacts.results.data || {};
const generatedAt = new Date().toISOString();
const slateDate = todayEastern();
const scheduledGames = Array.isArray(games.games) ? games.games : [];
const noGamesScheduled = games.date === slateDate && scheduledGames.length === 0;

const productionArtifacts = [
  [artifacts.games, ["updatedAt"]],
  [artifacts.playerPool, ["updatedAt"]],
  [artifacts.hrBoard, []],
  [artifacts.matchups, ["updatedAt"]],
  [artifacts.decision, ["updatedAt"]],
  [artifacts.weather, ["updatedAt"]]
];

const productionTimes = productionArtifacts
  .map(([artifact, fields]) => embeddedTimestamp(artifact, fields))
  .filter(Number.isFinite);
const updatedAt = productionTimes.length
  ? new Date(Math.max(...productionTimes)).toISOString()
  : generatedAt;

const payload = {
  sport: "MLB",
  status: "healthy",
  label: noGamesScheduled ? "CLOSED" : "LIVE",
  availability: noGamesScheduled ? "no_games_scheduled" : "live_slate",
  updatedAt,
  generatedAt,
  source: "mlb_fast_refresh",
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

for (const artifact of Object.values(artifacts)) {
  if (artifact.error && artifact !== artifacts.results) payload.errors.push(artifact.error);
}

const gamesAnchor = Date.parse(games.updatedAt);
if (!Number.isFinite(gamesAnchor)) {
  payload.errors.push("mlb_games_today.json has no valid updatedAt");
} else {
  if (Date.now() - gamesAnchor > MAX_REFRESH_AGE_MS) {
    payload.errors.push("MLB production chain is older than 15 minutes");
  }

  for (const [artifact, fields] of productionArtifacts) {
    const timestamp = embeddedTimestamp(artifact, fields);
    if (!Number.isFinite(timestamp)) {
      payload.errors.push(`${artifact.file} has no valid ${fields.join(" or ") || "filesystem timestamp"}`);
    } else if (timestamp < gamesAnchor - CLOCK_TOLERANCE_MS) {
      payload.errors.push(`${artifact.file} predates the current production chain`);
    }
  }
}

const expectedDates = [
  ["mlb_games_today.json", games.date],
  ["mlb_player_pool.json", playerPool.date],
  ["game_pitcher_matchups.json", matchups.date],
  ["mlb_weather.json", weather.date],
  ["hr_decision_center.json", decision.pitcherDate]
];

for (const [file, actualDate] of expectedDates) {
  if (actualDate !== slateDate) {
    payload.errors.push(`${file} slate date is ${actualDate || "missing"}; expected ${slateDate}`);
  }
}

if (noGamesScheduled) {
  const zeroSlateChecks = [
    ["mlb_player_pool.json", playerPool.availability === "no_games_scheduled" && payload.checks.players === 0],
    ["mlb_home_runs.json", payload.checks.hrBoard === 0],
    ["game_pitcher_matchups.json", matchups.availability === "no_games_scheduled" && payload.checks.matchups === 0],
    ["hr_decision_center.json", decision.availability === "no_games_scheduled" && payload.checks.decisionCenter === 0],
    ["mlb_weather.json", payload.checks.weather === 0]
  ];

  for (const [file, valid] of zeroSlateChecks) {
    if (!valid) payload.errors.push(`${file} is not a current empty no-games output`);
  }
}

const sections = decision.sections || {};
for (const [key, value] of Object.entries(sections)) {
  payload.sections[key] = Array.isArray(value)
    ? value.length
    : value && typeof value === "object"
      ? "loaded"
      : 0;
}

if (!noGamesScheduled) {
  if (payload.checks.games <= 0) payload.errors.push("No MLB games loaded");
  if (payload.checks.players <= 0) payload.errors.push("No player pool loaded");
  if (payload.checks.hrBoard <= 0) payload.errors.push("No HR board loaded");
  if (payload.checks.matchups <= 0) payload.errors.push("No matchup data loaded");
  if (payload.checks.decisionCenter <= 0) payload.errors.push("Decision Center empty");
  if (payload.checks.weather <= 0) payload.errors.push("No weather data loaded");
}

if (payload.errors.length) {
  payload.status = "error";
  payload.label = "CHECK";
}

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log("MLB health status built:", OUT);
console.log(payload.status.toUpperCase(), payload.checks);
