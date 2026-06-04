import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const POINTS_FILE = path.join(ROOT, "website/data/nba_points.json");
const GAMES_FILE = path.join(ROOT, "website/data/nba_games_today.json");
const OUT = path.join(ROOT, "website/data/nba_matchup_engine.json");

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

function matchupTier(score) {
  if (score >= 85) return "Elite Matchup";
  if (score >= 75) return "Strong Matchup";
  if (score >= 62) return "Playable Matchup";
  if (score >= 50) return "Neutral Matchup";
  return "Thin Matchup";
}

function findGame(row, games) {
  return games.find(g =>
    String(g.gameId) === String(row.gameId) ||
    (
      (
        String(g.homeTeam?.abbreviation || "") === String(row.team) ||
        String(g.awayTeam?.abbreviation || "") === String(row.team)
      ) &&
      (
        String(g.homeTeam?.abbreviation || "") === String(row.opponent) ||
        String(g.awayTeam?.abbreviation || "") === String(row.opponent)
      )
    )
  ) || null;
}

function buildScore(row) {
  const pointsScore = num(row.pointsScore);
  const usageScore = num(row.usageScore);
  const minutes = num(row.expectedMinutes);
  const minutesConfidence = num(row.minutesConfidence);
  const volumeTrend = num(row.volumeTrend);
  const trendDiff = num(row.trendDiff);

  const base = clamp(pointsScore * 0.34, 0, 34);
  const usage = clamp((usageScore / 100) * 20, 0, 20);
  const mins = clamp((minutes / 36) * 16, 0, 16);
  const minConf = clamp((minutesConfidence / 100) * 8, 0, 8);
  const volume = clamp((volumeTrend / 8) * 8, -4, 8);
  const scoringTrend = clamp((trendDiff / 8) * 6, -4, 6);

  const homeAwayBoost = row.homeAway === "HOME" ? 2 : 0;
  const usageSpikeBoost = row.usageTrend === "Usage Spike" ? 4 : row.usageTrend === "Usage Up" ? 2 : 0;
  const roleBoost =
    row.scoringRole === "Primary Scorer" ? 4 :
    row.scoringRole === "Strong Scorer" ? 2 :
    0;

  const matchupScore = clamp(base + usage + mins + minConf + volume + scoringTrend + homeAwayBoost + usageSpikeBoost + roleBoost);

  return round1(matchupScore);
}

function buildRow(row, games) {
  const game = findGame(row, games);
  const matchupScore = buildScore(row);
  const tier = matchupTier(matchupScore);

  const tags = [
    tier,
    row.homeAway === "HOME" ? "Home Spot" : "Road Spot",
    row.usageTrend === "Usage Spike" ? "Usage Spike" : "",
    row.usageTrend === "Usage Up" ? "Usage Up" : "",
    num(row.volumeTrend) >= 5 ? "Volume Acceleration" : "",
    num(row.expectedMinutes) >= 32 ? "Minute Edge" : "",
    row.scoringRole || "",
    row.minutesRole || ""
  ].filter(Boolean);

  return {
    playerId: row.playerId,
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    position: row.position,
    homeAway: row.homeAway,
    gameId: row.gameId,
    gameTimeUTC: row.gameTimeUTC,
    gameStatusText: row.gameStatusText,

    matchup: `${row.team} vs ${row.opponent}`,
    arena: game?.arena || "",
    city: game?.city || "",
    opponentContext: "Neutral until team defense dataset is added",
    paceContext: "Neutral until pace dataset is added",

    pointsScore: round1(row.pointsScore),
    pointsLean: round1(row.pointsLean),
    usageScore: round1(row.usageScore),
    usageTrend: row.usageTrend,
    volumeTrend: round1(row.volumeTrend),
    expectedMinutes: round1(row.expectedMinutes),
    minutesConfidence: round1(row.minutesConfidence),
    minutesRole: row.minutesRole,
    scoringRole: row.scoringRole,

    matchupScore,
    matchupTier: tier,
    tags: [...new Set(tags)].slice(0, 8)
  };
}

async function main() {
  const points = readJSON(POINTS_FILE, { players: [] });
  const gamesPayload = readJSON(GAMES_FILE, { games: [] });

  const players = Array.isArray(points.players) ? points.players : [];
  const games = Array.isArray(gamesPayload.games) ? gamesPayload.games : [];

  const rows = players
    .filter(p => String(p.status || "").toUpperCase() === "ACTIVE")
    .map(p => buildRow(p, games))
    .sort((a, b) =>
      b.matchupScore - a.matchupScore ||
      b.pointsScore - a.pointsScore ||
      b.usageScore - a.usageScore ||
      String(a.player).localeCompare(String(b.player))
    )
    .map((row, index) => ({
      rank: index + 1,
      ...row
    }));

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "nba_points plus nba_games_today",
    fetchedAt: new Date().toISOString(),
    date: points.date || gamesPayload.date || "",
    season: points.season || "",
    playerCount: rows.length,
    modelNotes: [
      "NBA Matchup Engine 1.0 uses existing points board context only.",
      "Opponent defensive ranks and pace are marked neutral until a real dataset is added.",
      "No fake defensive rankings are created.",
      "No odds or betting lines are used."
    ],
    players: rows
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA MATCHUP ENGINE COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA MATCHUP ENGINE FAILED");
  console.error(err);
  process.exit(1);
});
