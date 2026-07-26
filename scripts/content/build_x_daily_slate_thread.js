import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const SITE_CONTENT = path.join(DATA, "content");
const EXPORT_CONTENT = path.join(ROOT, "exports", "content");
const SITE_OUT = path.join(SITE_CONTENT, "x_daily_slate_thread.json");
const JSON_OUT = path.join(EXPORT_CONTENT, "x_daily_slate_thread.json");
const TXT_OUT = path.join(EXPORT_CONTENT, "x_daily_slate_thread.txt");
const BOARD_URL = "https://thesliplab.com/ai-says.html";
const MAX_TWEET_LENGTH = 280;
const MAX_INPUT_AGE_MS = 90 * 60 * 1000;

fs.mkdirSync(SITE_CONTENT, { recursive: true });
fs.mkdirSync(EXPORT_CONTENT, { recursive: true });

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
}

function easternParts(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(value);
  const get = type => parts.find(part => part.type === type)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    displayDate: `${Number(get("month"))}/${Number(get("day"))}`,
    time: `${get("hour")}:${get("minute")} ${get("dayPeriod")}`
  };
}

function normalize(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function teamAbbrev(name = "") {
  const map = {
    "Arizona Diamondbacks": "ARI",
    "Atlanta Braves": "ATL",
    "Baltimore Orioles": "BAL",
    "Boston Red Sox": "BOS",
    "Chicago Cubs": "CHC",
    "Chicago White Sox": "CWS",
    "Cincinnati Reds": "CIN",
    "Cleveland Guardians": "CLE",
    "Colorado Rockies": "COL",
    "Detroit Tigers": "DET",
    "Houston Astros": "HOU",
    "Kansas City Royals": "KC",
    "Los Angeles Angels": "LAA",
    "Los Angeles Dodgers": "LAD",
    "Miami Marlins": "MIA",
    "Milwaukee Brewers": "MIL",
    "Minnesota Twins": "MIN",
    "New York Mets": "NYM",
    "New York Yankees": "NYY",
    Athletics: "ATH",
    "Oakland Athletics": "ATH",
    "Philadelphia Phillies": "PHI",
    "Pittsburgh Pirates": "PIT",
    "San Diego Padres": "SD",
    "San Francisco Giants": "SF",
    "Seattle Mariners": "SEA",
    "St. Louis Cardinals": "STL",
    "Tampa Bay Rays": "TB",
    "Texas Rangers": "TEX",
    "Toronto Blue Jays": "TOR",
    "Washington Nationals": "WSH"
  };
  return map[name] || String(name || "").split(/\s+/).map(part => part[0]).join("").slice(0, 4).toUpperCase();
}

function gameLabel(game) {
  return `${teamAbbrev(game.awayTeam || game.away)} @ ${teamAbbrev(game.homeTeam || game.home)}`;
}

function gameTime(game) {
  const date = new Date(game.gameDate);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value || "";
  return `${get("hour")}:${get("minute")} ${get("dayPeriod")} ET`;
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function one(value) {
  return num(value).toFixed(1).replace(/\.0$/, "");
}

function int(value) {
  return String(Math.round(num(value)));
}

function requireToday(payload, file, field, expectedDate) {
  if (!payload || typeof payload !== "object") throw new Error(`${file} is missing`);
  if (payload[field] !== expectedDate) {
    throw new Error(`${file} ${field} is ${payload[field] || "missing"}; expected ${expectedDate}`);
  }
}

function requireFresh(payload, file, timestampField) {
  const timestamp = payload?.[timestampField];
  const parsed = Date.parse(timestamp);
  const age = Date.now() - parsed;
  if (!timestamp || !Number.isFinite(parsed) || age < 0 || age > MAX_INPUT_AGE_MS) {
    throw new Error(`${file} is outside the ${MAX_INPUT_AGE_MS / 60000}-minute slate-thread window`);
  }
  return { file, timestampField, timestamp, ageSeconds: Math.floor(age / 1000) };
}

function rowsByGame(rows) {
  const map = new Map();
  for (const row of rows) {
    const game = String(row.game || "").trim();
    if (!game) continue;
    if (!map.has(game)) map.set(game, []);
    map.get(game).push(row);
  }
  for (const list of map.values()) {
    list.sort((a, b) =>
      num(b.hrConfidence) - num(a.hrConfidence) ||
      num(b.ceilingScore) - num(a.ceilingScore) ||
      String(a.player).localeCompare(String(b.player))
    );
  }
  return map;
}

function shortPlayer(row, includeScore = true) {
  const score = includeScore ? ` ${one(row.hrConfidence)}` : "";
  return `${row.player}${score}`.trim();
}

function topEnvironmentScore(gameRows) {
  const top = gameRows.slice(0, 5);
  const avgHr = top.reduce((sum, row) => sum + num(row.hrConfidence), 0) / Math.max(1, top.length);
  const bestWeather = Math.max(...top.map(row => num(row.weather)));
  const bestBullpen = Math.max(...top.map(row => num(row.bullpen)));
  const bestPitchEdge = Math.max(...top.map(row => num(row.pitchEdge)));
  return avgHr * 0.58 + bestWeather * 0.12 + bestBullpen * 0.16 + bestPitchEdge * 0.14;
}

function rankedEnvironments(games, grouped) {
  return games
    .map(game => {
      const rows = grouped.get(game.matchup || `${game.awayTeam} at ${game.homeTeam}`) || [];
      return { game, rows, score: topEnvironmentScore(rows) };
    })
    .filter(item => item.rows.length)
    .sort((a, b) => b.score - a.score);
}

function buildMainPost({ today, games, grouped }) {
  const environments = rankedEnvironments(games, grouped);
  const projectedHr = environments.length
    ? environments.reduce((sum, item) => sum + Math.max(1.5, item.score / 20), 0)
    : 0;
  const topEnvironments = environments.slice(0, 5);

  return [
    `${today.displayDate} MLB HR Slate 🧪`,
    "",
    `${games.length} games on the board today.`,
    projectedHr ? `${one(projectedHr)} projected slate HR pressure` : "",
    "",
    "Top HR environments:",
    ...topEnvironments.map(item => `${gameLabel(item.game)} — ${one(item.score)}`),
    "",
    "Game-by-game Slip Lab looks below 👇"
  ].filter(line => line !== "").join("\n");
}

function contextByGame(contextPayload) {
  const map = new Map();
  for (const context of contextPayload?.contexts || []) {
    if (context?.gamePk) map.set(String(context.gamePk), context);
  }
  return map;
}

function valueRows(rows, topIds, marketAvailable) {
  const eligible = rows.filter(row => !topIds.has(String(row.playerId || row.player)));
  if (marketAvailable) {
    const priced = eligible
      .filter(row => row.bestOverPrice)
      .sort((a, b) => num(b.bestOverPrice) - num(a.bestOverPrice) || num(b.hrConfidence) - num(a.hrConfidence));
    if (priced.length) return { label: "Value looks", rows: priced.slice(0, 2) };
  }

  return {
    label: "Sleeper looks",
    rows: eligible
      .sort((a, b) =>
        num(b.ceilingScore) - num(a.ceilingScore) ||
        num(b.volatilityScore) - num(a.volatilityScore) ||
        num(b.hrConfidence) - num(a.hrConfidence)
      )
      .slice(0, 2)
  };
}

function weatherLine(game, contextMap) {
  const context = contextMap.get(String(game.gamePk));
  const weather = context?.weather || {};
  const temp = weather.temp ? `${weather.temp}°` : "";
  const wind = weather.wind && weather.wind !== "0 mph, None" ? weather.wind : "";
  const condition = weather.condition || "";
  const parts = [temp, wind, condition].filter(Boolean);
  return parts.length ? `Weather/park: ${parts.join(" · ")}` : "";
}

function buildGamePost({ game, rows, marketAvailable, contextMap }) {
  const top = rows.slice(0, 3);
  const topIds = new Set(top.map(row => String(row.playerId || row.player)));
  const extras = valueRows(rows, topIds, marketAvailable);
  const pitchers = [
    game.awayProbablePitcher ? `${teamAbbrev(game.awayTeam)}: ${game.awayProbablePitcher}` : "",
    game.homeProbablePitcher ? `${teamAbbrev(game.homeTeam)}: ${game.homeProbablePitcher}` : ""
  ].filter(Boolean).join(" | ");

  const lines = [
    `${gameLabel(game)} (${gameTime(game)})`,
    "",
    "Top HR looks:",
    ...top.map(row => shortPlayer(row)),
    "",
    `${extras.label}:`,
    ...extras.rows.map(row => shortPlayer(row, false)),
    "",
    weatherLine(game, contextMap),
    pitchers,
    BOARD_URL
  ].filter(line => line !== "");

  return fitTweet(lines.join("\n"));
}

function fitTweet(text) {
  if (text.length <= MAX_TWEET_LENGTH) return text;
  let next = text
    .split("\n")
    .filter(line => !line.startsWith("Weather/park:"))
    .join("\n");
  if (next.length <= MAX_TWEET_LENGTH) return next;
  next = next
    .split("\n")
    .filter(line => !line.includes(" | ") || !line.includes(":"))
    .join("\n");
  if (next.length <= MAX_TWEET_LENGTH) return next;
  const lines = next.split("\n");
  while (lines.length && lines.join("\n").length > MAX_TWEET_LENGTH) {
    const index = lines.findIndex(line => line === BOARD_URL);
    if (index > 0) lines.splice(index - 1, 1);
    else lines.splice(Math.max(1, lines.length - 2), 1);
  }
  return lines.join("\n").slice(0, MAX_TWEET_LENGTH);
}

const today = easternParts();
const gamesPayload = readJson("mlb_games_today.json");
const decision = readJson("hr_decision_center.json");
const health = readJson("health_status.json");
const market = readJson("mlb_market_odds.json", {});
const context = readJson("mlb_context_factors.json", {});

requireToday(gamesPayload, "mlb_games_today.json", "date", today.date);
requireToday(decision, "hr_decision_center.json", "pitcherDate", today.date);
if (health?.status !== "healthy" || health?.source !== "mlb_fast_refresh") {
  throw new Error("health_status.json is not a healthy mlb_fast_refresh output");
}

const inputs = [
  requireFresh(gamesPayload, "mlb_games_today.json", "updatedAt"),
  requireFresh(decision, "hr_decision_center.json", "updatedAt"),
  requireFresh(health, "health_status.json", "generatedAt"),
  requireFresh(context, "mlb_context_factors.json", "updatedAt")
];

const games = Array.isArray(gamesPayload.games) ? gamesPayload.games : [];
const rows = Array.isArray(decision.allPlayers) ? decision.allPlayers : [];
if (!games.length) throw new Error("Daily slate thread needs at least one game");
if (!rows.length) throw new Error("Daily slate thread needs Decision Center players");

const grouped = rowsByGame(rows);
const contextMap = contextByGame(context);
const marketAvailable = market?.availability === "available";
const posts = [];

posts.push({
  id: `daily_slate_${today.date}_intro`,
  index: 1,
  type: "daily_slate_intro",
  text: fitTweet(buildMainPost({ today, games, grouped })),
  replyToIndex: null
});

for (const game of [...games].sort((a, b) => Date.parse(a.gameDate) - Date.parse(b.gameDate))) {
  const key = game.matchup || `${game.awayTeam} at ${game.homeTeam}`;
  const gameRows = grouped.get(key) || [];
  if (!gameRows.length) continue;
  posts.push({
    id: `daily_slate_${today.date}_${game.gamePk}`,
    index: posts.length + 1,
    type: "daily_slate_game",
    gamePk: game.gamePk,
    matchup: key,
    text: buildGamePost({ game, rows: gameRows, marketAvailable, contextMap }),
    replyToIndex: 1
  });
}

const payload = {
  updatedAt: new Date().toISOString(),
  date: today.date,
  displayDate: today.displayDate,
  mode: "dry_run_thread_preview",
  source: "The Slip Lab Daily Slate Thread v1",
  boardUrl: BOARD_URL,
  marketAvailable,
  inputValidation: {
    status: "passed",
    maxAgeMinutes: MAX_INPUT_AGE_MS / 60000,
    inputs
  },
  gameCount: games.length,
  postCount: posts.length,
  posts
};

writeJson(SITE_OUT, payload);
writeJson(JSON_OUT, payload);
fs.writeFileSync(TXT_OUT, posts.map(post => `POST ${post.index}/${posts.length} — ${post.type}\n${post.text}`).join("\n\n---\n\n"));

console.log("THE SLIP LAB DAILY SLATE THREAD COMPLETE");
console.log("Date:", payload.date);
console.log("Games:", payload.gameCount);
console.log("Thread posts:", payload.postCount);
console.log("Market available:", payload.marketAvailable);
console.log("Saved:", SITE_OUT);
console.log("Saved:", TXT_OUT);
