import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const MINUTES_FILE = path.join(ROOT, "website/data/nba_minutes_engine.json");
const OUT = path.join(ROOT, "website/data/nba_rebounds.json");

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

function reboundRole(lean) {
  if (lean >= 11) return "Glass Cleaner";
  if (lean >= 8) return "Strong Rebounder";
  if (lean >= 5.5) return "Useful Rebounder";
  if (lean >= 3.5) return "Low Rebound Role";
  return "Thin Rebound Role";
}

function positionBoost(position) {
  const p = String(position || "").toUpperCase();
  if (p === "C") return 8;
  if (p === "PF") return 6;
  if (p === "SF") return 3;
  if (p === "SG") return 1;
  return 0;
}

function buildRow(p, minuteRow) {
  const season = num(p.profile?.seasonRebounds ?? p.history?.season?.rebounds);
  const last5 = num(p.profile?.last5Rebounds ?? p.history?.last5?.rebounds);
  const last10 = num(p.profile?.last10Rebounds ?? p.history?.last10?.rebounds);

  const expectedMinutes = num(minuteRow?.expectedMinutes ?? p.minutes?.expected ?? p.profile?.seasonMinutes);
  const minutesConfidence = num(minuteRow?.minutesConfidence ?? p.minutes?.confidence);
  const minutesRole = minuteRow?.role || p.minutes?.role || "";

  const reboundsLean = round1(season * 0.42 + last5 * 0.36 + last10 * 0.22);
  const trendDiff = round1(last5 - season);

  const base = clamp((reboundsLean / 13) * 48, 0, 48);
  const form = clamp(((last5 * 0.65 + last10 * 0.35) / 13) * 18, 0, 18);
  const mins = clamp((expectedMinutes / 36) * 14, 0, 14);
  const conf = clamp((minutesConfidence / 100) * 6, 0, 6);
  const trend = clamp((trendDiff / 4) * 6, -5, 6);
  const pos = positionBoost(p.position);

  const reboundsScore = round1(clamp(base + form + mins + conf + trend + pos));

  const tags = [
    p.starter ? "Starter" : "Bench",
    minutesRole,
    reboundRole(reboundsLean),
    trendDiff >= 2 ? "Rebounds Trending Up" : "",
    trendDiff <= -2 ? "Rebounds Trending Down" : "",
    expectedMinutes >= 30 ? "Stable Minutes" : "",
    expectedMinutes >= 34 ? "Heavy Minutes" : "",
    ["C","PF"].includes(String(p.position || "").toUpperCase()) ? "Frontcourt Rebound Profile" : ""
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

    seasonRebounds: round1(season),
    last5Rebounds: round1(last5),
    last10Rebounds: round1(last10),
    reboundsLean,
    trendDiff,

    expectedMinutes: round1(expectedMinutes),
    minutesConfidence: round1(minutesConfidence),
    minutesRole,

    reboundsScore,
    confidence: confidenceTier(reboundsScore),
    playGrade: playGrade(reboundsScore),
    reboundRole: reboundRole(reboundsLean),
    tags: [...new Set(tags)].slice(0, 8)
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const minutes = readJSON(MINUTES_FILE, { players: [] });

  const players = Array.isArray(core.players) ? core.players : [];
  const minutesMap = byId(minutes.players);

  const rows = players
    .map(p => buildRow(p, minutesMap.get(String(p.playerId)) || {}))
    .filter(r => String(r.status || "").toUpperCase() === "ACTIVE")
    .sort((a, b) =>
      b.reboundsScore - a.reboundsScore ||
      b.reboundsLean - a.reboundsLean ||
      b.expectedMinutes - a.expectedMinutes ||
      String(a.player).localeCompare(String(b.player))
    )
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));

  const out = {
    sport: "NBA",
    market: "Rebounds",
    version: "1.0",
    source: "nba_core plus nba_minutes_engine",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    season: core.season || "",
    gameCount: core.gameCount || 0,
    playerCount: rows.length,
    availability: Number(core.gameCount || 0) > 0 ? "games_scheduled" : "no_games_scheduled",
    modelNotes: [
      "Rebounds Board 1.0 uses season rebounds, last 5 rebounds, last 10 rebounds, expected minutes, minutes confidence, position role, and recent rebound trend.",
      "No odds or betting lines are used."
    ],
    players: rows
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA REBOUNDS BOARD COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA REBOUNDS BOARD FAILED");
  console.error(err);
  process.exit(1);
});
