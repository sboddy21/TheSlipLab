import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, "../..");
const CORE_FILE = path.join(ROOT, "website/data/nba_core.json");
const OUT = path.join(ROOT, "website/data/nba_minutes_engine.json");

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function positionBase(pos) {
  const p = String(pos || "").toUpperCase();
  if (p === "PG") return 34;
  if (p === "SG") return 32;
  if (p === "SF") return 32;
  if (p === "PF") return 30;
  if (p === "C") return 30;
  return 22;
}

function expectedMinutes(player) {
  if (String(player.status || "").toUpperCase() !== "ACTIVE") return 0;

  const base = positionBase(player.position);

  if (player.starter) return base;
  if (player.oncourt) return Math.max(18, base - 8);

  return Math.max(10, base - 14);
}

function confidence(player, minutes) {
  let score = 0;

  if (String(player.status || "").toUpperCase() === "ACTIVE") score += 25;
  if (player.starter) score += 35;
  if (player.oncourt) score += 15;
  if (minutes >= 32) score += 20;
  else if (minutes >= 28) score += 15;
  else if (minutes >= 22) score += 10;
  else if (minutes >= 16) score += 5;

  return Math.min(100, score);
}

function roleTag(player, minutes) {
  if (String(player.status || "").toUpperCase() !== "ACTIVE") return "Inactive";
  if (player.starter && minutes >= 32) return "Core Starter";
  if (player.starter) return "Starter";
  if (minutes >= 24) return "Rotation Piece";
  if (minutes >= 16) return "Bench Role";
  return "Low Minutes";
}

function buildRow(player) {
  const mins = expectedMinutes(player);
  const conf = confidence(player, mins);

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
    expectedMinutes: mins,
    minutesConfidence: conf,
    role: roleTag(player, mins),
    tags: [
      player.starter ? "Starter" : "Bench",
      roleTag(player, mins)
    ]
  };
}

async function main() {
  const core = readJSON(CORE_FILE, { players: [] });
  const players = Array.isArray(core.players) ? core.players : [];

  const rows = players
    .map(buildRow)
    .sort((a, b) =>
      b.minutesConfidence - a.minutesConfidence ||
      b.expectedMinutes - a.expectedMinutes ||
      a.player.localeCompare(b.player)
    );

  const out = {
    sport: "NBA",
    version: "1.0",
    source: "nba_core.json",
    fetchedAt: new Date().toISOString(),
    date: core.date || "",
    playerCount: rows.length,
    modelNotes: [
      "Minutes Engine 1.0 uses starter status, active status, on court status, and position role.",
      "Later versions will add season minutes, last 5 minutes, last 10 minutes, injuries, and rotation trends."
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
