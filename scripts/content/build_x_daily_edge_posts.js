import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const SITE_CONTENT = path.join(DATA, "content");
const EXPORT_CONTENT = path.join(ROOT, "exports", "content");
const SITE_OUT = path.join(SITE_CONTENT, "x_daily_edge_posts.json");
const JSON_OUT = path.join(EXPORT_CONTENT, "x_daily_edge_posts.json");
const TXT_OUT = path.join(EXPORT_CONTENT, "x_daily_edge_posts.txt");
const BOARD_URL = "https://thesliplab.com/ai-says.html";
const WEATHER_URL = "https://thesliplab.com/weather.html";
const MAX_POST_LENGTH = 280;
const MAX_INPUT_AGE_MS = 180 * 60 * 1000;

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
    throw new Error(`${file} is outside the ${MAX_INPUT_AGE_MS / 60000}-minute daily-edge window`);
  }
  return { file, timestampField, timestamp, ageSeconds: Math.floor(age / 1000) };
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

function gameLabelFromNames(away, home) {
  return `${teamAbbrev(away)} @ ${teamAbbrev(home)}`;
}

function fitPost(text) {
  if (text.length <= MAX_POST_LENGTH) return text;
  let next = text
    .split("\n")
    .filter(line => !line.startsWith("Board:") && !line.startsWith("Weather board:"))
    .join("\n");
  if (next.length <= MAX_POST_LENGTH) return next;
  next = next
    .split("\n")
    .filter(line => !line.startsWith("Why:"))
    .join("\n");
  if (next.length <= MAX_POST_LENGTH) return next;
  const lines = next.split("\n");
  while (lines.length && lines.join("\n").length > MAX_POST_LENGTH) {
    lines.splice(Math.max(1, lines.length - 2), 1);
  }
  return lines.join("\n").slice(0, MAX_POST_LENGTH);
}

function rowKey(row) {
  return String(row.playerId || row.mlbId || row.player || "");
}

function powerByPlayer(powerPayload) {
  const map = new Map();
  for (const row of powerPayload?.players || []) {
    map.set(String(row.playerId || ""), row);
  }
  return map;
}

function cardByPlayer(cardPayload) {
  const map = new Map();
  for (const row of cardPayload?.players || []) {
    map.set(String(row.playerId || ""), row);
  }
  return map;
}

function contextByMatchup(contextPayload) {
  const map = new Map();
  for (const context of contextPayload?.contexts || []) {
    const away = context?.teams?.away || "";
    const home = context?.teams?.home || "";
    if (away && home) map.set(`${away} at ${home}`, context);
  }
  return map;
}

function byGame(rows) {
  const map = new Map();
  for (const row of rows) {
    if (!row?.game) continue;
    if (!map.has(row.game)) map.set(row.game, []);
    map.get(row.game).push(row);
  }
  return map;
}

function confirmedOrProjected(row) {
  if (row.confirmedLineup) return "confirmed";
  if (String(row.lineupStatus || "").toUpperCase().includes("CONFIRMED")) return "confirmed";
  return "projected";
}

function topPitcherMatchups(rows) {
  return [...rows]
    .map(row => ({
      row,
      score: num(row.hrConfidence) * 0.42 + num(row.pitchEdge) * 0.28 + num(row.pitcherRisk) * 0.2 + num(row.powerScore) * 0.1
    }))
    .filter(item => num(item.row.pitchEdge) >= 48 && num(item.row.pitcherRisk) >= 32)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(item => item.row);
}

