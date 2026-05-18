import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const POOL_FILE = path.join(ROOT, "website", "data", "mlb_player_pool.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_hits.json");

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

  return {
    hits: num(stat.hits),
    avg: num(stat.avg),
    obp: num(stat.obp),
    ops: num(stat.ops),
    atBats: num(stat.atBats),
    strikeOuts: num(stat.strikeOuts),
    plateAppearances: num(stat.plateAppearances),
    doubles: num(stat.doubles),
    triples: num(stat.triples)
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
    inningsPitched: num(stat.inningsPitched)
  };
}

function buildScore(hitter, pitcher) {
  const contact =
    scale(hitter.avg, 0.190, 0.340) * 0.40 +
    scale(hitter.obp, 0.250, 0.450) * 0.25 +
    scale(hitter.hits, 15, 170) * 0.20 +
    scale(hitter.ops, 0.550, 1.050) * 0.15;

  const pitcherAttack = pitcher
    ? scale(pitcher.whip, 0.90, 1.70) * 0.60 +
      scale(pitcher.era, 2.50, 6.80) * 0.40
    : 50;

  const strikeoutPenalty =
    scale(hitter.strikeOuts, 10, 90) * 0.15;

  const samplePenalty =
    hitter.plateAppearances < 40
      ? 10
      : hitter.plateAppearances < 80
      ? 5
      : 0;

  return Math.round(
    contact * 0.72 +
    pitcherAttack * 0.28 -
    strikeoutPenalty -
    samplePenalty
  );
}

function edge(score) {
  if (score >= 84) return "Elite";
  if (score >= 76) return "Strong";
  if (score >= 68) return "Safe";
  if (score >= 60) return "Watch";

  return "Thin";
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

    rows.push({
      rank: 0,
      player: player.player,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      score,
      odds: "N/A",
      edge: edge(score),
      note:
        `AVG ${hitter.avg || "--"} • OBP ${hitter.obp || "--"} • H ${hitter.hits}`,
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

  console.log("Hits board saved");
  console.log("Players:", finalRows.length);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
