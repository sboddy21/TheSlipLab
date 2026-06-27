import { spawnSync } from "child_process";
import fs from "fs";

function run(label, command) {
  console.log("");
  console.log("RUNNING:", label);

  const result = spawnSync(command, {
    stdio: "inherit",
    shell: true,
    env: process.env
  });

  if (result.status !== 0) {
    console.log("");
    console.error("FAILED:", label);
    process.exit(result.status || 1);
  }
}

const steps = [
  ["Decision Center Ownership Check", "node scripts/validate_decision_center_ownership.cjs"],
  ["MLB Home Runs Ownership Check", "node scripts/validate_mlb_home_runs_ownership.cjs"],

  ["MLB Today", "node scripts/mlb/fetch_mlb_today.js"],
  ["MLB Player Pool", "node scripts/mlb/build_mlb_player_pool.js"],
  ["Game Pitcher Matchups", "node scripts/mlb/build_game_pitcher_matchups.mjs"],

  ["Pitch Type Damage", "node scripts/mlb/build_pitch_type_damage.js"],
  ["Weather Board", "node scripts/mlb/build_weather_board.js"],
  ["Bullpen Relievers", "node scripts/mlb/build_bullpen_relievers.js"],
  ["Master HR Model", "node scripts/mlb/build_master_hr_model.js"],
  ["Real HR Probability Engine", "node scripts/mlb/build_real_hr_probability_engine.js"],

  ["HR Decision Center", "node scripts/mlb/build_hr_decision_center.js"],
  ["Final Ownership Check", "node scripts/validate_decision_center_ownership.cjs"],

  ["Player Card Data", "node scripts/build_player_card_data.js"],
  ["AI Trust Engine", "node scripts/build_ai_trust_engine.cjs"],
  ["AI Reasoning Engine", "node scripts/build_ai_reasoning_engine.cjs"],
  ["AI Breakdowns", "node scripts/build_hr_ai_breakdowns.cjs"],
  ["AI History", "node scripts/build_hr_ai_history.cjs"],
  ["AI Movement", "node scripts/build_hr_ai_movement.cjs"],
  ["AI Hall of Fame", "node scripts/build_hr_ai_hof.cjs"],
  ["AI Stacks", "node scripts/build_hr_ai_stacks.cjs"],
  ["Health Status", "node scripts/build_health_status.js"],
  ["X Content", "node scripts/build_x_content.js"]
];

console.log("");
console.log("THE SLIP LAB FAST REFRESH");
console.log("Time:", new Date().toISOString());

for (const [label, command] of steps) {
  run(label, command);
}

const file = "website/data/hr_decision_center.json";

if (!fs.existsSync(file)) {
  console.error("FAILED: hr_decision_center.json does not exist");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, "utf8"));

if (!data.updatedAt) {
  console.error("FAILED: hr_decision_center.json is missing updatedAt");
  process.exit(1);
}

if (!data.sections || typeof data.sections !== "object") {
  console.error("FAILED: Decision Center missing sections object");
  process.exit(1);
}

const requiredSections = [
  "bestPicks",
  "safestPlays",
  "bestValue",
  "lottoBombs",
  "pitchTypeEdges",
  "weatherCarry",
  "bullpenBoosts",
  "ifOnlyOne"
];

for (const section of requiredSections) {
  if (!data.sections[section]) {
    console.error(`FAILED: Decision Center missing section ${section}`);
    process.exit(1);
  }
}

if (!Array.isArray(data.allPlayers)) {
  console.error("FAILED: Decision Center missing allPlayers array");
  process.exit(1);
}

if (!data.pitcherDebug || typeof data.pitcherDebug !== "object") {
  console.error("FAILED: Decision Center missing pitcherDebug");
  process.exit(1);
}

console.log("");
console.log("FAST REFRESH VALIDATION PASSED");
console.log("Players:", data.allPlayers.length);
console.log("Pitcher Debug:", data.pitcherDebug);
console.log("THE SLIP LAB FAST REFRESH COMPLETE");
