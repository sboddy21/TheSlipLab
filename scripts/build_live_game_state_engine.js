import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const WEBSITE_DATA = path.join(ROOT, "website/data");

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
  if (Array.isArray(payload.weather)) return payload.weather;
  if (Array.isArray(payload.stacks)) return payload.stacks;
  if (Array.isArray(payload.alerts)) return payload.alerts;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.teams)) return payload.teams;
  return [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(value = "") {
  return String(value)
    .replace(/\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function leverageLabel(score) {
  if (score >= 90) return "MAXIMUM LEVERAGE";
  if (score >= 75) return "HIGH LEVERAGE";
  if (score >= 60) return "VOLATILE";
  if (score >= 45) return "ACTIVE";
  return "STABLE";
}

function hrEnvironment(score) {
  if (score >= 90) return "LIVE HR EXPLOSION";
  if (score >= 75) return "HR CHAIN REACTION";
  if (score >= 60) return "HR WATCH";
  if (score >= 45) return "MODERATE";
  return "QUIET";
}

console.log("LIVE GAME STATE ENGINE");
console.log("======================");

const games = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_games_today.json"), [])
);

const bullpen = toArray(
  readJSON(path.join(WEBSITE_DATA, "bullpen_collapse_engine.json"), [])
);

const stackPayload = readJSON(
  path.join(WEBSITE_DATA, "team_stack_intelligence_2.json"),
  []
);

const stacks = toArray(stackPayload);

const weather = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_weather.json"), [])
);

const bullpenMap = {};
for (const row of bullpen) {
  bullpenMap[normalize(row.team || row.Team)] = row;
}

const weatherMap = {};
for (const row of weather) {
  const home = normalize(
    row.home_team ||
    row.homeTeam ||
    row.home ||
    row.homeTeamName ||
    ""
  );

  const away = normalize(
    row.away_team ||
    row.awayTeam ||
    row.away ||
    row.awayTeamName ||
    ""
  );

  const team = normalize(row.team || row.Team || "");

  if (home) weatherMap[home] = row;
  if (away) weatherMap[away] = row;
  if (team) weatherMap[team] = row;
}

const stackMap = {};
for (const row of stacks) {
  stackMap[normalize(row.team || row.Team)] = row;
}

const output = [];

for (const game of games) {
  const home =
    game.home_team ||
    game.homeTeam ||
    game.home ||
    game.home_name ||
    game.homeTeamName ||
    "";

  const away =
    game.away_team ||
    game.awayTeam ||
    game.away ||
    game.away_name ||
    game.awayTeamName ||
    "";

  if (!home || !away) continue;

  const homeKey = normalize(home);
  const awayKey = normalize(away);

  const homeBullpen = bullpenMap[homeKey] || {};
  const awayBullpen = bullpenMap[awayKey] || {};

  const homeStack = stackMap[homeKey] || {};
  const awayStack = stackMap[awayKey] || {};

  const weatherRow =
    weatherMap[homeKey] ||
    weatherMap[awayKey] ||
    {};

  const weatherBoost =
    num(weatherRow.weather_boost) +
    num(weatherRow.wind_boost) +
    num(weatherRow.park_boost);

  const homePressure = clamp(
    num(awayBullpen.dangerScore) * 0.45 +
      num(homeStack.enhancedStackScore) * 0.4 +
      weatherBoost * 5,
    0,
    100
  );

  const awayPressure = clamp(
    num(homeBullpen.dangerScore) * 0.45 +
      num(awayStack.enhancedStackScore) * 0.4 +
      weatherBoost * 5,
    0,
    100
  );

  const leverageScore = clamp(
    homePressure * 0.5 + awayPressure * 0.5,
    0,
    100
  );

  const chainReactionRisk = clamp(
    leverageScore * 0.55 + weatherBoost * 8,
    0,
    100
  );

  const hrEnvironmentScore = clamp(
    chainReactionRisk * 0.6 + weatherBoost * 10,
    0,
    100
  );

  output.push({
    game: `${away} @ ${home}`,
    homeTeam: home,
    awayTeam: away,
    homePressureScore: Number(homePressure.toFixed(1)),
    awayPressureScore: Number(awayPressure.toFixed(1)),
    leverageScore: Number(leverageScore.toFixed(1)),
    leverageLabel: leverageLabel(leverageScore),
    chainReactionRisk: Number(chainReactionRisk.toFixed(1)),
    hrEnvironmentScore: Number(hrEnvironmentScore.toFixed(1)),
    hrEnvironment: hrEnvironment(hrEnvironmentScore),
    weatherBoost,
    homeBullpenGrade: homeBullpen.grade || "UNKNOWN",
    awayBullpenGrade: awayBullpen.grade || "UNKNOWN",
    homeLateEnvironment: homeStack.lateGameEnvironment || "STABLE",
    awayLateEnvironment: awayStack.lateGameEnvironment || "STABLE",
    inningState: "PREGAME",
    liveAlert:
      leverageScore >= 80
        ? "LIVE EXPLOSION WATCH"
        : leverageScore >= 65
        ? "HIGH VOLATILITY"
        : "NORMAL"
  });
}

output.sort((a, b) => num(b.leverageScore) - num(a.leverageScore));

fs.writeFileSync(
  path.join(WEBSITE_DATA, "live_game_state.json"),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      count: output.length,
      games: output
    },
    null,
    2
  )
);

console.log("");
console.log("LIVE GAME STATE ENGINE COMPLETE");
console.log(`Games: ${output.length}`);

console.table(
  output.slice(0, 10).map(game => ({
    game: game.game,
    leverage: game.leverageScore,
    hr: game.hrEnvironment,
    alert: game.liveAlert
  }))
);

console.log("");
console.log(`Saved: ${path.join(WEBSITE_DATA, "live_game_state.json")}`);
