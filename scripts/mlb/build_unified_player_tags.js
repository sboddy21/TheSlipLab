import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, "website", "data");
const HR_FILE = path.join(DATA_DIR, "mlb_home_runs.json");
const TAG_FILE = path.join(DATA_DIR, "unified_player_tags.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function add(tags, tag, reason) {
  if (!tag) return;
  if (tags.some(t => t.tag === tag)) return;
  tags.push({ tag, reason });
}

function buildTags(row) {
  const tags = [];

  const prob = num(row.realHrProbability);
  const score = num(row.score);
  const truePower = num(row.truePowerScore);
  const hrPower = num(row.hrPowerIndex);
  const launch = num(row.launchPowerScore);
  const damage = num(row.contactDamageScore);
  const hitter = row.stats?.hitter || {};
  const pitcher = row.stats?.pitcher || {};

  if (prob >= 20) add(tags, "NUCLEAR HR", `${prob}% calibrated HR probability`);
  else if (prob >= 16) add(tags, "ELITE HR", `${prob}% calibrated HR probability`);
  else if (prob >= 12) add(tags, "STRONG HR", `${prob}% calibrated HR probability`);
  else if (prob >= 9) add(tags, "LIVE HR", `${prob}% calibrated HR probability`);
  else if (prob >= 6) add(tags, "LONGSHOT HR", `${prob}% calibrated HR probability`);

  if (truePower >= 74) add(tags, "ELITE POWER", `True power score ${truePower}`);
  else if (truePower >= 62) add(tags, "STRONG POWER", `True power score ${truePower}`);
  else if (truePower >= 50) add(tags, "VIABLE POWER", `True power score ${truePower}`);

  if (hrPower >= 80) add(tags, "HR RATE EDGE", `HR power index ${hrPower}`);
  else if (hrPower >= 68) add(tags, "POWER RATE", `HR power index ${hrPower}`);

  if (launch >= 70) add(tags, "LAUNCH UPSIDE", `Launch power score ${launch}`);
  else if (launch >= 58) add(tags, "LIFT PROFILE", `Launch power score ${launch}`);

  if (damage >= 80) add(tags, "DAMAGE BAT", `Contact damage score ${damage}`);
  else if (damage >= 68) add(tags, "EXTRA BASE THREAT", `Contact damage score ${damage}`);

  if (num(hitter.hr) >= 18) add(tags, "SEASON POWER", `${hitter.hr} HR this season`);
  else if (num(hitter.hr) >= 12) add(tags, "POWER FORM", `${hitter.hr} HR this season`);

  if (num(hitter.slg) >= 0.58) add(tags, "SLG HAMMER", `${hitter.slg} SLG`);
  else if (num(hitter.slg) >= 0.5) add(tags, "SLG EDGE", `${hitter.slg} SLG`);

  if (num(hitter.ops) >= 0.95) add(tags, "OPS HEATER", `${hitter.ops} OPS`);
  else if (num(hitter.ops) >= 0.85) add(tags, "OPS EDGE", `${hitter.ops} OPS`);

  if (num(pitcher.homeRuns) >= 12) add(tags, "PITCHER HR LEAK", `${pitcher.homeRuns} HR allowed`);
  else if (num(pitcher.homeRuns) >= 8) add(tags, "PITCHER POWER RISK", `${pitcher.homeRuns} HR allowed`);

  if (num(pitcher.era) >= 5.25) add(tags, "PITCHER DAMAGE RISK", `${pitcher.era} ERA`);
  if (num(pitcher.whip) >= 1.45) add(tags, "TRAFFIC EDGE", `${pitcher.whip} WHIP`);

  if (score >= 70) add(tags, "MODEL CORE", `Board score ${score}`);
  else if (score >= 60) add(tags, "MODEL EDGE", `Board score ${score}`);
  else if (score >= 50) add(tags, "MODEL WATCH", `Board score ${score}`);

  const primaryTags = tags.slice(0, 6).map(t => t.tag);
  const tagReasons = tags.slice(0, 6);

  return {
    primaryTags,
    tagReasons,
    tagSummary: primaryTags.join(" • ")
  };
}

function main() {
  const rows = readJson(HR_FILE, []);

  if (!Array.isArray(rows)) {
    throw new Error("website/data/mlb_home_runs.json is not an array");
  }

  const enriched = rows.map(row => {
    const built = buildTags(row);

    return {
      ...row,
      tags: built.primaryTags,
      unifiedTags: built.primaryTags,
      tagReasons: built.tagReasons,
      tagSummary: built.tagSummary
    };
  });

  const tagOutput = {
    generatedAt: new Date().toISOString(),
    source: "Unified Player Tag Engine",
    players: enriched.map(row => ({
      player: row.player,
      playerId: row.playerId,
      team: row.team,
      opponent: row.opponent,
      probabilityRank: row.probabilityRank,
      realHrProbability: row.realHrProbability,
      probabilityTier: row.probabilityTier,
      score: row.score,
      truePowerScore: row.truePowerScore,
      powerTier: row.powerTier,
      tags: row.tags,
      tagReasons: row.tagReasons,
      tagSummary: row.tagSummary
    }))
  };

  writeJson(HR_FILE, enriched);
  writeJson(TAG_FILE, tagOutput);

  console.log("");
  console.log("UNIFIED PLAYER TAGS BUILT");
  console.log("Players:", enriched.length);
  console.log("Saved:", TAG_FILE);
  console.log("");
}

main();
