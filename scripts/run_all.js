import { spawnSync } from "child_process";

const steps = [
  ["Decision Center Ownership Check", "scripts/validate_decision_center_ownership.cjs"],
  ["MLB Home Runs Ownership Check", "scripts/validate_mlb_home_runs_ownership.cjs"],
  ["MLB Today", "scripts/mlb/fetch_mlb_today.js"],
  ["MLB Player Pool", "scripts/mlb/build_mlb_player_pool.js"],
  ["Master HR Model", "scripts/mlb/build_master_hr_model.js"],
  ["Weather Board", "scripts/mlb/build_weather_board.js"],
  ["HR Decision Center", "scripts/mlb/build_hr_decision_center.js"],
  ["Player Cards", "scripts/build_player_card_data.js"],
  ["AI Breakdowns", "scripts/build_hr_ai_breakdowns.cjs"],
  ["AI Stacks", "scripts/build_hr_ai_stacks.cjs"],
  ["AI History", "scripts/build_hr_ai_history.cjs"],
  ["AI Movement", "scripts/build_hr_ai_movement.cjs"],
  ["AI HOF", "scripts/build_hr_ai_hof.cjs"],
  ["X Content", "scripts/build_x_content.js"],
  ["Health Status", "scripts/build_health_status.js"]
];

console.log("");
console.log("THE SLIP LAB MAIN MLB REFRESH");
console.log("Time:", new Date().toISOString());

for (const [name, file] of steps) {
  console.log("");
  console.log("RUNNING:", name);
  console.log("node", file);

  const result = spawnSync("node", [file], {
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    console.log("");
    console.log("FAILED:", name);
    console.log("File:", file);
    process.exit(result.status || 1);
  }
}

console.log("");
console.log("THE SLIP LAB MAIN MLB REFRESH COMPLETE");
