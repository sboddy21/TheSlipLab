import { spawnSync } from "child_process";

const steps = [
  "node scripts/mlb/fetch_mlb_today.js",
  "node scripts/mlb/build_mlb_player_pool.js",
  "node scripts/mlb/build_home_run_board.js",
  "node scripts/mlb/build_hits_board.js",
  "node scripts/mlb/build_total_bases_board.js",
  "node scripts/mlb/build_rbi_board.js",
  "node scripts/mlb/build_pitcher_strikeouts_board.js",
  "node scripts/mlb/build_game_pitcher_matchups.mjs",
  "node scripts/content/build_x_content.js"
];

for (const step of steps) {
  console.log("RUNNING:", step);

  const result = spawnSync(step, {
    shell: true,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error("FAILED:", step);
    process.exit(result.status || 1);
  }
}

console.log("FAST REFRESH COMPLETE");
console.log("Time:", new Date().toISOString());
