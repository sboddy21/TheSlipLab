import { spawnSync } from "child_process";

const steps = [
  "scripts/mlb/fetch_mlb_today.js",
  "scripts/mlb/build_mlb_player_pool.js",
  "scripts/mlb/build_home_run_board.js",
  "scripts/mlb/build_game_pitcher_matchups.mjs",
  "scripts/mlb/build_team_stacks.js",
  "scripts/mlb/build_weather_board.js",
  "scripts/mlb/build_hr_results.js",
  "scripts/build_advanced_player_intelligence.js",
  "scripts/build_player_card_data.js",
  "scripts/run_live_intelligence.js"
];

console.log("THE SLIP LAB FULL AUTO REFRESH");
console.log("==============================");

for (const step of steps) {
  console.log("");
  console.log(`RUNNING: node ${step}`);

  const result = spawnSync("node", [step], {
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.log("");
    console.log(`FAILED: ${step}`);
    process.exit(result.status || 1);
  }
}

console.log("");
console.log("THE SLIP LAB FULL AUTO REFRESH COMPLETE");
