const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const allowedWriters = new Set([
  "scripts/mlb/build_hr_decision_center.js"
]);

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function writesTarget(text, target) {
  const escapedTarget = escapeRegex(target);
  const writeCall = "(?:write|writeJson|writeJSON|(?:fs\\.)?writeFileSync)";
  const directWrite = new RegExp(`${writeCall}\\s*\\([^;\\n]*[\"']${escapedTarget}[\"']`);

  if (directWrite.test(text)) return true;

  const declaration = new RegExp(
    `(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*[^;]*[\"']${escapedTarget}[\"'][^;]*;`,
    "g"
  );

  for (const match of text.matchAll(declaration)) {
    const variable = escapeRegex(match[1]);
    if (new RegExp(`${writeCall}\\s*\\(\\s*${variable}\\b`).test(text)) return true;
  }

  return false;
}

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

  const writesDecision = writesTarget(text, "hr_decision_center.json");

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
