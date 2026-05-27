import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const PLAYER_POOL_FILE = path.join(DATA_DIR, "mlb_player_pool.json");
const OUT_FILE = path.join(DATA_DIR, "hr_power_profiles.json");

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed ${res.status}: ${url}`);
  return res.json();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  return Number(num(value).toFixed(digits));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scale(value, min, max) {
  if (max === min) return 0;
  return clamp(((num(value) - min) / (max - min)) * 100, 0, 100);
}

async function getHitterStats(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=hitting`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    hr: num(stat.homeRuns),
    hits: num(stat.hits),
    doubles: num(stat.doubles),
    triples: num(stat.triples),
    rbi: num(stat.rbi),
    avg: num(stat.avg),
    obp: num(stat.obp),
    slg: num(stat.slg),
    ops: num(stat.ops),
    atBats: num(stat.atBats),
    plateAppearances: num(stat.plateAppearances),
    strikeOuts: num(stat.strikeOuts)
  };
}

function buildPowerProfile(player, hitter) {
  const pa = Math.max(1, num(hitter.plateAppearances));
  const ab = Math.max(1, num(hitter.atBats));

  const hrRate = hitter.hr / pa;
  const xbh = hitter.doubles + hitter.triples + hitter.hr;
  const xbhRate = xbh / pa;
  const strikeoutRate = hitter.strikeOuts / pa;

  const rawHrPower =
    scale(hrRate, 0.005, 0.09) * 0.42 +
    scale(hitter.slg, 0.320, 0.700) * 0.26 +
    scale(hitter.ops, 0.650, 1.100) * 0.16 +
    scale(xbhRate, 0.035, 0.150) * 0.16;

  const contactDamage =
    scale(hitter.slg, 0.330, 0.680) * 0.42 +
    scale(xbhRate, 0.030, 0.145) * 0.34 +
    scale(hitter.avg, 0.190, 0.330) * 0.12 +
    scale(hitter.ops, 0.650, 1.080) * 0.12;

  const launchPower =
    scale(hitter.hr, 0, 35) * 0.45 +
    scale(hrRate, 0.005, 0.09) * 0.40 +
    scale(xbhRate, 0.035, 0.150) * 0.15;

  const samplePenalty =
    pa < 30 ? 18 :
    pa < 60 ? 10 :
    pa < 100 ? 5 :
    0;

  const strikeoutDrag =
    strikeoutRate >= 0.34 ? 5 :
    strikeoutRate >= 0.29 ? 3 :
    strikeoutRate >= 0.24 ? 1 :
    0;

  const truePowerScore = clamp(
    rawHrPower * 0.48 +
      contactDamage * 0.27 +
      launchPower * 0.25 -
      samplePenalty -
      strikeoutDrag,
    0,
    100
  );

  const tier =
    truePowerScore >= 85 ? "NUCLEAR_POWER" :
    truePowerScore >= 74 ? "ELITE_POWER" :
    truePowerScore >= 62 ? "STRONG_POWER" :
    truePowerScore >= 50 ? "VIABLE_POWER" :
    truePowerScore >= 38 ? "LONGSHOT_POWER" :
    "LOW_POWER";

  return {
    player: player.player,
    playerId: player.playerId,
    team: player.team,
    opponent: player.opponent,
    game: player.game,
    venue: player.venue,
    opposingPitcher: player.opposingProbablePitcher || "TBD",
    opposingPitcherId: player.opposingProbablePitcherId || null,

    hrPowerIndex: round(rawHrPower, 2),
    truePowerScore: round(truePowerScore, 2),
    contactDamageScore: round(contactDamage, 2),
    launchPowerScore: round(launchPower, 2),
    samplePenalty,
    strikeoutDrag,
    powerTier: tier,

    rates: {
      hrRate: round(hrRate * 100, 2),
      xbhRate: round(xbhRate * 100, 2),
      strikeoutRate: round(strikeoutRate * 100, 2)
    },

    stats: hitter
  };
}

async function main() {
  if (!fs.existsSync(PLAYER_POOL_FILE)) {
    throw new Error("Missing website/data/mlb_player_pool.json");
  }

  const pool = readJson(PLAYER_POOL_FILE, {});
  const players = pool.players || [];
  const profiles = [];

  for (const player of players) {
    if (!player.playerId) continue;

    try {
      console.log(`Power profiling ${player.player}`);

      const hitter = await getHitterStats(player.playerId);
      profiles.push(buildPowerProfile(player, hitter));
    } catch (err) {
      console.log(`Skipped ${player.player}: ${err.message}`);
    }
  }

  profiles.sort((a, b) => b.truePowerScore - a.truePowerScore);

  const output = {
    generatedAt: new Date().toISOString(),
    source: "MLB Stats API season hitting power profile",
    players: profiles.map((row, index) => ({
      ...row,
      powerRank: index + 1
    }))
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));

  console.log("");
  console.log("HR POWER PROFILES BUILT");
  console.log("Players:", output.players.length);
  console.log("Top Power:", output.players[0]?.player || "None");
  console.log("Saved:", OUT_FILE);
  console.log("");
}

main().catch(err => {
  console.error("Failed to build HR power profiles");
  console.error(err);
  process.exit(1);
});
