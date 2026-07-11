import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const MINUTES_FILE = path.join(ROOT, "website/data/nba_minutes_engine.json");
const USAGE_FILE = path.join(ROOT, "website/data/nba_usage_engine.json");
const OUT = path.join(ROOT, "website/data/nba_assists.json");

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

function playGrade(score) {
  const s = Number(score) || 0;

  if (s >= 90) return "ELITE PLAY";
  if (s >= 80) return "STRONG PLAY";
  if (s >= 70) return "GOOD PLAY";
  if (s >= 60) return "WATCH LIST";

  return "AVOID";
}

function confidenceTier(score) {
  if (score >= 88) return "Elite";
  if (score >= 76) return "Strong";
  if (score >= 64) return "Playable";
  if (score >= 52) return "Watch";
  return "Low";
}

function assistRole(lean) {
  if (lean >= 8) return "Primary Playmaker";
  if (lean >= 6) return "Strong Playmaker";
  if (lean >= 4) return "Useful Facilitator";
  if (lean >= 2.5) return "Low Assist Role";
  return "Thin Assist Role";
}

function positionBoost(position) {
  const p = String(position || "").toUpperCase();
  if (p === "PG") return 8;
  if (p === "SG") return 4;
  if (p === "SF") return 2;
  return 0;
}

function buildRow(p, minuteRow, usageRow) {
  const season = num(p.profile?.seasonAssists ?? p.history?.season?.assists);
  const last5 = num(p.profile?.last5Assists ?? p.history?.last5?.assists);
  const last10 = num(p.profile?.last10Assists ?? p.history?.last10?.assists);

  const expectedMinutes = num(minuteRow?.expectedMinutes ?? p.minutes?.expected ?? p.profile?.seasonMinutes);
  const minutesConfidence = num(minuteRow?.minutesConfidence ?? p.minutes?.confidence);
  const minutesRole = minuteRow?.role || p.minutes?.role || "";

  const usageScore = num(usageRow?.usageScore ?? p.usage?.score);
  const usageTrend = usageRow?.usageTrend || p.usage?.trend || "";
  const assistTrend = num(usageRow?.assistTrend ?? (last5 - season));

  const assistsLean = round1(season * 0.42 + last5 * 0.36 + last10 * 0.22);
  const trendDiff = round1(last5 - season);

  const base = clamp((assistsLean / 10) * 46, 0, 46);
  const form = clamp(((last5 * 0.65 + last10 * 0.35) / 10) * 18, 0, 18);
  const mins = clamp((expectedMinutes / 36) * 13, 0, 13);
  const usage = clamp((usageScore / 100) * 9, 0, 9);
  const conf = clamp((minutesConfidence / 100) * 5, 0, 5);
  const trend = clamp((trendDiff / 3) * 5, -5, 5);
  const pos = positionBoost(p.position);

  const assistsScore = round1(clamp(base + form + mins + usage + conf + trend + pos));

  const tags = [
    p.starter ? "Starter" : "Bench",
    minutesRole,
    assistRole(assistsLean),
    trendDiff >= 1.5 ? "Assists Trending Up" : "",
    trendDiff <= -1.5 ? "Assists Trending Down" : "",
    usageTrend === "Usage Spike" ? "Usage Spike" : "",
    usageTrend === "Usage Up" ? "Usage Up" : "",
    expectedMinutes >= 30 ? "Stable Minutes" : "",
    String(p.position || "").toUpperCase() === "PG" ? "Guard Creation Profile" : ""
  ].filter(Boolean);

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
    gameStatusText: p.gameStatusText,

    seasonAssists: round1(season),
    last5Assists: round1(last5),
    last10Assists: round1(last10),
    assistsLean,
    trendDiff,

    expectedMinutes: round1(expectedMinutes),
    minutesConfidence: round1(minutesConfidence),
    minutesRole,

    usageScore: round1(usageScore),
    usageTrend,
    assistTrend: round1(assistTrend),

    assistsScore,
    confidence: confidenceTier(assistsScore),
    playGrade: playGrade(assistsScore),
    assistRole: assistRole(assistsLean),
    tags: [...new Set(tags)].slice(0, 8)
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const minutes = readJSON(MINUTES_FILE, { players: [] });
  const usage = readJSON(USAGE_FILE, { players: [] });

  const players = Array.isArray(core.players) ? core.players : [];
  const minutesMap = byId(minutes.players);
  const usageMap = byId(usage.players);

  const rows = players
    .map(p => buildRow(p, minutesMap.get(String(p.playerId)) || {}, usageMap.get(String(p.playerId)) || {}))
    .filter(r => String(r.status || "").toUpperCase() === "ACTIVE")
    .sort((a, b) =>
      b.assistsScore - a.assistsScore ||
      b.assistsLean - a.assistsLean ||
      b.expectedMinutes - a.expectedMinutes ||
      String(a.player).localeCompare(String(b.player))
    )
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));

  const out = {
    sport: "NBA",
    market: "Assists",
    version: "1.0",
    source: "nba_core plus nba_minutes_engine plus nba_usage_engine",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    season: core.season || "",
    gameCount: core.gameCount || 0,
    playerCount: rows.length,
    availability: Number(core.gameCount || 0) > 0 ? "games_scheduled" : "no_games_scheduled",
    modelNotes: [
      "Assists Board 1.0 uses season assists, last 5 assists, last 10 assists, expected minutes, minutes confidence, usage, position role, and recent assist trend.",
      "No odds or betting lines are used."
    ],
    players: rows
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA ASSISTS BOARD COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA ASSISTS BOARD FAILED");
  console.error(err);
  process.exit(1);
});
