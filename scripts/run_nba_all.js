import { spawnSync } from "child_process";

const steps = [
  ["NBA Refresh", "scripts/run_nba_refresh.js"],
  ["NBA Usage Engine", "scripts/nba/build_usage_engine.js"],
  ["NBA Core", "scripts/nba/build_nba_core.js"],
  ["NBA Team Defense", "scripts/nba/build_team_defense.js"],
  ["NBA Pace Engine", "scripts/nba/build_pace_engine.js"],
  ["NBA Defender Engine", "scripts/nba/build_defender_engine.js"],
  ["NBA Matchup Engine", "scripts/nba/build_matchup_engine.js"],
  ["NBA Decision Center", "scripts/nba/build_nba_decision_center.js"],
  ["NBA Player Cards", "scripts/nba/build_nba_player_cards.js"]
];

console.log("");
console.log("THE SLIP LAB NBA ONLY REFRESH");
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
console.log("THE SLIP LAB NBA ONLY REFRESH COMPLETE");
