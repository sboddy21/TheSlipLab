import { spawnSync } from "child_process";
import fs from "fs";

const steps = ["scripts/wnba/fetch_wnba_today.js", "scripts/wnba/build_wnba_baselines.js", "scripts/wnba/build_wnba_projection_board.js"];
const outputFiles = ["website/data/wnba_games_today.json", "website/data/wnba_player_baselines.json", "website/data/wnba_team_baselines.json", "website/data/wnba_projection_board.json", "website/data/wnba_projection_history.json", "website/data/wnba_calibration.json"];
const startedAt = Date.now();
for (const step of steps) {
  const result = spawnSync(process.execPath, [step], { stdio: "inherit", env: process.env });
  if (result.status !== 0) process.exit(result.status || 1);
}
for (const outputFile of outputFiles) {
  if (!fs.existsSync(outputFile)) throw new Error(`Missing WNBA output: ${outputFile}`);
  const data = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  const timestamp = Date.parse(data.fetchedAt || data.generatedAt || data.updatedAt || "");
  if (data.sport !== "WNBA") throw new Error(`${outputFile} has an invalid sport marker`);
  if (!Number.isFinite(timestamp) || timestamp < startedAt - 2000) throw new Error(`${outputFile} was not refreshed during this run`);
}
console.log(`WNBA REFRESH VALIDATION PASSED: ${outputFiles.length} outputs`);
