import { execSync } from "child_process";
import fs from "fs";

const jobs = [
  "node scripts/mlb/fetch_mlb_today.js",
  "node scripts/mlb/build_home_run_board.js",
  "node scripts/mlb/build_hits_board.js",
  "node scripts/mlb/build_total_bases_board.js",
  "node scripts/mlb/build_rbis_board.js",
  "node scripts/mlb/build_team_stacks.js",
  "node scripts/mlb/build_weather_board.js",
  "node scripts/mlb/build_hr_results.js",
  "node scripts/mlb/build_hr_results_history.js",
  "node scripts/build_team_stack_intelligence_2.js",

  "node scripts/mlb/build_statcast_zones.js",
  "node scripts/mlb/build_pitcher_attack_zones.js",
  "node scripts/mlb/build_hr_decision_center.js",
  "node scripts/mlb/enrich_hr_decision_pitchers.js",
  "node scripts/mlb/build_hr_volatility_engine.js",
  "node scripts/mlb/build_pitch_type_destruction_engine.js",
  "node scripts/mlb/build_pull_wind_hr_engine.js",
  "node scripts/mlb/build_launch_hr_profile_engine.js",
  "node scripts/mlb/build_bullpen_inheritance_engine.js",
  "node scripts/mlb/build_multi_hr_ceiling_engine.js",
  "node scripts/mlb/build_real_hr_probability_engine.js",
  "node scripts/mlb/finalize_hr_decision_center.js",

  "node scripts/build_player_card_data.js",
  "node scripts/mlb/build_batting_spot_profiles.js",
  "node scripts/content/build_x_content.js"
];

console.log("");
console.log("THE SLIP LAB FAST REFRESH");
console.log("Time:", new Date().toISOString());
console.log("");

for (const job of jobs) {
  console.log("");
  console.log("RUNNING:", job);
  execSync(job, { stdio: "inherit" });
}

fs.mkdirSync("website/data", { recursive: true });
const now = new Date().toISOString();

fs.writeFileSync(
  "website/data/site_last_updated.json",
  JSON.stringify({
    updatedAt: now,
    updated_at: now,
    source: "render_fast_refresh_full_decision_center"
  }, null, 2)
);

console.log("");
console.log("FAST REFRESH COMPLETE");
console.log("Time:", new Date().toISOString());
