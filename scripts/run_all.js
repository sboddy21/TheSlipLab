import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const steps = [
  ["Slate", "scripts/mlb/fetch_mlb_today.js"],
  ["Player Pool", "scripts/mlb/build_mlb_player_pool.js"],
  ["Full Board", "scripts/mlb/build_home_run_board.js"],
  ["HR Volatility Engine", "scripts/mlb/build_hr_volatility_engine.js"],
  ["Game Pitcher Matchups", "scripts/mlb/build_game_pitcher_matchups.mjs"],
  ["Team Stacks", "scripts/mlb/build_team_stacks.js"],
  ["Weather", "scripts/mlb/build_weather_board.js"],
  ["Results", "scripts/mlb/build_hr_results.js"],
  ["Power Zones", "scripts/mlb/build_statcast_zones.js"],
  ["Pitcher Attack Zones", "scripts/mlb/build_pitcher_attack_zones.js"],
  ["Decision Center", "scripts/mlb/build_hr_decision_center.js"],
  ["Decision Pitcher Enrichment", "scripts/mlb/enrich_hr_decision_pitchers.js"],
  ["Decision Volatility Engine", "scripts/mlb/build_hr_volatility_engine.js"],
  ["Pitch Type Destruction Engine", "scripts/mlb/build_pitch_type_destruction_engine.js"],
  ["Pull Wind HR Engine", "scripts/mlb/build_pull_wind_hr_engine.js"],
  ["Advanced Player Intelligence", "scripts/build_advanced_player_intelligence.js"],
  ["Player Card Data", "scripts/build_player_card_data.js"],
  "scripts/mlb/build_batting_spot_profiles.js",
  ["Live Intelligence", "scripts/run_live_intelligence.js"]
];

console.log("THE SLIP LAB FULL AUTO REFRESH");
console.log("==============================");

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
  path.join("website", "data", "site_last_updated.json"),
  JSON.stringify({
    updatedAt: now,
    updated_at: now,
    source: "run_all",
    sections: [
      "slate",
      "full_board",
      "matchup_lab",
      "power_zones",
      "quick_target",
      "heat_check",
      "streak_lab",
      "weather",
      "results",
      "decision_center"
    ]
  }, null, 2)
);

console.log("");
console.log("THE SLIP LAB FULL AUTO REFRESH COMPLETE");