function topMeatballs(rows) {
  return [...rows]
    .map(row => ({
      row,
      score:
        num(row.zoneOverlap) * 0.34 +
        num(row.pitcherLeak) * 0.26 +
        num(row.hitterZonePower) * 0.14 +
        num(row.hotZoneCount) * 3.5 +
        num(row.hrConfidence) * 0.18 +
        num(row.powerScore) * 0.08
    }))
    .filter(item =>
      item.row.zoneSignalAvailable &&
      num(item.row.zoneOverlap) >= 32 &&
      num(item.row.hotZoneCount) >= 1 &&
      num(item.row.hrConfidence) >= 42 &&
      num(item.row.powerScore) >= 48
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map(item => item.row);
}

function topHardestSwings(rows, powerMap, cardMap) {
  return [...rows]
    .map(row => {
      const power = powerMap.get(rowKey(row)) || {};
      const card = cardMap.get(rowKey(row)) || {};
      const last7 = card.last7 || {};
      const score =
        num(power.hrPowerIndex || row.powerScore) * 0.36 +
        num(power.contactDamageScore || card.model?.barrelScore) * 0.24 +
        num(power.launchPowerScore || card.model?.hardHitScore) * 0.18 +
        num(last7.slg) * 16 +
        num(last7.hr) * 2.5;
      return { row, power, card, last7, score };
    })
    .filter(item => num(item.power.hrPowerIndex || item.row.powerScore) >= 55 && num(item.last7?.games) >= 5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function topWeatherGames(rows, contextMap) {
  const grouped = byGame(rows);
  const games = [];
  for (const [game, gameRows] of grouped.entries()) {
    const context = contextMap.get(game);
    const weather = context?.weather || {};
    const temp = num(weather.temp);
    const wind = String(weather.wind || "");
    const condition = String(weather.condition || "");
    const weatherScore =
      (temp >= 85 ? 10 : temp >= 78 ? 6 : 0) +
      (/out to/i.test(wind) ? 10 : /r to l|l to r/i.test(wind) ? 4 : 0) +
      (/sunny|partly/i.test(condition) ? 3 : 0) -
      (/roof closed|dome/i.test(condition) ? 8 : 0);
    if (weatherScore <= 0) continue;
    const top = [...gameRows].sort((a, b) => num(b.hrConfidence) - num(a.hrConfidence)).slice(0, 2);
    games.push({ game, context, weather, weatherScore, top });
  }
  return games.sort((a, b) => b.weatherScore - a.weatherScore).slice(0, 2);
}

function playerLine(row, metric) {
  return `${row.player} — ${metric}`;
}

function buildPitcherPost(today, picks) {
  const lines = [
    `🧪 ${today.displayDate} Pitcher Matchup Edges`,
    "",
    ...picks.map(row => playerLine(row, `${one(row.pitchEdge)} pitch edge vs ${row.opposingPitcher || "listed SP"}`)),
    "",
    "Why: HR score + pitch edge + pitcher risk all stack.",
    `Board: ${BOARD_URL}`
  ];
  return fitPost(lines.join("\n"));
}

function buildMeatballPost(today, picks) {
  const lines = [
    `🍝 ${today.displayDate} Meatball Watch`,
    "",
    ...picks.map(row => playerLine(row, `${one(row.zoneOverlap)} zone overlap · ${int(row.hotZoneCount)} hot zones`)),
    "",
    "These are bats whose damage zones line up with pitcher leak zones.",
    `Board: ${BOARD_URL}`
  ];
  return fitPost(lines.join("\n"));
}

function buildHardSwingPost(today, picks) {
  const lines = [
    `💥 ${today.displayDate} Hardest Swing Watch`,
    "",
    ...picks.map(item => {
      const last7 = item.last7?.games ? `L7 .${String(Math.round(num(item.last7.slg) * 1000)).padStart(3, "0")} SLG` : "power form";
      return playerLine(item.row, `${one(item.power.hrPowerIndex || item.row.powerScore)} power · ${last7}`);
    }),
    "",
    "Power profile + contact damage + recent slug.",
    `Board: ${BOARD_URL}`
  ];
  return fitPost(lines.join("\n"));
}

function buildWeatherPost(today, games) {
  const lines = [`🌤️ ${today.displayDate} Weather Carry Boost`, ""];
  for (const item of games) {
    const [away, home] = item.game.split(" at ");
    const weather = item.weather || {};
    const details = [weather.temp ? `${weather.temp}°` : "", weather.wind && weather.wind !== "0 mph, None" ? weather.wind : "", weather.condition || ""]
      .filter(Boolean)
      .join(" · ");
    lines.push(`${gameLabelFromNames(away, home)} — ${details}`);
    lines.push(`Bats: ${item.top.map(row => row.player).join(", ")}`);
  }
  lines.push("", `Weather board: ${WEATHER_URL}`);
  return fitPost(lines.join("\n"));
}

function post(id, type, text, meta = {}) {
  return {
    id,
    type,
    slot: "daily_edge",
    status: "dry_run",
    dryRun: true,
    text,
    posted: false,
    posted_at: null,
    x_post_id: null,
    created_at: new Date().toISOString(),
    ...meta
  };
}

const today = easternParts();
const decision = readJson("hr_decision_center.json");
const power = readJson("hr_power_profiles.json");
const cards = readJson("player_card_data.json");
const context = readJson("mlb_context_factors.json");
const health = readJson("health_status.json");

requireToday(decision, "hr_decision_center.json", "pitcherDate", today.date);
requireToday(context, "mlb_context_factors.json", "date", today.date);
if (health?.status !== "healthy" || health?.source !== "mlb_fast_refresh") {
  throw new Error("health_status.json is not a healthy mlb_fast_refresh output");
}

const inputs = [
  requireFresh(decision, "hr_decision_center.json", "updatedAt"),
  requireFresh(power, "hr_power_profiles.json", "generatedAt"),
  requireFresh(cards, "player_card_data.json", "updatedAt"),
  requireFresh(context, "mlb_context_factors.json", "updatedAt"),
  requireFresh(health, "health_status.json", "generatedAt")
];

const rows = Array.isArray(decision.allPlayers) ? decision.allPlayers : [];
const powerMap = powerByPlayer(power);
const cardMap = cardByPlayer(cards);
const contextMap = contextByMatchup(context);

if (!rows.length) throw new Error("Daily edge posts need Decision Center rows");

const pitcherPicks = topPitcherMatchups(rows);
const meatballPicks = topMeatballs(rows);
const swingPicks = topHardestSwings(rows, powerMap, cardMap);
const weatherGames = topWeatherGames(rows, contextMap);
const posts = [];

if (pitcherPicks.length) {
  posts.push(post(`daily_edge_${today.date}_pitcher_matchups`, "pitcher_matchup_edges", buildPitcherPost(today, pitcherPicks), {
    players: pitcherPicks.map(row => row.player),
    signals: pitcherPicks.map(row => ({
      player: row.player,
      pitcher: row.opposingPitcher || null,
      game: row.game,
      lineup: confirmedOrProjected(row),
      hrConfidence: num(row.hrConfidence),
      pitchEdge: num(row.pitchEdge),
      pitcherRisk: num(row.pitcherRisk)
    }))
  }));
}

if (meatballPicks.length) {
  posts.push(post(`daily_edge_${today.date}_meatball_watch`, "meatball_watch", buildMeatballPost(today, meatballPicks), {
    players: meatballPicks.map(row => row.player),
    signals: meatballPicks.map(row => ({
      player: row.player,
      game: row.game,
      zoneOverlap: num(row.zoneOverlap),
      hitterZonePower: num(row.hitterZonePower),
      pitcherLeak: num(row.pitcherLeak),
      hotZoneCount: num(row.hotZoneCount)
    }))
  }));
}

if (swingPicks.length) {
  posts.push(post(`daily_edge_${today.date}_hardest_swings`, "hardest_swing_watch", buildHardSwingPost(today, swingPicks), {
    players: swingPicks.map(item => item.row.player),
    signals: swingPicks.map(item => ({
      player: item.row.player,
      game: item.row.game,
      hrPowerIndex: num(item.power.hrPowerIndex || item.row.powerScore),
      contactDamageScore: num(item.power.contactDamageScore),
      launchPowerScore: num(item.power.launchPowerScore),
      last7: item.last7 || null
    }))
  }));
}

if (weatherGames.length) {
  posts.push(post(`daily_edge_${today.date}_weather_carry`, "weather_carry_boost", buildWeatherPost(today, weatherGames), {
    games: weatherGames.map(item => ({
      game: item.game,
      weatherScore: item.weatherScore,
      weather: item.weather,
      players: item.top.map(row => row.player)
    }))
  }));
}

const payload = {
  updatedAt: new Date().toISOString(),
  date: today.date,
  displayDate: today.displayDate,
  mode: "dry_run_daily_edge_posts",
  source: "The Slip Lab Daily Edge Posts v1",
  postingEnabled: false,
  dryRun: true,
  inputValidation: {
    status: "passed",
    maxAgeMinutes: MAX_INPUT_AGE_MS / 60000,
    inputs
  },
  count: posts.length,
  posts
};

writeJson(SITE_OUT, payload);
writeJson(JSON_OUT, payload);
fs.writeFileSync(TXT_OUT, posts.map((item, index) => `POST ${index + 1}/${posts.length} — ${item.type}\n${item.text}`).join("\n\n---\n\n"));

console.log("THE SLIP LAB DAILY EDGE POSTS COMPLETE");
console.log("Date:", payload.date);
console.log("Posts:", payload.count);
console.log("Saved:", SITE_OUT);
console.log("Saved:", TXT_OUT);
