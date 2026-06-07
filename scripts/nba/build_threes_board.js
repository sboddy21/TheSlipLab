import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const MINUTES_FILE = path.join(ROOT, "website/data/nba_minutes_engine.json");
const USAGE_FILE = path.join(ROOT, "website/data/nba_usage_engine.json");
const OUT = path.join(ROOT, "website/data/nba_threes.json");

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

function threesRole(lean) {
  if (lean >= 3.3) return "Primary Shooter";
  if (lean >= 2.5) return "Strong Shooter";
  if (lean >= 1.8) return "Useful Shooter";
  if (lean >= 1.0) return "Low Three Role";
  return "Thin Three Role";
}

function buildRow(p, minuteRow, usageRow) {
  const season = num(p.profile?.seasonThrees ?? p.history?.season?.threesMade);
  const last5 = num(p.profile?.last5Threes ?? p.history?.last5?.threesMade);
  const last10 = num(p.profile?.last10Threes ?? p.history?.last10?.threesMade);

  const season3PA = num(p.history?.season?.threesAttempted);
  const last53PA = num(p.history?.last5?.threesAttempted);
  const last103PA = num(p.history?.last10?.threesAttempted);

  const expectedMinutes = num(minuteRow?.expectedMinutes ?? p.minutes?.expected ?? p.profile?.seasonMinutes);
  const minutesConfidence = num(minuteRow?.minutesConfidence ?? p.minutes?.confidence);
  const minutesRole = minuteRow?.role || p.minutes?.role || "";

  const usageScore = num(usageRow?.usageScore ?? p.usage?.score);
  const usageTrend = usageRow?.usageTrend || p.usage?.trend || "";

  const threesLean = round1(season * 0.42 + last5 * 0.36 + last10 * 0.22);
  const trendDiff = round1(last5 - season);
  const attemptTrend = round1(last53PA - season3PA);

  const base = clamp((threesLean / 4) * 44, 0, 44);
  const attempts = clamp(((last53PA * 0.6 + last103PA * 0.4) / 10) * 18, 0, 18);
  const mins = clamp((expectedMinutes / 36) * 12, 0, 12);
  const usage = clamp((usageScore / 100) * 8, 0, 8);
  const conf = clamp((minutesConfidence / 100) * 5, 0, 5);
  const trend = clamp((trendDiff / 1.5) * 6, -5, 6);
  const attemptBoost = clamp((attemptTrend / 3) * 7, -5, 7);

  const threesScore = round1(clamp(base + attempts + mins + usage + conf + trend + attemptBoost));

  const tags = [
    p.starter ? "Starter" : "Bench",
    minutesRole,
    threesRole(threesLean),
    trendDiff >= 0.8 ? "Threes Trending Up" : "",
    trendDiff <= -0.8 ? "Threes Trending Down" : "",
    attemptTrend >= 2 ? "Three Volume Up" : "",
    usageTrend === "Usage Spike" ? "Usage Spike" : "",
    usageTrend === "Usage Up" ? "Usage Up" : "",
    expectedMinutes >= 30 ? "Stable Minutes" : ""
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

    seasonThrees: round1(season),
    last5Threes: round1(last5),
    last10Threes: round1(last10),
    threesLean,
    trendDiff,

    seasonThreeAttempts: round1(season3PA),
    last5ThreeAttempts: round1(last53PA),
    last10ThreeAttempts: round1(last103PA),
    attemptTrend,

    expectedMinutes: round1(expectedMinutes),
    minutesConfidence: round1(minutesConfidence),
    minutesRole,

    usageScore: round1(usageScore),
    usageTrend,

    threesScore,
    confidence: confidenceTier(threesScore),
    playGrade: playGrade(threesScore),
    threesRole: threesRole(threesLean),
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
      b.threesScore - a.threesScore ||
      b.threesLean - a.threesLean ||
      b.last5ThreeAttempts - a.last5ThreeAttempts ||
      String(a.player).localeCompare(String(b.player))
    )
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));

  const out = {
    sport: "NBA",
    market: "Threes",
    version: "1.0",
    source: "nba_core plus nba_minutes_engine plus nba_usage_engine",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    season: core.season || "",
    gameCount: core.gameCount || 0,
    playerCount: rows.length,
    modelNotes: [
      "Threes Board 1.0 uses season threes, last 5 threes, last 10 threes, three point attempts, attempt trend, expected minutes, minutes confidence, and usage.",
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
    preserveReason: "Board generated 0 players"
  }, null, 2));

  console.log("BOARD PRESERVED PREVIOUS DATA");
  return;
}

fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA THREES BOARD COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA THREES BOARD FAILED");
  console.error(err);
  process.exit(1);
});
