import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const OUT = path.join(ROOT, "website/data/nba_points.json");
const MINUTES_FILE = path.join(ROOT, "website/data/nba_minutes_engine.json");
const USAGE_FILE = path.join(ROOT, "website/data/nba_usage_engine.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readExisting() {
  try {
    return JSON.parse(fs.readFileSync(OUT, "utf8"));
  } catch {
    return null;
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

function confidenceTier(score) {
  if (score >= 90) return "Elite";
  if (score >= 80) return "Strong";
  if (score >= 70) return "Playable";
  if (score >= 58) return "Watch";
  return "Low";
}

function scoringRole(pointsLean) {
  if (pointsLean >= 28) return "Primary Scorer";
  if (pointsLean >= 22) return "Strong Scorer";
  if (pointsLean >= 16) return "Secondary Scorer";
  if (pointsLean >= 10) return "Low Volume Scorer";
  return "Thin Points Role";
}

function uniqueTags(tags) {
  return tags
    .filter(Boolean)
    .map(String)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 9);
}

function buildPointsScore({ pointsLean, season, last5, last10, minutes, minutesConfidence, usageScore, trendDiff, fgaTrend, ftaTrend, starter }) {
  const basePoints = clamp((pointsLean / 32) * 42, 0, 42);
  const seasonFloor = clamp((season / 28) * 12, 0, 12);
  const form = clamp(((last5 * 0.65 + last10 * 0.35) / 32) * 16, 0, 16);
  const minuteScore = clamp((minutes / 36) * 14, 0, 14);
  const usage = clamp((usageScore / 100) * 10, 0, 10);
  const trend = clamp((trendDiff / 8) * 4, -4, 4);
  const volumeTrend = clamp(((fgaTrend * 0.7 + ftaTrend * 0.3) / 5) * 3, -3, 3);
  const starterBoost = starter ? 2 : 0;
  const confidenceBoost = minutesConfidence >= 90 ? 1.5 : minutesConfidence >= 75 ? 0.8 : 0;

  return round1(clamp(basePoints + seasonFloor + form + minuteScore + usage + trend + volumeTrend + starterBoost + confidenceBoost));
}

function buildRow(p, minutesMap, usageMap) {
  const minuteRow = minutesMap.get(String(p.playerId)) || minutesMap.get(String(p.player)) || {};
  const usageRow = usageMap.get(String(p.playerId)) || usageMap.get(String(p.player)) || {};
  const season = num(p.profile?.seasonPoints ?? p.history?.season?.points);
  const last5 = num(p.profile?.last5Points ?? p.history?.last5?.points);
  const last10 = num(p.profile?.last10Points ?? p.history?.last10?.points);

  const minutes = num(minuteRow.expectedMinutes ?? p.minutes?.expected ?? p.profile?.seasonMinutes ?? p.history?.season?.minutes);
  const minutesConfidence = num(minuteRow.minutesConfidence ?? p.minutes?.confidence);
  const usageScore = num(usageRow.usageScore ?? p.usage?.score);

  const seasonFGA = num(usageRow.seasonFGA ?? p.usage?.seasonFGA ?? p.profile?.seasonFGA ?? p.history?.season?.fieldGoalAttempts);
  const last5FGA = num(usageRow.last5FGA ?? p.usage?.last5FGA ?? p.profile?.last5FGA ?? p.history?.last5?.fieldGoalAttempts);
  const seasonFTA = num(usageRow.seasonFTA ?? p.usage?.seasonFTA ?? p.profile?.seasonFTA ?? p.history?.season?.freeThrowAttempts);
  const last5FTA = num(usageRow.last5FTA ?? p.usage?.last5FTA ?? p.profile?.last5FTA ?? p.history?.last5?.freeThrowAttempts);

  const pointsLean = round1(
    season * 0.40 +
    last5 * 0.38 +
    last10 * 0.22
  );

  const trendDiff = round1(last5 - season);
  const fgaTrend = round1(last5FGA - seasonFGA);
  const ftaTrend = round1(last5FTA - seasonFTA);

  const pointsScore = buildPointsScore({
    pointsLean,
    season,
    last5,
    last10,
    minutes,
    minutesConfidence,
    usageScore,
    trendDiff,
    fgaTrend,
    ftaTrend,
    starter: Boolean(p.starter)
  });

  const tags = uniqueTags([
    ...(Array.isArray(p.tags) ? p.tags : []),
    scoringRole(pointsLean),
    trendDiff >= 4 ? "Scoring Form Up" : "",
    trendDiff <= -4 ? "Scoring Form Down" : "",
    fgaTrend >= 3 ? "Shot Volume Up" : "",
    ftaTrend >= 2 ? "Free Throw Volume Up" : "",
    minutes >= 34 ? "Heavy Minutes" : "",
    minutes >= 30 && minutes < 34 ? "Stable Minutes" : "",
    usageScore >= 85 ? "Elite Usage" : "",
    usageScore >= 70 && usageScore < 85 ? "High Usage" : "",
    usageScore >= 55 && usageScore < 70 ? "Strong Usage" : "",
    usageRow.usageTrend === "Usage Spike" ? "Usage Spike" : "",
    usageRow.volumeTrend >= 5 ? "Volume Acceleration" : "",
    p.starter ? "Starter" : ""
  ]);

  return {
    playerId: p.playerId,
    player: p.player,
    team: p.teamAbbr || p.team,
    opponent: p.opponentAbbr || p.opponent,
    position: p.position,
    homeAway: p.homeAway,
    starter: Boolean(p.starter),
    status: p.status,
    gameId: p.gameId,
    gameTimeUTC: p.gameTimeUTC,
    gameStatus: p.gameStatus,
    gameStatusText: p.gameStatusText,

    seasonPoints: round1(season),
    last5Points: round1(last5),
    last10Points: round1(last10),
    pointsLean,
    trendDiff,

    seasonFGA: round1(seasonFGA),
    last5FGA: round1(last5FGA),
    fgaTrend,
    seasonFTA: round1(seasonFTA),
    last5FTA: round1(last5FTA),
    ftaTrend,

    expectedMinutes: round1(minutes),
    minutesConfidence,
    minutesRole: minuteRow.role || p.minutes?.role || "",
    seasonMinutes: round1(minuteRow.seasonMinutes ?? p.profile?.seasonMinutes ?? p.history?.season?.minutes),
    last5Minutes: round1(minuteRow.last5Minutes ?? p.profile?.last5Minutes ?? p.history?.last5?.minutes),
    last10Minutes: round1(minuteRow.last10Minutes ?? p.profile?.last10Minutes ?? p.history?.last10?.minutes),
    minutesTrend: round1(minuteRow.minutesTrend ?? 0),
    usageScore,
    usageTier: usageRow.usageTier || p.usage?.tier || "",
    usageTrend: usageRow.usageTrend || p.usage?.trend || "",
    volumeTrend: round1(usageRow.volumeTrend ?? 0),
    assistTrend: round1(usageRow.assistTrend ?? 0),

    rawCorePointsScore: num(p.scores?.pointsScore),
    nbaScore: num(p.scores?.nbaScore),
    pointsScore,
    confidence: confidenceTier(pointsScore),
    scoringRole: scoringRole(pointsLean),
    tags
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const minutesPayload = readJSON(MINUTES_FILE, { players: [] });
  const usagePayload = readJSON(USAGE_FILE, { players: [] });

  const players = Array.isArray(core.players) ? core.players : [];
  const minuteRows = Array.isArray(minutesPayload.players) ? minutesPayload.players : [];
  const usageRows = Array.isArray(usagePayload.players) ? usagePayload.players : [];

  const minutesMap = new Map();
  for (const row of minuteRows) {
    if (row.playerId) minutesMap.set(String(row.playerId), row);
    if (row.player) minutesMap.set(String(row.player), row);
  }

  const usageMap = new Map();
  for (const row of usageRows) {
    if (row.playerId) usageMap.set(String(row.playerId), row);
    if (row.player) usageMap.set(String(row.player), row);
  }

  const rows = players
    .map(p => buildRow(p, minutesMap, usageMap))
    .filter(r => String(r.status || "").toUpperCase() === "ACTIVE")
    .sort((a, b) =>
      b.pointsScore - a.pointsScore ||
      b.pointsLean - a.pointsLean ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    )
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));

  const out = {
    sport: "NBA",
    market: "Points",
    version: "1.3",
    source: "nba_core.json",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    season: core.season || "",
    gameCount: core.gameCount || 0,
    playerCount: rows.length,
    modelNotes: [
      "Points Board 1.3 reads from nba_core.json, nba_minutes_engine.json, and nba_usage_engine.json.",
      "Score is normalized to 0-100.",
      "Foundation uses scoring average, last 5 form, last 10 form, enhanced expected minutes, minutes confidence, minutes trend, usage score, usage trend, volume acceleration, shot volume trend, free throw volume trend, and starter status.",
      "No odds or betting lines are used."
    ],
    players: rows
  };

  const existing = readExisting();
const existingPlayers = Array.isArray(existing?.players) ? existing.players : [];

if (rows.length === 0 && existingPlayers.length > 0) {
  fs.writeFileSync(OUT, JSON.stringify({
    ...existing,
    preservedAt: new Date().toISOString(),
    preserveReason: "Points board generated 0 players"
  }, null, 2));

  console.log("POINTS BOARD PRESERVED PREVIOUS DATA");
  return;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA POINTS BOARD COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA POINTS BOARD FAILED");
  console.error(err);
  process.exit(1);
});
