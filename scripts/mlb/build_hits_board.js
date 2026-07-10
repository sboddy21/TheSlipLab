import fs from "fs";
import path from "path";

const ROOT = process.cwd();

const POOL_FILE = path.join(ROOT, "website", "data", "mlb_player_pool.json");
const HR_FILE = path.join(ROOT, "website", "data", "mlb_home_runs.json");
const MATCHUPS_FILE = path.join(ROOT, "website", "data", "game_pitcher_matchups.json");
const OUT_FILE = path.join(ROOT, "website", "data", "mlb_hits.json");

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function rows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  return payload.players || payload.games || payload.rows || payload.data || payload.matchups || [];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inningsToNumber(value) {
  if (typeof value === "number") return value;
  if (value === undefined || value === null || value === "") return 0;

  const str = String(value);
  if (!str.includes(".")) return num(str);

  const [whole, frac] = str.split(".");
  return num(whole) + num(frac) / 3;
}

function lineupPlateAppearances(spot) {
  const map = {
    1: 4.65,
    2: 4.55,
    3: 4.45,
    4: 4.35,
    5: 4.25,
    6: 4.15,
    7: 4.05,
    8: 3.95,
    9: 3.85
  };

  return map[num(spot)] || 4.05;
}

function buildMatchupIndex(games) {
  const index = new Map();

  for (const game of games) {
    for (const hitter of [
      ...(game.hitters?.away || []),
      ...(game.hitters?.home || [])
    ]) {
      if (!hitter?.playerId) continue;

      index.set(String(hitter.playerId), {
        hitter,
        game
      });
    }
  }

  return index;
}

function hitterProfile(row, poolRow, matchupRow) {
  const stats =
    matchupRow?.hitter?.stats?.hitter ||
    row?.stats?.hitter ||
    {};

  const atBats = num(stats.atBats);
  const plateAppearances = num(stats.plateAppearances);
  const hits = num(stats.hits);
  const strikeOuts = num(stats.strikeOuts);

  return {
    hits,
    avg: num(stats.avg),
    obp: num(stats.obp),
    slg: num(stats.slg),
    ops: num(stats.ops),
    doubles: num(stats.doubles),
    triples: num(stats.triples),
    homeRuns: num(stats.hr ?? stats.homeRuns),
    atBats,
    plateAppearances,
    strikeOuts,
    hitRate: atBats > 0 ? hits / atBats : 0,
    kRate: plateAppearances > 0 ? strikeOuts / plateAppearances : 0,
    sampleReliability: clamp(plateAppearances / 250, 0.18, 1),
    lineupSpot: num(
      matchupRow?.hitter?.lineupSpot ??
      poolRow?.lineupSpot,
      0
    ),
    confirmedLineup: Boolean(
      matchupRow?.hitter?.confirmedLineup ??
      poolRow?.confirmedLineup
    ),
    lineupStatus:
      matchupRow?.hitter?.lineupStatus ||
      poolRow?.lineupStatus ||
      "PROJECTED"
  };
}

function pitcherProfile(row, matchupRow) {
  const stats =
    matchupRow?.hitter?.stats?.pitcher ||
    row?.stats?.pitcher ||
    {};

  const innings = inningsToNumber(stats.inningsPitched);
  const hits = num(stats.hits);
  const walks = num(stats.baseOnBalls ?? stats.walks);
  const homeRuns = num(stats.homeRuns);

  return {
    era: num(stats.era),
    whip: num(stats.whip),
    hits,
    inningsPitched: Number(innings.toFixed(1)),
    strikeOuts: num(stats.strikeOuts),
    walks,
    homeRuns,
    hPer9: innings > 0 ? Number(((hits / innings) * 9).toFixed(2)) : 0,
    bbPer9: innings > 0 ? Number(((walks / innings) * 9).toFixed(2)) : 0
  };
}

function projectionEngine(hitter, pitcher) {
  const expectedPA = lineupPlateAppearances(hitter.lineupSpot);

  const pitcherHitAdjustment = clamp(
    (pitcher.hPer9 - 8.7) * 0.018,
    -0.08,
    0.12
  );

  const whipAdjustment = clamp(
    (pitcher.whip - 1.28) * 0.10,
    -0.05,
    0.07
  );

  const strikeoutAdjustment = clamp(
    (0.225 - hitter.kRate) * 0.18,
    -0.04,
    0.05
  );

  const sampleAdjustedHitRate =
    hitter.hitRate * hitter.sampleReliability +
    0.238 * (1 - hitter.sampleReliability);

  const adjustedHitRate = clamp(
    sampleAdjustedHitRate +
    pitcherHitAdjustment +
    whipAdjustment +
    strikeoutAdjustment,
    0.14,
    0.39
  );

  const projectedHits = clamp(
    expectedPA * adjustedHitRate,
    0.45,
    2.25
  );

  return {
    expectedPlateAppearances: Number(expectedPA.toFixed(2)),
    rawHitRate: Number(hitter.hitRate.toFixed(3)),
    sampleAdjustedHitRate: Number(sampleAdjustedHitRate.toFixed(3)),
    pitcherHitAdjustment: Number(pitcherHitAdjustment.toFixed(3)),
    whipAdjustment: Number(whipAdjustment.toFixed(3)),
    strikeoutAdjustment: Number(strikeoutAdjustment.toFixed(3)),
    adjustedHitRate: Number(adjustedHitRate.toFixed(3)),
    projectedHits: Number(projectedHits.toFixed(1))
  };
}

