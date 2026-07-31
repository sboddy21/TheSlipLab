import { spawnSync } from "child_process";
import fs from "fs";

const outputFile = "website/data/wnba_games_today.json";
const startedAt = Date.now();
const result = spawnSync(process.execPath, ["scripts/wnba/fetch_wnba_today.js"], { stdio: "inherit", env: process.env });
if (result.status !== 0) process.exit(result.status || 1);
if (!fs.existsSync(outputFile)) throw new Error(`Missing WNBA output: ${outputFile}`);
const data = JSON.parse(fs.readFileSync(outputFile, "utf8"));
const fetchedAt = Date.parse(data.fetchedAt || "");
if (data.sport !== "WNBA") throw new Error("WNBA output has an invalid sport marker");
if (!Array.isArray(data.games)) throw new Error("WNBA output is missing its games array");
if (!Number.isFinite(fetchedAt) || fetchedAt < startedAt - 2000) throw new Error("WNBA output was not refreshed during this run");
console.log("WNBA REFRESH VALIDATION PASSED");
