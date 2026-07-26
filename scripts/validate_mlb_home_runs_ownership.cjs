const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();

const ownershipRules = [
  {
    target: "mlb_home_runs.json",
    allowedWriters: new Set(["scripts/mlb/build_master_hr_model.js"])
  },
  {
    target: "player_card_data.json",
    allowedWriters: new Set(["scripts/build_player_card_data.js"])
  },
  {
    target: "live_change_alerts.json",
    allowedWriters: new Set(["scripts/mlb/build_live_change_alerts.js"])
  },
  {
    target: "mlb_market_odds.json",
    allowedWriters: new Set(["scripts/mlb/build_market_odds.js"])
  },
  {
    target: "game_pitcher_matchups.json",
    allowedWriters: new Set(["scripts/mlb/build_game_pitcher_matchups.mjs"])
  },
  {
    target: "site_last_updated.json",
    allowedWriters: new Set(["scripts/run_fast_refresh.js"])
  },
  {
    target: "statcast_zones.json",
    allowedWriters: new Set(["scripts/statcast_zone_engine.js"])
  },
  {
    target: "x_posts.json",
    allowedWriters: new Set(["scripts/build_x_content.js"])
  },
  {
    target: "x_daily_queue.json",
    allowedWriters: new Set(["scripts/content/build_x_daily_queue_v2.js"])
  },
  {
    target: "x_post_history.json",
    allowedWriters: new Set([
      "scripts/content/post_x_queue.js",
      "scripts/content/post_x_daily_slate_thread.js",
      "scripts/content/post_x_daily_edge_posts.js"
    ])
  }
];

function walk(dir, out = []) {
  for (const item of fs.readdirSync(dir)) {
    if (item === "node_modules" || item === ".git") continue;

    const full = path.join(dir, item);
    const stat = fs.statSync(full);

    if (stat.isDirectory()) walk(full, out);
    else if (/\.(js|cjs|mjs|yml|yaml)$/.test(full)) out.push(full);
  }

  return out;
}

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

const files = [
  ...walk(path.join(ROOT, "scripts")),
  ...walk(path.join(ROOT, ".github"))
];
const offenders = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");

  for (const rule of ownershipRules) {
    if (writesTarget(text, rule.target) && !rule.allowedWriters.has(rel)) {
      offenders.push(`${rule.target}: ${rel}`);
    }
  }
}

for (const rule of ownershipRules) {
  for (const required of rule.allowedWriters) {
    if (!fs.existsSync(path.join(ROOT, required))) {
      offenders.push(`${rule.target}: MISSING REQUIRED OWNER ${required}`);
    }
  }
}

if (offenders.length) {
  console.error("");
  console.error("FAILED: Unauthorized canonical data writers found");
  for (const file of offenders) console.error(" - " + file);
  console.error("");
  process.exit(1);
}

console.log("Canonical ownership checks passed.");
for (const rule of ownershipRules) {
  console.log(`${rule.target} sole owner:`);
  for (const file of rule.allowedWriters) console.log(" - " + file);
}
