import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const HISTORY_FILE = path.join(ROOT, "website/data/nba_history.json");
const MINUTES_FILE = path.join(ROOT, "website/data/nba_minutes_engine.json");
const OUT = path.join(ROOT, "website/data/nba_usage_engine.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round1(v) {
  return Math.round(num(v) * 10) / 10;
}

function byId(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.playerId) map.set(String(row.playerId), row);
  }
  return map;
}

function usageScore(history, minutes) {
  const season = history?.season || {};
  const last5 = history?.last5 || {};

  const seasonFGA = num(season.fieldGoalAttempts);
  const last5FGA = num(last5.fieldGoalAttempts);
  const seasonFTA = num(season.freeThrowAttempts);
  const last5FTA = num(last5.freeThrowAttempts);
  const seasonAST = num(season.assists);
  const last5AST = num(last5.assists);
  const expectedMinutes = num(minutes?.expectedMinutes);

  let score = 0;

  if (seasonFGA >= 20) score += 35;
  else if (seasonFGA >= 17) score += 30;
  else if (seasonFGA >= 14) score += 24;
  else if (seasonFGA >= 11) score += 17;
  else if (seasonFGA >= 8) score += 10;
  else score += 4;

  if (last5FGA >= seasonFGA + 4) score += 15;
  else if (last5FGA >= seasonFGA + 2) score += 10;
  else if (last5FGA >= seasonFGA + 1) score += 5;

  if (seasonFTA >= 7) score += 12;
  else if (seasonFTA >= 5) score += 9;
  else if (seasonFTA >= 3) score += 5;

  if (last5FTA >= seasonFTA + 2) score += 6;

  if (seasonAST >= 7) score += 10;
  else if (seasonAST >= 5) score += 7;
  else if (seasonAST >= 3) score += 4;

  if (last5AST >= seasonAST + 2) score += 5;

  if (expectedMinutes >= 34) score += 10;
  else if (expectedMinutes >= 30) score += 7;
  else if (expectedMinutes >= 24) score += 4;

  return Math.min(100, Math.round(score));
}

function trendLabel(history) {
  const season = history?.season || {};
  const last5 = history?.last5 || {};

  const fgaDiff = num(last5.fieldGoalAttempts) - num(season.fieldGoalAttempts);
  const ftaDiff = num(last5.freeThrowAttempts) - num(season.freeThrowAttempts);

  if (fgaDiff >= 4 || ftaDiff >= 3) return "Usage Spike";
  if (fgaDiff >= 2 || ftaDiff >= 1.5) return "Usage Up";
  if (fgaDiff <= -4) return "Usage Down";
  return "Stable Usage";
}

function usageTier(score) {
  if (score >= 80) return "Elite Usage";
  if (score >= 65) return "High Usage";
  if (score >= 50) return "Strong Usage";
  if (score >= 35) return "Moderate Usage";
  return "Low Usage";
}

function buildRow(history, minutes) {
  const season = history?.season || {};
  const last5 = history?.last5 || {};
  const last10 = history?.last10 || {};
  const score = usageScore(history, minutes);

  return {
    playerId: history.playerId,
    player: history.player,
    team: history.team,
    opponent: history.opponent,
    position: history.position,
    starter: Boolean(history.starter),
    status: history.status,
    expectedMinutes: num(minutes?.expectedMinutes),
    minutesConfidence: num(minutes?.minutesConfidence),
    seasonFGA: round1(season.fieldGoalAttempts),
    last5FGA: round1(last5.fieldGoalAttempts),
    last10FGA: round1(last10.fieldGoalAttempts),
    seasonFTA: round1(season.freeThrowAttempts),
    last5FTA: round1(last5.freeThrowAttempts),
    last10FTA: round1(last10.freeThrowAttempts),
    seasonAssists: round1(season.assists),
    last5Assists: round1(last5.assists),
    last10Assists: round1(last10.assists),
    usageScore: score,
    usageTier: usageTier(score),
    usageTrend: trendLabel(history),
    tags: [
      usageTier(score),
      trendLabel(history)
    ]
  };
}

async function main() {
  const historyData = readJSON(HISTORY_FILE, { players: [] });
  const minutesData = readJSON(MINUTES_FILE, { players: [] });

  const minutesMap = byId(minutesData.players);
  const historyRows = Array.isArray(historyData.players) ? historyData.players : [];

  const rows = historyRows
    .map(h => buildRow(h, minutesMap.get(String(h.playerId)) || {}))
    .sort((a, b) =>
      b.usageScore - a.usageScore ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    );

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "nba_history plus nba_minutes_engine",
    fetchedAt: new Date().toISOString(),
    date: historyData.date || "",
    season: historyData.season || "",
    playerCount: rows.length,
    modelNotes: [
      "Usage Engine 1.0 uses field goal attempts, free throw attempts, assists, recent usage trend, and expected minutes.",
      "This layer helps separate real offensive engines from low volume rotation players."
    ],
    players: rows
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA USAGE ENGINE COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA USAGE ENGINE FAILED");
  console.error(err);
  process.exit(1);
});
