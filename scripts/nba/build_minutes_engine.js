import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const PLAYER_POOL_FILE = path.join(ROOT, "website/data/nba_player_pool.json");
const HISTORY_FILE = path.join(ROOT, "website/data/nba_history.json");
const OUT = path.join(ROOT, "website/data/nba_minutes_engine.json");

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

function roleFromMinutes(player, minutes) {
  if (String(player.status || "").toUpperCase() !== "ACTIVE") return "Inactive";
  if (minutes >= 34) return "Core Starter";
  if (minutes >= 30) return "Starter";
  if (minutes >= 22) return "Rotation";
  if (minutes >= 12) return "Bench";
  return "Deep Bench";
}

function buildExpectedMinutes(player, history) {
  const season = num(history?.seasonSummary?.minutes);
  const last5 = num(history?.last5?.minutes);
  const last10 = num(history?.last10?.minutes);

  if (String(player.status || "").toUpperCase() !== "ACTIVE") return 0;

  const historyLean = round1(
    season * 0.35 +
    last5 * 0.40 +
    last10 * 0.25
  );

  let expected = historyLean;

  if (player.starter) expected = Math.max(expected, 28);
  if (!player.starter && expected > 28) expected = 28;

  return round1(clamp(expected, 0, 40));
}

function buildConfidence(player, history, expectedMinutes) {
  let score = 0;

  const season = num(history?.seasonSummary?.minutes);
  const last5 = num(history?.last5?.minutes);
  const last10 = num(history?.last10?.minutes);

  if (String(player.status || "").toUpperCase() === "ACTIVE") score += 20;
  if (player.starter) score += 25;
  if (player.oncourt) score += 10;

  if (expectedMinutes >= 34) score += 25;
  else if (expectedMinutes >= 30) score += 20;
  else if (expectedMinutes >= 22) score += 14;
  else if (expectedMinutes >= 12) score += 7;

  if (season > 0 && last5 > 0 && last10 > 0) score += 15;
  else if (season > 0) score += 8;

  const minutesSwing = Math.abs(last5 - season);
  if (season > 0 && last5 > 0 && minutesSwing <= 3) score += 5;
  if (minutesSwing >= 8) score -= 8;

  return round1(clamp(score));
}

function buildRow(player, history) {
  const seasonMinutes = num(history?.seasonSummary?.minutes);
  const last5Minutes = num(history?.last5?.minutes);
  const last10Minutes = num(history?.last10?.minutes);

  const expectedMinutes = buildExpectedMinutes(player, history);
  const minutesConfidence = buildConfidence(player, history, expectedMinutes);
  const minutesTrend = round1(last5Minutes - seasonMinutes);
  const role = roleFromMinutes(player, expectedMinutes);

  const tags = [
    player.starter ? "Starter" : "Bench",
    role,
    minutesTrend >= 3 ? "Minutes Trending Up" : "",
    minutesTrend <= -3 ? "Minutes Trending Down" : "",
    expectedMinutes >= 34 ? "Heavy Minutes" : "",
    minutesConfidence >= 85 ? "High Minute Confidence" : "",
    minutesConfidence < 55 ? "Minute Risk" : ""
  ].filter(Boolean);

  return {
    playerId: player.playerId,
    player: player.player,
    team: player.teamAbbr,
    opponent: player.opponentAbbr,
    position: player.position,
    status: player.status,
    starter: Boolean(player.starter),
    oncourt: Boolean(player.oncourt),
    homeAway: player.homeAway,
    gameId: player.gameId,
    gameTimeUTC: player.gameTimeUTC,

    expectedMinutes,
    minutesConfidence,
    role,
    seasonMinutes: round1(seasonMinutes),
    last5Minutes: round1(last5Minutes),
    last10Minutes: round1(last10Minutes),
    minutesTrend,
    tags: [...new Set(tags)]
  };
}

async function main() {
  const pool = readJSON(PLAYER_POOL_FILE, { players: [] });
  const historyData = readJSON(HISTORY_FILE, { players: [] });
  const players = Array.isArray(pool.players) ? pool.players : [];
  const historyMap = byId(historyData.players);

  const rows = players
    .map(player => buildRow(player, historyMap.get(String(player.playerId)) || {}))
    .sort((a, b) =>
      b.minutesConfidence - a.minutesConfidence ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    );

  const out = {
    sport: "NBA",
    version: "1.1",
    source: "nba_player_pool plus nba_history",
    fetchedAt: new Date().toISOString(),
    date: pool.date || historyData.date || "",
    season: historyData.season || "",
    playerCount: rows.length,
    modelNotes: [
      "Minutes Engine 1.1 uses player-pool status plus season, last 5, and last 10 minutes from NBA history.",
      "Roles are Core Starter, Starter, Rotation, Bench, Deep Bench, and Inactive.",
      "No odds or betting lines are used."
    ],
    players: rows
  };

  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

  console.log("NBA MINUTES ENGINE COMPLETE");
  console.log("Players:", rows.length);
  console.log("Saved:", OUT);
}

main().catch(err => {
  console.error("NBA MINUTES ENGINE FAILED");
  console.error(err);
  process.exit(1);
});
