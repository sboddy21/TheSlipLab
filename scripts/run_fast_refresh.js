import { spawnSync } from "child_process";
import fs from "fs";

const startedAt = Date.now();

const steps = [
  ["Slate", "node scripts/mlb/fetch_mlb_today.js"],
  ["Player Pool", "node scripts/mlb/build_mlb_player_pool.js"],

  ["Full Board", "node scripts/mlb/build_home_run_board.js"],
  ["Hits Board", "node scripts/mlb/build_hits_board.js"],
  ["Total Bases Board", "node scripts/mlb/build_total_bases_board.js"],
  ["RBI Board", "node scripts/mlb/build_rbi_board.js"],
  ["Pitcher Strikeouts Board", "node scripts/mlb/build_pitcher_strikeouts_board.js"],

  ["Game Pitcher Matchups", "node scripts/mlb/build_game_pitcher_matchups.mjs"],

  ["Decision Center", "node scripts/mlb/build_hr_decision_center.js"],
  ["Decision Pitcher Enrichment", "node scripts/mlb/enrich_hr_decision_pitchers.js"],
  ["Decision Volatility Engine", "node scripts/mlb/build_hr_volatility_engine.js"],
  ["Pitch Type Destruction Engine", "node scripts/mlb/build_pitch_type_destruction_engine.js"],
  ["Pull Wind HR Engine", "node scripts/mlb/build_pull_wind_hr_engine.js"],
  ["Launch HR Profile Engine", "node scripts/mlb/build_launch_hr_profile_engine.js"],
  ["Bullpen Inheritance Engine", "node scripts/mlb/build_bullpen_inheritance_engine.js"],
  ["Bullpen Relievers", "node scripts/mlb/build_bullpen_relievers.js"],
  ["Multi HR Ceiling Engine", "node scripts/mlb/build_multi_hr_ceiling_engine.js"],
  ["Real HR Probability Engine", "node scripts/mlb/build_real_hr_probability_engine.js"],
  ["Finalize Decision Center", "node scripts/mlb/finalize_hr_decision_center.js"],

  ["X Content", "node scripts/content/build_x_content.js"]
];

function run(label, command) {
  console.log(`\n=== ${label} ===`);
  console.log("RUNNING:", command);

  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit"
  });

  if (result.status !== 0) {
    console.error(`FAILED: ${label}`);
    console.error(`COMMAND: ${command}`);
    process.exit(result.status || 1);
  }
}

function verifyDecisionCenterFresh() {
  const file = "website/data/hr_decision_center.json";

  if (!fs.existsSync(file)) {
    console.error(`FAILED: Missing ${file}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);

  if (!data.updatedAt) {
    console.error("FAILED: hr_decision_center.json is missing updatedAt");
    process.exit(1);
  }

  const updatedAtMs = new Date(data.updatedAt).getTime();

  if (!Number.isFinite(updatedAtMs)) {
    console.error("FAILED: hr_decision_center.json has invalid updatedAt:", data.updatedAt);
    process.exit(1);
  }

  if (updatedAtMs < startedAt - 5 * 60 * 1000) {
    console.error("FAILED: Decision Center did not refresh.");
    console.error("Started:", new Date(startedAt).toISOString());
    console.error("Decision Center updatedAt:", data.updatedAt);
    process.exit(1);
  }

  if (!data.sections || typeof data.sections !== "object") {
    console.error("FAILED: Decision Center missing sections object");
    process.exit(1);
  }

  const requiredSections = [
    "bestPicks",
    "safestPlays",
    "bestValue",
    "lottoBombs",
    "pitchTypeEdges",
    "weatherCarry",
    "bullpenBoosts"
  ];

  const missing = requiredSections.filter(key => !Array.isArray(data.sections[key]));

  if (missing.length) {
    console.error("FAILED: Decision Center missing sections:", missing.join(", "));
    process.exit(1);
  }

  console.log("\nDecision Center verified fresh");
  console.log("Updated:", data.updatedAt);
  console.log("Players:", data.totalPlayers);
}

for (const [label, command] of steps) {
  run(label, command);
}

verifyDecisionCenterFresh();

run("Build MLB health status", "node scripts/build_health_status.js");

console.log("\nFAST REFRESH COMPLETE");
console.log("Time:", new Date().toISOString());
