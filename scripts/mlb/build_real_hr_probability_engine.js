import fs from "fs";
import path from "path";

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

if (!rows.length) {
  const playerPool = readRequired("mlb_player_pool.json");
  if (playerPool?.availability !== "no_games_scheduled") {
    throw new Error("mlb_home_runs.json contains no players");
  }

  write("hr_probability_tracking.json", {
    generatedAt: new Date().toISOString(),
    date: playerPool.date,
    availability: "no_games_scheduled",
    scoringMode: "Calibrated Logistic HR Probability",
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
    const probability = clamp(logisticProbability(rawHrEventScore) * 100, 1.5, 24);

    return {
      player,
      team,
      opponent,
      probabilityRank: 0,
      rawHrEventScore,
      realHrProbability: round(probability, 1),
      probabilityTier: probabilityTier(probability),
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

write("hr_probability_tracking.json", {
  generatedAt: new Date().toISOString(),
  scoringMode: "Calibrated Logistic HR Probability",
  players: calibrated
});

console.log("");
console.log("REAL HR PROBABILITY ENGINE CALIBRATED");
console.log("Players:", calibrated.length);
console.log("Top Probability:", calibrated[0].realHrProbability);
console.log("Tracking Export Created");
console.log("");
