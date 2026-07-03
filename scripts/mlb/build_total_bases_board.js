import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "website", "data");
const MATCHUPS_FILE = path.join(DATA, "game_pitcher_matchups.json");
const OUT_FILE = path.join(DATA, "mlb_total_bases.json");

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

  const hits = num(stat.hits);
  const doubles = num(stat.doubles);
  const triples = num(stat.triples);
  const homeRuns = num(stat.homeRuns);
  const singles = Math.max(0, hits - doubles - triples - homeRuns);
  const totalBases = singles + doubles * 2 + triples * 3 + homeRuns * 4;

  return {
    hits,
    singles,
    doubles,
    triples,
    homeRuns,
    totalBases,
    avg: num(stat.avg),
    slg: num(stat.slg),
    ops: num(stat.ops),
    atBats: num(stat.atBats),
    plateAppearances: num(stat.plateAppearances),
    strikeOuts: num(stat.strikeOuts)
  };
}

function buildScore(hitter, pitcherRisk) {
  const powerContact =
    scale(hitter.slg, 0.300, 0.620) * 0.36 +
    scale(hitter.ops, 0.580, 1.050) * 0.24 +
    scale(hitter.totalBases, 25, 280) * 0.22 +
    scale(hitter.avg, 0.190, 0.340) * 0.18;

  const strikeoutPenalty = scale(hitter.strikeOuts, 20, 120) * 0.10;
  const samplePenalty =
    hitter.plateAppearances < 40 ? 10 :
    hitter.plateAppearances < 80 ? 5 :
    0;

  return Math.round(
    powerContact * 0.72 +
    num(pitcherRisk, 50) * 0.28 -
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

function projectedTotalBases(hitter, pitcherRisk) {
  const atBats = hitter.atBats > 0 ? hitter.atBats : 1;
  const tbRate = hitter.totalBases / atBats;
  const pitcherBoost = (num(pitcherRisk, 50) - 50) / 100;
  const projection = 4.1 * Math.max(0.250, tbRate + pitcherBoost);
  return Number(Math.max(0.6, Math.min(4.2, projection)).toFixed(1));
}

function flattenMatchupHitters(matchups) {
  const rows = [];

  for (const game of matchups.games || []) {
    for (const side of ["away", "home"]) {
      const hitters = game.hitters?.[side] || [];
      for (const hitter of hitters) {
        if (!hitter.playerId) continue;

        rows.push({
          ...hitter,
          game: game.matchup || game.game,
          gamePk: game.gamePk,
          team: hitter.team,
          opponent: hitter.opponent,
          opposingPitcher: hitter.opposingPitcher,
          opposingPitcherId: hitter.opposingPitcherId,
          pitcherRisk: hitter.pitcherRisk,
          pitcherVulnerability: hitter.pitcherVulnerability
        });
      }
    }
  }

  return rows;
}

async function main() {
  if (!fs.existsSync(MATCHUPS_FILE)) {
    throw new Error("Missing canonical game_pitcher_matchups.json");
  }

  const matchups = readJson(MATCHUPS_FILE);
  const players = flattenMatchupHitters(matchups);
  const rows = [];

  for (const player of players) {
    console.log(`Scoring TB ${player.player}`);

    const hitter = await getHitterStats(player.playerId);
    const pitcherRisk = num(player.pitcherRisk || player.pitcherVulnerability, 50);
    const score = buildScore(hitter, pitcherRisk);
    const projection = projectedTotalBases(hitter, pitcherRisk);

    rows.push({
      rank: 0,
      player: player.player,
      playerId: player.playerId,
      team: player.team,
      opponent: player.opponent,
      game: player.game,
      gamePk: player.gamePk,
      opposingPitcher: player.opposingPitcher,
      opposingPitcherId: player.opposingPitcherId,
      pitcherRisk,
      pitcherVulnerability: pitcherRisk,
      lineupStatus: player.lineupStatus,
      lineupSpot: player.lineupSpot,
      confirmedLineup: player.confirmedLineup,
      score,
      projection,
      projectedTotalBases: projection,
      seasonTotal: hitter.totalBases,
      marketStatLabel: "Projected TB",
      marketStatValue: projection,
      odds: "N/A",
      edge: edge(score),
      note: `Projected TB ${projection} • ${player.team} vs ${player.opponent} • Opposing pitcher ${player.opposingPitcher || "TBD"} • Pitcher risk ${pitcherRisk}`,
      stats: { hitter }
    });
  }

  rows.sort((a, b) => b.score - a.score);

  const finalRows = rows.slice(0, 40).map((row, index) => ({
    ...row,
    rank: index + 1
  }));

  fs.writeFileSync(OUT_FILE, JSON.stringify(finalRows, null, 2));

  console.log("");
  console.log("TOTAL BASES BOARD COMPLETE");
  console.log("Players:", finalRows.length);
  console.log("Saved: website/data/mlb_total_bases.json");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
