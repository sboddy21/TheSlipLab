import { spawnSync } from "child_process";

function run(command, args = [], options = {}) {
  console.log("");
  console.log("==================================================");
  console.log("RUNNING:", command, args.join(" "));
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
  console.log("");
  console.log("SOFT RUNNING:", command, args.join(" "));

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
    timeout: options.timeout || 120000,
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
console.log("THE SLIP LAB RENDER REFRESH STARTED");
console.log("Time:", new Date().toISOString());

run("node", ["scripts/mlb/fetch_mlb_today.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_mlb_player_pool.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_home_run_board.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_hits_board.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_team_stacks.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_weather_board.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_pitcher_attack_zones.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_pitch_type_damage.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_launch_angle_clusters.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_hot_cold_attack_regions.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_handedness_overlays.js"], { timeout: 60000 });
run("node", ["scripts/mlb/build_park_carry_visuals.js"], { timeout: 60000 });
run("node", ["scripts/statcast_zone_engine.js"], { timeout: 60000 });
run("node", ["scripts/build_team_stack_intelligence_2.js"], { timeout: 60000 });
run("node", ["scripts/content/build_x_content.js"], { timeout: 60000 });

run("node", [
  "-e",
  "const fs=require('fs');fs.mkdirSync('website/data',{recursive:true});fs.writeFileSync('website/data/site_last_updated.json',JSON.stringify({updatedAt:new Date().toISOString(),updated_at:new Date().toISOString(),source:'render_cron_5_min'},null,2));"
]);

run("git", ["config", "user.name", "render-refresh-bot"]);
run("git", ["config", "user.email", "render-refresh-bot@users.noreply.github.com"]);

if (process.env.GITHUB_TOKEN) {
  run("git", ["remote", "set-url", "origin", `https://x-access-token:${process.env.GITHUB_TOKEN}@github.com/sboddy21/TheSlipLab.git`]);
}

run("git", ["add", "website/data", "exports/content", "data", "exports"]);

softRun("git", ["commit", "-m", "Render auto refresh MLB data"]);

softRun("git", ["pull", "--rebase", "origin", "main"], { timeout: 60000 });

run("git", ["push", "origin", "main"], { timeout: 60000 });

console.log("");
console.log("RENDER REFRESH COMPLETE");
console.log("Time:", new Date().toISOString());
