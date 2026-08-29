import { spawnSync } from "child_process";

for (const step of ["scripts/nfl/fetch_nfl_foundation.js", "scripts/nfl/fetch_nfl_availability.js", "scripts/nfl/fetch_nfl_preseason_usage.js", "scripts/nfl/build_nfl_role_engine.js", "scripts/nfl/build_nfl_preseason_role_board.js", "scripts/nfl/build_nfl_matchup_context.js", "scripts/nfl/build_nfl_dress_rehearsal.js", "scripts/nfl/build_nfl_td_decision_center.js", "scripts/nfl/build_nfl_launch_audit.js", "scripts/nfl/build_nfl_foundation.js", "scripts/nfl/validate_nfl_foundation.js"]) {
  const result = spawnSync(process.execPath, [step], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log("NFL FOUNDATION REFRESH COMPLETE");
