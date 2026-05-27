import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const POOL_FILE = path.join(ROOT, "website", "data", "mlb_player_pool.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const POWER_PROFILE_FILE = path.join(ROOT, "website", "data", "hr_power_profiles.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
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

function scale(value, min, max) {
  const n = num(value);
  return Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100));
}

async function getPlayerBio(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}`;
  const data = await getJson(url);
  const person = data?.people?.[0] || {};

  return {
    batSide: person?.batSide?.code || null,
    batSideDescription: person?.batSide?.description || null,
    pitchHand: person?.pitchHand?.code || null,
    pitchHandDescription: person?.pitchHand?.description || null
  };
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

async function getPitcherStats(playerId) {
  if (!playerId) return null;

  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    era: num(stat.era),
    whip: num(stat.whip),
    homeRuns: num(stat.homeRuns),
    inningsPitched: num(stat.inningsPitched),
    hits: num(stat.hits),
    strikeOuts: num(stat.strikeOuts),
    baseOnBalls: num(stat.baseOnBalls)
  };
}

function scorePlayer(hitter, pitcher, powerProfile = null) {
  const pa = Math.max(1, num(hitter.plateAppearances));
  const hrRate = num(hitter.hr) / pa;
  const xbhRate =
    (num(hitter.doubles) + num(hitter.triples) + num(hitter.hr)) / pa;

  const fallbackPower =
    scale(hrRate, 0.005, 0.09) * 0.38 +
    scale(hitter.slg, 0.320, 0.700) * 0.28 +
    scale(hitter.ops, 0.650, 1.100) * 0.18 +
    scale(xbhRate, 0.035, 0.150) * 0.16;

  const truePower = num(powerProfile?.truePowerScore, fallbackPower);
  const hrPower = num(powerProfile?.hrPowerIndex, fallbackPower);
  const launchPower = num(powerProfile?.launchPowerScore, fallbackPower);
  const contactDamage = num(powerProfile?.contactDamageScore, fallbackPower);

  const pitcherRisk = pitcher
    ? scale(pitcher.homeRuns, 0, 30) * 0.50 +
      scale(pitcher.era, 2.50, 6.50) * 0.25 +
      scale(pitcher.whip, 0.95, 1.60) * 0.25
    : 50;

  const samplePenalty =
    num(powerProfile?.samplePenalty) ||
    (hitter.plateAppearances < 40 ? 10 : hitter.plateAppearances < 80 ? 5 : 0);

  const strikeoutDrag = num(powerProfile?.strikeoutDrag);

  const score =
    truePower * 0.42 +
    hrPower * 0.24 +
    launchPower * 0.16 +
    contactDamage * 0.08 +
    pitcherRisk * 0.10 -
    samplePenalty -
    strikeoutDrag;

  return Math.round(Math.max(0, Math.min(100, score)));
}

function edgeLabel(score) {
  if (score >= 82) return "Core";
  if (score >= 74) return "Strong";
  if (score >= 66) return "Live";
  if (score >= 58) return "Watch";
  return "Longshot";
}

async function main() {
  if (!fs.existsSync(POOL_FILE)) {
    throw new Error("Missing website/data/mlb_player_pool.json. Run npm run mlb:players first.");
  }

  const poolData = readJson(POOL_FILE);
  const players = poolData.players || [];

  const powerProfileData = fs.existsSync(POWER_PROFILE_FILE)
    ? readJson(POWER_PROFILE_FILE)
    : { players: [] };

  const powerProfiles = new Map(
    (powerProfileData.players || []).map(profile => [
      String(profile.playerId || profile.player).toLowerCase(),
      profile
    ])
  );

  const pitcherCache = new Map();
  const rows = [];

  for (const player of players) {
    if (!player.playerId) continue;

    console.log(`Scoring ${player.player}`);

    const bio = await getPlayerBio(player.playerId);
    const hitter = await getHitterStats(player.playerId);

    const pitcherId = player.opposingProbablePitcherId;
    let pitcher = null;

    if (pitcherId) {
      if (!pitcherCache.has(pitcherId)) {
        pitcherCache.set(pitcherId, await getPitcherStats(pitcherId));
      }
      pitcher = pitcherCache.get(pitcherId);
    }

    const powerProfile =
      powerProfiles.get(String(player.playerId).toLowerCase()) ||
      powerProfiles.get(String(player.player).toLowerCase()) ||
      null;

    const score = scorePlayer(hitter, pitcher, powerProfile);

    rows.push({
      rank: 0,
      player: player.player,
      batSide: bio.batSide,
      batSideDescription: bio.batSideDescription,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      venue: player.venue,
      opposingPitcher: player.opposingProbablePitcher || "TBD",
      score,
      truePowerScore: powerProfile?.truePowerScore ?? null,
      hrPowerIndex: powerProfile?.hrPowerIndex ?? null,
      launchPowerScore: powerProfile?.launchPowerScore ?? null,
      contactDamageScore: powerProfile?.contactDamageScore ?? null,
      powerTier: powerProfile?.powerTier ?? null,
      odds: "N/A",
      edge: edgeLabel(score),
      note: `HR ${hitter.hr} • SLG ${hitter.slg || "--"} • OPS ${hitter.ops || "--"}`,
      stats: {
        hitter,
        pitcher
      }
    });
  }

  rows.sort((a, b) => b.score - a.score);

  const finalRows = rows.map((row, index) => ({
    ...row,
    rank: index + 1
  }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(finalRows, null, 2));

  console.log("Home run board saved");
  console.log("Players:", finalRows.length);
  console.log("File:", OUT_FILE);
}

main().catch(err => {
  console.error("Failed to build home run board");
  console.error(err.message);
  process.exit(1);
});
