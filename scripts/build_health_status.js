import fs from "fs";
import path from "path";
import { isFreshForRefresh } from "./mlb/refresh_freshness.mjs";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const OUT = path.join(DATA, "health_status.json");
const MAX_REFRESH_AGE_MS = 15 * 60 * 1000;
const MAX_MODEL_AGE_MS = 70 * 60 * 1000;
const CLOCK_TOLERANCE_MS = 1000;
const requestedState = String(process.env.SL_HEALTH_STATE || "").trim().toLowerCase();
const requestedRefreshStart = Number(process.env.MLB_REFRESH_STARTED_AT);
const refreshStartedAt = Number.isFinite(requestedRefreshStart) && requestedRefreshStart > 0
  ? requestedRefreshStart
  : null;

function previousSuccessfulAt() {
  try {
    if (!fs.existsSync(OUT)) return null;
    const previous = JSON.parse(fs.readFileSync(OUT, "utf8"));
    const value = previous.monitoring?.lastSuccessfulAt
      || (previous.status === "healthy" ? previous.generatedAt : null);
    return Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

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

function timestampDetails(artifact, fields) {
  for (const field of fields) {
    const value = artifact.data?.[field];
    if (!value) continue;
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return { timestamp, field };
  }

  if (!fields.length && Number.isFinite(artifact.mtimeMs)) {
    return { timestamp: artifact.mtimeMs, field: "filesystem.mtime" };
  }

  return { timestamp: NaN, field: null };
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

const artifactDefinitions = {
  games: { timestampFields: ["updatedAt"], countKeys: ["games"], dateField: "date", required: true },
  playerPool: { timestampFields: ["updatedAt"], countKeys: ["players"], dateField: "date", required: true },
  hrBoard: { timestampFields: [], countKeys: ["players", "rows"], dateField: "date", required: true, cadence: "model" },
  matchups: { timestampFields: ["updatedAt"], countKeys: ["games"], dateField: "date", required: true, cadence: "model" },
  decision: { timestampFields: ["updatedAt"], countKeys: ["allPlayers"], dateField: "pitcherDate", required: true },
  weather: { timestampFields: ["updatedAt"], countKeys: ["games", "weather"], dateField: "date", required: true },
  results: { timestampFields: ["generatedAt", "updatedAt"], countKeys: ["homeRuns", "results"], dateField: "date", required: false }
};

const games = artifacts.games.data || {};
const playerPool = artifacts.playerPool.data || {};
const hrBoard = artifacts.hrBoard.data || {};
const matchups = artifacts.matchups.data || {};
const decision = artifacts.decision.data || {};
const weather = artifacts.weather.data || {};
const results = artifacts.results.data || {};
const generatedAt = new Date().toISOString();
const generatedAtMs = Date.parse(generatedAt);
const priorSuccessfulAt = previousSuccessfulAt();
const slateDate = todayEastern();
const scheduledGames = Array.isArray(games.games) ? games.games : [];
const noGamesScheduled = games.date === slateDate && scheduledGames.length === 0;

const productionArtifacts = [
  [artifacts.games, ["updatedAt"], "live"],
  [artifacts.playerPool, ["updatedAt"], "live"],
  [artifacts.hrBoard, [], "model"],
  [artifacts.matchups, ["updatedAt"], "model"],
  [artifacts.decision, ["updatedAt"], "live"],
  [artifacts.weather, ["updatedAt"], "live"]
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
  slateDate,
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
  artifacts: {},
  monitoring: {
    state: noGamesScheduled ? "closed" : "live",
    checkedAt: generatedAt,
    lastSuccessfulAt: generatedAt,
    freshUntil: new Date(generatedAtMs + MAX_REFRESH_AGE_MS).toISOString(),
    refreshWindowSeconds: Math.round(MAX_REFRESH_AGE_MS / 1000),
    productionAgeSeconds: null,
    refreshStartedAt: Number.isFinite(refreshStartedAt) ? new Date(refreshStartedAt).toISOString() : null,
    refreshDurationSeconds: Number.isFinite(refreshStartedAt)
      ? Math.max(0, Math.round((generatedAtMs - refreshStartedAt) / 1000))
      : null
  },
  delays: [],
  errors: []
};

for (const artifact of Object.values(artifacts)) {
  if (artifact.error && artifact !== artifacts.results) payload.errors.push(artifact.error);
}

const gamesAnchor = Date.parse(games.updatedAt);
if (!Number.isFinite(gamesAnchor)) {
  payload.errors.push("mlb_games_today.json has no valid updatedAt");
} else {
  payload.monitoring.productionAgeSeconds = Math.max(0, Math.round((generatedAtMs - gamesAnchor) / 1000));
  if (!isFreshForRefresh({ timestamp: gamesAnchor, generatedAt: generatedAtMs, maxAgeMs: MAX_REFRESH_AGE_MS, refreshStartedAt, toleranceMs: CLOCK_TOLERANCE_MS })) {
    payload.delays.push("MLB production chain is older than 15 minutes");
  }

  if (gamesAnchor > generatedAtMs + CLOCK_TOLERANCE_MS) {
    payload.errors.push("mlb_games_today.json updatedAt is in the future");
  }

  for (const [artifact, fields, cadence] of productionArtifacts) {
    const timestamp = embeddedTimestamp(artifact, fields);
    const maxAge = cadence === "model" ? MAX_MODEL_AGE_MS : MAX_REFRESH_AGE_MS;
    if (!Number.isFinite(timestamp)) {
      payload.errors.push(`${artifact.file} has no valid ${fields.join(" or ") || "filesystem timestamp"}`);
    } else if (cadence === "live" && timestamp < gamesAnchor - CLOCK_TOLERANCE_MS) {
      payload.errors.push(`${artifact.file} predates the current production chain`);
    } else if (!isFreshForRefresh({ timestamp, generatedAt: generatedAtMs, maxAgeMs: maxAge, refreshStartedAt, toleranceMs: CLOCK_TOLERANCE_MS })) {
      payload.errors.push(`${artifact.file} exceeded its ${cadence} refresh window`);
    } else if (timestamp > generatedAtMs + CLOCK_TOLERANCE_MS) {
      payload.errors.push(`${artifact.file} timestamp is in the future`);
    }
  }
}

for (const [key, definition] of Object.entries(artifactDefinitions)) {
  const artifact = artifacts[key];
  const details = timestampDetails(artifact, definition.timestampFields);
  const ageSeconds = Number.isFinite(details.timestamp)
    ? Math.round((generatedAtMs - details.timestamp) / 1000)
    : null;
  let freshness = "current";
  const maxAge = definition.cadence === "model" ? MAX_MODEL_AGE_MS : MAX_REFRESH_AGE_MS;

  if (artifact.error) freshness = "missing";
  else if (!Number.isFinite(details.timestamp)) freshness = "invalid";
  else if (details.timestamp > generatedAtMs + CLOCK_TOLERANCE_MS) freshness = "future";
  else if (definition.required && definition.cadence !== "model" && Number.isFinite(gamesAnchor) && details.timestamp < gamesAnchor - CLOCK_TOLERANCE_MS) freshness = "stale_chain";
  else if (!isFreshForRefresh({ timestamp: details.timestamp, generatedAt: generatedAtMs, maxAgeMs: maxAge, refreshStartedAt, toleranceMs: CLOCK_TOLERANCE_MS })) freshness = "delayed";

  payload.artifacts[key] = {
    file: artifact.file,
    required: definition.required,
    timestamp: Number.isFinite(details.timestamp) ? new Date(details.timestamp).toISOString() : null,
    timestampField: details.field,
    ageSeconds,
    maxAgeSeconds: maxAge / 1000,
    rowCount: count(artifact.data, definition.countKeys),
    slateDate: artifact.data?.[definition.dateField] || null,
    freshness
  };
}

// A newly written health file must not extend the lifetime of its source inputs.
const sourceDeadlines = Object.values(payload.artifacts)
  .filter(artifact => artifact.required && Number.isFinite(Date.parse(artifact.timestamp)))
  .map(artifact => Date.parse(artifact.timestamp) + artifact.maxAgeSeconds * 1000);
if (sourceDeadlines.length) {
  const deadline = Math.min(generatedAtMs + MAX_REFRESH_AGE_MS, ...sourceDeadlines);
  payload.monitoring.freshUntil = new Date(deadline).toISOString();
  if (deadline <= generatedAtMs) payload.delays.push("Required source inputs expired before publication; refresh them before claiming live data");
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
  payload.monitoring.state = "check";
  payload.monitoring.lastSuccessfulAt = priorSuccessfulAt;
} else if (payload.delays.length) {
  payload.status = "delayed";
  payload.label = "DELAYED";
  payload.monitoring.state = "delayed";
  payload.monitoring.lastSuccessfulAt = priorSuccessfulAt;
}

if (requestedState === "updating") {
  payload.status = "updating";
  payload.label = "UPDATING";
  payload.monitoring.state = "updating";
  payload.monitoring.lastSuccessfulAt = priorSuccessfulAt;
}

fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
console.log("MLB health status built:", OUT);
console.log(payload.status.toUpperCase(), payload.checks);