function confidenceEngine(hitter, pitcher, projection) {
  let confidence = 36;

  confidence += clamp(
    (projection.projectedHits - 1.0) * 17,
    -8,
    16
  );

  confidence += clamp(
    (hitter.hitRate - 0.238) * 70,
    -7,
    8
  );

  confidence += clamp(
    (0.225 - hitter.kRate) * 42,
    -6,
    6
  );

  confidence += clamp(
    (pitcher.hPer9 - 8.7) * 1.7,
    -5,
    6
  );

  confidence += clamp(
    (pitcher.whip - 1.28) * 8,
    -4,
    4
  );

  confidence += clamp(
    (hitter.sampleReliability - 0.65) * 13,
    -7,
    5
  );

  if (hitter.confirmedLineup) confidence += 4;
  else confidence -= 5;

  if (hitter.lineupSpot >= 1 && hitter.lineupSpot <= 3) confidence += 3;
  else if (hitter.lineupSpot >= 4 && hitter.lineupSpot <= 6) confidence += 1;
  else if (hitter.lineupSpot >= 7) confidence -= 3;

  if (hitter.plateAppearances < 50) confidence -= 14;
  else if (hitter.plateAppearances < 100) confidence -= 9;
  else if (hitter.plateAppearances < 175) confidence -= 5;
  else if (hitter.plateAppearances < 250) confidence -= 2;

  if (hitter.kRate >= 0.30) confidence -= 6;
  else if (hitter.kRate >= 0.26) confidence -= 3;

  return Math.round(clamp(confidence, 20, 88));
}

function edge(score, projection) {
  if (score >= 82 && projection >= 1.7) return "Elite";
  if (score >= 70 && projection >= 1.45) return "Strong";
  if (score >= 61 && projection >= 1.25) return "Value";
  if (score >= 50 && projection >= 1.05) return "Watch";
  return "Thin";
}

function buildNote(hitter, pitcher, projection) {
  return [
    `Projected Hits ${projection.projectedHits}`,
    `AVG ${hitter.avg || "--"}`,
    `K% ${hitter.kRate ? `${(hitter.kRate * 100).toFixed(1)}%` : "--"}`,
    `Pitcher H/9 ${pitcher.hPer9 || "--"}`,
    hitter.confirmedLineup
      ? `Confirmed #${hitter.lineupSpot || "?"}`
      : "Projected lineup"
  ].join(" • ");
}

function main() {
  const pool = rows(readJson(POOL_FILE, []));
  const hrRows = rows(readJson(HR_FILE, []));
  const games = rows(readJson(MATCHUPS_FILE, []));

  const poolById = new Map(
    pool.map(player => [String(player.playerId), player])
  );

  const matchupById = buildMatchupIndex(games);
  const output = [];

  for (const row of hrRows) {
    if (!row?.playerId || !row?.stats?.hitter) continue;

    const id = String(row.playerId);
    const poolRow = poolById.get(id) || {};
    const matchupRow = matchupById.get(id) || {};

    const hitter = hitterProfile(row, poolRow, matchupRow);
    const pitcher = pitcherProfile(row, matchupRow);

    if (!hitter.atBats || !hitter.plateAppearances) continue;

    const projection = projectionEngine(hitter, pitcher);
    const score = confidenceEngine(hitter, pitcher, projection);

    output.push({
      rank: 0,
      player: row.player,
      playerId: row.playerId,
      team: row.team || poolRow.team,
      opponent: row.opponent || poolRow.opponent,
      game: row.game || poolRow.game,
      gamePk: poolRow.gamePk,
      venue: row.venue || poolRow.venue,
      lineupSpot: hitter.lineupSpot || null,
      lineupStatus: hitter.lineupStatus,
      confirmedLineup: hitter.confirmedLineup,
      opposingPitcher:
        row.opposingPitcher ||
        poolRow.opposingProbablePitcher ||
        "",
      score,
      projection: projection.projectedHits,
      projectedHits: projection.projectedHits,
      seasonTotal: hitter.hits,
      marketStatLabel: "Projected Hits",
      marketStatValue: projection.projectedHits,
      odds: "N/A",
      edge: edge(score, projection.projectedHits),
      note: buildNote(hitter, pitcher, projection),
      stats: {
        hitter,
        pitcher,
        projection
      }
    });
  }

  output.sort((a, b) =>
    b.score - a.score ||
    b.projectedHits - a.projectedHits ||
    b.stats.hitter.hitRate - a.stats.hitter.hitRate
  );

  const finalRows = output.slice(0, 40).map((row, index) => ({
    ...row,
    rank: index + 1
  }));

  fs.writeFileSync(
    OUT_FILE,
    JSON.stringify(finalRows, null, 2)
  );

  console.log("Hits board saved");
  console.log("Players:", finalRows.length);
  console.log(
    "Top:",
    finalRows
      .slice(0, 8)
      .map(row =>
        `${row.rank}. ${row.player} ${row.projectedHits} hits ${row.score} ${row.edge}`
      )
      .join(" | ")
  );
}

main();
