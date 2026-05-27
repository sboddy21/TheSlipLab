import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const PLAYER_FILE = path.join(ROOT, "website/data/player_card_data.json");
const OUT_FILE = path.join(ROOT, "website/data/batting_spot_profiles.json");

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function safeDivide(a, b) {
  return b ? a / b : 0;
}

function estimateSpot(player) {
  const hr = Number(player?.season?.hr || 0);
  const ops = Number(player?.season?.ops || 0);
  const avg = Number(player?.season?.avg || 0);

  if (ops >= 1.000 || hr >= 18) return 3;
  if (ops >= 0.900 || hr >= 12) return 2;
  if (avg >= 0.290) return 1;
  if (hr >= 8) return 4;
  return 5;
}

function buildSpotStats(player) {
  const season = player.season || {};
  const projectedSpot = estimateSpot(player);

  const pa = Number(season.pa || 0);
  const hr = Number(season.hr || 0);
  const hits = Number(season.hits || 0);
  const ab = Number(season.ab || 0);
  const doubles = Number(season.doubles || 0);
  const triples = Number(season.triples || 0);

  const singles = Math.max(0, hits - doubles - triples - hr);
  const tb = singles + doubles * 2 + triples * 3 + hr * 4;

  const baseOps = Number(season.ops || 0);
  const baseAvg = Number(season.avg || 0);
  const baseSlg = Number(season.slg || 0);

  const profiles = {};

  for (let spot = 1; spot <= 9; spot++) {
    const multiplier =
      spot === projectedSpot
        ? 1
        : spot < projectedSpot
          ? 0.82 - (Math.abs(spot - projectedSpot) * 0.05)
          : 0.9 - (Math.abs(spot - projectedSpot) * 0.04);

    const adj = Math.max(0.45, multiplier);

    const estPA = Math.round(pa * adj * (spot === projectedSpot ? 1 : 0.42));

    profiles[spot] = {
      lineupSpot: spot,
      currentSpot: spot === projectedSpot,
      pa: estPA,
      avg: Number((baseAvg * (0.95 + adj / 12)).toFixed(3)),
      ops: Number((baseOps * (0.94 + adj / 10)).toFixed(3)),
      slg: Number((baseSlg * (0.94 + adj / 10)).toFixed(3)),
      hr: Math.max(0, Math.round(hr * adj * (estPA / Math.max(pa, 1)) * 2.2)),
      tb: Math.round(tb * adj * (estPA / Math.max(pa, 1)) * 2),
      hits: Math.round(hits * adj * (estPA / Math.max(pa, 1)) * 2)
    };
  }

  const sorted = Object.values(profiles).sort((a, b) => b.ops - a.ops);

  return {
    player: player.player,
    playerId: player.playerId,
    team: player.team,
    opponent: player.opponent,
    projectedSpot,
    bestSpot: sorted[0]?.lineupSpot || projectedSpot,
    worstSpot: sorted[sorted.length - 1]?.lineupSpot || projectedSpot,
    spots: profiles
  };
}

const raw = readJSON(PLAYER_FILE, []);
const players = Array.isArray(raw)
  ? raw
  : raw.players || raw.rows || raw.allPlayers || [];

const out = {
  updatedAt: new Date().toISOString(),
  players: players.map(buildSpotStats)
};

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

console.log("BATTING SPOT PROFILES COMPLETE");
console.log("Players:", out.players.length);
console.log("Saved:", OUT_FILE);
