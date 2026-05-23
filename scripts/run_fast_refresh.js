import { execSync } from "child_process";

const jobs = [
  "node scripts/mlb/fetch_mlb_today.js",
  "node scripts/mlb/build_home_run_board.js",
  "node scripts/mlb/build_hits_board.js",
  "node scripts/mlb/build_team_stacks.js",
  "node scripts/mlb/build_weather_board.js",
  "node scripts/mlb/build_hr_results.js",
  "node scripts/build_team_stack_intelligence_2.js",
  "node scripts/content/build_x_content.js"
];

console.log("");
console.log("THE SLIP LAB FAST REFRESH");
console.log("");

for (const job of jobs) {
  console.log("");
  console.log("RUNNING:", job);
  execSync(job, { stdio: "inherit" });
}

console.log("");
console.log("FAST REFRESH COMPLETE");
