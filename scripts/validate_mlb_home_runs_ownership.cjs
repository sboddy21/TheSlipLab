const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const canonicalOwner = "scripts/mlb/build_home_run_board.js";

const temporaryWriters = new Set([
  "scripts/mlb/build_hr_volatility_engine.js",
  "scripts/mlb/build_pitch_type_destruction_engine.js",
  "scripts/mlb/build_pull_wind_hr_engine.js",
  "scripts/mlb/build_launch_hr_profile_engine.js",
  "scripts/mlb/build_bullpen_inheritance_engine.js",
  "scripts/mlb/build_multi_hr_ceiling_engine.js"
]);

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir)) {
    if (item === "node_modules" || item === ".git") continue;

    const full = path.join(dir, item);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|mjs)$/.test(full)) out.push(full);
  }

  return out;
}

function writesMlbHomeRuns(text) {
  return (
    /write\s*\(\s*["']mlb_home_runs\.json["']/.test(text) ||
    /writeFileSync\s*\([^)]*mlb_home_runs\.json/.test(text) ||
    /const\s+OUT_FILE\s*=\s*path\.join\([^;]*mlb_home_runs\.json/.test(text) ||
    /const\s+OUTFILE\s*=\s*path\.join\([^;]*mlb_home_runs\.json/.test(text)
  );
}

const files = walk(path.join(ROOT, "scripts"));
const writers = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");

  if (writesMlbHomeRuns(text)) {
    writers.push(rel);
  }
}

const unknown = writers.filter(file => file !== canonicalOwner && !temporaryWriters.has(file));
const missingOwner = !writers.includes(canonicalOwner);

if (missingOwner) {
  console.error("");
  console.error("FAILED: Canonical MLB home run owner is missing:");
  console.error(" - " + canonicalOwner);
  console.error("");
  process.exit(1);
}

if (unknown.length) {
  console.error("");
  console.error("FAILED: Unknown scripts write mlb_home_runs.json");
  for (const file of unknown) console.error(" - " + file);
  console.error("");
  process.exit(1);
}

console.log("MLB home runs ownership audit passed.");
console.log("Canonical owner:", canonicalOwner);
console.log("Temporary writers pending Phase 4B:", temporaryWriters.size);
for (const file of [...temporaryWriters].filter(file => writers.includes(file))) {
  console.log(" - " + file);
}
