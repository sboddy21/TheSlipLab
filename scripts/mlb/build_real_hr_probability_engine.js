import fs from "fs";
import path from "path";
import {
  adjustProbabilityForPlateAppearances,
  lineupConfidence
} from "./lib/plate_appearance_probability.js";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

function readRequired(file) {
  const fullPath = path.join(DATA_DIR, file);

  if (!fs.existsSync(fullPath)) {
    throw new Error(`Required input does not exist: ${fullPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(fullPath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read ${fullPath}: ${error.message}`);
  }
}

function write(file, data) {
  const fullPath = path.join(DATA_DIR, file);
  const tempPath = `${fullPath}.tmp`;

  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  fs.renameSync(tempPath, fullPath);
}

function rowsOf(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.players)) return data.players;
  throw new Error("mlb_home_runs.json must be an array or contain a players array");
}

function requiredText(row, field, rowIndex) {
  const value = String(row?.[field] ?? "").trim();
  if (!value) {
    throw new Error(`Row ${rowIndex + 1} is missing required field ${field}`);
  }
  return value;
}

function requiredNumber(row, field, player) {
  const value = row?.[field];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${player} is missing required signal ${field}`);
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${player} has invalid signal ${field}: ${value}`);
  }

  return number;
}

function round(value, digits = 1) {
  return Number(value.toFixed(digits));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function logisticProbability(score) {
  const k = 0.055;
  const midpoint = 98;
  return 1 / (1 + Math.exp(-k * (score - midpoint)));
}

function probabilityTier(prob) {
  if (prob >= 20) return "NUCLEAR";
  if (prob >= 16) return "ELITE";
  if (prob >= 12) return "STRONG";
  if (prob >= 9) return "VIABLE";
  if (prob >= 6) return "LONGSHOT";
  return "LOW";
}

function calculateEventScore(row, player) {
  const modelScore = requiredNumber(row, "finalHrScore", player);
  const ceiling = requiredNumber(row, "multiHrCeilingScore", player);
  const pitch = requiredNumber(row, "pitchTypeDestructionScore", player);
  const launch = requiredNumber(row, "launchHrProfileScore", player);
  const pullWind = requiredNumber(row, "pullWindHrScore", player);

  return round(
    modelScore +
      ceiling * 0.12 +
      pitch * 0.08 +
      launch * 0.06 +
      pullWind * 0.05,
    2
  );
}

const homeRuns = readRequired("mlb_home_runs.json");
const rows = rowsOf(homeRuns);
const lineupImpact = readRequired("lineup_impact_engine.json");
const playerPool = readRequired("mlb_player_pool.json");

const normalize = value => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const lineupRows = Array.isArray(lineupImpact?.rows) ? lineupImpact.rows : [];
const poolRows = Array.isArray(playerPool?.players) ? playerPool.players : [];
const lineupById = new Map(lineupRows.filter(row => row.playerId).map(row => [String(row.playerId), row]));
const lineupByName = new Map(lineupRows.map(row => [normalize(row.player), row]));
const poolById = new Map(poolRows.filter(row => row.playerId).map(row => [String(row.playerId), row]));
const poolByName = new Map(poolRows.map(row => [normalize(row.player), row]));

if (!rows.length) {
  const playerPool = readRequired("mlb_player_pool.json");
  if (playerPool?.availability !== "no_games_scheduled") {
    throw new Error("mlb_home_runs.json contains no players");
  }

  write("hr_probability_tracking.json", {
    generatedAt: new Date().toISOString(),
    date: playerPool.date,
    availability: "no_games_scheduled",
    scoringMode: "Calibrated Logistic HR Probability + Expected PA",
    players: []
  });

  console.log("");
  console.log("REAL HR PROBABILITY ENGINE CALIBRATED");
  console.log("Availability: no games scheduled");
  console.log("Players: 0");
  console.log("Tracking Export Created");
  console.log("");
  process.exit(0);
}

const calibrated = rows
  .map((row, rowIndex) => {
    const player = requiredText(row, "player", rowIndex);
    const team = requiredText(row, "team", rowIndex);
    const opponent = requiredText(row, "opponent", rowIndex);
    const rawHrEventScore = calculateEventScore(row, player);
    const playerId = Number.isFinite(Number(row.playerId)) ? Number(row.playerId) : null;
    const lineup = lineupById.get(String(playerId)) || lineupByName.get(normalize(player)) || {};
    const pool = poolById.get(String(playerId)) || poolByName.get(normalize(player)) || {};
    const lineupStatus = pool.lineupStatus || lineup.lineupSource || "PROJECTED";
    const confirmedLineup = Boolean(pool.confirmedLineup || lineup.confirmedLineup);
    const lineupSpot = Number(pool.lineupSpot || lineup.lineupSpot) || null;
    const expectedPlateAppearances = lineupStatus === "NOT IN LINEUP"
      ? 0
      : Number(lineup.projectedPlateAppearances || 4.05);
    const baseProbability = clamp(logisticProbability(rawHrEventScore) * 100, 1.5, 24);
    const probability = adjustProbabilityForPlateAppearances(baseProbability, expectedPlateAppearances, { lineupStatus });
    const opportunityAdjustmentPct = baseProbability
      ? ((probability / baseProbability) - 1) * 100
      : 0;

    return {
      playerId,
      player,
      team,
      opponent,
      probabilityRank: 0,
      rawHrEventScore,
      baseHrProbability: round(baseProbability, 1),
      realHrProbability: round(probability, 1),
      probabilityTier: lineupStatus === "NOT IN LINEUP" ? "OUT" : probabilityTier(probability),
      expectedPlateAppearances: round(expectedPlateAppearances, 2),
      opportunityAdjustmentPct: round(opportunityAdjustmentPct, 1),
      lineupSpot,
      lineupStatus,
      confirmedLineup,
      lineupConfidence: lineupConfidence({ lineupStatus, confirmedLineup, lineupSpot }),
      actualHr: typeof row.actualHr === "boolean" ? row.actualHr : null
    };
  })
  .sort(
    (a, b) =>
      b.realHrProbability - a.realHrProbability ||
      b.rawHrEventScore - a.rawHrEventScore ||
      a.player.localeCompare(b.player)
  )
  .map((row, index) => ({
    ...row,
    probabilityRank: index + 1
  }));

for (const row of calibrated) {
  const validExpectedPa = row.lineupStatus === "NOT IN LINEUP"
    ? row.expectedPlateAppearances === 0
    : row.expectedPlateAppearances >= 3.7 && row.expectedPlateAppearances <= 4.75;
  if (!Number.isFinite(row.expectedPlateAppearances) || !validExpectedPa) {
    throw new Error(`${row.player} has invalid expected plate appearances: ${row.expectedPlateAppearances}`);
  }
  if (row.lineupStatus === "NOT IN LINEUP" && (row.realHrProbability !== 0 || row.probabilityTier !== "OUT")) {
    throw new Error(`${row.player} was not suppressed after being removed from the lineup`);
  }
  if (row.realHrProbability < 0 || row.realHrProbability > 24) {
    throw new Error(`${row.player} has invalid opportunity-adjusted probability: ${row.realHrProbability}`);
  }
}

write("hr_probability_tracking.json", {
  generatedAt: new Date().toISOString(),
  scoringMode: "Calibrated Logistic HR Probability + Expected PA",
  opportunityModel: {
    baselinePlateAppearances: 4.3,
    minimumPlateAppearances: 3.7,
    maximumPlateAppearances: 4.75,
    notInLineupProbability: 0
  },
  players: calibrated
});

console.log("");
console.log("REAL HR PROBABILITY ENGINE CALIBRATED");
console.log("Players:", calibrated.length);
console.log("Top Probability:", calibrated[0].realHrProbability);
console.log("Tracking Export Created");
console.log("");
