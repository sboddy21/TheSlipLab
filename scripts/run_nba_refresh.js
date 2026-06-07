import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const steps = [
  ["NBA Today", "scripts/nba/fetch_nba_today.js"],
  ["NBA Player Pool", "scripts/nba/build_nba_player_pool.js"],
  ["NBA History", "scripts/nba/build_nba_history.js"],
  ["NBA Minutes Engine", "scripts/nba/build_minutes_engine.js"],
  ["NBA Usage Engine", "scripts/nba/build_usage_engine.js"],
  ["NBA Core", "scripts/nba/build_nba_core.js"],
  ["NBA Team Defense", "scripts/nba/build_team_defense.js"],
  ["NBA Pace Engine", "scripts/nba/build_pace_engine.js"],
  ["NBA Defender Engine", "scripts/nba/build_defender_engine.js"],
  ["NBA Points Board", "scripts/nba/build_points_board.js"],
  ["NBA Rebounds Board", "scripts/nba/build_rebounds_board.js"],
  ["NBA Assists Board", "scripts/nba/build_assists_board.js"],
  ["NBA Threes Board", "scripts/nba/build_threes_board.js"],
  ["NBA Matchup Engine", "scripts/nba/build_matchup_engine.js"],
  ["NBA Player Cards", "scripts/nba/build_nba_player_cards.js"],
  ["NBA Decision Center", "scripts/nba/build_nba_decision_center.js"]
];

console.log("");
console.log("THE SLIP LAB NBA REFRESH");
console.log("Time:", new Date().toISOString());
console.log("");

for (const [label, file] of steps) {
  if (!fs.existsSync(file)) {
    console.log("");
    console.log(`SKIPPED: ${label}`);
    console.log(`Missing file: ${file}`);
    continue;
  }

  console.log("");
  console.log(`RUNNING: ${label}`);
  console.log(`node ${file}`);

  const result = spawnSync("node", [file], {
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    console.log("");
    console.log(`FAILED: ${label}`);
    console.log(`File: ${file}`);
    process.exit(result.status || 1);
  }
}

fs.mkdirSync("website/data", { recursive: true });

const now = new Date().toISOString();

fs.writeFileSync(
  path.join("website", "data", "nba_last_updated.json"),
  JSON.stringify({
    updatedAt: now,
    updated_at: now,
    source: "run_nba_refresh",
    sections: [
      "nba_today",
      "nba_points",
      "nba_rebounds",
      "nba_assists",
      "nba_threes",
      "nba_matchups",
      "nba_decision_center"
    ]
  }, null, 2)
);

console.log("");
console.log("THE SLIP LAB NBA REFRESH COMPLETE");
console.log("Time:", new Date().toISOString());
