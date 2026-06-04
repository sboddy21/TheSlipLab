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

function clamp(v, min = 0, max = 100) {
  return Math.max(min, Math.min(max, num(v)));
}

function byId(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (row.playerId) map.set(String(row.playerId), row);
  }
  return map;
}

function usageTrendLabel(volumeTrend, fgaTrend, ftaTrend) {
  if (volumeTrend >= 6 || fgaTrend >= 4 || ftaTrend >= 3) return "Usage Spike";
  if (volumeTrend >= 3 || fgaTrend >= 2 || ftaTrend >= 1.5) return "Usage Up";
  if (volumeTrend <= -5 || fgaTrend <= -4) return "Usage Down";
  return "Stable Usage";
}

function usageTier(score) {
  if (score >= 85) return "Elite Usage";
  if (score >= 70) return "High Usage";
  if (score >= 55) return "Strong Usage";
  if (score >= 40) return "Moderate Usage";
  return "Low Usage";
}

function buildUsageScore({ seasonFGA, last5FGA, seasonFTA, last5FTA, seasonAssists, last5Assists, expectedMinutes, minutesConfidence }) {
  const fgaBase = clamp((seasonFGA / 22) * 38, 0, 38);
  const ftaBase = clamp((seasonFTA / 8) * 14, 0, 14);
  const assistBase = clamp((seasonAssists / 8) * 10, 0, 10);

  const fgaTrend = last5FGA - seasonFGA;
  const ftaTrend = last5FTA - seasonFTA;
  const astTrend = last5Assists - seasonAssists;

  const trendScore = clamp((fgaTrend * 2.8) + (ftaTrend * 2.2) + (astTrend * 1.2), -12, 18);
  const minutesScore = clamp((expectedMinutes / 36) * 14, 0, 14);
  const confidenceScore = clamp((minutesConfidence / 100) * 6, 0, 6);

  return round1(clamp(fgaBase + ftaBase + assistBase + trendScore + minutesScore + confidenceScore));
}

function buildRow(history, minutes) {
  const season = history?.season || {};
  const last5 = history?.last5 || {};
  const last10 = history?.last10 || {};

  const seasonFGA = num(season.fieldGoalAttempts);
  const last5FGA = num(last5.fieldGoalAttempts);
  const last10FGA = num(last10.fieldGoalAttempts);

  const seasonFTA = num(season.freeThrowAttempts);
  const last5FTA = num(last5.freeThrowAttempts);
  const last10FTA = num(last10.freeThrowAttempts);

  const seasonAssists = num(season.assists);
  const last5Assists = num(last5.assists);
  const last10Assists = num(last10.assists);

  const expectedMinutes = num(minutes?.expectedMinutes);
  const minutesConfidence = num(minutes?.minutesConfidence);

  const fgaTrend = round1(last5FGA - seasonFGA);
  const ftaTrend = round1(last5FTA - seasonFTA);
  const assistTrend = round1(last5Assists - seasonAssists);
  const volumeTrend = round1(fgaTrend + ftaTrend + (assistTrend * 0.35));

  const usageScore = buildUsageScore({
    seasonFGA,
    last5FGA,
    seasonFTA,
    last5FTA,
    seasonAssists,
    last5Assists,
    expectedMinutes,
    minutesConfidence
  });

  const trend = usageTrendLabel(volumeTrend, fgaTrend, ftaTrend);
  const tier = usageTier(usageScore);

  const tags = [
    tier,
    trend,
    fgaTrend >= 3 ? "Shot Volume Climbing" : "",
    ftaTrend >= 2 ? "Rim/FT Volume Climbing" : "",
    volumeTrend >= 5 ? "Volume Acceleration" : "",
    expectedMinutes >= 34 ? "Heavy Minutes" : "",
    usageScore >= 85 ? "Primary Offensive Engine" : ""
  ].filter(Boolean);

  return {
    playerId: history.playerId,
    player: history.player,
    team: history.team,
    opponent: history.opponent,
    position: history.position,
    starter: Boolean(history.starter),
    status: history.status,

    expectedMinutes: round1(expectedMinutes),
    minutesConfidence: round1(minutesConfidence),

    seasonFGA: round1(seasonFGA),
    last5FGA: round1(last5FGA),
    last10FGA: round1(last10FGA),
    fgaTrend,

    seasonFTA: round1(seasonFTA),
    last5FTA: round1(last5FTA),
    last10FTA: round1(last10FTA),
    ftaTrend,

    seasonAssists: round1(seasonAssists),
    last5Assists: round1(last5Assists),
    last10Assists: round1(last10Assists),
    assistTrend,

    volumeTrend,
    usageScore,
    usageTier: tier,
    usageTrend: trend,
    tags: [...new Set(tags)]
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
      b.volumeTrend - a.volumeTrend ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    );

  const out = {
    sport: "NBA",
    version: "1.1",
    source: "nba_history plus nba_minutes_engine",
    fetchedAt: new Date().toISOString(),
    date: historyData.date || "",
    season: historyData.season || "",
    playerCount: rows.length,
    modelNotes: [
      "Usage Engine 1.1 uses shot volume, free throw volume, assist involvement, volume acceleration, expected minutes, and minutes confidence.",
      "Usage trend labels are Usage Spike, Usage Up, Stable Usage, and Usage Down.",
      "No odds or betting lines are used."
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
