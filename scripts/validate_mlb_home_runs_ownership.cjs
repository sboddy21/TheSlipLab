const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const allowedWriters = new Set([
  "scripts/mlb/build_master_hr_model.js"
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
const offenders = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");

  if (writesMlbHomeRuns(text) && !allowedWriters.has(rel)) {
    offenders.push(rel);
  }
}

for (const required of allowedWriters) {
  if (!fs.existsSync(path.join(ROOT, required))) {
    offenders.push(`MISSING REQUIRED OWNER: ${required}`);
  }
}

if (offenders.length) {
  console.error("");
  console.error("FAILED: Unauthorized MLB home run writers found");
  for (const file of offenders) console.error(" - " + file);
  console.error("");
  process.exit(1);
}

console.log("MLB home runs ownership check passed.");
console.log("Sole owner:");
for (const file of allowedWriters) console.log(" - " + file);
