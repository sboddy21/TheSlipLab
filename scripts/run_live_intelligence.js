import { spawnSync } from "child_process";

const steps = [
  "scripts/build_bullpen_collapse_engine.js",
  "scripts/build_team_stack_intelligence_2.js",
  "scripts/build_live_game_state_engine.js",
  "scripts/build_hr_chain_reaction_engine.js",
  "scripts/build_live_hr_tracker.js",
  "scripts/build_global_live_alerts.js",
  "scripts/clean_live_duplicates.js"
];

console.log("THE SLIP LAB LIVE INTELLIGENCE PIPELINE");
console.log("======================================");

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
console.log("LIVE INTELLIGENCE PIPELINE COMPLETE");
