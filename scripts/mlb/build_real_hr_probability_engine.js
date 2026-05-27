import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");

function read(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
  } catch {
    return fallback;
  }
}

function write(file, data) {
  fs.writeFileSync(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function round(v, d = 1) {
  return Number(num(v).toFixed(d));
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function logisticProbability(score) {
  const k = 0.055;
  const midpoint = 82;
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

function archetypeModifier(row) {
  const barrel = num(row.barrelRate || row.barrel_pct);
  const iso = num(row.iso || row.ISO);
  const pullAir = num(row.pullAirRate || row.pull_air_rate);
  const flyball = num(row.flyBallRate || row.fly_ball_rate);

  let mod = 1;

  if (barrel >= 18) mod += 0.08;
  else if (barrel >= 14) mod += 0.05;
  else if (barrel >= 10) mod += 0.03;

  if (iso >= 0.3) mod += 0.07;
  else if (iso >= 0.25) mod += 0.05;
  else if (iso >= 0.2) mod += 0.03;

  if (pullAir >= 18) mod += 0.05;
  else if (pullAir >= 14) mod += 0.03;

  if (flyball >= 45) mod += 0.03;

  return mod;
}

function calculateEventScore(row) {
  const modelScore =
    num(row.score) ||
    num(row.hr_score) ||
    num(row.modelScore) ||
    num(row.final_score) ||
    50;

  const ceiling = num(row.multiHrCeiling) || num(row.ceilingScore);
  const pitch = num(row.pitchTypeDestructionScore);
  const launch = num(row.launchHrScore);
  const pullWind = num(row.pullWindScore);
  const hr7 = num(row.last7Hr) || num(row.hrLast7);

  let score = modelScore;

  score += ceiling * 0.12;
  score += pitch * 0.08;
  score += launch * 0.06;
  score += pullWind * 0.05;
  score += hr7 * 1.4;

  score *= archetypeModifier(row);

  return round(score, 2);
}

const homeRuns = read("mlb_home_runs.json", []);
const dc = read("hr_decision_center.json", null);

const rows = Array.isArray(homeRuns)
  ? homeRuns
  : Array.isArray(homeRuns.players)
  ? homeRuns.players
  : [];

const calibrated = rows
  .map(row => {
    const rawEventScore = calculateEventScore(row);
    const rawProbability = logisticProbability(rawEventScore);
    const finalProbability = clamp(rawProbability * 100, 1.5, 24);

    return {
      ...row,
      rawHrEventScore: round(rawEventScore, 2),
      realHrProbability: round(finalProbability, 1),
      probabilityTier: probabilityTier(finalProbability),
      probabilityRank: 0
    };
  })
  .sort((a, b) => num(b.realHrProbability) - num(a.realHrProbability))
  .map((row, index) => ({
    ...row,
    probabilityRank: index + 1
  }));

write("mlb_home_runs.json", calibrated);

if (dc && Array.isArray(dc.rows)) {
  write("hr_decision_center.json", {
    ...dc,
    rows: calibrated
  });
}

write("hr_probability_tracking.json", {
  generatedAt: new Date().toISOString(),
  scoringMode: "Calibrated Logistic HR Probability",
  players: calibrated.map(row => ({
    player: row.player,
    team: row.team,
    opponent: row.opponent,
    probabilityRank: row.probabilityRank,
    rawHrEventScore: row.rawHrEventScore,
    realHrProbability: row.realHrProbability,
    probabilityTier: row.probabilityTier,
    actualHr: false
  }))
});

console.log("");
console.log("REAL HR PROBABILITY ENGINE CALIBRATED");
console.log("Players:", calibrated.length);
console.log("Top Probability:", calibrated[0]?.realHrProbability || 0);
console.log("Tracking Export Created");
console.log("");
