import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const POOL_FILE = path.join(ROOT, "website", "data", "mlb_player_pool.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_total_bases.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function getJson(url) {
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Request failed ${res.status}: ${url}`);
  }

  return res.json();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function scale(value, min, max) {
  const n = num(value);

  return Math.max(
    0,
    Math.min(
      100,
      ((n - min) / (max - min)) * 100
    )
  );
}

async function getHitterStats(playerId) {
  const url =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=hitting`;

  const data = await getJson(url);

  const stat =
    data?.stats?.[0]?.splits?.[0]?.stat || {};

  const hits = num(stat.hits);
  const doubles = num(stat.doubles);
  const triples = num(stat.triples);
  const homeRuns = num(stat.homeRuns);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const totalBases = singles + doubles * 2 + triples * 3 + homeRuns * 4;
  const atBats = num(stat.atBats);
  const slugging = num(stat.slg);
  const avg = num(stat.avg);
  const ops = num(stat.ops);

  return {
    hits,
    singles,
    doubles,
    triples,
    homeRuns,
    totalBases,
    avg,
    slg: slugging,
    ops,
    atBats,
    plateAppearances: num(stat.plateAppearances),
    strikeOuts: num(stat.strikeOuts)
  };
}

async function getPitcherStats(playerId) {
  if (!playerId) return null;

  const url =
    `https://statsapi.mlb.com/api/v1/people/${playerId}/stats?stats=season&group=pitching`;

  const data = await getJson(url);

  const stat =
    data?.stats?.[0]?.splits?.[0]?.stat || {};

  return {
    era: num(stat.era),
    whip: num(stat.whip),
    hits: num(stat.hits),
    homeRuns: num(stat.homeRuns),
    inningsPitched: num(stat.inningsPitched)
  };
}

function buildScore(hitter, pitcher) {
  const powerContact =
    scale(hitter.slg, 0.300, 0.620) * 0.36 +
    scale(hitter.ops, 0.580, 1.050) * 0.24 +
    scale(hitter.totalBases, 25, 280) * 0.22 +
    scale(hitter.avg, 0.190, 0.340) * 0.18;

  const pitcherAttack = pitcher
    ? scale(pitcher.whip, 0.90, 1.75) * 0.42 +
      scale(pitcher.era, 2.50, 6.80) * 0.34 +
      scale(pitcher.hits, 20, 190) * 0.24
    : 50;

  const strikeoutPenalty =
    scale(hitter.strikeOuts, 20, 120) * 0.10;

  const samplePenalty =
    hitter.plateAppearances < 40
      ? 10
      : hitter.plateAppearances < 80
      ? 5
      : 0;

  return Math.round(
    powerContact * 0.72 +
    pitcherAttack * 0.28 -
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

function projectedTotalBases(hitter, pitcher) {
  const atBats = hitter.atBats > 0 ? hitter.atBats : 1;
  const tbRate = hitter.totalBases / atBats;
  const baseAtBats = 4.1;
  const pitcherBoost = pitcher
    ? Math.max(-0.35, Math.min(0.45, (pitcher.whip - 1.25) * 0.55 + (pitcher.era - 4.20) * 0.045))
    : 0;

  const projection = baseAtBats * Math.max(0.250, tbRate + pitcherBoost);
  return Number(Math.max(0.6, Math.min(4.2, projection)).toFixed(1));
}

async function main() {
  if (!fs.existsSync(POOL_FILE)) {
    throw new Error("Missing player pool");
  }

  const poolData = readJson(POOL_FILE);
  const players = poolData.players || [];

  const pitcherCache = new Map();
  const rows = [];

  for (const player of players) {
    if (!player.playerId) continue;

    console.log(`Scoring ${player.player}`);

    const hitter =
      await getHitterStats(player.playerId);

    let pitcher = null;

    if (player.opposingProbablePitcherId) {
      if (!pitcherCache.has(player.opposingProbablePitcherId)) {
        pitcherCache.set(
          player.opposingProbablePitcherId,
          await getPitcherStats(player.opposingProbablePitcherId)
        );
      }

      pitcher =
        pitcherCache.get(player.opposingProbablePitcherId);
    }

    const score = buildScore(hitter, pitcher);

    const projection = projectedTotalBases(hitter, pitcher);

    rows.push({
      rank: 0,
      player: player.player,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      score,
      projection,
      projectedTotalBases: projection,
      seasonTotal: hitter.totalBases,
      marketStatLabel: "Projected TB",
      marketStatValue: projection,
      odds: "N/A",
      edge: edge(score),
      note:
        `Projected TB ${projection} • Season TB ${hitter.totalBases} • SLG ${hitter.slg || "--"} • OPS ${hitter.ops || "--"}`,
      stats: {
        hitter,
        pitcher
      }
    });
  }

  rows.sort((a, b) => b.score - a.score);

  const finalRows =
    rows.slice(0, 40).map((row, index) => ({
      ...row,
      rank: index + 1
    }));

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(finalRows, null, 2)
  );

  console.log("Total bases board saved");
  console.log("Players:", finalRows.length);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
