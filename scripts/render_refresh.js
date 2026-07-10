import { spawnSync } from "child_process";

function run(command, args = [], options = {}) {
  console.log("");
  console.log("==================================================");
  console.log("RUNNING:", command, args.map(a => String(a).includes("x-access-token") ? "[TOKEN HIDDEN]" : a).join(" "));
  console.log("==================================================");

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    timeout: options.timeout || 240000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    }
  });

  if (result.error) {
    console.error("COMMAND ERROR:", result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("COMMAND FAILED:", command, args.join(" "));
    console.error("EXIT STATUS:", result.status);
    process.exit(result.status || 1);
  }
}

function softRun(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    timeout: options.timeout || 60000,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0"
    }
  });

  if (result.status !== 0) {
    console.log("SOFT COMMAND DID NOT COMPLETE CLEANLY");
  }
}

console.log("");
console.log("THE SLIP LAB RENDER FAST REFRESH STARTED");
console.log("Time:", new Date().toISOString());

run("node", ["scripts/run_fast_refresh.js"], { timeout: 240000 });

console.log("");
console.log("THE SLIP LAB NBA REFRESH STARTED");

const nbaScripts = [
  "scripts/nba/fetch_nba_today.js",
  "scripts/nba/build_nba_player_pool.js",
  "scripts/nba/build_nba_history.js",
  "scripts/nba/build_minutes_engine.js",
  "scripts/nba/build_usage_engine.js",
  "scripts/nba/build_nba_core.js",
  "scripts/nba/build_team_defense.js",
  "scripts/nba/build_pace_engine.js",
  "scripts/nba/build_defender_engine.js",
  "scripts/nba/build_points_board.js",
  "scripts/nba/build_rebounds_board.js",
  "scripts/nba/build_assists_board.js",
  "scripts/nba/build_threes_board.js",
  "scripts/nba/build_matchup_engine.js",
  "scripts/nba/build_nba_player_cards.js",
  "scripts/nba/build_nba_decision_center.js"
];

for (const script of nbaScripts) {
  run("node", [script], { timeout: 300000 });
}

console.log("THE SLIP LAB NBA REFRESH COMPLETE");


run("git", ["config", "user.name", "render-refresh-bot"]);
run("git", ["config", "user.email", "render-refresh-bot@users.noreply.github.com"]);

const repoUrl = process.env.GITHUB_TOKEN
  ? `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/sboddy21/TheSlipLab.git`
  : "https://github.com/sboddy21/TheSlipLab.git";

softRun("git", ["remote", "remove", "origin"]);
run("git", ["remote", "add", "origin", repoUrl]);

run("git", ["add", "website/data", "exports/content", "data", "exports"]);

softRun("git", ["commit", "-m", "Render fast refresh MLB data"]);

softRun("git", ["pull", "--rebase", "origin", "main"], { timeout: 60000 });

run("git", ["push", "origin", "main"], { timeout: 60000 });

console.log("");
console.log("RENDER FAST REFRESH COMPLETE");
console.log("Time:", new Date().toISOString());
