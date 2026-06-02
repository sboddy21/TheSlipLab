import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");

const MATCHUPS = path.join(DATA, "game_pitcher_matchups.json");
const OUT = path.join(DATA, "lineup_impact_engine.json");

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clean(value, fallback = "") {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value);
}

function norm(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function lineupProfile(spot) {
  const s = Number(spot);

  const table = {
    1: { pa: 4.75, boost: 7.5, advantage: 92, label: "Leadoff Volume" },
    2: { pa: 4.65, boost: 9.0, advantage: 96, label: "Premium HR Slot" },
    3: { pa: 4.55, boost: 8.5, advantage: 94, label: "Heart Order" },
    4: { pa: 4.45, boost: 10.0, advantage: 98, label: "Cleanup Power" },
    5: { pa: 4.30, boost: 6.5, advantage: 88, label: "Power Runway" },
    6: { pa: 4.15, boost: 2.0, advantage: 74, label: "Neutral Middle" },
    7: { pa: 3.95, boost: -2.5, advantage: 58, label: "Lower Order" },
    8: { pa: 3.80, boost: -5.5, advantage: 46, label: "Low Volume" },
    9: { pa: 3.70, boost: -6.5, advantage: 40, label: "Lowest Volume" }
  };

  return table[s] || { pa: 4.05, boost: 0, advantage: 65, label: "Projected Unknown" };
}

function hitterKey(row) {
  return norm(row.player || row.name || row.fullName);
}

function teamLineupRows(game, side) {
  const rows = side === "away" ? game.hitters?.away || [] : game.hitters?.home || [];
  return rows
    .filter(row => row && row.player)
    .map(row => ({
      player: row.player,
      playerKey: hitterKey(row),
      team: row.team,
      spot: num(row.confirmedLineupSpot || row.lineupSpot || row.battingOrder || row.actualLineupSpot || row.projectedLineupSpot || row.projectedSpot),
      powerScore: num(row.powerScore),
      hrConfidence: num(row.hrConfidence),
      pitchEdge: num(row.pitchEdge),
      pitcherRisk: num(row.pitcherRisk),
      zoneOverlap: num(row.zoneOverlap)
    }))
    .filter(row => row.spot > 0)
    .sort((a, b) => a.spot - b.spot);
}

function neighborScore(lineup, spot) {
  const before = lineup.find(row => row.spot === spot - 1);
  const after = lineup.find(row => row.spot === spot + 1);

  const beforePower = before ? before.powerScore * 0.35 + before.hrConfidence * 2.0 : 0;
  const afterPower = after ? after.powerScore * 0.45 + after.hrConfidence * 2.2 : 0;

  const protection = Math.min(100, beforePower + afterPower);

  return {
    protectionScore: Number(protection.toFixed(1)),
    hitterBefore: before?.player || "",
    hitterAfter: after?.player || ""
  };
}

function buildRow(row, game, side, lineup) {
  const spot = num(row.confirmedLineupSpot || row.lineupSpot || row.battingOrder || row.actualLineupSpot || row.projectedLineupSpot || row.projectedSpot);
  const profile = lineupProfile(spot);
  const neighbors = neighborScore(lineup, spot);

  const confirmed = Boolean(row.confirmedLineup || row.confirmedLineupSpot || String(row.lineupSource || "").toUpperCase() === "CONFIRMED");

  const contextBoost =
    profile.boost +
    Math.max(0, neighbors.protectionScore - 55) * 0.045 +
    Math.max(0, num(row.pitchEdge) - 45) * 0.025 +
    Math.max(0, num(row.pitcherRisk) - 45) * 0.025;

  const lineupImpactScore = Math.max(
    0,
    Math.min(
      100,
      profile.advantage +
      Math.max(0, neighbors.protectionScore - 50) * 0.18 +
      Math.max(0, num(row.powerScore) - 55) * 0.15
    )
  );

  return {
    player: row.player,
    playerId: row.playerId || row.mlbId || row.id || null,
    team: row.team,
    opponent: row.opponent,
    game: game.matchup || game.game || "",
    side,
    lineupSpot: spot || null,
    lineupSource: confirmed ? "CONFIRMED" : clean(row.lineupSource, "PROJECTED"),
    confirmedLineup: confirmed,
    lineupRole: profile.label,
    projectedPlateAppearances: Number(profile.pa.toFixed(2)),
    lineupBoost: Number(contextBoost.toFixed(1)),
    lineupImpactScore: Number(lineupImpactScore.toFixed(1)),
    protectionScore: neighbors.protectionScore,
    hitterBefore: neighbors.hitterBefore,
    hitterAfter: neighbors.hitterAfter,
    originalHrConfidence: num(row.hrConfidence),
    adjustedHrConfidence: Number(Math.max(0, num(row.hrConfidence) + contextBoost / 10).toFixed(1)),
    tags: [
      confirmed ? "CONFIRMED LINEUP" : "PROJECTED LINEUP",
      profile.label,
      neighbors.protectionScore >= 75 ? "PROTECTION BOOST" : "",
      spot >= 1 && spot <= 5 ? "PA EDGE" : "",
      spot >= 8 ? "VOLUME RISK" : ""
    ].filter(Boolean)
  };
}

function main() {
  const data = readJson(MATCHUPS, { games: [] });
  const games = Array.isArray(data.games) ? data.games : [];
  const rows = [];

  for (const game of games) {
    for (const side of ["away", "home"]) {
      const hitters = side === "away" ? game.hitters?.away || [] : game.hitters?.home || [];
      const lineup = teamLineupRows(game, side);

      for (const row of hitters) {
        if (!row?.player) continue;
        rows.push(buildRow(row, game, side, lineup));
      }
    }
  }

  const byPlayer = {};
  for (const row of rows) {
    byPlayer[norm(row.player)] = row;
  }

  const output = {
    updatedAt: new Date().toISOString(),
    source: "game_pitcher_matchups.json",
    totalPlayers: rows.length,
    confirmedPlayers: rows.filter(row => row.confirmedLineup).length,
    rows: rows.sort((a, b) => b.lineupImpactScore - a.lineupImpactScore),
    byPlayer
  };

  writeJson(OUT, output);

  console.log("");
  console.log("LINEUP IMPACT ENGINE COMPLETE");
  console.log("Players:", output.totalPlayers);
  console.log("Confirmed:", output.confirmedPlayers);
  console.log("Saved:", OUT);
}

main();
