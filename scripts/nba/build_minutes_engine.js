import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const PLAYER_POOL_FILE = path.join(ROOT, "website/data/nba_player_pool.json");
const HISTORY_FILE = path.join(ROOT, "website/data/nba_history.json");
const AVAILABILITY_FILE = path.join(ROOT, "website/data/nba_availability.json");
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

function roleFromMinutes(player, availability, minutes) {
  if (availability?.unavailable) return "Unavailable";
  if (minutes >= 34) return "Core Starter";
  if (minutes >= 30) return "Starter";
  if (minutes >= 22) return "Rotation";
  if (minutes >= 12) return "Bench";
  return "Deep Bench";
}

function buildExpectedMinutes(player, history, availability) {
  const season = num(history?.seasonSummary?.minutes);
  const last5 = num(history?.last5?.minutes);
  const last10 = num(history?.last10?.minutes);

  if (availability?.unavailable) return 0;

  const historyLean = round1(
    season * 0.35 +
    last5 * 0.40 +
    last10 * 0.25
  );

  let expected = historyLean;

  if (player.starterKnown && player.starter) expected = Math.max(expected, 28);
  if (player.starterKnown && !player.starter && expected > 28) expected = 28;

  return round1(clamp(expected, 0, 40));
}

function buildConfidence(player, history, availability, expectedMinutes) {
  let score = 0;

  const season = num(history?.seasonSummary?.minutes);
  const last5 = num(history?.last5?.minutes);
  const last10 = num(history?.last10?.minutes);

  if (availability?.availabilityStatus === "CONFIRMED_ACTIVE") score += 20;
  else if (["PROBABLE", "DAY_TO_DAY"].includes(availability?.availabilityStatus)) score += 5;
  if (player.starterKnown && player.starter) score += 25;
  else if (player.starterKnown) score += 10;
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

function buildRow(player, history, availability) {
  const seasonMinutes = num(history?.seasonSummary?.minutes);
  const last5Minutes = num(history?.last5?.minutes);
  const last10Minutes = num(history?.last10?.minutes);

  const expectedMinutes = buildExpectedMinutes(player, history, availability);
  const minutesConfidence = buildConfidence(player, history, availability, expectedMinutes);
  const minutesTrend = round1(last5Minutes - seasonMinutes);
  const role = roleFromMinutes(player, availability, expectedMinutes);

  const tags = [
    player.starterKnown ? (player.starter ? "Confirmed Starter" : "Confirmed Bench") : "Starter Unknown",
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
    statusSource: player.statusSource || "",
    starter: Boolean(player.starter),
    starterKnown: Boolean(player.starterKnown),
    starterSource: player.starterSource || "",
    availabilityStatus: availability?.availabilityStatus || "UNKNOWN",
    availabilityKnown: Boolean(availability?.availabilityKnown),
    injury: availability?.injury || null,
    publicationEligible: Boolean(availability?.publicationEligible),
    publicationStatus: availability?.publicationStatus || "context_only_unconfirmed_role",
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
  const availabilityData = readJSON(AVAILABILITY_FILE, { players: [] });
  const players = Array.isArray(pool.players) ? pool.players : [];
  const historyMap = byId(historyData.players);
  const availabilityMap = byId(availabilityData.players);

  const rows = players
    .map(player => buildRow(player, historyMap.get(String(player.playerId)) || {}, availabilityMap.get(String(player.playerId)) || {}))
    .sort((a, b) =>
      b.minutesConfidence - a.minutesConfidence ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    );

  const out = {
    sport: "NBA",
    version: "1.1",
    source: "nba_player_pool plus nba_history plus nba_availability",
    fetchedAt: new Date().toISOString(),
    date: pool.date || historyData.date || "",
    season: historyData.season || "",
    playerCount: rows.length,
    modelNotes: [
      "Minutes Engine 1.1 uses player-pool status plus season, last 5, and last 10 minutes from NBA history.",
      "Unknown starters retain their historical minutes baseline and are not treated as confirmed bench players.",
      "Missing injury information does not mean a player is cleared; publication eligibility requires confirmed game status and role.",
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
