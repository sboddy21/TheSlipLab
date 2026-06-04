import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const OUT = path.join(ROOT, "website/data/nba_points.json");

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

function confidenceTier(score) {
  if (score >= 95) return "Elite";
  if (score >= 85) return "Strong";
  if (score >= 75) return "Playable";
  if (score >= 60) return "Watch";
  return "Low";
}

function buildRow(p) {
  const season = num(p.profile?.seasonPoints);
  const last5 = num(p.profile?.last5Points);
  const last10 = num(p.profile?.last10Points);
  const minutes = num(p.minutes?.expected);
  const usage = num(p.usage?.score);

  const pointsLean = round1(
    season * 0.45 +
    last5 * 0.35 +
    last10 * 0.20
  );

  const trendDiff = round1(last5 - season);

  return {
    playerId: p.playerId,
    player: p.player,
    team: p.teamAbbr,
    opponent: p.opponentAbbr,
    position: p.position,
    homeAway: p.homeAway,
    starter: Boolean(p.starter),
    status: p.status,
    gameId: p.gameId,
    gameTimeUTC: p.gameTimeUTC,

    seasonPoints: season,
    last5Points: last5,
    last10Points: last10,
    pointsLean,
    trendDiff,

    expectedMinutes: minutes,
    minutesConfidence: num(p.minutes?.confidence),
    usageScore: usage,
    usageTier: p.usage?.tier || "",
    usageTrend: p.usage?.trend || "",

    pointsScore: num(p.scores?.pointsScore),
    nbaScore: num(p.scores?.nbaScore),
    confidence: confidenceTier(num(p.scores?.pointsScore)),

    tags: [
      ...(Array.isArray(p.tags) ? p.tags : []),
      trendDiff >= 4 ? "Scoring Form Up" : "",
      minutes >= 34 ? "Heavy Minutes" : "",
      usage >= 60 ? "High Usage" : ""
    ].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).slice(0, 7)
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const players = Array.isArray(core.players) ? core.players : [];

  const rows = players
    .map(buildRow)
    .filter(r => String(r.status || "").toUpperCase() === "ACTIVE")
    .sort((a, b) =>
      b.pointsScore - a.pointsScore ||
      b.pointsLean - a.pointsLean ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    );

  const out = {
    sport: "NBA",
    market: "Points",
    version: "1.0",
    source: "nba_core.json",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    season: core.season || "",
    playerCount: rows.length,
    modelNotes: [
      "Points Board 1.0 reads only from nba_core.json.",
      "Score uses season scoring, last 5 form, last 10 form, expected minutes, usage, and trend tags."
    ],
    players: rows
  };

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
