import { execSync } from "child_process";

const jobs = [
  "node scripts/mlb/fetch_mlb_today.js",

  "node scripts/mlb/build_mlb_player_pool.js",
  "node scripts/mlb/build_home_run_board.js",
  "node scripts/mlb/build_hits_board.js",
  "node scripts/mlb/build_team_stacks.js",

  "node scripts/mlb/build_weather_board.js",
  "node scripts/mlb/build_pitcher_attack_zones.js",
  "node scripts/mlb/build_pitch_type_damage.js",

  "node scripts/mlb/build_launch_angle_clusters.js",
  "node scripts/mlb/build_hot_cold_attack_regions.js",
  "node scripts/mlb/build_handedness_overlays.js",
  "node scripts/mlb/build_park_carry_visuals.js",

  "node scripts/statcast_zone_engine.js",

  "node scripts/build_team_stack_intelligence_2.js",

  "node scripts/content/build_x_content.js"
];

console.log("");
console.log("THE SLIP LAB FULL PIPELINE");
console.log("");

for (const job of jobs) {
  console.log("");
  console.log("==================================================");
  console.log(`RUNNING: ${job}`);
  console.log("==================================================");
  console.log("");

  try {
    execSync(job, {
      stdio: "inherit"
    });

    console.log("");
    console.log(`SUCCESS: ${job}`);
  } catch (err) {
    console.log("");
    console.log(`FAILED: ${job}`);
    console.log("");

    process.exit(1);
  }
}

console.log("");
console.log("THE SLIP LAB PIPELINE COMPLETE");
console.log("");
