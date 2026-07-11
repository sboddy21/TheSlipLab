import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";

const refreshStartedAt = Date.now();

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

const expectedOutputs = [
  ["NBA Today", "website/data/nba_games_today.json", true],
  ["NBA Player Pool", "website/data/nba_player_pool.json", true],
  ["NBA History", "website/data/nba_history.json", true],
  ["NBA Minutes Engine", "website/data/nba_minutes_engine.json", true],
  ["NBA Usage Engine", "website/data/nba_usage_engine.json", true],
  ["NBA Core", "website/data/nba_core.json", true],
  ["NBA Team Defense", "website/data/nba_team_defense.json", true],
  ["NBA Pace Engine", "website/data/nba_pace_engine.json", true],
  ["NBA Defender Engine", "website/data/nba_defender_engine.json", true],
  ["NBA Points Board", "website/data/nba_points.json", true],
  ["NBA Rebounds Board", "website/data/nba_rebounds.json", true],
  ["NBA Assists Board", "website/data/nba_assists.json", true],
  ["NBA Threes Board", "website/data/nba_threes.json", true],
  ["NBA Matchup Engine", "website/data/nba_matchup_engine.json", true],
  ["NBA Player Cards", "website/data/nba_player_cards.json", true],
  ["NBA Decision Center", "website/data/nba_decision_center.json", true]
];

function todayET() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function readOutput(label, file) {
  if (!fs.existsSync(file)) {
    throw new Error(`${label} did not create ${file}`);
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} created invalid JSON at ${file}: ${error.message}`);
  }
}

function outputTimestamp(data) {
  return data?.fetchedAt || data?.updatedAt || data?.generatedAt || "";
}

function validateRefresh() {
  const today = todayET();
  const failures = [];

  for (const [label, file, requiresDate] of expectedOutputs) {
    let data;

    try {
      data = readOutput(label, file);
    } catch (error) {
      failures.push(error.message);
      continue;
    }

    if (requiresDate && data.date !== today) {
      failures.push(`${label} date is ${data.date || "missing"}; expected ${today}`);
    }

    if (data.preservedAt || data.preserveReason) {
      failures.push(`${label} reused a preserved output instead of current data`);
    }

    const timestamp = outputTimestamp(data);
    const timestampMs = Date.parse(timestamp);
    if (!timestamp || !Number.isFinite(timestampMs)) {
      failures.push(`${label} has no valid embedded refresh timestamp`);
    } else if (timestampMs < refreshStartedAt - 2000) {
      failures.push(`${label} was not rebuilt during this refresh`);
    }

    const source = String(data.source || "").toLowerCase();
    if (source.includes("fallback") || source.includes("previous nba")) {
      failures.push(`${label} reports a stale or fallback source: ${data.source}`);
    }
  }

  if (failures.length) {
    console.error("");
    console.error("NBA REFRESH VALIDATION FAILED");
    failures.forEach(failure => console.error(`- ${failure}`));
    process.exit(1);
  }

  console.log("");
  console.log("NBA REFRESH VALIDATION PASSED");
  console.log("Date:", today);
  console.log("Outputs:", expectedOutputs.length);
}

console.log("");
console.log("THE SLIP LAB NBA REFRESH");
console.log("Time:", new Date().toISOString());
console.log("");

function runBuilder([label, file]) {
  if (!fs.existsSync(file)) {
    console.error("");
    console.error(`FAILED: ${label}`);
    console.error(`Missing builder: ${file}`);
    process.exit(1);
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

const [todayStep, ...remainingSteps] = steps;
runBuilder(todayStep);

const todayData = readOutput("NBA Today", "website/data/nba_games_today.json");
const hasGames = Array.isArray(todayData.games) && todayData.games.length > 0;

console.log("NBA slate mode:", hasGames ? "games scheduled" : "no games scheduled");
remainingSteps.forEach(runBuilder);

validateRefresh();

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
