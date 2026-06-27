const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const allowedWriters = new Set([
  "scripts/mlb/build_hr_decision_center.js",
  "scripts/mlb/enrich_hr_decision_pitchers.js",
  "scripts/mlb/finalize_hr_decision_center.js"
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

const files = walk(path.join(ROOT, "scripts"));

const offenders = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");

  const writesDecision =
    /write\s*\(\s*["']hr_decision_center\.json["']/.test(text) ||
    /writeFileSync\s*\([^)]*hr_decision_center\.json/.test(text);

  if (writesDecision && !allowedWriters.has(rel)) {
    offenders.push(rel);
  }
}

if (offenders.length) {
  console.error("");
  console.error("FAILED: Unauthorized scripts write hr_decision_center.json");
  for (const f of offenders) console.error(" - " + f);
  console.error("");
  process.exit(1);
}

console.log("Decision Center ownership check passed.");
