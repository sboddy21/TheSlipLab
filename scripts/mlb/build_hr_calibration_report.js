import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(
    path.join(DATA_DIR, file),
    JSON.stringify(data, null, 2)
  );
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.players)) return data.players;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.homeRuns)) return data.homeRuns;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v, d = 2) {
  return Number(num(v).toFixed(d));
}

function key(player, team) {
  return `${String(player || "").trim().toLowerCase()}|${String(team || "").trim().toLowerCase()}`;
}

function playerName(row) {
  return row.player || row.name || row.batter || row.hitter || "";
}

function teamName(row) {
  return row.team || row.battingTeam || row.playerTeam || "";
}

function didHitHr(row) {
  return Boolean(
    row.did_homer === true ||
    row.actualHr === true ||
    row.actual_hr === true ||
    row.hitHr === true ||
    row.hit_hr === true ||
    row.hr === true ||
    num(row.homeRuns) > 0 ||
    num(row.home_runs) > 0 ||
    num(row.hrs) > 0
  );
}

function tierSummary(rows, resultMap) {
  const tiers = {};

  for (const row of rows) {
    const tier = row.probabilityTier || "UNKNOWN";

    if (!tiers[tier]) {
      tiers[tier] = {
        tier,
        players: 0,
        actualHr: 0,
        avgProbability: 0,
        hitRate: 0
      };
    }

    const result = resultMap.get(key(playerName(row), teamName(row)));
    const hit = result ? didHitHr(result) : didHitHr(row);

    tiers[tier].players += 1;
    tiers[tier].actualHr += hit ? 1 : 0;
    tiers[tier].avgProbability += num(row.realHrProbability);
  }

  return Object.values(tiers).map(tier => ({
    ...tier,
    avgProbability: round(tier.avgProbability / Math.max(1, tier.players), 2),
    hitRate: round((tier.actualHr / Math.max(1, tier.players)) * 100, 2)
  }));
}

function topGroup(rows, resultMap, count) {
  const sample = rows.slice(0, count);
  const actualHr = sample.filter(row => {
    const result = resultMap.get(key(playerName(row), teamName(row)));
    return result ? didHitHr(result) : didHitHr(row);
  }).length;

  return {
    count,
    players: sample.length,
    actualHr,
    hitRate: round((actualHr / Math.max(1, sample.length)) * 100, 2),
    avgProbability: round(
      sample.reduce((sum, row) => sum + num(row.realHrProbability), 0) /
        Math.max(1, sample.length),
      2
    )
  };
}

function falsePositives(rows, resultMap, limit = 15) {
  return rows
    .filter(row => {
      const result = resultMap.get(key(playerName(row), teamName(row)));
      return !(result ? didHitHr(result) : didHitHr(row));
    })
    .slice(0, limit)
    .map(row => ({
      rank: row.probabilityRank,
      player: playerName(row),
      team: teamName(row),
      opponent: row.opponent,
      probability: row.realHrProbability,
      tier: row.probabilityTier,
      rawHrEventScore: row.rawHrEventScore
    }));
}

function actualHrHits(rows, resultMap) {
  return rows
    .filter(row => {
      const result = resultMap.get(key(playerName(row), teamName(row)));
      return result ? didHitHr(result) : didHitHr(row);
    })
    .map(row => ({
      rank: row.probabilityRank,
      player: playerName(row),
      team: teamName(row),
      opponent: row.opponent,
      probability: row.realHrProbability,
      tier: row.probabilityTier,
      rawHrEventScore: row.rawHrEventScore
    }));
}

const hrRows = rowsOf(readJson("mlb_home_runs.json", []));
const resultRows = rowsOf(readJson("mlb_results.json", []));

const resultMap = new Map();
for (const row of resultRows) {
  resultMap.set(key(playerName(row), teamName(row)), row);
}

const sorted = [...hrRows].sort(
  (a, b) => num(a.probabilityRank) - num(b.probabilityRank)
);

const actualHits = actualHrHits(sorted, resultMap);

const report = {
  generatedAt: new Date().toISOString(),
  sourceRows: sorted.length,
  resultRows: resultRows.length,
  resultsAvailable: resultRows.length > 0,
  summary: {
    top10: topGroup(sorted, resultMap, 10),
    top25: topGroup(sorted, resultMap, 25),
    top50: topGroup(sorted, resultMap, 50),
    fullBoard: topGroup(sorted, resultMap, sorted.length),
    actualHrCount: actualHits.length,
    averageProbabilityOfActualHr: round(
      actualHits.reduce((sum, row) => sum + num(row.probability), 0) /
        Math.max(1, actualHits.length),
      2
    )
  },
  tiers: tierSummary(sorted, resultMap),
  actualHrHits: actualHits,
  biggestFalsePositives: falsePositives(sorted, resultMap, 20),
  notes: [
    resultRows.length > 0
      ? "Results were found and included in the calibration report."
      : "No mlb_results.json rows were found yet, so hit rate fields will remain zero until results are available.",
    "This report does not change the website layout.",
    "This report only evaluates the calibrated HR probability layer."
  ]
};

writeJson("hr_calibration_report.json", report);

console.log("");
console.log("HR CALIBRATION REPORT BUILT");
console.log("Source rows:", report.sourceRows);
console.log("Result rows:", report.resultRows);
console.log("Results available:", report.resultsAvailable);
console.log("Top 10 hit rate:", report.summary.top10.hitRate + "%");
console.log("Top 25 hit rate:", report.summary.top25.hitRate + "%");
console.log("Saved: website/data/hr_calibration_report.json");
console.log("");
