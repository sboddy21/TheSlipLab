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
  if (Array.isArray(payload.stacks)) return payload.stacks;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.rows)) return payload.rows;
  if (Array.isArray(payload.teams)) return payload.teams;
  return [];
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
  if (score >= 90) return "NUCLEAR";
  if (score >= 80) return "ELITE";
  if (score >= 70) return "STRONG";
  if (score >= 60) return "SOLID";
  if (score >= 50) return "VIABLE";
  return "FADE";
}

function lateEnv(score) {
  if (score >= 85) return "LATE INNING EXPLOSION RISK";
  if (score >= 70) return "HIGH SCORING LATE ENVIRONMENT";
  if (score >= 55) return "VOLATILE";
  return "STABLE";
}

console.log("TEAM STACK INTELLIGENCE 2.0");
console.log("===========================");

const sourceStacks = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_team_stacks.json"), [])
);

const bullpenRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "bullpen_collapse_engine.json"), [])
);

const games = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_games_today.json"), [])
);

const weatherRows = toArray(
  readJSON(path.join(WEBSITE_DATA, "mlb_weather.json"), [])
);

const bullpenMap = {};
for (const row of bullpenRows) {
  bullpenMap[norm(row.team || row.Team)] = row;
}

const opponentMap = {};
for (const game of games) {
  const home =
    game.home_team ||
    game.homeTeam ||
    game.home ||
    game.home_name ||
    "";

  const away =
    game.away_team ||
    game.awayTeam ||
    game.away ||
    game.away_name ||
    "";

  if (home && away) {
    opponentMap[norm(home)] = away;
    opponentMap[norm(away)] = home;
  }
}

const weatherMap = {};
for (const row of weatherRows) {
  const home = row.home_team || row.homeTeam || row.home || "";
  const away = row.away_team || row.awayTeam || row.away || "";

  if (home) weatherMap[norm(home)] = row;
  if (away) weatherMap[norm(away)] = row;
}

const upgraded = [];

for (const stack of sourceStacks) {
  const team =
    stack.team ||
    stack.Team ||
    stack.stackTeam ||
    stack.offense ||
    "";

  if (!team) continue;

  const teamKey = norm(team);

  const opponent =
    stack.opponent ||
    stack.Opponent ||
    stack.pitchingTeam ||
    stack.against ||
    opponentMap[teamKey] ||
    "";

  const opponentKey = norm(opponent);

  const bullpen = bullpenMap[opponentKey] || {};
  const weather = weatherMap[teamKey] || {};

  const baseScore =
    num(stack.stackScore) ||
    num(stack.score) ||
    num(stack.teamStackScore) ||
    num(stack.totalScore) ||
    50;

  const powerScore =
    num(stack.powerScore) ||
    num(stack.hrScore) ||
    num(stack.avgScore) ||
    baseScore;

  const stackSize =
    num(stack.bats) ||
    num(stack.players) ||
    num(stack.stackSize) ||
    0;

  const bullpenDangerScore = num(bullpen.dangerScore);
  const bullpenCollapseScore = num(bullpen.collapseScore);
  const collapseBoost = bullpenDangerScore * 0.24;

  const weatherBoost =
    num(weather.weather_boost) * 4 +
    num(weather.wind_boost) * 4 +
    num(weather.park_boost) * 3;

  const sizeBoost = clamp(stackSize * 1.5, 0, 10);

  const enhancedStackScore = clamp(
    baseScore * 0.62 +
      powerScore * 0.18 +
      collapseBoost +
      weatherBoost +
      sizeBoost,
    0,
    100
  );

  upgraded.push({
    ...stack,
    team,
    opponent,
    stackScore: Number(baseScore.toFixed(1)),
    powerScore: Number(powerScore.toFixed(1)),
    bullpenCollapseScore: Number(bullpenCollapseScore.toFixed(1)),
    bullpenDangerScore: Number(bullpenDangerScore.toFixed(1)),
    bullpenGrade: bullpen.grade || "UNKNOWN",
    collapseBoost: Number(collapseBoost.toFixed(1)),
    weatherBoost: Number(weatherBoost.toFixed(1)),
    lateGameEnvironment: lateEnv(bullpenDangerScore),
    enhancedStackScore: Number(enhancedStackScore.toFixed(1)),
    enhancedGrade: grade(enhancedStackScore)
  });
}

upgraded.sort((a, b) => num(b.enhancedStackScore) - num(a.enhancedStackScore));

const alerts = upgraded.filter(row => num(row.bullpenDangerScore) >= 70);

fs.writeFileSync(
  path.join(WEBSITE_DATA, "team_stack_intelligence_2.json"),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      count: upgraded.length,
      stacks: upgraded
    },
    null,
    2
  )
);

fs.writeFileSync(
  path.join(WEBSITE_DATA, "collapse_alerts.json"),
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      count: alerts.length,
      alerts
    },
    null,
    2
  )
);

console.log("");
console.log("TEAM STACK INTELLIGENCE 2.0 COMPLETE");
console.log(`Stacks Built: ${upgraded.length}`);
console.log(`Collapse Alerts: ${alerts.length}`);

console.table(
  upgraded.slice(0, 12).map(row => ({
    team: row.team,
    opp: row.opponent,
    score: row.enhancedStackScore,
    grade: row.enhancedGrade,
    bullpen: row.bullpenGrade,
    late: row.lateGameEnvironment
  }))
);

console.log("");
console.log(`Saved: ${path.join(WEBSITE_DATA, "team_stack_intelligence_2.json")}`);
console.log(`Saved: ${path.join(WEBSITE_DATA, "collapse_alerts.json")}`);
