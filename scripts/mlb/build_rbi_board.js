import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const POOL_FILE = path.join(ROOT, "website", "data", "mlb_player_pool.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_rbis.json");

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

async function getHitterStats(playerId) {
  const url = `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=hitting`;
  const data = await getJson(url);
  const stat = data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    hits: num(stat.hits),
    doubles: num(stat.doubles),
    triples: num(stat.triples),
    homeRuns: num(stat.homeRuns),
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
    hits: num(stat.hits),
    homeRuns: num(stat.homeRuns),
    runs: num(stat.runs),
    earnedRuns: num(stat.earnedRuns),
    inningsPitched: num(stat.inningsPitched)
  };
}

function buildScore(hitter, pitcher) {
  const runProduction =
    scale(hitter.rbi, 10, 130) * 0.34 +
    scale(hitter.ops, 0.580, 1.050) * 0.24 +
    scale(hitter.slg, 0.320, 0.620) * 0.20 +
    scale(hitter.homeRuns, 2, 45) * 0.14 +
    scale(hitter.obp, 0.260, 0.440) * 0.08;

  const pitcherPressure = pitcher
    ? scale(pitcher.whip, 0.90, 1.75) * 0.38 +
      scale(pitcher.era, 2.50, 6.80) * 0.34 +
      scale(pitcher.runs || pitcher.earnedRuns, 15, 120) * 0.28
    : 50;

  const strikeoutPenalty = scale(hitter.strikeOuts, 20, 130) * 0.08;

  const samplePenalty =
    hitter.plateAppearances < 40 ? 10 :
    hitter.plateAppearances < 80 ? 5 :
    0;

  return Math.round(
    runProduction * 0.74 +
    pitcherPressure * 0.26 -
    strikeoutPenalty -
    samplePenalty
  );
}

function edge(score) {
  if (score >= 84) return "Elite";
  if (score >= 76) return "Strong";
  if (score >= 68) return "Value";
  if (score >= 60) return "Watch";
  return "Thin";
}

function projectedRBIs(hitter, pitcher) {
  const plateAppearances = hitter.plateAppearances > 0 ? hitter.plateAppearances : 1;
  const rbiRate = hitter.rbi / plateAppearances;
  const basePlateAppearances = 4.3;
  const powerBoost = Math.max(0, (hitter.ops - 0.720) * 0.55);
  const pitcherBoost = pitcher
    ? Math.max(-0.12, Math.min(0.25, (pitcher.whip - 1.25) * 0.22 + (pitcher.era - 4.20) * 0.018))
    : 0;

  const projection = basePlateAppearances * Math.max(0.050, rbiRate + powerBoost + pitcherBoost);
  return Number(Math.max(0.2, Math.min(2.2, projection)).toFixed(1));
}

async function main() {
  if (!fs.existsSync(POOL_FILE)) throw new Error("Missing player pool");

  const poolData = readJson(POOL_FILE);
  const players = poolData.players || [];
  const pitcherCache = new Map();
  const rows = [];

  for (const player of players) {
    if (!player.playerId) continue;

    console.log(`Scoring ${player.player}`);

    const hitter = await getHitterStats(player.playerId);
    let pitcher = null;

    if (player.opposingProbablePitcherId) {
      if (!pitcherCache.has(player.opposingProbablePitcherId)) {
        pitcherCache.set(
          player.opposingProbablePitcherId,
          await getPitcherStats(player.opposingProbablePitcherId)
        );
      }
      pitcher = pitcherCache.get(player.opposingProbablePitcherId);
    }

    const score = buildScore(hitter, pitcher);

    const projection = projectedRBIs(hitter, pitcher);

    rows.push({
      rank: 0,
      player: player.player,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      score,
      projection,
      projectedRBIs: projection,
      seasonTotal: hitter.rbi,
      marketStatLabel: "Projected RBI",
      marketStatValue: projection,
      odds: "N/A",
      edge: edge(score),
      note: `Projected RBI ${projection} • Season RBI ${hitter.rbi} • OPS ${hitter.ops || "--"} • SLG ${hitter.slg || "--"}`,
      stats: {
        hitter,
        pitcher
      }
    });
  }

  rows.sort((a, b) => b.score - a.score);

  const finalRows = rows.slice(0, 40).map((row, index) => ({
    ...row,
    rank: index + 1
  }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(finalRows, null, 2));

  console.log("RBI board saved");
  console.log("Players:", finalRows.length);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
